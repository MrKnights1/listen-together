import { beforeEach, describe, expect, test } from "bun:test";
import { YouTubeTrackResolver } from "@/modules/catalog/application/youtube/YouTubeTrackResolver.ts";
import { PlaylistNotFound, UnsupportedTrackUrl } from "@/modules/catalog/domain/errors.ts";
import {
  FakeClock,
  InMemoryTrackRepository,
  StubYouTubeCatalog,
  track,
  videoFacts,
  videoId,
} from "@/modules/catalog/tests/support/fakes.ts";

const NOW = new Date("2026-10-15T10:00:00.000Z");
const DAY = 24 * 60 * 60 * 1000;

let youtube: StubYouTubeCatalog;
let repository: InMemoryTrackRepository;
let clock: FakeClock;
let resolver: YouTubeTrackResolver;

beforeEach(() => {
  youtube = new StubYouTubeCatalog();
  repository = new InMemoryTrackRepository();
  clock = new FakeClock(NOW);
  resolver = new YouTubeTrackResolver(youtube, repository, clock, {
    regionCode: "EE",
    maxPlaylistItems: 5,
    cacheTtlMs: 30 * DAY,
  });
});

const watch = (id: string) => new URL(`https://www.youtube.com/watch?v=${id}`);
const playlist = (id: string) => new URL(`https://www.youtube.com/playlist?list=${id}`);

describe("YouTubeTrackResolver — a video", () => {
  test("resolves a link to its track", async () => {
    youtube.add(videoFacts("dQw4w9WgXcQ"));

    const resolution = await resolver.resolve(watch("dQw4w9WgXcQ"));

    expect(resolution.kind).toBe("video");
    expect(resolution.tracks.map((one) => one.id)).toEqual(["youtube:dQw4w9WgXcQ"]);
    expect(resolution.skipped).toEqual([]);
    expect(resolution.truncated).toBe(false);
  });

  test("caches what YouTube said", async () => {
    youtube.add(videoFacts("dQw4w9WgXcQ"));

    await resolver.resolve(watch("dQw4w9WgXcQ"));

    expect(repository.ids()).toEqual(["youtube:dQw4w9WgXcQ"]);
  });

  /** The point of the cache: repeats and re-adds cost no quota. */
  test("answers a second paste from the cache without asking YouTube", async () => {
    youtube.add(videoFacts("dQw4w9WgXcQ"));
    await resolver.resolve(watch("dQw4w9WgXcQ"));

    clock.advance(29 * DAY);
    await resolver.resolve(watch("dQw4w9WgXcQ"));

    expect(youtube.videoCalls).toHaveLength(1);
  });

  test("asks YouTube again once the cached copy is 30 days old", async () => {
    youtube.add(videoFacts("dQw4w9WgXcQ"));
    await resolver.resolve(watch("dQw4w9WgXcQ"));

    clock.advance(30 * DAY);
    await resolver.resolve(watch("dQw4w9WgXcQ"));

    expect(youtube.videoCalls).toHaveLength(2);
  });

  test("reports an ineligible video as skipped, with its title and the reason", async () => {
    youtube.add(videoFacts("dQw4w9WgXcQ", { embeddable: false, title: "Blocked Song" }));

    const resolution = await resolver.resolve(watch("dQw4w9WgXcQ"));

    expect(resolution.tracks).toEqual([]);
    expect(resolution.skipped).toEqual([
      { providerTrackId: "dQw4w9WgXcQ", title: "Blocked Song", reason: "not_embeddable" },
    ]);
  });

  test("caches an ineligible video too, so pasting it again costs nothing", async () => {
    youtube.add(videoFacts("dQw4w9WgXcQ", { embeddable: false }));
    await resolver.resolve(watch("dQw4w9WgXcQ"));

    await resolver.resolve(watch("dQw4w9WgXcQ"));

    expect(youtube.videoCalls).toHaveLength(1);
  });

  test("reports a video YouTube does not answer for as not found", async () => {
    const resolution = await resolver.resolve(watch("dQw4w9WgXcQ"));

    expect(resolution.skipped).toEqual([
      { providerTrackId: "dQw4w9WgXcQ", title: null, reason: "not_found" },
    ]);
    expect(repository.ids()).toEqual([]);
  });

  test("refuses a YouTube link that names no video or playlist", async () => {
    await expect(resolver.resolve(new URL("https://www.youtube.com/@channel"))).rejects.toThrow(
      UnsupportedTrackUrl,
    );
  });
});

describe("YouTubeTrackResolver — a playlist", () => {
  test("resolves to its videos in playlist order", async () => {
    const ids = [videoId(3), videoId(1), videoId(2)];
    youtube.playlists.set("PLmine", ids);
    youtube.add(...ids.map((id) => videoFacts(id)));

    const resolution = await resolver.resolve(playlist("PLmine"));

    expect(resolution.kind).toBe("playlist");
    expect(resolution.tracks.map((one) => one.providerTrackId)).toEqual(ids);
  });

  test("asks YouTube only about the videos the cache cannot answer", async () => {
    const ids = [videoId(1), videoId(2), videoId(3)];
    youtube.playlists.set("PLmine", ids);
    youtube.add(...ids.map((id) => videoFacts(id)));
    await repository.saveAll([track(videoId(2), { fetchedAt: NOW })]);

    await resolver.resolve(playlist("PLmine"));

    expect(youtube.videoCalls).toEqual([[videoId(1), videoId(3)]]);
  });

  test("queues a video the playlist repeats only once", async () => {
    youtube.playlists.set("PLmine", [videoId(1), videoId(2), videoId(1)]);
    youtube.add(videoFacts(videoId(1)), videoFacts(videoId(2)));

    const resolution = await resolver.resolve(playlist("PLmine"));

    expect(resolution.tracks.map((one) => one.providerTrackId)).toEqual([videoId(1), videoId(2)]);
  });

  test("takes only the first items of a playlist past the cap, and says so", async () => {
    const ids = Array.from({ length: 8 }, (_, index) => videoId(index + 1));
    youtube.playlists.set("PLbig", ids);
    youtube.add(...ids.map((id) => videoFacts(id)));

    const resolution = await resolver.resolve(playlist("PLbig"));

    expect(resolution.tracks).toHaveLength(5);
    expect(resolution.truncated).toBe(true);
  });

  test("separates the playable from the skipped, keeping each in order", async () => {
    youtube.playlists.set("PLmixed", [videoId(1), videoId(2), videoId(3), videoId(4)]);
    youtube.add(
      videoFacts(videoId(1)),
      videoFacts(videoId(2), { privacyStatus: "private" }),
      videoFacts(videoId(4), { liveBroadcastContent: "live", isoDuration: "P0D" }),
    );

    const resolution = await resolver.resolve(playlist("PLmixed"));

    expect(resolution.tracks.map((one) => one.providerTrackId)).toEqual([videoId(1)]);
    expect(resolution.skipped.map((one) => [one.providerTrackId, one.reason])).toEqual([
      [videoId(2), "private"],
      [videoId(3), "not_found"],
      [videoId(4), "live"],
    ]);
  });

  test("passes a missing playlist through as PlaylistNotFound", async () => {
    await expect(resolver.resolve(playlist("PLgone"))).rejects.toThrow(PlaylistNotFound);
  });
});

describe("YouTubeTrackResolver.refresh", () => {
  test("updates cached tracks with what YouTube says now", async () => {
    await repository.saveAll([track(videoId(1), { title: "Old title" })]);
    youtube.add(videoFacts(videoId(1), { title: "New title" }));
    clock.advance(26 * DAY);

    const refreshed = await resolver.refresh([videoId(1)]);

    expect(refreshed.map((one) => one.title)).toEqual(["New title"]);
    expect((await repository.findByIds([`youtube:${videoId(1)}`]))[0]?.fetchedAt).toEqual(
      clock.now(),
    );
  });

  test("marks a cached track YouTube stopped answering for as not found", async () => {
    await repository.saveAll([track(videoId(1))]);

    const refreshed = await resolver.refresh([videoId(1)]);

    expect(refreshed[0]?.unplayableReason).toBe("not_found");
    expect(refreshed[0]?.title).toBe(`Song ${videoId(1)}`);
  });
});
