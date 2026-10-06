/** Preview coordinates: right handed, meters, +Y up and +Z forward. */
export type Vec3 = [number, number, number];
/** Parent-relative rotation in XYZW order. */
export type Quat = [number, number, number, number];

export const JOINT_NAMES = [
  'Hips', 'Spine', 'Chest', 'Neck', 'Head',
  'LeftShoulder', 'LeftUpperArm', 'LeftForeArm', 'LeftHand', 'LeftHandTip',
  'RightShoulder', 'RightUpperArm', 'RightForeArm', 'RightHand', 'RightHandTip',
  'LeftUpperLeg', 'LeftLowerLeg', 'LeftFoot', 'LeftToe', 'LeftHeel',
  'RightUpperLeg', 'RightLowerLeg', 'RightFoot', 'RightToe', 'RightHeel',
] as const;
export type JointName = typeof JOINT_NAMES[number];
export interface Pose { root: Vec3; joints: Record<JointName, Quat> }

export interface BakedTake {
  id: string;
  schemaVersion: 'preview-1';
  planId: string;
  countMapId: string;
  durationSeconds: number;
  /** Explicit times, including exact duration and every arrangement boundary. */
  times: number[];
  poses: Pose[];
  provenance: 'synthetic-demo';
}
