import { expect, test, type Page } from '@playwright/test';
import { Quaternion, Vector3 } from 'three';
import { EDITABLE_JOINT_NAMES, evaluatePose, frameTime, isJointRotationWithinLimits, rotationFromDegrees, sampleTake, type Pose, type Quat } from '../packages/core/src';
import { clickRevealed, reveal } from './helpers';
import { backup, current, diagnostics, draft, frame, hiddenButton, numeric, openFixture, openRealism, ready, save, screenshot } from './realismHelpers';
import { editStageValue, expectStageValue, selectStageJoint as select } from './stageInteractions';

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
  await expectStageValue(page, label, expected);
}
async function copyPose(page: Page) { await clickRevealed(page, hiddenButton(page, '复制当前姿态')); }
async function pastePose(page: Page, includeRoot = true) {
  await clickRevealed(page, hiddenButton(page, includeRoot ? '粘贴姿态与位置' : '粘贴关节姿态'));
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
  const source = await openFixture(page, false, source => {
    source.take.poses[2].root = [.45, 1.8, 0];
    source.take.poses[2].joints.LeftLowerLeg = rotationFromDegrees([-100, 0, 0]);
  });
  await frame(page, 75); await select(page, 'LeftLowerLeg'); await copyPose(page);
  await frame(page, 0);
  await fullKey(page);
  await frame(page, 120); await editStageValue(page, 'Root X 位移（米）', .15);
  await expectStageValue(page, 'Root X 位移（米）', .15, .000005); await fullKey(page);
  const endpoints = current(await backup(page));
  const endpointPoses = [fullPoseAtKey(endpoints, 0), fullPoseAtKey(endpoints, 120)];
  await frame(page, 0); const lock = await leftFootLock(page);
  const locked = current(await backup(page));
  expect(locked.manual!.footLocks).toEqual([lock]);
  expect(locked.take!.times).toContain(2);

  // Reusing an exact existing teacher pose preserves author intent even when
  // it conflicts with the standing foot. The solver reports a residual only.
  await frame(page, 60); await select(page, 'LeftLowerLeg');
  await pastePose(page);
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
  await editStageValue(page, '关节 Z 旋转（度）', 40); await number(page, '关节 Z 旋转（度）', 40); await trackKey(page, 'joint');
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
  const source = await openFixture(page, false, source => {
    source.take.poses[2].root = [0, 1.8, 0];
    source.take.poses[2].joints.LeftLowerLeg = rotationFromDegrees([-100, 0, 0]);
    source.take.poses[2].joints.LeftUpperArm = rotationFromDegrees([0, 0, 60]);
  });
  await frame(page, 75); await select(page, 'LeftLowerLeg'); await copyPose(page);
  await frame(page, 0); const lock = await leftFootLock(page);
  await frame(page, 60); await select(page, 'LeftLowerLeg');
  await pastePose(page); await trackKey(page, 'joint');
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
  await trackKey(page, 'joint');
  const selectedTracks = current(await backup(page));
  expect(Object.keys(selectedTracks.manual!.rotations).sort()).toEqual(['LeftLowerLeg', 'LeftUpperArm']);
  sameRotation(sampleAt(selectedTracks, 60).joints.LeftLowerLeg, rotationFromDegrees([-100, 0, 0]));
  sameRotation(sampleAt(selectedTracks, 60).joints.LeftUpperArm, rotationFromDegrees([0, 0, 60]));
  // Whole-pose reuse may also restore joints changed by contact correction.
  // Commit those remaining explicit paste intents with a real full-pose K.
  await fullKey(page);
  const complete = await backup(page), snapshot = current(complete), pose = fullPoseAtKey(snapshot, 60);
  for (const joint of EDITABLE_JOINT_NAMES) sameRotation(pose.joints[joint], source.take.poses[2].joints[joint]);
  expect(snapshot.manual!.baseTake).toEqual(source.take); expect(snapshot.manual!.footLocks).toEqual([lock]);
  expect(pose.root).toEqual([0, 1.8, 0]);
  sameRotation(pose.joints.LeftLowerLeg, rotationFromDegrees([-100, 0, 0]));
  sameRotation(pose.joints.LeftUpperArm, rotationFromDegrees([0, 0, 60]));
  await save(page); await page.reload(); await ready(page);
  expect((await backup(page)).scene.project).toEqual(complete.scene.project);
  await expect(draft(page)).toHaveCount(0);
});

test('@author-priority reused unusual poses remain exact while guided stage edits and mobile feedback stay clear', async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 1000 });
  const source = await openFixture(page, false, source => {
    source.take.poses[2].joints.LeftForeArm = rotationFromDegrees([70, 0, 0]);
  });
  await frame(page, 75); await select(page, 'LeftForeArm'); await copyPose(page);
  await frame(page, 90); await pastePose(page, false); await number(page, '关节 X 旋转（度）', 70);
  await fullKey(page);
  const authored = await backup(page), pose = fullPoseAtKey(current(authored), 90);
  sameRotation(pose.joints.LeftForeArm, rotationFromDegrees([70, 0, 0]));
  expect(isJointRotationWithinLimits('LeftForeArm', pose.joints.LeftForeArm)).toBe(false);
  expect(current(authored).manual!.baseTake).toEqual(source.take);

  await editStageValue(page, '关节 X 旋转（度）', -60);
  await number(page, '关节 X 旋转（度）', -60); await expect(draft(page)).toBeVisible();
  expect((await backup(page)).scene.project).toEqual(authored.scene.project);
  await page.getByRole('button', { name: '撤回草稿', exact: true }).click();
  await number(page, '关节 X 旋转（度）', 70); await expect(draft(page)).toHaveCount(0);
  await expect(page.getByRole('combobox', { name: '选择关节', exact: true })).toHaveCount(0);
  await expect(page.getByRole('spinbutton', { name: '关节 X 旋转（度）', exact: true })).toHaveCount(0);
  await save(page); await page.reload(); await ready(page);
  expect((await backup(page)).scene.project).toEqual(authored.scene.project);
  await expect(page.getByRole('status').filter({ hasText: '超出标准人体建议' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await screenshot(page, info, 'author-priority-stage-390.png');
});

test('@author-priority copied small rotations and Root positions retain stored precision through partial K and saving', async ({ page }) => {
  const source = await openFixture(page, true, source => {
    source.take.poses[2].joints.LeftUpperArm = rotationFromDegrees([0, 0, .04]);
    source.take.poses[2].root = [0, 1.8000004, 0];
  }), original = await backup(page);
  const originalMiddle = sampleTake(source.take, 2);
  await frame(page, 75); await select(page, 'LeftUpperArm'); await copyPose(page);
  await frame(page, 60); await select(page, 'LeftUpperArm');
  // Pose reuse must preserve formal data below visible display rounding and
  // former dot/distance thresholds without introducing a precision form.
  await pastePose(page);
  await expect(draft(page)).toBeVisible();
  expect((await backup(page)).scene.project).toEqual(original.scene.project);
  await trackKey(page, 'root');
  await expect(draft(page)).toBeVisible();
  const rootOnly = current(await backup(page));
  expect(rootOnly.manual!.root).toEqual([{ frame: 60, position: [0, 1.8000004, 0] }]);
  expect(rootOnly.manual!.rotations).toEqual({});
  expect(sampleAt(rootOnly, 60).joints.LeftUpperArm).toEqual(originalMiddle.joints.LeftUpperArm);

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
  await number(page, '关节 Z 旋转（度）', .04); await number(page, 'Root Y 位移（米）', 1.8000004);
  await expect(draft(page)).toHaveCount(0);
});
