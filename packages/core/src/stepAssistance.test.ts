import { describe, expect, it } from 'vitest';
import { Quaternion } from 'three';
import { JOINT_NAMES, type BakedTake, type Pose, type Vec3 } from './motion-types';
import { analyzeStepAssistance, bakeKeyframeSequence, frameTime, getKeyframeCount, makeKeyframeSequence, removeStepAssistance, rotationFromDegrees, setPoseKeyframe, setStepAssistance, upsertRootKeyframe, upsertRotationKeyframe } from './keyframes';
import { evaluatePose } from './humanoid';
import { isJointRotationWithinLimits } from './jointConstraints';
import { buildStepPlan, GROUND_STEP_DEFAULTS } from './stepAssistance';
import { addFootLock, removePoseKeyframe } from './keyframes';
import { captureFootLock } from './footLocks';
import { sampleTake } from './index';

const neutral = (): Pose => ({ root: [0, 1.05, 0], joints: Object.fromEntries(JOINT_NAMES.map(name => [name, [0, 0, 0, 1]])) as Pose['joints'] });
const source = (duration = 4): BakedTake => ({ id: 'base', schemaVersion: 'preview-1', planId: 'plan', countMapId: 'map', durationSeconds: duration, times: [0, .113, duration], poses: [neutral(), neutral(), neutral()], provenance: 'synthetic-demo' });
const moved = (position: Vec3 = [.5, 1.05, 0], duration = 4) => {
  let sequence = makeKeyframeSequence(source(duration));
  sequence = upsertRootKeyframe(sequence, 0, [0, 1.05, 0]);
  return upsertRootKeyframe(sequence, Math.ceil(duration * 30), position);
};
const distance = (a: number[], b: number[]) => Math.hypot(...a.map((value, axis) => value - b[axis]));

describe('versioned author-first flat-ground step assistance', () => {
  it.each([[.5, 0], [-.5, 0], [0, .5], [0, -.5]])('creates actual supported alternating feet for X=%s Z=%s', (x, z) => {
    const off = moved([x, 1.05, z]), sequence = setStepAssistance(off), before = JSON.stringify(sequence), take = bakeKeyframeSequence(sequence), report = analyzeStepAssistance(sequence);
    expect(report.stepCount).toBeGreaterThan(0);
    expect(report.issues).toEqual([]);
    expect(report.maxStanceResidualMeters).toBeLessThan(.005);
    expect(report.maxOrientationResidualRadians).toBeLessThan(Math.PI / 90);
    expect(report.maxRootLoweringMeters).toBeGreaterThan(0);
    expect(report.maxRootLoweringMeters).toBeLessThanOrEqual(GROUND_STEP_DEFAULTS.maxRootLoweringMeters);
    let supportedWithLift = 0;
    for (let frame = 4; frame < 116; frame++) {
      const pose = sampleTake(take, frame / 30), prior = sampleTake(take, (frame - 1) / 30), world = evaluatePose(pose), previous = evaluatePose(prior);
      for (const [support, swing] of [['LeftFoot', 'RightFoot'], ['RightFoot', 'LeftFoot']] as const) {
        if (distance(world[support].position, previous[support].position) < .001 && world[swing].position[1] > .105) supportedWithLift++;
      }
      expect(pose.root[0]).toBe(sampleTake(bakeKeyframeSequence(off), frame / 30).root[0]);
      expect(pose.root[2]).toBe(sampleTake(bakeKeyframeSequence(off), frame / 30).root[2]);
      for (const joint of ['LeftUpperLeg', 'LeftLowerLeg', 'LeftFoot', 'RightUpperLeg', 'RightLowerLeg', 'RightFoot'] as const) expect(isJointRotationWithinLimits(joint, pose.joints[joint])).toBe(true);
      expect(distance(world.LeftUpperLeg.position, world.LeftLowerLeg.position)).toBeCloseTo(.46, 12);
      expect(distance(world.RightLowerLeg.position, world.RightFoot.position)).toBeCloseTo(.45, 12);
    }
    expect(supportedWithLift).toBeGreaterThan(20);
    expect(JSON.stringify(sequence)).toBe(before);
    expect(getKeyframeCount(sequence)).toBe(getKeyframeCount(off));
    expect(sequence.root).toEqual(off.root); expect(sequence.rotations).toEqual(off.rotations); expect(sequence.baseTake).toBe(off.baseTake);
    expect(take.times).toContain(.113); expect(take.times.at(-1)).toBe(4);
  });

  it('preserves precise full K and untouched upper-body bits, and deterministically replans a new middle K', () => {
    let sequence = moved([.6, 1.05, 0], 6);
    sequence = upsertRotationKeyframe(sequence, 'Chest', 0, rotationFromDegrees([12, 8, -4]));
    sequence = upsertRotationKeyframe(sequence, 'Chest', 180, rotationFromDegrees([16, -6, 10]));
    const off = bakeKeyframeSequence(sequence);
    sequence = setStepAssistance(sequence);
    const first = bakeKeyframeSequence(sequence), repeat = bakeKeyframeSequence(sequence);
    expect(first.times).toEqual(repeat.times); expect(first.poses).toEqual(repeat.poses);
    for (const [index, time] of first.times.entries()) for (const joint of JOINT_NAMES.filter(name => !/UpperLeg|LowerLeg|Foot/.test(name))) expect(first.poses[index].joints[joint]).toEqual(sampleTake(off, time).joints[joint]);
    const mid = neutral(); mid.root = [.25, 1.05, 0]; mid.joints.LeftUpperArm = rotationFromDegrees([0, 0, 170]);
    const changed = setPoseKeyframe(sequence, 90, mid), take = bakeKeyframeSequence(changed), report = analyzeStepAssistance(changed);
    expect(report.segments).toHaveLength(2); expect(report.stepCount).toBeGreaterThan(0);
    const exact = sampleTake(take, 3);
    expect(exact.root).toEqual(changed.root.find(key => key.frame === 90)!.position);
    for (const [joint, keys] of Object.entries(changed.rotations)) expect(exact.joints[joint as keyof Pose['joints']]).toEqual(keys!.find(key => key.frame === 90)!.rotation);
    expect(isJointRotationWithinLimits('LeftUpperArm', exact.joints.LeftUpperArm)).toBe(false);
    expect(take.poses).not.toEqual(first.poses);
    const removed = removePoseKeyframe(changed, 90);
    expect(bakeKeyframeSequence(removed).poses).toEqual(first.poses);
  });

  it('keeps impossible authored leg K and skips only adjacent unsupported segments', () => {
    let sequence = moved([.9, 1.05, 0], 9);
    for (const [frame, x] of [[90, .3], [180, .6]] as const) { const pose = neutral(); pose.root = [x, 1.05, 0]; sequence = setPoseKeyframe(sequence, frame, pose); }
    sequence = upsertRotationKeyframe(sequence, 'LeftLowerLeg', 90, rotationFromDegrees([-50, 0, 0]));
    sequence = setStepAssistance(sequence);
    const before = JSON.stringify(sequence), take = bakeKeyframeSequence(sequence), report = analyzeStepAssistance(sequence);
    expect(report.stepCount).toBeGreaterThan(0);
    expect(report.segments.map(segment => segment.status)).toEqual(['skipped', 'skipped', 'supported']);
    expect(report.issues.filter(issue => issue.code === 'authored-leg-pose')).toHaveLength(2);
    expect(sampleTake(take, 3).joints.LeftLowerLeg).toEqual(sequence.rotations.LeftLowerLeg!.find(key => key.frame === 90)!.rotation);
    expect(JSON.stringify(sequence)).toBe(before);
  });

  it('lets explicit foot locks win, preserves their metadata and still assists disjoint valid segments', () => {
    let sequence = moved([.9, 1.05, 0], 9);
    sequence = upsertRootKeyframe(sequence, 90, [.3, 1.05, 0]); sequence = upsertRootKeyframe(sequence, 180, [.6, 1.05, 0]);
    const lock = captureFootLock(neutral(), 'LeftFoot', 0, 90);
    sequence = addFootLock(sequence, lock);
    const off = bakeKeyframeSequence(sequence), enabled = setStepAssistance(sequence), before = JSON.stringify(enabled), take = bakeKeyframeSequence(enabled), report = analyzeStepAssistance(enabled);
    expect(report.issues.some(issue => issue.code === 'explicit-foot-lock')).toBe(true); expect(report.stepCount).toBeGreaterThan(0);
    for (const time of off.times.filter(time => time <= 3)) expect(sampleTake(take, time)).toEqual(sampleTake(off, time));
    expect(enabled.footLocks).toEqual(sequence.footLocks); expect(JSON.stringify(enabled)).toBe(before);
  });

  it.each(['fast', 'jump', 'turn', 'diagonal'] as const)('returns a reason and preserves the authored %s take', kind => {
    let sequence = moved(kind === 'jump' ? [.5, 1.5, 0] : kind === 'diagonal' ? [.5, 1.05, .5] : [.5, 1.05, 0], kind === 'fast' ? .6 : 4);
    if (kind === 'turn') sequence = upsertRotationKeyframe(sequence, 'Hips', 120, rotationFromDegrees([0, 90, 0]));
    const off = bakeKeyframeSequence(sequence), enabled = setStepAssistance(sequence), before = JSON.stringify(enabled), report = analyzeStepAssistance(enabled), take = bakeKeyframeSequence(enabled);
    expect(report.stepCount).toBe(0); expect(report.issues.length).toBeGreaterThan(0);
    for (const [index, time] of take.times.entries()) expect(take.poses[index]).toEqual(sampleTake(off, time));
    expect(JSON.stringify(enabled)).toBe(before);
  });

  it('has atomic/no-op editing, isolated metadata and strict schema/authority', () => {
    const original = moved(), before = JSON.stringify(original), enabled = setStepAssistance(original, 15, 105);
    expect(JSON.stringify(original)).toBe(before); expect(enabled.steps).toEqual({ schema: 'ground-steps-1', startFrame: 15, endFrame: 105 });
    expect(setStepAssistance(enabled, 15, 105)).toBe(enabled);
    expect(removeStepAssistance(original)).toBe(original);
    const copy = upsertRootKeyframe(enabled, 60, [.2, 1.05, 0]); expect(copy.steps).not.toBe(enabled.steps); expect(copy.steps).toEqual(enabled.steps);
    const removed = removeStepAssistance(enabled); expect(removed.steps).toBeUndefined(); expect(removed.rotations).toEqual(original.rotations); expect(removed.root).toEqual(original.root);
    expect(() => setStepAssistance(original, 20, 20)).toThrow(/自动迈步/);
    expect(() => bakeKeyframeSequence({ ...enabled, authorKeyPriority: undefined })).toThrow(/作者关键帧优先/);
    expect(() => bakeKeyframeSequence({ ...enabled, steps: { ...enabled.steps!, schema: 'unknown' } as never })).toThrow(/自动迈步/);
  });

  it('preserves all outside-range poses and the exact short final knot without synthetic K', () => {
    const offSequence = moved([.5, 1.05, 0], 4.017), off = bakeKeyframeSequence(offSequence), sequence = setStepAssistance(offSequence, 15, 110), take = bakeKeyframeSequence(sequence);
    expect(take.times.at(-1)).toBe(4.017); expect(take.times).toContain(.113);
    for (const [index, time] of take.times.entries()) if (time <= frameTime(15, 4.017) || time >= frameTime(110, 4.017)) expect(take.poses[index]).toEqual(sampleTake(off, time));
    expect(getKeyframeCount(sequence)).toBe(2);
    expect(new Quaternion(...take.poses[60].joints.LeftLowerLeg).length()).toBeCloseTo(1, 12);
  });

  it('segments a genuine pause/reversal in the source Root route without forcing stationary author samples', () => {
    const base = source(8);
    base.times = [0, 2, 4, 6, 8];
    base.poses = base.times.map((_, index) => { const pose = neutral(); pose.root[0] = [0, .2, .2, 0, 0][index]; return pose; });
    const sequence = setStepAssistance(makeKeyframeSequence(base)), take = bakeKeyframeSequence(sequence), report = analyzeStepAssistance(sequence);
    expect(report.segments.map(segment => [segment.startFrame, segment.endFrame, segment.status])).toEqual([[0, 60, 'supported'], [60, 120, 'skipped'], [120, 180, 'supported'], [180, 240, 'skipped']]);
    expect(report.stepCount).toBe(4);
    for (const time of [2, 2.5, 3, 4, 6, 7, 8]) expect(sampleTake(take, time)).toEqual(sampleTake(base, time));
  });

  it('keeps tiny grounded segments and malformed metadata distinct; bounds extra solved samples atomically', () => {
    const stationary = setStepAssistance(moved([.01, 1.05, 0]));
    expect(analyzeStepAssistance(stationary).issues[0].code).toBe('stationary');
    expect(bakeKeyframeSequence(stationary).poses).toEqual(bakeKeyframeSequence(removeStepAssistance(stationary)).poses);
    expect(() => bakeKeyframeSequence({ ...stationary, steps: { ...stationary.steps!, extra: true } as never })).toThrow(/自动迈步/);
    const dense = source();
    dense.times = Array.from({ length: 6001 }, (_, index) => 4 * (index / 6000) ** 1.1);
    dense.times[0] = 0; dense.times[6000] = 4;
    dense.poses = dense.times.map(() => neutral());
    let sequence = makeKeyframeSequence(dense);
    sequence = upsertRootKeyframe(sequence, 0, [0, 1.05, 0]); sequence = upsertRootKeyframe(sequence, 120, [.5, 1.05, 0]);
    const before = JSON.stringify(sequence);
    expect(() => bakeKeyframeSequence(setStepAssistance(sequence))).toThrow(/样本超出/);
    expect(JSON.stringify(sequence)).toBe(before); expect(sequence.steps).toBeUndefined();
  });

  it.each(['root-spike', 'leg-pose', 'root-height'] as const)('checks exact off-grid original %s authority instead of missing it between 30 Hz frames', kind => {
    const base = source();
    base.times = [0, 1, 1.01, 1.02, 4];
    base.poses = base.times.map((_, index) => { const pose = neutral(); pose.root[0] = [0, .125, .12625, .1275, .5][index]; return pose; });
    if (kind === 'root-spike') base.poses[2].root[0] = 2;
    if (kind === 'leg-pose') base.poses[2].joints.LeftLowerLeg = rotationFromDegrees([-100, 0, 0]);
    if (kind === 'root-height') base.poses[2].root[1] = 1.5;
    const original = makeKeyframeSequence(base), enabled = setStepAssistance(original), before = JSON.stringify(enabled);
    const report = analyzeStepAssistance(enabled), take = bakeKeyframeSequence(enabled);
    expect(report.stepCount).toBe(0);
    expect(report.issues.some(issue => issue.code === (kind === 'root-spike' ? 'unreachable-steps' : kind === 'leg-pose' ? 'authored-leg-pose' : 'vertical-or-turning'))).toBe(true);
    expect(take.times).toEqual(base.times); expect(take.poses).toEqual(base.poses);
    expect(sampleTake(take, 1.01)).toEqual(base.poses[2]);
    expect(JSON.stringify(enabled)).toBe(before);
    // Public planner defaults must also cover native nonuniform source knots.
    const direct = buildStepPlan(enabled, (frame, exactTime) => sampleTake(base, exactTime ?? (frame === 120 ? 4 : frame / 30)));
    expect(direct.report.stepCount).toBe(0); expect(direct.report.issues.length).toBeGreaterThan(0);
  });

  it.each([.01, 3.99])('prechecks actual original Root knots in the fade near %s seconds', time => {
    const base = source();
    base.times = [0, time - .001, time, time + .001, 4];
    base.poses = base.times.map(at => { const pose = neutral(); pose.root[0] = at === time ? 2 : at * .125; return pose; });
    const sequence = setStepAssistance(makeKeyframeSequence(base)), report = analyzeStepAssistance(sequence), take = bakeKeyframeSequence(sequence);
    expect(report.stepCount).toBe(0); expect(report.issues.some(issue => issue.code === 'unreachable-steps')).toBe(true);
    expect(take.times).toEqual(base.times); expect(take.poses).toEqual(base.poses);
  });
});
