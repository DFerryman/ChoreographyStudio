/** Direct model-authored sparse motion. This protocol never resolves action IDs. */
import type { CountMap } from './index';
import { RIG_CALIBRATION_VERSION, RIG_DEFINITIONS } from './humanoid';
import { JOINT_NAMES, type JointName, type Pose, type Quat, type Vec3 } from './motion-types';

export const AI_MOTION_PROTOCOL = 'ai-motion-1' as const;
export const AI_MOTION_MODEL = '@cf/openai/gpt-oss-120b' as const;
/** Historical motion layers retain their original model provenance. This list
 * permits restoration, never automatic inference or provider fallback. */
export const AI_MOTION_SUPPORTED_MODELS = [AI_MOTION_MODEL, '@cf/qwen/qwen3-30b-a3b-fp8'] as const;
export type AIMotionModel = typeof AI_MOTION_SUPPORTED_MODELS[number];
export const AI_MOTION_REQUEST_MAX_BYTES = 64 * 1024;
export const AI_MOTION_RESULT_MAX_BYTES = 96 * 1024;
export const AI_MOTION_MAX_OUTPUT_TOKENS = 8192;
export const AI_MOTION_MAX_KEYFRAMES = 48;
export const AI_MOTION_PROMPT_MAX_LENGTH = 2000;
export const AI_MOTION_MAX_CONTEXT_SAMPLES = 16;

export interface AIMotionTarget { mode: 'full' | 'interval'; startSeconds: number; endSeconds: number }
export interface AIMotionSkeleton {
  id: typeof RIG_CALIBRATION_VERSION;
  coordinateSystem: 'right-handed-y-up-z-forward';
  rotationConvention: 'local-euler-xyz-degrees';
  joints: { name: JointName; parent: JointName | null; offset: Vec3; restRotation: Quat }[];
}
export interface AIMotionSample { time: number; pose: Pose }
export interface AIMotionBoundary extends AIMotionSample {
  /** World-space meters/second. */
  linearVelocity: Vec3;
  /** Parent-relative rotation's body-frame angular velocity in radians/second
   * (q^-1 dq), not Euler derivatives or world-space angular velocity. */
  angularVelocity: Record<JointName, Vec3>;
  support: 'left' | 'right' | 'both' | 'none' | 'unknown';
  supportConfidence: number;
  /** Read-only FK observations in world meters and meters/second. Presence is
   * not evidence of ground contact and never enables a collision projection. */
  footKinematics?: { left: { position: Vec3; velocity: Vec3 }; right: { position: Vec3; velocity: Vec3 } };
}
export interface AIMotionAudio {
  id: string;
  name: string;
  hash: string | null;
  /** Duration of the complete local audio asset. No audio bytes are sent. */
  durationSeconds: number;
  offsetSeconds: number;
  sourceOffsetSeconds: number;
  muted: boolean;
  availability: 'available' | 'missing';
  /** Audible source coverage on the scene timeline; null means no overlap. */
  coverage: { startSeconds: number; endSeconds: number } | null;
}
export interface AIMotionContext {
  requestId: string;
  sceneId: string;
  baseRevision: number;
  sourceHash: string;
  target: AIMotionTarget;
  skeleton: AIMotionSkeleton;
  timing: CountMap;
  initialPose: Pose;
  ending: 'hold';
  before: AIMotionSample[];
  after: AIMotionSample[];
  boundaries: { start: AIMotionBoundary; end: AIMotionBoundary };
  audio: AIMotionAudio[];
  audioUnderstanding: false;
}
export interface AIMotionRequest { protocol: typeof AI_MOTION_PROTOCOL; prompt: string; context: AIMotionContext }
/** Local Euler XYZ degrees; omissions inherit the preceding generated pose,
 * starting at context.initialPose. Root is always explicit. */
export interface AIMotionKeyframe { time: number; root: Vec3; rotations: Partial<Record<JointName, Vec3>> }
export interface AIMotionOutput { summary: string; keyframes: AIMotionKeyframe[] }
export interface AIMotionResult extends AIMotionOutput {
  protocol: typeof AI_MOTION_PROTOCOL;
  provider: 'cloudflare-workers-ai';
  model: typeof AI_MOTION_MODEL;
  requestId: string;
  sourceHash: string;
  target: AIMotionTarget;
}

const forbidden = new Set(['__proto__', 'constructor', 'prototype']);
const fail = (message = 'AI 动作数据无效。'): never => { throw new Error(message); };
const utf8Bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).byteLength;

function record(input: unknown, allowed: readonly string[], required: readonly string[] = allowed): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return fail();
  const prototype = Object.getPrototypeOf(input);
  if (prototype !== Object.prototype && prototype !== null) return fail();
  const descriptors = Object.getOwnPropertyDescriptors(input);
  const keys = Reflect.ownKeys(descriptors);
  if (keys.some(key => typeof key !== 'string' || forbidden.has(key) || !allowed.includes(key)) ||
    required.some(key => !Object.hasOwn(descriptors, key)) ||
    Object.values(descriptors).some(descriptor => !Object.hasOwn(descriptor, 'value'))) return fail();
  return input as Record<string, unknown>;
}
function finite(input: unknown, min: number, max: number, integer = false): number {
  if (typeof input !== 'number' || !Number.isFinite(input) || input < min || input > max || integer && !Number.isInteger(input)) return fail();
  return input;
}
function array(input: unknown, minimum: number, maximum: number): unknown[] {
  if (!Array.isArray(input) || Object.getPrototypeOf(input) !== Array.prototype || input.length < minimum || input.length > maximum) return fail();
  const descriptors = Object.getOwnPropertyDescriptors(input);
  if (Reflect.ownKeys(descriptors).length !== input.length + 1) return fail();
  for (let index = 0; index < input.length; index++) {
    if (!Object.hasOwn(descriptors, index) || !Object.hasOwn(descriptors[index], 'value')) return fail();
  }
  return input;
}
function text(input: unknown, maximum: number, trim = false): string {
  if (typeof input !== 'string' || !input.trim() || input.length > maximum || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(input)) return fail();
  return trim ? input.trim() : input;
}
function hash(input: unknown): string {
  if (typeof input !== 'string' || !/^[a-fA-F0-9]{64}$/.test(input)) return fail('AI 原稿摘要无效。');
  return input;
}
function vector(input: unknown, limit: number): Vec3 {
  return Array.from(array(input, 3, 3), value => finite(value, -limit, limit)) as Vec3;
}
function quaternion(input: unknown): Quat {
  const result = Array.from(array(input, 4, 4), value => finite(value, -1.001, 1.001)) as Quat;
  if (Math.abs(Math.hypot(...result) - 1) > 1e-4) return fail('AI 上下文需要单位四元数。');
  return result;
}
function pose(input: unknown): Pose {
  const value = record(input, ['root', 'joints']);
  const joints = record(value.joints, JOINT_NAMES);
  return { root: vector(value.root, 100), joints: Object.fromEntries(JOINT_NAMES.map(name => [name, quaternion(joints[name])])) as Pose['joints'] };
}
function samePose(a: Pose, b: Pose): boolean {
  return a.root.every((value, index) => value === b.root[index]) &&
    JOINT_NAMES.every(name => a.joints[name].every((value, index) => value === b.joints[name][index]));
}

/** Keep the original CountMap samples; validation never regenerates or rounds them. */
function timing(input: unknown): CountMap {
  const value = record(input, ['id', 'version', 'bpm', 'musicBeatsPerDanceCount', 'firstCountSourceSeconds', 'sourceOffsetSeconds', 'durationSeconds', 'octetCount', 'countTimesSeconds', 'confirmed']);
  const ratio = value.musicBeatsPerDanceCount;
  if (ratio !== 0.5 && ratio !== 1 && ratio !== 2 || value.confirmed !== true) return fail();
  const map: CountMap = {
    id: text(value.id, 128), version: finite(value.version, 1, Number.MAX_SAFE_INTEGER, true),
    bpm: finite(value.bpm, 30, 240), musicBeatsPerDanceCount: ratio,
    firstCountSourceSeconds: finite(value.firstCountSourceSeconds, 0, 1e7),
    sourceOffsetSeconds: finite(value.sourceOffsetSeconds, 0, 1e7),
    durationSeconds: finite(value.durationSeconds, 16 - 1e-9, 60 + 1e-9),
    octetCount: finite(value.octetCount, 2, 60, true), countTimesSeconds: [], confirmed: true,
  };
  const secondsPerCount = 60 / map.bpm * ratio;
  const countTimes = array(value.countTimesSeconds, map.octetCount * 8 + 1, map.octetCount * 8 + 1);
  if (Math.abs(map.durationSeconds - map.octetCount * 8 * secondsPerCount) > 1e-9 ||
    map.sourceOffsetSeconds < map.firstCountSourceSeconds ||
    Math.abs((map.sourceOffsetSeconds - map.firstCountSourceSeconds) / (8 * secondsPerCount) -
      Math.round((map.sourceOffsetSeconds - map.firstCountSourceSeconds) / (8 * secondsPerCount))) > 1e-7) return fail('AI 数拍上下文不一致。');
  map.countTimesSeconds = Array.from(countTimes, (time, index) => {
    const result = finite(time, 0, map.durationSeconds + 1e-9);
    if (Math.abs(result - index * secondsPerCount) > 1e-9) return fail('AI 数拍时间必须保留已确认的映射。');
    return result;
  });
  if (map.countTimesSeconds[0] !== 0 || map.countTimesSeconds.at(-1) !== map.durationSeconds) return fail();
  return map;
}
function target(input: unknown, duration: number): AIMotionTarget {
  const value = record(input, ['mode', 'startSeconds', 'endSeconds']);
  if (value.mode !== 'full' && value.mode !== 'interval') return fail();
  const result: AIMotionTarget = {
    mode: value.mode, startSeconds: finite(value.startSeconds, 0, duration), endSeconds: finite(value.endSeconds, 0, duration),
  };
  if (result.endSeconds <= result.startSeconds || result.mode === 'full' &&
    (result.startSeconds !== 0 || result.endSeconds !== duration)) return fail('AI 生成范围无效。');
  return result;
}
function skeleton(input: unknown): AIMotionSkeleton {
  const value = record(input, ['id', 'coordinateSystem', 'rotationConvention', 'joints']);
  if (value.id !== RIG_CALIBRATION_VERSION || value.coordinateSystem !== 'right-handed-y-up-z-forward' ||
    value.rotationConvention !== 'local-euler-xyz-degrees') return fail('AI 骨架约定不匹配。');
  const joints = array(value.joints, RIG_DEFINITIONS.length, RIG_DEFINITIONS.length);
  return {
    id: RIG_CALIBRATION_VERSION, coordinateSystem: 'right-handed-y-up-z-forward', rotationConvention: 'local-euler-xyz-degrees',
    joints: Array.from(joints, (inputJoint, index) => {
      const joint = record(inputJoint, ['name', 'parent', 'offset', 'restRotation']);
      const canonical = RIG_DEFINITIONS[index];
      const offset = vector(joint.offset, 2), restRotation = quaternion(joint.restRotation);
      if (joint.name !== canonical.name || joint.parent !== canonical.parent ||
        offset.some((value, axis) => value !== canonical.offset[axis]) ||
        restRotation.some((value, axis) => value !== [0, 0, 0, 1][axis])) return fail('AI 不能更换骨架或静止姿态。');
      return { name: canonical.name, parent: canonical.parent, offset, restRotation };
    }),
  };
}
function boundary(input: unknown, time: number): AIMotionBoundary {
  const fields = ['time', 'pose', 'linearVelocity', 'angularVelocity', 'support', 'supportConfidence'];
  const value = record(input, [...fields, 'footKinematics'], fields);
  if (value.time !== time || !['left', 'right', 'both', 'none', 'unknown'].includes(value.support as string)) return fail();
  const velocities = record(value.angularVelocity, JOINT_NAMES);
  const supportConfidence = finite(value.supportConfidence, 0, 1);
  if (value.support === 'unknown' && supportConfidence !== 0) return fail('未知支撑状态不能带有确定性。');
  let footKinematics: AIMotionBoundary['footKinematics'];
  if (Object.hasOwn(value, 'footKinematics')) {
    const feet = record(value.footKinematics, ['left', 'right']);
    const readFoot = (input: unknown) => {
      const foot = record(input, ['position', 'velocity']);
      return { position: vector(foot.position, 1000), velocity: vector(foot.velocity, 1e4) };
    };
    footKinematics = { left: readFoot(feet.left), right: readFoot(feet.right) };
  }
  return { time, pose: pose(value.pose), linearVelocity: vector(value.linearVelocity, 1e4),
    angularVelocity: Object.fromEntries(JOINT_NAMES.map(name => [name, vector(velocities[name], 1e4)])) as AIMotionBoundary['angularVelocity'],
    support: value.support as AIMotionBoundary['support'], supportConfidence, ...(footKinematics ? { footKinematics } : {}) };
}
function samples(input: unknown, min: number, max: number, exactBoundary: AIMotionBoundary): AIMotionSample[] {
  const values = array(input, 0, AI_MOTION_MAX_CONTEXT_SAMPLES);
  let precedingTime = -Infinity;
  return Array.from(values, sample => {
    const value = record(sample, ['time', 'pose']);
    const time = finite(value.time, min, max), samplePose = pose(value.pose);
    if (time <= precedingTime || time === exactBoundary.time && !samePose(samplePose, exactBoundary.pose)) return fail('AI 上下文样本顺序或边界不一致。');
    precedingTime = time;
    return { time, pose: samplePose };
  });
}
function audio(input: unknown, duration: number): AIMotionAudio[] {
  const values = array(input, 0, 9);
  const ids = new Set<string>();
  return Array.from(values, inputTrack => {
    const value = record(inputTrack, ['id', 'name', 'hash', 'durationSeconds', 'offsetSeconds', 'sourceOffsetSeconds', 'muted', 'availability', 'coverage']);
    if (typeof value.muted !== 'boolean' || value.availability !== 'available' && value.availability !== 'missing') return fail();
    const result: AIMotionAudio = {
      id: text(value.id, 128), name: text(value.name, 256), hash: value.hash === null ? null : hash(value.hash),
      durationSeconds: finite(value.durationSeconds, 0, 1e7), offsetSeconds: finite(value.offsetSeconds, -1e7, 1e7),
      sourceOffsetSeconds: finite(value.sourceOffsetSeconds, 0, 1e7), muted: value.muted, availability: value.availability, coverage: null,
    };
    if (ids.has(result.id) || result.availability === 'available' && (result.hash === null || result.durationSeconds <= 0)) return fail();
    ids.add(result.id);
    if (value.coverage !== null) {
      const coverage = record(value.coverage, ['startSeconds', 'endSeconds']);
      result.coverage = { startSeconds: finite(coverage.startSeconds, 0, duration), endSeconds: finite(coverage.endSeconds, 0, duration) };
      const startSource = result.sourceOffsetSeconds + result.coverage.startSeconds - result.offsetSeconds;
      const endSource = result.sourceOffsetSeconds + result.coverage.endSeconds - result.offsetSeconds;
      if (result.coverage.startSeconds >= result.coverage.endSeconds || startSource < -1e-9 || endSource > result.durationSeconds + 1e-9) return fail('AI 音频覆盖不匹配本地音轨映射。');
    }
    return result;
  });
}

export function validateAIMotionContext(input: unknown): AIMotionContext {
  const value = record(input, ['requestId', 'sceneId', 'baseRevision', 'sourceHash', 'target', 'skeleton', 'timing', 'initialPose', 'ending', 'before', 'after', 'boundaries', 'audio', 'audioUnderstanding']);
  if (value.ending !== 'hold' || value.audioUnderstanding !== false) return fail();
  const map = timing(value.timing), generationTarget = target(value.target, map.durationSeconds);
  const boundaries = record(value.boundaries, ['start', 'end']);
  const start = boundary(boundaries.start, generationTarget.startSeconds), end = boundary(boundaries.end, generationTarget.endSeconds);
  const initialPose = pose(value.initialPose);
  if (!samePose(initialPose, start.pose)) return fail('AI 初始姿态必须匹配固定起点。');
  const before = samples(value.before, 0, generationTarget.startSeconds, start);
  const after = samples(value.after, generationTarget.endSeconds, map.durationSeconds, end);
  if (generationTarget.mode === 'full' && (before.length || after.length) || generationTarget.mode === 'interval' &&
    (generationTarget.startSeconds > 0 && !before.length || generationTarget.endSeconds < map.durationSeconds && !after.length)) return fail('AI 区间缺少只读上下文。');
  return { requestId: text(value.requestId, 128), sceneId: text(value.sceneId, 128),
    baseRevision: finite(value.baseRevision, 0, Number.MAX_SAFE_INTEGER, true), sourceHash: hash(value.sourceHash),
    target: generationTarget, skeleton: skeleton(value.skeleton), timing: map, initialPose, ending: 'hold',
    before, after, boundaries: { start, end }, audio: audio(value.audio, map.durationSeconds), audioUnderstanding: false };
}
export function validateAIMotionRequest(input: unknown): AIMotionRequest {
  const value = record(input, ['protocol', 'prompt', 'context']);
  if (value.protocol !== AI_MOTION_PROTOCOL) return fail();
  const result: AIMotionRequest = { protocol: AI_MOTION_PROTOCOL, prompt: text(value.prompt, AI_MOTION_PROMPT_MAX_LENGTH, true), context: validateAIMotionContext(value.context) };
  if (utf8Bytes(result) > AI_MOTION_REQUEST_MAX_BYTES) return fail('AI 动作请求超过大小限制。');
  return result;
}

export function validateAIMotionOutput(input: unknown, context: AIMotionContext): AIMotionOutput {
  const value = record(input, ['summary', 'keyframes']);
  const { target: generationTarget } = validateAIMotionContext(context);
  const keys = array(value.keyframes, generationTarget.mode === 'full' ? 2 : 1, AI_MOTION_MAX_KEYFRAMES);
  let precedingTime = generationTarget.startSeconds;
  const keyframes = Array.from(keys, inputKey => {
    const key = record(inputKey, ['time', 'root', 'rotations']);
    const time = finite(key.time, generationTarget.startSeconds, generationTarget.endSeconds);
    if (time <= precedingTime || generationTarget.mode === 'interval' && time >= generationTarget.endSeconds) return fail('AI 只能修改固定区间内部且时间必须递增。');
    precedingTime = time;
    const rotations = record(key.rotations, JOINT_NAMES, []);
    return { time, root: vector(key.root, 100), rotations: Object.fromEntries(Object.entries(rotations).map(([name, value]) => [name, vector(value, 360)])) as AIMotionKeyframe['rotations'] };
  });
  if (generationTarget.mode === 'full' && keyframes.at(-1)!.time !== generationTarget.endSeconds) return fail('AI 整段动作必须覆盖准确结尾。');
  const result = { summary: text(value.summary, 240, true), keyframes };
  if (utf8Bytes(result) > AI_MOTION_RESULT_MAX_BYTES) return fail('AI 动作结果超过大小限制。');
  return result;
}
export function validateAIMotionResult(input: unknown, request: AIMotionRequest): AIMotionResult {
  const expected = validateAIMotionRequest(request);
  const value = record(input, ['protocol', 'provider', 'model', 'requestId', 'sourceHash', 'target', 'summary', 'keyframes']);
  const resultTarget = target(value.target, expected.context.timing.durationSeconds);
  if (value.protocol !== AI_MOTION_PROTOCOL || value.provider !== 'cloudflare-workers-ai' || value.model !== AI_MOTION_MODEL ||
    value.requestId !== expected.context.requestId || value.sourceHash !== expected.context.sourceHash ||
    resultTarget.mode !== expected.context.target.mode || resultTarget.startSeconds !== expected.context.target.startSeconds ||
    resultTarget.endSeconds !== expected.context.target.endSeconds) return fail('AI 候选已过期或与固定原稿范围不匹配。');
  const output = validateAIMotionOutput({ summary: value.summary, keyframes: value.keyframes }, expected.context);
  const result: AIMotionResult = { protocol: AI_MOTION_PROTOCOL, provider: 'cloudflare-workers-ai', model: AI_MOTION_MODEL,
    requestId: expected.context.requestId, sourceHash: expected.context.sourceHash, target: resultTarget, ...output };
  // Includes the server envelope; its metadata cannot evade the result budget.
  if (utf8Bytes(result) > AI_MOTION_RESULT_MAX_BYTES) return fail('AI 动作结果超过大小限制。');
  return result;
}

/** Model sees writable motion only; binding/source metadata is added by the server. */
export function aiMotionOutputSchema(context: AIMotionContext) {
  const { target: generationTarget } = validateAIMotionContext(context);
  const vectorSchema = (limit: number) => ({ type: 'array', minItems: 3, maxItems: 3, items: { type: 'number', minimum: -limit, maximum: limit } });
  const timeSchema = generationTarget.mode === 'interval'
    ? { type: 'number', exclusiveMinimum: generationTarget.startSeconds, exclusiveMaximum: generationTarget.endSeconds }
    : { type: 'number', exclusiveMinimum: generationTarget.startSeconds, maximum: generationTarget.endSeconds };
  return { type: 'object', additionalProperties: false, required: ['summary', 'keyframes'], properties: {
    summary: { type: 'string', minLength: 1, maxLength: 240 },
    keyframes: { type: 'array', minItems: generationTarget.mode === 'full' ? 2 : 1, maxItems: AI_MOTION_MAX_KEYFRAMES,
      items: { type: 'object', additionalProperties: false, required: ['time', 'root', 'rotations'], properties: {
        time: timeSchema, root: vectorSchema(100),
        rotations: { type: 'object', additionalProperties: false, properties: Object.fromEntries(JOINT_NAMES.map(name => [name, vectorSchema(360)])) },
      } },
    },
  } };
}

/** Inspect raw JSON before parsing so duplicate/escaped keys cannot overwrite data. */
export function parseAIMotionJson(source: string, maximumBytes = AI_MOTION_RESULT_MAX_BYTES): unknown {
  if (typeof source !== 'string' || new TextEncoder().encode(source).byteLength > maximumBytes) return fail('AI 数据超过大小限制。');
  let index = 0;
  const whitespace = () => { while (index < source.length && /\s/.test(source[index])) index++; };
  const stringToken = (): string => {
    if (source[index] !== '"') return fail();
    const start = index++;
    while (index < source.length) {
      const character = source[index++];
      if (character === '\\') index++;
      else if (character === '"') return source.slice(start, index);
    }
    return fail();
  };
  const value = (depth: number): void => {
    if (depth > 8) return fail();
    whitespace();
    if (source[index] === '"') { stringToken(); return; }
    if (source[index] === '{') {
      index++; whitespace(); const keys = new Set<string>();
      if (source[index] === '}') { index++; return; }
      while (index < source.length) {
        let key: string;
        try { key = JSON.parse(stringToken()) as string; } catch { return fail(); }
        if (forbidden.has(key) || keys.has(key)) return fail();
        keys.add(key); whitespace(); if (source[index++] !== ':') return fail();
        value(depth + 1); whitespace(); const separator = source[index++];
        if (separator === '}') return;
        if (separator !== ',') return fail();
        whitespace();
      }
      return fail();
    }
    if (source[index] === '[') {
      index++; whitespace(); if (source[index] === ']') { index++; return; }
      while (index < source.length) {
        value(depth + 1); whitespace(); const separator = source[index++];
        if (separator === ']') return;
        if (separator !== ',') return fail();
      }
      return fail();
    }
    const start = index;
    while (index < source.length && !/[\s,\]}]/.test(source[index])) index++;
    if (start === index) return fail();
  };
  value(0); whitespace(); if (index !== source.length) return fail();
  try { return JSON.parse(source) as unknown; } catch { return fail(); }
}
