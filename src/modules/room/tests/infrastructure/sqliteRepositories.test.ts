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
