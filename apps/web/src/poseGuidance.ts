import { EDITABLE_JOINT_NAMES, isJointRotationWithinLimits, type JointName, type Pose, type Quat } from '../../../packages/core/src';

export interface PoseGuidance {
  /** Read-only diagnostics: never repair imported, keyed or interpolated poses. */
  outsideSuggestedRange: JointName[];
  shoulderCoupling: ('Left' | 'Right')[];
}

/** Swing of the canonical downward limb axis; invariant under q -> -q. */
function limbSwingDegrees(rotation: Quat): number {
  const [x, y, z, w] = rotation;
  const normSquared = x * x + y * y + z * z + w * w;
  return Math.acos(Math.max(-1, Math.min(1, 1 - 2 * (x * x + z * z) / normSquared))) * 180 / Math.PI;
}

/**
 * Editing guidance, not clinical ROM or proof of whole-body feasibility.
 * Large isolated upper-arm swings deserve shoulder-girdle review even when
 * each independent local limit passes. The 120/5 degree thresholds are a
 * conservative review cue; they do not implement scapulohumeral coupling.
 */
export function getPoseGuidance(pose: Pose | null): PoseGuidance {
  if (!pose) return { outsideSuggestedRange: [], shoulderCoupling: [] };
  return {
    outsideSuggestedRange: EDITABLE_JOINT_NAMES.filter(joint => !isJointRotationWithinLimits(joint, pose.joints[joint])),
    shoulderCoupling: (['Left', 'Right'] as const).filter(side =>
      limbSwingDegrees(pose.joints[`${side}UpperArm`]) > 120 + 1e-7 &&
      limbSwingDegrees(pose.joints[`${side}Shoulder`]) < 5 - 1e-7),
  };
}
