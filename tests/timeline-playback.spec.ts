import { expect, test, type Page } from '@playwright/test';
import { closeDisclosures, seekSeconds } from './helpers';
import { backup, diagnostics, openFixture, screenshot } from './realismHelpers';

const timeline = (page: Page) => page.getByRole('region', { name: '场景时间线', exact: true });
const viewport = (page: Page) => timeline(page).locator('.tl-viewport');
const time = (page: Page) => timeline(page);
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
      const label = element.querySelector('.tl-ruler-row > .tl-lane-label')!.getBoundingClientRect();
      const cursor = element.querySelector('.tl-playhead')!.getBoundingClientRect();
      const value = Number(document.querySelector('.tl-timeline')!.getAttribute('data-time'));
      samples.push({ scroll: element.scrollLeft, cursor: cursor.x + cursor.width / 2, left: label.right, right: bounds.right, time: value });
    }
    return samples;
  });
}

/** Playback never scrolls the Timeline: the view holds still and the playhead moves. */
function stationary(samples: Awaited<ReturnType<typeof playbackSamples>>) {
  expect(new Set(samples.map(sample => sample.scroll)).size, 'Playback must not scroll the Timeline').toBe(1);
}

async function loop(page: Page) {
  await page.getByRole('button', { name: '循环整段', exact: true }).click();
}

for (const width of [1440, 390, 320]) {
  test(`@timelineplayback ${width}px playback moves the playhead without scrolling, across pause, loop and fit, without changing author data`, async ({ page }, info) => {
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
    stationary(frames);
    expect(frames.at(-1)!.time).toBeGreaterThan(frames[0].time);
    expect(frames.at(-1)!.cursor, 'The playhead itself advances').toBeGreaterThan(frames[0].cursor + 2);
    // The playhead is one continuous, clearly coloured line through every lane.
    const head = await timeline(page).locator('.tl-playhead').evaluate(element => {
      const style = getComputedStyle(element), line = element.getBoundingClientRect();
      const lanes = element.parentElement!.getBoundingClientRect();
      return { width: line.width, top: line.top - lanes.top, bottom: lanes.bottom - line.bottom, color: style.backgroundColor };
    });
    expect(head.width).toBeGreaterThanOrEqual(2);
    expect(Math.abs(head.top) + Math.abs(head.bottom)).toBeLessThan(1);
    expect(head.color).not.toMatch(/^rgb\((\d+), \1, \1\)$/);
    await screenshot(page, info, `timeline-playhead-${width}.png`);
    await page.getByRole('button', { name: '暂停', exact: true }).click();
    await expect(page.getByRole('button', { name: '播放', exact: true })).toBeVisible();

    // Pausing hands the scroller back to the user; panning does not seek.
    const pausedTime = await time(page).getAttribute('data-time');
    const cameraLane = timeline(page).locator('.tl-lane[data-track-id="camera"]');
    await cameraLane.evaluate(element => element.scrollIntoView({ block: 'nearest', inline: 'nearest' }));
    const start = await viewport(page).evaluate(element => element.scrollLeft);
    const bounds = (await viewport(page).boundingBox())!;
    const row = (await cameraLane.boundingBox())!;
    const x = bounds.x + bounds.width * .7, y = row.y + row.height / 2;
    await page.mouse.move(x, y); await page.mouse.down();
    await page.mouse.move(x - 80, y, { steps: 6 }); await page.mouse.up();
    await expect.poll(() => viewport(page).evaluate(element => element.scrollLeft)).toBeCloseTo(start + 80, 0);
    const paused = await playbackSamples(page);
    expect(new Set(paused.map(sample => sample.scroll)).size).toBe(1);
    await expect(time(page)).toHaveAttribute('data-time', pausedTime!);

    // A manual intermediate zoom stays put too, including the loop back to zero.
    await timeline(page).getByRole('slider', { name: '时间线缩放', exact: true }).evaluate((element: HTMLInputElement) => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(element, '75');
      element.dispatchEvent(new Event('input', { bubbles: true }));
      element.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await loop(page);
    await seekSeconds(page, 15.7);
    await page.getByRole('button', { name: '播放', exact: true }).click();
    // Whole-scene looping continues from the cursor; wait for a real wrap.
    await expect.poll(async () => Number(await time(page).getAttribute('data-time')), { timeout: 20_000 }).toBeGreaterThan(15);
    const beforeWrap = await viewport(page).evaluate(element => element.scrollLeft);
    await expect.poll(async () => Number(await time(page).getAttribute('data-time'))).toBeLessThan(1);
    const wrapped = await playbackSamples(page); stationary(wrapped);
    expect(wrapped[0].scroll, 'The loop wrap does not scroll the Timeline').toBe(beforeWrap);
    await page.getByRole('button', { name: '暂停', exact: true }).click();

    // Playback stops exactly at the end.
    await loop(page);
    await seekSeconds(page, 15.9);
    await page.getByRole('button', { name: '播放', exact: true }).click();
    await expect(page.getByRole('button', { name: '播放', exact: true })).toBeVisible();
    await expect(time(page)).toHaveAttribute('data-time', '16');

    await timeline(page).getByRole('button', { name: '适合整段时间线', exact: true }).click();
    await seekSeconds(page, 5);
    await page.getByRole('button', { name: '播放', exact: true }).click();
    const fit = await playbackSamples(page); stationary(fit);
    expect(fit.every(sample => sample.scroll === 0)).toBe(true);
    await page.getByRole('button', { name: '暂停', exact: true }).click();
    expect((await backup(page)).scene.project).toEqual(original);
  });
}
