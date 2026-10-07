import { describe, expect, it } from 'vitest';
import {
  JOINT_NAMES, MAX_KEYFRAME_COUNT, MAX_TAKE_SAMPLES, bakeKeyframeSequence, frameTime,
  getKeyframeCount, getKeyframeFrames, makeKeyframeSequence, sampleTake, transferKeyframes,
  upsertRootKeyframe, upsertRotationKeyframe,
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
const request = (override: Partial<KeyframeTransferRequest> = {}): KeyframeTransferRequest => ({
  operation: 'move', scope: { kind: 'all' }, sourceFrame: 9, targetFrame: 15, ...override,
});
const changed = (sequence: KeyframeSequence, options: KeyframeTransferRequest) => {
  const result = transferKeyframes(sequence, options);
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

  it('moves explicit endpoint keys while restoring implicit base endpoints and preserving exact short-tail timing', () => {
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
    expect(sampleTake(baked, 1.005).joints.Head).toEqual(sequence.baseTake.poses.at(-1)!.joints.Head);
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
});
