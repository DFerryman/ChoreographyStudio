import { describe, expect, it } from 'vitest';
import { Quaternion, Vector3 } from 'three';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { AI_MOTION_MODEL } from './aiMotion';
import { makeAIMotionFixture } from './aiMotion.fixture';
import { makeAIMotionPlanRequest, motionPlanSources, type AIMotionPlanResult } from './aiMotionPlan';
import { composeMotionPriorPlan, decodeMotionPrior, sampleMotionPrior, MOTION_PRIOR_CATALOG } from './motionPriors';
import { evaluatePose } from './humanoid';
import { rotationFromDegrees } from './keyframes';
import { compileAIMotionPosePatch, createAIMotionSampler, estimateAIMotionBoundary, recomputeAIMotionPatchTangents, type AIMotionPatch } from './aiMotionTrack';
import { JOINT_NAMES, type JointName, type Pose, type Vec3 } from './motion-types';
import { conditionMotionGrounding, conditionMotionGroundingCurve, conditionMotionLegContacts, MOTION_GROUNDING_MAX_ROOT_CORRECTION_METERS, type MotionGroundingSample } from './motionGrounding';
import { getMotionFeasibilitySampleTimes, inferMotionSupportGeometry, isFunctionalJointWithinLimits, measureFunctionalJoint, solveAIMotionFeasibility } from './motionFeasibility';

function pose(height = 1.03): Pose {
  return { root: [0, height, 0], joints: Object.fromEntries(JOINT_NAMES.map(joint => [joint, joint.endsWith('UpperLeg') ? rotationFromDegrees([-12, 0, 0]) : joint.endsWith('LowerLeg') ? rotationFromDegrees([24, 0, 0]) : joint.endsWith('Foot') ? rotationFromDegrees([-12, 0, 0]) : [0, 0, 0, 1]])) as Pose['joints'] };
}
function options(mode: 'full' | 'interval' = 'full', source = pose(), duration = 2) {
  return { target: { mode, startSeconds: 0, endSeconds: duration }, boundaries: {
    start: estimateAIMotionBoundary(() => source, 0, 'before', duration),
    end: estimateAIMotionBoundary(() => source, duration, 'after', duration),
  } };
}
function noisy(): MotionGroundingSample[] {
  return Array.from({ length: 61 }, (_, frame) => ({ time: frame / 30, pose: pose(frame > 6 && frame < 54 && frame % 2 ? 1.045 : 1.03) }));
}
describe('offline bounded Root/contact conditioning', () => {
  it.each([16, 32])('conditions the actual %ss Salsa candidate without altering source capture or world foot paths', async duration => {
    const motion = makeAIMotionFixture(), base = pose(1.05);
    Object.assign(motion.context.target, { endSeconds: duration });
    Object.assign(motion.context.timing, { durationSeconds: duration, octetCount: duration / 4, countTimesSeconds: Array.from({ length: duration * 2 + 1 }, (_, i) => i / 2) });
    motion.context.initialPose = base;
    motion.context.boundaries = { start: estimateAIMotionBoundary(() => base, 0, 'before', duration), end: estimateAIMotionBoundary(() => base, duration, 'after', duration) };
    motion.context.audio[0].coverage = { startSeconds: 0, endSeconds: duration };
    const request = makeAIMotionPlanRequest(motion, MOTION_PRIOR_CATALOG), entry = MOTION_PRIOR_CATALOG.clips.find(item => item.id === 'cmu-61-08')!;
    const bytes = readFileSync(new URL('../../../apps/web/public/motion-priors/cmu-61-08.motion', import.meta.url));
    const clip = decodeMotionPrior(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), entry), original = JSON.stringify(clip);
    const output = { summary: '真人连续 Salsa', intentMatch: 'supported' as const, limitations: [], segments: [{ clipId: entry.id,
      startSeconds: 0, endSeconds: duration, sourceStartSeconds: 0, sourceEndSeconds: duration, yawDegrees: 0,
      travelXZ: [0, 0] as [number, number], transitionSeconds: .3, contactHint: 'standing' as const }] };
    const plan: AIMotionPlanResult = { ...output, protocol: 'ai-motion-plan-1', provider: 'cloudflare-workers-ai', model: AI_MOTION_MODEL,
      requestId: motion.context.requestId, sourceHash: motion.context.sourceHash, target: motion.context.target,
      catalogVersion: request.catalog.version, sources: motionPlanSources(output, request.catalog) };
    const composition = await composeMotionPriorPlan(request, plan, new Map([[entry.id, clip]]), () => base);
    const candidateOriginal = JSON.stringify(composition.samples);
    const result = await conditionMotionGrounding(composition.samples, { target: motion.context.target, boundaries: motion.context.boundaries });
    expect(result.report.after.forceViolationSamples).toBeLessThanOrEqual(result.report.before.forceViolationSamples);
    expect(result.report.after.forceViolationSamples).toBe(0);
    expect(result.report.maxRootCorrectionMeters).toBeLessThanOrEqual(.060000001);
    expect(result.report.maxFootPositionResidualMeters).toBeLessThan(1e-7);
    expect(result.report.maxFootRotationResidualRadians).toBeLessThan(1e-7);
    expect(JSON.stringify(clip)).toBe(original); expect(JSON.stringify(composition.samples)).toBe(candidateOriginal);
  }, 15000);
  it('reduces contact-force jumps while preserving world feet/toes/heels and source data', async () => {
    const samples = noisy(), original = JSON.stringify(samples), result = await conditionMotionGrounding(samples, options());
    expect(result.report.before.forceViolationSamples).toBeGreaterThan(0);
    expect(result.report.after.forceViolationSamples).toBeLessThan(result.report.before.forceViolationSamples);
    expect(result.report.after.minNormalForceNewtons).toBeGreaterThan(result.report.before.minNormalForceNewtons);
    expect(result.report.maxRootCorrectionMeters).toBeGreaterThan(0);
    expect(result.report.maxRootCorrectionMeters).toBeLessThanOrEqual(MOTION_GROUNDING_MAX_ROOT_CORRECTION_METERS + 1e-10);
    expect(result.report.maxFootPositionResidualMeters).toBeLessThan(1e-7);
    expect(result.report.maxFootRotationResidualRadians).toBeLessThan(1e-7);
    expect(JSON.stringify(samples)).toBe(original); expect(result.samples.map(sample => sample.time)).toEqual(samples.map(sample => sample.time));
    for (let index = 0; index < samples.length; index++) {
      for (const joint of ['Hips', 'Chest', 'Head', 'LeftHand', 'RightHand'] as const) expect(result.samples[index].pose.joints[joint]).toEqual(samples[index].pose.joints[joint]);
      const before = evaluatePose(samples[index].pose), after = evaluatePose(result.samples[index].pose);
      for (const foot of ['LeftFoot', 'RightFoot', 'LeftToe', 'RightToe', 'LeftHeel', 'RightHeel'] as const) {
        expect(Math.hypot(...before[foot].position.map((value, axis) => value - after[foot].position[axis]))).toBeLessThan(1e-7);
      }
      for (const foot of ['LeftFoot', 'RightFoot'] as const) {
        const twist = (q: number[]) => 2 * Math.atan2(q[1], q[3]);
        expect(Math.abs(twist(result.samples[index].pose.joints[foot]) - twist(samples[index].pose.joints[foot]))).toBeLessThan(1e-7);
      }
    }
    expect(result.report.physicalParameters).toEqual({ massKg: 70, gravityMps2: 9.81, friction: .75 });
    expect(result.report.articulatedDynamics).toBe(false);
  });
  it('retains interval endpoint poses and the adjacent two sample bands exactly for a zero C1/C2 correction', async () => {
    const samples = noisy(), boundary = options('interval'), original = JSON.stringify(boundary);
    const result = await conditionMotionGrounding(samples, boundary);
    for (const index of [0, 1, 2, 58, 59, 60]) expect(result.samples[index]).toEqual(samples[index]);
    expect(JSON.stringify(boundary)).toBe(original);
    const interior = await conditionMotionGrounding(samples.slice(1, -1), boundary);
    expect(interior.samples).toHaveLength(59); expect(interior.samples[0].time).toBe(1 / 30); expect(interior.samples.at(-1)!.time).toBe(59 / 30);
  });
  it('leaves an already smooth stationary trajectory numerically exact and cloned', async () => {
    const samples = Array.from({ length: 61 }, (_, frame) => ({ time: frame / 30, pose: pose() }));
    const result = await conditionMotionGrounding(samples, options());
    expect(result.samples).toEqual(samples); expect(result.report.applied).toBe(false); expect(result.report.iterations).toBe(0);
    result.samples[0].pose.root[0] = 10; expect(samples[0].pose.root[0]).toBe(0);
  });
  it('rejects changed immutable anchors, invalid sampling and honours cancellation', async () => {
    const changed = noisy(); changed[0].pose.root[0] = 1;
    await expect(conditionMotionGrounding(changed, options())).rejects.toThrow('不能改写只读端点');
    const repeated = noisy(); repeated[5].time = repeated[4].time;
    await expect(conditionMotionGrounding(repeated, options())).rejects.toThrow('递增');
    const controller = new AbortController(); controller.abort();
    await expect(conditionMotionGrounding(noisy(), { ...options(), signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
  });
  it('yields during the offline solve so a user can cancel without changing the source', async () => {
    const samples = noisy(), before = JSON.stringify(samples), controller = new AbortController();
    const solving = conditionMotionGrounding(samples, { ...options(), signal: controller.signal });
    const timer = setTimeout(() => controller.abort(), 0);
    try { await expect(solving).rejects.toMatchObject({ name: 'AbortError' }); }
    finally { clearTimeout(timer); }
    expect(JSON.stringify(samples)).toBe(before);
  });
});

/** A synthetic, anatomically neutral standing motion with an intentionally
 * noisy new Root trajectory. It exercises interpolation, not a source waiver. */
function curveFixture(mode: 'full' | 'interval', nonuniform = false) {
  const source = pose(1.03);
  source.joints.LeftUpperArm = rotationFromDegrees([0, 0, 15]);
  source.joints.RightUpperArm = rotationFromDegrees([0, 0, -15]);
  const start = mode === 'interval' ? 1 : 0, span = 1 / 30;
  const times = Array.from({ length: 41 }, (_, index) => start + index * span + (nonuniform && index % 2 ? span / 5 : 0));
  const patch: AIMotionPatch = { id: 'ground-curve-fixture', provider: 'cloudflare-workers-ai', model: AI_MOTION_MODEL,
    requestId: 'curve-physical-fixture', sourceHash: 'a'.repeat(64), target: { mode, startSeconds: start, endSeconds: times.at(-1)! },
    knots: times.map((time, index) => ({ time, pose: { root: [0, 1.03 + (index > 5 && index < 35 && index % 2 ? .008 : 0), 0],
      joints: structuredClone(source.joints) }, linearVelocity: [0, 0, 0],
      angularVelocity: Object.fromEntries(JOINT_NAMES.map(joint => [joint, [0, 0, 0]])) as Record<JointName, Vec3> })) };
  return { source, patch: recomputeAIMotionPatchTangents(patch), durationSeconds: times.at(-1)! + (mode === 'interval' ? 1 : 0) };
}

describe('actual interpolated Root/contact conditioning', () => {
  it('refines the actual contact mesh for a captured interval with moving immutable source seams', async () => {
    const motion = makeAIMotionFixture('interval'), base = pose(1.05);
    for (const joint of JOINT_NAMES) base.joints[joint] = [0, 0, 0, 1];
    base.joints.LeftUpperArm = rotationFromDegrees([0, 0, 15]);
    base.joints.RightUpperArm = rotationFromDegrees([0, 0, -15]);
    const sourceSampler = (time: number): Pose => {
      const result = structuredClone(base); result.root[0] = time * .02;
      if (time >= 2.5) result.joints.LeftUpperArm = [0, 0, Math.sin(.2), Math.cos(.2)];
      return result;
    };
    Object.assign(motion.context.target, { startSeconds: 4, endSeconds: 12 });
    motion.context.initialPose = sourceSampler(4);
    motion.context.boundaries = { start: estimateAIMotionBoundary(sourceSampler, 4, 'before', 32), end: estimateAIMotionBoundary(sourceSampler, 12, 'after', 32) };
    motion.context.before = [{ time: 3, pose: sourceSampler(3) }]; motion.context.after = [{ time: 13, pose: sourceSampler(13) }];
    const request = makeAIMotionPlanRequest(motion, MOTION_PRIOR_CATALOG), entry = MOTION_PRIOR_CATALOG.clips.find(item => item.id === 'cmu-61-08-c')!;
    const bytes = readFileSync(new URL('../../../apps/web/public/motion-priors/cmu-61-08-c.motion', import.meta.url));
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(entry.sourceHash);
    const clip = decodeMotionPrior(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), entry), originalClip = JSON.stringify(clip), originalRequest = JSON.stringify(request);
    const first = sampleMotionPrior(clip, 0), last = sampleMotionPrior(clip, 8);
    // This genuine planning orientation avoids a shortest-SO(3) branch cut
    // during the active immutable seam blends; it changes only the new plan.
    const yawDegrees = -35, yaw = yawDegrees * Math.PI / 180;
    const dx = last.root[0] - first.root[0], dz = last.root[2] - first.root[2];
    const travelXZ: [number, number] = [.16 - Math.cos(yaw) * dx - Math.sin(yaw) * dz, Math.sin(yaw) * dx - Math.cos(yaw) * dz];
    const output = { summary: '接入真人连续步法并保留两端移动姿态。', intentMatch: 'supported' as const, limitations: [], segments: [{ clipId: entry.id,
      startSeconds: 4, endSeconds: 12, sourceStartSeconds: 0, sourceEndSeconds: 8, yawDegrees, travelXZ, transitionSeconds: .5, contactHint: 'standing' as const }] };
    const plan: AIMotionPlanResult = { ...output, protocol: 'ai-motion-plan-1', provider: 'cloudflare-workers-ai', model: AI_MOTION_MODEL,
      requestId: motion.context.requestId, sourceHash: motion.context.sourceHash, target: motion.context.target,
      catalogVersion: request.catalog.version, sources: motionPlanSources(output, request.catalog) };
    const composed = await composeMotionPriorPlan(request, plan, new Map([[entry.id, clip]]), sourceSampler);
    const feet = await conditionMotionLegContacts(composed.samples, { target: motion.context.target, boundaries: motion.context.boundaries });
    const raw = compileAIMotionPosePatch(motion, plan, feet.samples, sourceSampler, composed.origin), originalPatch = JSON.stringify(raw);
    const options = { sourceSampler, durationSeconds: 32, contacts: [{ startSeconds: 4, endSeconds: 12, mode: 'supported' as const }] };
    const before = await solveAIMotionFeasibility(raw, { ...options, correct: false });
    expect(before.report.violations.some(issue => issue.code === 'ground-force' || issue.code === 'ground-friction')).toBe(true);
    const result = await conditionMotionGroundingCurve(raw, options);
    const checked = await solveAIMotionFeasibility(result.patch, { ...options, correct: false });
    expect(checked.report.status).toBe('accepted'); expect(checked.report.violations).toEqual([]);
    expect(checked.report.coverage.complete).toBe(true); expect(checked.report.derivativeCoverage.complete).toBe(true);
    expect(JSON.stringify(raw)).toBe(originalPatch); expect(JSON.stringify(request)).toBe(originalRequest); expect(JSON.stringify(clip)).toBe(originalClip);
    const sampler = createAIMotionSampler(sourceSampler, { schema: 'ai-motion-track-1', countMapId: 'moving-seams', durationSeconds: 32, patches: [result.patch] });
    const beforeSampler = createAIMotionSampler(sourceSampler, { schema: 'ai-motion-track-1', countMapId: 'before-grounding', durationSeconds: 32, patches: [raw] });
    for (const time of getMotionFeasibilitySampleTimes(result.patch)) expect(new Vector3(...sampler(time).root).distanceTo(new Vector3(...beforeSampler(time).root))).toBeLessThanOrEqual(.060000001);
    for (const time of [0, 2, 3.999, 4, 12, 12.001, 16, 32]) expect(sampler(time)).toEqual(sourceSampler(time));
    for (const index of [0, 1, 2, raw.knots.length - 3, raw.knots.length - 2, raw.knots.length - 1]) expect(result.patch.knots[index]).toEqual(raw.knots[index]);
    for (let index = 0; index < raw.knots.length; index++) {
      expect(result.patch.knots[index].pose.joints).toEqual(raw.knots[index].pose.joints);
      expect(result.patch.knots[index].angularVelocity).toEqual(raw.knots[index].angularVelocity);
    }
  }, 30000);

  it('grounds a bounded supported-phase gap using actual geometry and keeps an unknown phase free', async () => {
    const { patch, source, durationSeconds } = curveFixture('interval');
    patch.knots.forEach((knot, index) => { knot.pose.root = [0, index >= 8 && index <= 32 ? 1.05 : 1.03, 0]; });
    const candidate = recomputeAIMotionPatchTangents(patch), original = JSON.stringify(candidate);
    const contacts = [{ startSeconds: candidate.target.startSeconds, endSeconds: candidate.target.endSeconds, mode: 'supported' as const }];
    const raw = await solveAIMotionFeasibility(candidate, { sourceSampler: () => source, durationSeconds, contacts, correct: false });
    expect(raw.report.violations.some(violation => violation.code === 'contact-mismatch')).toBe(true);
    const options = { sourceSampler: () => source, durationSeconds };
    const unknown = await conditionMotionGroundingCurve(candidate, { ...options, contacts: [{ ...contacts[0], mode: 'unknown' }] });
    const supported = await conditionMotionGroundingCurve(candidate, { ...options, contacts });
    const sample = (value: AIMotionPatch) => createAIMotionSampler(() => source, { schema: 'ai-motion-track-1', countMapId: 'phase-test', durationSeconds, patches: [value] });
    const middle = (candidate.target.startSeconds + candidate.target.endSeconds) / 2;
    expect(inferMotionSupportGeometry(sample(unknown.patch)(middle)).points).toHaveLength(0);
    expect(inferMotionSupportGeometry(sample(supported.patch)(middle)).points.length).toBeGreaterThan(0);
    const checked = await solveAIMotionFeasibility(supported.patch, { ...options, contacts, correct: false });
    expect(checked.report.status).toBe('accepted'); expect(checked.report.violations).toEqual([]);
    expect(supported.report.maxRootCorrectionMeters).toBeLessThanOrEqual(.060000001);
    expect(JSON.stringify(candidate)).toBe(original);
    for (const index of [0, 1, 2, 38, 39, 40]) expect(supported.patch.knots[index]).toEqual(candidate.knots[index]);
  });

  it.each(['full', 'interval'] as const)('makes a noisy %s curve pass the independent physical gate while keeping joints and locked bands exact', async mode => {
    const { patch, source, durationSeconds } = curveFixture(mode, true), original = JSON.stringify(patch);
    const options = { sourceSampler: () => source, durationSeconds, correct: false };
    const raw = await solveAIMotionFeasibility(patch, options);
    expect(raw.report.violations.some(violation => violation.code === 'ground-force' || violation.code === 'ground-friction')).toBe(true);
    const result = await conditionMotionGroundingCurve(patch, options);
    const checked = await solveAIMotionFeasibility(result.patch, options);
    expect(checked.report.status).toBe('accepted');
    expect(checked.report.violations).toEqual([]);
    expect(result.report.maxRootCorrectionMeters).toBeGreaterThan(0);
    expect(result.report.maxRootCorrectionMeters).toBeLessThanOrEqual(.060000001);
    expect(JSON.stringify(patch)).toBe(original);
    expect(result.patch.target).toEqual(patch.target); expect(result.patch.sourceHash).toBe(patch.sourceHash);
    for (let index = 0; index < patch.knots.length; index++) {
      expect(result.patch.knots[index].time).toBe(patch.knots[index].time);
      expect(result.patch.knots[index].pose.joints).toEqual(patch.knots[index].pose.joints);
      expect(result.patch.knots[index].angularVelocity).toEqual(patch.knots[index].angularVelocity);
      if (index < 3 || mode === 'interval' && index >= patch.knots.length - 3) expect(result.patch.knots[index]).toEqual(patch.knots[index]);
    }
    expect(result.patch.knots.at(-1)!.linearVelocity).toEqual(patch.knots.at(-1)!.linearVelocity);
    if (mode === 'interval') {
      const sampler = createAIMotionSampler(() => source, { schema: 'ai-motion-track-1', countMapId: 'ground-test', durationSeconds, patches: [result.patch] });
      for (const time of [0, patch.target.startSeconds - 1e-5, patch.target.endSeconds + 1e-5, durationSeconds]) expect(sampler(time)).toEqual(source);
    }
  });
  it('yields and cancels without mutating the input curve', async () => {
    const { patch, source, durationSeconds } = curveFixture('interval'), original = JSON.stringify(patch), controller = new AbortController();
    const solving = conditionMotionGroundingCurve(patch, { sourceSampler: () => source, durationSeconds, signal: controller.signal });
    const timer = setTimeout(() => controller.abort(), 0);
    try { await expect(solving).rejects.toMatchObject({ name: 'AbortError' }); } finally { clearTimeout(timer); }
    expect(JSON.stringify(patch)).toBe(original);
  });
});

describe('new candidate ankle trajectory conditioning', () => {
  it('rejects a single sample and retains a two-sample immutable band unchanged', async () => {
    const samples = [{ time: 0, pose: pose() }, { time: 1 / 30, pose: pose() }], before = JSON.stringify(samples);
    await expect(conditionMotionLegContacts(samples.slice(0, 1), options('full', pose(), 1 / 30))).rejects.toThrow('至少需要两个');
    expect((await conditionMotionLegContacts(samples, options('full', pose(), 1 / 30))).samples).toEqual(samples);
    expect(JSON.stringify(samples)).toBe(before);
  });

  it('keeps a moving ankle on the conservative side of the fixed axial limit throughout SO(3) interpolation', async () => {
    const { patch, source, durationSeconds } = curveFixture('interval');
    const smooth = (u: number) => { const x = Math.max(0, Math.min(1, u)); return x ** 3 * (10 - 15 * x + 6 * x * x); };
    const swing = new Quaternion(...source.joints.RightFoot);
    const rest = swing.clone().multiply(new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), -25 * Math.PI / 180)).toArray();
    source.joints.LeftFoot = [...rest]; source.joints.RightFoot = [...rest];
    for (const knot of patch.knots) {
      const time = knot.time - patch.target.startSeconds, end = patch.target.endSeconds - patch.target.startSeconds;
      const twist = -(25 + 5 * smooth((time - .25) / .15) * smooth((end - time - .25) / .15)) * Math.PI / 180;
      const foot = swing.clone().multiply(new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), twist)).toArray();
      knot.pose.root = [...source.root]; knot.pose.joints.LeftFoot = [...foot]; knot.pose.joints.RightFoot = [...foot];
      expect(isFunctionalJointWithinLimits('RightFoot', knot.pose.joints.RightFoot)).toBe(true);
    }
    const input = recomputeAIMotionPatchTangents(patch);
    const track = (candidate: AIMotionPatch) => ({ schema: 'ai-motion-track-1' as const, countMapId: 'ankle-edge', durationSeconds, patches: [candidate] });
    const rawSampler = createAIMotionSampler(() => source, track(input));
    expect(Math.max(...getMotionFeasibilitySampleTimes(input).map(time => measureFunctionalJoint('RightFoot', rawSampler(time).joints.RightFoot).errorDegrees))).toBeGreaterThan(1e-5);
    const conditioned = await conditionMotionLegContacts(input.knots, { target: input.target, boundaries: {
      start: estimateAIMotionBoundary(() => source, input.target.startSeconds, 'before', durationSeconds),
      end: estimateAIMotionBoundary(() => source, input.target.endSeconds, 'after', durationSeconds) } });
    const output = recomputeAIMotionPatchTangents({ ...input, knots: input.knots.map((knot, index) => ({ ...knot, pose: conditioned.samples[index].pose })) });
    const sampler = createAIMotionSampler(() => source, track(output));
    for (const time of getMotionFeasibilitySampleTimes(output)) expect(isFunctionalJointWithinLimits('RightFoot', sampler(time).joints.RightFoot)).toBe(true);
    const checked = await solveAIMotionFeasibility(output, { sourceSampler: () => source, durationSeconds, correct: false });
    expect(checked.report.status).toBe('accepted'); expect(checked.report.violations).toEqual([]);
    for (const index of [0, 1, 2, 38, 39, 40]) expect(output.knots[index].pose).toEqual(input.knots[index].pose);
  });

  it('removes a high frequency ankle trace on the actual curve without moving ankle/knee positions or rewriting input', async () => {
    const { patch, source, durationSeconds } = curveFixture('full');
    patch.knots.forEach((knot, index) => {
      knot.pose.root = [...source.root];
      knot.pose.joints.RightFoot = rotationFromDegrees([-12, 0, index > 10 && index < 30 ? index % 2 ? 5 : -5 : 0]);
    });
    const noisyPatch = recomputeAIMotionPatchTangents(patch), original = JSON.stringify(noisyPatch);
    const raw = await solveAIMotionFeasibility(noisyPatch, { sourceSampler: () => source, durationSeconds, correct: false });
    expect(raw.report.violations.some(violation => violation.code === 'acceleration' && violation.joint === 'RightFoot')).toBe(true);
    const result = await conditionMotionLegContacts(noisyPatch.knots, { target: noisyPatch.target,
      boundaries: { start: estimateAIMotionBoundary(() => source, 0, 'before', durationSeconds), end: estimateAIMotionBoundary(() => source, noisyPatch.target.endSeconds, 'after', durationSeconds) } });
    const conditioned = recomputeAIMotionPatchTangents({ ...noisyPatch, knots: noisyPatch.knots.map((knot, index) => ({ ...knot, pose: result.samples[index].pose })) });
    const checked = await solveAIMotionFeasibility(conditioned, { sourceSampler: () => source, durationSeconds, correct: false });
    expect(checked.report.status).toBe('accepted'); expect(checked.report.violations).toEqual([]);
    expect(result.report.maxFootPositionChangeMeters).toBe(0); expect(result.report.maxKneePositionChangeMeters).toBe(0);
    expect(result.report.maxFootMarkerPositionChangeMeters).toBeGreaterThan(0);
    expect(result.report.maxFootMarkerPositionChangeMeters).toBeLessThan(.05);
    expect(result.report.maxSoleOrientationChangeRadians).toBeLessThanOrEqual(15 * Math.PI / 180 + 1e-10);
    expect(JSON.stringify(noisyPatch)).toBe(original);
    for (let index = 0; index < result.samples.length; index++) {
      expect(result.samples[index].pose.root).toEqual(noisyPatch.knots[index].pose.root);
      for (const joint of JOINT_NAMES.filter(joint => !joint.endsWith('Foot'))) expect(result.samples[index].pose.joints[joint]).toEqual(noisyPatch.knots[index].pose.joints[joint]);
      if (index < 3) expect(result.samples[index].pose).toEqual(noisyPatch.knots[index].pose);
    }
  });
});
