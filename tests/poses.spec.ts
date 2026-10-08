import { createHash } from 'node:crypto';
import { mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { clickRevealed, reveal } from './helpers';

// This original local fixture is independent of the editor. Its non-uniform
// samples, moving Root and animated read-only terminals expose accidental
// whole-pose copies, re-baking and clipboard aliases in exported motion.
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
const terminals: Joint[] = ['LeftHandTip', 'RightHandTip', 'LeftToe', 'LeftHeel', 'RightToe', 'RightHeel'];
const editable = joints.filter(joint => !terminals.includes(joint));
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
  expect(messages.apiRequests, 'Pose reuse and local scene transactions must not call business APIs').toEqual([]);
});

function fixture(outsideSourceRoot = false) {
  const countMap = { id: 'poses-count-map', version: 1, bpm: 120, musicBeatsPerDanceCount: 1, firstCountSourceSeconds: 1, sourceOffsetSeconds: 1, durationSeconds: 16, octetCount: 4, countTimesSeconds: Array.from({ length: 33 }, (_, i) => i * 0.5), confirmed: true };
  const plan = {
    id: 'poses-plan', countMapId: countMap.id, durationSeconds: 16, provenance: 'synthetic-demo',
    slots: ['step-touch', 'side-reach', 'groove', 'settle'].map((actionId, slotIndex) => ({ slotIndex, actionId, label: '原创姿态复用回归样例', teachingCue: '本地回归', startSeconds: slotIndex * 4, endSeconds: (slotIndex + 1) * 4, countStart: slotIndex * 8 + 1, countEnd: (slotIndex + 1) * 8, role: slotIndex === 0 ? 'opening' : slotIndex === 3 ? 'closing' : 'body' })),
  };
  const times = [0, 0.7, 2.5, 4, 8, 12, 16];
  const poses = times.map((time): Pose => ({
    root: [time / 80, 1.05, 0],
    joints: Object.fromEntries(joints.map(joint => {
      const terminal = terminals.indexOf(joint);
      const rotation: Quat = terminal >= 0 ? [Math.sin(time * (terminal + 1) / 160), 0, 0, Math.cos(time * (terminal + 1) / 160)]
        : joint === 'Head' ? [0, Math.sin(time / 160), 0, Math.cos(time / 160)] : [0, 0, 0, 1];
      return [joint, rotation];
    })) as Record<Joint, Quat>,
  }));
  // Legacy authoritative takes permit finite Root coordinates outside today's
  // editing envelope; only the new pasted draft must clamp them.
  if (outsideSourceRoot) poses[2].root = [8, -1, -9];
  const take: Take = { id: 'poses-base-take', schemaVersion: 'preview-1', planId: plan.id, countMapId: countMap.id, durationSeconds: 16, times, poses, provenance: 'synthetic-demo' };
  const scene = {
    schema: 'choreo-scene-1', id: 'poses-local-scene', name: '姿态复用回归场景', createdAt: '2026-10-07T08:00:00.000Z', updatedAt: '2026-10-07T08:00:00.000Z',
    coordinateSystem: { handedness: 'right', upAxis: '+Y', forwardAxis: '+Z', units: 'm', floorPlane: 'XZ', origin: [0, 0, 0] },
    actor: { id: 'actor-1', rigId: 'synthetic-skeleton-1', provenance: 'synthetic-demo', joints: [...joints] },
    project: { history: [{ title: '姿态复用回归场景', countMap, plan, take }], historyIndex: 0, revision: 1, audioDuration: 20, teacherCheckedRevision: 1 },
    audioName: 'original-poses-local.wav',
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
async function editor(page: Page) {
  const region = page.getByRole('region', { name: '手动关键帧编辑器', exact: true });
  if (!await region.isVisible()) await page.getByRole('button', { name: '手动 K帧', exact: true }).click();
  await expect(region).toBeVisible();
}
async function openFixture(page: Page, includeSecond = false, outsideSourceRoot = false) {
  const source = fixture(outsideSourceRoot);
  await page.goto('/'); await ready(page);
  await page.evaluate(async ({ scene, bytes, includeSecond }) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('choreo-studio-preview', 2);
      request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
    });
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(['scenes', 'sceneIndex', 'sceneMeta'], 'readwrite');
      const { schema, id, name, createdAt, updatedAt, audioName } = scene;
      const audio = new Blob([new Uint8Array(bytes)], { type: 'audio/wav' });
      tx.objectStore('scenes').put({ ...scene, audio }, id);
      tx.objectStore('sceneIndex').put({ schema, id, name, createdAt, updatedAt, audioName }, id);
      tx.objectStore('sceneMeta').put(id, 'currentSceneId'); tx.objectStore('sceneMeta').put(true, 'legacyProjectMigrated');
      if (includeSecond) {
        const second = { ...scene, id: 'poses-second-scene', name: '姿态复用目标 B', project: structuredClone(scene.project), audio };
        tx.objectStore('scenes').put(second, second.id);
        tx.objectStore('sceneIndex').put({ schema, id: second.id, name: second.name, createdAt, updatedAt, audioName }, second.id);
      }
      tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error);
    });
    db.close();
  }, { scene: source.scene, bytes: Array.from(source.wave), includeSecond });
  await page.reload(); await ready(page);
  await expect(page.locator('.project-title h1')).toHaveText(source.scene.name);
  expect(current(await backup(page)).take).toEqual(source.take);
  await editor(page);
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
async function number(page: Page, label: string, value: number) {
  await expect.poll(async () => Math.abs(Number(await page.getByRole('spinbutton', { name: label, exact: true }).inputValue()) - value)).toBeLessThan(0.051);
}
async function joint(page: Page, value: Joint) { await page.getByRole('combobox', { name: '选择关节', exact: true }).selectOption(value); }
const draft = (page: Page) => page.getByRole('status').filter({ hasText: '姿态草稿 · 尚未写入关键帧' });
const guard = (page: Page) => page.getByRole('dialog', { name: '写入这份姿态草稿？', exact: true });
const clipboard = (page: Page) => page.getByLabel('已复制姿态', { exact: true });
const copy = (page: Page) => page.getByRole('button', { name: '复制当前姿态', exact: true, includeHidden: true });
const paste = (page: Page, root = false) => page.getByRole('button', { name: root ? '粘贴姿态与位置' : '粘贴关节姿态', exact: true, includeHidden: true });
async function copiedDraft(page: Page, root = 2) {
  await frame(page, 75); await joint(page, 'LeftUpperArm');
  await numeric(page, '关节 Z 旋转（度）', 45); await numeric(page, 'Root X 位移（米）', root);
  await clickRevealed(page, copy(page)); await expect(clipboard(page)).toContainText('第 75 帧 · 姿态草稿');
  // The source remains a preview: seeking explicitly discards it.
  await numeric(page, '当前帧', 120); await expect(guard(page)).toBeVisible();
  await guard(page).getByRole('button', { name: '放弃草稿，继续', exact: true }).click();
  await expect(page.getByRole('spinbutton', { name: '当前帧', exact: true })).toHaveValue('120');
  await expect(draft(page)).toHaveCount(0);
}
async function fullKey(page: Page) {
  await page.getByRole('button', { name: 'K 完整姿态', exact: true }).click();
  await expect(draft(page)).toHaveCount(0);
}
async function save(page: Page) {
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.locator('.save-state')).toHaveText('已保存到本机');
}
function expectQuaternion(actual: Quat, expected: Quat) {
  expect(Math.abs(actual.reduce((dot, value, i) => dot + value * expected[i], 0))).toBeCloseTo(1, 10);
}
function expectSourceKeys(snapshot: Snapshot, keyFrame: number, source: Pose) {
  expect(Object.keys(snapshot.manual!.rotations).sort()).toEqual([...editable].sort());
  for (const name of editable) expectQuaternion(snapshot.manual!.rotations[name]!.find(key => key.frame === keyFrame)!.rotation, source.joints[name]);
  for (const name of terminals) expect(snapshot.manual!.rotations[name]).toBeUndefined();
}
function expectTerminals(snapshot: Snapshot, time: number, expected: Pose) {
  const sample = snapshot.take.poses[snapshot.take.times.indexOf(time)];
  expect(sample).toBeDefined();
  for (const name of terminals) expectQuaternion(sample.joints[name], expected.joints[name]);
}
async function capture(page: Page, name: string) {
  if (!process.env.CHOREO_SCREENSHOT_DIR) return;
  await mkdir(process.env.CHOREO_SCREENSHOT_DIR, { recursive: true });
  await page.evaluate(() => window.scrollTo({ top: 0, left: 0, behavior: 'instant' }));
  await page.screenshot({ path: join(process.env.CHOREO_SCREENSHOT_DIR, name), fullPage: true });
}

test('@poses copied drafts reuse editable rotations without moving the target or copying terminals; partial K and later edits cannot mutate the buffer', async ({ page }) => {
  test.setTimeout(180_000);
  const source = await openFixture(page), original = await backup(page);
  await expect(paste(page)).toBeDisabled(); await expect(paste(page, true)).toBeDisabled();
  await copiedDraft(page);
  expect((await backup(page)).scene.project).toEqual(original.scene.project);
  await clickRevealed(page, paste(page)); await expect(draft(page)).toBeVisible();
  await number(page, '关节 Z 旋转（度）', 45); await number(page, 'Root X 位移（米）', 0.05);
  expect((await backup(page)).scene.project).toEqual(original.scene.project);

  await page.getByRole('button', { name: 'K 当前关节', exact: true }).click();
  await expect(draft(page)).toBeVisible();
  const partial = await backup(page);
  expect(partial.scene.project.revision).toBe(original.scene.project.revision + 1);
  expect(Object.keys(current(partial).manual!.rotations)).toEqual(['LeftUpperArm']);
  expect(current(partial).manual!.root).toEqual([]);
  expect(current(partial).manual!.baseTake).toEqual(source.take);
  // Changing the pasted draft must not mutate the source held in memory.
  await numeric(page, '关节 Z 旋转（度）', 90); await fullKey(page);
  const changed = await backup(page), changedPose = current(changed);
  expect(changedPose.manual!.root).toEqual([{ frame: 120, position: [0.05, 1.05, 0] }]);
  expectQuaternion(changedPose.manual!.rotations.LeftUpperArm![0].rotation, [0, 0, Math.SQRT1_2, Math.SQRT1_2]);
  expectTerminals(changedPose, 4, source.take.poses[3]);

  await frame(page, 240); await clickRevealed(page, paste(page, true)); await expect(draft(page)).toBeVisible();
  await number(page, '关节 Z 旋转（度）', 45); await number(page, 'Root X 位移（米）', 2);
  await expect(clipboard(page)).toContainText('第 75 帧 · 姿态草稿');
  expect((await backup(page)).scene.project).toEqual(changed.scene.project);
  await capture(page, 'choreo-poses-desktop.png');
  await fullKey(page);
  const final = await backup(page), expectedSource = structuredClone(source.take.poses[2]);
  expectedSource.root[0] = 2; expectedSource.joints.LeftUpperArm = [0, 0, Math.sin(Math.PI / 8), Math.cos(Math.PI / 8)];
  expectSourceKeys(current(final), 240, expectedSource);
  expect(current(final).manual!.root.find(key => key.frame === 240)!.position).toEqual(expectedSource.root);
  expectTerminals(current(final), 8, source.take.poses[4]);
  expect(current(final).manual!.baseTake).toEqual(source.take);
  expect(source.take.times.every(time => current(final).take.times.includes(time))).toBe(true);
  expect(current(final).take.times.at(-1)).toBe(16);
  expect(final.scene.project.revision).toBe(original.scene.project.revision + 3);
  expect(final.scene.project.history).toHaveLength(original.scene.project.history.length + 3);
  expect(final.scene.project.teacherCheckedRevision).toBeNull();
  await clickRevealed(page, paste(page)); await expect(draft(page)).toHaveCount(0);
  expect((await backup(page)).scene.project).toEqual(final.scene.project);
});

test('@poses replacing a target draft supports cancel, discard and write-before-paste while preserving the copied source and authoritative history', async ({ page }) => {
  test.setTimeout(180_000);
  const source = await openFixture(page); await copiedDraft(page);
  const original = await backup(page);
  await numeric(page, '关节 Z 旋转（度）', 10); await numeric(page, 'Root X 位移（米）', 1.2);
  await clickRevealed(page, paste(page, true)); await expect(guard(page)).toBeVisible();
  await guard(page).getByRole('button', { name: '取消', exact: true }).click();
  await number(page, '关节 Z 旋转（度）', 10); await number(page, 'Root X 位移（米）', 1.2);
  await expect(draft(page)).toBeVisible();
  expect((await backup(page)).scene.project).toEqual(original.scene.project);

  await clickRevealed(page, paste(page, true));
  await guard(page).getByRole('button', { name: '放弃草稿，继续', exact: true }).click();
  await number(page, '关节 Z 旋转（度）', 45); await number(page, 'Root X 位移（米）', 2);
  expect((await backup(page)).scene.project).toEqual(original.scene.project);
  await numeric(page, 'Root X 位移（米）', 1.4);
  await clickRevealed(page, paste(page, true));
  await guard(page).getByRole('button', { name: '写入完整姿态后继续', exact: true }).click();
  await expect(draft(page)).toBeVisible(); await number(page, 'Root X 位移（米）', 2);
  const writtenFirst = await backup(page);
  expect(writtenFirst.scene.project.revision).toBe(original.scene.project.revision + 1);
  expect(writtenFirst.scene.project.history).toHaveLength(original.scene.project.history.length + 1);
  expect(current(writtenFirst).manual!.root).toEqual([{ frame: 120, position: [1.4, 1.05, 0] }]);
  expectTerminals(current(writtenFirst), 4, source.take.poses[3]);
  await expect(clipboard(page)).toContainText('第 75 帧 · 姿态草稿');
  await page.getByRole('button', { name: 'K 位移', exact: true }).click(); await expect(draft(page)).toHaveCount(0);
  const final = await backup(page);
  expect(final.scene.project.revision).toBe(original.scene.project.revision + 2);
  expect(current(final).manual!.root).toEqual([{ frame: 120, position: [2, 1.05, 0] }]);
  expect(current(final).manual!.rotations).toEqual(current(writtenFirst).manual!.rotations);
  expect(current(final).take.id).not.toBe(current(writtenFirst).take.id);
});

test('@poses mirror and playback lock pose reuse; saved keys, history and original audio survive reload while the clipboard clears on reload and scene opening', async ({ page }) => {
  test.setTimeout(180_000);
  const source = await openFixture(page, true, true);
  await frame(page, 75); await clickRevealed(page, copy(page));
  await expect(clipboard(page)).toContainText('第 75 帧 · 动画姿态');
  const original = await backup(page);
  await clickRevealed(page, page.getByRole('button', { name: '镜像观看', exact: true, includeHidden: true }));
  for (const action of [copy(page), paste(page), paste(page, true)]) await expect(action).toBeDisabled();
  await clickRevealed(page, page.getByRole('button', { name: '镜像观看', exact: true, includeHidden: true }));
  await page.getByRole('button', { name: '播放', exact: true }).click();
  await expect(page.getByRole('button', { name: '暂停', exact: true })).toBeVisible();
  for (const action of [copy(page), paste(page), paste(page, true)]) await expect(action).toBeDisabled();
  await page.getByRole('button', { name: '暂停', exact: true }).click();
  expect((await backup(page)).scene.project).toEqual(original.scene.project);
  await frame(page, 120); await clickRevealed(page, paste(page, true));
  await number(page, 'Root X 位移（米）', 5); await number(page, 'Root Y 位移（米）', 0); await number(page, 'Root Z 位移（米）', -5);
  await fullKey(page);
  const authored = current(await backup(page));
  expect(authored.manual!.root).toEqual([{ frame: 120, position: [5, 0, -5] }]);
  expect(authored.manual!.baseTake).toEqual(source.take);
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  expect(current(await backup(page)).take).toEqual(source.take);
  await expect(clipboard(page)).toContainText('第 75 帧 · 动画姿态');
  await page.getByRole('button', { name: '重做', exact: true }).click();
  expect(current(await backup(page))).toEqual(authored);
  await save(page); const saved = await backup(page);
  await expect(clipboard(page)).toContainText('第 75 帧 · 动画姿态');
  expect(JSON.stringify(saved)).not.toMatch(/clipboard|poseClipboard/);
  await page.reload(); await ready(page); await editor(page);
  await expect(clipboard(page)).toHaveText('未复制姿态');
  await expect(paste(page)).toBeDisabled(); await expect(paste(page, true)).toBeDisabled();
  expect((await backup(page)).scene.project).toEqual(saved.scene.project);
  const audioHash = await page.locator('audio').evaluate(async (audio: HTMLAudioElement) => {
    const bytes = await (await fetch(audio.src)).arrayBuffer();
    return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), value => value.toString(16).padStart(2, '0')).join('');
  });
  expect(audioHash).toBe(createHash('sha256').update(source.wave).digest('hex'));
  await clickRevealed(page, copy(page)); await expect(paste(page)).toBeEnabled();
  await page.getByRole('button', { name: '场景', exact: true }).click();
  await page.getByRole('dialog', { name: '本机场景', exact: true }).getByRole('button', { name: '打开场景 姿态复用目标 B', exact: true }).click();
  await expect(page.locator('.project-title h1')).toHaveText('姿态复用目标 B'); await editor(page);
  await expect(clipboard(page)).toHaveText('未复制姿态'); await expect(paste(page)).toBeDisabled();
  expect(current(await backup(page)).take).toEqual(source.take);
});

test('@poses mobile pose reuse stays reachable without overflow; new scenes and confirmed music changes clear the transient clipboard', async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await openFixture(page); await copiedDraft(page, 1.2);
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    for (const action of [copy(page), paste(page), paste(page, true)]) {
      await reveal(page, action); await action.scrollIntoViewIfNeeded(); await expect(action).toBeInViewport();
      const box = (await action.boundingBox())!;
      expect(box.width).toBeGreaterThanOrEqual(40); expect(box.height).toBeGreaterThanOrEqual(44);
    }
    const geometry = await page.evaluate(() => ({ client: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }));
    expect(geometry.scroll).toBeLessThanOrEqual(geometry.client);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await clickRevealed(page, paste(page, true)); await number(page, '关节 Z 旋转（度）', 45); await number(page, 'Root X 位移（米）', 1.2);
  await fullKey(page); await save(page); await capture(page, 'choreo-poses-mobile.png');
  await page.getByRole('button', { name: '场景', exact: true }).click();
  await page.getByRole('dialog', { name: '本机场景', exact: true }).getByRole('button', { name: '新建场景', exact: true }).click();
  await expect(page.locator('.project-title h1')).toHaveText('未命名场景'); await ready(page); await editor(page);
  await expect(clipboard(page)).toHaveText('未复制姿态'); await expect(paste(page, true)).toBeDisabled();
  await clickRevealed(page, copy(page)); await expect(paste(page, true)).toBeEnabled();
  await page.getByRole('button', { name: '导入音乐', exact: true }).click();
  await page.getByRole('dialog', { name: '先把音乐和数拍准备好', exact: true }).getByRole('button', { name: '确认数拍，进入工作台', exact: true }).click();
  await page.getByRole('button', { name: '八拍编排', exact: true }).click();
  await expect(page.getByRole('button', { name: '生成模板初稿', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: '生成模板初稿', exact: true }).click(); await editor(page);
  await expect(clipboard(page)).toHaveText('未复制姿态'); await expect(paste(page)).toBeDisabled(); await expect(paste(page, true)).toBeDisabled();
});
