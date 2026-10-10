import { describe, expect, it } from 'vitest';
import {
  JOINT_NAMES, MAX_KEYFRAME_COUNT, MAX_TAKE_SAMPLES, addFootLock,
  bakeKeyframeSequence, bakeLegacyKeyframeSequence, captureFootLock,
  getKeyframeCount, getMotionPointEditCount, getMotionPointTimes,
  makeKeyframeSequence, removeMotionPointEdit, removePoseKeyframe, removeRootKeyframe, removeRotationKeyframe, rotationFromDegrees,
  sampleTake, setStepAssistance, upsertMotionPoint, upsertMotionPointChanges,
  transferKeyframes, upsertRootKeyframe, upsertRotationKeyframe,
  type BakedTake, type KeyframeSequence, type MotionPointEdit, type Pose, type Quat,
} from './index';

const pose = (x = 0, angle = 0): Pose => ({
  root: [x, 1.05, 0],
  joints: Object.fromEntries(JOINT_NAMES.map((joint, index) => [joint, rotationFromDegrees([index / 3, angle, 0])])) as Pose['joints'],
});
const source = (): BakedTake => ({
  id: 'source', schemaVersion: 'preview-1', planId: 'plan', countMapId: 'map', provenance: 'synthetic-demo',
  durationSeconds: 1.02, times: [0, .27, .61, 1.02], poses: [pose(0), pose(.8, 20), pose(-.3, -40), pose(.1, 10)],
});
const neutral = (): Pose => ({ root: [0, 1.05, 0], joints: Object.fromEntries(JOINT_NAMES.map(joint => [joint, [0, 0, 0, 1]])) as Pose['joints'] });

describe('exact-time author tracks on fresh manual motion', () => {
  const neutralSource = (): BakedTake => ({ ...source(), times: [0, 1.02], poses: [neutral(), neutral()] });
  const sameOrientation = (actual: Quat, expected: Quat) => expect(Math.abs(actual.reduce((sum, value, axis) => sum + value * expected[axis], 0))).toBeCloseTo(1, 12);

  it('holds a single off-grid author pose, interpolates to the next key and holds the final pose on independent channels', () => {
    const base = neutralSource();
    let sequence = makeKeyframeSequence(base, { pointInterpolation: 'hold-last-key-1' });
    const firstTime = .2134567, nextTime = .8134567;
    const first = rotationFromDegrees([0, 0, 30]), next = rotationFromDegrees([0, 0, 90]);
    sequence = upsertMotionPoint(sequence, firstTime, { root: [1, 1.1, .2], joints: { LeftUpperArm: first, LeftToe: first } }, base);
    const one = bakeKeyframeSequence(sequence);
    for (const time of [firstTime, .4, .7134567, 1.02]) {
      sameOrientation(sampleTake(one, time).joints.LeftUpperArm, first);
      sameOrientation(sampleTake(one, time).joints.LeftToe, first);
      expect(sampleTake(one, time).root).toEqual([1, 1.1, .2]);
    }
    sequence = upsertMotionPoint(sequence, nextTime, { root: [3, 1.3, .6], joints: { LeftUpperArm: next } }, one);
    const two = bakeKeyframeSequence(sequence), midpoint = sampleTake(two, (firstTime + nextTime) / 2);
    sameOrientation(midpoint.joints.LeftUpperArm, rotationFromDegrees([0, 0, 60]));
    midpoint.root.forEach((value, axis) => expect(value).toBeCloseTo([2, 1.2, .4][axis], 12));
    for (const time of [.9, 1.02]) {
      sameOrientation(sampleTake(two, time).joints.LeftUpperArm, next);
      expect(sampleTake(two, time).root).toEqual([3, 1.3, .6]);
      sameOrientation(sampleTake(two, time).joints.LeftToe, first);
    }
    expect(sampleTake(two, firstTime / 2).root[0]).toBeCloseTo(.5, 12);
    sameOrientation(sampleTake(two, firstTime / 2).joints.LeftUpperArm, rotationFromDegrees([0, 0, 15]));
    for (const pose of two.poses) for (const joint of JOINT_NAMES.filter(joint => !['LeftUpperArm', 'LeftToe'].includes(joint))) expect(pose.joints[joint]).toEqual([0, 0, 0, 1]);
    expect(two.times).toEqual([0, firstTime, nextTime, 1.02]);
    expect(bakeKeyframeSequence(JSON.parse(JSON.stringify(sequence))).poses).toEqual(two.poses);
    expect(base.times).toEqual([0, 1.02]); expect(base.poses).toEqual([neutral(), neutral()]);
    const clearedSecond = removeMotionPointEdit(removeMotionPointEdit(sequence, nextTime, 'root'), nextTime, 'LeftUpperArm');
    expect(bakeKeyframeSequence(clearedSecond).poses).toEqual(one.poses);
    const restored = removeMotionPointEdit(removeMotionPointEdit(removeMotionPointEdit(clearedSecond, firstTime, 'root'), firstTime, 'LeftUpperArm'), firstTime, 'LeftToe');
    expect(bakeKeyframeSequence(restored).poses).toEqual(base.poses);
    expect(bakeKeyframeSequence(restored).times).toEqual(base.times);
  });

  it('holds all 25 rotation channels from zero and uses the shortest antipodal path without synthesizing keys', () => {
    const base = neutralSource(), q = rotationFromDegrees([12, -8, 17]);
    const channels = Object.fromEntries(JOINT_NAMES.map(joint => [joint, q])) as Pose['joints'];
    let sequence = upsertMotionPoint(makeKeyframeSequence(base, { pointInterpolation: 'hold-last-key-1' }), 0, { joints: channels });
    sequence = upsertMotionPoint(sequence, .7134567, { joints: { LeftHeel: q.map(component => -component) as Quat } });
    const take = bakeKeyframeSequence(sequence);
    for (const time of [0, .123, .4134567, .7134567, 1.02]) for (const joint of JOINT_NAMES) sameOrientation(sampleTake(take, time).joints[joint], q);
    expect(sequence.pointEdits).toHaveLength(2);
    expect(getKeyframeCount(sequence)).toBe(26);
    expect(sequence.rotations).toEqual({}); expect(sequence.root).toEqual([]);
    expect(take.poses.at(-1)!.joints.LeftHeel).toEqual(sequence.pointEdits![1].joints!.LeftHeel);
  });

  it('recovers the pre-author authority for old unfrozen held point tracks and preserves untouched stored bits', () => {
    const base = source(), marker = { pointInterpolation: 'hold-last-key-1' } as const;
    const old = upsertMotionPoint(makeKeyframeSequence(base, marker), .27, { joints: { Head: rotationFromDegrees([0, 45, 0]) } });
    const authority = bakeKeyframeSequence(old);
    authority.poses[1].joints.Chest[0] += Number.EPSILON / 8;
    const edited = upsertMotionPoint(old, .61, { joints: { LeftToe: rotationFromDegrees([10, 0, 0]) } }, authority);
    expect(edited.pointBaseTake!.poses.map(pose => pose.joints.Head)).toEqual(base.poses.map(pose => pose.joints.Head));
    expect(edited.pointBaseTake!.poses[1].joints.Chest).toEqual(authority.poses[1].joints.Chest);
    const cleared = removeMotionPointEdit(removeMotionPointEdit(edited, .27, 'Head'), .61, 'LeftToe');
    expect(bakeKeyframeSequence(cleared).poses).toEqual(edited.pointBaseTake!.poses);
    expect(edited.pointInterpolation).toBe('hold-last-key-1');
  });
});

describe('exact-time channel editing over the original authority', () => {
  it('changes one joint sample while retaining every Root, unrelated channel and existing knot bit-exactly', () => {
    let sequence = makeKeyframeSequence(source());
    sequence = upsertRotationKeyframe(sequence, 'Chest', 10, rotationFromDegrees([20, 30, -10]));
    const original = JSON.stringify(sequence), authority = bakeKeyframeSequence(sequence), time = .27;
    const before = sampleTake(authority, time), after = structuredClone(before);
    after.joints.LeftUpperArm = rotationFromDegrees([10, 0, 55]);
    const edited = upsertMotionPointChanges(sequence, time, before, after), take = bakeKeyframeSequence(edited);
    expect(edited.baseTake).toBe(sequence.baseTake);
    expect(edited.rotations).toBe(sequence.rotations);
    expect(edited.root).toBe(sequence.root);
    expect(edited.pointEdits).toEqual([{ time, joints: { LeftUpperArm: after.joints.LeftUpperArm } }]);
    expect(take.times).toEqual(authority.times);
    for (const [index, actual] of take.poses.entries()) {
      expect(actual.root).toEqual(authority.poses[index].root);
      for (const joint of JOINT_NAMES) expect(actual.joints[joint]).toEqual(index === authority.times.indexOf(time) && joint === 'LeftUpperArm' ? after.joints.LeftUpperArm : authority.poses[index].joints[joint]);
    }
    expect(JSON.stringify(sequence)).toBe(original);
    expect(getKeyframeCount(edited)).toBe(2);
    expect(getMotionPointEditCount(edited)).toBe(1);
  });

  it('adds an exact off-grid time with the original evaluated values for omitted channels', () => {
    const sequence = makeKeyframeSequence(source()), authority = bakeKeyframeSequence(sequence), time = .431234567;
    const before = sampleTake(authority, time), after = structuredClone(before);
    after.joints.RightHand = rotationFromDegrees([15, 20, -60]);
    const edited = upsertMotionPointChanges(sequence, time, before, after), take = bakeKeyframeSequence(edited);
    expect(take.times).toEqual([0, .27, time, .61, 1.02]);
    expect(sampleTake(take, time)).toEqual(after);
    for (const [index, exact] of authority.times.entries()) expect(take.poses[take.times.indexOf(exact)]).toEqual(authority.poses[index]);
    expect(sampleTake(take, .15)).toEqual(sampleTake(authority, .15));
    expect(sampleTake(take, .9)).toEqual(sampleTake(authority, .9));
    expect(sampleTake(take, .4).joints.RightHand).not.toEqual(sampleTake(authority, .4).joints.RightHand);
    expect(getMotionPointTimes(edited)).toEqual(take.times);
    expect(getMotionPointTimes(edited, authority)).toEqual(take.times);
    const cleared = removeMotionPointEdit(edited, time, 'RightHand');
    expect(cleared.pointEdits).toEqual([]);
    expect(bakeKeyframeSequence(cleared).times).toEqual(authority.times);
    expect(bakeKeyframeSequence(cleared).poses).toEqual(authority.poses);
  });

  it('commits the actual IK-dependent channels together and ignores equivalent quaternion signs and floating noise', () => {
    const sequence = makeKeyframeSequence(source()), time = .61, before = sampleTake(sequence.baseTake, time), after = structuredClone(before);
    after.joints.LeftUpperArm = rotationFromDegrees([30, 10, 40]);
    after.joints.LeftForeArm = rotationFromDegrees([-55, 0, 0]);
    after.joints.LeftHand = rotationFromDegrees([8, 0, 5]);
    after.joints.Head = before.joints.Head.map(component => -component) as Quat;
    after.root[0] += 1e-10;
    const edited = upsertMotionPointChanges(sequence, time, before, after);
    expect(Object.keys(edited.pointEdits![0].joints!)).toEqual(['LeftUpperArm', 'LeftForeArm', 'LeftHand']);
    expect(edited.pointEdits![0].root).toBeUndefined();
    expect(getKeyframeCount(edited)).toBe(3);
    const signOnly = structuredClone(before);
    for (const joint of JOINT_NAMES) signOnly.joints[joint] = before.joints[joint].map(component => -component) as Quat;
    expect(upsertMotionPointChanges(sequence, time, before, signOnly)).toBe(sequence);
    expect(upsertMotionPointChanges(sequence, time, before, before)).toBe(sequence);
    expect(upsertMotionPoint(edited, time, { joints: { LeftUpperArm: after.joints.LeftUpperArm.map(component => -component) as Quat } })).toBe(edited);
  });

  it('supports all 25 stored joints and removes only the requested overlay channel', () => {
    const sequence = makeKeyframeSequence(source()), rotations = Object.fromEntries(JOINT_NAMES.map(joint => [joint, rotationFromDegrees([12, -8, 17])])) as Pose['joints'];
    const edited = upsertMotionPoint(sequence, .27, { root: [1.2, 1.1, .3], joints: rotations });
    expect(getMotionPointEditCount(edited)).toBe(26);
    expect(sampleTake(bakeKeyframeSequence(edited), .27)).toEqual({ root: [1.2, 1.1, .3], joints: rotations });
    const cleared = removeMotionPointEdit(edited, .27, 'LeftToe');
    expect(cleared.pointEdits![0].joints!.LeftToe).toBeUndefined();
    expect(sampleTake(bakeKeyframeSequence(cleared), .27).joints.LeftToe).toEqual(sequence.baseTake.poses[1].joints.LeftToe);
    expect(sampleTake(bakeKeyframeSequence(cleared), .27).root).toEqual([1.2, 1.1, .3]);
    expect(removeMotionPointEdit(cleared, .27, 'LeftToe')).toBe(cleared);
    const later = upsertRotationKeyframe(edited, 'Head', 12, rotationFromDegrees([0, 10, 0]));
    later.pointEdits![0].joints!.LeftToe![0] = .4;
    expect(edited.pointEdits![0].joints!.LeftToe).toEqual(rotations.LeftToe);
  });

  it('keeps finite imported Root positions outside editing bounds while editing an unrelated joint', () => {
    const base = source(); base.poses[1].root = [23, -4, 17];
    const sequence = makeKeyframeSequence(base), before = sampleTake(base, .27), after = structuredClone(before);
    after.joints.Head = rotationFromDegrees([0, 15, 0]);
    const edited = upsertMotionPointChanges(sequence, .27, before, after);
    expect(sampleTake(bakeKeyframeSequence(edited), .27).root).toEqual([23, -4, 17]);
    after.root[0] = 24;
    expect(() => upsertMotionPointChanges(sequence, .27, before, after)).toThrow(/Root/);
    expect(sequence.pointEdits).toBeUndefined();
  });
});

describe('point edits preserve assistance, legacy evaluation and atomic caps', () => {
  it('freezes the actual saved authority bits instead of repeating cross-engine sparse quaternion math', () => {
    const sequence = upsertRotationKeyframe(makeKeyframeSequence(source()), 'Chest', 10, rotationFromDegrees([20, 30, -10]));
    const saved = bakeKeyframeSequence(sequence);
    saved.poses[1].joints.Chest[0] += Number.EPSILON / 8;
    const stored = structuredClone(saved), before = sampleTake(saved, .61), after = structuredClone(before);
    after.joints.Head = rotationFromDegrees([0, 10, 0]);
    const edited = upsertMotionPointChanges(sequence, .61, before, after, saved);
    expect(edited.pointBaseTake).toEqual(stored);
    expect(edited.pointBaseTake).not.toBe(saved);
    saved.poses[1].joints.Chest[0] += .01;
    const baked = bakeKeyframeSequence(edited);
    for (const [index, time] of stored.times.entries()) {
      expect(baked.poses[index].root).toEqual(stored.poses[index].root);
      for (const joint of JOINT_NAMES.filter(joint => joint !== 'Head' || time !== .61)) expect(baked.poses[index].joints[joint]).toEqual(stored.poses[index].joints[joint]);
    }
    baked.poses[0].joints.Chest[0] += .01;
    expect(edited.pointBaseTake!.poses[0].joints.Chest).toEqual(stored.poses[0].joints.Chest);
    const repeated = upsertMotionPoint(edited, .27, { joints: { LeftToe: [0, 0, 0, 1] } }, baked);
    expect(repeated.pointBaseTake).toBe(edited.pointBaseTake);
    let cleared = removeMotionPointEdit(repeated, .27, 'LeftToe');
    cleared = removeMotionPointEdit(cleared, .61, 'Head');
    expect(bakeKeyframeSequence(cleared).poses).toEqual(stored.poses);
    expect(bakeKeyframeSequence(JSON.parse(JSON.stringify(cleared))).poses).toEqual(stored.poses);
    expect(sequence.baseTake).toBe(edited.baseTake); expect(sequence.rotations).toBe(edited.rotations);
  });

  it('does not capture a supplied authority for no-op gestures or missing overrides', () => {
    const sequence = makeKeyframeSequence(source()), authority = bakeKeyframeSequence(sequence), before = sampleTake(authority, .27);
    expect(upsertMotionPointChanges(sequence, .27, before, before, authority)).toBe(sequence);
    expect(removeMotionPointEdit(sequence, .27, 'Head', authority)).toBe(sequence);
    expect(sequence.pointBaseTake).toBeUndefined();
    expect(() => upsertMotionPoint(sequence, .27, { joints: { Head: rotationFromDegrees([0, 10, 0]) } }, { ...authority, countMapId: 'another-map' })).toThrow(/绑定/);
    expect(sequence.pointBaseTake).toBeUndefined();
  });

  it('recovers old point-only overlays while preserving stored bits on channels never overlaid', () => {
    const sequence = upsertRotationKeyframe(makeKeyframeSequence(source()), 'Chest', 10, rotationFromDegrees([20, 30, -10]));
    let old = upsertMotionPoint(sequence, .27, { joints: { Head: rotationFromDegrees([0, 20, 0]) } });
    old = upsertMotionPoint(old, .4137, { joints: { LeftToe: rotationFromDegrees([10, 0, 0]) } });
    const authority = bakeKeyframeSequence(old), index = authority.times.indexOf(.27);
    authority.poses[index].joints.Chest[0] += Number.EPSILON / 8;
    const edited = upsertMotionPoint(old, .61, { joints: { RightHand: rotationFromDegrees([0, 10, 0]) } }, authority);
    expect(edited.pointBaseTake!.times).toEqual(bakeKeyframeSequence(sequence).times);
    expect(edited.pointBaseTake!.times).not.toContain(.4137);
    expect(edited.pointBaseTake!.poses[edited.pointBaseTake!.times.indexOf(.27)].joints.Chest).toEqual(authority.poses[index].joints.Chest);
    expect(edited.pointBaseTake!.poses[edited.pointBaseTake!.times.indexOf(.27)].joints.Head).toEqual(sampleTake(bakeKeyframeSequence(sequence), .27).joints.Head);
    expect(sampleTake(bakeKeyframeSequence(edited), .27).joints.Head).toEqual(old.pointEdits![0].joints!.Head);
    let cleared = removeMotionPointEdit(edited, .27, 'Head');
    cleared = removeMotionPointEdit(cleared, .4137, 'LeftToe');
    cleared = removeMotionPointEdit(cleared, .61, 'RightHand');
    expect(bakeKeyframeSequence(cleared).times).toEqual(edited.pointBaseTake!.times);
    expect(bakeKeyframeSequence(cleared).poses).toEqual(edited.pointBaseTake!.poses);
    const firstDelete = removeMotionPointEdit(old, .27, 'Head', authority);
    expect(firstDelete.pointBaseTake).toBeDefined();
    expect(sampleTake(bakeKeyframeSequence(firstDelete), .27).joints.Head).toEqual(sampleTake(bakeKeyframeSequence(sequence), .27).joints.Head);
  });

  it('rebuilds only changed legacy sparse tracks while preserving frozen bits on every other channel', () => {
    const sequence = upsertRotationKeyframe(makeKeyframeSequence(source()), 'Chest', 10, rotationFromDegrees([20, 30, -10]));
    const authority = bakeKeyframeSequence(sequence);
    authority.poses[1].joints.Chest[0] += Number.EPSILON / 8;
    const edited = upsertMotionPoint(sequence, .61, { joints: { Head: rotationFromDegrees([0, 10, 0]) } }, authority);
    const updated = upsertRotationKeyframe(edited, 'LeftUpperArm', 12, rotationFromDegrees([0, 0, 40]));
    expect(updated.pointBaseTake).not.toBe(edited.pointBaseTake);
    expect(updated.pointEdits).toEqual(edited.pointEdits);
    expect(sampleTake(bakeKeyframeSequence(updated), .4).joints.LeftUpperArm).toEqual(updated.rotations.LeftUpperArm![0].rotation);
    const take = bakeKeyframeSequence(updated);
    for (const [index, time] of authority.times.entries()) {
      const pose = take.poses[take.times.indexOf(time)];
      expect(pose.root).toEqual(authority.poses[index].root);
      for (const joint of JOINT_NAMES.filter(joint => joint !== 'LeftUpperArm' && (joint !== 'Head' || time !== .61))) expect(pose.joints[joint]).toEqual(authority.poses[index].joints[joint]);
    }
    const moved = upsertRootKeyframe(updated, 12, [1.2, 1.1, .3]);
    for (const [index, time] of updated.pointBaseTake!.times.entries()) for (const joint of JOINT_NAMES) expect(moved.pointBaseTake!.poses[moved.pointBaseTake!.times.indexOf(time)].joints[joint]).toEqual(updated.pointBaseTake!.poses[index].joints[joint]);
  });

  it('captures saved authority for a first legacy sparse move or delete and preserves every other retained channel bit', () => {
    let sequence = upsertRotationKeyframe(makeKeyframeSequence(source()), 'Chest', 10, rotationFromDegrees([20, 30, -10]));
    sequence = upsertRotationKeyframe(sequence, 'LeftUpperArm', 12, rotationFromDegrees([0, 0, 40]));
    sequence = upsertRootKeyframe(sequence, 12, [1.2, 1.1, .3]);
    const authority = bakeKeyframeSequence(sequence);
    authority.poses[1].joints.Chest[0] += Number.EPSILON / 8;
    expect(sequence.pointBaseTake).toBeUndefined();
    const removedArm = removeRotationKeyframe(sequence, 'LeftUpperArm', 12, authority);
    const removedRoot = removeRootKeyframe(sequence, 12, authority);
    const removedPose = removePoseKeyframe(sequence, 12, authority);
    const moved = transferKeyframes(sequence, { operation: 'move', scope: { kind: 'joint', joint: 'LeftUpperArm' }, sourceFrame: 12, targetFrame: 15 }, authority);
    expect(moved.status).toBe('changed');
    for (const [next, changed] of [[removedArm, ['LeftUpperArm']], [removedRoot, ['root']], [removedPose, ['root', 'LeftUpperArm']], [moved.sequence, ['LeftUpperArm']]] as const) {
      expect(next.pointBaseTake).toBeDefined();
      const take = bakeKeyframeSequence(next);
      for (const originalTime of sequence.baseTake.times) expect(take.times).toContain(originalTime);
      for (const [index, time] of authority.times.entries()) {
        const nextIndex = take.times.indexOf(time);
        // Removing the last sparse key at a non-source time removes its derived support knot.
        if (nextIndex < 0) continue;
        if (!(changed as readonly string[]).includes('root')) expect(take.poses[nextIndex].root).toEqual(authority.poses[index].root);
        for (const joint of JOINT_NAMES.filter(joint => !(changed as readonly string[]).includes(joint))) expect(take.poses[nextIndex].joints[joint]).toEqual(authority.poses[index].joints[joint]);
      }
    }
    expect(sequence.pointBaseTake).toBeUndefined();
    expect(sequence.rotations.LeftUpperArm).toHaveLength(1);
    expect(sequence.root).toHaveLength(1);
  });

  it('does not capture authority for sparse no-ops or unresolved transfer collisions', () => {
    let sequence = upsertRotationKeyframe(makeKeyframeSequence(source()), 'LeftUpperArm', 12, rotationFromDegrees([0, 0, 40]));
    sequence = upsertRotationKeyframe(sequence, 'LeftUpperArm', 15, rotationFromDegrees([0, 0, 20]));
    const authority = bakeKeyframeSequence(sequence);
    expect(removeRotationKeyframe(sequence, 'Head', 12, authority)).toBe(sequence);
    expect(removeRootKeyframe(sequence, 12, authority)).toBe(sequence);
    expect(removePoseKeyframe(sequence, 11, authority)).toBe(sequence);
    const conflict = transferKeyframes(sequence, { operation: 'move', scope: { kind: 'joint', joint: 'LeftUpperArm' }, sourceFrame: 12, targetFrame: 15 }, authority);
    expect(conflict.status).toBe('conflict'); expect(conflict.sequence).toBe(sequence);
    const noop = transferKeyframes(sequence, { operation: 'move', scope: { kind: 'joint', joint: 'LeftUpperArm' }, sourceFrame: 12, targetFrame: 12 }, authority);
    expect(noop.status).toBe('noop'); expect(noop.sequence).toBe(sequence);
    expect(sequence.pointBaseTake).toBeUndefined();
  });

  it('evaluates new sparse support times from the canonical source without resampling an old support knot', () => {
    const base = source();
    base.poses = base.times.map((time, index) => pose(index / 10, time * 6));
    const sequence = upsertRootKeyframe(makeKeyframeSequence(base), 10, [1.2, 1.1, .3]);
    const authority = bakeKeyframeSequence(sequence), newTime = .5;
    const moved = transferKeyframes(sequence, { operation: 'move', scope: { kind: 'root' }, sourceFrame: 10, targetFrame: 15 }, authority);
    expect(moved.status).toBe('changed');
    const canonical = bakeKeyframeSequence({ ...moved.sequence, pointBaseTake: undefined, pointEdits: [] });
    const insertedIndex = canonical.times.indexOf(newTime);
    const repeatedInterpolation = sampleTake(authority, newTime).joints.Head;
    const directInterpolation = canonical.poses[insertedIndex].joints.Head;
    expect(Math.max(...directInterpolation.map((value, axis) => Math.abs(value - repeatedInterpolation[axis])))).toBeGreaterThan(1e-8);
    expect(moved.sequence.pointBaseTake!.poses[insertedIndex]).toEqual(canonical.poses[insertedIndex]);
    // The frozen source remains equivalent to the full official sparse bake,
    // while every retained imported timestamp keeps its original channel bits.
    expect(moved.sequence.pointBaseTake!.times).toEqual(canonical.times);
    expect(moved.sequence.pointBaseTake!.poses).toEqual(canonical.poses);
    const take = bakeKeyframeSequence(moved.sequence);
    for (const [index, time] of authority.times.entries()) {
      const nextIndex = take.times.indexOf(time);
      if (nextIndex < 0) continue;
      for (const joint of JOINT_NAMES) expect(take.poses[nextIndex].joints[joint]).toEqual(authority.poses[index].joints[joint]);
    }
  });

  it('refreshes the full derived authority when assistance changes and keeps point edits highest', () => {
    const base = { ...source(), poses: source().poses.map(() => neutral()) };
    const sequence = makeKeyframeSequence(base), authority = bakeKeyframeSequence(sequence);
    const edited = upsertMotionPoint(sequence, .61, { joints: { Head: rotationFromDegrees([0, 10, 0]) } }, authority);
    const locked = addFootLock(edited, captureFootLock(neutral(), 'LeftFoot', 0, 31, 0));
    expect(locked.pointBaseTake!.times).toContain(.5);
    const originalDerived = bakeKeyframeSequence({ ...locked, pointBaseTake: undefined, pointEdits: [] });
    expect(locked.pointBaseTake!.poses).toEqual(originalDerived.poses);
    expect(sampleTake(bakeKeyframeSequence(locked), .61).joints.Head).toEqual(edited.pointEdits![0].joints!.Head);
  });

  it('overlays after step and foot assistance without changing any other evaluated samples', () => {
    const base: BakedTake = { ...source(), durationSeconds: 4, times: [0, .113, 4], poses: [neutral(), neutral(), neutral()] };
    let sequence = upsertRootKeyframe(makeKeyframeSequence(base), 0, [0, 1.05, 0]);
    sequence = upsertRootKeyframe(sequence, 120, [.5, 1.05, 0]);
    sequence = setStepAssistance(sequence);
    sequence = addFootLock(sequence, captureFootLock(neutral(), 'RightFoot', 0, 10, 0));
    const original = bakeKeyframeSequence(sequence), time = 2.017, before = sampleTake(original, time), after = structuredClone(before);
    after.root = [.2, 1.3, .1]; after.joints.LeftUpperLeg = rotationFromDegrees([160, 0, 0]);
    const edited = upsertMotionPointChanges(sequence, time, before, after), take = bakeKeyframeSequence(edited);
    expect(sampleTake(take, time)).toEqual(after);
    for (const [index, exact] of original.times.entries()) expect(take.poses[take.times.indexOf(exact)]).toEqual(original.poses[index]);
    expect(edited.steps).toBe(sequence.steps); expect(edited.footLocks).toBe(sequence.footLocks);
  });

  it('preserves pre-priority foot-lock evaluation through edit and clear', () => {
    const base = { ...source(), poses: [neutral(), neutral(), neutral(), neutral()] };
    let sequence = upsertRootKeyframe(makeKeyframeSequence(base), 15, [.15, 1.05, 0]);
    sequence = addFootLock(sequence, captureFootLock(neutral(), 'LeftFoot', 0, 31, 0));
    delete sequence.authorKeyPriority;
    const original = bakeLegacyKeyframeSequence(sequence), before = sampleTake(original, .5), after = structuredClone(before);
    after.joints.Head = rotationFromDegrees([0, 20, 0]);
    const edited = upsertMotionPointChanges(sequence, .5, before, after), take = bakeKeyframeSequence(edited);
    expect(edited.authorKeyPriority).toBeUndefined();
    for (const [index, exact] of original.times.entries()) {
      const actual = take.poses[take.times.indexOf(exact)];
      expect(actual.root).toEqual(original.poses[index].root);
      for (const joint of JOINT_NAMES.filter(joint => joint !== 'Head' || exact !== .5)) expect(actual.joints[joint]).toEqual(original.poses[index].joints[joint]);
    }
    const cleared = removeMotionPointEdit(edited, .5, 'Head');
    expect(cleared.pointEdits).toEqual([]);
    expect(bakeKeyframeSequence(cleared).poses).toEqual(original.poses);
  });

  it('enforces one shared channel cap and does not partially commit an overflowing gesture', () => {
    const sequence = makeKeyframeSequence({ ...source(), durationSeconds: 60, times: [0, 60], poses: [pose(), pose()] });
    sequence.rotations = {
      Head: Array.from({ length: 1801 }, (_, frame) => ({ frame, rotation: rotationFromDegrees([0, 0, 0]) })),
      Neck: Array.from({ length: 1801 }, (_, frame) => ({ frame, rotation: rotationFromDegrees([0, 0, 0]) })),
      Chest: Array.from({ length: 493 }, (_, frame) => ({ frame, rotation: rotationFromDegrees([0, 0, 0]) })),
    };
    expect(getKeyframeCount(sequence)).toBe(MAX_KEYFRAME_COUNT - 1);
    const original = JSON.stringify(sequence);
    const full = upsertMotionPoint(sequence, .001, { joints: { LeftToe: [0, 0, 0, 1] } });
    expect(getKeyframeCount(full)).toBe(MAX_KEYFRAME_COUNT);
    expect(() => upsertMotionPoint(sequence, .001, { root: [0, 1.05, 0], joints: { LeftToe: [0, 0, 0, 1] } })).toThrow(/4096/);
    expect(() => upsertRotationKeyframe(full, 'Spine', 0, [0, 0, 0, 1])).toThrow(/4096/);
    expect(JSON.stringify(sequence)).toBe(original);
  });

  it('checks the exact union sample cap before returning a modified sequence', () => {
    const base = source(); base.times = Array.from({ length: MAX_TAKE_SAMPLES }, (_, index) => index / (MAX_TAKE_SAMPLES - 1) * base.durationSeconds); base.poses = base.times.map(() => pose());
    const sequence = makeKeyframeSequence(base), original = JSON.stringify(sequence);
    expect(() => upsertMotionPoint(sequence, .000001, { joints: { Head: [0, 0, 0, 1] } })).toThrow(/样本/);
    expect(JSON.stringify(sequence)).toBe(original);
    const edited = upsertMotionPoint(sequence, base.times[100], { joints: { Head: rotationFromDegrees([0, 5, 0]) } });
    expect(bakeKeyframeSequence(edited).times).toHaveLength(MAX_TAKE_SAMPLES);
  });

  it('rejects invalid times, duplicate records, unknown joints and unbounded new Root edits', () => {
    const sequence = makeKeyframeSequence(source());
    for (const time of [-1, 1.02000001, Infinity, NaN]) expect(() => upsertMotionPoint(sequence, time, { root: [0, 1, 0] })).toThrow(/时间/);
    for (const pointEdits of [
      [{ time: .27, joints: {} }],
      [{ time: .27, joints: { Mystery: [0, 0, 0, 1] } }],
      [{ time: .27, root: [6, 1, 0] }],
      [{ time: .27, joints: { Head: [0, 0, 0, 2] } }],
      [{ time: .27, root: [0, 1, 0] }, { time: .27, root: [0, 1, 0] }],
    ]) expect(() => bakeKeyframeSequence({ ...sequence, pointEdits: pointEdits as MotionPointEdit[] })).toThrow();
    expect(() => upsertMotionPoint(sequence, .27, { joints: { Head: [0, 0, 0, 0] } })).toThrow(/四元数/);
    expect(sequence.pointEdits).toBeUndefined();
  });
});
