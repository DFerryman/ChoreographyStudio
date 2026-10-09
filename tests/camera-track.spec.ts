import { deepStrictEqual } from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import type { BakedTake, CameraPose } from '../packages/core/src';
import { unpackScene } from '../apps/web/src/compactScene';
import { clickRevealed, closeDisclosures, reveal } from './helpers';
import { backup, current, diagnostics, hiddenButton, openFixture, ready, save, screenshot, type Backup } from './realismHelpers';

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

const timeline = (page: Page) => page.getByRole('region', { name: '手动关键帧时间线', exact: true });
const cameraLane = (page: Page) => timeline(page).locator('.kf-lane[data-track-id="camera"]');
const key = (page: Page, time: number) => cameraLane(page).locator(`.kf-camera-key[data-time="${time}"]`);
const stage = (page: Page) => page.getByRole('region', { name: '3D 动画舞台', exact: true });
const seconds = (page: Page) => timeline(page).getByRole('spinbutton', { name: '当前时间（秒）', exact: true, includeHidden: true });

async function atTime(page: Page, time: number) {
  await closeDisclosures(page);
  await reveal(page, seconds(page));
  await seconds(page).fill(String(time));
  await seconds(page).press('Tab');
  expect(Number(await seconds(page).inputValue())).toBe(time);
  await closeDisclosures(page, '.kf-point-inspector');
  await twoFrames(page);
}
async function selectCamera(page: Page) {
  await cameraLane(page).getByRole('button', { name: '选择镜头轨道', exact: true }).click();
  await expect(cameraLane(page)).toHaveClass(/selected/);
}
async function twoFrames(page: Page) {
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
}
async function visibleCamera(page: Page): Promise<CameraPose> {
  await expect(stage(page)).toHaveAttribute('data-camera-position', /^\[/);
  return stage(page).evaluate(element => ({
    position: JSON.parse(element.getAttribute('data-camera-position')!),
    target: JSON.parse(element.getAttribute('data-camera-target')!),
    zoom: Number(element.getAttribute('data-camera-zoom')),
  }));
}
async function expectVisibleCamera(page: Page, camera: CameraPose) {
  await expect.poll(async () => visibleCamera(page)).toEqual({ ...camera, zoom: camera.zoom ?? 1 });
}
async function gestureOrigin(page: Page) {
  await closeDisclosures(page);
  const canvas = page.getByRole('img', { name: '人体编舞动作预览', exact: true });
  await expect(canvas).toBeVisible();
  const box = (await canvas.boundingBox())!;
  // Empty upper-left stage space avoids body selection, transform handles,
  // Timeline keys and camera toolbar controls at both viewport widths.
  return { x: box.x + Math.min(90, box.width * .18), y: box.y + Math.min(100, box.height * .22) };
}
async function beginOrbit(page: Page, dx = 80, dy = 12) {
  const origin = await gestureOrigin(page);
  const before = await visibleCamera(page);
  await page.mouse.move(origin.x, origin.y);
  await page.mouse.down();
  await page.mouse.move(origin.x + dx, origin.y + dy, { steps: 8 });
  await expect.poll(async () => JSON.stringify(await visibleCamera(page))).not.toBe(JSON.stringify(before));
  return before;
}
async function authorOrbit(page: Page, time: number, dx = 80) {
  await atTime(page, time);
  await selectCamera(page);
  const before = await backup(page);
  const beforeView = await beginOrbit(page, dx);
  // A preview never creates a key. The release is the sole commit point.
  if (!current(before).cameraTrack?.keys.some(item => item.time === time)) await expect(key(page, time)).toHaveCount(0);
  const preview = await visibleCamera(page);
  await page.mouse.up();
  await expect(key(page, time)).toHaveCount(1);
  const after = await backup(page);
  const authored = current(after).cameraTrack!.keys.find(item => item.time === time)!;
  expect(authored.camera).toEqual(preview);
  await expectVisibleCamera(page, authored.camera);
  expect(after.scene.project.historyIndex).toBe(before.scene.project.historyIndex + 1);
  expect(after.scene.project.revision).toBe(before.scene.project.revision + 1);
  expect(current(after).operation?.time).toBe(time);
  expect(current(after).operation?.tracks).toEqual(['camera']);
  assertMotionUnchanged(after, before);
  return { before, after, beforeView, authored };
}
function assertMotionUnchanged(actual: Backup, original: Backup) {
  for (const field of ['take', 'manual', 'countMap', 'plan', 'audioOffsetSeconds'] as const) {
    deepStrictEqual(current(actual)[field], current(original)[field], `${field} must survive camera-only editing exactly`);
  }
}
async function undoRedo(page: Page, before: Backup, after: Backup, beforeCamera?: CameraPose, afterCamera?: CameraPose) {
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  deepStrictEqual(current(await backup(page)), current(before));
  if (beforeCamera) await expectVisibleCamera(page, beforeCamera);
  await page.getByRole('button', { name: '重做', exact: true }).click();
  deepStrictEqual(current(await backup(page)), current(after));
  if (afterCamera) await expectVisibleCamera(page, afterCamera);
}
async function inspectKey(page: Page, time: number) {
  await key(page, time).scrollIntoViewIfNeeded();
  await key(page, time).dblclick();
  const inspector = timeline(page).locator('details.kf-point-inspector');
  await expect(inspector).toHaveAttribute('open');
  await expect(inspector.getByRole('spinbutton', { name: '镜头位置X', exact: true })).toBeVisible();
  return inspector;
}
async function audioHash(page: Page) {
  return page.locator('audio').evaluate(async (audio: HTMLAudioElement) => {
    const bytes = await (await fetch(audio.src)).arrayBuffer();
    return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), byte => byte.toString(16).padStart(2, '0')).join('');
  });
}
async function bundle(page: Page) {
  const pending = page.waitForEvent('download');
  await clickRevealed(page, hiddenButton(page, '下载完整场景包'));
  const download = await pending, path = await download.path();
  expect(download.suggestedFilename()).toMatch(/\.choreo$/);
  expect(path).toBeTruthy();
  await closeDisclosures(page);
  return readFile(path!);
}
async function nativeImport(page: Page, bytes: Buffer) {
  await page.getByRole('button', { name: '场景', exact: true }).click();
  await page.getByRole('dialog', { name: '本机场景', exact: true }).getByRole('button', { name: '导入场景备份', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '导入场景备份', exact: true });
  await dialog.getByLabel('选择场景备份文件', { exact: true }).setInputFiles({ name: 'camera-original-music.choreo', mimeType: 'application/octet-stream', buffer: bytes });
  const confirm = dialog.getByRole('button', { name: '作为新场景导入', exact: true });
  await expect(confirm).toBeEnabled();
  await confirm.click();
  await twoFrames(page);
  const discard = page.getByRole('button', { name: '不保存，继续', exact: true });
  if (await discard.isVisible()) await discard.click();
  await expect(dialog).toHaveCount(0);
  await ready(page);
}

test('@camera explicit camera selection authors exact-time keys once; ordinary orbit and framing remain view-only', async ({ page }, info) => {
  test.setTimeout(120_000);
  const source = await openFixture(page), initial = await backup(page);
  await beginOrbit(page); await page.mouse.up();
  await page.getByRole('button', { name: '全身取景', exact: true }).click();
  await page.getByRole('button', { name: '背面', exact: true }).click();
  await page.getByRole('button', { name: '正面', exact: true }).click();
  deepStrictEqual((await backup(page)).scene.project, initial.scene.project);
  await atTime(page, .70391); await selectCamera(page);
  deepStrictEqual((await backup(page)).scene.project, initial.scene.project);
  const first = await authorOrbit(page, .70391);
  expect(current(first.after).cameraTrack!.baseCamera).toEqual(first.beforeView);
  expect(current(first.after).take).toEqual(source.take);
  expect(current(first.after).take!.times).not.toContain(.70391);
  await undoRedo(page, first.before, first.after, first.beforeView, first.authored.camera);
  const afterRedo = await backup(page);
  // Explicit framing still remains a viewer action while Camera is selected.
  await page.getByRole('button', { name: '全身取景', exact: true }).click();
  deepStrictEqual((await backup(page)).scene.project, afterRedo.scene.project);
  // Three contiguous wheel events are one user gesture, rather than three K.
  await atTime(page, 1.70391);
  const wheelBefore = await backup(page), origin = await gestureOrigin(page);
  await page.mouse.move(origin.x, origin.y);
  await page.getByRole('img', { name: '人体编舞动作预览', exact: true }).evaluate(element => {
    element.setAttribute('data-test-wheel-times', '[]');
    element.setAttribute('data-test-wheel-delivery-times', '[]');
    element.addEventListener('wheel', event => {
      const times = JSON.parse(element.getAttribute('data-test-wheel-times')!) as number[];
      times.push(event.timeStamp); element.setAttribute('data-test-wheel-times', JSON.stringify(times));
      const delivery = JSON.parse(element.getAttribute('data-test-wheel-delivery-times')!) as number[];
      delivery.push(performance.now()); element.setAttribute('data-test-wheel-delivery-times', JSON.stringify(delivery));
    }, { capture: true });
  });
  const wheelSession = await page.context().newCDPSession(page);
  // Native input sent as one burst avoids software-rendering acknowledgement
  // time accidentally splitting the intended 180ms user gesture.
  await Promise.all(Array.from({ length: 3 }, () => wheelSession.send('Input.dispatchMouseEvent', {
    type: 'mouseWheel', x: origin.x, y: origin.y, deltaX: 0, deltaY: -55,
  })));
  await wheelSession.detach();
  await expect(key(page, 1.70391)).toHaveCount(1);
  const wheelTimes = JSON.parse((await page.getByRole('img', { name: '人体编舞动作预览', exact: true }).getAttribute('data-test-wheel-times'))!) as number[];
  expect(wheelTimes.length).toBeGreaterThan(0);
  for (let i = 1; i < wheelTimes.length; i++) expect(wheelTimes[i] - wheelTimes[i - 1]).toBeLessThan(180);
  const deliveryTimes = JSON.parse((await page.getByRole('img', { name: '人体编舞动作预览', exact: true }).getAttribute('data-test-wheel-delivery-times'))!) as number[];
  await info.attach('native-wheel-event-times', { body: JSON.stringify({ timestamps: wheelTimes, intervals: wheelTimes.slice(1).map((time, i) => time - wheelTimes[i]), deliveryTimes, deliveryIntervals: deliveryTimes.slice(1).map((time, i) => time - deliveryTimes[i]) }), contentType: 'application/json' });
  const wheelAfter = await backup(page);
  expect(wheelAfter.scene.project.historyIndex).toBe(wheelBefore.scene.project.historyIndex + 1);
  expect(wheelAfter.scene.project.revision).toBe(wheelBefore.scene.project.revision + 1);
  expect(current(wheelAfter).cameraTrack!.keys).toHaveLength(2);
  expect(current(wheelAfter).cameraTrack!.keys[1].camera).toEqual(await visibleCamera(page));
  assertMotionUnchanged(wheelAfter, wheelBefore);
  const canvas = page.getByRole('img', { name: '人体编舞动作预览', exact: true });
  await canvas.focus();
  const settled = await visibleCamera(page), pendingSession = await page.context().newCDPSession(page);
  let latestWheel: CameraPose | undefined;
  let resolveDelete!: () => void;
  let deleteError: unknown;
  const deletionSent = new Promise<void>(resolve => { resolveDelete = resolve; });
  await page.exposeBinding('__cameraPendingDelete', async (_source, observed: { camera: CameraPose; historyLength: number; historyIndex: number; wheelAt: number; observedAt: number }) => {
    try {
      // Observe the real renderer and history together before native Delete.
      // A timer-completed wheel is an invalid stimulus for this guard branch.
      expect(observed.historyLength).toBe(wheelAfter.scene.project.history.length);
      expect(observed.historyIndex).toBe(wheelAfter.scene.project.historyIndex);
      expect(observed.camera).not.toEqual(settled);
      latestWheel = observed.camera;
      await info.attach('pending-wheel-before-native-delete', { body: JSON.stringify(observed), contentType: 'application/json' });
      await pendingSession.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Delete', code: 'Delete', windowsVirtualKeyCode: 46, nativeVirtualKeyCode: 46 });
      await pendingSession.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Delete', code: 'Delete', windowsVirtualKeyCode: 46, nativeVirtualKeyCode: 46 });
    } catch (error) { deleteError = error; }
    finally { resolveDelete(); }
  });
  await canvas.evaluate(element => {
    element.addEventListener('keydown', event => {
      if (event.key !== 'Delete') return;
      const history = Array.from(document.querySelectorAll('.operation-history-list > button'));
      element.setAttribute('data-test-pending-delete', JSON.stringify({ at: performance.now(), historyLength: history.length, historyIndex: history.findIndex(item => item.getAttribute('aria-current') === 'step') }));
    }, { capture: true, once: true });
    element.addEventListener('wheel', () => {
      const wheelAt = performance.now();
      // OrbitControls schedules its renderer before this bubble listener, so
      // the first RAF reads the changed tuple without extra protocol waits.
      requestAnimationFrame(() => {
        const rendered = element.closest('[data-camera-position]')!;
        const history = Array.from(document.querySelectorAll('.operation-history-list > button'));
        void (window as unknown as { __cameraPendingDelete(observed: unknown): Promise<void> }).__cameraPendingDelete({
          camera: { position: JSON.parse(rendered.getAttribute('data-camera-position')!), target: JSON.parse(rendered.getAttribute('data-camera-target')!), zoom: Number(rendered.getAttribute('data-camera-zoom')) },
          historyLength: history.length, historyIndex: history.findIndex(item => item.getAttribute('aria-current') === 'step'),
          wheelAt, observedAt: performance.now(),
        });
      });
    }, { once: true });
  });
  await pendingSession.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: origin.x, y: origin.y, deltaX: 0, deltaY: -45 });
  await deletionSent;
  if (deleteError) throw deleteError;
  expect(latestWheel).toBeDefined();
  const deleteCapture = JSON.parse((await canvas.getAttribute('data-test-pending-delete'))!);
  expect(deleteCapture.historyLength).toBe(wheelAfter.scene.project.history.length);
  expect(deleteCapture.historyIndex).toBe(wheelAfter.scene.project.historyIndex);
  await info.attach('pending-wheel-native-delete-capture', { body: JSON.stringify(deleteCapture), contentType: 'application/json' });
  await pendingSession.detach();
  await expect(key(page, 1.70391)).toHaveCount(0);
  const interrupted = await backup(page);
  expect(interrupted.scene.project.historyIndex).toBe(wheelAfter.scene.project.historyIndex + 2);
  expect(interrupted.scene.project.revision).toBe(wheelAfter.scene.project.revision + 2);
  const completedWheel = interrupted.scene.project.history[interrupted.scene.project.historyIndex - 1];
  expect(completedWheel.cameraTrack!.keys.find(item => item.time === 1.70391)!.camera).toEqual(latestWheel);
  expect(current(interrupted).cameraTrack!.keys).toEqual([first.authored]);
  assertMotionUnchanged(interrupted, wheelAfter);
  await expectVisibleCamera(page, first.authored.camera);
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  deepStrictEqual(current(await backup(page)), completedWheel);
  await expectVisibleCamera(page, latestWheel!);
  await page.getByRole('button', { name: '重做', exact: true }).click();
  deepStrictEqual(current(await backup(page)), current(interrupted));
  await expectVisibleCamera(page, first.authored.camera);
  await screenshot(page, info, 'camera-author-desktop.png');
});

test('@camera 390px touch authoring shares exact history semantics; no-op, Escape and touch cancel restore the camera', async ({ page }, info) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await openFixture(page);
  await atTime(page, .70391); await selectCamera(page);
  const initial = await backup(page), view = await visibleCamera(page), origin = await gestureOrigin(page);
  await page.mouse.click(origin.x, origin.y);
  deepStrictEqual((await backup(page)).scene.project, initial.scene.project);
  await beginOrbit(page, 45, 10);
  await page.keyboard.press('Escape'); await page.mouse.up();
  await expectVisibleCamera(page, view);
  deepStrictEqual((await backup(page)).scene.project, initial.scene.project);
  const session = await page.context().newCDPSession(page);
  const touch = (x: number, y: number) => ({ x, y, id: 21, radiusX: 3, radiusY: 3, force: 1 });
  await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [touch(origin.x, origin.y)] });
  await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [touch(origin.x + 45, origin.y + 8)] });
  await expect.poll(async () => JSON.stringify(await visibleCamera(page))).not.toBe(JSON.stringify(view));
  await expect(key(page, .70391)).toHaveCount(0);
  await session.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
  await expectVisibleCamera(page, view);
  deepStrictEqual((await backup(page)).scene.project, initial.scene.project);
  await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [touch(origin.x, origin.y)] });
  await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [touch(origin.x + 55, origin.y + 10)] });
  await expect.poll(async () => JSON.stringify(await visibleCamera(page))).not.toBe(JSON.stringify(view));
  const preview = await visibleCamera(page);
  await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect(key(page, .70391)).toHaveCount(1);
  const after = await backup(page);
  expect(after.scene.project.historyIndex).toBe(initial.scene.project.historyIndex + 1);
  expect(after.scene.project.revision).toBe(initial.scene.project.revision + 1);
  expect(current(after).cameraTrack!.keys[0]).toEqual({ time: .70391, camera: preview });
  assertMotionUnchanged(after, initial);
  await undoRedo(page, initial, after, view, preview);
  await session.detach();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await expect(cameraLane(page)).toBeInViewport();
  await screenshot(page, info, 'camera-author-mobile390.png');
});

test('@camera exact numeric edits, key drag, retime and deletion undo losslessly; seek and playback sample the curve', async ({ page }, info) => {
  test.setTimeout(180_000);
  await openFixture(page);
  const first = await authorOrbit(page, .70391), second = await authorOrbit(page, 2.50391, -110);
  const baseline = current(second.after).cameraTrack!.baseCamera;
  await atTime(page, 0); await expectVisibleCamera(page, baseline);
  await atTime(page, .70391); await expectVisibleCamera(page, first.authored.camera);
  await atTime(page, 2.50391); await expectVisibleCamera(page, second.authored.camera);
  await atTime(page, 1.60391);
  const middle = await visibleCamera(page);
  expect(middle).not.toEqual(first.authored.camera); expect(middle).not.toEqual(second.authored.camera);
  expect([...middle.position, ...middle.target, middle.zoom!].every(Number.isFinite)).toBe(true);
  expect(Math.hypot(...middle.position.map((value, axis) => value - middle.target[axis]))).toBeGreaterThanOrEqual(.01);
  const beforePlayback = await backup(page);
  await page.getByRole('button', { name: '播放', exact: true }).click();
  await expect.poll(async () => JSON.stringify(await visibleCamera(page))).not.toBe(JSON.stringify(middle));
  await page.getByRole('button', { name: '暂停', exact: true }).click();
  deepStrictEqual((await backup(page)).scene.project, beforePlayback.scene.project);
  await atTime(page, .70391);
  let inspector = await inspectKey(page, .70391);
  const x = inspector.getByRole('spinbutton', { name: '镜头位置X', exact: true }), changedX = first.authored.camera.position[0] + .123456789;
  await x.fill(String(changedX)); await x.press('Tab');
  const numeric = await backup(page);
  expect(numeric.scene.project.historyIndex).toBe(second.after.scene.project.historyIndex + 1);
  const numericCamera = current(numeric).cameraTrack!.keys[0].camera;
  expect(numericCamera).toEqual({ ...first.authored.camera, position: [changedX, ...first.authored.camera.position.slice(1)] });
  assertMotionUnchanged(numeric, second.after);
  await expectVisibleCamera(page, numericCamera);
  await timeline(page).getByRole('button', { name: '选择整体位移轨道', exact: true }).click();
  await expect(cameraLane(page)).not.toHaveClass(/selected/);
  await closeDisclosures(page);
  const directKey = key(page, .70391); await directKey.scrollIntoViewIfNeeded();
  const directBox = (await directKey.boundingBox())!;
  const directCenter = { x: directBox.x + directBox.width / 2, y: directBox.y + directBox.height / 2 };
  await page.mouse.move(directCenter.x, directCenter.y); await page.mouse.down();
  await page.mouse.move(directCenter.x + 29, directCenter.y, { steps: 7 }); await page.mouse.up();
  await expect(key(page, .70391)).toHaveCount(0); await expect(cameraLane(page)).toHaveClass(/selected/);
  const directMoved = await backup(page), directMovedKey = current(directMoved).cameraTrack!.keys.find(item => item.time !== 2.50391)!;
  expect(directMovedKey.camera).toEqual(numericCamera);
  expect(directMoved.scene.project.historyIndex).toBe(numeric.scene.project.historyIndex + 1);
  assertMotionUnchanged(directMoved, numeric);
  await undoRedo(page, numeric, directMoved);
  inspector = await inspectKey(page, directMovedKey.time);
  const keyTime = inspector.getByRole('spinbutton', { name: '镜头关键帧时间（秒）', exact: true });
  await keyTime.fill('1.23456789'); await keyTime.press('Tab');
  await expect(key(page, 1.23456789)).toHaveCount(1); await expect(key(page, .70391)).toHaveCount(0);
  const retimed = await backup(page);
  expect(retimed.scene.project.historyIndex).toBe(directMoved.scene.project.historyIndex + 1);
  expect(current(retimed).cameraTrack!.keys[0]).toEqual({ time: 1.23456789, camera: numericCamera });
  assertMotionUnchanged(retimed, directMoved);
  await undoRedo(page, directMoved, retimed);
  const beforeDragCancel = await backup(page);
  await closeDisclosures(page);
  const handle = key(page, 1.23456789); await handle.scrollIntoViewIfNeeded();
  const box = (await handle.boundingBox())!, center = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await page.mouse.move(center.x, center.y); await page.mouse.down();
  await page.mouse.move(center.x + 29, center.y, { steps: 7 });
  await page.keyboard.press('Escape'); await page.mouse.up();
  deepStrictEqual((await backup(page)).scene.project, beforeDragCancel.scene.project);
  await page.mouse.move(center.x, center.y); await page.mouse.down();
  await page.mouse.move(center.x + 29, center.y, { steps: 7 }); await page.mouse.up();
  await expect(key(page, 1.23456789)).toHaveCount(0);
  const dragged = await backup(page), moved = current(dragged).cameraTrack!.keys.find(item => item.time !== 2.50391)!;
  expect(moved.camera).toEqual(numericCamera);
  expect(moved.time).not.toBe(1.23456789);
  expect(moved.time * 30).not.toBe(Math.round(moved.time * 30));
  expect(dragged.scene.project.historyIndex).toBe(retimed.scene.project.historyIndex + 1);
  assertMotionUnchanged(dragged, retimed);
  await undoRedo(page, retimed, dragged);
  inspector = await inspectKey(page, moved.time);
  await inspector.getByRole('button', { name: '删除镜头关键帧', exact: true }).click();
  const deleted = await backup(page);
  expect(current(deleted).cameraTrack!.keys).toEqual([second.authored]);
  expect(deleted.scene.project.historyIndex).toBe(dragged.scene.project.historyIndex + 1);
  assertMotionUnchanged(deleted, dragged);
  await undoRedo(page, dragged, deleted);
  inspector = await inspectKey(page, 2.50391);
  const lastKeyView = await visibleCamera(page);
  await inspector.getByRole('button', { name: '删除镜头关键帧', exact: true }).click();
  const empty = await backup(page);
  expect(current(empty).cameraTrack).toBeUndefined();
  expect(empty.scene.project.historyIndex).toBe(deleted.scene.project.historyIndex + 1);
  assertMotionUnchanged(empty, deleted);
  await expectVisibleCamera(page, lastKeyView);
  const cancelUp = await stage(page).getAttribute('data-camera-up');
  const cancelView = await beginOrbit(page, 35);
  // Native keyboard activation reaches the history action while the camera
  // pointer remains held; another mouse click would release the old gesture.
  await page.getByLabel('操作记录', { exact: true }).press('Enter');
  await page.locator('.operation-history-list > button').first().press('Enter');
  await expectVisibleCamera(page, cancelView);
  await expect(stage(page)).toHaveAttribute('data-camera-up', cancelUp!);
  await page.mouse.up();
  await closeDisclosures(page, '.operation-history');
  const cancelledByHistory = await backup(page);
  deepStrictEqual(cancelledByHistory.scene.project.history, empty.scene.project.history);
  expect(cancelledByHistory.scene.project.historyIndex).toBe(0);
  expect(cancelledByHistory.scene.project.revision).toBe(empty.scene.project.revision + 1);
  expect(current(cancelledByHistory).cameraTrack).toBeUndefined();
  const returnToEmpty = page.locator('.operation-history-list > button').nth(empty.scene.project.historyIndex);
  await reveal(page, returnToEmpty); await returnToEmpty.press('Enter');
  await closeDisclosures(page, '.operation-history');
  deepStrictEqual(current(await backup(page)), current(empty));
  await expectVisibleCamera(page, lastKeyView);
  await beginOrbit(page, 35); await page.mouse.up();
  // Camera remains selected: a later real gesture can create a fresh track.
  const fresh = await backup(page);
  expect(current(fresh).cameraTrack!.baseCamera).toEqual(lastKeyView);
  expect(current(fresh).cameraTrack!.keys).toHaveLength(1);
  await undoRedo(page, empty, fresh, lastKeyView, current(fresh).cameraTrack!.keys[0].camera);
  await inspectKey(page, current(fresh).cameraTrack!.keys[0].time);
  await screenshot(page, info, 'camera-key-inspector-desktop.png');
});

test('@camera save/reopen and full native scene backup preserve exact camera history, source motion and original audio', async ({ page }, info) => {
  test.setTimeout(180_000);
  let source: { take: BakedTake; wave: Buffer };
  // Local acceptance can use the user's original file without publishing it.
  // CI retains the same interactions with a portable nonuniform source/WAV.
  if (process.env.CHOREO_CAMERA_FIXTURE) {
    const bytes = await readFile(process.env.CHOREO_CAMERA_FIXTURE), magic = Buffer.from('CHOREO-BUNDLE-1\n');
    deepStrictEqual(bytes.subarray(0, magic.length), magic);
    const headerLength = bytes.readUInt32LE(magic.length);
    await page.goto('/'); await ready(page); await nativeImport(page, bytes);
    source = { take: current(await backup(page)).take!, wave: bytes.subarray(magic.length + 4 + headerLength) };
    await info.attach('private-source-summary', { body: JSON.stringify({ bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), samples: source.take.times.length, audioBytes: source.wave.length }), contentType: 'application/json' });
  } else source = await openFixture(page);
  await authorOrbit(page, .70391); await authorOrbit(page, 2.50391, -110);
  await atTime(page, .70391);
  await save(page);
  const saved = await backup(page), expectedAudioHash = createHash('sha256').update(source.wave).digest('hex');
  await page.reload(); await ready(page);
  const reopened = await backup(page);
  deepStrictEqual(reopened.scene.project, saved.scene.project);
  expect(reopened.scene.viewer.time).toBe(.70391);
  expect(await audioHash(page)).toBe(expectedAudioHash);
  const bytes = await bundle(page), magic = Buffer.from('CHOREO-BUNDLE-1\n');
  deepStrictEqual(bytes.subarray(0, magic.length), magic);
  const headerLength = bytes.readUInt32LE(magic.length);
  const header = JSON.parse(bytes.subarray(magic.length + 4, magic.length + 4 + headerLength).toString('utf8'));
  deepStrictEqual(bytes.subarray(magic.length + 4 + headerLength), source.wave);
  deepStrictEqual(unpackScene(header.scene).project, saved.scene.project);
  await nativeImport(page, bytes);
  const imported = await backup(page);
  expect(imported.scene.id).not.toBe(saved.scene.id);
  deepStrictEqual(imported.scene.project, { ...saved.scene.project, teacherCheckedRevision: null });
  expect(current(imported).take).toEqual(source.take);
  expect(await audioHash(page)).toBe(expectedAudioHash);
  await page.reload(); await ready(page);
  deepStrictEqual((await backup(page)).scene.project, imported.scene.project);
  expect(await audioHash(page)).toBe(expectedAudioHash);
  await atTime(page, .70391);
  await expectVisibleCamera(page, current(imported).cameraTrack!.keys[0].camera);
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  deepStrictEqual(current(await backup(page)), imported.scene.project.history[imported.scene.project.historyIndex - 1]);
  await page.getByRole('button', { name: '重做', exact: true }).click();
  deepStrictEqual(current(await backup(page)), current(imported));
  await screenshot(page, info, 'camera-restored-original-music.png');
});
