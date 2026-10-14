import { describe, expect, it, vi } from 'vitest';
import worker from './index';
import { AI_MOTION_MODEL, AI_MOTION_REQUEST_MAX_BYTES, AI_MOTION_RESULT_MAX_BYTES } from '../../../packages/core/src/aiMotion';
import { AI_MOTION_PLAN_PROTOCOL, aiMotionPlanOutputSchema } from '../../../packages/core/src/aiMotionPlan';
import { AI_MOTION_PLAN_REASON_MESSAGES, AIMotionPlanValidationError, getSafeAIMotionPlanReason, type AIMotionPlanReasonCode } from '../../../packages/core/src/aiMotionPlanErrors';
import { makeAIMotionPlanFixture, makeAIMotionPlanOutputFixture, makeAIMotionPlanResultFixture } from '../../../packages/core/src/aiMotionPlan.fixture';

function fixture() {
  const limit = vi.fn<RateLimit['limit']>().mockResolvedValue({ success: true });
  const aiLimit = vi.fn<RateLimit['limit']>().mockResolvedValue({ success: true });
  const run = vi.fn<Ai['run']>().mockResolvedValue({ response: makeAIMotionPlanOutputFixture() });
  const fetch = vi.fn<Fetcher['fetch']>();
  const env: Env = { RELEASE_STAGE: 'S0-interactive-preview', API_RATE_LIMITER: { limit }, AI_RATE_LIMITER: { limit: aiLimit },
    AI: Object.assign({} as Ai, { run }), ASSETS: { fetch, connect: vi.fn() } };
  return { env, limit, aiLimit, run, fetch };
}
function request(body: unknown = makeAIMotionPlanFixture(), init: RequestInit = {}) {
  return new Request('https://preview.example/api/motion/plan', { method: 'POST', body: JSON.stringify(body),
    headers: { 'cf-connecting-ip': '192.0.2.1', origin: 'https://preview.example', 'content-type': 'application/json' }, ...init });
}
describe('Workers AI semantic motion planning (mock binding, no real inference)', () => {
  it.each(['full', 'interval'] as const)('runs exactly one %s planning call and adds immutable source provenance', async mode => {
    const input = makeAIMotionPlanFixture(mode), original = structuredClone(input), { env, run, limit, aiLimit, fetch } = fixture();
    run.mockResolvedValue({ choices: [{ message: { role: 'assistant', content: JSON.stringify(makeAIMotionPlanOutputFixture(input)) }, finish_reason: 'stop' }] });
    const response = await worker.fetch(request(input), env);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(makeAIMotionPlanResultFixture(input));
    expect(input).toEqual(original); expect(limit).toHaveBeenCalledOnce(); expect(fetch).not.toHaveBeenCalled();
    expect(aiLimit).toHaveBeenCalledWith({ key: 'choreo-ai:ip:192.0.2.1' }); expect(run).toHaveBeenCalledOnce();
    expect(run.mock.calls[0]).toMatchObject([AI_MOTION_MODEL, { stream: false, max_tokens: 8192, reasoning_effort: 'low',
      response_format: { type: 'json_schema', json_schema: { name: 'ai_motion_plan', schema: aiMotionPlanOutputSchema(input), strict: true } } },
    { signal: expect.any(AbortSignal) }]);
    const messages = (run.mock.calls[0][1] as { messages: { content: string }[] }).messages;
    expect(messages[1].content).toContain(JSON.stringify(input.motion.context));
    expect(messages[1].content).toContain(JSON.stringify(input.catalog));
    expect(messages[0].content).toContain('不能总是挑一个萨尔萨');
    expect(messages[0].content).toContain('audioUnderstanding=false');
  });
  it('returns unsupported intent without inventing motion or source attribution', async () => {
    const input = makeAIMotionPlanFixture(), { env, run } = fixture();
    const output = { ...makeAIMotionPlanOutputFixture(input), intentMatch: 'unsupported' as const, limitations: ['动捕来源没有后空翻。'], segments: [] };
    run.mockResolvedValue({ response: output });
    expect(await (await worker.fetch(request(input), env)).json()).toEqual(makeAIMotionPlanResultFixture(input, output));
    expect(run).toHaveBeenCalledOnce();
  });
  it('rejects a sub-minimum planning interval before consuming a provider allowance or inference', async () => {
    const input = makeAIMotionPlanFixture('interval'), { env, run, aiLimit } = fixture();
    input.motion.context.target.endSeconds = 4.05;
    input.motion.context.boundaries.end.time = 4.05;
    const response = await worker.fetch(request(input), env);
    expect(response.status).toBe(400);
    expect((await response.json() as { message: string }).message).toContain('0.1');
    expect(aiLimit).not.toHaveBeenCalled(); expect(run).not.toHaveBeenCalled();
  });
  it('rejects foreign origin, cross-site and wrong content types before any paid allowance', async () => {
    const { env, run, aiLimit } = fixture();
    for (const origin of ['https://evil.example', 'null', '']) {
      const req = request(); req.headers.set('origin', origin); expect((await worker.fetch(req, env)).status).toBe(403);
    }
    const cross = request(); cross.headers.set('sec-fetch-site', 'cross-site'); expect((await worker.fetch(cross, env)).status).toBe(403);
    const type = request(); type.headers.set('content-type', 'text/plain'); expect((await worker.fetch(type, env)).status).toBe(415);
    expect(aiLimit).not.toHaveBeenCalled(); expect(run).not.toHaveBeenCalled();
  });
  it('rejects invalid/dangerous JSON, raw scene/audio, source catalog errors and oversized bodies before inference', async () => {
    const { env, run, aiLimit } = fixture(), input = makeAIMotionPlanFixture();
    for (const body of [{ ...input, audioBytes: 'private' }, { ...input, model: 'other' },
      { ...input, catalog: { ...input.catalog, clips: [] } }, { ...input, motion: { ...input.motion, prompt: '' } }]) {
      expect((await worker.fetch(request(body), env)).status).toBe(400);
    }
    for (const body of ['{"protocol":"ai-motion-plan-1","protocol":"ai-motion-plan-1"}', '{"__proto__":{}}', new Uint8Array([0xc3, 0x28])]) {
      expect((await worker.fetch(request(input, { body }), env)).status).toBe(400);
    }
    const advertised = request(); advertised.headers.set('content-length', String(AI_MOTION_REQUEST_MAX_BYTES + 1));
    expect((await worker.fetch(advertised, env)).status).toBe(413);
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new Uint8Array(40_000)); controller.enqueue(new Uint8Array(40_000)); }, cancel() { cancelled = true; } });
    expect((await worker.fetch(request(input, { body, duplex: 'half' } as RequestInit), env)).status).toBe(413);
    expect(cancelled).toBe(true); expect(aiLimit).not.toHaveBeenCalled(); expect(run).not.toHaveBeenCalled();
  });
  it('fails closed and shares global/provider rate protection with all older generation routes', async () => {
    const { env, run, limit, aiLimit } = fixture();
    limit.mockResolvedValue({ success: false }); expect((await worker.fetch(request(), env)).status).toBe(429);
    expect(aiLimit).not.toHaveBeenCalled(); limit.mockResolvedValue({ success: true }); aiLimit.mockResolvedValue({ success: false });
    const response = await worker.fetch(request(), env); expect(response.status).toBe(429); expect(response.headers.get('retry-after')).toBe('60');
    aiLimit.mockRejectedValue(new Error('private failure')); expect((await worker.fetch(request(), env)).status).toBe(503);
    Reflect.deleteProperty(env, 'AI'); expect((await worker.fetch(request(), env)).status).toBe(503);
    expect(run).not.toHaveBeenCalled();
  });
  it('rejects provider partial/tool/refusal output and schema bypass without direct-angle fallback or retry', async () => {
    const { env, run } = fixture(), output = makeAIMotionPlanOutputFixture();
    for (const value of [
      { choices: [{ finish_reason: 'length', message: { content: JSON.stringify(output) } }] },
      { choices: [{ finish_reason: 'stop', message: { refusal: 'private', content: JSON.stringify(output) } }] },
      { object: 'response', status: 'incomplete', output: [] },
      { response: JSON.stringify(output).replace('"summary":', '"summary":"duplicate","summary":') },
      { response: { ...output, segments: [{ ...output.segments[0], clipId: 'invented' }] } },
      { response: { ...output, physicalAcceptance: true } }, { response: 'x'.repeat(AI_MOTION_RESULT_MAX_BYTES + 1) },
      { response: { summary: '直接角度', keyframes: [] } },
    ]) {
      run.mockResolvedValue(value); const response = await worker.fetch(request(), env);
      expect(response.status).toBe(502);
      const body = await response.json() as { code: string; message: string; reasonCode: string };
      expect(body).toEqual({ code: 'AI_OUTPUT_INVALID', message: 'AI 返回了无法使用的动作规划，请稍后手动重试。', reasonCode: expect.any(String) });
      expect(Object.hasOwn(AI_MOTION_PLAN_REASON_MESSAGES, body.reasonCode)).toBe(true);
    }
    expect(run).toHaveBeenCalledTimes(8);
  });
  it.each([
    ['PLAN_FORMAT_INVALID', (output: ReturnType<typeof makeAIMotionPlanOutputFixture>) => ({ ...output, privateProviderField: 'private provider token' })],
    ['PLAN_SOURCE_RANGE', (output: ReturnType<typeof makeAIMotionPlanOutputFixture>) => ({ ...output, segments: [{ ...output.segments[0], sourceEndSeconds: 100 }] })],
    ['PLAN_COVERAGE', (output: ReturnType<typeof makeAIMotionPlanOutputFixture>) => ({ ...output, segments: [{ ...output.segments[0], endSeconds: 31.5 }] })],
    ['PLAN_SPEED', (output: ReturnType<typeof makeAIMotionPlanOutputFixture>) => ({ ...output, segments: [{ ...output.segments[0], sourceEndSeconds: 1 }] })],
    ['PLAN_TRANSITION', (output: ReturnType<typeof makeAIMotionPlanOutputFixture>) => ({ ...output, segments: [{ ...output.segments[0], transitionSeconds: 2 }] })],
    ['PLAN_INTENT_CONTRACT', (output: ReturnType<typeof makeAIMotionPlanOutputFixture>) => ({ ...output, intentMatch: 'partial', limitations: [] })],
  ] as const)('reports only the safe %s category after one rejected model response', async (reasonCode, mutate) => {
    const input = makeAIMotionPlanFixture(), original = structuredClone(input), { env, run, aiLimit } = fixture();
    const output = mutate({ ...makeAIMotionPlanOutputFixture(input), summary: 'private provider token' });
    run.mockResolvedValue({ response: output });
    const response = await worker.fetch(request(input), env), body = await response.json();
    expect(response.status).toBe(502);
    expect(body).toEqual({ code: 'AI_OUTPUT_INVALID', message: 'AI 返回了无法使用的动作规划，请稍后手动重试。', reasonCode });
    expect(JSON.stringify(body)).not.toContain('private provider token');
    expect(input).toEqual(original); expect(run).toHaveBeenCalledOnce(); expect(aiLimit).toHaveBeenCalledOnce();
  });
  it('preserves cancellation and returns safe provider errors without automatic retry', async () => {
    const { env, run } = fixture(), controller = new AbortController(); controller.abort();
    expect((await worker.fetch(request(undefined, { signal: controller.signal }), env)).status).toBe(499); expect(run).not.toHaveBeenCalled();
    const late = new AbortController();
    run.mockImplementation(async () => { late.abort(); return { response: makeAIMotionPlanOutputFixture() }; });
    expect((await worker.fetch(request(undefined, { signal: late.signal }), env)).status).toBe(499);
    run.mockRejectedValue(new Error('private model stack'));
    const response = await worker.fetch(request(), env); expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ code: 'AI_GENERATION_FAILED', message: 'AI 生成失败，请稍后手动重试。' });
    expect(run).toHaveBeenCalledTimes(2);
  });
  it('advertises planning separately from preserved legacy direct motion', async () => {
    const { env, run } = fixture();
    const req = new Request('https://preview.example/api/capabilities', { headers: { 'cf-connecting-ip': '192.0.2.1' } });
    expect(await (await worker.fetch(req, env)).json()).toMatchObject({ aiMotionPlanning: { protocol: AI_MOTION_PLAN_PROTOCOL,
      semanticPlanning: true, realMotionPriors: true, createsNewMaterial: false, operation: 'arrange-existing',
      coverage: { styles: ['street', 'salsa'], recordings: 2 },
      requiresDeterministicCandidateValidation: true, physicalValidationLocation: 'client', articulatedDynamics: false, directBoneMotion: false, audioUnderstanding: false,
      immutableContext: true, explicitRequestOnly: true, maximumRequestsPerMinutePerIp: 2 } });
    expect(run).not.toHaveBeenCalled();
  });
  it('does not substitute existing-motion planning for a new-material request, even with a valid legacy plan body', async () => {
    const { env, limit, aiLimit, run, fetch } = fixture();
    const response = await worker.fetch(new Request('https://preview.example/api/motion/create', {
      method: 'POST', body: JSON.stringify(makeAIMotionPlanFixture()),
      headers: { 'cf-connecting-ip': '192.0.2.1', origin: 'https://preview.example', 'content-type': 'application/json' },
    }), env);
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ code: 'CREATION_UNAVAILABLE' });
    expect(limit).toHaveBeenCalledOnce(); expect(aiLimit).not.toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
  });
});

describe('trusted local planning failure classification', () => {
  it('keeps traditional validation messages local and only exports whitelisted categories', () => {
    const message = 'AI 动作规划必须连续覆盖目标且保持合理速度。';
    const error = new AIMotionPlanValidationError('PLAN_SPEED', message);
    expect(error.message).toBe(message); expect(getSafeAIMotionPlanReason(error)).toBe('PLAN_SPEED');
    for (const untrusted of [new Error('private provider token'), { name: 'AIMotionPlanValidationError', reasonCode: 'PLAN_SPEED' },
      Object.assign(new Error('private provider token'), { reasonCode: 'PLAN_SPEED' }),
      new AIMotionPlanValidationError('constructor' as AIMotionPlanReasonCode, 'private provider token')]) {
      expect(getSafeAIMotionPlanReason(untrusted)).toBe('PLAN_FORMAT_INVALID');
    }
  });
  it('does not execute an accessor in an error that otherwise has the expected class', () => {
    const error = new AIMotionPlanValidationError('PLAN_SPEED'), accessor = vi.fn(() => { throw new Error('private provider token'); });
    Object.defineProperty(error, 'reasonCode', { get: accessor });
    expect(getSafeAIMotionPlanReason(error)).toBe('PLAN_FORMAT_INVALID'); expect(accessor).not.toHaveBeenCalled();
  });
});
