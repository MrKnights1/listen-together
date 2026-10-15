import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { Database } from "bun:sqlite";
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { openDatabase } from "@/shared/infrastructure/database.ts";
import { migrate } from "@/shared/infrastructure/migrator.ts";

/**
 * The runner is generic machinery: it knows how to apply and record SQL files
 * and nothing about any feature's schema. These tests use throwaway fixtures
 * rather than the project's real migrations, so a schema change can never break
 * the runner's own suite.
 */
let db: Database;
const directories: string[] = [];

function directoryWith(files: Record<string, string>): string {
  const directory = mkdtempSync(join(tmpdir(), "musicplayer-migrations-"));
  for (const [name, sql] of Object.entries(files)) writeFileSync(join(directory, name), sql);
  directories.push(directory);
  return directory;
}

function tableNames(): string[] {
  return db
    .query<{ name: string }, []>(
      "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
    )
    .all()
    .map((row) => row.name);
}

function appliedVersions(): string[] {
  return db
    .query<{ version: string }, []>("SELECT version FROM schema_migrations ORDER BY version")
    .all()
    .map((row) => row.version);
}

beforeEach(() => {
  db = openDatabase(":memory:");
});

afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

describe("migrate", () => {
  test("applies a pending migration and reports it", () => {
    const directory = directoryWith({
      "20260101000000_one.sql": "CREATE TABLE one (id TEXT) STRICT;",
    });

    expect(migrate(db, directory)).toEqual(["20260101000000_one.sql"]);
    expect(tableNames()).toContain("one");
  });

  test("does nothing the second time it runs", () => {
    const directory = directoryWith({
      "20260101000000_one.sql": "CREATE TABLE one (id TEXT) STRICT;",
    });
    migrate(db, directory);

    expect(migrate(db, directory)).toEqual([]);
  });

  test("applies migrations in filename order, not directory order", () => {
    // Why filenames carry timestamps: this order is the schema's history.
    const directory = directoryWith({
      "20260103000000_third.sql": "CREATE TABLE third (id TEXT) STRICT;",
      "20260101000000_first.sql": "CREATE TABLE first (id TEXT) STRICT;",
      "20260102000000_second.sql": "CREATE TABLE second (id TEXT) STRICT;",
    });

    expect(migrate(db, directory)).toEqual([
      "20260101000000_first.sql",
      "20260102000000_second.sql",
      "20260103000000_third.sql",
    ]);
  });

  test("records each applied migration so it is never replayed", () => {
    const directory = directoryWith({
      "20260101000000_one.sql": "CREATE TABLE one (id TEXT) STRICT;",
      "20260102000000_two.sql": "CREATE TABLE two (id TEXT) STRICT;",
    });

    migrate(db, directory);

    expect(appliedVersions()).toEqual(["20260101000000_one.sql", "20260102000000_two.sql"]);
  });

  test("applies only what is new when a migration is added later", () => {
    const directory = directoryWith({
      "20260101000000_one.sql": "CREATE TABLE one (id TEXT) STRICT;",
    });
    migrate(db, directory);
    writeFileSync(join(directory, "20260102000000_two.sql"), "CREATE TABLE two (id TEXT) STRICT;");

    expect(migrate(db, directory)).toEqual(["20260102000000_two.sql"]);
  });

  test("ignores files that are not migrations", () => {
    const directory = directoryWith({
      "20260101000000_one.sql": "CREATE TABLE one (id TEXT) STRICT;",
      "README.md": "not a migration",
    });

    expect(migrate(db, directory)).toEqual(["20260101000000_one.sql"]);
  });

  test("rolls a failing migration back whole", () => {
    const directory = directoryWith({
      "20260101000000_broken.sql": "CREATE TABLE good (id TEXT) STRICT; THIS IS NOT SQL;",
    });

    expect(() => migrate(db, directory)).toThrow();
    expect(tableNames()).not.toContain("good");
  });

  test("does not record a migration that failed", () => {
    const directory = directoryWith({
      "20260101000000_broken.sql": "CREATE TABLE good (id TEXT) STRICT; THIS IS NOT SQL;",
    });

    try {
      migrate(db, directory);
    } catch {
      // asserted above; here we only care what was written down
    }

    expect(appliedVersions()).toEqual([]);
  });
});

describe("the default migrations directory", () => {
  /**
   * The default is a path relative to this file. Nothing else would notice it
   * breaking until a real boot, so it is checked here.
   */
  const DEFAULT = resolve(import.meta.dir, "../../../migrations");

  test("exists at the project root", () => {
    expect(existsSync(DEFAULT)).toBe(true);
  });

  test("every file in it is timestamp-named", () => {
    const files = readdirSync(DEFAULT).filter((entry) => entry.endsWith(".sql"));

    expect(files.filter((file) => !/^\d{14}_[a-z0-9_]+\.sql$/.test(file))).toEqual([]);
  });

  test("is what migrate uses when given no directory", () => {
    expect(migrate(db)).toEqual(
      readdirSync(DEFAULT)
        .filter((entry) => entry.endsWith(".sql"))
        .sort(),
    );
  });
});
