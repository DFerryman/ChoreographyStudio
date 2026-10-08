import { expect, type Locator, type Page } from '@playwright/test';

/** Reveal an action through the same native disclosure controls a user uses. */
export async function reveal(_page: Page, target: Locator): Promise<void> {
  await expect(target).toHaveCount(1);
  const closed = target.locator('xpath=ancestor::details[not(@open)]');
  while (await closed.count()) {
    await closed.first().locator(':scope > summary').click();
  }
  await expect(target).toBeVisible();
}

export async function clickRevealed(page: Page, target: Locator): Promise<void> {
  await reveal(page, target);
  await target.click();
}
