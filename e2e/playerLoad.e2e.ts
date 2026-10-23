import { execFileSync } from "node:child_process";
import { expect, test } from "@playwright/test";
import { clearRoom } from "./support/clearRoom.ts";
import { BASE_URL, PEOPLE, REPO_ROOT, SONGS } from "./support/e2eRoom.ts";

const IFRAME_API = "https://www.youtube.com/iframe_api";

test("a listener whose browser can't load YouTube's player is told so, and can try again", async ({
  browser,
}) => {
  const tokens = JSON.parse(
    execFileSync("bun", ["e2e/support/seed.ts"], { cwd: REPO_ROOT, encoding: "utf8" }),
  ) as Record<string, string>;
  const context = await browser.newContext();
  await context.addCookies([
    {
      name: "mp_session",
      value: tokens[PEOPLE[2].id] as string,
      url: BASE_URL,
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);
  const page = await context.newPage();
  await page.route(IFRAME_API, (route) => route.abort());
  await page.goto("/");
  await clearRoom(page);

  await page
    .getByLabel("YouTube video or playlist link")
    .fill(`https://youtu.be/${SONGS[0].videoId}`);
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await expect(page.locator(".add__result")).toHaveText("Added 1 song to your list.");
  await page.getByRole("button", { name: "Start listening" }).click();

  const notice = page.locator("p.sync");
  await expect(notice).toContainText("YouTube's player didn't load");

  await page.unroute(IFRAME_API);
  await notice.getByRole("button", { name: "Try again" }).click();
  await expect(notice).toHaveText("In sync", { timeout: 60_000 });

  await context.close();
});
