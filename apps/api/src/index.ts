const headers = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' };
export default {
  async fetch(request, env): Promise<Response> {
    const path = new URL(request.url).pathname;
    if (path.startsWith('/api/')) {
      if (request.method !== 'GET') return Response.json({ code: 'FEATURE_NOT_ENABLED', message: '此公开预览仅提供本机演示，不接受项目或音频上传。' }, { status: 501, headers });
      if (path === '/api/health') return Response.json({ status: 'ok', stage: env.RELEASE_STAGE, version: '0.1.0', protocol: 'preview-1', motionProvenance: 'synthetic-demo' }, { headers });
      if (path === '/api/capabilities') return Response.json({ protocol: 'preview-1', localPreview: { manualCountMap: true, templateArrangement: true, syntheticMotion: true, singleOctetReplacement: true, undoRedo: true, indexedDbSave: true }, serverProjectStorage: false, modelGeneration: false, licensedMotionPack: false, teacherFinalization: false, mp4Export: false, creativeIK: false, freeTimelineEditing: false }, { headers });
      return Response.json({ code: 'FEATURE_NOT_ENABLED', message: '此接口尚未接入生产服务。' }, { status: 501, headers });
    }
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
