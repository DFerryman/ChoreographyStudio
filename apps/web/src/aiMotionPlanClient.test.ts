import { afterEach, describe, expect, it, vi } from 'vitest';
import { requestAIMotionPlan } from './aiMotionPlanClient';
import { AI_MOTION_RESULT_MAX_BYTES } from '../../../packages/core/src/aiMotion';
import { makeAIMotionPlanFixture, makeAIMotionPlanResultFixture } from '../../../packages/core/src/aiMotionPlan.fixture';

function fixture(response: Response = Response.json(makeAIMotionPlanResultFixture())) {
  const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(response); vi.stubGlobal('fetch', fetch); return fetch;
}
afterEach(() => vi.unstubAllGlobals());
describe('selective AI motion planning client, fetch mocked', () => {
  it.each(['full', 'interval'] as const)('sends one immutable %s context+catalog and checks all source bindings', async mode => {
    const request = makeAIMotionPlanFixture(mode), result = makeAIMotionPlanResultFixture(request), original = structuredClone(request);
    const fetch = fixture(Response.json(result)), controller = new AbortController();
    expect(await requestAIMotionPlan(request, controller.signal)).toEqual(result);
    expect(fetch).toHaveBeenCalledOnce();
    expect(fetch).toHaveBeenCalledWith('/api/motion/plan', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(request),
      credentials: 'same-origin', cache: 'no-store', redirect: 'error', signal: controller.signal });
    expect(request).toEqual(original);
  });
  it('never sends cancelled or invalid requests', async () => {
    const fetch = fixture(), input = makeAIMotionPlanFixture(), controller = new AbortController(); controller.abort();
    await expect(requestAIMotionPlan(input, controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
    await expect(requestAIMotionPlan({ ...input, catalog: { ...input.catalog, clips: [] } }, new AbortController().signal)).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });
  it('rejects stale source/catalog/result and ignores provider error text with no retry/fallback', async () => {
    const input = makeAIMotionPlanFixture(), result = makeAIMotionPlanResultFixture(input), fetch = fixture();
    for (const patch of [{ requestId: 'stale' }, { sourceHash: 'c'.repeat(64) }, { catalogVersion: 'stale' },
      { sources: [{ clipId: 'cmu-61-08', sourceHash: 'c'.repeat(64) }] }, { physicalAcceptance: true }]) {
      fetch.mockResolvedValue(Response.json({ ...result, ...patch }));
      await expect(requestAIMotionPlan(input, new AbortController().signal)).rejects.toThrow('无法使用的动作规划');
    }
    fetch.mockResolvedValue(Response.json({ code: 'constructor', message: 'private provider secret' }, { status: 500 }));
    await expect(requestAIMotionPlan(input, new AbortController().signal)).rejects.toThrow('AI 生成失败，请稍后手动重试。');
    expect(fetch).toHaveBeenCalledTimes(6);
    expect(fetch.mock.calls.every(call => call[0] === '/api/motion/plan')).toBe(true);
  });
  it('returns unsupported intent honestly for UI handling rather than inventing a replacement plan', async () => {
    const input = makeAIMotionPlanFixture();
    const output = { summary: '来源不支持。', intentMatch: 'unsupported' as const, limitations: ['没有后空翻动捕。'], segments: [] };
    fixture(Response.json(makeAIMotionPlanResultFixture(input, output)));
    expect((await requestAIMotionPlan(input, new AbortController().signal)).segments).toEqual([]);
  });
  it('bounds advertised/streaming output and rejects duplicate keys/invalid UTF-8', async () => {
    const input = makeAIMotionPlanFixture(), fetch = fixture(new Response('{}', { headers: { 'content-length': String(AI_MOTION_RESULT_MAX_BYTES + 1) } }));
    await expect(requestAIMotionPlan(input, new AbortController().signal)).rejects.toThrow('无法使用的动作规划');
    let cancelled = false;
    fetch.mockResolvedValue(new Response(new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new Uint8Array(60_000)); controller.enqueue(new Uint8Array(60_000)); }, cancel() { cancelled = true; } })));
    await expect(requestAIMotionPlan(input, new AbortController().signal)).rejects.toThrow('无法使用的动作规划'); expect(cancelled).toBe(true);
    for (const body of ['{"summary":"a","summary":"b"}', new Uint8Array([0xc3, 0x28])]) {
      fetch.mockResolvedValue(new Response(body)); await expect(requestAIMotionPlan(input, new AbortController().signal)).rejects.toThrow('无法使用的动作规划');
    }
    expect(fetch).toHaveBeenCalledTimes(4);
  });
  it('cancels a pending body read and preserves AbortError across late/network responses', async () => {
    const input = makeAIMotionPlanFixture(), fetch = fixture(), streamAbort = new AbortController(); let bodyCancelled = false;
    fetch.mockResolvedValue(new Response(new ReadableStream<Uint8Array>({ pull() { streamAbort.abort(); }, cancel() { bodyCancelled = true; } }, { highWaterMark: 0 })));
    await expect(requestAIMotionPlan(input, streamAbort.signal)).rejects.toMatchObject({ name: 'AbortError' }); expect(bodyCancelled).toBe(true);
    const late = new AbortController(); fetch.mockImplementation(async () => { late.abort(); return Response.json(makeAIMotionPlanResultFixture(input)); });
    await expect(requestAIMotionPlan(input, late.signal)).rejects.toMatchObject({ name: 'AbortError' });
    const network = new AbortController(); fetch.mockImplementation(async () => { network.abort(); throw new Error('private stack'); });
    await expect(requestAIMotionPlan(input, network.signal)).rejects.toMatchObject({ name: 'AbortError' }); expect(fetch).toHaveBeenCalledTimes(3);
  });
  it('checks against cloned request identity even if the caller mutates it while waiting', async () => {
    const input = makeAIMotionPlanFixture(), result = makeAIMotionPlanResultFixture(input), fetch = fixture();
    fetch.mockImplementation(async () => { input.motion.context.sourceHash = 'c'.repeat(64); input.catalog.clips[1].sourceHash = 'd'.repeat(64); return Response.json(result); });
    expect(await requestAIMotionPlan(input, new AbortController().signal)).toEqual(result);
  });
  it.each(['AI_RATE_LIMITED', 'AI_TIMEOUT', 'AI_OUTPUT_INVALID', 'AI_GENERATION_FAILED'])('maps %s safely without any retry', async code => {
    const fetch = fixture(Response.json({ code, message: 'private stack' }, { status: 502 }));
    await expect(requestAIMotionPlan(makeAIMotionPlanFixture(), new AbortController().signal)).rejects.not.toThrow('private');
    expect(fetch).toHaveBeenCalledOnce();
  });
});
