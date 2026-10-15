/**
 * Candidate generation pipeline (plan → synthesize → compile → gate).
 *
 * A candidate is offered only when the independent feasibility gate accepts
 * the exact compiled curve. If it does not, the same plan is re-synthesized at
 * a lower intensity (smaller steps, smaller amplitudes, slower transfers) and
 * checked again. If the plan's footwork (turns, travelling) is what cannot be
 * fitted between the fixed ends, the last attempts keep the same keyposes but
 * dance them in place (only the steps needed to reach the end stance remain),
 * so generation does not dead-end on a strict reject.
 */
import type { AIMotionRequest } from './aiMotion';
import { compileAIMotionPosePatch, type AIMotionPatch, type AIMotionPoseSampler, type DanceSynthesisOrigin } from './aiMotionTrack';
import { DANCE_PLAN_MODEL, LOCAL_DANCE_PLANNER, danceBeatSeconds, type DancePlanResult } from './dancePlan';
import { DANCE_SYNTH_VERSION, synthesizeDance, type DanceSegment } from './danceSynth';
import { loadRapierBackend } from './rapierBackend';
import { CANONICAL_MOTION_FEASIBILITY_PROFILE, solveAIMotionFeasibility, type MotionFeasibilityReport, type MotionFeasibilityViolation } from './motionFeasibility';

export const DANCE_INTENSITY_LEVELS = [1, .65, .35, .15] as const;
/** Footwork-free retries after the intensity levels: same poses, danced in place. */
export const DANCE_IN_PLACE_LEVELS = [.65, .25] as const;
export interface DanceAttempt { intensity: number; footwork: 'plan' | 'in-place'; status: MotionFeasibilityReport['status']; totalViolations: number; firstViolation?: Pick<MotionFeasibilityViolation, 'code' | 'startSeconds' | 'message' | 'joint' | 'segments' | 'measured' | 'limit'> }
export interface DanceCandidate {
  patch: AIMotionPatch;
  report: MotionFeasibilityReport;
  intensity: number;
  footwork: DanceAttempt['footwork'];
  attempts: DanceAttempt[];
  segments: DanceSegment[];
  steps: number;
}
export interface GenerateDanceOptions {
  request: AIMotionRequest;
  plan: DancePlanResult;
  sourceSampler: AIMotionPoseSampler;
  signal?: AbortSignal;
  onAttempt?: (attempt: DanceAttempt, index: number) => void;
  levels?: readonly number[];
  inPlaceLevels?: readonly number[];
}
export class DanceGenerationError extends Error {
  readonly attempts: DanceAttempt[];
  constructor(message: string, attempts: DanceAttempt[]) { super(message); this.name = 'DanceGenerationError'; this.attempts = attempts; }
}

const cancelled = (signal?: AbortSignal) => { if (signal?.aborted) throw new DOMException('Generation cancelled.', 'AbortError'); };

export async function generateDanceCandidate(options: GenerateDanceOptions): Promise<DanceCandidate> {
  const { request, plan, sourceSampler, signal } = options;
  const { target, timing, boundaries, requestId, sourceHash } = request.context;
  const beatSeconds = danceBeatSeconds(timing);
  const provider = plan.source === 'ai' ? 'cloudflare-workers-ai' as const : 'local' as const;
  const model = plan.source === 'ai' ? DANCE_PLAN_MODEL : LOCAL_DANCE_PLANNER;
  const attempts: DanceAttempt[] = [];
  let last: MotionFeasibilityReport | undefined;
  // The synthesizer uses the same collision backend for its seam contact repair.
  await loadRapierBackend();
  const inPlace = { ...plan.plan, phrases: plan.plan.phrases.map(phrase => ({ poses: phrase.poses.map(pose => ({ ...pose, step: 'none' as const })) })) };
  const schedule = [...(options.levels ?? DANCE_INTENSITY_LEVELS).map(intensity => ({ intensity, footwork: 'plan' as const })),
    ...(options.inPlaceLevels ?? DANCE_IN_PLACE_LEVELS).map(intensity => ({ intensity, footwork: 'in-place' as const }))];
  for (const { intensity, footwork } of schedule) {
    cancelled(signal);
    const synthesized = synthesizeDance({ target, start: boundaries.start, end: boundaries.end, beatSeconds, plan: footwork === 'plan' ? plan.plan : inPlace, intensity });
    const origin: DanceSynthesisOrigin = { kind: 'dance-synthesis', generator: DANCE_SYNTH_VERSION, planSource: plan.source,
      style: plan.plan.style, energy: plan.plan.energy, intensity,
      moves: synthesized.segments.slice(0, 200).map(segment => ({ move: segment.move, startSeconds: segment.startSeconds, endSeconds: segment.endSeconds, mirror: segment.mirror })) };
    const patch = compileAIMotionPosePatch(request, { provider, model, requestId, sourceHash, target }, synthesized.samples, sourceSampler, origin);
    // Yield so the page stays responsive between the synthesis and the gate.
    await new Promise(resolve => setTimeout(resolve, 0));
    cancelled(signal);
    const solved = await solveAIMotionFeasibility(patch, { sourceSampler, durationSeconds: timing.durationSeconds, profile: CANONICAL_MOTION_FEASIBILITY_PROFILE,
      signal, contacts: [], correct: false, failFast: true, inheritBoundaryIssues: { windowSeconds: Math.max(synthesized.blendSeconds.start, synthesized.blendSeconds.end) + .05 } });
    cancelled(signal);
    const report = solved.report, first = report.violations[0];
    const attempt: DanceAttempt = { intensity, footwork, status: report.status, totalViolations: report.totalViolations,
      ...(first ? { firstViolation: { code: first.code, startSeconds: first.startSeconds, message: first.message, ...(first.joint ? { joint: first.joint } : {}), ...(first.segments ? { segments: first.segments } : {}), ...(first.measured !== undefined ? { measured: first.measured, limit: first.limit } : {}) } } : {}) };
    attempts.push(attempt); options.onAttempt?.(attempt, attempts.length - 1);
    last = report;
    if (report.status === 'cancelled') cancelled({ aborted: true } as AbortSignal);
    if (solved.patch && report.status === 'accepted' && report.coverage.complete && report.derivativeCoverage.complete && report.totalViolations === 0) {
      return { patch: solved.patch, report, intensity, footwork, attempts, segments: synthesized.segments, steps: synthesized.steps };
    }
  }
  const first = last?.violations[0];
  throw new DanceGenerationError(`The candidate did not pass the motion constraint check${first ? ` (${Number(first.startSeconds.toFixed(2))} s: ${first.code})` : ''}. The original motion is unchanged.`, attempts);
}
