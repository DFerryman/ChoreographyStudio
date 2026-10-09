import { describe, expect, it } from 'vitest';
import {
  EDITABLE_JOINT_NAMES, JOINT_NAMES, constrainJointRotation, constrainJointRotationDegrees,
  bakePlan, bakeKeyframeSequence, createNeutralTake, makeCountMap, makeKeyframeSequence, makePlan,
  sampleTake, setPoseKeyframe, upsertRotationKeyframe,
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

  it.each<{ joint: JointName; rotation: Quat; degrees: Vec3 }>([
    { joint: 'LeftForeArm', rotation: [-0.11471704949084884, 0.1347731555209452, 0.13826411938458458, 0.9744532971866053], degrees: [-15.550536376768143, 13.352289516941134, 17.98276311397531] },
    { joint: 'LeftForeArm', rotation: [-0.6371985943120906, 0.09301021804745838, 0.1314160047047678, 0.7536954852278849], degrees: [-80.170455171458, -1.562845885266747, 18.466195169788932] },
    { joint: 'RightLowerLeg', rotation: [0.44781483995477656, 0.03169150429047378, -0.16916476562642843, 0.877405721284424], degrees: [53.153105940587736, -5.502913619086462, -19.07114494582632] },
    { joint: 'RightLowerLeg', rotation: [0.7539744832572669, -0.20288241819830205, 0.01779175254430984, 0.6245355526504063], degrees: [103.01070013168298, -13.096129472449354, 19.689481728502475] },
    { joint: 'RightLowerLeg', rotation: [0.8749011955379251, 0.2133239910590742, 0.0676285402983988, 0.42949639512112936], degrees: [130.71436865570578, 17.55254746684343, -19.303597879153585] },
    { joint: 'RightLowerLeg', rotation: [0.39503215770294453, 0.061527684573436645, 0.20379252740970455, 0.8936624330157067], degrees: [45.027153996974995, 15.72254112872932, 19.141422249964414] },
  ])('$joint coupled projection stays legal and idempotent through normalization and a real K write: $degrees', ({ joint, rotation, degrees }) => {
    // These fixed inputs reproduced a projected result that crossed the
    // secondary-swing boundary by rounding, including only after K normalization.
    rotationToDegrees(rotation).forEach((value, axis) => expect(value).toBeCloseTo(degrees[axis], 10));
    const map = makeCountMap({ bpm: 120, musicBeatsPerDanceCount: 1, firstCountSourceSeconds: 0, octetCount: 8, audioDurationSeconds: 40 });
    const sequence = makeKeyframeSequence(createNeutralTake(bakePlan(makePlan(map), map)));
    const original = JSON.stringify(sequence);
    for (const input of [rotation, rotationFromDegrees(degrees)]) {
      const before = [...input];
      const projected = constrainJointRotation(joint, input);
      expect(input).toEqual(before);
      expect(Math.hypot(...projected)).toBeCloseTo(1, 12);
      expect(isJointRotationWithinLimits(joint, projected)).toBe(true);
      let repeated = projected;
      for (let iteration = 0; iteration < 5; iteration++) {
        repeated = repeated.map(value => value / Math.hypot(...repeated)) as Quat;
        expect(isJointRotationWithinLimits(joint, repeated)).toBe(true);
        repeated = constrainJointRotation(joint, repeated);
        expect(isJointRotationWithinLimits(joint, repeated)).toBe(true);
        repeated.forEach((value, axis) => expect(Math.abs(value - projected[axis])).toBeLessThan(1e-14));
      }
      const authored = upsertRotationKeyframe(sequence, joint, 60, projected);
      const saved: Quat = JSON.parse(JSON.stringify(authored.rotations[joint]![0].rotation));
      expect(isJointRotationWithinLimits(joint, saved)).toBe(true);
      expect(authored.baseTake).toEqual(sequence.baseTake);
      expect(authored.rotations[joint]).toHaveLength(1);
      expect(JSON.stringify(sequence)).toBe(original);
    }
  });

  it.each<[JointName, Quat]>([
    ['LeftForeArm', [-0.055338420000625436, 0.03145958484521592, 0.014141525180751504, 0.5775695706197171]],
    ['RightLowerLeg', [0.6030709372773353, -0.026258305727364924, -0.0525317680311531, 1.8963749961365775]],
  ])('%s keeps an already legal boundary input legal after normalizing and saving it', (joint, input) => {
    expect(isJointRotationWithinLimits(joint, input)).toBe(true);
    const output = constrainJointRotation(joint, input);
    sameOrientation(output, input);
    expect(isJointRotationWithinLimits(joint, output)).toBe(true);
    const map = makeCountMap({ bpm: 120, musicBeatsPerDanceCount: 1, firstCountSourceSeconds: 0, octetCount: 8, audioDurationSeconds: 40 });
    const sequence = makeKeyframeSequence(createNeutralTake(bakePlan(makePlan(map), map)));
    const saved = upsertRotationKeyframe(sequence, joint, 60, output).rotations[joint]![0].rotation;
    expect(isJointRotationWithinLimits(joint, saved)).toBe(true);
    const repeated = constrainJointRotation(joint, saved);
    expect(isJointRotationWithinLimits(joint, repeated)).toBe(true);
    repeated.forEach((value, axis) => expect(Math.abs(value - output[axis])).toBeLessThan(1e-14));
  });

  it.each<[JointName, Quat]>([
    ['LeftLowerLeg', rotationFromDegrees([170, 0, 0])],
    ['LeftLowerLeg', [0.9537169507482269, 0, 0, 0.30070579950427345]],
    ['LeftForeArm', [-0.25650200097871706, 0.0739787608261766, 0.0855164154116003, 0.9599066668878221]],
    ['RightLowerLeg', rotationFromDegrees([90, 4, 3])],
    ['Hips', [-0.5632561118007073, -0.6312149622607962, -0.4474102475434128, -0.290059122129253]],
    ['Hips', [1e308, 1e308, 1e308, 1e308]],
  ])('%s newly edited draft remains component-exact through feedback re-entry, both K writes and bake', (joint, input) => {
    // The knee sample is the actual failing browser draft; the elbow sample
    // produced a two-state direct-hypot normalization cycle. Existing source
    // poses are never canonicalized by this new-edit projection.
    const map = makeCountMap({ bpm: 120, musicBeatsPerDanceCount: 1, firstCountSourceSeconds: 0, octetCount: 8, audioDurationSeconds: 40 });
    const sequence = makeKeyframeSequence(createNeutralTake(bakePlan(makePlan(map), map)));
    const original = JSON.stringify(sequence), before = [...input];
    const draft = constrainJointRotation(joint, input);
    expect(input).toEqual(before);
    expect(isJointRotationWithinLimits(joint, draft)).toBe(true);
    const pose = sampleTake(sequence.baseTake, 0);
    pose.joints[joint] = [...draft];
    const single = upsertRotationKeyframe(sequence, joint, 0, draft);
    const full = setPoseKeyframe(sequence, 0, pose);
    for (const keyed of [single, full]) {
      expect(keyed.rotations[joint]![0].rotation).toEqual(draft);
      expect(bakeKeyframeSequence(keyed).poses[0].joints[joint]).toEqual(draft);
      expect(keyed.baseTake).toEqual(sequence.baseTake);
    }
    expect(Math.hypot(...draft)).toBe(1);
    let feedback = draft;
    for (let iteration = 0; iteration < 5; iteration++) {
      feedback = constrainJointRotation(joint, feedback);
      expect(feedback).toEqual(draft);
      expect(isJointRotationWithinLimits(joint, feedback)).toBe(true);
    }
    expect(JSON.stringify(sequence)).toBe(original);
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
