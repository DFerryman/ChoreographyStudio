import { createHash } from 'node:crypto';
import { mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { clickRevealed, reveal, seekSeconds } from './helpers';
import { PerspectiveCamera, Quaternion, Vector3 } from 'three';

// Original local data with non-uniform samples and a translated, articulated
// rig. Assertions forward-project exported camera state, without reading the
// renderer or importing its framing implementation.
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
type Camera = { position: Vec3; target: Vec3; zoom?: number };
type Take = { id: string; schemaVersion: string; planId: string; countMapId: string; durationSeconds: number; times: number[]; poses: Pose[]; provenance: string };
type Snapshot = { take: Take; manual?: { root: { frame: number; position: Vec3 }[]; rotations: Partial<Record<Joint, { frame: number; rotation: Quat }[]>> } };
type Backup = { scene: { id: string; name: string; project: { historyIndex: number; history: Snapshot[]; revision: number; teacherCheckedRevision: number | null }; viewer: { camera: Camera; view: string; mirror: boolean; time: number; selectedJoint: Joint | null; editorMode?: string; transformTool?: string } } };
const current = (document: Backup) => document.scene.project.history[document.scene.project.historyIndex];
const whole = (page: Page) => page.getByRole('button', { name: '全身取景', exact: true });
const focus = (page: Page) => page.getByRole('button', { name: '聚焦关节', exact: true, includeHidden: true });
const draft = (page: Page) => page.getByRole('status').filter({ hasText: '姿态草稿 · 尚未写入关键帧' });
const guard = (page: Page) => page.getByRole('dialog', { name: '写入这份姿态草稿？', exact: true });
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
  expect(messages.apiRequests, 'Camera framing and local scene transactions must not call business APIs').toEqual([]);
});

function fixture() {
  const countMap = { id: 'framing-count-map', version: 1, bpm: 120, musicBeatsPerDanceCount: 1, firstCountSourceSeconds: 1, sourceOffsetSeconds: 1, durationSeconds: 16, octetCount: 4, countTimesSeconds: Array.from({ length: 33 }, (_, i) => i * 0.5), confirmed: true };
  const plan = {
    id: 'framing-plan', countMapId: countMap.id, durationSeconds: 16, provenance: 'synthetic-demo',
    slots: ['step-touch', 'side-reach', 'groove', 'settle'].map((actionId, slotIndex) => ({ slotIndex, actionId, label: '原创相机回归样例', teachingCue: '本地回归', startSeconds: slotIndex * 4, endSeconds: (slotIndex + 1) * 4, countStart: slotIndex * 8 + 1, countEnd: (slotIndex + 1) * 8, role: slotIndex === 0 ? 'opening' : slotIndex === 3 ? 'closing' : 'body' })),
  };
  const times = [0, 0.7, 2.5, 4, 8, 12, 16];
  const roots: Vec3[] = [[0, 1.05, 0], [2.2, 1.05, -1], [4.8, 1.05, -2.8], [4.4, 1.05, -2.4], [-4.8, 1.05, 2.6], [2.6, 1.05, 1], [0.4, 1.05, 0]];
  const poses = times.map((time, index): Pose => ({
    root: roots[index],
    joints: Object.fromEntries(joints.map(joint => {
      const angle = joint === 'LeftUpperArm' ? 0.72 : joint === 'RightUpperArm' ? -0.56 : 0;
      const rotation: Quat = joint === 'Head' ? [0, Math.sin(time / 160), 0, Math.cos(time / 160)] : [0, 0, Math.sin(angle / 2), Math.cos(angle / 2)];
      return [joint, rotation];
    })) as Record<Joint, Quat>,
  }));
  const take: Take = { id: 'framing-original-take', schemaVersion: 'preview-1', planId: plan.id, countMapId: countMap.id, durationSeconds: 16, times, poses, provenance: 'synthetic-demo' };
  const scene = {
    schema: 'choreo-scene-1', id: 'framing-local-scene', name: '相机取景回归场景', createdAt: '2026-10-07T11:00:00.000Z', updatedAt: '2026-10-07T11:00:00.000Z',
    coordinateSystem: { handedness: 'right', upAxis: '+Y', forwardAxis: '+Z', units: 'm', floorPlane: 'XZ', origin: [0, 0, 0] },
    actor: { id: 'actor-1', rigId: 'synthetic-skeleton-1', provenance: 'synthetic-demo', joints: [...joints] },
    project: { history: [{ title: '相机取景回归场景', countMap, plan, take }], historyIndex: 0, revision: 1, audioDuration: 20, teacherCheckedRevision: 1 },
    audioName: 'original-framing-local.wav',
    viewer: { camera: null, view: 'front', mirror: false, rate: 1, loop: false, countSound: false, selectedSlot: 0, selectedJoint: null, time: 0 },
  };
  const sampleRate = 8000, samples = sampleRate * 20, wave = Buffer.alloc(44 + samples * 2);
  wave.write('RIFF', 0); wave.writeUInt32LE(36 + samples * 2, 4); wave.write('WAVE', 8);
  wave.write('fmt ', 12); wave.writeUInt32LE(16, 16); wave.writeUInt16LE(1, 20); wave.writeUInt16LE(1, 22);
  wave.writeUInt32LE(sampleRate, 24); wave.writeUInt32LE(sampleRate * 2, 28); wave.writeUInt16LE(2, 32); wave.writeUInt16LE(16, 34);
  wave.write('data', 36); wave.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i++) wave.writeInt16LE(Math.round(Math.sin(i / sampleRate * Math.PI * 2 * 330) * 1500), 44 + i * 2);
  return { scene, take, wave };
}
async function ready(page: Page) {
  await expect(page.getByRole('button', { name: '播放', exact: true })).toBeEnabled();
  await expect(page.getByLabel('相机世界坐标')).not.toContainText('—');
  await expect.poll(() => page.locator('audio').evaluate((audio: HTMLAudioElement) => audio.readyState)).toBeGreaterThanOrEqual(2);
}
async function openFixture(page: Page, second = false) {
  const source = fixture();
  await page.goto('/'); await ready(page);
  await page.evaluate(async ({ scene, bytes, second }) => {
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
      if (second) {
        const other = { ...scene, id: 'framing-second-scene', name: '独立取景场景 B', project: structuredClone(scene.project), audio, viewer: { ...scene.viewer, view: 'free', camera: { position: [8, 7, 9], target: [2, 0.95, 1], zoom: 1.2 } } };
        tx.objectStore('scenes').put(other, other.id);
        tx.objectStore('sceneIndex').put({ schema, id: other.id, name: other.name, createdAt, updatedAt, audioName }, other.id);
      }
      tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error);
    });
    db.close();
  }, { scene: source.scene, bytes: Array.from(source.wave), second });
  await page.reload(); await ready(page);
  await expect(page.locator('.project-title h1')).toHaveText(source.scene.name);
  expect(current(await backup(page)).take).toEqual(source.take);
  return source;
}
async function backup(page: Page): Promise<Backup> {
  const pending = page.waitForEvent('download');
  await clickRevealed(page, page.getByRole('button', { name: '下载项目备份', exact: true, includeHidden: true }));
  const path = await (await pending).path(); expect(path).toBeTruthy();
  return JSON.parse(await readFile(path!, 'utf8')) as Backup;
}
async function audioHash(page: Page) {
  return page.locator('audio').evaluate(async (audio: HTMLAudioElement) => {
    const bytes = await (await fetch(audio.src)).arrayBuffer();
    return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), byte => byte.toString(16).padStart(2, '0')).join('');
  });
}
async function seek(page: Page, time: number) {
  await seekSeconds(page, time);
}
async function numeric(page: Page, label: string, value: number) {
  const input = page.getByRole('spinbutton', { name: label, exact: true });
  await input.fill(String(value)); await input.press('Tab');
}
async function joint(page: Page, value: Joint) {
  await page.getByRole('combobox', { name: '选择关节', exact: true }).selectOption(value);
  await expect(page.getByLabel('选中关节世界坐标').locator('strong')).toContainText('Y');
}
async function cameraText(page: Page) { await reveal(page, page.getByLabel('相机世界坐标')); return page.getByLabel('相机世界坐标').innerText(); }
async function cameraAction(page: Page, kind: 'whole' | 'joint', expectChange = true) {
  const previous = await cameraText(page);
  await clickRevealed(page, kind === 'whole' ? whole(page) : focus(page));
  await expect(page.locator('.viewer-muted')).toHaveText('自由视角');
  if (expectChange) await expect.poll(() => cameraText(page)).not.toBe(previous);
  else await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  return backup(page);
}
function direction(camera: Camera) { return new Vector3(...camera.position).sub(new Vector3(...camera.target)).normalize(); }
function distance(camera: Camera) { return new Vector3(...camera.position).distanceTo(new Vector3(...camera.target)); }
function sameCamera(actual: Camera, expected: Camera) {
  for (const field of ['position', 'target'] as const) for (let i = 0; i < 3; i++) expect(actual[field][i]).toBeCloseTo(expected[field][i], 7);
  expect(actual.zoom ?? 1).toBeCloseTo(expected.zoom ?? 1, 7);
}
function sameDirection(actual: Camera, expected: Camera) { expect(direction(actual).dot(direction(expected))).toBeCloseTo(1, 10); }
function nearPoint(actual: number[], expected: Vector3, digits = 7) { expected.toArray().forEach((value, i) => expect(actual[i]).toBeCloseTo(value, digits)); }

// Established preview-1 rest transforms, evaluated by parent rotation and
// translation independently of Three.js Groups and the production evaluator.
const hierarchy: [Joint, Joint | null, Vec3][] = [
  ['Hips', null, [0, 0, 0]], ['Spine', 'Hips', [0, 0.14, 0]], ['Chest', 'Spine', [0, 0.2, 0]], ['Neck', 'Chest', [0, 0.19, 0]], ['Head', 'Neck', [0, 0.08, 0]],
  ...(['Left', 'Right'] as const).flatMap(side => {
    const sign = side === 'Left' ? 1 : -1;
    return [
      [`${side}Shoulder`, 'Chest', [sign * 0.205, 0.095, 0]], [`${side}UpperArm`, `${side}Shoulder`, [sign * 0.082, -0.03, 0]],
      [`${side}ForeArm`, `${side}UpperArm`, [0, -0.285, 0]], [`${side}Hand`, `${side}ForeArm`, [0, -0.255, 0]], [`${side}HandTip`, `${side}Hand`, [0, -0.115, 0]],
      [`${side}UpperLeg`, 'Hips', [sign * 0.112, -0.05, 0]], [`${side}LowerLeg`, `${side}UpperLeg`, [0, -0.46, 0]], [`${side}Foot`, `${side}LowerLeg`, [0, -0.45, 0]],
      [`${side}Toe`, `${side}Foot`, [0, -0.035, 0.15]], [`${side}Heel`, `${side}Foot`, [0, -0.035, -0.065]],
    ] as [Joint, Joint | null, Vec3][];
  }),
];
function worldRig(pose: Pose, mirror = false) {
  const transforms = new Map<Joint, { position: Vector3; rotation: Quaternion }>();
  for (const [name, parent, offset] of hierarchy) {
    const before = parent ? transforms.get(parent)! : { position: new Vector3(...pose.root), rotation: new Quaternion() };
    transforms.set(name, { position: new Vector3(...offset).applyQuaternion(before.rotation).add(before.position), rotation: before.rotation.clone().multiply(new Quaternion(...pose.joints[name])) });
  }
  const viewPoint = (point: Vector3) => { const result = point.clone(); if (mirror) result.x *= -1; return result; };
  const points: Vector3[] = [];
  for (const [name, transform] of transforms) {
    const radius = name === 'Hips' ? 0.05 : name.includes('Tip') || name.endsWith('Toe') || name.endsWith('Heel') ? 0.027 : 0.037;
    for (const axis of [new Vector3(radius, 0, 0), new Vector3(0, radius, 0), new Vector3(0, 0, radius)]) {
      points.push(viewPoint(transform.position.clone().add(axis)), viewPoint(transform.position.clone().sub(axis)));
    }
  }
  const head = transforms.get('Head')!;
  for (const offset of [[0.105, 0.08, 0], [-0.105, 0.08, 0], [0, 0.2081, 0], [0, -0.0481, 0], [0, 0.08, -0.105], [0, 0.08, 0.17]] as Vec3[]) points.push(viewPoint(new Vector3(...offset).applyQuaternion(head.rotation).add(head.position)));
  return { points, joint: (name: Joint) => viewPoint(transforms.get(name)!.position) };
}
async function projected(page: Page, state: Camera, points: Vector3[]) {
  const canvas = page.getByRole('img', { name: '人体编舞动作预览' });
  const box = (await canvas.boundingBox())!;
  const camera = new PerspectiveCamera(40, box.width / box.height, 0.05, 80);
  camera.position.fromArray(state.position); camera.zoom = state.zoom ?? 1;
  camera.lookAt(new Vector3(...state.target)); camera.updateProjectionMatrix(); camera.updateMatrixWorld(true);
  return points.map(point => point.clone().project(camera));
}
async function expectVisible(page: Page, state: Camera, pose: Pose, mirror = false) {
  for (const point of await projected(page, state, worldRig(pose, mirror).points)) {
    expect(Math.abs(point.x), 'Whole-body horizontal framing including joint/head extents').toBeLessThan(1);
    expect(Math.abs(point.y), 'Whole-body vertical framing including joint/head extents').toBeLessThan(1);
    expect(point.z).toBeGreaterThan(-1); expect(point.z).toBeLessThan(1);
  }
}
async function capture(page: Page, name: string) {
  if (!process.env.CHOREO_SCREENSHOT_DIR) return;
  await mkdir(process.env.CHOREO_SCREENSHOT_DIR, { recursive: true });
  await page.evaluate(() => window.scrollTo({ top: 0, left: 0, behavior: 'instant' }));
  await page.screenshot({ path: join(process.env.CHOREO_SCREENSHOT_DIR, name), fullPage: true });
}

test('@framing whole-body framing brings a translated current pose into view without changing choreography, audio or camera direction', async ({ page }) => {
  test.setTimeout(120_000);
  const source = await openFixture(page);
  await expect(focus(page)).toBeDisabled();
  await page.getByRole('button', { name: '手动 K帧', exact: true }).click();
  await clickRevealed(page, page.getByRole('button', { name: '左侧', exact: true, includeHidden: true }));
  await numeric(page, '当前帧', 75);
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.locator('.save-state')).toHaveText('已保存到本机');
  const before = await backup(page), pose = source.take.poses[2];
  expect((await projected(page, before.scene.viewer.camera, worldRig(pose).points)).some(point => Math.abs(point.x) > 1 || Math.abs(point.y) > 1)).toBe(true);
  const audioTime = await page.locator('audio').evaluate((audio: HTMLAudioElement) => audio.currentTime);
  const after = await cameraAction(page, 'whole');
  await expectVisible(page, after.scene.viewer.camera, pose);
  sameDirection(after.scene.viewer.camera, before.scene.viewer.camera);
  expect(after.scene.project).toEqual(before.scene.project);
  expect(after.scene.viewer.time).toBe(2.5);
  expect(after.scene.viewer.selectedJoint).toBeNull();
  expect(after.scene.viewer.editorMode).toBe('keyframes');
  await expect(page.getByRole('spinbutton', { name: '当前帧', exact: true })).toHaveValue('75');
  expect(await page.locator('audio').evaluate((audio: HTMLAudioElement) => audio.currentTime)).toBeCloseTo(audioTime, 5);
  expect(await audioHash(page)).toBe(createHash('sha256').update(source.wave).digest('hex'));
  await expect(page.locator('.save-state')).toHaveText('有未保存更改');
  await expect(guard(page)).toHaveCount(0);
  await capture(page, 'choreo-framing-desktop.png');
});

test('@framing joint focus centers editable and read-only landmarks, honors mirror and remains available in teaching view', async ({ page }) => {
  test.setTimeout(120_000);
  const source = await openFixture(page);
  await seek(page, 2.5); await joint(page, 'LeftForeArm');
  const before = await backup(page);
  const fitted = await cameraAction(page, 'whole');
  const focused = await cameraAction(page, 'joint');
  nearPoint(focused.scene.viewer.camera.target, worldRig(source.take.poses[2]).joint('LeftForeArm'));
  sameDirection(focused.scene.viewer.camera, fitted.scene.viewer.camera);
  expect(distance(focused.scene.viewer.camera)).toBeLessThan(distance(fitted.scene.viewer.camera));
  const center = (await projected(page, focused.scene.viewer.camera, [worldRig(source.take.poses[2]).joint('LeftForeArm')]))[0];
  expect(Math.abs(center.x)).toBeLessThan(1e-7); expect(Math.abs(center.y)).toBeLessThan(1e-7);
  expect(focused.scene.project).toEqual(before.scene.project);
  await joint(page, 'LeftHandTip'); await expect(focus(page)).toBeEnabled();
  sameCamera((await backup(page)).scene.viewer.camera, focused.scene.viewer.camera);
  const terminal = await cameraAction(page, 'joint');
  nearPoint(terminal.scene.viewer.camera.target, worldRig(source.take.poses[2]).joint('LeftHandTip'));
  await expect(page.getByRole('button', { name: '旋转工具', exact: true })).toBeDisabled();
  await clickRevealed(page, page.getByRole('button', { name: '镜像观看', exact: true, includeHidden: true }));
  const mirrored = await cameraAction(page, 'joint');
  nearPoint(mirrored.scene.viewer.camera.target, worldRig(source.take.poses[2], true).joint('LeftHandTip'));
  expect(mirrored.scene.viewer.selectedJoint).toBe('LeftHandTip'); expect(mirrored.scene.viewer.mirror).toBe(true);
  sameDirection(mirrored.scene.viewer.camera, terminal.scene.viewer.camera);
  const labels = await page.getByLabel('选中关节世界坐标').locator('strong > span').allTextContents();
  const dataPoint = labels.map(label => Number(label.replace(/^[XYZ]/, '')));
  nearPoint(dataPoint, worldRig(source.take.poses[2]).joint('LeftHandTip'), 2);
  await page.getByRole('button', { name: '教学预览', exact: true }).click();
  const teaching = await cameraAction(page, 'whole');
  await expectVisible(page, teaching.scene.viewer.camera, source.take.poses[2], true);
  await expect(page.getByRole('button', { name: '教学预览', exact: true })).toHaveAttribute('aria-current', 'page');
  expect(teaching.scene.project).toEqual(before.scene.project);
  expect(teaching.scene.viewer.time).toBe(2.5); expect(teaching.scene.viewer.mirror).toBe(true);
});

test('@framing framing uses an unwritten pose without resolving it, and saved cameras survive manual movement, seeking, resize, reload and scene switches', async ({ page }) => {
  test.setTimeout(180_000);
  const source = await openFixture(page, true), original = await backup(page);
  await page.getByRole('button', { name: '手动 K帧', exact: true }).click();
  await numeric(page, '当前帧', 75); await joint(page, 'LeftUpperArm');
  await numeric(page, '关节 Z 旋转（度）', 60); await numeric(page, 'Root X 位移（米）', -5);
  const pose = structuredClone(source.take.poses[2]);
  pose.root[0] = -5; pose.joints.LeftUpperArm = [0, 0, Math.sin(Math.PI / 6), Math.cos(Math.PI / 6)];
  await expect(draft(page)).toBeVisible();
  await clickRevealed(page, page.getByRole('button', { name: '复制当前姿态', exact: true, includeHidden: true }));
  await expect(page.getByLabel('已复制姿态', { exact: true })).toContainText('第 75 帧 · 姿态草稿');
  const framed = await cameraAction(page, 'whole'); await expectVisible(page, framed.scene.viewer.camera, pose);
  await joint(page, 'LeftForeArm'); const focused = await cameraAction(page, 'joint');
  nearPoint(focused.scene.viewer.camera.target, worldRig(pose).joint('LeftForeArm'));
  expect(focused.scene.project).toEqual(original.scene.project);
  await expect(draft(page)).toBeVisible(); await expect(guard(page)).toHaveCount(0);
  await expect(page.getByLabel('已复制姿态', { exact: true })).toContainText('第 75 帧 · 姿态草稿');
  expect(Number(await page.getByRole('spinbutton', { name: 'Root X 位移（米）', exact: true }).inputValue())).toBe(-5);
  await expect(page.getByRole('spinbutton', { name: '当前帧', exact: true })).toHaveValue('75');
  await page.getByRole('button', { name: 'K 完整姿态', exact: true }).click();
  await expect(draft(page)).toHaveCount(0);
  const committed = await backup(page);
  expect(committed.scene.project.revision).toBe(original.scene.project.revision + 1);
  expect(current(committed).manual!.root).toEqual([{ frame: 75, position: pose.root }]);
  const canvas = page.getByRole('img', { name: '人体编舞动作预览' });
  await canvas.scrollIntoViewIfNeeded(); let box = (await canvas.boundingBox())!;
  const beforeHeldFocus = await cameraText(page);
  await page.mouse.move(box.x + box.width * 0.78, box.y + box.height * 0.55);
  await page.mouse.down({ button: 'right' });
  // Keyboard activation can occur while a canvas pointer remains held. The
  // old pan gesture must be isolated until that pointer is fully released.
  await whole(page).focus(); await page.keyboard.press('Enter');
  await expect.poll(() => cameraText(page)).not.toBe(beforeHeldFocus);
  const interrupted = await backup(page);
  await canvas.scrollIntoViewIfNeeded();
  box = (await canvas.boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.88, box.y + box.height * 0.66, { steps: 6 });
  await page.mouse.up({ button: 'right' });
  const released = await backup(page);
  sameCamera(released.scene.viewer.camera, interrupted.scene.viewer.camera);
  expect(released.scene.project).toEqual(committed.scene.project);
  expect(released.scene.viewer.selectedJoint).toBe('LeftForeArm');
  await expect(draft(page)).toHaveCount(0);
  await canvas.scrollIntoViewIfNeeded(); box = (await canvas.boundingBox())!;
  const previousCamera = await cameraText(page);
  await page.mouse.move(box.x + box.width * 0.7, box.y + box.height * 0.6); await page.mouse.down({ button: 'right' });
  await page.mouse.move(box.x + box.width * 0.77, box.y + box.height * 0.64, { steps: 8 }); await page.mouse.up({ button: 'right' });
  await expect.poll(() => cameraText(page)).not.toBe(previousCamera);
  const panned = await backup(page);
  await numeric(page, '当前帧', 240);
  sameCamera((await backup(page)).scene.viewer.camera, panned.scene.viewer.camera);
  await page.setViewportSize({ width: 900, height: 1000 });
  await expect.poll(async () => (await canvas.boundingBox())!.width).toBeLessThan(box.width);
  const resized = await backup(page); sameCamera(resized.scene.viewer.camera, panned.scene.viewer.camera);
  expect(resized.scene.project).toEqual(committed.scene.project);
  await page.getByRole('button', { name: '保存', exact: true }).click(); await expect(page.locator('.save-state')).toHaveText('已保存到本机');
  const saved = await backup(page); await page.reload(); await ready(page);
  const restored = await backup(page); sameCamera(restored.scene.viewer.camera, saved.scene.viewer.camera);
  expect(restored.scene.project).toEqual(saved.scene.project); expect(restored.scene.viewer.time).toBe(8);
  expect(await audioHash(page)).toBe(createHash('sha256').update(source.wave).digest('hex'));
  await page.getByRole('button', { name: '场景', exact: true }).click();
  await page.getByRole('dialog', { name: '本机场景', exact: true }).getByRole('button', { name: '打开场景 独立取景场景 B', exact: true }).click();
  await expect(page.locator('.project-title h1')).toHaveText('独立取景场景 B');
  const other = await backup(page); sameCamera(other.scene.viewer.camera, { position: [8, 7, 9], target: [2, 0.95, 1], zoom: 1.2 });
  expect(current(other).take).toEqual(source.take); expect(other.scene.project.teacherCheckedRevision).toBe(1);
});

test('@framing portrait framing stays usable at 390 and 320 pixels, targets the visible candidate and does not pause playback', async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 390, height: 844 });
  const source = await openFixture(page), original = await backup(page);
  await seek(page, 2.5);
  let framed = await cameraAction(page, 'whole'); await expectVisible(page, framed.scene.viewer.camera, source.take.poses[2]);
  await capture(page, 'choreo-framing-mobile.png');
  for (const width of [390, 320]) {
    if (width === 320) { await page.setViewportSize({ width, height: 844 }); framed = await cameraAction(page, 'whole', false); }
    await expectVisible(page, framed.scene.viewer.camera, source.take.poses[2]);
    for (const button of [whole(page), focus(page)]) expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  }
  await joint(page, 'Hips');
  await page.getByRole('button', { name: '八拍编排', exact: true }).click();
  await page.getByRole('button', { name: '换一个八拍', exact: true }).click();
  const candidate = page.getByRole('region', { name: '替换候选', exact: true });
  await expect(candidate.getByRole('button', { name: '切回原稿', exact: false })).toBeVisible();
  await seek(page, 2.5);
  const values = await page.getByLabel('选中关节世界坐标').locator('strong > span').allTextContents();
  const candidatePoint = new Vector3(...values.map(label => Number(label.replace(/^[XYZ]/, ''))) as Vec3);
  const focused = await cameraAction(page, 'joint');
  nearPoint(focused.scene.viewer.camera.target, candidatePoint, 2);
  expect(focused.scene.project).toEqual(original.scene.project);
  await expect(candidate.getByRole('button', { name: '采用', exact: true })).toBeEnabled();
  await expect(page.locator('.viewer-title')).toContainText('替换预览');
  await page.getByRole('button', { name: '播放', exact: true }).click();
  await expect(page.getByRole('button', { name: '暂停', exact: true })).toBeEnabled();
  const started = await page.locator('audio').evaluate((audio: HTMLAudioElement) => audio.currentTime);
  await clickRevealed(page, whole(page)); await clickRevealed(page, focus(page));
  await expect(page.getByRole('button', { name: '暂停', exact: true })).toBeEnabled();
  expect(await page.locator('audio').evaluate((audio: HTMLAudioElement) => audio.paused)).toBe(false);
  await expect.poll(() => page.locator('audio').evaluate((audio: HTMLAudioElement) => audio.currentTime)).toBeGreaterThan(started);
  await page.getByRole('button', { name: '暂停', exact: true }).click();
  const final = await backup(page); expect(final.scene.project).toEqual(original.scene.project);
  expect(final.scene.viewer.selectedJoint).toBe('Hips');
  await expect(page.locator('.viewer-title')).toContainText('替换预览');
  expect(await audioHash(page)).toBe(createHash('sha256').update(source.wave).digest('hex'));
});
