import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import { unpackScene } from '../apps/web/src/compactScene';
import type { SceneDocument } from '../apps/web/src/scene';
import type { SceneProject } from '../apps/web/src/sceneProject';
import { clickRevealed, closeDisclosures, reveal } from './helpers';

const diagnostics = new WeakMap<Page, { errors: string[]; warnings: string[]; apiRequests: string[] }>();
test.beforeEach(async ({ page }) => {
  const messages = { errors: [] as string[], warnings: [] as string[], apiRequests: [] as string[] };
  diagnostics.set(page, messages);
  page.on('pageerror', error => messages.errors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error') messages.errors.push(message.text());
    if (message.type() === 'warning') messages.warnings.push(message.text());
  });
  page.on('request', request => {
    if (new URL(request.url()).pathname.startsWith('/api/')) messages.apiRequests.push(`${request.method()} ${request.url()}`);
  });
  page.on('dialog', dialog => { void (dialog.type() === 'beforeunload' ? dialog.accept() : dialog.dismiss()); });
});
test.afterEach(async ({ page }, testInfo) => {
  const messages = diagnostics.get(page)!;
  await testInfo.attach('browser-console-and-api', { body: JSON.stringify(messages), contentType: 'application/json' });
  expect(messages.errors, 'Browser runtime errors').toEqual([]);
  expect(messages.warnings, 'Browser warnings').toEqual([]);
  expect(messages.apiRequests, 'Slow playback and backups stay in the browser').toEqual([]);
});

async function ready(page: Page) {
  await expect(page.getByRole('button', { name: '播放', exact: true })).toBeEnabled();
  await page.locator('.project-title h1').click();
  await expect(page.getByLabel('相机世界坐标')).not.toContainText('—');
  await expect.poll(() => page.locator('audio').evaluate((audio: HTMLAudioElement) => audio.readyState)).toBeGreaterThanOrEqual(2);
}
const rateSelect = (page: Page) => page.getByRole('combobox', { name: '播放速度', exact: true, includeHidden: true });

async function download(page: Page, action: string) {
  const pending = page.waitForEvent('download');
  await clickRevealed(page, page.getByRole('button', { name: action, exact: true, includeHidden: true }));
  const path = await (await pending).path();
  expect(path).toBeTruthy();
  const bytes = await readFile(path!);
  await closeDisclosures(page, '.studio-more, .studio-more .backup-menu');
  return bytes;
}
function readJson(bytes: Buffer): SceneDocument<SceneProject> {
  const wire = JSON.parse(bytes.toString('utf8'));
  expect(wire.format).toBe('choreo-scene-backup-2');
  return unpackScene(wire.scene) as SceneDocument<SceneProject>;
}
function readBundle(bytes: Buffer) {
  const magic = Buffer.from('CHOREO-BUNDLE-1\n');
  expect(bytes.subarray(0, magic.length)).toEqual(magic);
  const headerEnd = magic.length + 4 + bytes.readUInt32LE(magic.length);
  const header = JSON.parse(bytes.subarray(magic.length + 4, headerEnd).toString('utf8'));
  expect(header.format).toBe('choreo-scene-bundle-2');
  const audio = bytes.subarray(headerEnd);
  expect(header.audio.byteLength).toBe(audio.length);
  expect(header.audio.sha256).toBe(createHash('sha256').update(audio).digest('hex'));
  return { scene: unpackScene(header.scene) as SceneDocument<SceneProject>, audio };
}
async function clock(page: Page) {
  return page.evaluate(() => ({
    wall: performance.now(),
    scene: Number(document.querySelector<HTMLInputElement>('input[aria-label="关键帧时间线进度"]')!.value),
    audio: document.querySelector('audio')!.currentTime,
  }));
}

for (const { rate, importFormat } of [{ rate: 0.25, importFormat: 'choreo' }, { rate: 0.1, importFormat: 'json' }] as const) {
  test(`@playback-rates ${rate}× drives the real audio and scene clocks, survives reopening and ${importFormat} import`, async ({ page }) => {
    test.setTimeout(90_000);
    await page.goto('/'); await ready(page);
    const original = readJson(await download(page, '下载项目备份'));
    await reveal(page, rateSelect(page));
    expect(await rateSelect(page).locator('option').allTextContents()).toEqual(['1×', '0.75×', '0.5×', '0.25×', '0.1×']);
    await rateSelect(page).selectOption(String(rate));
    await closeDisclosures(page, '.playback-options, .kf-more');
    await page.getByRole('button', { name: '播放', exact: true }).click();
    await expect.poll(() => page.locator('audio').evaluate((audio: HTMLAudioElement) => audio.paused)).toBe(false);
    expect(await page.locator('audio').evaluate((audio: HTMLAudioElement) => audio.playbackRate)).toBe(rate);
    const start = await clock(page);
    await expect.poll(async () => (await clock(page)).scene).toBeGreaterThan(start.scene + 0.15);
    const end = await clock(page), sceneElapsed = end.scene - start.scene;
    expect(Math.abs(sceneElapsed - (end.wall - start.wall) / 1000 * rate)).toBeLessThan(0.1);
    expect(Math.abs(sceneElapsed - (end.audio - start.audio))).toBeLessThan(0.12);
    await page.getByRole('button', { name: '暂停', exact: true }).click();
    await page.getByRole('button', { name: '保存', exact: true }).click();
    await expect(page.locator('.save-state')).toHaveText('已保存到本机');
    const json = await download(page, '下载项目备份'), saved = readJson(json);
    const full = await download(page, '下载完整场景包'), bundle = readBundle(full);
    expect(saved.viewer.rate).toBe(rate);
    expect(bundle.scene.viewer.rate).toBe(rate);
    expect(saved.project).toEqual(original.project);
    expect(bundle.scene.project).toEqual(original.project);

    await page.reload(); await ready(page);
    await expect(rateSelect(page)).toHaveValue(String(rate));
    const reopened = readJson(await download(page, '下载项目备份'));
    expect(reopened.id).toBe(saved.id);
    expect(reopened.viewer.rate).toBe(rate);
    expect(reopened.project).toEqual(original.project);

    await page.getByRole('button', { name: '场景', exact: true }).click();
    await page.getByRole('dialog', { name: '本机场景', exact: true }).getByRole('button', { name: '导入场景备份', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: '导入场景备份', exact: true });
    await dialog.getByLabel('选择场景备份文件', { exact: true }).setInputFiles({
      name: `slow-${rate}.${importFormat}`, mimeType: importFormat === 'json' ? 'application/json' : 'application/octet-stream', buffer: importFormat === 'json' ? json : full,
    });
    if (importFormat === 'json') {
      await dialog.getByLabel('重新关联原音乐', { exact: true }).setInputFiles({ name: saved.audioName, mimeType: 'audio/wav', buffer: bundle.audio });
    }
    const importedName = `${rate}倍速导入回归`;
    await dialog.getByLabel('导入后的场景名称', { exact: true }).fill(importedName);
    await expect(dialog.getByRole('button', { name: '作为新场景导入', exact: true })).toBeEnabled();
    await dialog.getByRole('button', { name: '作为新场景导入', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.locator('.project-title h1')).toHaveText(importedName);
    await ready(page);
    await expect(rateSelect(page)).toHaveValue(String(rate));
    const imported = readJson(await download(page, '下载项目备份'));
    expect(imported.id).not.toBe(saved.id);
    expect(imported.viewer.rate).toBe(rate);
    expect(imported.project).toEqual({ ...saved.project, teacherCheckedRevision: null });
    const importedAudioHash = await page.locator('audio').evaluate(async (audio: HTMLAudioElement) => {
      const bytes = await (await fetch(audio.src)).arrayBuffer();
      return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), byte => byte.toString(16).padStart(2, '0')).join('');
    });
    expect(importedAudioHash).toBe(createHash('sha256').update(bundle.audio).digest('hex'));
    await page.getByRole('button', { name: '播放', exact: true }).click();
    await expect.poll(() => page.locator('audio').evaluate((audio: HTMLAudioElement) => audio.paused)).toBe(false);
    expect(await page.locator('audio').evaluate((audio: HTMLAudioElement) => audio.playbackRate)).toBe(rate);
    await page.getByRole('button', { name: '暂停', exact: true }).click();
  });
}
