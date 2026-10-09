import * as THREE from 'three';
import { evaluatePose, JOINT_NAMES, type JointName, type Pose } from '../../../packages/core/src';

/** Raw source frames are independently checked before any display calibration. */
export type QuaterniusRigDescription = {
  schema: 'quaternius-rig-1';
  version: number;
  nativeJointCount: number;
  vertexCount: number;
  triangleCount: number;
  nativeJointNames: readonly string[];
  nativeJointParents: readonly number[];
  topoOrder: readonly number[];
  sourceLocalTranslation: readonly (readonly number[])[];
  sourceLocalRotation: readonly (readonly number[])[];
  sourceLocalScale: readonly (readonly number[])[];
  sourceBindWorld: readonly (readonly number[])[];
  sourceInverseBindWorld: readonly (readonly number[])[];
  sourceBounds: { min: readonly number[]; max: readonly number[] };
  sourceHeightMeters: number;
  runtimeCalibration?: QuaterniusCalibration;
};

export const QUATERNIUS_PRIMARY_JOINT_MAPPING: Readonly<Record<string, JointName>> = Object.freeze({
  pelvis: 'Hips', spine_01: 'Spine', spine_03: 'Chest', neck_01: 'Neck', Head: 'Head',
  ...Object.fromEntries((['l', 'r'] as const).flatMap(suffix => {
    const side = suffix === 'l' ? 'Left' : 'Right';
    return ([['clavicle', 'Shoulder'], ['upperarm', 'UpperArm'], ['lowerarm', 'ForeArm'], ['hand', 'Hand'], ['thigh', 'UpperLeg'], ['calf', 'LowerLeg'], ['foot', 'Foot'], ['ball', 'Toe']] as const)
      .map(([native, author]) => [`${native}_${suffix}`, `${side}${author}` as JointName]);
  })),
});

const tuple = (value: unknown, size: number): value is number[] => Array.isArray(value) && value.length === size && value.every(number => typeof number === 'number' && Number.isFinite(number));
const vector = (value: readonly number[]) => new THREE.Vector3(value[0], value[1], value[2]);
const quaternion = (value: readonly number[]) => new THREE.Quaternion(value[0], value[1], value[2], value[3]).normalize();
const matrix = (value: readonly number[]) => new THREE.Matrix4().fromArray([...value]);
const maximumDifference = (a: readonly number[], b: readonly number[]) => Math.max(...a.map((number, at) => Math.abs(number - b[at])));

/** Skin order and node order need not be a traversal order. Validate an explicit
 * parent-before-child schedule instead of guessing ancestry from an index. */
export function validateQuaterniusRigDescription(value: QuaterniusRigDescription): void {
  if (!value || value.schema !== 'quaternius-rig-1' || value.version !== 1 || value.nativeJointCount !== 65
    || value.vertexCount !== 8483 || value.triangleCount !== 14318 || value.nativeJointNames?.length !== 65
    || new Set(value.nativeJointNames).size !== 65 || value.nativeJointParents?.length !== 65 || value.topoOrder?.length !== 65
    || new Set(value.topoOrder).size !== 65 || value.sourceLocalTranslation?.length !== 65 || value.sourceLocalRotation?.length !== 65
    || value.sourceLocalScale?.length !== 65 || value.sourceBindWorld?.length !== 65 || value.sourceInverseBindWorld?.length !== 65
    || !tuple(value.sourceBounds?.min, 3) || !tuple(value.sourceBounds?.max, 3)
    || !Number.isFinite(value.sourceHeightMeters) || value.sourceHeightMeters < 1.7 || value.sourceHeightMeters > 2
    || Math.abs(value.sourceBounds.max[1] - value.sourceBounds.min[1] - value.sourceHeightMeters) > 1e-6
    || value.sourceBounds.min.some((minimum, at) => minimum >= value.sourceBounds.max[at])) throw new Error('人体模型校准数据无效。');
  const seen = new Set<number>();
  for (const index of value.topoOrder) {
    if (!Number.isInteger(index) || index < 0 || index >= 65) throw new Error('人体骨架遍历顺序无效。');
    const parent = value.nativeJointParents[index];
    if (typeof value.nativeJointNames[index] !== 'string' || !value.nativeJointNames[index]
      || !Number.isInteger(parent) || parent < -1 || parent >= 65 || parent === index || (parent >= 0 && !seen.has(parent))
      || !tuple(value.sourceLocalTranslation[index], 3) || !tuple(value.sourceLocalRotation[index], 4)
      || Math.abs(Math.hypot(...value.sourceLocalRotation[index]) - 1) > 1e-5
      || !tuple(value.sourceLocalScale[index], 3) || value.sourceLocalScale[index].some(scale => scale < .99 || scale > 1.01)
      || !tuple(value.sourceBindWorld[index], 16) || !tuple(value.sourceInverseBindWorld[index], 16)) throw new Error('人体原生骨架校准无效。');
    for (const frame of [value.sourceBindWorld[index], value.sourceInverseBindWorld[index]]) {
      if (Math.abs(matrix(frame).determinant()) < 1e-9 || Math.abs(frame[3]) > 1e-6 || Math.abs(frame[7]) > 1e-6
        || Math.abs(frame[11]) > 1e-6 || Math.abs(frame[15] - 1) > 1e-6) throw new Error('人体原生绑定矩阵无效。');
    }
    const local = new THREE.Matrix4().compose(vector(value.sourceLocalTranslation[index]), quaternion(value.sourceLocalRotation[index]), vector(value.sourceLocalScale[index]));
    const world = parent < 0 ? local : matrix(value.sourceBindWorld[parent]).multiply(local);
    if (maximumDifference(world.elements, value.sourceBindWorld[index]) > 1e-5
      || maximumDifference(matrix(value.sourceBindWorld[index]).multiply(matrix(value.sourceInverseBindWorld[index])).elements, new THREE.Matrix4().elements) > 1e-5) throw new Error('人体原生关节轴与绑定矩阵不匹配。');
    seen.add(index);
  }
  if (value.nativeJointParents.filter(parent => parent < 0).length !== 1 || value.nativeJointNames[value.nativeJointParents.indexOf(-1)] !== 'root'
    || Object.keys(QUATERNIUS_PRIMARY_JOINT_MAPPING).some(name => !value.nativeJointNames.includes(name))
    || !value.nativeJointNames.includes('spine_02')) throw new Error('人体编辑关节映射不完整。');
}

export type QuaterniusRigController = { update(): void; dispose(): void };
export type QuaterniusCalibration = {
  schema: 'quaternius-canonical-display-2';
  canonicalRig: 'neutral-rig-2';
  primaryJointMapping: Readonly<Record<string, JointName>>;
  neutralAuthorRootY: number;
  armDownDegrees: number;
  footSurfaceDepthMeters: number;
  targetHeadTopWorldMeters: number;
  sourceBodySimilarity: number[];
  bodySimilarityAnchor: 'source-sole-to-stage-ground';
  bodyDepthAnchor: 'mean-source-upperarm-to-canonical-upperarm';
  sourceBodyJointNames: string[];
  headFitOriginSourceBone: null;
  sourceUniformScale: number;
  spine2Fraction: number;
  neutralWorldRotations: number[][];
  boneScales: number[][];
  neutralWorldFrames: number[][];
  skinBindAdjustments: number[][];
  footVerticalFactors: number[];
  headVerticalFactor: number;
};

/** Declarative, pose-independent display calibration. Raw glTF frames and IBM
 * remain separately validated; these fixed matrices bind that native surface
 * to the unchanged editor pivots. There is no learned corrective or per-pose
 * bone-length fitting. */
export function createQuaterniusCalibration(description: QuaterniusRigDescription): QuaterniusCalibration {
  validateQuaterniusRigDescription(description);
  const names = description.nativeJointNames, parents = description.nativeJointParents;
  const source = description.sourceBindWorld.map(matrix);
  const sourcePositions = source.map(frame => new THREE.Vector3().setFromMatrixPosition(frame));
  const sourceRotations = source.map(frame => { const position = new THREE.Vector3(), rotation = new THREE.Quaternion(), scale = new THREE.Vector3(); frame.decompose(position, rotation, scale); return rotation.normalize(); });
  const sourceScales = source.map(frame => { const position = new THREE.Vector3(), rotation = new THREE.Quaternion(), scale = new THREE.Vector3(); frame.decompose(position, rotation, scale); return scale; });
  const uniformScale = 1.85 / description.sourceHeightMeters;
  const rotations = sourceRotations.map(rotation => rotation.clone());
  const scales = sourceScales.map(scale => scale.clone().multiplyScalar(uniformScale));
  for (const suffix of ['l', 'r']) {
    for (const [start, end, targetLength] of [['upperarm', 'lowerarm', .285], ['lowerarm', 'hand', .255], ['thigh', 'calf', .46], ['calf', 'foot', .45]] as const) {
      const index = names.indexOf(`${start}_${suffix}`), child = names.indexOf(`${end}_${suffix}`);
      const displacement = sourcePositions[child].clone().sub(sourcePositions[index]);
      rotations[index].premultiply(new THREE.Quaternion().setFromUnitVectors(displacement.clone().normalize(), new THREE.Vector3(0, -1, 0))).normalize();
      // Native Y is the long segment axis. This is the complete final world
      // scale, not a ratio multiplied by the global scale a second time.
      scales[index].y = sourceScales[index].y * targetLength / displacement.length();
    }
    const hand = names.indexOf(`hand_${suffix}`), forearm = names.indexOf(`lowerarm_${suffix}`);
    rotations[hand].copy(rotations[forearm]).multiply(sourceRotations[forearm].clone().invert()).multiply(sourceRotations[hand]).normalize();
  }
  const spine2 = names.indexOf('spine_02'), spine3 = names.indexOf('spine_03');
  const fraction = vector(description.sourceLocalTranslation[spine2]).length()
    / (vector(description.sourceLocalTranslation[spine2]).length() + vector(description.sourceLocalTranslation[spine3]).length());
  const rest = evaluatePose({ root: [0, 0, 0], joints: Object.fromEntries(JOINT_NAMES.map(name => [name, [0, 0, 0, 1]])) as Pose['joints'] });
  const positions = source.map(() => new THREE.Vector3()), frames = source.map(() => new THREE.Matrix4());
  for (const index of description.topoOrder) {
    const name = names[index], primary = QUATERNIUS_PRIMARY_JOINT_MAPPING[name], parent = parents[index];
    if (primary) positions[index].copy(vector(rest[primary].position));
    else if (name === 'spine_02') positions[index].copy(vector(rest.Spine.position)).lerp(vector(rest.Chest.position), fraction);
    else if (parent < 0) positions[index].set(0, 0, 0);
    else {
      rotations[index].copy(rotations[parent]).multiply(quaternion(description.sourceLocalRotation[index])).normalize();
      const offset = sourcePositions[index].clone().sub(sourcePositions[parent]).applyQuaternion(sourceRotations[parent].clone().invert());
      offset.multiply(scales[parent]).divide(sourceScales[parent]).applyQuaternion(rotations[parent]);
      positions[index].copy(positions[parent]).add(offset);
      scales[index].copy(sourceScales[index]).multiplyScalar(uniformScale);
    }
    frames[index].compose(positions[index], rotations[index], scales[index]);
  }
  const adjustments = source.map(() => new THREE.Matrix4());
  const factors: number[] = [];
  const scaleAround = (origin: THREE.Vector3, y: number) => new THREE.Matrix4().makeTranslation(...origin.toArray() as [number, number, number])
    .multiply(new THREE.Matrix4().makeScale(1, y, 1)).multiply(new THREE.Matrix4().makeTranslation(-origin.x, -origin.y, -origin.z));
  for (const suffix of ['l', 'r']) {
    const foot = names.indexOf(`foot_${suffix}`), ball = names.indexOf(`ball_${suffix}`), leaf = names.indexOf(`ball_leaf_${suffix}`);
    const factor = .082 / ((sourcePositions[foot].y - description.sourceBounds.min[1]) * uniformScale); factors.push(factor);
    adjustments[foot].copy(frames[foot]).invert().multiply(scaleAround(positions[foot], factor)).multiply(frames[foot]);
    const neutralFootSkin = frames[foot].clone().multiply(adjustments[foot]).multiply(matrix(description.sourceInverseBindWorld[foot]));
    // Foot and toe keep one coherent original surface at rest, although the
    // native metatarsal pivot differs from the editor's read-only Toe pivot.
    for (const index of [ball, leaf]) adjustments[index].copy(frames[index]).invert().multiply(neutralFootSkin).multiply(source[index]);
  }
  // Torso/neck blended weights must all refer to one source rest surface.
  // Independently moving clavicle and chest skin to their control pivots made
  // a wide platform at the shoulders. Keep the user's source torso and head
  // silhouette while the physical editing frames remain the canonical ones.
  const shoulderDepth = (sourcePositions[names.indexOf('upperarm_l')].z + sourcePositions[names.indexOf('upperarm_r')].z) / 2;
  const bodySimilarity = new THREE.Matrix4().makeTranslation(0, -1.05 - description.sourceBounds.min[1] * uniformScale, -shoulderDepth * uniformScale)
    .multiply(new THREE.Matrix4().makeScale(uniformScale, uniformScale, uniformScale));
  const bodyNames = ['root', 'pelvis', 'spine_01', 'spine_02', 'spine_03', 'clavicle_l', 'clavicle_r', 'neck_01', 'Head'];
  for (const name of bodyNames) {
    const index = names.indexOf(name);
    adjustments[index].copy(frames[index]).invert().multiply(bodySimilarity).multiply(source[index]);
  }
  return {
    schema: 'quaternius-canonical-display-2', canonicalRig: 'neutral-rig-2', primaryJointMapping: QUATERNIUS_PRIMARY_JOINT_MAPPING,
    neutralAuthorRootY: 1.05, armDownDegrees: 0, footSurfaceDepthMeters: .082, targetHeadTopWorldMeters: 1.85,
    sourceBodySimilarity: [...bodySimilarity.elements], bodySimilarityAnchor: 'source-sole-to-stage-ground',
    bodyDepthAnchor: 'mean-source-upperarm-to-canonical-upperarm',
    sourceBodyJointNames: bodyNames, headFitOriginSourceBone: null,
    sourceUniformScale: uniformScale, spine2Fraction: fraction,
    neutralWorldRotations: rotations.map(rotation => rotation.toArray()), boneScales: scales.map(scale => scale.toArray()),
    neutralWorldFrames: frames.map(frame => [...frame.elements]), skinBindAdjustments: adjustments.map(frame => [...frame.elements]),
    footVerticalFactors: factors, headVerticalFactor: 1,
  };
}

export function quaterniusNeutralFrames(description: QuaterniusRigDescription): THREE.Matrix4[] {
  return createQuaterniusCalibration(description).neutralWorldFrames.map(matrix);
}

export function validateQuaterniusRuntimeCalibration(description: QuaterniusRigDescription): void {
  const value = description.runtimeCalibration, expected = createQuaterniusCalibration(description);
  if (!value || value.schema !== expected.schema || value.canonicalRig !== expected.canonicalRig
    || value.neutralAuthorRootY !== 1.05 || value.armDownDegrees !== 0 || value.footSurfaceDepthMeters !== .082 || value.targetHeadTopWorldMeters !== 1.85
    || value.bodySimilarityAnchor !== expected.bodySimilarityAnchor || value.bodyDepthAnchor !== expected.bodyDepthAnchor || value.headFitOriginSourceBone !== null
    || !tuple(value.sourceBodySimilarity, 16) || maximumDifference(value.sourceBodySimilarity, expected.sourceBodySimilarity) > 1e-8
    || !Array.isArray(value.sourceBodyJointNames) || value.sourceBodyJointNames.length !== expected.sourceBodyJointNames.length
    || value.sourceBodyJointNames.some((name, index) => name !== expected.sourceBodyJointNames[index])
    || Object.keys(value.primaryJointMapping ?? {}).length !== Object.keys(QUATERNIUS_PRIMARY_JOINT_MAPPING).length
    || Object.entries(QUATERNIUS_PRIMARY_JOINT_MAPPING).some(([name, joint]) => value.primaryJointMapping[name] !== joint)) throw new Error('人物显示标定版本不匹配。');
  for (const name of ['sourceUniformScale', 'spine2Fraction', 'headVerticalFactor'] as const) {
    if (!Number.isFinite(value[name]) || Math.abs(value[name] - expected[name]) > 1e-8) throw new Error('人物固定标定参数无效。');
  }
  if (!tuple(value.footVerticalFactors, 2) || maximumDifference(value.footVerticalFactors, expected.footVerticalFactors) > 1e-8) throw new Error('人物脚底标定无效。');
  for (const [name, size] of [['neutralWorldRotations', 4], ['boneScales', 3], ['neutralWorldFrames', 16], ['skinBindAdjustments', 16]] as const) {
    if (!Array.isArray(value[name]) || value[name].length !== 65 || value[name].some((row, index) => !tuple(row, size)
      || maximumDifference(row, expected[name][index]) > 1e-8)) throw new Error('人物固定蒙皮标定与来源不匹配。');
  }
}

// Each mesh owns its cloned raw IBM. Reusing an already-bound surface would
// multiply the fixed adjustment twice; reject that programming error instead.
const boundSurfaces = new WeakSet<THREE.SkinnedMesh>();

/** Internal display bones never mutate the canonical author rig or its data. */
export function createQuaterniusRigController(
  mesh: THREE.SkinnedMesh,
  canonicalJoints: ReadonlyMap<JointName, THREE.Bone>,
  description: QuaterniusRigDescription,
): QuaterniusRigController {
  validateQuaterniusRigDescription(description);
  validateQuaterniusRuntimeCalibration(description);
  const bones = mesh.skeleton.bones, names = description.nativeJointNames, parents = description.nativeJointParents;
  if (bones.length !== 65 || bones.some((bone, index) => bone.name !== names[index])
    || !mesh.geometry.getAttribute('position') || mesh.geometry.getAttribute('position').count !== description.vertexCount) throw new Error('人体蒙皮与原生骨架不匹配。');
  if (JOINT_NAMES.some(name => !canonicalJoints.get(name))) throw new Error('人体编辑骨架缺少关节。');
  if (boundSurfaces.has(mesh)) throw new Error('人物蒙皮表面已经完成固定标定。');
  const calibration = description.runtimeCalibration!;
  const neutral = calibration.neutralWorldFrames.map(matrix);
  const neutralPosition = bones.map(() => new THREE.Vector3()), neutralRotation = bones.map(() => new THREE.Quaternion()), neutralScale = bones.map(() => new THREE.Vector3());
  neutral.forEach((frame, index) => frame.decompose(neutralPosition[index], neutralRotation[index], neutralScale[index]));
  const offsets = neutralPosition.map((position, index) => parents[index] < 0 ? position.clone()
    : position.clone().sub(neutralPosition[parents[index]]).applyQuaternion(neutralRotation[parents[index]].clone().invert()));
  const rotations = bones.map(() => new THREE.Quaternion()), positions = bones.map(() => new THREE.Vector3()), frames = bones.map(() => new THREE.Matrix4());
  const signature = new Float64Array(JOINT_NAMES.length * 4).fill(Number.NaN);
  const localRotations = neutralRotation.map((rotation, index) => parents[index] < 0 ? rotation.clone()
    : neutralRotation[parents[index]].clone().invert().multiply(rotation));
  const scratch = new THREE.Matrix4();
  let disposed = false;
  boundSurfaces.add(mesh);
  // SkeletonUtils can share both the array and its matrix entries. Own a new
  // array of new display matrices before touching this skeleton's bind.
  mesh.skeleton.boneInverses = mesh.skeleton.boneInverses.map((inverse, index) => matrix(calibration.skinBindAdjustments[index]).multiply(inverse));
  for (let index = 0; index < bones.length; index++) {
    bones[index].matrixAutoUpdate = false;
    const name = names[index];
    bones[index].userData.editorJoint = QUATERNIUS_PRIMARY_JOINT_MAPPING[name]
      ?? (name === 'spine_02' ? 'Chest' : name === 'ball_leaf_l' ? 'LeftFoot' : name === 'ball_leaf_r' ? 'RightFoot'
        : name.endsWith('_l') ? 'LeftHand' : name.endsWith('_r') ? 'RightHand' : 'Hips');
  }
  const spineFraction = calibration.spine2Fraction;
  function update() {
    if (disposed) return;
    let changed = false;
    const joints = {} as Pose['joints'];
    for (let index = 0; index < JOINT_NAMES.length; index++) {
      const name = JOINT_NAMES[index], bone = canonicalJoints.get(name);
      if (!bone) throw new Error('人体编辑骨架缺少关节。');
      const values = bone.quaternion.toArray() as Pose['joints'][JointName];
      joints[name] = values;
      for (let component = 0; component < 4; component++) if (values[component] !== signature[index * 4 + component]) changed = true;
    }
    if (!changed) return;
    const evaluated = evaluatePose({ root: [0, 0, 0], joints });
    const authorPosition = Object.fromEntries(JOINT_NAMES.map(name => [name, vector(evaluated[name].position)])) as Record<JointName, THREE.Vector3>;
    const authorRotation = Object.fromEntries(JOINT_NAMES.map(name => [name, quaternion(evaluated[name].rotation)])) as Record<JointName, THREE.Quaternion>;
    for (const index of description.topoOrder) {
      const name = names[index], parent = parents[index], primary = QUATERNIUS_PRIMARY_JOINT_MAPPING[name];
      if (parent < 0) { positions[index].copy(offsets[index]); rotations[index].copy(authorRotation.Hips).multiply(neutralRotation[index]); }
      else {
        if (primary) { positions[index].copy(authorPosition[primary]); rotations[index].multiplyQuaternions(authorRotation[primary], neutralRotation[index]); }
        else if (name === 'spine_02') { positions[index].copy(authorPosition.Spine).lerp(authorPosition.Chest, spineFraction); rotations[index].copy(authorRotation.Spine).slerp(authorRotation.Chest, spineFraction).multiply(neutralRotation[index]); }
        else { positions[index].copy(offsets[index]).applyQuaternion(rotations[parent]).add(positions[parent]); rotations[index].copy(rotations[parent]).multiply(localRotations[index]); }
      }
      frames[index].compose(positions[index], rotations[index], neutralScale[index]);
      bones[index].matrix.copy(parent < 0 ? frames[index] : scratch.copy(frames[parent]).invert().multiply(frames[index]));
      bones[index].matrixWorldNeedsUpdate = true;
    }
    mesh.updateMatrixWorld(true);
    for (let index = 0; index < JOINT_NAMES.length; index++) signature.set(joints[JOINT_NAMES[index]], index * 4);
  }
  return { update, dispose() { disposed = true; } };
}
