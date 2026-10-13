import { CAPSULE_FLOOR_TOLERANCE_METERS, getCapsuleCollisions } from '../../../packages/core/src/capsuleCollision';
import { JOINT_NAMES } from '../../../packages/core/src/motion-types';
import { CANONICAL_MOTION_FEASIBILITY_PROFILE, getMotionMinimumFloorHeight, isFunctionalJointWithinLimits } from '../../../packages/core/src/motionFeasibility';
import { loadRapierBackend } from '../../../packages/core/src/rapierBackend';
import type { AIMotionRequest } from '../../../packages/core/src/aiMotion';

export const INFEASIBLE_MOTION_SOURCE = '原动作在固定端点超出当前人体约束，无法保持端点生成；请调整选区或新建场景。';
// Match the final generation gate's existing 3mm floor tolerance and numerical
// rounding allowance, including the native Foot hull beyond the legacy sole.
const FLOOR_TOLERANCE_METERS = CAPSULE_FLOOR_TOLERANCE_METERS + 2e-8;
const cancelled = (signal?: AbortSignal) => { if (signal?.aborted) throw new DOMException('生成已取消。', 'AbortError'); };

/** Reject an already incompatible immutable endpoint before spending a model
 * request. This checks pose geometry only; the offline solver still checks all
 * interpolation, velocities, contacts and boundaries before candidate adoption. */
export async function checkAIMotionSourceBoundaries(request: AIMotionRequest, signal?: AbortSignal): Promise<void> {
  cancelled(signal);
  await loadRapierBackend();
  cancelled(signal);
  const profile = CANONICAL_MOTION_FEASIBILITY_PROFILE;
  const boundaries = [request.context.boundaries.start,
    ...(request.context.target.mode === 'interval' ? [request.context.boundaries.end] : [])];
  for (const boundary of boundaries) {
    if (JOINT_NAMES.some(joint => !isFunctionalJointWithinLimits(joint, boundary.pose.joints[joint], profile))) throw new Error(INFEASIBLE_MOTION_SOURCE);
    const collisions = getCapsuleCollisions(boundary.pose, profile.bodyProfile);
    if (collisions.selfCollisions.length || getMotionMinimumFloorHeight(boundary.pose, profile.bodyProfile) < -FLOOR_TOLERANCE_METERS) throw new Error(INFEASIBLE_MOTION_SOURCE);
  }
  cancelled(signal);
}
