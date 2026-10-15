import { rotationFromDegrees } from './keyframes';
import { JOINT_NAMES, type JointName, type Pose, type Quat, type Vec3 } from './motion-types';
import type { MotionPriorCompositionOrigin } from './motionPriors';
import { hasAIMotionPlanMinimumDuration } from './aiMotionPlan';
import {
  AI_MOTION_SUPPORTED_MODELS, LOCAL_DANCE_PLANNER, AI_MOTION_MAX_KEYFRAMES, validateAIMotionRequest, validateAIMotionResult,
  type AIMotionBoundary, type AIMotionModel, type AIMotionRequest, type AIMotionResult, type AIMotionTarget,
} from './aiMotion';

/** A separate, immutable layer: author takes and their exact sample times stay intact. */
export interface AIMotionKnot {
  time: number;
  pose: Pose;
  linearVelocity: Vec3;
  /** Parent-relative, body-frame angular velocity, in radians per second. */
  angularVelocity: Record<JointName, Vec3>;
}
/** Provenance of a procedurally synthesized dance (dance-synth-1). */
export interface DanceSynthesisOrigin {
  kind: 'dance-synthesis';
  generator: 'dance-synth-1';
  planSource: 'ai' | 'local';
  style: string;
  energy: 'low' | 'medium' | 'high';
  /** Backoff scale actually used, in (0, 1]. */
  intensity: number;
  moves: { move: string; startSeconds: number; endSeconds: number; mirror: boolean }[];
}
export type AIMotionPatchProvider = 'cloudflare-workers-ai' | 'local';
export interface AIMotionPatch {
  id: string;
  /** `local` marks motion planned by the deterministic rule planner. */
  provider: AIMotionPatchProvider;
  model: AIMotionModel;
  requestId: string;
  sourceHash: string;
  target: AIMotionTarget;
  knots: AIMotionKnot[];
  /** Local dense curves preserve their actual human-capture/plan provenance. */
  motionOrigin?: MotionPriorCompositionOrigin | DanceSynthesisOrigin;
}
export interface AIMotionTrack {
  schema: 'ai-motion-track-1';
  countMapId: string;
  durationSeconds: number;
  patches: AIMotionPatch[];
}
export type AIMotionPoseSampler = (time: number) => Pose;
export const MAX_AI_MOTION_PATCHES = 12;
/** Local motion data is independent of the model's sparse JSON/token budget. */
export const MAX_AI_MOTION_POSE_SAMPLES = 1801;
export const MAX_AI_MOTION_TRACK_KNOTS = 7208;
export interface AIMotionQuality {
  samples: number;
  maxFrameRootDistanceMeters: number;
  maxFrameJointAngleDegrees: number;
  /** Maximum displacement/orientation difference from the first sampled pose. */
  maxRootExcursionMeters: number;
  maxJointExcursionDegrees: number;
  maxLinearSpeedMetersPerSecond: number;
  maxRootAccelerationMetersPerSecondSquared: number;
  maxAngularSpeedDegreesPerSecond: number;
  maxAngularAccelerationDegreesPerSecondSquared: number;
  warnings: string[];
}
/** Technical review thresholds only. These are not anatomical limits or quality scores. */
export const AI_MOTION_QUALITY_WARNING_THRESHOLDS = {
  frameRootDistanceMeters: .5,
  frameJointAngleDegrees: 60,
  linearSpeedMetersPerSecond: 15,
  rootAccelerationMetersPerSecondSquared: 150,
  angularSpeedDegreesPerSecond: 1800,
  angularAccelerationDegreesPerSecondSquared: 18000,
  staticRootExcursionMeters: 1e-5,
  staticJointExcursionDegrees: .1,
} as const;
export const AI_MOTION_STATIC_WARNING = '候选没有明显的移动或转动，请确认是否符合描述。';
const UNIT_EPSILON = 1e-4;
const forbidden = new Set(['__proto__', 'prototype', 'constructor']);
const fail = (message = 'AI 动作轨道格式无效。'): never => { throw new Error(message); };
const copyVector = (v: Vec3): Vec3 => [...v];
/** JSON represents both signed zeros as +0; only new derived velocities are canonicalized. */
const canonicalVelocity = (v: Vec3): Vec3 => v.map(component => component === 0 ? 0 : component) as Vec3;
const copyPose = (pose: Pose): Pose => ({ root: [...pose.root], joints: Object.fromEntries(JOINT_NAMES.map(joint => [joint, [...pose.joints[joint]]])) as Pose['joints'] });
const zeros = (): Record<JointName, Vec3> => Object.fromEntries(JOINT_NAMES.map(joint => [joint, [0, 0, 0]])) as Record<JointName, Vec3>;
const scale = (v: Vec3, amount: number): Vec3 => v.map(value => value * amount) as Vec3;
const add = (a: Vec3, b: Vec3): Vec3 => a.map((value, axis) => value + b[axis]) as Vec3;
const subtract = (a: Vec3, b: Vec3): Vec3 => a.map((value, axis) => value - b[axis]) as Vec3;
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
function multiply(a: Quat, b: Quat): Quat {
  return [
    a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
    a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
    a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
    a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
  ];
}
function relative(a: Quat, b: Quat): Quat {
  return multiply([-a[0], -a[1], -a[2], a[3]], b);
}
/** Shortest SO(3) logarithm; quaternion sign never changes a physical rotation. */
function logarithm(input: Quat): Vec3 {
  const length = Math.hypot(...input);
  if (!Number.isFinite(length) || length < Number.EPSILON) return fail('AI 曲线含无效旋转。');
  const sign = input[3] < 0 ? -1 : 1;
  const q = input.map(component => component / length * sign) as Quat;
  const sine = Math.hypot(q[0], q[1], q[2]);
  if (sine < 1e-12) return [q[0] * 2, q[1] * 2, q[2] * 2];
  const amount = 2 * Math.atan2(sine, Math.max(0, q[3])) / sine;
  return [q[0] * amount, q[1] * amount, q[2] * amount];
}
function exponential(vector: Vec3): Quat {
  const angle = Math.hypot(...vector);
  if (!Number.isFinite(angle)) return fail('AI 曲线旋转数值溢出。');
  const amount = angle < 1e-10 ? .5 - angle * angle / 48 : Math.sin(angle / 2) / angle;
  return [vector[0] * amount, vector[1] * amount, vector[2] * amount, Math.cos(angle / 2)];
}
/** Converts the requested endpoint body velocity to a logarithm-coordinate tangent. */
function inverseRightJacobian(rotation: Vec3, velocity: Vec3): Vec3 {
  const angle = Math.hypot(...rotation);
  const coefficient = angle < 1e-4 ? 1 / 12 + angle * angle / 720 : 1 / (angle * angle) - 1 / (2 * angle * Math.tan(angle / 2));
  const first = cross(rotation, velocity);
  return add(add(velocity, scale(first, .5)), scale(cross(rotation, first), coefficient));
}
function hermite(a: Vec3, b: Vec3, va: Vec3, vb: Vec3, amount: number, duration: number): Vec3 {
  const u2 = amount * amount, u3 = u2 * amount;
  const h00 = 2 * u3 - 3 * u2 + 1, h10 = u3 - 2 * u2 + amount;
  const h01 = -2 * u3 + 3 * u2, h11 = u3 - u2;
  return a.map((value, axis) => h00 * value + h10 * duration * va[axis] + h01 * b[axis] + h11 * duration * vb[axis]) as Vec3;
}
function rotationCurve(a: Quat, b: Quat, va: Vec3, vb: Vec3, amount: number, duration: number): Quat {
  const ending = logarithm(relative(a, b));
  const coordinate = hermite([0, 0, 0], ending, va, inverseRightJacobian(ending, vb), amount, duration);
  const result = multiply(a, exponential(coordinate));
  const norm = Math.hypot(...result);
  return result.map(component => component / norm) as Quat;
}

function record(input: unknown, required: readonly string[], optional: readonly string[] = []): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return fail();
  const prototype = Object.getPrototypeOf(input);
  if (prototype !== Object.prototype && prototype !== null) return fail();
  const value = input as Record<string, unknown>, keys = Object.keys(value);
  if (required.some(key => !Object.hasOwn(value, key)) || keys.some(key => forbidden.has(key) || !required.includes(key) && !optional.includes(key))) return fail();
  return value;
}
function validateDanceOrigin(input: unknown, range: AIMotionTarget): void {
  const value = record(input, ['kind', 'generator', 'planSource', 'style', 'energy', 'intensity', 'moves']);
  if (value.generator !== 'dance-synth-1' || value.planSource !== 'ai' && value.planSource !== 'local' ||
    value.energy !== 'low' && value.energy !== 'medium' && value.energy !== 'high' ||
    typeof value.intensity !== 'number' || !Number.isFinite(value.intensity) || value.intensity <= 0 || value.intensity > 1) return fail('AI 动作来源记录无效。');
  text(value.style, 32);
  if (!Array.isArray(value.moves) || value.moves.length > 200) return fail('AI 动作来源记录无效。');
  for (const inputMove of value.moves) {
    const move = record(inputMove, ['move', 'startSeconds', 'endSeconds', 'mirror']);
    text(move.move, 32);
    if (typeof move.mirror !== 'boolean' || typeof move.startSeconds !== 'number' || typeof move.endSeconds !== 'number' ||
      !(move.startSeconds >= range.startSeconds) || !(move.endSeconds <= range.endSeconds) || !(move.endSeconds > move.startSeconds)) return fail('AI 动作来源记录无效。');
  }
}
function validateMotionOrigin(input: unknown, range: AIMotionTarget): void {
  if (input && typeof input === 'object' && (input as { kind?: unknown }).kind === 'dance-synthesis') return validateDanceOrigin(input, range);
  const value = record(input, ['kind', 'catalogVersion', 'sources', 'segments'], ['adaptations', 'adaptationMetrics', 'endingAdaptation']);
  if (value.kind !== 'human-motion-prior') return fail('AI 动作来源类型无效。');
  text(value.catalogVersion, 128);
  if (value.endingAdaptation !== undefined) {
    const ending = record(value.endingAdaptation, ['kind', 'seconds']);
    if (range.mode !== 'full' || ending.kind !== 'stable-hold' || typeof ending.seconds !== 'number' || !Number.isFinite(ending.seconds) ||
      ending.seconds <= 0 || ending.seconds > range.endSeconds - range.startSeconds) return fail('动作收势适配记录无效。');
  }
  if (value.adaptations !== undefined) {
    if (!Array.isArray(value.adaptations) || value.adaptations.length < 1 || value.adaptations.length > 12) return fail('动作适配来源数量无效。');
    for (const adaptation of value.adaptations) text(adaptation, 128);
    if (new Set(value.adaptations).size !== value.adaptations.length) return fail('动作适配来源重复。');
  }
  if (value.adaptationMetrics !== undefined) {
    const metrics = record(value.adaptationMetrics, ['maxHandDisplacementMeters', 'rmsHandDisplacementMeters'],
      ['maxSoleOrientationChangeRadians', 'maxSoleSmoothingRadians', 'maxFootMarkerDisplacementMeters', 'maxFootDisplacementMeters', 'rmsFootDisplacementMeters', 'maxKneeDisplacementMeters']);
    const maximum = metrics.maxHandDisplacementMeters, rms = metrics.rmsHandDisplacementMeters;
    if (typeof maximum !== 'number' || typeof rms !== 'number' || !Number.isFinite(maximum) || !Number.isFinite(rms) ||
      maximum < 0 || maximum > 5 || rms < 0 || rms > maximum + 1e-10) return fail('动作比例适配记录无效。');
    for (const [key, limit] of [['maxSoleOrientationChangeRadians', Math.PI], ['maxSoleSmoothingRadians', Math.PI], ['maxFootMarkerDisplacementMeters', 5],
      ['maxFootDisplacementMeters', 5], ['rmsFootDisplacementMeters', 5], ['maxKneeDisplacementMeters', 5]] as const) {
      const metric = metrics[key];
      if (metric !== undefined && (typeof metric !== 'number' || !Number.isFinite(metric) || metric < 0 || metric > limit)) return fail('动作足部适配记录无效。');
    }
    if (metrics.rmsFootDisplacementMeters !== undefined && (metrics.maxFootDisplacementMeters === undefined ||
      (metrics.rmsFootDisplacementMeters as number) > (metrics.maxFootDisplacementMeters as number) + 1e-10)) return fail('动作足部适配记录无效。');
  }
  if (!Array.isArray(value.sources) || value.sources.length < 1 || value.sources.length > 24 || !Array.isArray(value.segments) || value.segments.length < 1 || value.segments.length > 32) return fail('AI 动作来源数量超出范围。');
  const ids = new Set<string>();
  for (const inputSource of value.sources) {
    const source = record(inputSource, ['clipId', 'sourceHash']); text(source.clipId, 128);
    if (ids.has(source.clipId as string) || typeof source.sourceHash !== 'string' || !/^[a-f0-9]{64}$/.test(source.sourceHash)) return fail('AI 动作来源摘要无效。');
    ids.add(source.clipId as string);
  }
  let previous = range.startSeconds;
  const used = new Set<string>();
  for (const inputSegment of value.segments) {
    const segment = record(inputSegment, ['clipId', 'startSeconds', 'endSeconds', 'sourceStartSeconds', 'sourceEndSeconds', 'yawDegrees', 'travelXZ', 'transitionSeconds', 'contactHint']);
    if (!ids.has(segment.clipId as string)) return fail('AI 动作段缺少来源。');
    used.add(segment.clipId as string);
    const values = ['startSeconds', 'endSeconds', 'sourceStartSeconds', 'sourceEndSeconds', 'yawDegrees', 'transitionSeconds'].map(key => segment[key]);
    if (values.some(v => typeof v !== 'number' || !Number.isFinite(v))) return fail();
    const [start, end, sourceStart, sourceEnd, yaw, transition] = values as number[];
    const duration = end - start, sourceDuration = sourceEnd - sourceStart;
    if (start !== previous || end > range.endSeconds || !hasAIMotionPlanMinimumDuration(start, end) || sourceStart < 0 || sourceEnd > 600 || sourceDuration <= 0 || duration / sourceDuration < .5 || duration / sourceDuration > 2 || Math.abs(yaw) > 180 || transition < 0 || transition > Math.min(1, duration / 3) || !['standing', 'floor', 'airborne', 'mixed', 'unknown'].includes(segment.contactHint as string)) return fail('保存的 AI 编排时间或来源无效。');
    vector(segment.travelXZ, 2, 2); previous = end;
  }
  if (previous !== range.endSeconds || used.size !== ids.size) return fail('AI 动作来源与目标覆盖不一致。');
}
function vector(input: unknown, size = 3, limit = 1e4): void {
  if (!Array.isArray(input) || input.length !== size || Array.from(input).some(value => typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > limit)) return fail('AI 动作轨道坐标或速度超过数值范围。');
}
function pose(input: unknown): void {
  const value = record(input, ['root', 'joints']); vector(value.root, 3, 100);
  const joints = record(value.joints, JOINT_NAMES);
  for (const joint of JOINT_NAMES) {
    vector(joints[joint], 4, 1.001);
    if (Math.abs(Math.hypot(...joints[joint] as Quat) - 1) > UNIT_EPSILON) return fail('AI 动作轨道旋转必须是单位四元数。');
  }
}
function velocities(input: unknown): void {
  const joints = record(input, JOINT_NAMES);
  for (const joint of JOINT_NAMES) vector(joints[joint]);
}
function text(input: unknown, maximum = 160): void {
  if (typeof input !== 'string' || !input.trim() || input.length > maximum || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(input)) return fail();
}
function target(input: unknown, duration: number): AIMotionTarget {
  const value = record(input, ['mode', 'startSeconds', 'endSeconds']);
  if (value.mode !== 'full' && value.mode !== 'interval' || typeof value.startSeconds !== 'number' || typeof value.endSeconds !== 'number' || !Number.isFinite(value.startSeconds) || !Number.isFinite(value.endSeconds) || value.startSeconds < 0 || value.endSeconds > duration || value.endSeconds <= value.startSeconds || value.mode === 'full' && (value.startSeconds !== 0 || value.endSeconds !== duration)) return fail('AI 动作轨道区间无效。');
  return value as unknown as AIMotionTarget;
}

/** Strict and lossless: validation never snaps times, normalizes saved values or rebakes. */
export function validateAIMotionTrack(input: unknown, map: { id: string; durationSeconds: number }, baseSampler?: AIMotionPoseSampler): AIMotionTrack {
  if (!map.id || !Number.isFinite(map.durationSeconds) || map.durationSeconds <= 0) return fail('AI 动作轨道需要有效数拍。');
  const track = record(input, ['schema', 'countMapId', 'durationSeconds', 'patches']);
  if (track.schema !== 'ai-motion-track-1' || track.countMapId !== map.id || track.durationSeconds !== map.durationSeconds || !Array.isArray(track.patches) || track.patches.length < 1 || track.patches.length > MAX_AI_MOTION_PATCHES) return fail('AI 动作轨道的数拍绑定或层数无效。');
  let totalKnots = 0;
  const ids = new Set<string>(), requests = new Set<string>();
  for (const [index, inputPatch] of track.patches.entries()) {
    const patch = record(inputPatch, ['id', 'provider', 'model', 'requestId', 'sourceHash', 'target', 'knots'], ['motionOrigin']);
    text(patch.id); text(patch.requestId); text(patch.sourceHash);
    if (!/^[a-fA-F0-9]{64}$/.test(patch.sourceHash as string)) return fail('AI 动作轨道需要有效的原稿摘要。');
    if (patch.provider !== 'cloudflare-workers-ai' && patch.provider !== 'local' || (patch.provider === 'local') !== (patch.model === LOCAL_DANCE_PLANNER) || !AI_MOTION_SUPPORTED_MODELS.includes(patch.model as AIMotionModel) || ids.has(patch.id as string) || requests.has(patch.requestId as string)) return fail('AI 动作轨道来源或标识无效。');
    ids.add(patch.id as string); requests.add(patch.requestId as string);
    const range = target(patch.target, map.durationSeconds);
    if (patch.motionOrigin !== undefined) validateMotionOrigin(patch.motionOrigin, range);
    if (range.mode === 'full' && index !== 0) return fail('完整 AI 动作必须是轨道第一层。');
    const maxKnots = (patch.motionOrigin === undefined ? AI_MOTION_MAX_KEYFRAMES : MAX_AI_MOTION_POSE_SAMPLES) + (range.mode === 'full' ? 1 : 2);
    if (!Array.isArray(patch.knots) || patch.knots.length < 3 || patch.knots.length > maxKnots) return fail('AI 动作曲线关键姿态数量无效。');
    totalKnots += patch.knots.length;
    if (totalKnots > MAX_AI_MOTION_TRACK_KNOTS) return fail(`AI 动作轨道最多保存 ${MAX_AI_MOTION_TRACK_KNOTS} 个关键姿态。`);
    let previous = -Infinity;
    for (const inputKnot of patch.knots) {
      const knot = record(inputKnot, ['time', 'pose', 'linearVelocity', 'angularVelocity']);
      if (typeof knot.time !== 'number' || !Number.isFinite(knot.time) || knot.time < range.startSeconds || knot.time > range.endSeconds || knot.time <= previous) return fail('AI 动作关键姿态时间必须严格递增且位于区间内。');
      previous = knot.time; pose(knot.pose); vector(knot.linearVelocity); velocities(knot.angularVelocity);
    }
    if (patch.knots[0].time !== range.startSeconds || patch.knots.at(-1)!.time !== range.endSeconds) return fail('AI 动作曲线必须保存精确的两端。');
    if (range.mode === 'full') {
      const final = patch.knots.at(-1)! as AIMotionKnot;
      if (final.linearVelocity.some(component => component !== 0) || JOINT_NAMES.some(joint => final.angularVelocity[joint].some(component => component !== 0))) return fail('完整 AI 动作结束必须平稳保持。');
    }
  }
  if (baseSampler) validateSourceBoundaries(input as AIMotionTrack, baseSampler);
  return input as AIMotionTrack;
}

/** The real dt is retained; no assumption that imported motion uses uniform 30 fps. */
export function estimateAIMotionBoundary(sampler: AIMotionPoseSampler, time: number, side: 'before' | 'after', duration: number): AIMotionBoundary {
  if (!Number.isFinite(duration) || duration <= 0 || !Number.isFinite(time) || time < 0 || time > duration || side !== 'before' && side !== 'after') return fail('AI 边界采样区间无效。');
  const current = sampler(time); pose(current);
  let direction = side === 'before' ? -1 : 1;
  if (direction < 0 && time === 0 || direction > 0 && time === duration) direction *= -1;
  const room = direction < 0 ? time : duration - time;
  const dt = Math.min(1e-4, room / 2);
  if (!(dt > 0) || time + direction * dt === time) return { time, pose: copyPose(current), linearVelocity: [0, 0, 0], angularVelocity: zeros(), support: 'unknown', supportConfidence: 0 };
  const one = sampler(time + direction * dt), two = sampler(time + direction * 2 * dt);
  pose(one); pose(two);
  const derivative = (first: Vec3, second: Vec3): Vec3 => scale(subtract(scale(first, 4), second), 1 / (direction * 2 * dt));
  const linearVelocity = canonicalVelocity(derivative(subtract(one.root, current.root), subtract(two.root, current.root)));
  const angularVelocity = Object.fromEntries(JOINT_NAMES.map(joint => [joint, canonicalVelocity(derivative(logarithm(relative(current.joints[joint], one.joints[joint])), logarithm(relative(current.joints[joint], two.joints[joint]))))])) as Record<JointName, Vec3>;
  vector(linearVelocity); velocities(angularVelocity);
  return { time, pose: copyPose(current), linearVelocity, angularVelocity, support: 'unknown', supportConfidence: 0 };
}

function interiorVelocities(knots: AIMotionKnot[], index: number): void {
  const previous = knots[index - 1], current = knots[index], next = knots[index + 1];
  const before = current.time - previous.time, after = next.time - current.time;
  const tangent = (incoming: Vec3, outgoing: Vec3): Vec3 => scale(add(scale(incoming, after / before), scale(outgoing, before / after)), 1 / (before + after));
  current.linearVelocity = canonicalVelocity(tangent(subtract(current.pose.root, previous.pose.root), subtract(next.pose.root, current.pose.root)));
  current.angularVelocity = Object.fromEntries(JOINT_NAMES.map(joint => {
    const incoming = scale(logarithm(relative(current.pose.joints[joint], previous.pose.joints[joint])), -1);
    const outgoing = logarithm(relative(current.pose.joints[joint], next.pose.joints[joint]));
    return [joint, canonicalVelocity(tangent(incoming, outgoing))];
  })) as Record<JointName, Vec3>;
}
function boundaryKnot(boundary: AIMotionBoundary): AIMotionKnot {
  return { time: boundary.time, pose: copyPose(boundary.pose), linearVelocity: canonicalVelocity(boundary.linearVelocity), angularVelocity: Object.fromEntries(JOINT_NAMES.map(joint => [joint, canonicalVelocity(boundary.angularVelocity[joint])])) as Record<JointName, Vec3> };
}
function exactPose(a: Pose, b: Pose): boolean {
  return a.root.every((component, axis) => component === b.root[axis]) && JOINT_NAMES.every(joint => a.joints[joint].every((component, axis) => component === b.joints[joint][axis]));
}
function validateSourceBoundaries(track: AIMotionTrack, original: AIMotionPoseSampler): void {
  let previousSampler = original;
  const sameVelocity = (a: Vec3, b: Vec3) => a.every((component, axis) => Math.abs(component - b[axis]) <= 1e-5);
  for (const patch of track.patches) {
    const range = patch.target;
    const boundaries = [
      { knot: patch.knots[0], side: 'before' as const },
      ...(range.mode === 'interval' ? [{ knot: patch.knots.at(-1)!, side: 'after' as const }] : []),
    ];
    for (const { knot, side } of boundaries) {
      const source = estimateAIMotionBoundary(previousSampler, knot.time, side, track.durationSeconds);
      // Full regeneration fixes its initial pose, but has no preceding outside
      // interval. Its chosen initial velocity can come from the replaced AI layer.
      const changedVelocity = range.mode === 'interval' && (!sameVelocity(knot.linearVelocity, source.linearVelocity) || JOINT_NAMES.some(joint => !sameVelocity(knot.angularVelocity[joint], source.angularVelocity[joint])));
      if (!exactPose(knot.pose, source.pose) || changedVelocity) return fail('保存的 AI 动作接缝与原稿不一致。');
    }
    const preceding = previousSampler;
    previousSampler = time => range.mode === 'full' && time >= range.startSeconds && time <= range.endSeconds || range.mode === 'interval' && time > range.startSeconds && time < range.endSeconds ? samplePatch(patch, time) : preceding(time);
  }
}

/** Model Euler values are converted once, not repeatedly projected during playback. */
export function compileAIMotionPatch(inputRequest: AIMotionRequest, inputResult: AIMotionResult, baseSampler: AIMotionPoseSampler): AIMotionPatch {
  const request = validateAIMotionRequest(inputRequest);
  const result = validateAIMotionResult(inputResult, request);
  const { target: range, timing } = request.context;
  const start = estimateAIMotionBoundary(baseSampler, range.startSeconds, 'before', timing.durationSeconds);
  const end = estimateAIMotionBoundary(baseSampler, range.endSeconds, 'after', timing.durationSeconds);
  if (!exactPose(start.pose, request.context.initialPose) || !exactPose(start.pose, request.context.boundaries.start.pose) || !exactPose(end.pose, request.context.boundaries.end.pose)) return fail('AI 候选的原稿边界已变化，请重新生成。');
  const knots = [boundaryKnot(start)];
  let previous = copyPose(start.pose);
  for (const key of result.keyframes) {
    const generated = copyPose(previous);
    generated.root = [...key.root];
    for (const joint of JOINT_NAMES) if (key.rotations[joint] !== undefined) generated.joints[joint] = rotationFromDegrees(key.rotations[joint]!);
    knots.push({ time: key.time, pose: generated, linearVelocity: [0, 0, 0], angularVelocity: zeros() });
    previous = generated;
  }
  if (range.mode === 'interval') knots.push(boundaryKnot(end));
  for (let index = 1; index < knots.length - 1; index++) interiorVelocities(knots, index);
  const patch: AIMotionPatch = {
    id: `ai-patch-${result.requestId}`, provider: result.provider, model: result.model,
    requestId: result.requestId, sourceHash: result.sourceHash, target: { ...range }, knots,
  };
  validateAIMotionTrack({ schema: 'ai-motion-track-1', countMapId: timing.id, durationSeconds: timing.durationSeconds, patches: [patch] }, timing);
  return patch;
}

/** Compile locally sampled real motion without routing dense poses through an LLM.
 * Both interval seams are injected from the unchanged effective source sampler. */
export function compileAIMotionPosePatch(
  inputRequest: AIMotionRequest,
  metadata: { provider: AIMotionPatchProvider; model: AIMotionModel } & Pick<AIMotionResult, 'requestId' | 'sourceHash' | 'target'>,
  samples: readonly { time: number; pose: Pose }[],
  baseSampler: AIMotionPoseSampler,
  motionOrigin: MotionPriorCompositionOrigin | DanceSynthesisOrigin,
): AIMotionPatch {
  const request = validateAIMotionRequest(inputRequest), { target: range, timing } = request.context;
  if (metadata.provider !== 'cloudflare-workers-ai' && metadata.provider !== 'local' || (metadata.provider === 'local') !== (metadata.model === LOCAL_DANCE_PLANNER) || !AI_MOTION_SUPPORTED_MODELS.includes(metadata.model) || metadata.requestId !== request.context.requestId || metadata.sourceHash !== request.context.sourceHash || metadata.target.mode !== range.mode || metadata.target.startSeconds !== range.startSeconds || metadata.target.endSeconds !== range.endSeconds) return fail('AI 编排与原稿目标不一致。');
  validateMotionOrigin(motionOrigin, range);
  if (!Array.isArray(samples) || samples.length < (range.mode === 'full' ? 2 : 1) || samples.length > MAX_AI_MOTION_POSE_SAMPLES) return fail('本地动作采样数量超出范围。');
  const start = estimateAIMotionBoundary(baseSampler, range.startSeconds, 'before', timing.durationSeconds);
  const end = estimateAIMotionBoundary(baseSampler, range.endSeconds, 'after', timing.durationSeconds);
  if (!exactPose(start.pose, request.context.initialPose) || !exactPose(start.pose, request.context.boundaries.start.pose) || !exactPose(end.pose, request.context.boundaries.end.pose)) return fail('AI 候选的原稿边界已变化，请重新生成。');
  const knots = [boundaryKnot(start)];
  let previousTime = range.startSeconds;
  for (const sample of samples) {
    if (!sample || !Number.isFinite(sample.time) || sample.time <= previousTime || sample.time > range.endSeconds || range.mode === 'interval' && sample.time === range.endSeconds) return fail('本地动作时间必须位于固定可写区间。');
    pose(sample.pose); previousTime = sample.time;
    knots.push({ time: sample.time, pose: copyPose(sample.pose), linearVelocity: [0, 0, 0], angularVelocity: zeros() });
  }
  if (range.mode === 'interval') knots.push(boundaryKnot(end));
  else if (previousTime !== range.endSeconds) return fail('完整动作必须采样到精确结束时间。');
  for (let index = 1; index < knots.length - 1; index++) interiorVelocities(knots, index);
  const patch: AIMotionPatch = { id: `ai-patch-${metadata.requestId}`, provider: metadata.provider, model: metadata.model,
    requestId: metadata.requestId, sourceHash: metadata.sourceHash, target: { ...range }, knots, motionOrigin: structuredClone(motionOrigin) };
  validateAIMotionTrack({ schema: 'ai-motion-track-1', countMapId: timing.id, durationSeconds: timing.durationSeconds, patches: [patch] }, timing);
  return patch;
}

/** An offline numerical repair may change interior poses, never either seam tangent. */
export function recomputeAIMotionPatchTangents(patch: AIMotionPatch): AIMotionPatch {
  const updated = clonePatch(patch);
  for (let index = 1; index < updated.knots.length - 1; index++) interiorVelocities(updated.knots, index);
  return updated;
}

function clonePatch(patch: AIMotionPatch): AIMotionPatch {
  return { ...patch, ...(patch.motionOrigin ? { motionOrigin: structuredClone(patch.motionOrigin) } : {}), target: { ...patch.target }, knots: patch.knots.map(knot => ({ time: knot.time, pose: copyPose(knot.pose), linearVelocity: copyVector(knot.linearVelocity), angularVelocity: Object.fromEntries(JOINT_NAMES.map(joint => [joint, copyVector(knot.angularVelocity[joint])])) as Record<JointName, Vec3> })) };
}
/** A full regeneration replaces AI layers; the caller's original take stays separate. */
export function appendAIMotionPatch(existing: AIMotionTrack | undefined, patch: AIMotionPatch, map: { id: string; durationSeconds: number }): AIMotionTrack {
  if (existing) validateAIMotionTrack(existing, map);
  const patches = patch.target.mode === 'full' ? [clonePatch(patch)] : [...(existing?.patches ?? []).map(clonePatch), clonePatch(patch)];
  const track: AIMotionTrack = { schema: 'ai-motion-track-1', countMapId: map.id, durationSeconds: map.durationSeconds, patches };
  validateAIMotionTrack(track, map);
  return track;
}

function samplePatch(patch: AIMotionPatch, time: number): Pose {
  const knots = patch.knots;
  if (time <= knots[0].time) return copyPose(knots[0].pose);
  if (time >= knots.at(-1)!.time) return copyPose(knots.at(-1)!.pose);
  let low = 0, high = knots.length - 1;
  while (low < high) { const middle = Math.floor((low + high) / 2); if (knots[middle].time < time) low = middle + 1; else high = middle; }
  const next = knots[low];
  if (next.time === time) return copyPose(next.pose);
  const previous = knots[low - 1], duration = next.time - previous.time, amount = (time - previous.time) / duration;
  return {
    root: hermite(previous.pose.root, next.pose.root, previous.linearVelocity, next.linearVelocity, amount, duration),
    joints: Object.fromEntries(JOINT_NAMES.map(joint => [joint, rotationCurve(previous.pose.joints[joint], next.pose.joints[joint], previous.angularVelocity[joint], next.angularVelocity[joint], amount, duration)])) as Pose['joints'],
  };
}

function usableSample(input: Pose): void {
  // A Hermite overshoot may exceed authored coordinates. Diagnose it, never clamp it.
  vector(input.root, 3, Infinity);
  const joints = record(input.joints, JOINT_NAMES);
  for (const joint of JOINT_NAMES) {
    vector(joints[joint], 4, 1.001);
    if (Math.abs(Math.hypot(...joints[joint] as Quat) - 1) > UNIT_EPSILON) return fail('AI 动作曲线产生不可用的旋转。');
  }
}

/**
 * Bounded, read-only diagnostics of the actual compiled curve: 30 fps plus exact knots.
 * Adjacent distances include additional knot samples, whose dt can be shorter than a
 * frame. Speeds use their true dt; accelerations use the separation of interval middles.
 * Rotational diagnostics measure parent-relative spatial angular velocity, in degrees.
 * This cannot establish musicality, foot contact, semantics or natural human movement.
 */
export function analyzeAIMotionPatch(patch: AIMotionPatch): AIMotionQuality {
  const end = patch?.target?.endSeconds;
  if (typeof end !== 'number' || !Number.isFinite(end) || end > 60 + 1e-9) return fail('AI 动作诊断需要有效的 60 秒内场景。');
  validateAIMotionTrack({ schema: 'ai-motion-track-1', countMapId: 'quality-analysis', durationSeconds: end, patches: [patch] }, { id: 'quality-analysis', durationSeconds: end });
  const start = patch.target.startSeconds, duration = end - start;
  const knotTimes = patch.knots.map(knot => knot.time), times = new Set(knotTimes);
  // Explicit final time preserves a nonuniform last interval instead of rounding it.
  times.add(start); times.add(end);
  for (let frame = 0; frame <= Math.ceil(duration * 30); frame++) {
    const time = start + frame / 30;
    // Keep exact knots authoritative when a frame grid point differs only by rounding.
    if (time < end && !knotTimes.some(knotTime => Math.abs(knotTime - time) <= 1e-9)) times.add(time);
  }
  const ordered = [...times].sort((a, b) => a - b), radiansToDegrees = 180 / Math.PI;
  const quality: AIMotionQuality = {
    samples: ordered.length, maxFrameRootDistanceMeters: 0, maxFrameJointAngleDegrees: 0,
    maxRootExcursionMeters: 0, maxJointExcursionDegrees: 0,
    maxLinearSpeedMetersPerSecond: 0, maxRootAccelerationMetersPerSecondSquared: 0,
    maxAngularSpeedDegreesPerSecond: 0, maxAngularAccelerationDegreesPerSecondSquared: 0,
    warnings: [],
  };
  let previousPose = samplePatch(patch, ordered[0]); usableSample(previousPose);
  const firstPose = previousPose;
  let precedingLinear: Vec3 | undefined, precedingAngular: Record<JointName, Vec3> | undefined;
  let precedingDt = 0;
  for (let index = 1; index < ordered.length; index++) {
    const time = ordered[index], previousTime = ordered[index - 1], dt = time - previousTime;
    const current = samplePatch(patch, time); usableSample(current);
    const displacement = subtract(current.root, previousPose.root), linear = displacement.map(component => component / dt) as Vec3;
    const angular = {} as Record<JointName, Vec3>;
    const middleSeparation = (precedingDt + dt) / 2;
    quality.maxRootExcursionMeters = Math.max(quality.maxRootExcursionMeters, Math.hypot(...subtract(current.root, firstPose.root)));
    quality.maxFrameRootDistanceMeters = Math.max(quality.maxFrameRootDistanceMeters, Math.hypot(...displacement));
    quality.maxLinearSpeedMetersPerSecond = Math.max(quality.maxLinearSpeedMetersPerSecond, Math.hypot(...linear));
    if (precedingLinear) quality.maxRootAccelerationMetersPerSecondSquared = Math.max(quality.maxRootAccelerationMetersPerSecondSquared, Math.hypot(...subtract(linear, precedingLinear).map(component => component / middleSeparation)));
    for (const joint of JOINT_NAMES) {
      const from = previousPose.joints[joint], to = current.joints[joint];
      quality.maxJointExcursionDegrees = Math.max(quality.maxJointExcursionDegrees, Math.hypot(...logarithm(relative(firstPose.joints[joint], to))) * radiansToDegrees);
      // R_next * R_previous^-1 expresses all increments in the same parent frame.
      const increment = logarithm(multiply(to, [-from[0], -from[1], -from[2], from[3]]));
      angular[joint] = increment.map(component => component / dt * radiansToDegrees) as Vec3;
      quality.maxFrameJointAngleDegrees = Math.max(quality.maxFrameJointAngleDegrees, Math.hypot(...increment) * radiansToDegrees);
      quality.maxAngularSpeedDegreesPerSecond = Math.max(quality.maxAngularSpeedDegreesPerSecond, Math.hypot(...angular[joint]));
      if (precedingAngular) quality.maxAngularAccelerationDegreesPerSecondSquared = Math.max(quality.maxAngularAccelerationDegreesPerSecondSquared, Math.hypot(...subtract(angular[joint], precedingAngular[joint]).map(component => component / middleSeparation)));
    }
    previousPose = current; precedingLinear = linear; precedingAngular = angular; precedingDt = dt;
  }
  const measured = Object.values(quality).filter((value): value is number => typeof value === 'number');
  if (measured.some(value => !Number.isFinite(value))) return fail('AI 动作曲线产生非有限的变化量。');
  const thresholds = AI_MOTION_QUALITY_WARNING_THRESHOLDS;
  if (quality.maxRootExcursionMeters < thresholds.staticRootExcursionMeters && quality.maxJointExcursionDegrees < thresholds.staticJointExcursionDegrees) quality.warnings.push(AI_MOTION_STATIC_WARNING);
  if (quality.maxFrameRootDistanceMeters > thresholds.frameRootDistanceMeters) quality.warnings.push('相邻采样点位移超过 0.5 米，发现较急移动，请预览。');
  if (quality.maxFrameJointAngleDegrees > thresholds.frameJointAngleDegrees) quality.warnings.push('相邻采样点关节转角超过 60°，发现较急转动，请预览。');
  if (quality.maxLinearSpeedMetersPerSecond > thresholds.linearSpeedMetersPerSecond || quality.maxRootAccelerationMetersPerSecondSquared > thresholds.rootAccelerationMetersPerSecondSquared) quality.warnings.push('Root 速度或加速度较高，请预览。');
  if (quality.maxAngularSpeedDegreesPerSecond > thresholds.angularSpeedDegreesPerSecond || quality.maxAngularAccelerationDegreesPerSecondSquared > thresholds.angularAccelerationDegreesPerSecondSquared) quality.warnings.push('关节角速度或角加速度较高，请预览。');
  return quality;
}

/** Outside every interval, return the caller's exact sample, without copying or rebaking. */
export function createAIMotionSampler(baseSampler: AIMotionPoseSampler, track?: AIMotionTrack): AIMotionPoseSampler {
  if (!track) return baseSampler;
  validateAIMotionTrack(track, { id: track.countMapId, durationSeconds: track.durationSeconds });
  return time => {
    if (!Number.isFinite(time)) return fail('AI 动作采样时间必须有限。');
    for (let index = track.patches.length - 1; index >= 0; index--) {
      const patch = track.patches[index], range = patch.target;
      if (range.mode === 'full' && time >= range.startSeconds && time <= range.endSeconds || range.mode === 'interval' && time > range.startSeconds && time < range.endSeconds) return samplePatch(patch, time);
    }
    return baseSampler(time);
  };
}
