import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { clearRoom } from "./support/clearRoom.ts";
import { BASE_URL, PEOPLE, REPO_ROOT, SONGS } from "./support/e2eRoom.ts";

/** Listeners further apart than this are not hearing the same moment. */
const SAME_MOMENT_MS = 1000;
/** An ad or a slow first load can hold a player back this long before it plays the room's song. */
const SETTLE_MS = 90_000;

interface Playback {
  at: number;
  positionMs: number;
  paused: boolean;
}

/** What this browser's YouTube player is actually doing — read from its video element, not from our page. */
async function playback(page: Page): Promise<Playback | null> {
  const frame = page.frames().find((one) => one.url().startsWith("https://www.youtube.com/embed"));
  if (frame === undefined) return null;
  return frame.evaluate(() => {
    const video = document.querySelector("video");
    return video === null
      ? null
      : { at: Date.now(), positionMs: video.currentTime * 1000, paused: video.paused };
  });
}

/** Every player read at once, carried to the same instant, and how far apart the furthest two are. */
async function readAll(
  pages: Page[],
): Promise<{ positionsMs: number[]; spreadMs: number; paused: boolean[] }> {
  const readings = await Promise.all(pages.map(playback));
  if (readings.some((reading) => reading === null))
    throw new Error("a player is not on the page yet");
  const all = readings as Playback[];
  const instant = Math.max(...all.map((reading) => reading.at));
  const positionsMs = all.map((reading) =>
    Math.round(reading.paused ? reading.positionMs : reading.positionMs + (instant - reading.at)),
  );
  return {
    positionsMs,
    spreadMs: Math.max(...positionsMs) - Math.min(...positionsMs),
    paused: all.map((reading) => reading.paused),
  };
}

async function openRoom(browser: Browser, sessionToken: string): Promise<Page> {
  const context = await browser.newContext();
  await context.addCookies([
    { name: "mp_session", value: sessionToken, url: BASE_URL, httpOnly: true, sameSite: "Lax" },
  ]);
  const page = await context.newPage();
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Start listening" })).toBeVisible();
  return page;
}

async function add(page: Page, videoId: string): Promise<void> {
  await page.getByLabel("YouTube video or playlist link").fill(`https://youtu.be/${videoId}`);
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await expect(page.locator(".add__result")).toHaveText("Added 1 song to your list.");
}

/** Polls until `settled` holds, and says how long that took — or that it never did. */
async function timeUntil(
  settled: () => Promise<boolean>,
  timeoutMs: number,
): Promise<{ settledInMs: number | null }> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await settled().catch(() => false)) return { settledInMs: Date.now() - start };
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return { settledInMs: null };
}

/** Samples how far apart everyone is, once a second, and what each page says about its sync. */
async function steady(pages: Page[], seconds: number) {
  const spreads: number[] = [];
  const notInSync: string[] = [];
  for (let second = 0; second < seconds; second += 1) {
    spreads.push((await readAll(pages)).spreadMs);
    const lines = await Promise.all(pages.map((page) => page.locator("p.sync").innerText()));
    lines.forEach((line, index) => {
      if (line !== "In sync") notInSync.push(`${PEOPLE[index]?.name} at ${second}s: ${line}`);
    });
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  const sorted = [...spreads].sort((a, b) => a - b);
  return {
    samples: spreads.length,
    medianSpreadMs: sorted[Math.floor(sorted.length / 2)],
    maxSpreadMs: sorted.at(-1),
    notInSync,
  };
}

test("five listeners hear the same moment, through steady play, pause, resume, a jump and a skip", async ({
  browser,
}) => {
  test.setTimeout(420_000);
  const tokens = JSON.parse(
    execFileSync("bun", ["e2e/support/seed.ts"], { cwd: REPO_ROOT, encoding: "utf8" }),
  ) as Record<string, string>;
  const [first, second] = SONGS;
  const pages = await Promise.all(
    PEOPLE.map((person) => openRoom(browser, tokens[person.id] as string)),
  );
  const [ada, bob, cy, dee, eve] = pages as [Page, Page, Page, Page, Page];
  const measured: Record<string, unknown> = {};
  const allInSync = async () =>
    (await Promise.all(pages.map((page) => page.locator("p.sync").innerText()))).every(
      (line) => line === "In sync",
    );

  await clearRoom(ada);
  await add(ada, first.videoId);
  await add(bob, second.videoId);
  await Promise.all(
    pages.map((page) => page.getByRole("button", { name: "Start listening" }).click()),
  );
  measured["start: all five in sync"] = await timeUntil(allInSync, SETTLE_MS);
  for (const page of pages) await expect(page.locator(".now__title")).toHaveText(first.title);

  measured["steady play, 30 s"] = await steady(pages, 30);

  await cy.getByRole("button", { name: "Pause", exact: true }).click();
  measured["pause by Cy: all stopped"] = await timeUntil(
    async () => (await readAll(pages)).paused.every(Boolean),
    15_000,
  );
  measured["pause by Cy: positions apart"] = (await readAll(pages)).spreadMs;

  await dee.getByRole("button", { name: "Resume" }).click();
  measured["resume by Dee: all playing together"] = await timeUntil(async () => {
    const now = await readAll(pages);
    return now.paused.every((paused) => !paused) && now.spreadMs < SAME_MOMENT_MS;
  }, 30_000);

  const jumpedAt = Date.now();
  await eve.getByRole("slider", { name: /Position in the song/ }).fill("120");
  // When each page's own clock shows the jump, and when each player's video gets there.
  const shownAfterMs: (number | null)[] = pages.map(() => null);
  const playedAfterMs: (number | null)[] = pages.map(() => null);
  const movedAfterMs: (number | null)[] = pages.map(() => null);
  const jumpTimeline = timeUntil(async () => {
    const [times, now] = await Promise.all([
      Promise.all(pages.map((page) => page.locator(".seek__time").first().innerText())),
      readAll(pages),
    ]);
    times.forEach((time, index) => {
      if (shownAfterMs[index] === null && /^2:0\d$/.test(time))
        shownAfterMs[index] = Date.now() - jumpedAt;
    });
    now.positionsMs.forEach((ms, index) => {
      if (movedAfterMs[index] === null && ms > 119_000) movedAfterMs[index] = Date.now() - jumpedAt;
      if (playedAfterMs[index] === null && ms > 119_000 && !now.paused[index])
        playedAfterMs[index] = Date.now() - jumpedAt;
    });
    return now.spreadMs < SAME_MOMENT_MS && now.positionsMs.every((ms) => ms > 119_000);
  }, 30_000);
  measured["jump by Eve to 2:00: all landed together"] = await jumpTimeline;
  measured["jump by Eve: each page's clock showed it after (ms)"] = shownAfterMs;
  measured["jump by Eve: each player's video moved past 1:59 after (ms)"] = movedAfterMs;
  measured["jump by Eve: each player playing past 1:59 after (ms)"] = playedAfterMs;
  measured["jump by Eve: positions after"] = (await readAll(pages)).positionsMs;

  measured["steady after the jump, 15 s"] = await steady(pages, 15);

  await bob.getByRole("button", { name: "Skip" }).click();
  measured["skip by Bob: all on the next song together"] = await timeUntil(async () => {
    const titles = await Promise.all(pages.map((page) => page.locator(".now__title").innerText()));
    const now = await readAll(pages);
    return titles.every((title) => title === second.title) && now.spreadMs < SAME_MOMENT_MS;
  }, SETTLE_MS);
  measured["skip: all in sync"] = await timeUntil(allInSync, SETTLE_MS);

  measured["steady after the skip, 15 s"] = await steady(pages, 15);

  writeFileSync(test.info().outputPath("measured.json"), JSON.stringify(measured, null, 2));

  for (const [label, value] of Object.entries(measured)) {
    if (typeof value === "object" && value !== null && "settledInMs" in value) {
      expect(value.settledInMs, `${label} never settled`).not.toBeNull();
    }
    if (typeof value === "object" && value !== null && "maxSpreadMs" in value) {
      expect(value.maxSpreadMs as number, `${label}: furthest two apart`).toBeLessThan(
        SAME_MOMENT_MS,
      );
    }
  }
});
