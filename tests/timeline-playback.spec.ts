import { expect, test, type Page } from '@playwright/test';
import { clickRevealed, closeDisclosures, seekSeconds } from './helpers';
import { backup, diagnostics, openFixture, screenshot } from './realismHelpers';

const timeline = (page: Page) => page.getByRole('region', { name: '手动关键帧时间线', exact: true });
const viewport = (page: Page) => timeline(page).locator('.kf-lanes-viewport');
const time = (page: Page) => timeline(page).locator('.kf-point-inspector summary code[data-time]');
const reports = new WeakMap<Page, ReturnType<typeof diagnostics>>();

test.beforeEach(async ({ page }) => {
  reports.set(page, diagnostics(page));
  await page.route('**/api/**', route => route.abort('blockedbyclient'));
});
test.afterEach(async ({ page }, info) => {
  const report = reports.get(page)!;
  await info.attach('browser-console-and-api', { body: JSON.stringify(report), contentType: 'application/json' });
  expect(report).toEqual({ errors: [], warnings: [], expectedHttpErrors: [], apiRequests: [] });
});

async function playbackSamples(page: Page) {
  return viewport(page).evaluate(async element => {
    const samples = [] as { scroll: number; cursor: number; left: number; right: number; time: number }[];
    for (let index = 0; index < 24; index++) {
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
      const bounds = element.getBoundingClientRect();
      const label = element.querySelector('.kf-ruler-row > .kf-lane-label')!.getBoundingClientRect();
      const cursor = element.querySelector('.kf-ruler-playhead')!.getBoundingClientRect();
      const value = Number(document.querySelector('.kf-point-inspector summary code[data-time]')!.getAttribute('data-time'));
      samples.push({ scroll: element.scrollLeft, cursor: cursor.x + cursor.width / 2, left: label.right, right: bounds.right, time: value });
    }
    return samples;
  });
}

function visible(samples: Awaited<ReturnType<typeof playbackSamples>>) {
  for (const sample of samples) {
    expect(sample.cursor, `Playback cursor at ${sample.time}s must remain after the sticky labels`).toBeGreaterThanOrEqual(sample.left - 2);
    expect(sample.cursor, `Playback cursor at ${sample.time}s must remain inside the viewport`).toBeLessThanOrEqual(sample.right + 2);
  }
}

async function loop(page: Page) {
  await clickRevealed(page, page.getByRole('button', { name: '循环整段', exact: true, includeHidden: true }));
  await closeDisclosures(page, '.kf-more, .playback-options');
}

for (const width of [1440, 390, 320]) {
  test(`@timelineplayback ${width}px zoomed playback follows its cursor, respects pause, loop and fit without changing author data`, async ({ page }, info) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width, height: width === 1440 ? 1000 : 844 });
    await openFixture(page);
    const original = (await backup(page)).scene.project;
    await closeDisclosures(page);
    await seekSeconds(page, 5);
    await timeline(page).getByRole('button', { name: '逐帧查看时间线', exact: true }).click();
    await page.getByRole('button', { name: '播放', exact: true }).click();
    await expect(page.getByRole('button', { name: '暂停', exact: true })).toBeVisible();
    const frames = await playbackSamples(page);
    visible(frames);
    expect(frames.at(-1)!.scroll).toBeGreaterThan(frames[0].scroll + 10);
    expect(frames.at(-1)!.time).toBeGreaterThan(frames[0].time);
    await screenshot(page, info, `timeline-follow-${width}.png`);
    await page.getByRole('button', { name: '暂停', exact: true }).click();
    await expect(page.getByRole('button', { name: '播放', exact: true })).toBeVisible();

    // Pausing hands the scroller back to the user; panning does not seek.
    const pausedTime = await time(page).getAttribute('data-time');
    const start = await viewport(page).evaluate(element => element.scrollLeft);
    const bounds = (await viewport(page).boundingBox())!;
    const row = (await timeline(page).locator('.kf-lane[data-track-id="body"]').boundingBox())!;
    const x = bounds.x + bounds.width * .7, y = row.y + row.height / 2;
    await page.mouse.move(x, y); await page.mouse.down();
    await page.mouse.move(x - 80, y, { steps: 6 }); await page.mouse.up();
    await expect.poll(() => viewport(page).evaluate(element => element.scrollLeft)).toBeCloseTo(start + 80, 0);
    const paused = await playbackSamples(page);
    expect(new Set(paused.map(sample => sample.scroll)).size).toBe(1);
    await expect(time(page)).toHaveAttribute('data-time', pausedTime!);

    // A manual intermediate zoom follows too, including the loop back to zero.
    await timeline(page).getByRole('slider', { name: '时间线缩放', exact: true }).evaluate((element: HTMLInputElement) => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(element, '75');
      element.dispatchEvent(new Event('input', { bubbles: true }));
      element.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await loop(page);
    await seekSeconds(page, 15.7);
    await page.getByRole('button', { name: '播放', exact: true }).click();
    // Loop playback intentionally starts at zero; wait for a real full wrap.
    await expect.poll(async () => Number(await time(page).getAttribute('data-time')), { timeout: 20_000 }).toBeGreaterThan(15);
    await expect.poll(async () => Number(await time(page).getAttribute('data-time'))).toBeLessThan(1);
    const wrapped = await playbackSamples(page); visible(wrapped);
    expect(wrapped.at(-1)!.scroll).toBeLessThan(await viewport(page).evaluate(element => element.scrollWidth * .2));
    await page.getByRole('button', { name: '暂停', exact: true }).click();

    // The last authored time remains visible when playback stops at the end.
    await loop(page);
    await seekSeconds(page, 15.9);
    await page.getByRole('button', { name: '播放', exact: true }).click();
    await expect(page.getByRole('button', { name: '播放', exact: true })).toBeVisible();
    await expect(time(page)).toHaveAttribute('data-time', '16');
    visible(await playbackSamples(page));

    await timeline(page).getByRole('button', { name: '适合整段时间线', exact: true }).click();
    await seekSeconds(page, 5);
    await page.getByRole('button', { name: '播放', exact: true }).click();
    const fit = await playbackSamples(page); visible(fit);
    expect(fit.every(sample => sample.scroll === 0)).toBe(true);
    await page.getByRole('button', { name: '暂停', exact: true }).click();
    expect((await backup(page)).scene.project).toEqual(original);
  });
}
