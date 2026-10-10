import { describe, expect, it } from 'vitest';
import {
  JOINT_NAMES, MAX_KEYFRAME_COUNT, MAX_TAKE_SAMPLES, addFootLock, bakeKeyframeSequence, captureFootLock, frameTime,
  getKeyframeCount, getKeyframeFrames, getKeyframeProtection, makeKeyframeSequence, sampleTake, setStepAssistance, transferKeyframes,
  upsertMotionPoint, upsertRootKeyframe, upsertRotationKeyframe,
  type BakedTake, type KeyframeSequence, type KeyframeTransferRequest, type Pose, type Quat,
} from './index';

const rotationZ = (degrees: number): Quat => [0, 0, Math.sin(degrees * Math.PI / 360), Math.cos(degrees * Math.PI / 360)];
const pose = (x: number, angle: number): Pose => ({
  root: [x, 1.05, 0], joints: Object.fromEntries(JOINT_NAMES.map(joint => [joint, rotationZ(angle)])) as Pose['joints'],
});
const base = (): BakedTake => ({
  id: 'transfer-source', planId: 'plan', countMapId: 'map', schemaVersion: 'preview-1', provenance: 'synthetic-demo',
  durationSeconds: 1.005, times: [0, 0.27, 0.61, 1.005], poses: [pose(0, 0), pose(0.3, 20), pose(0.9, -10), pose(1, 30)],
});
const request = (override: Partial<Extract<KeyframeTransferRequest, { sourceFrame: number }>> = {}): KeyframeTransferRequest => ({
  operation: 'move', scope: { kind: 'all' }, sourceFrame: 9, targetFrame: 15, ...override,
});
const changed = (sequence: KeyframeSequence, options: KeyframeTransferRequest, authority?: BakedTake) => {
  const result = transferKeyframes(sequence, options, authority);
  expect(result.status).toBe('changed');
  if (result.status !== 'changed') throw new Error('expected changed transfer');
  return result;
};

describe('explicit keyframe copy and move', () => {
  it('returns the original sequence for empty sources, implicit endpoints and same-frame requests', () => {
    const empty = makeKeyframeSequence(base());
    for (const sourceFrame of [0, 9, 31]) {
      const result = transferKeyframes(empty, request({ sourceFrame }));
      expect(result).toMatchObject({ status: 'noop', reason: 'empty-source', sourceKeyCount: 0 });
      expect(result.sequence).toBe(empty);
    }
    const sequence = upsertRootKeyframe(empty, 9, [1, 1, 0]);
    const same = transferKeyframes(sequence, request({ targetFrame: 9 }));
    expect(same).toMatchObject({ status: 'noop', reason: 'same-frame', sourceKeyCount: 1 });
    expect(same.sequence).toBe(sequence);
    const noJoint = transferKeyframes(sequence, request({ scope: { kind: 'joint', joint: 'Head' } }));
    expect(noJoint.sequence).toBe(sequence);
    expect(noJoint.status).toBe('noop');
  });

  it('moves one joint without changing source/destination keys of other joints or Root', () => {
    let sequence = upsertRotationKeyframe(makeKeyframeSequence(base()), 'LeftForeArm', 9, rotationZ(75));
    sequence = upsertRotationKeyframe(sequence, 'Head', 9, rotationZ(25));
    sequence = upsertRotationKeyframe(sequence, 'Head', 15, rotationZ(50));
    sequence = upsertRootKeyframe(sequence, 9, [1, 1, 0]);
    sequence = upsertRootKeyframe(sequence, 15, [2, 1, 0]);
    const snapshot = JSON.stringify(sequence);
    const result = changed(sequence, request({ scope: { kind: 'joint', joint: 'LeftForeArm' } }));
    expect(result.sourceKeyCount).toBe(1);
    expect(result.replaced).toEqual([]);
    expect(result.sequence.id).not.toBe(sequence.id);
    expect(result.sequence.baseTake).toBe(sequence.baseTake);
    expect(result.sequence.rotations.LeftForeArm).toEqual([{ frame: 15, rotation: rotationZ(75) }]);
    expect(result.sequence.rotations.Head).toEqual(sequence.rotations.Head);
    expect(result.sequence.root).toEqual(sequence.root);
    expect(JSON.stringify(sequence)).toBe(snapshot);
    const baked = bakeKeyframeSequence(result.sequence);
    for (const time of sequence.baseTake.times) {
      expect(baked.times).toContain(time);
      expect(sampleTake(baked, time).joints.LeftHandTip).toEqual(sampleTake(sequence.baseTake, time).joints.LeftHandTip);
    }
  });

  it('copies Root independently with no source/destination array aliases', () => {
    let sequence = upsertRootKeyframe(makeKeyframeSequence(base()), 9, [1.5, 1.2, -0.5]);
    sequence = upsertRotationKeyframe(sequence, 'Head', 15, rotationZ(60));
    const snapshot = JSON.stringify(sequence);
    const result = changed(sequence, request({ operation: 'copy', scope: { kind: 'root' } }));
    expect(result.sequence.root).toEqual([{ frame: 9, position: [1.5, 1.2, -0.5] }, { frame: 15, position: [1.5, 1.2, -0.5] }]);
    expect(result.sequence.rotations).toEqual(sequence.rotations);
    expect(result.sequence.root[0].position).not.toBe(sequence.root[0].position);
    expect(result.sequence.root[1].position).not.toBe(result.sequence.root[0].position);
    result.sequence.root[1].position[0] = 2;
    result.sequence.rotations.Head![0].rotation[0] = 0.5;
    expect(result.sequence.root[0].position[0]).toBe(1.5);
    expect(JSON.stringify(sequence)).toBe(snapshot);
  });

  it('moves a sparse joint group in one operation while keeping Root and other groups unchanged', () => {
    let sequence = upsertRotationKeyframe(makeKeyframeSequence(base()), 'LeftUpperArm', 9, rotationZ(75));
    sequence = upsertRotationKeyframe(sequence, 'LeftForeArm', 9, rotationZ(25));
    sequence = upsertRotationKeyframe(sequence, 'LeftHand', 15, rotationZ(50));
    sequence = upsertRotationKeyframe(sequence, 'Head', 9, rotationZ(10));
    sequence = upsertRotationKeyframe(sequence, 'Head', 15, rotationZ(60));
    sequence = upsertRootKeyframe(sequence, 9, [1, 1, 0]);
    sequence = upsertRootKeyframe(sequence, 15, [2, 1, 0]);
    const snapshot = JSON.stringify(sequence);
    const result = changed(sequence, request({ scope: { kind: 'joints', joints: ['LeftShoulder', 'LeftUpperArm', 'LeftForeArm', 'LeftHand'] } }));
    expect(result.sourceKeyCount).toBe(2);
    expect(result.replaced).toEqual([]);
    expect(result.sequence.id).not.toBe(sequence.id);
    expect(result.sequence.baseTake).toBe(sequence.baseTake);
    expect(result.sequence.rotations.LeftUpperArm).toEqual([{ frame: 15, rotation: sequence.rotations.LeftUpperArm![0].rotation }]);
    expect(result.sequence.rotations.LeftForeArm).toEqual([{ frame: 15, rotation: sequence.rotations.LeftForeArm![0].rotation }]);
    expect(result.sequence.rotations.LeftShoulder).toBeUndefined();
    expect(result.sequence.rotations.LeftHand).toEqual(sequence.rotations.LeftHand);
    expect(result.sequence.rotations.Head).toEqual(sequence.rotations.Head);
    expect(result.sequence.root).toEqual(sequence.root);
    expect(getKeyframeCount(result.sequence)).toBe(getKeyframeCount(sequence));
    expect(JSON.stringify(sequence)).toBe(snapshot);
    const baked = bakeKeyframeSequence(result.sequence);
    expect(sampleTake(baked, 0.5).joints.LeftUpperArm).toEqual(sequence.rotations.LeftUpperArm![0].rotation);
    expect(sampleTake(baked, 0.5).joints.LeftForeArm).toEqual(sequence.rotations.LeftForeArm![0].rotation);
    for (const time of sequence.baseTake.times) {
      expect(baked.times).toContain(time);
      expect(sampleTake(baked, time).joints.RightUpperArm).toEqual(sampleTake(sequence.baseTake, time).joints.RightUpperArm);
      expect(sampleTake(baked, time).joints.LeftHandTip).toEqual(sampleTake(sequence.baseTake, time).joints.LeftHandTip);
    }
  });

  it('copies a joint group without aliasing the source or the copied payloads', () => {
    let sequence = upsertRotationKeyframe(makeKeyframeSequence(base()), 'LeftUpperArm', 9, rotationZ(75));
    sequence = upsertRotationKeyframe(sequence, 'LeftForeArm', 9, rotationZ(25));
    sequence = upsertRootKeyframe(sequence, 9, [1, 1, 0]);
    const snapshot = JSON.stringify(sequence);
    const result = changed(sequence, request({ operation: 'copy', scope: { kind: 'joints', joints: ['LeftForeArm', 'LeftUpperArm'] } }));
    expect(result.sourceKeyCount).toBe(2);
    expect(getKeyframeCount(result.sequence)).toBe(5);
    expect(result.sequence.root).toEqual(sequence.root);
    for (const joint of ['LeftUpperArm', 'LeftForeArm'] as const) {
      const keys = result.sequence.rotations[joint]!;
      expect(keys.map(key => key.frame)).toEqual([9, 15]);
      expect(keys[0].rotation).toEqual(keys[1].rotation);
      expect(keys[0].rotation).not.toBe(sequence.rotations[joint]![0].rotation);
      expect(keys[1].rotation).not.toBe(keys[0].rotation);
      keys[1].rotation[0] = 0.5;
      expect(keys[0].rotation[0]).toBe(0);
    }
    expect(JSON.stringify(sequence)).toBe(snapshot);
  });

  it('reports grouped collisions on concrete tracks and replaces only explicit source tracks atomically', () => {
    let sequence = upsertRotationKeyframe(makeKeyframeSequence(base()), 'LeftUpperArm', 9, rotationZ(20));
    sequence = upsertRotationKeyframe(sequence, 'LeftForeArm', 9, rotationZ(40));
    sequence = upsertRotationKeyframe(sequence, 'LeftUpperArm', 15, rotationZ(90));
    sequence = upsertRotationKeyframe(sequence, 'LeftForeArm', 15, rotationZ(90));
    sequence = upsertRotationKeyframe(sequence, 'LeftHand', 15, rotationZ(10));
    sequence = upsertRotationKeyframe(sequence, 'RightUpperArm', 9, rotationZ(15));
    sequence = upsertRootKeyframe(sequence, 9, [1, 1, 0]);
    sequence = upsertRootKeyframe(sequence, 15, [3, 1, 2]);
    const snapshot = JSON.stringify(sequence);
    const scope = { kind: 'joints', joints: ['LeftHand', 'LeftForeArm', 'LeftUpperArm'] } as const;
    for (const operation of ['copy', 'move'] as const) {
      const options = request({ operation, scope: { ...scope, joints: [...scope.joints] } });
      const conflict = transferKeyframes(sequence, options);
      expect(conflict).toMatchObject({ status: 'conflict', sourceKeyCount: 2, collisions: [{ kind: 'joint', joint: 'LeftUpperArm' }, { kind: 'joint', joint: 'LeftForeArm' }] });
      expect(conflict.sequence).toBe(sequence);
      const result = changed(sequence, { ...options, collision: 'replace' });
      expect(result.replaced).toEqual([{ kind: 'joint', joint: 'LeftUpperArm' }, { kind: 'joint', joint: 'LeftForeArm' }]);
      expect(result.sequence.rotations.LeftUpperArm?.find(key => key.frame === 15)?.rotation).toEqual(sequence.rotations.LeftUpperArm![0].rotation);
      expect(result.sequence.rotations.LeftForeArm?.find(key => key.frame === 15)?.rotation).toEqual(sequence.rotations.LeftForeArm![0].rotation);
      expect(result.sequence.rotations.LeftHand).toEqual(sequence.rotations.LeftHand);
      expect(result.sequence.rotations.RightUpperArm).toEqual(sequence.rotations.RightUpperArm);
      expect(result.sequence.root).toEqual(sequence.root);
      expect(getKeyframeCount(result.sequence)).toBe(operation === 'copy' ? 8 : 6);
      expect(result.sequence.rotations.LeftUpperArm?.some(key => key.frame === 9)).toBe(operation === 'copy');
      expect(result.sequence.rotations.LeftForeArm?.some(key => key.frame === 9)).toBe(operation === 'copy');
    }
    expect(JSON.stringify(sequence)).toBe(snapshot);
  });

  it('moves grouped author protection to the new time and retains assistance metadata and exact authored values', () => {
    const source = base(); source.poses = source.times.map(() => pose(0, 0));
    let sequence = addFootLock(makeKeyframeSequence(source), captureFootLock(source.poses[0], 'LeftFoot', 0, 31, 0));
    sequence = setStepAssistance(sequence);
    sequence = upsertRotationKeyframe(sequence, 'LeftUpperLeg', 9, rotationZ(100));
    sequence = upsertRotationKeyframe(sequence, 'LeftLowerLeg', 9, rotationZ(-80));
    const snapshot = JSON.stringify(sequence);
    const result = changed(sequence, request({ scope: { kind: 'joints', joints: ['LeftUpperLeg', 'LeftLowerLeg', 'LeftFoot'] } }));
    expect(result.sequence.authorKeyPriority).toBe('author-key-priority-1');
    expect(result.sequence.baseTake).toBe(sequence.baseTake);
    expect(result.sequence.footLocks).toEqual(sequence.footLocks);
    expect(result.sequence.footLocks).not.toBe(sequence.footLocks);
    expect(result.sequence.footLocks![0].target).not.toBe(sequence.footLocks![0].target);
    expect(result.sequence.steps).toEqual(sequence.steps);
    expect(result.sequence.steps).not.toBe(sequence.steps);
    expect(getKeyframeProtection(result.sequence, 9)).toEqual({});
    expect(getKeyframeProtection(result.sequence, 15)).toEqual({ joints: { LeftUpperLeg: 1, LeftLowerLeg: 1 } });
    const baked = bakeKeyframeSequence(result.sequence);
    expect(baked.times.at(-1)).toBe(source.durationSeconds);
    expect(sampleTake(baked, 0.5).joints.LeftUpperLeg).toEqual(sequence.rotations.LeftUpperLeg![0].rotation);
    expect(sampleTake(baked, 0.5).joints.LeftLowerLeg).toEqual(sequence.rotations.LeftLowerLeg![0].rotation);
    expect(JSON.stringify(sequence)).toBe(snapshot);
  });

  it('reports sparse all-track collisions atomically and preserves destination-only tracks after replacement', () => {
    let sequence = upsertRotationKeyframe(makeKeyframeSequence(base()), 'Head', 9, rotationZ(20));
    sequence = upsertRotationKeyframe(sequence, 'Neck', 9, rotationZ(40));
    sequence = upsertRotationKeyframe(sequence, 'Head', 15, rotationZ(90));
    sequence = upsertRotationKeyframe(sequence, 'Chest', 15, rotationZ(10));
    sequence = upsertRootKeyframe(sequence, 15, [3, 1, 2]);
    const snapshot = JSON.stringify(sequence);
    for (const operation of ['copy', 'move'] as const) {
      const conflict = transferKeyframes(sequence, request({ operation }));
      expect(conflict).toMatchObject({ status: 'conflict', sourceKeyCount: 2, collisions: [{ kind: 'joint', joint: 'Head' }] });
      expect(conflict.sequence).toBe(sequence);
      const result = changed(sequence, request({ operation, collision: 'replace' }));
      expect(result.replaced).toEqual([{ kind: 'joint', joint: 'Head' }]);
      expect(result.sequence.rotations.Head?.find(key => key.frame === 15)?.rotation).toEqual(sequence.rotations.Head?.find(key => key.frame === 9)?.rotation);
      expect(result.sequence.rotations.Neck?.find(key => key.frame === 15)?.rotation).toEqual(sequence.rotations.Neck?.find(key => key.frame === 9)?.rotation);
      expect(result.sequence.rotations.Chest).toEqual(sequence.rotations.Chest);
      expect(result.sequence.root).toEqual(sequence.root);
      expect(getKeyframeCount(result.sequence)).toBe(operation === 'copy' ? 6 : 4);
      expect(result.sequence.rotations.Head?.some(key => key.frame === 9)).toBe(operation === 'copy');
    }
    expect(JSON.stringify(sequence)).toBe(snapshot);
  });

  it('requires collision confirmation even for equal payloads, then skips an unchanged copy', () => {
    let sequence = upsertRootKeyframe(makeKeyframeSequence(base()), 9, [1, 1, 0]);
    sequence = upsertRootKeyframe(sequence, 15, [1, 1, 0]);
    const conflict = transferKeyframes(sequence, request({ operation: 'copy', scope: { kind: 'root' } }));
    expect(conflict).toMatchObject({ status: 'conflict', collisions: [{ kind: 'root' }] });
    const confirmed = transferKeyframes(sequence, request({ operation: 'copy', scope: { kind: 'root' }, collision: 'replace' }));
    expect(confirmed).toMatchObject({ status: 'noop', reason: 'unchanged', sourceKeyCount: 1 });
    expect(confirmed.sequence).toBe(sequence);
    expect(getKeyframeCount(sequence)).toBe(2);
  });

  it('moves explicit endpoint keys while restoring the base start and holding the last key through the exact short tail', () => {
    let sequence = upsertRootKeyframe(makeKeyframeSequence(base()), 0, [2, 2, 1]);
    sequence = upsertRotationKeyframe(sequence, 'Head', 31, rotationZ(120));
    const start = changed(sequence, request({ scope: { kind: 'root' }, sourceFrame: 0 }));
    const final = changed(start.sequence, request({ scope: { kind: 'joint', joint: 'Head' }, sourceFrame: 31, targetFrame: 30 }));
    const baked = bakeKeyframeSequence(final.sequence);
    expect(final.sequence.baseTake).toBe(sequence.baseTake);
    expect(baked.times.at(-1)).toBe(1.005);
    expect(frameTime(31, baked.durationSeconds)).toBe(1.005);
    expect(getKeyframeFrames(final.sequence)).toEqual([15, 30]);
    expect(sampleTake(baked, 0).root).toEqual(sequence.baseTake.poses[0].root);
    expect(sampleTake(baked, 1.005).joints.Head).toEqual(rotationZ(120));
    expect(sampleTake(baked, 1.005).root).toEqual([2, 2, 1]);
    expect(sampleTake(baked, 0.5).root).toEqual([2, 2, 1]);
    expect(sampleTake(baked, 1).joints.Head).toEqual(rotationZ(120));
    for (const time of sequence.baseTake.times) expect(baked.times).toContain(time);
  });

  it('rejects aggregate copy growth atomically while allowing moves and replacement at the limit', () => {
    const source = base(); source.durationSeconds = 60; source.times = [0, 60]; source.poses = [pose(0, 0), pose(1, 20)];
    const sequence = makeKeyframeSequence(source);
    sequence.rotations.Head = Array.from({ length: 1801 }, (_, frame) => ({ frame, rotation: rotationZ(0) }));
    sequence.rotations.Neck = Array.from({ length: 1801 }, (_, frame) => ({ frame, rotation: rotationZ(0) }));
    sequence.root = Array.from({ length: MAX_KEYFRAME_COUNT - 3602 }, (_, frame) => ({ frame, position: [0, 1.05, 0] }));
    sequence.rotations.Head[10].rotation = rotationZ(25);
    const snapshot = JSON.stringify(sequence);
    expect(() => transferKeyframes(sequence, request({ operation: 'copy', scope: { kind: 'root' }, sourceFrame: 0, targetFrame: 1500 }))).toThrow(/4096/);
    expect(getKeyframeCount(changed(sequence, request({ scope: { kind: 'root' }, sourceFrame: 0, targetFrame: 1500 })).sequence)).toBe(MAX_KEYFRAME_COUNT);
    expect(getKeyframeCount(changed(sequence, request({ operation: 'copy', scope: { kind: 'joint', joint: 'Head' }, sourceFrame: 10, targetFrame: 1800, collision: 'replace' })).sequence)).toBe(MAX_KEYFRAME_COUNT);
    expect(JSON.stringify(sequence)).toBe(snapshot);
  });

  it('counts all grouped copy growth against the aggregate limit before making any change', () => {
    const source = base(); source.durationSeconds = 60; source.times = [0, 60]; source.poses = [pose(0, 0), pose(1, 20)];
    const sequence = makeKeyframeSequence(source);
    sequence.rotations.Head = Array.from({ length: 1801 }, (_, frame) => ({ frame, rotation: rotationZ(0) }));
    sequence.rotations.Neck = Array.from({ length: 1801 }, (_, frame) => ({ frame, rotation: rotationZ(0) }));
    sequence.root = Array.from({ length: MAX_KEYFRAME_COUNT - 3606 }, (_, frame) => ({ frame, position: [0, 1.05, 0] }));
    for (const joint of ['LeftUpperArm', 'LeftForeArm'] as const) sequence.rotations[joint] = [{ frame: 9, rotation: rotationZ(25) }, { frame: 15, rotation: rotationZ(0) }];
    const snapshot = JSON.stringify(sequence);
    const scope: KeyframeTransferRequest['scope'] = { kind: 'joints', joints: ['LeftUpperArm', 'LeftForeArm'] };
    expect(getKeyframeCount(sequence)).toBe(MAX_KEYFRAME_COUNT);
    expect(() => transferKeyframes(sequence, request({ operation: 'copy', scope, targetFrame: 20 }))).toThrow(/4096/);
    expect(getKeyframeCount(changed(sequence, request({ scope, targetFrame: 20 })).sequence)).toBe(MAX_KEYFRAME_COUNT);
    expect(getKeyframeCount(changed(sequence, request({ operation: 'copy', scope, collision: 'replace' })).sequence)).toBe(MAX_KEYFRAME_COUNT);
    expect(JSON.stringify(sequence)).toBe(snapshot);
  });

  it('keeps source authority unchanged if a transferred knot exceeds the independent baked-sample cap', () => {
    const source = base();
    source.times = Array.from({ length: MAX_TAKE_SAMPLES }, (_, index) => index * source.durationSeconds / (MAX_TAKE_SAMPLES - 1));
    source.times[MAX_TAKE_SAMPLES - 1] = source.durationSeconds;
    source.poses = source.times.map(() => pose(0, 0));
    const sequence = upsertRootKeyframe(makeKeyframeSequence(source), 0, [1, 1, 0]);
    const snapshot = JSON.stringify(sequence);
    const result = changed(sequence, request({ scope: { kind: 'root' }, sourceFrame: 0, targetFrame: 1 }));
    expect(() => bakeKeyframeSequence(result.sequence)).toThrow(/样本超出/);
    expect(JSON.stringify(sequence)).toBe(snapshot);
    expect(bakeKeyframeSequence(sequence).times).toHaveLength(MAX_TAKE_SAMPLES);
  });

  it('validates frames, editable scope and operation before no-op or mutation', () => {
    const empty = makeKeyframeSequence(base());
    for (const invalid of [-1, 0.1, 32, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => transferKeyframes(empty, request({ sourceFrame: invalid }))).toThrow(/整数/);
      expect(() => transferKeyframes(empty, request({ targetFrame: invalid }))).toThrow(/整数/);
    }
    expect(() => transferKeyframes(empty, request({ scope: { kind: 'joint', joint: 'LeftHandTip' } }))).toThrow(/可编辑/);
    for (const invalid of [{ scope: { kind: 'bad' } }, { scope: { kind: 'joint', joint: 'Unknown' } }, { operation: 'bad' }, { collision: 'bad' }]) {
      expect(() => transferKeyframes(empty, { ...request(), ...invalid } as KeyframeTransferRequest)).toThrow();
    }
    expect(() => transferKeyframes({ ...empty, fps: 60 } as unknown as KeyframeSequence, request())).toThrow(/帧率/);
    expect(getKeyframeCount(empty)).toBe(0);
  });

  it('rejects empty, duplicated, terminal, unknown and malformed groups before same-frame or empty-source no-ops', () => {
    const empty = makeKeyframeSequence(base());
    const malformed = [undefined, null, 'Head', {}, [], ['Head', 'Head'], ['Head', 'LeftHandTip'], ['Unknown'], ['Root'], ['__proto__'], [null], [undefined], new Array(1), Array.from({ length: 20 }, () => 'Head')];
    for (const joints of malformed) for (const targetFrame of [9, 15]) {
      expect(() => transferKeyframes(empty, request({ scope: { kind: 'joints', joints } as KeyframeTransferRequest['scope'], targetFrame }))).toThrow(/可编辑/);
    }
    const snapshot = JSON.stringify(empty);
    const validEmpty = transferKeyframes(empty, request({ scope: { kind: 'joints', joints: ['LeftUpperArm', 'LeftForeArm'] } }));
    expect(validEmpty).toMatchObject({ status: 'noop', reason: 'empty-source', sourceKeyCount: 0 });
    expect(validEmpty.sequence).toBe(empty);
    expect(JSON.stringify(empty)).toBe(snapshot);
  });
});

describe('unified sparse and exact-point author transfers', () => {
  it('carries the latest same-time overlay together with its sparse tuple for both frame and exact callers', () => {
    let sequence = upsertRotationKeyframe(makeKeyframeSequence(base()), 'Head', 9, rotationZ(20));
    sequence = upsertRootKeyframe(sequence, 9, [1, 1.05, 0]);
    sequence = upsertMotionPoint(sequence, .3, { root: [2, 1.05, 0], joints: { Head: rotationZ(40), LeftToe: rotationZ(15) } });
    sequence = upsertMotionPoint(sequence, .5, { joints: { RightToe: rotationZ(25) } });
    // Valid stored tuples need not be normalized again during a transfer.
    sequence.pointEdits![0].joints!.Head![2] += 1e-8;
    const snapshot = JSON.stringify(sequence), sparse = sequence.rotations.Head![0].rotation, latest = sequence.pointEdits![0].joints!.Head;
    for (const operation of ['move', 'copy'] as const) for (const exact of [false, true]) {
      const options: KeyframeTransferRequest = exact
        ? { operation, scope: { kind: 'joint', joint: 'Head' }, sourceTime: .3, targetTime: .5 }
        : { operation, scope: { kind: 'joint', joint: 'Head' }, sourceFrame: 9, targetFrame: 15 };
      const result = changed(sequence, options, bakeKeyframeSequence(sequence));
      expect(result).toMatchObject({ sourceTime: .3, targetTime: .5, sourceKeyCount: 1, changedTracks: [{ kind: 'joint', joint: 'Head' }] });
      expect(result.sequence.rotations.Head!.find(key => key.frame === 15)!.rotation).toEqual(sparse);
      expect(result.sequence.pointEdits!.find(edit => edit.time === .5)!.joints!.Head).toEqual(latest);
      expect(sampleTake(bakeKeyframeSequence(result.sequence), .5).joints.Head).toEqual(latest);
      // Keeping 20° in the sparse layer preserves its longer interval semantics.
      expect(sampleTake(bakeKeyframeSequence(result.sequence), .61).joints.Head).toEqual(sparse);
      expect(result.sequence.rotations.Head!.some(key => key.frame === 9)).toBe(operation === 'copy');
      expect(result.sequence.pointEdits!.find(edit => edit.time === .3)!.joints?.Head !== undefined).toBe(operation === 'copy');
      expect(result.sequence.root).toEqual(sequence.root);
      expect(result.sequence.pointEdits!.find(edit => edit.time === .3)!.root).toEqual([2, 1.05, 0]);
      expect(result.sequence.pointEdits!.find(edit => edit.time === .3)!.joints!.LeftToe).toEqual(sequence.pointEdits![0].joints!.LeftToe);
      expect(result.sequence.pointEdits!.find(edit => edit.time === .5)!.joints!.RightToe).toEqual(sequence.pointEdits![1].joints!.RightToe);
    }
    expect(JSON.stringify(sequence)).toBe(snapshot);
  });

  it('moves exact point authors between distinct seconds inside the same 30fps frame without aliases', () => {
    const sourceTime = .70391, targetTime = .70612;
    const sequence = upsertMotionPoint(makeKeyframeSequence(base()), sourceTime, { root: [1, 1.1, .2], joints: { LeftHeel: rotationZ(37) } });
    const authority = bakeKeyframeSequence(sequence), snapshot = JSON.stringify(sequence);
    const result = changed(sequence, { operation: 'move', scope: { kind: 'all' }, sourceTime, targetTime }, authority);
    expect(result).toMatchObject({ sourceTime, targetTime, sourceKeyCount: 2, changedTracks: [{ kind: 'joint', joint: 'LeftHeel' }, { kind: 'root' }] });
    expect(result.sequence.pointEdits).toEqual([{ ...sequence.pointEdits![0], time: targetTime }]);
    expect(result.sequence.rotations).toEqual({}); expect(result.sequence.root).toEqual([]);
    const take = bakeKeyframeSequence(result.sequence);
    expect(take.times).not.toContain(sourceTime); expect(take.times).toContain(targetTime);
    expect(sampleTake(take, targetTime).root).toEqual(sequence.pointEdits![0].root);
    for (const [index, time] of sequence.baseTake.times.entries()) expect(take.poses[take.times.indexOf(time)]).toEqual(sequence.baseTake.poses[index]);
    result.sequence.pointEdits![0].root![0] = 2;
    result.sequence.pointEdits![0].joints!.LeftHeel![0] = .1;
    expect(JSON.stringify(sequence)).toBe(snapshot);
  });

  it('transfers a selected group including terminal point channels and preserves omitted channels at both times', () => {
    let sequence = upsertMotionPoint(makeKeyframeSequence(base()), .27, { root: [1, 1, 0], joints: { Head: rotationZ(5), LeftUpperArm: rotationZ(25), LeftForeArm: rotationZ(45), LeftHandTip: rotationZ(65) } });
    sequence = upsertMotionPoint(sequence, .61, { root: [2, 1, 0], joints: { RightToe: rotationZ(15) } });
    const result = changed(sequence, { operation: 'move', scope: { kind: 'joints', joints: ['LeftUpperArm', 'LeftForeArm', 'LeftHandTip'] }, sourceTime: .27, targetTime: .61 });
    expect(result.sourceKeyCount).toBe(3);
    expect(result.sequence.pointEdits![0]).toEqual({ time: .27, root: sequence.pointEdits![0].root, joints: { Head: sequence.pointEdits![0].joints!.Head } });
    expect(result.sequence.pointEdits![1]).toEqual({ time: .61, root: sequence.pointEdits![1].root, joints: { RightToe: sequence.pointEdits![1].joints!.RightToe, LeftUpperArm: sequence.pointEdits![0].joints!.LeftUpperArm, LeftForeArm: sequence.pointEdits![0].joints!.LeftForeArm, LeftHandTip: sequence.pointEdits![0].joints!.LeftHandTip } });
    const root = changed(result.sequence, { operation: 'move', scope: { kind: 'root' }, sourceTime: .27, targetTime: .61, collision: 'replace' });
    expect(root.changedTracks).toEqual([{ kind: 'root' }]);
    expect(root.sequence.pointEdits![0].joints).toEqual(result.sequence.pointEdits![0].joints);
    expect(root.sequence.pointEdits![0].root).toBeUndefined();
    expect(root.sequence.pointEdits![1].joints).toEqual(result.sequence.pointEdits![1].joints);
    expect(root.sequence.pointEdits![1].root).toEqual([1, 1, 0]);
  });

  it('copies all 25 stored point rotations and Root without turning source samples into explicit keys', () => {
    const sequence = upsertMotionPoint(makeKeyframeSequence(base()), .27, { root: [1, 1.1, .2], joints: Object.fromEntries(JOINT_NAMES.map(joint => [joint, rotationZ(37)])) });
    const result = changed(sequence, { operation: 'copy', scope: { kind: 'all' }, sourceTime: .27, targetTime: .4134567 });
    expect(result.sourceKeyCount).toBe(26); expect(result.changedTracks).toHaveLength(26);
    expect(getKeyframeCount(result.sequence)).toBe(52);
    expect(result.sequence.pointEdits).toEqual([sequence.pointEdits![0], { ...sequence.pointEdits![0], time: .4134567 }]);
    expect(result.sequence.rotations).toEqual({}); expect(result.sequence.root).toEqual([]);
    const empty = transferKeyframes(sequence, { operation: 'copy', scope: { kind: 'all' }, sourceTime: .61, targetTime: .5 });
    expect(empty).toMatchObject({ status: 'noop', reason: 'empty-source', sourceTime: .61, targetTime: .5, sourceKeyCount: 0, changedTracks: [] });
    expect(empty.sequence).toBe(sequence);
  });

  it('reports a two-layer destination once per channel and replaces only transferred author layers', () => {
    let sequence = upsertRotationKeyframe(makeKeyframeSequence(base()), 'Head', 9, rotationZ(20));
    sequence = upsertRotationKeyframe(sequence, 'Head', 15, rotationZ(60));
    sequence = upsertRootKeyframe(sequence, 15, [3, 1, 0]);
    sequence = upsertMotionPoint(sequence, .3, { joints: { Head: rotationZ(40) } });
    sequence = upsertMotionPoint(sequence, .5, { root: [4, 1, 0], joints: { Head: rotationZ(80), LeftToe: rotationZ(10) } });
    const authority = bakeKeyframeSequence(sequence), snapshot = JSON.stringify(sequence);
    const options: KeyframeTransferRequest = { operation: 'move', scope: { kind: 'joint', joint: 'Head' }, sourceTime: .3, targetTime: .5 };
    const conflict = transferKeyframes(sequence, options, authority);
    expect(conflict).toMatchObject({ status: 'conflict', sourceTime: .3, targetTime: .5, sourceKeyCount: 1, changedTracks: [], collisions: [{ kind: 'joint', joint: 'Head' }] });
    expect(conflict.sequence).toBe(sequence); expect(sequence.pointBaseTake).toBeUndefined();
    const result = changed(sequence, { ...options, collision: 'replace' }, authority);
    expect(result.replaced).toEqual([{ kind: 'joint', joint: 'Head' }]);
    expect(result.sequence.pointEdits).toEqual([{ time: .5, root: [4, 1, 0], joints: { Head: sequence.pointEdits![0].joints!.Head, LeftToe: sequence.pointEdits![1].joints!.LeftToe } }]);
    expect(result.sequence.root).toEqual(sequence.root);
    expect(JSON.stringify(sequence)).toBe(snapshot);
  });

  it('replaces a different destination layer type instead of leaving a hidden conflicting author', () => {
    let sequence = upsertRotationKeyframe(makeKeyframeSequence(base()), 'Head', 15, rotationZ(80));
    sequence = upsertMotionPoint(sequence, .27, { joints: { Head: rotationZ(40) } });
    const options: KeyframeTransferRequest = { operation: 'copy', scope: { kind: 'joint', joint: 'Head' }, sourceTime: .27, targetTime: .5 };
    expect(transferKeyframes(sequence, options).status).toBe('conflict');
    const point = changed(sequence, { ...options, collision: 'replace' });
    expect(point.sequence.rotations.Head).toBeUndefined();
    expect(point.sequence.pointEdits).toHaveLength(2);
    const sparse = upsertRotationKeyframe(makeKeyframeSequence(base()), 'Head', 9, rotationZ(20));
    const withPoint = upsertMotionPoint(sparse, .5, { joints: { Head: rotationZ(40), LeftToe: rotationZ(10) } });
    const moved = changed(withPoint, { operation: 'move', scope: { kind: 'joint', joint: 'Head' }, sourceTime: .3, targetTime: .5, collision: 'replace' });
    expect(moved.sequence.pointEdits![0].joints!.Head).toBeUndefined();
    expect(moved.sequence.pointEdits![0].joints!.LeftToe).toEqual(withPoint.pointEdits![0].joints!.LeftToe);
    expect(sampleTake(bakeKeyframeSequence(moved.sequence), .5).joints.Head).toEqual(sparse.rotations.Head![0].rotation);
  });

  it('rejects an off-grid target for any sparse source atomically and accepts the exact short final frame', () => {
    let sequence = upsertRotationKeyframe(makeKeyframeSequence(base()), 'Head', 9, rotationZ(20));
    sequence = upsertMotionPoint(sequence, .3, { joints: { Head: rotationZ(40), LeftToe: rotationZ(10) } });
    const snapshot = JSON.stringify(sequence), authority = bakeKeyframeSequence(sequence);
    for (const operation of ['move', 'copy'] as const) {
      expect(() => transferKeyframes(sequence, { operation, scope: { kind: 'all' }, sourceTime: .3, targetTime: .503 }, authority)).toThrow(/30fps/);
    }
    expect(JSON.stringify(sequence)).toBe(snapshot); expect(sequence.pointBaseTake).toBeUndefined();
    const result = changed(sequence, { operation: 'move', scope: { kind: 'all' }, sourceTime: .3, targetTime: 1.005 }, authority);
    expect(result.sequence.rotations.Head![0].frame).toBe(31);
    expect(result.sequence.pointEdits![0].time).toBe(1.005);
    expect(result.targetTime).toBe(1.005);
  });

  it('keeps nearby off-grid authors distinct and returns original references for exact no-ops', () => {
    let sequence = upsertMotionPoint(makeKeyframeSequence(base()), .70391, { joints: { Head: rotationZ(40) } });
    sequence = upsertMotionPoint(sequence, .70612, { joints: { Head: rotationZ(40) } });
    const authority = bakeKeyframeSequence(sequence), options: KeyframeTransferRequest = { operation: 'copy', scope: { kind: 'joint', joint: 'Head' }, sourceTime: .70391, targetTime: .70612 };
    const conflict = transferKeyframes(sequence, options, authority);
    expect(conflict).toMatchObject({ status: 'conflict', sourceTime: .70391, targetTime: .70612, changedTracks: [] });
    const identical = transferKeyframes(sequence, { ...options, collision: 'replace' }, authority);
    expect(identical).toMatchObject({ status: 'noop', reason: 'unchanged', changedTracks: [] }); expect(identical.sequence).toBe(sequence);
    const same = transferKeyframes(sequence, { ...options, targetTime: .70391 }, authority);
    expect(same).toMatchObject({ status: 'noop', sourceTime: .70391, targetTime: .70391, changedTracks: [] }); expect(same.sequence).toBe(sequence);
    expect(sequence.pointBaseTake).toBeUndefined();
    const changedTime = changed(sequence, { ...options, targetTime: .7061200000001 });
    expect(changedTime.sequence.pointEdits!.map(edit => edit.time)).toEqual([.70391, .70612, .7061200000001]);
  });

  it('counts both carried layers against 4096 while permitting moves and complete replacement at the limit', () => {
    const source = base(); source.durationSeconds = 60; source.times = [0, 60]; source.poses = [pose(0, 0), pose(1, 20)];
    const sequence = makeKeyframeSequence(source);
    sequence.rotations.Head = Array.from({ length: 1800 }, (_, frame) => ({ frame, rotation: rotationZ(0) }));
    sequence.rotations.Neck = Array.from({ length: 1801 }, (_, frame) => ({ frame, rotation: rotationZ(0) }));
    sequence.root = Array.from({ length: 493 }, (_, frame) => ({ frame, position: [0, 1.05, 0] }));
    sequence.pointEdits = [{ time: 0, joints: { Head: rotationZ(40) } }, { time: 1 / 30, joints: { Head: rotationZ(60) } }];
    expect(getKeyframeCount(sequence)).toBe(MAX_KEYFRAME_COUNT);
    const snapshot = JSON.stringify(sequence);
    expect(() => transferKeyframes(sequence, { operation: 'copy', scope: { kind: 'joint', joint: 'Head' }, sourceTime: 0, targetTime: 60 })).toThrow(/4096/);
    const moved = changed(sequence, { operation: 'move', scope: { kind: 'joint', joint: 'Head' }, sourceTime: 0, targetTime: 60 });
    const replaced = changed(sequence, { operation: 'copy', scope: { kind: 'joint', joint: 'Head' }, sourceTime: 0, targetTime: 1 / 30, collision: 'replace' });
    expect(getKeyframeCount(moved.sequence)).toBe(MAX_KEYFRAME_COUNT); expect(getKeyframeCount(replaced.sequence)).toBe(MAX_KEYFRAME_COUNT);
    expect(moved.sourceKeyCount).toBe(1); expect(replaced.replaced).toEqual([{ kind: 'joint', joint: 'Head' }]);
    expect(JSON.stringify(sequence)).toBe(snapshot);
  });

  it('checks the independent 6001 final-grid limit before returning point-only candidates', () => {
    const source = base(); source.times = Array.from({ length: MAX_TAKE_SAMPLES }, (_, index) => index * source.durationSeconds / (MAX_TAKE_SAMPLES - 1)); source.times[MAX_TAKE_SAMPLES - 1] = source.durationSeconds; source.poses = source.times.map(() => pose(0, 0));
    const sequence = upsertMotionPoint(makeKeyframeSequence(source), 0, { root: [1, 1, 0] });
    const snapshot = JSON.stringify(sequence), authority = bakeKeyframeSequence(sequence);
    for (const operation of ['move', 'copy'] as const) expect(() => transferKeyframes(sequence, { operation, scope: { kind: 'root' }, sourceTime: 0, targetTime: .123456789 }, authority)).toThrow(/样本超出/);
    expect(JSON.stringify(sequence)).toBe(snapshot); expect(sequence.pointBaseTake).toBeUndefined();
  });

  it('freezes pre-overlay authority before a mixed move and preserves every unrelated retained saved tuple', () => {
    let sequence = upsertRotationKeyframe(makeKeyframeSequence(base()), 'Head', 9, rotationZ(20));
    sequence = upsertRootKeyframe(sequence, 9, [1, 1.1, .2]);
    sequence = upsertMotionPoint(sequence, .3, { joints: { Head: rotationZ(40) } });
    const authority = bakeKeyframeSequence(sequence);
    authority.poses[authority.times.indexOf(.27)].joints.Chest[0] += Number.EPSILON / 8;
    const result = changed(sequence, { operation: 'move', scope: { kind: 'joint', joint: 'Head' }, sourceTime: .3, targetTime: .5 }, authority);
    expect(result.sequence.pointBaseTake).toBeDefined();
    expect(result.sequence.pointEdits).toEqual([{ time: .5, joints: { Head: sequence.pointEdits![0].joints!.Head } }]);
    const take = bakeKeyframeSequence(result.sequence);
    for (const [index, time] of authority.times.entries()) {
      const next = take.poses[take.times.indexOf(time)];
      expect(next.root).toEqual(authority.poses[index].root);
      for (const joint of JOINT_NAMES.filter(joint => joint !== 'Head')) expect(next.joints[joint]).toEqual(authority.poses[index].joints[joint]);
    }
    expect(sampleTake(take, .3).joints.Head).not.toEqual(sequence.pointEdits![0].joints!.Head);
    expect(sequence.pointBaseTake).toBeUndefined();
  });

  it('retains fresh held interpolation when moving an unfrozen exact author, without freezing its old held values', () => {
    const source = base(); source.poses = source.times.map(() => pose(0, 0));
    const sequence = upsertMotionPoint(makeKeyframeSequence(source, { pointInterpolation: 'hold-last-key-1' }), .2134567, { root: [1, 1.1, .2], joints: { Head: rotationZ(40) } });
    const authority = bakeKeyframeSequence(sequence); authority.poses[authority.times.indexOf(.27)].joints.Chest[0] += Number.EPSILON / 8;
    const result = changed(sequence, { operation: 'move', scope: { kind: 'all' }, sourceTime: .2134567, targetTime: .4134567 }, authority);
    expect(result.sequence.pointInterpolation).toBe('hold-last-key-1');
    expect(result.sequence.pointBaseTake!.times).toEqual(source.times);
    for (const pose of result.sequence.pointBaseTake!.poses) { expect(pose.root).toEqual([0, 1.05, 0]); expect(pose.joints.Head).toEqual(rotationZ(0)); }
    const take = bakeKeyframeSequence(result.sequence);
    expect(take.times).not.toContain(.2134567);
    for (const time of [.4134567, .61, 1.005]) { expect(sampleTake(take, time).root).toEqual([1, 1.1, .2]); expect(sampleTake(take, time).joints.Head).toEqual(sequence.pointEdits![0].joints!.Head); }
    expect(sampleTake(take, .27).joints.Chest).toEqual(authority.poses[authority.times.indexOf(.27)].joints.Chest);
    expect(sampleTake(take, .2134567).root[0]).toBeLessThan(1);
  });

  it('keeps pure point transfers on legacy priority/contact semantics and reports only changed copy channels', () => {
    let sequence = addFootLock(makeKeyframeSequence(base()), captureFootLock(pose(0, 0), 'LeftFoot', 0, 30));
    delete sequence.authorKeyPriority;
    sequence = upsertMotionPoint(sequence, .27, { root: [1, 1, 0], joints: { Head: rotationZ(40) } });
    sequence = upsertMotionPoint(sequence, .61, { root: [1, 1, 0], joints: { Head: rotationZ(60) } });
    const result = changed(sequence, { operation: 'copy', scope: { kind: 'all' }, sourceTime: .27, targetTime: .61, collision: 'replace' });
    expect(result.sequence.authorKeyPriority).toBeUndefined();
    expect(result.changedTracks).toEqual([{ kind: 'joint', joint: 'Head' }]);
    expect(result.sequence.footLocks).toEqual(sequence.footLocks);
  });

  it('validates exact seconds, exclusive coordinate pairs and all-25 scopes before no-op results', () => {
    const empty = makeKeyframeSequence(base()), valid: KeyframeTransferRequest = { operation: 'move', scope: { kind: 'joint', joint: 'LeftToe' }, sourceTime: .27, targetTime: .61 };
    expect(transferKeyframes(empty, valid)).toMatchObject({ status: 'noop', sourceTime: .27, targetTime: .61, changedTracks: [] });
    for (const invalid of [-1, 1.006, Number.NaN, Number.POSITIVE_INFINITY, undefined]) {
      expect(() => transferKeyframes(empty, { ...valid, sourceTime: invalid } as KeyframeTransferRequest)).toThrow();
      expect(() => transferKeyframes(empty, { ...valid, targetTime: invalid } as KeyframeTransferRequest)).toThrow();
    }
    for (const invalid of [
      { ...valid, sourceFrame: 9, targetFrame: 15 }, { ...valid, sourceFrame: 9 },
      { operation: 'move', scope: { kind: 'root' }, sourceTime: .27, targetFrame: 15 },
      { ...valid, scope: { kind: 'joint', joint: 'Unknown' } },
      { ...valid, scope: { kind: 'joints', joints: ['LeftToe', 'LeftToe'] } },
      { ...valid, scope: { kind: 'joints', joints: [] } },
    ]) expect(() => transferKeyframes(empty, invalid as KeyframeTransferRequest)).toThrow();
  });
});
