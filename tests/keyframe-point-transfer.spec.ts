import { createHash } from 'node:crypto';
import { deepStrictEqual } from 'node:assert/strict';
import { expect, test, type Page } from '@playwright/test';
import {
  JOINT_NAMES, bakeKeyframeSequence, makeKeyframeSequence, rotationFromDegrees,
  rotationToDegrees, sampleTake, upsertRotationKeyframe,
  type BakedTake, type JointName, type MotionPointTrack,
} from '../packages/core/src';
import type { SceneSnapshot } from '../apps/web/src/sceneProject';
import { closeDisclosures, seekSeconds } from './helpers';
import { backup, current, diagnostics, openFixture, ready, save, screenshot, type Backup } from './realismHelpers';
import { editStageValue, selectStageJoint } from './stageInteractions';

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
const lane = (page: Page, id: string) => timeline(page).locator(`.kf-lane[data-track-id="${id}"]`);
const authored = (page: Page, id: string, time: number) => lane(page, id).locator(`.kf-lane-key[data-time="${time}"]`);
const inspector = (page: Page) => timeline(page).locator('details.kf-point-inspector');
const conflict = (page: Page) => page.getByRole('dialog', { name: '目标帧已有关键帧', exact: true });
const labels: Partial<Record<JointName | 'root', string>> = { Head: '头部', LeftForeArm: '左肘', LeftHandTip: '左指尖', root: '整体位移' };
const groups: Partial<Record<JointName, string>> = { Head: 'body', LeftForeArm: 'left-arm', LeftHandTip: 'left-arm' };

async function portable(page: Page, sparse?: JointName) {
  return openFixture(page, false, source => {
    source.take.times = [0, .70391, .70612, 1, 2, 3, 4, 8, 12, 16];
    source.take.poses = source.take.times.map(time => ({
      root: [time / 80, 1.05 + time / 500, time ? -time / 150 : 0],
      joints: Object.fromEntries(JOINT_NAMES.map((joint, index) => [joint, rotationFromDegrees([
        joint === 'LeftForeArm' ? 0 : time * index / 400,
        joint === 'Head' || joint === 'LeftForeArm' || joint === 'LeftHandTip' ? 0 : time * index / 300,
        joint === 'LeftUpperArm' ? 20 : joint === 'RightUpperArm' ? -20 : 0,
      ])])) as BakedTake['poses'][number]['joints'],
    }));
    if (sparse) {
      const snapshot = source.scene.project.history[0] as SceneSnapshot;
      const sequence = upsertRotationKeyframe(makeKeyframeSequence(source.take), sparse, 30, rotationFromDegrees(sparse === 'Head' ? [0, 20, 0] : [-20, 0, 0]));
      snapshot.manual = sequence; snapshot.take = bakeKeyframeSequence(sequence); source.take = snapshot.take;
    }
  });
}

async function choose(page: Page, point: JointName | 'root', time: number) {
  await closeDisclosures(page);
  await seekSeconds(page, time);
  if (point !== 'root') {
    const toggle = lane(page, groups[point]!).locator('.kf-group-toggle');
    if (await toggle.getAttribute('aria-expanded') !== 'true') await toggle.click();
  }
  await lane(page, point).getByRole('button', { name: `选择${labels[point]}轨道`, exact: true }).click();
  await expect(page.getByRole('img', { name: '人体编舞动作预览' })).toHaveAttribute('data-motion-presentation', 'author');
}

async function inspect(page: Page, point: JointName | 'root', time: number) {
  await choose(page, point, time);
  await expect(lane(page, point).locator(`[data-selected-point="true"][data-time="${time}"][data-point="${point}"]`)).toHaveCount(1);
  const summary = inspector(page).locator(':scope > summary');
  await expect(summary.getByText(labels[point]!, { exact: true })).toBeVisible();
  await expect(summary.locator('code')).toHaveAttribute('data-time', String(time));
  // Nearby exact author instants share a mobile hit region at fit zoom. The
  // native inspector summary opens the selected channel/time without asking
  // the user to hit the lower of two overlapping diamonds.
  if (!(await inspector(page).evaluate((element: HTMLDetailsElement) => element.open))) await summary.click();
  await expect(inspector(page)).toHaveAttribute('open');
}

async function pointValue(page: Page, point: JointName | 'root', time: number, axis: 'X' | 'Y', value: number) {
  await inspect(page, point, time);
  const field = page.getByRole('spinbutton', { name: `${labels[point]}${point === 'root' ? '位置' : '四元数'}${axis}`, exact: true });
  await field.fill(String(value)); await field.press('Tab');
  await closeDisclosures(page);
}

async function contextTransfer(page: Page, point: JointName | 'root', source: number, target: number, operation: 'move' | 'copy') {
  await inspect(page, point, source);
  await page.getByRole('spinbutton', { name: '关键帧目标时间（秒）', exact: true }).fill(String(target));
  await page.getByRole('button', { name: operation === 'move' ? '移动选中关键帧' : '复制选中关键帧', exact: true }).click();
}

async function drag(page: Page, id: string, source: number, target: number, copy = false) {
  await closeDisclosures(page);
  const key = authored(page, id, source);
  await expect(key, 'A coincident old K and latest point must be one draggable diamond').toHaveCount(1);
  await key.scrollIntoViewIfNeeded();
  const box = (await key.boundingBox())!, width = await lane(page, id).locator('.kf-lane-track').evaluate((element: HTMLElement) => element.getBoundingClientRect().width);
  const x = box.x + box.width / 2, y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  if (copy) await page.keyboard.down('Alt');
  await page.mouse.down();
  await page.mouse.move(x + (target - source) / 16 * width, y, { steps: 5 });
  // Copy is captured when the gesture begins, not sampled from release state.
  if (copy) await page.keyboard.up('Alt');
  await page.mouse.up();
}

function otherChannels(actual: BakedTake, before: BakedTake, changed: MotionPointTrack[]) {
  for (let index = 0; index < before.times.length; index++) {
    const time = before.times[index], afterIndex = actual.times.indexOf(time);
    expect(afterIndex, `Retain the source time ${time}`).toBeGreaterThanOrEqual(0);
    const previous = before.poses[index], next = actual.poses[afterIndex];
    if (!changed.includes('root')) deepStrictEqual(next.root, previous.root, `Root at ${time}`);
    for (const joint of JOINT_NAMES) if (!changed.includes(joint)) deepStrictEqual(next.joints[joint], previous.joints[joint], `${joint} at ${time}`);
  }
}

function oneOperation(before: Backup, after: Backup, time: number, tracks: MotionPointTrack[]) {
  expect(after.scene.project.revision).toBe(before.scene.project.revision + 1);
  expect(after.scene.project.history).toHaveLength(before.scene.project.history.length + 1);
  expect(current(after).operation?.time).toBe(time);
  expect(current(after).operation?.tracks).toEqual(tracks);
  deepStrictEqual(current(after).manual!.baseTake, current(before).manual!.baseTake);
  deepStrictEqual(current(after).countMap, current(before).countMap);
  deepStrictEqual(current(after).plan, current(before).plan);
  otherChannels(current(after).take!, current(before).take!, tracks);
}

async function audioHash(page: Page) {
  return page.locator('audio').evaluate(async (audio: HTMLAudioElement) => {
    const bytes = await (await fetch(audio.src)).arrayBuffer();
    return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), value => value.toString(16).padStart(2, '0')).join('');
  });
}

test('@point-transfer moves coincident old Head K and latest author point together, then Alt-copies the effective value', async ({ page }, info) => {
  test.setTimeout(150_000);
  await portable(page, 'Head');
  await seekSeconds(page, 1); await selectStageJoint(page, 'Head');
  await editStageValue(page, '关节 Y 旋转（度）', 24);
  const before = await backup(page), manual = current(before).manual!;
  const latest = manual.pointEdits!.find(edit => edit.time === 1)!.joints!.Head!;
  expect(rotationToDegrees(latest)[1]).toBeCloseTo(24, 1);
  expect(rotationToDegrees(manual.rotations.Head![0].rotation)[1]).toBeCloseTo(20, 10);
  await choose(page, 'Head', 1); await drag(page, 'Head', 1, 2);
  const moved = await backup(page), movedManual = current(moved).manual!;
  oneOperation(before, moved, 2, ['Head']);
  expect(movedManual.rotations.Head!.map(key => key.frame)).toEqual([60]);
  expect(movedManual.pointEdits!.map(edit => edit.time)).toEqual([2]);
  expect(movedManual.pointEdits![0].joints!.Head).toEqual(latest);
  expect(sampleTake(current(moved).take!, 2).joints.Head).toEqual(latest);
  expect(sampleTake(current(moved).take!, 1).joints.Head).not.toEqual(latest);
  await expect(authored(page, 'Head', 1)).toHaveCount(0);
  await expect(authored(page, 'Head', 2)).toHaveCount(1);
  await drag(page, 'Head', 2, 3, true);
  const copied = await backup(page), copiedManual = current(copied).manual!;
  oneOperation(moved, copied, 3, ['Head']);
  expect(copiedManual.rotations.Head!.map(key => key.frame)).toEqual([60, 90]);
  expect(copiedManual.pointEdits!.map(edit => edit.time)).toEqual([2, 3]);
  for (const time of [2, 3]) expect(sampleTake(current(copied).take!, time).joints.Head).toEqual(latest);
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  deepStrictEqual(current(await backup(page)), current(moved));
  await page.getByRole('button', { name: '重做', exact: true }).click();
  deepStrictEqual(current(await backup(page)), current(copied));
  await screenshot(page, info, 'point-transfer-desktop.png');
});

test('@point-transfer 390px exact terminal copy and move resolve only the occupied channel and survive save with original audio', async ({ page }, info) => {
  test.setTimeout(150_000);
  await page.setViewportSize({ width: 390, height: 844 });
  const source = await portable(page), from = .70391, to = .70612;
  expect(Math.round(from * 30)).toBe(Math.round(to * 30));
  await pointValue(page, 'LeftHandTip', from, 'X', .02);
  await pointValue(page, 'LeftHandTip', to, 'X', -.03);
  await pointValue(page, 'root', to, 'X', .18);
  const before = await backup(page), manual = current(before).manual!;
  const sourceValue = manual.pointEdits!.find(edit => edit.time === from)!.joints!.LeftHandTip!;
  const targetRoot = manual.pointEdits!.find(edit => edit.time === to)!.root!;
  await contextTransfer(page, 'LeftHandTip', from, to, 'copy');
  await expect(conflict(page)).toBeVisible();
  await conflict(page).getByRole('button', { name: '取消', exact: true }).click();
  deepStrictEqual((await backup(page)).scene.project, before.scene.project);
  await contextTransfer(page, 'LeftHandTip', from, to, 'copy');
  await conflict(page).getByRole('button', { name: '替换并继续', exact: true }).click();
  const copied = await backup(page), copiedManual = current(copied).manual!;
  oneOperation(before, copied, to, ['LeftHandTip']);
  expect(copied.scene.viewer.time).toBe(to);
  for (const time of [from, to]) expect(copiedManual.pointEdits!.find(edit => edit.time === time)!.joints!.LeftHandTip).toEqual(sourceValue);
  expect(copiedManual.pointEdits!.find(edit => edit.time === to)!.root).toEqual(targetRoot);
  await contextTransfer(page, 'LeftHandTip', from, to, 'move');
  await conflict(page).getByRole('button', { name: '替换并继续', exact: true }).click();
  const moved = await backup(page), movedManual = current(moved).manual!;
  oneOperation(copied, moved, to, ['LeftHandTip']);
  expect(movedManual.pointEdits!.find(edit => edit.time === from)?.joints?.LeftHandTip).toBeUndefined();
  expect(movedManual.pointEdits!.find(edit => edit.time === to)!.root).toEqual(targetRoot);
  expect(sampleTake(current(moved).take!, from).joints.LeftHandTip).toEqual(sampleTake(source.take, from).joints.LeftHandTip);
  expect(sampleTake(current(moved).take!, to).joints.LeftHandTip).toEqual(sourceValue);
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  deepStrictEqual(current(await backup(page)), current(copied));
  await page.getByRole('button', { name: '重做', exact: true }).click();
  deepStrictEqual(current(await backup(page)), current(moved));
  await save(page); const saved = await backup(page);
  await page.reload(); await ready(page);
  deepStrictEqual((await backup(page)).scene.project, saved.scene.project);
  expect(await audioHash(page)).toBe(createHash('sha256').update(source.wave).digest('hex'));
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await screenshot(page, info, 'point-transfer-mobile.png');
});

test('@point-transfer group Alt-copy includes a terminal point and a sparse joint in one operation; source samples stay unwritable', async ({ page }, info) => {
  test.setTimeout(150_000);
  await portable(page, 'LeftForeArm');
  await pointValue(page, 'LeftHandTip', 1, 'X', .02);
  const before = await backup(page), manual = current(before).manual!;
  await drag(page, 'left-arm', 1, 2, true);
  const after = await backup(page), next = current(after).manual!;
  oneOperation(before, after, 2, ['LeftForeArm', 'LeftHandTip']);
  expect(next.rotations.LeftForeArm!.map(key => key.frame)).toEqual([30, 60]);
  expect(next.rotations.LeftForeArm![1].rotation).toEqual(manual.rotations.LeftForeArm![0].rotation);
  expect(next.pointEdits!.find(edit => edit.time === 1)!.joints!.LeftHandTip).toEqual(manual.pointEdits![0].joints!.LeftHandTip);
  expect(next.pointEdits!.find(edit => edit.time === 2)!.joints!.LeftHandTip).toEqual(manual.pointEdits![0].joints!.LeftHandTip);
  expect(next.root).toEqual(manual.root);
  await inspect(page, 'Head', .70391);
  await expect(page.getByRole('spinbutton', { name: '关键帧目标时间（秒）', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '移动选中关键帧', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '复制选中关键帧', exact: true })).toHaveCount(0);
  deepStrictEqual((await backup(page)).scene.project, after.scene.project);
  await closeDisclosures(page);
  await screenshot(page, info, 'point-transfer-group.png');
});
