import { afterEach, describe, expect, it, vi } from 'vitest';
import { DANCE_PLAN_MODEL, DANCE_PLAN_PROTOCOL, makeDancePlanRequest } from '../../../packages/core/src/dancePlan';
import { requestDancePlan } from './dancePlanClient';

const input = makeDancePlanRequest('来段街舞', { mode: 'full', startSeconds: 0, endSeconds: 16 }, { bpm: 120, musicBeatsPerDanceCount: 1 });
const plan = { summary: 's', style: 'hiphop', energy: 'high', moves: [{ move: 'punch', beats: 4, mirror: false }] };
afterEach(() => vi.unstubAllGlobals());
const respond = (status: number, value: unknown) => vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } })));

describe('dance plan client', () => {
  it('uses a valid AI plan', async () => {
    respond(200, { protocol: DANCE_PLAN_PROTOCOL, source: 'ai', model: DANCE_PLAN_MODEL, plan });
    expect(await requestDancePlan(input, new AbortController().signal)).toMatchObject({ source: 'ai', plan });
  });
  it.each([[503, { code: 'AI_UNAVAILABLE' }, 'AI 服务暂时不可用'], [429, { code: 'AI_RATE_LIMITED' }, '每分钟'], [502, { code: 'AI_OUTPUT_INVALID' }, '不可用'], [200, { nonsense: true }, '不可用']])(
    'falls back to the local planner on HTTP %i', async (status, value, reason) => {
      respond(status, value);
      const result = await requestDancePlan(input, new AbortController().signal);
      expect(result.source).toBe('local'); expect(result.model).toBe('local-dance-planner-1');
      expect(result.fallbackReason).toContain(reason); expect(result.plan.style).toBe('hiphop');
    });
  it('falls back when the network fails, but propagates cancellation', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('offline')));
    expect((await requestDancePlan(input, new AbortController().signal)).source).toBe('local');
    const controller = new AbortController(); controller.abort();
    await expect(requestDancePlan(input, controller.signal)).rejects.toThrow('取消');
  });
});
