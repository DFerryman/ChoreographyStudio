import { describe, expect, it } from 'vitest';
import { JOINT_NAMES, type BakedTake, type Pose } from './motion-types';
import { evaluatePose } from './humanoid';
import { applyFootLocks, captureFootLock, footLockWeight, MAX_FOOT_LOCKS, validateFootLocks } from './footLocks';
import { addFootLock, bakeKeyframeSequence, frameTime, getKeyframeCount, lastFrame, makeKeyframeSequence, removeFootLock, removePoseKeyframe, rotationFromDegrees, setPoseKeyframe, transferKeyframes, upsertRootKeyframe, upsertRotationKeyframe } from './keyframes';
import { isJointRotationWithinLimits } from './jointConstraints';

const neutral = (): Pose => ({ root: [0, 1.05, 0], joints: Object.fromEntries(JOINT_NAMES.map(name => [name, [0, 0, 0, 1]])) as Pose['joints'] });
const source = (): BakedTake => ({ id: 'source', schemaVersion: 'preview-1', planId: 'plan', countMapId: 'map', durationSeconds: 1.02, provenance: 'synthetic-demo', times: [0, 0.27, 0.61, 1.02], poses: [neutral(), neutral(), neutral(), neutral()] });
const distance = (a: number[], b: number[]) => Math.hypot(...a.map((value, axis) => value - b[axis]));

describe('persistent explicit foot support constraints', () => {
  it('captures the actual ankle/world orientation, keeping the sole distinct from toe/heel markers', () => {
    const pose = neutral(), lock = captureFootLock(pose, 'LeftFoot', 0, 30);
    expect(lock.target[1]).toBeCloseTo(0.09, 12);
    expect(evaluatePose(pose).LeftToe.position[1]).toBeCloseTo(0.055, 12);
    expect(lock.rotation).toEqual([0, 0, 0, 1]);
    expect(lock.target).toEqual(evaluatePose(pose).LeftFoot.position);
    lock.target[0] = 2; expect(pose.root[0]).toBe(0);
  });

  it('does not bend or lower an already satisfied neutral foot lock', () => {
    const pose = neutral(), lock = captureFootLock(pose, 'LeftFoot', 0, 30, 0);
    const result = applyFootLocks(pose, [lock], 15, 1);
    expect(result.adjustedRoot).toBe(false);
    expect(result.pose.root[1]).toBeCloseTo(pose.root[1], 12);
    for (const joint of JOINT_NAMES) expect(result.pose.joints[joint]).toEqual(pose.joints[joint]);
    expect(result.residuals[0].reached).toBe(true);
  });

  it('preserves both world foot anchors through an authored Root move and permits explicit reach lowering', () => {
    const pose = neutral(), locks = ['LeftFoot', 'RightFoot'].map(foot => captureFootLock(pose, foot as 'LeftFoot' | 'RightFoot', 0, 30, 0));
    pose.root[0] = 0.15;
    const result = applyFootLocks(pose, locks, 15, 1);
    expect(result.adjustedRoot).toBe(true); expect(result.pose.root[1]).toBeLessThan(pose.root[1]);
    expect(result.pose.root[0]).toBe(0.15); expect(result.pose.root[2]).toBe(0);
    for (const residual of result.residuals) { expect(residual.residual).toBeLessThan(0.005); expect(residual.orientationResidual).toBeLessThan(0.035); expect(residual.reached).toBe(true); }
    for (const foot of ['LeftFoot', 'RightFoot'] as const) expect(distance(evaluatePose(result.pose)[foot].position, locks.find(lock => lock.foot === foot)!.target)).toBeLessThan(0.005);
    for (const name of ['LeftUpperLeg', 'LeftLowerLeg', 'LeftFoot', 'RightUpperLeg', 'RightLowerLeg', 'RightFoot'] as const) expect(isJointRotationWithinLimits(name, result.pose.joints[name])).toBe(true);
    expect(result.pose.joints.Chest).toEqual(pose.joints.Chest);
  });

  it('blends only inside a contact interval and releases at its boundaries for flight/turning', () => {
    const pose = neutral(), lock = captureFootLock(pose, 'LeftFoot', 3, 20, 3);
    expect(footLockWeight(lock, 2, 30)).toBe(0); expect(footLockWeight(lock, 3, 30)).toBe(0);
    expect(footLockWeight(lock, 4.5, 30)).toBeCloseTo(0.5, 12);
    expect(footLockWeight(lock, 6, 30)).toBe(1); expect(footLockWeight(lock, 17, 30)).toBe(1);
    expect(footLockWeight(lock, 20, 30)).toBe(0); expect(footLockWeight(lock, 21, 30)).toBe(0);
    pose.root[0] = 0.12;
    expect(applyFootLocks(pose, [lock], 2, 1).pose).toEqual(pose);
    expect(applyFootLocks(pose, [lock], 20, 1).pose).toEqual(pose);
    const held = applyFootLocks(pose, [lock], 10, 1);
    expect(held.residuals[0].weight).toBe(1); expect(held.residuals[0].residual).toBeLessThan(0.005);
    expect(applyFootLocks(pose, [lock], 21, 1).residuals).toEqual([]);
  });

  it('reports unreachable support without stretching, inventing a successful lock or moving Root X/Z', () => {
    const pose = neutral(), lock = captureFootLock(pose, 'LeftFoot', 0, 30, 0); lock.target[0] = 3;
    const result = applyFootLocks(pose, [lock], 15, 1);
    expect(result.residuals[0].reached).toBe(false); expect(result.residuals[0].residual).toBeGreaterThan(1);
    expect(result.pose.root).toEqual(pose.root);
    const world = evaluatePose(result.pose);
    expect(distance(world.LeftUpperLeg.position, world.LeftLowerLeg.position)).toBeCloseTo(0.46, 12);
    expect(distance(world.LeftLowerLeg.position, world.LeftFoot.position)).toBeCloseTo(0.45, 12);
  });

  it('reports orientation residual when an anchor would require an impossible ankle twist', () => {
    const pose = neutral(), lock = captureFootLock(pose, 'LeftFoot', 0, 30, 0);
    lock.rotation = rotationFromDegrees([0, 90, 0]);
    const result = applyFootLocks(pose, [lock], 15, 1);
    expect(result.residuals[0].residual).toBeLessThan(0.005);
    expect(result.residuals[0].orientationResidual).toBeGreaterThan(1);
    expect(result.residuals[0].reached).toBe(false);
    expect(isJointRotationWithinLimits('LeftFoot', result.pose.joints.LeftFoot)).toBe(true);
  });

  it('treats floating-point 30 Hz boundary roundoff as its exact contact frame', () => {
    const lock = captureFootLock(neutral(), 'LeftFoot', 14, 29, 0);
    expect(footLockWeight(lock, 13.999999999999998, 31)).toBe(1);
    expect(footLockWeight(lock, 29.000000000000004, 31)).toBe(1);
    expect(footLockWeight(lock, 29.0001, 31)).toBe(0);
  });

  it('rejects overlapping same-foot contacts, invalid versions/frames/quaternions and excess metadata atomically', () => {
    const pose = neutral(), first = captureFootLock(pose, 'LeftFoot', 0, 10, 0), second = captureFootLock(pose, 'LeftFoot', 10, 20, 0);
    expect(() => validateFootLocks([first, second], 1)).toThrow(/重叠/);
    expect(() => validateFootLocks([first, { ...second, foot: 'RightFoot' }], 1)).not.toThrow();
    for (const bad of [{ ...first, schema: 'x' }, { ...first, startFrame: -1 }, { ...first, endFrame: 31 }, { ...first, blendFrames: 16 }, { ...first, target: [Infinity, 0, 0] }, { ...first, rotation: [0, 0, 0, 2] }]) expect(() => validateFootLocks([bad as typeof first], 1)).toThrow();
    const many = Array.from({ length: MAX_FOOT_LOCKS + 1 }, (_, index) => ({ ...first, id: String(index), startFrame: index * 3, endFrame: index * 3 + 1 }));
    expect(() => validateFootLocks(many, 60)).toThrow(/数量/);
    const original = makeKeyframeSequence(source()), withLock = addFootLock(original, first), before = JSON.stringify(withLock);
    expect(() => addFootLock(withLock, second)).toThrow(); expect(JSON.stringify(withLock)).toBe(before);
  });
});

describe('bounded authoritative contact baking and save equivalence', () => {
  it('samples contact solving at 30 Hz while preserving exact base times/end without inserting track keys', () => {
    const base = source(), end = lastFrame(base.durationSeconds);
    let sequence = upsertRootKeyframe(makeKeyframeSequence(base), 0, [0, 1.05, 0]);
    sequence = upsertRootKeyframe(sequence, end, [0.15, 1.05, 0]);
    sequence = addFootLock(sequence, captureFootLock(base.poses[0], 'LeftFoot', 0, end, 0));
    sequence = addFootLock(sequence, captureFootLock(base.poses[0], 'RightFoot', 0, end, 0));
    const baked = bakeKeyframeSequence(sequence);
    expect(getKeyframeCount(sequence)).toBe(2); expect(Object.keys(sequence.rotations)).toEqual([]);
    expect(baked.times.at(-1)).toBe(1.02); expect(baked.planId).toBe(base.planId); expect(baked.countMapId).toBe(base.countMapId);
    for (const time of base.times) expect(baked.times).toContain(time);
    for (let frame = 0; frame <= end; frame++) expect(baked.times).toContain(frameTime(frame, 1.02));
    for (const pose of baked.poses) for (const lock of sequence.footLocks!) expect(distance(evaluatePose(pose)[lock.foot].position, lock.target)).toBeLessThan(0.005);
    const restored = JSON.parse(JSON.stringify(sequence));
    const second = bakeKeyframeSequence(restored);
    expect(second.times).toEqual(baked.times); expect(second.poses).toEqual(baked.poses); expect(second.id).not.toBe(baked.id);
    expect(base.poses.every(pose => pose.root[0] === 0)).toBe(true);
  });

  it('clones contact metadata across write/delete/transfer and removes a lock explicitly without touching the base', () => {
    const base = source(), lock = captureFootLock(base.poses[0], 'LeftFoot', 0, 30, 0);
    const original = addFootLock(makeKeyframeSequence(base), lock);
    let changed = setPoseKeyframe(original, 3, neutral());
    changed = upsertRotationKeyframe(changed, 'Chest', 9, [0, 0, 0, 1]);
    const transfer = transferKeyframes(changed, { operation: 'copy', scope: { kind: 'joint', joint: 'Chest' }, sourceFrame: 9, targetFrame: 12 });
    expect(transfer.status).toBe('changed'); changed = removePoseKeyframe(transfer.sequence, 3);
    expect(changed.footLocks).toEqual(original.footLocks);
    changed.footLocks![0].target[0] = 8; expect(original.footLocks![0].target[0]).toBeCloseTo(0.112, 12);
    const removed = removeFootLock(original, lock.id); expect(removed.footLocks).toEqual([]);
    expect(bakeKeyframeSequence(removed).times).toEqual(base.times); expect(bakeKeyframeSequence(removed).poses).toEqual(base.poses);
    expect(removeFootLock(original, 'missing')).toBe(original);
  });

  it('leaves old sequences and non-contact sample bits untouched and rejects sample overflow', () => {
    const base = source(), legacy = makeKeyframeSequence(base), baked = bakeKeyframeSequence(legacy);
    expect(legacy.footLocks).toBeUndefined(); expect(baked.times).toEqual(base.times); expect(baked.poses).toEqual(base.poses);
    const withLock = addFootLock(legacy, captureFootLock(base.poses[0], 'LeftFoot', 3, 20, 3));
    const solved = bakeKeyframeSequence(withLock);
    expect(solved.poses[0]).toEqual(base.poses[0]); expect(solved.poses.at(-1)).toEqual(base.poses.at(-1));
    const dense: BakedTake = { ...base, times: Array.from({ length: 6001 }, (_, index) => index * base.durationSeconds / 6000), poses: Array.from({ length: 6001 }, () => neutral()) };
    dense.times[6000] = dense.durationSeconds;
    expect(() => bakeKeyframeSequence(addFootLock(makeKeyframeSequence(dense), captureFootLock(dense.poses[0], 'LeftFoot', 0, 30, 0)))).toThrow(/样本/);
  });
});
