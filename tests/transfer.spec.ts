import { createHash } from 'node:crypto';
import { mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { clickRevealed, reveal } from './helpers';
import { PerspectiveCamera, Vector3 } from 'three';

// Independent legacy-compatible scene: a non-uniform base, moving Root and
// untouched Head arc expose accidental rebaking or unrelated-track mutation.
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
type Camera = { position: Vec3; target: Vec3; zoom?: number };
type Pose = { root: Vec3; joints: Record<Joint, Quat> };
type Take = { id: string; schemaVersion: string; planId: string; countMapId: string; durationSeconds: number; times: number[]; poses: Pose[]; provenance: string };
type Sequence = { schema: 'manual-keyframes-1'; id: string; fps: 30; baseTake: Take; rotations: Partial<Record<Joint, { frame: number; rotation: Quat }[]>>; root: { frame: number; position: Vec3 }[] };
type Snapshot = { title: string; countMap: { id: string; durationSeconds: number }; plan: unknown; take: Take; manual?: Sequence };
type Backup = { scene: { id: string; name: string; audioName: string; project: { historyIndex: number; history: Snapshot[]; revision: number; teacherCheckedRevision: number | null }; viewer: { time: number; selectedJoint: Joint | null; editorMode?: string; camera: Camera } } };
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
  expect(messages.apiRequests, 'Keyframe transfer and local scene transactions must stay in the browser').toEqual([]);
});

function fixture() {
  const countMap = { id: 'transfer-count-map', version: 1, bpm: 120, musicBeatsPerDanceCount: 1, firstCountSourceSeconds: 1, sourceOffsetSeconds: 1, durationSeconds: 16, octetCount: 4, countTimesSeconds: Array.from({ length: 33 }, (_, i) => i * 0.5), confirmed: true };
  const plan = {
    id: 'transfer-plan', countMapId: countMap.id, durationSeconds: 16, provenance: 'synthetic-demo',
    slots: ['step-touch', 'side-reach', 'groove', 'settle'].map((actionId, slotIndex) => ({ slotIndex, actionId, label: '原创移时回归样例', teachingCue: '本地回归', startSeconds: slotIndex * 4, endSeconds: (slotIndex + 1) * 4, countStart: slotIndex * 8 + 1, countEnd: (slotIndex + 1) * 8, role: slotIndex === 0 ? 'opening' : slotIndex === 3 ? 'closing' : 'body' })),
  };
  const times = [0, 0.7, 2.5, 4, 8, 12, 16];
  const poses = times.map((time): Pose => ({ root: [time / 80, 1.05, 0], joints: Object.fromEntries(joints.map(joint => [joint, joint === 'Head' ? [0, Math.sin(time / 160), 0, Math.cos(time / 160)] : [0, 0, 0, 1]])) as Record<Joint, Quat> }));
  const take: Take = { id: 'transfer-base-take', schemaVersion: 'preview-1', planId: plan.id, countMapId: countMap.id, durationSeconds: 16, times, poses, provenance: 'synthetic-demo' };
  const scene = {
    schema: 'choreo-scene-1', id: 'transfer-local-scene', name: '关键帧移时回归场景', createdAt: '2026-10-07T06:00:00.000Z', updatedAt: '2026-10-07T06:00:00.000Z',
    coordinateSystem: { handedness: 'right', upAxis: '+Y', forwardAxis: '+Z', units: 'm', floorPlane: 'XZ', origin: [0, 0, 0] },
    actor: { id: 'actor-1', rigId: 'synthetic-skeleton-1', provenance: 'synthetic-demo', joints: [...joints] },
    project: { history: [{ title: '关键帧移时回归场景', countMap, plan, take }], historyIndex: 0, revision: 1, audioDuration: 20, teacherCheckedRevision: 1 },
    audioName: 'original-transfer-local.wav',
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
  await clickRevealed(page, page.getByRole('button', { name: 'K 当前关节', exact: true, includeHidden: true })); await expect(draft(page)).toHaveCount(0);
}
async function rootKey(page: Page, keyFrame: number, x: number) {
  await frame(page, keyFrame); await numeric(page, 'Root X 位移（米）', x);
  await clickRevealed(page, page.getByRole('button', { name: 'K 位移', exact: true, includeHidden: true })); await expect(draft(page)).toHaveCount(0);
}
const draft = (page: Page) => page.getByRole('status').filter({ hasText: '姿态草稿 · 尚未写入关键帧' });
const guard = (page: Page) => page.getByRole('dialog', { name: '写入这份姿态草稿？', exact: true });
const timeline = (page: Page) => page.getByRole('region', { name: '手动关键帧时间线', exact: true });
async function visibleFrames(page: Page, expected: number[]) {
  if (expected.length) await reveal(page, timeline(page).getByRole('list', { name: '关键帧列表', exact: true, includeHidden: true }));
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

const destination = (page: Page) => page.getByRole('spinbutton', { name: '关键帧目标帧', exact: true, includeHidden: true });
const transfer = (page: Page, operation: 'copy' | 'move') => page.getByRole('button', { name: operation === 'copy' ? '复制当前范围关键帧' : '移动当前范围关键帧', exact: true, includeHidden: true });
const collision = (page: Page) => page.getByRole('dialog', { name: '目标帧已有关键帧', exact: true });
async function target(page: Page, value: number | '') { await reveal(page, destination(page)); await destination(page).fill(String(value)); await destination(page).press('Tab'); }
async function scope(page: Page, value: 'all' | 'joint' | 'root') { await page.getByRole('combobox', { name: '关键帧轨道筛选', exact: true }).selectOption(value); }
async function audioHash(page: Page) {
  return page.locator('audio').evaluate(async (audio: HTMLAudioElement) => {
    const bytes = await (await fetch(audio.src)).arrayBuffer();
    return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), byte => byte.toString(16).padStart(2, '0')).join('');
  });
}
function checkUneditedHead(snapshot: Snapshot, base: Take) {
  for (const [index, time] of base.times.entries()) expect(snapshot.take.poses[snapshot.take.times.indexOf(time)].joints.Head).toEqual(base.poses[index].joints.Head);
  expect(snapshot.take.times.at(-1)).toBe(base.durationSeconds);
}
async function seeded(page: Page) {
  const source = await openScene(page);
  await rotationKey(page, 30, 'LeftUpperArm', 20); await rotationKey(page, 30, 'RightUpperArm', -30); await rootKey(page, 30, 0.9);
  await rotationKey(page, 90, 'LeftUpperArm', 60); await rotationKey(page, 120, 'RightUpperArm', -40);
  await frame(page, 30); await joint(page, 'LeftUpperArm');
  return source;
}
async function holdRootArrow(page: Page, root: Vec3, cameraState: Camera) {
  const canvas = page.getByRole('img', { name: '人体编舞动作预览' });
  await canvas.scrollIntoViewIfNeeded(); const box = (await canvas.boundingBox())!;
  const camera = new PerspectiveCamera(40, box.width / box.height, 0.05, 80);
  camera.position.fromArray(cameraState.position); camera.zoom = cameraState.zoom ?? 1;
  camera.lookAt(new Vector3(...cameraState.target)); camera.updateProjectionMatrix(); camera.updateMatrixWorld(true);
  const factor = camera.position.distanceTo(new Vector3(...root)) * 1.9 * Math.tan(40 * Math.PI / 360) / camera.zoom * 0.95 / 4;
  const point = new Vector3(root[0] + factor * 0.38, root[1], root[2]).project(camera);
  await page.mouse.move(box.x + (point.x + 1) * box.width / 2, box.y + (1 - point.y) * box.height / 2);
  await expect(page.getByLabel('Root 世界位移', { exact: true })).toContainText('X轴');
  await page.mouse.down({ button: 'left' });
  return canvas;
}

test('@transfer current-joint copy asks before collision replacement; all-track move changes only explicit source keys and is undoable and locally saved', async ({ page }) => {
  test.setTimeout(180_000);
  const source = await seeded(page), original = await backup(page), originalSequence = current(original).manual!;
  await scope(page, 'joint'); await target(page, 90);
  await page.getByRole('button', { name: '移动角色工具', exact: true }).click();
  await page.getByRole('button', { name: '全身取景', exact: true }).click();
  const camera = (await backup(page)).scene.viewer.camera;
  const canvas = await holdRootArrow(page, originalSequence.root[0].position, camera);
  // A keyboard transfer while the real Root handle remains held must cancel
  // manipulation; movement behind or after its modal cannot create a draft.
  await reveal(page, transfer(page, 'copy')); await transfer(page, 'copy').focus(); await page.keyboard.press('Enter'); await expect(collision(page)).toBeVisible();
  await canvas.scrollIntoViewIfNeeded(); const heldBox = (await canvas.boundingBox())!;
  await page.mouse.move(heldBox.x + heldBox.width * 0.76, heldBox.y + heldBox.height * 0.58, { steps: 6 });
  await expect(draft(page)).toHaveCount(0);
  const cancel = collision(page).getByRole('button', { name: '取消', exact: true });
  await cancel.focus(); await page.keyboard.press('Enter');
  await canvas.scrollIntoViewIfNeeded(); const box = (await canvas.boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.82, box.y + box.height * 0.62, { steps: 8 });
  await page.mouse.up({ button: 'left' }); await expect(draft(page)).toHaveCount(0);
  expect(Number(await page.getByRole('spinbutton', { name: 'Root X 位移（米）', exact: true }).inputValue())).toBe(0.9);
  expect((await backup(page)).scene.project).toEqual(original.scene.project);
  await clickRevealed(page, transfer(page, 'copy'));
  await collision(page).getByRole('button', { name: '替换并继续', exact: true }).click();
  const copied = await backup(page), copiedSequence = current(copied).manual!;
  expect(copied.scene.project.revision).toBe(original.scene.project.revision + 1);
  expect(copiedSequence.rotations.LeftUpperArm).toEqual([
    originalSequence.rotations.LeftUpperArm![0], { frame: 90, rotation: originalSequence.rotations.LeftUpperArm![0].rotation },
  ]);
  expect(copiedSequence.rotations.RightUpperArm).toEqual(originalSequence.rotations.RightUpperArm);
  expect(copiedSequence.root).toEqual(originalSequence.root); expect(copiedSequence.baseTake).toEqual(source.take);
  expect(current(copied).take.id).not.toBe(current(original).take.id);
  await frame(page, 30); await scope(page, 'all'); await target(page, 60); await clickRevealed(page, transfer(page, 'move'));
  const moved = await backup(page), movedSequence = current(moved).manual!;
  expect(moved.scene.project.revision).toBe(copied.scene.project.revision + 1);
  expect(movedSequence.rotations.LeftUpperArm).toEqual([{ frame: 60, rotation: copiedSequence.rotations.LeftUpperArm![0].rotation }, copiedSequence.rotations.LeftUpperArm![1]]);
  expect(movedSequence.rotations.RightUpperArm).toEqual([{ frame: 60, rotation: copiedSequence.rotations.RightUpperArm![0].rotation }, copiedSequence.rotations.RightUpperArm![1]]);
  expect(movedSequence.root).toEqual([{ frame: 60, position: [0.9, 1.05, 0] }]);
  expect(Object.keys(movedSequence.rotations).sort()).toEqual(['LeftUpperArm', 'RightUpperArm']);
  expect(movedSequence.baseTake).toEqual(source.take); expect(current(moved).countMap).toEqual(current(original).countMap); expect(current(moved).plan).toEqual(current(original).plan);
  checkUneditedHead(current(moved), source.take); await visibleFrames(page, [60, 90, 120]);
  await capture(page, 'choreo-transfer-desktop.png');
  await page.getByRole('button', { name: '撤销', exact: true }).click(); await unchanged(page, current(copied));
  await page.getByRole('button', { name: '重做', exact: true }).click(); await unchanged(page, current(moved));
  await frame(page, 60); await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.locator('.save-state')).toHaveText('已保存到本机'); const saved = await backup(page);
  await page.reload(); await ready(page); const restored = await backup(page);
  expect(restored.scene.project).toEqual(saved.scene.project); expect(restored.scene.id).toBe(saved.scene.id);
  expect(await audioHash(page)).toBe(createHash('sha256').update(source.wave).digest('hex'));
});

test('@transfer Root scope works independently of read-only selection; empty, fractional, same-frame and out-of-range targets never write animation', async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 390, height: 844 });
  const source = await openScene(page);
  await rotationKey(page, 90, 'LeftUpperArm', 40); await rootKey(page, 0, 0.8); await rootKey(page, 480, 1.2);
  const original = await backup(page);
  await frame(page, 0); await joint(page, 'RightHeel'); await scope(page, 'joint'); await target(page, 450);
  await expect(transfer(page, 'copy')).toBeDisabled(); await expect(transfer(page, 'move')).toBeDisabled();
  await joint(page, ''); await expect(transfer(page, 'copy')).toBeDisabled();
  await joint(page, 'RightHeel'); await scope(page, 'root');
  for (const value of ['', -1, 481, 0.5, 0] as const) {
    await target(page, value); await expect(transfer(page, 'copy')).toBeDisabled(); await expect(transfer(page, 'move')).toBeDisabled();
  }
  expect((await backup(page)).scene.project).toEqual(original.scene.project);
  await target(page, 450); await expect(transfer(page, 'move')).toBeEnabled();
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    for (const button of [transfer(page, 'copy'), transfer(page, 'move')]) {
      await reveal(page, button); await button.scrollIntoViewIfNeeded(); expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  }
  await clickRevealed(page, transfer(page, 'move')); const moved = await backup(page), sequence = current(moved).manual!;
  expect(sequence.root).toEqual([{ frame: 450, position: [0.8, 1.05, 0] }, { frame: 480, position: [1.2, 1.05, 0] }]);
  expect(sequence.rotations).toEqual(current(original).manual!.rotations); expect(sequence.baseTake).toEqual(source.take);
  expect(moved.scene.project.revision).toBe(original.scene.project.revision + 1); checkUneditedHead(current(moved), source.take);
  await frame(page, 0); await expect(transfer(page, 'move')).toBeDisabled();
  await frame(page, 1); await expect(transfer(page, 'copy')).toBeDisabled();
  expect((await backup(page)).scene.project).toEqual(moved.scene.project);
  await page.setViewportSize({ width: 390, height: 844 }); await frame(page, 450); await capture(page, 'choreo-transfer-mobile.png');
});

test('@transfer draft cancellation and discard preserve source keys; write-before-transfer captures the original scope, source and destination through confirmation', async ({ page }) => {
  test.setTimeout(180_000);
  const source = await openScene(page);
  await rotationKey(page, 75, 'LeftUpperArm', 30); await rotationKey(page, 75, 'RightUpperArm', -20); await rootKey(page, 75, 0.7);
  await rotationKey(page, 150, 'LeftUpperArm', 60); await frame(page, 75); await joint(page, 'LeftUpperArm'); await scope(page, 'joint'); await target(page, 150);
  const original = await backup(page);
  await numeric(page, 'Root X 位移（米）', 2);
  await clickRevealed(page, transfer(page, 'copy')); await expect(guard(page)).toBeVisible();
  await guard(page).getByRole('button', { name: '取消', exact: true }).click();
  await expect(draft(page)).toBeVisible(); expect((await backup(page)).scene.project).toEqual(original.scene.project);
  await clickRevealed(page, transfer(page, 'copy')); await guard(page).getByRole('button', { name: '放弃草稿，继续', exact: true }).click();
  await expect(collision(page)).toBeVisible(); await collision(page).getByRole('button', { name: '取消', exact: true }).click();
  await expect(draft(page)).toHaveCount(0); expect((await backup(page)).scene.project).toEqual(original.scene.project);

  await numeric(page, 'Root X 位移（米）', 1.8);
  await clickRevealed(page, transfer(page, 'copy')); await expect(guard(page)).toBeVisible();
  // Simulate a queued view-state update while the confirmation is open. The
  // captured action must not read a changed filter/joint/target after writing.
  await destination(page).evaluate((input: HTMLInputElement) => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, '120');
    input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await page.getByRole('combobox', { name: '关键帧轨道筛选', exact: true }).evaluate((input: HTMLSelectElement) => { input.value = 'root'; input.dispatchEvent(new Event('change', { bubbles: true })); });
  await page.getByRole('combobox', { name: '选择关节', exact: true }).evaluate((input: HTMLSelectElement) => { input.value = 'RightUpperArm'; input.dispatchEvent(new Event('change', { bubbles: true })); });
  await guard(page).getByRole('button', { name: '写入完整姿态后继续', exact: true }).click();
  await expect(collision(page)).toBeVisible(); await expect(collision(page)).toContainText('150');
  await collision(page).getByRole('button', { name: '替换并继续', exact: true }).click();
  const completed = await backup(page), sequence = current(completed).manual!;
  expect(completed.scene.project.revision).toBe(original.scene.project.revision + 2);
  expect(sequence.rotations.LeftUpperArm!.map(key => key.frame)).toEqual([75, 150]);
  expect(sequence.rotations.LeftUpperArm![1].rotation).toEqual(sequence.rotations.LeftUpperArm![0].rotation);
  expect(sequence.rotations.RightUpperArm!.map(key => key.frame)).toEqual([75]);
  expect(sequence.root).toEqual([{ frame: 75, position: [1.8, 1.05, 0] }]);
  expect(Object.keys(sequence.rotations)).toHaveLength(19); expect(sequence.baseTake).toEqual(source.take);
  await expect(draft(page)).toHaveCount(0);
  expect(current(completed).take.times.at(-1)).toBe(16);
  for (const [index, time] of source.take.times.entries()) expect(current(completed).take.poses[current(completed).take.times.indexOf(time)].joints.LeftHandTip).toEqual(source.take.poses[index].joints.LeftHandTip);
});
