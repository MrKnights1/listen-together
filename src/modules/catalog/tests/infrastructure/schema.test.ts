import { beforeEach, describe, expect, test } from "bun:test";
import type { Database } from "bun:sqlite";
import { openDatabase } from "@/shared/infrastructure/database.ts";
import { migrate } from "@/shared/infrastructure/migrator.ts";

let db: Database;

beforeEach(() => {
  db = openDatabase(":memory:");
  migrate(db);
});

function insert(id: string, providerTrackId: string, durationMs: number): void {
  db.query(
    "INSERT INTO tracks (id, provider, provider_track_id, title, artist, duration_ms, fetched_at) VALUES (?, 'youtube', ?, 't', 'a', ?, 0)",
  ).run(id, providerTrackId, durationMs);
}

describe("catalog schema", () => {
  test("refuses two rows for one provider track", () => {
    insert("youtube:dQw4w9WgXcQ", "dQw4w9WgXcQ", 1000);

    expect(() => insert("youtube:other", "dQw4w9WgXcQ", 1000)).toThrow();
  });

  test("refuses a negative duration", () => {
    expect(() => insert("youtube:dQw4w9WgXcQ", "dQw4w9WgXcQ", -1)).toThrow();
  });

  test("indexes fetched_at, which the daily maintenance scans by", () => {
    const indexes = db
      .query("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'tracks'")
      .all() as { name: string }[];

    expect(indexes.map((index) => index.name)).toContain("tracks_fetched_at");
  });
});
