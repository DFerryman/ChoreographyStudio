import { describe, expect, it } from 'vitest';
import { makeAIMotionFixture } from '../../../packages/core/src/aiMotion.fixture';
import { CAPSULE_FLOOR_TOLERANCE_METERS, getCapsuleCollisions } from '../../../packages/core/src/capsuleCollision';
import { rotationFromDegrees } from '../../../packages/core/src/keyframes';
import { JOINT_NAMES, type Pose } from '../../../packages/core/src/motion-types';
import { getMotionMinimumFloorHeight, isFunctionalJointWithinLimits } from '../../../packages/core/src/motionFeasibility';
import { loadRapierBackend } from '../../../packages/core/src/rapierBackend';
import { checkAIMotionSourceBoundaries } from './motionSourcePreflight';

function healthy(mode: 'full' | 'interval' = 'full') {
  const request = makeAIMotionFixture(mode);
  for (const pose of [request.context.initialPose, request.context.boundaries.start.pose, request.context.boundaries.end.pose]) {
    pose.joints.LeftUpperArm = rotationFromDegrees([0, 0, 15]);
    pose.joints.RightUpperArm = rotationFromDegrees([0, 0, -15]);
  }
  return request;
}
// Public CMU-derived curve at 3.425s: independently measured native toe skin
// penetrates 22.32mm while the unchanged legacy sole stays inside its tolerance.
function nativeToeRegressionPose(): Pose {
  const pose = healthy().context.boundaries.start.pose;
  pose.root = [-.015076188685033123, 1.0280235555128743, .15771091780693985];
  Object.assign(pose.joints, {
    Hips: [-.00022747522441921098, -.06581125343759978, -.026548379607932902, .9974788272019548],
    LeftUpperLeg: [-.03902566784456003, -.018991935637192477, .026566854932096658, .998704413652536],
    RightUpperLeg: [-.17374210757780723, -.002095786141733125, .002535021951426246, .9847856931325595],
    LeftLowerLeg: [.3715647496256995, .002445626547119249, .0009788420297135022, .9284033054737926],
    RightLowerLeg: [.2965475131896887, -.001419580280618679, -.00044039501664502374, .9550169439675233],
    LeftFoot: [-.02007733951380747, .04591162730210875, -.025121455768500348, .9984277316744516],
    RightFoot: [-.048240764154988736, -.04066261756962767, .05133071261561373, .9966867803620666],
  });
  return pose;
}
describe('immutable source preflight before AI cost', () => {
  it('checks new relaxed rest without mutating source, while rejecting old overlapping rest', async () => {
    const request = healthy(), before = JSON.stringify(request);
    await expect(checkAIMotionSourceBoundaries(request)).resolves.toBeUndefined();
    expect(JSON.stringify(request)).toBe(before);
    await expect(checkAIMotionSourceBoundaries(makeAIMotionFixture())).rejects.toThrow('固定端点');
  });
  it('locks both interval endpoints, but full generation replaces the old ending', async () => {
    const interval = healthy('interval');
    interval.context.boundaries.end.pose.joints.LeftForeArm = rotationFromDegrees([90, 0, 0]);
    await expect(checkAIMotionSourceBoundaries(interval)).rejects.toThrow('固定端点');
    const full = healthy(); full.context.boundaries.end.pose.joints.LeftForeArm = rotationFromDegrees([90, 0, 0]);
    await expect(checkAIMotionSourceBoundaries(full)).resolves.toBeUndefined();
  });
  it('rejects genuine native toe penetration missed by legacy geometry without changing fixed endpoints', async () => {
    await loadRapierBackend();
    const toe = nativeToeRegressionPose();
    expect(JOINT_NAMES.every(joint => isFunctionalJointWithinLimits(joint, toe.joints[joint]))).toBe(true);
    expect(getCapsuleCollisions(toe)).toMatchObject({ selfCollisions: [], floorPenetrations: [] });
    expect(getMotionMinimumFloorHeight(toe)).toBeCloseTo(-.02232195042, 8);
    expect(getMotionMinimumFloorHeight(toe)).toBeLessThan(-CAPSULE_FLOOR_TOLERANCE_METERS);
    for (const [mode, boundary] of [['full', 'start'], ['interval', 'start'], ['interval', 'end']] as const) {
      const request = healthy(mode);
      request.context.boundaries[boundary].pose = structuredClone(toe);
      if (boundary === 'start') request.context.initialPose = structuredClone(toe);
      const before = JSON.stringify(request);
      await expect(checkAIMotionSourceBoundaries(request)).rejects.toThrow('固定端点');
      expect(JSON.stringify(request)).toBe(before);
    }
    const full = healthy(); full.context.boundaries.end.pose = structuredClone(toe);
    const before = JSON.stringify(full);
    await expect(checkAIMotionSourceBoundaries(full)).resolves.toBeUndefined();
    expect(JSON.stringify(full)).toBe(before);
  });
  it('uses the same existing 3mm tolerance for native toe clearance as the final gate', async () => {
    const request = healthy(), toe = nativeToeRegressionPose();
    toe.root[1] += -CAPSULE_FLOOR_TOLERANCE_METERS - getMotionMinimumFloorHeight(toe);
    request.context.initialPose = structuredClone(toe);
    request.context.boundaries.start.pose = toe;
    const before = JSON.stringify(request);
    expect(getMotionMinimumFloorHeight(toe)).toBeCloseTo(-CAPSULE_FLOOR_TOLERANCE_METERS, 10);
    await expect(checkAIMotionSourceBoundaries(request)).resolves.toBeUndefined();
    expect(JSON.stringify(request)).toBe(before);
    toe.root[1] -= .00001;
    const belowTolerance = JSON.stringify(request);
    await expect(checkAIMotionSourceBoundaries(request)).rejects.toThrow('固定端点');
    expect(JSON.stringify(request)).toBe(belowTolerance);
  });
  it('releases cancelled work before loading or inspecting source', async () => {
    const controller = new AbortController(); controller.abort();
    await expect(checkAIMotionSourceBoundaries(healthy(), controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
  });
});
