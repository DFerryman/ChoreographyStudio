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

/** Manual editing has one frame slider; arranging retains its seconds slider. */
export async function seekSeconds(page: Page, time: number): Promise<void> {
  const frames = page.getByRole('slider', { name: '关键帧时间线进度', exact: true });
  const manual = await frames.count() > 0;
  const slider = manual ? frames : page.getByRole('slider', { name: '播放进度', exact: true });
  const value = manual ? Math.round(time * 30) : time;
  await slider.evaluate((element: HTMLInputElement, next) => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(element, String(next));
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
  }, value);
  await expect(slider).toHaveValue(String(value));
}
