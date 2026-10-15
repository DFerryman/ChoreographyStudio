import { describe, expect, it } from 'vitest';
import { DANCE_PLAN_PROTOCOL, DANCE_STEPS, danceBeatSeconds, dancePlanFromModelText, dancePlanOutputSchema, describeDanceRequest, localDancePlan, makeDancePlanRequest, mirrorDancePose, normalizeDancePlan, validateDancePlanRequest, validateDancePlanResult, type DancePose } from './dancePlan';

const pose = (arms: number[], step = 'none'): unknown => ({ arms, torso: [1, 2, 3], head: [0, 1], hips: [2, 4], step });
describe('keypose dance plan (ai-dance-plan-3)', () => {
  it('keeps dance beats within 0.4–1 s for every legal count map', () => {
    for (const bpm of [30, 45, 60, 90, 128, 180, 240]) for (const ratio of [.5, 1, 2] as const) {
      const beat = danceBeatSeconds({ bpm, musicBeatsPerDanceCount: ratio });
      expect(beat).toBeGreaterThanOrEqual(.4); expect(beat).toBeLessThanOrEqual(1);
    }
  });
  it('sends only the description and coarse framing; no poses, audio or scene data', () => {
    const request = makeDancePlanRequest('  street dance  ', { mode: 'interval', startSeconds: 4.37, endSeconds: 9.81 }, { bpm: 120, musicBeatsPerDanceCount: 1 });
    expect(request).toEqual({ protocol: DANCE_PLAN_PROTOCOL, prompt: 'street dance', target: { mode: 'interval', durationSeconds: 9.81 - 4.37 }, bpm: 120, beatSeconds: .5, beats: 11 });
    expect(() => validateDancePlanRequest({ ...request, extra: 1 })).toThrow();
    expect(() => validateDancePlanRequest({ ...request, prompt: '' })).toThrow();
    expect(makeDancePlanRequest('turn', { mode: 'interval', startSeconds: 1, endSeconds: 1.06 }, { bpm: 90, musicBeatsPerDanceCount: 1 }).beats).toBe(1);
  });
  it('asks the model for bounded integers and enumerations, never times or angles', () => {
    const schema = dancePlanOutputSchema(), poseSchema = schema.properties.phrases.items.properties.poses.items;
    expect(poseSchema.properties.step.enum).toEqual([...DANCE_STEPS]);
    expect(poseSchema.properties.arms).toMatchObject({ minItems: 6, maxItems: 6, items: { type: 'integer' } });
    expect(JSON.stringify(schema)).not.toMatch(/Seconds|degree|radian|root|quaternion/i);
  });
  it('clamps and repairs model output instead of rejecting the plan', () => {
    const plan = normalizeDancePlan({ summary: 'ok', style: 'unknown', energy: 'max', extra: true, phrases: [
      { poses: [pose([12, -9, 4.6, 3, 5, 5], 'L-side'), pose([1, 2, 3]), 'junk', pose([0, 0, 0, 0, 0, 0], 'moonwalk')] },
      { poses: [] }, [pose([5, 5, 5, 5, 5, 5])],
    ], order: [{ phrase: 1, mirror: true }, { phrase: 9 }, 0] });
    expect(plan!.style).toBe('freestyle'); expect(plan!.summary).toBe('ok'); expect(plan!.energy).toBe('medium');
    expect(plan!.phrases).toHaveLength(2);
    expect(plan!.phrases[0].poses[0]).toEqual({ arms: [10, -2, 5, 3, 5, 5], torso: [1, 2, 3], head: [0, 1], hips: [2, 4], step: 'L-side' });
    expect(plan!.phrases[0].poses[1].arms).toEqual([1, 2, 3, 1, 2, 1]);
    expect(plan!.phrases[0].poses[2].step).toBe('none');
    expect(plan!.order).toEqual([{ phrase: 1, mirror: true }, { phrase: 0, mirror: false }]);
    expect(normalizeDancePlan({ phrases: [{ poses: ['x'] }] })).toBeUndefined();
    expect(dancePlanFromModelText(`thinking...\n\`\`\`json\n${JSON.stringify({ phrases: [{ poses: [pose([1, 1, 1, 1, 1, 1])] }] })}\n\`\`\``)!.order).toEqual([{ phrase: 0, mirror: false }]);
    expect(dancePlanFromModelText('not json')).toBeUndefined();
  });
  it('mirrors a pose left/right', () => {
    const value = { arms: [9, 1, 2, 3, 4, 5], torso: [1, 2, 3], head: [1, 2], hips: [3, 4], step: 'turn-L' } as DancePose;
    expect(mirrorDancePose(value)).toEqual({ arms: [3, 4, 5, 9, 1, 2], torso: [1, -2, -3], head: [1, -2], hips: [-3, 4], step: 'turn-R' });
    expect(mirrorDancePose(mirrorDancePose(value))).toEqual(value);
  });
  it('local composer invents a different dance for every seed, in the requested style', () => {
    expect(describeDanceRequest('complex energetic hip-hop')).toEqual({ style: 'hiphop', energy: 'high' });
    expect(describeDanceRequest('slow lyrical piece').style).toBe('gentle');
    const a = localDancePlan('pop dance', 64, 1), b = localDancePlan('pop dance', 64, 2);
    expect(JSON.stringify(a.phrases)).not.toBe(JSON.stringify(b.phrases));
    expect(localDancePlan('pop dance', 64, 1)).toEqual(a);
    const poses = a.phrases.flatMap(phrase => phrase.poses);
    expect(new Set(poses.map(value => JSON.stringify(value.arms))).size).toBeGreaterThan(poses.length / 2);
    expect(normalizeDancePlan(a)).toEqual(a);
    expect(localDancePlan('spin around', 16, 3).phrases.some(phrase => phrase.poses.some(value => value.step.startsWith('turn')))).toBe(true);
    for (const beats of [1, 3, 150]) expect(localDancePlan('x', beats, beats).order.length).toBeGreaterThan(0);
  });
  it('validates the Worker result and its provenance', () => {
    const plan = localDancePlan('pop', 16, 5);
    expect(validateDancePlanResult({ protocol: DANCE_PLAN_PROTOCOL, source: 'ai', model: '@cf/openai/gpt-oss-20b', plan })!.plan).toEqual(plan);
    expect(validateDancePlanResult({ protocol: DANCE_PLAN_PROTOCOL, source: 'ai', model: 'local-dance-planner-1', plan })).toBeUndefined();
    expect(validateDancePlanResult({ protocol: 'ai-dance-plan-2', source: 'ai', model: '@cf/openai/gpt-oss-20b', plan })).toBeUndefined();
  });
});
