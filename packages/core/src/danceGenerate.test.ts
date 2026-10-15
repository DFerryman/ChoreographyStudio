import { describe, expect, it } from 'vitest';
import { makeDanceRequest } from './dance.fixture';
import { DanceGenerationError, generateDanceCandidate } from './danceGenerate';
import { createAIMotionSampler, validateAIMotionTrack } from './aiMotionTrack';
import { DANCE_MOVE_IDS, DANCE_PLAN_PROTOCOL, LOCAL_DANCE_PLANNER, localDancePlan, type DanceMoveId } from './dancePlan';
import { evaluatePose } from './humanoid';
import { getMotionMinimumFloorHeight } from './motionFeasibility';
import { synthesizeDance } from './danceSynth';
import type { Pose } from './motion-types';

const local = (prompt: string, beats = 32) => ({ protocol: DANCE_PLAN_PROTOCOL, source: 'local' as const, model: LOCAL_DANCE_PLANNER, plan: localDancePlan(prompt, beats) });
const only = (move: DanceMoveId) => ({ protocol: DANCE_PLAN_PROTOCOL, source: 'local' as const, model: LOCAL_DANCE_PLANNER,
  plan: { summary: move, style: 'pop' as const, energy: 'high' as const, moves: [{ move, beats: 4 as const, mirror: false }, { move, beats: 4 as const, mirror: true }] } });
const exact = (a: Pose, b: Pose) => JSON.stringify(a) === JSON.stringify(b);

describe('constraint-first dance generation (real feasibility gate)', () => {
  it('passes the gate at full intensity for every move in the vocabulary', async () => {
    for (const move of DANCE_MOVE_IDS) {
      const { request, sampler } = makeDanceRequest({ bpm: 120, duration: 16 });
      const result = await generateDanceCandidate({ request, plan: only(move), sourceSampler: sampler, levels: [1] });
      expect(result.report.status, move).toBe('accepted');
      expect(result.report.totalViolations).toBe(0);
      expect(result.report.coverage.complete && result.report.derivativeCoverage.complete).toBe(true);
    }
  }, 300_000);
  it('keeps planted feet on the floor without sliding and reaches them by IK', () => {
    const { request } = makeDanceRequest({ bpm: 100, duration: 16 });
    const { samples } = synthesizeDance({ target: request.context.target, start: request.context.boundaries.start, end: request.context.boundaries.end, beatSeconds: .6, intensity: 1, plan: only('step-touch').plan });
    let planted = 0;
    for (let index = 1; index < samples.length; index++) {
      const a = evaluatePose(samples[index - 1].pose), b = evaluatePose(samples[index].pose);
      expect(getMotionMinimumFloorHeight(samples[index].pose)).toBeGreaterThan(-.003);
      for (const foot of ['LeftFoot', 'RightFoot'] as const) {
        if (a[foot].position[1] > .09 || b[foot].position[1] > .09 || samples[index].time < 1.2) continue;
        planted++;
        expect(Math.hypot(a[foot].position[0] - b[foot].position[0], a[foot].position[2] - b[foot].position[2])).toBeLessThan(.004);
      }
    }
    expect(planted).toBeGreaterThan(300);
  });
  it('regenerates a short off-beat range inside a moving dance with exact seams and untouched outside', async () => {
    const base = makeDanceRequest({ bpm: 110, duration: 20 });
    const first = await generateDanceCandidate({ request: base.request, plan: local('流行 侧步 转身', 36), sourceSampler: base.sampler });
    const track = { schema: 'ai-motion-track-1' as const, countMapId: base.request.context.timing.id, durationSeconds: base.request.context.timing.durationSeconds, patches: [first.patch] };
    const sampler = createAIMotionSampler(base.sampler, track);
    for (const [start, end] of [[5.31, 8.93], [12.1, 13.0], [3.2, 3.85]]) {
      const { request } = makeDanceRequest({ bpm: 110, duration: 20, mode: 'interval', start, end, sampler });
      const result = await generateDanceCandidate({ request, plan: local('街舞 出拳', 8), sourceSampler: sampler });
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
    const result = await generateDanceCandidate({ request, plan: local('爵士'), sourceSampler: sampler });
    expect(result.report.status).toBe('accepted');
    expect(result.report.inheritedBoundaryIssues).toBeGreaterThan(0);
    expect(result.report.warnings.join()).toContain('固定端点');
  }, 120_000);
  it('reports the attempts when cancelled', async () => {
    const { request, sampler } = makeDanceRequest();
    const controller = new AbortController(); controller.abort();
    await expect(generateDanceCandidate({ request, plan: local('流行'), sourceSampler: sampler, signal: controller.signal })).rejects.toThrow('取消');
    void DanceGenerationError;
  });
});
