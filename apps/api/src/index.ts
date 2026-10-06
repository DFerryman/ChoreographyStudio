const headers = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' };
const retryHeaders = { ...headers, 'retry-after': '60' };

async function apiRateLimit(request: Request, env: Env): Promise<Response | undefined> {
  // Cloudflare supplies this header. All API routes share one allowance, so
  // changing paths or query strings cannot reset the anonymous preview limit.
  const ip = request.headers.get('cf-connecting-ip');
  if (!ip || !env.API_RATE_LIMITER) return unavailable();
  try {
    const result = await env.API_RATE_LIMITER.limit({ key: `choreo-preview:ip:${ip}` });
    if (result.success === true) return;
    if (result.success === false) return Response.json({ code: 'RATE_LIMITED', message: '请求过于频繁，请稍后再试。' }, { status: 429, headers: retryHeaders });
    return unavailable();
  } catch {
    // A missing or failed protection never opens the API to unlimited traffic.
    return unavailable();
  }
}

function unavailable(): Response {
  return Response.json({ code: 'API_TEMPORARILY_UNAVAILABLE', message: '接口暂时不可用，请稍后再试。' }, { status: 503, headers: retryHeaders });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const path = new URL(request.url).pathname;
    if (path.startsWith('/api/')) {
      const limited = await apiRateLimit(request, env);
      if (limited) return limited;
      if (request.method !== 'GET') return Response.json({ code: 'FEATURE_NOT_ENABLED', message: '此公开预览仅提供本机演示，不接受项目或音频上传。' }, { status: 501, headers });
      if (path === '/api/health') return Response.json({ status: 'ok', stage: env.RELEASE_STAGE, version: '0.1.0', protocol: 'preview-1', motionProvenance: 'synthetic-demo' }, { headers });
      if (path === '/api/capabilities') return Response.json({ protocol: 'preview-1', localPreview: { manualCountMap: true, templateArrangement: true, syntheticMotion: true, singleOctetReplacement: true, undoRedo: true, indexedDbSave: true }, serverProjectStorage: false, modelGeneration: false, licensedMotionPack: false, teacherFinalization: false, mp4Export: false, creativeIK: false, freeTimelineEditing: false }, { headers });
      return Response.json({ code: 'FEATURE_NOT_ENABLED', message: '此接口尚未接入生产服务。' }, { status: 501, headers });
    }
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
