import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { clone } from 'three/addons/utils/SkeletonUtils.js';
import { evaluatePose, JOINT_NAMES, RIG_DEFINITIONS, type JointName, type Pose } from '../../../packages/core/src';
import { HUMANOID_ASSET_URL, HUMANOID_RIG_ASSET_URL, disposeHumanoid, loadHumanoid, readHumanoidRawSkinWeights, updateHumanoid } from './Humanoid';
import { QUATERNIUS_PRIMARY_JOINT_MAPPING, createQuaterniusRigController, quaterniusNeutralFrames, validateQuaterniusRigDescription, validateQuaterniusRuntimeCalibration, type QuaterniusRigDescription } from './QuaterniusRig';

const file = (name: string) => new URL(`../public/models/${name}`, import.meta.url);
const bytes = (name: string): ArrayBuffer => {
  const value = readFileSync(file(name));
  return value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength) as ArrayBuffer;
};
const description = JSON.parse(readFileSync(file('neutral-quaternius-v1.json'), 'utf8')) as QuaterniusRigDescription;
let source: GLTF;
beforeAll(async () => {
  const data = bytes('neutral-quaternius-v1.glb');
  source = await new GLTFLoader().parseAsync(data, '');
  source.scene.traverse(object => {
    if (object instanceof THREE.SkinnedMesh) object.geometry.setAttribute('skinWeight', new THREE.BufferAttribute(readHumanoidRawSkinWeights(data, description.vertexCount), 4));
  });
});
afterEach(() => { vi.unstubAllGlobals(); });

function authorRig() {
  const actor = new THREE.Group(), joints = new Map<JointName, THREE.Bone>();
  for (const definition of RIG_DEFINITIONS) {
    const bone = new THREE.Bone(); bone.name = definition.name; bone.position.set(...definition.offset);
    (definition.parent ? joints.get(definition.parent)! : actor).add(bone); joints.set(definition.name, bone);
  }
  return { actor, joints };
}
function fixture() {
  const scene = clone(source.scene); scene.updateMatrixWorld(true);
  let mesh!: THREE.SkinnedMesh;
  scene.traverse(object => { if (object instanceof THREE.SkinnedMesh) mesh = object; });
  mesh.geometry = mesh.geometry.clone();
  mesh.add(mesh.skeleton.bones.find(bone => !(bone.parent instanceof THREE.Bone))!);
  mesh.bindMatrix.identity(); mesh.bindMatrixInverse.identity();
  const { actor, joints } = authorRig(); actor.add(mesh);
  const controller = createQuaterniusRigController(mesh, joints, description);
  const assign = (angles: Partial<Record<JointName, readonly number[]>>) => {
    for (const name of JOINT_NAMES) {
      const value = angles[name] ?? [0, 0, 0];
      joints.get(name)!.quaternion.setFromEuler(new THREE.Euler(...value.map(number => THREE.MathUtils.degToRad(number)) as [number, number, number], 'XYZ'));
    }
    actor.updateMatrixWorld(true); controller.update();
  };
  const surface = () => Array.from({ length: description.vertexCount }, (_, vertex) => mesh.getVertexPosition(vertex, new THREE.Vector3()).toArray()).flat();
  const dispose = () => { controller.dispose(); mesh.geometry.dispose(); mesh.skeleton.dispose(); };
  return { actor, joints, mesh, controller, assign, surface, dispose };
}
const maximumDifference = (a: readonly number[], b: readonly number[]) => Math.max(...a.map((number, index) => Math.abs(number - b[index])));
const arrayHash = (array: Float32Array) => createHash('sha256').update(new Uint8Array(array.buffer, array.byteOffset, array.byteLength)).digest('hex');
const SOURCE_WEIGHT_SHA = 'd8fd81863a6c5e5926b450169febc992cace86ec98cd2cd0b36889444f2ef1a2';

function changedGLBJSON(change: (doc: Record<string, any>) => void): ArrayBuffer {
  const original = bytes('neutral-quaternius-v1.glb'), originalView = new DataView(original), jsonLength = originalView.getUint32(12, true);
  const doc = JSON.parse(new TextDecoder().decode(new Uint8Array(original, 20, jsonLength))); change(doc);
  const encoded = new TextEncoder().encode(JSON.stringify(doc)), paddedLength = Math.ceil(encoded.length / 4) * 4;
  const tail = new Uint8Array(original, 20 + jsonLength), result = new ArrayBuffer(20 + paddedLength + tail.length), view = new DataView(result);
  view.setUint32(0, 0x46546c67, true); view.setUint32(4, 2, true); view.setUint32(8, result.byteLength, true);
  view.setUint32(12, paddedLength, true); view.setUint32(16, 0x4e4f534a, true);
  new Uint8Array(result, 20, paddedLength).fill(32); new Uint8Array(result, 20, encoded.length).set(encoded);
  new Uint8Array(result, 20 + paddedLength).set(tail); return result;
}

describe('selected Quaternius native skeleton', () => {
  it('recovers exact source float32 weights and rejects unsafe raw accessor layouts', () => {
    const data = bytes('neutral-quaternius-v1.glb');
    expect(arrayHash(readHumanoidRawSkinWeights(data, 8483))).toBe(SOURCE_WEIGHT_SHA);
    expect(() => readHumanoidRawSkinWeights(data.slice(0, -4), 8483)).toThrow();
    const changes = [
      (doc: Record<string, any>) => { doc.accessors[doc.meshes[0].primitives[0].attributes.WEIGHTS_0].count = 8482; },
      (doc: Record<string, any>) => { doc.accessors[doc.meshes[0].primitives[0].attributes.WEIGHTS_0].componentType = 5123; },
      (doc: Record<string, any>) => { doc.accessors[doc.meshes[0].primitives[0].attributes.WEIGHTS_0].sparse = {}; },
      (doc: Record<string, any>) => { doc.bufferViews[doc.accessors[doc.meshes[0].primitives[0].attributes.WEIGHTS_0].bufferView].byteStride = 12; },
      (doc: Record<string, any>) => { doc.bufferViews[doc.accessors[doc.meshes[0].primitives[0].attributes.WEIGHTS_0].bufferView].byteOffset = 2147483644; },
      (doc: Record<string, any>) => { doc.buffers[0].uri = 'external.bin'; },
    ];
    for (const change of changes) expect(() => readHumanoidRawSkinWeights(changedGLBJSON(change), 8483)).toThrow();
  });
  it('rejects cycles, invalid traversal, changed source bind and inverse bind', () => {
    expect(() => validateQuaterniusRigDescription(description)).not.toThrow();
    const cycle = structuredClone(description); cycle.nativeJointParents = cycle.nativeJointParents.map((parent, index) => index === 0 ? 1 : parent);
    const schedule = structuredClone(description); schedule.topoOrder = [...schedule.topoOrder].reverse();
    const bind = structuredClone(description); bind.sourceBindWorld = bind.sourceBindWorld.map((frame, index) => index === 8 ? frame.map((value, at) => at === 12 ? value + .01 : value) : frame);
    const inverse = structuredClone(description); inverse.sourceInverseBindWorld = inverse.sourceInverseBindWorld.map((frame, index) => index === 57 ? frame.map((value, at) => at === 13 ? value + .01 : value) : frame);
    const missing = structuredClone(description); missing.nativeJointNames = missing.nativeJointNames.map(name => name === 'hand_l' ? 'missing_hand' : name);
    for (const invalid of [cycle, schedule, bind, inverse, missing]) expect(() => validateQuaterniusRigDescription(invalid)).toThrow();
  });

  it('calibrates all mapped pivots to canonical neutral FK with arms vertically down', () => {
    const neutral = quaterniusNeutralFrames(description);
    const rest = evaluatePose({ root: [0, 0, 0], joints: Object.fromEntries(JOINT_NAMES.map(name => [name, [0, 0, 0, 1]])) as Pose['joints'] });
    for (const suffix of ['l', 'r']) {
      const upper = description.nativeJointNames.indexOf(`upperarm_${suffix}`), lower = description.nativeJointNames.indexOf(`lowerarm_${suffix}`);
      const direction = new THREE.Vector3().setFromMatrixPosition(neutral[lower]).sub(new THREE.Vector3().setFromMatrixPosition(neutral[upper])).normalize();
      expect(direction.distanceTo(new THREE.Vector3(0, -1, 0))).toBeLessThan(1e-12);
    }
    for (const [native, author] of Object.entries(QUATERNIUS_PRIMARY_JOINT_MAPPING)) {
      const position = new THREE.Vector3().setFromMatrixPosition(neutral[description.nativeJointNames.indexOf(native)]);
      expect(position.distanceTo(new THREE.Vector3(...rest[author].position))).toBeLessThan(1e-12);
    }
  });

  it('rejects missing or altered fixed display calibration before binding a surface', () => {
    expect(() => validateQuaterniusRuntimeCalibration(description)).not.toThrow();
    const missing = structuredClone(description); delete missing.runtimeCalibration;
    const factor = structuredClone(description); factor.runtimeCalibration!.footVerticalFactors[0] += .001;
    const axis = structuredClone(description); axis.runtimeCalibration!.neutralWorldRotations[8][2] += .01;
    const inverse = structuredClone(description); inverse.runtimeCalibration!.skinBindAdjustments[57][13] += .01;
    for (const invalid of [missing, factor, axis, inverse]) expect(() => validateQuaterniusRuntimeCalibration(invalid)).toThrow();
    const f = fixture(), before = f.mesh.skeleton.boneInverses.map(frame => [...frame.elements]);
    expect(() => createQuaterniusRigController(f.mesh, f.joints, description)).toThrow('已经完成固定标定');
    expect(f.mesh.skeleton.boneInverses.map(frame => [...frame.elements])).toEqual(before); f.dispose();
  });

  it('fits neutral body height and source skin sole to the existing profile', () => {
    const f = fixture(); f.assign({}); f.actor.position.y = 1.05; f.actor.updateMatrixWorld(true);
    const points = f.surface(), ys = points.filter((_, index) => index % 3 === 1).map(y => y + 1.05);
    expect(Math.abs(Math.max(...ys) - 1.85)).toBeLessThan(2e-6);
    // Original calf/foot weights blend the ankle skin; audit its actual surface
    // instead of pretending every plantar vertex is 100% ankle-owned.
    expect(Math.abs(Math.min(...ys) - .008)).toBeLessThan(.002); f.dispose();
  });

  it('retains raw vertex data, all weights and inverse binds through extreme authored poses', () => {
    const f = fixture();
    const positions = Array.from(f.mesh.geometry.getAttribute('position').array), weights = Array.from(f.mesh.geometry.getAttribute('skinWeight').array);
    const inverses = f.mesh.skeleton.boneInverses.map(frame => [...frame.elements]);
    const poses: Partial<Record<JointName, number[]>>[] = [{}, { LeftUpperArm: [0, 0, 150], LeftForeArm: [-100, 0, 0] }, { LeftUpperArm: [0, 0, 170], LeftHand: [45, 60, 25], RightHand: [-45, -60, -25] }, { Spine: [35, 25, 0], Neck: [20, 30, 0], LeftUpperLeg: [-60, 20, 45], LeftLowerLeg: [110, 0, 0], LeftFoot: [-40, 0, 20] }];
    for (const pose of poses) {
      f.assign(pose); const author = JOINT_NAMES.map(name => f.joints.get(name)!.quaternion.toArray());
      expect(f.surface().every(Number.isFinite)).toBe(true);
      expect(JOINT_NAMES.map(name => f.joints.get(name)!.quaternion.toArray())).toEqual(author);
      expect(Array.from(f.mesh.geometry.getAttribute('position').array)).toEqual(positions);
      expect(Array.from(f.mesh.geometry.getAttribute('skinWeight').array)).toEqual(weights);
      expect(f.mesh.skeleton.boneInverses.map(frame => [...frame.elements])).toEqual(inverses);
      const evaluated = evaluatePose({ root: [0, 0, 0], joints: Object.fromEntries(JOINT_NAMES.map(name => [name, f.joints.get(name)!.quaternion.toArray()])) as Pose['joints'] });
      for (const [native, author] of Object.entries(QUATERNIUS_PRIMARY_JOINT_MAPPING)) {
        const index = description.nativeJointNames.indexOf(native), bone = f.mesh.skeleton.bones[index];
        const position = bone.getWorldPosition(new THREE.Vector3());
        expect(position.distanceTo(new THREE.Vector3(...evaluated[author].position))).toBeLessThan(1e-10);
        const expected = new THREE.Matrix4().compose(new THREE.Vector3(...evaluated[author].position),
          new THREE.Quaternion(...evaluated[author].rotation).multiply(new THREE.Quaternion(...description.runtimeCalibration!.neutralWorldRotations[index] as [number, number, number, number])),
          new THREE.Vector3(...description.runtimeCalibration!.boneScales[index] as [number, number, number]));
        expect(maximumDifference(bone.matrixWorld.elements, expected.elements)).toBeLessThan(1e-10);
      }
    }
    for (const name of ['index_01_l', 'middle_03_l', 'thumb_04_leaf_l']) expect(f.mesh.skeleton.bones[description.nativeJointNames.indexOf(name)].userData.editorJoint).toBe('LeftHand');
    for (const name of ['index_01_r', 'middle_03_r', 'thumb_04_leaf_r']) expect(f.mesh.skeleton.bones[description.nativeJointNames.indexOf(name)].userData.editorJoint).toBe('RightHand');
    expect(f.mesh.skeleton.bones[description.nativeJointNames.indexOf('ball_leaf_l')].userData.editorJoint).toBe('LeftFoot');
    expect(f.mesh.skeleton.bones[description.nativeJointNames.indexOf('ball_leaf_r')].userData.editorJoint).toBe('RightFoot');
    f.dispose();
  });

  it('applies outer Root and mirror once and stops changing skin after disposal', () => {
    const f = fixture(); f.assign({ LeftUpperArm: [0, 0, 150], LeftForeArm: [-90, 0, 0] });
    const before = f.surface();
    f.actor.position.set(1.2, 1.05, -.7); f.actor.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), .6); f.actor.scale.set(-1, 1, 1);
    f.actor.updateMatrixWorld(true); f.controller.update();
    expect(maximumDifference(f.surface(), before)).toBeLessThan(5e-7);
    const vertex = new THREE.Vector3(...before.slice(2300 * 3, 2300 * 3 + 3) as [number, number, number]);
    const actual = f.mesh.getVertexPosition(2300, new THREE.Vector3()).applyMatrix4(f.mesh.matrixWorld);
    expect(actual.distanceTo(vertex.applyMatrix4(f.actor.matrixWorld))).toBeLessThan(5e-7);
    f.controller.dispose(); f.assign({ LeftUpperArm: [0, 0, 170] });
    expect(maximumDifference(f.surface(), before)).toBeLessThan(5e-7); f.dispose();
  });

  it('seeks without state and treats quaternion signs identically at creative half turns', () => {
    const f = fixture(), expected = new Map<number, number[]>();
    for (const degrees of [20, 90, 150, 170]) { f.assign({ LeftUpperArm: [0, 0, degrees] }); expected.set(degrees, f.surface()); }
    for (const degrees of [170, 20, 150, 90, 170]) { f.assign({ LeftUpperArm: [0, 0, degrees] }); expect(maximumDifference(f.surface(), expected.get(degrees)!)).toBeLessThan(1e-12); }
    for (const joint of ['LeftHand', 'RightHand', 'LeftUpperArm', 'LeftFoot', 'Neck'] as const) {
      f.assign({ [joint]: [0, 180, 0] }); const positive = f.surface(), q = f.joints.get(joint)!.quaternion;
      q.set(-q.x, -q.y, -q.z, -q.w); f.controller.update();
      expect(maximumDifference(f.surface(), positive)).toBeLessThan(1e-12);
      f.assign({ [joint]: [0, 179.9999, 0] }); const before = f.surface();
      f.assign({ [joint]: [0, 180.0001, 0] }); expect(maximumDifference(f.surface(), before)).toBeLessThan(4e-6);
    }
    f.dispose();
  });

  it('loads the selected source with exactly two bounded requests and no old-model corrective', async () => {
    const fetcher = vi.fn(async (url: string) => {
      if (url !== HUMANOID_ASSET_URL && url !== HUMANOID_RIG_ASSET_URL) throw new Error(`unexpected asset request ${url}`);
      return new Response(bytes(url.split('/').at(-1)!));
    }); vi.stubGlobal('fetch', fetcher);
    const { actor, joints } = authorRig();
    const mesh = await loadHumanoid(joints, new AbortController().signal); actor.add(mesh); updateHumanoid(mesh);
    expect(fetcher).toHaveBeenCalledTimes(2); expect(mesh.skeleton.bones).toHaveLength(65); expect(mesh.geometry.getAttribute('position').count).toBe(8483);
    expect(arrayHash(mesh.geometry.getAttribute('skinWeight').array as Float32Array)).toBe(SOURCE_WEIGHT_SHA);
    disposeHumanoid(mesh); mesh.geometry.dispose(); mesh.skeleton.dispose();
  });

  it('rejects an already aborted request before exposing a loaded surface', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => new Response(bytes(url.split('/').at(-1)!))));
    const abort = new AbortController(); abort.abort();
    await expect(loadHumanoid(authorRig().joints, abort.signal)).rejects.toHaveProperty('name', 'AbortError');
  });
});
