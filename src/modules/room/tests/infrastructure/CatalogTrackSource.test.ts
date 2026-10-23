import { beforeEach, describe, expect, test } from "bun:test";
import { openDatabase } from "@/shared/infrastructure/database.ts";
import { migrate } from "@/shared/infrastructure/migrator.ts";
import {
  CatalogError,
  FindTracks,
  MaintainTrackCache,
  ResolveTrackUrl,
  SqliteTrackRepository,
  YouTubeTrackResolver,
} from "@/modules/catalog/index.ts";
import { LinkRejected } from "@/modules/room/domain/errors.ts";
import { CatalogTrackSource } from "@/modules/room/infrastructure/CatalogTrackSource.ts";
import { FakeClock } from "@/modules/room/tests/support/fakes.ts";

/** More songs than any test pastes: the room has a place for every one. */
const PLENTY = 5000;

/**
 * The adapter through the catalog's real published use cases and its real
 * SQLite cache. Only YouTube itself is replaced — by an object with the shape
 * the resolver asks for, so nothing of the catalog's internals is imported.
 */
const NOW = Date.parse("2026-10-15T10:00:00.000Z");

/** What a quota or network failure looks like from outside the catalog. */
class YouTubeOutage extends CatalogError {
  readonly code = "provider_unavailable";
  constructor() {
    super("The YouTube Data API quota is used up for today.");
  }
}

/** YouTube's shape as the resolver's public constructor states it — no catalog internals imported. */
type YouTubeCatalogShape = ConstructorParameters<typeof YouTubeTrackResolver>[0];
type VideoFactsShape = Awaited<ReturnType<YouTubeCatalogShape["videos"]>>[number];

const videos = new Map<string, VideoFactsShape>();
let failing: Error | null;

const fakeYouTube: YouTubeCatalogShape = {
  async videos(videoIds: string[]) {
    if (failing !== null) throw failing;
    return videoIds.flatMap((id) => {
      const facts = videos.get(id);
      return facts === undefined ? [] : [facts];
    });
  },
  /** Every known video, as one playlist of one page. */
  async *playlistPages(_playlistId: string) {
    yield [...videos.keys()];
  },
};

function video(videoId: string, overrides: Partial<VideoFactsShape> = {}) {
  videos.set(videoId, {
    videoId,
    title: `Song ${videoId}`,
    channelTitle: "Artist - Topic",
    isoDuration: "PT3M",
    thumbnailUrl: null,
    privacyStatus: "public",
    uploadStatus: "processed",
    embeddable: true,
    liveBroadcastContent: "none",
    ageRestricted: false,
    regionRestriction: null,
    ...overrides,
  });
}

let source: CatalogTrackSource;
let clock: FakeClock;

beforeEach(() => {
  videos.clear();
  failing = null;
  clock = new FakeClock(NOW);
  const db = openDatabase(":memory:");
  migrate(db);
  const repository = new SqliteTrackRepository(db);
  const resolver = new YouTubeTrackResolver(fakeYouTube, repository, clock, {
    regionCode: "EE",
    maxPlaylistItems: 200,
    cacheTtlMs: 30 * 86_400_000,
  });
  source = new CatalogTrackSource({
    resolveTrackUrl: new ResolveTrackUrl([resolver]),
    findTracks: new FindTracks(repository),
    maintainTrackCache: new MaintainTrackCache([resolver], repository, clock),
  });
});

describe("CatalogTrackSource", () => {
  test("turns a link into the room's view of its songs", async () => {
    video("dQw4w9WgXcQ");

    const resolved = await source.resolve("https://youtu.be/dQw4w9WgXcQ", "song", PLENTY);

    expect(resolved).toEqual({
      tracks: [
        {
          trackId: "youtube:dQw4w9WgXcQ",
          provider: "youtube",
          providerTrackId: "dQw4w9WgXcQ",
          title: "Song dQw4w9WgXcQ",
          artist: "Artist",
          durationMs: 180_000,
          artworkUrl: null,
        },
      ],
      skipped: [],
      truncated: false,
    });
  });

  describe("a link to a song inside a playlist", () => {
    const inList = "https://www.youtube.com/watch?v=BBBBBBBBBBB&list=PLmine&index=2";

    beforeEach(() => {
      for (const id of ["AAAAAAAAAAA", "BBBBBBBBBBB", "CCCCCCCCCCC"]) video(id);
    });

    test("is no more of the playlist than the room has a place for, and says the rest was left", async () => {
      const resolved = await source.resolve(inList, "playlist", 1);

      expect(resolved.tracks.map((one) => one.providerTrackId)).toEqual(["BBBBBBBBBBB"]);
      expect(resolved.truncated).toBe(true);
    });

    test("is just that song when the person chose the song", async () => {
      const resolved = await source.resolve(inList, "song", PLENTY);

      expect(resolved.tracks.map((one) => one.providerTrackId)).toEqual(["BBBBBBBBBBB"]);
    });

    test("is the playlist from that song on when the person chose the playlist", async () => {
      const resolved = await source.resolve(inList, "playlist", PLENTY);

      expect(resolved.tracks.map((one) => one.providerTrackId)).toEqual([
        "BBBBBBBBBBB",
        "CCCCCCCCCCC",
      ]);
    });

    test("is rejected as song_not_in_playlist once the playlist dropped the song", async () => {
      videos.delete("BBBBBBBBBBB");

      const failure = await source
        .resolve(inList, "playlist", PLENTY)
        .catch((error: unknown) => error);

      expect(failure).toBeInstanceOf(LinkRejected);
      expect((failure as LinkRejected).code).toBe("song_not_in_playlist");
    });
  });

  test("passes skipped songs on with their reasons", async () => {
    video("dQw4w9WgXcQ", { embeddable: false, title: "Blocked" });

    const resolved = await source.resolve("https://youtu.be/dQw4w9WgXcQ", "song", PLENTY);

    expect(resolved.skipped).toEqual([{ title: "Blocked", reason: "not_embeddable" }]);
  });

  test.each([
    ["hello", "invalid_url"],
    ["https://open.spotify.com/track/abc", "unsupported_url"],
  ] as const)("rejects %p as %s", async (pasted, code) => {
    const failure = await source.resolve(pasted, "song", PLENTY).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(LinkRejected);
    expect((failure as LinkRejected).code).toBe(code);
  });

  test("reports a YouTube outage as unavailable, keeping the cause in the log", async () => {
    failing = new YouTubeOutage();
    const logged: unknown[] = [];
    const original = console.error;
    console.error = (...args: unknown[]) => logged.push(args);

    try {
      const failure = await source
        .resolve("https://youtu.be/dQw4w9WgXcQ", "song", PLENTY)
        .catch((error: unknown) => error);
      expect(failure).toBeInstanceOf(LinkRejected);
      expect((failure as LinkRejected).code).toBe("provider_unavailable");
    } finally {
      console.error = original;
    }
    expect(logged).toHaveLength(1);
  });

  test("lets an error that is not the catalog's through untouched", async () => {
    failing = new TypeError("a bug, not an outage");

    await expect(source.resolve("https://youtu.be/dQw4w9WgXcQ", "song", PLENTY)).rejects.toThrow(
      TypeError,
    );
  });

  test("describes cached songs by id", async () => {
    video("dQw4w9WgXcQ");
    await source.resolve("https://youtu.be/dQw4w9WgXcQ", "song", PLENTY);

    expect(
      (await source.describe(["youtube:dQw4w9WgXcQ", "youtube:missing0000"])).map((t) => t.title),
    ).toEqual(["Song dQw4w9WgXcQ"]);
  });

  test("reports queued songs that stopped being playable", async () => {
    video("dQw4w9WgXcQ");
    await source.resolve("https://youtu.be/dQw4w9WgXcQ", "song", PLENTY);
    videos.clear();
    clock.set(NOW + 26 * 86_400_000);

    expect(await source.maintain(["youtube:dQw4w9WgXcQ"])).toEqual(["youtube:dQw4w9WgXcQ"]);
  });
});
