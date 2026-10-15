import type { MotionPriorCompositionOrigin } from './motionPriors';
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { makeAIMotionFixture } from './aiMotion.fixture';
import { makeAIMotionPlanRequest, motionPlanSources, type AIMotionPlanResult } from './aiMotionPlan';
import { AI_MOTION_MODEL } from './aiMotion';
import { compileAIMotionPosePatch, createAIMotionSampler, estimateAIMotionBoundary, recomputeAIMotionPatchTangents, type AIMotionPatch } from './aiMotionTrack';
import { getBodyCollisionContacts, getCapsuleCollisions } from './capsuleCollision';
import { clonePose, evaluatePose } from './humanoid';
import { rotationFromDegrees } from './keyframes';
import { JOINT_NAMES, type JointName, type Pose, type Vec3 } from './motion-types';
import { loadRapierBackend } from './rapierBackend';
import { composeMotionPriorPlan, composeMotionPriorPlanAsync, decodeMotionPrior, MOTION_PRIOR_CATALOG, MOTION_PRIOR_ARM_ADAPTATION_VERSION, MOTION_PRIOR_ARM_TRAJECTORY_VERSION, MOTION_PRIOR_HEAD_TRAJECTORY_VERSION, MOTION_PRIOR_HOLD_ADAPTATION_VERSION, MOTION_PRIOR_KNEE_TRAJECTORY_VERSION, MOTION_PRIOR_NECK_TRAJECTORY_VERSION, MOTION_PRIOR_SHIN_TRAJECTORY_VERSION, MOTION_PRIOR_SPINE_TRAJECTORY_VERSION, MOTION_PRIOR_STANCE_ADAPTATION_VERSION, MOTION_PRIOR_UPPER_LEG_TRAJECTORY_VERSION } from './motionPriors';
import { conditionMotionGroundingCurve, conditionMotionLegContacts } from './motionGrounding';
import { CANONICAL_MOTION_FEASIBILITY_PROFILE, getMotionFeasibilitySampleTimes, getMotionFootMinimumFloorHeight, getMotionMinimumFloorHeight, inferMotionSupportGeometry, isFunctionalJointWithinLimits, measureFunctionalJoint, solveAIMotionFeasibility, type MotionContactHint } from './motionFeasibility';

const neutral = (height = 1.05): Pose => ({ root: [0, height, 0], joints: Object.fromEntries(JOINT_NAMES.map(joint => [joint, joint === 'LeftUpperArm' ? rotationFromDegrees([0, 0, 15]) : joint === 'RightUpperArm' ? rotationFromDegrees([0, 0, -15]) : [0, 0, 0, 1]])) as Pose['joints'] });
const zeros = () => Object.fromEntries(JOINT_NAMES.map(joint => [joint, [0, 0, 0]])) as Record<JointName, Vec3>;
function patchFor(poses: Pose[], duration = 2, mode: 'full' | 'interval' = 'full'): AIMotionPatch {
  return { id: 'feasibility-test', provider: 'cloudflare-workers-ai', model: AI_MOTION_MODEL, requestId: 'feasibility-request', sourceHash: 'a'.repeat(64), target: { mode, startSeconds: mode === 'full' ? 0 : 1, endSeconds: mode === 'full' ? duration : 1 + duration }, knots: poses.map((pose, index) => ({ time: (mode === 'full' ? 0 : 1) + duration * index / (poses.length - 1), pose, linearVelocity: [0, 0, 0], angularVelocity: zeros() })) };
}
const optionsFor = (patch: AIMotionPatch, source = neutral()) => ({ sourceSampler: () => source, durationSeconds: patch.target.mode === 'full' ? patch.target.endSeconds : patch.target.endSeconds + 1 });
const codes = (result: Awaited<ReturnType<typeof solveAIMotionFeasibility>>) => result.report.violations.map(violation => violation.code);
// Compact public CMU-derived v4 curve sample at3.425s. Independent Quaternius
// skinning found a pure rigid toe vertex22.32195027mm below the floor, beyond
// the shortened legacy sole. No private scene or ignored test file is read.
function nativeToeRegressionPose(): Pose {
  const pose = neutral();
  pose.root = [-.015076188685033123, 1.0280235555128743, .15771091780693985];
  Object.assign(pose.joints, {
    Hips: [-.00022747522441921098, -.06581125343759978, -.026548379607932902, .9974788272019548],
    LeftUpperLeg: [-.03902566784456003, -.018991935637192477, .026566854932096658, .998704413652536],
    RightUpperLeg: [-.17374210757780723, -.002095786141733125, .002535021951426246, .9847856931325595],
    LeftLowerLeg: [.3715647496256995, .002445626547119249, .0009788420297135022, .9284033054737926],
    RightLowerLeg: [.2965475131896887, -.001419580280618679, -.00044039501664502374, .9550169439675233],
    LeftFoot: [-.02007733951380747, .04591162730210875, -.025121455768500348, .9984277316744516],
    RightFoot: [-.048240764154988736, -.04066261756962767, .05133071261561373, .9966867803620666],
  });
  return pose;
}

describe('functional generation profile', () => {
  it('allows forearm pronation without sideways or reversed elbow flexion', () => {
    for (const joint of ['LeftForeArm', 'RightForeArm'] as const) for (const pronation of [-80, 80]) {
      const rotation = rotationFromDegrees([-90, pronation, 0]);
      expect(isFunctionalJointWithinLimits(joint, rotation)).toBe(true);
      expect(measureFunctionalJoint(joint, rotation).flexionDegrees).toBeCloseTo(90, 8);
      expect(measureFunctionalJoint(joint, rotation).lateralDegrees).toBeCloseTo(0, 8);
      expect(measureFunctionalJoint(joint, rotation).twistDegrees).toBeCloseTo(pronation, 8);
    }
    expect(isFunctionalJointWithinLimits('LeftForeArm', rotationFromDegrees([80, 0, 0]))).toBe(false);
    expect(isFunctionalJointWithinLimits('RightForeArm', rotationFromDegrees([-90, 0, 40]))).toBe(false);
    expect(isFunctionalJointWithinLimits('LeftLowerLeg', rotationFromDegrees([100, 0, 0]))).toBe(true);
    expect(isFunctionalJointWithinLimits('RightLowerLeg', rotationFromDegrees([-70, 0, 0]))).toBe(false);
    expect(isFunctionalJointWithinLimits('LeftUpperArm', rotationFromDegrees([100, 0, 0]))).toBe(false);
    expect(isFunctionalJointWithinLimits('RightUpperArm', rotationFromDegrees([-120, 0, 0]))).toBe(true);
    expect(isFunctionalJointWithinLimits('LeftHand', rotationFromDegrees([0, 0, 80]))).toBe(false);
    expect(isFunctionalJointWithinLimits('RightHand', rotationFromDegrees([0, 30, 0]))).toBe(false);
    expect(isFunctionalJointWithinLimits('LeftHand', rotationFromDegrees([-60, 0, 0]))).toBe(true);
    expect(isFunctionalJointWithinLimits('RightHand', rotationFromDegrees([0, 0, -25]))).toBe(true);
    expect(isFunctionalJointWithinLimits('LeftFoot', rotationFromDegrees([0, 0, 60]))).toBe(false);
    expect(isFunctionalJointWithinLimits('RightFoot', rotationFromDegrees([-55, 0, 0]))).toBe(false);
    expect(isFunctionalJointWithinLimits('RightFoot', rotationFromDegrees([63, 0, 0]))).toBe(false);
    expect(isFunctionalJointWithinLimits('LeftFoot', rotationFromDegrees([45, 0, 0]))).toBe(true);
    expect(isFunctionalJointWithinLimits('RightFoot', rotationFromDegrees([-30, 0, 0]))).toBe(true);
  });
  it('rejects arbitrary terminal marker rotations and combined excessive swing/twist', () => {
    expect(isFunctionalJointWithinLimits('LeftHandTip', rotationFromDegrees([15, 0, 0]))).toBe(false);
    expect(isFunctionalJointWithinLimits('Spine', rotationFromDegrees([50, 80, 0]))).toBe(false);
    const q = rotationFromDegrees([-70, 75, 0]);
    expect(measureFunctionalJoint('LeftForeArm', q)).toEqual(measureFunctionalJoint('LeftForeArm', q.map(value => -value) as typeof q));
  });
});

describe('offline candidate feasibility', () => {
  it('detects original rigid toe hull penetration that the unchanged legacy sole misses', async () => {
    await loadRapierBackend();
    const toe = nativeToeRegressionPose(), original = JSON.stringify(toe), profile = JSON.stringify(CANONICAL_MOTION_FEASIBILITY_PROFILE.bodyProfile);
    for (const joint of JOINT_NAMES) expect(isFunctionalJointWithinLimits(joint, toe.joints[joint])).toBe(true);
    expect(getCapsuleCollisions(toe).floorPenetrations).toEqual([]);
    expect(getBodyCollisionContacts(toe).floorDepthMeters).toBeCloseTo(.00164245702, 8);
    expect(getMotionMinimumFloorHeight(toe)).toBeCloseTo(-.02232195042, 8);
    expect(getMotionFootMinimumFloorHeight(toe, 'LeftFoot')).toBe(getMotionMinimumFloorHeight(toe));
    expect(getMotionFootMinimumFloorHeight(toe, 'RightFoot')).toBeGreaterThan(getMotionFootMinimumFloorHeight(toe, 'LeftFoot'));
    const patch = patchFor([neutral(), toe, neutral()]), before = JSON.stringify(patch);
    const rejected = await solveAIMotionFeasibility(patch, { ...optionsFor(patch), correct: false });
    expect(rejected.report.status).toBe('rejected'); expect(rejected.patch).toBeUndefined();
    expect(rejected.report.violations.some(issue => issue.code === 'floor-penetration' && issue.segments?.some(segment => segment.endsWith('-foot')) && issue.measured! > .022)).toBe(true);
    expect(JSON.stringify(toe)).toBe(original); expect(JSON.stringify(patch)).toBe(before);
    expect(JSON.stringify(CANONICAL_MOTION_FEASIBILITY_PROFILE.bodyProfile)).toBe(profile);
  });
  it('retains genuine native toe support after floor clearance without changing the neutral or legacy sole', async () => {
    await loadRapierBackend();
    const toe = nativeToeRegressionPose(); toe.root[1] += .03;
    const original = JSON.stringify(toe);
    // Every old primitive/sole corner is over25mm high, but the actual toe
    // remains7.678mm above the floor and must still enter the contact polygon.
    expect(getBodyCollisionContacts(toe).floorDepthMeters).toBeLessThan(-.025);
    expect(getMotionMinimumFloorHeight(toe)).toBeCloseTo(.00767804958, 8);
    expect(getMotionFootMinimumFloorHeight(toe, 'LeftFoot')).toBe(getMotionMinimumFloorHeight(toe));
    const support = inferMotionSupportGeometry(toe);
    expect(support.effectors.has('LeftFoot')).toBe(true);
    expect(Math.min(...support.points.map(point => point[1]))).toBeCloseTo(.00767804958, 8);
    expect(support.points.every(point => point[1] >= -.00300002 && point[1] <= .025)).toBe(true);
    const source = neutral(); expect(getMotionMinimumFloorHeight(source)).toBeGreaterThan(.006);
    const held = patchFor([source, neutral(), neutral()]);
    const accepted = await solveAIMotionFeasibility(held, { ...optionsFor(held, source), correct: false });
    expect(accepted.report.status).toBe('accepted'); expect(accepted.report.totalViolations).toBe(0);
    expect(accepted.patch!.knots[0]).toEqual(held.knots[0]); expect(JSON.stringify(toe)).toBe(original);
  });
  it('keeps actual standing Salsa and basic Street ankle poses within directional engineering limits', () => {
    for (const [id, endSeconds] of [['cmu-61-08', 16], ['cmu-85-12-a', 3]] as const) {
      const entry = MOTION_PRIOR_CATALOG.clips.find(clip => clip.id === id)!;
      const bytes = readFileSync(new URL(`../../../apps/web/public/motion-priors/${id}.motion`, import.meta.url));
      const clip = decodeMotionPrior(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), entry);
      for (let index = 0; index < clip.poses.length && clip.times[index] <= endSeconds; index++) for (const foot of ['LeftFoot', 'RightFoot'] as const) expect(isFunctionalJointWithinLimits(foot, clip.poses[index].joints[foot])).toBe(true);
    }
  });
  it('accepts an actual CMU street prior through planning, dense composition and whole interpolated gate', async () => {
    const motion = makeAIMotionFixture('interval'), source = neutral();
    motion.context.initialPose = source;
    motion.context.boundaries = { start: estimateAIMotionBoundary(() => source, 4, 'before', 32), end: estimateAIMotionBoundary(() => source, 8, 'after', 32) };
    motion.context.before = [{ time: 3, pose: source }]; motion.context.after = [{ time: 9, pose: source }];
    const request = makeAIMotionPlanRequest(motion, MOTION_PRIOR_CATALOG), entry = MOTION_PRIOR_CATALOG.clips.find(clip => clip.id === 'cmu-85-12-a')!;
    const bytes = readFileSync(new URL('../../../apps/web/public/motion-priors/cmu-85-12-a.motion', import.meta.url));
    const clip = decodeMotionPrior(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), entry);
    const output = { summary: '真人街舞站立步法', intentMatch: 'supported' as const, limitations: [], segments: [{ clipId: entry.id, startSeconds: 4, endSeconds: 8, sourceStartSeconds: 0, sourceEndSeconds: 3, yawDegrees: 0, travelXZ: [0, 0] as [number, number], transitionSeconds: .5, contactHint: 'standing' as const }] };
    const result: AIMotionPlanResult = { ...output, protocol: 'ai-motion-plan-1', provider: 'cloudflare-workers-ai', model: AI_MOTION_MODEL, requestId: motion.context.requestId, sourceHash: motion.context.sourceHash, target: motion.context.target, catalogVersion: request.catalog.version, sources: motionPlanSources(output, request.catalog) };
    const composition = composeMotionPriorPlan(request, result, new Map([[entry.id, clip]]), () => source);
    const patch = compileAIMotionPosePatch(motion, result, composition.samples, () => source, composition.origin);
    const priorHash = JSON.stringify(clip), inputHash = JSON.stringify(patch);
    const solved = await solveAIMotionFeasibility(patch, { sourceSampler: () => source, durationSeconds: 32, contacts: [{ startSeconds: 4, endSeconds: 8, mode: 'supported' }] });
    expect(solved.report.violations).toEqual([]);
    expect(solved.report.status).toBe('accepted'); expect(solved.report.coverage.complete).toBe(true);
    expect((solved.patch!.motionOrigin as MotionPriorCompositionOrigin | undefined)?.sources[0]).toEqual({ clipId: entry.id, sourceHash: entry.sourceHash });
    expect(solved.patch!.knots.length).toBeGreaterThan(48); expect(JSON.stringify(patch)).toBe(inputHash); expect(JSON.stringify(clip)).toBe(priorHash);
  }, 30000);
  it('reports the full actual Salsa prior without changing source data or relaxing the gate', async () => {
    const motion = makeAIMotionFixture('full'), source = neutral();
    motion.context.target.endSeconds = 16;
    Object.assign(motion.context.timing, { durationSeconds: 16, octetCount: 4, countTimesSeconds: Array.from({ length: 33 }, (_, index) => index / 2) });
    motion.context.initialPose = source;
    motion.context.boundaries = { start: estimateAIMotionBoundary(() => source, 0, 'before', 16), end: estimateAIMotionBoundary(() => source, 16, 'after', 16) };
    motion.context.audio[0].coverage = { startSeconds: 0, endSeconds: 16 };
    const request = makeAIMotionPlanRequest(motion, MOTION_PRIOR_CATALOG), entry = MOTION_PRIOR_CATALOG.clips.find(clip => clip.id === 'cmu-61-08')!;
    const bytes = readFileSync(new URL('../../../apps/web/public/motion-priors/cmu-61-08.motion', import.meta.url));
    const clip = decodeMotionPrior(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), entry);
    const output = { summary: '真人 Salsa 连续步法', intentMatch: 'supported' as const, limitations: [], segments: [{ clipId: entry.id, startSeconds: 0, endSeconds: 16, sourceStartSeconds: 0, sourceEndSeconds: 16, yawDegrees: 0, travelXZ: [0, 0] as [number, number], transitionSeconds: .5, contactHint: 'standing' as const }] };
    const result: AIMotionPlanResult = { ...output, protocol: 'ai-motion-plan-1', provider: 'cloudflare-workers-ai', model: AI_MOTION_MODEL, requestId: motion.context.requestId, sourceHash: motion.context.sourceHash, target: motion.context.target, catalogVersion: request.catalog.version, sources: motionPlanSources(output, request.catalog) };
    const composition = composeMotionPriorPlan(request, result, new Map([[entry.id, clip]]), () => source);
    // A raw capture retarget is not a physical certificate. Deliberately bypass
    // the avatar-adaptation stage here to retain this actual negative baseline.
    const rawSamples = clip.times.map((time, index) => ({ time, pose: clip.poses[index] })).filter(sample => sample.time > 0 && sample.time <= 16);
    const patch = compileAIMotionPosePatch(motion, result, rawSamples, () => source, composition.origin);
    const solved = await solveAIMotionFeasibility(patch, { sourceSampler: () => source, durationSeconds: 16, correct: false, contacts: [{ startSeconds: 0, endSeconds: 16, mode: 'supported' }] });
    expect(solved.report.coverage.complete).toBe(true);
    expect(solved.report.status).toBe('rejected'); expect(solved.patch).toBeUndefined();
    expect(solved.report.violationCounts['self-collision']).toBeGreaterThan(0);
    for (const code of Object.keys(solved.report.violationCounts)) expect(solved.report.violations.some(issue => issue.code === code)).toBe(true);
  }, 30000);
  it('accepts the complete real 16s Salsa production pipeline under the independent interpolated gate', async () => {
    const motion = makeAIMotionFixture('full'), source = neutral(), base = () => source;
    motion.context.target.endSeconds = 16;
    Object.assign(motion.context.timing, { durationSeconds: 16, octetCount: 4, countTimesSeconds: Array.from({ length: 33 }, (_, index) => index / 2) });
    motion.context.initialPose = source;
    motion.context.boundaries = { start: estimateAIMotionBoundary(base, 0, 'before', 16), end: estimateAIMotionBoundary(base, 16, 'after', 16) };
    motion.context.audio[0].coverage = { startSeconds: 0, endSeconds: 16 };
    const request = makeAIMotionPlanRequest(motion, MOTION_PRIOR_CATALOG), entry = MOTION_PRIOR_CATALOG.clips.find(clip => clip.id === 'cmu-61-08')!;
    const bytes = readFileSync(new URL('../../../apps/web/public/motion-priors/cmu-61-08.motion', import.meta.url));
    const clip = decodeMotionPrior(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), entry);
    const output = { summary: '真人 Salsa 连续步法与平稳收势', intentMatch: 'supported' as const, limitations: [], segments: [{ clipId: entry.id, startSeconds: 0, endSeconds: 16, sourceStartSeconds: 0, sourceEndSeconds: 16, yawDegrees: 0, travelXZ: [0, 0] as [number, number], transitionSeconds: .5, contactHint: 'standing' as const }] };
    const result: AIMotionPlanResult = { ...output, protocol: 'ai-motion-plan-1', provider: 'cloudflare-workers-ai', model: AI_MOTION_MODEL, requestId: motion.context.requestId, sourceHash: motion.context.sourceHash, target: motion.context.target, catalogVersion: request.catalog.version, sources: motionPlanSources(output, request.catalog) };
    const original = JSON.stringify({ source, request, clip });
    const composition = await composeMotionPriorPlanAsync(request, result, new Map([[entry.id, clip]]), base);
    const compositionSnapshot = JSON.stringify(composition);
    const feet = await conditionMotionLegContacts(composition.samples, { target: motion.context.target, boundaries: motion.context.boundaries, sourceHash: motion.context.sourceHash });
    const origin = { ...composition.origin, adaptations: [...composition.origin.adaptations!, 'motion-leg-contact-conditioning-1', 'motion-curve-grounding-1'], adaptationMetrics: { ...composition.origin.adaptationMetrics!, maxSoleSmoothingRadians: feet.report.maxSoleOrientationChangeRadians, maxFootMarkerDisplacementMeters: feet.report.maxFootMarkerPositionChangeMeters } };
    const draft = compileAIMotionPosePatch(motion, result, feet.samples, base, origin), draftSnapshot = JSON.stringify(draft);
    const contacts: MotionContactHint[] = [{ startSeconds: 0, endSeconds: 16, mode: 'supported' }];
    const grounded = await conditionMotionGroundingCurve(draft, { sourceSampler: base, durationSeconds: 16, contacts }), groundedSnapshot = JSON.stringify(grounded.patch);
    // This independent detector must accept the ACTUAL compiled curve. Its
    // repair path and knot-only diagnostics are deliberately disabled here.
    const solved = await solveAIMotionFeasibility(grounded.patch, { sourceSampler: base, durationSeconds: 16, contacts, correct: false });
    expect(solved.report.status).toBe('accepted'); expect(solved.patch).toBeDefined();
    expect(solved.report.coverage.complete).toBe(true); expect(solved.report.coverage.samples).toBeGreaterThan(4 * (draft.knots.length - 1));
    expect(solved.report.derivativeCoverage).toMatchObject({ complete: true, spans: draft.knots.length - 1, stencils: 2 * (draft.knots.length - 1), poseSamples: 4 * (draft.knots.length - 1) });
    expect(solved.report.totalViolations).toBe(0); expect(solved.report.violationCounts).toEqual({}); expect(solved.report.violations).toEqual([]);
    expect(solved.report.corrections).toEqual([]); expect(solved.report.metrics.maxJointAccelerationRadiansPerSecondSquared).toBeLessThanOrEqual(250);
    expect(solved.report.metrics.maxSelfDepthMeters).toBe(0); expect(solved.report.metrics.maxFloorDepthMeters).toBe(0);
    expect(solved.report.metrics.airborneSamples).toBe(0); expect(solved.report.metrics.groundedForceSamples).toBeGreaterThan(1900);
    expect(solved.report.metrics.minNormalForceNewtons).toBeGreaterThanOrEqual(-52.5); expect(solved.report.metrics.maxFrictionExcessNewtons).toBeLessThanOrEqual(52.5);
    expect(solved.report.articulatedDynamics).toBe(false);
    expect(solved.patch!.motionOrigin).toEqual(origin);
    expect(origin.sources).toEqual([{ clipId: entry.id, sourceHash: entry.sourceHash }]);
    expect(origin.adaptations).toEqual(expect.arrayContaining([MOTION_PRIOR_ARM_ADAPTATION_VERSION, MOTION_PRIOR_ARM_TRAJECTORY_VERSION, MOTION_PRIOR_NECK_TRAJECTORY_VERSION, MOTION_PRIOR_HEAD_TRAJECTORY_VERSION, MOTION_PRIOR_SPINE_TRAJECTORY_VERSION, MOTION_PRIOR_STANCE_ADAPTATION_VERSION, MOTION_PRIOR_SHIN_TRAJECTORY_VERSION, MOTION_PRIOR_KNEE_TRAJECTORY_VERSION, MOTION_PRIOR_UPPER_LEG_TRAJECTORY_VERSION, MOTION_PRIOR_HOLD_ADAPTATION_VERSION, 'motion-leg-contact-conditioning-1', 'motion-curve-grounding-1']));
    expect(origin.endingAdaptation).toEqual({ kind: 'stable-hold', seconds: 1.5 });
    expect(origin.adaptationMetrics.maxSoleSmoothingRadians).toBe(feet.report.maxSoleOrientationChangeRadians);
    expect(solved.patch!.knots[0]).toEqual(draft.knots[0]); expect(solved.patch!.knots[0].pose).toEqual(motion.context.boundaries.start.pose);
    expect(solved.patch!.knots.at(-1)!.time).toBe(16); expect(solved.patch!.knots.at(-1)!.linearVelocity).toEqual([0, 0, 0]);
    expect(solved.patch!.knots.at(-1)!.angularVelocity).toEqual(zeros());
    expect(JSON.stringify({ source, request, clip })).toBe(original); expect(JSON.stringify(composition)).toBe(compositionSnapshot);
    expect(JSON.stringify(draft)).toBe(draftSnapshot); expect(JSON.stringify(grounded.patch)).toBe(groundedSnapshot);
    const sampler = createAIMotionSampler(base, { schema: 'ai-motion-track-1', countMapId: 'fixture', durationSeconds: 16, patches: [solved.patch!] });
    expect(sampler(0)).toEqual(source);
  }, 60000);
  it('accepts a grounded natural arm movement with finite interpolated coverage, without mutation', async () => {
    const source = neutral(), raised = neutral(); raised.joints.LeftUpperArm = rotationFromDegrees([-45, 0, 40]); raised.joints.LeftForeArm = rotationFromDegrees([-55, 65, 0]);
    const patch = patchFor([source, raised, neutral()]), before = JSON.stringify({ patch, source });
    const result = await solveAIMotionFeasibility(patch, optionsFor(patch, source));
    expect(result.report.status).toBe('accepted'); expect(result.patch).toBeDefined();
    expect(result.report.coverage.complete).toBe(true); expect(result.report.coverage.samples).toBeGreaterThan(120);
    expect(result.report.articulatedDynamics).toBe(false); expect(result.report.scope).toBe('adaptive-sampled-kinematic-proxy');
    expect(JSON.stringify({ patch, source })).toBe(before); expect(result.patch).not.toBe(patch);
  });
  it('rejects grossly backwards flexion instead of rescuing an impossible action', async () => {
    const invalid = neutral(); invalid.joints.LeftForeArm = rotationFromDegrees([90, 0, 0]);
    const patch = patchFor([neutral(), invalid, neutral()]);
    const result = await solveAIMotionFeasibility(patch, optionsFor(patch));
    expect(result.report.status).toBe('rejected'); expect(codes(result)).toContain('joint-limit'); expect(result.patch).toBeUndefined();
  });
  it('rejects infeasible locked boundary and preserves every boundary value', async () => {
    const source = neutral(); source.joints.LeftForeArm = rotationFromDegrees([90, 0, 0]);
    const patch = patchFor([clonePose(source), neutral(), clonePose(source)], 2, 'interval'), before = JSON.stringify({ source, patch });
    const result = await solveAIMotionFeasibility(patch, optionsFor(patch, source));
    expect(codes(result)).toContain('locked-boundary'); expect(result.patch).toBeUndefined(); expect(result.report.corrections).toEqual([]);
    expect(JSON.stringify({ source, patch })).toBe(before);
  });
  it('detects floor penetration and only repairs small errors in a separate interior candidate', async () => {
    const patch = patchFor([neutral(), neutral(1.02), neutral()]), before = JSON.stringify(patch);
    const result = await solveAIMotionFeasibility(patch, optionsFor(patch));
    expect(result.report.status).toBe('accepted'); expect(result.report.corrections.some(item => item.kind === 'ground-alignment')).toBe(true);
    expect(result.patch!.knots[0]).toEqual(patch.knots[0]); expect(result.patch!.knots[1].pose.root[1]).toBeGreaterThan(patch.knots[1].pose.root[1]);
    expect(JSON.stringify(patch)).toBe(before);
    const deep = patchFor([neutral(), neutral(.5), neutral()]);
    const rejected = await solveAIMotionFeasibility(deep, optionsFor(deep));
    expect(rejected.report.status).toBe('rejected'); expect(codes(rejected)).toContain('floor-penetration');
  });
  it('revalidates a coupled conditioner and forbids even tiny locked-anchor changes', async () => {
    const patch = patchFor([neutral(), neutral(1.02), neutral()]), original = JSON.stringify(patch);
    let calls = 0;
    const accepted = await solveAIMotionFeasibility(patch, { ...optionsFor(patch), diagnostics: true, conditionCandidate: async candidate => { calls++; return candidate; } });
    expect(calls).toBeGreaterThan(0); expect(accepted.report.status).toBe('accepted');
    expect(accepted.report.diagnostics?.map(receipt => receipt.stage)).toEqual(['input', 'ground-alignment', 'regularization', 'conditioning']);
    expect(accepted.report.diagnostics![0].maxFloorDepthMeters).toBeGreaterThan(.003);
    expect(accepted.report.coverage.complete).toBe(true);
    const changedAnchor = await solveAIMotionFeasibility(patch, { ...optionsFor(patch), conditionCandidate: async candidate => { candidate.knots[0].pose.root[0] += 1e-9; return candidate; } });
    expect(changedAnchor.patch).toBeUndefined(); expect(changedAnchor.report.status).toBe('rejected');
    expect(changedAnchor.report.violationCounts['detector-error']).toBe(1);
    const oversized = await solveAIMotionFeasibility(patch, { ...optionsFor(patch), conditionCandidate: async candidate => { candidate.knots[1].pose.root[0] += .07; return candidate; } });
    expect(oversized.patch).toBeUndefined(); expect(oversized.report.violationCounts['correction-budget']).toBeGreaterThan(0);
    expect(JSON.stringify(patch)).toBe(original);
  });
  it('repairs a dense smooth ground-clearance wave without threshold-induced force jumps', async () => {
    const poses = Array.from({ length: 45 }, (_, index) => neutral(1.05 - .03 * Math.pow(Math.sin(Math.PI * index / 44), 2)));
    const patch = patchFor(poses), original = JSON.stringify(patch);
    patch.knots.forEach(knot => { knot.linearVelocity[1] = -.03 * Math.PI / 2 * Math.sin(Math.PI * knot.time); });
    patch.knots[0].linearVelocity[1] = 0; patch.knots.at(-1)!.linearVelocity[1] = 0;
    const sourceSnapshot = JSON.stringify(patch);
    const raw = await solveAIMotionFeasibility(patch, { ...optionsFor(patch), correct: false });
    expect(raw.report.violationCounts['floor-penetration']).toBeGreaterThan(0);
    const repaired = await solveAIMotionFeasibility(patch, optionsFor(patch));
    expect(repaired.report.status).toBe('accepted'); expect(repaired.report.coverage.complete).toBe(true);
    expect(repaired.report.violationCounts['ground-force']).toBeUndefined(); expect(repaired.report.violationCounts['ground-friction']).toBeUndefined();
    expect(repaired.patch!.knots[0]).toEqual(patch.knots[0]);
    expect(JSON.stringify(patch)).toBe(sourceSnapshot); expect(original).not.toBe(sourceSnapshot);
  });
  it('detects self collision in a legal anatomical envelope', async () => {
    const collision = neutral(); collision.joints.LeftUpperArm = rotationFromDegrees([0, 0, -65]);
    const patch = patchFor([neutral(), collision, neutral()]);
    const result = await solveAIMotionFeasibility(patch, { ...optionsFor(patch), correct: false });
    expect(result.patch).toBeUndefined(); expect(codes(result)).toContain('self-collision');
  });
  it('separates a small new hand/thigh overlap with bounded functional IK and revalidates the whole curve', async () => {
    const contacting = neutral(); contacting.joints.LeftUpperArm = rotationFromDegrees([0, 0, 5]);
    const patch = patchFor([neutral(), contacting, neutral()]), before = JSON.stringify(patch);
    const raw = await solveAIMotionFeasibility(patch, { ...optionsFor(patch), correct: false });
    expect(codes(raw)).toContain('self-collision');
    const solved = await solveAIMotionFeasibility(patch, { ...optionsFor(patch), contacts: [{ startSeconds: 0, endSeconds: 2, mode: 'supported' }] });
    expect(solved.report.violations).toEqual([]); expect(solved.report.status).toBe('accepted');
    expect(solved.report.corrections.some(correction => correction.kind === 'collision-separation')).toBe(true);
    expect(solved.report.metrics.maxPoseCorrectionDegrees).toBeLessThanOrEqual(20 + 1e-7);
    expect(solved.report.metrics.maxRootCorrectionMeters).toBeLessThanOrEqual(.06 + 1e-7);
    expect(solved.patch!.knots.map(knot => knot.pose.root)).toEqual(patch.knots.map(knot => knot.pose.root));
    expect(JSON.stringify(patch)).toBe(before);
  });
  it('rejects an impossible sideways wrist fold despite a modest total swing', async () => {
    const folded = neutral(); folded.joints.LeftHand = rotationFromDegrees([0, 0, 80]);
    const patch = patchFor([neutral(), folded, neutral()]), original = JSON.stringify(patch);
    const result = await solveAIMotionFeasibility(patch, optionsFor(patch));
    expect(result.report.status).toBe('rejected'); expect(result.patch).toBeUndefined();
    expect(result.report.violations.some(issue => issue.code === 'joint-limit' && issue.joint === 'LeftHand')).toBe(true);
    expect(JSON.stringify(patch)).toBe(original);
  });
  it('checks Hermite/SO3 between legal knots, including tiny off-grid intervals', async () => {
    const patch = patchFor([neutral(), neutral(), neutral()], .018);
    patch.knots[0].angularVelocity.LeftForeArm = [500, 0, 0];
    const result = await solveAIMotionFeasibility(patch, { ...optionsFor(patch), correct: false });
    expect(result.patch).toBeUndefined(); expect(codes(result).some(code => code === 'joint-limit' || code === 'angular-speed')).toBe(true);
    expect(result.report.coverage.samples).toBeGreaterThan(3); expect(result.report.coverage.maxGapSeconds).toBeLessThan(.018);
  });
  it('rejects one-sided near-knot curvature even when every legal quarter-grid stencil passes', async () => {
    const dt = 1 / 30, angle = .05, source = neutral(), turned = neutral();
    turned.joints.Head = rotationFromDegrees([angle * 180 / Math.PI, 0, 0]);
    const patch = patchFor([source, turned, neutral()], 2 * dt), original = JSON.stringify(patch);
    expect(isFunctionalJointWithinLimits('Head', turned.joints.Head)).toBe(true);
    const sampler = createAIMotionSampler(() => source, { schema: 'ai-motion-track-1', countMapId: 'fixture', durationSeconds: 2 * dt, patches: [patch] });
    const times = getMotionFeasibilitySampleTimes(patch), angles = times.map(time => { const q = sampler(time).joints.Head; return 2 * Math.atan2(q[0], q[3]); });
    expect(times).toHaveLength(9);
    let quarterMaximum = 0;
    for (let index = 2; index < times.length; index++) {
      const before = times[index - 1] - times[index - 2], after = times[index] - times[index - 1];
      quarterMaximum = Math.max(quarterMaximum, Math.abs(((angles[index] - angles[index - 1]) / after - (angles[index - 1] - angles[index - 2]) / before) / ((before + after) / 2)));
    }
    expect(quarterMaximum).toBeLessThan(250);
    // A zero-tangent cubic has endpoint curvature6*angle/dt²=270.
    expect(6 * angle / dt ** 2).toBeCloseTo(270, 8);
    const result = await solveAIMotionFeasibility(patch, { ...optionsFor(patch, source), correct: false });
    expect(result.report.status).toBe('rejected'); expect(result.patch).toBeUndefined();
    expect(result.report.coverage.complete).toBe(true);
    expect(result.report.derivativeCoverage).toMatchObject({ method: 'one-sided-so3-curvature', complete: true, spans: 2, stencils: 4, poseSamples: 8, maxPoseSamples: 7208 });
    expect(result.report.metrics.maxJointAccelerationRadiansPerSecondSquared).toBeGreaterThan(269);
    expect(result.report.violations.some(issue => issue.code === 'acceleration' && issue.joint === 'Head' && issue.endSeconds - issue.startSeconds < dt / 500)).toBe(true);
    expect(JSON.stringify(patch)).toBe(original);
  });
  it('rejects reconstructed Hermite angular-curvature peaks below the knot-only acceleration bound', async () => {
    const dt = 1 / 30, delta = 150 * dt * dt, angles = [0, 0, -delta, -delta, -delta];
    const poses = angles.map(angle => { const pose = neutral(); pose.joints.LeftForeArm = rotationFromDegrees([angle * 180 / Math.PI, 0, 0]); return pose; });
    for (const pose of poses) expect(isFunctionalJointWithinLimits('LeftForeArm', pose.joints.LeftForeArm)).toBe(true);
    for (let index = 1; index < angles.length - 1; index++) expect(Math.abs((angles[index + 1] - 2 * angles[index] + angles[index - 1]) / dt ** 2)).toBeLessThanOrEqual(150 + 1e-7);
    const patch = recomputeAIMotionPatchTangents(patchFor(poses, dt * 4)), original = JSON.stringify(patch);
    const result = await solveAIMotionFeasibility(patch, { ...optionsFor(patch), correct: false });
    expect(result.report.status).toBe('rejected'); expect(result.patch).toBeUndefined(); expect(result.report.coverage.complete).toBe(true);
    expect(result.report.metrics.maxJointAccelerationRadiansPerSecondSquared).toBeGreaterThan(250);
    expect(result.report.metrics.maxJointSpeedRadiansPerSecond).toBeLessThan(16);
    expect(result.report.violations.some(issue => issue.code === 'acceleration' && issue.joint === 'LeftForeArm')).toBe(true);
    expect(JSON.stringify(patch)).toBe(original);
  });
  it('does not invent angular speed from identical valid Float32-rounded source rotations', async () => {
    const source = neutral(); source.joints.LeftUpperArm = [.16130028665, .2150670439, .26883381605, .92490905523];
    const patch = patchFor([clonePose(source), clonePose(source), clonePose(source)], .00001, 'interval'), before = JSON.stringify({ patch, source });
    const solved = await solveAIMotionFeasibility(patch, optionsFor(patch, source));
    expect(solved.report.violations).toEqual([]); expect(solved.report.status).toBe('accepted');
    expect(solved.report.metrics.maxJointSpeedRadiansPerSecond).toBeLessThan(1e-7);
    expect(JSON.stringify({ patch, source })).toBe(before);
  });
  it('rejects an unrepresentable adaptive time grid with finite rejection metrics', async () => {
    const patch = patchFor([neutral(), neutral(), neutral()], Number.EPSILON * 2, 'interval'), original = JSON.stringify(patch);
    const solved = await solveAIMotionFeasibility(patch, optionsFor(patch));
    expect(solved.report.status).toBe('rejected'); expect(solved.patch).toBeUndefined();
    expect(solved.report.violationCounts.coverage).toBe(1); expect(solved.report.coverage.complete).toBe(false);
    expect(Object.values(solved.report.metrics).every(Number.isFinite)).toBe(true);
    expect(JSON.stringify(patch)).toBe(original);
  });
  it('preserves exact interval seams, locked velocities and all arbitrary outside times', async () => {
    const source = neutral(), raised = neutral(); raised.joints.LeftUpperArm = rotationFromDegrees([0, 0, 40]);
    const patch = patchFor([clonePose(source), raised, clonePose(source)], 2, 'interval');
    const result = await solveAIMotionFeasibility(patch, optionsFor(patch, source));
    expect(result.report.status).toBe('accepted'); expect(result.patch!.knots[0]).toEqual(patch.knots[0]); expect(result.patch!.knots.at(-1)).toEqual(patch.knots.at(-1));
    const sampler = createAIMotionSampler(() => source, { schema: 'ai-motion-track-1', countMapId: 'fixture', durationSeconds: 4, patches: [result.patch!] });
    for (const time of [0, .913579, 1, 3, 3.000123, 4]) expect(sampler(time)).toBe(source);
  });
  it('rejects a changed boundary or contact hint that contradicts actual geometry', async () => {
    const patch = patchFor([neutral(), neutral(), neutral()], 2, 'interval');
    patch.knots[0].linearVelocity = [1, 0, 0];
    expect(codes(await solveAIMotionFeasibility(patch, optionsFor(patch)))).toContain('locked-boundary');
    const fresh = patchFor([neutral(), neutral(), neutral()]);
    const result = await solveAIMotionFeasibility(fresh, { ...optionsFor(fresh), contacts: [{ startSeconds: 0, endSeconds: 2, mode: 'supported', effectors: ['LeftHand'] }] });
    expect(codes(result)).toContain('contact-mismatch'); expect(result.patch).toBeUndefined();
  });
  it('rejects unsupported hovering and accepts a ballistic airborne COM trajectory', async () => {
    const hovering = neutral(2), hoverPatch = patchFor([hovering, clonePose(hovering), clonePose(hovering)]);
    expect(codes(await solveAIMotionFeasibility(hoverPatch, optionsFor(hoverPatch, hovering)))).toContain('unsupported-flight');
    const duration = .3, flightStart = neutral(2), endHeight = 2 + 1.4715 * duration - 9.81 * duration * duration / 2;
    const flight = patchFor([flightStart, neutral(2 + 1.4715 * duration / 2 - 9.81 * (duration / 2) ** 2 / 2), neutral(endHeight)], duration, 'interval');
    flight.knots.forEach(knot => { knot.linearVelocity = [0, 1.4715 - 9.81 * (knot.time - 1), 0]; });
    const original = (time: number) => neutral(2 + 1.4715 * (time - 1) - 9.81 * (time - 1) ** 2 / 2);
    for (const knot of [flight.knots[0], flight.knots.at(-1)!]) { const boundary = estimateAIMotionBoundary(original, knot.time, knot.time === 1 ? 'before' : 'after', 2); knot.pose = boundary.pose; knot.linearVelocity = boundary.linearVelocity; }
    const result = await solveAIMotionFeasibility(flight, { sourceSampler: original, durationSeconds: 2, contacts: [{ startSeconds: 1, endSeconds: 1.3, mode: 'airborne' }] });
    expect(result.report.status).toBe('accepted'); expect(result.report.metrics.airborneSamples).toBe(result.report.coverage.samples);
  });
  it('accepts a hand-supported inverted pose using body contacts rather than an upright foot rule', async () => {
    await loadRapierBackend();
    const handstand = neutral(1.15); handstand.joints.Hips = rotationFromDegrees([180, 0, 0]);
    handstand.joints.LeftShoulder = rotationFromDegrees([0, 0, 30]); handstand.joints.RightShoulder = rotationFromDegrees([0, 0, -30]);
    handstand.joints.LeftUpperArm = rotationFromDegrees([0, 0, 150]); handstand.joints.RightUpperArm = rotationFromDegrees([0, 0, -150]);
    const depth = getBodyCollisionContacts(handstand).floorDepthMeters; handstand.root[1] += depth + .004;
    const patch = patchFor([handstand, clonePose(handstand), clonePose(handstand)]);
    const result = await solveAIMotionFeasibility(patch, { ...optionsFor(patch, handstand), contacts: [{ startSeconds: 0, endSeconds: 2, mode: 'supported', effectors: ['LeftHand', 'RightHand'], planted: true }] });
    expect(result.report.status).toBe('accepted'); expect(result.report.metrics.supportedSamples).toBe(result.report.coverage.samples);
    const fk = evaluatePose(handstand); expect(fk.LeftFoot.position[1]).toBeGreaterThan(1.5); expect(fk.Head.position[1]).toBeGreaterThan(.3);
  });
  it('rejects planted-foot sliding instead of calling every ground touch planted', async () => {
    const middle = neutral(); middle.root[0] = .2;
    const patch = patchFor([neutral(), middle, neutral()]);
    const hint: MotionContactHint = { startSeconds: 0, endSeconds: 2, mode: 'supported', effectors: ['LeftFoot'], planted: true };
    expect(codes(await solveAIMotionFeasibility(patch, { ...optionsFor(patch), contacts: [hint] }))).toContain('contact-slide');
    expect((await solveAIMotionFeasibility(patch, { ...optionsFor(patch), contacts: [{ ...hint, planted: false }] })).report.status).toBe('accepted');
    const turning = neutral(); turning.joints.LeftFoot = rotationFromDegrees([0, 10, 0]);
    const turningPatch = patchFor([neutral(), turning, neutral()]);
    expect(codes(await solveAIMotionFeasibility(turningPatch, { ...optionsFor(turningPatch), contacts: [hint] }))).toContain('contact-slide');
  });
  it('fails closed for finite coverage exhaustion, malformed detector inputs and cancellation', async () => {
    const patch = patchFor([neutral(), neutral(), neutral()]);
    const short = await solveAIMotionFeasibility(patch, { ...optionsFor(patch), maxSamples: 3 });
    expect(codes(short)).toContain('coverage'); expect(short.report.coverage.complete).toBe(false); expect(short.patch).toBeUndefined();
    const controller = new AbortController(); controller.abort();
    expect((await solveAIMotionFeasibility(patch, { ...optionsFor(patch), signal: controller.signal })).report.status).toBe('cancelled');
    const bad = patchFor([neutral(), neutral(), neutral()]); bad.knots[1].pose.root[0] = NaN;
    const invalid = await solveAIMotionFeasibility(bad, optionsFor(bad));
    expect(invalid.report.status).toBe('rejected'); expect(invalid.report.coverage.complete).toBe(false);
  });
  it('allows cancellation during a long offline curve and never exposes a partially checked candidate', async () => {
    const patch = patchFor([neutral(), neutral(), neutral()], 16), before = JSON.stringify(patch), controller = new AbortController();
    setTimeout(() => controller.abort(), 0);
    const result = await solveAIMotionFeasibility(patch, { ...optionsFor(patch), signal: controller.signal });
    expect(result.report.status).toBe('cancelled'); expect(result.report.coverage.complete).toBe(false); expect(result.patch).toBeUndefined();
    expect(JSON.stringify(patch)).toBe(before);
  });
  it('uses standard body mass, gravity and friction in supported net contact force', async () => {
    const patch = patchFor([neutral(), neutral(), neutral()]);
    const solved = await solveAIMotionFeasibility(patch, optionsFor(patch));
    expect(solved.report.status).toBe('accepted');
    expect(solved.report.metrics.groundedForceSamples).toBeGreaterThan(20);
    expect(solved.report.metrics.minNormalForceNewtons).toBeCloseTo(70 * 9.81, 5);
    expect(solved.report.metrics.maxNormalForceNewtons).toBeCloseTo(70 * 9.81, 5);
    expect(solved.report.metrics.maxHorizontalContactForceNewtons).toBeLessThan(1e-5);
  });
  it('rejects a negative floor normal force and horizontal force outside the friction cone', async () => {
    const run = async (duration: number, sampler: (time: number) => Pose) => {
      const patch = patchFor([sampler(1), sampler(1 + duration / 2), sampler(1 + duration)], duration, 'interval');
      for (const [index, knot] of patch.knots.entries()) {
        const boundary = estimateAIMotionBoundary(sampler, knot.time, index === patch.knots.length - 1 ? 'after' : 'before', 2);
        knot.pose = boundary.pose; knot.linearVelocity = boundary.linearVelocity;
      }
      return solveAIMotionFeasibility(patch, { sourceSampler: sampler, durationSeconds: 2, correct: false });
    };
    const downward = await run(.02, time => { const pose = neutral(); pose.root[1] -= 10 * (time - 1) ** 2; return pose; });
    expect(codes(downward)).toContain('ground-force'); expect(downward.report.metrics.minNormalForceNewtons).toBeLessThan(-500); expect(downward.patch).toBeUndefined();
    const lateral = await run(.2, time => { const pose = neutral(); pose.root[0] += 10 * (time - 1) ** 2; return pose; });
    expect(codes(lateral)).toContain('ground-friction'); expect(lateral.report.metrics.maxHorizontalContactForceNewtons).toBeGreaterThan(1300); expect(lateral.patch).toBeUndefined();
    const valid = await run(.2, time => { const pose = neutral(); pose.root[0] += (time - 1) ** 2; return pose; });
    expect(valid.report.status).toBe('accepted'); expect(valid.report.metrics.maxFrictionExcessNewtons).toBe(0);
  });
});
