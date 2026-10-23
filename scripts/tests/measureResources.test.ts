import { describe, expect, test } from "bun:test";
import {
  FindTracks,
  MaintainTrackCache,
  ResolveTrackUrl,
  SqliteTrackRepository,
  YouTubeTrackResolver,
} from "@/modules/catalog/index.ts";
import {
  CatalogTrackSource,
  MAX_ROOM_ENTRIES,
  MaintainQueue,
  MathRandom,
  RestoreRoom,
  RoomEngine,
  SqliteActivityRepository,
  SqliteRoomRepository,
} from "@/modules/room/index.ts";
import type { Timers } from "@/shared/domain/Timers.ts";
import { openDatabase } from "@/shared/infrastructure/database.ts";
import { migrate } from "@/shared/infrastructure/migrator.ts";
import { SystemClock } from "@/shared/infrastructure/SystemClock.ts";
import {
  commandFor,
  cpuTicks,
  FULL_ROOM_IDS,
  PLACEHOLDER_YOUTUBE_KEY,
  rssByMinute,
  rssBytes,
  scenariosFor,
  seedFullRoom,
  seedPeople,
  seedSongs,
  serverProcess,
  SONG_IDS,
  summarize,
  TARGETS,
  verdicts,
  type Sample,
} from "../measureResources.ts";

const MB = 1024 * 1024;

function samples(count: number, rssMb: (index: number) => number, cpuPercent: number): Sample[] {
  return Array.from({ length: count }, (_, index) => ({
    at: index,
    rssBytes: rssMb(index) * MB,
    cpuPercent,
  }));
}

describe("cpuTicks", () => {
  test("adds user and system time", () => {
    const line = "4242 (bun) S 1 4242 4242 0 -1 4194560 9000 0 0 0 157 23 0 0 20 0 9 0 12345";

    expect(cpuTicks(line)).toBe(180);
  });

  /** A process may call itself anything, spaces and brackets included. */
  test("is not thrown by a name holding spaces and a closing bracket", () => {
    const line = "77 (a) b c) R 1 77 77 0 -1 4194560 10 0 0 0 5 6 0 0 20 0 1 0 99";

    expect(cpuTicks(line)).toBe(11);
  });
});

describe("rssBytes", () => {
  test("reads the resident set from the status file", () => {
    expect(rssBytes("Name:\tbun\nVmPeak:\t  900 kB\nVmRSS:\t   51200 kB\nThreads:\t9\n")).toBe(
      51200 * 1024,
    );
  });

  test("refuses a status with no resident set: the process is gone", () => {
    expect(() => rssBytes("Name:\tbun\nState:\tZ (zombie)\n")).toThrow("has exited");
  });
});

describe("summarize and verdicts", () => {
  test("passes a quiet, steady process", () => {
    const summary = summarize(
      samples(60, () => 40, 0.1),
      samples(300, () => 45, 0.3),
    );

    expect(summary.idleRssMb).toBe(40);
    expect(summary.busyRssMb).toBe(45);
    expect(summary.growthMb).toBe(0);
    expect(verdicts(summary, TARGETS).every((verdict) => verdict.ok)).toBe(true);
  });

  test("fails a process that keeps growing, naming the target it missed", () => {
    const summary = summarize(
      samples(60, () => 40, 0.1),
      samples(300, (index) => 45 + index / 20, 0.3),
    );

    const missed = verdicts(summary, TARGETS).filter((verdict) => !verdict.ok);

    expect(missed.map((verdict) => verdict.name)).toEqual(["growthMb"]);
    expect(summary.growthMb).toBeCloseTo(13.5, 1);
  });

  test("fails a busy CPU", () => {
    const summary = summarize(
      samples(60, () => 40, 0.1),
      samples(300, () => 45, 2.5),
    );

    expect(
      verdicts(summary, TARGETS).find((verdict) => verdict.name === "busyCpuPercent")?.ok,
    ).toBe(false);
  });

  test("will not judge from a run cut short", () => {
    expect(() =>
      summarize(
        samples(60, () => 40, 0.1),
        samples(10, () => 45, 0.3),
      ),
    ).toThrow("Too few samples");
  });
});

describe("rssByMinute", () => {
  test("averages each whole minute and drops a partial one", () => {
    const run = samples(150, (index) => (index < 60 ? 40 : 46), 0);

    expect(rssByMinute(run)).toEqual([40, 46]);
  });
});

describe("measuring never spends YouTube quota", () => {
  const developer = {
    PATH: "/usr/bin",
    HOME: "/root",
    YOUTUBE_API_KEY: "AIzaSyD-a-real-looking-key-0123456789abc",
    DISCORD_CLIENT_SECRET: "a-real-looking-discord-secret",
    DATABASE_PATH: "/root/musicplayer/data/musicplayer.db",
  };

  test("the server reads no .env file", () => {
    const { cmd } = serverProcess("/tmp/measure.db", developer);

    expect(cmd).toContain("--no-env-file");
    expect(cmd.indexOf("--no-env-file")).toBeLessThan(cmd.indexOf("musicplayer.ts"));
  });

  test("the server's environment is built from constants: nothing of the developer's gets through but PATH", () => {
    const { env } = serverProcess("/tmp/measure.db", developer);

    expect(Object.keys(env).sort()).toEqual(
      [
        "APP_ENV",
        "APP_URL",
        "DATABASE_PATH",
        "DISCORD_ALLOWED_USER_IDS",
        "DISCORD_CLIENT_ID",
        "DISCORD_CLIENT_SECRET",
        "DISCORD_REDIRECT_URI",
        "HOST",
        "PATH",
        "PORT",
        "YOUTUBE_API_KEY",
        "YOUTUBE_REGION_CODE",
      ].sort(),
    );
    expect(env["YOUTUBE_API_KEY"]).toBe(PLACEHOLDER_YOUTUBE_KEY);
    expect(env["DATABASE_PATH"]).toBe("/tmp/measure.db");
    expect(env["PATH"]).toBe("/usr/bin");
    for (const secret of [developer.YOUTUBE_API_KEY, developer.DISCORD_CLIENT_SECRET]) {
      expect(Object.values(env)).not.toContain(secret);
    }
  });

  test("a listener never pastes a playlist, and only adds songs that are seeded", () => {
    const seeded = new Set(SONG_IDS.map((id) => `https://youtu.be/${id}`));
    const states = [
      null,
      { entryId: "e1", status: "playing" as const },
      { entryId: "e1", status: "paused" as const },
    ];
    for (let sent = 1; sent <= 1000; sent += 1) {
      for (const offset of [0, 1, 2]) {
        for (const current of states) {
          const op = commandFor(sent, offset, current);
          if (op.type !== "add") continue;
          expect(op.scope).toBe("song");
          expect(seeded.has(op.url)).toBe(true);
        }
      }
    }
  });

  test("booting into the full room, and every add a listener makes, ask YouTube nothing", async () => {
    const db = openDatabase(":memory:");
    migrate(db);
    const now = Date.now();
    seedPeople(db, now);
    seedSongs(db, SONG_IDS, now);
    await seedFullRoom(db, now);

    const calls: string[] = [];
    const youtube: ConstructorParameters<typeof YouTubeTrackResolver>[0] = {
      videos: async (ids) => {
        calls.push(`videos ${ids.length}`);
        return [];
      },
      playlistPages: (playlistId) => {
        calls.push(`playlist ${playlistId}`);
        return (async function* () {})();
      },
    };
    const clock = new SystemClock();
    const tracks = new SqliteTrackRepository(db);
    const resolver = new YouTubeTrackResolver(youtube, tracks, clock, {
      regionCode: "EE",
      maxPlaylistItems: MAX_ROOM_ENTRIES,
      cacheTtlMs: 30 * 24 * 60 * 60 * 1000,
    });
    const source = new CatalogTrackSource({
      resolveTrackUrl: new ResolveTrackUrl([resolver]),
      findTracks: new FindTracks(tracks),
      maintainTrackCache: new MaintainTrackCache([resolver], tracks, clock),
    });
    const noTimers: Timers = { every: () => () => undefined, after: () => () => undefined };
    const rooms = new SqliteRoomRepository(db);
    const activity = new SqliteActivityRepository(db);
    const engine = new RoomEngine({
      rooms,
      activity,
      clock,
      timers: noTimers,
      random: new MathRandom(),
    });

    await new RestoreRoom(rooms, source, engine, clock).execute();
    const maintained = await new MaintainQueue(engine, source, activity, clock).execute();
    for (const id of SONG_IDS) await source.resolve(`https://youtu.be/${id}`, "song");

    expect(calls).toEqual([]);
    expect(Object.keys(engine.snapshot().state.entries)).toHaveLength(FULL_ROOM_IDS.length);
    expect(maintained.removed).toBe(0);
    db.close();
  });
});

describe("scenariosFor", () => {
  test("runs both scenarios unless asked for one", () => {
    expect(scenariosFor(undefined).map((scenario) => scenario.name)).toEqual(["base", "full"]);
    expect(scenariosFor("full").map((scenario) => scenario.name)).toEqual(["full"]);
  });

  test("refuses a scenario it does not know", () => {
    expect(() => scenariosFor("huge")).toThrow("Unknown scenario");
  });
});
