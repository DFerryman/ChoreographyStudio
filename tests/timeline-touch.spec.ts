import { expect, test, type CDPSession, type Page } from '@playwright/test';
import { closeDisclosures } from './helpers';
import { backup, diagnostics, openFixture, screenshot } from './realismHelpers';

// iPad-class tablet: touch input at tablet widths, without the phone layout.
test.use({ hasTouch: true, viewport: { width: 1180, height: 820 } });

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

const timeline = (page: Page) => page.getByRole('region', { name: '场景时间线', exact: true });
const countTrack = (page: Page) => timeline(page).locator('[data-track-id="counts"] .tl-lane-track');
const zoomSlider = (page: Page) => timeline(page).getByRole('slider', { name: '时间线缩放', exact: true });
const range = async (page: Page) => countTrack(page).evaluate(element => [Number(element.getAttribute('data-range-start')), Number(element.getAttribute('data-range-end'))]);

/** Viewport point inside the count row for a scene time, at the current zoom and scroll (16 s fixture). */
async function pointAt(page: Page, seconds: number) {
  const box = (await countTrack(page).boundingBox())!;
  return { x: box.x + box.width * seconds / 16, y: box.y + box.height / 2 };
}
type Point = { x: number; y: number };
async function touch(cdp: CDPSession, type: 'touchStart' | 'touchMove' | 'touchEnd', points: Point[]) {
  await cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points.map((point, id) => ({ x: point.x, y: point.y, id })) });
}
/** One finger: press, move in steps, release. */
async function swipe(cdp: CDPSession, from: Point, to: Point, steps = 8) {
  await touch(cdp, 'touchStart', [from]);
  for (let step = 1; step <= steps; step += 1) await touch(cdp, 'touchMove', [{ x: from.x + (to.x - from.x) * step / steps, y: from.y + (to.y - from.y) * step / steps }]);
  await touch(cdp, 'touchEnd', []);
}
async function tap(cdp: CDPSession, at: Point) { await touch(cdp, 'touchStart', [at]); await touch(cdp, 'touchEnd', []); }
/** Two fingers centred on one point, changing their horizontal spread. */
async function pinch(cdp: CDPSession, centre: Point, fromSpread: number, toSpread: number, steps = 10) {
  const at = (spread: number) => [{ x: centre.x - spread / 2, y: centre.y }, { x: centre.x + spread / 2, y: centre.y }];
  await touch(cdp, 'touchStart', at(fromSpread));
  for (let step = 1; step <= steps; step += 1) await touch(cdp, 'touchMove', at(fromSpread + (toSpread - fromSpread) * step / steps));
  await touch(cdp, 'touchEnd', []);
}

test('@timelinetouch iPad touch: one-finger range drag, double-tap eight-count, pinch zoom and keyboard zoom stay view-only', async ({ page }, info) => {
  test.setTimeout(120_000);
  await openFixture(page);
  const original = (await backup(page)).scene.project;
  await closeDisclosures(page);
  expect(await page.evaluate(() => matchMedia('(pointer: coarse)').matches)).toBe(true);
  const cdp = await page.context().newCDPSession(page);

  // Tablet touch targets: range edges, rows and toolbar buttons are finger-sized.
  await swipe(cdp, await pointAt(page, 2.02), await pointAt(page, 5.98));
  expect(await range(page)).toEqual([2, 6]);
  const handle = (await timeline(page).getByRole('button', { name: '拖动选区终点', exact: true }).boundingBox())!;
  expect(handle.width).toBeGreaterThanOrEqual(26);
  expect((await countTrack(page).boundingBox())!.height).toBeGreaterThanOrEqual(34);
  const zoomButton = (await timeline(page).getByRole('button', { name: '适合整段时间线', exact: true }).boundingBox())!;
  expect(zoomButton.height).toBeGreaterThanOrEqual(40);

  // Dragging the end handle with a finger moves only that edge.
  await swipe(cdp, { x: handle.x + handle.width / 2, y: handle.y + handle.height / 2 }, await pointAt(page, 8));
  expect(await range(page)).toEqual([2, 8]);

  // A single tap positions the playhead; a quick second tap selects the eight-count.
  const at = await pointAt(page, 13);
  await tap(cdp, at);
  await expect.poll(async () => Number(await timeline(page).getAttribute('data-time'))).toBeCloseTo(13, 1);
  expect(await range(page)).toEqual([2, 8]);
  await page.waitForTimeout(500);
  await tap(cdp, at); await tap(cdp, at);
  expect(await range(page)).toEqual([12, 16]);
  // The browser's dblclick synthesized from those taps must not also zoom to the new range.
  await page.waitForTimeout(300);
  await expect(zoomSlider(page)).toHaveValue('0');

  // Spreading two fingers zooms around their midpoint; the time under it stays put.
  const fitWidth = (await countTrack(page).boundingBox())!.width;
  const centre = await pointAt(page, 8);
  await pinch(cdp, centre, 120, 360);
  await expect.poll(async () => (await countTrack(page).boundingBox())!.width).toBeGreaterThan(fitWidth * 2.5);
  expect(Math.abs((await pointAt(page, 8)).x - centre.x)).toBeLessThan(24);
  expect(Number(await zoomSlider(page).inputValue())).toBeGreaterThan(0);
  // The pinch neither moved the range nor the playhead.
  expect(await range(page)).toEqual([12, 16]);
  await expect.poll(async () => Number(await timeline(page).getAttribute('data-time'))).toBeCloseTo(13, 1);
  await screenshot(page, info, 'timeline-touch-pinched.png');

  // Pinching in returns to the whole-scene fit and never below it.
  await pinch(cdp, centre, 400, 40);
  await expect(zoomSlider(page)).toHaveValue('0');
  expect(Math.abs((await countTrack(page).boundingBox())!.width - fitWidth)).toBeLessThan(1);

  // Hardware keyboard (iPad Magic Keyboard or desktop): = / - zoom, backslash fits.
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.press('=');
  await expect.poll(async () => Number(await zoomSlider(page).inputValue())).toBeGreaterThan(0);
  await page.keyboard.press('=');
  const zoomed = Number(await zoomSlider(page).inputValue());
  await page.keyboard.press('-');
  await expect.poll(async () => Number(await zoomSlider(page).inputValue())).toBeLessThan(zoomed);
  await page.keyboard.press('\\');
  await expect(zoomSlider(page)).toHaveValue('0');

  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(1180);
  await screenshot(page, info, 'timeline-touch-1180.png');
  // Ranges and zoom are view state only.
  expect((await backup(page)).scene.project).toEqual(original);
});

test('@timelinetouch iPad portrait keeps the docked Timeline usable without horizontal overflow', async ({ page }, info) => {
  await page.setViewportSize({ width: 820, height: 1180 });
  await openFixture(page);
  await closeDisclosures(page);
  const cdp = await page.context().newCDPSession(page);
  await swipe(cdp, await pointAt(page, 4), await pointAt(page, 8));
  expect(await range(page)).toEqual([4, 8]);
  const lanes = await timeline(page).locator('[data-track-id]').evaluateAll(rows => rows.map(row => row.getBoundingClientRect().height));
  for (const height of lanes) expect(height).toBeGreaterThanOrEqual(34);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(820);
  await screenshot(page, info, 'timeline-touch-820.png');
});
