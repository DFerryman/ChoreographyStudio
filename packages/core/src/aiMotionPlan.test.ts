import { describe, expect, it } from 'vitest';
import { Euler, Quaternion } from 'three';
import { AI_MOTION_REQUEST_MAX_BYTES, validateAIMotionRequest } from './aiMotion';
import { AI_MOTION_PLAN_MAX_SEGMENTS, aiMotionPlanOutputSchema, makeAIMotionPlanRequest, validateAIMotionPlanOutput, validateAIMotionPlanRequest, validateAIMotionPlanResult } from './aiMotionPlan';
import { makeAIMotionPlanFixture, makeAIMotionPlanOutputFixture, makeAIMotionPlanResultFixture } from './aiMotionPlan.fixture';
import { MOTION_PRIOR_CATALOG } from './motionPriors';
import { JOINT_NAMES, type Pose, type Vec3 } from './motion-types';

function largeIntervalMotion() {
  const motion = makeAIMotionPlanFixture('interval').motion, context = motion.context;
  const secondsPerCount = 60 / 239.123456789 * .5;
  const countTimes = Array.from({ length: 473 }, (_, index) => index * secondsPerCount);
  context.timing = { ...context.timing, bpm: 239.123456789, musicBeatsPerDanceCount: .5, octetCount: 59,
    durationSeconds: countTimes.at(-1)!, countTimesSeconds: countTimes };
  const start = 10.1234567890123, end = 47.9876543210987;
  context.target = { mode: 'interval', startSeconds: start, endSeconds: end };
  const pose = (time: number): Pose => ({ root: [.345678901234 * Math.sin(time / 7) + .212345678901,
    1.052345678901 + .023456789012 * Math.sin(time / 9), .245678901234 * Math.cos(time / 8)],
    joints: Object.fromEntries(JOINT_NAMES.map((joint, index) => [joint, new Quaternion().setFromEuler(new Euler(
      .312345678901 * Math.sin(time / 10 + index * .123456789), .234567890123 * Math.cos(time / 12 + index * .234567891),
      .256789012345 * Math.sin(time / 15 + index * .345678912), 'XYZ')).toArray()])) as Pose['joints'] });
  const velocity = (time: number): Vec3 => [.234567891234 * Math.cos(time / 10), .123456789123 * Math.sin(time / 12), .345678912345 * Math.cos(time / 15)];
  for (const [boundary, time] of [[context.boundaries.start, start], [context.boundaries.end, end]] as const) {
    boundary.time = time; boundary.pose = pose(time); boundary.linearVelocity = velocity(time);
    boundary.angularVelocity = Object.fromEntries(JOINT_NAMES.map((joint, index) => [joint, velocity(time + index * .123456789)])) as typeof boundary.angularVelocity;
    boundary.footKinematics = { left: { position: pose(time).root, velocity: velocity(time) }, right: { position: pose(time + .23456789).root, velocity: velocity(time + .23456789) } };
  }
  context.initialPose = structuredClone(context.boundaries.start.pose);
  context.before = Array.from({ length: 4 }, (_, index) => { const time = index === 3 ? start : start - 1 + index / 3; return { time, pose: pose(time) }; });
  context.after = Array.from({ length: 4 }, (_, index) => { const time = index === 0 ? end : end + index / 3; return { time, pose: pose(time) }; });
  context.audio = Array.from({ length: 9 }, (_, index) => ({ ...context.audio[0], id: index ? `audio-${index}` : 'primary',
    name: '乐'.repeat(256), durationSeconds: 120.1234567890123, coverage: { startSeconds: 0, endSeconds: context.timing.durationSeconds } }));
  motion.prompt = '舞'.repeat(2000);
  return validateAIMotionRequest(motion);
}

describe('typed selective choreography planning over real motion priors', () => {
  it('rejects a planning interval shorter than the minimum segment while keeping legacy motion requests valid', () => {
    const request = makeAIMotionPlanFixture('interval');
    request.motion.context.target.endSeconds = 4.05;
    request.motion.context.boundaries.end.time = 4.05;
    expect(validateAIMotionRequest(request.motion)).toEqual(request.motion);
    expect(() => validateAIMotionPlanRequest(request)).toThrow('至少需要 0.1 秒');
    expect(() => makeAIMotionPlanRequest(request.motion, request.catalog)).toThrow('至少需要 0.1 秒');
  });
  it.each([[4, 4.1], [31.3, 31.4]])('accepts a decimal0.1s interval %s..%s with only endpoint-ULP tolerance', (start, end) => {
    const request = makeAIMotionPlanFixture('interval');
    request.motion.context.target = { mode: 'interval', startSeconds: start, endSeconds: end };
    request.motion.context.boundaries.start.time = start; request.motion.context.boundaries.end.time = end;
    request.motion.context.before = [{ time: start - 1, pose: request.motion.context.initialPose }];
    request.motion.context.after = [{ time: Math.min(32, end + .1), pose: request.motion.context.boundaries.end.pose }];
    expect(validateAIMotionPlanRequest(request)).toEqual(request);
    const output = makeAIMotionPlanOutputFixture(request);
    output.segments[0] = { ...output.segments[0], sourceStartSeconds: 0, sourceEndSeconds: end - start, transitionSeconds: 0 };
    expect(validateAIMotionPlanOutput(output, request)).toEqual(output);
    request.motion.context.target.endSeconds = start + .0999; request.motion.context.boundaries.end.time = start + .0999;
    expect(() => validateAIMotionPlanRequest(request)).toThrow('至少需要 0.1 秒');
  });

  it('fits a long fractional-BPM interval and full Unicode intent by bounding only advisory audio names', () => {
    const motion = largeIntervalMotion(), before = structuredClone(motion);
    const size = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).byteLength;
    expect(size(motion)).toBeLessThanOrEqual(AI_MOTION_REQUEST_MAX_BYTES);
    expect(size({ protocol: 'ai-motion-plan-1', motion, catalog: MOTION_PRIOR_CATALOG })).toBeGreaterThan(AI_MOTION_REQUEST_MAX_BYTES);
    const request = makeAIMotionPlanRequest(motion, MOTION_PRIOR_CATALOG);
    expect(size(request)).toBeLessThanOrEqual(AI_MOTION_REQUEST_MAX_BYTES);
    expect(request.motion).toEqual({ ...before, context: { ...before.context,
      audio: before.context.audio.map(audio => ({ ...audio, name: '乐'.repeat(64) })) } });
    expect(motion).toEqual(before);
    expect(request.motion.context.before).toHaveLength(4); expect(request.motion.context.after).toHaveLength(4);
    expect(request.catalog).toEqual(MOTION_PRIOR_CATALOG);
  });

  it('bounds Unicode codepoints on a detached payload and preserves nonempty whitespace-prefixed names', () => {
    const motion = makeAIMotionPlanFixture().motion;
    motion.context.audio[0].name = '💃'.repeat(100);
    const request = makeAIMotionPlanRequest(motion, MOTION_PRIOR_CATALOG);
    expect(request.motion.context.audio[0].name).toBe('💃'.repeat(64));
    expect(motion.context.audio[0].name).toBe('💃'.repeat(100));
    request.motion.context.initialPose.root[0] = 1;
    expect(motion.context.initialPose.root[0]).toBe(0);
    motion.context.audio[0].name = `${' '.repeat(80)}music.wav`;
    expect(makeAIMotionPlanRequest(motion, MOTION_PRIOR_CATALOG).motion.context.audio[0].name).toBe('music.wav');
    expect(motion.context.audio[0].name).toBe(`${' '.repeat(80)}music.wav`);
  });

  it.each(['full', 'interval'] as const)('binds %s plans to frozen original context and exact source hashes', mode => {
    const request = makeAIMotionPlanFixture(mode), original = structuredClone(request), result = makeAIMotionPlanResultFixture(request);
    expect(validateAIMotionPlanRequest(request)).toEqual(request);
    expect(validateAIMotionPlanResult(result, request)).toEqual(result);
    expect(request).toEqual(original);
    const copy = validateAIMotionPlanRequest(request);
    copy.motion.context.initialPose.root[0] = 1;
    copy.catalog.clips[0].tags.push('another');
    expect(request).toEqual(original);
    expect(aiMotionPlanOutputSchema(request).properties.segments.maxItems).toBe(AI_MOTION_PLAN_MAX_SEGMENTS);
  });

  it('rejects invented clips, source overruns, gaps, overlap, reversed time and excessive retiming/transforms', () => {
    const request = makeAIMotionPlanFixture(), output = makeAIMotionPlanOutputFixture(request), segment = output.segments[0];
    for (const patch of [
      { clipId: 'invented' }, { sourceEndSeconds: 100 }, { sourceStartSeconds: -1 }, { sourceStartSeconds: 32 },
      { startSeconds: 0.1 }, { endSeconds: 31.9 }, { sourceEndSeconds: 1 },
      { yawDegrees: 181 }, { travelXZ: [2.01, 0] }, { transitionSeconds: 1.1 }, { contactHint: 'certified' },
      { startSeconds: NaN }, { sourceStartSeconds: Infinity }, { rotations: { Head: [0, 0, 0] } },
    ]) expect(() => validateAIMotionPlanOutput({ ...output, segments: [{ ...segment, ...patch }] }, request)).toThrow();
    const first = { ...segment, endSeconds: 16, sourceEndSeconds: 16 };
    const second = { ...segment, startSeconds: 15.9, sourceStartSeconds: 16, sourceEndSeconds: 32 };
    expect(() => validateAIMotionPlanOutput({ ...output, segments: [first, second] }, request)).toThrow();
    expect(() => validateAIMotionPlanOutput({ ...output, segments: Array(33).fill(segment) }, request)).toThrow();
  });

  it('requires honest limitations and never gives unsupported intent a candidate', () => {
    const request = makeAIMotionPlanFixture(), output = makeAIMotionPlanOutputFixture(request);
    const unsupported = { ...output, intentMatch: 'unsupported' as const, limitations: ['来源不包含指定的后空翻。'], segments: [] };
    expect(validateAIMotionPlanOutput(unsupported, request)).toEqual(unsupported);
    expect(validateAIMotionPlanResult(makeAIMotionPlanResultFixture(request, unsupported), request).sources).toEqual([]);
    expect(() => validateAIMotionPlanOutput({ ...unsupported, segments: output.segments }, request)).toThrow();
    expect(() => validateAIMotionPlanOutput({ ...unsupported, limitations: [] }, request)).toThrow();
    expect(() => validateAIMotionPlanOutput({ ...output, intentMatch: 'partial' }, request)).toThrow();
    expect(validateAIMotionPlanOutput({ ...output, intentMatch: 'partial', limitations: ['仅能提供接近的站立舞步。'] }, request).intentMatch).toBe('partial');
  });

  it('rejects stale context/catalog/source provenance and generated acceptance overrides', () => {
    const request = makeAIMotionPlanFixture('interval'), result = makeAIMotionPlanResultFixture(request);
    for (const patch of [
      { requestId: 'other' }, { sourceHash: 'b'.repeat(64) }, { catalogVersion: 'other' },
      { target: { ...result.target, endSeconds: 9 } }, { sources: [{ clipId: 'cmu-61-08', sourceHash: 'c'.repeat(64) }] },
      { sources: [] }, { physicalAcceptance: true }, { model: 'other' },
    ]) expect(() => validateAIMotionPlanResult({ ...result, ...patch }, request)).toThrow();
  });

  it('bounds the complete request and rejects duplicate catalog IDs, unsafe objects and accessors', () => {
    const request = makeAIMotionPlanFixture();
    const duplicate = structuredClone(request); duplicate.catalog.clips.push(duplicate.catalog.clips[0]);
    expect(() => validateAIMotionPlanRequest(duplicate)).toThrow();
    const accessor = structuredClone(request);
    Object.defineProperty(accessor.catalog.clips[0], 'label', { get() { throw new Error('should not run'); }, enumerable: true });
    expect(() => validateAIMotionPlanRequest(accessor)).toThrow('AI 动作规划数据无效');
    const sparse = structuredClone(request); sparse.catalog.clips.length++;
    expect(() => validateAIMotionPlanRequest(sparse)).toThrow();
    const tooLarge = structuredClone(request);
    tooLarge.catalog.clips = Array.from({ length: 24 }, (_, index) => ({ ...request.catalog.clips[0], id: `clip-${index}`, tags: Array.from({ length: 16 }, (_, tag) => `${tag}${'舞'.repeat(79)}`) }));
    expect(new TextEncoder().encode(JSON.stringify(tooLarge)).byteLength).toBeGreaterThan(AI_MOTION_REQUEST_MAX_BYTES);
    expect(() => validateAIMotionPlanRequest(tooLarge)).toThrow();
  });
});
