import { describe, expect, it, vi } from 'vitest';
import worker from './index';
import { AI_MODEL, makeAIRequest } from '../../../packages/core/src/aiChoreography';
import { makeCountMap } from '../../../packages/core/src/index';
import { workerMetadata } from '../../../infra/worker-metadata.mjs';

function fixture(success = true) {
  const limit = vi.fn<RateLimit['limit']>().mockResolvedValue({ success });
  const fetch = vi.fn<Fetcher['fetch']>().mockResolvedValue(new Response('static asset'));
  const run = vi.fn<Ai['run']>();
  const aiLimit = vi.fn<RateLimit['limit']>().mockResolvedValue({ success: true });
  const env: Env = {
    RELEASE_STAGE: 'S0-interactive-preview',
    API_RATE_LIMITER: { limit },
    ASSETS: { fetch, connect: vi.fn() },
    // Tests only: no remote binding exists and this mock cannot run inference.
    AI: Object.assign({} as Ai, { run }),
    AI_RATE_LIMITER: { limit: aiLimit },
  };
  return { env, limit, fetch, run, aiLimit };
}

function request(path: string, method = 'GET', ip: string | null = '192.0.2.1') {
  return new Request(`https://preview.example${path}`, {
    method,
    headers: ip ? { 'cf-connecting-ip': ip } : {},
  });
}

describe('public preview API rate protection', () => {
  it('allows health and capabilities while sharing the same IP key across routes and queries', async () => {
    const { env, limit, fetch } = fixture();
    const health = await worker.fetch(request('/api/health?cache=1'), env);
    const capabilities = await worker.fetch(request('/api/capabilities'), env);
    expect(health.status).toBe(200);
    expect(await health.json()).toMatchObject({ status: 'ok', protocol: 'preview-1' });
    expect(capabilities.status).toBe(200);
    expect(await capabilities.json()).toMatchObject({ serverProjectStorage: false, modelGeneration: true, aiArrangement: { explicitRequestOnly: true, uploadsAudio: false } });
    expect(limit.mock.calls).toEqual([
      [{ key: 'choreo-preview:ip:192.0.2.1' }],
      [{ key: 'choreo-preview:ip:192.0.2.1' }],
    ]);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('rejects exhausted allowance with retry guidance before any API handler or assets', async () => {
    const { env, limit, fetch } = fixture(false);
    const response = await worker.fetch(request('/api/health'), env);
    expect(response.status).toBe(429);
    expect(await response.json()).toMatchObject({ code: 'RATE_LIMITED' });
    expect(response.headers.get('retry-after')).toBe('60');
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(limit).toHaveBeenCalledOnce();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('fails closed when the rate binding is absent', async () => {
    const { env, limit, fetch } = fixture();
    // Model a broken deployment without weakening the production Env type.
    Reflect.deleteProperty(env, 'API_RATE_LIMITER');
    const response = await worker.fetch(request('/api/health'), env);
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ code: 'API_TEMPORARILY_UNAVAILABLE' });
    expect(response.headers.get('retry-after')).toBe('60');
    expect(limit).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('fails closed when the rate binding throws', async () => {
    const { env, limit, fetch } = fixture();
    limit.mockRejectedValue(new Error('unavailable'));
    const response = await worker.fetch(request('/api/capabilities'), env);
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ code: 'API_TEMPORARILY_UNAVAILABLE' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('fails closed without Cloudflare client identity and ignores spoofable forwarding headers', async () => {
    const { env, limit } = fixture();
    const noIdentity = request('/api/health', 'GET', null);
    noIdentity.headers.set('x-forwarded-for', '192.0.2.5');
    expect((await worker.fetch(noIdentity, env)).status).toBe(503);
    expect(limit).not.toHaveBeenCalled();
  });

  it('keeps all writes and unknown APIs disabled even when rate checks pass', async () => {
    const { env, limit, fetch } = fixture();
    expect((await worker.fetch(request('/api/projects', 'POST'), env)).status).toBe(501);
    expect((await worker.fetch(request('/api/unknown'), env)).status).toBe(501);
    expect(limit).toHaveBeenCalledTimes(2);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('serves static and SPA routes without invoking the rate binding', async () => {
    const { env, limit, fetch } = fixture(false);
    for (const path of ['/', '/assets/index.js', '/workspace/project']) {
      const response = await worker.fetch(request(path, 'GET', null), env);
      expect(response.status).toBe(200);
    }
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(limit).not.toHaveBeenCalled();
  });
});

const map = makeCountMap({ bpm: 120, musicBeatsPerDanceCount: 1, firstCountSourceSeconds: 0, octetCount: 4, audioDurationSeconds: 32 });
const input = makeAIRequest('节奏轻快，动作舒展，最后收势', map);
const arrangement = { summary: '轻快舒展的四个八拍', slots: Array.from({ length: 4 }, (_, index) => ({ actionId: index === 3 ? 'settle' : 'side-reach', amplitude: 0.7 })) };
function generation(body: unknown = input, init: RequestInit = {}) {
  return new Request('https://preview.example/api/choreography/generate', {
    method: 'POST', body: JSON.stringify(body), headers: { 'cf-connecting-ip': '192.0.2.1', origin: 'https://preview.example', 'content-type': 'application/json' }, ...init,
  });
}

describe('explicit Workers AI arrangement, mock binding only', () => {
  it('performs one bounded server-selected model call and returns a checked arrangement', async () => {
    const { env, run, aiLimit, limit, fetch } = fixture();
    run.mockResolvedValue({ choices: [{ message: { role: 'assistant', content: JSON.stringify(arrangement) }, finish_reason: 'stop' }] });
    const response = await worker.fetch(generation(), env);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ protocol: 'ai-arrangement-1', provider: 'cloudflare-workers-ai', model: AI_MODEL,
      countMapId: map.id, countMapVersion: map.version, durationSeconds: 16, arrangement });
    expect(limit).toHaveBeenCalledOnce();
    expect(aiLimit).toHaveBeenCalledWith({ key: 'choreo-ai:ip:192.0.2.1' });
    expect(run).toHaveBeenCalledOnce();
    expect(run.mock.calls[0]).toMatchObject([AI_MODEL, { stream: false, max_tokens: 768, response_format: { type: 'json_schema', json_schema: { properties: { slots: { minItems: 4, maxItems: 4 } } } } }, { signal: expect.any(AbortSignal) }]);
    expect(fetch).not.toHaveBeenCalled();
    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  it.each([
    { response: arrangement }, { response: JSON.stringify(arrangement) },
    { choices: [{ text: JSON.stringify(arrangement), finish_reason: 'stop' }] },
    JSON.stringify(arrangement),
  ])('accepts documented structured/text completion shapes without a second model call (%#)', async output => {
    const { env, run } = fixture();
    run.mockResolvedValue(output as Record<string, unknown>);
    expect((await worker.fetch(generation(), env)).status).toBe(200);
    expect(run).toHaveBeenCalledOnce();
  });

  it.each([
    { ...input, audio: 'private bytes' }, { ...input, model: 'expensive-model' },
    { ...input, prompt: '' }, { ...input, prompt: 'x'.repeat(1001) },
    { ...input, timing: { ...input.timing, confirmed: false } },
    { ...input, timing: { ...input.timing, durationSeconds: 17 } },
    { ...input, timing: { ...input.timing, octetCount: 10000 } },
  ])('rejects invalid/unbounded input before model and AI allowance (%#)', async invalid => {
    const { env, run, aiLimit } = fixture();
    expect((await worker.fetch(generation(invalid), env)).status).toBe(400);
    expect(run).not.toHaveBeenCalled(); expect(aiLimit).not.toHaveBeenCalled();
  });

  it.each(['https://evil.example', 'null', ''])('rejects a foreign or absent Origin (%s)', async origin => {
    const { env, run } = fixture();
    const request = generation(); request.headers.set('origin', origin);
    expect((await worker.fetch(request, env)).status).toBe(403); expect(run).not.toHaveBeenCalled();
  });

  it('rejects non-JSON, dangerous/duplicate JSON and invalid UTF-8 without inference', async () => {
    const { env, run } = fixture();
    const wrongType = generation(); wrongType.headers.set('content-type', 'text/plain');
    expect((await worker.fetch(wrongType, env)).status).toBe(415);
    for (const body of ['{"protocol":"ai-arrangement-1","protocol":"ai-arrangement-1"}', '{"__proto__":{}}', new Uint8Array([0xc3, 0x28])]) {
      expect((await worker.fetch(generation(undefined, { body }), env)).status).toBe(400);
    }
    expect(run).not.toHaveBeenCalled();
  });

  it('enforces advertised and actual streamed byte limits', async () => {
    const { env, run } = fixture();
    const advertised = generation(); advertised.headers.set('content-length', '4097');
    expect((await worker.fetch(advertised, env)).status).toBe(413);
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(new Uint8Array(3000)); controller.enqueue(new Uint8Array(3000)); },
      cancel() { cancelled = true; },
    });
    const streamed = generation(undefined, { body, duplex: 'half' } as RequestInit);
    expect((await worker.fetch(streamed, env)).status).toBe(413);
    expect(cancelled).toBe(true); expect(run).not.toHaveBeenCalled();
  });

  it('keeps generation closed under either global or dedicated AI rate protection', async () => {
    const global = fixture(false);
    expect((await worker.fetch(generation(), global.env)).status).toBe(429);
    expect(global.aiLimit).not.toHaveBeenCalled(); expect(global.run).not.toHaveBeenCalled();
    const { env, run, aiLimit } = fixture(); aiLimit.mockResolvedValue({ success: false });
    const response = await worker.fetch(generation(), env);
    expect(response.status).toBe(429); expect(await response.json()).toMatchObject({ code: 'AI_RATE_LIMITED' });
    expect(response.headers.get('retry-after')).toBe('60'); expect(run).not.toHaveBeenCalled();
    aiLimit.mockRejectedValue(new Error('private failure'));
    expect((await worker.fetch(generation(), env)).status).toBe(503); expect(run).not.toHaveBeenCalled();
  });

  it.each(['AI', 'AI_RATE_LIMITER'])('fails closed with missing %s and reports generation unavailable', async binding => {
    const { env, run } = fixture(); Reflect.deleteProperty(env, binding);
    expect((await worker.fetch(generation(), env)).status).toBe(503);
    expect(await (await worker.fetch(request('/api/capabilities'), env)).json()).toMatchObject({ modelGeneration: false });
    expect(run).not.toHaveBeenCalled();
  });

  it('returns a bounded error and makes no automatic retry on provider failure', async () => {
    const { env, run } = fixture(); run.mockRejectedValue(new Error('provider secret and internal stack'));
    const response = await worker.fetch(generation(), env);
    expect(response.status).toBe(502); expect(await response.json()).toEqual({ code: 'AI_GENERATION_FAILED', message: 'AI 生成失败，请稍后手动重试。' });
    expect(run).toHaveBeenCalledOnce();
  });

  it.each([
    { response: { ...arrangement, slots: [] } }, { response: { ...arrangement, slots: [...arrangement.slots, arrangement.slots[0]] } },
    { response: { ...arrangement, slots: arrangement.slots.map(slot => ({ ...slot, actionId: 'impossible' })) } },
    { response: { ...arrangement, slots: arrangement.slots.map(slot => ({ ...slot, amplitude: 1.01 })) } },
    { response: { ...arrangement, durationSeconds: 60 } },
    { choices: [{ message: { content: JSON.stringify(arrangement) }, finish_reason: 'length' }] },
    { response: '```json\n{}\n```' }, { response: 'x'.repeat(16385) },
    { response: '{"summary":"one","summary":"two","slots":[]}' },
  ])('rejects invalid model output without retry or original work changes (%#)', async invalid => {
    const { env, run } = fixture(); run.mockResolvedValue(invalid);
    const response = await worker.fetch(generation(), env);
    expect(response.status).toBe(502); expect(await response.json()).toMatchObject({ code: 'AI_OUTPUT_INVALID' }); expect(run).toHaveBeenCalledOnce();
  });

  it('honors cancellation before and during inference without returning a candidate', async () => {
    const { env, run } = fixture(); const controller = new AbortController(); controller.abort();
    expect((await worker.fetch(generation(undefined, { signal: controller.signal }), env)).status).toBe(499); expect(run).not.toHaveBeenCalled();
    const active = new AbortController();
    run.mockImplementation(async (_model, _input, options) => {
      active.abort(); expect(options?.signal?.aborted).toBe(true);
      return { response: arrangement };
    });
    expect((await worker.fetch(generation(undefined, { signal: active.signal }), env)).status).toBe(499); expect(run).toHaveBeenCalledOnce();
  });

  it('passes a 45 second abort deadline and rejects a provider result that arrives after it', async () => {
    const { env, run } = fixture();
    const deadline = new AbortController();
    const timeout = vi.spyOn(AbortSignal, 'timeout').mockReturnValueOnce(deadline.signal);
    try {
      run.mockImplementation(async (_model, _input, options) => {
        deadline.abort(); expect(options?.signal?.aborted).toBe(true);
        return { response: arrangement };
      });
      const response = await worker.fetch(generation(), env);
      expect(response.status).toBe(504); expect(await response.json()).toMatchObject({ code: 'AI_TIMEOUT' });
      expect(timeout).toHaveBeenCalledWith(45_000); expect(run).toHaveBeenCalledOnce();
    } finally { timeout.mockRestore(); }
  });

  it('preserves Workers AI and both rate guards in inline upload metadata', () => {
    const metadata = workerMetadata({ compatibility_date: '2026-10-06', ai: { binding: 'AI', remote: false },
      vars: { RELEASE_STAGE: 'S0-interactive-preview' }, ratelimits: [
        { name: 'API_RATE_LIMITER', namespace_id: '2026100601', simple: { limit: 20, period: 60 } },
        { name: 'AI_RATE_LIMITER', namespace_id: '2026100801', simple: { limit: 2, period: 60 } },
      ],
    });
    expect(metadata.bindings).toEqual([
      { type: 'plain_text', name: 'RELEASE_STAGE', text: 'S0-interactive-preview' },
      { type: 'ratelimit', name: 'API_RATE_LIMITER', namespace_id: '2026100601', simple: { limit: 20, period: 60 } },
      { type: 'ratelimit', name: 'AI_RATE_LIMITER', namespace_id: '2026100801', simple: { limit: 2, period: 60 } },
      { type: 'ai', name: 'AI' },
    ]);
  });
});
