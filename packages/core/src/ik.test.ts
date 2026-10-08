import { describe, expect, it } from 'vitest';
import { Bone, Group } from 'three';
import { JOINT_NAMES, type Pose } from './motion-types';
import { evaluatePose, RIG_CALIBRATION_VERSION, RIG_DEFINITIONS } from './humanoid';
import { STANDARD_HUMAN_PROFILE } from './humanProfile';
import { IK_EFFECTORS, solveLimbIK } from './ik';
import { isJointRotationWithinLimits } from './jointConstraints';
import { rotationFromDegrees } from './keyframes';

const neutral = (): Pose => ({ root: [0, 1.05, 0], joints: Object.fromEntries(JOINT_NAMES.map(name => [name, [0, 0, 0, 1]])) as Pose['joints'] });
const distance = (a: number[], b: number[]) => Math.hypot(...a.map((value, axis) => value - b[axis]));

describe('shared humanoid FK', () => {
  it('uses one versioned natural shoulder calibration while retaining the fixed limb and foot geometry', () => {
    const pose = neutral(), world = evaluatePose(pose);
    expect(RIG_CALIBRATION_VERSION).toBe('neutral-rig-2');
    expect(STANDARD_HUMAN_PROFILE.id).toBe('neutral-adult-v2');
    expect(STANDARD_HUMAN_PROFILE.version).toBe(2);
    expect(STANDARD_HUMAN_PROFILE.heightMeters).toBe(1.85);
    expect(STANDARD_HUMAN_PROFILE.massKg).toBe(70);
    expect(world.LeftShoulder.position[0]).toBeCloseTo(.1, 12);
    expect(world.RightShoulder.position[0]).toBeCloseTo(-.1, 12);
    expect(world.LeftUpperArm.position[0] - world.RightUpperArm.position[0]).toBeCloseTo(.42, 12);
    expect(distance(world.LeftUpperArm.position, world.LeftForeArm.position)).toBeCloseTo(.285, 12);
    expect(distance(world.LeftForeArm.position, world.LeftHand.position)).toBeCloseTo(.255, 12);
    expect(distance(world.LeftFoot.position, [.112, .09, 0])).toBeLessThan(1e-12);
    expect(distance(world.RightFoot.position, [-.112, .09, 0])).toBeLessThan(1e-12);
  });

  it('keeps legacy torso and foot world transforms unchanged without rewriting authored rotations', () => {
    const pose = neutral(); pose.root = [1.2, 1.4, -.8];
    pose.joints.Hips = rotationFromDegrees([15, 35, -12]);
    pose.joints.Chest = rotationFromDegrees([20, -10, 15]);
    pose.joints.LeftShoulder = rotationFromDegrees([20, 15, 30]);
    pose.joints.LeftUpperArm = rotationFromDegrees([-60, 20, 80]);
    pose.joints.LeftForeArm = rotationFromDegrees([-100, 0, 0]);
    pose.joints.LeftUpperLeg = rotationFromDegrees([-25, 0, 0]);
    pose.joints.LeftLowerLeg = rotationFromDegrees([50, 0, 0]);
    const before = JSON.stringify(pose), oldRoot = new Group(); oldRoot.position.set(...pose.root);
    const oldBones = new Map<string, Bone>();
    for (const definition of RIG_DEFINITIONS) {
      const old = new Bone(), side = definition.name.startsWith('Left') ? 1 : -1;
      const offset = definition.name.endsWith('Shoulder') ? [side * .205, .095, 0] : definition.name.endsWith('UpperArm') ? [side * .082, -.03, 0] : [...definition.offset];
      old.position.set(offset[0], offset[1], offset[2]); old.quaternion.set(...pose.joints[definition.name]);
      (definition.parent ? oldBones.get(definition.parent)! : oldRoot).add(old); oldBones.set(definition.name, old);
    }
    oldRoot.updateMatrixWorld(true);
    const current = evaluatePose(pose);
    for (const name of JOINT_NAMES.filter(name => !/Shoulder|UpperArm|ForeArm|Hand/.test(name))) {
      const old = oldBones.get(name)!;
      expect(distance(current[name].position, old.getWorldPosition(old.position.clone()).toArray())).toBeLessThan(1e-12);
      const rotation = old.getWorldQuaternion(old.quaternion.clone()).toArray();
      expect(Math.abs(current[name].rotation.reduce((sum, value, axis) => sum + value * rotation[axis], 0))).toBeCloseTo(1, 12);
    }
    expect(distance(current.LeftHand.position, oldBones.get('LeftHand')!.getWorldPosition(oldBones.get('LeftHand')!.position.clone()).toArray())).toBeGreaterThan(.05);
    expect(JSON.stringify(pose)).toBe(before);
  });

  it('matches the exact renderer hierarchy, parent quaternion multiplication and fixed offsets', () => {
    const pose = neutral(); pose.root = [1.2, 1.4, -0.8];
    pose.joints.Hips = rotationFromDegrees([15, 35, -12]);
    pose.joints.Chest = rotationFromDegrees([20, -10, 15]);
    pose.joints.LeftUpperArm = rotationFromDegrees([-60, 20, 80]);
    pose.joints.LeftForeArm = rotationFromDegrees([-100, 0, 0]);
    const root = new Group(); root.position.set(...pose.root);
    const joints = new Map<string, Bone>();
    for (const definition of RIG_DEFINITIONS) {
      const bone = new Bone(); bone.position.set(...definition.offset); bone.quaternion.set(...pose.joints[definition.name]);
      (definition.parent ? joints.get(definition.parent)! : root).add(bone); joints.set(definition.name, bone);
    }
    root.updateMatrixWorld(true);
    const result = evaluatePose(pose);
    expect(RIG_DEFINITIONS).toHaveLength(25);
    expect(new Set(RIG_DEFINITIONS.map(item => item.name)).size).toBe(25);
    for (const joint of JOINT_NAMES) {
      const expected = joints.get(joint)!;
      expect(distance(result[joint].position, expected.getWorldPosition(expected.position.clone()).toArray())).toBeLessThan(1e-12);
      const quaternion = expected.getWorldQuaternion(expected.quaternion.clone()).toArray();
      expect(Math.abs(result[joint].rotation.reduce((sum, value, axis) => sum + value * quaternion[axis], 0))).toBeCloseTo(1, 12);
    }
    expect(RIG_DEFINITIONS.find(item => item.name === 'LeftLowerLeg')!.offset).toEqual([0, -0.46, 0]);
    expect(RIG_DEFINITIONS.find(item => item.name === 'LeftFoot')!.offset).toEqual([0, -0.45, 0]);
  });

  it('does not repair legacy angular motion while evaluating world transforms', () => {
    const pose = neutral(); pose.joints.LeftLowerLeg = rotationFromDegrees([-45, 0, 0]);
    const before = JSON.stringify(pose); evaluatePose(pose); expect(JSON.stringify(pose)).toBe(before);
    const bad = neutral(); bad.joints.Neck = [0, 0, 0, 0]; expect(() => evaluatePose(bad)).toThrow(/四元数/);
  });
});

describe('MIT Three CCD limb adapter with anatomical projection', () => {
  it.each(IK_EFFECTORS)('reaches a legal %s target without stretching or changing Root/non-chain joints', effector => {
    const pose = neutral(), goal = neutral(), side = effector.startsWith('Left') ? 'Left' : 'Right';
    const leg = effector.endsWith('Foot');
    const upper = `${side}${leg ? 'UpperLeg' : 'UpperArm'}` as keyof Pose['joints'];
    const lower = `${side}${leg ? 'LowerLeg' : 'ForeArm'}` as keyof Pose['joints'];
    goal.joints[upper] = rotationFromDegrees([leg ? -40 : -35, 0, 0]);
    goal.joints[lower] = rotationFromDegrees([leg ? 50 : -60, 0, 0]);
    const target = evaluatePose(goal)[effector].position, before = JSON.stringify(pose);
    const result = solveLimbIK(pose, effector, target);
    expect(result.reached).toBe(true); expect(result.residual).toBeLessThan(0.005);
    expect(result.pose.root).toEqual(pose.root); expect(JSON.stringify(pose)).toBe(before);
    for (const name of JOINT_NAMES.filter(name => name !== upper && name !== lower)) expect(result.pose.joints[name]).toEqual(pose.joints[name]);
    for (const name of [upper, lower]) { expect(isJointRotationWithinLimits(name, result.pose.joints[name])).toBe(true); expect(Math.hypot(...result.pose.joints[name])).toBeCloseTo(1, 12); }
    const world = evaluatePose(result.pose);
    expect(distance(world[upper].position, world[lower].position)).toBeCloseTo(leg ? 0.46 : 0.285, 12);
    expect(distance(world[lower].position, world[effector].position)).toBeCloseTo(leg ? 0.45 : 0.255, 12);
  });

  it('reports an unreachable far target with finite residual and constrained bones', () => {
    const pose = neutral(), result = solveLimbIK(pose, 'LeftFoot', [4, 0, 3]);
    expect(result.reached).toBe(false); expect(result.residual).toBeGreaterThan(3);
    expect(Number.isFinite(result.residual)).toBe(true);
    expect(result.pose.root).toEqual(pose.root);
    for (const name of ['LeftUpperLeg', 'LeftLowerLeg'] as const) expect(isJointRotationWithinLimits(name, result.pose.joints[name])).toBe(true);
  });

  it('accepts a world-space pole, follows a rotated parent and optionally preserves sole orientation', () => {
    const pose = neutral(); pose.joints.Hips = rotationFromDegrees([0, 40, 0]);
    const goal = structuredClone(pose); goal.joints.LeftUpperLeg = rotationFromDegrees([-30, 0, 0]); goal.joints.LeftLowerLeg = rotationFromDegrees([60, 0, 0]);
    const target = evaluatePose(goal).LeftFoot.position;
    const result = solveLimbIK(pose, 'LeftFoot', target, { pole: [0.5, 0.65, 1], preserveEndRotation: evaluatePose(pose).LeftFoot.rotation });
    expect(result.residual).toBeLessThan(0.005);
    for (const name of result.changedJoints) expect(isJointRotationWithinLimits(name, result.pose.joints[name])).toBe(true);
    expect(result.pose.joints.Hips).toEqual(pose.joints.Hips);
  });

  it('is deterministic, deep clones its result and rejects invalid targets', () => {
    const pose = neutral(), target: [number, number, number] = [0.112, 0.3, 0.2];
    const first = solveLimbIK(pose, 'LeftFoot', target), second = solveLimbIK(pose, 'LeftFoot', target);
    expect(second).toEqual(first); first.pose.joints.Chest[0] = 0.5; expect(pose.joints.Chest[0]).toBe(0);
    for (const target of [[0, Number.NaN, 0], [Infinity, 0, 0]]) expect(() => solveLimbIK(pose, 'LeftFoot', target as [number, number, number])).toThrow(/无效/);
  });
});
