import { mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { inflateSync } from 'node:zlib';
import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { Euler, PerspectiveCamera, Quaternion, Vector3 } from 'three';
import { isJointRotationWithinLimits } from '../packages/core/src';
import { clickRevealed, reveal } from './helpers';

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
type Sequence = { schema: string; baseTake: Take; rotations: Partial<Record<Joint, { frame: number; rotation: Quat }[]>>; root: { frame: number; position: Vec3 }[] };
type Snapshot = { take: Take; manual?: Sequence };
type Camera = { position: Vec3; target: Vec3; zoom?: number };
type Backup = { scene: { id: string; name: string; project: { historyIndex: number; history: Snapshot[]; revision: number }; viewer: { time: number; camera: Camera } } };
const current = (backup: Backup) => backup.scene.project.history[backup.scene.project.historyIndex];
const draft = (page: Page) => page.getByRole('status').filter({ hasText: '姿态草稿 · 尚未写入关键帧' });
const hiddenButton = (page: Page, name: string) => page.getByRole('button', { name, exact: true, includeHidden: true });
const radians = Math.PI / 180;
const fromDegrees = (degrees: Vec3) => new Quaternion().setFromEuler(new Euler(...degrees.map(value => value * radians) as Vec3, 'XYZ')).toArray() as Quat;

const diagnostics = new WeakMap<Page, { errors: string[]; warnings: string[]; apiRequests: string[] }>();
test.beforeEach(async ({ page }) => {
  const report = { errors: [] as string[], warnings: [] as string[], apiRequests: [] as string[] };
  diagnostics.set(page, report);
  page.on('pageerror', error => report.errors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error') report.errors.push(message.text());
    if (message.type() === 'warning') report.warnings.push(message.text());
  });
  page.on('request', request => { if (new URL(request.url()).pathname.startsWith('/api/')) report.apiRequests.push(request.url()); });
  page.on('dialog', dialog => { void (dialog.type() === 'beforeunload' ? dialog.accept() : dialog.dismiss()); });
});
test.afterEach(async ({ page }, testInfo) => {
  const report = diagnostics.get(page)!;
  await testInfo.attach('browser-console-and-api', { body: JSON.stringify(report), contentType: 'application/json' });
  expect(report.errors).toEqual([]); expect(report.warnings).toEqual([]); expect(report.apiRequests).toEqual([]);
});

function fixture(legacyViolations = false) {
  const countMap = { id: 'constraint-count-map', version: 1, bpm: 120, musicBeatsPerDanceCount: 1, firstCountSourceSeconds: 1, sourceOffsetSeconds: 1, durationSeconds: 16, octetCount: 4, countTimesSeconds: Array.from({ length: 33 }, (_, index) => index * 0.5), confirmed: true };
  const plan = {
    id: 'constraint-plan', countMapId: countMap.id, durationSeconds: 16, provenance: 'synthetic-demo',
    slots: ['step-touch', 'side-reach', 'groove', 'settle'].map((actionId, slotIndex) => ({ slotIndex, actionId, label: '原创人体与关节限制回归', teachingCue: '本地回归', startSeconds: slotIndex * 4, endSeconds: (slotIndex + 1) * 4, countStart: slotIndex * 8 + 1, countEnd: (slotIndex + 1) * 8, role: slotIndex === 0 ? 'opening' : slotIndex === 3 ? 'closing' : 'body' })),
  };
  const times = [0, 0.7, 2.5, 4, 8, 12, 16];
  const poses: Pose[] = times.map(() => ({ root: [0, 1.05, 0], joints: Object.fromEntries(joints.map(joint => [joint, [0, 0, 0, 1]])) as Record<Joint, Quat> }));
  if (legacyViolations) {
    poses[2].joints.LeftForeArm = fromDegrees([65, 18, 20]);
    poses[2].joints.RightLowerLeg = fromDegrees([-55, -12, -10]);
  }
  const take: Take = { id: 'constraint-base-take', schemaVersion: 'preview-1', planId: plan.id, countMapId: countMap.id, durationSeconds: 16, times, poses, provenance: 'synthetic-demo' };
  const scene = {
    schema: 'choreo-scene-1', id: 'constraint-local-scene', name: '人体与关节限制场景', createdAt: '2026-10-08T08:00:00.000Z', updatedAt: '2026-10-08T08:00:00.000Z',
    coordinateSystem: { handedness: 'right', upAxis: '+Y', forwardAxis: '+Z', units: 'm', floorPlane: 'XZ', origin: [0, 0, 0] },
    actor: { id: 'actor-1', rigId: 'synthetic-skeleton-1', provenance: 'synthetic-demo', joints: [...joints] },
    project: { history: [{ title: '人体与关节限制场景', countMap, plan, take }], historyIndex: 0, revision: 1, audioDuration: 20, teacherCheckedRevision: null },
    audioName: 'constraint-local.wav', viewer: { camera: null, view: 'front', mirror: false, rate: 1, loop: false, countSound: false, selectedSlot: 0, selectedJoint: null, time: 0, editorMode: 'keyframes', transformTool: 'select' },
  };
  const sampleRate = 8000, samples = sampleRate * 20, wave = Buffer.alloc(44 + samples * 2);
  wave.write('RIFF', 0); wave.writeUInt32LE(wave.length - 8, 4); wave.write('WAVE', 8); wave.write('fmt ', 12); wave.writeUInt32LE(16, 16);
  wave.writeUInt16LE(1, 20); wave.writeUInt16LE(1, 22); wave.writeUInt32LE(sampleRate, 24); wave.writeUInt32LE(sampleRate * 2, 28); wave.writeUInt16LE(2, 32); wave.writeUInt16LE(16, 34);
  wave.write('data', 36); wave.writeUInt32LE(samples * 2, 40);
  for (let index = 0; index < samples; index++) wave.writeInt16LE(Math.round(Math.sin(index / sampleRate * Math.PI * 2 * 440) * 1200), 44 + index * 2);
  return { scene, take, wave };
}

async function ready(page: Page) {
  await expect(page.getByRole('button', { name: '播放', exact: true })).toBeEnabled();
  await expect(page.getByLabel('相机世界坐标')).not.toContainText('—');
  await expect.poll(() => page.locator('audio').evaluate((audio: HTMLAudioElement) => audio.readyState)).toBeGreaterThanOrEqual(2);
}
async function openFixture(page: Page, legacyViolations = false) {
  const source = fixture(legacyViolations);
  await page.goto('/'); await ready(page);
  await page.evaluate(async ({ scene, bytes }) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('choreo-studio-preview', 2); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
    });
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(['scenes', 'sceneIndex', 'sceneMeta'], 'readwrite');
      tx.objectStore('scenes').put({ ...scene, audio: new Blob([new Uint8Array(bytes)], { type: 'audio/wav' }) }, scene.id);
      const { schema, id, name, createdAt, updatedAt, audioName } = scene;
      tx.objectStore('sceneIndex').put({ schema, id, name, createdAt, updatedAt, audioName }, id);
      tx.objectStore('sceneMeta').put(id, 'currentSceneId'); tx.objectStore('sceneMeta').put(true, 'legacyProjectMigrated');
      tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error);
    }); db.close();
  }, { scene: source.scene, bytes: Array.from(source.wave) });
  await page.reload(); await ready(page);
  await expect(page.locator('.project-title h1')).toHaveText(source.scene.name);
  expect(current(await backup(page)).take).toEqual(source.take);
  return source;
}
async function backup(page: Page): Promise<Backup> {
  const pending = page.waitForEvent('download'); await clickRevealed(page, hiddenButton(page, '下载项目备份'));
  const path = await (await pending).path(); expect(path).toBeTruthy();
  return JSON.parse(await readFile(path!, 'utf8')) as Backup;
}
async function numeric(page: Page, label: string, value: number) {
  const input = page.getByRole('spinbutton', { name: label, exact: true }); await input.fill(String(value)); await input.press('Tab');
}
const select = (page: Page, joint: Joint) => page.getByRole('combobox', { name: '选择关节', exact: true }).selectOption(joint);
const frame = (page: Page, value: number) => numeric(page, '当前帧', value);
async function angles(page: Page): Promise<Vec3> {
  return await Promise.all(['X', 'Y', 'Z'].map(async axis => Number(await page.getByRole('spinbutton', { name: `关节 ${axis} 旋转（度）`, exact: true }).inputValue()))) as Vec3;
}
function expectAnglesBounded(value: Vec3, bounds: readonly (readonly [number, number])[]) {
  value.forEach((angle, axis) => { expect(angle).toBeGreaterThanOrEqual(bounds[axis][0] - 0.051); expect(angle).toBeLessThanOrEqual(bounds[axis][1] + 0.051); });
}
async function save(page: Page) {
  await page.getByRole('button', { name: '保存', exact: true }).click(); await expect(page.locator('.save-state')).toHaveText('已保存到本机');
}
async function position(page: Page, joint: Joint): Promise<Vec3> {
  await select(page, joint); await reveal(page, page.getByLabel('选中关节世界坐标', { exact: true }));
  const label = page.getByLabel('选中关节世界坐标', { exact: true });
  await expect(label.locator('strong')).toContainText('Y');
  // Pose evaluation reports the newly selected landmark on its next frame.
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  return Array.from((await label.locator('strong').innerText()).matchAll(/[XYZ]\s*(-?\d+(?:\.\d+)?)/g), match => Number(match[1])) as Vec3;
}
async function projection(page: Page, state: Camera) {
  const canvas = page.getByRole('img', { name: '人体编舞动作预览' }); await canvas.scrollIntoViewIfNeeded();
  const box = (await canvas.boundingBox())!;
  const camera = new PerspectiveCamera(40, box.width / box.height, 0.05, 80);
  camera.position.fromArray(state.position); camera.zoom = state.zoom ?? 1; camera.lookAt(new Vector3(...state.target)); camera.updateProjectionMatrix(); camera.updateMatrixWorld(true);
  return { canvas, box, camera, point: (world: Vec3) => { const point = new Vector3(...world).project(camera); return { x: box.x + (point.x + 1) * box.width / 2, y: box.y + (1 - point.y) * box.height / 2 }; } };
}
async function capture(page: Page, testInfo: TestInfo, name: string) {
  await testInfo.attach(name, { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });
  if (process.env.CHOREO_SCREENSHOT_DIR) { await mkdir(process.env.CHOREO_SCREENSHOT_DIR, { recursive: true }); await page.screenshot({ path: join(process.env.CHOREO_SCREENSHOT_DIR, name), fullPage: true }); }
}

test('@constraints elbow and knee sliders keep coupled anatomical limits while numeric authoring remains explicit', async ({ page }) => {
  const source = await openFixture(page), original = await backup(page);
  for (const [joint, keyFrame, forbidden, permitted, bounds] of [
    ['LeftForeArm', 60, 70, -60, [[-145, 0], [-8, 8], [-5, 5]]],
    ['RightLowerLeg', 120, -70, 90, [[0, 145], [-4, 4], [-3, 3]]],
  ] as const) {
    await frame(page, keyFrame); await select(page, joint);
    await numeric(page, '关节 X 旋转（度）', forbidden);
    await expect.poll(async () => (await angles(page))[0]).toBe(forbidden);
    await expect(page.getByRole('status').filter({ hasText: '超出标准人体建议' })).toBeVisible();
    for (const [axis, limits] of ['X', 'Y', 'Z'].map((axis, index) => [axis, bounds[index]] as const)) {
      const slider = page.getByRole('slider', { name: `关节 ${axis} 滑条`, exact: true });
      await expect(slider).toHaveAttribute('min', String(limits[0])); await expect(slider).toHaveAttribute('max', String(limits[1]));
    }
    const x = page.getByRole('slider', { name: '关节 X 滑条', exact: true });
    await x.focus(); await x.press(joint === 'LeftForeArm' ? 'Home' : 'End');
    expectAnglesBounded(await angles(page), bounds);
    await numeric(page, '关节 X 旋转（度）', permitted);
    // Direct numbers are author intent; these physical slider gestures keep
    // the suggested coupled anatomical projection instead.
    await page.getByRole('slider', { name: '关节 Y 滑条', exact: true }).focus();
    await page.getByRole('slider', { name: '关节 Y 滑条', exact: true }).press('End');
    await page.getByRole('slider', { name: '关节 Z 滑条', exact: true }).focus();
    await page.getByRole('slider', { name: '关节 Z 滑条', exact: true }).press('Home');
    expectAnglesBounded(await angles(page), bounds); await expect(draft(page)).toBeVisible();
    await clickRevealed(page, page.getByRole('button', { name: 'K 当前关节', exact: true, includeHidden: true }));
    const authored = current(await backup(page));
    expect(isJointRotationWithinLimits(joint, authored.manual!.rotations[joint]![0].rotation)).toBe(true);
    expect(authored.manual!.baseTake).toEqual(source.take);
  }
  const authored = await backup(page);
  expect(authored.scene.project.revision).toBe(original.scene.project.revision + 2);
  expect(Object.keys(current(authored).manual!.rotations).sort()).toEqual(['LeftForeArm', 'RightLowerLeg']);
  await save(page); await page.reload(); await ready(page);
  const restored = await backup(page); expect(restored.scene.project).toEqual(authored.scene.project);
  for (const joint of ['LeftForeArm', 'RightLowerLeg'] as const) for (const key of current(restored).manual!.rotations[joint]!) expect(isJointRotationWithinLimits(joint, key.rotation)).toBe(true);
});

test('@constraints legacy poses keep their authority through Root-only writes and exact pose reuse; cancel restores the formal pose', async ({ page }) => {
  const source = await openFixture(page, true), original = await backup(page);
  expect(isJointRotationWithinLimits('LeftForeArm', source.take.poses[2].joints.LeftForeArm)).toBe(false);
  await frame(page, 75); await select(page, 'LeftForeArm');
  await expect(page.getByRole('status').filter({ hasText: '超出标准人体建议' })).toBeVisible();
  expect((await angles(page))[0]).toBeCloseTo(65, 1);
  await clickRevealed(page, hiddenButton(page, '复制当前姿态'));
  expect((await backup(page)).scene.project).toEqual(original.scene.project);
  await numeric(page, 'Root X 位移（米）', 1.1); expect((await angles(page))[0]).toBeCloseTo(65, 1);
  await clickRevealed(page, page.getByRole('button', { name: 'K 位移', exact: true, includeHidden: true }));
  const rootOnly = await backup(page), rootTake = current(rootOnly).take;
  expect(current(rootOnly).manual!.rotations).toEqual({}); expect(current(rootOnly).manual!.baseTake).toEqual(source.take);
  source.take.times.forEach((time, index) => expect(rootTake.poses[rootTake.times.indexOf(time)].joints).toEqual(source.take.poses[index].joints));
  await frame(page, 120); await clickRevealed(page, hiddenButton(page, '粘贴关节姿态'));
  await expect(draft(page)).toBeVisible(); await expect.poll(() => angles(page)).toEqual([65, 18, 20]);
  await select(page, 'RightLowerLeg'); await expect.poll(() => angles(page)).toEqual([-55, -12, -10]);
  expect((await backup(page)).scene.project).toEqual(rootOnly.scene.project);
  await frame(page, 150);
  const guard = page.getByRole('dialog', { name: '写入这份姿态草稿？', exact: true }); await expect(guard).toBeVisible();
  await guard.getByRole('button', { name: '取消', exact: true }).click(); await expect(draft(page)).toBeVisible();
  await page.getByRole('button', { name: '撤回草稿', exact: true }).click();
  await expect(draft(page)).toHaveCount(0); await expect.poll(() => angles(page)).toEqual([0, 0, 0]);
  await expect(page.getByRole('spinbutton', { name: '当前帧', exact: true })).toHaveValue('120');
  expect((await backup(page)).scene.project).toEqual(rootOnly.scene.project);
  await clickRevealed(page, hiddenButton(page, '粘贴关节姿态'));
  await page.getByRole('button', { name: 'K 完整姿态', exact: true }).click();
  const pasted = await backup(page);
  expect(current(pasted).manual!.baseTake).toEqual(source.take);
  expect(pasted.scene.project.history.slice(0, rootOnly.scene.project.history.length)).toEqual(rootOnly.scene.project.history);
  for (const joint of ['LeftForeArm', 'RightLowerLeg'] as const) {
    const rotation = current(pasted).manual!.rotations[joint]![0].rotation;
    expect(Math.abs(new Quaternion(...rotation).dot(new Quaternion(...source.take.poses[2].joints[joint])))).toBeCloseTo(1, 12);
    expect(isJointRotationWithinLimits(joint, rotation)).toBe(false);
  }
});

test('@constraints full-pose K preserves unedited source rotations outside the standard profile', async ({ page }) => {
  const source = await openFixture(page, true);
  await frame(page, 75); await select(page, 'LeftForeArm');
  await expect.poll(() => angles(page)).toEqual([65, 18, 20]);
  await expect(draft(page)).toHaveCount(0);
  await page.getByRole('button', { name: 'K 完整姿态', exact: true }).click();
  const authored = await backup(page), snapshot = current(authored);
  expect(snapshot.manual!.baseTake).toEqual(source.take);
  for (const joint of ['LeftForeArm', 'RightLowerLeg'] as const) {
    const rotation = snapshot.manual!.rotations[joint]!.find(key => key.frame === 75)!.rotation;
    expect(Math.abs(new Quaternion(...rotation).dot(new Quaternion(...source.take.poses[2].joints[joint])))).toBeCloseTo(1, 12);
    expect(snapshot.take.poses[snapshot.take.times.indexOf(2.5)].joints[joint]).toEqual(rotation);
    expect(isJointRotationWithinLimits(joint, rotation)).toBe(false);
  }
  await save(page); await page.reload(); await ready(page);
  expect((await backup(page)).scene.project).toEqual(authored.scene.project);
});

test('@constraints a real elbow rotation ring clamps the rendered limb and explicit key without changing other joints or camera', async ({ page }, testInfo) => {
  const source = await openFixture(page);
  await select(page, 'LeftForeArm'); await page.getByRole('button', { name: '旋转工具', exact: true }).click();
  const elbow = await position(page, 'LeftForeArm');
  await clickRevealed(page, hiddenButton(page, '左侧'));
  await page.locator('.camera-options > summary').click(); await expect(page.locator('.camera-options')).not.toHaveAttribute('open');
  const original = await backup(page);
  // Begin near the limit with an unwritten draft. TransformControls converts
  // screen displacement to rotation, so a short physical drag crosses the
  // boundary without wrapping the requested quaternion past 180 degrees.
  await numeric(page, '关节 X 旋转（度）', -140);
  expect((await angles(page))[0]).toBeCloseTo(-140, 1);
  const view = await projection(page, original.scene.viewer.camera);
  const radius = view.camera.position.distanceTo(new Vector3(...elbow)) * 1.9 * Math.tan(40 * Math.PI / 360) / view.camera.zoom * 0.95 / 8;
  const ring = (angle: number) => view.point([elbow[0], elbow[1] + radius * Math.cos(angle), elbow[2] + radius * Math.sin(angle)]);
  // The rotated Y/Z handles can occlude part of the X ring. Find an exposed
  // screen point through ordinary hover feedback, rather than rig internals.
  let angle: number | undefined;
  for (const candidate of [1, 0.55, 0.2, 1.3, -0.2, -0.55, -1, -1.3]) {
    const point = ring(candidate);
    await page.mouse.move(point.x, point.y);
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    if ((await page.getByLabel('关节局部旋转', { exact: true }).innerText()).includes('X轴')) { angle = candidate; break; }
  }
  expect(angle, 'A visible X rotation ring must accept a real pointer hit').toBeDefined();
  const start = ring(angle!), end = ring(angle! - 0.2);
  expect(await view.canvas.evaluate((element, points) => points.every(point => document.elementFromPoint(point.x, point.y) === element), [start, end])).toBe(true);
  await page.mouse.move(start.x, start.y); await expect(page.getByLabel('关节局部旋转', { exact: true })).toContainText('X轴');
  await page.mouse.down({ button: 'left' }); await page.mouse.move(end.x, end.y, { steps: 18 });
  expectAnglesBounded(await angles(page), [[-145, 0], [-8, 8], [-5, 5]]);
  await page.mouse.up({ button: 'left' }); await expect(draft(page)).toBeVisible();
  const displayed = await angles(page); expect(displayed[0]).toBeCloseTo(-145, 1);
  const expectedWrist = new Vector3(0, -0.255, 0).applyQuaternion(new Quaternion(...fromDegrees(displayed))).add(new Vector3(...elbow));
  const wrist = await position(page, 'LeftHand'); wrist.forEach((value, axis) => expect(value).toBeCloseTo(expectedWrist.getComponent(axis), 2));
  expect(current(await backup(page))).toEqual(current(original));
  await select(page, 'LeftForeArm'); await clickRevealed(page, page.getByRole('button', { name: 'K 当前关节', exact: true, includeHidden: true }));
  const authored = await backup(page), snapshot = current(authored);
  expect(snapshot.manual!.baseTake).toEqual(source.take); expect(Object.keys(snapshot.manual!.rotations)).toEqual(['LeftForeArm']);
  expect(isJointRotationWithinLimits('LeftForeArm', snapshot.manual!.rotations.LeftForeArm![0].rotation)).toBe(true);
  for (const pose of snapshot.take.poses) for (const joint of joints) if (joint !== 'LeftForeArm') expect(pose.joints[joint]).toEqual([0, 0, 0, 1]);
  expect(authored.scene.viewer.camera).toEqual(original.scene.viewer.camera);
  await capture(page, testInfo, 'constrained-elbow.png');
});

// Inspect rendered pixels independently of the rig or WebGL scene internals.
function brightCoverage(png: Buffer, region: { x: number; y: number; width: number; height: number }) {
  const width = png.readUInt32BE(16), height = png.readUInt32BE(20), channels = png[25] === 6 ? 4 : png[25] === 2 ? 3 : 0;
  if (png[24] !== 8 || !channels || png[28] !== 0) throw new Error('Unexpected PNG format');
  const parts: Buffer[] = []; for (let offset = 8; offset < png.length;) { const length = png.readUInt32BE(offset); if (png.toString('ascii', offset + 4, offset + 8) === 'IDAT') parts.push(png.subarray(offset + 8, offset + 8 + length)); offset += length + 12; }
  const decoded = inflateSync(Buffer.concat(parts)), stride = width * channels, pixels = Buffer.alloc(height * stride);
  const paeth = (a: number, b: number, c: number) => { const p = a + b - c, da = Math.abs(p - a), db = Math.abs(p - b), dc = Math.abs(p - c); return da <= db && da <= dc ? a : db <= dc ? b : c; };
  for (let y = 0; y < height; y++) for (let x = 0; x < stride; x++) {
    const index = y * stride + x, a = x >= channels ? pixels[index - channels] : 0, b = y ? pixels[index - stride] : 0, c = y && x >= channels ? pixels[index - stride - channels] : 0;
    const filter = decoded[y * (stride + 1)]; pixels[index] = (decoded[y * (stride + 1) + x + 1] + (filter === 0 ? 0 : filter === 1 ? a : filter === 2 ? b : filter === 3 ? Math.floor((a + b) / 2) : paeth(a, b, c))) & 255;
  }
  let bright = 0, total = 0;
  for (let y = Math.max(0, Math.ceil(region.y)); y < Math.min(height, region.y + region.height); y++) for (let x = Math.max(0, Math.ceil(region.x)); x < Math.min(width, region.x + region.width); x++) {
    const index = y * stride + x * channels; total++; if (Math.min(pixels[index], pixels[index + 1], pixels[index + 2]) > 100) bright++;
  }
  expect(total).toBeGreaterThan(20); return bright / total;
}

test('@constraints solid human surfaces remain visible with a clear manual workspace at 320 and 1440 pixels', async ({ page }, testInfo) => {
  await openFixture(page); const original = await backup(page);
  for (const width of [320, 1440]) {
    await page.setViewportSize({ width, height: width === 320 ? 844 : 1000 });
    await page.getByRole('button', { name: '全身取景', exact: true }).click();
    const framed = await backup(page), view = await projection(page, framed.scene.viewer.camera);
    const corners = [[-0.075, 1.36, 0], [0.075, 1.36, 0], [-0.075, 1.44, 0], [0.075, 1.44, 0]].map(point => view.point(point as Vec3));
    const region = { x: Math.min(...corners.map(point => point.x)) - view.box.x, y: Math.min(...corners.map(point => point.y)) - view.box.y, width: Math.max(...corners.map(point => point.x)) - Math.min(...corners.map(point => point.x)), height: Math.max(...corners.map(point => point.y)) - Math.min(...corners.map(point => point.y)) };
    expect(brightCoverage(await view.canvas.screenshot(), region), 'The torso must have a filled visible surface beyond thin joint lines').toBeGreaterThan(0.7);
    expect(framed.scene.project).toEqual(original.scene.project);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await expect(page.getByRole('group', { name: '舞台编辑工具', exact: true }).getByRole('button')).toHaveCount(3);
    for (const name of ['姿态复用', '关键帧明细', '更多编辑操作', '键盘快捷键', '移动与复制关键帧']) await expect(page.locator('details').filter({ has: page.locator('summary').filter({ hasText: new RegExp(`^${name}$`) }) })).not.toHaveAttribute('open');
    await page.getByRole('heading', { name: '人体与关节限制场景', exact: true }).scrollIntoViewIfNeeded();
    await capture(page, testInfo, `human-manual-layout-${width}.png`);
  }
});
