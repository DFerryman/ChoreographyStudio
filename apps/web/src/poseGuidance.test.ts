import { describe, expect, it } from 'vitest';
import { Quaternion } from 'three';
import { JOINT_NAMES, isJointRotationWithinLimits, rotationFromDegrees, type JointName, type Pose, type Quat, type Vec3 } from '../../../packages/core/src';
import { getPoseGuidance } from './poseGuidance';

function pose(rotations: Partial<Record<JointName, Vec3>> = {}): Pose {
  return { root: [0, 1.05, 0], joints: Object.fromEntries(JOINT_NAMES.map(joint => [joint, rotationFromDegrees(rotations[joint] ?? [0, 0, 0])])) as Pose['joints'] };
}

describe('read-only whole-body pose guidance', () => {
  it('checks unselected joints without changing impossible author rotations or Root', () => {
    const authored = pose({ LeftUpperArm: [0, 0, 170], RightLowerLeg: [-70, 0, 0], LeftFoot: [-40, 0, 0] });
    const before = structuredClone(authored);
    Object.freeze(authored.root);
    for (const q of Object.values(authored.joints)) Object.freeze(q);
    Object.freeze(authored.joints); Object.freeze(authored);
    expect(getPoseGuidance(authored).outsideSuggestedRange).toEqual(['LeftUpperArm', 'LeftFoot', 'RightLowerLeg']);
    expect(authored).toEqual(before);
  });

  it('identifies all four explicit out-of-range skin stress inputs', () => {
    for (const [input, outside] of [
      [{ LeftUpperArm: [0, 0, 170] }, ['LeftUpperArm']],
      [{ LeftForeArm: [-70, 60, 0] }, ['LeftForeArm']],
      [{ LeftFoot: [-40, 0, 0], RightFoot: [-40, 0, 0] }, ['LeftFoot', 'RightFoot']],
      [{ RightFoot: [0, 0, 20] }, ['RightFoot']],
    ] as [Partial<Record<JointName, Vec3>>, JointName[]][]) expect(getPoseGuidance(pose(input)).outsideSuggestedRange).toEqual(outside);
  });

  it('reports a real SLERP violation between independently legal wrist endpoints', () => {
    const a = rotationFromDegrees([-51.047825273126364, -14.960054133553058, 21.82540789945051]);
    const b = rotationFromDegrees([45.59781915508211, 13.430102812126279, 23.15311743877828]);
    expect(isJointRotationWithinLimits('LeftHand', a)).toBe(true);
    expect(isJointRotationWithinLimits('LeftHand', b)).toBe(true);
    const interpolated = pose();
    interpolated.joints.LeftHand = new Quaternion(...a).slerp(new Quaternion(...b), .25).toArray() as Quat;
    const before = structuredClone(interpolated);
    expect(getPoseGuidance(interpolated).outsideSuggestedRange).toEqual(['LeftHand']);
    expect(interpolated).toEqual(before);
  });

  it('distinguishes local limits from absent shoulder-girdle participation', () => {
    const isolated = pose({ LeftUpperArm: [0, 0, 150], RightUpperArm: [0, 0, -150] });
    expect(getPoseGuidance(isolated)).toEqual({ outsideSuggestedRange: [], shoulderCoupling: ['Left', 'Right'] });
    expect(getPoseGuidance(pose({ LeftUpperArm: [0, 0, 130], LeftShoulder: [0, 0, 20] })).shoulderCoupling).toEqual([]);
    expect(getPoseGuidance(pose({ LeftUpperArm: [0, 0, 120] })).shoulderCoupling).toEqual([]);
    expect(getPoseGuidance(pose({ LeftUpperArm: [0, 0, 150], LeftShoulder: [0, 0, 5] })).shoulderCoupling).toEqual([]);
    const negative = structuredClone(isolated);
    for (const joint of JOINT_NAMES) negative.joints[joint] = negative.joints[joint].map(value => -value) as Quat;
    expect(getPoseGuidance(negative)).toEqual(getPoseGuidance(isolated));
  });

  it('keeps neutral and absent poses quiet without claiming physical feasibility', () => {
    expect(getPoseGuidance(null)).toEqual({ outsideSuggestedRange: [], shoulderCoupling: [] });
    expect(getPoseGuidance(pose())).toEqual({ outsideSuggestedRange: [], shoulderCoupling: [] });
  });
});
