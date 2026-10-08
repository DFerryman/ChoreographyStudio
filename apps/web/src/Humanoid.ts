import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { JOINT_NAMES, RIG_DEFINITIONS, type JointName } from '../../../packages/core/src';

export const HUMANOID_ASSET_URL = '/models/neutral-human.glb';

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

/**
 * The CC0-derived surface is adapted offline to the canonical rest pose. Only
 * its geometry and four skin influences are consumed here: source bone axes,
 * rest rotations, animation and helper meshes never replace the editor rig.
 */
export async function loadHumanoid(joints: ReadonlyMap<JointName, THREE.Bone>, signal: AbortSignal): Promise<THREE.SkinnedMesh> {
  const response = await fetch(HUMANOID_ASSET_URL, { signal });
  if (!response.ok) throw new Error('中性人体模型载入失败，请刷新页面重试。');
  const data = await response.arrayBuffer();
  signal.throwIfAborted();
  const gltf = await new GLTFLoader().parseAsync(data, '/models/');
  let geometry: THREE.BufferGeometry | null = null;
  let material: THREE.MeshStandardMaterial | null = null;
  let skeleton: THREE.Skeleton | null = null;
  try {
    signal.throwIfAborted();
    gltf.scene.updateMatrixWorld(true);
    const surfaces: THREE.SkinnedMesh[] = [];
    gltf.scene.traverse(object => { if (object instanceof THREE.SkinnedMesh) surfaces.push(object); });
    if (surfaces.length !== 1) throw new Error('中性人体模型必须包含一个连续蒙皮表面。');
    const source = surfaces[0];
    geometry = source.geometry.clone().applyMatrix4(source.matrixWorld);
    const sourceIndices = geometry.getAttribute('skinIndex');
    const sourceWeights = geometry.getAttribute('skinWeight');
    if (!sourceIndices || !sourceWeights || sourceIndices.count !== geometry.getAttribute('position').count) throw new Error('人体蒙皮权重无效。');
    const indices = new Uint16Array(sourceIndices.count * 4);
    const mapping = source.skeleton.bones.map(bone => JOINT_NAMES.indexOf(bone.name as JointName));
    for (let vertex = 0; vertex < sourceIndices.count; vertex++) {
      for (let influence = 0; influence < 4; influence++) {
        const sourceIndex = sourceIndices.getComponent(vertex, influence);
        const mapped = mapping[sourceIndex];
        if (mapped === undefined || mapped < 0) throw new Error('人体骨骼不匹配编辑器。');
        indices[vertex * 4 + influence] = mapped;
      }
    }
    geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(indices, 4));
    material = new THREE.MeshStandardMaterial({ color: '#d8d3c9', roughness: .84, metalness: .015 });
    const mesh = new THREE.SkinnedMesh(geometry, material);
    mesh.name = 'NeutralHuman';
    mesh.castShadow = true;
    // The floor receives the contact shadow; studio lights shape the body
    // without shadow-map acne across small facial and finger triangles.
    mesh.receiveShadow = false;
    mesh.frustumCulled = false;
    const restPositions = new Map<JointName, THREE.Vector3>();
    for (const { name, parent, offset } of RIG_DEFINITIONS) {
      restPositions.set(name, new THREE.Vector3(...offset).add(parent ? restPositions.get(parent)! : new THREE.Vector3()));
    }
    const inverses = JOINT_NAMES.map(name => new THREE.Matrix4().makeTranslation(...restPositions.get(name)!.clone().negate().toArray() as [number, number, number]));
    skeleton = new THREE.Skeleton(JOINT_NAMES.map(name => joints.get(name)!), inverses);
    // Explicit rest matrices make asynchronous loading independent of the
    // current take, mirror, draft or playback pose when the file arrives.
    mesh.bind(skeleton, new THREE.Matrix4());
    mesh.normalizeSkinWeights();
    return mesh;
  } catch (error) {
    geometry?.dispose(); material?.dispose(); skeleton?.dispose();
    throw error;
  } finally { disposeSource(gltf.scene); }
}
