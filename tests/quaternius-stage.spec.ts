import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { Vector3 } from 'three';
import { HUMANOID_ASSET_URL } from '../apps/web/src/Humanoid';
import { evaluatePose, isJointRotationWithinLimits, sampleTake, type JointName } from '../packages/core/src';
import { clickRevealed } from './helpers';
import { backup, current, diagnostics, draft, frame, jointPosition, numeric, openFixture, projection, ready, save, select } from './realismHelpers';
import { expectStageValue } from './stageInteractions';

const loading = (page: Page) => page.getByRole('status').filter({ hasText: '人物模型载入中' });

async function loaded(page: Page) {
  await expect(loading(page)).toBeHidden();
  await expect(page.getByText('3D 预览暂时不可用', { exact: true })).toHaveCount(0);
  await expect(page.locator('.stage3d-selection-announcement')).toHaveCount(1);
}

async function capture(page: Page, info: TestInfo, name: string) {
  await loaded(page);
  const canvas = page.getByRole('img', { name: '人体编舞动作预览' });
  await canvas.scrollIntoViewIfNeeded();
  await page.mouse.move(1, 1);
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  const bytes = await canvas.screenshot();
  await info.attach(name, { body: bytes, contentType: 'image/png' });
  if (process.env.CHOREO_SCREENSHOT_DIR) {
    await mkdir(process.env.CHOREO_SCREENSHOT_DIR, { recursive: true });
    await writeFile(join(process.env.CHOREO_SCREENSHOT_DIR, name), bytes);
  }
}

test.beforeEach(async ({ page }) => {
  await page.route('**/api/**', route => route.abort('blockedbyclient'));
});

test('@quaternius-stage actual hand and foot IK drafts and K share the selected native skin across mirror, save and mobile framing', async ({ page }, info) => {
  test.setTimeout(90_000);
  const report = diagnostics(page), assets: string[] = [], archivedAssetRequests: string[] = [];
  page.on('request', request => {
    const pathname = new URL(request.url()).pathname;
    if (pathname.startsWith('/models/') && pathname.includes('mhr')) archivedAssetRequests.push(pathname);
  });
  page.on('response', response => {
    if (new URL(response.url()).pathname === HUMANOID_ASSET_URL && response.ok()) assets.push(HUMANOID_ASSET_URL);
  });
  const source = await openFixture(page);
  await loaded(page);
  expect(HUMANOID_ASSET_URL).toBe('/models/neutral-quaternius-v1.glb');
  expect(assets.length).toBeGreaterThan(0);
  const original = await backup(page);
  await frame(page, 60);
  await select(page, 'LeftHand');
  await page.getByRole('button', { name: '手脚 IK', exact: true }).click();
  const indicator = page.getByLabel('IK 手脚目标', { exact: true });
  await expect(indicator).toContainText('手脚协调');
  const first = evaluatePose(sampleTake(source.take, 2)).LeftHand.position;
  const projected = await projection(page, await backup(page));
  const start = projected.point([first[0], first[1] + .16, first[2]]);
  const end = projected.point([first[0], first[1] + .30, first[2]]);
  await page.mouse.move(start.x, start.y);
  await expect(indicator).toContainText('Y轴');
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 9 });
  await page.mouse.up();
  await expect(draft(page)).toBeVisible();
  const actualHand = await jointPosition(page);
  expect(actualHand[1]).toBeGreaterThan(first[1] + .06);
  expect((await backup(page)).scene.project).toEqual(original.scene.project);
  await capture(page, info, 'quaternius-real-hand-ik-draft.png');
  await page.getByRole('button', { name: 'K 完整姿态', exact: true }).click();
  await expect(draft(page)).toBeHidden();
  const written = await backup(page), snapshot = current(written);
  const solved = evaluatePose(sampleTake(snapshot.take!, 2)).LeftHand.position;
  expect(new Vector3(...solved).distanceTo(new Vector3(...actualHand))).toBeLessThan(.001);
  expect(snapshot.manual!.baseTake).toEqual(source.take);
  expect(snapshot.manual!.root).toHaveLength(1);
  expect(sampleTake(snapshot.take!, 2).root).toEqual(source.take.poses[0].root);
  for (const joint of ['LeftUpperArm', 'LeftForeArm'] as JointName[]) {
    expect(snapshot.manual!.rotations[joint]![0].frame).toBe(60);
    expect(isJointRotationWithinLimits(joint, snapshot.manual!.rotations[joint]![0].rotation)).toBe(true);
  }
  await capture(page, info, 'quaternius-real-hand-ik-key.png');
  await clickRevealed(page, page.getByRole('button', { name: '镜像观看', exact: true, includeHidden: true }));
  await clickRevealed(page, page.getByRole('button', { name: '全身取景', exact: true }));
  const mirrored = await backup(page);
  expect(mirrored.scene.viewer.mirror).toBe(true);
  expect(mirrored.scene.project).toEqual(written.scene.project);
  await capture(page, info, 'quaternius-real-hand-ik-mirror.png');
  await save(page);
  await page.reload();
  await ready(page);
  await loaded(page);
  const restored = await backup(page);
  expect(restored.scene.project).toEqual(written.scene.project);
  expect(restored.scene.viewer.mirror).toBe(true);
  expect(restored.scene.viewer.camera).toEqual(mirrored.scene.viewer.camera);
  await page.setViewportSize({ width: 390, height: 844 });
  await clickRevealed(page, page.getByRole('button', { name: '全身取景', exact: true }));
  await capture(page, info, 'quaternius-real-hand-ik-reopened-mobile390.png');
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  expect((await backup(page)).scene.project).toEqual(written.scene.project);

  // The legacy leg regression captures after its undo. Capture the actual
  // loaded foot deformation here while the leg draft and its K still exist.
  await page.setViewportSize({ width: 1440, height: 1000 });
  await clickRevealed(page, page.getByRole('button', { name: '镜像观看', exact: true, includeHidden: true }));
  await frame(page, 90);
  await clickRevealed(page, page.getByRole('button', { name: '全身取景', exact: true }));
  await select(page, 'LeftFoot');
  await page.getByRole('button', { name: '手脚 IK', exact: true }).click();
  const initialFoot = evaluatePose(sampleTake(current(written).take!, 3)).LeftFoot.position;
  const footView = await projection(page, await backup(page));
  const footStart = footView.point([initialFoot[0], initialFoot[1] + .16, initialFoot[2]]);
  const footEnd = footView.point([initialFoot[0], initialFoot[1] + .30, initialFoot[2]]);
  await page.mouse.move(footStart.x, footStart.y);
  await expect(indicator).toContainText('Y轴');
  await page.mouse.down();
  await page.mouse.move(footEnd.x, footEnd.y, { steps: 9 });
  await page.mouse.up();
  await expect(draft(page)).toBeVisible();
  const actualFoot = await jointPosition(page);
  expect(actualFoot[1]).toBeGreaterThan(initialFoot[1] + .06);
  expect((await backup(page)).scene.project).toEqual(written.scene.project);
  await capture(page, info, 'quaternius-real-foot-ik-draft.png');
  await page.getByRole('button', { name: 'K 完整姿态', exact: true }).click();
  await expect(draft(page)).toBeHidden();
  const footKey = current(await backup(page));
  expect(footKey.manual!.baseTake).toEqual(source.take);
  expect(sampleTake(footKey.take!, 3).root).toEqual(source.take.poses[0].root);
  const solvedFoot = evaluatePose(sampleTake(footKey.take!, 3)).LeftFoot.position;
  expect(new Vector3(...solvedFoot).distanceTo(new Vector3(...actualFoot))).toBeLessThan(.001);
  for (const joint of ['LeftUpperLeg', 'LeftLowerLeg'] as JointName[]) {
    const legKey = footKey.manual!.rotations[joint]!.find(key => key.frame === 90)!;
    expect(isJointRotationWithinLimits(joint, legKey.rotation)).toBe(true);
  }
  await capture(page, info, 'quaternius-real-foot-ik-key.png');

  // The source-rest torso binding must remain coherent when the clavicle
  // participates. Exercise real rotation rings, not only a locked-clavicle
  // imported stress pose that could conceal a neck/shoulder seam.
  const beforeShoulder = await backup(page);
  await select(page, 'LeftUpperArm');
  await page.getByRole('button', { name: '旋转工具', exact: true }).click();
  // Remove the earlier hand IK's other-axis arm rotation with real rings;
  // a local Z drag on a tilted arm is not an absolute Euler Z edit.
  for (const axis of ['X', 'Y', 'Z']) {
    await numeric(page, `关节 ${axis} 旋转（度）`, 0);
    await expectStageValue(page, `关节 ${axis} 旋转（度）`, 0);
  }
  for (const axis of ['X', 'Y', 'Z']) await expectStageValue(page, `关节 ${axis} 旋转（度）`, 0);
  await numeric(page, '关节 Z 旋转（度）', 130);
  await expectStageValue(page, '关节 Z 旋转（度）', 130);
  await select(page, 'LeftShoulder');
  await numeric(page, '关节 Z 旋转（度）', 20);
  await expectStageValue(page, '关节 Z 旋转（度）', 20);
  await expect(draft(page)).toBeVisible();
  await clickRevealed(page, page.getByRole('button', { name: '全身取景', exact: true }));
  expect((await backup(page)).scene.project).toEqual(beforeShoulder.scene.project);
  await capture(page, info, 'quaternius-real-clavicle20-arm130-draft.png');
  await page.getByRole('button', { name: 'K 完整姿态', exact: true }).click();
  await expect(draft(page)).toBeHidden();
  const coordinated = current(await backup(page));
  expect(coordinated.manual!.baseTake).toEqual(source.take);
  expect(sampleTake(coordinated.take!, 3).root).toEqual(sampleTake(footKey.take!, 3).root);
  expect(sampleTake(coordinated.take!, 3).joints.LeftLowerLeg).toEqual(sampleTake(footKey.take!, 3).joints.LeftLowerLeg);
  await expectStageValue(page, '关节 Z 旋转（度）', 20);
  await capture(page, info, 'quaternius-real-clavicle20-arm130-key.png');
  expect(archivedAssetRequests, 'The selected source must not fetch MHR skin or learned correction assets').toEqual([]);
  expect(report).toEqual({ errors: [], warnings: [], expectedHttpErrors: [], apiRequests: [] });
  await info.attach('quaternius-hand-workflow-diagnostics.json', { body: JSON.stringify({ ...report, loadedAsset: HUMANOID_ASSET_URL, successfulAssetResponses: assets.length }), contentType: 'application/json' });
});
