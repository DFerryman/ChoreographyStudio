import * as THREE from 'three';
import { evaluatePose, JOINT_NAMES, type JointName, type Pose } from '../../../packages/core/src';
import { MHRPoseCorrectives } from './MHRCorrectives';

/** Original MHR bind frames remain independently validated by the loader. */
export type MHRRigDescription = {
  version: number;
  nativeJointCount: number;
  vertexCount: number;
  nativeJointNames: readonly string[];
  nativeJointParents: readonly number[];
  jointNames?: readonly string[];
  jointParents?: readonly number[];
  sourcePreRotations: readonly (readonly number[])[];
  sourceOffsetsMeters: readonly (readonly number[])[];
  sourceBindWorld: readonly (readonly number[])[];
  sourceRootOriginMeters: readonly number[];
  primaryJointMapping: Readonly<Record<string, JointName>>;
  neutralWorldRotations: readonly (readonly number[])[];
  spine0Fraction: number;
  spine2Fraction: number;
  boneScales: readonly (readonly number[])[];
  /** Fixed rest-shape calibration, applied to base and learned PSD together. */
  skinBindAdjustments: readonly (readonly number[])[];
};
export type MHRRigController = { update(): void; dispose(): void };
export const MHR_PRIMARY_JOINT_MAPPING: Readonly<Record<string, JointName>> = Object.freeze({
  root: 'Hips', c_spine1: 'Spine', c_spine3: 'Chest', c_neck: 'Neck', c_head: 'Head',
  ...Object.fromEntries((['l', 'r'] as const).flatMap(prefix => {
    const side = prefix === 'l' ? 'Left' : 'Right';
    return ([['clavicle', 'Shoulder'], ['uparm', 'UpperArm'], ['lowarm', 'ForeArm'], ['wrist', 'Hand'], ['upleg', 'UpperLeg'], ['lowleg', 'LowerLeg'], ['foot', 'Foot'], ['ball', 'Toe']] as const).map(([native, author]) => [`${prefix}_${native}`, `${side}${author}` as JointName]);
  })),
});


const vector = (values: readonly number[]) => new THREE.Vector3(values[0], values[1], values[2]);
const quaternion = (values: readonly number[]) => new THREE.Quaternion(values[0], values[1], values[2], values[3]).normalize();
const finiteTuple = (value: unknown, size: number): value is number[] => Array.isArray(value) && value.length === size && value.every(v => typeof v === 'number' && Number.isFinite(v));

/** A fractional principal-angle twist has a seam at +/- pi. Preserve normal
 * anatomical rolls, then fade only private deformation guidance to the same
 * state at both half-turn endpoints. No previous-frame unwrap is involved. */
function periodicTwist(angle: number): number {
  const wrapped = Math.atan2(Math.sin(angle), Math.cos(angle));
  const start = Math.PI * 2 / 3;
  const amount = THREE.MathUtils.clamp((Math.abs(wrapped) - start) / (Math.PI - start), 0, 1);
  const fade = amount ** 3 * (10 + amount * (-15 + 6 * amount));
  return wrapped * (1 - fade);
}

/** Native X is the longitudinal bone axis. Swing/twist becomes undefined for
 * a perpendicular half-turn; fade its projection smoothly rather than letting
 * tiny floating-point signs choose opposing twists. q and -q are equivalent. */
function axialTwist(q: THREE.Quaternion): number {
  const projection = q.x * q.x + q.w * q.w;
  if (projection < 1e-24) return 0;
  const sign = q.w < 0 || (q.w === 0 && q.x < 0) ? -1 : 1;
  return periodicTwist(2 * Math.atan2(sign * q.x, sign * q.w)) * projection / (projection + .0001);
}

/** Do not infer a rig from names: native rest axes and source ordering matter. */
export function validateMHRRigDescription(value: MHRRigDescription): void {
  if (!value || value.version !== 1 || value.nativeJointCount !== 127 || value.vertexCount !== 4899
    || value.nativeJointNames?.length !== 127 || new Set(value.nativeJointNames).size !== 127
    || value.nativeJointParents?.length !== 127 || value.sourcePreRotations?.length !== 127
    || value.sourceBindWorld?.length !== 127 || value.sourceOffsetsMeters?.length !== 127
    || value.neutralWorldRotations?.length !== 127 || value.boneScales?.length !== 127
    || value.skinBindAdjustments?.length !== 127 || !finiteTuple(value.sourceRootOriginMeters, 3)
    || !Number.isFinite(value.spine0Fraction) || value.spine0Fraction <= 0 || value.spine0Fraction >= 1
    || !Number.isFinite(value.spine2Fraction) || value.spine2Fraction <= 0 || value.spine2Fraction >= 1) throw new Error('人体模型校准数据无效。');
  for (let i = 0; i < 127; i++) {
    const parent = value.nativeJointParents[i];
    if (typeof value.nativeJointNames[i] !== 'string' || !Number.isInteger(parent) || parent < -1 || parent >= i
      || (i === 0 ? parent !== -1 : parent < 0)
      || !finiteTuple(value.sourcePreRotations[i], 4) || Math.abs(Math.hypot(...value.sourcePreRotations[i]) - 1) > 1e-5
      || !finiteTuple(value.neutralWorldRotations[i], 4) || Math.abs(Math.hypot(...value.neutralWorldRotations[i]) - 1) > 1e-5
      || !finiteTuple(value.sourceOffsetsMeters[i], 3) || !finiteTuple(value.sourceBindWorld[i], 16)
      || !finiteTuple(value.boneScales[i], 3) || value.boneScales[i].some(s => s <= .1 || s > 3)
      || !finiteTuple(value.skinBindAdjustments[i], 16)) throw new Error('人体骨架校准数据无效。');
    for (const values of [value.sourceBindWorld[i], value.skinBindAdjustments[i]]) {
      const m = new THREE.Matrix4().fromArray([...values]);
      if (Math.abs(m.determinant()) < 1e-9 || Math.abs(values[3]) > 1e-6 || Math.abs(values[7]) > 1e-6 || Math.abs(values[11]) > 1e-6 || Math.abs(values[15] - 1) > 1e-6) throw new Error('人体蒙皮矩阵无效。');
    }
  }
  const mappings = Object.entries(value.primaryJointMapping ?? {});
  if (mappings.length !== Object.keys(MHR_PRIMARY_JOINT_MAPPING).length || new Set(mappings.map(([, author]) => author)).size !== mappings.length
    || mappings.some(([native, author]) => MHR_PRIMARY_JOINT_MAPPING[native] !== author)
    || Object.entries(MHR_PRIMARY_JOINT_MAPPING).some(([native, author]) => value.primaryJointMapping[native] !== author || !value.nativeJointNames.includes(native))) throw new Error('人体编辑映射无效。');
  // MHR parameter deltas are pre-relative. A forged pre quaternion/offset
  // would produce plausible bones but feed a different pose into correctives.
  const rest = value.sourceBindWorld.map(values => new THREE.Matrix4().fromArray([...values]));
  for (let i = 0; i < 127; i++) {
    const local = new THREE.Matrix4().compose(vector(value.sourceOffsetsMeters[i]), quaternion(value.sourcePreRotations[i]), new THREE.Vector3(1, 1, 1));
    const parent = value.nativeJointParents[i];
    const expected = parent < 0 ? local : rest[parent].clone().multiply(local);
    if (expected.elements.some((number, at) => Math.abs(number - rest[i].elements[at]) > 1e-5)) throw new Error('人体原生关节轴与绑定姿态不匹配。');
  }
}

/** Native mesh bones belong to the loader. This controller never creates or
 * changes the canonical author rig, its stored rotations, Root, or IK targets. */
export function createMHRRigController(
  mesh: THREE.SkinnedMesh,
  canonicalJoints: ReadonlyMap<JointName, THREE.Bone>,
  correctives: MHRPoseCorrectives,
  description: MHRRigDescription,
): MHRRigController {
  validateMHRRigDescription(description);
  if (mesh.skeleton.bones.length !== 127 || correctives.vertexCount !== 4899) throw new Error('人体蒙皮与骨架不匹配。');
  const names = description.nativeJointNames;
  const parents = description.nativeJointParents;
  const index = new Map(names.map((name, i) => [name, i]));
  const bones = mesh.skeleton.bones;
  const bind = description.sourceBindWorld.map(values => new THREE.Matrix4().fromArray([...values]));
  const sourcePosition = bind.map(matrix => new THREE.Vector3().setFromMatrixPosition(matrix));
  const sourceRotation = bind.map(matrix => new THREE.Quaternion().setFromRotationMatrix(matrix).normalize());
  const pre = description.sourcePreRotations.map(quaternion);
  const neutral = description.neutralWorldRotations.map(quaternion);
  const scales = description.boneScales.map(vector);
  const neutralParameter = neutral.map((q, i) => pre[i].clone().invert()
    .multiply((parents[i] < 0 ? new THREE.Quaternion() : neutral[parents[i]].clone()).invert()).multiply(q).normalize());
  const neutralEulerX = neutralParameter.map(q => new THREE.Euler().setFromQuaternion(q, 'ZYX').x);
  const axialDelta = new THREE.Quaternion();
  // q0^-1*q = neutralChild^-1 * authorParent^-1 * authorChild *
  // neutralChild. This removes the down-arm preset and measures authored roll
  // in the native bone's neutral axis, not a swing mixed into Euler.rx.
  const axialGuide = (q: THREE.Quaternion, driver: number) => periodicTwist(neutralEulerX[driver]
    + axialTwist(axialDelta.copy(neutralParameter[driver]).invert().multiply(q)));
  const position = bones.map(() => new THREE.Vector3());
  const rotation = bones.map(() => new THREE.Quaternion());
  const world = bones.map(() => new THREE.Matrix4());
  const parameter = bones.map(() => new THREE.Quaternion());
  const parameterQuaternions = new Float32Array(127 * 4);
  const correction = new Float32Array(4899 * 3);
  const scratchQuaternion = new THREE.Quaternion();
  const scratchVector = new THREE.Vector3();
  const scratchMatrix = new THREE.Matrix4();
  const signature = new Float64Array(JOINT_NAMES.length * 4).fill(Number.NaN);
  let disposed = false;
  const points = mesh.geometry.getAttribute('position');
  if (!points || points.count !== 4899 || points.itemSize !== 3) throw new Error('人体表面与骨架不匹配。');
  const base = new Float32Array(4899 * 3);
  for (let vertex = 0; vertex < 4899; vertex++) {
    base[vertex * 3] = points.getX(vertex); base[vertex * 3 + 1] = points.getY(vertex); base[vertex * 3 + 2] = points.getZ(vertex);
  }
  if (points instanceof THREE.BufferAttribute) points.setUsage(THREE.DynamicDrawUsage);
  else points.data.setUsage(THREE.DynamicDrawUsage);
  const originalInverses = mesh.skeleton.boneInverses.map(matrix => matrix.clone());
  const shapeAdjustments = description.skinBindAdjustments.map(values => new THREE.Matrix4().fromArray([...values]));
  for (let i = 0; i < 127; i++) {
    if (bones[i].name !== names[i]) throw new Error('人体骨架顺序不匹配。');
    bones[i].matrixAutoUpdate = false;
    // Base geometry and decoded PSD pass through the same fixed calibration.
    mesh.skeleton.boneInverses[i].multiplyMatrices(shapeAdjustments[i], originalInverses[i]);
    let owner = description.primaryJointMapping[names[i]];
    if (!owner && names[i] === 'c_spine0') owner = 'Spine';
    if (!owner && names[i] === 'c_spine2') owner = 'Chest';
    if (!owner && /^[lr]_eye(?:_null)?$/.test(names[i])) owner = 'Head';
    if (!owner && names[i].startsWith('l_')) owner = names[i].includes('upleg') ? 'LeftUpperLeg' : names[i].includes('lowleg') ? 'LeftLowerLeg' : names[i].includes('uparm') ? 'LeftUpperArm' : names[i].includes('lowarm') ? 'LeftForeArm' : /foot|talocrural|subtalar|transversetarsal|ball/.test(names[i]) ? 'LeftFoot' : 'LeftHand';
    if (!owner && names[i].startsWith('r_')) owner = names[i].includes('upleg') ? 'RightUpperLeg' : names[i].includes('lowleg') ? 'RightLowerLeg' : names[i].includes('uparm') ? 'RightUpperArm' : names[i].includes('lowarm') ? 'RightForeArm' : /foot|talocrural|subtalar|transversetarsal|ball/.test(names[i]) ? 'RightFoot' : 'RightHand';
    if (!owner && names[i].includes('neck')) owner = 'Neck';
    if (!owner && names[i].startsWith('c_')) owner = 'Head';
    bones[i].userData.editorJoint = owner ?? 'Hips';
  }

  function update() {
    if (disposed) return;
    let changed = false;
    const joints = {} as Pose['joints'];
    for (let j = 0; j < JOINT_NAMES.length; j++) {
      const name = JOINT_NAMES[j]; const bone = canonicalJoints.get(name);
      if (!bone) throw new Error('人体编辑骨架缺少关节。');
      const values = bone.quaternion.toArray() as [number, number, number, number];
      joints[name] = values;
      for (let k = 0; k < 4; k++) {
        const at = j * 4 + k;
        if (values[k] !== signature[at]) changed = true;
      }
    }
    if (!changed) return;
    // Local author channels are independent of the outer Root/mirror transform.
    const evaluated = evaluatePose({ root: [0, 0, 0], joints });
    const authorPosition = Object.fromEntries(JOINT_NAMES.map(name => [name, vector(evaluated[name].position)])) as Record<JointName, THREE.Vector3>;
    const authorRotation = Object.fromEntries(JOINT_NAMES.map(name => [name, quaternion(evaluated[name].rotation)])) as Record<JointName, THREE.Quaternion>;
    for (let i = 0; i < 127; i++) {
      const name = names[i]; const parent = parents[i]; const primary = description.primaryJointMapping[name];
      const parentRotation = parent >= 0 ? rotation[parent] : new THREE.Quaternion();
      if (name === 'body_world') {
        rotation[i].copy(sourceRotation[i]); position[i].copy(sourcePosition[i]);
      } else if (primary) {
        rotation[i].multiplyQuaternions(authorRotation[primary], neutral[i]); position[i].copy(authorPosition[primary]);
      } else if (name === 'c_spine0' || name === 'c_spine2') {
        const lower = name === 'c_spine0' ? 'Hips' : 'Spine'; const upper = name === 'c_spine0' ? 'Spine' : 'Chest';
        const fraction = name === 'c_spine0' ? description.spine0Fraction : description.spine2Fraction;
        rotation[i].copy(authorRotation[lower]).slerp(authorRotation[upper], fraction).multiply(neutral[i]);
        position[i].copy(authorPosition[lower]).lerp(authorPosition[upper], fraction);
      } else if (name.includes('_twist') && name.endsWith('_proc')) {
        const split = name.lastIndexOf('_twist'); const stem = name.slice(0, split); const segment = Number(name[split + 6]);
        let lower: JointName; let upper: JointName; let amount: number; let factor: number; let twist: number;
        if (/uparm$|upleg$/.test(stem)) {
          lower = description.primaryJointMapping[stem]; upper = description.primaryJointMapping[stem.replace('uparm', 'lowarm').replace('upleg', 'lowleg')];
          amount = segment / 4; factor = -(1 - amount); twist = axialGuide(parameter[parent], parent);
        } else if (/lowarm$|lowleg$/.test(stem)) {
          lower = description.primaryJointMapping[stem]; const ending = stem.replace('lowarm', 'wrist').replace('lowleg', 'foot');
          upper = description.primaryJointMapping[ending];
          amount = segment / 5; factor = amount;
          // Preserve compact_v6_1's driver relationships and coefficients,
          // adapted to neutral-relative axial rolls for canonical author axes.
          // These deltas include the actual parent, pre frame and wrist chain.
          const driver = index.get(/lowarm$/.test(stem) ? ending + '_twist' : ending)!;
          twist = axialGuide(parameter[driver], driver);
        } else if (stem === 'c_neck') {
          lower = 'Neck'; upper = 'Head'; amount = segment / 2; factor = segment === 0 ? -1 : -.5;
          twist = axialGuide(parameter[parent], parent);
        } else throw new Error('人体变形骨架不匹配。');
        rotation[i].copy(parentRotation).multiply(pre[i]).multiply(scratchQuaternion.setFromAxisAngle(new THREE.Vector3(1, 0, 0), twist * factor));
        position[i].copy(authorPosition[lower]).lerp(authorPosition[upper], amount);
      } else if (name.endsWith('wrist_twist')) {
        const side = name.startsWith('l_') ? 'Left' : 'Right';
        const wrist = index.get(`${name[0]}_wrist`)!;
        // MHR separates axial forearm roll from wrist swing. Extract roll in
        // the native parameter frame; compensate the following wrist bone so
        // its final world orientation remains the exact authored Hand target.
        scratchQuaternion.copy(pre[i]).invert().multiply(parentRotation.clone().invert()).multiply(authorRotation[`${side}Hand`]).multiply(neutral[wrist]).multiply(pre[wrist].clone().invert());
        const twist = axialTwist(scratchQuaternion);
        rotation[i].copy(parentRotation).multiply(pre[i]).multiply(scratchQuaternion.setFromAxisAngle(new THREE.Vector3(1, 0, 0), twist)); position[i].copy(authorPosition[`${side}Hand`]);
      } else if (/^[lr]_(talocrural|subtalar|transversetarsal)$/.test(name)) {
        const side = name.startsWith('l_') ? 'Left' : 'Right'; const foot = index.get(`${name[0]}_foot`)!;
        rotation[i].multiplyQuaternions(authorRotation[`${side}Foot`], neutral[i]);
        scratchVector.copy(sourcePosition[i]).sub(sourcePosition[foot]).applyQuaternion(scratchQuaternion.copy(sourceRotation[foot]).invert()).applyQuaternion(neutral[foot]).applyQuaternion(authorRotation[`${side}Foot`]);
        position[i].copy(authorPosition[`${side}Foot`]).add(scratchVector);
      } else {
        rotation[i].copy(parentRotation).multiply(pre[i]);
        scratchVector.copy(sourcePosition[i]).sub(sourcePosition[parent]).applyQuaternion(scratchQuaternion.copy(sourceRotation[parent]).invert()).applyQuaternion(parentRotation);
        position[i].copy(position[parent]).add(scratchVector);
      }
      parameter[i].copy(pre[i]).invert().multiply(scratchQuaternion.copy(parentRotation).invert()).multiply(rotation[i]).normalize();
      parameter[i].toArray(parameterQuaternions, i * 4);
      world[i].compose(position[i], rotation[i], scales[i]);
      bones[i].matrix.copy(parent >= 0 ? scratchMatrix.copy(world[parent]).invert().multiply(world[i]) : world[i]);
      bones[i].matrixWorldNeedsUpdate = true;
    }
    correctives.evaluateQuaternions(parameterQuaternions, correction);
    for (let vertex = 0; vertex < 4899; vertex++) {
      const at = vertex * 3;
      points.setXYZ(vertex, base[at] + correction[at] * .01, base[at + 1] + correction[at + 1] * .01, base[at + 2] + correction[at + 2] * .01);
    }
    points.needsUpdate = true;
    mesh.geometry.computeVertexNormals();
    // World matrices include the one outer actor Root and viewing mirror.
    mesh.updateMatrixWorld(true);
    // Only cache a completed update: a failed evaluation must remain retryable.
    for (let j = 0; j < JOINT_NAMES.length; j++) signature.set(joints[JOINT_NAMES[j]], j * 4);
  }
  return { update, dispose() { disposed = true; } };
}
