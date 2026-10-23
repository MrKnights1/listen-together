import { expect, type Page } from "@playwright/test";

/**
 * The end-to-end tests share one server, so one room: each starts by skipping
 * whatever an earlier test left playing or queued, until the room is idle.
 */
export async function clearRoom(page: Page): Promise<void> {
  // "(you)" needs the room's welcome: before it the page shows an empty room, with nothing to skip.
  await expect(page.getByText("(you)")).toBeVisible();
  const skip = page.getByRole("button", { name: "Skip" });
  const title = page.locator(".now__title");
  const queued = page.locator(".queue .row");
  while (await skip.isEnabled()) {
    const playing = await title.innerText();
    const waiting = await queued.count();
    await skip.click();
    // The next song may be the same one queued again: a shorter queue shows the skip too.
    await expect
      .poll(
        async () =>
          (await title.count()) === 0 ||
          (await title.innerText()) !== playing ||
          (await queued.count()) < waiting,
      )
      .toBe(true);
  }
}
