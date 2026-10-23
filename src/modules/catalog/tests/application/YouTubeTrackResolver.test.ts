import { beforeEach, describe, expect, test } from "bun:test";
import { YouTubeTrackResolver } from "@/modules/catalog/application/youtube/YouTubeTrackResolver.ts";
import {
  PlaylistNotFound,
  SongNotInPlaylist,
  UnsupportedTrackUrl,
} from "@/modules/catalog/domain/errors.ts";
import {
  FakeClock,
  InMemoryTrackRepository,
  StubYouTubeCatalog,
  track,
  videoFacts,
  videoId,
} from "@/modules/catalog/tests/support/fakes.ts";

/** More songs than any test pastes: the room has a place for every one. */
const PLENTY = 5000;

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
/** The address bar while a playlist plays: a song, and the list it is playing from. */
const songInList = (id: string, list: string) =>
  new URL(`https://www.youtube.com/watch?v=${id}&list=${list}&index=46`);

describe("YouTubeTrackResolver — a video", () => {
  test("resolves a link to its track", async () => {
    youtube.add(videoFacts("dQw4w9WgXcQ"));

    const resolution = await resolver.resolve(watch("dQw4w9WgXcQ"), "song", PLENTY);

    expect(resolution.kind).toBe("video");
    expect(resolution.tracks.map((one) => one.id)).toEqual(["youtube:dQw4w9WgXcQ"]);
    expect(resolution.skipped).toEqual([]);
    expect(resolution.truncated).toBe(false);
  });

  test("caches what YouTube said", async () => {
    youtube.add(videoFacts("dQw4w9WgXcQ"));

    await resolver.resolve(watch("dQw4w9WgXcQ"), "song", PLENTY);

    expect(repository.ids()).toEqual(["youtube:dQw4w9WgXcQ"]);
  });

  /** The point of the cache: repeats and re-adds cost no quota. */
  test("answers a second paste from the cache without asking YouTube", async () => {
    youtube.add(videoFacts("dQw4w9WgXcQ"));
    await resolver.resolve(watch("dQw4w9WgXcQ"), "song", PLENTY);

    clock.advance(29 * DAY);
    await resolver.resolve(watch("dQw4w9WgXcQ"), "song", PLENTY);

    expect(youtube.videoCalls).toHaveLength(1);
  });

  test("asks YouTube again once the cached copy is 30 days old", async () => {
    youtube.add(videoFacts("dQw4w9WgXcQ"));
    await resolver.resolve(watch("dQw4w9WgXcQ"), "song", PLENTY);

    clock.advance(30 * DAY);
    await resolver.resolve(watch("dQw4w9WgXcQ"), "song", PLENTY);

    expect(youtube.videoCalls).toHaveLength(2);
  });

  test("reports an ineligible video as skipped, with its title and the reason", async () => {
    youtube.add(videoFacts("dQw4w9WgXcQ", { embeddable: false, title: "Blocked Song" }));

    const resolution = await resolver.resolve(watch("dQw4w9WgXcQ"), "song", PLENTY);

    expect(resolution.tracks).toEqual([]);
    expect(resolution.skipped).toEqual([
      { providerTrackId: "dQw4w9WgXcQ", title: "Blocked Song", reason: "not_embeddable" },
    ]);
  });

  test("caches an ineligible video too, so pasting it again costs nothing", async () => {
    youtube.add(videoFacts("dQw4w9WgXcQ", { embeddable: false }));
    await resolver.resolve(watch("dQw4w9WgXcQ"), "song", PLENTY);

    await resolver.resolve(watch("dQw4w9WgXcQ"), "song", PLENTY);

    expect(youtube.videoCalls).toHaveLength(1);
  });

  test("reports a video YouTube does not answer for as not found", async () => {
    const resolution = await resolver.resolve(watch("dQw4w9WgXcQ"), "song", PLENTY);

    expect(resolution.skipped).toEqual([
      { providerTrackId: "dQw4w9WgXcQ", title: null, reason: "not_found" },
    ]);
    expect(repository.ids()).toEqual([]);
  });

  test("refuses a YouTube link that names no video or playlist", async () => {
    await expect(
      resolver.resolve(new URL("https://www.youtube.com/@channel"), "song", PLENTY),
    ).rejects.toThrow(UnsupportedTrackUrl);
  });
});

describe("YouTubeTrackResolver — a playlist", () => {
  test("resolves to its videos in playlist order", async () => {
    const ids = [videoId(3), videoId(1), videoId(2)];
    youtube.playlists.set("PLmine", ids);
    youtube.add(...ids.map((id) => videoFacts(id)));

    const resolution = await resolver.resolve(playlist("PLmine"), "song", PLENTY);

    expect(resolution.kind).toBe("playlist");
    expect(resolution.tracks.map((one) => one.providerTrackId)).toEqual(ids);
  });

  test("asks YouTube only about the videos the cache cannot answer", async () => {
    const ids = [videoId(1), videoId(2), videoId(3)];
    youtube.playlists.set("PLmine", ids);
    youtube.add(...ids.map((id) => videoFacts(id)));
    await repository.saveAll([track(videoId(2), { fetchedAt: NOW })]);

    await resolver.resolve(playlist("PLmine"), "song", PLENTY);

    expect(youtube.videoCalls).toEqual([[videoId(1), videoId(3)]]);
  });

  test("queues a video the playlist repeats only once", async () => {
    youtube.playlists.set("PLmine", [videoId(1), videoId(2), videoId(1)]);
    youtube.add(videoFacts(videoId(1)), videoFacts(videoId(2)));

    const resolution = await resolver.resolve(playlist("PLmine"), "song", PLENTY);

    expect(resolution.tracks.map((one) => one.providerTrackId)).toEqual([videoId(1), videoId(2)]);
  });

  test("takes only the first items of a playlist past the cap, and says so", async () => {
    const ids = Array.from({ length: 8 }, (_, index) => videoId(index + 1));
    youtube.playlists.set("PLbig", ids);
    youtube.add(...ids.map((id) => videoFacts(id)));

    const resolution = await resolver.resolve(playlist("PLbig"), "song", PLENTY);

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

    const resolution = await resolver.resolve(playlist("PLmixed"), "song", PLENTY);

    expect(resolution.tracks.map((one) => one.providerTrackId)).toEqual([videoId(1)]);
    expect(resolution.skipped.map((one) => [one.providerTrackId, one.reason])).toEqual([
      [videoId(2), "private"],
      [videoId(3), "not_found"],
      [videoId(4), "live"],
    ]);
  });

  test("passes a missing playlist through as PlaylistNotFound", async () => {
    await expect(resolver.resolve(playlist("PLgone"), "song", PLENTY)).rejects.toThrow(
      PlaylistNotFound,
    );
  });
});

describe("YouTubeTrackResolver — a song inside a playlist", () => {
  const ids = Array.from({ length: 7 }, (_, index) => videoId(index + 1));

  beforeEach(() => {
    youtube.playlists.set("PLmine", ids);
    youtube.add(...ids.map((id) => videoFacts(id)));
  });

  test("takes just the song when that was meant, without reading the playlist", async () => {
    const resolution = await resolver.resolve(songInList(videoId(4), "PLmine"), "song", PLENTY);

    expect(resolution.kind).toBe("video");
    expect(resolution.tracks.map((one) => one.providerTrackId)).toEqual([videoId(4)]);
    expect(youtube.playlistCalls).toEqual([]);
  });

  test("takes the playlist from that song on, in playlist order", async () => {
    const resolution = await resolver.resolve(songInList(videoId(4), "PLmine"), "playlist", PLENTY);

    expect(resolution.kind).toBe("playlist");
    expect(resolution.tracks.map((one) => one.providerTrackId)).toEqual(ids.slice(3));
    expect(resolution.truncated).toBe(false);
  });

  test("counts the cap from the song, and says when there was more", async () => {
    const resolution = await resolver.resolve(songInList(videoId(2), "PLmine"), "playlist", PLENTY);

    expect(resolution.tracks.map((one) => one.providerTrackId)).toEqual(ids.slice(1, 6));
    expect(resolution.truncated).toBe(true);
  });

  test("asks YouTube about none of the songs before the linked one", async () => {
    await resolver.resolve(songInList(videoId(6), "PLmine"), "playlist", PLENTY);

    expect(youtube.videoCalls).toEqual([[videoId(6), videoId(7)]]);
  });

  test("refuses a song the playlist no longer holds", async () => {
    await expect(
      resolver.resolve(songInList("dQw4w9WgXcQ", "PLmine"), "playlist", PLENTY),
    ).rejects.toThrow(SongNotInPlaylist);
  });

  test("passes a missing playlist through as PlaylistNotFound", async () => {
    await expect(
      resolver.resolve(songInList(videoId(1), "PLgone"), "playlist", PLENTY),
    ).rejects.toThrow(PlaylistNotFound);
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

/** Every page and every lookup is a request against the daily quota. */
describe("YouTubeTrackResolver — a playlist pasted into a room with little space", () => {
  let roomy: YouTubeTrackResolver;
  beforeEach(() => {
    roomy = new YouTubeTrackResolver(youtube, repository, clock, {
      regionCode: "EE",
      maxPlaylistItems: 5000,
      cacheTtlMs: 30 * DAY,
    });
  });

  const longList = (count: number) => {
    const ids = Array.from({ length: count }, (_, index) => videoId(index + 1));
    youtube.playlists.set("PLlong", ids);
    youtube.add(...ids.map((id) => videoFacts(id)));
    return ids;
  };

  test("reads only as far as the room can take, and says the rest was left out", async () => {
    const ids = longList(30);

    const resolution = await roomy.resolve(playlist("PLlong"), "playlist", 4);

    expect(resolution.tracks.map((one) => one.providerTrackId)).toEqual(ids.slice(0, 4));
    expect(resolution.truncated).toBe(true);
    expect(youtube.videoCalls).toEqual([ids.slice(0, 4)]);
    // Three to a page in the stub: four songs, and a look at the fifth, take two of its ten pages.
    expect(youtube.playlistCalls).toHaveLength(2);
  });

  test("reads on past songs that can't play, so they take no place", async () => {
    youtube.playlists.set("PLmixed", [videoId(1), videoId(2), videoId(3), videoId(4), videoId(5)]);
    youtube.add(
      videoFacts(videoId(1), { privacyStatus: "private" }),
      videoFacts(videoId(2)),
      videoFacts(videoId(4)),
      videoFacts(videoId(5)),
    );

    const resolution = await roomy.resolve(playlist("PLmixed"), "playlist", 2);

    expect(resolution.tracks.map((one) => one.providerTrackId)).toEqual([videoId(2), videoId(4)]);
    expect(resolution.skipped.map((one) => [one.providerTrackId, one.reason])).toEqual([
      [videoId(1), "private"],
      [videoId(3), "not_found"],
    ]);
    expect(resolution.truncated).toBe(true);
  });

  test("is not cut short when the room has a place for every song", async () => {
    longList(3);

    expect((await roomy.resolve(playlist("PLlong"), "playlist", 3)).truncated).toBe(false);
  });

  test("into a full room, asks YouTube about no song, and says the playlist was left out", async () => {
    longList(30);

    const resolution = await roomy.resolve(playlist("PLlong"), "playlist", 0);

    expect(resolution.tracks).toEqual([]);
    expect(resolution.truncated).toBe(true);
    expect(youtube.videoCalls).toEqual([]);
    expect(youtube.playlistCalls).toHaveLength(1);
  });

  test("into a full room, still says a playlist is missing or a song is not in it", async () => {
    longList(4);

    await expect(roomy.resolve(playlist("PLgone"), "playlist", 0)).rejects.toThrow(
      PlaylistNotFound,
    );
    await expect(roomy.resolve(songInList("dQw4w9WgXcQ", "PLlong"), "playlist", 0)).rejects.toThrow(
      SongNotInPlaylist,
    );
  });

  test("a single song asks about that song alone, whatever the room has space for", async () => {
    youtube.add(videoFacts("dQw4w9WgXcQ"));

    const resolution = await roomy.resolve(watch("dQw4w9WgXcQ"), "song", 0);

    expect(resolution.tracks).toHaveLength(1);
    expect(youtube.videoCalls).toEqual([["dQw4w9WgXcQ"]]);
  });
});
