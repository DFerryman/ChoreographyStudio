import { describe, expect, it } from 'vitest';
import {
  EDITABLE_JOINT_NAMES, JOINT_NAMES, constrainJointRotation, constrainJointRotationDegrees,
  getJointRotationLimits, isJointRotationWithinLimits, jointRotationToDegrees,
  rotationFromDegrees, rotationToDegrees, type JointName, type Quat, type Vec3,
} from './index';

function sameOrientation(a: Quat, b: Quat) {
  const dot = a.reduce((sum, value, axis) => sum + value * b[axis], 0) / Math.hypot(...a) / Math.hypot(...b);
  expect(Math.abs(dot)).toBeCloseTo(1, 12);
}

function restLimbDirection([x, y, z, w]: Quat): Vec3 {
  // Rotate the actual preview rig's neutral child direction (0, -1, 0).
  return [2 * (w * z - x * y), -1 + 2 * (x * x + z * z), -2 * (y * z + w * x)];
}

describe('joint editing envelopes for the original preview rig', () => {
  it.each(JOINT_NAMES)('%s retains neutral and every single-axis numeric boundary', joint => {
    const limits = getJointRotationLimits(joint);
    const neutral: Quat = [0, 0, 0, 1];
    sameOrientation(constrainJointRotation(joint, neutral), neutral);
    expect(limits).toHaveLength(3);
    for (const [axis, range] of limits.entries()) {
      expect(range[0]).toBeLessThanOrEqual(0); expect(range[1]).toBeGreaterThanOrEqual(0);
      for (const boundary of range) {
        const degrees: Vec3 = [0, 0, 0]; degrees[axis] = boundary;
        const input = rotationFromDegrees(degrees);
        expect(isJointRotationWithinLimits(joint, input)).toBe(true);
        sameOrientation(constrainJointRotation(joint, input), input);
      }
    }
  });

  it('uses the measured neutral basis: both elbows fold forward and both knees fold backward', () => {
    for (const joint of ['LeftForeArm', 'RightForeArm'] as const) {
      expect(restLimbDirection(constrainJointRotation(joint, rotationFromDegrees([-90, 0, 0])))[2]).toBeCloseTo(1, 12);
      expect(rotationToDegrees(constrainJointRotation(joint, rotationFromDegrees([120, 0, 0])))[0]).toBeCloseTo(0, 10);
      expect(rotationToDegrees(constrainJointRotation(joint, rotationFromDegrees([-170, 0, 0])))[0]).toBeCloseTo(-145, 10);
    }
    for (const joint of ['LeftLowerLeg', 'RightLowerLeg'] as const) {
      expect(restLimbDirection(constrainJointRotation(joint, rotationFromDegrees([90, 0, 0])))[2]).toBeCloseTo(-1, 12);
      expect(rotationToDegrees(constrainJointRotation(joint, rotationFromDegrees([-120, 0, 0])))[0]).toBeCloseTo(0, 10);
      expect(rotationToDegrees(constrainJointRotation(joint, rotationFromDegrees([170, 0, 0])))[0]).toBeCloseTo(145, 10);
    }
  });

  it('mirrors outward shoulder and hip motion without reversing elbow or knee flexion', () => {
    for (const [left, right] of [['LeftUpperArm', 'RightUpperArm'], ['LeftUpperLeg', 'RightUpperLeg']] as const) {
      const angle = left === 'LeftUpperArm' ? 90 : 30;
      expect(restLimbDirection(constrainJointRotation(left, rotationFromDegrees([0, 0, angle])))[0]).toBeGreaterThan(0);
      expect(restLimbDirection(constrainJointRotation(right, rotationFromDegrees([0, 0, -angle])))[0]).toBeLessThan(0);
      expect(getJointRotationLimits(left)[2]).toEqual([-getJointRotationLimits(right)[2][1], -getJointRotationLimits(right)[2][0]]);
    }
  });

  it('retains existing template shoulder, elbow and knee orientations inside the editing envelope', () => {
    const samples: [JointName, Vec3][] = [
      ['LeftUpperArm', [-5.73, 0, 143.24]], ['RightUpperArm', [-5.73, 0, -143.24]],
      ['LeftUpperArm', [-14.32, 1.64, 90]], ['RightUpperArm', [-14.32, -1.64, -90]],
      ['LeftForeArm', [-30.94, 0, 0]], ['RightForeArm', [-4.58, 0, 0]],
      ['LeftLowerLeg', [7.45, 0, 0]], ['RightLowerLeg', [7.45, 0, 0]],
    ];
    for (const [joint, degrees] of samples) {
      const input = rotationFromDegrees(degrees);
      expect(isJointRotationWithinLimits(joint, input)).toBe(true);
      sameOrientation(constrainJointRotation(joint, input), input);
    }
  });

  it('keeps legal compound rotations unchanged, including mildly off-axis flexed hinges', () => {
    const legal: [JointName, Vec3][] = [
      ['Spine', [10, 5, 5]], ['Chest', [10, -5, 5]], ['Neck', [10, 10, 5]], ['Head', [10, 5, 5]],
      ['LeftShoulder', [5, 5, 8]], ['RightShoulder', [5, -5, -8]],
      ['LeftUpperArm', [-35, 10, 45]], ['RightUpperArm', [-35, -10, -45]],
      ['LeftForeArm', [-60, 2, 1]], ['RightForeArm', [-90, -2, 1]],
      ['LeftHand', [-15, 3, 5]], ['RightHand', [-15, -3, -5]],
      ['LeftUpperLeg', [-30, 5, 12]], ['RightUpperLeg', [-30, -5, -12]],
      ['LeftLowerLeg', [90, 1, 1]], ['RightLowerLeg', [90, -1, -1]],
      ['LeftFoot', [-5, 3, 6]], ['RightFoot', [-5, -3, -6]],
    ];
    for (const [joint, degrees] of legal) {
      const input = rotationFromDegrees(degrees);
      expect(isJointRotationWithinLimits(joint, input), joint).toBe(true);
      const result = constrainJointRotation(joint, input);
      sameOrientation(result, input);
      expect(result.every((value, axis) => Math.abs(value - input[axis]) < 1e-14)).toBe(true);
    }
  });

  it('restrains combined secondary hinge swing even when both Euler angles meet their individual bounds', () => {
    for (const [joint, degrees] of [
      ['LeftForeArm', [-90, 8, 5]], ['RightForeArm', [-90, -8, -5]],
      ['LeftLowerLeg', [90, 4, 3]], ['RightLowerLeg', [90, -4, -3]],
    ] as [JointName, Vec3][]) {
      const input = rotationFromDegrees(degrees);
      expect(isJointRotationWithinLimits(joint, input)).toBe(false);
      const result = constrainJointRotation(joint, input);
      expect(isJointRotationWithinLimits(joint, result)).toBe(true);
      const output = rotationToDegrees(result);
      expect(Math.abs(output[1])).toBeLessThan(Math.abs(degrees[1]));
      expect(Math.abs(output[2])).toBeLessThan(Math.abs(degrees[2]));
    }
  });

  it('limits compounded shoulder axial twist instead of only clamping three independent Euler sliders', () => {
    const input = rotationFromDegrees([-120, 65, 150]);
    expect(isJointRotationWithinLimits('LeftUpperArm', input)).toBe(false);
    const result = constrainJointRotation('LeftUpperArm', input);
    expect(isJointRotationWithinLimits('LeftUpperArm', result)).toBe(true);
    const actualTwist = 2 * Math.atan2(result[1], result[3]) * 180 / Math.PI;
    expect(Math.abs(actualTwist)).toBeLessThanOrEqual(65.000001);
  });

  it.each(EDITABLE_JOINT_NAMES.filter(joint => joint !== 'Hips'))('%s projects extreme input to finite, normalized, stable in-range output', joint => {
    const input = rotationFromDegrees([179, 89, -179]);
    const before = [...input];
    const output = constrainJointRotation(joint, input);
    expect(output.every(Number.isFinite)).toBe(true);
    expect(Math.hypot(...output)).toBeCloseTo(1, 12);
    expect(isJointRotationWithinLimits(joint, output)).toBe(true);
    expect(input).toEqual(before);
    sameOrientation(constrainJointRotation(joint, output), output);
    sameOrientation(constrainJointRotation(joint, input.map(value => -value) as Quat), output);
    sameOrientation(constrainJointRotation(joint, input.map(value => value * 12) as Quat), output);
  });

  it('leaves whole-actor Hips direction and read-only terminal orientations unrestricted', () => {
    for (const joint of ['Hips', 'LeftHandTip', 'RightHandTip', 'LeftToe', 'RightToe', 'LeftHeel', 'RightHeel'] as const) {
      for (const angles of [[179, 89, 179], [0, 180, 0], [140, 0, 140]] as Vec3[]) {
        const input = rotationFromDegrees(angles);
        sameOrientation(constrainJointRotation(joint, input), input);
        expect(isJointRotationWithinLimits(joint, input)).toBe(true);
      }
      if (joint !== 'Hips') expect(getJointRotationLimits(joint)).toEqual([[0, 0], [0, 0], [0, 0]]);
    }
  });

  it('normalizes finite input robustly and treats q and -q as the same rotation', () => {
    const input = rotationFromDegrees([-60, 2, 1]);
    const normalized = constrainJointRotation('LeftForeArm', input.map(value => value * 1e308) as Quat);
    sameOrientation(normalized, input); expect(Math.hypot(...normalized)).toBeCloseTo(1, 12);
    const negative = constrainJointRotation('LeftForeArm', input.map(value => -value) as Quat);
    sameOrientation(negative, input); expect(negative[3]).toBeLessThan(0);
  });

  it('rejects NaN, infinity, missing components and zero quaternions without mutating valid data', () => {
    for (const bad of [[0, 0, 0, 0], [Number.NaN, 0, 0, 1], [0, 0, Infinity, 1], [0, 0, 1], [0, 0, 0, '1']]) {
      expect(() => constrainJointRotation('LeftForeArm', bad as Quat)).toThrow(/有限|四元数/);
    }
    expect(() => constrainJointRotationDegrees('LeftForeArm', [Number.NaN, 0, 0])).toThrow(/有限/);
    expect(() => getJointRotationLimits('unknown' as JointName)).toThrow(/关节/);
  });

  it('displays a legacy impossible rotation verbatim until an explicit edit projects it', () => {
    const legacy = rotationFromDegrees([110, 0, 0]);
    Object.freeze(legacy);
    expect(jointRotationToDegrees('LeftForeArm', legacy)[0]).toBeCloseTo(110, 10);
    expect(isJointRotationWithinLimits('LeftForeArm', legacy)).toBe(false);
    const edited = constrainJointRotation('LeftForeArm', legacy);
    expect(rotationToDegrees(edited)[0]).toBeCloseTo(0, 10);
    expect(jointRotationToDegrees('LeftForeArm', legacy)[0]).toBeCloseTo(110, 10);
  });

  it('clamps literal numeric input before converting intrinsic XYZ to a quaternion', () => {
    expect(constrainJointRotationDegrees('LeftForeArm', [-1000, 0, 0])[0]).toBeCloseTo(-145, 10);
    expect(constrainJointRotationDegrees('LeftLowerLeg', [-1000, 0, 0])[0]).toBeCloseTo(0, 10);
    expect(constrainJointRotationDegrees('LeftUpperArm', [0, 0, 720])[2]).toBeCloseTo(150, 10);
    const input: Vec3 = [-60, 2, 1];
    const result = constrainJointRotationDegrees('LeftForeArm', input);
    result.forEach((value, axis) => expect(value).toBeCloseTo(input[axis], 10));
    expect(input).toEqual([-60, 2, 1]);
  });
});
