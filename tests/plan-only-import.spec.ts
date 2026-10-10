import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import { JOINT_NAMES } from '../packages/core/src';
import type { SceneDocument } from '../apps/web/src/scene';
import type { SceneProject } from '../apps/web/src/sceneProject';
import { encodeSceneBackup } from '../apps/web/src/sceneBackup';
import { clickRevealed, closeDisclosures, reveal } from './helpers';
import { backup, current, diagnostics, fixture, ready, save, screenshot } from './realismHelpers';
import { expectStageSelection } from './stageInteractions';

const timeline = (page: Page) => page.getByRole('region', { name: '手动关键帧时间线', exact: true });
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

async function nativeImport(page: Page, bytes: Buffer, name: string) {
  await page.getByRole('button', { name: '场景', exact: true }).click();
  await page.getByRole('dialog', { name: '本机场景', exact: true }).getByRole('button', { name: '导入场景备份', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '导入场景备份', exact: true });
  await dialog.getByLabel('选择场景备份文件', { exact: true }).setInputFiles({ name, mimeType: 'application/octet-stream', buffer: bytes });
  await expect(dialog.getByRole('button', { name: '作为新场景导入', exact: true })).toBeEnabled();
  await dialog.getByRole('button', { name: '作为新场景导入', exact: true }).click();
  await expect(dialog).toHaveCount(0); await ready(page);
  await expect(timeline(page)).toBeVisible();
}

async function audioHash(page: Page) {
  return page.locator('audio').evaluate(async (audio: HTMLAudioElement) => {
    const bytes = await (await fetch(audio.src)).arrayBuffer();
    return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), byte => byte.toString(16).padStart(2, '0')).join('');
  });
}

test('@planonlyimport native legacy plan with an empty take records its first Head edit with matching bindings and round-trips music and history', async ({ page }, info) => {
  test.setTimeout(120_000);
  const source = fixture();
  const planOnly = {
    ...source.scene, name: '旧编排空动作场景', audio: new Blob([new Uint8Array(source.wave)], { type: 'audio/wav' }),
    project: { ...source.scene.project, history: [{ ...source.scene.project.history[0], take: null }] },
    viewer: { ...source.scene.viewer, editorMode: 'arrange' },
  } as unknown as SceneDocument<SceneProject>;
  const initialBytes = Buffer.from(await (await encodeSceneBackup(planOnly)).arrayBuffer());
  const expectedAudio = createHash('sha256').update(source.wave).digest('hex');
  await page.goto('/'); await ready(page); await save(page);
  await nativeImport(page, initialBytes, 'legacy-plan-only.choreo');
  const before = await backup(page);
  expect(before.scene.project).toEqual(planOnly.project);
  expect(current(before).take).toBeNull();
  expect(current(before).manual).toBeUndefined();
  expect(before.scene.viewer.editorMode).toBe('keyframes');
  expect(await audioHash(page)).toBe(expectedAudio);

  const seconds = timeline(page).getByRole('spinbutton', { name: '当前时间（秒）', exact: true, includeHidden: true });
  await reveal(page, seconds); await seconds.fill('2'); await seconds.press('Tab');
  await expect(seconds).toHaveValue('2'); await closeDisclosures(page, '.kf-point-inspector');
  await timeline(page).locator('[data-track-id="body"] .kf-group-toggle').click();
  const head = timeline(page).locator('[data-track-id="Head"]');
  await head.getByRole('button', { name: '选择头部轨道', exact: true }).click();
  await expectStageSelection(page, 'Head');
  await head.locator('[data-selected-point="true"][data-time="2"]').dblclick();
  const x = timeline(page).getByRole('spinbutton', { name: '头部四元数X', exact: true });
  await x.fill('0.1'); await x.press('Tab');
  const after = await backup(page), edited = current(after);
  expect(after.scene.project.history).toHaveLength(before.scene.project.history.length + 1);
  expect(after.scene.project.history[0]).toEqual(before.scene.project.history[0]);
  expect(edited.plan).toEqual(current(before).plan);
  expect(edited.plan!.id).toBe(edited.take!.planId);
  expect(edited.manual!.baseTake.planId).toBe(edited.plan!.id);
  expect(edited.manual!.baseTake.countMapId).toBe(edited.countMap.id);
  expect(edited.take!.countMapId).toBe(edited.countMap.id);
  expect(edited.operation).toMatchObject({ time: 2, tracks: ['Head'] });
  expect(edited.manual!.pointInterpolation).toBe('hold-last-key-1');
  expect(edited.manual!.pointEdits).toHaveLength(1);
  expect(Object.keys(edited.manual!.pointEdits![0].joints!)).toEqual(['Head']);
  const authoredHead = edited.manual!.pointEdits![0].joints!.Head!;
  expect(authoredHead).not.toEqual([0, 0, 0, 1]);
  edited.take!.times.forEach((time, index) => {
    if (time >= 2) expect(edited.take!.poses[index].joints.Head).toEqual(authoredHead);
  });
  edited.take!.poses.forEach(pose => {
    expect(pose.root).toEqual([0, 1.05, 0]);
    for (const joint of JOINT_NAMES) if (joint !== 'Head') expect(pose.joints[joint]).toEqual([0, 0, 0, 1]);
  });

  await save(page); await page.reload(); await ready(page);
  const reopened = await backup(page);
  expect(reopened.scene.project).toEqual(after.scene.project);
  expect(await audioHash(page)).toBe(expectedAudio);
  const pending = page.waitForEvent('download');
  await clickRevealed(page, page.getByRole('button', { name: '下载完整场景包', exact: true, includeHidden: true }));
  const path = await (await pending).path(); expect(path).toBeTruthy();
  const exportedBytes = await readFile(path!);
  await closeDisclosures(page, '.studio-more, .studio-more .backup-menu');
  await nativeImport(page, exportedBytes, 'edited-plan-only.choreo');
  const restored = await backup(page);
  expect(restored.scene.id).not.toBe(reopened.scene.id);
  expect(restored.scene.project).toEqual(reopened.scene.project);
  expect(restored.scene.viewer).toEqual(reopened.scene.viewer);
  expect(restored.scene.audioName).toBe(source.scene.audioName);
  expect(await audioHash(page)).toBe(expectedAudio);
  await screenshot(page, info, 'legacy-plan-only-first-edit.png');
});
