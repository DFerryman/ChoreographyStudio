import { afterEach, describe, expect, it, vi } from 'vitest';
import { DANCE_PLAN_MODEL, DANCE_PLAN_PROTOCOL, makeDancePlanRequest } from '../../../packages/core/src/dancePlan';
import { requestDancePlan } from './dancePlanClient';

const input = makeDancePlanRequest('energetic hip-hop', { mode: 'full', startSeconds: 0, endSeconds: 16 }, { bpm: 120, musicBeatsPerDanceCount: 1 });
const plan = { summary: 's', style: 'hiphop', energy: 'high', phrases: [{ poses: [{ arms: [5, 9, 8, 2, 4, 9], torso: [1, 0, 2], head: [0, 0], hips: [0, 5], step: 'R-side' }] }], order: [{ phrase: 0, mirror: false }] };
afterEach(() => vi.unstubAllGlobals());
const respond = (status: number, value: unknown) => vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } })));

describe('dance plan client', () => {
  it('uses a valid AI plan', async () => {
    respond(200, { protocol: DANCE_PLAN_PROTOCOL, source: 'ai', model: DANCE_PLAN_MODEL, plan });
    expect(await requestDancePlan(input, new AbortController().signal)).toMatchObject({ source: 'ai', plan });
  });
  it.each([[503, { code: 'AI_UNAVAILABLE' }, 'temporarily unavailable'], [429, { code: 'AI_RATE_LIMITED' }, 'per minute'], [502, { code: 'AI_OUTPUT_INVALID' }, 'unusable'], [502, { code: 'AI_OUTPUT_INVALID', detail: 'empty reply' }, 'unusable (empty reply)'], [200, { nonsense: true }, 'unusable']])(
    'falls back to the local planner on HTTP %i', async (status, value, reason) => {
      respond(status, value);
      const result = await requestDancePlan(input, new AbortController().signal);
      expect(result.source).toBe('local'); expect(result.model).toBe('local-dance-planner-1');
      expect(result.fallbackReason).toContain(reason); expect(result.plan.style).toBe('hiphop');
    });
  it('shows only fixed server details, never arbitrary text', async () => {
    respond(502, { code: 'AI_OUTPUT_INVALID', detail: 'provider said something' });
    expect((await requestDancePlan(input, new AbortController().signal)).fallbackReason).toBe('the AI plan was unusable');
  });
  it('falls back to the local composer when the planner exceeds its deadline', async () => {
    vi.stubGlobal('fetch', vi.fn((_url: string, init: RequestInit) => new Promise((_resolve, reject) => init.signal!.addEventListener('abort', () => reject(init.signal!.reason)))));
    const result = await requestDancePlan(input, new AbortController().signal, 20);
    expect(result.source).toBe('local'); expect(result.fallbackReason).toBe('AI planning timed out');
  });
  it('composes a different local dance each time', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('offline')));
    const [a, b] = await Promise.all([requestDancePlan(input, new AbortController().signal), requestDancePlan(input, new AbortController().signal)]);
    expect(JSON.stringify(a.plan.phrases)).not.toBe(JSON.stringify(b.plan.phrases));
  });
  it('falls back when the network fails, but propagates cancellation', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('offline')));
    expect((await requestDancePlan(input, new AbortController().signal)).source).toBe('local');
    const controller = new AbortController(); controller.abort();
    await expect(requestDancePlan(input, controller.signal)).rejects.toThrow('cancelled');
  });
});
