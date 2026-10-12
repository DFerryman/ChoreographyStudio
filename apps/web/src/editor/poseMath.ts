import { getKeyframeProtection, JOINT_NAMES, sampleTake, type BakedTake, type FootLockProtection, type JointName, type KeyframeSequence, type Pose, type Quat, type Vec3 } from '../../../../packages/core/src';

/** Deep copy of an authored pose; drafts never alias stored Take samples. */
export const clonePose = (pose: Pose): Pose => ({
  root: [...pose.root],
  joints: Object.fromEntries(JOINT_NAMES.map(joint => [joint, [...pose.joints[joint]]])) as Pose['joints'],
});

/** Author intents protect their own channels from automatic foot-lock assistance. */
export function authorProtection(sequence: KeyframeSequence, frame: number, joints: ReadonlySet<JointName>, root: boolean): FootLockProtection {
  const protection = getKeyframeProtection(sequence, frame);
  return { ...protection, ...(root ? { root: 1 } : {}), joints: { ...protection.joints, ...Object.fromEntries([...joints].map(joint => [joint, 1])) } };
}

/** Sign-insensitive comparison of normalized quaternions. */
export function rotationsDiffer(a: Quat, b: Quat): boolean {
  const aLength = Math.hypot(...a), bLength = Math.hypot(...b);
  const sign = a.reduce((sum, value, axis) => sum + value * b[axis], 0) < 0 ? -1 : 1;
  return a.some((value, axis) => Math.abs(value / aLength - sign * b[axis] / bLength) > 1e-10);
}

export const rootsDiffer = (a: Vec3, b: Vec3) => a.some((value, axis) => Math.abs(value - b[axis]) > 1e-9);
export const posesDiffer = (a: Pose, b: Pose) => rootsDiffer(a.root, b.root) || JOINT_NAMES.some(joint => rotationsDiffer(a.joints[joint], b.joints[joint]));

/** Coarse motion classification used only for the realism diagnostics. */
export function motionIsDynamic(take: BakedTake | null, time: number): boolean {
  if (!take) return false;
  const first = Math.max(0, time - 1 / 30), last = Math.min(take.durationSeconds, time + 1 / 30);
  if (last <= first) return false;
  const a = sampleTake(take, first), mid = sampleTake(take, time), b = sampleTake(take, last), dt = last - first;
  const rootSpeed = (Math.hypot(...a.root.map((value, axis) => mid.root[axis] - value)) + Math.hypot(...mid.root.map((value, axis) => b.root[axis] - value))) / dt;
  return rootSpeed > .05 || JOINT_NAMES.some(joint => {
    const dotA = Math.min(1, Math.abs(a.joints[joint].reduce((sum, value, axis) => sum + value * mid.joints[joint][axis], 0)));
    const dotB = Math.min(1, Math.abs(mid.joints[joint].reduce((sum, value, axis) => sum + value * b.joints[joint][axis], 0)));
    return 2 * (Math.acos(dotA) + Math.acos(dotB)) / dt > .1;
  });
}
