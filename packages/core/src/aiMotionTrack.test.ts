import { describe, expect, it } from 'vitest';
import { Quaternion, Vector3 } from 'three';
import { makeCountMap, sampleTake } from './index';
import { rotationFromDegrees } from './keyframes';
import { JOINT_NAMES, type BakedTake, type Pose, type Quat, type Vec3 } from './motion-types';
import { makeAIMotionFixture, makeAIMotionResultFixture } from './aiMotion.fixture';
import { AI_MOTION_MODEL, type AIMotionKeyframe, type AIMotionRequest, type AIMotionResult } from './aiMotion';
import {
  AI_MOTION_STATIC_WARNING, analyzeAIMotionPatch, appendAIMotionPatch, compileAIMotionPatch, createAIMotionSampler,
  estimateAIMotionBoundary, MAX_AI_MOTION_PATCHES, validateAIMotionTrack,
  type AIMotionPoseSampler, type AIMotionTrack,
} from './aiMotionTrack';

const map = () => makeCountMap({ bpm: 120, musicBeatsPerDanceCount: 1, firstCountSourceSeconds: 0, octetCount: 4, audioDurationSeconds: 16 });
const poseAt = (time: number): Pose => ({
  root: [time * .07 + time * time * .001, 1.05 + Math.sin(time * .5) * .03, time * .02],
  joints: Object.fromEntries(JOINT_NAMES.map((joint, index) => [joint, rotationFromDegrees([time * (index + 1) * .7, Math.sin(time * .4) * 8, time * (index + 1) * .3])])) as Pose['joints'],
});
const neutral = (): Pose => ({ root: [0, 1.05, 0], joints: Object.fromEntries(JOINT_NAMES.map(joint => [joint, [0, 0, 0, 1]])) as Pose['joints'] });
let serial = 0;
function requestFor(sampler: AIMotionPoseSampler, timing = map(), mode: 'full' | 'interval' = 'interval', start = 4, end = 8): AIMotionRequest {
  const request = makeAIMotionFixture(mode);
  const range = mode === 'full' ? { mode, startSeconds: 0, endSeconds: timing.durationSeconds } : { mode, startSeconds: start, endSeconds: end };
  request.context.requestId = `track-test-${++serial}`;
  request.context.timing = timing;
  request.context.audio[0].coverage = { startSeconds: 0, endSeconds: timing.durationSeconds };
  request.context.target = range;
  request.context.initialPose = sampler(range.startSeconds);
  request.context.boundaries = {
    start: estimateAIMotionBoundary(sampler, range.startSeconds, 'before', timing.durationSeconds),
    end: estimateAIMotionBoundary(sampler, range.endSeconds, 'after', timing.durationSeconds),
  };
  request.context.before = mode === 'full' ? [] : [...new Set([Math.max(0, start - 1), Math.max(0, start - .5), start])].sort((a, b) => a - b).map(time => ({ time, pose: sampler(time) }));
  request.context.after = mode === 'full' ? [] : [...new Set([end, Math.min(timing.durationSeconds, end + .5), Math.min(timing.durationSeconds, end + 1)])].sort((a, b) => a - b).map(time => ({ time, pose: sampler(time) }));
  return request;
}
function resultFor(request: AIMotionRequest, keys?: AIMotionKeyframe[]): AIMotionResult {
  const result = makeAIMotionResultFixture(request);
  const { startSeconds: start, endSeconds: end, mode } = request.context.target;
  result.keyframes = keys ?? [
    { time: start + (end - start) * .23, root: [.6, 1.1, .25], rotations: { Hips: [31, 24, -17], LeftUpperArm: [40, 17, 63] } },
    { time: mode === 'full' ? end : start + (end - start) * .72, root: [.3, 1.02, .1], rotations: { Hips: [-26, 53, 28], RightUpperArm: [23, -12, -41] } },
  ];
  return result;
}
function compile(sampler: AIMotionPoseSampler, timing = map(), mode: 'full' | 'interval' = 'interval', start = 4, end = 8) {
  const request = requestFor(sampler, timing, mode, start, end);
  const result = resultFor(request);
  const patch = compileAIMotionPatch(request, result, sampler);
  return { request, result, patch, track: appendAIMotionPatch(undefined, patch, timing) };
}

/** Independent finite differences of actual sampled orientations, using Three. */
function angularDelta(a: Quat, b: Quat, dt: number): Vec3 {
  const delta = new Quaternion(...a).invert().multiply(new Quaternion(...b)).normalize();
  if (delta.w < 0) delta.set(-delta.x, -delta.y, -delta.z, -delta.w);
  const axis = new Vector3(delta.x, delta.y, delta.z), sine = axis.length();
  if (sine < 1e-12) return axis.multiplyScalar(2 / dt).toArray() as Vec3;
  return axis.multiplyScalar(2 * Math.atan2(sine, delta.w) / (sine * dt)).toArray() as Vec3;
}
function sampledVelocity(sampler: AIMotionPoseSampler, time: number, direction: -1 | 1, step = 1e-6) {
  const current = sampler(time), other = sampler(time + direction * step), dt = direction * step;
  return {
    linear: current.root.map((value, axis) => (other.root[axis] - value) / dt),
    angular: Object.fromEntries(JOINT_NAMES.map(joint => [joint, angularDelta(current.joints[joint], other.joints[joint], dt)])) as Record<string, Vec3>,
  };
}
function expectVelocityContinuity(before: ReturnType<typeof sampledVelocity>, after: ReturnType<typeof sampledVelocity>, tolerance = 2e-3) {
  before.linear.forEach((value, axis) => expect(Math.abs(value - after.linear[axis])).toBeLessThan(tolerance));
  for (const joint of JOINT_NAMES) before.angular[joint].forEach((value, axis) => expect(Math.abs(value - after.angular[joint][axis])).toBeLessThan(tolerance));
}

describe('independent AI motion layers', () => {
  it('preserves arbitrary nonuniform author samples and exact sampling outside an interval', () => {
    const timing = map(), times = [0, .073, .7134567, 1.03, 3.97, 4, 4.023, 6.17, 7.93, 8, 8.021, 11.2, 16];
    const take: BakedTake = { id: 'dense-source', schemaVersion: 'preview-1', planId: 'original', countMapId: timing.id, durationSeconds: 16, times, poses: times.map(poseAt), provenance: 'synthetic-demo' };
    const original = JSON.stringify(take), sampler = (time: number) => sampleTake(take, time);
    const { request, result, patch, track } = compile(sampler, timing);
    const payload = JSON.stringify({ request, result, patch, track });
    const layered = createAIMotionSampler(sampler, track);
    for (const time of [0, .031234567, .7134567, 3.99712345, 4, 8, 8.000001, 10.718192, 16]) expect(layered(time)).toEqual(sampler(time));
    expect(layered(5.13579)).not.toEqual(sampler(5.13579));
    expect(JSON.stringify(take)).toBe(original);
    expect(JSON.stringify({ request, result, patch, track })).toBe(payload);
    const exact = poseAt(0), referenceSampler = () => exact;
    expect(createAIMotionSampler(referenceSampler, track)(3)).toBe(exact);
    expect(createAIMotionSampler(referenceSampler)).toBe(referenceSampler);
  });

  it('matches both original boundary poses and multi-axis root/angular velocities', () => {
    const timing = map(), { patch, track } = compile(poseAt, timing);
    const layered = createAIMotionSampler(poseAt, track);
    expect(layered(4)).toEqual(poseAt(4)); expect(layered(8)).toEqual(poseAt(8));
    expect(patch.knots[0].pose).toEqual(poseAt(4)); expect(patch.knots.at(-1)!.pose).toEqual(poseAt(8));
    expectVelocityContinuity(sampledVelocity(poseAt, 4, -1), sampledVelocity(layered, 4, 1));
    expectVelocityContinuity(sampledVelocity(layered, 8, -1), sampledVelocity(poseAt, 8, 1));
    for (const knot of patch.knots.slice(1, -1)) expectVelocityContinuity(sampledVelocity(layered, knot.time, -1), sampledVelocity(layered, knot.time, 1));
  });

  it('layers a second interval against the previous effective motion without changing its outside', () => {
    const timing = map(), first = compile(poseAt, timing), firstSampler = createAIMotionSampler(poseAt, first.track);
    const second = compile(firstSampler, timing, 'interval', 5, 7);
    const track = appendAIMotionPatch(first.track, second.patch, timing), secondSampler = createAIMotionSampler(poseAt, track);
    for (const time of [0, 4, 4.125, 5, 7, 7.51, 8, 16]) expect(secondSampler(time)).toEqual(firstSampler(time));
    expectVelocityContinuity(sampledVelocity(firstSampler, 5, -1), sampledVelocity(secondSampler, 5, 1));
    expectVelocityContinuity(sampledVelocity(secondSampler, 7, -1), sampledVelocity(firstSampler, 7, 1));
    expect(track.patches).toHaveLength(2);
    expect(first.track.patches).toHaveLength(1);
  });

  it('supports full generation then interval editing and full replacement without touching the original', () => {
    const timing = map(), earlier = compile(poseAt, timing), full = compile(poseAt, timing, 'full');
    const fullTrack = appendAIMotionPatch(earlier.track, full.patch, timing);
    expect(fullTrack.patches).toHaveLength(1);
    const fullSampler = createAIMotionSampler(poseAt, fullTrack);
    expect(fullSampler(0)).toEqual(poseAt(0));
    expect(fullSampler(16)).toEqual(full.patch.knots.at(-1)!.pose);
    const finalVelocity = sampledVelocity(fullSampler, 16, -1);
    finalVelocity.linear.forEach(value => expect(Math.abs(value)).toBeLessThan(1e-4));
    for (const angular of Object.values(finalVelocity.angular)) angular.forEach(value => expect(Math.abs(value)).toBeLessThan(1e-4));
    const local = compile(fullSampler, timing, 'interval', 3, 10), edited = appendAIMotionPatch(fullTrack, local.patch, timing);
    const editedSampler = createAIMotionSampler(poseAt, edited);
    for (const time of [0, 2.513456, 3, 10, 15.137, 16]) expect(editedSampler(time)).toEqual(fullSampler(time));
    expectVelocityContinuity(sampledVelocity(fullSampler, 3, -1), sampledVelocity(editedSampler, 3, 1));
    expectVelocityContinuity(sampledVelocity(editedSampler, 10, -1), sampledVelocity(fullSampler, 10, 1));
    const replacement = compile(editedSampler, timing, 'full'), reset = appendAIMotionPatch(edited, replacement.patch, timing);
    expect(reset.patches).toHaveLength(1);
    expect(reset.patches[0].requestId).toBe(replacement.request.context.requestId);
    expect(earlier.track.patches).toHaveLength(1); expect(edited.patches).toHaveLength(2);
  });

  it('inherits omitted local rotations from the preceding generated pose', () => {
    const timing = map(), request = requestFor(poseAt, timing), result = resultFor(request);
    const patch = compileAIMotionPatch(request, result, poseAt);
    expect(patch.knots[1].pose.joints.RightUpperArm).toEqual(poseAt(4).joints.RightUpperArm);
    expect(patch.knots[2].pose.joints.LeftUpperArm).toEqual(patch.knots[1].pose.joints.LeftUpperArm);
    expect(patch.knots[1].pose.joints.LeftUpperArm).toEqual(rotationFromDegrees([40, 17, 63]));
    // Do not apply biomechanical limits to model-authored channels during compilation.
    const extreme = resultFor(request, [{ time: 6, root: [0, 1.05, 0], rotations: { LeftUpperArm: [250, 0, 0] } }]);
    expect(compileAIMotionPatch(request, extreme, poseAt).knots[1].pose.joints.LeftUpperArm).toEqual(rotationFromDegrees([250, 0, 0]));
  });

  it('remains finite near 180 degrees and treats quaternion signs as equivalent', () => {
    const timing = map(), request = requestFor(neutral, timing);
    const result = resultFor(request, [
      { time: 5, root: [0, 1.05, 0], rotations: { Hips: [179.999999, 0, 0] } },
      { time: 6.7, root: [.2, 1.1, 0], rotations: { Hips: [-179.999999, 45, 10] } },
    ]);
    const patch = compileAIMotionPatch(request, result, neutral), track = appendAIMotionPatch(undefined, patch, timing);
    const opposite = structuredClone(track);
    for (const knot of opposite.patches[0].knots) for (const joint of JOINT_NAMES) knot.pose.joints[joint] = knot.pose.joints[joint].map(value => -value) as Quat;
    const a = createAIMotionSampler(neutral, track), b = createAIMotionSampler(neutral, opposite);
    for (let step = 0; step <= 120; step++) {
      const time = 4 + step / 30;
      for (const joint of JOINT_NAMES) {
        const qa = a(time).joints[joint], qb = b(time).joints[joint];
        expect(qa.every(Number.isFinite)).toBe(true); expect(Math.hypot(...qa)).toBeCloseTo(1, 12);
        expect(new Quaternion(...qa).angleTo(new Quaternion(...qb))).toBeLessThan(1e-7);
      }
    }
    expectVelocityContinuity(sampledVelocity(a, 5, -1), sampledVelocity(a, 5, 1));
  });

  it('estimates single-sided velocities at endpoints and nonuniform source knots', () => {
    const timing = map();
    const start = estimateAIMotionBoundary(poseAt, 0, 'before', timing.durationSeconds);
    const end = estimateAIMotionBoundary(poseAt, 16, 'after', timing.durationSeconds);
    expect(start.linearVelocity[0]).toBeCloseTo(.07, 8);
    expect(end.linearVelocity[0]).toBeCloseTo(.102, 8);
    const cusp = (time: number): Pose => ({ ...neutral(), root: [time <= 4 ? time : 4 + (time - 4) * 3, 1.05, 0] });
    expect(estimateAIMotionBoundary(cusp, 4, 'before', 16).linearVelocity[0]).toBeCloseTo(1, 8);
    expect(estimateAIMotionBoundary(cusp, 4, 'after', 16).linearVelocity[0]).toBeCloseTo(3, 8);
  });

  it('rejects invalid stored tracks without silently normalizing or discarding layers', () => {
    const timing = map(), { track } = compile(poseAt, timing);
    expect(validateAIMotionTrack(track, timing)).toBe(track);
    const mutations: ((value: AIMotionTrack) => void)[] = [
      value => { value.schema = 'bad' as any; },
      value => { value.countMapId = 'another-map'; },
      value => { value.durationSeconds = 16.1; },
      value => { value.patches[0].provider = 'pretend' as any; },
      value => { value.patches[0].model = 'pretend' as any; },
      value => { value.patches[0].sourceHash = 'not-a-hash'; },
      value => { value.patches[0].knots[1].time = value.patches[0].knots[0].time; },
      value => { value.patches[0].knots[0].time += .01; },
      value => { value.patches[0].knots.at(-1)!.time -= .01; },
      value => { value.patches[0].knots[1].pose.joints.Hips = [0, 0, 0, .9]; },
      value => { value.patches[0].knots[1].linearVelocity[0] = Infinity; },
      value => { value.patches[0].knots[1].linearVelocity[0] = Number.MAX_VALUE; },
      value => { value.patches[0].knots[1].angularVelocity.LeftUpperArm[1] = NaN; },
      value => { (value.patches[0] as any).hidden = true; },
      value => { value.patches = []; },
      value => { value.patches.push(structuredClone(value.patches[0])); },
    ];
    for (const mutate of mutations) { const invalid = structuredClone(track); mutate(invalid); expect(() => validateAIMotionTrack(invalid, timing)).toThrow(); }
    const maximum = structuredClone(track);
    maximum.patches = Array.from({ length: MAX_AI_MOTION_PATCHES }, (_, index) => ({ ...structuredClone(track.patches[0]), id: `patch-${index}`, requestId: `request-${index}` }));
    const unchanged = JSON.stringify(maximum), extra = structuredClone(track.patches[0]); extra.id = 'extra'; extra.requestId = 'extra';
    expect(() => appendAIMotionPatch(maximum, extra, timing)).toThrow();
    expect(JSON.stringify(maximum)).toBe(unchanged);
    const full = compile(poseAt, timing, 'full').track;
    full.patches[0].knots.at(-1)!.linearVelocity[0] = 1;
    expect(() => validateAIMotionTrack(full, timing)).toThrow();
  });

  it('rejects compilation against changed source boundaries and never mutates the old request', () => {
    const timing = map(), request = requestFor(poseAt, timing), result = resultFor(request), original = JSON.stringify(request);
    const changed = (time: number): Pose => { const value = poseAt(time); value.root[0] += .01; return value; };
    expect(() => compileAIMotionPatch(request, result, changed)).toThrow('原稿边界已变化');
    expect(JSON.stringify(request)).toBe(original);
  });

  it('restores historical Qwen provenance unchanged after selecting OSS and layers the new model separately', () => {
    const timing = map(), times = [0, .071, .717, 3.97, 4, 4.13, 8, 8.17, 16];
    const take: BakedTake = { id: 'old-qwen-source', schemaVersion: 'preview-1', planId: 'original', countMapId: timing.id, durationSeconds: 16, times, poses: times.map(poseAt), provenance: 'synthetic-demo' };
    const originalSampler = (time: number) => sampleTake(take, time), { patch } = compile(originalSampler, timing);
    expect(AI_MOTION_MODEL).toBe('@cf/openai/gpt-oss-120b');
    patch.model = '@cf/qwen/qwen3-30b-a3b-fp8';
    const oldTrack = appendAIMotionPatch(undefined, patch, timing), original = JSON.stringify({ take, oldTrack });
    const restored = JSON.parse(original);
    expect(validateAIMotionTrack(restored.oldTrack, timing, originalSampler)).toEqual(oldTrack);
    expect(restored.take).toEqual(take);
    expect(restored.oldTrack.patches[0].model).toBe('@cf/qwen/qwen3-30b-a3b-fp8');
    const existingSampler = createAIMotionSampler(originalSampler, restored.oldTrack);
    const next = compile(existingSampler, timing, 'interval', 5, 7), combined = appendAIMotionPatch(restored.oldTrack, next.patch, timing);
    expect(combined.patches.map(value => value.model)).toEqual(['@cf/qwen/qwen3-30b-a3b-fp8', '@cf/openai/gpt-oss-120b']);
    expect(validateAIMotionTrack(JSON.parse(JSON.stringify(combined)), timing, originalSampler)).toEqual(combined);
    expect(combined.patches[0]).toEqual(oldTrack.patches[0]);
    for (const time of [0, .613456, 4, 8, 8.991, 16]) expect(createAIMotionSampler(originalSampler, combined)(time)).toEqual(originalSampler(time));
    expect(JSON.stringify({ take, oldTrack })).toBe(original);
  });

  it('compiles and restores true session identity without changing the motion or source seams', () => {
    const timing = map(), request = requestFor(poseAt, timing), originalResult = resultFor(request);
    const response: AIMotionResult = { ...originalResult, provider: 'codex-session', model: 'gpt-6.1-sol' };
    const options = { expectedProvider: 'codex-session', expectedModel: 'gpt-6.1-sol' } as const;
    const original = JSON.stringify({ request, response, options });
    expect(() => compileAIMotionPatch(request, response, poseAt)).toThrow(/过期/);
    const patch = compileAIMotionPatch(request, response, poseAt, options);
    expect(patch.provider).toBe('codex-session'); expect(patch.model).toBe('gpt-6.1-sol');
    expect(patch.motionOrigin).toBeUndefined();
    expect(patch.knots).toEqual(compileAIMotionPatch(request, originalResult, poseAt).knots);
    const track = appendAIMotionPatch(undefined, patch, timing), restored = JSON.parse(JSON.stringify(track));
    expect(validateAIMotionTrack(restored, timing, poseAt)).toEqual(track);
    for (const time of [0, 3.999999, 4, 8, 8.000001, 16]) expect(createAIMotionSampler(poseAt, restored)(time)).toEqual(poseAt(time));
    expect(() => compileAIMotionPatch(request, response, poseAt,
      { expectedProvider: 'cloudflare-workers-ai', expectedModel: 'gpt-6.1-sol' } as any)).toThrow();
    const changed = (time: number) => { const value = poseAt(time); if (time === 4) value.root[0] += .001; return value; };
    expect(() => compileAIMotionPatch(request, response, changed, options)).toThrow(/原稿边界已变化/);
    expect(JSON.stringify({ request, response, options })).toBe(original);
  });

  it('rejects incorrect stored identity pairs and session human-prior claims without increasing sparse limits', () => {
    const timing = map(), request = requestFor(poseAt, timing);
    const response: AIMotionResult = { ...resultFor(request), provider: 'codex-session', model: 'gpt-6.1-sol' };
    const patch = compileAIMotionPatch(request, response, poseAt, { expectedProvider: 'codex-session', expectedModel: 'gpt-6.1-sol' });
    const track = appendAIMotionPatch(undefined, patch, timing);
    for (const [provider, model] of [
      ['cloudflare-workers-ai', 'gpt-6.1-sol'], ['codex-session', AI_MOTION_MODEL],
      ['codex-session', '@cf/qwen/qwen3-30b-a3b-fp8'], ['codex-session', 'unknown'], ['unknown', 'gpt-6.1-sol'],
    ]) {
      const changed = structuredClone(track); Object.assign(changed.patches[0], { provider, model });
      expect(() => validateAIMotionTrack(changed, timing)).toThrow(/来源/);
    }
    const fakePrior = structuredClone(track); fakePrior.patches[0].motionOrigin = { kind: 'human-motion-prior' } as any;
    expect(() => validateAIMotionTrack(fakePrior, timing)).toThrow(/不能标记/);
    const dense = structuredClone(track);
    dense.patches[0].knots = Array.from({ length: 51 }, (_, index) => ({ ...structuredClone(patch.knots[0]), time: 4 + index * 4 / 50 }));
    expect(() => validateAIMotionTrack(dense, timing)).toThrow(/数量/);
  });

  it('checks restored seam authority against the source and prior AI layers when provided', () => {
    const timing = map(), full = compile(poseAt, timing, 'full'), fullSampler = createAIMotionSampler(poseAt, full.track);
    const local = compile(fullSampler, timing, 'interval', 4, 8), track = appendAIMotionPatch(full.track, local.patch, timing);
    const restored = JSON.parse(JSON.stringify(track));
    expect(validateAIMotionTrack(restored, timing, poseAt)).toBe(restored);
    const wrongPose = structuredClone(track); wrongPose.patches[1].knots[0].pose.root[0] += .001;
    expect(() => validateAIMotionTrack(wrongPose, timing, poseAt)).toThrow('接缝与原稿不一致');
    const wrongVelocity = structuredClone(track); wrongVelocity.patches[1].knots.at(-1)!.angularVelocity.Hips[0] += .1;
    expect(() => validateAIMotionTrack(wrongVelocity, timing, poseAt)).toThrow('接缝与原稿不一致');
    const wrongOriginal = (time: number) => { const value = poseAt(time); value.root[0] += .001; return value; };
    expect(() => validateAIMotionTrack(track, timing, wrongOriginal)).toThrow('接缝与原稿不一致');
  });

  it('canonicalizes only new derived velocity zeros for exact JSON round trips', () => {
    const timing = map(), { request, patch, track } = compile(neutral, timing);
    const components = [
      ...request.context.boundaries.start.linearVelocity, ...request.context.boundaries.end.linearVelocity,
      ...Object.values(request.context.boundaries.start.angularVelocity).flat(), ...Object.values(request.context.boundaries.end.angularVelocity).flat(),
      ...patch.knots.flatMap(knot => [...knot.linearVelocity, ...Object.values(knot.angularVelocity).flat()]),
    ];
    expect(components.every(value => !Object.is(value, -0))).toBe(true);
    expect(JSON.parse(JSON.stringify(track))).toEqual(track);
    const source = neutral(); source.root[0] = -0; source.joints.Hips[1] = -0;
    const original = structuredClone(source), boundary = estimateAIMotionBoundary(() => source, 4, 'before', 16);
    expect(source).toEqual(original); expect(Object.is(boundary.pose.root[0], -0)).toBe(true);
    expect(Object.is(boundary.pose.joints.Hips[1], -0)).toBe(true);
    expect([...boundary.linearVelocity, ...Object.values(boundary.angularVelocity).flat()].every(value => !Object.is(value, -0))).toBe(true);
  });

  it('restores repeated full regeneration after replacing the previous AI layers', () => {
    const timing = map(), firstRequest = requestFor(neutral, timing, 'full');
    const firstResult = resultFor(firstRequest, [
      { time: .1, root: [0, 1.05, 0], rotations: { Head: [80, 0, 0] } },
      { time: 1, root: [0, 1.05, 0], rotations: { Head: [0, 0, 0] } },
      { time: 16, root: [0, 1.05, 0], rotations: {} },
    ]);
    const firstPatch = compileAIMotionPatch(firstRequest, firstResult, neutral), firstTrack = appendAIMotionPatch(undefined, firstPatch, timing);
    const firstSampler = createAIMotionSampler(neutral, firstTrack), second = compile(firstSampler, timing, 'full');
    // Single-sided finite differences of this fast first curve have a small
    // truncation error even though its exact initial angular velocity is zero.
    expect(Math.abs(second.request.context.boundaries.start.angularVelocity.Head[0])).toBeGreaterThan(1e-5);
    const replaced = appendAIMotionPatch(firstTrack, second.patch, timing), restored = JSON.parse(JSON.stringify(replaced));
    expect(restored.patches).toHaveLength(1);
    expect(validateAIMotionTrack(restored, timing, neutral)).toBe(restored);
    expect(createAIMotionSampler(neutral, restored)(0)).toEqual(neutral());
    expect(restored.patches[0].knots.at(-1).linearVelocity).toEqual([0, 0, 0]);
    expect(Object.values(restored.patches[0].knots.at(-1).angularVelocity).flat().every(value => value === 0)).toBe(true);
    expect(firstTrack.patches).toHaveLength(1);
  });

  it('reports a smooth hold for review without rejecting or inventing motion quality scores', () => {
    const timing = map(), request = requestFor(neutral, timing, 'full');
    const result = resultFor(request, [
      { time: 4, root: [0, 1.05, 0], rotations: {} },
      { time: 16, root: [0, 1.05, 0], rotations: {} },
    ]);
    const patch = compileAIMotionPatch(request, result, neutral), original = JSON.stringify(patch);
    const quality = analyzeAIMotionPatch(patch);
    expect(quality.samples).toBe(481); expect(quality.warnings).toEqual([AI_MOTION_STATIC_WARNING]);
    for (const [key, value] of Object.entries(quality)) if (key !== 'samples' && typeof value === 'number') expect(value).toBeLessThan(1e-9);
    expect(JSON.stringify(patch)).toBe(original);
  });

  it('measures cumulative slow movement from the first pose instead of individual frames', () => {
    const timing = map();
    for (const channel of ['root', 'rotation'] as const) {
      const request = requestFor(neutral, timing, 'full');
      const result = resultFor(request, [
        { time: 8, root: [channel === 'root' ? .001 : 0, 1.05, 0], rotations: channel === 'rotation' ? { Hips: [2.5, 0, 0] } : {} },
        { time: 16, root: [channel === 'root' ? .002 : 0, 1.05, 0], rotations: channel === 'rotation' ? { Hips: [5, 0, 0] } : {} },
      ]);
      const patch = compileAIMotionPatch(request, result, neutral), quality = analyzeAIMotionPatch(patch);
      expect(quality.maxFrameRootDistanceMeters).toBeLessThan(1e-5);
      expect(quality.maxFrameJointAngleDegrees).toBeLessThan(.1);
      if (channel === 'root') expect(quality.maxRootExcursionMeters).toBeCloseTo(.002, 9);
      else expect(quality.maxJointExcursionDegrees).toBeCloseTo(5, 9);
      expect(quality.warnings).not.toContain(AI_MOTION_STATIC_WARNING);
    }
  });

  it('uses physical quaternion orientation for near-360 values and a real turn returning to its initial pose', () => {
    const timing = map(), request = requestFor(neutral, timing, 'full');
    const almostSame = resultFor(request, [
      { time: 8, root: [0, 1.05, 0], rotations: { Hips: [359.99, 0, 0] } },
      { time: 16, root: [0, 1.05, 0], rotations: { Hips: [360, 0, 0] } },
    ]);
    const still = analyzeAIMotionPatch(compileAIMotionPatch(request, almostSame, neutral));
    expect(still.maxJointExcursionDegrees).toBeLessThan(.1);
    expect(still.warnings).toContain(AI_MOTION_STATIC_WARNING);
    const turning = resultFor(request, [
      { time: 4, root: [0, 1.05, 0], rotations: { Hips: [90, 0, 0] } },
      { time: 8, root: [0, 1.05, 0], rotations: { Hips: [179.999, 0, 0] } },
      { time: 12, root: [0, 1.05, 0], rotations: { Hips: [270, 0, 0] } },
      { time: 16, root: [0, 1.05, 0], rotations: { Hips: [360, 0, 0] } },
    ]);
    const moving = analyzeAIMotionPatch(compileAIMotionPatch(request, turning, neutral));
    expect(moving.maxJointExcursionDegrees).toBeGreaterThan(179.5);
    expect(moving.maxJointExcursionDegrees).toBeLessThanOrEqual(180 + 1e-8);
    expect(moving.warnings).not.toContain(AI_MOTION_STATIC_WARNING);
  });

  it('flags the observed five-zero-pose response pattern while preserving valid hold adoption', () => {
    const timing = map(), request = requestFor(neutral, timing, 'full'); request.prompt = '抬起双臂并转身。';
    const zeroRotations = Object.fromEntries(JOINT_NAMES.map(joint => [joint, [0, 0, 0]])) as AIMotionKeyframe['rotations'];
    const result = resultFor(request, [3.2, 6.4, 9.6, 12.8, 16].map(time => ({ time, root: [0, 1.05, 0], rotations: structuredClone(zeroRotations) })));
    const original = JSON.stringify({ request, result }), patch = compileAIMotionPatch(request, result, neutral);
    const quality = analyzeAIMotionPatch(patch);
    expect(quality.maxRootExcursionMeters).toBeLessThan(1e-5);
    expect(quality.maxJointExcursionDegrees).toBeLessThan(.1);
    expect(quality.warnings).toContain(AI_MOTION_STATIC_WARNING);
    expect(() => appendAIMotionPatch(undefined, patch, timing)).not.toThrow();
    expect(JSON.stringify({ request, result })).toBe(original);
  });

  it('measures and warns about a legal one-millisecond C1 excursion without changing it', () => {
    const timing = map(), request = requestFor(neutral, timing, 'interval', 4, 4.001);
    const result = resultFor(request, [{ time: 4.0005, root: [1, 1.05, 0], rotations: { Hips: [120, 0, 0] } }]);
    const patch = compileAIMotionPatch(request, result, neutral), original = JSON.stringify(patch);
    const quality = analyzeAIMotionPatch(patch);
    expect(quality.samples).toBe(3);
    expect(quality.maxFrameRootDistanceMeters).toBeCloseTo(1, 9);
    expect(quality.maxFrameJointAngleDegrees).toBeCloseTo(120, 9);
    expect(quality.maxLinearSpeedMetersPerSecond).toBeGreaterThan(1999);
    expect(quality.maxRootAccelerationMetersPerSecondSquared).toBeGreaterThan(3.9e6);
    expect(quality.maxAngularSpeedDegreesPerSecond).toBeGreaterThan(239999);
    expect(quality.maxAngularAccelerationDegreesPerSecondSquared).toBeGreaterThan(4.7e8);
    expect(quality.warnings.length).toBeGreaterThan(0);
    expect(JSON.stringify(patch)).toBe(original);
  });

  it('uses real intervals and midpoint distances at nonuniform knots and the final partial frame', () => {
    const timing = map(), { patch } = compile(neutral, timing, 'interval', 0, .71);
    // Independent analytic trajectory x=t², angle=40t² degrees. Its accelerations
    // are exactly 2 m/s² and 80 deg/s², including the 0.01-second final interval.
    patch.knots = [0, .41, .71].map(time => {
      const current = neutral(); current.root[0] = time * time;
      current.joints.Hips = rotationFromDegrees([40 * time * time, 0, 0]);
      const angularVelocity = Object.fromEntries(JOINT_NAMES.map(joint => [joint, [0, 0, 0]])) as typeof patch.knots[number]['angularVelocity'];
      angularVelocity.Hips = [80 * time * Math.PI / 180, 0, 0];
      return { time, pose: current, linearVelocity: [2 * time, 0, 0], angularVelocity };
    });
    const quality = analyzeAIMotionPatch(patch);
    expect(quality.samples).toBe(24);
    expect(quality.maxLinearSpeedMetersPerSecond).toBeCloseTo(1.41, 8);
    expect(quality.maxRootAccelerationMetersPerSecondSquared).toBeCloseTo(2, 7);
    expect(quality.maxAngularSpeedDegreesPerSecond).toBeCloseTo(56.4, 7);
    expect(quality.maxAngularAccelerationDegreesPerSecondSquared).toBeCloseTo(80, 6);
    expect(quality.warnings).toEqual([]);
  });

  it('rejects unusable samples and reports finite Hermite overshoots without projection', () => {
    const timing = map(), { patch } = compile(neutral, timing);
    patch.knots[0].linearVelocity = [1e4, 0, 0];
    const original = JSON.stringify(patch), quality = analyzeAIMotionPatch(patch);
    expect(quality.maxFrameRootDistanceMeters).toBeGreaterThan(.5);
    expect(quality.warnings.length).toBeGreaterThan(0);
    expect(JSON.stringify(patch)).toBe(original);
    const broken = structuredClone(patch); broken.knots[1].pose.root[0] = NaN;
    expect(() => analyzeAIMotionPatch(broken)).toThrow();
    const invalidRotation = structuredClone(patch); invalidRotation.knots[1].pose.joints.Hips = [0, 0, 0, 0];
    expect(() => analyzeAIMotionPatch(invalidRotation)).toThrow();
    const unbounded = structuredClone(patch); unbounded.target.endSeconds = 1e10;
    expect(() => analyzeAIMotionPatch(unbounded)).toThrow();
  });
});
