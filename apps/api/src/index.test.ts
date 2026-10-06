import { describe, expect, it, vi } from 'vitest';
import worker from './index';

function fixture(success = true) {
  const limit = vi.fn<RateLimit['limit']>().mockResolvedValue({ success });
  const fetch = vi.fn<Fetcher['fetch']>().mockResolvedValue(new Response('static asset'));
  const env: Env = {
    RELEASE_STAGE: 'S0-interactive-preview',
    API_RATE_LIMITER: { limit },
    ASSETS: { fetch, connect: vi.fn() },
  };
  return { env, limit, fetch };
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
    expect(await capabilities.json()).toMatchObject({ serverProjectStorage: false, modelGeneration: false });
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
