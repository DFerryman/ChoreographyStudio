/** Compact AI arrangement contract. Motion remains original procedural content. */
import { ACTIONS, bakePlan, makePlan, type ArrangementPlan, type CountMap } from './index';
import { EDITABLE_JOINT_NAMES } from './keyframes';
import { constrainJointRotation } from './jointConstraints';
import { type BakedTake, type Quat } from './motion-types';

export const AI_PROTOCOL = 'ai-arrangement-1' as const;
export const AI_MODEL = '@cf/qwen/qwen3-30b-a3b-fp8' as const;
export const AI_REQUEST_MAX_BYTES = 4096;
export const AI_RESULT_MAX_BYTES = 16384;
export const AI_PROMPT_MAX_LENGTH = 1000;
export interface AITiming {
  countMapId: string;
  countMapVersion: number;
  bpm: number;
  musicBeatsPerDanceCount: 0.5 | 1 | 2;
  durationSeconds: number;
  octetCount: number;
  confirmed: true;
}
export interface AIChoreographyRequest { protocol: typeof AI_PROTOCOL; prompt: string; timing: AITiming }
export interface AIArrangementSlot { actionId: string; amplitude: number }
export interface AIArrangement { summary: string; slots: AIArrangementSlot[] }
export interface AIChoreographyResult {
  protocol: typeof AI_PROTOCOL;
  provider: 'cloudflare-workers-ai';
  model: typeof AI_MODEL;
  countMapId: string;
  countMapVersion: number;
  durationSeconds: number;
  arrangement: AIArrangement;
}

const fail = (message = 'AI 编排数据无效。'): never => { throw new Error(message); };
const forbidden = new Set(['__proto__', 'constructor', 'prototype']);
function object(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fail();
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return fail();
  const record = value as Record<string, unknown>;
  const ownKeys = Object.keys(record);
  if (ownKeys.length !== keys.length || ownKeys.some(key => forbidden.has(key) || !keys.includes(key))) return fail();
  return record;
}
function number(value: unknown, min: number, max: number, integer = false): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max || (integer && !Number.isInteger(value))) return fail();
  return value;
}
function text(value: unknown, max: number): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)) return fail();
  return value.trim();
}

/** Reject duplicate/dangerous keys before native parsing can hide an overwrite. */
export function parseAIJson(source: string, maximumBytes = AI_RESULT_MAX_BYTES): unknown {
  if (new TextEncoder().encode(source).byteLength > maximumBytes) return fail('AI 数据超过大小限制。');
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

export function validateAIRequest(input: unknown): AIChoreographyRequest {
  const request = object(input, ['protocol', 'prompt', 'timing']);
  if (request.protocol !== AI_PROTOCOL) return fail();
  const timing = object(request.timing, ['countMapId', 'countMapVersion', 'bpm', 'musicBeatsPerDanceCount', 'durationSeconds', 'octetCount', 'confirmed']);
  const ratio = timing.musicBeatsPerDanceCount;
  if (ratio !== 0.5 && ratio !== 1 && ratio !== 2 || timing.confirmed !== true) return fail();
  const normalized: AITiming = {
    countMapId: text(timing.countMapId, 120),
    countMapVersion: number(timing.countMapVersion, 1, Number.MAX_SAFE_INTEGER, true),
    bpm: number(timing.bpm, 30, 240), musicBeatsPerDanceCount: ratio,
    durationSeconds: number(timing.durationSeconds, 16 - 1e-9, 60 + 1e-9),
    octetCount: number(timing.octetCount, 2, 60, true), confirmed: true,
  };
  const expected = normalized.octetCount * 8 * 60 / normalized.bpm * ratio;
  if (Math.abs(expected - normalized.durationSeconds) > 1e-9) return fail('AI 编排时长必须匹配已确认的完整八拍。');
  return { protocol: AI_PROTOCOL, prompt: text(request.prompt, AI_PROMPT_MAX_LENGTH), timing: normalized };
}

export function makeAIRequest(prompt: string, map: CountMap): AIChoreographyRequest {
  return validateAIRequest({ protocol: AI_PROTOCOL, prompt, timing: {
    countMapId: map.id, countMapVersion: map.version, bpm: map.bpm,
    musicBeatsPerDanceCount: map.musicBeatsPerDanceCount, durationSeconds: map.durationSeconds,
    octetCount: map.octetCount, confirmed: map.confirmed,
  } });
}

export function validateAIArrangement(input: unknown, octetCount: number): AIArrangement {
  const result = object(input, ['summary', 'slots']);
  if (!Array.isArray(result.slots) || result.slots.length !== octetCount) return fail('AI 编排必须覆盖全部已确认八拍。');
  return { summary: text(result.summary, 240), slots: result.slots.map(inputSlot => {
    const slot = object(inputSlot, ['actionId', 'amplitude']);
    if (typeof slot.actionId !== 'string' || !ACTIONS.some(action => action.id === slot.actionId)) return fail('AI 返回了动作包以外的动作。');
    return { actionId: slot.actionId, amplitude: number(slot.amplitude, 0.35, 1) };
  }) };
}

export function validateAIResult(input: unknown, map: CountMap): AIChoreographyResult {
  makeAIRequest('检查数拍', map);
  const result = object(input, ['protocol', 'provider', 'model', 'countMapId', 'countMapVersion', 'durationSeconds', 'arrangement']);
  if (result.protocol !== AI_PROTOCOL || result.provider !== 'cloudflare-workers-ai' || result.model !== AI_MODEL ||
    result.countMapId !== map.id || result.countMapVersion !== map.version || result.durationSeconds !== map.durationSeconds) return fail('AI 候选与当前数拍版本不匹配。');
  return {
    protocol: AI_PROTOCOL, provider: 'cloudflare-workers-ai', model: AI_MODEL,
    countMapId: map.id, countMapVersion: map.version, durationSeconds: map.durationSeconds,
    arrangement: validateAIArrangement(result.arrangement, map.octetCount),
  };
}

/** Schema for the selected model; validation still runs independently afterwards. */
export function aiArrangementSchema(octetCount: number) {
  return {
    type: 'object', additionalProperties: false, required: ['summary', 'slots'],
    properties: {
      summary: { type: 'string', minLength: 1, maxLength: 240 },
      slots: { type: 'array', minItems: octetCount, maxItems: octetCount, items: {
        type: 'object', additionalProperties: false, required: ['actionId', 'amplitude'],
        properties: { actionId: { type: 'string', enum: ACTIONS.map(action => action.id) }, amplitude: { type: 'number', minimum: 0.35, maximum: 1 } },
      } },
    },
  };
}

function scaledQuaternion(input: Quat, amount: number): Quat {
  const length = Math.hypot(...input);
  const sign = input[3] < 0 ? -1 : 1;
  const q = input.map(value => value / length * sign) as Quat;
  const angle = Math.acos(Math.max(-1, Math.min(1, q[3])));
  const scale = angle < 1e-8 ? amount : Math.sin(angle * amount) / Math.sin(angle);
  return [q[0] * scale, q[1] * scale, q[2] * scale, Math.cos(angle * amount)];
}

/** Do not re-bake this plan on adoption: amplitude lives in the authoritative take. */
export function buildAICandidate(map: CountMap, input: unknown): { plan: ArrangementPlan; take: BakedTake; ai: AIChoreographyResult } {
  const ai = validateAIResult(input, map);
  const plan = makePlan(map);
  plan.slots = plan.slots.map((slot, index) => {
    const action = ACTIONS.find(action => action.id === ai.arrangement.slots[index].actionId)!;
    return { ...slot, actionId: action.id, label: action.label, teachingCue: action.cue };
  });
  const take = bakePlan(plan, map);
  const secondsPerOctet = map.durationSeconds / map.octetCount;
  // Amplitude transitions need time even at the fastest supported count rate.
  const radius = Math.min(0.3, secondsPerOctet * 0.4);
  const smooth = (x: number) => x * x * x * (x * (x * 6 - 15) + 10);
  take.poses = take.poses.map((pose, index) => {
    const time = take.times[index];
    const slotIndex = Math.min(map.octetCount - 1, Math.floor(time / secondsPerOctet));
    let amplitude = ai.arrangement.slots[slotIndex].amplitude;
    const start = slotIndex * secondsPerOctet, end = start + secondsPerOctet;
    if (slotIndex > 0 && time - start < radius) {
      const blend = smooth((time - start + radius) / (2 * radius));
      amplitude = ai.arrangement.slots[slotIndex - 1].amplitude * (1 - blend) + amplitude * blend;
    } else if (slotIndex < map.octetCount - 1 && end - time < radius) {
      const blend = smooth((time - end + radius) / (2 * radius));
      amplitude = amplitude * (1 - blend) + ai.arrangement.slots[slotIndex + 1].amplitude * blend;
    }
    const result = { root: [...pose.root] as typeof pose.root, joints: { ...pose.joints } };
    result.root[0] *= amplitude; result.root[1] = 1.05 + (result.root[1] - 1.05) * amplitude; result.root[2] *= amplitude;
    for (const joint of EDITABLE_JOINT_NAMES) result.joints[joint] = constrainJointRotation(joint, scaledQuaternion(pose.joints[joint], amplitude));
    return result;
  });
  return { plan, take, ai };
}
