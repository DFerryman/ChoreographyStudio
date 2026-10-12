import { createHash } from 'node:crypto';
import { deepStrictEqual } from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { clickRevealed, closeDisclosures, reveal, seekSeconds } from './helpers';
import { bakeKeyframeSequence, makeKeyframeSequence, sampleTake, upsertMotionPointChanges, type BakedTake } from '../packages/core/src';
import { unpackScene } from '../apps/web/src/compactScene';

// Independent legacy-compatible scene: a non-uniform base, moving Root and
// Head arc expose accidental rebaking or data loss during local backup import.
const joints = [
  'Hips', 'Spine', 'Chest', 'Neck', 'Head',
  'LeftShoulder', 'LeftUpperArm', 'LeftForeArm', 'LeftHand', 'LeftHandTip',
  'RightShoulder', 'RightUpperArm', 'RightForeArm', 'RightHand', 'RightHandTip',
  'LeftUpperLeg', 'LeftLowerLeg', 'LeftFoot', 'LeftToe', 'LeftHeel',
  'RightUpperLeg', 'RightLowerLeg', 'RightFoot', 'RightToe', 'RightHeel',
] as const;
type Joint = typeof joints[number];
type Vec3 = [number, number, number];
type Quat = [number, number, number, number];
type Pose = { root: Vec3; joints: Record<Joint, Quat> };
type Take = { id: string; schemaVersion: string; planId: string; countMapId: string; durationSeconds: number; times: number[]; poses: Pose[]; provenance: string };
type Sequence = { schema: 'manual-keyframes-1'; id: string; fps: 30; baseTake: Take; rotations: Partial<Record<Joint, { frame: number; rotation: Quat }[]>>; root: { frame: number; position: Vec3 }[]; pointEdits?: { time: number; root?: Vec3; joints?: Partial<Record<Joint, Quat>> }[] };
type Snapshot = { title: string; countMap: { id: string; durationSeconds: number }; plan: unknown; take: Take; manual?: Sequence; cameraTrack?: { keys: { time: number }[] }; operation?: { label: string; time?: number; tracks?: ('root' | 'camera' | Joint)[] } };
type Backup = { scene: { id: string; name: string; audioName: string; project: { historyIndex: number; history: Snapshot[]; revision: number; teacherCheckedRevision: number | null }; viewer: { time: number; selectedJoint: Joint | null; editorMode?: string; view: string; mirror: boolean; camera: { position: Vec3; target: Vec3; zoom?: number } } } };
const current = (document: Backup) => document.scene.project.history[document.scene.project.historyIndex];
const diagnostics = new WeakMap<Page, { errors: string[]; warnings: string[]; apiRequests: string[] }>();

test.beforeEach(async ({ page }) => {
  const messages = { errors: [] as string[], warnings: [] as string[], apiRequests: [] as string[] };
  diagnostics.set(page, messages);
  page.on('pageerror', error => messages.errors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error') messages.errors.push(message.text());
    if (message.type() === 'warning') messages.warnings.push(message.text());
  });
  page.on('request', request => { if (new URL(request.url()).pathname.startsWith('/api/')) messages.apiRequests.push(`${request.method()} ${request.url()}`); });
  page.on('dialog', dialog => { void (dialog.type() === 'beforeunload' ? dialog.accept() : dialog.dismiss()); });
});
test.afterEach(async ({ page }, testInfo) => {
  const messages = diagnostics.get(page)!;
  await testInfo.attach('browser-console-and-api', { body: JSON.stringify(messages), contentType: 'application/json' });
  expect(messages.errors, 'Browser runtime errors').toEqual([]);
  expect(messages.warnings, 'Browser warnings').toEqual([]);
  expect(messages.apiRequests, 'Backup export/import and local scene transactions must stay in the browser').toEqual([]);
});

function fixture() {
  const countMap = { id: 'backup-count-map', version: 1, bpm: 120, musicBeatsPerDanceCount: 1, firstCountSourceSeconds: 1, sourceOffsetSeconds: 1, durationSeconds: 16, octetCount: 4, countTimesSeconds: Array.from({ length: 33 }, (_, i) => i * 0.5), confirmed: true };
  const plan = {
    id: 'backup-plan', countMapId: countMap.id, durationSeconds: 16, provenance: 'synthetic-demo',
    slots: ['step-touch', 'side-reach', 'groove', 'settle'].map((actionId, slotIndex) => ({ slotIndex, actionId, label: '原创备份回归样例', teachingCue: '本地回归', startSeconds: slotIndex * 4, endSeconds: (slotIndex + 1) * 4, countStart: slotIndex * 8 + 1, countEnd: (slotIndex + 1) * 8, role: slotIndex === 0 ? 'opening' : slotIndex === 3 ? 'closing' : 'body' })),
  };
  const times = [0, 0.7, 2.5, 4, 8, 12, 16];
  const poses = times.map((time): Pose => ({ root: [time / 80, 1.05, 0], joints: Object.fromEntries(joints.map(joint => [joint, joint === 'Head' ? [0, Math.sin(time / 160), 0, Math.cos(time / 160)] : [0, 0, 0, 1]])) as Record<Joint, Quat> }));
  const base: Take = { id: 'backup-base-take', schemaVersion: 'preview-1', planId: plan.id, countMapId: countMap.id, durationSeconds: 16, times, poses, provenance: 'synthetic-demo' };
  // Existing character authoring (from before the AI-only workflow) is hidden
  // from the Timeline but must remain scene data through every local transfer.
  let manual = makeKeyframeSequence(base as BakedTake, { pointInterpolation: 'hold-last-key-1' });
  const before = sampleTake(base as BakedTake, 2.5), after = structuredClone(before);
  after.joints.LeftUpperArm = [0, 0, Math.sin(.3), Math.cos(.3)]; after.root = [1.2, 1.05, 0];
  manual = upsertMotionPointChanges(manual, 2.5, before, after, base as BakedTake);
  const take = bakeKeyframeSequence(manual) as unknown as Take;
  const scene = {
    schema: 'choreo-scene-1', id: 'backup-local-scene', name: '场景备份回归场景', createdAt: '2026-10-07T06:00:00.000Z', updatedAt: '2026-10-07T06:00:00.000Z',
    coordinateSystem: { handedness: 'right', upAxis: '+Y', forwardAxis: '+Z', units: 'm', floorPlane: 'XZ', origin: [0, 0, 0] },
    actor: { id: 'actor-1', rigId: 'synthetic-skeleton-1', provenance: 'synthetic-demo', joints: [...joints] },
    project: { history: [{ title: '场景备份回归场景', countMap, plan, take, manual }], historyIndex: 0, revision: 1, audioDuration: 20, teacherCheckedRevision: 1 },
    audioName: 'original-backup-local.wav',
    viewer: { camera: null, view: 'front', mirror: false, rate: 1, loop: false, countSound: false, selectedSlot: 0, selectedJoint: null, time: 0 },
  };
  const sampleRate = 8000, samples = sampleRate * 20, wave = Buffer.alloc(44 + samples * 2);
  wave.write('RIFF', 0); wave.writeUInt32LE(36 + samples * 2, 4); wave.write('WAVE', 8);
  wave.write('fmt ', 12); wave.writeUInt32LE(16, 16); wave.writeUInt16LE(1, 20); wave.writeUInt16LE(1, 22);
  wave.writeUInt32LE(sampleRate, 24); wave.writeUInt32LE(sampleRate * 2, 28); wave.writeUInt16LE(2, 32); wave.writeUInt16LE(16, 34);
  wave.write('data', 36); wave.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i++) wave.writeInt16LE(Math.round(Math.sin(i / sampleRate * Math.PI * 2 * 440) * 1500), 44 + i * 2);
  return { scene, take, base, manual: manual as unknown as Sequence, wave };
}
async function ready(page: Page) {
  await expect(page.getByRole('button', { name: '播放', exact: true })).toBeEnabled();
  // Match the shared harness's native media activation without changing the
  // authored scene or starting playback in headless Chromium.
  await page.locator('.project-title h1').click();
  await expect(page.getByLabel('相机世界坐标')).not.toContainText('—');
  await expect.poll(() => page.locator('audio').evaluate((audio: HTMLAudioElement) => audio.readyState)).toBeGreaterThanOrEqual(2);
}
async function openScene(page: Page) {
  const source = fixture();
  await page.goto('/'); await ready(page);
  await page.evaluate(async ({ scene, bytes }) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('choreo-studio-preview', 2);
      request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
    });
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(['scenes', 'sceneIndex', 'sceneMeta'], 'readwrite');
      tx.objectStore('scenes').put({ ...scene, audio: new Blob([new Uint8Array(bytes)], { type: 'audio/wav' }) }, scene.id);
      const { schema, id, name, createdAt, updatedAt, audioName } = scene;
      tx.objectStore('sceneIndex').put({ schema, id, name, createdAt, updatedAt, audioName }, id);
      tx.objectStore('sceneMeta').put(id, 'currentSceneId'); tx.objectStore('sceneMeta').put(true, 'legacyProjectMigrated');
      tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error);
    });
    db.close();
  }, { scene: source.scene, bytes: Array.from(source.wave) });
  await page.reload(); await ready(page);
  await expect(page.locator('.project-title h1')).toHaveText(source.scene.name);
  const opened = current(await backup(page));
  deepStrictEqual(opened.take, source.take);
  deepStrictEqual(opened.manual, source.manual);
  const timeline = page.getByRole('region', { name: '场景时间线', exact: true });
  await expect(timeline).toBeVisible();
  // Character channels are retained in the scene but never shown as tracks.
  expect(await timeline.locator('[data-track-id]').evaluateAll(rows => rows.map(row => row.getAttribute('data-track-id')))).toEqual(['counts', 'audio', 'camera']);
  return source;
}
async function backup(page: Page): Promise<Backup> {
  const pending = page.waitForEvent('download');
  await clickRevealed(page, page.getByRole('button', { name: '下载项目备份', exact: true, includeHidden: true }));
  const path = await (await pending).path(); expect(path).toBeTruthy();
  const wire = JSON.parse(await readFile(path!, 'utf8'));
  expect(wire.format).toBe('choreo-scene-backup-2');
  const document = { ...wire, scene: unpackScene(wire.scene) } as Backup;
  await closeDisclosures(page, '.studio-more, .studio-more .backup-menu');
  return document;
}
async function frame(page: Page, value: number) {
  await closeDisclosures(page);
  await seekSeconds(page, value / 30);
  await expect(page.getByRole('region', { name: '场景时间线', exact: true })).toHaveAttribute('data-time', String(value / 30));
}
/** Record the current view as a Camera key: the remaining keyed edit. */
async function cameraPoint(page: Page, keyFrame: number) {
  await frame(page, keyFrame);
  await page.getByRole('button', { name: '在当前时间记录镜头', exact: true }).click();
  await expect(page.getByRole('region', { name: '场景时间线', exact: true }).locator(`.tl-key[data-time="${keyFrame / 30}"]`)).toHaveCount(1);
  expect(current(await backup(page)).operation?.tracks).toEqual(['camera']);
}
const importDialog = (page: Page) => page.getByRole('dialog', { name: '导入场景备份', exact: true });
const importConfirm = (page: Page) => importDialog(page).getByRole('button', { name: '作为新场景导入', exact: true });
const unsaved = (page: Page) => page.getByRole('dialog', { name: '保留当前场景的修改？', exact: true });

async function save(page: Page) {
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.locator('.save-state')).toHaveText('已保存到本机');
}
async function bundle(page: Page) {
  const pending = page.waitForEvent('download');
  await clickRevealed(page, page.getByRole('button', { name: '下载完整场景包', exact: true, includeHidden: true }));
  const downloaded = await pending, path = await downloaded.path();
  expect(downloaded.suggestedFilename()).toMatch(/\.choreo$/);
  expect(path).toBeTruthy();
  const bytes = await readFile(path!);
  await closeDisclosures(page, '.studio-more, .studio-more .backup-menu');
  return bytes;
}
async function openImport(page: Page) {
  await page.getByRole('button', { name: '场景', exact: true }).click();
  await page.getByRole('dialog', { name: '本机场景', exact: true }).getByRole('button', { name: '导入场景备份', exact: true }).click();
  await expect(importDialog(page)).toBeVisible();
}
async function chooseBackup(page: Page, bytes: Buffer, name = 'original-scene.choreo') {
  await importDialog(page).getByLabel('选择场景备份文件', { exact: true }).setInputFiles({ name, mimeType: name.endsWith('.json') ? 'application/json' : 'application/octet-stream', buffer: bytes });
}
async function audioHash(page: Page) {
  return page.locator('audio').evaluate(async (audio: HTMLAudioElement) => {
    const bytes = await (await fetch(audio.src)).arrayBuffer();
    return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), byte => byte.toString(16).padStart(2, '0')).join('');
  });
}
async function localState(page: Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('choreo-studio-preview', 2);
      request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
    });
    return new Promise<{ ids: string[]; currentId: string }>((resolve, reject) => {
      const tx = db.transaction(['scenes', 'sceneMeta'], 'readonly');
      const keys = tx.objectStore('scenes').getAllKeys(), currentId = tx.objectStore('sceneMeta').get('currentSceneId');
      tx.oncomplete = () => { db.close(); resolve({ ids: keys.result.map(String).sort(), currentId: String(currentId.result) }); };
      tx.onerror = () => { db.close(); reject(tx.error); };
    });
  });
}
async function watchWrites(page: Page) {
  await page.evaluate(() => {
    const original = IDBDatabase.prototype.transaction;
    const state = window as unknown as { backupWriteCount: number; restoreBackupTransactions: () => void };
    state.backupWriteCount = 0;
    state.restoreBackupTransactions = () => { IDBDatabase.prototype.transaction = original; };
    IDBDatabase.prototype.transaction = function (...args: Parameters<IDBDatabase['transaction']>) {
      if (args[1] === 'readwrite') state.backupWriteCount++;
      return original.apply(this, args);
    };
  });
}
async function restoreTransactions(page: Page) { await page.evaluate(() => (window as unknown as { restoreBackupTransactions: () => void }).restoreBackupTransactions()); }
function rawBundle(bytes: Buffer) {
  // Independently inspect the documented binary envelope, rather than using
  // the encoder/decoder under test to prove its own output.
  const magic = Buffer.from('CHOREO-BUNDLE-1\n', 'utf8');
  deepStrictEqual(bytes.subarray(0, magic.length), magic);
  const headerLength = bytes.readUInt32LE(magic.length);
  const header = JSON.parse(bytes.subarray(magic.length + 4, magic.length + 4 + headerLength).toString('utf8'));
  const audio = bytes.subarray(magic.length + 4 + headerLength);
  expect(header.format).toBe('choreo-scene-bundle-2'); expect(header.scene.schema).toBe('compact-scene-1');
  expect(header.scene.takes.length).toBeGreaterThan(0);
  expect(header.audio.byteLength).toBe(audio.length);
  expect(header.audio.sha256).toBe(createHash('sha256').update(audio).digest('hex'));
  return { header: { ...header, scene: unpackScene(header.scene) }, audio };
}
async function capture(page: Page, name: string) {
  if (!process.env.CHOREO_SCREENSHOT_DIR) return;
  await mkdir(process.env.CHOREO_SCREENSHOT_DIR, { recursive: true });
  await page.screenshot({ path: join(process.env.CHOREO_SCREENSHOT_DIR, name), fullPage: true });
}

test('@backup compact full scene bundles round-trip retained character data, camera edits, exact original audio, non-uniform animation, history and camera into a new local scene', async ({ page }) => {
  test.setTimeout(180_000);
  const source = await openScene(page);
  await cameraPoint(page, 30); await cameraPoint(page, 75); await cameraPoint(page, 120);
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  await frame(page, 75);
  await page.getByRole('button', { name: '背面', exact: true }).click();
  const speed = page.getByRole('combobox', { name: '播放速度', exact: true, includeHidden: true });
  await reveal(page, speed); await speed.selectOption('0.5');
  await closeDisclosures(page, '.tl-more');
  await clickRevealed(page, page.getByRole('button', { name: '教学预览', exact: true, includeHidden: true }));
  await page.getByRole('button', { name: '标记本版已试看', exact: true }).click();
  await save(page);
  const original = await backup(page), savedState = await localState(page), bytes = await bundle(page);
  expect(original.scene.project.teacherCheckedRevision).toBe(original.scene.project.revision);
  const inspected = rawBundle(bytes);
  deepStrictEqual(inspected.audio, source.wave);
  deepStrictEqual(inspected.header.scene.project, original.scene.project);
  deepStrictEqual(inspected.header.scene.viewer, original.scene.viewer);
  expect(inspected.header.scene.audio).toBeUndefined();
  expect(inspected.header.scene.poseClipboard).toBeUndefined(); expect(inspected.header.scene.poseDraft).toBeUndefined();
  await openImport(page); await chooseBackup(page, bytes);
  await expect(importConfirm(page)).toBeEnabled();
  await importDialog(page).getByLabel('导入后的场景名称', { exact: true }).fill('原音乐与手 K · 导入副本');
  await capture(page, 'choreo-backup-desktop.png');
  await importConfirm(page).click();
  await expect(importDialog(page)).toHaveCount(0); await expect(page.locator('.project-title h1')).toHaveText('原音乐与手 K · 导入副本');
  await expect(page.locator('.save-state')).toHaveText('已保存到本机');
  const imported = await backup(page), after = await localState(page);
  expect(imported.scene.id).not.toBe(original.scene.id);
  expect(after.ids).toEqual([...savedState.ids, imported.scene.id].sort()); expect(after.currentId).toBe(imported.scene.id);
  deepStrictEqual(imported.scene.project, { ...original.scene.project, teacherCheckedRevision: null });
  deepStrictEqual(imported.scene.viewer, original.scene.viewer);
  deepStrictEqual(current(imported).manual, source.manual);
  deepStrictEqual(current(imported).take, source.take);
  expect(current(imported).cameraTrack!.keys.map(key => key.time)).toEqual([1, 2.5]);
  expect(await audioHash(page)).toBe(createHash('sha256').update(source.wave).digest('hex'));
  await page.reload(); await ready(page);
  const restored = await backup(page); deepStrictEqual(restored.scene, imported.scene);
  expect(await audioHash(page)).toBe(createHash('sha256').update(source.wave).digest('hex'));
  await page.getByRole('button', { name: '场景', exact: true }).click();
  await page.getByRole('dialog', { name: '本机场景', exact: true }).getByRole('button', { name: `打开场景 ${original.scene.name}`, exact: true }).click();
  await expect(page.locator('.project-title h1')).toHaveText(original.scene.name);
  deepStrictEqual((await backup(page)).scene.project, original.scene.project);
  expect(await audioHash(page)).toBe(createHash('sha256').update(source.wave).digest('hex'));
});

test('@backup malformed, oversized-header, truncated and tampered bundles perform no writes; legacy JSON requires explicit original music relinking', async ({ page }) => {
  test.setTimeout(210_000);
  const source = await openScene(page);
  await cameraPoint(page, 75); await save(page);
  const original = await backup(page), bytes = await bundle(page), state = await localState(page);
  const oversizedHeader = Buffer.from(bytes); oversizedHeader.writeUInt32LE(32 * 1024 * 1024 + 1, 16);
  const badDigest = Buffer.from(bytes); badDigest[badDigest.length - 1] ^= 1;
  const badMagic = Buffer.from(bytes); badMagic[0] ^= 1;
  await watchWrites(page); await openImport(page);
  const invalid = [
    { name: 'malformed.json', bytes: Buffer.from('{broken-json') },
    { name: 'unsupported-magic.choreo', bytes: badMagic },
    { name: 'oversized-header.choreo', bytes: oversizedHeader },
    { name: 'truncated.choreo', bytes: bytes.subarray(0, bytes.length - 1) },
    { name: 'wrong-audio-digest.choreo', bytes: badDigest },
  ];
  for (const entry of invalid) {
    await chooseBackup(page, entry.bytes, entry.name);
    await expect(importDialog(page).getByRole('alert')).toBeVisible(); await expect(importConfirm(page)).toBeDisabled();
    expect(await localState(page)).toEqual(state);
    expect(await page.evaluate(() => (window as unknown as { backupWriteCount: number }).backupWriteCount)).toBe(0);
    await expect(page.locator('.project-title h1')).toHaveText(original.scene.name);
  }
  await restoreTransactions(page);
  const legacy = Buffer.from(JSON.stringify({ format: 'choreo-scene-backup-1', scene: original.scene, audioIncluded: false }));
  await chooseBackup(page, legacy, 'legacy-no-audio.json');
  await expect(importDialog(page).getByLabel('重新关联原音乐', { exact: true })).toBeVisible();
  await expect(importConfirm(page)).toBeDisabled();
  await importDialog(page).getByLabel('重新关联原音乐', { exact: true }).setInputFiles({ name: 'original-backup-local.wav', mimeType: 'audio/wav', buffer: source.wave });
  await expect(importConfirm(page)).toBeEnabled();
  await importConfirm(page).click(); await expect(importDialog(page)).toHaveCount(0);
  const imported = await backup(page);
  expect(imported.scene.id).not.toBe(original.scene.id);
  deepStrictEqual(imported.scene.project, { ...original.scene.project, teacherCheckedRevision: null });
  deepStrictEqual(current(imported).manual, source.manual);
  expect(await audioHash(page)).toBe(createHash('sha256').update(source.wave).digest('hex'));

  // Simulate an existing local scene whose music blob has become unavailable.
  // Loading it must preserve its formal work instead of substituting demo music.
  await page.evaluate(async id => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('choreo-studio-preview', 2);
      request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
    });
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(['scenes'], 'readwrite'), store = tx.objectStore('scenes'), request = store.get(id);
      request.onsuccess = () => store.put({ ...request.result, audio: null }, id);
      tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error);
    });
    db.close();
  }, imported.scene.id);
  await page.reload();
  await expect(page.locator('.project-title h1')).toHaveText(imported.scene.name);
  await expect(page.getByLabel('相机世界坐标')).not.toContainText('—');
  await expect(page.getByRole('alert').filter({ hasText: '原音乐缺失' })).toBeVisible();
  await expect(page.getByRole('button', { name: '播放', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: '保存', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: '下载完整场景包', exact: true, includeHidden: true })).toBeDisabled();
  expect(await page.locator('audio').evaluate((audio: HTMLAudioElement) => ({ src: audio.getAttribute('src'), currentSrc: audio.currentSrc }))).toEqual({ src: null, currentSrc: '' });
  const missing = await backup(page);
  expect(missing.scene.id).toBe(imported.scene.id); deepStrictEqual(missing.scene.project, imported.scene.project);
  const beforeRecovery = await localState(page);
  await cameraPoint(page, 120);
  const latest = await backup(page);
  expect(latest.scene.project.history).toHaveLength(imported.scene.project.history.length + 1);
  await page.getByRole('button', { name: '恢复原音乐', exact: true }).click();
  await expect(importDialog(page)).toBeVisible(); await expect(importConfirm(page)).toBeDisabled();
  const musicInput = importDialog(page).getByLabel('重新关联原音乐', { exact: true });
  await expect(musicInput).toBeVisible();
  // A valid 18-second WAV covers the selection but does not match the saved
  // 20-second original, so duration verification must still reject it.
  const wrongDuration = Buffer.from(source.wave.subarray(0, 44 + 8000 * 18 * 2));
  wrongDuration.writeUInt32LE(wrongDuration.length - 8, 4); wrongDuration.writeUInt32LE(wrongDuration.length - 44, 40);
  await musicInput.setInputFiles({ name: 'wrong-duration.wav', mimeType: 'audio/wav', buffer: wrongDuration });
  await expect(importDialog(page).getByRole('alert')).toContainText('时长'); await expect(importConfirm(page)).toBeDisabled();
  expect(await localState(page)).toEqual(beforeRecovery);
  await musicInput.setInputFiles({ name: 'original-backup-local.wav', mimeType: 'audio/wav', buffer: source.wave });
  await expect(importConfirm(page)).toBeEnabled(); await importConfirm(page).click();
  await expect(unsaved(page)).toBeVisible();
  await expect(unsaved(page).getByRole('button', { name: '保存后继续', exact: true })).toBeDisabled();
  await unsaved(page).getByRole('button', { name: '不保存，继续', exact: true }).click();
  await expect(importDialog(page)).toHaveCount(0); await ready(page);
  const recovered = await backup(page);
  expect(recovered.scene.id).not.toBe(missing.scene.id);
  deepStrictEqual(recovered.scene.project.history.slice(0, imported.scene.project.history.length), imported.scene.project.history);
  expect(recovered.scene.project.history).toHaveLength(imported.scene.project.history.length + 1);
  expect(recovered.scene.project.historyIndex).toBe(imported.scene.project.historyIndex + 1);
  expect(recovered.scene.project.revision).toBe(imported.scene.project.revision + 1); expect(recovered.scene.project.teacherCheckedRevision).toBeNull();
  expect(current(recovered).countMap).toEqual(current(imported).countMap); expect(current(recovered).plan).toEqual(current(imported).plan);
  // Recovery keeps the retained character data exactly; only the camera changed.
  deepStrictEqual(current(recovered).take, source.take); deepStrictEqual(current(recovered).manual, source.manual);
  expect(current(recovered).cameraTrack!.keys.map(key => key.time)).toEqual([2.5, 4]);
  deepStrictEqual(recovered.scene.project, { ...latest.scene.project, teacherCheckedRevision: null });
  deepStrictEqual(recovered.scene.viewer, { ...imported.scene.viewer, time: 4 });
  expect(await audioHash(page)).toBe(createHash('sha256').update(source.wave).digest('hex'));
  expect((await localState(page)).ids).toEqual([...beforeRecovery.ids, recovered.scene.id].sort());
  deepStrictEqual(await page.evaluate(async id => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('choreo-studio-preview', 2);
      request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
    });
    return new Promise<{ audioMissing: boolean; project: unknown }>((resolve, reject) => {
      const tx = db.transaction(['scenes'], 'readonly'), request = tx.objectStore('scenes').get(id);
      tx.oncomplete = () => { db.close(); resolve({ audioMissing: request.result.audio === null, project: request.result.project }); }; tx.onerror = () => { db.close(); reject(tx.error); };
    });
  }, missing.scene.id), { audioMissing: true, project: imported.scene.project });
});

test('@backup mobile export captures camera edits with retained character data and preserves current scenes through import cancellation and quota failure, then retries once as a new scene', async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 390, height: 844 });
  const source = await openScene(page); await cameraPoint(page, 75);
  const original = await backup(page);
  deepStrictEqual(current(original).manual, source.manual);
  expect(current(original).cameraTrack!.keys.map(key => key.time)).toEqual([2.5]);
  await save(page);
  const bytes = await bundle(page);
  deepStrictEqual(rawBundle(bytes).audio, source.wave);
  deepStrictEqual(rawBundle(bytes).header.scene.project, original.scene.project);
  await closeDisclosures(page, '.studio-more, .studio-more .backup-menu');
  await cameraPoint(page, 120);
  await openImport(page); await chooseBackup(page, bytes);
  await expect(importConfirm(page)).toBeEnabled();
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    expect((await importConfirm(page).boundingBox())!.height).toBeGreaterThanOrEqual(44);
  }
  await importConfirm(page).click();
  await expect(unsaved(page)).toBeVisible();
  await unsaved(page).getByRole('button', { name: '取消', exact: true }).click();
  await expect(importDialog(page)).toBeVisible();
  const beforeFailure = await localState(page);
  await page.evaluate(() => {
    const original = IDBDatabase.prototype.transaction;
    (window as unknown as { restoreBackupTransactions: () => void }).restoreBackupTransactions = () => { IDBDatabase.prototype.transaction = original; };
    IDBDatabase.prototype.transaction = function (...args: Parameters<IDBDatabase['transaction']>) {
      if (args[1] === 'readwrite') throw new DOMException('Simulated storage quota', 'QuotaExceededError');
      return original.apply(this, args);
    };
  });
  await importConfirm(page).click(); await expect(unsaved(page)).toBeVisible();
  await unsaved(page).getByRole('button', { name: '不保存，继续', exact: true }).click();
  await expect(importDialog(page).getByRole('alert')).toBeVisible();
  await expect(page.locator('.project-title h1')).toHaveText(original.scene.name);
  expect(await localState(page)).toEqual(beforeFailure);
  await restoreTransactions(page);
  if (await unsaved(page).isVisible()) await unsaved(page).getByRole('button', { name: '取消', exact: true }).click();
  await importConfirm(page).click();
  if (await unsaved(page).isVisible()) await unsaved(page).getByRole('button', { name: '不保存，继续', exact: true }).click();
  await expect(importDialog(page)).toHaveCount(0); await expect(page.locator('.save-state')).toHaveText('已保存到本机');
  const imported = await backup(page); expect(imported.scene.id).not.toBe(original.scene.id);
  deepStrictEqual(imported.scene.project, { ...original.scene.project, teacherCheckedRevision: null });
  expect(await audioHash(page)).toBe(createHash('sha256').update(source.wave).digest('hex'));
  expect((await localState(page)).ids).toEqual([...beforeFailure.ids, imported.scene.id].sort());
  await page.setViewportSize({ width: 390, height: 844 }); await capture(page, 'choreo-backup-mobile.png');
});
