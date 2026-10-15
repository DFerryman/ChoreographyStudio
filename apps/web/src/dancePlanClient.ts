import { parseAIMotionJson } from '../../../packages/core/src/aiMotion';
import {
  DANCE_PLAN_PROTOCOL, DANCE_PLAN_REQUEST_MAX_BYTES, DANCE_PLAN_RESULT_MAX_BYTES, LOCAL_DANCE_PLANNER,
  localDancePlan, validateDancePlanRequest, validateDancePlanResult, type DancePlanRequest, type DancePlanResult,
} from '../../../packages/core/src/dancePlan';

const fallbackReasons: Record<string, string> = {
  AI_RATE_LIMITED: 'AI 规划每分钟最多两次',
  RATE_LIMITED: '请求过于频繁',
  AI_UNAVAILABLE: 'AI 服务暂时不可用',
  API_TEMPORARILY_UNAVAILABLE: '接口暂时不可用',
  AI_GENERATION_FAILED: 'AI 规划失败',
  AI_OUTPUT_INVALID: 'AI 返回的规划不可用',
  AI_TIMEOUT: 'AI 规划超时',
  FEATURE_NOT_ENABLED: '当前部署尚未启用 AI 规划',
};
function cancelled(signal: AbortSignal): void {
  if (signal.aborted) throw new DOMException('生成已取消。', 'AbortError');
}
async function readBounded(response: Response, signal: AbortSignal): Promise<unknown> {
  const length = response.headers.get('content-length');
  if (length && Number(length) > DANCE_PLAN_RESULT_MAX_BYTES || !response.body) throw new Error('INVALID');
  const reader = response.body.getReader(), chunks: Uint8Array[] = [];
  const abort = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener('abort', abort, { once: true });
  let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      cancelled(signal);
      if (done) break;
      bytes += value.byteLength;
      if (bytes > DANCE_PLAN_RESULT_MAX_BYTES) { await reader.cancel(); throw new Error('INVALID'); }
      chunks.push(value);
    }
  } finally { signal.removeEventListener('abort', abort); reader.releaseLock(); }
  const merged = new Uint8Array(bytes); let offset = 0;
  for (const chunk of chunks) { merged.set(chunk, offset); offset += chunk.byteLength; }
  return parseAIMotionJson(new TextDecoder('utf-8', { fatal: true }).decode(merged), DANCE_PLAN_RESULT_MAX_BYTES);
}
export function localDancePlanResult(request: DancePlanRequest, fallbackReason?: string): DancePlanResult {
  return { protocol: DANCE_PLAN_PROTOCOL, source: 'local', model: LOCAL_DANCE_PLANNER, plan: localDancePlan(request.prompt, request.beats), ...(fallbackReason ? { fallbackReason } : {}) };
}

/**
 * One explicit planning request. Only the description and coarse musical
 * framing are sent. Any failure other than cancellation falls back to the
 * deterministic local planner, so generation always has a usable plan; the
 * result says which planner was used and why.
 */
export async function requestDancePlan(input: DancePlanRequest, signal: AbortSignal): Promise<DancePlanResult> {
  cancelled(signal);
  const request = validateDancePlanRequest(input), body = JSON.stringify(request);
  if (new TextEncoder().encode(body).byteLength > DANCE_PLAN_REQUEST_MAX_BYTES) return localDancePlanResult(request, '描述过长');
  let response: Response;
  try {
    response = await fetch('/api/dance/plan', { method: 'POST', headers: { 'content-type': 'application/json' }, body,
      credentials: 'same-origin', cache: 'no-store', redirect: 'error', signal });
  } catch {
    cancelled(signal);
    return localDancePlanResult(request, '无法连接 AI 服务');
  }
  cancelled(signal);
  let value: unknown;
  try { value = await readBounded(response, signal); }
  catch (error) { cancelled(signal); void error; return localDancePlanResult(request, 'AI 返回的规划不可用'); }
  if (response.status === 499) throw new DOMException('生成已取消。', 'AbortError');
  if (!response.ok) {
    const code = value && typeof value === 'object' && Object.hasOwn(value, 'code') ? (value as { code: unknown }).code : null;
    return localDancePlanResult(request, typeof code === 'string' && Object.hasOwn(fallbackReasons, code) ? fallbackReasons[code] : 'AI 规划失败');
  }
  return validateDancePlanResult(value) ?? localDancePlanResult(request, 'AI 返回的规划不可用');
}
