import { describe, expect, it } from 'vitest';
import { DANCE_MOVE_IDS, DANCE_PLAN_PROTOCOL, danceBeatSeconds, dancePlanFromModelText, dancePlanOutputSchema, localDancePlan, makeDancePlanRequest, normalizeDancePlan, validateDancePlanRequest, validateDancePlanResult } from './dancePlan';

describe('semantic dance plan (ai-dance-plan-2)', () => {
  it('keeps dance beats within 0.4–1 s for every legal count map', () => {
    for (const bpm of [30, 45, 60, 90, 128, 180, 240]) for (const ratio of [.5, 1, 2] as const) {
      const beat = danceBeatSeconds({ bpm, musicBeatsPerDanceCount: ratio });
      expect(beat).toBeGreaterThanOrEqual(.4); expect(beat).toBeLessThanOrEqual(1);
    }
  });
  it('sends only the description and coarse framing; no poses, audio or scene data', () => {
    const request = makeDancePlanRequest('  来段街舞  ', { mode: 'interval', startSeconds: 4.37, endSeconds: 9.81 }, { bpm: 120, musicBeatsPerDanceCount: 1 });
    expect(request).toEqual({ protocol: DANCE_PLAN_PROTOCOL, prompt: '来段街舞', target: { mode: 'interval', durationSeconds: 9.81 - 4.37 }, bpm: 120, beatSeconds: .5, beats: 11 });
    expect(() => validateDancePlanRequest({ ...request, extra: 1 })).toThrow();
    expect(() => validateDancePlanRequest({ ...request, prompt: '' })).toThrow();
    // Any positive range is plannable; there is no minimum the model must hit.
    expect(makeDancePlanRequest('转', { mode: 'interval', startSeconds: 1, endSeconds: 1.06 }, { bpm: 90, musicBeatsPerDanceCount: 1 }).beats).toBe(1);
  });
  it('exposes only enumerations to the model', () => {
    const schema = dancePlanOutputSchema();
    expect(schema.properties.moves.items.properties.move.enum).toEqual([...DANCE_MOVE_IDS]);
    expect(JSON.stringify(schema)).not.toMatch(/Seconds|degrees|root|rotation/i);
  });
  it('normalizes leniently instead of rejecting the whole plan', () => {
    const plan = normalizeDancePlan({ summary: '好', style: 'unknown', energy: 'max', extra: true,
      moves: [{ move: 'Step Touch', beats: 5 }, { move: 'backflip', beats: 4 }, 'turn', { move: 'pose', beats: 1, mirror: true }] });
    expect(plan).toEqual({ summary: '好', style: 'freestyle', energy: 'medium', moves: [
      { move: 'step-touch', beats: 4, mirror: false }, { move: 'turn', beats: 8, mirror: false }, { move: 'pose', beats: 2, mirror: true }] });
    expect(normalizeDancePlan({ moves: [{ move: 'backflip' }] })).toBeUndefined();
    expect(normalizeDancePlan({ moves: ['groove'] })!.summary).toContain('律动');
    expect(dancePlanFromModelText('思考…\n```json\n{"summary":"x","style":"pop","energy":"low","moves":[{"move":"groove","beats":4,"mirror":false}]}\n```')!.moves).toHaveLength(1);
    expect(dancePlanFromModelText('not json')).toBeUndefined();
  });
  it('local rule planner always returns a usable plan that follows the description', () => {
    expect(localDancePlan('来段复杂街舞', 32)).toMatchObject({ style: 'hiphop', energy: 'high' });
    expect(localDancePlan('温柔舒缓', 32)).toMatchObject({ style: 'gentle', energy: 'low' });
    expect(localDancePlan('拉丁 萨尔萨', 16).style).toBe('latin');
    expect(localDancePlan('我想要踢腿和拍手', 16).moves.slice(0, 2).map(move => move.move).sort()).toEqual(['clap', 'kick']);
    for (const prompt of ['x', '后空翻', 'robot dance']) for (const beats of [1, 3, 150]) {
      const plan = localDancePlan(prompt, beats);
      expect(plan.moves.length).toBeGreaterThan(0); expect(plan.moves.length).toBeLessThanOrEqual(24);
    }
  });
  it('validates the Worker result and its provenance', () => {
    const plan = localDancePlan('流行', 16);
    expect(validateDancePlanResult({ protocol: DANCE_PLAN_PROTOCOL, source: 'ai', model: '@cf/openai/gpt-oss-20b', plan })!.plan).toEqual(plan);
    expect(validateDancePlanResult({ protocol: DANCE_PLAN_PROTOCOL, source: 'ai', model: 'local-dance-planner-1', plan })).toBeUndefined();
    expect(validateDancePlanResult({ protocol: 'ai-motion-plan-1', source: 'ai', model: '@cf/openai/gpt-oss-20b', plan })).toBeUndefined();
  });
});
