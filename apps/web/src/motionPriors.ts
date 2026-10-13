import { decodeMotionPrior, MOTION_PRIOR_CATALOG, MOTION_PRIOR_MAX_BYTES,
  type MotionPriorClip } from '../../../packages/core/src/motionPriors';
import { JOINT_NAMES } from '../../../packages/core/src/motion-types';

const loaded = new Map<string, MotionPriorClip>();
const cancelled = (signal?: AbortSignal) => { if (signal?.aborted) throw new DOMException('生成已取消。', 'AbortError'); };
async function sha256(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, '0')).join('');
}
function freezeClip(clip: MotionPriorClip): MotionPriorClip {
  for (const pose of clip.poses) {
    Object.freeze(pose.root);
    for (const joint of JOINT_NAMES) Object.freeze(pose.joints[joint]);
    Object.freeze(pose.joints); Object.freeze(pose);
  }
  Object.freeze(clip.times); Object.freeze(clip.poses); Object.freeze(clip);
  return clip;
}
async function readBounded(response: Response, signal?: AbortSignal): Promise<ArrayBuffer> {
  const length = response.headers.get('content-length');
  if (length && (!/^\d+$/.test(length) || Number(length) > MOTION_PRIOR_MAX_BYTES)) throw new Error('真人动作参考大小超出限制。');
  if (!response.body) throw new Error('真人动作参考没有内容。');
  const reader = response.body.getReader(), chunks: Uint8Array[] = []; let size = 0;
  // Cancellation also closes a pending read after response headers. It does
  // not depend on a custom/stalled stream forwarding the fetch abort signal.
  const abort = () => { void reader.cancel().catch(() => undefined); };
  signal?.addEventListener('abort', abort, { once: true });
  try {
    while (true) {
      cancelled(signal);
      const { done, value } = await reader.read();
      cancelled(signal);
      if (done) break;
      size += value.byteLength;
      if (size > MOTION_PRIOR_MAX_BYTES) throw new Error('真人动作参考大小超出限制。');
      chunks.push(value);
    }
  } catch (error) { void reader.cancel().catch(() => undefined); throw error; } finally {
    signal?.removeEventListener('abort', abort); reader.releaseLock();
  }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes.buffer;
}

/** Only selected, product-owned motion references are fetched on an explicit
 * generation. User scenes/audio remain local; no entire packs are downloaded. */
export async function loadMotionPriorClips(ids: readonly string[], options: {
  signal?: AbortSignal; fetcher?: typeof fetch;
} = {}): Promise<Map<string, MotionPriorClip>> {
  cancelled(options.signal);
  const unique = [...new Set(ids)];
  const metadata = unique.map(id => {
    const entry = MOTION_PRIOR_CATALOG.clips.find(clip => clip.id === id);
    if (!entry || !/^[a-z0-9-]+$/.test(id)) throw new Error('编舞选用了未知的真人动作参考。');
    return entry;
  });
  const fetcher = options.fetcher ?? fetch;
  const clips = await Promise.all(metadata.map(async entry => {
    const cached = loaded.get(entry.id);
    if (cached) return cached;
    const response = await fetcher(`/motion-priors/${entry.id}.motion?v=${entry.sourceHash}`, {
      signal: options.signal, credentials: 'same-origin', redirect: 'error',
    });
    if (!response.ok) throw new Error(`真人动作参考读取失败（${response.status}），请重新生成。`);
    const bytes = await readBounded(response, options.signal);
    cancelled(options.signal);
    const actual = await sha256(bytes); cancelled(options.signal);
    if (actual !== entry.sourceHash) throw new Error('真人动作参考版本不匹配，请刷新后重新生成。');
    const clip = freezeClip(decodeMotionPrior(bytes, entry));
    loaded.set(entry.id, clip);
    return clip;
  }));
  cancelled(options.signal);
  return new Map(clips.map(clip => [clip.id, clip]));
}
