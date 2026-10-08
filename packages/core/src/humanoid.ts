import { Quaternion, Vector3 } from 'three';
import { JOINT_NAMES, type JointName, type Pose, type Quat, type Vec3 } from './motion-types';

export type RigDefinition = { readonly name: JointName; readonly parent: JointName | null; readonly offset: readonly [number, number, number] };
/** Fixed natural-shoulder calibration: meters, right handed, +Y up and +Z forward. */
export const RIG_CALIBRATION_VERSION = 'neutral-rig-2' as const;
const definitions: RigDefinition[] = [
  { name: 'Hips', parent: null, offset: [0, 0, 0] },
  { name: 'Spine', parent: 'Hips', offset: [0, 0.14, 0] },
  { name: 'Chest', parent: 'Spine', offset: [0, 0.2, 0] },
  { name: 'Neck', parent: 'Chest', offset: [0, 0.19, 0] },
  { name: 'Head', parent: 'Neck', offset: [0, 0.08, 0] },
  ...(['Left', 'Right'] as const).flatMap(side => {
    const sign = side === 'Left' ? 1 : -1;
    return [
      // Place the clavicle pivot inside the chest and the humerus at 21 cm.
      // FK, IK, skin bind matrices and physical proxies share these offsets.
      { name: `${side}Shoulder`, parent: 'Chest', offset: [sign * 0.100, 0.095, 0] },
      { name: `${side}UpperArm`, parent: `${side}Shoulder`, offset: [sign * 0.110, -0.03, 0] },
      { name: `${side}ForeArm`, parent: `${side}UpperArm`, offset: [0, -0.285, 0] },
      { name: `${side}Hand`, parent: `${side}ForeArm`, offset: [0, -0.255, 0] },
      { name: `${side}HandTip`, parent: `${side}Hand`, offset: [0, -0.115, 0] },
      { name: `${side}UpperLeg`, parent: 'Hips', offset: [sign * 0.112, -0.05, 0] },
      { name: `${side}LowerLeg`, parent: `${side}UpperLeg`, offset: [0, -0.46, 0] },
      { name: `${side}Foot`, parent: `${side}LowerLeg`, offset: [0, -0.45, 0] },
      { name: `${side}Toe`, parent: `${side}Foot`, offset: [0, -0.035, 0.15] },
      { name: `${side}Heel`, parent: `${side}Foot`, offset: [0, -0.035, -0.065] },
    ] as RigDefinition[];
  }),
];
export const RIG_DEFINITIONS: readonly RigDefinition[] = Object.freeze(definitions.map(definition => Object.freeze({ ...definition, offset: Object.freeze([...definition.offset]) as RigDefinition['offset'] })));

export type EvaluatedPose = Record<JointName, { position: Vec3; rotation: Quat }>;
export function clonePose(pose: Pose): Pose {
  return { root: [...pose.root], joints: Object.fromEntries(JOINT_NAMES.map(name => [name, [...pose.joints[name]]])) as Pose['joints'] };
}

/** Shared FK for the renderer, IK and physical diagnostics. Never repairs motion. */
export function evaluatePose(pose: Pose): EvaluatedPose {
  if (!pose || !Array.isArray(pose.root) || pose.root.length !== 3 || pose.root.some(value => !Number.isFinite(value))) throw new Error('人体 Root 必须是三个有限坐标。');
  const result = {} as EvaluatedPose;
  for (const { name, parent, offset } of RIG_DEFINITIONS) {
    const local = pose.joints?.[name];
    if (!Array.isArray(local) || local.length !== 4 || local.some(value => !Number.isFinite(value)) || !Number.isFinite(Math.hypot(...local)) || Math.hypot(...local) < 1e-12 || Math.max(...local.map(Math.abs)) > 1e150) throw new Error('人体关节必须是有效 XYZW 四元数。');
    const rotation = new Quaternion(...local).normalize();
    const position = new Vector3(...offset);
    if (parent) {
      const ancestor = result[parent];
      const parentRotation = new Quaternion(...ancestor.rotation);
      position.applyQuaternion(parentRotation).add(new Vector3(...ancestor.position));
      rotation.premultiply(parentRotation);
    } else position.add(new Vector3(...pose.root));
    result[name] = { position: position.toArray() as Vec3, rotation: rotation.normalize().toArray() as Quat };
  }
  return result;
}
