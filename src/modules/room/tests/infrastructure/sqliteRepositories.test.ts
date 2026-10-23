import { describe, expect, test } from "bun:test";
import { openDatabase } from "@/shared/infrastructure/database.ts";
import { migrate } from "@/shared/infrastructure/migrator.ts";
import { SqliteActivityRepository } from "@/modules/room/infrastructure/persistence/SqliteActivityRepository.ts";
import { SqliteRoomRepository } from "@/modules/room/infrastructure/persistence/SqliteRoomRepository.ts";
import { runRoomRepositoryContracts } from "@/modules/room/tests/support/repositoryContracts.ts";

runRoomRepositoryContracts("SQLite", () => {
  const db = openDatabase(":memory:");
  migrate(db);
  return { rooms: new SqliteRoomRepository(db), activity: new SqliteActivityRepository(db) };
});

describe("SqliteRoomRepository", () => {
  test("refuses to start from a saved room that is not a room", async () => {
    const db = openDatabase(":memory:");
    migrate(db);
    db.query(
      "INSERT INTO room_state (id, state, saved_at, clean_shutdown) VALUES (1, ?, 0, 0)",
    ).run(JSON.stringify({ version: 1, entries: [] }));

    await expect(new SqliteRoomRepository(db).load()).rejects.toThrow("expected shape");
  });

  /** Saved while songs took turns between people: one list per person and a line of turns. */
  test("lines up a room saved under the old turn-taking by when each song was added", async () => {
    const db = openDatabase(":memory:");
    migrate(db);
    const entry = (id: string, ownerId: string, addedAt: number) => ({
      id,
      ownerId,
      trackId: `youtube:${id}`,
      durationMs: 200_000,
      addedAt,
    });
    const saved = {
      version: 7,
      entries: {
        playing: entry("playing", "cy", 1),
        a1: entry("a1", "ada", 10),
        a2: entry("a2", "ada", 10),
        a3: entry("a3", "ada", 40),
        b1: entry("b1", "bob", 20),
      },
      lanes: { ada: ["a1", "a2", "a3"], bob: ["b1"] },
      keys: { bob: 3, ada: 4 },
      counter: 4,
      current: { entryId: "playing", status: "playing" as const, positionMs: 0, anchorAt: 1 },
      repeat: "all" as const,
    };
    db.query(
      "INSERT INTO room_state (id, state, saved_at, clean_shutdown) VALUES (1, ?, 0, 1)",
    ).run(JSON.stringify(saved));

    const loaded = await new SqliteRoomRepository(db).load();

    expect(loaded?.state).toEqual({
      version: 7,
      entries: saved.entries,
      queue: ["a1", "a2", "b1", "a3"],
      current: saved.current,
      repeat: "all",
      shuffle: false,
      starred: [],
      played: [],
    });
  });

  /** Saved before shuffle became a switch: no `shuffle` at all, and it was off. */
  test("loads a room saved before shuffle was a switch with shuffle off", async () => {
    const db = openDatabase(":memory:");
    migrate(db);
    const saved = { version: 3, entries: {}, queue: [], current: null, repeat: "off" as const };
    db.query(
      "INSERT INTO room_state (id, state, saved_at, clean_shutdown) VALUES (1, ?, 0, 1)",
    ).run(JSON.stringify(saved));

    const loaded = await new SqliteRoomRepository(db).load();

    expect(loaded?.state).toEqual({ ...saved, shuffle: false, starred: [], played: [] });
  });

  /** Saved before songs could be starred: no `starred` at all, and none were. */
  test("loads a room saved before songs could be starred with none starred", async () => {
    const db = openDatabase(":memory:");
    migrate(db);
    const saved = {
      version: 5,
      entries: {
        a1: { id: "a1", ownerId: "ada", trackId: "youtube:a1", durationMs: 1, addedAt: 10 },
      },
      queue: ["a1"],
      current: null,
      repeat: "off" as const,
      shuffle: true,
    };
    db.query(
      "INSERT INTO room_state (id, state, saved_at, clean_shutdown) VALUES (1, ?, 0, 1)",
    ).run(JSON.stringify(saved));

    const loaded = await new SqliteRoomRepository(db).load();

    expect(loaded?.state).toEqual({ ...saved, starred: [], played: [] });
  });

  /** Saved before the room remembered what it played: no `played`, and nothing is remembered. */
  test("loads a room saved before Recently played as having played nothing", async () => {
    const db = openDatabase(":memory:");
    migrate(db);
    const saved = {
      version: 9,
      entries: {},
      queue: [],
      current: null,
      repeat: "off" as const,
      shuffle: false,
      starred: [],
    };
    db.query(
      "INSERT INTO room_state (id, state, saved_at, clean_shutdown) VALUES (1, ?, 0, 1)",
    ).run(JSON.stringify(saved));

    const loaded = await new SqliteRoomRepository(db).load();

    expect(loaded?.state).toEqual({ ...saved, played: [] });
  });

  test("refuses a saved room whose played songs are not songs", async () => {
    const db = openDatabase(":memory:");
    migrate(db);
    const insert = db.query(
      "INSERT OR REPLACE INTO room_state (id, state, saved_at, clean_shutdown) VALUES (1, ?, 0, 1)",
    );
    const room = {
      version: 3,
      entries: {},
      queue: [],
      current: null,
      repeat: "off",
      shuffle: false,
      starred: [],
    };

    for (const played of [
      "youtube:a1",
      [{ trackId: "youtube:a1", ownerId: "ada" }],
      [{ trackId: 1, ownerId: "ada", at: 1 }],
      null,
    ]) {
      insert.run(JSON.stringify({ ...room, played }));
      await expect(new SqliteRoomRepository(db).load()).rejects.toThrow("expected shape");
    }
  });

  test("refuses a saved room whose starred songs are not a list of entry ids", async () => {
    const db = openDatabase(":memory:");
    migrate(db);
    const insert = db.query(
      "INSERT OR REPLACE INTO room_state (id, state, saved_at, clean_shutdown) VALUES (1, ?, 0, 1)",
    );
    const room = {
      version: 3,
      entries: {},
      queue: [],
      current: null,
      repeat: "off",
      shuffle: true,
    };

    for (const starred of ["a1", [1, 2], null]) {
      insert.run(JSON.stringify({ ...room, starred }));
      await expect(new SqliteRoomRepository(db).load()).rejects.toThrow("expected shape");
    }
  });

  test("refuses a saved room whose shuffle is not on or off", async () => {
    const db = openDatabase(":memory:");
    migrate(db);
    db.query(
      "INSERT INTO room_state (id, state, saved_at, clean_shutdown) VALUES (1, ?, 0, 1)",
    ).run(
      JSON.stringify({
        version: 3,
        entries: {},
        queue: [],
        current: null,
        repeat: "off",
        shuffle: "yes",
      }),
    );

    await expect(new SqliteRoomRepository(db).load()).rejects.toThrow("expected shape");
  });

  test("the schema allows exactly one room", () => {
    const db = openDatabase(":memory:");
    migrate(db);

    expect(() =>
      db
        .query(
          "INSERT INTO room_state (id, state, saved_at, clean_shutdown) VALUES (2, '{}', 0, 0)",
        )
        .run(),
    ).toThrow();
  });
});
