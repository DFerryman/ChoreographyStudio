import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { HUMANOID_ASSET_URL } from '../apps/web/src/Humanoid';
import { clickRevealed, reveal } from './helpers';
import { backup, current, diagnostics, draft, numeric, openFixture, projection, save, screenshot, select } from './realismHelpers';
import { expectStageValue, readStagePose } from './stageInteractions';

const modelLoading = (page: Page) => page.getByRole('status').filter({ hasText: '人物模型载入中' });

test.beforeEach(async ({ page }) => { await page.route('**/api/**', route => route.abort('blockedbyclient')); });

test('@model continuous neutral skin renders in desktop and mobile layouts and follows a manual shoulder pose', async ({ page }, info) => {
  const report = diagnostics(page);
  await openFixture(page);
  await expect(modelLoading(page)).toBeHidden();
  const original = await backup(page);
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: width === 1440 ? 1000 : 844 });
    await page.getByRole('button', { name: '全身取景', exact: true }).click();
    const view = await projection(page, await backup(page));
    const name = `neutral-human-canvas-${width}.png`, bytes = await view.canvas.screenshot();
    await info.attach(name, { body: bytes, contentType: 'image/png' });
    if (process.env.CHOREO_SCREENSHOT_DIR) {
      await mkdir(process.env.CHOREO_SCREENSHOT_DIR, { recursive: true });
      await writeFile(join(process.env.CHOREO_SCREENSHOT_DIR, name), bytes);
    }
    await screenshot(page, info, `neutral-human-layout-${width}.png`);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await select(page, 'LeftUpperArm');
  await numeric(page, '关节 Z 旋转（度）', 80);
  await expect(draft(page)).toBeVisible();
  await clickRevealed(page, page.getByRole('button', { name: '全身取景', exact: true }));
  expect((await backup(page)).scene.project).toEqual(original.scene.project);
  await screenshot(page, info, 'neutral-human-shoulder-draft-1440.png');
  expect(report).toEqual({ errors: [], warnings: [], expectedHttpErrors: [], apiRequests: [] });
});

test('@model a delayed asset binds to the current edited pose without changing its authority or saved camera', async ({ page }, info) => {
  const report = diagnostics(page);
  let hold = false;
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const bytes = await readFile(`apps/web/public${HUMANOID_ASSET_URL}`);
  await page.route(`**${HUMANOID_ASSET_URL}`, async route => {
    if (hold) await gate;
    await route.fulfill({ status: 200, contentType: 'model/gltf-binary', body: bytes });
  });
  await openFixture(page);
  await expect(modelLoading(page)).toBeHidden();
  const original = await backup(page);
  hold = true;
  await page.reload();
  await expect(modelLoading(page)).toBeVisible();
  await select(page, 'LeftUpperArm');
  await numeric(page, '关节 Z 旋转（度）', 80);
  await numeric(page, 'Root X 位移（米）', .8);
  await expectStageValue(page, '关节 Z 旋转（度）', 80);
  await expectStageValue(page, 'Root X 位移（米）', .8, .000005);
  const actualDraft = (await readStagePose(page)).pose;
  await expect(draft(page)).toBeVisible();
  const before = await backup(page);
  release();
  await expect(modelLoading(page)).toBeHidden();
  await reveal(page, page.getByLabel('相机世界坐标'));
  const loaded = await backup(page);
  expect(loaded.scene.viewer.camera).toEqual(before.scene.viewer.camera);
  expect(loaded.scene.project).toEqual(original.scene.project);
  await page.getByRole('button', { name: '全身取景', exact: true }).click();
  await screenshot(page, info, 'neutral-human-late-posed-1440.png');
  await page.getByRole('button', { name: 'K 完整姿态', exact: true }).click();
  await expect(draft(page)).toBeHidden();
  const authored = await backup(page);
  // Pointer rays carry normal floating point error. Persist the actual visible
  // draft exactly rather than claiming the removed number form was used.
  expect(current(authored).take.poses[0].root).toEqual(actualDraft.root);
  actualDraft.joints.LeftUpperArm.forEach((component, i) => expect(current(authored).take.poses[0].joints.LeftUpperArm[i]).toBeCloseTo(component, 12));
  await save(page);
  await page.reload();
  await expect(modelLoading(page)).toBeHidden();
  const reopened = await backup(page);
  expect(reopened.scene.project).toEqual(authored.scene.project);
  expect(reopened.scene.viewer.camera).toEqual(authored.scene.viewer.camera);
  await screenshot(page, info, 'neutral-human-reopened-posed-1440.png');
  expect(report).toEqual({ errors: [], warnings: [], expectedHttpErrors: [], apiRequests: [] });
});
