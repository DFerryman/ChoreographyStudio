import { readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { HUMANOID_ASSET_URL } from '../apps/web/src/Humanoid';
import { diagnostics, openFixture } from './realismHelpers';

test('@quaternius-runtime-local actual selected native skin retains independent source arrays and posed points', async ({ page }, info) => {
  test.setTimeout(120_000);
  const report = diagnostics(page);
  await page.route('**/api/**', route => route.abort('blockedbyclient'));
  // Generated offline from the released glTF arrays and the declared fixed
  // calibration. It must never be recorded from updateHumanoid output.
  const reference = JSON.parse(readFileSync(new URL('./fixtures/quaternius-native-skin-reference.json', import.meta.url), 'utf8'));
  expect(reference.schema).toBe('quaternius-native-skin-reference-1');
  expect(reference.acceptance.sourcePointMaximumErrorMeters).toBe(.000002);
  await openFixture(page);
  await expect(page.getByRole('status').filter({ hasText: '人物模型载入中' })).toBeHidden();
  await expect(page.getByText('3D 预览暂时不可用', { exact: true })).toHaveCount(0);
  const result = await page.evaluate(async reference => {
    const url = '/src/Humanoid.ts';
    const source = await (await fetch(url)).text();
    const threeURL = source.match(/import\s*\*\s*as\s*THREE\s*from\s*["']([^"']+)["']/)?.[1];
    if (!threeURL) throw new Error('The selected humanoid Three import is missing.');
    const THREE = await import(threeURL), humanoid = await import(url);
    const rigSource = await (await fetch('/src/QuaterniusRig.ts')).text();
    const coreURL = rigSource.match(/import\s*\{[^}]*\bevaluatePose\b[^}]*\}\s*from\s*["']([^"']+)["']/)?.[1];
    if (!coreURL) throw new Error('The actual Quaternius core import is missing.');
    const core = await import(coreURL);
    const definitions = core.RIG_DEFINITIONS.map((definition: { name: string; parent: string | null; offset: number[] }) => [definition.name, definition.parent, [...definition.offset]]);
    if (JSON.stringify(definitions) !== JSON.stringify(reference.canonicalDefinitions)) throw new Error('The independent native skin reference uses different author calibration.');
    const root = new THREE.Group(), joints = new Map();
    for (const definition of core.RIG_DEFINITIONS) {
      const bone = new THREE.Bone();
      bone.name = definition.name; bone.position.fromArray(definition.offset); joints.set(definition.name, bone);
      (definition.parent ? joints.get(definition.parent) : root).add(bone);
    }
    root.updateMatrixWorld(true);
    const surface = await humanoid.loadHumanoid(joints, new AbortController().signal);
    root.add(surface);
    const attributeHash = async (name: string, componentType: 'float32' | 'uint32') => {
      const attribute = name === 'index' ? surface.geometry.index : surface.geometry.getAttribute(name);
      const values = Array.from({ length: attribute.count * attribute.itemSize }, (_, at) => attribute.getComponent(Math.floor(at / attribute.itemSize), at % attribute.itemSize));
      const array = componentType === 'float32' ? new Float32Array(values) : new Uint32Array(values);
      return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', array.buffer)), byte => byte.toString(16).padStart(2, '0')).join('');
    };
    const geometryHashes = Object.fromEntries(await Promise.all(Object.entries(reference.geometryHashes as Record<string, string>).map(async ([name]) => [name, await attributeHash(name, name === 'index' || name === 'skinIndex' ? 'uint32' : 'float32')])));
    const indices = Array.from(surface.geometry.index.array as ArrayLike<number>);
    const vertices = surface.geometry.getAttribute('position').count;
    const state = () => JSON.stringify(Array.from(joints, ([name, bone]) => [name, bone.position.toArray(), bone.quaternion.toArray()]));
    const posed = reference.poses.map((entry: { id: string; root: number[]; rotations: Record<string, number[]>; pointsMeters: number[][]; primaryPointsMeters: Record<string, number[]> }) => {
      for (const [name, bone] of joints) {
        bone.quaternion.setFromEuler(new THREE.Euler(...(entry.rotations[name] ?? [0, 0, 0]).map((value: number) => value * Math.PI / 180), 'XYZ'));
      }
      // Stage applies author Root to the actor group; Hips stays a rotation
      // channel. Exercise the same world translation without editing bones.
      root.position.fromArray(entry.root);
      root.updateMatrixWorld(true);
      const before = state();
      humanoid.updateHumanoid(surface); root.updateMatrixWorld(true); surface.skeleton.update();
      if (state() !== before) throw new Error('Selected avatar deformation modified author bones.');
      const points = Array.from({ length: vertices }, (_, vertex) => surface.getVertexPosition(vertex, new THREE.Vector3()).applyMatrix4(surface.matrixWorld).toArray() as number[]);
      const selectedPoints = reference.vertexIds.map((vertex: number) => points[vertex]);
      const sourcePointErrorsMeters = selectedPoints.map((point: number[], at: number) => Math.hypot(...point.map((value, axis) => value - entry.pointsMeters[at][axis])));
      const primaryPivotErrorsMeters = Object.fromEntries(Object.entries(entry.primaryPointsMeters).map(([name, expected]) => {
        const bone = surface.skeleton.bones.find((bone: { name: string }) => bone.name === name);
        if (!bone) throw new Error(`The selected native primary ${name} is missing.`);
        const point = bone.getWorldPosition(new THREE.Vector3()).toArray();
        return [name, Math.hypot(...point.map((value: number, axis: number) => value - expected[axis]))];
      }));
      let degenerateFaces = 0;
      for (let at = 0; at < indices.length; at += 3) {
        const a = new THREE.Vector3(...points[indices[at]]), b = new THREE.Vector3(...points[indices[at + 1]]), c = new THREE.Vector3(...points[indices[at + 2]]);
        if (b.sub(a).cross(c.sub(a)).length() < 1e-12) degenerateFaces++;
      }
      return { id: entry.id, finite: points.every(point => point.every(Number.isFinite)), sourcePointErrorsMeters, maximumSourcePointErrorMeters: Math.max(...sourcePointErrorsMeters), primaryPivotErrorsMeters, degenerateFaces };
    });
    try {
      return { asset: humanoid.HUMANOID_ASSET_URL, nativeBoneNames: surface.skeleton.bones.map((bone: { name: string }) => bone.name), canonicalJointCount: joints.size, vertices, triangles: indices.length / 3, geometryHashes, posed };
    } finally {
      humanoid.disposeHumanoid(surface); surface.geometry.dispose(); surface.skeleton.dispose();
      for (const material of Array.isArray(surface.material) ? surface.material : [surface.material]) material.dispose();
    }
  }, reference);
  const output = JSON.stringify(result, null, 2);
  await info.attach('quaternius-actual-runtime-shape.json', { body: output, contentType: 'application/json' });
  if (process.env.CHOREO_SCREENSHOT_DIR) {
    await mkdir(process.env.CHOREO_SCREENSHOT_DIR, { recursive: true });
    await writeFile(join(process.env.CHOREO_SCREENSHOT_DIR, 'quaternius-actual-runtime-shape.json'), output);
  }
  expect(result.asset).toBe(HUMANOID_ASSET_URL);
  expect(result.asset).toBe('/models/neutral-quaternius-v1.glb');
  expect(result.canonicalJointCount).toBe(25);
  expect(result.nativeBoneNames).toEqual(reference.nativeBoneNames);
  expect(result.nativeBoneNames).toHaveLength(65);
  expect(result.vertices).toBe(reference.vertexCount);
  expect(result.triangles).toBe(reference.triangleCount);
  expect(result.geometryHashes).toEqual(reference.geometryHashes);
  expect(result.posed).toHaveLength(reference.poses.length);
  for (const entry of result.posed) {
    expect(entry.finite, entry.id).toBe(true);
    expect(entry.degenerateFaces, entry.id).toBe(0);
    expect(entry.sourcePointErrorsMeters, entry.id).toHaveLength(reference.vertexIds.length);
    for (const error of entry.sourcePointErrorsMeters) expect(error, `${entry.id}: independent native source point`).toBeLessThanOrEqual(reference.acceptance.sourcePointMaximumErrorMeters);
    expect(Object.keys(entry.primaryPivotErrorsMeters), entry.id).toHaveLength(21);
    for (const [name, error] of Object.entries(entry.primaryPivotErrorsMeters)) expect(error, `${entry.id}: ${name} matches the independent author FK pivot`).toBeLessThanOrEqual(.000002);
  }
  expect(report).toEqual({ errors: [], warnings: [], expectedHttpErrors: [], apiRequests: [] });
  await info.attach('quaternius-native-runtime-diagnostics.json', { body: JSON.stringify(report), contentType: 'application/json' });
});
