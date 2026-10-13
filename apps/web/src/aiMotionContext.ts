import { JOINT_NAMES, sampleTake, type Pose, type Vec3 } from '../../../packages/core/src';
import { clonePose, evaluatePose, RIG_CALIBRATION_VERSION, RIG_DEFINITIONS } from '../../../packages/core/src/humanoid';
import { AI_MOTION_PROTOCOL, validateAIMotionRequest, type AIMotionAudio, type AIMotionBoundary, type AIMotionRequest, type AIMotionSample, type AIMotionTarget } from '../../../packages/core/src/aiMotion';
import { audioTrackSegments, type SceneAudioClip } from './audioTracks';
import { createAIMotionSampler, estimateAIMotionBoundary, validateAIMotionTrack } from '../../../packages/core/src/aiMotionTrack';
import type { SceneSnapshot } from './sceneProject';

export type BuildAIMotionRequestOptions = {
  prompt: string;
  sceneId: string;
  baseRevision: number;
  snapshot: SceneSnapshot;
  /** Captured exactly once. Subsequent Timeline selection changes are unrelated. */
  range?: { start: number; end: number } | null;
  audioBlob?: Blob | null;
  audioName?: string;
  /** Decoded duration of the complete primary asset, rather than the selected segment. */
  audioDurationSeconds?: number;
  audioClips?: readonly SceneAudioClip[];
  signal?: AbortSignal;
};

const CONTEXT_SECONDS = 1;
const CONTEXT_SAMPLES_PER_SIDE = 4;
const audioHashes = new WeakMap<Blob, Promise<string>>();
const identities = new WeakMap<object, number>();
let nextIdentity = 0;

function objectIdentity(value: object | null | undefined): number {
  if (!value) return 0;
  let identity = identities.get(value);
  if (identity === undefined) { identity = ++nextIdentity; identities.set(value, identity); }
  return identity;
}

/**
 * Cheap local stale-candidate guard for immutable history objects. This identity
 * stamp is never sent or persisted; context.sourceHash is the SHA-256 identity.
 * Camera and view changes are not motion sources. Callers also check revision.
 */
export function sourceStampForAIMotion(snapshot: SceneSnapshot, audioBlob: Blob | null | undefined, audioClips: readonly SceneAudioClip[] = []): string {
  const clips = new Map(audioClips.map(clip => [clip.id, clip.blob]));
  return JSON.stringify([
    objectIdentity(snapshot.countMap), objectIdentity(snapshot.take), objectIdentity(snapshot.manual), objectIdentity(snapshot.aiMotion),
    snapshot.audioOffsetSeconds ?? 0, objectIdentity(audioBlob),
    (snapshot.audioTracks ?? []).map(track => [track.id, track.name, track.offsetSeconds, track.durationSeconds, !!track.muted, JSON.stringify(track.segments ?? null), objectIdentity(clips.get(track.id))]),
  ]);
}

function cancelled(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new DOMException('生成已取消。', 'AbortError');
}

/** Cancellation releases the request owner even if WebCrypto is still finishing locally. */
async function withCancellation<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  cancelled(signal);
  if (!signal) return promise;
  return new Promise<T>((resolve, reject) => {
    const abort = () => { signal.removeEventListener('abort', abort); reject(new DOMException('生成已取消。', 'AbortError')); };
    signal.addEventListener('abort', abort, { once: true });
    promise.then(value => {
      signal.removeEventListener('abort', abort);
      if (signal.aborted) abort(); else resolve(value);
    }, error => { signal.removeEventListener('abort', abort); reject(error); });
  });
}

async function sha256(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

function hashAudio(blob: Blob, signal?: AbortSignal): Promise<string> {
  let hash = audioHashes.get(blob);
  if (!hash) {
    hash = blob.arrayBuffer().then(sha256);
    audioHashes.set(blob, hash);
    // A local read failure may be retried by a later explicit generation.
    void hash.catch(() => { if (audioHashes.get(blob) === hash) audioHashes.delete(blob); });
  }
  return withCancellation(hash, signal);
}

/** Stable key order makes equivalent source snapshots share the same SHA. */
function sourceJSON(snapshot: SceneSnapshot): string {
  return JSON.stringify({
    countMap: snapshot.countMap, take: snapshot.take, manual: snapshot.manual ?? null, aiMotion: snapshot.aiMotion ?? null,
  }, (_key, value: unknown) => value && typeof value === 'object' && !Array.isArray(value)
    ? Object.fromEntries(Object.keys(value).sort().map(key => [key, (value as Record<string, unknown>)[key]])) : value);
}

function neutralPose(): Pose {
  return { root: [0, 1.05, 0], joints: Object.fromEntries(JOINT_NAMES.map(name => [name, [0, 0, 0, 1]])) as Pose['joints'] };
}

function contextSamples(sampler: (time: number) => Pose, start: number, end: number): AIMotionSample[] {
  if (end <= start) return [];
  return Array.from({ length: CONTEXT_SAMPLES_PER_SIDE }, (_, index) => {
    const time = index === CONTEXT_SAMPLES_PER_SIDE - 1 ? end : start + (end - start) * index / (CONTEXT_SAMPLES_PER_SIDE - 1);
    return { time, pose: clonePose(sampler(time)) };
  });
}

/** Read-only FK hints describe foot movement, without guessing floor contact. */
function boundaryWithFeet(sampler: (time: number) => Pose, time: number, side: 'before' | 'after', duration: number): AIMotionBoundary {
  const boundary = estimateAIMotionBoundary(sampler, time, side, duration);
  const world = evaluatePose(boundary.pose);
  let direction = side === 'before' ? -1 : 1;
  if (direction < 0 && time === 0 || direction > 0 && time === duration) direction *= -1;
  const room = direction < 0 ? time : duration - time;
  const step = Math.min(1e-4, room / 2);
  const firstTime = time + direction * step, secondTime = time + direction * 2 * step;
  // Use the represented sample times, including fractional imported boundaries.
  const firstDt = firstTime - time, secondDt = secondTime - time;
  const hasSamples = step > 0 && firstDt !== 0 && secondDt !== firstDt;
  const firstWorld = hasSamples ? evaluatePose(sampler(firstTime)) : null;
  const secondWorld = hasSamples ? evaluatePose(sampler(secondTime)) : null;
  const foot = (joint: 'LeftFoot' | 'RightFoot') => {
    const position: Vec3 = [...world[joint].position];
    const velocity: Vec3 = firstWorld && secondWorld
      ? position.map((value, axis) => (secondDt * secondDt * (firstWorld[joint].position[axis] - value) - firstDt * firstDt * (secondWorld[joint].position[axis] - value)) / (firstDt * secondDt * (secondDt - firstDt))) as Vec3
      : [0, 0, 0];
    return { position, velocity };
  };
  return { ...boundary, footKinematics: { left: foot('LeftFoot'), right: foot('RightFoot') } };
}

function coverage(offset: number, sourceOffset: number, sourceDuration: number, selectedDuration: number, sceneDuration: number): AIMotionAudio['coverage'] {
  const startSeconds = Math.max(0, offset, offset - sourceOffset);
  const endSeconds = Math.min(sceneDuration, offset + selectedDuration, offset + sourceDuration - sourceOffset);
  return endSeconds > startSeconds ? { startSeconds, endSeconds } : null;
}

function freezeRequest<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freezeRequest(child);
    Object.freeze(value);
  }
  return value;
}

/**
 * Capture only necessary context for one explicit text-model generation. No
 * audio bytes, entire scene, camera, dense take, or manual author tracks leave
 * the browser. Their local SHA still makes the captured source unambiguous.
 */
export async function buildAIMotionRequest(options: BuildAIMotionRequestOptions): Promise<AIMotionRequest> {
  cancelled(options.signal);
  const { snapshot, signal, prompt, sceneId, baseRevision } = options;
  const duration = snapshot.countMap.durationSeconds;
  const target: AIMotionTarget = options.range
    ? { mode: 'interval', startSeconds: options.range.start, endSeconds: options.range.end }
    : { mode: 'full', startSeconds: 0, endSeconds: duration };
  if (!Number.isFinite(target.startSeconds) || !Number.isFinite(target.endSeconds) || target.startSeconds < 0 || target.endSeconds > duration || target.endSeconds <= target.startSeconds) throw new Error('AI 生成区间无效。');
  if (snapshot.take && (snapshot.take.durationSeconds !== duration || snapshot.take.countMapId !== snapshot.countMap.id)) throw new Error('原动作与数拍绑定不一致。');
  if (snapshot.aiMotion) validateAIMotionTrack(snapshot.aiMotion, snapshot.countMap);

  // active.take is already the authoritative legacy result. Baking manual again
  // would change imported nonuniform samples and their surrounding interpolation.
  const sampler = createAIMotionSampler(snapshot.take ? time => sampleTake(snapshot.take!, time) : () => neutralPose(), snapshot.aiMotion);
  const timing = structuredClone(snapshot.countMap);
  const start = boundaryWithFeet(sampler, target.startSeconds, 'before', duration);
  const end = boundaryWithFeet(sampler, target.endSeconds, 'after', duration);
  const before = target.mode === 'interval' ? contextSamples(sampler, Math.max(0, target.startSeconds - CONTEXT_SECONDS), target.startSeconds) : [];
  const after = target.mode === 'interval' ? contextSamples(sampler, target.endSeconds, Math.min(duration, target.endSeconds + CONTEXT_SECONDS)) : [];
  // Capture the complete source serialization before the first asynchronous read.
  const motionSource = sourceJSON(snapshot);
  // Missing music is allowed: zero means its complete asset duration is unknown.
  // A present asset must use the decoded duration, never a guessed segment length.
  const primaryDuration = options.audioDurationSeconds ?? 0;
  if (!Number.isFinite(primaryDuration) || primaryDuration < 0 || (options.audioBlob && primaryDuration === 0)) throw new Error('音乐时长尚未就绪。');
  const primaryOffset = snapshot.audioOffsetSeconds ?? 0;
  const audio: AIMotionAudio[] = [{
    id: 'primary', name: options.audioName || '音乐', hash: null, durationSeconds: primaryDuration,
    offsetSeconds: primaryOffset, sourceOffsetSeconds: timing.sourceOffsetSeconds, muted: false,
    availability: options.audioBlob ? 'available' : 'missing',
    coverage: coverage(primaryOffset, timing.sourceOffsetSeconds, primaryDuration, duration, duration),
  }];
  const blobs: (Blob | null)[] = [options.audioBlob ?? null];
  const clips = new Map((options.audioClips ?? []).map(clip => [clip.id, clip.blob]));
  for (const track of snapshot.audioTracks ?? []) {
    const blob = clips.get(track.id) ?? null, audible = audioTrackSegments(track);
    audio.push({ id: track.id, name: track.name, hash: null, durationSeconds: track.durationSeconds,
      offsetSeconds: track.offsetSeconds, sourceOffsetSeconds: 0, muted: !!track.muted,
      // Split/trimmed tracks report the scene span from their first to last audible piece.
      availability: blob ? 'available' : 'missing', coverage: coverage(track.offsetSeconds + audible[0].startSeconds, 0, audible.at(-1)!.endSeconds - audible[0].startSeconds, audible.at(-1)!.endSeconds - audible[0].startSeconds, duration) });
    blobs.push(blob);
  }
  // Sequential hashing bounds transient ArrayBuffer memory to one local clip.
  // WeakMap caching stores only digest promises, never an extra audio byte copy.
  for (const [index, blob] of blobs.entries()) {
    cancelled(signal);
    if (blob) audio[index].hash = await hashAudio(blob, signal);
  }
  cancelled(signal);
  const sourceBytes = new TextEncoder().encode(`{"motion":${motionSource},"audio":${JSON.stringify(audio)}}`);
  const sourceHash = await withCancellation(sha256(sourceBytes.buffer), signal);
  cancelled(signal);
  const request: AIMotionRequest = {
    protocol: AI_MOTION_PROTOCOL, prompt,
    context: {
      requestId: `motion_${crypto.randomUUID()}`, sceneId, baseRevision, sourceHash, target,
      skeleton: { id: RIG_CALIBRATION_VERSION, coordinateSystem: 'right-handed-y-up-z-forward', rotationConvention: 'local-euler-xyz-degrees',
        joints: RIG_DEFINITIONS.map(joint => ({ name: joint.name, parent: joint.parent, offset: [...joint.offset], restRotation: [0, 0, 0, 1] })) },
      timing, initialPose: clonePose(start.pose), ending: 'hold', before, after,
      boundaries: { start, end }, audio, audioUnderstanding: false,
    },
  };
  return freezeRequest(validateAIMotionRequest(request));
}
