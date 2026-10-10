import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import { PerspectiveCamera, Plane, Quaternion, Raycaster, Vector2, Vector3 } from 'three';
import {
  JOINT_NAMES, evaluatePose, getBodyCollisions, initializeBodyCollisionBackend, isJointRotationWithinLimits,
  rotationFromDegrees, sampleTake, type BakedTake, type JointName, type Pose, type Quat,
} from '../packages/core/src';
import { clickRevealed, closeDisclosures, reveal } from './helpers';
import {
  backup, current, diagnostics, hiddenButton, openFixture, projection, ready, save,
  screenshot, type Backup,
} from './realismHelpers';
import { applyStageViewOffset, editStageValue, expectStageSelection, selectStageJoint, stageValue } from './stageInteractions';

const reports = new WeakMap<Page, ReturnType<typeof diagnostics>>();
const modelResponses = new WeakMap<Page, { status: number; bytes: number; magic: string; sha256: string }[]>();
const stage = (page: Page) => page.getByRole('region', { name: '3D 动画舞台', exact: true });
const timeline = (page: Page) => page.getByRole('region', { name: '手动关键帧时间线', exact: true });
const canvas = (page: Page) => page.getByRole('img', { name: '人体编舞动作预览', exact: true });
const exactClock = (page: Page) => timeline(page).getByRole('spinbutton', { name: '当前时间（秒）', exact: true, includeHidden: true });

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

async function rendered(page: Page, presentation: 'author' | 'collision-preview', time?: number): Promise<{ pose: Pose; time: number }> {
  // The canvas receipt is written after applying the actual rig, not merely
  // when React schedules a new preview. Never assert against the previous draw.
  await expect(canvas(page)).toHaveAttribute('data-motion-presentation', presentation);
  await expect(canvas(page)).toHaveAttribute('data-collision-preview-state', presentation === 'author' ? 'author' : 'ready');
  if (time !== undefined) await expect(canvas(page)).toHaveAttribute('data-render-time', String(time));
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  const result = await canvas(page).evaluate(element => ({
    pose: JSON.parse(element.getAttribute('data-render-pose')!),
    time: Number(element.getAttribute('data-render-time')),
  })) as { pose: Pose; time: number };
  expect([...result.pose.root, ...JOINT_NAMES.flatMap(joint => result.pose.joints[joint])].every(Number.isFinite)).toBe(true);
  if (time !== undefined) expect(JSON.parse((await stage(page).getAttribute('data-root-position'))!)).toEqual(result.pose.root);
  return result;
}

async function previewAt(page: Page, time: number) {
  const seekExact = async (next: number) => {
    await reveal(page, exactClock(page));
    await exactClock(page).fill(String(next)); await exactClock(page).press('Tab');
    expect(Number(await exactClock(page).inputValue())).toBe(next);
    await closeDisclosures(page, '.kf-point-inspector');
  };
  // Re-entering a preview at an unchanged time is still a user seek. Native
  // input change delivery requires an actual value transition after reload.
  if (Number(await exactClock(page).inputValue()) === time && await stage(page).getAttribute('data-motion-presentation') === 'author') {
    await seekExact(time === 0 ? .01 : 0);
  }
  // Native range inputs sanitize their own decimal string. The numeric exact
  // time entry retains every digit when replaying an arbitrary drawn time.
  await seekExact(time);
  await expect(page.getByLabel('碰撞预览', { exact: true })).toBeVisible();
  return (await rendered(page, 'collision-preview', time)).pose;
}

async function nativeScrub(page: Page, startFraction: number, endFraction: number) {
  await closeDisclosures(page);
  const slider = timeline(page).getByRole('slider', { name: '关键帧时间线进度', exact: true });
  await slider.scrollIntoViewIfNeeded();
  const box = (await slider.boundingBox())!;
  await page.mouse.move(box.x + box.width * startFraction, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * endFraction, box.y + box.height / 2, { steps: 5 });
  await page.mouse.up();
  const time = Number(await exactClock(page).inputValue());
  return rendered(page, 'collision-preview', time);
}

function selfDepth(pose: Pose) {
  return getBodyCollisions(pose).selfCollisions.reduce((sum, contact) => sum + contact.depthMeters, 0);
}

async function fullBundle(page: Page) {
  const download = page.waitForEvent('download');
  await clickRevealed(page, hiddenButton(page, '下载完整场景包'));
  const path = await (await download).path(); expect(path).toBeTruthy();
  await closeDisclosures(page);
  return readFile(path!);
}

/** Real pointer movement deliberately proposes an authored overlap. Collision
 * handling belongs to viewing, so it must not shorten this editor gesture. */
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
  if (degrees !== 0) await page.mouse.move(end.x, end.y, { steps: 1 });
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
  const discard = page.getByRole('button', { name: '不保存，继续', exact: true });
  if (await discard.isVisible()) await discard.click();
  await expect(dialog).toHaveCount(0); await ready(page); await loaded(page);
}

test('@capsule a legal rotation freely enters body overlap and records only the authored channel', async ({ page }, info) => {
  const initialRotation = rotationFromDegrees([-90, 0, 0]);
  const source = await openFixture(page, false, source => {
    for (const pose of source.take.poses) {
      pose.joints.LeftUpperArm = [...initialRotation];
      pose.joints.RightUpperArm = rotationFromDegrees([0, 0, -80]);
    }
  });
  await loaded(page); await selectStageJoint(page, 'LeftUpperArm');
  const original = await backup(page), before = sampleTake(source.take, 0);
  const proposed = structuredClone(before);
  proposed.joints.LeftUpperArm = new Quaternion(...initialRotation).multiply(new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), 60 * Math.PI / 180)).toArray() as Quat;
  for (const pose of [before, proposed]) expect(isJointRotationWithinLimits('LeftUpperArm', pose.joints.LeftUpperArm)).toBe(true);
  expect(getBodyCollisions(before).selfCollisions).toEqual([]);
  expect(getBodyCollisions(proposed).selfCollisions.length).toBeGreaterThan(0);
  await rotationDrag(page, original, before, 'LeftUpperArm', 'X', 60);
  await expect(stage(page)).toHaveAttribute('data-motion-presentation', 'author');
  await expect(stage(page)).not.toContainText('已阻止身体穿插');
  const displayed = await visibleRotation(page);
  expect(new Quaternion(...initialRotation).angleTo(new Quaternion(...displayed))).toBeGreaterThan(.01);
  expect(new Quaternion(...displayed).angleTo(new Quaternion(...proposed.joints.LeftUpperArm))).toBeLessThan(.00001);
  await page.mouse.up();
  const edited = await backup(page), snapshot = current(edited);
  expect(edited.scene.project.history).toHaveLength(original.scene.project.history.length + 1);
  expect(snapshot.operation).toMatchObject({ time: 0, tracks: ['LeftUpperArm'] });
  expect(snapshot.manual!.baseTake).toEqual(source.take);
  expect(snapshot.manual!.pointEdits).toHaveLength(1);
  expect(snapshot.manual!.pointEdits![0].joints!.LeftUpperArm).toEqual(displayed);
  expect(snapshot.take!.poses[0].joints.LeftUpperArm).toEqual(displayed);
  onlyPointChanged(snapshot.take!, source.take, 0, 'LeftUpperArm');
  expect(getBodyCollisions(sampleTake(snapshot.take!, 0)).selfCollisions.length).toBeGreaterThan(0);
  expect((await rendered(page, 'author', 0)).pose).toEqual(sampleTake(snapshot.take!, 0));
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  expect(current(await backup(page))).toEqual(current(original));
  await screenshot(page, info, 'capsule-free-rotation-desktop.png');
});

test('@capsule Root freely enters the floor and repeated edits, save and undo preserve authored values', async ({ page }, info) => {
  const source = await openFixture(page); await loaded(page);
  const original = await backup(page);
  await editStageValue(page, 'Root Y 位移（米）', .8);
  const acceptedY = await stageValue(page, 'Root Y 位移（米）');
  expect(acceptedY).toBeCloseTo(.8, 5);
  const edited = await backup(page), snapshot = current(edited);
  expect(edited.scene.project.history).toHaveLength(original.scene.project.history.length + 1);
  expect(snapshot.operation).toMatchObject({ time: 0, tracks: ['root'] });
  expect(snapshot.manual!.baseTake).toEqual(source.take);
  onlyPointChanged(snapshot.take!, source.take, 0, 'root');
  expect(getBodyCollisions(sampleTake(snapshot.take!, 0)).floorPenetrations.length).toBeGreaterThan(0);
  // A second below-floor author value is a second effective edit, not a
  // collision-limited no-op or a progressively clamped floor boundary.
  await editStageValue(page, 'Root Y 位移（米）', 1.03);
  expect(await stageValue(page, 'Root Y 位移（米）')).toBeCloseTo(1.03, 5);
  const second = await backup(page);
  expect(second.scene.project.history).toHaveLength(edited.scene.project.history.length + 1);
  expect(current(second).operation).toMatchObject({ time: 0, tracks: ['root'] });
  expect((await rendered(page, 'author', 0)).pose).toEqual(sampleTake(current(second).take!, 0));
  await save(page); await page.reload(); await ready(page); await loaded(page);
  expect((await backup(page)).scene.project).toEqual(second.scene.project);
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  expect(current(await backup(page))).toEqual(snapshot);
  await page.getByRole('button', { name: '重做', exact: true }).click();
  expect(current(await backup(page))).toEqual(current(second));
  await screenshot(page, info, 'capsule-free-floor-root-desktop.png');
});

test('@capsule imported body crossing receives display-only contact response in playback while author values and bundles remain exact', async ({ page }, info) => {
  test.setTimeout(120_000);
  const crossing = rotationFromDegrees([0, 0, -90]);
  const source = await openFixture(page, false, source => {
    for (const pose of source.take.poses) {
      pose.joints.LeftUpperArm = [...crossing];
      pose.joints.RightUpperArm = rotationFromDegrees([0, 0, -80]);
    }
  });
  await loaded(page); expect(getBodyCollisions(source.take.poses[0]).selfCollisions.length).toBeGreaterThan(0);
  await save(page);
  const bytes = await fullBundle(page);
  await nativeImport(page, bytes);
  const imported = await backup(page);
  expect(current(imported).take).toEqual(source.take);
  await expectStageSelection(page, null);
  const projected = await previewAt(page, .7);
  expect(selfDepth(projected)).toBeLessThan(selfDepth(sampleTake(source.take, .7)) - .000001);
  expect((await backup(page)).scene.project).toEqual(imported.scene.project);
  await page.getByRole('button', { name: '播放', exact: true }).click();
  await expect.poll(async () => Number(await timeline(page).getByRole('slider', { name: '关键帧时间线进度', exact: true }).inputValue())).toBeGreaterThan(0);
  const played = await rendered(page, 'collision-preview');
  expect(selfDepth(played.pose)).toBeLessThan(selfDepth(sampleTake(source.take, played.time)) - .000001);
  await page.getByRole('button', { name: '暂停', exact: true }).click();
  expect(await previewAt(page, played.time)).toEqual(played.pose);
  expect((await backup(page)).scene.project).toEqual(imported.scene.project);
  await editStageValue(page, '当前帧', 0);
  await selectStageJoint(page, 'LeftUpperArm');
  await page.getByRole('button', { name: '旋转工具', exact: true }).click();
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
  await closeDisclosures(page); await expect(stage(page)).toHaveAttribute('data-motion-presentation', 'author');
  await save(page); await page.reload(); await ready(page); await loaded(page);
  expect((await backup(page)).scene.project).toEqual(authored.scene.project);
  await previewAt(page, .7);
  const secondBundle = await fullBundle(page);
  await nativeImport(page, secondBundle, 'raw-author-after-preview.choreo');
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
    await expect(stage(page)).toHaveAttribute('data-motion-presentation', 'author');
    await expect(page.locator('details.realism-panel')).not.toHaveAttribute('open');
    await expect(page.getByRole('button', { name: /^K (完整姿态|当前关节|位移)$/, includeHidden: true })).toHaveCount(0);
    const canvas = (await page.getByRole('img', { name: '人体编舞动作预览', exact: true }).boundingBox())!;
    expect(canvas.width).toBeGreaterThanOrEqual(width * .95);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await closeDisclosures(page);
    await screenshot(page, info, `capsule-loaded-skin-${width}.png`);
  }
});

test('@capsule 390px exact forward and backward previews preserve raw scenes and the first body gesture starts from the author pose', async ({ page }, info) => {
  test.setTimeout(150_000);
  await page.setViewportSize({ width: 390, height: 844 });
  const time = .70391;
  const source = await openFixture(page, false, source => {
    source.take.times = [0, time, .70612, 2.5, 4, 8, 12, 16];
    source.take.poses = source.take.times.map(sampleTime => {
      const pose = structuredClone(source.take.poses[0]);
      pose.root = [sampleTime / 100, sampleTime < 1 ? .8 + sampleTime * .05 : 1.05, 0];
      pose.joints.LeftUpperArm = rotationFromDegrees([-90, 0, 0]);
      pose.joints.RightUpperArm = rotationFromDegrees([0, 0, -80]);
      return pose;
    });
  });
  await loaded(page);
  const original = await backup(page), raw = sampleTake(source.take, time);
  const firstPreview = await previewAt(page, time);
  const rawFloor = getBodyCollisions(raw).floorPenetrations;
  expect(rawFloor.length).toBeGreaterThan(0);
  expect(firstPreview.root[1]).toBeGreaterThan(raw.root[1] + .15);
  expect(getBodyCollisions(firstPreview).floorPenetrations.every(contact => contact.depthMeters <= .003001)).toBe(true);
  expect(firstPreview.root[0]).toBe(raw.root[0]);
  expect(firstPreview.root[2]).toBe(raw.root[2]);
  expect(firstPreview.joints).toEqual(raw.joints);

  // Native slider dragging reaches the same screen location from both sides.
  // Exact off-grid seeks then check an independently specified source timestamp.
  const backward = await nativeScrub(page, .7, .04);
  const forward = await nativeScrub(page, .01, .04);
  expect(forward.time).toBe(backward.time);
  expect(forward.pose).toEqual(backward.pose);
  for (const other of [12, .70612, 0, 4]) {
    await previewAt(page, other);
    expect(await previewAt(page, time)).toEqual(firstPreview);
  }
  expect((await backup(page)).scene.project).toEqual(original.scene.project);

  await page.getByRole('button', { name: '播放', exact: true }).click();
  await expect.poll(async () => Number(await timeline(page).getByRole('slider', { name: '关键帧时间线进度', exact: true }).inputValue())).toBeGreaterThan(time);
  const played = await rendered(page, 'collision-preview');
  await page.getByRole('button', { name: '暂停', exact: true }).click();
  expect(await previewAt(page, played.time)).toEqual(played.pose);
  expect((await backup(page)).scene.project).toEqual(original.scene.project);

  await previewAt(page, time); await save(page); await page.reload(); await ready(page); await loaded(page);
  const reopened = await backup(page);
  expect(reopened.scene.project).toEqual(original.scene.project);
  expect(reopened.scene.viewer.time).toBe(time);
  expect(await previewAt(page, time)).toEqual(firstPreview);
  const bytes = await fullBundle(page), headerLength = bytes.readUInt32LE(16);
  expect(bytes.subarray(20 + headerLength)).toEqual(source.wave);
  await nativeImport(page, bytes, 'raw-floor-with-exact-times.choreo');
  const imported = await backup(page);
  expect(imported.scene.project).toEqual(original.scene.project);
  expect(await previewAt(page, time)).toEqual(firstPreview);
  await screenshot(page, info, 'capsule-collision-preview-390.png');

  // Pick the visible, corrected Head on the actual canvas. This must first
  // restore the raw author pose, without accepting the lifted preview Root.
  const view = await projection(page, await backup(page));
  const head = view.point(evaluatePose(firstPreview).Head.position);
  await page.mouse.click(head.x, head.y);
  await expectStageSelection(page, 'Head');
  expect((await rendered(page, 'author', time)).pose).toEqual(raw);
  expect((await backup(page)).scene.project).toEqual(imported.scene.project);

  const before = await backup(page);
  await rotationDrag(page, before, raw, 'Head', 'Y', 0);
  await page.mouse.up();
  expect((await backup(page)).scene.project).toEqual(before.scene.project);
  await rotationDrag(page, before, raw, 'Head', 'Y', 15);
  await stage(page).press('Escape'); await page.mouse.up();
  expect((await backup(page)).scene.project).toEqual(before.scene.project);
  expect((await rendered(page, 'author', time)).pose).toEqual(raw);

  await rotationDrag(page, before, raw, 'Head', 'Y', 15);
  const authoredRotation = await visibleRotation(page);
  await page.mouse.up();
  const after = await backup(page), snapshot = current(after);
  expect(after.scene.project.history).toHaveLength(before.scene.project.history.length + 1);
  expect(snapshot.operation).toMatchObject({ time, tracks: ['Head'] });
  expect(snapshot.manual!.baseTake).toEqual(source.take);
  expect(snapshot.manual!.pointEdits).toEqual([{ time, joints: { Head: authoredRotation } }]);
  expect(sampleTake(snapshot.take!, time).root).toEqual(raw.root);
  onlyPointChanged(snapshot.take!, source.take, time, 'Head');
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  expect(current(await backup(page))).toEqual(current(before));
  await page.getByRole('button', { name: '重做', exact: true }).click();
  expect(current(await backup(page))).toEqual(snapshot);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await screenshot(page, info, 'capsule-first-author-gesture-390.png');
});

test('@capsule a grounded real knee ring freely crosses the floor, cancels exactly and reaches a backward kick without changing Root', async ({ page }, info) => {
  test.setTimeout(120_000);
  const source = await openFixture(page, false, source => {
    for (const pose of source.take.poses) {
      pose.root = [0, 1.05, 0];
      pose.joints.LeftUpperArm = rotationFromDegrees([0, 0, 20]);
      pose.joints.RightUpperArm = rotationFromDegrees([0, 0, -20]);
    }
  });
  await loaded(page);
  const before = sampleTake(source.take, 0);
  expect(getBodyCollisions(before).selfCollisions).toEqual([]);
  expect(getBodyCollisions(before).floorPenetrations).toEqual([]);
  const contactPose = structuredClone(before), kickPose = structuredClone(before);
  contactPose.joints.LeftLowerLeg = rotationFromDegrees([15, 0, 0]);
  kickPose.joints.LeftLowerLeg = rotationFromDegrees([60, 0, 0]);
  for (const pose of [contactPose, kickPose]) expect(isJointRotationWithinLimits('LeftLowerLeg', pose.joints.LeftLowerLeg)).toBe(true);
  expect(getBodyCollisions(contactPose).floorPenetrations.some(contact => contact.segmentId === 'Left-foot' && contact.depthMeters > .01)).toBe(true);
  expect(getBodyCollisions(kickPose).selfCollisions).toEqual([]);
  expect(getBodyCollisions(kickPose).floorPenetrations).toEqual([]);

  // Select the actual visible knee with the pointer before hitting its native
  // X ring. No numeric pose edit, forced click or relaxed joint limit is used.
  const bodyView = await projection(page, await backup(page));
  const knee = bodyView.point(evaluatePose(before).LeftLowerLeg.position);
  await page.mouse.click(knee.x, knee.y);
  await expectStageSelection(page, 'LeftLowerLeg');
  const original = await backup(page);
  expect((await rendered(page, 'author', 0)).pose).toEqual(before);

  await rotationDrag(page, original, before, 'LeftLowerLeg', 'X', 15);
  expect(new Quaternion(...await visibleRotation(page)).angleTo(new Quaternion(...contactPose.joints.LeftLowerLeg))).toBeLessThan(.00001);
  const cancelledDraft = (await rendered(page, 'author', 0)).pose;
  expect(cancelledDraft.root).toEqual(before.root);
  expect(getBodyCollisions(cancelledDraft).floorPenetrations.some(contact => contact.depthMeters > .01)).toBe(true);
  await stage(page).press('Escape'); await page.mouse.up();
  expect((await backup(page)).scene.project).toEqual(original.scene.project);
  expect((await rendered(page, 'author', 0)).pose).toEqual(before);

  await rotationDrag(page, original, before, 'LeftLowerLeg', 'X', 15);
  const authoredContact = await visibleRotation(page);
  expect(new Quaternion(...authoredContact).angleTo(new Quaternion(...contactPose.joints.LeftLowerLeg))).toBeLessThan(.00001);
  expect((await rendered(page, 'author', 0)).pose.root).toEqual(before.root);
  await page.mouse.up();
  const edited = await backup(page), snapshot = current(edited);
  expect(edited.scene.project.history).toHaveLength(original.scene.project.history.length + 1);
  expect(edited.scene.project.historyIndex).toBe(original.scene.project.historyIndex + 1);
  expect(snapshot.operation).toMatchObject({ time: 0, tracks: ['LeftLowerLeg'] });
  expect(snapshot.manual!.baseTake).toEqual(source.take);
  expect(snapshot.manual!.pointEdits).toEqual([{ time: 0, joints: { LeftLowerLeg: authoredContact } }]);
  onlyPointChanged(snapshot.take!, source.take, 0, 'LeftLowerLeg');
  const authoredPose = sampleTake(snapshot.take!, 0);
  expect(authoredPose.root).toEqual(before.root);
  expect(authoredPose.joints.LeftLowerLeg).toEqual(authoredContact);
  const authorContacts = getBodyCollisions(authoredPose);
  expect(authorContacts.floorPenetrations.some(contact => contact.depthMeters > .01)).toBe(true);

  const projected = await previewAt(page, 0), projectedContacts = getBodyCollisions(projected);
  expect(projected.root[1]).toBeGreaterThan(before.root[1] + .01);
  expect(projected.root[0]).toBe(before.root[0]);
  expect(projected.root[2]).toBe(before.root[2]);
  expect(projected.joints).toEqual(authoredPose.joints);
  expect(projectedContacts.floorPenetrations.every(contact => contact.depthMeters <= .003001)).toBe(true);
  expect((await backup(page)).scene.project).toEqual(edited.scene.project);
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  expect(current(await backup(page))).toEqual(current(original));

  // A 60-degree knee bend ends clear of the floor but passes through the same
  // contact interval. The former incremental guard stopped it near 4.36 deg.
  // Explicitly choosing the real tool restores author presentation after seek.
  await page.getByRole('button', { name: '旋转工具', exact: true }).click();
  await expectStageSelection(page, 'LeftLowerLeg');
  expect((await rendered(page, 'author', 0)).pose).toEqual(before);
  const restored = await backup(page);
  await rotationDrag(page, restored, before, 'LeftLowerLeg', 'X', 60);
  const authoredKick = await visibleRotation(page);
  expect(new Quaternion(...authoredKick).angleTo(new Quaternion(...kickPose.joints.LeftLowerLeg))).toBeLessThan(.00001);
  expect((await rendered(page, 'author', 0)).pose.root).toEqual(before.root);
  await page.mouse.up();
  const kicked = await backup(page), kickSnapshot = current(kicked);
  expect(kicked.scene.project.history).toHaveLength(original.scene.project.history.length + 1);
  expect(kicked.scene.project.historyIndex).toBe(original.scene.project.historyIndex + 1);
  expect(kickSnapshot.operation).toMatchObject({ time: 0, tracks: ['LeftLowerLeg'] });
  expect(kickSnapshot.manual!.baseTake).toEqual(source.take);
  expect(kickSnapshot.manual!.pointEdits).toEqual([{ time: 0, joints: { LeftLowerLeg: authoredKick } }]);
  onlyPointChanged(kickSnapshot.take!, source.take, 0, 'LeftLowerLeg');
  const finalPose = sampleTake(kickSnapshot.take!, 0);
  expect(finalPose.root).toEqual(before.root);
  expect(finalPose.joints.LeftLowerLeg).toEqual(authoredKick);
  expect((await rendered(page, 'author', 0)).pose).toEqual(finalPose);
  const finalContacts = getBodyCollisions(finalPose);
  expect(finalContacts.selfCollisions).toEqual([]);
  expect(finalContacts.floorPenetrations).toEqual([]);
  await info.attach('capsule-grounded-knee-contact-response.json', {
    body: JSON.stringify({ authorContacts, projectedContacts, finalContacts, authoredRoot: authoredPose.root, previewRoot: projected.root, kickRoot: finalPose.root }),
    contentType: 'application/json',
  });
  await screenshot(page, info, 'capsule-grounded-real-knee-backward-kick.png');
});
