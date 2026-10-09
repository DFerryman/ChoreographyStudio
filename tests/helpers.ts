import { expect, type Locator, type Page } from '@playwright/test';

/** Reveal an action through the same native disclosure controls a user uses. */
export async function reveal(_page: Page, target: Locator): Promise<void> {
  await expect(target).toHaveCount(1);
  const closed = target.locator('xpath=ancestor::details[not(@open)]');
  while (await closed.count()) {
    const summary = closed.first().locator(':scope > summary');
    await summary.focus();
    await summary.press('Enter');
  }
  await expect(target).toBeVisible();
}

export async function clickRevealed(page: Page, target: Locator): Promise<void> {
  await reveal(page, target);
  await target.click();
}

/** Dismiss floating tool menus through their native keyboard controls. */
export async function closeDisclosures(page: Page, selector = 'details'): Promise<void> {
  const panels = page.locator(selector);
  while (true) {
    const index = await panels.evaluateAll(elements => elements.map((element, index) => element instanceof HTMLDetailsElement && element.open ? index : -1).filter(index => index >= 0).at(-1) ?? -1);
    if (index < 0) return;
    const details = panels.nth(index), closedAncestors = details.locator('xpath=ancestor::details[not(@open)]');
    while (await closedAncestors.count()) {
      const ancestorSummary = closedAncestors.first().locator(':scope > summary');
      await ancestorSummary.focus();
      await ancestorSummary.press('Enter');
    }
    const summary = details.locator(':scope > summary');
    await summary.focus();
    await summary.press('Enter');
    await expect(details).not.toHaveAttribute('open');
  }
}

/** Operation scope is independent of the visible track overview. */
export async function timelineScopeFrames(page: Page): Promise<number[]> {
  const timeline = page.getByRole('region', { name: '手动关键帧时间线', exact: true });
  const scope = await timeline.getByRole('combobox', { name: '关键帧轨道筛选', exact: true, includeHidden: true }).inputValue();
  let keys = timeline.locator('.kf-lane-key');
  if (scope === 'root') keys = timeline.locator('[data-track-id="root"] .kf-lane-key');
  if (scope === 'joint') {
    const joint = await page.getByRole('region', { name: '3D 动画舞台', exact: true }).getAttribute('data-selected-joint');
    const groups: Record<string, string[]> = {
      body: ['Hips', 'Spine', 'Chest', 'Neck', 'Head'],
      'left-arm': ['LeftShoulder', 'LeftUpperArm', 'LeftForeArm', 'LeftHand'],
      'right-arm': ['RightShoulder', 'RightUpperArm', 'RightForeArm', 'RightHand'],
      'left-leg': ['LeftUpperLeg', 'LeftLowerLeg', 'LeftFoot'],
      'right-leg': ['RightUpperLeg', 'RightLowerLeg', 'RightFoot'],
    };
    const group = Object.keys(groups).find(id => joint && groups[id].includes(joint));
    if (!group) return [];
    const toggle = timeline.locator(`[data-track-id="${group}"] .kf-group-toggle`);
    if (await toggle.getAttribute('aria-expanded') !== 'true') await toggle.click();
    keys = timeline.locator(`[data-track-id="${joint}"] .kf-lane-key`);
  }
  return keys.evaluateAll(items => [...new Set(items.map(item => Number(item.getAttribute('data-frame'))))].sort((a, b) => a - b));
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
