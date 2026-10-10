import { describe, expect, it } from 'vitest';
import { Quaternion } from 'three';
import { JOINT_NAMES, type BakedTake, type Pose, type Quat } from './motion-types';
import { evaluatePose } from './humanoid';
import { applyFootLocks, captureFootLock } from './footLocks';
import { isJointRotationWithinLimits } from './jointConstraints';
import {
  EDITABLE_JOINT_NAMES, addFootLock, bakeKeyframeSequence, bakeLegacyKeyframeSequence, frameTime,
  getKeyframeCount, getKeyframeProtection, lastFrame, makeKeyframeSequence,
  removeFootLock, removePoseKeyframe, removeRootKeyframe, removeRotationKeyframe, rotationFromDegrees,
  setPoseKeyframe, transferKeyframes, upsertRootKeyframe, upsertRotationKeyframe,
  type KeyframeSequence,
} from './keyframes';
import { sampleTake } from './index';

const neutral = (): Pose => ({
  root: [0, 1.05, 0],
  joints: Object.fromEntries(JOINT_NAMES.map(joint => [joint, [0, 0, 0, 1]])) as Pose['joints'],
});

describe('versioned author priority and legacy contact compatibility', () => {
  const legacy = (sequence: KeyframeSequence): KeyframeSequence => {
    const copy: KeyframeSequence = JSON.parse(JSON.stringify(sequence));
    delete copy.authorKeyPriority;
    delete copy.trackInterpolation;
    delete copy.pointInterpolation;
    return copy;
  };

  it('preserves exact new/legacy samples for old untagged sequences without foot locks', () => {
    const base = source(), fresh = makeKeyframeSequence(base), originalBase = JSON.stringify(base);
    expect(fresh.authorKeyPriority).toBe('author-key-priority-1');
    const empty = legacy(fresh);
    let keyed = upsertRotationKeyframe(fresh, 'Chest', 12, rotationFromDegrees([0, 0, 55]));
    keyed = upsertRootKeyframe(keyed, 12, [0.25, 1.07, 0.1]);
    const oldKeyed = legacy(keyed);
    for (const sequence of [empty, oldKeyed]) {
      const original = JSON.stringify(sequence), current = bakeKeyframeSequence(sequence), prior = bakeLegacyKeyframeSequence(sequence);
      expect(current.times).toEqual(prior.times); expect(current.poses).toEqual(prior.poses);
      expect(current.times.at(-1)).toBe(1.02);
      for (const time of base.times) expect(current.times).toContain(time);
      expect(current.planId).toBe(base.planId); expect(current.countMapId).toBe(base.countMapId);
      expect(sequence.authorKeyPriority).toBeUndefined(); expect(JSON.stringify(sequence)).toBe(original);
    }
    expect(bakeLegacyKeyframeSequence(empty).times).toEqual(base.times);
    expect(bakeLegacyKeyframeSequence(empty).poses).toEqual(base.poses);
    const keyedPose = atFrame(bakeLegacyKeyframeSequence(oldKeyed), 12);
    expect(keyedPose.root).toEqual(oldKeyed.root[0].position);
    expect(keyedPose.joints.Chest).toEqual(oldKeyed.rotations.Chest![0].rotation);
    expect(JSON.stringify(base)).toBe(originalBase);
  });

  it('reproduces legacy contact solving explicitly while ordinary rebakes preserve conflicting old author keys', () => {
    const base = source(), originalBase = JSON.stringify(base);
    let sequence = upsertRootKeyframe(withLeftLock(base), 12, [0.15, 1.05, 0]);
    sequence = upsertRotationKeyframe(sequence, 'LeftLowerLeg', 12, rotationFromDegrees([-70, 0, 0]));
    sequence = legacy(sequence);
    const original = JSON.stringify(sequence), current = bakeKeyframeSequence(sequence), prior = bakeLegacyKeyframeSequence(sequence);
    const currentPose = atFrame(current, 12), priorPose = atFrame(prior, 12), authored = neutral();
    authored.root = [...sequence.root[0].position]; authored.joints.LeftLowerLeg = [...sequence.rotations.LeftLowerLeg![0].rotation];
    const oldSolver = applyFootLocks(authored, sequence.footLocks!, 12, base.durationSeconds);
    expect(priorPose).toEqual(oldSolver.pose);
    expect(priorPose.root[1]).toBeLessThan(authored.root[1]);
    expect(angularDistance(priorPose.joints.LeftLowerLeg, authored.joints.LeftLowerLeg)).toBeGreaterThan(0.1);
    expect(isJointRotationWithinLimits('LeftLowerLeg', priorPose.joints.LeftLowerLeg)).toBe(true);
    expect(currentPose.root).toEqual(authored.root);
    expect(currentPose.joints.LeftLowerLeg).toEqual(authored.joints.LeftLowerLeg);
    expect(isJointRotationWithinLimits('LeftLowerLeg', currentPose.joints.LeftLowerLeg)).toBe(false);
    expect(current.times).toEqual(prior.times); expect(prior.times.at(-1)).toBe(1.02);
    for (const time of base.times) expect(prior.times).toContain(time);
    for (let frame = 0; frame <= lastFrame(base.durationSeconds); frame++) {
      expect(prior.times).toContain(frameTime(frame, base.durationSeconds));
    }
    expect(sequence.authorKeyPriority).toBeUndefined();
    expect(JSON.stringify(sequence)).toBe(original); expect(JSON.stringify(base)).toBe(originalBase);
  });

  it('marks genuine old-sequence edits, deep-clones contact metadata, and preserves untagged no-op/history identity', () => {
    const base = source();
    let sequence = upsertRootKeyframe(withLeftLock(base), 12, [0.15, 1.05, 0]);
    sequence = upsertRotationKeyframe(sequence, 'LeftLowerLeg', 12, rotationFromDegrees([-70, 0, 0]));
    const old = legacy(sequence), original = JSON.stringify(old), oldLock = old.footLocks![0];
    const operations: Array<(sequence: KeyframeSequence) => KeyframeSequence> = [
      item => upsertRootKeyframe(item, 15, [0.2, 1.05, 0]),
      item => upsertRotationKeyframe(item, 'Chest', 15, rotationFromDegrees([0, 0, 15])),
      item => setPoseKeyframe(item, 15, neutral()),
      item => removeRootKeyframe(item, 12),
      item => removeRotationKeyframe(item, 'LeftLowerLeg', 12),
      item => removePoseKeyframe(item, 12),
      item => addFootLock(item, captureFootLock(neutral(), 'RightFoot', 0, lastFrame(base.durationSeconds), 0)),
      item => removeFootLock(item, oldLock.id),
      item => {
        const transfer = transferKeyframes(item, { operation: 'move', scope: { kind: 'all' }, sourceFrame: 12, targetFrame: 21 });
        expect(transfer.status).toBe('changed');
        return transfer.sequence;
      },
    ];
    for (const operation of operations) {
      const changed = operation(old);
      expect(changed).not.toBe(old); expect(changed.authorKeyPriority).toBe('author-key-priority-1');
      expect(old.authorKeyPriority).toBeUndefined(); expect(JSON.stringify(old)).toBe(original);
      const retained = changed.footLocks?.find(lock => lock.id === oldLock.id);
      if (retained) {
        expect(retained).toEqual(oldLock); expect(retained).not.toBe(oldLock);
        expect(retained.target).not.toBe(oldLock.target); expect(retained.rotation).not.toBe(oldLock.rotation);
        retained.target[0] += 1; retained.rotation[0] += 0.1;
        expect(JSON.stringify(old)).toBe(original);
      }
    }
    expect(removeFootLock(old, 'absent-lock')).toBe(old);
    expect(removeRootKeyframe(old, 15)).toBe(old);
    expect(removeRotationKeyframe(old, 'Chest', 15)).toBe(old);
    expect(removePoseKeyframe(old, 15)).toBe(old);
    for (const request of [
      { operation: 'move' as const, scope: { kind: 'all' as const }, sourceFrame: 12, targetFrame: 12 },
      { operation: 'copy' as const, scope: { kind: 'all' as const }, sourceFrame: 15, targetFrame: 21 },
    ]) {
      const result = transferKeyframes(old, request);
      expect(result.status).toBe('noop'); expect(result.sequence).toBe(old);
      expect(result.sequence.authorKeyPriority).toBeUndefined();
    }
    expect(JSON.stringify(old)).toBe(original);
  });

  it('rejects unknown priority declarations and prevents new declared sequences from being evaluated as legacy', () => {
    const fresh = makeKeyframeSequence(source()), old = legacy(fresh);
    expect(() => bakeLegacyKeyframeSequence(old)).not.toThrow();
    expect(() => bakeLegacyKeyframeSequence(fresh)).toThrow();
    expect(() => bakeLegacyKeyframeSequence(upsertRootKeyframe(old, 12, [0.15, 1.05, 0]))).toThrow();
    for (const marker of ['author-key-priority-2', '', null, true, 1]) {
      const invalid = { ...old, authorKeyPriority: marker } as unknown as KeyframeSequence;
      const original = JSON.stringify(invalid);
      expect(() => bakeKeyframeSequence(invalid)).toThrow();
      expect(() => bakeLegacyKeyframeSequence(invalid)).toThrow();
      expect(() => upsertRootKeyframe(invalid, 12, [0.15, 1.05, 0])).toThrow();
      expect(JSON.stringify(invalid)).toBe(original);
    }
  });
});
const source = (): BakedTake => ({
  id: 'author-key-source', schemaVersion: 'preview-1', planId: 'plan', countMapId: 'map',
  durationSeconds: 1.02, provenance: 'synthetic-demo',
  times: [0, 0.27, 0.61, 1.02], poses: [neutral(), neutral(), neutral(), neutral()],
});
const distance = (a: number[], b: number[]) => Math.hypot(...a.map((value, axis) => value - b[axis]));
const angularDistance = (a: Quat, b: Quat) => new Quaternion(...a).angleTo(new Quaternion(...b));
const atFrame = (take: BakedTake, frame: number): Pose => {
  const index = take.times.indexOf(frameTime(frame, take.durationSeconds));
  expect(index).toBeGreaterThanOrEqual(0);
  return take.poses[index];
};
const withLeftLock = (base: BakedTake) => addFootLock(
  makeKeyframeSequence(base),
  captureFootLock(neutral(), 'LeftFoot', 0, lastFrame(base.durationSeconds), 0),
);

describe('explicit author keys take precedence over automatic foot support', () => {
  it('keeps every full-pose author channel exact at conflicting middle and precise final keys, including legacy rotations', () => {
    const base = source(), original = JSON.stringify(base), end = lastFrame(base.durationSeconds);
    const middle = neutral(), final = neutral();
    middle.root = [0.24, 1.08, 0.12]; final.root = [0.35, 1.1, -0.04];
    for (const [index, joint] of EDITABLE_JOINT_NAMES.entries()) {
      middle.joints[joint] = rotationFromDegrees([index % 3 * 6, index % 4 * 4, index % 5 * 3]);
      final.joints[joint] = rotationFromDegrees([-(index % 3) * 7, index % 4 * 5, -(index % 5) * 2]);
    }
    // Existing explicit keys may predate the editing envelopes; support must
    // neither overwrite nor silently repair that recorded author authority.
    middle.joints.LeftLowerLeg = rotationFromDegrees([-80, 0, 0]);
    final.joints.LeftLowerLeg = rotationFromDegrees([-65, 0, 0]);
    expect(isJointRotationWithinLimits('LeftLowerLeg', middle.joints.LeftLowerLeg)).toBe(false);
    let sequence = setPoseKeyframe(withLeftLock(base), 9, middle);
    sequence = setPoseKeyframe(sequence, end, final);
    const stored = JSON.stringify(sequence), baked = bakeKeyframeSequence(sequence);

    for (const frame of [9, end]) {
      const pose = atFrame(baked, frame), protection = getKeyframeProtection(sequence, frame);
      expect(pose.root).toEqual(sequence.root.find(key => key.frame === frame)!.position);
      expect(protection.root).toBe(1);
      for (const joint of EDITABLE_JOINT_NAMES) {
        expect(pose.joints[joint]).toEqual(sequence.rotations[joint]!.find(key => key.frame === frame)!.rotation);
        expect(protection.joints?.[joint]).toBe(1);
      }
      for (const joint of JOINT_NAMES.filter(joint => !EDITABLE_JOINT_NAMES.includes(joint))) {
        expect(pose.joints[joint]).toEqual(neutral().joints[joint]);
        expect(protection.joints?.[joint]).toBeUndefined();
      }
      expect(distance(evaluatePose(pose).LeftFoot.position, sequence.footLocks![0].target)).toBeGreaterThan(0.05);
    }
    expect(baked.times.at(-1)).toBe(1.02);
    for (const time of base.times) expect(baked.times).toContain(time);
    expect(getKeyframeCount(sequence)).toBe(40);
    expect(JSON.stringify(base)).toBe(original);
    expect(JSON.stringify(sequence)).toBe(stored);
  });

  it('protects one explicit rotation while still solving unkeyed channels and preserving the opposite leg', () => {
    const base = source();
    for (const pose of base.poses) pose.root[0] = 0.15;
    const original = JSON.stringify(base);
    const sequence = upsertRotationKeyframe(withLeftLock(base), 'LeftLowerLeg', 12, rotationFromDegrees([-70, 0, 0]));
    const protection = getKeyframeProtection(sequence, 12), pose = atFrame(bakeKeyframeSequence(sequence), 12);
    expect(protection.root).toBeUndefined();
    expect(protection.joints).toEqual({ LeftLowerLeg: 1 });
    expect(pose.joints.LeftLowerLeg).toEqual(sequence.rotations.LeftLowerLeg![0].rotation);
    expect(isJointRotationWithinLimits('LeftLowerLeg', pose.joints.LeftLowerLeg)).toBe(false);
    expect(pose.root[1]).toBeLessThan(base.poses[0].root[1]);
    expect(angularDistance(pose.joints.LeftUpperLeg, base.poses[0].joints.LeftUpperLeg)).toBeGreaterThan(0.01);
    expect(isJointRotationWithinLimits('LeftUpperLeg', pose.joints.LeftUpperLeg)).toBe(true);
    for (const joint of ['RightUpperLeg', 'RightLowerLeg', 'RightFoot', 'Chest'] as const) {
      expect(pose.joints[joint]).toEqual(base.poses[0].joints[joint]);
    }
    expect(JSON.stringify(base)).toBe(original);
  });

  it('keeps a Root-only key exact without reach lowering and reports residuals from the actual protected pose', () => {
    const base = source(), sequence = upsertRootKeyframe(withLeftLock(base), 12, [0.15, 1.05, 0]);
    const pose = neutral(); pose.root = [...sequence.root[0].position];
    const lock = sequence.footLocks![0], protection = getKeyframeProtection(sequence, 12);
    expect(protection.root).toBe(1); expect(protection.joints ?? {}).toEqual({});
    const automatic = applyFootLocks(pose, [lock], 12, base.durationSeconds);
    const protectedResult = applyFootLocks(pose, [lock], 12, base.durationSeconds, protection);
    expect(automatic.adjustedRoot).toBe(true);
    expect(protectedResult.adjustedRoot).toBe(false);
    expect(protectedResult.pose.root).toEqual(pose.root);
    expect(atFrame(bakeKeyframeSequence(sequence), 12).root).toEqual(pose.root);
    expect(angularDistance(protectedResult.pose.joints.LeftUpperLeg, pose.joints.LeftUpperLeg)).toBeGreaterThan(0.01);
    for (const joint of ['LeftUpperLeg', 'LeftLowerLeg', 'LeftFoot'] as const) {
      expect(isJointRotationWithinLimits(joint, protectedResult.pose.joints[joint])).toBe(true);
    }
    const actual = evaluatePose(protectedResult.pose).LeftFoot, residual = protectedResult.residuals[0];
    expect(residual.residual).toBeCloseTo(distance(actual.position, lock.target), 12);
    expect(residual.orientationResidual).toBeCloseTo(angularDistance(actual.rotation, lock.rotation), 12);
    expect(residual.reached).toBe(residual.residual <= 0.005 && residual.orientationResidual <= Math.PI / 90);
    expect(pose.root).toEqual([0.15, 1.05, 0]);
  });

  it('recomputes both neighboring interpolation intervals when a teacher adds a middle key, without extra explicit keys', () => {
    const base = source(), original = JSON.stringify(base);
    let sequence = upsertRotationKeyframe(makeKeyframeSequence(base), 'Chest', 0, rotationFromDegrees([0, 0, 0]));
    sequence = upsertRotationKeyframe(sequence, 'Chest', 30, rotationFromDegrees([0, 0, 90]));
    sequence = upsertRootKeyframe(sequence, 0, [0, 1.05, 0]);
    sequence = upsertRootKeyframe(sequence, 30, [2, 1.05, 0]);
    const before = bakeKeyframeSequence(sequence), stored = JSON.stringify(sequence);
    const withRotation = upsertRotationKeyframe(sequence, 'Chest', 15, rotationFromDegrees([0, 0, -60]));
    const changed = upsertRootKeyframe(withRotation, 15, [-1, 1.05, 0]), after = bakeKeyframeSequence(changed);
    for (const [time, beforeAngle, afterAngle, beforeX, afterX] of [[0.25, 22.5, -30, 0.5, -0.5], [0.75, 67.5, 15, 1.5, 0.5]]) {
      expect(angularDistance(sampleTake(before, time).joints.Chest, rotationFromDegrees([0, 0, beforeAngle]))).toBeCloseTo(0, 7);
      expect(angularDistance(sampleTake(after, time).joints.Chest, rotationFromDegrees([0, 0, afterAngle]))).toBeCloseTo(0, 7);
      expect(sampleTake(before, time).root[0]).toBeCloseTo(beforeX, 12);
      expect(sampleTake(after, time).root[0]).toBeCloseTo(afterX, 12);
    }
    expect(getKeyframeCount(sequence)).toBe(4); expect(getKeyframeCount(changed)).toBe(6);
    expect(atFrame(after, 15).joints.Chest).toEqual(changed.rotations.Chest![1].rotation);
    expect(after.times.at(-1)).toBe(base.durationSeconds);
    expect(JSON.stringify(sequence)).toBe(stored); expect(JSON.stringify(base)).toBe(original);
  });

  it('removes or moves protection with the explicit keys while keeping contact metadata and source sequence immutable', () => {
    const base = source();
    let sequence = upsertRotationKeyframe(withLeftLock(base), 'LeftLowerLeg', 12, rotationFromDegrees([-70, 0, 0]));
    sequence = upsertRootKeyframe(sequence, 12, [0.2, 1.07, 0]);
    const original = JSON.stringify(sequence);
    const rotationRemoved = removeRotationKeyframe(sequence, 'LeftLowerLeg', 12);
    expect(getKeyframeProtection(rotationRemoved, 12).joints?.LeftLowerLeg).toBeUndefined();
    expect(getKeyframeProtection(rotationRemoved, 12).root).toBe(1);
    const allRemoved = removeRootKeyframe(rotationRemoved, 12);
    expect(getKeyframeProtection(allRemoved, 12).root).toBeUndefined();
    expect(getKeyframeProtection(allRemoved, 12).joints ?? {}).toEqual({});
    const transfer = transferKeyframes(sequence, { operation: 'move', scope: { kind: 'all' }, sourceFrame: 12, targetFrame: 21 });
    expect(transfer.status).toBe('changed');
    const moved = transfer.sequence, old = getKeyframeProtection(moved, 12), next = getKeyframeProtection(moved, 21);
    expect(old.root).toBeUndefined(); expect(old.joints?.LeftLowerLeg).toBeUndefined();
    expect(next.root).toBe(1); expect(next.joints?.LeftLowerLeg).toBe(1);
    const pose = atFrame(bakeKeyframeSequence(moved), 21);
    expect(pose.root).toEqual(moved.root[0].position);
    expect(pose.joints.LeftLowerLeg).toEqual(moved.rotations.LeftLowerLeg![0].rotation);
    expect(getKeyframeCount(moved)).toBe(2);
    expect(moved.footLocks).toEqual(sequence.footLocks); expect(allRemoved.footLocks).toEqual(sequence.footLocks);
    expect(JSON.stringify(sequence)).toBe(original);
  });

  it('uses independent nearest-key smooth protection and does not hard-clamp partially protected legacy author intent', () => {
    const base = source();
    let sequence = upsertRotationKeyframe(makeKeyframeSequence(base), 'LeftLowerLeg', 12, rotationFromDegrees([-70, 0, 0]));
    sequence = upsertRootKeyframe(sequence, 6, [0.15, 1.05, 0]);
    sequence = upsertRootKeyframe(sequence, 18, [0.25, 1.05, 0]);
    // Historical tracks have no final-hold version and retain symmetric fades.
    delete sequence.trackInterpolation;
    const value = (frame: number) => getKeyframeProtection(sequence, frame).joints?.LeftLowerLeg ?? 0;
    expect(value(12)).toBe(1); expect(value(12 + 5e-9)).toBe(1);
    expect(value(11)).toBeCloseTo(20 / 27, 12); expect(value(13)).toBeCloseTo(20 / 27, 12);
    expect(value(10)).toBeCloseTo(7 / 27, 12); expect(value(14)).toBeCloseTo(7 / 27, 12);
    expect(value(9)).toBe(0); expect(value(15)).toBe(0);
    expect(getKeyframeProtection(sequence, 8).root).toBeCloseTo(7 / 27, 12);
    expect(getKeyframeProtection(sequence, 16).root).toBeCloseTo(7 / 27, 12);
    expect(getKeyframeProtection(sequence, 12).root).toBeUndefined();
    for (const frame of [0, lastFrame(base.durationSeconds)]) {
      expect(getKeyframeProtection(sequence, frame).root).toBeUndefined();
      expect(getKeyframeProtection(sequence, frame).joints?.LeftLowerLeg).toBeUndefined();
    }
    expect(getKeyframeProtection(sequence, 12).joints?.Chest).toBeUndefined();

    const pose = neutral(); pose.root[0] = 0.15; pose.joints.LeftLowerLeg = sequence.rotations.LeftLowerLeg![0].rotation;
    const original = JSON.stringify(pose), lock = captureFootLock(neutral(), 'LeftFoot', 0, lastFrame(base.durationSeconds), 0);
    const automatic = applyFootLocks(pose, [lock], 12, base.durationSeconds, { root: 1 });
    const partial = applyFootLocks(pose, [lock], 12, base.durationSeconds, { root: 1, joints: { LeftLowerLeg: 0.9 } });
    const held = applyFootLocks(pose, [lock], 12, base.durationSeconds, { root: 1, joints: { LeftLowerLeg: 1 } });
    expect(isJointRotationWithinLimits('LeftLowerLeg', automatic.pose.joints.LeftLowerLeg)).toBe(true);
    expect(isJointRotationWithinLimits('LeftLowerLeg', partial.pose.joints.LeftLowerLeg)).toBe(false);
    expect(angularDistance(partial.pose.joints.LeftLowerLeg, pose.joints.LeftLowerLeg)).toBeGreaterThan(0.001);
    expect(angularDistance(partial.pose.joints.LeftLowerLeg, pose.joints.LeftLowerLeg)).toBeLessThan(angularDistance(automatic.pose.joints.LeftLowerLeg, pose.joints.LeftLowerLeg));
    expect(held.pose.joints.LeftLowerLeg).toEqual(pose.joints.LeftLowerLeg);
    const actual = evaluatePose(held.pose).LeftFoot;
    expect(held.residuals[0].residual).toBeCloseTo(distance(actual.position, lock.target), 12);
    expect(held.residuals[0].orientationResidual).toBeCloseTo(angularDistance(actual.rotation, lock.rotation), 12);
    expect(held.residuals[0].reached).toBe(false);
    expect(JSON.stringify(pose)).toBe(original);
  });
});
