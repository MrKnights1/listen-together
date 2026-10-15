import type { Database } from "bun:sqlite";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * One folder, applied in filename order. Outside `src/` because a migration is a
 * database artifact, not application code. The cost: table ownership across
 * modules is a rule the team keeps, not one the layout enforces.
 */
const MIGRATIONS_DIRECTORY = join(import.meta.dir, "../../../migrations");

/**
 * Applies every not-yet-applied migration, each in its own transaction.
 *
 * A filename *is* the version key, so it must never be renamed once it has run
 * anywhere you care about. Timestamp prefixes keep two branches from colliding.
 */
export function migrate(db: Database, directory: string = MIGRATIONS_DIRECTORY): string[] {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version    TEXT    PRIMARY KEY,
      applied_at INTEGER NOT NULL
    ) STRICT
  `);

  const applied = new Set(
    db
      .query<{ version: string }, []>("SELECT version FROM schema_migrations")
      .all()
      .map((row) => row.version),
  );

  const pending = readdirSync(directory)
    .filter((entry) => entry.endsWith(".sql"))
    .filter((entry) => !applied.has(entry))
    .sort();

  const record = db.query("INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)");

  for (const version of pending) {
    const sql = readFileSync(join(directory, version), "utf8");
    db.transaction(() => {
      db.exec(sql);
      record.run(version, Date.now());
    })();
  }

  return pending;
}
