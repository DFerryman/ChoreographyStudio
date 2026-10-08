import { describe, expect, it } from 'vitest';
import { ACTIONS, bakePlan, makeCountMap, makePlan } from './index';
import { AI_MODEL, AI_PROTOCOL, AI_REQUEST_MAX_BYTES, aiArrangementSchema, buildAICandidate, makeAIRequest, parseAIJson, validateAIArrangement, validateAIRequest, validateAIResult } from './aiChoreography';
import { EDITABLE_JOINT_NAMES } from './keyframes';
import { isJointRotationWithinLimits } from './jointConstraints';

const map = makeCountMap({ bpm: 120, musicBeatsPerDanceCount: 1, firstCountSourceSeconds: 1.5, startOctet: 1, octetCount: 8, audioDurationSeconds: 60 });
const arrangement = {
  summary: '轻柔侧向舒展，末尾收势',
  slots: Array.from({ length: 8 }, (_, index) => ({ actionId: index === 7 ? 'settle' : 'side-reach', amplitude: 0.7 })),
};
const result = () => ({ protocol: AI_PROTOCOL, provider: 'cloudflare-workers-ai', model: AI_MODEL,
  countMapId: map.id, countMapVersion: map.version, durationSeconds: map.durationSeconds, arrangement });

describe('bounded AI arrangement contract (no inference)', () => {
  it('sends only a preference and compact confirmed timing, without music/audio/poses or model choice', () => {
    const request = makeAIRequest('  轻柔的舞蹈  ', map);
    expect(request).toEqual({ protocol: AI_PROTOCOL, prompt: '轻柔的舞蹈', timing: {
      countMapId: map.id, countMapVersion: map.version, bpm: 120, musicBeatsPerDanceCount: 1,
      durationSeconds: 32, octetCount: 8, confirmed: true,
    } });
    expect(new TextEncoder().encode(JSON.stringify(request)).length).toBeLessThan(AI_REQUEST_MAX_BYTES);
    expect(Object.keys(request)).toEqual(['protocol', 'prompt', 'timing']);
  });

  it.each([
    { prompt: 'x'.repeat(1001) }, { prompt: '' }, { prompt: ' \t\n ' },
    { prompt: 'a\u0000b' }, { protocol: 'original-contract-2.1.0' }, { model: AI_MODEL }, { audio: [] },
  ])('rejects request extras and unsuitable prompts (%#)', override => {
    expect(() => validateAIRequest({ ...makeAIRequest('轻柔', map), ...override })).toThrow();
  });

  it.each([
    { confirmed: false }, { bpm: 0 }, { bpm: Infinity }, { octetCount: 61 }, { octetCount: 2.5 },
    { musicBeatsPerDanceCount: 3 }, { durationSeconds: 31 }, { countMapVersion: 0 }, { countMapId: '' },
  ])('rejects unsafe or inconsistent confirmed timing (%#)', override => {
    const request = makeAIRequest('轻柔', map);
    expect(() => validateAIRequest({ ...request, timing: { ...request.timing, ...override } })).toThrow();
  });

  it('preserves non-integer durations and the exact final CountMap sample', () => {
    const uneven = makeCountMap({ bpm: 137, musicBeatsPerDanceCount: 1, firstCountSourceSeconds: 0, octetCount: 8, audioDurationSeconds: 50 });
    const ai = { ...result(), countMapId: uneven.id, countMapVersion: uneven.version, durationSeconds: uneven.durationSeconds };
    const candidate = buildAICandidate(uneven, ai);
    expect(candidate.take.times.at(-1)).toBe(uneven.durationSeconds);
    expect(candidate.take.times.slice(-2).at(0)).not.toBe(uneven.durationSeconds - 1 / 30);
    for (let i = 0; i <= uneven.octetCount; i++) expect(candidate.take.times).toContain(uneven.countTimesSeconds[i * 8]);
    expect(candidate.plan.durationSeconds).toBe(uneven.durationSeconds);
  });

  it.each([
    { slots: [] }, { slots: arrangement.slots.slice(1) }, { slots: [...arrangement.slots, arrangement.slots[0]] },
    { slots: arrangement.slots.map(slot => ({ ...slot, actionId: 'moonwalk' })) },
    { slots: arrangement.slots.map(slot => ({ ...slot, amplitude: NaN })) },
    { slots: arrangement.slots.map(slot => ({ ...slot, amplitude: 1.01 })) },
    { slots: arrangement.slots.map(slot => ({ ...slot, amplitude: 0.349 })) },
    { slots: arrangement.slots.map(slot => ({ ...slot, weight: 70 })) }, { summary: '' }, { summary: 'x'.repeat(241) },
    { root: [0, 1, 0] },
  ])('rejects unexpected actions, quantities and forged simulation parameters (%#)', override => {
    expect(() => validateAIArrangement({ ...arrangement, ...override }, 8)).toThrow();
  });

  it.each([
    '{"summary":"a","summary":"b","slots":[]}', '{"__proto__":{}}', '{"constructor":[]}',
    '{"slots":[{"prototype":{}}]}', '{"a":1} trailing', '[[[[[[[[[[0]]]]]]]]]]', '{"a":1e999}',
    '{"slots":[]', '{"a":}',
  ])('rejects ambiguous, malformed and dangerous raw model JSON (%#)', source => {
    if (source === '{"a":1e999}') {
      expect(() => validateAIArrangement(parseAIJson(source), 8)).toThrow();
    } else expect(() => parseAIJson(source)).toThrow();
  });

  it('counts UTF-8 bytes rather than characters and rejects duplicate escaped field names', () => {
    expect(() => parseAIJson('"' + '舞'.repeat(1500) + '"', 4096)).toThrow();
    expect(() => parseAIJson('{"summary":"a","\\u0073ummary":"b"}')).toThrow();
    expect(parseAIJson(JSON.stringify(arrangement))).toEqual(arrangement);
  });

  it.each([
    { countMapId: 'other-map' }, { countMapVersion: map.version + 1 }, { durationSeconds: map.durationSeconds + 1 },
    { provider: 'local-template' }, { model: '@cf/other' }, { protocol: 'ai-other' }, { extra: true },
  ])('rejects stale or misrepresented AI results (%#)', override => {
    expect(() => validateAIResult({ ...result(), ...override }, map)).toThrow();
  });

  it('schema permits exactly the existing actions and the bounded phrase count/amplitude', () => {
    const schema = aiArrangementSchema(8);
    expect(schema.additionalProperties).toBe(false);
    expect(schema.properties.slots).toMatchObject({ minItems: 8, maxItems: 8, items: {
      additionalProperties: false, properties: { actionId: { enum: ACTIONS.map(action => action.id) }, amplitude: { minimum: 0.35, maximum: 1 } },
    } });
  });

  it('builds actual changed motion, keeps all limits and authority/source data separate', () => {
    const originalPlan = makePlan(map), originalTake = bakePlan(originalPlan, map);
    const original = JSON.stringify({ map, originalPlan, originalTake, arrangement });
    const candidate = buildAICandidate(map, result());
    expect(candidate.plan.slots[0].actionId).toBe('side-reach');
    expect(candidate.take.planId).toBe(candidate.plan.id);
    expect(candidate.take.countMapId).toBe(map.id);
    expect(candidate.take.provenance).toBe('synthetic-demo');
    expect(candidate.ai.provider).toBe('cloudflare-workers-ai');
    expect(candidate.take.poses).not.toEqual(originalTake.poses);
    const unscaled = bakePlan(candidate.plan, map);
    expect(candidate.take.poses).not.toEqual(unscaled.poses);
    for (const pose of candidate.take.poses) for (const joint of EDITABLE_JOINT_NAMES) {
      expect(Math.hypot(...pose.joints[joint])).toBeCloseTo(1, 9);
      expect(isJointRotationWithinLimits(joint, pose.joints[joint])).toBe(true);
    }
    expect(JSON.stringify({ map, originalPlan, originalTake, arrangement })).toBe(original);
    candidate.ai.arrangement.slots[0].amplitude = 0.4;
    expect(arrangement.slots[0].amplitude).toBe(0.7);
  });

  it('accepts the maximum 60 phrase timing with bounded samples and smooth amplitude changes', () => {
    const maximum = makeCountMap({ bpm: 240, musicBeatsPerDanceCount: 0.5, firstCountSourceSeconds: 0, octetCount: 60, audioDurationSeconds: 60 });
    const input = { ...result(), countMapId: maximum.id, durationSeconds: maximum.durationSeconds,
      arrangement: { summary: '交替轻柔与舒展', slots: Array.from({ length: 60 }, (_, index) => ({ actionId: 'side-reach', amplitude: index % 2 ? 0.35 : 1 })) },
    };
    const candidate = buildAICandidate(maximum, input);
    expect(candidate.take.times.length).toBeLessThanOrEqual(6001);
    expect(candidate.plan.slots.length).toBe(60);
    expect(candidate.take.times.at(-1)).toBe(60);
    for (let index = 1; index < candidate.take.poses.length; index++) {
      const a = candidate.take.poses[index - 1].joints.LeftUpperArm, b = candidate.take.poses[index].joints.LeftUpperArm;
      const dot = Math.abs(a.reduce((sum, value, i) => sum + value * b[i], 0));
      expect(dot).toBeGreaterThan(0.99);
    }
  });
});
