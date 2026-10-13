import { afterEach, describe, expect, it, vi } from 'vitest';
import { makeCountMap } from '../../../packages/core/src/index';
import { AI_MODEL, AI_PROTOCOL, makeAIRequest } from '../../../packages/core/src/aiChoreography';
import { requestAIArrangement, requestAIMotion } from './aiClient';
import { AI_MOTION_RESULT_MAX_BYTES } from '../../../packages/core/src/aiMotion';
import { makeAIMotionFixture, makeAIMotionResultFixture } from '../../../packages/core/src/aiMotion.fixture';

const map = makeCountMap({ bpm: 120, musicBeatsPerDanceCount: 1, firstCountSourceSeconds: 0, octetCount: 4, audioDurationSeconds: 32 });
const result = { protocol: AI_PROTOCOL, provider: 'cloudflare-workers-ai', model: AI_MODEL,
  countMapId: map.id, countMapVersion: map.version, durationSeconds: map.durationSeconds,
  arrangement: { summary: '轻柔舒展', slots: Array.from({ length: 4 }, () => ({ actionId: 'side-reach', amplitude: 0.7 })) },
};
const fixture = (response: Response = Response.json(result)) => {
  const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(response);
  vi.stubGlobal('fetch', fetch);
  return fetch;
};
afterEach(() => { vi.unstubAllGlobals(); });

describe('explicit AI client (fetch mocked, no real inference)', () => {
  it('posts a single confirmed compact request with cancellation ownership and validates the result', async () => {
    const fetch = fixture(); const controller = new AbortController();
    expect(await requestAIArrangement('轻柔', map, controller.signal)).toEqual(result);
    expect(fetch).toHaveBeenCalledOnce();
    expect(fetch).toHaveBeenCalledWith('/api/choreography/generate', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(makeAIRequest('轻柔', map)),
      credentials: 'same-origin', cache: 'no-store', redirect: 'error', signal: controller.signal,
    });
  });

  it('does not send invalid prompts/timing or an already cancelled request', async () => {
    const fetch = fixture();
    await expect(requestAIArrangement('x'.repeat(1001), map, new AbortController().signal)).rejects.toThrow();
    const unconfirmed = structuredClone(map); Reflect.set(unconfirmed, 'confirmed', false);
    await expect(requestAIArrangement('轻柔', unconfirmed, new AbortController().signal)).rejects.toThrow();
    const controller = new AbortController(); controller.abort();
    await expect(requestAIArrangement('轻柔', map, controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each(['AI_RATE_LIMITED', 'AI_UNAVAILABLE', 'AI_TIMEOUT', 'AI_OUTPUT_INVALID'])('reports a known safe error code without automatic retry (%s)', async code => {
    const fetch = fixture(Response.json({ code, message: 'arbitrary provider stack / secret' }, { status: 502 }));
    await expect(requestAIArrangement('轻柔', map, new AbortController().signal)).rejects.toThrow(/AI/);
    expect(fetch).toHaveBeenCalledOnce();
  });

  it('rejects a stale response and does not trust errors or generated extra fields', async () => {
    const fetch = fixture(Response.json({ ...result, countMapId: 'stale' }));
    await expect(requestAIArrangement('轻柔', map, new AbortController().signal)).rejects.toThrow('无法使用的编排');
    fetch.mockResolvedValue(Response.json({ ...result, audio: 'unexpected' }));
    await expect(requestAIArrangement('轻柔', map, new AbortController().signal)).rejects.toThrow('无法使用的编排');
    fetch.mockResolvedValue(Response.json({ code: 'UNTRUSTED', message: 'secret' }, { status: 500 }));
    await expect(requestAIArrangement('轻柔', map, new AbortController().signal)).rejects.toThrow('AI 生成失败，请稍后手动重试。');
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it('keeps cancellation semantics across both late success and network rejection', async () => {
    const fetch = fixture(); const controller = new AbortController();
    fetch.mockImplementation(async () => { controller.abort(); return Response.json(result); });
    await expect(requestAIArrangement('轻柔', map, controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
    const next = new AbortController();
    fetch.mockImplementation(async () => { next.abort(); throw new Error('abort'); });
    await expect(requestAIArrangement('轻柔', map, next.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('maps a network failure to a safe message without retry', async () => {
    const fetch = fixture(); fetch.mockRejectedValue(new Error('network stack'));
    await expect(requestAIArrangement('轻柔', map, new AbortController().signal)).rejects.toThrow('无法连接 AI 服务');
    expect(fetch).toHaveBeenCalledOnce();
  });

  it('enforces advertised and actual response byte bounds, cancels an oversized body', async () => {
    const fetch = fixture(new Response('{}', { headers: { 'content-length': '16385' } }));
    await expect(requestAIArrangement('轻柔', map, new AbortController().signal)).rejects.toThrow('无法使用的编排');
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(new Uint8Array(10000)); controller.enqueue(new Uint8Array(10000)); },
      cancel() { cancelled = true; },
    });
    fetch.mockResolvedValue(new Response(body));
    await expect(requestAIArrangement('轻柔', map, new AbortController().signal)).rejects.toThrow('无法使用的编排');
    expect(cancelled).toBe(true); expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('rejects duplicate JSON keys and invalid UTF-8 before adoption', async () => {
    const fetch = fixture(new Response('{"summary":"a","summary":"b"}'));
    await expect(requestAIArrangement('轻柔', map, new AbortController().signal)).rejects.toThrow('无法使用的编排');
    fetch.mockResolvedValue(new Response(new Uint8Array([0xc3, 0x28])));
    await expect(requestAIArrangement('轻柔', map, new AbortController().signal)).rejects.toThrow('无法使用的编排');
  });

  it('sanitizes a response stream failure and inherited error-code names', async () => {
    const body = new ReadableStream<Uint8Array>({ start(controller) { controller.error(new Error('private stream stack')); } });
    const fetch = fixture(new Response(body));
    await expect(requestAIArrangement('轻柔', map, new AbortController().signal)).rejects.toThrow('AI 返回了无法使用的编排，请稍后手动重试。');
    fetch.mockResolvedValue(Response.json({ code: 'constructor', message: 'private error' }, { status: 500 }));
    await expect(requestAIArrangement('轻柔', map, new AbortController().signal)).rejects.toThrow('AI 生成失败，请稍后手动重试。');
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});

describe('explicit direct bone AI client (fetch mocked, no real inference)', () => {
  it.each(['full', 'interval'] as const)('posts one immutable %s context and checks its result binding', async mode => {
    const input = makeAIMotionFixture(mode);
    const result = makeAIMotionResultFixture(input);
    const original = structuredClone(input);
    const fetch = fixture(Response.json(result)); const controller = new AbortController();
    expect(await requestAIMotion(input, controller.signal)).toEqual(result);
    expect(fetch).toHaveBeenCalledOnce();
    expect(fetch).toHaveBeenCalledWith('/api/motion/generate', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input),
      credentials: 'same-origin', cache: 'no-store', redirect: 'error', signal: controller.signal,
    });
    expect(input).toEqual(original);
  });

  it('validates prompts/context before sending and does not send cancelled requests', async () => {
    const input = makeAIMotionFixture(); const fetch = fixture();
    await expect(requestAIMotion({ ...input, prompt: '' }, new AbortController().signal)).rejects.toThrow();
    await expect(requestAIMotion({ ...input, prompt: 'x'.repeat(2001) }, new AbortController().signal)).rejects.toThrow();
    const invalidAudio = structuredClone(input); Reflect.set(invalidAudio.context, 'audioUnderstanding', true);
    await expect(requestAIMotion(invalidAudio, new AbortController().signal)).rejects.toThrow();
    const cancelled = new AbortController(); cancelled.abort();
    await expect(requestAIMotion(input, cancelled.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('rejects stale request identity/source/range and a legacy template without retry', async () => {
    const input = makeAIMotionFixture('interval'); const result = makeAIMotionResultFixture(input);
    const fetch = fixture();
    const invalid = [
      { ...result, requestId: 'another-request' }, { ...result, sourceHash: 'c'.repeat(64) },
      { ...result, target: { ...result.target, startSeconds: result.target.startSeconds + 0.1 } },
      { ...result, unexpected: 'untrusted' },
      { ...result, keyframes: [{ ...result.keyframes[0], time: input.context.target.endSeconds }] },
      { protocol: 'ai-arrangement-1', arrangement: { slots: [{ actionId: 'side-reach' }] } },
    ];
    for (const value of invalid) {
      fetch.mockResolvedValue(Response.json(value));
      await expect(requestAIMotion(input, new AbortController().signal)).rejects.toThrow('无法使用的动作数据');
    }
    expect(fetch).toHaveBeenCalledTimes(invalid.length);
    expect(fetch.mock.calls.every(call => call[0] === '/api/motion/generate')).toBe(true);
  });

  it.each(['AI_RATE_LIMITED', 'AI_UNAVAILABLE', 'AI_TIMEOUT', 'AI_OUTPUT_INVALID', 'INVALID_MOTION_REQUEST'])('reports only a safe known error (%s)', async code => {
    const fetch = fixture(Response.json({ code, message: 'private provider stack' }, { status: 502 }));
    await expect(requestAIMotion(makeAIMotionFixture(), new AbortController().signal)).rejects.not.toThrow('private');
    expect(fetch).toHaveBeenCalledOnce();
  });

  it('preserves cancellation after response headers, during a body read, and after network failure', async () => {
    const input = makeAIMotionFixture(); const result = makeAIMotionResultFixture(input);
    const fetch = fixture(); const late = new AbortController();
    fetch.mockImplementation(async () => { late.abort(); return Response.json(result); });
    await expect(requestAIMotion(input, late.signal)).rejects.toMatchObject({ name: 'AbortError' });
    const streaming = new AbortController(); let bodyCancelled = false;
    fetch.mockResolvedValue(new Response(new ReadableStream<Uint8Array>({
      pull() { streaming.abort(); }, cancel() { bodyCancelled = true; },
    }, { highWaterMark: 0 })));
    await expect(requestAIMotion(input, streaming.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(bodyCancelled).toBe(true);
    const network = new AbortController();
    fetch.mockImplementation(async () => { network.abort(); throw new Error('private abort stack'); });
    await expect(requestAIMotion(input, network.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it('bounds response bytes, cancels oversized streaming output and rejects malformed JSON/UTF-8', async () => {
    const input = makeAIMotionFixture();
    const fetch = fixture(new Response('{}', { headers: { 'content-length': String(AI_MOTION_RESULT_MAX_BYTES + 1) } }));
    await expect(requestAIMotion(input, new AbortController().signal)).rejects.toThrow('无法使用的动作数据');
    let cancelled = false;
    fetch.mockResolvedValue(new Response(new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(new Uint8Array(60_000)); controller.enqueue(new Uint8Array(60_000)); },
      cancel() { cancelled = true; },
    })));
    await expect(requestAIMotion(input, new AbortController().signal)).rejects.toThrow('无法使用的动作数据');
    expect(cancelled).toBe(true);
    for (const body of ['{"summary":"a","summary":"b"}', new Uint8Array([0xc3, 0x28])]) {
      fetch.mockResolvedValue(new Response(body));
      await expect(requestAIMotion(input, new AbortController().signal)).rejects.toThrow('无法使用的动作数据');
    }
    expect(fetch).toHaveBeenCalledTimes(4);
  });

  it('sanitizes network/stream failures and inherited error codes without retry or template request', async () => {
    const input = makeAIMotionFixture(); const fetch = fixture();
    fetch.mockRejectedValue(new Error('private network stack'));
    await expect(requestAIMotion(input, new AbortController().signal)).rejects.toThrow('无法连接 AI 服务');
    fetch.mockResolvedValue(new Response(new ReadableStream<Uint8Array>({ start(controller) { controller.error(new Error('private stream stack')); } })));
    await expect(requestAIMotion(input, new AbortController().signal)).rejects.toThrow('无法使用的动作数据');
    fetch.mockResolvedValue(Response.json({ code: 'constructor', message: 'private provider stack' }, { status: 500 }));
    await expect(requestAIMotion(input, new AbortController().signal)).rejects.toThrow('AI 生成失败，请稍后手动重试。');
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(fetch.mock.calls.every(call => call[0] === '/api/motion/generate')).toBe(true);
  });
});
