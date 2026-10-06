import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import { PerspectiveCamera, Vector3 } from 'three';

// This fixture keeps the published v4 schema, without importing the new editor
// implementation. Its original WAV and non-uniform source samples are local.
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
type Sequence = {
  schema: 'manual-keyframes-1'; id: string; fps: 30; baseTake: Take;
  rotations: Partial<Record<Joint, { frame: number; rotation: Quat }[]>>;
  root: { frame: number; position: Vec3 }[];
};
type Snapshot = { title: string; countMap: { id: string; durationSeconds: number }; plan: unknown; take: Take; manual?: Sequence };
type Backup = {
  scene: {
    id: string; name: string; audioName: string;
    project: { historyIndex: number; history: Snapshot[]; revision: number; teacherCheckedRevision: number | null };
    viewer: { camera: Camera; mirror: boolean; selectedJoint: Joint | null; time: number };
  };
};
const current = (document: Backup) => document.scene.project.history[document.scene.project.historyIndex];
const sha = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

const diagnostics = new WeakMap<Page, { errors: string[]; warnings: string[] }>();
test.beforeEach(async ({ page }) => {
  const messages = { errors: [] as string[], warnings: [] as string[] };
  diagnostics.set(page, messages);
  page.on('pageerror', error => messages.errors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error') messages.errors.push(message.text());
    if (message.type() === 'warning') messages.warnings.push(message.text());
  });
  page.on('dialog', dialog => { void (dialog.type() === 'beforeunload' ? dialog.accept() : dialog.dismiss()); });
});
test.afterEach(async ({ page }, testInfo) => {
  const messages = diagnostics.get(page)!;
  await testInfo.attach('browser-console', { body: JSON.stringify(messages), contentType: 'application/json' });
  expect(messages.errors, 'Browser runtime errors').toEqual([]);
});

async function ready(page: Page) {
  await page.goto('/');
  await expect(page.getByRole('button', { name: '播放', exact: true })).toBeEnabled();
  await expect(page.getByLabel('相机世界坐标')).not.toContainText('—');
  await expect.poll(() => page.locator('audio').evaluate((audio: HTMLAudioElement) => audio.readyState)).toBeGreaterThanOrEqual(2);
}
async function backup(page: Page): Promise<Backup> {
  const downloading = page.waitForEvent('download');
  await page.getByRole('button', { name: '下载项目备份', exact: true }).click();
  const path = await (await downloading).path();
  expect(path).toBeTruthy();
  return JSON.parse(await readFile(path!, 'utf8')) as Backup;
}
async function save(page: Page) {
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.locator('.save-state')).toHaveText('已保存到本机');
}
async function audioHash(page: Page) {
  return page.locator('audio').evaluate(async (audio: HTMLAudioElement) => {
    const bytes = await (await fetch(audio.src)).arrayBuffer();
    return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), byte => byte.toString(16).padStart(2, '0')).join('');
  });
}
function waveFixture() {
  const sampleRate = 8000, samples = sampleRate * 20;
  const bytes = Buffer.alloc(44 + samples * 2);
  bytes.write('RIFF', 0); bytes.writeUInt32LE(36 + samples * 2, 4); bytes.write('WAVE', 8);
  bytes.write('fmt ', 12); bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(sampleRate, 24); bytes.writeUInt32LE(sampleRate * 2, 28); bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34);
  bytes.write('data', 36); bytes.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i++) bytes.writeInt16LE(Math.round(Math.sin(i / sampleRate * Math.PI * 2 * 440) * 1500), 44 + i * 2);
  return bytes;
}
function legacyFixture() {
  const id = 'v4-local-original-scene', name = 'v4 原音频场景';
  const countMap = {
    id: 'v4-count-map', version: 1, bpm: 120, musicBeatsPerDanceCount: 1,
    firstCountSourceSeconds: 1, sourceOffsetSeconds: 1, durationSeconds: 16,
    octetCount: 4, countTimesSeconds: Array.from({ length: 33 }, (_, index) => index * 0.5), confirmed: true,
  };
  const labels = ['左右点步', '侧向舒展', '轻柔律动', '舒展收势'];
  const actions = ['step-touch', 'side-reach', 'groove', 'settle'];
  const plan = {
    id: 'v4-plan', countMapId: countMap.id, durationSeconds: 16, provenance: 'synthetic-demo',
    slots: labels.map((label, slotIndex) => ({
      slotIndex, actionId: actions[slotIndex], label, teachingCue: '原创本地兼容样例',
      startSeconds: slotIndex * 4, endSeconds: (slotIndex + 1) * 4,
      countStart: slotIndex * 8 + 1, countEnd: (slotIndex + 1) * 8,
      role: slotIndex === 0 ? 'opening' : slotIndex === 3 ? 'closing' : 'body',
    })),
  };
  const times = [0, 0.7, 2.5, 4, 8, 12, 16];
  const poses = times.map((time): Pose => ({
    root: [time === 16 ? 0.2 : time / 80, 1.05, 0],
    joints: Object.fromEntries(joints.map(joint => [joint, joint === 'Head'
      ? [0, Math.sin(time / 160), 0, Math.cos(time / 160)] : [0, 0, 0, 1]])) as Record<Joint, Quat>,
  }));
  const take: Take = { id: 'v4-take', schemaVersion: 'preview-1', planId: plan.id, countMapId: countMap.id, durationSeconds: 16, times, poses, provenance: 'synthetic-demo' };
  const scene = {
    schema: 'choreo-scene-1', id, name, createdAt: '2026-10-06T14:00:00.000Z', updatedAt: '2026-10-06T14:00:00.000Z',
    coordinateSystem: { handedness: 'right', upAxis: '+Y', forwardAxis: '+Z', units: 'm', floorPlane: 'XZ', origin: [0, 0, 0] },
    actor: { id: 'actor-1', rigId: 'synthetic-skeleton-1', provenance: 'synthetic-demo', joints: [...joints] },
    project: { history: [{ title: name, countMap, plan, take }], historyIndex: 0, revision: 1, audioDuration: 20, teacherCheckedRevision: 1 },
    audioName: 'v4-original-local.wav',
    viewer: { camera: null, view: 'front', mirror: false, rate: 1, loop: false, countSound: false, selectedSlot: 0, selectedJoint: null, time: 0 },
  };
  return { scene, take, wave: waveFixture() };
}
async function openLegacyScene(page: Page, includeSecond = false) {
  const fixture = legacyFixture();
  await ready(page);
  await page.evaluate(async ({ scene, bytes, includeSecond }) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('choreo-studio-preview', 2);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(['scenes', 'sceneIndex', 'sceneMeta'], 'readwrite');
      tx.objectStore('scenes').put({ ...scene, audio: new Blob([new Uint8Array(bytes)], { type: 'audio/wav' }) }, scene.id);
      const { schema, id, name, createdAt, updatedAt, audioName } = scene;
      tx.objectStore('sceneIndex').put({ schema, id, name, createdAt, updatedAt, audioName }, id);
      tx.objectStore('sceneMeta').put(id, 'currentSceneId');
      tx.objectStore('sceneMeta').put(true, 'legacyProjectMigrated');
      if (includeSecond) {
        const copy = { ...scene, id: 'v4-second-scene', name: '切换目标 B', project: structuredClone(scene.project), audio: new Blob([new Uint8Array(bytes)], { type: 'audio/wav' }) };
        tx.objectStore('scenes').put(copy, copy.id);
        tx.objectStore('sceneIndex').put({ schema, id: copy.id, name: copy.name, createdAt, updatedAt, audioName }, copy.id);
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
    db.close();
  }, { scene: fixture.scene, bytes: Array.from(fixture.wave), includeSecond });
  await page.reload();
  await expect(page.locator('.project-title h1')).toHaveText(fixture.scene.name);
  await expect(page.getByRole('button', { name: '播放', exact: true })).toBeEnabled();
  await expect(page.locator('.save-state')).toHaveText('已保存到本机');
  expect(current(await backup(page)).take).toEqual(fixture.take);
  expect(await audioHash(page)).toBe(createHash('sha256').update(fixture.wave).digest('hex'));
  return fixture;
}

async function seek(page: Page, time: number) {
  const slider = page.getByRole('slider', { name: '播放进度', exact: true });
  await slider.evaluate((element: HTMLInputElement, value) => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(element, String(value));
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
  }, time);
  await expect(slider).toHaveValue(String(time));
}

const draftNote = (page: Page) => page.getByRole('status').filter({ hasText: '姿态草稿 · 尚未写入关键帧' });
const draftGuard = (page: Page) => page.getByRole('dialog', { name: '写入这份姿态草稿？', exact: true });
async function editor(page: Page) {
  const region = page.getByRole('region', { name: '手动关键帧编辑器', exact: true });
  if (!await region.isVisible()) await page.getByRole('button', { name: '手动 K帧', exact: true }).click();
  await expect(region).toBeVisible();
}
async function selectJoint(page: Page, joint: Joint) {
  await page.getByRole('combobox', { name: '选择关节', exact: true }).selectOption(joint);
  await expect(page.getByRole('combobox', { name: '选择关节', exact: true })).toHaveValue(joint);
}
async function numeric(page: Page, label: string, value: number) {
  const input = page.getByRole('spinbutton', { name: label, exact: true });
  await input.fill(String(value));
  await input.press('Tab');
}
async function angle(page: Page, value: number) { await numeric(page, '关节 Z 旋转（度）', value); }
async function rootX(page: Page, value: number) { await numeric(page, 'Root X 位移（米）', value); }
async function frame(page: Page, value: number) {
  await numeric(page, '当前帧', value);
  await expect(page.getByRole('spinbutton', { name: '当前帧', exact: true })).toHaveValue(String(value));
}
async function expectNumber(page: Page, label: string, value: number, tolerance = 0.051) {
  await expect.poll(async () => Math.abs(Number(await page.getByRole('spinbutton', { name: label, exact: true }).inputValue()) - value)).toBeLessThan(tolerance);
}
async function worldPosition(page: Page): Promise<number[]> {
  const text = await page.getByLabel('选中关节世界坐标', { exact: true }).locator('strong').innerText();
  return Array.from(text.matchAll(/[XYZ]\s*(-?\d+(?:\.\d+)?)/g), match => Number(match[1]));
}
async function expectWorld(page: Page, expected: Vec3) {
  await expect.poll(async () => {
    const position = await worldPosition(page);
    return position.length === 3 && position.every((value, i) => Math.abs(value - expected[i]) < 0.002);
  }).toBe(true);
}
async function write(page: Page, kind: '当前关节' | '位移' | '完整姿态') {
  await page.getByRole('button', { name: `K ${kind}`, exact: true }).click();
  await expect(draftNote(page)).toHaveCount(0);
}
async function sameSnapshot(page: Page, snapshot: Snapshot) {
  const actual = current(await backup(page));
  expect(actual.manual).toEqual(snapshot.manual);
  expect(actual.take).toEqual(snapshot.take);
}
async function library(page: Page) {
  await page.getByRole('button', { name: '场景', exact: true }).click();
  return page.getByRole('dialog', { name: '本机场景', exact: true });
}
async function openScene(page: Page, name: string) {
  await (await library(page)).getByRole('button', { name: `打开场景 ${name}`, exact: true }).click();
}

test('pose drafts remain previews until explicit keys, interpolate real joint and Root output, and support updates, deletion and undo', async ({ page }) => {
  test.setTimeout(180_000);
  await openLegacyScene(page);
  await editor(page);
  await page.getByRole('button', { name: '从站姿开始', exact: true }).click();
  await selectJoint(page, 'LeftUpperArm');
  const neutral = current(await backup(page));
  expect(neutral.manual?.root).toEqual([]);
  expect(neutral.manual?.rotations).toEqual({});
  expect(neutral.take.poses.every(pose => pose.root.join(',') === '0,1.05,0')).toBe(true);

  await selectJoint(page, 'Hips'); await expectWorld(page, [0, 1.05, 0]);
  await selectJoint(page, 'LeftUpperArm');
  await expect.poll(() => worldPosition(page)).not.toEqual([0, 1.05, 0]);
  const upperArm = await worldPosition(page);
  await selectJoint(page, 'LeftForeArm');
  await expect.poll(() => worldPosition(page)).not.toEqual(upperArm);
  const foreArm = await worldPosition(page);
  const limb = foreArm.map((value, i) => value - upperArm[i]);
  await selectJoint(page, 'LeftUpperArm');

  const unchangedFrame = await page.getByRole('img', { name: '原创人偶的编舞动作预览' }).screenshot();
  await angle(page, 30); await rootX(page, 0.5);
  await expect(draftNote(page)).toBeVisible();
  await expectNumber(page, '关节 Z 旋转（度）', 30);
  expect((await page.getByRole('img', { name: '原创人偶的编舞动作预览' }).screenshot()).equals(unchangedFrame)).toBe(false);
  await sameSnapshot(page, neutral);
  await angle(page, 0); await rootX(page, 0);
  await write(page, '完整姿态');
  const first = current(await backup(page));
  expect(first.manual!.root).toEqual([{ frame: 0, position: [0, 1.05, 0] }]);
  expect(Object.keys(first.manual!.rotations)).toHaveLength(19);
  await frame(page, 90);
  await angle(page, 90); await rootX(page, 2);
  await write(page, '完整姿态');
  const two = current(await backup(page));
  expect(two.manual!.root.map(key => key.frame)).toEqual([0, 90]);
  expect(two.manual!.rotations.LeftUpperArm!.map(key => key.frame)).toEqual([0, 90]);
  expect(two.manual!.baseTake).toEqual(neutral.take);
  expect(two.manual!.rotations.LeftUpperArm![1].rotation[2]).toBeCloseTo(Math.SQRT1_2, 8);
  expect(two.manual!.rotations.LeftUpperArm![1].rotation[3]).toBeCloseTo(Math.SQRT1_2, 8);
  await expect(page.getByRole('list', { name: '关键帧列表', exact: true }).getByRole('listitem')).toHaveCount(2);

  // A single-axis 0 -> 90 degree arc has an independently known 45 degree
  // midpoint. The child landmark checks the rendered hierarchy as well as UI.
  await frame(page, 45);
  await expectNumber(page, '关节 Z 旋转（度）', 45);
  await expectNumber(page, 'Root X 位移（米）', 1, 0.002);
  await selectJoint(page, 'Hips'); await expectWorld(page, [1, 1.05, 0]);
  await selectJoint(page, 'LeftForeArm');
  await expectWorld(page, [
    1 + upperArm[0] + (limb[0] - limb[1]) * Math.SQRT1_2,
    upperArm[1] + (limb[0] + limb[1]) * Math.SQRT1_2,
    upperArm[2] + limb[2],
  ]);
  await selectJoint(page, 'LeftUpperArm');
  await page.evaluate(() => window.scrollTo({ top: 0, left: 0, behavior: 'instant' }));
  await page.screenshot({ path: '/tmp/choreo-keyframes-written-desktop.png', fullPage: true });
  await frame(page, 480);
  await expectNumber(page, 'Root X 位移（米）', 0, 0.002);
  await expectNumber(page, '关节 Z 旋转（度）', 0);
  expect(two.take.poses.at(-1)).toEqual(neutral.take.poses.at(-1));

  await frame(page, 90); await angle(page, 120); await write(page, '当前关节');
  const updated = current(await backup(page));
  expect(updated.manual!.rotations.LeftUpperArm).toHaveLength(2);
  expect(updated.manual!.rotations.LeftUpperArm![1].rotation[2]).toBeCloseTo(Math.sqrt(3) / 2, 8);
  expect(updated.manual!.root).toEqual(two.manual!.root);
  await page.getByRole('button', { name: '删除当前帧关键帧', exact: true }).click();
  const deleted = current(await backup(page));
  expect(deleted.manual!.root.map(key => key.frame)).toEqual([0]);
  expect(deleted.manual!.rotations.LeftUpperArm!.map(key => key.frame)).toEqual([0]);
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  await sameSnapshot(page, updated);
  await page.getByRole('button', { name: '重做', exact: true }).click();
  await sameSnapshot(page, deleted);
  await frame(page, 0);
  await page.getByRole('button', { name: '删除当前帧关键帧', exact: true }).click();
  const empty = current(await backup(page));
  expect(empty.take.times).toEqual(neutral.take.times);
  expect(empty.take.poses).toEqual(neutral.take.poses);
  expect(empty.take.id).not.toBe(neutral.take.id);
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  await sameSnapshot(page, deleted);
});

test('old v4 scenes retain their original audio and motion, while explicit joint and Root keys survive save and refresh without mirror writes', async ({ page }) => {
  test.setTimeout(180_000);
  const fixture = await openLegacyScene(page);
  const old = await backup(page);
  expect(current(old).manual).toBeUndefined();
  await page.getByRole('button', { name: '播放', exact: true }).click();
  await expect.poll(() => page.locator('audio').evaluate((audio: HTMLAudioElement) => audio.currentTime)).toBeGreaterThan(1.5);
  await page.getByRole('button', { name: '暂停', exact: true }).click();
  await seek(page, 0);
  await editor(page); await selectJoint(page, 'LeftUpperArm');
  await angle(page, 0); await write(page, '当前关节');
  await rootX(page, 0); await write(page, '位移');
  await frame(page, 90);
  await angle(page, 90); await write(page, '当前关节');
  await rootX(page, 2); await write(page, '位移');
  const authored = await backup(page), authoredSnapshot = current(authored);
  expect(authoredSnapshot.manual!.baseTake).toEqual(fixture.take);
  expect(Object.keys(authoredSnapshot.manual!.rotations)).toEqual(['LeftUpperArm']);
  expect(authoredSnapshot.manual!.root.map(key => key.frame)).toEqual([0, 90]);
  expect(authored.scene.project.teacherCheckedRevision).toBeNull();
  // Every untouched source knot keeps its original bits. Additional key
  // times must stay on the source's independently known constant-rate arc.
  for (const [sourceIndex, time] of fixture.take.times.entries()) {
    const index = authoredSnapshot.take.times.indexOf(time);
    expect(index, `Original non-uniform sample at ${time}s must remain`).toBeGreaterThanOrEqual(0);
    expect(authoredSnapshot.take.poses[index].joints.Head).toEqual(fixture.take.poses[sourceIndex].joints.Head);
  }
  for (const [index, time] of authoredSnapshot.take.times.entries()) {
    const rotation = authoredSnapshot.take.poses[index].joints.Head;
    expect(rotation[1]).toBeCloseTo(Math.sin(time / 160), 6);
    expect(rotation[3]).toBeCloseTo(Math.cos(time / 160), 6);
    expect(authoredSnapshot.take.poses[index].joints.LeftHandTip).toEqual([0, 0, 0, 1]);
  }
  await save(page);
  const saved = await backup(page);
  await page.reload();
  await expect(page.locator('.save-state')).toHaveText('已保存到本机');
  await expect(page.getByRole('button', { name: '播放', exact: true })).toBeEnabled();
  const restored = await backup(page);
  expect(restored.scene.project).toEqual(saved.scene.project);
  expect(await audioHash(page)).toBe(createHash('sha256').update(fixture.wave).digest('hex'));
  await editor(page); await selectJoint(page, 'LeftUpperArm');
  await frame(page, 45);
  await expectNumber(page, '关节 Z 旋转（度）', 45);
  await expectNumber(page, 'Root X 位移（米）', 1, 0.002);
  await selectJoint(page, 'Hips'); await expectWorld(page, [1, 1.05, 0]);
  const beforeMirror = current(await backup(page));
  await page.getByRole('button', { name: '镜像观看', exact: true }).click();
  await expect(page.getByRole('button', { name: 'K 完整姿态', exact: true })).toBeDisabled();
  await expectWorld(page, [1, 1.05, 0]);
  await sameSnapshot(page, beforeMirror);
  await page.getByRole('button', { name: '镜像观看', exact: true }).click();
  await selectJoint(page, 'LeftHandTip');
  await expect(page.getByRole('button', { name: 'K 当前关节', exact: true })).toBeDisabled();
  await expect(page.getByRole('spinbutton', { name: '关节 Z 旋转（度）', exact: true })).toBeDisabled();
  await expect(page.getByRole('region', { name: '手动关键帧编辑器', exact: true })).toContainText('末端节点只读');
  await sameSnapshot(page, beforeMirror);

  await page.getByRole('button', { name: '八拍编排', exact: true }).click();
  await page.getByRole('listitem', { name: /^第2个八拍/ }).click();
  await page.getByRole('button', { name: '换一个八拍', exact: true }).click();
  const candidate = page.getByRole('region', { name: '替换候选', exact: true });
  await expect(page.getByRole('status')).toContainText('替换需要包含完整八拍边界和内部样本');
  await expect(candidate).toHaveCount(0);
  await sameSnapshot(page, beforeMirror);
  await page.getByRole('listitem', { name: /^第1个八拍/ }).click();
  await page.getByRole('button', { name: '换一个八拍', exact: true }).click();
  await expect(candidate).toBeVisible();
  await candidate.getByRole('button', { name: '采用', exact: true }).click();
  const confirmation = page.getByRole('dialog', { name: '固化当前手动编舞并换段？', exact: true });
  await expect(confirmation).toBeVisible();
  await confirmation.getByRole('button', { name: '取消', exact: true }).click();
  await sameSnapshot(page, beforeMirror);
  await candidate.getByRole('button', { name: '采用', exact: true }).click();
  await confirmation.getByRole('button', { name: '确认并继续', exact: true }).click();
  const adopted = current(await backup(page));
  expect(adopted.manual).toBeUndefined();
  expect(adopted.take.id).not.toBe(beforeMirror.take.id);
  const outside = (take: Take) => take.times.flatMap((time, index) => time <= 0 || time >= 4 ? [{ time, pose: take.poses[index] }] : []);
  expect(outside(adopted.take), 'A manual replacement must preserve the baked poses outside the selected phrase').toEqual(outside(beforeMirror.take));
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  await sameSnapshot(page, beforeMirror);
});

test('dirty pose guards preserve cancel and failed-save drafts, distinguish discard from explicit save, and remain usable on small screens', async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  const fixture = await openLegacyScene(page, true);
  await editor(page); await selectJoint(page, 'Hips');
  await rootX(page, 0.6);
  const old = current(await backup(page));
  await page.getByRole('button', { name: '播放', exact: true }).click();
  await expect(draftGuard(page)).toBeVisible();
  await draftGuard(page).getByRole('button', { name: '取消', exact: true }).click();
  await expectNumber(page, 'Root X 位移（米）', 0.6, 0.002);
  await expect(page.getByRole('button', { name: '播放', exact: true })).toBeVisible();
  await numeric(page, '当前帧', 45);
  await expect(draftGuard(page)).toBeVisible();
  await draftGuard(page).getByRole('button', { name: '取消', exact: true }).click();
  await expect(page.getByRole('spinbutton', { name: '当前帧', exact: true })).toHaveValue('0');
  await sameSnapshot(page, old);

  await openScene(page, '切换目标 B');
  await expect(draftGuard(page)).toBeVisible();
  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 844 });
    const geometry = await page.evaluate(() => ({ client: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }));
    expect(geometry.scroll).toBeLessThanOrEqual(geometry.client);
    for (const label of ['取消', '放弃草稿，继续', '写入完整姿态后继续']) {
      const button = draftGuard(page).getByRole('button', { name: label, exact: true });
      await button.scrollIntoViewIfNeeded();
      await expect(button).toBeInViewport();
    }
    await page.screenshot({ path: `/tmp/choreo-keyframes-${width}-draft-guard.png`, fullPage: true });
  }
  await draftGuard(page).getByRole('button', { name: '取消', exact: true }).click();
  await page.getByRole('button', { name: '关闭场景列表', exact: true }).click();
  await expect(page.locator('.project-title h1')).toHaveText(fixture.scene.name);
  await expectNumber(page, 'Root X 位移（米）', 0.6, 0.002);
  await expectWorld(page, [0.6, 1.05, 0]);

  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(draftGuard(page)).toBeVisible();
  await draftGuard(page).getByRole('button', { name: '取消', exact: true }).click();
  await sameSnapshot(page, old);
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await draftGuard(page).getByRole('button', { name: '写入完整姿态后继续', exact: true }).click();
  await expect(page.locator('.save-state')).toHaveText('已保存到本机');
  const saved = current(await backup(page));
  expect(saved.manual!.root[0].position[0]).toBe(0.6);
  await rootX(page, 2);
  await openScene(page, '切换目标 B');
  await draftGuard(page).getByRole('button', { name: '放弃草稿，继续', exact: true }).click();
  await expect(page.locator('.project-title h1')).toHaveText('切换目标 B');
  await openScene(page, fixture.scene.name);
  await expect(page.locator('.project-title h1')).toHaveText(fixture.scene.name);
  await editor(page); await selectJoint(page, 'Hips');
  await sameSnapshot(page, saved);
  await expectNumber(page, 'Root X 位移（米）', 0.6, 0.002);

  await rootX(page, 1.4);
  // Simulate a browser-local quota failure only for write transactions. The
  // scene must retain the now-explicit pose, then permit a successful retry.
  await page.evaluate(() => {
    const proto = IDBDatabase.prototype as typeof IDBDatabase.prototype & { originalTransaction?: typeof IDBDatabase.prototype.transaction };
    proto.originalTransaction = proto.transaction;
    proto.transaction = function (...args: Parameters<typeof IDBDatabase.prototype.transaction>) {
      if (args[1] === 'readwrite') throw new DOMException('Test local save quota', 'QuotaExceededError');
      return proto.originalTransaction!.apply(this, args);
    };
  });
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await draftGuard(page).getByRole('button', { name: '写入完整姿态后继续', exact: true }).click();
  await expect(page.locator('.save-state')).toHaveText('保存失败');
  const failed = current(await backup(page));
  expect(failed.manual!.root).toHaveLength(1);
  expect(failed.manual!.root[0].position[0]).toBe(1.4);
  await expectWorld(page, [1.4, 1.05, 0]);
  await page.evaluate(() => {
    const proto = IDBDatabase.prototype as typeof IDBDatabase.prototype & { originalTransaction?: typeof IDBDatabase.prototype.transaction };
    proto.transaction = proto.originalTransaction!;
    delete proto.originalTransaction;
  });
  await save(page);

  // Hold only the transaction-completion acknowledgement. The real local
  // transaction has committed; the UI still has an in-flight save promise.
  await page.evaluate(() => {
    const proto = IDBDatabase.prototype as typeof IDBDatabase.prototype & { originalTransaction?: typeof IDBDatabase.prototype.transaction };
    proto.originalTransaction = proto.transaction;
    const complete = Object.getOwnPropertyDescriptor(IDBTransaction.prototype, 'oncomplete')!;
    proto.transaction = function (...args: Parameters<typeof IDBDatabase.prototype.transaction>) {
      const tx = proto.originalTransaction!.apply(this, args);
      if (args[1] === 'readwrite') {
        Object.defineProperty(tx, 'oncomplete', {
          configurable: true,
          get: () => complete.get!.call(tx),
          set: (handler: ((this: IDBTransaction, event: Event) => unknown) | null) => complete.set!.call(tx, (event: Event) => {
            (window as Window & { releaseChoreoSave?: () => void }).releaseChoreoSave = () => handler?.call(tx, event);
          }),
        });
      }
      return tx;
    };
  });
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.locator('.save-state')).toHaveText('保存中');
  await expect.poll(() => page.evaluate(() => typeof (window as Window & { releaseChoreoSave?: () => void }).releaseChoreoSave === 'function')).toBe(true);
  const editableDuringSave = !await page.getByRole('spinbutton', { name: 'Root X 位移（米）', exact: true }).isDisabled();
  if (editableDuringSave) {
    await rootX(page, 1.9);
    await expect(draftNote(page)).toBeVisible();
  }
  await page.evaluate(() => {
    const runtime = window as Window & { releaseChoreoSave?: () => void };
    runtime.releaseChoreoSave!(); delete runtime.releaseChoreoSave;
    const proto = IDBDatabase.prototype as typeof IDBDatabase.prototype & { originalTransaction?: typeof IDBDatabase.prototype.transaction };
    proto.transaction = proto.originalTransaction!; delete proto.originalTransaction;
  });
  if (editableDuringSave) {
    await expect(page.locator('.save-state')).toHaveText('有未保存更改');
    await expectNumber(page, 'Root X 位移（米）', 1.9, 0.002);
    await page.getByRole('button', { name: '撤回草稿', exact: true }).click();
    await expect(draftNote(page)).toHaveCount(0);
    await expect(page.locator('.save-state')).toHaveText('有未保存更改');
    await sameSnapshot(page, failed);
    await expect(page.getByRole('button', { name: '保存', exact: true })).toBeEnabled();
    await save(page);
  } else {
    await expect(page.locator('.save-state')).toHaveText('已保存到本机');
    await expect(page.getByRole('spinbutton', { name: 'Root X 位移（米）', exact: true })).toBeEnabled();
  }
  await testInfo.attach('delayed-save-regression', { body: JSON.stringify({ editableDuringSave }), contentType: 'application/json' });
  await page.reload();
  await expect(page.locator('.save-state')).toHaveText('已保存到本机');
  await sameSnapshot(page, failed);
  expect(await audioHash(page)).toBe(createHash('sha256').update(fixture.wave).digest('hex'));
});

test('dragging a visible local rotation ring edits a pose draft while orbiting changes only the camera', async ({ page }) => {
  test.setTimeout(120_000);
  await openLegacyScene(page);
  await editor(page);
  await page.getByRole('button', { name: '从站姿开始', exact: true }).click();
  await selectJoint(page, 'Hips'); await expectWorld(page, [0, 1.05, 0]);
  await page.getByRole('button', { name: '复位相机', exact: true }).click();
  await expect(page.getByRole('button', { name: '正面', exact: true })).toHaveAttribute('aria-pressed', 'true');
  const before = await backup(page), original = current(before);
  const cameraBefore = before.scene.viewer.camera;
  expect(cameraBefore).toBeTruthy();
  const canvas = page.getByRole('img', { name: '原创人偶的编舞动作预览' });
  await canvas.scrollIntoViewIfNeeded();
  const box = (await canvas.boundingBox())!;
  const projection = new PerspectiveCamera(40, box.width / box.height, 0.05, 80);
  projection.position.fromArray(cameraBefore.position);
  projection.zoom = cameraBefore.zoom ?? 1;
  projection.lookAt(new Vector3(...cameraBefore.target));
  projection.updateProjectionMatrix(); projection.updateMatrixWorld(true);
  const hips = new Vector3(0, 1.05, 0);
  // Official TransformControls' visible Z ring, projected through the public
  // scene camera. Hover feedback confirms the chosen handle before dragging.
  const radius = projection.position.distanceTo(hips) * 1.9 * Math.tan(40 * Math.PI / 360) / projection.zoom * 0.95 / 8;
  const ringPoint = (angle: number) => {
    const point = hips.clone().add(new Vector3(radius * Math.cos(angle), radius * Math.sin(angle), 0)).project(projection);
    return { x: box.x + (point.x + 1) * box.width / 2, y: box.y + (1 - point.y) * box.height / 2 };
  };
  const start = ringPoint(0.55), end = ringPoint(1.2);
  await page.mouse.move(start.x, start.y);
  await expect(page.getByLabel('关节局部旋转', { exact: true })).toContainText('Z轴');
  await page.mouse.down({ button: 'left' });
  await page.mouse.move(end.x, end.y, { steps: 12 });
  await page.mouse.up({ button: 'left' });
  await expect(draftNote(page)).toBeVisible();
  await expect.poll(async () => Math.abs(Number(await page.getByRole('spinbutton', { name: '关节 Z 旋转（度）', exact: true }).inputValue()))).toBeGreaterThan(10);
  const draft = await backup(page);
  expect(sha(current(draft))).toBe(sha(original));
  expect(draft.scene.viewer.camera).toEqual(cameraBefore);
  await write(page, '当前关节');
  const committed = await backup(page);
  expect(current(committed).manual!.rotations.Hips).toHaveLength(1);
  expect(current(committed).manual!.rotations.Hips![0].rotation).not.toEqual([0, 0, 0, 1]);
  expect(committed.scene.viewer.camera).toEqual(cameraBefore);

  await canvas.scrollIntoViewIfNeeded();
  const orbitBox = (await canvas.boundingBox())!;
  const coordinateBefore = await page.getByLabel('相机世界坐标', { exact: true }).innerText();
  await page.mouse.move(orbitBox.x + orbitBox.width * 0.84, orbitBox.y + orbitBox.height * 0.24);
  await page.mouse.down({ button: 'left' });
  await page.mouse.move(orbitBox.x + orbitBox.width * 0.93, orbitBox.y + orbitBox.height * 0.34, { steps: 12 });
  await page.mouse.up({ button: 'left' });
  await expect.poll(() => page.getByLabel('相机世界坐标', { exact: true }).innerText()).not.toBe(coordinateBefore);
  await expect(draftNote(page)).toHaveCount(0);
  const orbited = await backup(page);
  expect(orbited.scene.viewer.camera.position).not.toEqual(cameraBefore.position);
  expect(current(orbited)).toEqual(current(committed));
  await expect(page.getByRole('combobox', { name: '选择关节', exact: true })).toHaveValue('Hips');
});
