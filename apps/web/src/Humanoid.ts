import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { type JointName } from '../../../packages/core/src';
import { MHR_CORRECTIVES_ASSET_URL, MHR_CORRECTIVES_MAX_BYTES, MHRPoseCorrectives } from './MHRCorrectives';
import { createMHRRigController, validateMHRRigDescription, type MHRRigDescription } from './MHRRig';

// Versioned URLs leave assets available to editors opened before this update.
export const HUMANOID_ASSET_URL = '/models/neutral-mhr-v1.glb';
export const HUMANOID_RIG_ASSET_URL = '/models/neutral-mhr-v1.json';

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

/**
 * Three.js handles the native glTF skeleton and linear skinning. MHR retains
 * its source frames, weights and local pose correctives; the display adapter
 * follows the editor's canonical author rig without changing animation data.
 */
export async function loadHumanoid(joints: ReadonlyMap<JointName, THREE.Bone>, signal: AbortSignal): Promise<THREE.SkinnedMesh> {
  const [data, descriptionBytes, correctiveBytes] = await Promise.all([
    readAsset(HUMANOID_ASSET_URL, 2 * 1024 * 1024, signal),
    readAsset(HUMANOID_RIG_ASSET_URL, 512 * 1024, signal),
    readAsset(MHR_CORRECTIVES_ASSET_URL, MHR_CORRECTIVES_MAX_BYTES, signal),
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
