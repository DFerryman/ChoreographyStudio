import { readFile } from 'node:fs/promises';
import { expect, type Page } from '@playwright/test';
import { PerspectiveCamera, Plane, Quaternion, Raycaster, Vector2, Vector3 } from 'three';
import { JOINT_NAMES, evaluatePose, rotationFromDegrees, rotationToDegrees, sampleTake, type JointName, type Pose, type Quat, type Vec3 } from '../packages/core/src';
import { clickRevealed, closeDisclosures, reveal } from './helpers';
import { unpackScene } from '../apps/web/src/compactScene';

// These helpers operate the same canvas, handles and native disclosures as a
// teacher. They do not mutate React state or introduce an editor-only test API.
const labels: Record<JointName, string> = {
  Hips: '骨盆', Spine: '腰椎', Chest: '胸椎', Neck: '颈部', Head: '头部',
  LeftShoulder: '左锁骨', LeftUpperArm: '左肩', LeftForeArm: '左肘', LeftHand: '左腕', LeftHandTip: '左指尖',
  RightShoulder: '右锁骨', RightUpperArm: '右肩', RightForeArm: '右肘', RightHand: '右腕', RightHandTip: '右指尖',
  LeftUpperLeg: '左髋', LeftLowerLeg: '左膝', LeftFoot: '左踝', LeftToe: '左脚尖', LeftHeel: '左脚跟',
  RightUpperLeg: '右髋', RightLowerLeg: '右膝', RightFoot: '右踝', RightToe: '右脚尖', RightHeel: '右脚跟',
};
const axes = { X: new Vector3(1, 0, 0), Y: new Vector3(0, 1, 0), Z: new Vector3(0, 0, 1) };
const poseLabels = /^(关节 [XYZ] 旋转（度）|Root [XYZ] 位移（米）)$/;
const cachedDrafts = new WeakMap<Page, { id: string; take: string; time: number; pose: Pose }>();
type Exported = { scene: { id: string; viewer: { time: number; mirror: boolean; camera: { position: Vec3; target: Vec3; zoom?: number }; transformTool?: string }; project: { historyIndex: number; history: { take: Parameters<typeof sampleTake>[0] }[] } } };

export async function stageSelectedJoint(page: Page): Promise<JointName | null> {
  const announcement = page.locator('.stage3d-selection-announcement');
  await expect(announcement, 'The live stage must remain available for body selection').toHaveCount(1);
  const text = await announcement.innerText();
  return JOINT_NAMES.find(name => text === `已选中${labels[name]}`) ?? null;
}

export async function expectStageSelection(page: Page, joint: JointName | '' | null) {
  await expect(page.locator('.stage3d-selection-announcement')).toHaveText(joint ? `已选中${labels[joint]}` : '未选中关节');
}

async function exported(page: Page): Promise<Exported> {
  const pending = page.waitForEvent('download');
  await clickRevealed(page, page.getByRole('button', { name: '下载项目备份', exact: true, includeHidden: true }));
  const path = await (await pending).path();
  expect(path).toBeTruthy();
  const document = JSON.parse(await readFile(path!, 'utf8'));
  if (document.format === 'choreo-scene-backup-2') document.scene = unpackScene(document.scene);
  await closeDisclosures(page, '.studio-more, .studio-more .backup-menu');
  return document;
}

export async function stageValue(page: Page, label: string): Promise<number> {
  if (!poseLabels.test(label)) return Number(await page.getByRole('spinbutton', { name: label, exact: true, includeHidden: true }).inputValue());
  const axis = label.includes(' X ') ? 0 : label.includes(' Y ') ? 1 : 2;
  const stage = page.getByRole('region', { name: '3D 动画舞台', exact: true });
  const attribute = label.startsWith('Root') ? 'data-root-position' : 'data-local-rotation';
  const raw = await stage.getAttribute(attribute) ?? await page.getByLabel('选中姿态状态', { exact: true }).getAttribute(attribute);
  expect(raw, `The actual visible pose snapshot must report ${label}`).toBeTruthy();
  const data = JSON.parse(raw!);
  return label.startsWith('Root') ? data[axis] : rotationToDegrees(data as Quat)[axis];
}

export async function expectStageValue(page: Page, label: string, value: number, tolerance = label.startsWith('Root') ? .000005 : .051) {
  await expect.poll(async () => Math.abs(await stageValue(page, label) - value)).toBeLessThan(tolerance);
}

/** Target coordinates entered by a pointer are checked to five decimal meters;
 * stored/imported/copied/history values continue using exact comparisons. */
export function expectGestureRootKeys(actual: { frame: number; position: number[] }[], expected: { frame: number; position: number[] }[]) {
  expect(actual.map(key => key.frame)).toEqual(expected.map(key => key.frame));
  actual.forEach((key, i) => key.position.forEach((value, axis) => expect(value).toBeCloseTo(expected[i].position[axis], 5)));
}

export async function readStagePose(page: Page) {
  const document = await exported(page), scene = document.scene;
  const take = scene.project.history[scene.project.historyIndex].take;
  const draft = await page.getByRole('status').filter({ hasText: '姿态草稿 · 尚未写入关键帧' }).isVisible();
  const cached = cachedDrafts.get(page);
  const pose = structuredClone(draft && cached?.id === scene.id && cached.take === take.id && cached.time === scene.viewer.time ? cached.pose : sampleTake(take, scene.viewer.time));
  pose.root = await Promise.all(['X', 'Y', 'Z'].map(axis => stageValue(page, `Root ${axis} 位移（米）`))) as Vec3;
  const selected = await stageSelectedJoint(page);
  if (selected) {
    const degrees = await Promise.all(['X', 'Y', 'Z'].map(axis => stageValue(page, `关节 ${axis} 旋转（度）`))) as Vec3;
    pose.joints[selected] = rotationFromDegrees(degrees);
  }
  cachedDrafts.set(page, { id: scene.id, take: take.id, time: scene.viewer.time, pose });
  return { document, pose, selected };
}

/** The displayed camera reserves transient screen space without changing its saved world state. */
export async function applyStageViewOffset(page: Page, camera: PerspectiveCamera) {
  const { width, height, value } = await page.getByRole('region', { name: '3D 动画舞台', exact: true }).evaluate((stage: HTMLElement) => ({ width: stage.clientWidth, height: stage.clientHeight, value: stage.getAttribute('data-camera-offset-y') }));
  expect(value, 'The stage must expose its actual transient camera projection').not.toBeNull();
  expect(width).toBeGreaterThan(0); expect(height).toBeGreaterThan(0);
  const offsetY = Number(value);
  expect(Number.isFinite(offsetY)).toBe(true);
  // The renderer uses integer client dimensions; CSS pointer coordinates can
  // still have a fractional bounding box and are mapped through that box below.
  camera.aspect = width / height;
  if (offsetY !== 0) camera.setViewOffset(width, height, 0, offsetY, width, height);
}

async function projection(page: Page, document: Exported) {
  const canvas = page.getByRole('img', { name: '人体编舞动作预览' });
  await closeDisclosures(page, '.studio-more, .scene-extras, .camera-options, .kf-more, .kf-more-actions');
  await canvas.scrollIntoViewIfNeeded();
  const box = (await canvas.boundingBox())!, state = document.scene.viewer.camera;
  const camera = new PerspectiveCamera(40, box.width / box.height, .05, 80);
  camera.position.fromArray(state.position); camera.zoom = state.zoom ?? 1;
  await applyStageViewOffset(page, camera);
  camera.lookAt(new Vector3(...state.target)); camera.updateProjectionMatrix(); camera.updateMatrixWorld(true);
  const point = (world: Vector3) => {
    const projected = world.clone().project(camera);
    return { x: box.x + (projected.x + 1) * box.width / 2, y: box.y + (1 - projected.y) * box.height / 2 };
  };
  return { canvas, box, camera, point };
}

/** Select from the body itself; offscreen or occluded nodes remain keyboard accessible. */
export async function selectStageJoint(page: Page, joint: JointName | '' | null) {
  if (await stageSelectedJoint(page) === (joint || null)) return;
  const state = await readStagePose(page), view = await projection(page, state.document);
  const stage = page.getByRole('region', { name: '3D 动画舞台', exact: true });
  if (joint) {
    const world = [...evaluatePose(state.pose)[joint].position] as Vec3;
    if (state.document.scene.viewer.mirror) world[0] *= -1;
    const p = view.point(new Vector3(...world));
    const viewport = page.viewportSize()!;
    if (p.x > view.box.x + 2 && p.x < view.box.x + view.box.width - 2 && p.y > Math.max(view.box.y + 2, 0) && p.y < Math.min(view.box.y + view.box.height - 2, viewport.height)) {
      await view.canvas.scrollIntoViewIfNeeded();
      const fresh = await projection(page, state.document), target = fresh.point(new Vector3(...world));
      await page.mouse.click(target.x, target.y);
      if (await stageSelectedJoint(page) === joint) {
        await expectStageSelection(page, joint);
        return;
      }
    }
    if (await stage.getAttribute('tabindex') !== '0') {
      // In viewing modes, frame the visible actor before choosing its body
      // part. This is the explicit whole-body action a user needs when the
      // scene's translated pose lies beyond the current camera.
      await page.getByRole('button', { name: '全身取景', exact: true }).click();
      const refreshed = await readStagePose(page), framed = await projection(page, refreshed.document);
      const target = framed.point(new Vector3(...world));
      await page.mouse.click(target.x, target.y);
      await expectStageSelection(page, joint);
      return;
    }
    await stage.focus();
    for (let i = 0; i < JOINT_NAMES.length; i++) {
      if (await stageSelectedJoint(page) === joint) break;
      await stage.press('Alt+ArrowDown');
    }
    await expectStageSelection(page, joint);
  } else {
    await page.getByRole('button', { name: '选择工具', exact: true }).click();
    const fresh = await projection(page, state.document);
    const viewport = page.viewportSize()!;
    for (const [x, y] of [[.04, .45], [.96, .45], [.04, .3], [.96, .3], [.04, .6], [.96, .6], [.5, .15]] as const) {
      const point = { x: fresh.box.x + fresh.box.width * x, y: fresh.box.y + fresh.box.height * y };
      if (point.x <= 0 || point.x >= viewport.width || point.y <= 0 || point.y >= viewport.height) continue;
      if (!await fresh.canvas.evaluate((canvas, point) => document.elementFromPoint(point.x, point.y) === canvas, point)) continue;
      await page.mouse.click(point.x, point.y);
      if (await stageSelectedJoint(page) === null) {
        await expectStageSelection(page, null);
        return;
      }
    }
    throw new Error('No visible blank canvas point was available to clear the selected body part.');
  }
}

async function hoverHandle(page: Page, point: (angle: number) => { x: number; y: number }, indicator: string, axis: string) {
  for (const angle of [.55, 1.2, 2.1, 3.4, 4.3, 5.1, .3, 1.7, 2.7, 3.8, 4.8, 5.7]) {
    const candidate = point(angle);
    await page.mouse.move(candidate.x, candidate.y);
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => resolve())));
    if ((await page.getByLabel(indicator, { exact: true }).innerText()).includes(`${axis}轴`)) return candidate;
  }
  throw new Error(`No visible ${axis} handle was found for ${indicator}`);
}

/** Former precision-panel calls now exercise a real pointer drag. */
export async function editStageValue(page: Page, label: string, value: number) {
  if (!poseLabels.test(label)) {
    const input = page.getByRole('spinbutton', { name: label, exact: true, includeHidden: true });
    await reveal(page, input);
    await input.fill(String(value)); await input.press('Tab'); return;
  }
  const axis = label.includes(' X ') ? 'X' : label.includes(' Y ') ? 'Y' : 'Z';
  const startValue = await stageValue(page, label);
  if (Math.abs(startValue - value) < 1e-12) return;
  const state = await readStagePose(page), root = label.startsWith('Root');
  expect(root || state.selected, 'Rotation requires an actual selected body part').toBeTruthy();
  const prior = state.document.scene.viewer.transformTool ?? 'rotate';
  await closeDisclosures(page, '.studio-more, .scene-extras, .camera-options, .kf-more');
  await page.getByRole('button', { name: root ? '移动角色工具' : '旋转工具', exact: true }).click();
  const view = await projection(page, state.document), fk = evaluatePose(state.pose);
  const center = new Vector3(...(root ? state.pose.root : fk[state.selected!].position));
  const eye = view.camera.position.clone().sub(center).normalize();
  const scale = view.camera.position.distanceTo(center) * Math.min(1.9 * Math.tan(Math.PI * view.camera.fov / 360) / view.camera.zoom, 7) * .95 / 4;
  let start: { x: number; y: number }, end: { x: number; y: number };
  if (root) {
    const direction = axes[axis].clone();
    start = await hoverHandle(page, fraction => view.point(center.clone().addScaledVector(direction, scale * (.42 + fraction * .045))), 'Root 世界位移', axis);
    const ray = new Raycaster();
    ray.setFromCamera(new Vector2((start.x - view.box.x) / view.box.width * 2 - 1, 1 - (start.y - view.box.y) / view.box.height * 2), view.camera);
    const normal = direction.clone().cross(eye.clone().cross(direction)).normalize();
    const plane = new Plane().setFromNormalAndCoplanarPoint(normal, center);
    const hit = ray.ray.intersectPlane(plane, new Vector3())!;
    end = view.point(hit.addScaledVector(direction, value - startValue));
  } else {
    const worldRotation = new Quaternion(...fk[state.selected!].rotation), localAxis = axes[axis].clone().applyQuaternion(worldRotation);
    const others = axis === 'X' ? [axes.Y, axes.Z] : axis === 'Y' ? [axes.Z, axes.X] : [axes.X, axes.Y];
    const u = others[0].clone().applyQuaternion(worldRotation), v = others[1].clone().applyQuaternion(worldRotation);
    start = await hoverHandle(page, angle => view.point(center.clone().addScaledVector(u, Math.cos(angle) * scale * .5).addScaledVector(v, Math.sin(angle) * scale * .5)), '关节局部旋转', axis);
    const ray = new Raycaster();
    ray.setFromCamera(new Vector2((start.x - view.box.x) / view.box.width * 2 - 1, 1 - (start.y - view.box.y) / view.box.height * 2), view.camera);
    const normal = view.camera.getWorldDirection(new Vector3()), plane = new Plane().setFromNormalAndCoplanarPoint(normal, center);
    const hit = ray.ray.intersectPlane(plane, new Vector3())!;
    const tangent = localAxis.clone().cross(eye).normalize();
    const inPlane = tangent.clone().addScaledVector(normal, -tangent.dot(normal));
    const speed = 20 / view.camera.position.distanceTo(center), radians = (value - startValue) * Math.PI / 180;
    if (tangent.lengthSq() < 1e-12) {
      end = view.point(hit.sub(center).applyAxisAngle(eye, radians).add(center));
    } else end = view.point(hit.addScaledVector(inPlane, radians / speed / inPlane.dot(tangent)));
  }
  await page.mouse.move(start.x, start.y); await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 5 }); await page.mouse.up();
  // Actual semantic feedback, not the requested value, updates the geometry
  // model used to locate subsequent handles in the same unwritten draft.
  const actualRoot = await Promise.all(['X', 'Y', 'Z'].map(next => stageValue(page, `Root ${next} 位移（米）`))) as Vec3;
  state.pose.root = actualRoot;
  if (state.selected) state.pose.joints[state.selected] = rotationFromDegrees(await Promise.all(['X', 'Y', 'Z'].map(next => stageValue(page, `关节 ${next} 旋转（度）`))) as Vec3);
  cachedDrafts.set(page, { id: state.document.scene.id, take: state.document.scene.project.history[state.document.scene.project.historyIndex].take.id, time: state.document.scene.viewer.time, pose: state.pose });
  const name = prior === 'rotate' ? '旋转工具' : prior === 'translate' ? '移动角色工具' : prior === 'ik' ? '手脚 IK' : '选择工具';
  const button = page.getByRole('button', { name, exact: true });
  if (await button.isEnabled()) await button.click();
}
