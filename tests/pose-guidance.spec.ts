import { expect, test, type Page } from '@playwright/test';
import { Quaternion } from 'three';
import { isJointRotationWithinLimits, rotationFromDegrees, sampleTake, type Quat } from '../packages/core/src';
import { clickRevealed } from './helpers';
import { backup, current, diagnostics, draft, frame, openFixture, openRealism, screenshot } from './realismHelpers';
import { editStageValue, expectStageSelection, expectStageValue, selectStageJoint } from './stageInteractions';

const reports = new WeakMap<Page, ReturnType<typeof diagnostics>>();
const warning = (page: Page) => page.getByLabel('全身关节建议范围', { exact: true });
const stage = (page: Page) => page.getByRole('region', { name: '3D 动画舞台', exact: true });
test.beforeEach(async ({ page }) => {
  reports.set(page, diagnostics(page));
  await page.route('**/api/**', route => route.abort('blockedbyclient'));
});
test.afterEach(async ({ page }, info) => {
  const report = reports.get(page)!;
  await info.attach('guidance-browser-console-and-api', { body: JSON.stringify(report), contentType: 'application/json' });
  expect(report).toEqual({ errors: [], warnings: [], expectedHttpErrors: [], apiRequests: [] });
});
async function loaded(page: Page) {
  await expect(page.getByRole('status').filter({ hasText: '人物模型载入中' })).toBeHidden();
  await expect(page.getByText('3D 预览暂时不可用', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('img', { name: '人体编舞动作预览', exact: true })).toBeVisible();
}
async function fullKey(page: Page) {
  await page.getByRole('button', { name: 'K 完整姿态', exact: true }).click();
  await expect(draft(page)).toHaveCount(0);
}

test('@pose-guidance unusual author K remains exact with no selection, collapsed diagnostics and active playback warnings', async ({ page }, info) => {
  const impossible = rotationFromDegrees([-70, 0, 0]);
  const source = await openFixture(page, false, source => {
    for (const pose of source.take.poses) pose.joints.LeftLowerLeg = [...impossible];
  });
  await loaded(page); await expectStageSelection(page, null);
  await expect(warning(page)).toContainText('1 处');
  await expect(warning(page)).toHaveAttribute('title', '左膝');
  const panel = page.locator('details.realism-panel');
  await expect(panel).not.toHaveAttribute('open');
  await expect(panel.getByLabel('关节超限数量', { exact: true })).toContainText('1 处');
  await fullKey(page);
  const keyed = await backup(page), snapshot = current(keyed);
  expect(snapshot.manual!.rotations.LeftLowerLeg![0]).toEqual({ frame: 0, rotation: impossible });
  expect(snapshot.take!.poses[0].joints.LeftLowerLeg).toEqual(impossible);
  expect(snapshot.manual!.baseTake).toEqual(source.take);
  await openRealism(page);
  await expect(page.getByLabel('全身关节超限部位', { exact: true })).toContainText('左膝');
  await panel.locator(':scope > summary').click();
  await page.getByRole('button', { name: '播放', exact: true }).click();
  await expect(page.getByRole('button', { name: '暂停', exact: true })).toBeVisible();
  await expect.poll(async () => Number(await page.getByRole('slider', { name: '关键帧时间线进度', exact: true }).inputValue())).toBeGreaterThan(0);
  await expectStageSelection(page, null);
  await expect(warning(page)).toBeVisible();
  await screenshot(page, info, 'joint-guidance-unselected-playback.png');
  await page.getByRole('button', { name: '暂停', exact: true }).click();
  expect((await backup(page)).scene.project).toEqual(keyed.scene.project);
  await page.setViewportSize({ width: 390, height: 844 });
  await stage(page).scrollIntoViewIfNeeded();
  await expect(warning(page)).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await screenshot(page, info, 'joint-guidance-unselected-mobile390.png');
});

test('@pose-guidance legal wrist keys expose an interpolated limit violation without changing either key or the raw SLERP', async ({ page }, info) => {
  const a = rotationFromDegrees([-51.047825273126364, -14.960054133553058, 21.82540789945051]);
  const b = rotationFromDegrees([45.59781915508211, 13.430102812126279, 23.15311743877828]);
  expect(isJointRotationWithinLimits('LeftHand', a)).toBe(true);
  expect(isJointRotationWithinLimits('LeftHand', b)).toBe(true);
  await openFixture(page, false, source => {
    source.take.poses.forEach((pose, index) => { pose.joints.LeftHand = [...(index < 3 ? a : b)]; });
  });
  await loaded(page);
  // Capture the original second pose before adding the first sparse key:
  // one new key changes the whole track toward its original final endpoint.
  await frame(page, 120);
  await clickRevealed(page, page.getByRole('button', { name: '复制当前姿态', exact: true, includeHidden: true }));
  await frame(page, 0); await fullKey(page);
  await frame(page, 120);
  await clickRevealed(page, page.getByRole('button', { name: '粘贴关节姿态', exact: true, includeHidden: true }));
  await expect(warning(page)).toHaveCount(0); await fullKey(page);
  const keyed = await backup(page), snapshot = current(keyed);
  const keys = structuredClone(snapshot.manual!.rotations.LeftHand!);
  expect(keys.map(key => key.frame)).toEqual([0, 120]);
  // Writing a new K normalizes its quaternion. Capture that authoritative
  // payload, then require warning/seek/render to preserve its bits exactly.
  for (const [index, input] of [a, b].entries()) expect(Math.abs(new Quaternion(...input).dot(new Quaternion(...keys[index].rotation)))).toBeCloseTo(1, 12);
  expect(sampleTake(snapshot.take!, 0).joints.LeftHand).toEqual(keys[0].rotation);
  expect(sampleTake(snapshot.take!, 4).joints.LeftHand).toEqual(keys[1].rotation);
  const expected = new Quaternion(...keys[0].rotation).slerp(new Quaternion(...keys[1].rotation), .25);
  await frame(page, 30); await expectStageSelection(page, null);
  await expect(warning(page)).toHaveAttribute('title', '左腕');
  await expect(warning(page)).toContainText('1 处');
  await screenshot(page, info, 'joint-guidance-interpolated-wrist.png');
  const actual = sampleTake(current(await backup(page)).take!, 1).joints.LeftHand;
  expect(Math.abs(expected.dot(new Quaternion(...actual)))).toBeCloseTo(1, 12);
  expect(isJointRotationWithinLimits('LeftHand', actual)).toBe(false);
  await selectStageJoint(page, 'LeftHand');
  const visible = JSON.parse((await stage(page).getAttribute('data-local-rotation'))!) as Quat;
  expect(visible).toEqual(actual);
  expect((await backup(page)).scene.project).toEqual(keyed.scene.project);
});

test('@pose-guidance ordinary knee ring editing still projects an excessive new rotation before explicit K', async ({ page }, info) => {
  const source = await openFixture(page);
  await loaded(page); await selectStageJoint(page, 'LeftLowerLeg');
  await editStageValue(page, '关节 X 旋转（度）', 90);
  await expectStageValue(page, '关节 X 旋转（度）', 90);
  await editStageValue(page, '关节 X 旋转（度）', 170);
  await expectStageValue(page, '关节 X 旋转（度）', 145);
  await expect(draft(page)).toBeVisible(); await expect(warning(page)).toHaveCount(0);
  const visible = JSON.parse((await stage(page).getAttribute('data-local-rotation'))!) as Quat;
  expect(isJointRotationWithinLimits('LeftLowerLeg', visible)).toBe(true);
  expect((await backup(page)).scene.project).toEqual(source.scene.project);
  await fullKey(page);
  const keyed = current(await backup(page));
  expect(keyed.manual!.rotations.LeftLowerLeg![0].rotation).toEqual(visible);
  expect(isJointRotationWithinLimits('LeftLowerLeg', keyed.take!.poses[0].joints.LeftLowerLeg)).toBe(true);
  await screenshot(page, info, 'joint-guidance-guided-knee145.png');
});
