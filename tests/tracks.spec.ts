import { createHash } from 'node:crypto';
import { mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { clickRevealed, reveal } from './helpers';

// Independent v4 scene: a non-uniform base, moving Root, and an untouched
// Head arc make a mistaken whole-pose delete visible in exported motion.
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
type Sequence = { schema: 'manual-keyframes-1'; id: string; fps: 30; baseTake: Take; rotations: Partial<Record<Joint, { frame: number; rotation: Quat }[]>>; root: { frame: number; position: Vec3 }[] };
type Snapshot = { title: string; countMap: { id: string; durationSeconds: number }; plan: unknown; take: Take; manual?: Sequence };
type Backup = { scene: { id: string; name: string; audioName: string; project: { historyIndex: number; history: Snapshot[]; revision: number; teacherCheckedRevision: number | null }; viewer: { time: number; selectedJoint: Joint | null; editorMode?: string } } };
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
  expect(messages.apiRequests, 'Track editing, navigation and saving must stay in the browser').toEqual([]);
});

function fixture() {
  const countMap = { id: 'tracks-count-map', version: 1, bpm: 120, musicBeatsPerDanceCount: 1, firstCountSourceSeconds: 1, sourceOffsetSeconds: 1, durationSeconds: 16, octetCount: 4, countTimesSeconds: Array.from({ length: 33 }, (_, i) => i * 0.5), confirmed: true };
  const plan = {
    id: 'tracks-plan', countMapId: countMap.id, durationSeconds: 16, provenance: 'synthetic-demo',
    slots: ['step-touch', 'side-reach', 'groove', 'settle'].map((actionId, slotIndex) => ({ slotIndex, actionId, label: '原创轨道回归样例', teachingCue: '本地回归', startSeconds: slotIndex * 4, endSeconds: (slotIndex + 1) * 4, countStart: slotIndex * 8 + 1, countEnd: (slotIndex + 1) * 8, role: slotIndex === 0 ? 'opening' : slotIndex === 3 ? 'closing' : 'body' })),
  };
  const times = [0, 0.7, 2.5, 4, 8, 12, 16];
  const poses = times.map((time): Pose => ({ root: [time / 80, 1.05, 0], joints: Object.fromEntries(joints.map(joint => [joint, joint === 'Head' ? [0, Math.sin(time / 160), 0, Math.cos(time / 160)] : [0, 0, 0, 1]])) as Record<Joint, Quat> }));
  const take: Take = { id: 'tracks-base-take', schemaVersion: 'preview-1', planId: plan.id, countMapId: countMap.id, durationSeconds: 16, times, poses, provenance: 'synthetic-demo' };
  const scene = {
    schema: 'choreo-scene-1', id: 'tracks-local-scene', name: '手 K 轨道回归场景', createdAt: '2026-10-07T06:00:00.000Z', updatedAt: '2026-10-07T06:00:00.000Z',
    coordinateSystem: { handedness: 'right', upAxis: '+Y', forwardAxis: '+Z', units: 'm', floorPlane: 'XZ', origin: [0, 0, 0] },
    actor: { id: 'actor-1', rigId: 'synthetic-skeleton-1', provenance: 'synthetic-demo', joints: [...joints] },
    project: { history: [{ title: '手 K 轨道回归场景', countMap, plan, take }], historyIndex: 0, revision: 1, audioDuration: 20, teacherCheckedRevision: 1 },
    audioName: 'original-tracks-local.wav',
    viewer: { camera: null, view: 'front', mirror: false, rate: 1, loop: false, countSound: false, selectedSlot: 0, selectedJoint: null, time: 0 },
  };
  const sampleRate = 8000, samples = sampleRate * 20, wave = Buffer.alloc(44 + samples * 2);
  wave.write('RIFF', 0); wave.writeUInt32LE(36 + samples * 2, 4); wave.write('WAVE', 8);
  wave.write('fmt ', 12); wave.writeUInt32LE(16, 16); wave.writeUInt16LE(1, 20); wave.writeUInt16LE(1, 22);
  wave.writeUInt32LE(sampleRate, 24); wave.writeUInt32LE(sampleRate * 2, 28); wave.writeUInt16LE(2, 32); wave.writeUInt16LE(16, 34);
  wave.write('data', 36); wave.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i++) wave.writeInt16LE(Math.round(Math.sin(i / sampleRate * Math.PI * 2 * 440) * 1500), 44 + i * 2);
  return { scene, take, wave };
}
async function ready(page: Page) {
  await expect(page.getByRole('button', { name: '播放', exact: true })).toBeEnabled();
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
  expect(current(await backup(page)).take).toEqual(source.take);
  await page.getByRole('button', { name: '手动 K帧', exact: true }).click();
  await expect(page.getByRole('region', { name: '手动关键帧编辑器', exact: true })).toBeVisible();
  return source;
}
async function backup(page: Page): Promise<Backup> {
  const pending = page.waitForEvent('download');
  await clickRevealed(page, page.getByRole('button', { name: '下载项目备份', exact: true, includeHidden: true }));
  const path = await (await pending).path(); expect(path).toBeTruthy();
  return JSON.parse(await readFile(path!, 'utf8')) as Backup;
}
async function numeric(page: Page, label: string, value: number) {
  const input = page.getByRole('spinbutton', { name: label, exact: true });
  await input.fill(String(value)); await input.press('Tab');
}
async function frame(page: Page, value: number) {
  await numeric(page, '当前帧', value);
  await expect(page.getByRole('spinbutton', { name: '当前帧', exact: true })).toHaveValue(String(value));
}
async function joint(page: Page, value: Joint | '') { await page.getByRole('combobox', { name: '选择关节', exact: true }).selectOption(value); }
async function rotationKey(page: Page, keyFrame: number, name: Joint, degrees: number) {
  await frame(page, keyFrame); await joint(page, name); await numeric(page, '关节 Z 旋转（度）', degrees);
  await page.getByRole('button', { name: 'K 当前关节', exact: true }).click(); await expect(draft(page)).toHaveCount(0);
}
async function rootKey(page: Page, keyFrame: number, x: number) {
  await frame(page, keyFrame); await numeric(page, 'Root X 位移（米）', x);
  await page.getByRole('button', { name: 'K 位移', exact: true }).click(); await expect(draft(page)).toHaveCount(0);
}
const draft = (page: Page) => page.getByRole('status').filter({ hasText: '姿态草稿 · 尚未写入关键帧' });
const guard = (page: Page) => page.getByRole('dialog', { name: '写入这份姿态草稿？', exact: true });
const timeline = (page: Page) => page.getByRole('region', { name: '手动关键帧时间线', exact: true });
async function visibleFrames(page: Page, expected: number[]) {
  await expect(timeline(page).getByRole('listitem')).toHaveCount(expected.length);
  expect(await timeline(page).getByRole('listitem').evaluateAll(items => items.map(item => item.getAttribute('aria-label')))).toEqual(expected.map(value => `第 ${value} 帧关键帧`));
  await expect(timeline(page).getByRole('button', { name: /^跳到第 \d+ 帧关键帧$/ })).toHaveCount(expected.length);
}
async function unchanged(page: Page, snapshot: Snapshot) { expect(current(await backup(page))).toEqual(snapshot); }
async function capture(page: Page, name: string) {
  const directory = process.env.CHOREO_SCREENSHOT_DIR;
  if (!directory) return;
  await mkdir(directory, { recursive: true });
  await timeline(page).scrollIntoViewIfNeeded();
  await page.screenshot({ path: join(directory, name), fullPage: true });
}

test('@tracks deleting one joint at a shared frame restores that base track and preserves the other joint, Root, version history and undo', async ({ page }) => {
  test.setTimeout(180_000);
  const source = await openScene(page);
  await rotationKey(page, 90, 'LeftUpperArm', 70);
  await rotationKey(page, 90, 'RightUpperArm', -40);
  await rootKey(page, 90, 1.3); await joint(page, 'LeftUpperArm');
  const before = await backup(page), authored = current(before);
  await clickRevealed(page, page.getByRole('button', { name: '删除当前关节 K', exact: true, includeHidden: true }));
  const after = await backup(page), removed = current(after);
  expect(removed.manual!.rotations.LeftUpperArm).toBeUndefined();
  expect(removed.manual!.rotations.RightUpperArm).toEqual(authored.manual!.rotations.RightUpperArm);
  expect(removed.manual!.root).toEqual(authored.manual!.root);
  expect(removed.manual!.baseTake).toEqual(source.take);
  expect(removed.take.id).not.toBe(authored.take.id); expect(removed.manual!.id).not.toBe(authored.manual!.id);
  expect(after.scene.project.revision).toBe(before.scene.project.revision + 1);
  expect(after.scene.project.historyIndex).toBe(before.scene.project.historyIndex + 1);
  expect(after.scene.project.history).toHaveLength(before.scene.project.history.length + 1);
  expect(removed.countMap).toEqual(authored.countMap); expect(removed.plan).toEqual(authored.plan);
  expect(removed.take.times).toEqual(authored.take.times);
  for (const [index, pose] of removed.take.poses.entries()) {
    expect(pose.joints.LeftUpperArm).toEqual([0, 0, 0, 1]);
    expect(pose.joints.RightUpperArm).toEqual(authored.take.poses[index].joints.RightUpperArm);
    expect(pose.root).toEqual(authored.take.poses[index].root);
  }
  for (const [index, time] of source.take.times.entries()) expect(removed.take.poses[removed.take.times.indexOf(time)].joints.Head).toEqual(source.take.poses[index].joints.Head);
  await expect(page.getByRole('button', { name: '删除当前关节 K', exact: true, includeHidden: true })).toBeDisabled();
  await page.getByRole('button', { name: '撤销', exact: true }).click(); await unchanged(page, authored);
  if (process.env.CHOREO_SCREENSHOT_DIR) await frame(page, 90);
  await capture(page, 'choreo-tracks-desktop.png');
  await page.getByRole('button', { name: '重做', exact: true }).click(); await unchanged(page, removed);
});

test('@tracks Root deletion resolves drafts explicitly and missing, unselected or terminal tracks never mutate the scene', async ({ page }) => {
  test.setTimeout(180_000);
  const source = await openScene(page);
  await rotationKey(page, 90, 'LeftUpperArm', 50); await rootKey(page, 90, 1.4);
  const authored = current(await backup(page));
  await numeric(page, 'Root X 位移（米）', 2);
  await clickRevealed(page, page.getByRole('button', { name: '删除 Root K', exact: true, includeHidden: true })); await expect(guard(page)).toBeVisible();
  await guard(page).getByRole('button', { name: '取消', exact: true }).click();
  await expect(draft(page)).toBeVisible(); await unchanged(page, authored);
  await clickRevealed(page, page.getByRole('button', { name: '删除 Root K', exact: true, includeHidden: true }));
  await guard(page).getByRole('button', { name: '放弃草稿，继续', exact: true }).click();
  const after = await backup(page), removed = current(after);
  expect(removed.manual!.root).toEqual([]); expect(removed.manual!.rotations).toEqual(authored.manual!.rotations);
  expect(removed.manual!.baseTake).toEqual(source.take);
  for (const [index, time] of source.take.times.entries()) expect(removed.take.poses[removed.take.times.indexOf(time)].root).toEqual(source.take.poses[index].root);
  await expect(draft(page)).toHaveCount(0);
  await expect(page.getByRole('button', { name: '删除 Root K', exact: true, includeHidden: true })).toBeDisabled();
  await joint(page, 'RightUpperArm'); await expect(page.getByRole('button', { name: '删除当前关节 K', exact: true, includeHidden: true })).toBeDisabled();
  await joint(page, ''); await expect(page.getByRole('button', { name: '删除当前关节 K', exact: true, includeHidden: true })).toBeDisabled();
  await joint(page, 'LeftHandTip'); await expect(page.getByRole('button', { name: '删除当前关节 K', exact: true, includeHidden: true })).toBeDisabled();
  await frame(page, 91); await joint(page, 'LeftUpperArm');
  await expect(page.getByRole('button', { name: '删除当前关节 K', exact: true, includeHidden: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: '删除当前帧关键帧', exact: true, includeHidden: true })).toBeDisabled();
  expect((await backup(page)).scene.project).toEqual(after.scene.project);
  await rootKey(page, 90, 1.6);
  const beforeWriteAndDelete = await backup(page);
  await numeric(page, '关节 Z 旋转（度）', 80);
  await clickRevealed(page, page.getByRole('button', { name: '删除 Root K', exact: true, includeHidden: true })); await expect(guard(page)).toBeVisible();
  await guard(page).getByRole('button', { name: '写入完整姿态后继续', exact: true }).click();
  await expect(draft(page)).toHaveCount(0);
  const writeAndDelete = await backup(page), removedAfterWrite = current(writeAndDelete);
  expect(writeAndDelete.scene.project.revision).toBe(beforeWriteAndDelete.scene.project.revision + 2);
  expect(writeAndDelete.scene.project.historyIndex).toBe(beforeWriteAndDelete.scene.project.historyIndex + 2);
  expect(removedAfterWrite.manual!.root).toEqual([]);
  expect(Object.keys(removedAfterWrite.manual!.rotations)).toHaveLength(19);
  expect(removedAfterWrite.manual!.rotations.LeftUpperArm![0].rotation[2]).toBeCloseTo(Math.sin(80 * Math.PI / 360), 8);
  expect(removedAfterWrite.manual!.rotations.LeftUpperArm![0].rotation[3]).toBeCloseTo(Math.cos(80 * Math.PI / 360), 8);
  expect(removedAfterWrite.manual!.baseTake).toEqual(source.take);
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  const fullPoseBeforeDelete = current(await backup(page));
  expect(fullPoseBeforeDelete.manual!.root).toEqual([{ frame: 90, position: [1.6, 1.05, 0] }]);
  expect(fullPoseBeforeDelete.manual!.rotations).toEqual(removedAfterWrite.manual!.rotations);
  await page.getByRole('button', { name: '重做', exact: true }).click(); await unchanged(page, removedAfterWrite);
  await frame(page, 90);
  await clickRevealed(page, page.getByRole('button', { name: '删除当前帧关键帧', exact: true, includeHidden: true }));
  const empty = current(await backup(page));
  expect(empty.manual!.root).toEqual([]); expect(empty.manual!.rotations).toEqual({});
  expect(empty.take.times).toEqual(source.take.times); expect(empty.take.poses).toEqual(source.take.poses);
  expect(empty.take.id).not.toBe(source.take.id);
  await page.getByRole('button', { name: '撤销', exact: true }).click(); await unchanged(page, removedAfterWrite);
});

test('@tracks timeline filters scope navigation, global editor navigation sees all keys, and previous/next cannot silently discard a draft', async ({ page }) => {
  test.setTimeout(180_000);
  await openScene(page);
  await rotationKey(page, 30, 'LeftUpperArm', 20); await rotationKey(page, 90, 'LeftUpperArm', 60);
  await rotationKey(page, 60, 'RightUpperArm', -35); await rootKey(page, 120, 1.1);
  const authored = await backup(page);
  const filter = page.getByRole('combobox', { name: '关键帧轨道筛选', exact: true });
  await filter.selectOption('all'); await visibleFrames(page, [30, 60, 90, 120]);
  await joint(page, 'LeftUpperArm'); await frame(page, 0); await filter.selectOption('joint'); await visibleFrames(page, [30, 90]);
  const previous = page.getByRole('button', { name: '时间线上一关键帧', exact: true });
  const next = page.getByRole('button', { name: '时间线下一关键帧', exact: true });
  await expect(previous).toBeDisabled(); await next.click(); await expect(page.getByRole('spinbutton', { name: '当前帧', exact: true })).toHaveValue('30');
  await next.click(); await expect(page.getByRole('spinbutton', { name: '当前帧', exact: true })).toHaveValue('90'); await expect(next).toBeDisabled();
  await previous.click(); await expect(page.getByRole('spinbutton', { name: '当前帧', exact: true })).toHaveValue('30');
  await page.getByRole('button', { name: '下一关键帧', exact: true }).click(); await expect(page.getByRole('spinbutton', { name: '当前帧', exact: true })).toHaveValue('60');
  await page.getByRole('button', { name: '上一关键帧', exact: true }).click(); await expect(page.getByRole('spinbutton', { name: '当前帧', exact: true })).toHaveValue('30');
  await filter.selectOption('root'); await visibleFrames(page, [120]);
  await next.click(); await expect(page.getByRole('spinbutton', { name: '当前帧', exact: true })).toHaveValue('120');
  await frame(page, 150); await previous.click(); await expect(page.getByRole('spinbutton', { name: '当前帧', exact: true })).toHaveValue('120');
  await filter.selectOption('joint'); await joint(page, ''); await visibleFrames(page, []); await expect(previous).toBeDisabled(); await expect(next).toBeDisabled();
  await joint(page, 'LeftHandTip'); await visibleFrames(page, []);
  await joint(page, 'RightUpperArm'); await visibleFrames(page, [60]);
  await joint(page, 'LeftUpperArm'); await visibleFrames(page, [30, 90]);
  expect((await backup(page)).scene.project).toEqual(authored.scene.project);
  await frame(page, 90); await numeric(page, '关节 Z 旋转（度）', 85);
  await previous.click(); await expect(guard(page)).toBeVisible();
  await guard(page).getByRole('button', { name: '取消', exact: true }).click();
  await expect(page.getByRole('spinbutton', { name: '当前帧', exact: true })).toHaveValue('90'); await expect(draft(page)).toBeVisible();
  await unchanged(page, current(authored));
  await previous.click(); await guard(page).getByRole('button', { name: '放弃草稿，继续', exact: true }).click();
  await expect(page.getByRole('spinbutton', { name: '当前帧', exact: true })).toHaveValue('30'); await expect(draft(page)).toHaveCount(0);
  await numeric(page, '关节 Z 旋转（度）', 45); await next.click(); await expect(guard(page)).toBeVisible();
  await guard(page).getByRole('button', { name: '写入完整姿态后继续', exact: true }).click();
  await expect(page.getByRole('spinbutton', { name: '当前帧', exact: true })).toHaveValue('90'); await expect(draft(page)).toHaveCount(0);
  const committed = await backup(page), sequence = current(committed).manual!;
  expect(committed.scene.project.revision).toBe(authored.scene.project.revision + 1);
  expect(sequence.rotations.LeftUpperArm!.find(key => key.frame === 30)!.rotation[2]).toBeCloseTo(Math.sin(Math.PI / 8), 8);
  expect(Object.keys(sequence.rotations)).toHaveLength(19);
  expect(sequence.root.map(key => key.frame)).toEqual([30, 120]);
});

test('@tracks mobile track actions are reachable and deletion, undo, save and reopen preserve the sequence, history and original local audio', async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 390, height: 844 });
  const source = await openScene(page);
  await rotationKey(page, 45, 'LeftUpperArm', 55); await rootKey(page, 45, 1.2);
  const authored = current(await backup(page));
  await page.getByRole('combobox', { name: '关键帧轨道筛选', exact: true }).selectOption('joint'); await visibleFrames(page, [45]);
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    for (const name of ['删除当前关节 K', '删除 Root K', '上一关键帧', '下一关键帧']) {
      const action = page.getByRole('button', { name, exact: true, includeHidden: true });
      await reveal(page, action); await action.scrollIntoViewIfNeeded(); await expect(action).toBeInViewport();
      const box = (await action.boundingBox())!; expect(box.width).toBeGreaterThanOrEqual(40); expect(box.height).toBeGreaterThanOrEqual(44);
    }
    const geometry = await page.evaluate(() => ({ client: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }));
    expect(geometry.scroll).toBeLessThanOrEqual(geometry.client);
  }
  await clickRevealed(page, page.getByRole('button', { name: '删除当前关节 K', exact: true, includeHidden: true }));
  expect(current(await backup(page)).manual!.root).toEqual(authored.manual!.root); await visibleFrames(page, []);
  await page.getByRole('button', { name: '撤销', exact: true }).click(); await unchanged(page, authored); await visibleFrames(page, [45]);
  await page.getByRole('button', { name: '保存', exact: true }).click(); await expect(page.locator('.save-state')).toHaveText('已保存到本机');
  const saved = await backup(page);
  await page.reload(); await ready(page); await expect(page.locator('.save-state')).toHaveText('已保存到本机');
  const restored = await backup(page);
  expect(restored.scene.id).toBe(saved.scene.id); expect(restored.scene.project).toEqual(saved.scene.project);
  expect(restored.scene.audioName).toBe(saved.scene.audioName); expect(current(restored).manual!.baseTake).toEqual(source.take);
  await expect(page.getByRole('combobox', { name: '关键帧轨道筛选', exact: true })).toHaveValue('all');
  const audioHash = await page.locator('audio').evaluate(async (audio: HTMLAudioElement) => {
    const bytes = await (await fetch(audio.src)).arrayBuffer();
    return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), value => value.toString(16).padStart(2, '0')).join('');
  });
  expect(audioHash).toBe(createHash('sha256').update(source.wave).digest('hex'));
  await expect(page.getByRole('button', { name: '重做', exact: true })).toBeEnabled();
  if (process.env.CHOREO_SCREENSHOT_DIR) {
    await page.setViewportSize({ width: 390, height: 844 });
    await frame(page, 45);
    await page.getByRole('combobox', { name: '关键帧轨道筛选', exact: true }).selectOption('joint');
    await capture(page, 'choreo-tracks-mobile.png');
  }
});
