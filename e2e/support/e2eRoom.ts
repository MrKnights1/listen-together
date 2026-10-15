/**
 * What the end-to-end run shares between its config, its seeder and its
 * tests: one throwaway database, five people, and the songs they add — cached
 * in advance, so adding them costs no YouTube quota.
 */
import path from "node:path";

export const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..");
export const PORT = 3318;
export const BASE_URL = `http://localhost:${PORT}`;
export const DATABASE_DIR = "data/e2e";
export const DATABASE_PATH = `${DATABASE_DIR}/musicplayer.db`;

export const PEOPLE = [
  { id: "e2e-ada", discordId: "80351110224678912", name: "Ada" },
  { id: "e2e-bob", discordId: "80351110224678913", name: "Bob" },
  { id: "e2e-cy", discordId: "80351110224678914", name: "Cy" },
  { id: "e2e-dee", discordId: "80351110224678915", name: "Dee" },
  { id: "e2e-eve", discordId: "80351110224678916", name: "Eve" },
] as const;

/** Real, embeddable videos. Durations are what the room schedules by; only the start of each is played. */
export const SONGS = [
  {
    videoId: "M7lc1UVf-VE",
    title: "YouTube Developers Live: Embedded Web Player Customization",
    artist: "Google for Developers",
    durationMs: 1_200_000,
  },
  {
    videoId: "dQw4w9WgXcQ",
    title: "Rick Astley - Never Gonna Give You Up",
    artist: "Rick Astley",
    durationMs: 213_000,
  },
] as const;

/** Every variable the server requires. Discord and YouTube are never called: sessions and songs are seeded. */
export const SERVER_ENV = {
  PORT: String(PORT),
  HOST: "127.0.0.1",
  APP_URL: BASE_URL,
  APP_ENV: "development",
  DATABASE_PATH,
  DISCORD_CLIENT_ID: "000000000000000000",
  DISCORD_CLIENT_SECRET: "unused-in-e2e",
  DISCORD_REDIRECT_URI: `${BASE_URL}/api/auth/discord/callback`,
  DISCORD_ALLOWED_USER_IDS: PEOPLE.map((person) => person.discordId).join(","),
  YOUTUBE_API_KEY: "unused-in-e2e",
  YOUTUBE_REGION_CODE: "EE",
};
