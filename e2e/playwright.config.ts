import { defineConfig } from "@playwright/test";
import { BASE_URL, DATABASE_DIR, REPO_ROOT, SERVER_ENV } from "./support/e2eRoom.ts";

/**
 * Real Chrome against a real server and real YouTube: Chromium as Playwright
 * ships it lacks the codecs some videos need. One worker, because both
 * listeners share the one room.
 */
export default defineConfig({
  testDir: ".",
  testMatch: "*.e2e.ts",
  timeout: 240_000,
  workers: 1,
  reporter: "list",
  use: { channel: "chrome", baseURL: BASE_URL },
  webServer: {
    // A fresh database every run. --no-env-file: only the variables below, never the developer's .env.
    command: `rm -rf ${DATABASE_DIR} && mkdir -p ${DATABASE_DIR} && bun --no-env-file musicplayer.ts`,
    cwd: REPO_ROOT,
    url: `${BASE_URL}/api/health`,
    reuseExistingServer: false,
    env: SERVER_ENV,
  },
});
