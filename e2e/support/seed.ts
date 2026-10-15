/**
 * Run with Bun against the e2e server's database once it has migrated it:
 * writes both people with a live session each, and caches the songs. Prints
 * the session tokens as JSON — the only way into the room without Discord.
 *
 *   bun e2e/support/seed.ts
 */
import { Database } from "bun:sqlite";
import path from "node:path";
import { DATABASE_PATH, PEOPLE, REPO_ROOT, SONGS } from "./e2eRoom.ts";

const DAY_MS = 24 * 60 * 60 * 1000;

const db = new Database(path.join(REPO_ROOT, DATABASE_PATH));
const now = Date.now();
const tokens: Record<string, string> = {};

for (const person of PEOPLE) {
  db.query(
    `INSERT INTO users (id, discord_id, username, global_name, created_at, last_login_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (id) DO NOTHING`,
  ).run(person.id, person.discordId, person.name.toLowerCase(), person.name, now, now);

  const token = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url");
  const tokenHash = new Bun.CryptoHasher("sha256").update(token, "utf8").digest("hex");
  db.query(
    "INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)",
  ).run(tokenHash, person.id, now, now + DAY_MS);
  tokens[person.id] = token;
}

for (const song of SONGS) {
  db.query(
    `INSERT OR REPLACE INTO tracks (id, provider, provider_track_id, title, artist, duration_ms, fetched_at)
     VALUES (?, 'youtube', ?, ?, ?, ?, ?)`,
  ).run(`youtube:${song.videoId}`, song.videoId, song.title, song.artist, song.durationMs, now);
}

db.close();
process.stdout.write(JSON.stringify(tokens));
