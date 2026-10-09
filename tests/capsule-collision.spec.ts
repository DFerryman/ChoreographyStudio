import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import { PerspectiveCamera, Plane, Quaternion, Raycaster, Vector2, Vector3 } from 'three';
import {
  JOINT_NAMES, evaluatePose, getBodyCollisions, initializeBodyCollisionBackend, isJointRotationWithinLimits,
  rotationFromDegrees, sampleTake, type BakedTake, type JointName, type Pose, type Quat,
} from '../packages/core/src';
import { clickRevealed, closeDisclosures } from './helpers';
import {
  backup, current, diagnostics, hiddenButton, openFixture, projection, ready, save,
  screenshot, type Backup,
} from './realismHelpers';
import { applyStageViewOffset, editStageValue, expectStageSelection, selectStageJoint, stageValue } from './stageInteractions';

const reports = new WeakMap<Page, ReturnType<typeof diagnostics>>();
const modelResponses = new WeakMap<Page, { status: number; bytes: number; magic: string; sha256: string }[]>();
const stage = (page: Page) => page.getByRole('region', { name: '3D 动画舞台', exact: true });
const warning = (page: Page) => page.getByLabel('身体碰撞提示', { exact: true });
const timeline = (page: Page) => page.getByRole('region', { name: '手动关键帧时间线', exact: true });

test.beforeAll(async () => { await initializeBodyCollisionBackend(); });
test.beforeEach(async ({ page }) => {
  reports.set(page, diagnostics(page));
  modelResponses.set(page, []);
  await page.route('**/api/**', route => route.abort('blockedbyclient'));
  page.on('response', async response => {
    if (new URL(response.url()).pathname !== '/models/neutral-quaternius-v1.glb') return;
    const bytes = await response.body();
    modelResponses.get(page)!.push({ status: response.status(), bytes: bytes.length,
      magic: bytes.subarray(0, 4).toString(), sha256: createHash('sha256').update(bytes).digest('hex') });
  });
});
test.afterEach(async ({ page }, info) => {
  const report = reports.get(page)!;
  await info.attach('capsule-browser-console-and-api.json', { body: JSON.stringify(report), contentType: 'application/json' });
  await info.attach('capsule-actual-model-loads.json', { body: JSON.stringify(modelResponses.get(page)), contentType: 'application/json' });
  expect(report).toEqual({ errors: [], warnings: [], expectedHttpErrors: [], apiRequests: [] });
});

async function loaded(page: Page) {
  await expect(page.getByRole('status').filter({ hasText: '人物模型载入中' })).toBeHidden();
  await expect(page.getByText('3D 预览暂时不可用', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('img', { name: '人体编舞动作预览', exact: true })).toBeVisible();
  await expect.poll(() => modelResponses.get(page)!.length).toBeGreaterThan(0);
  for (const response of modelResponses.get(page)!) {
    expect(response.status).toBe(200); expect(response.magic).toBe('glTF'); expect(response.bytes).toBeGreaterThan(100_000);
  }
}

async function visibleRotation(page: Page): Promise<Quat> {
  return JSON.parse((await stage(page).getAttribute('data-local-rotation'))!) as Quat;
}

/** A single pointer move skips the colliding middle in screen-event space.
 * The editor must still stop at the first contact along the proposed sweep. */
async function rotationDrag(page: Page, document: Backup, pose: Pose, joint: JointName, axis: 'X' | 'Y' | 'Z', degrees: number) {
  await page.getByRole('button', { name: '旋转工具', exact: true }).click();
  const view = await projection(page, document), box = (await view.canvas.boundingBox())!;
  const state = document.scene.viewer.camera!;
  const camera = new PerspectiveCamera(40, box.width / box.height, .05, 80);
  camera.position.fromArray(state.position); camera.zoom = state.zoom ?? 1;
  await applyStageViewOffset(page, camera);
  camera.lookAt(new Vector3(...state.target)); camera.updateProjectionMatrix(); camera.updateMatrixWorld(true);
  const fk = evaluatePose(pose), center = new Vector3(...fk[joint].position);
  const eye = camera.position.clone().sub(center).normalize();
  const scale = camera.position.distanceTo(center) * Math.min(1.9 * Math.tan(Math.PI * camera.fov / 360) / camera.zoom, 7) * .95 / 4;
  const axes = { X: new Vector3(1, 0, 0), Y: new Vector3(0, 1, 0), Z: new Vector3(0, 0, 1) };
  const worldRotation = new Quaternion(...fk[joint].rotation);
  const localAxis = axes[axis].clone().applyQuaternion(worldRotation);
  const others = axis === 'X' ? [axes.Y, axes.Z] : axis === 'Y' ? [axes.Z, axes.X] : [axes.X, axes.Y];
  const u = others[0].clone().applyQuaternion(worldRotation), v = others[1].clone().applyQuaternion(worldRotation);
  let start: { x: number; y: number } | undefined;
  for (const angle of [.55, 1.2, 2.1, 3.4, 4.3, 5.1, .3, 1.7, 2.7, 3.8, 4.8, 5.7]) {
    const point = view.point(center.clone().addScaledVector(u, Math.cos(angle) * scale * .5).addScaledVector(v, Math.sin(angle) * scale * .5).toArray() as [number, number, number]);
    await page.mouse.move(point.x, point.y);
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => resolve())));
    if ((await page.getByLabel('关节局部旋转', { exact: true }).innerText()).includes(`${axis}轴`)) { start = point; break; }
  }
  expect(start, `An exposed ${axis} ring must accept a real pointer hit`).toBeDefined();
  const ray = new Raycaster();
  ray.setFromCamera(new Vector2((start!.x - box.x) / box.width * 2 - 1, 1 - (start!.y - box.y) / box.height * 2), camera);
  const normal = camera.getWorldDirection(new Vector3()), plane = new Plane().setFromNormalAndCoplanarPoint(normal, center);
  const hit = ray.ray.intersectPlane(plane, new Vector3())!;
  const tangent = localAxis.clone().cross(eye).normalize(), inPlane = tangent.clone().addScaledVector(normal, -tangent.dot(normal));
  const radians = degrees * Math.PI / 180, speed = 20 / camera.position.distanceTo(center);
  const end = view.point((tangent.lengthSq() < 1e-12
    ? hit.sub(center).applyAxisAngle(eye, radians).add(center)
    : hit.addScaledVector(inPlane, radians / speed / inPlane.dot(tangent))).toArray() as [number, number, number]);
  await page.mouse.move(start!.x, start!.y); await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 1 });
}

function onlyPointChanged(actual: BakedTake, original: BakedTake, time: number, track: JointName | 'root') {
  expect(actual.times).toEqual(original.times);
  original.times.forEach((sampleTime, index) => {
    if (sampleTime !== time || track !== 'root') expect(actual.poses[index].root).toEqual(original.poses[index].root);
    for (const joint of JOINT_NAMES) if (sampleTime !== time || joint !== track) expect(actual.poses[index].joints[joint]).toEqual(original.poses[index].joints[joint]);
  });
}

async function nativeImport(page: Page, bytes: Buffer, filename = 'authored-crossing.choreo') {
  await closeDisclosures(page);
  await page.getByRole('button', { name: '场景', exact: true }).click();
  await page.getByRole('dialog', { name: '本机场景', exact: true }).getByRole('button', { name: '导入场景备份', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '导入场景备份', exact: true });
  await dialog.getByLabel('选择场景备份文件', { exact: true }).setInputFiles({ name: filename, mimeType: 'application/octet-stream', buffer: bytes });
  await dialog.getByRole('button', { name: '作为新场景导入', exact: true }).click();
  await expect(dialog).toHaveCount(0); await ready(page); await loaded(page);
}

test('@capsule a legal rotation with a clear endpoint cannot tunnel through the body in one pointer move', async ({ page }, info) => {
  const initialRotation = rotationFromDegrees([-90, 0, 0]);
  const source = await openFixture(page, false, source => {
    for (const pose of source.take.poses) {
      pose.joints.LeftUpperArm = [...initialRotation];
      pose.joints.RightUpperArm = rotationFromDegrees([0, 0, -80]);
    }
  });
  await loaded(page); await selectStageJoint(page, 'LeftUpperArm');
  const original = await backup(page), before = sampleTake(source.take, 0);
  const proposed = structuredClone(before), middle = structuredClone(before);
  proposed.joints.LeftUpperArm = new Quaternion(...initialRotation).multiply(new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), 120 * Math.PI / 180)).toArray() as Quat;
  middle.joints.LeftUpperArm = new Quaternion(...initialRotation).multiply(new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), 60 * Math.PI / 180)).toArray() as Quat;
  for (const pose of [before, middle, proposed]) expect(isJointRotationWithinLimits('LeftUpperArm', pose.joints.LeftUpperArm)).toBe(true);
  expect(getBodyCollisions(before).selfCollisions).toEqual([]);
  expect(getBodyCollisions(middle).selfCollisions.length).toBeGreaterThan(0);
  expect(getBodyCollisions(proposed).selfCollisions).toEqual([]);
  await rotationDrag(page, original, before, 'LeftUpperArm', 'X', 120);
  await expect(stage(page)).toContainText('已阻止身体穿插');
  const displayed = await visibleRotation(page);
  expect(new Quaternion(...initialRotation).angleTo(new Quaternion(...displayed))).toBeGreaterThan(.01);
  expect(new Quaternion(...displayed).angleTo(new Quaternion(...proposed.joints.LeftUpperArm))).toBeGreaterThan(.1);
  await page.mouse.up();
  const edited = await backup(page), snapshot = current(edited);
  expect(edited.scene.project.history).toHaveLength(original.scene.project.history.length + 1);
  expect(snapshot.operation).toMatchObject({ time: 0, tracks: ['LeftUpperArm'] });
  expect(snapshot.manual!.baseTake).toEqual(source.take);
  expect(snapshot.manual!.pointEdits).toHaveLength(1);
  expect(snapshot.manual!.pointEdits![0].joints!.LeftUpperArm).toEqual(displayed);
  expect(snapshot.take!.poses[0].joints.LeftUpperArm).toEqual(displayed);
  onlyPointChanged(snapshot.take!, source.take, 0, 'LeftUpperArm');
  expect(getBodyCollisions(sampleTake(snapshot.take!, 0)).selfCollisions).toEqual([]);
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  expect(current(await backup(page))).toEqual(current(original));
  await screenshot(page, info, 'capsule-swept-rotation-desktop.png');
});

test('@capsule Root stops at the floor and repeated blocked dragging adds no operation; save and undo remain exact', async ({ page }, info) => {
  const source = await openFixture(page); await loaded(page);
  const original = await backup(page);
  await editStageValue(page, 'Root Y 位移（米）', .8);
  const acceptedY = await stageValue(page, 'Root Y 位移（米）');
  expect(acceptedY).toBeLessThan(1.05); expect(acceptedY).toBeGreaterThanOrEqual(1.039 - .000005);
  const edited = await backup(page), snapshot = current(edited);
  expect(edited.scene.project.history).toHaveLength(original.scene.project.history.length + 1);
  expect(snapshot.operation).toMatchObject({ time: 0, tracks: ['root'] });
  expect(snapshot.manual!.baseTake).toEqual(source.take);
  onlyPointChanged(snapshot.take!, source.take, 0, 'root');
  expect(getBodyCollisions(sampleTake(snapshot.take!, 0)).floorPenetrations).toEqual([]);
  // A small repeated attempt must also be an exact no-op. Large deltas alone
  // can hide contact-budget drift below a coarse bisection resolution.
  await editStageValue(page, 'Root Y 位移（米）', 1.03);
  expect((await backup(page)).scene.project).toEqual(edited.scene.project);
  await save(page); await page.reload(); await ready(page); await loaded(page);
  expect((await backup(page)).scene.project).toEqual(edited.scene.project);
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  expect(current(await backup(page))).toEqual(current(original));
  await page.getByRole('button', { name: '重做', exact: true }).click();
  expect(current(await backup(page))).toEqual(snapshot);
  await screenshot(page, info, 'capsule-floor-root-desktop.png');
});

test('@capsule native imported crossing motion is warned in playback and explicit point values retain author intent', async ({ page }, info) => {
  test.setTimeout(120_000);
  const crossing = rotationFromDegrees([0, 0, -90]);
  const source = await openFixture(page, false, source => {
    for (const pose of source.take.poses) pose.joints.LeftUpperArm = [...crossing];
  });
  await loaded(page); expect(getBodyCollisions(source.take.poses[0]).selfCollisions.length).toBeGreaterThan(0);
  await save(page);
  const download = page.waitForEvent('download');
  await clickRevealed(page, hiddenButton(page, '下载完整场景包'));
  const path = await (await download).path(); expect(path).toBeTruthy();
  const bytes = await readFile(path!);
  await nativeImport(page, bytes);
  const imported = await backup(page);
  expect(current(imported).take).toEqual(source.take);
  await expect(warning(page)).toContainText('身体接触需检查');
  await expectStageSelection(page, null);
  await page.getByRole('button', { name: '播放', exact: true }).click();
  await expect.poll(async () => Number(await timeline(page).getByRole('slider', { name: '关键帧时间线进度', exact: true }).inputValue())).toBeGreaterThan(0);
  await expect(warning(page)).toBeVisible();
  await page.getByRole('button', { name: '暂停', exact: true }).click();
  expect((await backup(page)).scene.project).toEqual(imported.scene.project);
  await editStageValue(page, '当前帧', 0); await selectStageJoint(page, 'LeftUpperArm');
  expect(await visibleRotation(page)).toEqual(crossing);
  expect((await backup(page)).scene.project).toEqual(imported.scene.project);
  const selected = timeline(page).locator('[data-selected-point="true"][data-point="LeftUpperArm"][data-time="0"]');
  await selected.dblclick();
  const explicitX = page.getByRole('spinbutton', { name: '左肩四元数X', exact: true });
  await explicitX.fill('0.02'); await explicitX.press('Tab');
  const authored = await backup(page), snapshot = current(authored);
  expect(authored.scene.project.history).toHaveLength(imported.scene.project.history.length + 1);
  expect(snapshot.operation).toMatchObject({ time: 0, tracks: ['LeftUpperArm'] });
  onlyPointChanged(snapshot.take!, source.take, 0, 'LeftUpperArm');
  expect(getBodyCollisions(snapshot.take!.poses[0]).selfCollisions.length).toBeGreaterThan(0);
  expect(snapshot.take!.poses[0].joints.LeftUpperArm).toEqual(await visibleRotation(page));
  await closeDisclosures(page); await expect(warning(page)).toBeVisible();
  await save(page); await page.reload(); await ready(page); await loaded(page);
  expect((await backup(page)).scene.project).toEqual(authored.scene.project);
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  expect(current(await backup(page))).toEqual(current(imported));
  await screenshot(page, info, 'capsule-authored-crossing-preserved.png');
});

test('@capsule cancelling a real rotation leaves source and history intact on desktop and 390px with the actual skin loaded', async ({ page }, info) => {
  const crossing = rotationFromDegrees([0, 0, -90]);
  const source = await openFixture(page, false, source => {
    for (const pose of source.take.poses) pose.joints.LeftUpperArm = [...crossing];
  });
  await loaded(page);
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
    await page.getByRole('button', { name: '全身取景', exact: true }).click();
    await selectStageJoint(page, 'RightForeArm');
    const before = await backup(page), pose = sampleTake(source.take, 0);
    await rotationDrag(page, before, pose, 'RightForeArm', 'X', -20);
    expect(new Quaternion(...pose.joints.RightForeArm).angleTo(new Quaternion(...await visibleRotation(page)))).toBeGreaterThan(.1);
    await stage(page).press('Escape'); await page.mouse.up();
    expect((await backup(page)).scene.project).toEqual(before.scene.project);
    expect(await visibleRotation(page)).toEqual(pose.joints.RightForeArm);
    await expect(warning(page)).toBeVisible();
    await expect(page.locator('details.realism-panel')).not.toHaveAttribute('open');
    await expect(page.getByRole('button', { name: /^K (完整姿态|当前关节|位移)$/, includeHidden: true })).toHaveCount(0);
    const canvas = (await page.getByRole('img', { name: '人体编舞动作预览', exact: true }).boundingBox())!;
    expect(canvas.width).toBeGreaterThanOrEqual(width * .95);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await closeDisclosures(page);
    await screenshot(page, info, `capsule-loaded-skin-${width}.png`);
  }
});

