import { execFileSync } from "node:child_process";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { BASE_URL, PEOPLE, REPO_ROOT, SONGS } from "./support/e2eRoom.ts";

/** Two listeners further apart than this are not hearing the same moment. */
const SAME_MOMENT_MS = 1000;
/** An ad or a slow first load can hold a player back this long before it plays the room's song. */
const SETTLE_MS = 60_000;

interface Playback {
  /** Wall-clock time of the reading. Both browsers run on this machine, so their clocks agree. */
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

/** Both players read at once, then carried to the same instant so they can be compared. */
async function readBoth(a: Page, b: Page): Promise<{ a: Playback; b: Playback; apartMs: number }> {
  const [first, second] = await Promise.all([playback(a), playback(b)]);
  if (first === null || second === null) throw new Error("a player is not on the page yet");
  const instant = Math.max(first.at, second.at);
  const carried = (reading: Playback) =>
    reading.paused ? reading.positionMs : reading.positionMs + (instant - reading.at);
  return { a: first, b: second, apartMs: Math.abs(carried(first) - carried(second)) };
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

async function inSync(page: Page): Promise<void> {
  await expect(page.locator("p.sync")).toHaveText("In sync", { timeout: SETTLE_MS });
}

test("two listeners hear the same moment, and each one's controls reach the other", async ({
  browser,
}) => {
  const tokens = JSON.parse(
    execFileSync("bun", ["e2e/support/seed.ts"], { cwd: REPO_ROOT, encoding: "utf8" }),
  ) as Record<string, string>;
  const [first, second] = SONGS;
  const ada = await openRoom(browser, tokens[PEOPLE[0].id] as string);
  const bob = await openRoom(browser, tokens[PEOPLE[1].id] as string);

  await test.step("both hear the same moment of the same song", async () => {
    await add(ada, first.videoId);
    await add(ada, second.videoId);
    await ada.getByRole("button", { name: "Start listening" }).click();
    await bob.getByRole("button", { name: "Start listening" }).click();
    await Promise.all([inSync(ada), inSync(bob)]);

    for (const page of [ada, bob]) {
      await expect(page.locator(".now__title")).toHaveText(first.title);
    }
    await expect.poll(async () => (await readBoth(ada, bob)).apartMs).toBeLessThan(SAME_MOMENT_MS);
  });

  await test.step("one pauses, and the other stops at the same place", async () => {
    await ada.getByRole("button", { name: "Pause", exact: true }).click();

    await expect.poll(async () => (await playback(bob))?.paused).toBe(true);
    const { a, b } = await readBoth(ada, bob);
    expect(a.paused).toBe(true);
    expect(Math.abs(a.positionMs - b.positionMs)).toBeLessThan(500);
  });

  await test.step("the other resumes, and both play on together", async () => {
    await bob.getByRole("button", { name: "Resume" }).click();

    await expect.poll(async () => (await playback(ada))?.paused).toBe(false);
    await expect.poll(async () => (await readBoth(ada, bob)).apartMs).toBeLessThan(SAME_MOMENT_MS);
  });

  await test.step("one jumps ahead, and both land there", async () => {
    await bob.getByRole("slider", { name: /Position in the song/ }).fill("120");

    await expect
      .poll(async () => {
        const { a, b, apartMs } = await readBoth(ada, bob);
        return apartMs < SAME_MOMENT_MS && a.positionMs > 119_000 && b.positionMs > 119_000;
      })
      .toBe(true);
    expect((await readBoth(ada, bob)).a.positionMs).toBeLessThan(130_000);
  });

  await test.step("one skips, and both move to the next song together", async () => {
    await ada.getByRole("button", { name: "Skip" }).click();

    for (const page of [ada, bob]) {
      await expect(page.locator(".now__title")).toHaveText(second.title);
    }
    await Promise.all([inSync(ada), inSync(bob)]);
    await expect
      .poll(async () => {
        const { a, apartMs } = await readBoth(ada, bob);
        return apartMs < SAME_MOMENT_MS && a.positionMs < 60_000;
      })
      .toBe(true);
  });
});
