import { beforeEach, describe, expect, test } from "bun:test";
import type { Database } from "bun:sqlite";
import { openDatabase } from "@/shared/infrastructure/database.ts";
import { migrate } from "@/shared/infrastructure/migrator.ts";

let db: Database;

beforeEach(() => {
  db = openDatabase(":memory:");
  migrate(db);
});

function insertUser(id: string, discordId: string): void {
  db.query(
    "INSERT INTO users (id, discord_id, username, created_at, last_login_at) VALUES (?, ?, 'ada', 0, 0)",
  ).run(id, discordId);
}

describe("identity schema", () => {
  test("refuses two users for one Discord account", () => {
    insertUser("user-1", "80351110224678912");

    expect(() => insertUser("user-2", "80351110224678912")).toThrow();
  });

  test("takes a user's sessions with them when the user is deleted", () => {
    insertUser("user-1", "80351110224678912");
    db.query(
      "INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES ('h', 'user-1', 0, 1)",
    ).run();

    db.query("DELETE FROM users WHERE id = 'user-1'").run();

    expect(db.query("SELECT COUNT(*) AS n FROM sessions").get()).toEqual({ n: 0 });
  });

  test("refuses a session for a user who does not exist", () => {
    expect(() =>
      db
        .query(
          "INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES ('h', 'ghost', 0, 1)",
        )
        .run(),
    ).toThrow();
  });

  test("refuses a value of the wrong type, because the tables are STRICT", () => {
    expect(() =>
      db
        .query(
          "INSERT INTO users (id, discord_id, username, created_at, last_login_at) VALUES ('u', 'd', 'ada', 'yesterday', 0)",
        )
        .run(),
    ).toThrow();
  });
});
