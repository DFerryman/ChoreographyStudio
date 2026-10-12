import { expect, test, type Page } from '@playwright/test';
import { bakeKeyframeSequence, makeKeyframeSequence, sampleTake, upsertMotionPointChanges } from '../packages/core/src';
import { closeDisclosures } from './helpers';
import { backup, current, diagnostics, openFixture, save, screenshot, ready } from './realismHelpers';

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
const readout = (page: Page) => page.getByLabel('当前选区', { exact: true });
const range = async (page: Page) => countTrack(page).evaluate(element => [Number(element.getAttribute('data-range-start')), Number(element.getAttribute('data-range-end'))]);

/** Pointer X inside the count row for an exact scene time (fit zoom, 16 s fixture). */
async function xAt(page: Page, seconds: number) {
  const box = (await countTrack(page).boundingBox())!;
  return { x: box.x + box.width * seconds / 16, y: box.y + box.height / 2 };
}
async function dragCounts(page: Page, from: number, to: number) {
  const start = await xAt(page, from), end = await xAt(page, to);
  await page.mouse.move(start.x, start.y); await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 8 }); await page.mouse.up();
}

for (const width of [1440, 390]) {
  test(`@timelinerange ${width}px count-row drag, handles, octet select and zoom-to-range stay view-only`, async ({ page }, info) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width, height: width === 1440 ? 1000 : 844 });
    await openFixture(page);
    const original = (await backup(page)).scene.project;
    await closeDisclosures(page);
    // Only two editable tracks; the count row is for navigation and ranges.
    expect(await timeline(page).locator('[data-track-id]').evaluateAll(rows => rows.map(row => row.getAttribute('data-track-id')))).toEqual(['counts', 'audio', 'camera']);

    // Drags snap to dance counts (0.5 s at 120 BPM) when close to one.
    await dragCounts(page, 2.02, 5.98);
    await expect(readout(page)).toHaveText('2s–6s · 4s');
    expect(await range(page)).toEqual([2, 6]);

    // Edge handles adjust one side; the body moves the range intact.
    const endHandle = (await timeline(page).getByRole('button', { name: '拖动选区终点', exact: true }).boundingBox())!;
    const target = await xAt(page, 8);
    await page.mouse.move(endHandle.x + endHandle.width / 2, endHandle.y + endHandle.height / 2); await page.mouse.down();
    await page.mouse.move(target.x, target.y, { steps: 8 }); await page.mouse.up();
    expect(await range(page)).toEqual([2, 8]);
    const body = (await timeline(page).getByRole('button', { name: '拖动移动选区', exact: true }).boundingBox())!;
    const from = { x: body.x + body.width / 2, y: body.y + body.height / 2 }, shift = (await xAt(page, 4)).x - (await xAt(page, 0)).x;
    await page.mouse.move(from.x, from.y); await page.mouse.down();
    await page.mouse.move(from.x + shift, from.y, { steps: 8 }); await page.mouse.up();
    const moved = await range(page);
    expect(moved[1] - moved[0]).toBeCloseTo(6, 6);
    expect(moved[0]).toBeGreaterThan(5.5); expect(moved[0]).toBeLessThan(6.5);

    // A plain click in the count row positions the playhead and keeps the range.
    const click = await xAt(page, 1);
    await page.mouse.click(click.x, click.y);
    await expect.poll(async () => Number(await timeline(page).getAttribute('data-time'))).toBeCloseTo(1, 1);
    expect(await range(page)).toEqual(moved);

    // Double-click selects the whole eight-count phrase under the pointer
    // (inside an existing range, a double-click zooms to it instead).
    const fourth = await xAt(page, 13);
    await page.mouse.dblclick(fourth.x, fourth.y);
    expect(await range(page)).toEqual([12, 16]);
    await screenshot(page, info, `timeline-range-${width}.png`);

    // Zooming to the range fits it into the visible lanes.
    await timeline(page).getByRole('button', { name: '缩放到选区', exact: true }).click();
    const viewport = timeline(page).locator('.tl-viewport');
    await expect.poll(async () => {
      const shade = await timeline(page).locator('[data-track-id="camera"] .tl-range-shade').boundingBox();
      const view = await viewport.boundingBox();
      return !!shade && !!view && shade.width > view.width * .55 && shade.x >= view.x && shade.x + shade.width <= view.x + view.width + 1;
    }).toBe(true);
    await timeline(page).getByRole('button', { name: '清除选区', exact: true }).click();
    await expect(readout(page)).toHaveText('未选区');
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    // Ranges are view state only.
    expect((await backup(page)).scene.project).toEqual(original);
  });
}

test('@timelinerange explicit camera key records the current view and the AI panel shows the target range', async ({ page }) => {
  await openFixture(page);
  const before = await backup(page);
  const at = await xAt(page, 4);
  await page.mouse.click(at.x, at.y);
  await expect(timeline(page)).toHaveAttribute('data-time', '4');
  await dragCounts(page, 4, 8);
  await page.getByRole('button', { name: '在当前时间记录镜头', exact: true }).click();
  const after = await backup(page);
  expect(current(after).cameraTrack!.keys).toEqual([{ time: 4, camera: after.scene.viewer.camera }]);
  expect(current(after).operation).toMatchObject({ label: '记录镜头', time: 4, tracks: ['camera'] });
  expect(current(after).take).toEqual(current(before).take);
  await expect(timeline(page).getByRole('button', { name: '删除镜头关键帧', exact: true })).toBeVisible();
  await page.getByLabel('AI 生成动作', { exact: true }).click();
  await expect(page.getByLabel('AI 目标区间', { exact: true })).toContainText('4 秒–8 秒');
});

test('@timelinerange existing character keyframes stay in the scene, hidden from the Timeline, through save and reload', async ({ page }) => {
  test.setTimeout(90_000);
  const source = await openFixture(page, false, fixture => {
    // Character authoring from the earlier manual editor: hidden, never dropped.
    const base = fixture.take, before = sampleTake(base, 2.5), after = structuredClone(before);
    after.joints.LeftUpperArm = [0, 0, Math.sin(.4), Math.cos(.4)]; after.root = [.6, 1.05, .2];
    let manual = makeKeyframeSequence(base, { pointInterpolation: 'hold-last-key-1' });
    manual = upsertMotionPointChanges(manual, 2.5, before, after, base);
    fixture.take = bakeKeyframeSequence(manual);
    Object.assign(fixture.scene.project.history[0], { take: fixture.take, manual });
  });
  const opened = await backup(page), snapshot = current(opened);
  expect(snapshot.manual?.pointEdits).toHaveLength(1);
  expect(snapshot.take).toEqual(source.take);
  await expect(timeline(page).locator('[data-track-id]')).toHaveCount(3);
  await expect(page.getByRole('button', { name: /旋转工具|移动角色工具|手脚 IK/, includeHidden: true })).toHaveCount(0);
  // The stage still plays the retained motion: the Root moves toward 0.6 m.
  await page.getByRole('slider', { name: '时间线进度', exact: true }).fill('3');
  await expect.poll(async () => JSON.parse((await page.getByRole('region', { name: '3D 动画舞台', exact: true }).getAttribute('data-root-position'))!)[0]).toBeGreaterThan(.5);
  // Saving a camera edit keeps the character data byte-for-byte.
  await page.getByRole('button', { name: '在当前时间记录镜头', exact: true }).click();
  await save(page);
  await page.reload(); await ready(page);
  const reopened = current(await backup(page));
  expect(reopened.manual).toEqual(snapshot.manual);
  expect(reopened.take).toEqual(snapshot.take);
  expect(reopened.cameraTrack!.keys).toHaveLength(1);
});
