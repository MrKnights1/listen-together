import { execFileSync } from "node:child_process";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { clearRoom } from "./support/clearRoom.ts";
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
  muted: boolean;
}

/** What this browser's YouTube player is actually doing — read from its video element, not from our page. */
async function playback(page: Page): Promise<Playback | null> {
  const frame = page.frames().find((one) => one.url().startsWith("https://www.youtube.com/embed"));
  if (frame === undefined) return null;
  return frame.evaluate(() => {
    const video = document.querySelector("video");
    return video === null
      ? null
      : {
          at: Date.now(),
          positionMs: video.currentTime * 1000,
          paused: video.paused,
          muted: video.muted,
        };
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

/** The address bar while a playlist plays: the form asks whether the song or the playlist was meant. */
async function addFromPlaylistLink(page: Page, videoId: string): Promise<void> {
  await page
    .getByLabel("YouTube video or playlist link")
    .fill(
      `https://www.youtube.com/watch?v=${videoId}&list=PLFgquLnL59alCl_2TQvOiD5Vgm1hCaGSI&index=3`,
    );
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await expect(page.getByText("This song is part of a playlist.")).toBeVisible();
  await page.getByRole("button", { name: "Just this song" }).click();
  await expect(page.locator(".add__result")).toHaveText("Added 1 song to your list.");
  await expect(page.getByRole("button", { name: "Just this song" })).toHaveCount(0);
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
  await clearRoom(ada);

  await test.step("both hear the same moment of the same song", async () => {
    await add(ada, first.videoId);
    await addFromPlaylistLink(ada, second.videoId);
    await ada.getByRole("button", { name: "Start listening" }).click();
    await bob.getByRole("button", { name: "Start listening" }).click();
    await Promise.all([inSync(ada), inSync(bob)]);

    for (const page of [ada, bob]) {
      await expect(page.locator(".now__title")).toHaveText(first.title);
    }
    await expect.poll(async () => (await readBoth(ada, bob)).apartMs).toBeLessThan(SAME_MOMENT_MS);
  });

  await test.step("one mutes in the player, and only their own sound goes", async () => {
    const nowPlaying = ada.getByRole("region", { name: "Now playing" });
    await expect(nowPlaying.getByRole("slider", { name: "Volume" })).toBeVisible();
    await expect(ada.getByRole("slider", { name: "Volume" })).toHaveCount(1);

    await nowPlaying.getByRole("button", { name: "Mute" }).click();
    await expect.poll(async () => (await playback(ada))?.muted).toBe(true);
    expect((await playback(bob))?.muted).toBe(false);

    await nowPlaying.getByRole("button", { name: "Unmute" }).click();
    await expect.poll(async () => (await playback(ada))?.muted).toBe(false);
  });

  await test.step("one pauses, and the other stops at the same place", async () => {
    await ada.getByRole("button", { name: "Pause", exact: true }).click();

    // Both players hear of the pause at the same moment, but stop a few milliseconds apart.
    await expect
      .poll(async () => {
        const { a, b } = await readBoth(ada, bob);
        return a.paused && b.paused;
      })
      .toBe(true);
    const { a, b } = await readBoth(ada, bob);
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

  await test.step("one clears the queue after saying yes, and it empties for both", async () => {
    const queued = (page: Page) => page.locator(".queue .row");
    const count = (page: Page) => page.locator(".upnext__count");
    const clear = ada.getByRole("button", { name: "Clear queue" });
    const question = ada.getByRole("dialog", { name: "Clear the queue?" });
    await add(bob, first.videoId);
    for (const page of [ada, bob]) {
      await expect(queued(page)).toHaveCount(1);
      await expect(count(page)).toHaveText("1 song");
    }

    await clear.click();
    await expect(question).toContainText("This removes 1 song from Up next for everyone.");
    await question.press("Escape");
    await expect(question).toHaveCount(0);

    await clear.click();
    await question.getByRole("button", { name: "Keep songs" }).click();
    await expect(question).toHaveCount(0);
    for (const page of [ada, bob]) await expect(queued(page)).toHaveCount(1);

    await clear.click();
    await question.getByRole("button", { name: "Clear queue" }).click();

    await expect(question).toHaveCount(0);
    for (const page of [ada, bob]) {
      await expect(page.getByText("Nothing queued.")).toBeVisible();
      await expect(count(page)).toHaveText("0 songs");
      await expect(page.locator(".now__title")).toHaveText(second.title);
    }
    await expect(bob.locator(".feed")).toContainText("Ada cleared 1 song from the queue");
  });

  await test.step("with shuffle on, one stars a song, and it plays next for both", async () => {
    const queued = (page: Page) => page.locator(".queue .row");
    const bobsRow = (page: Page) => queued(page).filter({ hasText: PEOPLE[1].name });
    const playNext = `Play ${first.title} next`;
    await ada.getByRole("button", { name: "Shuffle is off" }).click();
    await add(ada, first.videoId);
    await add(bob, first.videoId);

    for (const page of [ada, bob]) {
      await expect(page.getByRole("button", { name: "Shuffle is on" })).toBeVisible();
      await expect(queued(page)).toHaveCount(2);
      await expect(page.locator(".upnext__count")).toHaveText("2 songs");
      await expect(page.getByRole("button", { name: /^Move / })).toHaveCount(0);
    }

    await bobsRow(ada).getByRole("button", { name: playNext }).click();
    await expect(bobsRow(bob).getByRole("button", { name: playNext })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(bob.locator(".feed")).toContainText(`Ada starred ${first.title} to play next`);

    await ada.getByRole("button", { name: "Skip" }).click();
    for (const page of [ada, bob]) {
      await expect(page.locator(".now__title")).toHaveText(first.title);
      await expect(page.locator(".now__owner")).toContainText(PEOPLE[1].name);
      await expect(queued(page)).toHaveCount(1);
      await expect(page.locator(".upnext__count")).toHaveText("1 song");
    }

    // Later tests share the room and expect it in order.
    await ada.getByRole("button", { name: "Shuffle is on" }).click();
    await expect(bob.getByRole("button", { name: "Shuffle is off" })).toBeVisible();
  });
});
