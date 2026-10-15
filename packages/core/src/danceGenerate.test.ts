import { describe, expect, it } from 'vitest';
import { makeDanceRequest } from './dance.fixture';
import { generateDanceCandidate } from './danceGenerate';
import { createAIMotionSampler, validateAIMotionTrack } from './aiMotionTrack';
import { DANCE_PLAN_PROTOCOL, DANCE_STEPS, LOCAL_DANCE_PLANNER, danceRandom, localDancePlan, type DancePlan, type DancePose } from './dancePlan';
import { evaluatePose } from './humanoid';
import { getMotionMinimumFloorHeight } from './motionFeasibility';
import { synthesizeDance } from './danceSynth';
import type { Pose } from './motion-types';

const local = (plan: DancePlan) => ({ protocol: DANCE_PLAN_PROTOCOL, source: 'local' as const, model: LOCAL_DANCE_PLANNER, plan });
const exact = (a: Pose, b: Pose) => JSON.stringify(a) === JSON.stringify(b);
/** A "creative model": uniformly random poses anywhere on the legal scales. */
function wildPlan(seed: number): DancePlan {
  const random = danceRandom(seed), r = (low: number, high: number) => Math.round(low + random() * (high - low));
  return { summary: 'random', style: 'freestyle', energy: 'high', order: [0, 1, 0, 1].map((phrase, index) => ({ phrase, mirror: index > 1 })),
    phrases: [0, 1].map(() => ({ poses: Array.from({ length: 8 }, (): DancePose => ({ arms: [r(0, 10), r(-2, 10), r(0, 10), r(0, 10), r(-2, 10), r(0, 10)],
      torso: [r(-5, 5), r(-5, 5), r(-5, 5)], head: [r(-5, 5), r(-5, 5)], hips: [r(-5, 5), r(0, 10)], step: DANCE_STEPS[r(0, DANCE_STEPS.length - 1)] })) })) };
}

describe('keypose dance generation (real feasibility gate)', () => {
  it('turns invented keyposes into motion that passes the gate, for every style and tempo', async () => {
    const cases: [string, number][] = [['energetic hip-hop', 96], ['gentle lyrical', 70], ['latin salsa', 140], ['k-pop', 180], ['jazz with turns', 120]];
    for (const [index, [prompt, bpm]] of cases.entries()) {
      const { request, sampler } = makeDanceRequest({ bpm, duration: 16 });
      const result = await generateDanceCandidate({ request, plan: local(localDancePlan(prompt, 32, index + 1)), sourceSampler: sampler });
      expect(result.report.status, prompt).toBe('accepted');
      expect(result.report.totalViolations).toBe(0);
      expect(result.report.coverage.complete && result.report.derivativeCoverage.complete).toBe(true);
    }
  }, 300_000);
  it('accepts arbitrary poses from a creative model (amplitude may be reduced, never refused)', async () => {
    for (const seed of [1, 2, 3]) {
      const { request, sampler } = makeDanceRequest({ bpm: 110, duration: 16 });
      const result = await generateDanceCandidate({ request, plan: local(wildPlan(seed)), sourceSampler: sampler });
      expect(result.report.status).toBe('accepted');
      expect(result.intensity).toBeGreaterThan(.1);
    }
  }, 300_000);
  it('generates a different dance for each new composition', () => {
    const { request } = makeDanceRequest({ bpm: 120, duration: 16 });
    const poses = [7, 8].map(seed => synthesizeDance({ target: request.context.target, start: request.context.boundaries.start, end: request.context.boundaries.end, beatSeconds: .5, intensity: 1,
      plan: localDancePlan('pop', 32, seed) }).samples.find(sample => sample.time > 6)!.pose);
    expect(exact(poses[0], poses[1])).toBe(false);
  });
  it('keeps planted feet on the floor without sliding and reaches them by IK', () => {
    const { request } = makeDanceRequest({ bpm: 100, duration: 16 });
    const { samples } = synthesizeDance({ target: request.context.target, start: request.context.boundaries.start, end: request.context.boundaries.end, beatSeconds: .6, intensity: 1, plan: localDancePlan('latin footwork steps', 32, 4) });
    let planted = 0;
    for (let index = 1; index < samples.length; index++) {
      const a = evaluatePose(samples[index - 1].pose), b = evaluatePose(samples[index].pose);
      expect(getMotionMinimumFloorHeight(samples[index].pose)).toBeGreaterThan(-.003);
      for (const foot of ['LeftFoot', 'RightFoot'] as const) {
        if (a[foot].position[1] > .093 || b[foot].position[1] > .093 || samples[index].time < 1.5) continue;
        planted++;
        expect(Math.hypot(a[foot].position[0] - b[foot].position[0], a[foot].position[2] - b[foot].position[2])).toBeLessThan(.004);
      }
    }
    expect(planted).toBeGreaterThan(300);
  });
  it('regenerates short off-beat ranges inside a moving dance with exact seams and untouched outside', async () => {
    const base = makeDanceRequest({ bpm: 110, duration: 20 });
    const first = await generateDanceCandidate({ request: base.request, plan: local(localDancePlan('pop side steps and turns', 36, 11)), sourceSampler: base.sampler });
    const track = { schema: 'ai-motion-track-1' as const, countMapId: base.request.context.timing.id, durationSeconds: base.request.context.timing.durationSeconds, patches: [first.patch] };
    const sampler = createAIMotionSampler(base.sampler, track);
    for (const [start, end] of [[5.31, 8.93], [12.1, 13.0], [3.2, 3.85]]) {
      const { request } = makeDanceRequest({ bpm: 110, duration: 20, mode: 'interval', start, end, sampler });
      const result = await generateDanceCandidate({ request, plan: local(localDancePlan('hip-hop punches', 8, start * 100)), sourceSampler: sampler });
      expect(result.report.status).toBe('accepted');
      const combined = createAIMotionSampler(sampler, validateAIMotionTrack({ ...track, patches: [first.patch, result.patch] }, { id: track.countMapId, durationSeconds: track.durationSeconds }));
      for (const at of [0, start - .5, start, end, end + .5, 19]) expect(exact(combined(at), sampler(at)), String(at)).toBe(true);
      expect(exact(combined((start + end) / 2), sampler((start + end) / 2))).toBe(false);
    }
  }, 300_000);
  it('connects to fixed boundaries that are outside the envelope instead of refusing the range', async () => {
    const weird = (): Pose => {
      const { request } = makeDanceRequest(); const pose = structuredClone(request.context.initialPose);
      pose.joints.LeftUpperArm = [0, 0, Math.sin(Math.PI * 170 / 360), Math.cos(Math.PI * 170 / 360)];
      pose.root = [.4, .7, -.3]; // straight legs through the floor
      return pose;
    };
    const { request, sampler } = makeDanceRequest({ mode: 'interval', start: 4, end: 10, sampler: () => weird() });
    const result = await generateDanceCandidate({ request, plan: local(localDancePlan('jazz', 12, 5)), sourceSampler: sampler });
    expect(result.report.status).toBe('accepted');
    expect(result.report.inheritedBoundaryIssues).toBeGreaterThan(0);
    expect(result.report.warnings.join()).toContain('fixed endpoint');
  }, 120_000);
  it('stops when cancelled', async () => {
    const { request, sampler } = makeDanceRequest();
    const controller = new AbortController(); controller.abort();
    await expect(generateDanceCandidate({ request, plan: local(localDancePlan('pop', 32, 1)), sourceSampler: sampler, signal: controller.signal })).rejects.toThrow('cancelled');
  });
});
