import { readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { Euler, Quaternion } from 'three';
import { sampleTake, type JointName } from '../packages/core/src';
import { HUMANOID_ASSET_URL } from '../apps/web/src/Humanoid';
import { clickRevealed } from './helpers';
import { backup, current, diagnostics, draft, numeric, openFixture, save, screenshot, select } from './realismHelpers';
import { expectStageValue, readStagePose } from './stageInteractions';

type Rotations = Partial<Record<JointName, [number, number, number]>>;
const radians = (degrees: number) => degrees * Math.PI / 180;
const rotation = (degrees: [number, number, number]) => new Quaternion().setFromEuler(new Euler(...degrees.map(radians) as [number, number, number], 'XYZ')).toArray();
const camera = { position: [.6, 1.58, 2.4], target: [0, 1.58, 0], zoom: 1.35 };
const loading = (page: Page) => page.getByRole('status').filter({ hasText: '人物模型载入中' });
const sourceReference = JSON.parse(readFileSync(new URL('./fixtures/mhr-native-chest-reference.json', import.meta.url), 'utf8')) as {
  chestVertexIds: number[];
  canonicalCalibration: { authorDefinitions: [string, string | null, number[]][] };
  acceptance: { referenceMotionVectorErrorMaximumMeters: number };
  poses: Record<'neutral' | 'raised150' | 'raised170', {
    authorRotationsDegrees: Rotations;
    officialCalibratedChestPointsMeters: number[][];
    officialCalibratedChestMotionVectorsMeters?: number[][];
    officialSourceChestMotionP95Meters?: number;
  }>;
};

// The same poses also drive the larger private desktop/mobile review matrix.
// Explicit saved author poses may exceed edit guidance (170°, axial forearm
// twist), and must never be silently clamped for the avatar's convenience.
export const NATURAL_REVIEW_POSES: { id: string; rotations: Rotations; fullBody?: boolean }[] = [
  { id: 'neutral', rotations: {} },
  { id: 'raise150-no-clavicle', rotations: { LeftUpperArm: [0, 0, 150] } },
  { id: 'raise170-no-clavicle', rotations: { LeftUpperArm: [0, 0, 170] } },
  { id: 'raise150-clavicle20', rotations: { LeftUpperArm: [0, 0, 130], LeftShoulder: [0, 0, 20] } },
  { id: 'raise150-chest30', rotations: { LeftUpperArm: [0, 0, 130], LeftShoulder: [0, 0, 20], Chest: [0, 30, 0] } },
  { id: 'raise120-axial60-elbow100', rotations: { LeftUpperArm: [0, 60, 120], LeftForeArm: [-100, 0, 0] } },
  { id: 'both-raised150', rotations: { LeftUpperArm: [0, 0, 150], RightUpperArm: [0, 0, -150] } },
  { id: 'forearm-twist60', rotations: { LeftUpperArm: [-60, 0, 50], LeftForeArm: [-70, 60, 0] } },
  { id: 'wrists-flex45-side25', rotations: { LeftUpperArm: [-40, 0, 70], RightUpperArm: [-40, 0, -70], LeftHand: [45, 0, 0], RightHand: [0, 0, 25] } },
  { id: 'hip-side45', rotations: { LeftUpperLeg: [0, 0, 45] }, fullBody: true },
  { id: 'deep-crouch-knee110', rotations: { LeftUpperLeg: [-50, 0, 0], RightUpperLeg: [-50, 0, 0], LeftLowerLeg: [110, 0, 0], RightLowerLeg: [110, 0, 0], LeftFoot: [-40, 0, 0], RightFoot: [-40, 0, 0], Spine: [15, 0, 0] }, fullBody: true },
  { id: 'ankles-flex25-side20', rotations: { LeftFoot: [25, 0, 0], RightFoot: [0, 0, 20] }, fullBody: true },
  { id: 'neck20-turn30-spine35-turn25', rotations: { Neck: [-20, 30, 0], Spine: [35, 25, 0] } },
  { id: 'bilateral-shoulders-elbows-wrists-hips-knees-ankles', rotations: {
    LeftUpperArm: [0, 0, 120], RightUpperArm: [0, 0, -120], LeftForeArm: [-110, 0, 0], RightForeArm: [-100, 0, 0],
    LeftHand: [45, 0, 0], RightHand: [-40, 0, 0], LeftUpperLeg: [-30, 20, 20], RightUpperLeg: [-40, -20, -20],
    LeftLowerLeg: [110, 0, 0], RightLowerLeg: [100, 0, 0], LeftFoot: [15, 0, 10], RightFoot: [20, 0, -15],
  }, fullBody: true },
];

test.beforeEach(async ({ page }) => {
  // No fixture or skin verification is permitted to consume Workers AI or use
  // an API fallback. Static avatar/metadata/correctives use their real URLs.
  await page.route('**/api/**', route => route.abort('blockedbyclient'));
});

async function openPose(page: Page, name: string, rotations: Rotations, fullBody = false) {
  const source = await openFixture(page, false, source => {
    source.scene.name = `自然人体 ${name}`;
    source.scene.viewer.camera = (fullBody ? { position: [.8, 1.12, 4], target: [0, 1.12, 0], zoom: 1.25 } : camera) as never;
    for (const pose of source.take.poses) for (const [joint, degrees] of Object.entries(rotations)) pose.joints[joint as JointName] = rotation(degrees);
  });
  await expect(loading(page)).toBeHidden();
  await expect(page.getByText('3D 预览暂时不可用', { exact: true }), 'A fallback drawing is not a loaded humanoid').toHaveCount(0);
  await expect(page.locator('.stage3d-selection-announcement'), 'The loaded skin must leave the actual stage interactive').toHaveCount(1);
  expect(current(await backup(page)).take).toEqual(source.take);
  return source;
}

async function captureCanvas(page: Page, info: TestInfo, name: string) {
  await expect(page.getByText('3D 预览暂时不可用', { exact: true }), 'Only a live humanoid may be accepted in a skin screenshot').toHaveCount(0);
  await expect(page.locator('.stage3d-selection-announcement')).toHaveCount(1);
  const canvas = page.getByRole('img', { name: '人体编舞动作预览' });
  await canvas.scrollIntoViewIfNeeded(); await page.mouse.move(1, 1);
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  const body = await canvas.screenshot();
  await info.attach(name, { body, contentType: 'image/png' });
  if (process.env.CHOREO_SCREENSHOT_DIR) {
    await mkdir(process.env.CHOREO_SCREENSHOT_DIR, { recursive: true });
    await writeFile(join(process.env.CHOREO_SCREENSHOT_DIR, name), body);
  }
}

for (const angle of [150, 170]) {
  test(`@model-natural shoulder ${angle} with unrotated clavicle and chest retains the exact author pose in desktop and mobile skin`, async ({ page }, info) => {
    const report = diagnostics(page), assets: string[] = [];
    page.on('response', response => { if (new URL(response.url()).pathname === HUMANOID_ASSET_URL && response.ok()) assets.push(HUMANOID_ASSET_URL); });
    const source = await openPose(page, `肩 ${angle}`, { LeftUpperArm: [0, 0, angle] });
    expect(assets.length).toBeGreaterThan(0);
    await captureCanvas(page, info, `natural-shoulder${angle}-desktop.png`);
    await screenshot(page, info, `natural-shoulder${angle}-workbench.png`);
    await page.setViewportSize({ width: 390, height: 844 });
    await clickRevealed(page, page.getByRole('button', { name: '全身取景', exact: true }));
    await captureCanvas(page, info, `natural-shoulder${angle}-mobile390.png`);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    expect((await backup(page)).scene.project).toEqual(source.scene.project);
    expect(report).toEqual({ errors: [], warnings: [], expectedHttpErrors: [], apiRequests: [] });
    await info.attach(`natural-shoulder${angle}-diagnostics.json`, { body: Buffer.from(JSON.stringify(report)), contentType: 'application/json' });
  });
}

test('@model-natural bilateral major joints and neck/spine deformations retain the loaded author pose', async ({ page }, info) => {
  const report = diagnostics(page);
  for (const entry of NATURAL_REVIEW_POSES.slice(-2)) {
    await page.setViewportSize({ width: 1440, height: 1000 });
    const source = await openPose(page, entry.id, entry.rotations, entry.fullBody);
    await captureCanvas(page, info, `natural-${entry.id}-desktop.png`);
    await page.setViewportSize({ width: 390, height: 844 });
    await clickRevealed(page, page.getByRole('button', { name: '全身取景', exact: true }));
    await captureCanvas(page, info, `natural-${entry.id}-mobile390.png`);
    expect((await backup(page)).scene.project).toEqual(source.scene.project);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  }
  expect(report).toEqual({ errors: [], warnings: [], expectedHttpErrors: [], apiRequests: [] });
  await info.attach('natural-major-joints-diagnostics.json', { body: Buffer.from(JSON.stringify(report)), contentType: 'application/json' });
});

test('@model-natural real arm/neck/spine ring drafts, explicit K and interpolated playback use the same natural skin', async ({ page }, info) => {
  const report = diagnostics(page);
  const source = await openPose(page, '实际舞台操作', {});
  await select(page, 'LeftUpperArm'); await numeric(page, '关节 Z 旋转（度）', 150);
  await expectStageValue(page, '关节 Z 旋转（度）', 150);
  await expect(draft(page)).toBeVisible();
  const actual = (await readStagePose(page)).pose;
  expect((await backup(page)).scene.project).toEqual(source.scene.project);
  await captureCanvas(page, info, 'natural-real-arm150-draft.png');
  await page.getByRole('button', { name: 'K 完整姿态', exact: true }).click();
  await expect(draft(page)).toBeHidden();
  const keyed = await backup(page);
  actual.joints.LeftUpperArm.forEach((component, index) => expect(current(keyed).take.poses[0].joints.LeftUpperArm[index]).toBeCloseTo(component, 12));
  await captureCanvas(page, info, 'natural-real-arm150-key.png');
  await numeric(page, '当前帧', 60); await numeric(page, '关节 Z 旋转（度）', 0);
  await page.getByRole('button', { name: 'K 完整姿态', exact: true }).click();
  await numeric(page, '当前帧', 30);
  const interpolated = await backup(page), expected = new Quaternion(...actual.joints.LeftUpperArm).slerp(new Quaternion(), .5);
  expect(Math.abs(expected.dot(new Quaternion(...sampleTake(current(interpolated).take, 1).joints.LeftUpperArm)))).toBeCloseTo(1, 10);
  await captureCanvas(page, info, 'natural-interpolated-arm75.png');
  await page.getByRole('button', { name: '播放', exact: true }).click();
  await expect.poll(async () => Number(await page.getByRole('slider', { name: '关键帧时间线进度', exact: true }).inputValue())).toBeGreaterThan(30);
  await page.getByRole('button', { name: '暂停', exact: true }).click();
  await captureCanvas(page, info, 'natural-interpolated-playback.png');
  expect((await backup(page)).scene.project).toEqual(interpolated.scene.project);
  await select(page, 'Neck'); await numeric(page, '关节 X 旋转（度）', -20); await numeric(page, '关节 Y 旋转（度）', 30);
  await expectStageValue(page, '关节 X 旋转（度）', -20); await expectStageValue(page, '关节 Y 旋转（度）', 30);
  await select(page, 'Spine'); await numeric(page, '关节 X 旋转（度）', 35); await numeric(page, '关节 Y 旋转（度）', 25);
  await expectStageValue(page, '关节 X 旋转（度）', 35); await expectStageValue(page, '关节 Y 旋转（度）', 25);
  await expect(draft(page)).toBeVisible();
  await captureCanvas(page, info, 'natural-real-neck-spine-draft.png');
  const spineDraft = (await readStagePose(page)).pose;
  await page.getByRole('button', { name: 'K 完整姿态', exact: true }).click();
  const torsoKey = await backup(page), time = torsoKey.scene.viewer.time;
  for (const joint of ['Neck', 'Spine'] as const) spineDraft.joints[joint].forEach((component, index) => expect(sampleTake(current(torsoKey).take, time).joints[joint][index]).toBeCloseTo(component, 12));
  await save(page); const saved = await backup(page);
  await page.reload(); await expect(loading(page)).toBeHidden();
  expect((await backup(page)).scene.project).toEqual(saved.scene.project);
  await page.setViewportSize({ width: 390, height: 844 });
  await clickRevealed(page, page.getByRole('button', { name: '全身取景', exact: true }));
  await captureCanvas(page, info, 'natural-real-neck-spine-reopened-mobile390.png');
  expect(report).toEqual({ errors: [], warnings: [], expectedHttpErrors: [], apiRequests: [] });
  await info.attach('natural-stage-workflow-diagnostics.json', { body: Buffer.from(JSON.stringify(report)), contentType: 'application/json' });
});

// Vite module imports make this a local/CI runtime regression. Public browser
// release checks select @model-natural and must not select this local-only tag.
test('@mhr-historical-local archived MHR source keeps its original 127-bone and corrective shape contract', async ({ page }, info) => {
  test.setTimeout(120_000);
  const report = diagnostics(page);
  await openPose(page, '实际形变计算', {});
  const result = await page.evaluate(async ({ poses, reference }) => {
    const humanoidURL = '/src/Humanoid.ts';
    const text = await (await fetch(humanoidURL)).text();
    const threeURL = text.match(/import\s*\*\s*as\s*THREE\s*from\s*["']([^"']+)["']/)?.[1];
    if (!threeURL) throw new Error('The actual Humanoid Three import is missing.');
    const THREE = await import(threeURL);
    const humanoid = await import(humanoidURL);
    const rigText = await (await fetch('/src/MHRRig.ts')).text();
    // Resolve the actual Vite-transformed import, including the checkout path
    // chosen by GitHub Actions. No /workspace path is part of this regression.
    const coreURL = rigText.match(/import\s*\{[^}]*\bevaluatePose\b[^}]*\}\s*from\s*["']([^"']+)["']/)?.[1];
    if (!coreURL) throw new Error('The actual MHR rig core import is missing.');
    const core = await import(coreURL);
    const definitions = core.RIG_DEFINITIONS.map((definition: { name: string; parent: string | null; offset: number[] }) => [definition.name, definition.parent, [...definition.offset]]);
    if (JSON.stringify(definitions) !== JSON.stringify(reference.canonicalCalibration.authorDefinitions)) throw new Error('The fixed native source reference uses a different author calibration.');
    const root = new THREE.Group(), joints = new Map();
    for (const definition of core.RIG_DEFINITIONS) {
      const bone = new THREE.Bone(); bone.name = definition.name; bone.position.fromArray(definition.offset); joints.set(definition.name, bone);
      (definition.parent ? joints.get(definition.parent) : root).add(bone);
    }
    root.updateMatrixWorld(true);
    // This is deliberately independent of the editor's selected display
    // model. Keep the original MHR source parity and all its thresholds.
    const surface = await humanoid.loadMHRHumanoid(joints, new AbortController().signal);
    root.add(surface);
    const indices = Array.from(surface.geometry.index.array as ArrayLike<number>);
    const vertices = surface.geometry.getAttribute('position').count;
    const positions = () => Array.from({ length: vertices }, (_, vertex) => surface.getVertexPosition(vertex, new THREE.Vector3()).applyMatrix4(surface.matrixWorld).toArray() as number[]);
    const state = () => JSON.stringify(Array.from(joints, ([name, bone]) => [name, bone.position.toArray(), bone.quaternion.toArray()]));
    const assign = (degrees: Record<string, number[]>) => {
      for (const [name, bone] of joints) {
        const xyz = (degrees[name] ?? [0, 0, 0]).map((value: number) => value * Math.PI / 180);
        bone.quaternion.setFromEuler(new THREE.Euler(...xyz, 'XYZ'));
      }
      root.updateMatrixWorld(true); const before = state();
      humanoid.updateHumanoid(surface); root.updateMatrixWorld(true); surface.skeleton.update();
      if (state() !== before) throw new Error('Avatar deformation modified author bones.');
      return positions();
    };
    try {
      const rest = assign({});
      const heightMeters = Math.max(...rest.map(point => point[1])) - Math.min(...rest.map(point => point[1]));
      const neutralFeet = ['Left', 'Right'].map(side => {
        const owner = `${side}Foot`, skinIndices = surface.geometry.getAttribute('skinIndex'), skinWeights = surface.geometry.getAttribute('skinWeight');
        const points = rest.filter((_point, vertex) => {
          let total = 0;
          for (let influence = 0; influence < 4; influence++) {
            const native = surface.skeleton.bones[skinIndices.getComponent(vertex, influence)];
            if ([owner, `${side}Toe`, `${side}Heel`].includes(native.userData.editorJoint)) total += skinWeights.getComponent(vertex, influence);
          }
          return total > .7;
        });
        const joint = joints.get(owner).getWorldPosition(new THREE.Vector3());
        const local = points.map(point => new THREE.Vector3(...point).sub(joint).toArray() as number[]);
        return { side, vertices: points.length, soleY: Math.min(...local.map(point => point[1])), minX: Math.min(...local.map(point => point[0])), maxX: Math.max(...local.map(point => point[0])), heelZ: Math.min(...local.map(point => point[2])), toeZ: Math.max(...local.map(point => point[2])) };
      });
      const area = (points: number[][], face: number[]) => {
        const [a, b, c] = face.map(index => new THREE.Vector3(...points[index])); return b.sub(a).cross(c.sub(a)).length();
      };
      const faces = Array.from({ length: indices.length / 3 }, (_, i) => indices.slice(i * 3, i * 3 + 3));
      const baseArea = faces.map(face => area(rest, face));
      const shoulder = faces.map(face => face.map(index => rest[index]).reduce((sum, point) => sum.map((value, axis) => value + point[axis] / 3), [0, 0, 0])).map(point => point[0] > .17 && point[0] < .285 && point[1] > .37 && point[1] < .50);
      const chest = rest.map(point => point[0] > .055 && point[0] < .155 && point[1] > .25 && point[1] < .405 && point[2] > .04);
      const measuredChestIds = chest.flatMap((selected, vertex) => selected ? [vertex] : []);
      if (JSON.stringify(measuredChestIds) !== JSON.stringify(reference.chestVertexIds)) throw new Error('The fixed chest reference vertex coverage changed.');
      const neutralSourcePointMaximumErrorMeters = Math.max(...reference.chestVertexIds.map((vertex, index) => Math.hypot(...rest[vertex].map((value, axis) => value - reference.poses.neutral.officialCalibratedChestPointsMeters[index][axis]))));
      const shoulderFaces = shoulder.filter(Boolean).length, chestVertices = chest.filter(Boolean).length;
      const evaluated = poses.map(pose => {
        const points = assign(pose.rotations as Record<string, number[]>);
        const finite = points.every(point => point.every(Number.isFinite));
        const actualArea = faces.map(face => area(points, face));
        const collapsedShoulderFaces = actualArea.filter((value, index) => shoulder[index] && value < baseArea[index] * .1).length;
        const collapsedShoulderFaceDetails = faces.flatMap((face, index) => shoulder[index] && actualArea[index] < baseArea[index] * .1 ? [{
          index, vertices: face, areaRatio: actualArea[index] / baseArea[index], restAreaSquareMeters: baseArea[index] / 2,
          restPoints: face.map(vertex => rest[vertex]), posedPoints: face.map(vertex => points[vertex]),
        }] : []);
        const chestMotion = points.map((point, index) => chest[index] ? Math.hypot(...point.map((value, axis) => value - rest[index][axis])) : null).filter((value): value is number => value !== null).sort((a, b) => a - b);
        const nativeReference = pose.id === 'raise150-no-clavicle' ? reference.poses.raised150 : pose.id === 'raise170-no-clavicle' ? reference.poses.raised170 : null;
        const sourceMotionVectorErrorsMeters = nativeReference ? reference.chestVertexIds.map((vertex, index) => Math.hypot(...points[vertex].map((value, axis) => value - rest[vertex][axis] - nativeReference.officialCalibratedChestMotionVectorsMeters![index][axis]))) : [];
        return { id: pose.id, finite, degenerateFaces: actualArea.filter(value => value < 1e-12).length, shoulderFaces, collapsedShoulderFaces, collapsedShoulderFraction: collapsedShoulderFaces / shoulderFaces, collapsedShoulderFaceDetails, chestVertices, chestMotionP95Meters: chestMotion[Math.floor((chestMotion.length - 1) * .95)], sourceMotionVectorErrorsMeters, sourceMotionVectorMaximumErrorMeters: sourceMotionVectorErrorsMeters.length ? Math.max(...sourceMotionVectorErrorsMeters) : null, officialNativeSourceChestMotionP95Meters: nativeReference?.officialSourceChestMotionP95Meters ?? null };
      });
      return { asset: '/models/neutral-mhr-v1.glb', canonicalJointCount: joints.size, nativeBoneCount: surface.skeleton.bones.length, vertices, triangles: faces.length, heightMeters, profile: { heightMeters: core.STANDARD_HUMAN_PROFILE.heightMeters, foot: core.STANDARD_HUMAN_PROFILE.foot }, neutralFeet, neutralSourcePointMaximumErrorMeters, evaluated };
    } finally {
      humanoid.disposeHumanoid(surface); surface.geometry.dispose(); surface.skeleton.dispose();
      for (const material of Array.isArray(surface.material) ? surface.material : [surface.material]) material.dispose();
    }
  }, { poses: NATURAL_REVIEW_POSES, reference: sourceReference });
  await info.attach('natural-actual-runtime-shape.json', { body: Buffer.from(JSON.stringify(result, null, 2)), contentType: 'application/json' });
  if (process.env.CHOREO_SCREENSHOT_DIR) {
    await mkdir(process.env.CHOREO_SCREENSHOT_DIR, { recursive: true });
    await writeFile(join(process.env.CHOREO_SCREENSHOT_DIR, 'natural-actual-runtime-shape.json'), JSON.stringify(result, null, 2));
  }
  expect(result.asset).toBe('/models/neutral-mhr-v1.glb');
  expect(result.canonicalJointCount).toBe(25);
  expect(result.nativeBoneCount).toBe(127);
  expect(result.vertices).toBeGreaterThan(4000);
  expect(result.neutralSourcePointMaximumErrorMeters).toBeLessThanOrEqual(sourceReference.acceptance.referenceMotionVectorErrorMaximumMeters);
  expect(Math.abs(result.heightMeters - result.profile.heightMeters)).toBeLessThan(.002);
  for (const foot of result.neutralFeet) {
    expect(foot.vertices, `${foot.side}: actual weighted foot surface`).toBeGreaterThan(30);
    expect(Math.abs(foot.soleY + result.profile.foot.soleOffsetMeters), `${foot.side}: visible sole and contact anchor`).toBeLessThan(.002);
    expect(foot.minX).toBeGreaterThan(-result.profile.foot.halfWidthMeters - .002);
    expect(foot.maxX).toBeLessThan(result.profile.foot.halfWidthMeters + .002);
    expect(Math.abs(foot.heelZ - result.profile.foot.heelZ), `${foot.side}: actual visible heel`).toBeLessThan(.002);
    expect(Math.abs(foot.toeZ - result.profile.foot.toeZ), `${foot.side}: actual visible toe`).toBeLessThan(.002);
  }
  for (const pose of result.evaluated) {
    expect(pose.finite, pose.id).toBe(true);
    expect(pose.degenerateFaces, pose.id).toBe(0);
  }
  for (const id of ['raise150-no-clavicle', 'raise170-no-clavicle']) {
    const pose = result.evaluated.find(pose => pose.id === id)!;
    expect(pose.shoulderFaces, id).toBeGreaterThan(30);
    expect(pose.chestVertices, id).toBeGreaterThan(10);
    expect(pose.collapsedShoulderFraction, `${id}: shoulder triangles must retain their 3D area`).toBeLessThan(.03);
    // The former absolute 25 mm line incorrectly rejected the upstream human's
    // own published pose-corrective deformation at 170° (25.5356 mm).
    // Compare the SAME original vertices against independently evaluated,
    // equally calibrated native motion.
    expect(pose.sourceMotionVectorErrorsMeters, id).toHaveLength(sourceReference.chestVertexIds.length);
    for (const error of pose.sourceMotionVectorErrorsMeters) expect(error, `${id}: native source chest motion vector parity`).toBeLessThanOrEqual(sourceReference.acceptance.referenceMotionVectorErrorMaximumMeters);
  }
  expect(report).toEqual({ errors: [], warnings: [], expectedHttpErrors: [], apiRequests: [] });
});
