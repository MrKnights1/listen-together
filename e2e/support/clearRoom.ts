import { expect, type Page } from "@playwright/test";

/**
 * The end-to-end tests share one server, so one room: each starts by skipping
 * whatever an earlier test left playing or queued, until the room is idle.
 */
export async function clearRoom(page: Page): Promise<void> {
  const skip = page.getByRole("button", { name: "Skip" });
  const title = page.locator(".now__title");
  while (await skip.isEnabled()) {
    const playing = await title.innerText();
    await skip.click();
    await expect
      .poll(async () => (await title.count()) === 0 || (await title.innerText()) !== playing)
      .toBe(true);
  }
}
