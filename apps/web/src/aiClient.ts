import { AI_REQUEST_MAX_BYTES, AI_RESULT_MAX_BYTES, makeAIRequest, parseAIJson, validateAIResult, type AIChoreographyResult } from '../../../packages/core/src/aiChoreography';
import type { CountMap } from '../../../packages/core/src/index';

const errorMessages: Record<string, string> = {
  AI_RATE_LIMITED: 'AI 生成每分钟最多两次，请稍后再试。',
  RATE_LIMITED: '请求过于频繁，请稍后再试。',
  AI_UNAVAILABLE: 'AI 生成暂时不可用，本机编辑仍可使用。',
  API_TEMPORARILY_UNAVAILABLE: '接口暂时不可用，请稍后再试。',
  AI_GENERATION_FAILED: 'AI 生成失败，请稍后手动重试。',
  AI_OUTPUT_INVALID: 'AI 返回了无法使用的编排，请稍后手动重试。',
  AI_TIMEOUT: 'AI 生成超时，请稍后手动重试。',
  INVALID_GENERATION_REQUEST: '请检查描述和已确认的完整八拍。',
  BODY_TOO_LARGE: '生成请求超过大小限制。',
  FEATURE_NOT_ENABLED: '当前部署尚未启用 AI 生成，本机编辑仍可使用。',
};
function cancelled(signal: AbortSignal): void {
  if (signal.aborted) throw new DOMException('生成已取消。', 'AbortError');
}
async function readResult(response: Response, signal: AbortSignal): Promise<unknown> {
  const length = response.headers.get('content-length');
  if (length && (!/^\d+$/.test(length) || Number(length) > AI_RESULT_MAX_BYTES)) throw new Error(errorMessages.AI_OUTPUT_INVALID);
  if (!response.body) throw new Error(errorMessages.AI_OUTPUT_INVALID);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      cancelled(signal);
      const { value, done } = await reader.read();
      cancelled(signal);
      if (done) break;
      bytes += value.byteLength;
      if (bytes > AI_RESULT_MAX_BYTES) { await reader.cancel(); throw new Error(errorMessages.AI_OUTPUT_INVALID); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const merged = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) { merged.set(chunk, offset); offset += chunk.byteLength; }
  try { return parseAIJson(new TextDecoder('utf-8', { fatal: true }).decode(merged)); }
  catch { throw new Error(errorMessages.AI_OUTPUT_INVALID); }
}

/** One explicit request. No startup calls, retries, audio or scene uploads. */
export async function requestAIArrangement(prompt: string, map: CountMap, signal: AbortSignal): Promise<AIChoreographyResult> {
  cancelled(signal);
  const body = JSON.stringify(makeAIRequest(prompt, map));
  if (new TextEncoder().encode(body).byteLength > AI_REQUEST_MAX_BYTES) throw new Error(errorMessages.BODY_TOO_LARGE);
  let response: Response;
  try {
    response = await fetch('/api/choreography/generate', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body,
      credentials: 'same-origin', cache: 'no-store', redirect: 'error', signal,
    });
  } catch {
    cancelled(signal);
    throw new Error('无法连接 AI 服务，请稍后手动重试。');
  }
  cancelled(signal);
  let value: unknown;
  try { value = await readResult(response, signal); }
  catch { cancelled(signal); throw new Error(errorMessages.AI_OUTPUT_INVALID); }
  cancelled(signal);
  if (!response.ok) {
    if (response.status === 499) throw new DOMException('生成已取消。', 'AbortError');
    const code = value && typeof value === 'object' && 'code' in value ? (value as { code: unknown }).code : null;
    throw new Error(typeof code === 'string' && Object.hasOwn(errorMessages, code) ? errorMessages[code] : 'AI 生成失败，请稍后手动重试。');
  }
  try { return validateAIResult(value, map); }
  catch { throw new Error(errorMessages.AI_OUTPUT_INVALID); }
}
