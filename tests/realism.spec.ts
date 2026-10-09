import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import { Vector3 } from 'three';
import { evaluatePose, sampleTake, type JointName, type Vec3 } from '../packages/core/src';
import { isJointRotationWithinLimits } from '../packages/core/src/jointConstraints';
import { clickRevealed, closeDisclosures, reveal } from './helpers';
import { backup, current, diagnostics, draft, frame, hiddenButton, jointPosition, numeric, openFixture, openRealism, projection, ready, save, screenshot, select } from './realismHelpers';

const reports = new WeakMap<Page, ReturnType<typeof diagnostics>>();
test.beforeEach(async ({ page }) => {
  reports.set(page, diagnostics(page));
  // A regression must fail closed rather than reach an inference provider.
  await page.route('**/api/**', route => route.abort('blockedbyclient'));
});
test.afterEach(async ({ page }, info) => {
  const report = reports.get(page)!;
  await info.attach('browser-console-and-api', { body: JSON.stringify(report), contentType: 'application/json' });
  expect(report.errors).toEqual([]); expect(report.warnings).toEqual([]);
  expect(report.expectedHttpErrors).toEqual([]); expect(report.apiRequests).toEqual([]);
});

test('@realism real IK world-arrow drags form a constrained leg draft, explicit K persists and undo restores the original', async ({ page }, info) => {
  const source = await openFixture(page), original = await backup(page);
  await frame(page, 60); await select(page, 'LeftFoot');
  await page.getByRole('button', { name: '手脚 IK', exact: true }).click();
  const indicator = page.getByLabel('IK 手脚目标', { exact: true });
  await expect(indicator).toContainText('手脚协调');
  const first = evaluatePose(sampleTake(source.take, 2)).LeftFoot.position;
  let projected = await projection(page, original);
  const yStart = projected.point([first[0], first[1] + .16, first[2]]);
  const yEnd = projected.point([first[0], first[1] + .29, first[2]]);
  await page.mouse.move(yStart.x, yStart.y);
  await expect(indicator).toContainText('Y轴');
  await page.mouse.down(); await page.mouse.move(yEnd.x, yEnd.y, { steps: 9 }); await page.mouse.up();
  await expect(draft(page)).toBeVisible();
  let lifted = await jointPosition(page);
  expect(lifted[1]).toBeGreaterThan(first[1] + .06);
  expect((await backup(page)).scene.project).toEqual(original.scene.project);
  projected = await projection(page, original);
  const xStart = projected.point([lifted[0] + .16, lifted[1], lifted[2]]);
  const xEnd = projected.point([lifted[0] + .27, lifted[1], lifted[2]]);
  await page.mouse.move(xStart.x, xStart.y);
  await expect(indicator).toContainText('X轴');
  await page.mouse.down(); await page.mouse.move(xEnd.x, xEnd.y, { steps: 9 }); await page.mouse.up();
  lifted = await jointPosition(page);
  expect(lifted[0]).toBeGreaterThan(first[0] + .055);
  expect((await backup(page)).scene.project).toEqual(original.scene.project);
  // Moving beyond the fixed leg's reach must leave a visible residual and a
  // valid bounded pose instead of stretching the skeleton to fake success.
  projected = await projection(page, original);
  const farStart = projected.point([lifted[0] + .16, lifted[1], lifted[2]]);
  const farEnd = projected.point([lifted[0] + .90, lifted[1], lifted[2]]);
  await page.mouse.move(farStart.x, farStart.y); await expect(indicator).toContainText('X轴');
  await page.mouse.down(); await page.mouse.move(farEnd.x, farEnd.y, { steps: 12 }); await page.mouse.up();
  await expect(indicator.getByRole('status').filter({ hasText: '目标差' })).toBeVisible();
  expect((await backup(page)).scene.project).toEqual(original.scene.project);
  await page.getByRole('button', { name: 'K 完整姿态', exact: true }).click();
  await expect(draft(page)).toHaveCount(0);
  const written = await backup(page), snapshot = current(written);
  expect(snapshot.manual!.baseTake).toEqual(source.take);
  expect(snapshot.manual!.root).toHaveLength(1);
  for (const joint of ['LeftUpperLeg', 'LeftLowerLeg'] as JointName[]) {
    expect(snapshot.manual!.rotations[joint]![0].frame).toBe(60);
    expect(isJointRotationWithinLimits(joint, snapshot.manual!.rotations[joint]![0].rotation)).toBe(true);
  }
  const solved = evaluatePose(sampleTake(snapshot.take!, 2)).LeftFoot.position;
  expect(solved[0]).toBeGreaterThan(first[0] + .055);
  expect(solved[1]).toBeGreaterThan(first[1] + .06);
  expect(sampleTake(snapshot.take!, 2).root).toEqual(source.take.poses[0].root);
  await save(page); await page.reload(); await ready(page);
  expect((await backup(page)).scene.project).toEqual(written.scene.project);
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  expect(current(await backup(page)).take).toEqual(source.take);
  await screenshot(page, info, 'realism-ik-1440.png');
});

test('@realism a foot contact survives Root editing, undo/redo, local saving and a complete scene bundle', async ({ page }) => {
  const source = await openFixture(page);
  await select(page, 'LeftFoot');
  await openRealism(page);
  const lockAction = hiddenButton(page, '锁定支撑脚');
  await reveal(page, lockAction); await numeric(page, '脚锁结束帧', 120); await lockAction.click();
  // Contact metadata is independent of the sparse Root key written below.
  const locked = await backup(page), contact = current(locked).manual!.footLocks![0];
  expect(contact).toMatchObject({ schema: 'foot-lock-1', foot: 'LeftFoot', startFrame: 0 });
  expect(contact.endFrame).toBe(120);
  await frame(page, 60); await numeric(page, 'Root X 位移（米）', .12);
  await clickRevealed(page, page.getByRole('button', { name: 'K 位移', exact: true, includeHidden: true }));
  await expect(draft(page)).toHaveCount(0);
  const edited = await backup(page), manual = current(edited).manual!;
  expect(manual.footLocks).toEqual([contact]); expect(manual.root).toHaveLength(1);
  expect(manual.baseTake).toEqual(source.take);
  const world = evaluatePose(sampleTake(current(edited).take!, 2)).LeftFoot.position;
  expect(new Vector3(...world).distanceTo(new Vector3(...contact.target))).toBeLessThan(.01);
  expect(current(edited).take!.times.at(-1)).toBe(16);
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  expect(current(await backup(page)).manual!.root).toEqual([]);
  expect(current(await backup(page)).manual!.footLocks).toEqual([contact]);
  await page.getByRole('button', { name: '重做', exact: true }).click();
  const redone = await backup(page);
  expect(current(redone).manual).toEqual(manual);
  await save(page); await page.reload(); await ready(page);
  expect((await backup(page)).scene.project).toEqual(redone.scene.project);
  const download = page.waitForEvent('download');
  await clickRevealed(page, hiddenButton(page, '下载完整场景包'));
  const file = await (await download).path(); expect(file).toBeTruthy();
  const bytes = await readFile(file!);
  await closeDisclosures(page, '.studio-more, .studio-more .backup-menu');
  await page.getByRole('button', { name: '场景', exact: true }).click();
  await page.getByRole('dialog', { name: '本机场景', exact: true }).getByRole('button', { name: '导入场景备份', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '导入场景备份', exact: true });
  await dialog.getByLabel('选择场景备份文件', { exact: true }).setInputFiles({ name: 'contact.choreo', mimeType: 'application/octet-stream', buffer: bytes });
  await dialog.getByLabel('导入后的场景名称', { exact: true }).fill('脚锁完整备份副本');
  await dialog.getByRole('button', { name: '作为新场景导入', exact: true }).click();
  await expect(dialog).toHaveCount(0); await expect(page.locator('.project-title h1')).toHaveText('脚锁完整备份副本');
  const imported = await backup(page);
  expect(imported.scene.id).not.toBe(edited.scene.id);
  expect(imported.scene.project).toEqual(redone.scene.project);
  expect(current(imported).manual!.footLocks).toEqual([contact]);
});

test('@realism Rapier gravity previews a floating body, cancellation leaves authority intact and explicit adoption is undoable', async ({ page }, info) => {
  const source = await openFixture(page, true), original = await backup(page);
  await select(page, 'LeftFoot');
  await openRealism(page);
  await clickRevealed(page, hiddenButton(page, '生成重力候选'));
  const candidate = page.getByLabel('辅助候选', { exact: true });
  await expect(candidate).toContainText('重力候选', { timeout: 30_000 });
  expect((await backup(page)).scene.project).toEqual(original.scene.project);
  await candidate.getByRole('button', { name: '预览候选', exact: true }).click();
  await frame(page, 240);
  expect((await jointPosition(page))[1]).toBeLessThan(.5);
  expect((await backup(page)).scene.project).toEqual(original.scene.project);
  await candidate.getByRole('button', { name: '关闭候选', exact: true }).click();
  await expect(candidate).toHaveCount(0);
  expect((await jointPosition(page))[1]).toBeCloseTo(.84, 2);
  expect(current(await backup(page)).take).toEqual(source.take);
  await clickRevealed(page, hiddenButton(page, '生成重力候选'));
  await expect(candidate).toContainText('重力候选', { timeout: 30_000 });
  await candidate.getByRole('button', { name: '采用候选', exact: true }).click();
  await expect(candidate).toHaveCount(0);
  const adopted = await backup(page), take = current(adopted).take!;
  expect(take.id).not.toBe(source.take.id);
  expect(sampleTake(take, 8).root[1]).toBeLessThan(1.3);
  source.take.times.forEach(time => expect(take.times).toContain(time));
  expect(take.times.at(-1)).toBe(source.take.durationSeconds);
  expect(adopted.scene.project.revision).toBe(original.scene.project.revision + 1);
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  expect(current(await backup(page)).take).toEqual(source.take);
  await screenshot(page, info, 'realism-gravity-1440.png');
});

test('@realism the standard body profile is built in and read only, with a clear mobile layout', async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 1000 });
  const source = await openFixture(page), original = await backup(page);
  await openRealism(page);
  await clickRevealed(page, hiddenButton(page, '生成重力候选'));
  const panel = page.locator('details.realism-panel');
  await expect(panel).toContainText('标准中性人体');
  await expect(panel).toContainText('70 kg');
  expect(await panel.getByRole('spinbutton', { name: /体重|质量|摩擦|惯量|重力|驱动/ }).count()).toBe(0);
  expect(await panel.getByRole('textbox', { name: /体重|质量|摩擦|惯量|重力|驱动/ }).count()).toBe(0);
  await expect(page.getByLabel('辅助候选', { exact: true })).toContainText('重力候选', { timeout: 30_000 });
  const width = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, viewport: window.innerWidth }));
  expect(width.scroll).toBeLessThanOrEqual(width.viewport);
  expect(current(await backup(page)).take).toEqual(source.take);
  expect((await backup(page)).scene.project).toEqual(original.scene.project);
  await screenshot(page, info, 'realism-profile-390.png');
});
