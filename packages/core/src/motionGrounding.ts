/** Offline conditioning of NEW candidate motion only. Original scene data and
 * immutable boundary bands stay exact; new foot fidelity changes are measured.
 * Aggregate COM/contact conditioning does not grant physical acceptance or
 * establish complete articulated dynamics. The independent whole curve gate
 * remains authoritative. */
import { Quaternion, Vector3 } from 'three';
import { clonePose, evaluatePose, RIG_CALIBRATION_VERSION, type EvaluatedPose } from './humanoid';
import { STANDARD_HUMAN_PROFILE as HUMAN } from './humanProfile';
import { CANONICAL_MOTION_FEASIBILITY_PROFILE, computeMotionCenterOfMass, getMotionFeasibilitySampleTimes, getMotionMinimumFloorHeight, inferMotionSupportGeometry } from './motionFeasibility';
import type { MotionContactHint } from './motionFeasibility';
import { JOINT_NAMES, type Pose, type Quat, type Vec3 } from './motion-types';
import type { AIMotionBoundary, AIMotionTarget } from './aiMotion';
import { createAIMotionSampler, type AIMotionPatch, type AIMotionPoseSampler } from './aiMotionTrack';

export const MOTION_GROUNDING_MAX_ROOT_CORRECTION_METERS = .06;
export interface MotionGroundingSample { time: number; pose: Pose }
export interface MotionGroundingOptions {
  target: AIMotionTarget;
  boundaries: { start: AIMotionBoundary; end: AIMotionBoundary };
  sourceHash?: string;
  signal?: AbortSignal;
}
export interface MotionGroundingForceMetrics {
  groundedSamples: number;
  minNormalForceNewtons: number;
  maxFrictionExcessNewtons: number;
  forceViolationSamples: number;
}
export interface MotionGroundingReport {
  schema: 'motion-grounding-1';
  applied: boolean;
  iterations: number;
  scope: 'sampled-com-contact-conditioning';
  articulatedDynamics: false;
  physicalParameters: { massKg: number; gravityMps2: number; friction: number };
  provenance: { rigId: typeof RIG_CALIBRATION_VERSION; humanProfileId: typeof HUMAN.id; sourceHash: string | null; inputSamples: number };
  maxRootCorrectionMeters: number;
  maxFootPositionResidualMeters: number;
  maxFootRotationResidualRadians: number;
  before: MotionGroundingForceMetrics;
  after: MotionGroundingForceMetrics;
}
export interface MotionGroundingResult { samples: MotionGroundingSample[]; report: MotionGroundingReport }
const ZERO: Vec3 = [0, 0, 0];
const clamp = (x: number, low: number, high: number) => Math.max(low, Math.min(high, x));
const abort = (signal?: AbortSignal) => { if (signal?.aborted) throw new DOMException('动作接触处理已取消。', 'AbortError'); };
const yieldTask = () => new Promise<void>(resolve => setTimeout(resolve, 0));
const exactPose = (a: Pose, b: Pose) => a.root.every((value, axis) => value === b.root[axis]) && JOINT_NAMES.every(joint => a.joints[joint].every((value, axis) => value === b.joints[joint][axis]));
/** Same fixed segment-mass estimator as the whole-trajectory detector. */
export const groundingCenterOfMass = computeMotionCenterOfMass;
function acceleration(points: readonly Vec3[], times: readonly number[], index: number): Vec3 {
  const before = times[index] - times[index - 1], after = times[index + 1] - times[index], middle = (before + after) / 2;
  return points[index].map((_, axis) => ((points[index + 1][axis] - points[index][axis]) / after - (points[index][axis] - points[index - 1][axis]) / before) / middle) as Vec3;
}
function forceMetrics(points: readonly Vec3[], times: readonly number[], supported: readonly boolean[]): MotionGroundingForceMetrics {
  const result: MotionGroundingForceMetrics = { groundedSamples: 0, minNormalForceNewtons: 0, maxFrictionExcessNewtons: 0, forceViolationSamples: 0 };
  for (let i = 1; i < points.length - 1; i++) {
    if (!supported[i - 1] || !supported[i] || !supported[i + 1]) continue;
    const a = acceleration(points, times, i), normal = HUMAN.massKg * (HUMAN.gravityMps2 + a[1]);
    const excess = HUMAN.massKg * Math.hypot(a[0], a[2]) - HUMAN.ground.friction * Math.max(0, normal);
    if (!result.groundedSamples++) result.minNormalForceNewtons = normal; else result.minNormalForceNewtons = Math.min(result.minNormalForceNewtons, normal);
    result.maxFrictionExcessNewtons = Math.max(result.maxFrictionExcessNewtons, excess);
    // Same disclosed numerical tolerance as the final detector, never adjusted
    // to make this individual reference pass.
    if (normal < -HUMAN.massKg * .75 || excess > HUMAN.massKg * .75) result.forceViolationSamples++;
  }
  return result;
}
function coneProjection(a: Vec3): Vec3 {
  const horizontal = Math.hypot(a[0], a[2]), normal = HUMAN.gravityMps2 + a[1], mu = HUMAN.ground.friction;
  // A small fixed interior margin avoids relying on the detector's tolerance.
  const margin = .25, required = horizontal / mu + margin;
  if (normal >= required) return a;
  if (horizontal < 1e-12) return [0, Math.max(margin, normal) - HUMAN.gravityMps2, 0];
  const projectedNormal = Math.max(margin, (normal + mu * horizontal + mu * mu * margin) / (1 + mu * mu));
  const projectedHorizontal = mu * Math.max(0, projectedNormal - margin), scale = projectedHorizontal / horizontal;
  return [a[0] * scale, projectedNormal - HUMAN.gravityMps2, a[2] * scale];
}
function bounded(correction: Vec3, world: EvaluatedPose): Vec3 {
  const value = new Vector3(...correction);
  if (value.length() > MOTION_GROUNDING_MAX_ROOT_CORRECTION_METERS) value.setLength(MOTION_GROUNDING_MAX_ROOT_CORRECTION_METERS);
  // Intersect the two leg-reach balls. This prevents raising a straight leg's
  // hip beyond its ankle target while all original world foot poses stay fixed.
  for (let pass = 0; pass < 3; pass++) for (const side of ['Left', 'Right'] as const) {
    const hip = new Vector3(...world[`${side}UpperLeg`].position), foot = new Vector3(...world[`${side}Foot`].position);
    const delta = hip.clone().add(value).sub(foot), length = delta.length(), maximum = .46 + .45 - 1e-9;
    if (length > maximum) value.addScaledVector(delta, -(length - maximum) / length);
  }
  if (value.length() > MOTION_GROUNDING_MAX_ROOT_CORRECTION_METERS) value.setLength(MOTION_GROUNDING_MAX_ROOT_CORRECTION_METERS);
  return value.toArray() as Vec3;
}
function solve3(matrix: number[][], rhs: Vec3): Vec3 {
  const rows = matrix.map((row, index) => [...row, rhs[index]]);
  for (let i = 0; i < 3; i++) {
    let pivot = i;
    for (let j = i + 1; j < 3; j++) if (Math.abs(rows[j][i]) > Math.abs(rows[pivot][i])) pivot = j;
    [rows[i], rows[pivot]] = [rows[pivot], rows[i]];
    if (Math.abs(rows[i][i]) < 1e-12) return [0, 0, 0];
    const scale = rows[i][i]; for (let col = i; col < 4; col++) rows[i][col] /= scale;
    for (let row = 0; row < 3; row++) if (row !== i) { const amount = rows[row][i]; for (let col = i; col < 4; col++) rows[row][col] -= amount * rows[i][col]; }
  }
  return rows.map(row => row[3]) as Vec3;
}
function multiply(matrix: number[][], vector: Vec3): Vec3 { return matrix.map(row => row.reduce((sum, value, axis) => sum + value * vector[axis], 0)) as Vec3; }
const twistY = (q: Quaternion) => ((2 * Math.atan2(q.y, q.w) + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;
function comJacobian(source: Pose, correction: Vec3, world: EvaluatedPose): number[][] {
  const epsilon = .0002, columns: Vec3[] = [];
  for (let axis = 0; axis < 3; axis++) {
    const plus = [...correction] as Vec3, minus = [...correction] as Vec3; plus[axis] += epsilon; minus[axis] -= epsilon;
    const a = groundingCenterOfMass(restoreFeet(source, bounded(plus, world), world));
    const b = groundingCenterOfMass(restoreFeet(source, bounded(minus, world), world));
    columns.push(a.map((value, coordinate) => (value - b[coordinate]) / (2 * epsilon)) as Vec3);
  }
  return [0, 1, 2].map(row => columns.map(column => column[row]));
}
/** Preserve the captured knee pole and leg twist rather than seeding every
 * frame from a generic bend. End rotation preserves sole/toe/heel world poses. */
function restoreFeet(source: Pose, rootCorrection: Vec3, world: EvaluatedPose, targetWorld: EvaluatedPose = world): Pose {
  const result = clonePose(source);
  if (Math.hypot(...rootCorrection) < 1e-14 && targetWorld === world) return result;
  result.root = result.root.map((value, axis) => value + rootCorrection[axis]) as Vec3;
  for (const side of ['Left', 'Right'] as const) {
    const upper = `${side}UpperLeg` as const, lower = `${side}LowerLeg` as const, foot = `${side}Foot` as const;
    const hip = new Vector3(...world[upper].position).add(new Vector3(...rootCorrection)), target = new Vector3(...targetWorld[foot].position);
    const sourceHip = new Vector3(...world[upper].position), sourceKnee = new Vector3(...world[lower].position);
    const direction = target.clone().sub(hip), length = clamp(direction.length(), .01000001, .909999999);
    direction.normalize();
    const pole = sourceKnee.clone().sub(sourceHip).addScaledVector(direction, -sourceKnee.clone().sub(sourceHip).dot(direction));
    if (pole.lengthSq() < 1e-12) pole.set(0, 0, 1).applyQuaternion(new Quaternion(...world.Hips.rotation)).addScaledVector(direction, -new Vector3(0, 0, 1).applyQuaternion(new Quaternion(...world.Hips.rotation)).dot(direction));
    if (pole.lengthSq() < 1e-12) pole.set(1, 0, 0).addScaledVector(direction, -direction.x);
    pole.normalize();
    const along = (.46 * .46 + length * length - .45 * .45) / (2 * length), height = Math.sqrt(Math.max(0, .46 * .46 - along * along));
    const knee = hip.clone().addScaledVector(direction, along).addScaledVector(pole, height);
    const oldUpper = sourceKnee.clone().sub(sourceHip).normalize(), newUpper = knee.clone().sub(hip).normalize();
    const upperWorld = new Quaternion().setFromUnitVectors(oldUpper, newUpper).multiply(new Quaternion(...world[upper].rotation)).normalize();
    const oldLower = new Vector3(...world[foot].position).sub(sourceKnee).normalize(), newLower = target.clone().sub(knee).normalize();
    const lowerWorld = new Quaternion().setFromUnitVectors(oldLower, newLower).multiply(new Quaternion(...world[lower].rotation)).normalize();
    // Keep captured ankle longitudinal twist in its original local frame. A
    // small root adjustment must not push a foot already at its calibrated Y
    // bound into a later clamp/floor lift. These axial rotations leave both
    // fixed-length segment endpoints and the complete world foot pose intact.
    const originalFoot = new Quaternion(...source.joints[foot]);
    const footLocal = lowerWorld.clone().invert().multiply(new Quaternion(...targetWorld[foot].rotation));
    const ankleTwistDelta = twistY(footLocal) - twistY(originalFoot);
    lowerWorld.multiply(new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), ankleTwistDelta)).normalize();
    const lowerLocal = upperWorld.clone().invert().multiply(lowerWorld), kneeTwist = twistY(lowerLocal), kneeLimit = 25 * Math.PI / 180;
    const excessKneeTwist = kneeTwist - clamp(kneeTwist, -kneeLimit, kneeLimit);
    if (Math.abs(excessKneeTwist) > 1e-12) upperWorld.multiply(new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), excessKneeTwist)).normalize();
    result.joints[upper] = new Quaternion(...world.Hips.rotation).invert().multiply(upperWorld).normalize().toArray() as Quat;
    result.joints[lower] = upperWorld.clone().invert().multiply(lowerWorld).normalize().toArray() as Quat;
    result.joints[foot] = lowerWorld.clone().invert().multiply(new Quaternion(...targetWorld[foot].rotation)).normalize().toArray() as Quat;
  }
  return result;
}

export interface MotionLegContactReport {
  schema: 'motion-leg-contact-conditioning-1';
  sigmaSeconds: number;
  provenance: { rigId: typeof RIG_CALIBRATION_VERSION; sourceHash: string | null; inputSamples: number };
  maxSoleOrientationChangeRadians: number;
  maxFootPositionChangeMeters: number;
  maxKneePositionChangeMeters: number;
  maxFootMarkerPositionChangeMeters: number;
  sourceFootAngularAccelerationRadiansPerSecondSquared: number;
  conditionedFootAngularAccelerationRadiansPerSecondSquared: number;
  articulatedDynamics: false;
}
export interface MotionLegContactResult { samples: MotionGroundingSample[]; report: MotionLegContactReport }
const rotationVector = (q: Quaternion): Vector3 => {
  if (q.w < 0) q.set(-q.x, -q.y, -q.z, -q.w);
  const sine = Math.hypot(q.x, q.y, q.z);
  return new Vector3(q.x, q.y, q.z).multiplyScalar(sine < 1e-12 ? 2 : 2 * Math.atan2(sine, q.w) / sine);
};
const quaternionVector = (v: Vector3): Quaternion => {
  const angle = v.length();
  return angle < 1e-12 ? new Quaternion() : new Quaternion().setFromAxisAngle(v.clone().multiplyScalar(1 / angle), angle);
};
function maxFootAcceleration(samples: readonly MotionGroundingSample[]): number {
  let maximum = 0;
  for (let i = 2; i < samples.length; i++) for (const foot of ['LeftFoot', 'RightFoot'] as const) {
    const a = samples[i - 2], b = samples[i - 1], c = samples[i], dt0 = b.time - a.time, dt1 = c.time - b.time;
    const q0 = new Quaternion(...a.pose.joints[foot]), q1 = new Quaternion(...b.pose.joints[foot]), q2 = new Quaternion(...c.pose.joints[foot]);
    const v0 = rotationVector(q0.clone().invert().multiply(q1)).applyQuaternion(q0).divideScalar(dt0);
    const v1 = rotationVector(q1.clone().invert().multiply(q2)).applyQuaternion(q1).divideScalar(dt1);
    maximum = Math.max(maximum, v1.distanceTo(v0) / ((dt0 + dt1) / 2));
  }
  return maximum;
}
/** C2 join from a flat limit to identity. This small inner margin absorbs
 * cubic SO(3) overshoot at a legitimate surface without moving the surface. */
function positivePartC2(value: number, width: number): number {
  if (value <= 0) return 0;
  if (value >= width) return value;
  const u = value / width;
  return width * u ** 3 * (6 - 8 * u + 3 * u * u);
}
function insideScalar(value: number, bounds: readonly [number, number], margin: number, band: number): number {
  const low = bounds[0] + margin, high = bounds[1] - margin;
  return value > high - band ? high - positivePartC2(high - value, band) :
    value < low + band ? low + positivePartC2(value - low, band) : value;
}
function boundedCorrectionAngle(angle: number, budget: number): number {
  const band = Math.min(budget / 3, 5 * Math.PI / 180), start = budget - band;
  if (angle <= start) return angle;
  if (angle >= budget + band) return budget;
  const u = (angle - start) / (2 * band);
  // Identity joins a flat bound with continuous first and second derivatives;
  // small useful corrections remain unattenuated, unlike a global tanh.
  return start + 2 * band * (u - u ** 3 + .5 * u ** 4);
}
function interiorFootRotation(joint: 'LeftFoot' | 'RightFoot', rotation: Quaternion): Quaternion {
  const envelope = CANONICAL_MOTION_FEASIBILITY_PROFILE.envelopes[joint]!;
  const radians = Math.PI / 180, margin = .02 * radians, band = .05 * radians;
  const originalTwist = twistY(rotation), twist = insideScalar(originalTwist, envelope.twistDegrees.map(value => value * radians) as [number, number], margin, band);
  const down = new Vector3(0, -1, 0), direction = down.clone().applyQuaternion(rotation);
  const flexion = Math.atan2(direction.z, -direction.y), lateral = Math.atan2(direction.x, Math.hypot(direction.y, direction.z));
  const flex = envelope.flexionDegrees ? insideScalar(flexion, envelope.flexionDegrees.map(value => value * radians) as [number, number], margin, band) : flexion;
  const side = envelope.lateralDegrees ? insideScalar(lateral, envelope.lateralDegrees.map(value => value * radians) as [number, number], margin, band) : lateral;
  const swing = flex !== flexion || side !== lateral ? new Quaternion().setFromUnitVectors(down,
    new Vector3(Math.sin(side), -Math.cos(flex) * Math.cos(side), Math.sin(flex) * Math.cos(side))) :
    rotation.clone().multiply(new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), -originalTwist));
  const angle = rotationVector(swing.clone()).length(), maximum = envelope.swingDegrees! * radians - margin;
  if (angle > maximum - band) {
    const target = maximum - positivePartC2(maximum - angle, band);
    swing.slerp(new Quaternion(), 1 - target / angle);
  }
  return swing.multiply(new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), twist)).normalize();
}
/** Modest whole-trajectory leg/ankle denoising for a NEW candidate. Captured
 * stepping times are preserved, while foot position changes are reported. Sole orientation may
 * change by a smoothly bounded15deg correction; the subsequent actual-curve
 * solver and independent gate must establish actual contact and feasible motion.
 * Floor-hand/inverted phases are left to the full-body solver unchanged. */
export async function conditionMotionLegContacts(samples: readonly MotionGroundingSample[], options: MotionGroundingOptions): Promise<MotionLegContactResult> {
  abort(options.signal);
  const { target } = options, sigma = .05, maximumSoleAngle = 15 * Math.PI / 180;
  if (samples.length < 2) throw new Error('下肢处理至少需要两个时间样本。');
  if (samples.length > 1801 || !Number.isFinite(target.startSeconds) || !Number.isFinite(target.endSeconds) ||
    target.endSeconds <= target.startSeconds || target.endSeconds - target.startSeconds > 60 ||
    target.mode !== 'full' && target.mode !== 'interval' || options.sourceHash !== undefined && !/^[a-f0-9]{64}$/.test(options.sourceHash) ||
    options.boundaries.start.time !== target.startSeconds || options.boundaries.end.time !== target.endSeconds ||
    samples.some((sample, index) => !Number.isFinite(sample.time) || sample.time <= (index ? samples[index - 1].time : target.startSeconds - 1) || sample.time < target.startSeconds || sample.time > target.endSeconds)) throw new Error('下肢处理需要有效且递增的固定区间样本。');
  const reference = samples.map(sample => ({ time: sample.time, pose: clonePose(sample.pose) })), worlds = reference.map(sample => evaluatePose(sample.pose));
  const groups = ['LeftFoot', 'RightFoot'] as const;
  const filtered: MotionGroundingSample[] = [], report: MotionLegContactReport = { schema: 'motion-leg-contact-conditioning-1', sigmaSeconds: sigma,
    provenance: { rigId: RIG_CALIBRATION_VERSION, sourceHash: options.sourceHash ?? null, inputSamples: samples.length },
    maxSoleOrientationChangeRadians: 0, maxFootPositionChangeMeters: 0, maxKneePositionChangeMeters: 0, maxFootMarkerPositionChangeMeters: 0,
    sourceFootAngularAccelerationRadiansPerSecondSquared: maxFootAcceleration(reference), conditionedFootAngularAccelerationRadiansPerSecondSquared: 0,
    articulatedDynamics: false };
  const smoother = (u: number) => { const x = clamp(u, 0, 1); return x ** 3 * (10 + x * (-15 + 6 * x)); };
  const floorPhaseTimes = reference.flatMap(sample => {
    const support = inferMotionSupportGeometry(sample.pose);
    return (['LeftHand', 'RightHand', 'Hips', 'Chest', 'Head'] as const).some(joint => support.effectors.has(joint)) ? [sample.time] : [];
  });
  for (let index = 0; index < reference.length; index++) {
    if (index % 32 === 0) { await yieldTask(); abort(options.signal); }
    const sample = reference[index], world = worlds[index];
    // Inverted/floor support needs its original palms/knees/back and an explicit
    // whole-body solve, never an imposed standing stance or foot freezing.
    const phaseFade = floorPhaseTimes.length ? smoother(Math.min(...floorPhaseTimes.map(time => Math.abs(time - sample.time))) / .25) : 1;
    const fade = index < 3 || target.mode === 'interval' && index >= reference.length - 3 ? 0 :
      phaseFade * smoother((sample.time - target.startSeconds) / .5) * (target.mode === 'interval' ? smoother((target.endSeconds - sample.time) / .5) : 1);
    if (!fade) { filtered.push({ time: sample.time, pose: clonePose(sample.pose) }); continue; }
    const seed = clonePose(sample.pose);
    for (const joint of groups) {
      const q = new Quaternion(...sample.pose.joints[joint]), mean = q.clone();
      for (let iteration = 0; iteration < 2; iteration++) {
        const tangent = new Vector3(); let weightSum = 0;
        for (let neighbor = Math.max(0, index - 8); neighbor <= Math.min(reference.length - 1, index + 8); neighbor++) {
          const dt = reference[neighbor].time - sample.time; if (Math.abs(dt) > 3 * sigma) continue;
          const density = neighbor === 0 ? reference[1].time - reference[0].time : neighbor === reference.length - 1 ?
            reference[neighbor].time - reference[neighbor - 1].time : (reference[neighbor + 1].time - reference[neighbor - 1].time) / 2;
          const weight = density * Math.exp(-.5 * (dt / sigma) ** 2);
          tangent.addScaledVector(rotationVector(mean.clone().invert().multiply(new Quaternion(...reference[neighbor].pose.joints[joint]))), weight); weightSum += weight;
        }
        mean.multiply(quaternionVector(tangent.divideScalar(weightSum))).normalize();
      }
      const tangent = rotationVector(q.clone().invert().multiply(mean));
      const angle = tangent.length();
      // Smoothly bound the entire correction field. A hard per-frame angular
      // clip introduces a kink and can increase the source's acceleration.
      const budget = maximumSoleAngle - .05 * Math.PI / 180;
      tangent.multiplyScalar(angle > 1e-12 ? fade * boundedCorrectionAngle(angle, budget) / angle : fade);
      const meanRotation = q.multiply(quaternionVector(tangent)).normalize();
      seed.joints[joint] = meanRotation.clone().slerp(interiorFootRotation(joint, meanRotation), fade).normalize().toArray() as Quat;
    }
    // New motion may move its feet modestly. Keeping old world ankle anchors
    // would undo the local ankle denoising and restore the source's force spikes.
    const fitted = seed, fittedWorld = evaluatePose(fitted);
    for (const side of ['Left', 'Right'] as const) {
      const foot = `${side}Foot` as const, knee = `${side}LowerLeg` as const;
      report.maxSoleOrientationChangeRadians = Math.max(report.maxSoleOrientationChangeRadians, new Quaternion(...world[foot].rotation).angleTo(new Quaternion(...fittedWorld[foot].rotation)));
      report.maxFootPositionChangeMeters = Math.max(report.maxFootPositionChangeMeters, new Vector3(...fittedWorld[foot].position).distanceTo(new Vector3(...world[foot].position)));
      report.maxKneePositionChangeMeters = Math.max(report.maxKneePositionChangeMeters, new Vector3(...fittedWorld[knee].position).distanceTo(new Vector3(...world[knee].position)));
    }
    for (const marker of ['LeftToe', 'RightToe', 'LeftHeel', 'RightHeel'] as const) report.maxFootMarkerPositionChangeMeters = Math.max(report.maxFootMarkerPositionChangeMeters,
      new Vector3(...fittedWorld[marker].position).distanceTo(new Vector3(...world[marker].position)));
    filtered.push({ time: sample.time, pose: fitted });
  }
  report.conditionedFootAngularAccelerationRadiansPerSecondSquared = maxFootAcceleration(filtered);
  abort(options.signal);
  return { samples: filtered, report };
}

/** Sampled contact/IK prototype. Its receipts apply only to the input knots;
 * production uses conditionMotionGroundingCurve on the actual interpolant. */
export async function conditionMotionGrounding(samples: readonly MotionGroundingSample[], options: MotionGroundingOptions): Promise<MotionGroundingResult> {
  abort(options.signal);
  const { target, boundaries } = options;
  if (!samples.length || samples.length > 1801 || target.mode !== 'full' && target.mode !== 'interval' ||
    options.sourceHash !== undefined && !/^[a-f0-9]{64}$/.test(options.sourceHash) || !Number.isFinite(target.startSeconds) || !Number.isFinite(target.endSeconds) ||
    target.endSeconds <= target.startSeconds || target.endSeconds - target.startSeconds > 60 || boundaries.start.time !== target.startSeconds || boundaries.end.time !== target.endSeconds) throw new Error('动作接触处理需要固定区间及有效边界。');
  let previous = target.startSeconds - 1;
  const reference = samples.map(sample => {
    if (!Number.isFinite(sample.time) || sample.time <= previous || sample.time < target.startSeconds || sample.time > target.endSeconds) throw new Error('动作接触处理的样本必须按目标时间递增。');
    previous = sample.time; evaluatePose(sample.pose);
    if (sample.time === target.startSeconds && !exactPose(sample.pose, boundaries.start.pose) || target.mode === 'interval' && sample.time === target.endSeconds && !exactPose(sample.pose, boundaries.end.pose)) throw new Error('动作接触处理不能改写只读端点。');
    return { time: sample.time, pose: clonePose(sample.pose) };
  });
  const prepend = reference[0].time !== target.startSeconds;
  if (prepend) reference.unshift({ time: target.startSeconds, pose: clonePose(boundaries.start.pose) });
  const append = target.mode === 'interval' && reference.at(-1)!.time !== target.endSeconds;
  if (append) reference.push({ time: target.endSeconds, pose: clonePose(boundaries.end.pose) });
  const times = reference.map(sample => sample.time), worlds = reference.map(sample => evaluatePose(sample.pose));
  const support = reference.map(sample => inferMotionSupportGeometry(sample.pose));
  const supported = support.map(geometry => geometry.points.length > 0);
  // Foot-only IK cannot preserve a planted palm/knee/back constraint. Leave
  // those unsupported cases to the whole-body solver rather than lifting them.
  const conditionable = support.map((geometry, index) => (geometry.effectors.has('LeftFoot') || geometry.effectors.has('RightFoot')) &&
    !(['LeftHand', 'RightHand', 'Hips', 'Chest', 'Head'] as const).some(joint => geometry.effectors.has(joint)) &&
    !(['LeftLowerLeg', 'RightLowerLeg'] as const).some(joint => geometry.effectors.has(joint) && worlds[index][joint].position[1] < .1));
  const sourceCenters = reference.map(sample => groundingCenterOfMass(sample.pose));
  const before = forceMetrics(sourceCenters, times, supported), corrections: Vec3[] = reference.map(() => [...ZERO]);
  const locked = (index: number) => index < 3 || target.mode === 'interval' && index >= reference.length - 3;
  let result = reference.map(sample => ({ time: sample.time, pose: clonePose(sample.pose) })), iterations = 0;
  let best = result, bestCorrections = corrections.map(c => [...c] as Vec3);
  const score = (metrics: MotionGroundingForceMetrics) => metrics.forceViolationSamples * 1000 + Math.max(0, -metrics.minNormalForceNewtons) + metrics.maxFrictionExcessNewtons;
  let bestScore = score(before);
  // Project a complete temporal field rather than independently clamping poses.
  // Leg IK changes the COM response, so each outer iteration remeasures it.
  if (before.forceViolationSamples) for (let outer = 0; outer < 6; outer++) {
    abort(options.signal); await yieldTask(); abort(options.signal);
    const actual = result.map(sample => groundingCenterOfMass(sample.pose));
    const jacobians: number[][][] = [];
    for (let index = 0; index < reference.length; index++) {
      if (index && index % 64 === 0) { await yieldTask(); abort(options.signal); }
      jacobians.push(comJacobian(reference[index].pose, corrections[index], worlds[index]));
    }
    const residual = actual.map((point, index) => { const predicted = multiply(jacobians[index], corrections[index]); return point.map((value, axis) => value - predicted[axis]) as Vec3; });
    for (let pass = 0; pass < 32; pass++) {
      if (pass && pass % 4 === 0) { await yieldTask(); abort(options.signal); }
      iterations++;
      for (let i = 1; i < reference.length - 1; i++) {
        if (!conditionable[i - 1] || !conditionable[i] || !conditionable[i + 1]) continue;
        const points = [i - 1, i, i + 1].map(index => { const predicted = multiply(jacobians[index], corrections[index]); return residual[index].map((value, axis) => value + predicted[axis]) as Vec3; });
        const t = [times[i - 1], times[i], times[i + 1]], a = acceleration(points, t, 1), projected = coneProjection(a);
        const dt0 = t[1] - t[0], dt1 = t[2] - t[1], middle = (dt0 + dt1) / 2;
        const row = [1 / (dt0 * middle), -(1 / dt0 + 1 / dt1) / middle, 1 / (dt1 * middle)];
        const normal = [0, 1, 2].map(() => [0, 0, 0]);
        for (let offset = 0; offset < 3; offset++) {
          const index = i - 1 + offset; if (locked(index)) continue;
          const jacobian = jacobians[index];
          for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) normal[a][b] += row[offset] ** 2 * jacobian[a].reduce((sum, value, axis) => sum + value * jacobian[b][axis], 0);
        }
        for (let axis = 0; axis < 3; axis++) normal[axis][axis] += 1e-6;
        const lambda = solve3(normal, projected.map((value, axis) => value - a[axis]) as Vec3);
        for (let offset = 0; offset < 3; offset++) {
          const index = i - 1 + offset; if (locked(index)) continue;
          const delta = [0, 1, 2].map(axis => jacobians[index].reduce((sum, derivative, coordinate) => sum + derivative[axis] * lambda[coordinate], 0) * row[offset]) as Vec3;
          corrections[index] = bounded(corrections[index].map((value, axis) => value + .85 * delta[axis]) as Vec3, worlds[index]);
        }
      }
      if (pass % 4 === 3) {
        // Penalize high-frequency CORRECTION only, preserving the source dance.
        const snapshot = corrections.map(c => [...c] as Vec3);
        for (let i = 1; i < corrections.length - 1; i++) if (!locked(i)) corrections[i] = bounded(snapshot[i].map((value, axis) => .998 * value + .001 * snapshot[i - 1][axis] + .001 * snapshot[i + 1][axis]) as Vec3, worlds[i]);
      }
    }
    result = reference.map((sample, index) => ({ time: sample.time, pose: restoreFeet(sample.pose, corrections[index], worlds[index]) }));
    const measured = forceMetrics(result.map(sample => groundingCenterOfMass(sample.pose)), times, supported);
    if (score(measured) < bestScore) { bestScore = score(measured); best = result; bestCorrections = corrections.map(c => [...c] as Vec3); }
    if (!measured.forceViolationSamples) break;
  }
  // A bounded nonlinear assist may fail. Do not replace the original candidate
  // with a measured worse trajectory; final acceptance still belongs elsewhere.
  result = best;
  for (let i = 0; i < corrections.length; i++) corrections[i] = bestCorrections[i];
  let maxRootCorrectionMeters = 0, maxFootPositionResidualMeters = 0, maxFootRotationResidualRadians = 0;
  for (let i = 0; i < result.length; i++) {
    const world = evaluatePose(result[i].pose); maxRootCorrectionMeters = Math.max(maxRootCorrectionMeters, Math.hypot(...corrections[i]));
    for (const foot of ['LeftFoot', 'RightFoot', 'LeftToe', 'RightToe', 'LeftHeel', 'RightHeel'] as const) {
      maxFootPositionResidualMeters = Math.max(maxFootPositionResidualMeters, new Vector3(...world[foot].position).distanceTo(new Vector3(...worlds[i][foot].position)));
      maxFootRotationResidualRadians = Math.max(maxFootRotationResidualRadians, new Quaternion(...world[foot].rotation).angleTo(new Quaternion(...worlds[i][foot].rotation)));
    }
  }
  const after = forceMetrics(result.map(sample => groundingCenterOfMass(sample.pose)), times, supported);
  const report: MotionGroundingReport = { schema: 'motion-grounding-1', applied: maxRootCorrectionMeters > 1e-12, iterations,
    scope: 'sampled-com-contact-conditioning', articulatedDynamics: false,
    physicalParameters: { massKg: HUMAN.massKg, gravityMps2: HUMAN.gravityMps2, friction: HUMAN.ground.friction },
    provenance: { rigId: RIG_CALIBRATION_VERSION, humanProfileId: HUMAN.id, sourceHash: options.sourceHash ?? null, inputSamples: samples.length },
    maxRootCorrectionMeters, maxFootPositionResidualMeters, maxFootRotationResidualRadians, before, after };
  abort(options.signal);
  return { samples: result.slice(prepend ? 1 : 0, append ? -1 : undefined), report };
}

type RootBasis = Map<number, number>;
export interface MotionCurveGroundingReport {
  schema: 'motion-curve-grounding-1';
  scope: 'quarterpoint-hermite-root-conditioning';
  articulatedDynamics: false;
  physicalParameters: { massKg: number; gravityMps2: number; friction: number };
  provenance: { rigId: typeof RIG_CALIBRATION_VERSION; humanProfileId: typeof HUMAN.id; sourceHash: string; inputKnots: number };
  samples: number;
  iterations: number;
  maxRootCorrectionMeters: number;
  maxFloorDepthMeters: number;
  before: MotionGroundingForceMetrics;
  after: MotionGroundingForceMetrics;
}
export interface MotionCurveGroundingResult { patch: AIMotionPatch; report: MotionCurveGroundingReport }
export interface MotionCurveGroundingOptions {
  sourceSampler: AIMotionPoseSampler;
  durationSeconds: number;
  contacts?: readonly MotionContactHint[];
  signal?: AbortSignal;
}
function addBasis(target: RootBasis, source: RootBasis, scale: number): void {
  for (const [index, value] of source) target.set(index, (target.get(index) ?? 0) + value * scale);
}
function rootVelocityBasis(patch: AIMotionPatch, index: number): RootBasis {
  const knots = patch.knots;
  if (index < 3 || index === knots.length - 1 || patch.target.mode === 'interval' && index >= knots.length - 3) return new Map();
  const before = knots[index].time - knots[index - 1].time, after = knots[index + 1].time - knots[index].time;
  return new Map([[index - 1, -after / (before * (before + after))],
    [index, (after / before - before / after) / (before + after)], [index + 1, before / (after * (before + after))]]);
}
function rootSpanBasis(patch: AIMotionPatch, span: number, u: number): RootBasis {
  const duration = patch.knots[span + 1].time - patch.knots[span].time, u2 = u * u, u3 = u2 * u;
  const basis = new Map([[span, 2 * u3 - 3 * u2 + 1], [span + 1, -2 * u3 + 3 * u2]]);
  addBasis(basis, rootVelocityBasis(patch, span), (u3 - 2 * u2 + u) * duration);
  addBasis(basis, rootVelocityBasis(patch, span + 1), (u3 - u2) * duration);
  return basis;
}
function rootSpanAccelerationBasis(patch: AIMotionPatch, span: number, u: number): RootBasis {
  const duration = patch.knots[span + 1].time - patch.knots[span].time;
  const basis = new Map([[span, (12 * u - 6) / duration ** 2], [span + 1, (-12 * u + 6) / duration ** 2]]);
  addBasis(basis, rootVelocityBasis(patch, span), (6 * u - 4) / duration);
  addBasis(basis, rootVelocityBasis(patch, span + 1), (6 * u - 2) / duration);
  return basis;
}
function basisVector(basis: RootBasis, corrections: readonly Vec3[]): Vec3 {
  const result: Vec3 = [0, 0, 0];
  for (const [index, coefficient] of basis) for (let axis = 0; axis < 3; axis++) result[axis] += coefficient * corrections[index][axis];
  return result;
}
/** Fix Root motion against the ACTUAL interpolated rigid-body pose. Joints and
 * their SO(3) tangents are held fixed, so COM and every collider translate by
 * the same Root field exactly. Sparse Hermite basis rows make floor, contact,
 * correction-budget and net-force projections a bounded convex problem.
 * This is generation-time conditioning; the independent final gate remains. */
async function conditionMotionGroundingCurvePass(input: AIMotionPatch, options: MotionCurveGroundingOptions, budgetReference: AIMotionPatch): Promise<MotionCurveGroundingResult> {
  abort(options.signal);
  if (options.contacts !== undefined && (!Array.isArray(options.contacts) || options.contacts.length > 64 ||
    options.contacts.some(contact => !Number.isFinite(contact.startSeconds) || !Number.isFinite(contact.endSeconds) ||
      contact.startSeconds < 0 || contact.endSeconds > options.durationSeconds || contact.endSeconds <= contact.startSeconds ||
      !['supported', 'airborne', 'unknown'].includes(contact.mode)))) throw new Error('曲线接触上下文无效。');
  const reference = structuredClone(input);
  if (reference.knots.length < 3 || reference.knots.length > 1803) throw new Error('曲线接触处理需要有效的候选采样。');
  const sampler = createAIMotionSampler(options.sourceSampler, { schema: 'ai-motion-track-1', countMapId: 'grounding-curve', durationSeconds: options.durationSeconds, patches: [reference] });
  const budgetSampler = createAIMotionSampler(options.sourceSampler, { schema: 'ai-motion-track-1', countMapId: 'grounding-budget', durationSeconds: options.durationSeconds, patches: [budgetReference] });
  const budgetOffsets = reference.knots.map((knot, index) => knot.pose.root.map((value, axis) => value - budgetReference.knots[index].pose.root[axis]) as Vec3);
  const bases: RootBasis[] = [], times = getMotionFeasibilitySampleTimes(reference), centers: Vec3[] = [], floorHeights: number[] = [], supportHeights: (number | null)[] = [], contactCeilings: (number | null)[] = [], referencePoses: Pose[] = [], referenceOffsets: Vec3[] = [];
  let span = 0;
  for (let index = 0; index < times.length; index++) {
      if (index % 64 === 0) { await yieldTask(); abort(options.signal); }
      const time = times[index];
      while (span < reference.knots.length - 2 && time > reference.knots[span + 1].time) span++;
      const u = (time - reference.knots[span].time) / (reference.knots[span + 1].time - reference.knots[span].time), pose = sampler(time);
      const support = inferMotionSupportGeometry(pose);
      bases.push(rootSpanBasis(reference, span, u)); centers.push(groundingCenterOfMass(pose)); floorHeights.push(getMotionMinimumFloorHeight(pose)); referencePoses.push(pose);
      const originalRoot = input === budgetReference ? pose.root : budgetSampler(time).root;
      referenceOffsets.push(pose.root.map((value, axis) => value - originalRoot[axis]) as Vec3);
      const supportHeight = support.points.length ? Math.min(...support.points.map(point => point[1])) : null;
      supportHeights.push(supportHeight);
      const contactHint = reference.motionOrigin?.segments.find(segment => time >= segment.startSeconds && time <= segment.endSeconds)?.contactHint;
      const mode = options.contacts?.find(contact => time >= contact.startSeconds && time <= contact.endSeconds)?.mode;
      const supportedGoal = options.contacts !== undefined ? mode === 'supported' : contactHint === 'standing' || contactHint === 'floor';
      // A supported planning hint is a conditioning goal, never evidence that
      // a gap is grounded. Any required lowering uses real floor geometry and
      // the unchanged6cm budget; only actual contact activates force rows.
      contactCeilings.push(supportHeight ?? (supportedGoal ? floorHeights.at(-1)! : null));
  }
  const supported = supportHeights.map(height => height !== null), before = forceMetrics(centers, times, supported);
  const corrections: Vec3[] = reference.knots.map(() => [0, 0, 0]);
  const locked = (index: number) => index < 3 || reference.target.mode === 'interval' && index >= reference.knots.length - 3;
  const rows: { basis: RootBasis; base: Vec3 }[] = [];
  const pendingContactRows: { row: { basis: RootBasis; base: Vec3 }; poses: Pose[]; bases: RootBasis[] }[] = [];
  for (let index = 1; index < times.length - 1; index++) {
    const beforeDt = times[index] - times[index - 1], afterDt = times[index + 1] - times[index], middle = (beforeDt + afterDt) / 2;
    const basis = new Map<number, number>();
    addBasis(basis, bases[index - 1], 1 / (beforeDt * middle));
    addBasis(basis, bases[index], -(1 / beforeDt + 1 / afterDt) / middle);
    addBasis(basis, bases[index + 1], 1 / (afterDt * middle));
    const row = { basis, base: acceleration(centers, times, index) };
    if (supported[index - 1] && supported[index] && supported[index + 1]) rows.push(row);
    else pendingContactRows.push({ row, poses: referencePoses.slice(index - 1, index + 2), bases: bases.slice(index - 1, index + 2) });
  }
  // A C1 Hermite curve need not be C2 across its knots. A central acceleration
  // there can average opposite one-sided peaks. Constrain each span's own
  // endpoint curvature too, using an analytic Root basis and real joint/FK COM.
  for (let segment = 0; segment < reference.knots.length - 1; segment++) {
    if (segment % 32 === 0) { await yieldTask(); abort(options.signal); }
    const start = reference.knots[segment].time, duration = reference.knots[segment + 1].time - start, h = Math.min(1e-4, duration / 1024);
    for (const u of [1 / 256, .25, .5, .75, 255 / 256]) {
      const time = start + duration * u;
      const poses = [sampler(time - h), sampler(time), sampler(time + h)];
      const points = poses.map(groundingCenterOfMass);
      const base = points[1].map((_, axis) => (points[2][axis] - 2 * points[1][axis] + points[0][axis]) / (h * h)) as Vec3;
      const row = { basis: rootSpanAccelerationBasis(reference, segment, u), base };
      if (poses.every(pose => inferMotionSupportGeometry(pose).points.length)) rows.push(row);
      else pendingContactRows.push({ row, poses, bases: [-h, 0, h].map(offset => rootSpanBasis(reference, segment, u + offset / duration)) });
    }
  }
  const apply = (basis: RootBasis, delta: Vec3) => {
    let denominator = 0;
    for (const [index, coefficient] of basis) if (!locked(index)) denominator += coefficient * coefficient;
    if (denominator < 1e-12) return;
    for (const [index, coefficient] of basis) if (!locked(index)) {
      const c = corrections[index].map((value, axis) => value + coefficient * delta[axis] / denominator) as Vec3;
      const total = c.map((value, axis) => value + budgetOffsets[index][axis]) as Vec3, length = Math.hypot(...total);
      corrections[index] = length > .06 ? total.map((value, axis) => value * .06 / length - budgetOffsets[index][axis]) as Vec3 : c;
    }
  };
  let iterations = 0;
  for (let pass = 0; pass < 96; pass++) {
    if (pass % 4 === 0) { await yieldTask(); abort(options.signal); }
    iterations++;
    for (const row of rows) {
      const correction = basisVector(row.basis, corrections), a = row.base.map((value, axis) => value + correction[axis]) as Vec3;
      const desired = coneProjection(a); apply(row.basis, desired.map((value, axis) => value - a[axis]) as Vec3);
    }
    for (let index = 0; index < bases.length; index++) {
      const field = basisVector(bases[index], corrections), minimum = -.002 - floorHeights[index];
      // Preserve a source-supported phase within the same calibrated25mm
      // contact tolerance; never declare a floating candidate grounded.
      const maximum = contactCeilings[index] === null ? Infinity : .023 - contactCeilings[index]!;
      const required = clamp(field[1], minimum, Math.max(minimum, maximum));
      if (required !== field[1]) apply(bases[index], [0, required - field[1], 0]);
      const total = field.map((value, axis) => value + referenceOffsets[index][axis]) as Vec3, length = Math.hypot(...total);
      if (length > .06) apply(bases[index], total.map(value => value * .06 / length - value) as Vec3);
    }
    if (pass % 8 === 7) {
      let activated = false;
      for (let index = pendingContactRows.length - 1; index >= 0; index--) {
        const pending = pendingContactRows[index];
        if (pending.poses.every((pose, point) => {
          const field = basisVector(pending.bases[point], corrections);
          return inferMotionSupportGeometry({ root: pose.root.map((value, axis) => value + field[axis]) as Vec3, joints: pose.joints }).points.length > 0;
        })) { rows.push(pending.row); pendingContactRows.splice(index, 1); activated = true; }
      }
      const current = centers.map((center, index) => { const field = basisVector(bases[index], corrections); return center.map((value, axis) => value + field[axis]) as Vec3; });
      const metrics = forceMetrics(current, times, supported);
      const floorOkay = floorHeights.every((height, index) => height + basisVector(bases[index], corrections)[1] >= -.00300002);
      const curvatureOkay = rows.every(row => {
        const c = basisVector(row.basis, corrections), a = row.base.map((value, axis) => value + c[axis]) as Vec3, n = HUMAN.gravityMps2 + a[1];
        return n >= -.5 && Math.hypot(a[0], a[2]) <= HUMAN.ground.friction * Math.max(0, n) + .5;
      });
      if (!activated && !metrics.forceViolationSamples && floorOkay && curvatureOkay) break;
    }
  }
  const patch = structuredClone(reference);
  for (let index = 0; index < patch.knots.length; index++) {
    if (locked(index)) continue;
    patch.knots[index].pose.root = reference.knots[index].pose.root.map((value, axis) => value + corrections[index][axis]) as Vec3;
    const velocity = basisVector(rootVelocityBasis(reference, index), corrections);
    patch.knots[index].linearVelocity = reference.knots[index].linearVelocity.map((value, axis) => value + velocity[axis]) as Vec3;
  }
  // Bounded knot corrections can still overshoot inside a C1 Hermite span.
  // Project the WHOLE correction field uniformly, including its velocities;
  // this keeps its continuity and zero immutable bands. Re-measure geometry
  // and forces below; a budget projection never grants physical acceptance.
  let maximumField = 0;
  // Each cubic is a convex combination of four Bézier controls. Their
  // largest correction norm also bounds every unsampled Root time exactly.
  for (let index = 0; index < patch.knots.length - 1; index++) {
    const duration = patch.knots[index + 1].time - patch.knots[index].time;
    const a = patch.knots[index], b = patch.knots[index + 1], originalA = budgetReference.knots[index], originalB = budgetReference.knots[index + 1];
    const pa = a.pose.root.map((value, axis) => value - originalA.pose.root[axis]) as Vec3;
    const pb = b.pose.root.map((value, axis) => value - originalB.pose.root[axis]) as Vec3;
    const va = a.linearVelocity.map((value, axis) => value - originalA.linearVelocity[axis]) as Vec3;
    const vb = b.linearVelocity.map((value, axis) => value - originalB.linearVelocity[axis]) as Vec3;
    maximumField = Math.max(maximumField, Math.hypot(...pa), Math.hypot(...pb),
      Math.hypot(...pa.map((value, axis) => value + duration * va[axis] / 3)),
      Math.hypot(...pb.map((value, axis) => value - duration * vb[axis] / 3)));
  }
  if (maximumField > .06) {
    const scale = .06 / maximumField;
    for (let index = 0; index < patch.knots.length; index++) {
      if (locked(index)) continue;
      const origin = budgetReference.knots[index];
      patch.knots[index].pose.root = patch.knots[index].pose.root.map((value, axis) => origin.pose.root[axis] + (value - origin.pose.root[axis]) * scale) as Vec3;
      patch.knots[index].linearVelocity = patch.knots[index].linearVelocity.map((value, axis) => origin.linearVelocity[axis] + (value - origin.linearVelocity[axis]) * scale) as Vec3;
    }
  }
  const actualSampler = createAIMotionSampler(options.sourceSampler, { schema: 'ai-motion-track-1', countMapId: 'grounding-curve', durationSeconds: options.durationSeconds, patches: [patch] });
  // Root changes can refine the adaptive mesh. Rebuild it from the actual
  // output for the receipt rather than carrying the input's support mask/grid.
  const actualTimes = getMotionFeasibilitySampleTimes(patch), afterCenters: Vec3[] = [], actualSupport: boolean[] = [];
  let maxRootCorrectionMeters = 0, maxFloorDepthMeters = 0;
  for (let index = 0; index < actualTimes.length; index++) {
    if (index % 64 === 0) { await yieldTask(); abort(options.signal); }
    const pose = actualSampler(actualTimes[index]), original = budgetSampler(actualTimes[index]); actualSupport.push(inferMotionSupportGeometry(pose).points.length > 0);
    // Report actual output samples, never a prediction masquerading as evidence.
    afterCenters.push(groundingCenterOfMass(pose));
    maxRootCorrectionMeters = Math.max(maxRootCorrectionMeters, Math.hypot(...pose.root.map((value, axis) => value - original.root[axis])));
    maxFloorDepthMeters = Math.max(maxFloorDepthMeters, -getMotionMinimumFloorHeight(pose));
  }
  abort(options.signal);
  if (maxRootCorrectionMeters > .06000001) throw new Error('曲线 Root 修正超出 6 厘米范围。', { cause: { maxRootCorrectionMeters } });
  return { patch, report: { schema: 'motion-curve-grounding-1', scope: 'quarterpoint-hermite-root-conditioning', articulatedDynamics: false,
    physicalParameters: { massKg: HUMAN.massKg, gravityMps2: HUMAN.gravityMps2, friction: HUMAN.ground.friction },
    provenance: { rigId: RIG_CALIBRATION_VERSION, humanProfileId: HUMAN.id, sourceHash: reference.sourceHash, inputKnots: reference.knots.length },
    samples: actualTimes.length, iterations, maxRootCorrectionMeters, maxFloorDepthMeters,
    before, after: forceMetrics(afterCenters, actualTimes, actualSupport) } };
}

/** One bounded mesh refinement addresses contacts/finite differences that
 * become visible after Root changes the adaptive sample grid. Both passes
 * share the original6cm budget, immutable bands and independent final gate. */
export async function conditionMotionGroundingCurve(input: AIMotionPatch, options: MotionCurveGroundingOptions): Promise<MotionCurveGroundingResult> {
  const first = await conditionMotionGroundingCurvePass(input, options, input);
  if (!first.report.after.forceViolationSamples && first.report.maxFloorDepthMeters <= HUMAN.ground.penetrationToleranceMeters) return first;
  const refined = await conditionMotionGroundingCurvePass(first.patch, options, input);
  refined.report.before = first.report.before;
  refined.report.iterations += first.report.iterations;
  return refined;
}
