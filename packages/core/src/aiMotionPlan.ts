/** Selective semantic planning over genuine motion priors. This protocol does
 * not let a language model invent joint angles or certify physical validity. */
import { AI_MOTION_MODEL, AI_MOTION_REQUEST_MAX_BYTES, AI_MOTION_RESULT_MAX_BYTES,
  validateAIMotionRequest, type AIMotionRequest, type AIMotionTarget } from './aiMotion';
import { RIG_CALIBRATION_VERSION } from './humanoid';

export const AI_MOTION_PLAN_PROTOCOL = 'ai-motion-plan-1' as const;
export const AI_MOTION_PLAN_MAX_SEGMENTS = 32;
export const AI_MOTION_PLAN_MAX_CLIPS = 24;
export const AI_MOTION_PLAN_MAX_OUTPUT_TOKENS = 8192;
export const AI_MOTION_PLAN_MIN_DURATION_ERROR = 'AI 编舞规划区间至少需要 0.1 秒。';
/** Only representational endpoint roundoff is allowed; real short intervals
 * still fail before inference. Coverage endpoints themselves stay exact. */
export function hasAIMotionPlanMinimumDuration(startSeconds: number, endSeconds: number): boolean {
  if (!Number.isFinite(startSeconds) || !Number.isFinite(endSeconds) || endSeconds <= startSeconds) return false;
  const magnitude = Math.max(.1, Math.abs(startSeconds), Math.abs(endSeconds));
  const endpointUlp = 2 ** (Math.floor(Math.log2(magnitude)) - 52);
  return endSeconds - startSeconds >= .1 - endpointUlp;
}
export const AI_MOTION_PLAN_CONTACT_HINTS = ['standing', 'floor', 'airborne', 'mixed', 'unknown'] as const;
export type AIMotionPlanContactHint = typeof AI_MOTION_PLAN_CONTACT_HINTS[number];
export interface AIMotionPlanClip {
  id: string;
  sourceHash: string;
  label: string;
  tags: string[];
  durationSeconds: number;
  skeletonId: string;
}
export interface AIMotionPlanCatalog { version: string; clips: AIMotionPlanClip[] }
export interface AIMotionPlanRequest {
  protocol: typeof AI_MOTION_PLAN_PROTOCOL;
  motion: AIMotionRequest;
  catalog: AIMotionPlanCatalog;
}
export interface AIMotionPlanSegment {
  clipId: string;
  startSeconds: number;
  endSeconds: number;
  sourceStartSeconds: number;
  sourceEndSeconds: number;
  yawDegrees: number;
  /** Additional horizontal travel over the captured trajectory, in meters. */
  travelXZ: [number, number];
  /** The incoming blend stays entirely inside this segment. */
  transitionSeconds: number;
  /** Hypothesis only; deterministic contact inference/validation decides. */
  contactHint: AIMotionPlanContactHint;
}
export interface AIMotionPlanOutput {
  summary: string;
  intentMatch: 'supported' | 'partial' | 'unsupported';
  limitations: string[];
  segments: AIMotionPlanSegment[];
}
export interface AIMotionPlanResult extends AIMotionPlanOutput {
  protocol: typeof AI_MOTION_PLAN_PROTOCOL;
  provider: 'cloudflare-workers-ai';
  model: typeof AI_MOTION_MODEL;
  requestId: string;
  sourceHash: string;
  target: AIMotionTarget;
  catalogVersion: string;
  sources: { clipId: string; sourceHash: string }[];
}

const fail = (message = 'AI 动作规划数据无效。'): never => { throw new Error(message); };
const forbidden = new Set(['__proto__', 'constructor', 'prototype']);
const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).byteLength;
function record(input: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input) ||
    Object.getPrototypeOf(input) !== Object.prototype && Object.getPrototypeOf(input) !== null) return fail();
  const descriptors = Object.getOwnPropertyDescriptors(input);
  const actual = Reflect.ownKeys(descriptors);
  if (actual.length !== keys.length || actual.some(key => typeof key !== 'string' || forbidden.has(key) || !keys.includes(key)) ||
    keys.some(key => !Object.hasOwn(descriptors, key)) ||
    Object.values(descriptors).some(descriptor => !Object.hasOwn(descriptor, 'value'))) return fail();
  return input as Record<string, unknown>;
}
function array(input: unknown, min: number, max: number): unknown[] {
  if (!Array.isArray(input) || Object.getPrototypeOf(input) !== Array.prototype || input.length < min || input.length > max) return fail();
  const descriptors = Object.getOwnPropertyDescriptors(input);
  if (Reflect.ownKeys(descriptors).length !== input.length + 1) return fail();
  for (let i = 0; i < input.length; i++) if (!Object.hasOwn(descriptors, String(i)) || !Object.hasOwn(descriptors[String(i)], 'value')) return fail();
  return input;
}
function text(input: unknown, max: number): string {
  if (typeof input !== 'string' || !input.trim() || input.length > max || /[\u0000-\u001f]/.test(input)) return fail();
  return input;
}
function number(input: unknown, min: number, max: number): number {
  if (typeof input !== 'number' || !Number.isFinite(input) || input < min || input > max) return fail();
  return input;
}
function hash(input: unknown): string {
  if (typeof input !== 'string' || !/^[a-f0-9]{64}$/.test(input)) return fail();
  return input;
}

export function validateAIMotionPlanCatalog(input: unknown): AIMotionPlanCatalog {
  const value = record(input, ['version', 'clips']);
  const ids = new Set<string>();
  return { version: text(value.version, 128), clips: array(value.clips, 1, AI_MOTION_PLAN_MAX_CLIPS).map(inputClip => {
    const clip = record(inputClip, ['id', 'sourceHash', 'label', 'tags', 'durationSeconds', 'skeletonId']);
    const id = text(clip.id, 128);
    if (forbidden.has(id) || ids.has(id) || clip.skeletonId !== RIG_CALIBRATION_VERSION) return fail();
    ids.add(id);
    const tags = array(clip.tags, 1, 16).map(tag => text(tag, 80));
    if (new Set(tags).size !== tags.length) return fail();
    return { id, sourceHash: hash(clip.sourceHash), label: text(clip.label, 160), tags,
      durationSeconds: number(clip.durationSeconds, 0.1, 600), skeletonId: RIG_CALIBRATION_VERSION };
  }) };
}
export function validateAIMotionPlanRequest(input: unknown): AIMotionPlanRequest {
  const value = record(input, ['protocol', 'motion', 'catalog']);
  if (value.protocol !== AI_MOTION_PLAN_PROTOCOL) return fail();
  const result: AIMotionPlanRequest = { protocol: AI_MOTION_PLAN_PROTOCOL,
    motion: validateAIMotionRequest(value.motion), catalog: validateAIMotionPlanCatalog(value.catalog) };
  const target = result.motion.context.target;
  if (!hasAIMotionPlanMinimumDuration(target.startSeconds, target.endSeconds)) return fail(AI_MOTION_PLAN_MIN_DURATION_ERROR);
  if (bytes(result) > AI_MOTION_REQUEST_MAX_BYTES) return fail('AI 动作规划请求超过大小限制。');
  return result;
}
export function makeAIMotionPlanRequest(motion: AIMotionRequest, catalog: AIMotionPlanCatalog): AIMotionPlanRequest {
  // File names are advisory; scene/audio identities and all motion context stay
  // exact. Reserve room for the catalog without truncating intent or read-only
  // poses, velocities or CountMap samples. Work on a detached payload only.
  const bounded = structuredClone(validateAIMotionRequest(motion));
  for (const audio of bounded.context.audio) audio.name = Array.from(audio.name.trim()).slice(0, 64).join('');
  return validateAIMotionPlanRequest({ protocol: AI_MOTION_PLAN_PROTOCOL, motion: bounded, catalog });
}
export function validateAIMotionPlanOutput(input: unknown, request: AIMotionPlanRequest): AIMotionPlanOutput {
  const expected = validateAIMotionPlanRequest(request);
  const value = record(input, ['summary', 'intentMatch', 'limitations', 'segments']);
  if (value.intentMatch !== 'supported' && value.intentMatch !== 'partial' && value.intentMatch !== 'unsupported') return fail();
  const intentMatch = value.intentMatch;
  const limitations = array(value.limitations, intentMatch === 'supported' ? 0 : 1, 8).map(item => text(item, 160));
  const { target } = expected.motion.context;
  let previous = target.startSeconds;
  const segments = array(value.segments, intentMatch === 'unsupported' ? 0 : 1, intentMatch === 'unsupported' ? 0 : AI_MOTION_PLAN_MAX_SEGMENTS).map(inputSegment => {
    const segment = record(inputSegment, ['clipId', 'startSeconds', 'endSeconds', 'sourceStartSeconds', 'sourceEndSeconds', 'yawDegrees', 'travelXZ', 'transitionSeconds', 'contactHint']);
    const clipId = text(segment.clipId, 128), clip = expected.catalog.clips.find(clip => clip.id === clipId);
    if (!clip) return fail('AI 只能选择已提供的真实动作来源。');
    const startSeconds = number(segment.startSeconds, target.startSeconds, target.endSeconds);
    const endSeconds = number(segment.endSeconds, target.startSeconds, target.endSeconds);
    const sourceStartSeconds = number(segment.sourceStartSeconds, 0, clip.durationSeconds);
    const sourceEndSeconds = number(segment.sourceEndSeconds, 0, clip.durationSeconds);
    const duration = endSeconds - startSeconds, sourceDuration = sourceEndSeconds - sourceStartSeconds;
    if (startSeconds !== previous || !hasAIMotionPlanMinimumDuration(startSeconds, endSeconds) || sourceDuration <= 0 || duration / sourceDuration < 0.5 || duration / sourceDuration > 2) return fail('AI 动作规划必须连续覆盖目标且保持合理速度。');
    previous = endSeconds;
    const travel = array(segment.travelXZ, 2, 2);
    if (!AI_MOTION_PLAN_CONTACT_HINTS.includes(segment.contactHint as AIMotionPlanContactHint)) return fail();
    return { clipId, startSeconds, endSeconds, sourceStartSeconds, sourceEndSeconds,
      yawDegrees: number(segment.yawDegrees, -180, 180), travelXZ: [number(travel[0], -2, 2), number(travel[1], -2, 2)] as [number, number],
      transitionSeconds: number(segment.transitionSeconds, 0, Math.min(1, duration / 3)), contactHint: segment.contactHint as AIMotionPlanContactHint };
  });
  if (intentMatch !== 'unsupported' && previous !== target.endSeconds) return fail('AI 动作规划必须连续覆盖目标且保持合理速度。');
  const result: AIMotionPlanOutput = { summary: text(value.summary, 240), intentMatch, limitations, segments };
  if (bytes(result) > AI_MOTION_RESULT_MAX_BYTES) return fail('AI 动作规划结果超过大小限制。');
  return result;
}
export function motionPlanSources(output: AIMotionPlanOutput, catalog: AIMotionPlanCatalog): AIMotionPlanResult['sources'] {
  const used = new Set(output.segments.map(segment => segment.clipId));
  return catalog.clips.filter(clip => used.has(clip.id)).map(clip => ({ clipId: clip.id, sourceHash: clip.sourceHash }));
}
export function validateAIMotionPlanResult(input: unknown, request: AIMotionPlanRequest): AIMotionPlanResult {
  const expected = validateAIMotionPlanRequest(request);
  const value = record(input, ['protocol', 'provider', 'model', 'requestId', 'sourceHash', 'target', 'catalogVersion', 'sources', 'summary', 'intentMatch', 'limitations', 'segments']);
  const resultTarget = record(value.target, ['mode', 'startSeconds', 'endSeconds']);
  const { target, requestId, sourceHash } = expected.motion.context;
  if (value.protocol !== AI_MOTION_PLAN_PROTOCOL || value.provider !== 'cloudflare-workers-ai' || value.model !== AI_MOTION_MODEL ||
    value.requestId !== requestId || value.sourceHash !== sourceHash || value.catalogVersion !== expected.catalog.version ||
    resultTarget.mode !== target.mode || resultTarget.startSeconds !== target.startSeconds || resultTarget.endSeconds !== target.endSeconds) return fail('AI 候选已过期或与固定原稿范围不匹配。');
  const output = validateAIMotionPlanOutput({ summary: value.summary, intentMatch: value.intentMatch, limitations: value.limitations, segments: value.segments }, expected);
  const sources = motionPlanSources(output, expected.catalog);
  const actualSources = array(value.sources, sources.length, sources.length).map(inputSource => {
    const source = record(inputSource, ['clipId', 'sourceHash']);
    return { clipId: text(source.clipId, 128), sourceHash: hash(source.sourceHash) };
  });
  if (actualSources.some((source, index) => source.clipId !== sources[index].clipId || source.sourceHash !== sources[index].sourceHash)) return fail('AI 动作来源已更改。');
  const result: AIMotionPlanResult = { protocol: AI_MOTION_PLAN_PROTOCOL, provider: 'cloudflare-workers-ai', model: AI_MOTION_MODEL,
    requestId, sourceHash, target: { ...target }, catalogVersion: expected.catalog.version, sources, ...output };
  if (bytes(result) > AI_MOTION_RESULT_MAX_BYTES) return fail('AI 动作规划结果超过大小限制。');
  return result;
}
export function aiMotionPlanOutputSchema(request: AIMotionPlanRequest) {
  const expected = validateAIMotionPlanRequest(request), { target } = expected.motion.context;
  const time = { type: 'number', minimum: target.startSeconds, maximum: target.endSeconds };
  return { type: 'object', additionalProperties: false, required: ['summary', 'intentMatch', 'limitations', 'segments'], properties: {
    summary: { type: 'string', minLength: 1, maxLength: 240 },
    intentMatch: { type: 'string', enum: ['supported', 'partial', 'unsupported'] },
    limitations: { type: 'array', minItems: 0, maxItems: 8, items: { type: 'string', minLength: 1, maxLength: 160 } },
    segments: { type: 'array', minItems: 0, maxItems: AI_MOTION_PLAN_MAX_SEGMENTS,
      items: { type: 'object', additionalProperties: false,
        required: ['clipId', 'startSeconds', 'endSeconds', 'sourceStartSeconds', 'sourceEndSeconds', 'yawDegrees', 'travelXZ', 'transitionSeconds', 'contactHint'],
        properties: { clipId: { type: 'string', enum: expected.catalog.clips.map(clip => clip.id) }, startSeconds: time, endSeconds: time,
          sourceStartSeconds: { type: 'number', minimum: 0, maximum: Math.max(...expected.catalog.clips.map(clip => clip.durationSeconds)) },
          sourceEndSeconds: { type: 'number', minimum: 0, maximum: Math.max(...expected.catalog.clips.map(clip => clip.durationSeconds)) },
          yawDegrees: { type: 'number', minimum: -180, maximum: 180 },
          travelXZ: { type: 'array', minItems: 2, maxItems: 2, items: { type: 'number', minimum: -2, maximum: 2 } },
          transitionSeconds: { type: 'number', minimum: 0, maximum: 1 }, contactHint: { type: 'string', enum: AI_MOTION_PLAN_CONTACT_HINTS },
        } },
    },
  } };
}
