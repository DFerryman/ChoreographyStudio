import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { type JointName } from '../../../packages/core/src';
import { MHRPoseCorrectives } from './MHRCorrectives';
import { readMHRCorrectives } from './MHRTransport';
import { createMHRRigController, validateMHRRigDescription, type MHRRigDescription } from './MHRRig';
import { createQuaterniusRigController, validateQuaterniusRigDescription, validateQuaterniusRuntimeCalibration, type QuaterniusRigDescription } from './QuaterniusRig';
import { AVATAR_COLLISION_PROFILE } from '../../../packages/core/src/avatarCapsules.generated';
import { validateAvatarCollisionSource } from './avatarCollisionSource';

// Versioned URLs leave assets available to editors opened before this update.
export const HUMANOID_ASSET_URL = '/models/neutral-quaternius-v1.glb';
export const HUMANOID_RIG_ASSET_URL = '/models/neutral-quaternius-v1.json';
export const MHR_HUMANOID_ASSET_URL = '/models/neutral-mhr-v1.glb';
export const MHR_HUMANOID_RIG_ASSET_URL = '/models/neutral-mhr-v1.json';

type SurfaceController = { update(): void; dispose(): void };
const surfaceControllers = new WeakMap<THREE.SkinnedMesh, SurfaceController>();

/** Drawing, deliberate skin picking and framing use the same posed surface. */
export function updateHumanoid(surface: THREE.SkinnedMesh | null) {
  if (surface) surfaceControllers.get(surface)?.update();
}

export function disposeHumanoid(surface: THREE.SkinnedMesh | null) {
  if (!surface) return;
  surfaceControllers.get(surface)?.dispose();
  surfaceControllers.delete(surface);
}

function disposeSource(scene: THREE.Object3D) {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  const skeletons = new Set<THREE.Skeleton>();
  scene.traverse(object => {
    const mesh = object as THREE.Mesh;
    if (mesh.geometry) geometries.add(mesh.geometry);
    for (const material of Array.isArray(mesh.material) ? mesh.material : mesh.material ? [mesh.material] : []) materials.add(material);
    if (object instanceof THREE.SkinnedMesh) skeletons.add(object.skeleton);
  });
  for (const geometry of geometries) geometry.dispose();
  for (const material of materials) material.dispose();
  for (const skeleton of skeletons) skeleton.dispose();
}

async function readAsset(url: string, maximumBytes: number, signal: AbortSignal): Promise<ArrayBuffer> {
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error('中性人体模型载入失败，请刷新页面重试。');
  const length = Number(response.headers.get('content-length'));
  if (Number.isFinite(length) && length > maximumBytes) throw new Error('人体模型资产超过大小限制。');
  const bytes = await response.arrayBuffer();
  signal.throwIfAborted();
  if (bytes.byteLength === 0 || bytes.byteLength > maximumBytes) throw new Error('人体模型资产大小无效。');
  return bytes;
}

type RawSkinGLTF = {
  buffers?: { byteLength?: number; uri?: string }[];
  bufferViews?: { buffer?: number; byteOffset?: number; byteLength?: number; byteStride?: number }[];
  accessors?: { bufferView?: number; byteOffset?: number; count?: number; type?: string; componentType?: number; normalized?: boolean; sparse?: unknown }[];
  meshes?: { primitives?: { attributes?: Record<string, number>; extensions?: unknown }[] }[];
};
const safeInteger = (value: unknown, minimum = 0): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= minimum;

/** GLTFLoader normalizes skin weights on import, including the source's tiny
 * float32 sum rounding. Recover its exact published accessor values, never a
 * reweighted approximation. Only this bounded, single-surface GLB is accepted. */
export function readHumanoidRawSkinWeights(data: ArrayBuffer, expectedVertices: number): Float32Array {
  const fail = () => { throw new Error('人物原始蒙皮权重数据无效。'); };
  if (data.byteLength < 28 || data.byteLength > 2 * 1024 * 1024 || !safeInteger(expectedVertices, 1) || expectedVertices > 10000) return fail();
  const view = new DataView(data);
  if (view.getUint32(0, true) !== 0x46546c67 || view.getUint32(4, true) !== 2 || view.getUint32(8, true) !== data.byteLength) return fail();
  let json: RawSkinGLTF | undefined, binaryOffset = -1, binaryLength = -1;
  for (let offset = 12; offset < data.byteLength;) {
    if (offset + 8 > data.byteLength) return fail();
    const length = view.getUint32(offset, true), kind = view.getUint32(offset + 4, true); offset += 8;
    if (length % 4 !== 0 || offset + length > data.byteLength) return fail();
    if (kind === 0x4e4f534a) {
      if (json || binaryOffset >= 0 || length > 512 * 1024) return fail();
      json = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(new Uint8Array(data, offset, length))) as RawSkinGLTF;
    } else if (kind === 0x004e4942) {
      if (!json || binaryOffset >= 0) return fail();
      binaryOffset = offset; binaryLength = length;
    } else return fail();
    offset += length;
  }
  const primitive = json?.meshes?.[0]?.primitives?.[0], accessorIndex = primitive?.attributes?.WEIGHTS_0;
  if (!json || json.meshes?.length !== 1 || json.meshes[0].primitives?.length !== 1 || primitive?.extensions !== undefined
    || !safeInteger(accessorIndex) || !Array.isArray(json.accessors) || accessorIndex >= json.accessors.length
    || json.buffers?.length !== 1 || !safeInteger(json.buffers[0].byteLength, 1) || json.buffers[0].uri !== undefined
    || binaryOffset < 0 || binaryLength < json.buffers[0].byteLength || binaryLength - json.buffers[0].byteLength > 3) return fail();
  const accessor = json.accessors[accessorIndex];
  if (accessor.componentType !== 5126 || accessor.type !== 'VEC4' || accessor.count !== expectedVertices || accessor.normalized === true
    || accessor.sparse !== undefined || !safeInteger(accessor.bufferView) || !Array.isArray(json.bufferViews) || accessor.bufferView >= json.bufferViews.length) return fail();
  const bufferView = json.bufferViews[accessor.bufferView], bufferOffset = bufferView.byteOffset ?? 0, accessorOffset = accessor.byteOffset ?? 0, stride = bufferView.byteStride ?? 16;
  if (bufferView.buffer !== 0 || !safeInteger(bufferOffset) || bufferOffset % 4 !== 0 || !safeInteger(accessorOffset) || accessorOffset % 4 !== 0
    || !safeInteger(bufferView.byteLength, 1) || !safeInteger(stride, 16) || stride > 252 || stride % 4 !== 0
    || bufferOffset + bufferView.byteLength > json.buffers[0].byteLength
    || accessorOffset + (expectedVertices - 1) * stride + 16 > bufferView.byteLength) return fail();
  const result = new Float32Array(expectedVertices * 4);
  for (let vertex = 0; vertex < expectedVertices; vertex++) {
    let sum = 0;
    for (let influence = 0; influence < 4; influence++) {
      const weight = view.getFloat32(binaryOffset + bufferOffset + accessorOffset + vertex * stride + influence * 4, true);
      if (!Number.isFinite(weight) || weight < 0 || weight > 1) return fail();
      result[vertex * 4 + influence] = weight; sum += weight;
    }
    if (Math.abs(sum - 1) > 2e-5) return fail();
  }
  return result;
}

/**
 * The explicitly retained MHR path supports source-history verification. The
 * active default below is the independently loaded, user-selected Quaternius.
 */
export async function loadMHRHumanoid(joints: ReadonlyMap<JointName, THREE.Bone>, signal: AbortSignal): Promise<THREE.SkinnedMesh> {
  const [data, descriptionBytes, correctiveBytes] = await Promise.all([
    readAsset(MHR_HUMANOID_ASSET_URL, 2 * 1024 * 1024, signal),
    readAsset(MHR_HUMANOID_RIG_ASSET_URL, 512 * 1024, signal),
    readMHRCorrectives(signal),
  ]);
  const description: MHRRigDescription = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(descriptionBytes));
  validateMHRRigDescription(description);
  const correctives = new MHRPoseCorrectives(correctiveBytes);
  const gltf = await new GLTFLoader().parseAsync(data, '/models/');
  let geometry: THREE.BufferGeometry | null = null;
  let material: THREE.MeshStandardMaterial | null = null;
  let skeleton: THREE.Skeleton | null = null;
  let mesh: THREE.SkinnedMesh | null = null;
  try {
    signal.throwIfAborted();
    gltf.scene.updateMatrixWorld(true);
    const surfaces: THREE.SkinnedMesh[] = [];
    gltf.scene.traverse(object => { if (object instanceof THREE.SkinnedMesh) surfaces.push(object); });
    if (surfaces.length !== 1) throw new Error('中性人体模型必须包含一个连续蒙皮表面。');
    const source = surfaces[0];
    if (description.version !== 1 || description.nativeJointCount !== 127 || description.vertexCount !== 4899
      || source.skeleton.bones.length !== 127 || new Set(source.skeleton.bones.map(bone => bone.name)).size !== 127
      || !Array.isArray(description.nativeJointNames) || description.nativeJointNames.length !== 127
      || !Array.isArray(description.nativeJointParents) || description.nativeJointParents.length !== 127
      || !Array.isArray(description.sourceBindWorld) || description.sourceBindWorld.length !== 127) {
      throw new Error('人体模型与当前骨架不匹配，请刷新页面重试。');
    }
    const identity = new THREE.Matrix4();
    if (source.matrixWorld.elements.some((value, i) => !Number.isFinite(value) || Math.abs(value - identity.elements[i]) > 1e-6)) throw new Error('人体表面坐标校准无效。');
    for (let index = 0; index < 127; index++) {
      const bone = source.skeleton.bones[index], parentIndex = description.nativeJointParents[index];
      const parent = bone.parent instanceof THREE.Bone ? source.skeleton.bones.indexOf(bone.parent) : -1;
      const expected = description.sourceBindWorld[index];
      if (bone.name !== description.nativeJointNames[index] || !Number.isInteger(parentIndex) || parentIndex < -1 || parentIndex >= index
        || parent !== parentIndex || !Array.isArray(expected) || expected.length !== 16 || !expected.every(Number.isFinite)
        || bone.matrixWorld.elements.some((value, i) => !Number.isFinite(value) || Math.abs(value - expected[i]) > 1e-5)) throw new Error('人体原生骨骼校准不匹配。');
      const product = bone.matrixWorld.clone().multiply(source.skeleton.boneInverses[index]);
      if (product.elements.some((value, i) => !Number.isFinite(value) || Math.abs(value - identity.elements[i]) > 1e-5)) throw new Error('人体原生绑定矩阵无效。');
    }
    geometry = source.geometry.clone();
    const positions = geometry.getAttribute('position'), indices = geometry.getAttribute('skinIndex'), weights = geometry.getAttribute('skinWeight');
    if (!positions || positions.count !== 4899 || positions.itemSize !== 3 || !indices || !weights
      || indices.itemSize !== 4 || weights.itemSize !== 4 || indices.count !== positions.count || weights.count !== positions.count) throw new Error('人体蒙皮权重无效。');
    for (let vertex = 0; vertex < positions.count; vertex++) {
      if (![positions.getX(vertex), positions.getY(vertex), positions.getZ(vertex)].every(Number.isFinite)) throw new Error('人体表面坐标无效。');
      let sum = 0;
      for (let influence = 0; influence < 4; influence++) {
        const bone = indices.getComponent(vertex, influence), weight = weights.getComponent(vertex, influence);
        if (!Number.isInteger(bone) || bone < 0 || bone >= 127 || !Number.isFinite(weight) || weight < 0 || weight > 1) throw new Error('人体蒙皮权重无效。');
        sum += weight;
      }
      if (Math.abs(sum - 1) > 2e-5) throw new Error('人体蒙皮权重未归一化。');
    }
    const bones = source.skeleton.bones.map(sourceBone => {
      const bone = new THREE.Bone();
      bone.name = sourceBone.name;
      bone.position.copy(sourceBone.position); bone.quaternion.copy(sourceBone.quaternion); bone.scale.copy(sourceBone.scale);
      return bone;
    });
    material = new THREE.MeshStandardMaterial({ color: '#d8d3c9', roughness: .84, metalness: .015 });
    mesh = new THREE.SkinnedMesh(geometry, material);
    mesh.name = 'NeutralHuman'; mesh.castShadow = true; mesh.receiveShadow = false; mesh.frustumCulled = false;
    bones.forEach((bone, index) => (description.nativeJointParents[index] === -1 ? mesh! : bones[description.nativeJointParents[index]]).add(bone));
    skeleton = new THREE.Skeleton(bones, source.skeleton.boneInverses.map(inverse => inverse.clone()));
    mesh.bind(skeleton, new THREE.Matrix4());
    const controller = createMHRRigController(mesh, joints, correctives, description);
    surfaceControllers.set(mesh, controller);
    return mesh;
  } catch (error) {
    disposeHumanoid(mesh); geometry?.dispose(); material?.dispose(); skeleton?.dispose();
    throw error;
  } finally { disposeSource(gltf.scene); }
}

/** Mature Three.js glTF/LBS keeps the selected source geometry, original four
 * influences and all sixty-five native bones. Source inverse binds are checked
 * before the separate fixed canonical display calibration is applied.
 * No MHR corrective is fetched or applied to this different human. */
export async function loadHumanoid(joints: ReadonlyMap<JointName, THREE.Bone>, signal: AbortSignal): Promise<THREE.SkinnedMesh> {
  const [data, descriptionBytes] = await Promise.all([
    readAsset(HUMANOID_ASSET_URL, 2 * 1024 * 1024, signal),
    readAsset(HUMANOID_RIG_ASSET_URL, 512 * 1024, signal),
  ]);
  // Authoring needs the validated model, independently of optional preview WASM.
  await validateAvatarCollisionSource(data, descriptionBytes, AVATAR_COLLISION_PROFILE);
  signal.throwIfAborted();
  const description: QuaterniusRigDescription = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(descriptionBytes));
  validateQuaterniusRigDescription(description);
  validateQuaterniusRuntimeCalibration(description);
  const originalWeights = readHumanoidRawSkinWeights(data, description.vertexCount);
  const gltf = await new GLTFLoader().parseAsync(data, '/models/');
  let geometry: THREE.BufferGeometry | null = null;
  let material: THREE.MeshStandardMaterial | null = null;
  let skeleton: THREE.Skeleton | null = null;
  let mesh: THREE.SkinnedMesh | null = null;
  try {
    signal.throwIfAborted();
    gltf.scene.updateMatrixWorld(true);
    const surfaces: THREE.SkinnedMesh[] = [];
    gltf.scene.traverse(object => { if (object instanceof THREE.SkinnedMesh) surfaces.push(object); });
    if (surfaces.length !== 1) throw new Error('人物模型必须包含一个完整蒙皮表面。');
    const source = surfaces[0], identity = new THREE.Matrix4();
    source.geometry.setAttribute('skinWeight', new THREE.BufferAttribute(originalWeights, 4));
    if (source.skeleton.bones.length !== 65 || source.skeleton.boneInverses.length !== 65
      || source.matrixWorld.elements.some((number, at) => !Number.isFinite(number) || Math.abs(number - identity.elements[at]) > 1e-6)) throw new Error('人物表面与原生骨架不匹配。');
    for (let index = 0; index < 65; index++) {
      const bone = source.skeleton.bones[index], parent = bone.parent instanceof THREE.Bone ? source.skeleton.bones.indexOf(bone.parent) : -1;
      const expected = description.sourceBindWorld[index], inverse = description.sourceInverseBindWorld[index];
      if (bone.name !== description.nativeJointNames[index] || parent !== description.nativeJointParents[index]
        || bone.matrixWorld.elements.some((number, at) => !Number.isFinite(number) || Math.abs(number - expected[at]) > 1e-5)
        || source.skeleton.boneInverses[index].elements.some((number, at) => !Number.isFinite(number) || Math.abs(number - inverse[at]) > 1e-8)) throw new Error('人物原生关节与绑定姿态不匹配。');
      const product = bone.matrixWorld.clone().multiply(source.skeleton.boneInverses[index]);
      if (product.elements.some((number, at) => !Number.isFinite(number) || Math.abs(number - identity.elements[at]) > 1e-5)) throw new Error('人物原生绑定矩阵无效。');
    }
    geometry = source.geometry.clone();
    const positions = geometry.getAttribute('position'), normals = geometry.getAttribute('normal'), indices = geometry.getAttribute('skinIndex'), weights = geometry.getAttribute('skinWeight');
    if (!positions || positions.count !== description.vertexCount || positions.itemSize !== 3 || !normals || normals.count !== positions.count || normals.itemSize !== 3
      || !geometry.index || geometry.index.count !== description.triangleCount * 3 || !indices || !weights
      || indices.itemSize !== 4 || weights.itemSize !== 4 || indices.count !== positions.count || weights.count !== positions.count) throw new Error('人物原生蒙皮数据无效。');
    for (let vertex = 0; vertex < positions.count; vertex++) {
      if (![positions.getX(vertex), positions.getY(vertex), positions.getZ(vertex), normals.getX(vertex), normals.getY(vertex), normals.getZ(vertex)].every(Number.isFinite)) throw new Error('人物表面坐标无效。');
      let sum = 0;
      for (let influence = 0; influence < 4; influence++) {
        const index = indices.getComponent(vertex, influence), weight = weights.getComponent(vertex, influence);
        if (!Number.isInteger(index) || index < 0 || index >= 65 || !Number.isFinite(weight) || weight < 0 || weight > 1) throw new Error('人物原生蒙皮权重无效。');
        sum += weight;
      }
      if (Math.abs(sum - 1) > 2e-5) throw new Error('人物原生蒙皮权重未归一化。');
    }
    for (let index = 0; index < geometry.index.count; index++) {
      const vertex = geometry.index.getX(index);
      if (!Number.isInteger(vertex) || vertex < 0 || vertex >= positions.count) throw new Error('人物表面拓扑无效。');
    }
    const bones = source.skeleton.bones.map(sourceBone => {
      const bone = new THREE.Bone(); bone.name = sourceBone.name;
      bone.position.copy(sourceBone.position); bone.quaternion.copy(sourceBone.quaternion); bone.scale.copy(sourceBone.scale);
      return bone;
    });
    material = new THREE.MeshStandardMaterial({ color: '#a0adb7', roughness: .82, metalness: .015 });
    mesh = new THREE.SkinnedMesh(geometry, material);
    mesh.name = 'NeutralHuman'; mesh.castShadow = true; mesh.receiveShadow = false; mesh.frustumCulled = false;
    bones.forEach((bone, index) => (description.nativeJointParents[index] < 0 ? mesh! : bones[description.nativeJointParents[index]]).add(bone));
    skeleton = new THREE.Skeleton(bones, source.skeleton.boneInverses.map(inverse => inverse.clone()));
    mesh.bind(skeleton, new THREE.Matrix4());
    const controller = createQuaterniusRigController(mesh, joints, description);
    surfaceControllers.set(mesh, controller);
    signal.throwIfAborted();
    return mesh;
  } catch (error) {
    disposeHumanoid(mesh); geometry?.dispose(); material?.dispose(); skeleton?.dispose();
    throw error;
  } finally { disposeSource(gltf.scene); }
}
