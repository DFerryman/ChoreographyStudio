import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { Matrix4, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { AVATAR_COLLISION_PROFILE as profile } from '../../../packages/core/src/avatarCapsules.generated';
import { STANDARD_HUMAN_PROFILE } from '../../../packages/core/src/humanProfile';

const modelBytes = readFileSync(new URL('../public/models/neutral-quaternius-v1.glb', import.meta.url));
const rigBytes = readFileSync(new URL('../public/models/neutral-quaternius-v1.json', import.meta.url));
const rig = JSON.parse(rigBytes.toString());
const jsonLength = modelBytes.readUInt32LE(12);
const gltf = JSON.parse(modelBytes.subarray(20, 20 + jsonLength).toString());
const binary = modelBytes.subarray(28 + jsonLength);
function accessor(index: number): number[][] {
  const spec = gltf.accessors[index], view = gltf.bufferViews[spec.bufferView];
  const width = spec.type === 'VEC3' ? 3 : 4, componentSize = spec.componentType === 5126 ? 4 : spec.componentType === 5123 ? 2 : 1;
  const offset = (view.byteOffset ?? 0) + (spec.byteOffset ?? 0), stride = view.byteStride ?? width * componentSize;
  return Array.from({ length: spec.count }, (_, at) => Array.from({ length: width }, (_, component) => {
    const position = offset + at * stride + component * componentSize;
    return spec.componentType === 5126 ? binary.readFloatLE(position) : spec.componentType === 5123 ? binary.readUInt16LE(position) : binary.readUInt8(position);
  }));
}
function region(native: string): string {
  if (native === 'root' || native === 'pelvis') return 'pelvis';
  if (native === 'spine_01') return 'abdomen';
  if (['spine_02', 'spine_03', 'clavicle_l', 'clavicle_r'].includes(native)) return 'thorax';
  if (native === 'neck_01') return 'neck';
  if (native === 'Head') return 'head';
  const side = native.endsWith('_l') ? 'Left' : 'Right';
  for (const [prefix, part] of [['upperarm', 'upper-arm'], ['lowerarm', 'forearm'], ['thigh', 'thigh'], ['calf', 'shank'], ['foot', 'foot'], ['ball', 'foot']]) {
    if (native.startsWith(prefix)) return `${side}-${part}`;
  }
  return `${side}-hand`;
}

describe('source-bound avatar collision geometry', () => {
  it('matches the shipped source bytes and preserves immutable collision and sole geometry', () => {
    expect(profile.sourceGlbSha256).toBe(createHash('sha256').update(modelBytes).digest('hex'));
    expect(profile.sourceRigSha256).toBe(createHash('sha256').update(rigBytes).digest('hex'));
    expect(profile.canonicalRig).toBe('neutral-rig-2');
    expect(profile.colliders).toHaveLength(17);
    expect(Object.isFrozen(profile)).toBe(true);
    for (const shape of profile.colliders) {
      expect(shape.shape).toBe('convex');
      expect(Object.isFrozen(shape)).toBe(true);
      if (shape.shape === 'convex') {
        expect(Object.isFrozen(shape.vertices)).toBe(true);
        expect(Object.isFrozen(shape.indices)).toBe(true);
        expect(shape.vertices.every(point => Object.isFrozen(point))).toBe(true);
      }
    }
    expect(profile.footGround).toEqual({
      halfWidthMeters: STANDARD_HUMAN_PROFILE.foot.halfWidthMeters,
      soleOffsetMeters: STANDARD_HUMAN_PROFILE.foot.soleOffsetMeters,
      heelZ: STANDARD_HUMAN_PROFILE.foot.heelZ, toeZ: STANDARD_HUMAN_PROFILE.foot.toeZ,
      topOffsetMeters: -.004,
    });
    expect(STANDARD_HUMAN_PROFILE.ground.penetrationToleranceMeters).toBe(.003);
  });

  it('encloses every neutral displayed source vertex in its anatomical hull within 10 nanometres', () => {
    const attributes = gltf.meshes[0].primitives[0].attributes;
    const positions = accessor(attributes.POSITION), slots = accessor(attributes.JOINTS_0), weights = accessor(attributes.WEIGHTS_0);
    const matrices = rig.runtimeCalibration.neutralWorldFrames.map((frame: number[], at: number) => new Matrix4().fromArray(frame)
      .multiply(new Matrix4().fromArray(rig.runtimeCalibration.skinBindAdjustments[at]))
      .multiply(new Matrix4().fromArray(rig.sourceInverseBindWorld[at])));
    const names: string[] = rig.nativeJointNames;
    const planes = new Map(profile.colliders.map(shape => {
      if (shape.shape !== 'convex') throw new Error('The selected avatar must use the verified convex surface profile.');
      const pivot = new Vector3().setFromMatrixPosition(new Matrix4().fromArray(rig.runtimeCalibration.neutralWorldFrames[names.indexOf(Object.entries(rig.runtimeCalibration.primaryJointMapping).find(([, name]) => name === shape.proximal)![0])]));
      const vertices = shape.vertices.map(point => new Vector3(...point).add(pivot));
      const result = [];
      for (let at = 0; at < shape.indices.length; at += 3) {
        const a = vertices[shape.indices[at]], b = vertices[shape.indices[at + 1]], c = vertices[shape.indices[at + 2]];
        const normal = b.clone().sub(a).cross(c.clone().sub(a)).normalize();
        result.push({ normal, offset: normal.dot(a) });
      }
      return [shape.anatomicalRegion, result] as const;
    }));
    let maximumOutside = 0, minimumFootY = Infinity;
    for (let at = 0; at < positions.length; at++) {
      const skin = new Vector3(), scores = new Map<string, number>();
      for (let slot = 0; slot < 4; slot++) {
        const bone = slots[at][slot], weight = weights[at][slot];
        skin.addScaledVector(new Vector3(...positions[at] as [number, number, number]).applyMatrix4(matrices[bone]), weight);
        const id = region(names[bone]);
        scores.set(id, (scores.get(id) ?? 0) + weight);
      }
      const dominant = [...scores].sort((a, b) => b[1] - a[1])[0][0];
      for (const plane of planes.get(dominant)!) maximumOutside = Math.max(maximumOutside, plane.normal.dot(skin) - plane.offset);
      if (dominant.endsWith('-foot')) minimumFootY = Math.min(minimumFootY, skin.y + 1.05);
    }
    expect(positions).toHaveLength(8483);
    expect(maximumOutside).toBeLessThanOrEqual(1e-8);
    // Actual neutral skin stands above the floor; the broader hull corners do
    // not replace the existing calibrated sole-contact contract.
    expect(minimumFootY).toBeGreaterThan(.006);
  });
});
