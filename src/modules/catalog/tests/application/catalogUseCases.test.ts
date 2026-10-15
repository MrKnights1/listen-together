import { beforeEach, describe, expect, test } from "bun:test";
import { FindTracks } from "@/modules/catalog/application/FindTracks.ts";
import {
  DELETE_AFTER_MS,
  MaintainTrackCache,
  REFRESH_AFTER_MS,
} from "@/modules/catalog/application/MaintainTrackCache.ts";
import { ResolveTrackUrl } from "@/modules/catalog/application/ResolveTrackUrl.ts";
import { YouTubeTrackResolver } from "@/modules/catalog/application/youtube/YouTubeTrackResolver.ts";
import { InvalidTrackUrl, UnsupportedTrackUrl } from "@/modules/catalog/domain/errors.ts";
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
    maxPlaylistItems: 200,
    cacheTtlMs: 30 * DAY,
  });
});

describe("ResolveTrackUrl", () => {
  test("hands a YouTube link to the YouTube resolver", async () => {
    youtube.add(videoFacts("dQw4w9WgXcQ"));

    const resolution = await new ResolveTrackUrl([resolver]).execute(
      " youtu.be/dQw4w9WgXcQ ",
      "song",
    );

    expect(resolution.tracks.map((one) => one.id)).toEqual(["youtube:dQw4w9WgXcQ"]);
  });

  test("refuses something that is not a link", async () => {
    await expect(new ResolveTrackUrl([resolver]).execute("hello", "song")).rejects.toThrow(
      InvalidTrackUrl,
    );
  });

  test("refuses a link no provider here can play", async () => {
    await expect(
      new ResolveTrackUrl([resolver]).execute("https://open.spotify.com/track/abc", "song"),
    ).rejects.toThrow(UnsupportedTrackUrl);
    expect(youtube.videoCalls).toEqual([]);
  });
});

describe("FindTracks", () => {
  test("returns cached tracks by id, once each", async () => {
    await repository.saveAll([track(videoId(1))]);

    const found = await new FindTracks(repository).execute([
      `youtube:${videoId(1)}`,
      `youtube:${videoId(1)}`,
      "youtube:missing0000",
    ]);

    expect(found.map((one) => one.providerTrackId)).toEqual([videoId(1)]);
  });
});

describe("MaintainTrackCache", () => {
  const cache = () => new MaintainTrackCache([resolver], repository, clock);
  const at = (daysAgo: number) => new Date(NOW.getTime() - daysAgo * DAY);

  test("refreshes old tracks that are still queued", async () => {
    await repository.saveAll([track(videoId(1), { fetchedAt: at(26), title: "Old" })]);
    youtube.add(videoFacts(videoId(1), { title: "New" }));

    const result = await cache().execute([`youtube:${videoId(1)}`]);

    expect(result.refreshed).toBe(1);
    expect((await repository.findByIds([`youtube:${videoId(1)}`]))[0]?.title).toBe("New");
  });

  test("leaves young tracks alone, queued or not", async () => {
    await repository.saveAll([track(videoId(1), { fetchedAt: at(24) })]);

    const result = await cache().execute([]);

    expect(result).toEqual({ refreshed: 0, deleted: 0, nowUnplayable: [] });
    expect(youtube.videoCalls).toEqual([]);
  });

  test("deletes tracks nobody has queued once they reach the 30-day limit", async () => {
    await repository.saveAll([
      track(videoId(1), { fetchedAt: at(30) }),
      track(videoId(2), { fetchedAt: at(27) }),
    ]);

    const result = await cache().execute([]);

    expect(result.deleted).toBe(1);
    expect(repository.ids()).toEqual([`youtube:${videoId(2)}`]);
  });

  test("never deletes a queued track, however old", async () => {
    await repository.saveAll([track(videoId(1), { fetchedAt: at(90) })]);
    youtube.add(videoFacts(videoId(1)));

    await cache().execute([`youtube:${videoId(1)}`]);

    expect(repository.ids()).toEqual([`youtube:${videoId(1)}`]);
  });

  test("names queued tracks that turned out to be gone, so the room can drop them", async () => {
    await repository.saveAll([
      track(videoId(1), { fetchedAt: at(26) }),
      track(videoId(2), { fetchedAt: at(26) }),
    ]);
    youtube.add(videoFacts(videoId(1)));

    const result = await cache().execute([`youtube:${videoId(1)}`, `youtube:${videoId(2)}`]);

    expect(result.nowUnplayable).toEqual([`youtube:${videoId(2)}`]);
  });

  test("keeps the policy windows where YouTube's 30-day rule needs them", () => {
    expect(REFRESH_AFTER_MS).toBeLessThan(DELETE_AFTER_MS);
    expect(DELETE_AFTER_MS).toBe(30 * DAY);
  });
});
