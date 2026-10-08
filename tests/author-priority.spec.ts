import { expect, test, type Page } from '@playwright/test';
import { Quaternion, Vector3 } from 'three';
import { EDITABLE_JOINT_NAMES, evaluatePose, frameTime, isJointRotationWithinLimits, rotationFromDegrees, type Pose, type Quat } from '../packages/core/src';
import { clickRevealed, reveal } from './helpers';
import { backup, current, diagnostics, draft, frame, hiddenButton, numeric, openFixture, openRealism, ready, save, screenshot, select } from './realismHelpers';

const reports = new WeakMap<Page, ReturnType<typeof diagnostics>>();
test.beforeEach(async ({ page }) => {
  reports.set(page, diagnostics(page));
  await page.route('**/api/**', route => route.abort('blockedbyclient'));
});
test.afterEach(async ({ page }, info) => {
  const report = reports.get(page)!;
  await info.attach('browser-console-and-api', { body: JSON.stringify(report), contentType: 'application/json' });
  expect(report.errors).toEqual([]); expect(report.warnings).toEqual([]);
  expect(report.expectedHttpErrors).toEqual([]); expect(report.apiRequests).toEqual([]);
});

async function number(page: Page, label: string, expected: number) {
  await expect.poll(async () => Number(await page.getByRole('spinbutton', { name: label, exact: true }).inputValue())).toBe(expected);
}
async function fullKey(page: Page) {
  await page.getByRole('button', { name: 'K 完整姿态', exact: true }).click();
  await expect(draft(page)).toHaveCount(0);
}
async function trackKey(page: Page, kind: 'joint' | 'root') {
  await clickRevealed(page, hiddenButton(page, kind === 'joint' ? 'K 当前关节' : 'K 位移'));
}
function sameRotation(actual: Quat, expected: Quat) {
  expect(Math.abs(new Quaternion(...actual).dot(new Quaternion(...expected)))).toBeCloseTo(1, 12);
}
function sampleAt(snapshot: ReturnType<typeof current>, keyFrame: number): Pose {
  const take = snapshot.take!;
  const time = frameTime(keyFrame, take.durationSeconds);
  const index = take.times.indexOf(time);
  expect(index, 'The materialized take must contain the exact authored frame time').toBeGreaterThanOrEqual(0);
  return take.poses[index];
}
function fullPoseAtKey(snapshot: ReturnType<typeof current>, keyFrame: number) {
  const pose = sampleAt(snapshot, keyFrame), sequence = snapshot.manual!;
  expect(pose.root).toEqual(sequence.root.find(key => key.frame === keyFrame)!.position);
  for (const joint of EDITABLE_JOINT_NAMES) {
    expect(pose.joints[joint]).toEqual(sequence.rotations[joint]!.find(key => key.frame === keyFrame)!.rotation);
  }
  return pose;
}
async function leftFootLock(page: Page, endFrame = 120) {
  await select(page, 'LeftFoot'); await openRealism(page);
  const action = hiddenButton(page, '锁定支撑脚');
  await reveal(page, action); await numeric(page, '脚锁结束帧', endFrame); await action.click();
  const snapshot = current(await backup(page));
  expect(snapshot.manual!.footLocks).toHaveLength(1);
  return snapshot.manual!.footLocks![0];
}

test('@author-priority an inserted middle pose wins over foot locks and remains exact after later rebaking and saving', async ({ page }, info) => {
  const source = await openFixture(page);
  await fullKey(page);
  await frame(page, 120); await numeric(page, 'Root X 位移（米）', .15); await fullKey(page);
  const endpoints = current(await backup(page));
  const endpointPoses = [fullPoseAtKey(endpoints, 0), fullPoseAtKey(endpoints, 120)];
  await frame(page, 0); const lock = await leftFootLock(page);
  const locked = current(await backup(page));
  expect(locked.manual!.footLocks).toEqual([lock]);
  expect(locked.take!.times).toContain(2);

  // This exact teacher pose deliberately conflicts with the standing foot.
  // Numbers specify intent; the support solver may report a residual only.
  await frame(page, 60); await select(page, 'LeftLowerLeg');
  await numeric(page, '关节 X 旋转（度）', -100);
  await numeric(page, '关节 Y 旋转（度）', 0); await numeric(page, '关节 Z 旋转（度）', 0);
  await numeric(page, 'Root X 位移（米）', .45);
  await numeric(page, 'Root Y 位移（米）', 1.8);
  await number(page, '关节 X 旋转（度）', -100);
  await number(page, 'Root Y 位移（米）', 1.8);
  await expect(page.getByRole('status').filter({ hasText: '超出标准人体建议' })).toBeVisible();
  await expect(draft(page)).toBeVisible();
  await fullKey(page);
  const authored = current(await backup(page)), middle = fullPoseAtKey(authored, 60);
  expect(middle.root).toEqual([.45, 1.8, 0]);
  sameRotation(middle.joints.LeftLowerLeg, rotationFromDegrees([-100, 0, 0]));
  expect(isJointRotationWithinLimits('LeftLowerLeg', middle.joints.LeftLowerLeg)).toBe(false);
  expect(authored.manual!.baseTake).toEqual(source.take);
  expect(authored.manual!.footLocks).toEqual([lock]);
  expect([fullPoseAtKey(authored, 0), fullPoseAtKey(authored, 120)]).toEqual(endpointPoses);
  const residual = new Vector3(...evaluatePose(middle).LeftFoot.position).distanceTo(new Vector3(...lock.target));
  expect(residual).toBeGreaterThan(.1);
  await expect(page.getByLabel('脚锁残差 左脚', { exact: true })).toContainText('目标尚未到达');

  // A later single-track edit forces a fresh bake of every contact sample.
  await frame(page, 90); await select(page, 'LeftUpperArm');
  await numeric(page, '关节 Z 旋转（度）', 40); await trackKey(page, 'joint');
  await expect(draft(page)).toHaveCount(0);
  const rebaked = await backup(page), final = current(rebaked);
  expect(fullPoseAtKey(final, 60)).toEqual(middle);
  expect([fullPoseAtKey(final, 0), fullPoseAtKey(final, 120)]).toEqual(endpointPoses);
  expect(final.manual!.footLocks).toEqual([lock]);
  source.take.times.forEach(time => expect(final.take!.times).toContain(time));
  expect(final.take!.times.at(-1)).toBe(16);
  await save(page); await page.reload(); await ready(page);
  expect((await backup(page)).scene.project).toEqual(rebaked.scene.project);
  await frame(page, 60); await select(page, 'LeftLowerLeg');
  await number(page, '关节 X 旋转（度）', -100); await number(page, 'Root Y 位移（米）', 1.8);
  await openRealism(page);
  await expect(page.getByLabel('脚锁残差 左脚', { exact: true })).toContainText('目标尚未到达');
  await screenshot(page, info, 'author-priority-contact-1440.png');
});

test('@author-priority single-track K retains only the remaining teacher edits without losing their raw pose to contact corrections', async ({ page }) => {
  const source = await openFixture(page); const lock = await leftFootLock(page);
  await frame(page, 60); await select(page, 'LeftLowerLeg');
  await numeric(page, '关节 X 旋转（度）', -100);
  await numeric(page, '关节 Y 旋转（度）', 0); await numeric(page, '关节 Z 旋转（度）', 0);
  await numeric(page, 'Root Y 位移（米）', 1.8);
  await select(page, 'LeftUpperArm'); await numeric(page, '关节 Z 旋转（度）', 60);
  await select(page, 'LeftLowerLeg'); await trackKey(page, 'joint');
  await expect(draft(page)).toBeVisible();
  await number(page, '关节 X 旋转（度）', -100); await number(page, 'Root Y 位移（米）', 1.8);
  const legOnly = current(await backup(page));
  expect(Object.keys(legOnly.manual!.rotations)).toEqual(['LeftLowerLeg']);
  expect(legOnly.manual!.root).toEqual([]);
  sameRotation(legOnly.manual!.rotations.LeftLowerLeg![0].rotation, rotationFromDegrees([-100, 0, 0]));
  await select(page, 'LeftUpperArm'); await number(page, '关节 Z 旋转（度）', 60);
  await trackKey(page, 'root'); await expect(draft(page)).toBeVisible();
  await number(page, '关节 Z 旋转（度）', 60);
  const legAndRoot = current(await backup(page));
  expect(Object.keys(legAndRoot.manual!.rotations)).toEqual(['LeftLowerLeg']);
  expect(legAndRoot.manual!.root).toEqual([{ frame: 60, position: [0, 1.8, 0] }]);
  await trackKey(page, 'joint'); await expect(draft(page)).toHaveCount(0);
  const complete = await backup(page), snapshot = current(complete), pose = sampleAt(snapshot, 60);
  expect(Object.keys(snapshot.manual!.rotations).sort()).toEqual(['LeftLowerLeg', 'LeftUpperArm']);
  expect(snapshot.manual!.baseTake).toEqual(source.take); expect(snapshot.manual!.footLocks).toEqual([lock]);
  expect(pose.root).toEqual([0, 1.8, 0]);
  sameRotation(pose.joints.LeftLowerLeg, rotationFromDegrees([-100, 0, 0]));
  sameRotation(pose.joints.LeftUpperArm, rotationFromDegrees([0, 0, 60]));
  await save(page); await page.reload(); await ready(page);
  expect((await backup(page)).scene.project).toEqual(complete.scene.project);
  await expect(draft(page)).toHaveCount(0);
});

test('@author-priority direct angle authoring has canonical bounds, preserves an unusual K and stays clear on mobile', async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 1000 });
  const source = await openFixture(page); await frame(page, 75); await select(page, 'LeftForeArm');
  const input = page.getByRole('spinbutton', { name: '关节 X 旋转（度）', exact: true });
  await expect(input).toHaveAttribute('min', '-180'); await expect(input).toHaveAttribute('max', '180');
  await expect(page.getByRole('slider', { name: '关节 X 滑条', exact: true })).toHaveAttribute('min', '-145');
  await expect(page.getByRole('slider', { name: '关节 X 滑条', exact: true })).toHaveAttribute('max', '0');
  await expect(page.getByRole('spinbutton', { name: 'Root X 位移（米）', exact: true })).toHaveAttribute('max', '5');
  await expect(page.getByRole('spinbutton', { name: 'Root Y 位移（米）', exact: true })).toHaveAttribute('min', '0');
  await expect(page.getByRole('spinbutton', { name: 'Root Y 位移（米）', exact: true })).toHaveAttribute('max', '3');
  await numeric(page, '关节 X 旋转（度）', 70); await number(page, '关节 X 旋转（度）', 70);
  await fullKey(page);
  const authored = await backup(page), pose = fullPoseAtKey(current(authored), 75);
  sameRotation(pose.joints.LeftForeArm, rotationFromDegrees([70, 0, 0]));
  expect(isJointRotationWithinLimits('LeftForeArm', pose.joints.LeftForeArm)).toBe(false);
  expect(current(authored).manual!.baseTake).toEqual(source.take);

  await numeric(page, '关节 X 旋转（度）', 999); await number(page, '关节 X 旋转（度）', 180);
  expect((await backup(page)).scene.project).toEqual(authored.scene.project);
  await page.getByRole('button', { name: '撤回草稿', exact: true }).click();
  await number(page, '关节 X 旋转（度）', 70); await expect(draft(page)).toHaveCount(0);
  await input.fill(''); await input.press('Tab');
  await number(page, '关节 X 旋转（度）', 70); await expect(draft(page)).toHaveCount(0);
  await save(page); await page.reload(); await ready(page);
  expect((await backup(page)).scene.project).toEqual(authored.scene.project);
  await expect(page.getByRole('status').filter({ hasText: '超出标准人体建议' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await screenshot(page, info, 'author-priority-numeric-390.png');
});

test('@author-priority small angle and Root edits retain stored precision through partial K and saving', async ({ page }) => {
  const source = await openFixture(page, true), original = await backup(page);
  await frame(page, 60); await select(page, 'LeftUpperArm');
  // Both changes are below display rounding and the former dot/distance
  // thresholds. They must still become explicit author intent.
  await numeric(page, '关节 Z 旋转（度）', .04);
  await expect(page.getByRole('spinbutton', { name: '关节 Z 旋转（度）', exact: true })).toHaveValue('0.04');
  await expect(draft(page)).toBeVisible();
  await numeric(page, 'Root Y 位移（米）', 1.8000004);
  await expect(page.getByRole('spinbutton', { name: 'Root Y 位移（米）', exact: true })).toHaveValue('1.8000004');
  expect((await backup(page)).scene.project).toEqual(original.scene.project);
  await trackKey(page, 'root');
  await expect(draft(page)).toBeVisible();
  await expect(page.getByRole('spinbutton', { name: '关节 Z 旋转（度）', exact: true })).toHaveValue('0.04');
  const rootOnly = current(await backup(page));
  expect(rootOnly.manual!.root).toEqual([{ frame: 60, position: [0, 1.8000004, 0] }]);
  expect(rootOnly.manual!.rotations).toEqual({});
  expect(sampleAt(rootOnly, 60).joints.LeftUpperArm).toEqual([0, 0, 0, 1]);

  await trackKey(page, 'joint'); await expect(draft(page)).toHaveCount(0);
  const authored = await backup(page), snapshot = current(authored), pose = sampleAt(snapshot, 60);
  expect(snapshot.manual!.baseTake).toEqual(source.take);
  expect(Object.keys(snapshot.manual!.rotations)).toEqual(['LeftUpperArm']);
  const key = snapshot.manual!.rotations.LeftUpperArm![0];
  expect(key.frame).toBe(60);
  rotationFromDegrees([0, 0, .04]).forEach((component, axis) => expect(key.rotation[axis]).toBeCloseTo(component, 14));
  expect(key.rotation[2]).toBeGreaterThan(.0003);
  expect(pose.joints.LeftUpperArm).toEqual(key.rotation);
  expect(pose.root).toEqual([0, 1.8000004, 0]);
  expect(snapshot.manual!.root[0].position[1] - source.take.poses[0].root[1]).toBeCloseTo(.0000004, 14);
  await save(page); await page.reload(); await ready(page);
  expect((await backup(page)).scene.project).toEqual(authored.scene.project);
  await expect(page.getByRole('spinbutton', { name: '关节 Z 旋转（度）', exact: true })).toHaveValue('0.04');
  await expect(page.getByRole('spinbutton', { name: 'Root Y 位移（米）', exact: true })).toHaveValue('1.8000004');
  await expect(draft(page)).toHaveCount(0);
});
