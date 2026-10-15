import { parseAIMotionJson } from '../../../packages/core/src/aiMotion';
import {
  DANCE_PLAN_PROTOCOL, DANCE_PLAN_REQUEST_MAX_BYTES, DANCE_PLAN_RESULT_MAX_BYTES, LOCAL_DANCE_PLANNER,
  localDancePlan, validateDancePlanRequest, validateDancePlanResult, type DancePlanRequest, type DancePlanResult,
} from '../../../packages/core/src/dancePlan';

const fallbackReasons: Record<string, string> = {
  AI_RATE_LIMITED: 'AI planning is limited to two requests per minute',
  RATE_LIMITED: 'too many requests',
  AI_UNAVAILABLE: 'the AI service is temporarily unavailable',
  API_TEMPORARILY_UNAVAILABLE: 'the API is temporarily unavailable',
  AI_GENERATION_FAILED: 'AI planning failed',
  AI_OUTPUT_INVALID: 'the AI plan was unusable',
  AI_TIMEOUT: 'AI planning timed out',
  FEATURE_NOT_ENABLED: 'AI planning is not enabled on this deployment',
};
function cancelled(signal: AbortSignal): void {
  if (signal.aborted) throw new DOMException('Generation cancelled.', 'AbortError');
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
/** Every local composition uses a fresh seed: generating again gives a new dance. */
export function localDancePlanResult(request: DancePlanRequest, fallbackReason?: string, seed = crypto.getRandomValues(new Uint32Array(1))[0]): DancePlanResult {
  return { protocol: DANCE_PLAN_PROTOCOL, source: 'local', model: LOCAL_DANCE_PLANNER, plan: localDancePlan(request.prompt, request.beats, seed), ...(fallbackReason ? { fallbackReason } : {}) };
}

/**
 * One explicit planning request. Only the description and coarse musical
 * framing are sent. Any failure other than cancellation falls back to the
 * seeded local composer, so generation always has a usable plan; the
 * result says which planner was used and why.
 */
/** The planner never holds up generation: past this, the local composer takes over. */
export const DANCE_PLAN_CLIENT_TIMEOUT_MS = 60_000;
export async function requestDancePlan(input: DancePlanRequest, signal: AbortSignal, timeoutMs = DANCE_PLAN_CLIENT_TIMEOUT_MS): Promise<DancePlanResult> {
  cancelled(signal);
  const request = validateDancePlanRequest(input), body = JSON.stringify(request);
  if (new TextEncoder().encode(body).byteLength > DANCE_PLAN_REQUEST_MAX_BYTES) return localDancePlanResult(request, 'the description is too long');
  const timeout = AbortSignal.timeout(timeoutMs), combined = AbortSignal.any([signal, timeout]);
  const fallback = (reason: string) => { cancelled(signal); return localDancePlanResult(request, timeout.aborted ? 'AI planning timed out' : reason); };
  let response: Response;
  try {
    response = await fetch('/api/dance/plan', { method: 'POST', headers: { 'content-type': 'application/json' }, body,
      credentials: 'same-origin', cache: 'no-store', redirect: 'error', signal: combined });
  } catch { return fallback('could not reach the AI service'); }
  cancelled(signal);
  let value: unknown;
  try { value = await readBounded(response, combined); }
  catch { return fallback('the AI plan was unusable'); }
  if (response.status === 499) throw new DOMException('Generation cancelled.', 'AbortError');
  if (!response.ok) {
    const code = value && typeof value === 'object' && Object.hasOwn(value, 'code') ? (value as { code: unknown }).code : null;
    return localDancePlanResult(request, typeof code === 'string' && Object.hasOwn(fallbackReasons, code) ? fallbackReasons[code] : 'AI planning failed');
  }
  return validateDancePlanResult(value) ?? localDancePlanResult(request, 'the AI plan was unusable');
}
