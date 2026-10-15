import { describe, expect, it, vi } from 'vitest';
import worker from './index';
import { DANCE_PLAN_MAX_OUTPUT_TOKENS, DANCE_PLAN_MODEL, DANCE_PLAN_PROTOCOL, dancePlanOutputSchema, makeDancePlanRequest } from '../../../packages/core/src/dancePlan';

const pose = (raise: number, step = 'none') => ({ arms: [raise, 5, 2, 10 - raise, 3, 6], torso: [1, -2, 3], head: [0, 2], hips: [2, 4], step });
const output = { summary: 'Pop groove with a turn.', style: 'pop', energy: 'medium',
  phrases: [{ poses: [pose(2, 'L-side'), pose(6), pose(9, 'turn-L'), pose(4, 'turn-L')] }], order: [{ phrase: 0, mirror: false }, { phrase: 0, mirror: true }] };
function fixture() {
  const limit = vi.fn<RateLimit['limit']>().mockResolvedValue({ success: true });
  const aiLimit = vi.fn<RateLimit['limit']>().mockResolvedValue({ success: true });
  const run = vi.fn<Ai['run']>().mockResolvedValue({ response: output });
  const fetch = vi.fn<Fetcher['fetch']>();
  const env: Env = { RELEASE_STAGE: 'S0-interactive-preview', API_RATE_LIMITER: { limit }, AI_RATE_LIMITER: { limit: aiLimit },
    AI: Object.assign({} as Ai, { run }), ASSETS: { fetch, connect: vi.fn() } };
  return { env, limit, aiLimit, run, fetch };
}
const body = () => makeDancePlanRequest('a pop dance', { mode: 'interval', startSeconds: 4, endSeconds: 9.5 }, { bpm: 120, musicBeatsPerDanceCount: 1 });
function request(value: unknown = body(), init: RequestInit = {}) {
  return new Request('https://preview.example/api/dance/plan', { method: 'POST', body: JSON.stringify(value),
    headers: { 'cf-connecting-ip': '192.0.2.1', origin: 'https://preview.example', 'content-type': 'application/json' }, ...init });
}

describe('Workers AI dance planning (mock binding, no real inference)', () => {
  it('makes exactly one keypose planning call with the small model', async () => {
    const { env, run, aiLimit, fetch } = fixture();
    const response = await worker.fetch(request(), env);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ protocol: DANCE_PLAN_PROTOCOL, source: 'ai', model: DANCE_PLAN_MODEL, plan: output });
    expect(aiLimit).toHaveBeenCalledWith({ key: 'choreo-ai:ip:192.0.2.1' }); expect(run).toHaveBeenCalledOnce(); expect(fetch).not.toHaveBeenCalled();
    expect(run.mock.calls[0]).toMatchObject([DANCE_PLAN_MODEL, { stream: false, max_tokens: DANCE_PLAN_MAX_OUTPUT_TOKENS, reasoning_effort: 'low',
      response_format: { type: 'json_schema', json_schema: { name: 'dance_plan', schema: dancePlanOutputSchema(), strict: true } } }, { signal: expect.any(AbortSignal) }]);
    const messages = (run.mock.calls[0][1] as { messages: { content: string }[] }).messages;
    expect(messages[0].content).toContain('turn-L'); expect(messages[0].content).toContain('arms = ['); expect(messages[1].content).toContain('a pop dance');
    expect(messages.map(message => message.content).join()).not.toMatch(/[\u4e00-\u9fff]/);
  });
  it.each([
    ['chat completion text', { choices: [{ message: { content: `\`\`\`json\n${JSON.stringify(output)}\n\`\`\`` }, finish_reason: 'stop' }] }],
    ['responses envelope', { object: 'response', status: 'completed', output: [{ type: 'reasoning' }, { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: JSON.stringify(output) }] }] }],
    ['string response', { response: JSON.stringify({ ...output, unknown: 1 }) }],
  ])('normalizes a %s leniently', async (_name, value) => {
    const { env, run } = fixture(); run.mockResolvedValue(value);
    const result = await (await worker.fetch(request(), env)).json() as { plan: typeof output };
    expect(result.plan.phrases).toEqual(output.phrases); expect(result.plan.order).toEqual(output.order);
  });
  it('returns a typed error the client can fall back from, never provider text', async () => {
    const { env, run } = fixture();
    run.mockResolvedValue({ response: { phrases: [{ poses: ['backflip'] }] } });
    const invalid = await worker.fetch(request(), env);
    expect(invalid.status).toBe(502); expect(await invalid.json()).toMatchObject({ code: 'AI_OUTPUT_INVALID' });
    run.mockRejectedValue(new Error('secret provider detail'));
    const failed = await worker.fetch(request(), env);
    expect(failed.status).toBe(502); expect(JSON.stringify(await failed.json())).not.toContain('secret');
  });
  it('rejects foreign origins, bad bodies and exhausted allowances before inference', async () => {
    const { env, run, aiLimit } = fixture();
    const foreign = request(); foreign.headers.set('origin', 'https://evil.example');
    expect((await worker.fetch(foreign, env)).status).toBe(403);
    expect((await worker.fetch(request({ ...body(), scene: {} }), env)).status).toBe(400);
    expect((await worker.fetch(request('x'.repeat(9000)), env)).status).toBe(413);
    expect(aiLimit).not.toHaveBeenCalled();
    aiLimit.mockResolvedValue({ success: false });
    expect((await worker.fetch(request(), env)).status).toBe(429);
    expect(run).not.toHaveBeenCalled();
  });
  it('no longer serves the retired clip-planning endpoint', async () => {
    const { env } = fixture();
    expect((await worker.fetch(new Request('https://preview.example/api/motion/plan', { method: 'POST', body: '{}', headers: { 'cf-connecting-ip': '192.0.2.1', origin: 'https://preview.example', 'content-type': 'application/json' } }), env)).status).toBe(501);
  });
});
