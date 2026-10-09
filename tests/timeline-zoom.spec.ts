import { expect, test, type Page } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { bakeKeyframeSequence, makeKeyframeSequence, rotationFromDegrees, lastFrame, upsertRootKeyframe, upsertRotationKeyframe } from '../packages/core/src';
import { closeDisclosures } from './helpers';
import { backup, current, diagnostics, openFixture, screenshot } from './realismHelpers';

const timeline = (page: Page) => page.getByRole('region', { name: '手动关键帧时间线', exact: true });
const viewport = (page: Page) => timeline(page).locator('.kf-lanes-viewport');
const cursor = (page: Page) => timeline(page).getByRole('spinbutton', { name: '当前帧', exact: true });
const pointTime = (page: Page) => timeline(page).locator('.kf-point-inspector summary code[data-time]');
const row = (page: Page, id: string) => timeline(page).locator(`.kf-lane[data-track-id="${id}"]`);
const key = (page: Page, id: string, frame: number) => row(page, id).locator(`.kf-lane-key[data-frame="${frame}"]`);
const zoom = (page: Page) => timeline(page).getByRole('slider', { name: '时间线缩放', exact: true });
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

async function denseScene(page: Page, duration = 16) {
  await openFixture(page, false, source => {
    const scale = duration / source.take.durationSeconds;
    if (scale !== 1) {
      const snapshot = source.scene.project.history[0];
      snapshot.countMap.durationSeconds = duration; snapshot.countMap.bpm /= scale;
      snapshot.countMap.countTimesSeconds = snapshot.countMap.countTimesSeconds.map(time => time * scale);
      snapshot.plan.durationSeconds = duration;
      snapshot.plan.slots = snapshot.plan.slots.map(slot => ({ ...slot, startSeconds: slot.startSeconds * scale, endSeconds: slot.endSeconds * scale }));
      source.take.durationSeconds = duration; source.take.times = source.take.times.map(time => time * scale);
    }
    const base = source.take;
    let manual = makeKeyframeSequence(base);
    for (let frame = 270; frame <= 286; frame++) manual = upsertRootKeyframe(manual, frame, [frame / 1000, 1.05, 0]);
    if (duration !== 16) { const end = lastFrame(duration); manual = upsertRootKeyframe(manual, end - 1, [.48, 1.05, 0]); manual = upsertRootKeyframe(manual, end, [.481, 1.05, 0]); }
    for (const frame of [270, 275, 276, 286]) manual = upsertRotationKeyframe(manual, 'LeftUpperArm', frame, rotationFromDegrees([0, 0, frame % 20]));
    const take = bakeKeyframeSequence(manual);
    Object.assign(source.scene.project.history[0], { manual, take });
    source.take = take;
  });
  await closeDisclosures(page);
  const initial = await backup(page);
  await closeDisclosures(page);
  return initial;
}

async function centerFrame(page: Page, frame: number, fraction = .5) {
  await viewport(page).evaluate((element, { frame, fraction }) => {
    const lane = element.querySelector<HTMLElement>('.kf-lane-track')!;
    const label = element.querySelector<HTMLElement>('.kf-lane-label')!;
    const end = Number(lane.getAttribute('data-frame-max'));
    element.scrollLeft = frame / end * lane.getBoundingClientRect().width - (element.clientWidth - label.getBoundingClientRect().width) * fraction;
  }, { frame, fraction });
}

async function showRow(page: Page, id: string) {
  await viewport(page).evaluate((element, id) => {
    const lane = element.querySelector<HTMLElement>(`.kf-lane[data-track-id="${id}"]`)!;
    const view = element.getBoundingClientRect(), rect = lane.getBoundingClientRect();
    const rulerHeight = element.querySelector('.kf-ruler-row')!.getBoundingClientRect().height;
    if (rect.top < view.top + rulerHeight) element.scrollTop += rect.top - view.top - rulerHeight;
    else if (rect.bottom > view.top + element.clientHeight) element.scrollTop += rect.bottom - view.top - element.clientHeight;
  }, id);
}

for (const width of [1440, 390, 320]) {
  test(`@timelinezoom ${width}px consecutive K remain distinct, zoom and pan preserve authority, and scrolled dragging uses the source frame`, async ({ page }, info) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width, height: width === 1440 ? 1000 : 844 });
    const initial = await denseScene(page, width === 320 ? 16.005 : 16);
    // The scrubber now uses exact seconds; canonical sparse K still use frames.
    const end = Number(await cursor(page).getAttribute('max'));
    const original = current(initial);
    await cursor(page).fill('275'); await cursor(page).press('Tab');
    const beforeZoom = await key(page, 'root', 275).boundingBox();
    await timeline(page).getByRole('button', { name: '逐帧查看时间线', exact: true }).click();
    await expect(zoom(page)).toHaveValue('100');
    await expect(timeline(page).locator('.kf-lanes')).toHaveAttribute('data-pixels-per-frame', '48');
    const a = (await key(page, 'root', 275).boundingBox())!, b = (await key(page, 'root', 276).boundingBox())!;
    expect(a.x + a.width / 2).toBeCloseTo(beforeZoom!.x + beforeZoom!.width / 2, 0);
    expect(b.x - a.x).toBeCloseTo(48, 5);
    expect(b.x - (a.x + a.width)).toBeGreaterThanOrEqual(4);
    await key(page, 'root', 275).click(); await expect(cursor(page)).toHaveValue('275');
    await expect(pointTime(page)).toHaveAttribute('data-time', String(275 / 30));
    await key(page, 'root', 276).click(); await expect(cursor(page)).toHaveValue('276');
    await expect(pointTime(page)).toHaveAttribute('data-time', String(276 / 30));
    await expect(timeline(page).getByRole('button', { name: /添加关键帧|更新关键帧/ })).toHaveCount(0);
    await expect(row(page, 'root').locator('.kf-lane-track')).toHaveAttribute('data-source-count', String(original.manual!.baseTake.times.length));
    expect((await backup(page)).scene.project).toEqual(initial.scene.project);
    await closeDisclosures(page);

    await screenshot(page, info, `timeline-dense-${width}.png`);
    if (width === 320) {
      // The real final interval is only .005s; its canonical K still receives
      // the full 48px display interval and both end keys can be selected.
      await viewport(page).evaluate(element => { element.scrollLeft = element.scrollWidth; element.scrollTop = 0; });
      const penultimate = (await key(page, 'root', end - 1).boundingBox())!, final = (await key(page, 'root', end).boundingBox())!;
      expect(final.x - penultimate.x).toBeCloseTo(48, 5);
      expect(final.x - penultimate.x - penultimate.width).toBeGreaterThanOrEqual(4);
      await key(page, 'root', end - 1).click(); await expect(cursor(page)).toHaveValue(String(end - 1));
      const finalVisible = (await key(page, 'root', end).boundingBox())!;
      await page.mouse.click(finalVisible.x + finalVisible.width / 4, finalVisible.y + finalVisible.height / 2);
      await expect(cursor(page)).toHaveValue(String(end));
      await expect(pointTime(page)).toHaveAttribute('data-time', String(original.take!.durationSeconds));
      expect((await backup(page)).scene.project).toEqual(initial.scene.project);
      await closeDisclosures(page);
      await cursor(page).fill('276'); await cursor(page).press('Tab');
    }

    // Pointer panning on empty track space moves the single scroller, without
    // seeking, recording keys, or changing the project/CountMap.
    await showRow(page, 'body');
    const view = (await viewport(page).boundingBox())!, body = (await row(page, 'body').boundingBox())!;
    const panX = view.x + view.width * .7, panY = body.y + body.height / 2;
    const scrollBefore = await viewport(page).evaluate(element => element.scrollLeft);
    if (width !== 1440) {
      // CDP touch positions enter Chrome's integer coordinate pipeline. Use one
      // integer origin for start and moves so the native gesture spans 96px.
      const touchX = Math.round(panX), touchY = Math.round(panY);
      await page.evaluate(({ touchX, touchY }) => {
        const audit = { origin: { x: touchX, y: touchY }, target: document.elementFromPoint(touchX, touchY)?.outerHTML.slice(0, 1000), events: [] as unknown[] };
        (window as unknown as { panAudit: typeof audit }).panAudit = audit;
        for (const type of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel']) document.addEventListener(type, event => {
          const pointer = event as PointerEvent;
          audit.events.push({ type, target: (event.target as HTMLElement)?.className, button: pointer.button, pointerType: pointer.pointerType, primary: pointer.isPrimary, x: pointer.clientX, y: pointer.clientY, scroll: document.querySelector('.kf-lanes-viewport')?.scrollLeft });
        }, true);
      }, { touchX, touchY });
      const touch = await page.context().newCDPSession(page);
      await touch.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
      await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: touchX, y: touchY }] });
      for (let step = 1; step <= 6; step++) await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: touchX - step * 16, y: touchY }] });
      await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await touch.send('Emulation.setTouchEmulationEnabled', { enabled: false });
      await touch.detach();
      const auditPath = info.outputPath('touch-pan-events.json');
      await writeFile(auditPath, JSON.stringify(await page.evaluate(() => (window as unknown as { panAudit: unknown }).panAudit), null, 2));
      await info.attach('touch-pan-events', { path: auditPath, contentType: 'application/json' });
    } else {
      await page.mouse.move(panX, panY); await page.mouse.down();
      await page.mouse.move(panX - 96, panY, { steps: 6 }); await page.mouse.up();
    }
    await expect.poll(() => viewport(page).evaluate(element => element.scrollLeft)).toBeCloseTo(scrollBefore + 96, 0);
    await expect(cursor(page)).toHaveValue('276');
    expect((await backup(page)).scene.project).toEqual(initial.scene.project);
    await closeDisclosures(page);

    // A ruler click and an empty lane click share the scrolled time mapping.
    await centerFrame(page, 276);
    const rail = (await row(page, 'root').locator('.kf-lane-track').boundingBox())!;
    const ruler = (await timeline(page).getByRole('slider', { name: '关键帧时间线进度', exact: true }).boundingBox())!;
    await page.mouse.click(rail.x + 277 / end * rail.width, ruler.y + ruler.height / 2);
    await expect(cursor(page)).toHaveValue('277');
    await page.mouse.click(rail.x + 275 / end * rail.width, panY);
    await expect(cursor(page)).toHaveValue('275');
    expect((await backup(page)).scene.project).toEqual(initial.scene.project);
    await closeDisclosures(page);

    // The cursor differs from the dragged key; the marker owns source 276.
    // The destination is occupied, so the unchanged collision guard must run.
    await viewport(page).evaluate(element => { element.scrollTop = 0; });
    await centerFrame(page, 276, .25);
    const fixedScroll = await viewport(page).evaluate(element => element.scrollLeft);
    const source = (await key(page, 'root', 276).boundingBox())!;
    await page.mouse.move(source.x + source.width / 2, source.y + source.height / 2); await page.mouse.down();
    await expect(zoom(page)).toBeDisabled();
    await page.mouse.move(source.x + source.width / 2 + 96, source.y + source.height / 2, { steps: 6 }); await page.mouse.up();
    const collision = page.getByRole('dialog', { name: '目标帧已有关键帧', exact: true });
    await expect(collision).toBeVisible();
    expect(await viewport(page).evaluate(element => element.scrollLeft)).toBe(fixedScroll);
    await expect(collision).toContainText('第 278 帧');
    await expect(key(page, 'root', 276)).toHaveCount(1);
    await expect(cursor(page)).toHaveValue('275');
    await collision.getByRole('button', { name: '替换并继续', exact: true }).click();
    await expect(collision).toBeHidden();
    const moved = await backup(page), motion = current(moved);
    expect(motion.manual!.root).toEqual(original.manual!.root.filter(item => item.frame !== 276 && item.frame !== 278).concat({ ...original.manual!.root.find(item => item.frame === 276)!, frame: 278 }).sort((left, right) => left.frame - right.frame));
    expect(motion.manual!.rotations).toEqual(original.manual!.rotations);
    expect(motion.manual!.baseTake).toEqual(original.manual!.baseTake);
    expect(motion.countMap).toEqual(original.countMap);
    expect(moved.scene.project.history).toHaveLength(initial.scene.project.history.length + 1);
    await page.getByRole('button', { name: '撤销', exact: true }).click();
    expect(current(await backup(page))).toEqual(original);
    await closeDisclosures(page);
    // Audio uses the same frozen pixels/time scale at a nonzero scroll offset.
    await centerFrame(page, 276);
    const audio = timeline(page).getByRole('button', { name: '移动音频片段', exact: true });
    const audioView = (await viewport(page).boundingBox())!, audioBox = (await audio.boundingBox())!;
    const audioLabelWidth = await timeline(page).locator('.kf-ruler-row .kf-lane-label').evaluate(element => element.getBoundingClientRect().width);
    const audioX = audioView.x + audioLabelWidth + (audioView.width - audioLabelWidth) * .3;
    await page.mouse.move(audioX, audioBox.y + audioBox.height / 2); await page.mouse.down();
    await page.mouse.move(audioX + 96, audioBox.y + audioBox.height / 2, { steps: 6 }); await page.mouse.up();
    await expect(audio).toHaveAttribute('data-offset-seconds', String(2 / 30));
    const audioMoved = await backup(page), audioMotion = current(audioMoved);
    expect(audioMotion.audioOffsetSeconds).toBe(2 / 30);
    expect(audioMotion.manual).toEqual(original.manual);
    expect(audioMotion.take).toEqual(original.take);
    expect(audioMotion.countMap).toEqual(original.countMap);
    expect(audioMotion.plan).toEqual(original.plan);
    expect(audioMoved.scene.project.history).toHaveLength(initial.scene.project.history.length + 1);
    await page.getByRole('button', { name: '撤销', exact: true }).click();
    expect(current(await backup(page))).toEqual(original);
    await closeDisclosures(page);
    // Ctrl-wheel preserves the exact time under the pointer, to the browser's
    // one-pixel scroll precision, and leaves authored history untouched.
    const wheelRail = (await row(page, 'root').locator('.kf-lane-track').boundingBox())!;
    const wheelView = (await viewport(page).boundingBox())!;
    const wheelX = wheelView.x + audioLabelWidth + (wheelView.width - audioLabelWidth) * .6;
    const wheelTime = (wheelX - wheelRail.x) / wheelRail.width * end / 30;
    await page.mouse.move(wheelX, panY);
    await page.keyboard.down('Control'); await page.mouse.wheel(0, 100); await page.keyboard.up('Control');
    await expect(zoom(page)).toHaveValue('94');
    const zoomedRail = (await row(page, 'root').locator('.kf-lane-track').boundingBox())!;
    expect(Math.abs((wheelX - zoomedRail.x) / zoomedRail.width * end / 30 - wheelTime)).toBeLessThanOrEqual(end / 30 / zoomedRail.width);
    expect(current(await backup(page))).toEqual(original);
    await closeDisclosures(page);
    // Panning away from the playhead must make toolbar zoom anchor the view
    // center, rather than jump back to the old cursor time.
    await cursor(page).fill('0'); await cursor(page).press('Tab');
    await centerFrame(page, 276);
    const centeredRail = (await row(page, 'root').locator('.kf-lane-track').boundingBox())!, centeredView = (await viewport(page).boundingBox())!;
    const centerX = centeredView.x + audioLabelWidth + (centeredView.width - audioLabelWidth) / 2;
    const centeredFrame = (centerX - centeredRail.x) / centeredRail.width * end;
    await timeline(page).getByRole('button', { name: '缩小时间线', exact: true }).click();
    await expect(zoom(page)).toHaveValue('81.5');
    const afterCenterZoom = (await row(page, 'root').locator('.kf-lane-track').boundingBox())!;
    expect(Math.abs((centerX - afterCenterZoom.x) / afterCenterZoom.width * end - centeredFrame)).toBeLessThanOrEqual(end / afterCenterZoom.width);
    await expect(cursor(page)).toHaveValue('0');
    expect(current(await backup(page))).toEqual(original);
    await closeDisclosures(page);
    await timeline(page).getByRole('button', { name: '适合整段时间线', exact: true }).click();
    await expect(zoom(page)).toHaveValue('0');
    await expect.poll(() => viewport(page).evaluate(element => element.scrollLeft)).toBe(0);
    expect(current(await backup(page))).toEqual(original);
    await closeDisclosures(page);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await screenshot(page, info, `timeline-zoom-${width}.png`);
  });
}

test('@timelinezoom edge scrolling moves one K across a viewport, freezes zoom, and commits once with exact undo', async ({ page }, info) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 960, height: 900 });
  const initial = await denseScene(page), original = current(initial);
  await cursor(page).fill('275'); await cursor(page).press('Tab');
  await timeline(page).getByRole('button', { name: '逐帧查看时间线', exact: true }).click();
  await centerFrame(page, 276);
  const source = (await key(page, 'root', 276).boundingBox())!, view = (await viewport(page).boundingBox())!;
  const originalScroll = await viewport(page).evaluate(element => element.scrollLeft);
  const sourceCenter = source.x + source.width / 2;
  await page.mouse.move(sourceCenter, source.y + source.height / 2); await page.mouse.down();
  await expect(zoom(page)).toBeDisabled();
  await viewport(page).evaluate((element, clientX) => element.dispatchEvent(new WheelEvent('wheel', { deltaY: -100, ctrlKey: true, clientX, bubbles: true, cancelable: true })), sourceCenter);
  await expect(zoom(page)).toHaveValue('100');
  await page.mouse.move(view.x + view.width - 2, source.y + source.height / 2, { steps: 8 });
  await expect.poll(() => viewport(page).evaluate(element => element.scrollLeft), { timeout: 10_000 }).toBeGreaterThan(originalScroll + view.width);
  // Stop edge scrolling in the middle before release, then inspect its actual
  // intended frame. This proves scroll-aware mapping without timing guesses.
  const releaseX = view.x + view.width / 2;
  await page.mouse.move(releaseX, source.y + source.height / 2);
  const scrolled = await viewport(page).evaluate(element => element.scrollLeft);
  const expectedFrame = Math.round(276 + (releaseX - sourceCenter + scrolled - originalScroll) / 48);
  expect(expectedFrame).toBeGreaterThan(286);
  await expect(row(page, 'root').locator('.kf-lane-key.dragging .kf-drag-time')).toHaveText(`${expectedFrame} 帧`);
  await page.mouse.up();
  await expect(zoom(page)).toBeEnabled();
  const moved = await backup(page), motion = current(moved);
  expect(motion.manual!.root).toEqual(original.manual!.root.map(item => item.frame === 276 ? { ...item, frame: expectedFrame } : item).sort((left, right) => left.frame - right.frame));
  expect(motion.manual!.rotations).toEqual(original.manual!.rotations);
  expect(motion.manual!.baseTake).toEqual(original.manual!.baseTake);
  expect(motion.countMap).toEqual(original.countMap);
  expect(moved.scene.project.history).toHaveLength(initial.scene.project.history.length + 1);
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  expect(current(await backup(page))).toEqual(original);
  await closeDisclosures(page);
  // Resizing across the sticky-header breakpoint cancels an unfinished move,
  // rather than changing its time mapping or committing a partial drag.
  const beforeResize = await backup(page);
  await closeDisclosures(page);
  await centerFrame(page, 276);
  const held = (await key(page, 'root', 276).boundingBox())!;
  await page.mouse.move(held.x + held.width / 2, held.y + held.height / 2); await page.mouse.down();
  await page.mouse.move(held.x + held.width / 2 + 48, held.y + held.height / 2, { steps: 4 });
  await expect(zoom(page)).toBeDisabled();
  await page.setViewportSize({ width: 640, height: 900 });
  await expect(zoom(page)).toBeEnabled(); await page.mouse.up();
  await expect(page.getByRole('dialog', { name: '目标帧已有关键帧', exact: true })).toHaveCount(0);
  expect((await backup(page)).scene.project).toEqual(beforeResize.scene.project);
  await closeDisclosures(page);
  await page.setViewportSize({ width: 960, height: 900 });
  await screenshot(page, info, 'timeline-zoom-autoscroll.png');
});
