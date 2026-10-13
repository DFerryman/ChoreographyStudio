import { describe, expect, it } from 'vitest';
import { makeAIMotionFixture, makeAIMotionResultFixture } from './aiMotion.fixture';
import { compileAIMotionPosePatch, createAIMotionSampler, validateAIMotionTrack, MAX_AI_MOTION_POSE_SAMPLES } from './aiMotionTrack';
import { rotationFromDegrees } from './keyframes';
import { clonePose } from './humanoid';
import type { MotionPriorCompositionOrigin } from './motionPriors';

function setup(mode: 'full' | 'interval' = 'interval') {
  const request = makeAIMotionFixture(mode), { target } = request.context;
  const base = () => clonePose(request.context.initialPose);
  const origin: MotionPriorCompositionOrigin = { kind: 'human-motion-prior', catalogVersion: 'test-capture-1',
    sources: [{ clipId: 'capture', sourceHash: 'c'.repeat(64) }],
    adaptations: ['test-body-fit'], adaptationMetrics: { maxHandDisplacementMeters: .18, rmsHandDisplacementMeters: .04,
      maxSoleOrientationChangeRadians: .1, maxFootMarkerDisplacementMeters: .02 },
    segments: [{ clipId: 'capture', startSeconds: target.startSeconds, endSeconds: target.endSeconds,
      sourceStartSeconds: 0, sourceEndSeconds: target.endSeconds - target.startSeconds, yawDegrees: 0,
      travelXZ: [0, 0], transitionSeconds: .5, contactHint: 'standing' }] };
  const duration = target.endSeconds - target.startSeconds;
  const samples = Array.from({ length: Math.ceil(duration * 30) }, (_, i) => {
    const time = Math.min(target.endSeconds, target.startSeconds + (i + 1) / 30), pose = base();
    pose.joints.LeftForeArm = rotationFromDegrees([-20 * Math.sin(Math.PI * (time - target.startSeconds) / duration) ** 2, 0, 0]);
    return { time, pose };
  }).filter(sample => mode === 'full' || sample.time < target.endSeconds);
  return { request, base, origin, samples, result: makeAIMotionResultFixture(request) };
}

describe('local dense motion curves and saved provenance', () => {
  it('retains dense detail, exact outside/both endpoints and zero source mutation', () => {
    const { request, base, origin, samples, result } = setup();
    const before = JSON.stringify({ request, origin, samples });
    const patch = compileAIMotionPosePatch(request, result, samples, base, origin);
    expect(patch.knots.length).toBeGreaterThan(50);
    const track = { schema: 'ai-motion-track-1' as const, countMapId: request.context.timing.id,
      durationSeconds: 32, patches: [patch] };
    expect(validateAIMotionTrack(JSON.parse(JSON.stringify(track)), request.context.timing, base)).toEqual(track);
    const sampler = createAIMotionSampler(base, track);
    for (const time of [0, 3.71, 4, 8, 8.091, 32]) expect(sampler(time)).toEqual(base());
    expect(sampler(6)).not.toEqual(base());
    expect(patch.knots[0].angularVelocity).toEqual(request.context.boundaries.start.angularVelocity);
    expect(patch.knots.at(-1)!.angularVelocity).toEqual(request.context.boundaries.end.angularVelocity);
    expect(JSON.stringify({ request, origin, samples })).toBe(before);
  });

  it('retains full final hold and copies its actual source plan independently', () => {
    const { request, base, origin, samples, result } = setup('full');
    const patch = compileAIMotionPosePatch(request, result, samples, base, origin);
    expect(patch.knots.at(-1)!.time).toBe(32);
    expect(patch.knots.at(-1)!.linearVelocity).toEqual([0, 0, 0]);
    expect(Object.values(patch.knots.at(-1)!.angularVelocity).flat().every(value => value === 0)).toBe(true);
    origin.sources[0].sourceHash = 'd'.repeat(64);
    expect(patch.motionOrigin!.sources[0].sourceHash).toBe('c'.repeat(64));
  });

  it('requires real provenance for dense curves while leaving sparse legacy limits strict', () => {
    const { request, base, origin, samples, result } = setup();
    const patch = compileAIMotionPosePatch(request, result, samples, base, origin);
    delete patch.motionOrigin;
    expect(() => validateAIMotionTrack({ schema: 'ai-motion-track-1', countMapId: request.context.timing.id,
      durationSeconds: 32, patches: [patch] }, request.context.timing)).toThrow('关键姿态数量');
  });

  it('rejects source changes, out-of-range samples, exceeded budgets and corrupt plans', () => {
    const { request, base, origin, samples, result } = setup();
    const changed = () => { const pose = base(); pose.root[0] = .01; return pose; };
    expect(() => compileAIMotionPosePatch(request, result, samples, changed, origin)).toThrow('原稿边界');
    expect(() => compileAIMotionPosePatch(request, result, [{ time: 4, pose: base() }, ...samples], base, origin)).toThrow('可写区间');
    expect(() => compileAIMotionPosePatch(request, result, Array(MAX_AI_MOTION_POSE_SAMPLES + 1).fill(samples[0]), base, origin)).toThrow('采样数量');
    const bad = structuredClone(origin); bad.segments[0].endSeconds = 9;
    expect(() => compileAIMotionPosePatch(request, result, samples, base, bad)).toThrow('编排时间');
    const badMetrics = structuredClone(origin); badMetrics.adaptationMetrics!.rmsHandDisplacementMeters = .5;
    expect(() => compileAIMotionPosePatch(request, result, samples, base, badMetrics)).toThrow('适配记录');
    const badSole = structuredClone(origin); badSole.adaptationMetrics!.maxSoleOrientationChangeRadians = -1;
    expect(() => compileAIMotionPosePatch(request, result, samples, base, badSole)).toThrow('适配记录');
  });
});
