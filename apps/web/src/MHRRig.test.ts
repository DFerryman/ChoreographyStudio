import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { clone } from 'three/addons/utils/SkeletonUtils.js';
import { evaluatePose, JOINT_NAMES, RIG_DEFINITIONS, type JointName, type Pose } from '../../../packages/core/src';
import { MHRPoseCorrectives } from './MHRCorrectives';
import { createMHRRigController, validateMHRRigDescription, type MHRRigDescription } from './MHRRig';

const model = (name: string) => new URL(`../public/models/${name}`, import.meta.url);
const bytes = (name: string): ArrayBuffer => {
  const buffer = readFileSync(model(name));
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;
};
const description = JSON.parse(readFileSync(model('neutral-mhr-v1.json'), 'utf8')) as MHRRigDescription;
let source: GLTF;
beforeAll(async () => { source = await new GLTFLoader().parseAsync(bytes('neutral-mhr-v1.glb'), ''); });

function fixture() {
  const scene = clone(source.scene);
  scene.updateMatrixWorld(true);
  let mesh!: THREE.SkinnedMesh;
  scene.traverse(object => { if (object instanceof THREE.SkinnedMesh) mesh = object; });
  mesh.geometry = mesh.geometry.clone();
  const nativeRoot = mesh.skeleton.bones.find(bone => !(bone.parent instanceof THREE.Bone))!;
  mesh.add(nativeRoot);
  mesh.bindMatrix.identity(); mesh.bindMatrixInverse.identity();
  const actor = new THREE.Group(); actor.add(mesh);
  const joints = new Map<JointName, THREE.Bone>();
  for (const definition of RIG_DEFINITIONS) {
    const bone = new THREE.Bone(); bone.name = definition.name; bone.position.set(...definition.offset);
    (definition.parent ? joints.get(definition.parent)! : actor).add(bone); joints.set(definition.name, bone);
  }
  const decoder = new MHRPoseCorrectives(bytes('neutral-mhr-correctives-v1.bin'));
  const controller = createMHRRigController(mesh, joints, decoder, description);
  const assign = (rotations: Partial<Record<JointName, readonly number[]>>) => {
    for (const name of JOINT_NAMES) {
      const value = rotations[name] ?? [0, 0, 0];
      joints.get(name)!.quaternion.setFromEuler(new THREE.Euler(value[0] * Math.PI / 180, value[1] * Math.PI / 180, value[2] * Math.PI / 180, 'XYZ'));
    }
    actor.updateMatrixWorld(true); controller.update();
  };
  const surface = () => Array.from({ length: 4899 }, (_, vertex) => mesh.getVertexPosition(vertex, new THREE.Vector3()).toArray()).flat();
  const dispose = () => { controller.dispose(); mesh.geometry.dispose(); mesh.skeleton.dispose(); };
  return { actor, mesh, joints, decoder, controller, assign, surface, dispose };
}
const maximumDifference = (a: number[], b: number[]) => Math.max(...a.map((value, index) => Math.abs(value - b[index])));

describe('native MHR display adapter', () => {
  it('rejects incomplete mappings, changed source axes and invalid fixed affine data', () => {
    expect(() => validateMHRRigDescription(description)).not.toThrow();
    const cases: MHRRigDescription[] = [];
    const missing = structuredClone(description); missing.primaryJointMapping = {}; cases.push(missing);
    const duplicate = structuredClone(description); duplicate.primaryJointMapping = { ...duplicate.primaryJointMapping, l_uparm: 'LeftShoulder' }; cases.push(duplicate);
    const changedAxis = structuredClone(description);
    changedAxis.sourcePreRotations = changedAxis.sourcePreRotations.map((q, i) => i === 75 ? new THREE.Quaternion(...q as [number, number, number, number]).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), .02)).toArray() : q);
    cases.push(changedAxis);
    const changedOffset = structuredClone(description); changedOffset.sourceOffsetsMeters = changedOffset.sourceOffsetsMeters.map((v, i) => i === 75 ? [v[0] + .01, v[1], v[2]] : v); cases.push(changedOffset);
    const singular = structuredClone(description); singular.skinBindAdjustments = singular.skinBindAdjustments.map((v, i) => i === 75 ? Array(16).fill(0) : v); cases.push(singular);
    for (const value of cases) expect(() => validateMHRRigDescription(value)).toThrow();
  });

  it('preserves all author channels and exactly follows every primary world frame across compound poses', () => {
    const f = fixture();
    const poses: Partial<Record<JointName, number[]>>[] = [
      {}, { LeftUpperArm: [0, 0, 150] }, { LeftUpperArm: [0, 0, 170] },
      { Hips: [5, 20, 10], Spine: [20, -30, 5], Chest: [-10, 15, 10], Neck: [15, 25, -10], Head: [-15, 20, 5], LeftShoulder: [0, 10, 20], LeftUpperArm: [-35, 60, 120], LeftForeArm: [-100, 25, 5], LeftHand: [25, 65, 15], RightUpperArm: [-65, 30, -45], RightForeArm: [-75, -25, 5], RightHand: [-25, -40, -15], LeftUpperLeg: [-45, 25, 30], LeftLowerLeg: [105, 5, 0], LeftFoot: [-35, 20, 15], RightUpperLeg: [-55, -20, -25], RightLowerLeg: [95, -5, 0], RightFoot: [-30, -15, -10] },
    ];
    for (const rotations of poses) {
      f.assign(rotations);
      const saved = JOINT_NAMES.map(name => f.joints.get(name)!.quaternion.toArray());
      const pose: Pose = { root: [0, 0, 0], joints: Object.fromEntries(JOINT_NAMES.map((name, i) => [name, saved[i]])) as Pose['joints'] };
      const evaluated = evaluatePose(pose);
      for (const [native, author] of Object.entries(description.primaryJointMapping)) {
        const index = description.nativeJointNames.indexOf(native), joint = evaluated[author];
        const expected = new THREE.Matrix4().compose(new THREE.Vector3(...joint.position), new THREE.Quaternion(...joint.rotation).multiply(new THREE.Quaternion(...description.neutralWorldRotations[index] as [number, number, number, number])), new THREE.Vector3(...description.boneScales[index] as [number, number, number]));
        expect(maximumDifference(f.mesh.skeleton.bones[index].matrixWorld.elements, expected.elements)).toBeLessThan(1e-10);
      }
      expect(JOINT_NAMES.map(name => f.joints.get(name)!.quaternion.toArray())).toEqual(saved);
      expect(f.surface().every(Number.isFinite)).toBe(true);
    }
    for (const eye of ['l_eye', 'r_eye', 'l_eye_null', 'r_eye_null']) expect(f.mesh.skeleton.bones[description.nativeJointNames.indexOf(eye)].userData.editorJoint).toBe('Head');
    f.dispose();
  });

  it('applies outer Root and mirror once without reevaluating local correctives', () => {
    const f = fixture(); const calls = vi.spyOn(f.decoder, 'evaluateQuaternions');
    f.assign({ LeftUpperArm: [0, 0, 150], LeftForeArm: [-90, 0, 0] }); const local = f.surface();
    expect(calls).toHaveBeenCalledTimes(1);
    f.actor.position.set(1.2, 1.05, -.7); f.actor.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), .6); f.actor.scale.set(-1, 1, 1);
    f.actor.updateMatrixWorld(true); f.controller.update();
    // Original float32 source weights sum to one within 1e-7. Keep them
    // bit-for-bit rather than renormalizing to conceal their rounding noise.
    expect(calls).toHaveBeenCalledTimes(1); expect(maximumDifference(f.surface(), local)).toBeLessThan(2e-7);
    const vertex = new THREE.Vector3(...local.slice(1228 * 3, 1228 * 3 + 3) as [number, number, number]);
    const actual = f.mesh.getVertexPosition(1228, new THREE.Vector3()).applyMatrix4(f.mesh.matrixWorld);
    expect(actual.distanceTo(vertex.applyMatrix4(f.actor.matrixWorld))).toBeLessThan(2e-7);
    f.dispose();
  });

  it('retries failed correctives and stops updating after disposal', () => {
    const f = fixture(); const calls = vi.spyOn(f.decoder, 'evaluateQuaternions');
    calls.mockImplementationOnce(() => { throw new Error('injected decoder failure'); });
    expect(() => f.assign({ LeftUpperArm: [0, 0, 150] })).toThrow('injected decoder failure');
    f.controller.update(); expect(calls).toHaveBeenCalledTimes(2);
    const previous = f.surface(); f.controller.dispose(); f.assign({ LeftUpperArm: [0, 0, 170] });
    expect(calls).toHaveBeenCalledTimes(2); expect(f.surface()).toEqual(previous); f.dispose();
  });

  it('treats quaternion signs identically and crosses creative half-turns without helper seams', () => {
    const f = fixture();
    for (const joint of ['LeftHand', 'RightHand', 'LeftUpperArm', 'RightUpperArm', 'LeftFoot', 'RightFoot', 'Neck'] as const) {
      f.assign({ [joint]: [0, 180, 0] }); const positive = f.surface(), q = f.joints.get(joint)!.quaternion;
      q.set(-q.x, -q.y, -q.z, -q.w); f.controller.update();
      expect(maximumDifference(f.surface(), positive), `${joint} q/-q`).toBeLessThan(1e-12);
      f.assign({ [joint]: [0, 179.9999, 0] }); const before = f.surface();
      f.assign({ [joint]: [0, 180.0001, 0] });
      expect(maximumDifference(f.surface(), before), `${joint} half-turn seam`).toBeLessThan(2e-6);
    }
    f.dispose();
  });

  it('produces the same surface for random seeking and smooth high abduction', () => {
    const f = fixture(); const expected = new Map<number, number[]>();
    for (const degrees of [90, 110, 130, 150, 160, 170]) { f.assign({ LeftUpperArm: [0, 0, degrees] }); expected.set(degrees, f.surface()); }
    for (const degrees of [170, 90, 150, 110, 160, 130, 170]) { f.assign({ LeftUpperArm: [0, 0, degrees] }); expect(maximumDifference(f.surface(), expected.get(degrees)!)).toBeLessThan(1e-12); }
    for (const degrees of [90, 120, 150, 170]) {
      f.assign({ LeftUpperArm: [0, 0, degrees - .0001] }); const before = f.surface();
      f.assign({ LeftUpperArm: [0, 0, degrees + .0001] }); expect(maximumDifference(f.surface(), before)).toBeLessThan(3e-6);
    }
    f.dispose();
  });
});
