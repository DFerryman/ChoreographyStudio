import { AI_MOTION_REQUEST_MAX_BYTES, AI_MOTION_RESULT_MAX_BYTES, parseAIMotionJson } from '../../../packages/core/src/aiMotion';
import { validateAIMotionPlanRequest, validateAIMotionPlanResult, type AIMotionPlanRequest, type AIMotionPlanResult } from '../../../packages/core/src/aiMotionPlan';
import { AI_MOTION_PLAN_REASON_MESSAGES, type AIMotionPlanReasonCode } from '../../../packages/core/src/aiMotionPlanErrors';

const invalidMessage = 'AI 返回了无法使用的动作规划，请稍后手动重试。';
const errors: Record<string, string> = {
  AI_RATE_LIMITED: 'AI 生成每分钟最多两次，请稍后再试。',
  RATE_LIMITED: '请求过于频繁，请稍后再试。',
  AI_UNAVAILABLE: 'AI 生成暂时不可用，请稍后再试。',
  API_TEMPORARILY_UNAVAILABLE: '接口暂时不可用，请稍后再试。',
  AI_GENERATION_FAILED: 'AI 生成失败，请稍后手动重试。',
  AI_OUTPUT_INVALID: invalidMessage,
  AI_TIMEOUT: 'AI 生成超时，请稍后手动重试。',
  INVALID_MOTION_PLAN_REQUEST: '请检查动作描述、固定区间和真实动作来源。',
  BODY_TOO_LARGE: '生成请求超过大小限制。',
  FEATURE_NOT_ENABLED: '当前部署尚未启用动作规划，请稍后再试。',
};
function cancelled(signal: AbortSignal): void {
  if (signal.aborted) throw new DOMException('生成已取消。', 'AbortError');
}
async function read(response: Response, signal: AbortSignal): Promise<unknown> {
  const length = response.headers.get('content-length');
  if (length && (!/^\d+$/.test(length) || Number(length) > AI_MOTION_RESULT_MAX_BYTES) || !response.body) throw new Error(invalidMessage);
  const reader = response.body.getReader();
  const abort = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener('abort', abort, { once: true });
  const chunks: Uint8Array[] = []; let bytes = 0;
  try {
    while (true) {
      cancelled(signal);
      const { done, value } = await reader.read();
      cancelled(signal);
      if (done) break;
      bytes += value.byteLength;
      if (bytes > AI_MOTION_RESULT_MAX_BYTES) { await reader.cancel(); throw new Error(invalidMessage); }
      chunks.push(value);
    }
  } finally { signal.removeEventListener('abort', abort); reader.releaseLock(); }
  const merged = new Uint8Array(bytes); let offset = 0;
  for (const chunk of chunks) { merged.set(chunk, offset); offset += chunk.byteLength; }
  return parseAIMotionJson(new TextDecoder('utf-8', { fatal: true }).decode(merged));
}

/** Exactly one explicit planning request. No provider retries, direct-angle
 * fallback, audio bytes, scene files, startup calls or server persistence. */
export async function requestAIMotionPlan(request: AIMotionPlanRequest, signal: AbortSignal): Promise<AIMotionPlanResult> {
  cancelled(signal);
  // Validation clones all supplied context/catalog; caller mutations during a
  // pending response cannot change the identity against which it is checked.
  const input = validateAIMotionPlanRequest(request), body = JSON.stringify(input);
  if (new TextEncoder().encode(body).byteLength > AI_MOTION_REQUEST_MAX_BYTES) throw new Error(errors.BODY_TOO_LARGE);
  let response: Response;
  try {
    response = await fetch('/api/motion/plan', { method: 'POST', headers: { 'content-type': 'application/json' }, body,
      credentials: 'same-origin', cache: 'no-store', redirect: 'error', signal });
  } catch {
    cancelled(signal);
    throw new Error('无法连接 AI 服务，请稍后手动重试。');
  }
  cancelled(signal);
  let value: unknown;
  try { value = await read(response, signal); }
  catch { cancelled(signal); throw new Error(invalidMessage); }
  cancelled(signal);
  if (!response.ok) {
    if (response.status === 499) throw new DOMException('生成已取消。', 'AbortError');
    const code = value && typeof value === 'object' && Object.hasOwn(value, 'code') ? (value as { code: unknown }).code : null;
    if (code === 'AI_OUTPUT_INVALID') {
      const reason = value && typeof value === 'object' && Object.hasOwn(value, 'reasonCode') ? (value as { reasonCode: unknown }).reasonCode : null;
      if (typeof reason === 'string' && Object.hasOwn(AI_MOTION_PLAN_REASON_MESSAGES, reason)) {
        throw new Error(AI_MOTION_PLAN_REASON_MESSAGES[reason as AIMotionPlanReasonCode]);
      }
    }
    throw new Error(typeof code === 'string' && Object.hasOwn(errors, code) ? errors[code] : errors.AI_GENERATION_FAILED);
  }
  try { return validateAIMotionPlanResult(value, input); }
  catch { throw new Error(invalidMessage); }
}
