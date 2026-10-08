import { describe, expect, it } from 'vitest';
import {
  EDITABLE_JOINT_NAMES, JOINT_NAMES, MAX_KEYFRAME_COUNT, MAX_TAKE_SAMPLES,
  bakeKeyframeSequence, bakePlan, createNeutralTake, frameAtTime, frameTime,
  getKeyframeCount, getKeyframeFrames, lastFrame, makeCountMap, makeKeyframeSequence,
  makePlan, removePoseKeyframe, removeRootKeyframe, removeRotationKeyframe,
  rotationFromDegrees, rotationToDegrees, sampleTake, setPoseKeyframe,
  upsertRootKeyframe, upsertRotationKeyframe,
  type BakedTake, type KeyframeSequence, type Pose, type Quat,
} from './index';

const rotationZ = (degrees: number): Quat => [0, 0, Math.sin(degrees * Math.PI / 360), Math.cos(degrees * Math.PI / 360)];
const pose = (x: number, angle = 0): Pose => ({
  root: [x, 1.05, 0],
  joints: Object.fromEntries(JOINT_NAMES.map(joint => [joint, rotationZ(angle)])) as Pose['joints'],
});
function source(): BakedTake {
  return {
    id: 'source', planId: 'plan', countMapId: 'map', schemaVersion: 'preview-1', provenance: 'synthetic-demo',
    durationSeconds: 1.02, times: [0, 0.27, 0.61, 1.02], poses: [pose(0, 0), pose(0.3, 20), pose(0.9, -10), pose(1, 30)],
  };
}
const sameOrientation = (actual: Quat, expected: Quat) => {
  expect(Math.abs(actual.reduce((sum, component, index) => sum + component * expected[index], 0))).toBeCloseTo(1, 10);
  expect(Math.hypot(...actual)).toBeCloseTo(1, 10);
};

describe('manual keyframe timing and rotation convention', () => {
  it('edits 19 parent-relative joints, keeping six terminal marker joints read-only', () => {
    expect(EDITABLE_JOINT_NAMES).toHaveLength(19);
    for (const joint of ['LeftHandTip', 'RightHandTip', 'LeftToe', 'RightToe', 'LeftHeel', 'RightHeel']) expect(EDITABLE_JOINT_NAMES).not.toContain(joint);
    expect(EDITABLE_JOINT_NAMES).toContain('Hips');
    expect(EDITABLE_JOINT_NAMES).toContain('LeftHand');
    expect(() => upsertRotationKeyframe(makeKeyframeSequence(source()), 'LeftHandTip', 0, [0, 0, 0, 1])).toThrow(/可编辑/);
  });

  it('uses explicit 30 fps frames plus exact D, selecting the nearest short-tail frame', () => {
    expect(lastFrame(1.005)).toBe(31);
    expect(frameTime(30, 1.005)).toBe(1);
    expect(frameTime(31, 1.005)).toBe(1.005);
    expect(frameAtTime(1.003, 1.005)).toBe(31);
    expect(frameAtTime(1.001, 1.005)).toBe(30);
    expect(frameAtTime(-100, 1.005)).toBe(0);
    expect(frameAtTime(100, 1.005)).toBe(31);
    expect(lastFrame(32)).toBe(960);
    expect(frameTime(960, 32)).toBe(32);
    for (const frame of [-1, 0.1, 32, Number.NaN]) expect(() => frameTime(frame, 1.005)).toThrow();
    for (const duration of [0, -1, 60.01, Number.NaN, Number.POSITIVE_INFINITY]) expect(() => lastFrame(duration)).toThrow();
    expect(() => frameAtTime(Number.NaN, 1)).toThrow();
  });

  it('matches intrinsic XYZ local rotation and survives gimbal-lock round trips by orientation', () => {
    // A positive local Z rotation turns the rig's rest (0,-1,0) toward +X.
    const q = rotationFromDegrees([0, 0, 90]);
    expect(2 * (q[3] * q[2] - q[0] * q[1])).toBeCloseTo(1, 12);
    sameOrientation(q, rotationZ(90));
    for (const angles of [[35, -42, 17], [-180, 0, 180], [35, 90, -42], [-70, -90, 50], [12, 89.9999999, 54]] as [number, number, number][]) {
      const rotation = rotationFromDegrees(angles);
      sameOrientation(rotationFromDegrees(rotationToDegrees(rotation)), rotation);
    }
    expect(() => rotationFromDegrees([0, Number.NaN, 0])).toThrow(/有限/);
    expect(() => rotationToDegrees([0, 0, 0, 0])).toThrow(/四元数/);
  });
});

describe('immutable independent manual motion tracks', () => {
  it('SLERPs local rotations and linearly interpolates Root while keeping source authority immutable', () => {
    const take = source(), original = JSON.stringify(take);
    let sequence = makeKeyframeSequence(take);
    const empty = sequence;
    sequence = upsertRotationKeyframe(sequence, 'LeftUpperArm', 0, rotationZ(0));
    sequence = upsertRotationKeyframe(sequence, 'LeftUpperArm', 15, rotationZ(90));
    sequence = upsertRootKeyframe(sequence, 0, [0, 1.05, 0]);
    sequence = upsertRootKeyframe(sequence, 15, [2, 1.05, 0]);
    const baked = bakeKeyframeSequence(sequence);
    sameOrientation(sampleTake(baked, 0.25).joints.LeftUpperArm, rotationZ(45));
    expect(sampleTake(baked, 0.25).root[0]).toBeCloseTo(1, 12);
    expect(baked.id).not.toBe(take.id);
    expect(baked.planId).toBe(take.planId);
    expect(baked.countMapId).toBe(take.countMapId);
    expect(baked.durationSeconds).toBe(take.durationSeconds);
    expect(baked.schemaVersion).toBe('preview-1');
    expect(baked.provenance).toBe('synthetic-demo');
    expect(JSON.stringify(take)).toBe(original);
    expect(getKeyframeCount(empty)).toBe(0);
    expect(getKeyframeCount(sequence)).toBe(4);
    // Original support knots survive exactly on every unedited joint.
    take.times.forEach((time, index) => {
      const output = baked.poses[baked.times.indexOf(time)];
      for (const joint of JOINT_NAMES.filter(name => name !== 'LeftUpperArm')) expect(output.joints[joint]).toEqual(take.poses[index].joints[joint]);
    });
    for (const time of [0.123, 0.289, 0.52, 0.88, 1.019]) sameOrientation(sampleTake(baked, time).joints.Head, sampleTake(take, time).joints.Head);
  });

  it('fills missing endpoints from baseTake and lets explicit endpoint keys override them', () => {
    const take = source();
    let sequence = upsertRotationKeyframe(makeKeyframeSequence(take), 'Head', 15, rotationZ(90));
    sequence = upsertRootKeyframe(sequence, 15, [2, 2, 1]);
    const implicit = bakeKeyframeSequence(sequence);
    expect(implicit.poses[0]).toEqual(take.poses[0]);
    expect(implicit.poses.at(-1)).toEqual(take.poses.at(-1));
    sameOrientation(sampleTake(implicit, 0.25).joints.Head, rotationZ(45));
    sameOrientation(sampleTake(implicit, 0.76).joints.Head, rotationZ(60));
    sequence = upsertRotationKeyframe(sequence, 'Head', lastFrame(take.durationSeconds), rotationZ(180));
    sequence = upsertRootKeyframe(sequence, lastFrame(take.durationSeconds), [3, 3, -2]);
    const explicit = bakeKeyframeSequence(sequence);
    expect(explicit.times.at(-1)).toBe(1.02);
    sameOrientation(sampleTake(explicit, 1.02).joints.Head, rotationZ(180));
    expect(sampleTake(explicit, 1.02).root).toEqual([3, 3, -2]);
  });

  it('handles antipodal XYZW keys without a full spin and normalizes finite input quaternions', () => {
    const q = rotationZ(70);
    let sequence = upsertRotationKeyframe(makeKeyframeSequence(source()), 'Chest', 0, q.map(component => component * 3) as Quat);
    sequence = upsertRotationKeyframe(sequence, 'Chest', 15, q.map(component => -component) as Quat);
    const baked = bakeKeyframeSequence(sequence);
    sameOrientation(sampleTake(baked, 0.25).joints.Chest, q);
    expect(sequence.rotations.Chest?.[0].rotation).toEqual(q);
  });

  it('updates the same frame instead of adding a duplicate and returns isolated tracks', () => {
    const first = upsertRotationKeyframe(makeKeyframeSequence(source()), 'Neck', 12, rotationZ(30));
    const second = upsertRotationKeyframe(first, 'Neck', 12, rotationZ(80));
    const third = upsertRootKeyframe(second, 12, [1, 1, 0]);
    expect(first.id).not.toBe(second.id);
    expect(second.rotations.Neck).toHaveLength(1);
    sameOrientation(first.rotations.Neck![0].rotation, rotationZ(30));
    sameOrientation(second.rotations.Neck![0].rotation, rotationZ(80));
    expect(getKeyframeCount(third)).toBe(2);
    expect(getKeyframeFrames(third)).toEqual([12]);
    third.rotations.Neck![0].rotation[0] = 0.25;
    expect(second.rotations.Neck![0].rotation[0]).toBe(0);
  });

  it('writes a full pose atomically, edits only 19 joints, and removes all tracks at one frame', () => {
    const original = makeKeyframeSequence(source());
    const fullPose = pose(2, 55);
    let sequence = setPoseKeyframe(original, 9, fullPose);
    expect(getKeyframeCount(sequence)).toBe(20);
    expect(Object.keys(sequence.rotations)).toHaveLength(19);
    expect(sequence.rotations.LeftHandTip).toBeUndefined();
    const baked = bakeKeyframeSequence(sequence);
    sameOrientation(sampleTake(baked, 0.3).joints.Hips, rotationZ(55));
    sameOrientation(sampleTake(baked, 0.3).joints.LeftHandTip, sampleTake(source(), 0.3).joints.LeftHandTip);
    expect(sampleTake(baked, 0.3).root).toEqual([2, 1.05, 0]);
    sequence = upsertRotationKeyframe(sequence, 'Head', 15, rotationZ(40));
    const removed = removePoseKeyframe(sequence, 9);
    expect(getKeyframeFrames(removed)).toEqual([15]);
    expect(getKeyframeCount(removed)).toBe(1);
    expect(getKeyframeCount(original)).toBe(0);
    const badPose = pose(0); badPose.joints.RightHand = [0, 0, 0, 0];
    expect(() => setPoseKeyframe(sequence, 12, badPose)).toThrow();
    expect(getKeyframeCount(sequence)).toBe(21);
  });

  it('deleting the final key exactly restores source samples and permits exact history replay', () => {
    const take = source();
    const empty = makeKeyframeSequence(take);
    const rotation = upsertRotationKeyframe(empty, 'Head', 13, rotationZ(100));
    const both = upsertRootKeyframe(rotation, 17, [4, 2, 3]);
    const rootOnly = removeRotationKeyframe(both, 'Head', 13);
    const removed = removeRootKeyframe(rootOnly, 17);
    const restored = bakeKeyframeSequence(removed);
    expect(restored.times).toEqual(take.times);
    expect(restored.poses).toEqual(take.poses);
    expect(restored.id).not.toBe(take.id);
    expect(getKeyframeFrames(removed)).toEqual([]);
    // An undo/redo stack can retain each immutable sequence and authority intact.
    const firstAuthority = bakeKeyframeSequence(both);
    const redoAuthority = bakeKeyframeSequence(both);
    expect(redoAuthority.poses).toEqual(firstAuthority.poses);
    expect(redoAuthority.times).toEqual(firstAuthority.times);
    expect(redoAuthority.id).not.toBe(firstAuthority.id);
    restored.poses[0].joints.Head[0] = 0.5;
    expect(take.poses[0].joints.Head[0]).toBe(0);
    expect(removed.baseTake.poses[0].joints.Head[0]).toBe(0);
  });

  it('retains CountMap, exact non-grid phrase boundaries and precise final key on a real preview take', () => {
    const map = makeCountMap({ bpm: 137, musicBeatsPerDanceCount: 1, firstCountSourceSeconds: 1.25, octetCount: 6, audioDurationSeconds: 60 });
    const plan = makePlan(map), take = bakePlan(plan, map);
    const originalMap = JSON.stringify(map);
    let sequence = upsertRootKeyframe(makeKeyframeSequence(take), lastFrame(map.durationSeconds), [1, 1, 1]);
    sequence = upsertRotationKeyframe(sequence, 'RightUpperArm', 111, rotationZ(-135));
    const baked = bakeKeyframeSequence(sequence);
    expect(baked.times.at(-1)).toBe(map.durationSeconds);
    expect(baked.times).toContain(frameTime(111, map.durationSeconds));
    for (const slot of plan.slots) expect(baked.times).toContain(slot.startSeconds);
    expect(sampleTake(baked, map.durationSeconds).root).toEqual([1, 1, 1]);
    expect(JSON.stringify(map)).toBe(originalMap);
    expect(baked.countMapId).toBe(map.id);
    expect(baked.planId).toBe(plan.id);
  });

  it('creates a neutral FK base without changing original sample timing or arrangement binding', () => {
    const take = source(), snapshot = JSON.stringify(take);
    const neutral = createNeutralTake(take);
    expect(neutral.times).toEqual(take.times);
    expect(neutral.id).not.toBe(take.id);
    expect(neutral.planId).toBe(take.planId);
    expect(neutral.countMapId).toBe(take.countMapId);
    for (const frame of neutral.poses) {
      expect(frame.root).toEqual([0, 1.05, 0]);
      for (const joint of JOINT_NAMES) expect(frame.joints[joint]).toEqual([0, 0, 0, 1]);
    }
    expect(JSON.stringify(take)).toBe(snapshot);
    neutral.poses[0].joints.Head[0] = 0.2;
    expect(neutral.poses[1].joints.Head[0]).toBe(0);
  });

  it('lets a teacher author only three pose times and computes the unwritten transitions without adding K records', () => {
    const map = makeCountMap({ bpm: 120, musicBeatsPerDanceCount: 1, firstCountSourceSeconds: 0, octetCount: 8, audioDurationSeconds: 40 });
    const base = createNeutralTake(bakePlan(makePlan(map), map));
    const snapshots = [[90, [0, 1.05, 0], -30, -10], [300, [0.5, 1.05, 0.2], -90, -110], [750, [0.1, 1.05, 0.8], -10, -40]] as const;
    let sequence = makeKeyframeSequence(base);
    for (const [frame, position, shoulder, elbow] of snapshots) {
      const authored = sampleTake(base, frameTime(frame, map.durationSeconds));
      authored.root = [...position];
      authored.joints.LeftUpperArm = rotationFromDegrees([shoulder, 0, 0]);
      authored.joints.LeftForeArm = rotationFromDegrees([elbow, 0, 0]);
      sequence = setPoseKeyframe(sequence, frame, authored);
    }
    const baked = bakeKeyframeSequence(sequence);
    // There are three authored pose times, despite the many playback samples.
    expect(getKeyframeFrames(sequence)).toEqual([90, 300, 750]);
    expect(getKeyframeCount(sequence)).toBe(60);
    for (const [time, position, shoulder, elbow] of [[6.5, [0.25, 1.05, 0.1], -60, -60], [17.5, [0.3, 1.05, 0.5], -50, -75]] as const) {
      const between = sampleTake(baked, time);
      between.root.forEach((value, axis) => expect(value).toBeCloseTo(position[axis], 12));
      sameOrientation(between.joints.LeftUpperArm, rotationFromDegrees([shoulder, 0, 0]));
      sameOrientation(between.joints.LeftForeArm, rotationFromDegrees([elbow, 0, 0]));
      expect(sequence.root.some(key => key.frame === time * 30)).toBe(false);
      expect(between.joints.RightUpperArm).toEqual([0, 0, 0, 1]);
    }
    const restored = bakeKeyframeSequence(JSON.parse(JSON.stringify(sequence)));
    expect(restored.times).toEqual(baked.times); expect(restored.poses).toEqual(baked.poses);
    expect(baked.countMapId).toBe(map.id); expect(baked.durationSeconds).toBe(32);
    expect(baked.times.at(-1)).toBe(map.durationSeconds);
    const deleted = removePoseKeyframe(sequence, 300);
    expect(getKeyframeFrames(deleted)).toEqual([90, 750]);
    expect(getKeyframeCount(deleted)).toBe(40);
    expect(getKeyframeFrames(sequence)).toEqual([90, 300, 750]);
  });
});

describe('manual keyframe safety envelope', () => {
  it('rejects malformed samples, source versions, tracks and out-of-range frames before baking', () => {
    for (const override of [
      { times: [0, 0.27, 0.27, 1.02] }, { times: [0, 0.27, 0.61, 1] }, { times: [0, 0.27, Number.NaN, 1.02] },
      { schemaVersion: 'other' }, { durationSeconds: 61 }, { poses: [pose(0)] },
      { times: Array.from({ length: MAX_TAKE_SAMPLES + 1 }, (_, index) => index / 30), poses: Array.from({ length: MAX_TAKE_SAMPLES + 1 }, () => pose(0)) },
    ]) expect(() => makeKeyframeSequence({ ...source(), ...override } as BakedTake)).toThrow();
    const broken = source(); broken.poses[0].joints.Head = [0, 0, Number.NaN, 1];
    expect(() => makeKeyframeSequence(broken)).toThrow(/有限/);
    const sequence = makeKeyframeSequence(source());
    for (const frame of [-1, 32, 0.1, Number.NaN]) expect(() => upsertRootKeyframe(sequence, frame, [0, 1, 0])).toThrow();
    expect(() => bakeKeyframeSequence({ ...sequence, fps: 60 } as unknown as KeyframeSequence)).toThrow(/帧率/);
    expect(() => bakeKeyframeSequence({ ...sequence, rotations: { Head: [{ frame: 4, rotation: rotationZ(0) }, { frame: 4, rotation: rotationZ(1) }] } })).toThrow(/重复/);
    expect(() => bakeKeyframeSequence({ ...sequence, rotations: { Head: [{ frame: 7, rotation: rotationZ(0) }, { frame: 4, rotation: rotationZ(1) }] } })).toThrow(/递增/);
    expect(() => bakeKeyframeSequence({ ...sequence, rotations: { UnknownJoint: [] } } as unknown as KeyframeSequence)).toThrow(/可编辑/);
  });

  it('rejects nonfinite/zero rotations and bounds manual Root position to the declared metric workspace', () => {
    const sequence = makeKeyframeSequence(source());
    for (const rotation of [[0, 0, 0, 0], [0, Number.NaN, 0, 1], [0, 0, Infinity, 1], [0, 0, 1]] as Quat[]) expect(() => upsertRotationKeyframe(sequence, 'Head', 1, rotation)).toThrow();
    for (const root of [[5.001, 1, 0], [-5.001, 1, 0], [0, 3.001, 0], [0, -0.001, 0], [0, 1, 5.001], [0, 1, Number.NaN]] as [number, number, number][]) expect(() => upsertRootKeyframe(sequence, 1, root)).toThrow();
    expect(upsertRootKeyframe(sequence, 1, [-5, 0, 5]).root[0].position).toEqual([-5, 0, 5]);
    expect(upsertRootKeyframe(sequence, 1, [5, 3, -5]).root[0].position).toEqual([5, 3, -5]);
    expect(getKeyframeCount(sequence)).toBe(0);
  });

  it('rejects sparse tuples and sparse source/track arrays without producing invalid samples', () => {
    const sequence = makeKeyframeSequence(source());
    expect(() => upsertRootKeyframe(sequence, 1, Array(3) as [number, number, number])).toThrow(/有限/);
    expect(() => upsertRotationKeyframe(sequence, 'Head', 1, Array(4) as Quat)).toThrow(/有限/);
    const brokenTimes = source(); delete brokenTimes.times[1];
    expect(() => makeKeyframeSequence(brokenTimes)).toThrow(/有限/);
    const brokenPoses = source(); delete brokenPoses.poses[1];
    expect(() => makeKeyframeSequence(brokenPoses)).toThrow(/缺少骨骼/);
    expect(() => bakeKeyframeSequence({ ...sequence, root: Array(1) })).toThrow(/记录无效/);
    expect(() => bakeKeyframeSequence({ ...sequence, rotations: { Head: Array(1) } })).toThrow(/记录无效/);
  });

  it('rejects a bake exceeding the same sample cap used for its next immutable base', () => {
    const take = source();
    take.times = Array.from({ length: MAX_TAKE_SAMPLES }, (_, index) => index * take.durationSeconds / (MAX_TAKE_SAMPLES - 1));
    take.times[MAX_TAKE_SAMPLES - 1] = take.durationSeconds;
    take.poses = take.times.map(() => pose(0));
    const sequence = upsertRootKeyframe(makeKeyframeSequence(take), 1, [0, 1, 0]);
    expect(() => bakeKeyframeSequence(sequence)).toThrow(/样本超出/);
    expect(getKeyframeCount(sequence)).toBe(1);
  });

  it('caps aggregate track records and rejects a whole-pose write atomically at the limit', () => {
    const map = makeCountMap({ bpm: 120, musicBeatsPerDanceCount: 1, firstCountSourceSeconds: 0, octetCount: 15, audioDurationSeconds: 60 });
    const plan = makePlan(map), base = bakePlan(plan, map);
    const sequence = makeKeyframeSequence(base);
    sequence.rotations.Head = Array.from({ length: 1801 }, (_, frame) => ({ frame, rotation: rotationZ(0) }));
    sequence.rotations.Neck = Array.from({ length: 1801 }, (_, frame) => ({ frame, rotation: rotationZ(0) }));
    sequence.root = Array.from({ length: MAX_KEYFRAME_COUNT - 3602 }, (_, frame) => ({ frame, position: [0, 1.05, 0] }));
    const original = JSON.stringify(sequence);
    expect(getKeyframeCount(sequence)).toBe(MAX_KEYFRAME_COUNT);
    expect(() => upsertRotationKeyframe(sequence, 'Chest', 0, rotationZ(0))).toThrow(/4096/);
    expect(() => setPoseKeyframe(sequence, 1000, pose(0))).toThrow(/4096/);
    expect(JSON.stringify(sequence)).toBe(original);
    expect(getKeyframeCount(upsertRotationKeyframe(sequence, 'Head', 0, rotationZ(45)))).toBe(MAX_KEYFRAME_COUNT);
  });
});
