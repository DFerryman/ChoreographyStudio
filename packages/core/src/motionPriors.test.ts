import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { Quaternion, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { AI_MOTION_MODEL } from './aiMotion';
import { makeAIMotionFixture } from './aiMotion.fixture';
import { makeAIMotionPlanRequest, motionPlanSources, type AIMotionPlanResult } from './aiMotionPlan';
import { evaluatePose } from './humanoid';
import { measureFunctionalJoint, CANONICAL_MOTION_FEASIBILITY_PROFILE, solveAIMotionFeasibility } from './motionFeasibility';
import { getCapsuleCollisions } from './capsuleCollision';
import { loadRapierBackend } from './rapierBackend';
import { rotationFromDegrees } from './keyframes';
import { compileAIMotionPosePatch, createAIMotionSampler } from './aiMotionTrack';
import { conditionMotionGroundingCurve, conditionMotionLegContacts } from './motionGrounding';
import { MOTION_PRIOR_CATALOG, adaptMotionPriorArmTargets, composeMotionPriorPlan, composeMotionPriorPlanAsync, decodeMotionPrior, sampleMotionPrior, type MotionPriorClip } from './motionPriors';
import { JOINT_NAMES } from './motion-types';

function bytes(id: string): ArrayBuffer {
  const raw = readFileSync(new URL(`../../../apps/web/public/motion-priors/${id}.motion`, import.meta.url));
  return raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength);
}
function clip(id = 'cmu-61-08'): MotionPriorClip {
  return decodeMotionPrior(bytes(id), MOTION_PRIOR_CATALOG.clips.find(entry => entry.id === id)!);
}
function planned(mode: 'full' | 'interval' = 'interval', durationSeconds = 32, safeBase = false) {
  const motion = makeAIMotionFixture(mode);
  if (safeBase) {
    motion.context.initialPose.root[1] = 1.055;
    motion.context.initialPose.joints.LeftUpperArm = rotationFromDegrees([0, 0, 15]);
    motion.context.initialPose.joints.RightUpperArm = rotationFromDegrees([0, 0, -15]);
    motion.context.boundaries.start.pose = structuredClone(motion.context.initialPose);
    motion.context.boundaries.end.pose = structuredClone(motion.context.initialPose);
  }
  if (mode === 'full' && durationSeconds !== 32) {
    motion.context.target.endSeconds = durationSeconds; motion.context.boundaries.end.time = durationSeconds;
    motion.context.timing.durationSeconds = durationSeconds; motion.context.timing.octetCount = durationSeconds / 4;
    motion.context.timing.countTimesSeconds = Array.from({ length: durationSeconds * 2 + 1 }, (_, index) => index * .5);
    motion.context.audio[0].coverage!.endSeconds = durationSeconds;
  }
  const request = makeAIMotionPlanRequest(motion, MOTION_PRIOR_CATALOG), range = motion.context.target;
  const segments = [{ clipId: 'cmu-61-08', startSeconds: range.startSeconds, endSeconds: range.endSeconds,
    sourceStartSeconds: 0, sourceEndSeconds: range.endSeconds - range.startSeconds, yawDegrees: 0,
    travelXZ: [0, 0] as [number, number], transitionSeconds: .5, contactHint: 'standing' as const }];
  const result: AIMotionPlanResult = { protocol: 'ai-motion-plan-1', provider: 'cloudflare-workers-ai', model: AI_MOTION_MODEL,
    requestId: motion.context.requestId, sourceHash: motion.context.sourceHash, target: range,
    catalogVersion: request.catalog.version, sources: motionPlanSources({ summary: '真人 Salsa 步法', intentMatch: 'supported', limitations: [], segments }, request.catalog),
    summary: '真人 Salsa 步法', intentMatch: 'supported', limitations: [], segments };
  return { motion, request, result, base: () => structuredClone(motion.context.initialPose) };
}

describe('licensed, pinned human-motion priors (no model calls)', () => {
  it('ships motion-only derivatives bound to their exact catalogue hash and canonical rig', () => {
    for (const entry of MOTION_PRIOR_CATALOG.clips) {
      const raw = bytes(entry.id);
      expect(createHash('sha256').update(new Uint8Array(raw)).digest('hex')).toBe(entry.sourceHash);
      const decoded = decodeMotionPrior(raw, entry);
      expect(decoded.skeletonId).toBe('neutral-rig-2');
      expect(decoded.times[0]).toBe(0); expect(decoded.times.at(-1)).toBe(entry.durationSeconds);
      expect(decoded.poses.length).toBe(decoded.times.length);
      expect(raw.byteLength).toBeLessThan(1024 * 1024);
      expect(entry.tags.length).toBeLessThanOrEqual(16);
      expect(entry.tags.every(tag => tag.length <= 80)).toBe(true);
      for (const [label, pose] of [['start', decoded.poses[0]], ['end', decoded.poses.at(-1)!]] as const) {
        const xz = entry.tags.find(tag => tag.startsWith(`wholeClip.${label}RootXZ=`))!;
        const y = entry.tags.find(tag => tag.startsWith(`wholeClip.${label}RootY=`))!;
        expect(JSON.parse(xz.split('=')[1])).toEqual([pose.root[0], pose.root[2]]);
        expect(Number(y.split('=')[1])).toBe(pose.root[1]);
      }
    }
  });

  it('redistributes the known forearm carrying frame into upper-arm axial twist', () => {
    const source = clip();
    for (let index = 0; index < source.poses.length; index += 13) {
      for (const name of ['LeftForeArm', 'RightForeArm'] as const) {
        const direction = new Vector3(0, -1, 0).applyQuaternion(new Quaternion(...source.poses[index].joints[name]));
        const flexion = Math.atan2(direction.z, -direction.y);
        expect(Math.abs(direction.x)).toBeLessThan(1e-5);
        expect(flexion).toBeGreaterThan(0);
        expect(flexion).toBeLessThan(155 * Math.PI / 180);
        const hand = source.poses[index].joints[name === 'LeftForeArm' ? 'LeftHand' : 'RightHand'];
        let wristTwist = 2 * Math.atan2(hand[1], hand[3]);
        wristTwist = ((wristTwist + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;
        expect(Math.abs(wristTwist)).toBeLessThan(8 * Math.PI / 180);
      }
    }
    // Independent full-body FK sees actual recorded steps and hand movements.
    const first = evaluatePose(sampleMotionPrior(source, 0)), later = Array.from({ length: 32 }, (_, index) => evaluatePose(sampleMotionPrior(source, (index + 1) / 4)));
    expect(Math.max(...later.map(pose => Math.hypot(...first.LeftHand.position.map((v, i) => v - pose.LeftHand.position[i]))))).toBeGreaterThan(.1);
    expect(Math.max(...later.map(pose => Math.hypot(...first.RightFoot.position.map((v, i) => v - pose.RightFoot.position[i]))))).toBeGreaterThan(.05);
  });

  it('rejects foreign rigs, malformed time data, byte truncation and non-unit rotations', () => {
    const entry = MOTION_PRIOR_CATALOG.clips[0], raw = bytes(entry.id), start = 20 + new DataView(raw).getUint32(16, true);
    expect(() => decodeMotionPrior(raw, { ...entry, skeletonId: 'foreign' })).toThrow();
    expect(() => decodeMotionPrior(raw.slice(0, -1), entry)).toThrow();
    const times = raw.slice(0); new DataView(times).setFloat64(start + 420, 0, true);
    expect(() => decodeMotionPrior(times, entry)).toThrow(/时间/);
    const rotation = raw.slice(0); new DataView(rotation).setFloat32(start + 8 + 12, 1, true);
    expect(() => decodeMotionPrior(rotation, entry)).toThrow(/旋转/);
  });

  it('composes genuine source motion without changing original source poses or interval context', () => {
    const { request, result, base } = planned(), source = clip(), originalSource = JSON.stringify(source), originals = JSON.stringify([request, result, source]);
    const output = composeMotionPriorPlan(request, result, new Map([[source.id, source]]), base);
    expect(output.samples).toHaveLength(119);
    expect(output.samples[0].time).toBeGreaterThan(4); expect(output.samples.at(-1)!.time).toBeLessThan(8);
    const middle = output.samples.find(sample => sample.time === 6)!, recorded = sampleMotionPrior(source, 2), origin = sampleMotionPrior(source, 0);
    for (const joint of JOINT_NAMES) if (!/UpperArm|ForeArm|Hand$|UpperLeg|LowerLeg|Foot$|^Neck$|^Head$|^Spine$/.test(joint)) expect(middle.pose.joints[joint]).toEqual(recorded.joints[joint]);
    const fittedWorld = evaluatePose(middle.pose), sourceWorld = evaluatePose({ ...recorded, root: middle.pose.root });
    const changedHands = ['LeftHand', 'RightHand'].map(name => {
      const hand = name as 'LeftHand' | 'RightHand';
      return new Vector3(...fittedWorld[hand].position).distanceTo(new Vector3(...sourceWorld[hand].position));
    });
    expect(Math.max(...changedHands)).toBeGreaterThan(.01);
    expect(output.adaptation.maxHandDisplacementMeters).toBeGreaterThanOrEqual(Math.max(...changedHands) - 1e-8);
    expect(output.adaptation.rmsHandDisplacementMeters).toBeGreaterThan(0);
    expect(middle.pose.root[0]).toBeCloseTo(recorded.root[0] - origin.root[0], 12);
    expect(middle.pose.root[1]).toBe(recorded.root[1]);
    expect(middle.pose.root[2]).toBeCloseTo(recorded.root[2] - origin.root[2], 12);
    expect(output.origin).toMatchObject({ kind: 'human-motion-prior', catalogVersion: MOTION_PRIOR_CATALOG.version, sources: result.sources });
    expect(output.endingAdaptation).toBeUndefined(); expect(output.origin.endingAdaptation).toBeUndefined();
    expect(JSON.stringify([request, result, source])).toBe(originals);
    output.samples[0].pose.root[0] = 100;
    expect(JSON.stringify(source)).toBe(originalSource);
  });

  it('uses dense recorded poses in full generation and rejects source-version or semantic mismatches', () => {
    const { request, result, base } = planned('full'), source = clip();
    const output = composeMotionPriorPlan(request, result, new Map([[source.id, source]]), base);
    expect(output.samples).toHaveLength(960); expect(output.samples.at(-1)!.time).toBe(32);
    expect(output.endingAdaptation).toEqual({ kind: 'stable-hold', seconds: 1.5 });
    expect(output.origin.endingAdaptation).toEqual(output.endingAdaptation);
    expect(output.samples.at(-1)!.pose.root[1]).toBe(1.055);
    expect(output.samples.length).toBeGreaterThan(48);
    expect(() => composeMotionPriorPlan(request, result, new Map([[source.id, { ...source, sourceHash: 'a'.repeat(64) }]]), base)).toThrow(/变化/);
    const unsupported: AIMotionPlanResult = { ...result, intentMatch: 'unsupported', limitations: ['参考没有该舞种。'], segments: [], sources: [] };
    expect(() => composeMotionPriorPlan(request, unsupported, new Map(), base)).toThrow(/无法满足/);
  }, 10_000);

  it('continues the outgoing capture through a timed transition and applies only the planned yaw/travel', () => {
    const { request, result, base } = planned('full', 16), source = clip();
    result.segments = [
      { ...result.segments[0], endSeconds: 8, sourceEndSeconds: 8 },
      { ...result.segments[0], startSeconds: 8, sourceStartSeconds: 24, sourceEndSeconds: 32,
        yawDegrees: 90, travelXZ: [1, .5], transitionSeconds: 1 },
    ];
    const output = composeMotionPriorPlan(request, result, new Map([[source.id, source]]), base);
    const seam = output.samples.find(sample => sample.time === 8)!, outgoing = sampleMotionPrior(source, 8);
    for (const joint of JOINT_NAMES) if (!/UpperArm|ForeArm|Hand$|UpperLeg|LowerLeg|Foot$|^Neck$|^Head$|^Spine$/.test(joint)) expect(seam.pose.joints[joint]).toEqual(outgoing.joints[joint]);
    const incoming = output.samples.find(sample => sample.time === 9)!, recorded = sampleMotionPrior(source, 25);
    const yaw = new Quaternion(0, Math.SQRT1_2, 0, Math.SQRT1_2);
    const expectedHips = yaw.multiply(new Quaternion(...recorded.joints.Hips)).normalize().toArray();
    for (let axis = 0; axis < 4; axis++) expect(incoming.pose.joints.Hips[axis]).toBeCloseTo(expectedHips[axis], 12);
    expect(incoming.pose.joints.LeftToe).toEqual(recorded.joints.LeftToe);
    // Height is captured data; horizontal travel/turning does not flatten or
    // force an upright pose. The whole-trajectory solver owns physical limits.
    expect(incoming.pose.root[1]).toBe(recorded.root[1]);
    expect(output.origin.segments).toEqual(result.segments);
    output.origin.segments[1].travelXZ[0] = 99;
    expect(result.segments[1].travelXZ).toEqual([1, .5]);
  });

  it('does not read unselected source poses while continuing the outgoing endpoint velocity', () => {
    const { request, result, base } = planned(), source = clip();
    result.segments = [
      { ...result.segments[0], endSeconds: 6, sourceEndSeconds: 2 },
      { ...result.segments[0], startSeconds: 6, sourceStartSeconds: 24, sourceEndSeconds: 26, transitionSeconds: .5 },
    ];
    const original = composeMotionPriorPlan(request, result, new Map([[source.id, source]]), base);
    const changed = structuredClone(source);
    for (const [index, time] of changed.times.entries()) if (time > 2 && time < 24) changed.poses[index].root[1] = 99;
    const recomposed = composeMotionPriorPlan(request, result, new Map([[changed.id, changed]]), base);
    expect(recomposed.samples).toEqual(original.samples);
  });

  it('keeps Salsa and upright-street ankle/tibial twist within bounds without certifying advanced floor capture', () => {
    for (const source of [clip('cmu-61-08'), clip('cmu-85-12-a')]) for (let index = 0; index < source.poses.length; index++) {
      for (const side of ['Left', 'Right'] as const) {
        const twist = (name: 'LeftFoot' | 'RightFoot' | 'LeftLowerLeg' | 'RightLowerLeg') => {
          const q = source.poses[index].joints[name], angle = 2 * Math.atan2(q[1], q[3]);
          return ((angle + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;
        };
        expect(Math.abs(twist(`${side}Foot`))).toBeLessThanOrEqual(30 * Math.PI / 180 + 1e-6);
        expect(Math.abs(twist(`${side}LowerLeg`))).toBeLessThanOrEqual(25 * Math.PI / 180 + 1e-6);
      }
    }
    const source = clip(), original = sampleMotionPrior(source, 149 / 30), fitted = adaptMotionPriorArmTargets(original);
    expect(fitted.root).toEqual(original.root);
    for (const joint of JOINT_NAMES) if (!/UpperArm|ForeArm|Hand$/.test(joint)) expect(fitted.joints[joint]).toEqual(original.joints[joint]);
    const world = evaluatePose(fitted);
    expect(world.LeftHand.position.every(Number.isFinite)).toBe(true); expect(world.RightHand.position.every(Number.isFinite)).toBe(true);
  });

  it('matches synchronous composition and cancels during yielded generation batches', async () => {
    const { request, result, base } = planned(), source = clip(), map = new Map([[source.id, source]]);
    const expected = composeMotionPriorPlan(request, result, map, base);
    expect(await composeMotionPriorPlanAsync(request, result, map, base)).toEqual(expected);
    const controller = new AbortController();
    const pending = composeMotionPriorPlanAsync(request, result, map, base, { signal: controller.signal });
    setTimeout(() => controller.abort(), 0);
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    await expect(composeMotionPriorPlanAsync(request, result, map, base, { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('conditions an actual complete16-second arm and stance trajectory under the existing bounds', async () => {
    const { request, result, base } = planned('full', 16, true), source = clip();
    const composition = composeMotionPriorPlan(request, result, new Map([[source.id, source]]), base);
    const samples = [{ time: 0, pose: base() }, ...composition.samples];
    for (const joint of JOINT_NAMES.filter(name => /UpperArm|ForeArm|Hand$/.test(name))) {
      let previous: Vector3 | undefined;
      for (let index = 1; index < samples.length; index++) {
        const q = new Quaternion(...samples[index].pose.joints[joint]).multiply(new Quaternion(...samples[index - 1].pose.joints[joint]).invert());
        if (q.w < 0) { q.x *= -1; q.y *= -1; q.z *= -1; q.w *= -1; }
        const sine = Math.hypot(q.x, q.y, q.z), dt = samples[index].time - samples[index - 1].time;
        const velocity = sine < 1e-12 ? new Vector3() : new Vector3(q.x, q.y, q.z).multiplyScalar(2 * Math.atan2(sine, q.w) / sine / dt);
        expect(velocity.length()).toBeLessThan(CANONICAL_MOTION_FEASIBILITY_PROFILE.maxJointSpeedRadiansPerSecond);
        if (previous) expect(velocity.clone().sub(previous).length() / dt).toBeLessThan(CANONICAL_MOTION_FEASIBILITY_PROFILE.maxJointAccelerationRadiansPerSecondSquared);
        expect(measureFunctionalJoint(joint, samples[index].pose.joints[joint]).errorDegrees).toBeLessThan(1e-5);
        previous = velocity;
      }
    }
    expect(composition.origin.adaptations).toContain('arm-so3-trajectory-1');
    expect(composition.origin.adaptationMetrics).toMatchObject({ maxHandDisplacementMeters: composition.adaptation.maxHandDisplacementMeters,
      rmsHandDisplacementMeters: composition.adaptation.rmsHandDisplacementMeters });
    expect(composition.adaptation.maxIKTargetErrorMeters).toBeGreaterThan(0);
    expect(composition.origin.adaptations).toContain('quaternius-cmu61-stance-1');
    expect(composition.origin.adaptationMetrics).toMatchObject({ maxFootDisplacementMeters: composition.adaptation.maxFootDisplacementMeters,
      rmsFootDisplacementMeters: composition.adaptation.rmsFootDisplacementMeters, maxKneeDisplacementMeters: composition.adaptation.maxKneeDisplacementMeters });
    await loadRapierBackend();
    for (const sample of composition.samples) {
      expect(getCapsuleCollisions(sample.pose).selfCollisions).toEqual([]);
      for (const joint of ['LeftUpperLeg', 'RightUpperLeg', 'LeftLowerLeg', 'RightLowerLeg', 'LeftFoot', 'RightFoot'] as const)
        expect(measureFunctionalJoint(joint, sample.pose.joints[joint]).errorDegrees).toBeLessThan(1e-5);
    }
    // Feet are explicit soft goals in new retargeted motion, never silently
    // claimed unchanged. No source or frozen boundary is rewritten.
    expect(composition.adaptation.maxFootDisplacementMeters).toBeGreaterThan(.05);
    expect(composition.adaptation.maxFootDisplacementMeters).toBeLessThan(.3);
    expect(composition.adaptation.maxKneeDisplacementMeters).toBeLessThan(.3);
    expect(composition.endingAdaptation).toEqual({ kind: 'stable-hold', seconds: 1.5 });
    expect(composition.origin.adaptations).toContain('full-hold-settle-1');
  });

  it('conditions the captured Street plan for 4..9.5 under the unchanged full curve gate without altering source or anchors', async ({ signal }) => {
    // Same numeric plan as the real ordinary-Street failure, with synthetic
    // protocol identities and metadata only; no saved scene or audio is read.
    const motion = makeAIMotionFixture('interval');
    motion.context.target.endSeconds = 9.5;
    motion.context.boundaries.end.time = 9.5;
    motion.context.initialPose.joints.LeftUpperArm = rotationFromDegrees([0, 0, 15]);
    motion.context.initialPose.joints.RightUpperArm = rotationFromDegrees([0, 0, -15]);
    const base = () => structuredClone(motion.context.initialPose);
    motion.context.boundaries.start.pose = base(); motion.context.boundaries.end.pose = base();
    motion.context.before = [{ time: 3, pose: base() }]; motion.context.after = [{ time: 10.5, pose: base() }];
    const request = makeAIMotionPlanRequest(motion, MOTION_PRIOR_CATALOG), source = clip('cmu-85-12');
    const output = { summary: '真人街舞连续站立步法', intentMatch: 'supported' as const, limitations: [], segments: [{
      clipId: source.id, startSeconds: 4, endSeconds: 9.5, sourceStartSeconds: 0, sourceEndSeconds: 5.5,
      yawDegrees: 0, travelXZ: [0, 0] as [number, number], transitionSeconds: 0, contactHint: 'floor' as const,
    }] };
    const result: AIMotionPlanResult = { ...output, protocol: 'ai-motion-plan-1', provider: 'cloudflare-workers-ai', model: AI_MOTION_MODEL,
      requestId: motion.context.requestId, sourceHash: motion.context.sourceHash, target: motion.context.target,
      catalogVersion: request.catalog.version, sources: motionPlanSources(output, request.catalog) };
    const originalSource = JSON.stringify(source), originalRequest = JSON.stringify(request), originalResult = JSON.stringify(result);
    const composition = composeMotionPriorPlan(request, result, new Map([[source.id, source]]), base);
    expect(composition.origin.adaptations).toContain('upperleg-so3-trajectory-1');
    expect(composition.origin.adaptations).toContain('knee-flex-trajectory-1');
    expect(composition.origin.adaptations).not.toContain('quaternius-cmu61-stance-1');
    expect(composition.origin.adaptations).not.toContain('shin-axial-trajectory-1');
    expect(composition.adaptation.maxFootDisplacementMeters).toBeGreaterThan(0);
    expect(composition.adaptation.maxFootDisplacementMeters).toBeLessThan(.15);
    expect(composition.adaptation.maxKneeDisplacementMeters).toBeLessThan(.08);
    const feet = await conditionMotionLegContacts(composition.samples, { target: motion.context.target, boundaries: motion.context.boundaries, signal });
    const origin = { ...composition.origin, adaptations: [...composition.origin.adaptations!, 'motion-leg-contact-conditioning-1', 'motion-curve-grounding-1'],
      adaptationMetrics: { ...composition.origin.adaptationMetrics!, maxSoleSmoothingRadians: feet.report.maxSoleOrientationChangeRadians,
        maxFootMarkerDisplacementMeters: feet.report.maxFootMarkerPositionChangeMeters } };
    const draft = compileAIMotionPosePatch(motion, result, feet.samples, base, origin);
    const options = { sourceSampler: base, durationSeconds: 32, signal, contacts: [{ startSeconds: 4, endSeconds: 9.5, mode: 'supported' as const }] };
    const grounded = await conditionMotionGroundingCurve(draft, options);
    const checked = await solveAIMotionFeasibility(grounded.patch, { ...options,
      conditionCandidate: async (patch, repairSignal) => (await conditionMotionGroundingCurve(patch, { ...options, signal: repairSignal })).patch });
    expect(checked.report.status, JSON.stringify(checked.report.violations)).toBe('accepted');
    expect(checked.report.totalViolations).toBe(0);
    expect(checked.report.coverage.complete).toBe(true); expect(checked.report.derivativeCoverage.complete).toBe(true);
    expect(checked.report.metrics.maxJointAccelerationRadiansPerSecondSquared).toBeLessThanOrEqual(CANONICAL_MOTION_FEASIBILITY_PROFILE.maxJointAccelerationRadiansPerSecondSquared);
    expect(grounded.report.maxRootCorrectionMeters).toBeLessThanOrEqual(.060000001);
    expect(checked.patch!.knots[0]).toEqual(draft.knots[0]); expect(checked.patch!.knots.at(-1)).toEqual(draft.knots.at(-1));
    const sampler = createAIMotionSampler(base, { schema: 'ai-motion-track-1', countMapId: motion.context.timing.id, durationSeconds: 32, patches: [checked.patch!] });
    for (const time of [0, 3.997, 4, 9.5, 9.503, 16, 32]) expect(sampler(time)).toEqual(base());
    expect(JSON.stringify(source)).toBe(originalSource); expect(JSON.stringify(request)).toBe(originalRequest); expect(JSON.stringify(result)).toBe(originalResult);
  }, 30000);

  it('omits a grid knot numerically adjacent to a frozen interval endpoint', () => {
    const { motion, base } = planned();
    motion.context.target = { mode: 'interval', startSeconds: 1 / 30, endSeconds: .2 };
    motion.context.boundaries.start.time = 1 / 30; motion.context.boundaries.end.time = .2;
    motion.context.before = [{ time: 0, pose: base() }]; motion.context.after = [{ time: .25, pose: base() }];
    const request = makeAIMotionPlanRequest(motion, MOTION_PRIOR_CATALOG), source = clip();
    const segment = { clipId: source.id, startSeconds: 1 / 30, endSeconds: .2, sourceStartSeconds: 0, sourceEndSeconds: .2 - 1 / 30,
      yawDegrees: 0, travelXZ: [0, 0] as [number, number], transitionSeconds: 0, contactHint: 'standing' as const };
    const body = { summary: '短区间', intentMatch: 'supported' as const, limitations: [], segments: [segment] };
    const result: AIMotionPlanResult = { protocol: 'ai-motion-plan-1', provider: 'cloudflare-workers-ai', model: AI_MOTION_MODEL,
      requestId: motion.context.requestId, sourceHash: motion.context.sourceHash, target: motion.context.target,
      catalogVersion: request.catalog.version, sources: motionPlanSources(body, request.catalog), ...body };
    const output = composeMotionPriorPlan(request, result, new Map([[source.id, source]]), base);
    expect(output.samples).toHaveLength(4);
    expect(.2 - output.samples.at(-1)!.time).toBeGreaterThan(.03);
    expect(motion.context.boundaries.end.time).toBe(.2);
  });
});
