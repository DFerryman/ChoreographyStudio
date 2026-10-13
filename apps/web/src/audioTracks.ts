/**
 * Additional imported audio tracks. The CountMap music stays the primary track;
 * every further file sits on its own Timeline track with its own placement.
 * Snapshots store only small placement records; clip bytes live once per scene.
 */
export const AUDIO_TRACK_FPS = 30;
export const AUDIO_TRACK_LIMITS = {
  tracks: 8,
  clipBytes: 100 * 1024 * 1024,
  totalBytes: 200 * 1024 * 1024,
  minDurationSeconds: 0.05,
  maxDurationSeconds: 600,
  nameLength: 255,
  /** Audible pieces per track after splitting. */
  segments: 64,
} as const;

/**
 * One audible piece of a track, in clip source seconds. Starts sit on whole
 * frames; an end sits on a whole frame or at the clip's exact duration.
 */
export type AudioTrackSegment = { startSeconds: number; endSeconds: number };

export type SceneAudioTrack = {
  /** Identifies the clip bytes in SceneDocument.audioClips. */
  id: string;
  name: string;
  /** Scene time at which the clip's first sample plays; whole 30 fps frames. */
  offsetSeconds: number;
  /** Decoded duration of the complete, unchanged clip. */
  durationSeconds: number;
  muted?: boolean;
  /**
   * Split/trimmed audible ranges, sorted and non-overlapping. Absent means the
   * whole clip plays. Source outside these ranges never plays.
   */
  segments?: AudioTrackSegment[];
};
type Placement = Pick<SceneAudioTrack, 'offsetSeconds' | 'durationSeconds' | 'segments'>;
export type SceneAudioClip = { id: string; blob: Blob };

const frames = (seconds: number) => Math.ceil(seconds * AUDIO_TRACK_FPS - 1e-9);

const frameTimeOf = (frame: number) => frame === 0 ? 0 : frame / AUDIO_TRACK_FPS;
const onFrame = (seconds: number) => Math.abs(seconds * AUDIO_TRACK_FPS - Math.round(seconds * AUDIO_TRACK_FPS)) <= 1e-9;

/** The audible source ranges of a track; the whole clip when never split or trimmed. */
export function audioTrackSegments(track: Pick<SceneAudioTrack, 'durationSeconds' | 'segments'>): AudioTrackSegment[] {
  return track.segments?.length ? track.segments : [{ startSeconds: 0, endSeconds: track.durationSeconds }];
}

/** At least one frame of the audible part always overlaps the scene. */
export function audioTrackOffsetBounds(track: Pick<SceneAudioTrack, 'durationSeconds' | 'segments'>, sceneDuration: number) {
  const segments = audioTrackSegments(track);
  const first = segments[0].startSeconds, last = segments.at(-1)!.endSeconds;
  return { min: frameTimeOf(-Math.max(0, frames(last) - 1)), max: frameTimeOf(Math.max(0, frames(sceneDuration) - 1) - Math.round(first * AUDIO_TRACK_FPS)) };
}

export function snapAudioTrackOffset(seconds: number, track: Pick<SceneAudioTrack, 'durationSeconds' | 'segments'>, sceneDuration: number): number {
  if (!Number.isFinite(seconds) || !Number.isFinite(track.durationSeconds) || track.durationSeconds <= 0 || !Number.isFinite(sceneDuration) || sceneDuration <= 0) throw new Error('音轨位置无效。');
  const { min, max } = audioTrackOffsetBounds(track, sceneDuration);
  const frame = Math.max(Math.round(min * AUDIO_TRACK_FPS), Math.min(Math.round(max * AUDIO_TRACK_FPS), Math.round(seconds * AUDIO_TRACK_FPS)));
  return frameTimeOf(frame);
}

/** Source position for a scene time, or null where this track is silent. */
export function audioTrackSourceTime(track: Placement, sceneTime: number, sceneDuration: number): number | null {
  if (!Number.isFinite(sceneTime) || sceneTime < 0 || sceneTime >= sceneDuration) return null;
  const source = sceneTime - track.offsetSeconds;
  if (source < 0 || source >= track.durationSeconds - 1e-6) return null;
  return audioTrackSegments(track).some(segment => source >= segment.startSeconds - 1e-9 && source < segment.endSeconds - 1e-6) ? source : null;
}

/** Where a silent track should wait: the start of its next audible piece, if any. */
function nextAudibleSource(track: Placement, sceneTime: number): number | null {
  const source = sceneTime - track.offsetSeconds;
  return audioTrackSegments(track).find(segment => segment.startSeconds >= source - 1e-9)?.startSeconds ?? null;
}

/** Store whole-clip playback without a segments field, exactly like an untouched track. */
function withSegments(track: SceneAudioTrack, segments: AudioTrackSegment[]): SceneAudioTrack {
  const { segments: _previous, ...rest } = track;
  const whole = segments.length === 1 && segments[0].startSeconds === 0 && segments[0].endSeconds === track.durationSeconds;
  return whole ? rest : { ...rest, segments };
}

/**
 * Split the audible piece under a scene time into two at the nearest whole
 * frame. Returns null when the point is not strictly inside a piece.
 */
export function splitAudioTrack(track: SceneAudioTrack, sceneTime: number): SceneAudioTrack | null {
  if (!Number.isFinite(sceneTime)) return null;
  const segments = audioTrackSegments(track);
  if (segments.length >= AUDIO_TRACK_LIMITS.segments) return null;
  const at = frameTimeOf(Math.round((sceneTime - track.offsetSeconds) * AUDIO_TRACK_FPS));
  const index = segments.findIndex(segment => at > segment.startSeconds + 1e-9 && at < segment.endSeconds - 1e-9);
  if (index < 0) return null;
  const piece = segments[index];
  return withSegments(track, [...segments.slice(0, index), { startSeconds: piece.startSeconds, endSeconds: at }, { startSeconds: at, endSeconds: piece.endSeconds }, ...segments.slice(index + 1)]);
}

/** Inclusive source-time limits for dragging one edge of one piece. */
export function audioSegmentTrimBounds(track: SceneAudioTrack, index: number, edge: 'start' | 'end', sceneDuration: number): { min: number; max: number } | null {
  const segments = audioTrackSegments(track), piece = segments[index];
  if (!piece) return null;
  const sceneLastFrame = Math.max(0, frames(sceneDuration) - 1);
  const offsetFrame = Math.round(track.offsetSeconds * AUDIO_TRACK_FPS);
  if (edge === 'start') {
    let max = frames(piece.endSeconds) - 1;
    if (index === 0) max = Math.min(max, sceneLastFrame - offsetFrame);
    const min = Math.round((segments[index - 1]?.endSeconds ?? 0) * AUDIO_TRACK_FPS);
    return min <= max ? { min: frameTimeOf(min), max: frameTimeOf(max) } : null;
  }
  const next = segments[index + 1]?.startSeconds;
  let min = Math.round(piece.startSeconds * AUDIO_TRACK_FPS) + 1;
  if (index === segments.length - 1) min = Math.max(min, 1 - offsetFrame);
  const max = next ?? track.durationSeconds;
  return min / AUDIO_TRACK_FPS <= max + 1e-9 ? { min: frameTimeOf(min), max } : null;
}

/**
 * Move one edge of one audible piece to a source time, snapped to whole frames
 * and clamped so pieces never overlap and the track stays inside the scene.
 * Returns null when nothing changes.
 */
export function trimAudioSegment(track: SceneAudioTrack, index: number, edge: 'start' | 'end', sourceSeconds: number, sceneDuration: number): SceneAudioTrack | null {
  const bounds = audioSegmentTrimBounds(track, index, edge, sceneDuration);
  if (!bounds || !Number.isFinite(sourceSeconds)) return null;
  let value = frameTimeOf(Math.round(sourceSeconds * AUDIO_TRACK_FPS));
  if (value >= bounds.max - 1e-9) value = bounds.max;
  if (value <= bounds.min + 1e-9) value = bounds.min;
  const segments = audioTrackSegments(track);
  const piece = segments[index];
  if (value === piece[edge === 'start' ? 'startSeconds' : 'endSeconds']) return null;
  const changed = edge === 'start' ? { ...piece, startSeconds: value } : { ...piece, endSeconds: value };
  return withSegments(track, segments.map((segment, at) => at === index ? changed : segment));
}

/** Remove one audible piece; the last remaining piece is removed with its track instead. */
export function removeAudioSegment(track: SceneAudioTrack, index: number, sceneDuration: number): SceneAudioTrack | null {
  const segments = audioTrackSegments(track);
  if (segments.length < 2 || !segments[index]) return null;
  const next = withSegments(track, segments.filter((_, at) => at !== index));
  // Removing an outer piece can leave the remaining audio outside the scene.
  const { min, max } = audioTrackOffsetBounds(next, sceneDuration);
  return next.offsetSeconds >= min - 1e-9 && next.offsetSeconds <= max + 1e-9 ? next : null;
}

/** Keep a readable file name without control characters. */
export function audioTrackName(fileName: string): string {
  const cleaned = fileName.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, AUDIO_TRACK_LIMITS.nameLength);
  return cleaned || '音轨';
}

function own(value: object, key: string) { return Object.prototype.hasOwnProperty.call(value, key); }

/** Strict validation of one snapshot's track list; throws a readable message. */
export function validateAudioTracks(value: unknown, sceneDuration: number): SceneAudioTrack[] {
  if (!Array.isArray(value) || value.length > AUDIO_TRACK_LIMITS.tracks) throw new Error('音轨数量超出范围。');
  const ids = new Set<string>();
  return value.map(item => {
    if (!item || typeof item !== 'object' || Array.isArray(item) || ![Object.prototype, null].includes(Object.getPrototypeOf(item))) throw new Error('音轨格式错误。');
    const track = item as Record<string, unknown>;
    const allowed = ['id', 'name', 'offsetSeconds', 'durationSeconds', 'muted', 'segments'];
    if (['id', 'name', 'offsetSeconds', 'durationSeconds'].some(key => !own(track, key)) || Object.keys(track).some(key => !allowed.includes(key))) throw new Error('音轨字段不完整或不受支持。');
    const { id, name, offsetSeconds, durationSeconds, muted, segments } = track;
    if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(id) || ids.has(id)) throw new Error('音轨 ID 无效或重复。');
    ids.add(id);
    if (typeof name !== 'string' || !name.trim() || name.length > AUDIO_TRACK_LIMITS.nameLength || /[\u0000-\u001f\u007f]/.test(name)) throw new Error('音轨名称无效。');
    if (typeof durationSeconds !== 'number' || !Number.isFinite(durationSeconds) || durationSeconds < AUDIO_TRACK_LIMITS.minDurationSeconds || durationSeconds > AUDIO_TRACK_LIMITS.maxDurationSeconds) throw new Error('音轨时长超出范围。');
    if (typeof offsetSeconds !== 'number' || !Number.isFinite(offsetSeconds) || !onFrame(offsetSeconds)) throw new Error('音轨位置必须对齐 30 fps 整帧。');
    const pieces = segments === undefined ? undefined : validateSegments(segments, durationSeconds);
    const { min, max } = audioTrackOffsetBounds({ durationSeconds, segments: pieces }, sceneDuration);
    if (offsetSeconds < min - 1e-9 || offsetSeconds > max + 1e-9) throw new Error('音轨必须至少有一帧位于场景内。');
    if (muted !== undefined && typeof muted !== 'boolean') throw new Error('音轨静音设置无效。');
    return { id, name, offsetSeconds, durationSeconds, ...(muted ? { muted: true } : {}), ...(pieces ? { segments: pieces } : {}) };
  });
}

function validateSegments(value: unknown, durationSeconds: number): AudioTrackSegment[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > AUDIO_TRACK_LIMITS.segments) throw new Error('音轨片段数量超出范围。');
  let previousEnd = 0;
  return value.map(item => {
    if (!item || typeof item !== 'object' || Array.isArray(item) || ![Object.prototype, null].includes(Object.getPrototypeOf(item))) throw new Error('音轨片段格式错误。');
    const segment = item as Record<string, unknown>;
    if (Object.keys(segment).length !== 2 || !own(segment, 'startSeconds') || !own(segment, 'endSeconds')) throw new Error('音轨片段字段不完整或不受支持。');
    const { startSeconds, endSeconds } = segment;
    if (typeof startSeconds !== 'number' || typeof endSeconds !== 'number' || !Number.isFinite(startSeconds) || !Number.isFinite(endSeconds)) throw new Error('音轨片段时间无效。');
    if (!onFrame(startSeconds) || (!onFrame(endSeconds) && endSeconds !== durationSeconds)) throw new Error('音轨片段边界必须对齐 30 fps 整帧。');
    if (startSeconds < previousEnd - 1e-9 || endSeconds <= startSeconds || endSeconds > durationSeconds) throw new Error('音轨片段必须按顺序、互不重叠且位于音频内。');
    previousEnd = endSeconds;
    return { startSeconds, endSeconds };
  });
}

/** Clip ids referenced anywhere in history, so undo/redo keeps working after save. */
export function referencedAudioClipIds(project: { history: readonly { audioTracks?: readonly SceneAudioTrack[] }[] }): Set<string> {
  return new Set(project.history.flatMap(snapshot => snapshot.audioTracks?.map(track => track.id) ?? []));
}

export function pruneAudioClips(clips: readonly SceneAudioClip[], project: { history: readonly { audioTracks?: readonly SceneAudioTrack[] }[] }): SceneAudioClip[] {
  const used = referencedAudioClipIds(project);
  return clips.filter(clip => used.has(clip.id));
}

/** Keep only tracks that still fit a changed scene duration. */
export function fitAudioTracks(tracks: readonly SceneAudioTrack[] | undefined, sceneDuration: number): SceneAudioTrack[] {
  return (tracks ?? []).filter(track => {
    const { min, max } = audioTrackOffsetBounds(track, sceneDuration);
    return track.offsetSeconds >= min - 1e-9 && track.offsetSeconds <= max + 1e-9;
  });
}

export type AudioTrackElement = Pick<HTMLAudioElement, 'currentTime' | 'playbackRate' | 'paused' | 'play' | 'pause'>;
export type AudioTrackSyncState = { time: number; playing: boolean; rate: number; sceneDuration: number };

/**
 * Follow the authoritative scene clock. Paused tracks sit at their exact source
 * position; playing tracks correct only noticeable drift to avoid stutter.
 */
export function syncAudioTrackElement(element: AudioTrackElement, track: SceneAudioTrack, state: AudioTrackSyncState, tolerance = .12): 'playing' | 'stopped' {
  const source = audioTrackSourceTime(track, state.time, state.sceneDuration);
  if (element.playbackRate !== state.rate) element.playbackRate = state.rate;
  const seek = (target: number) => { try { element.currentTime = target; } catch { /* metadata not ready yet */ } };
  if (!state.playing || source === null || track.muted) {
    if (!element.paused) element.pause();
    const target = source ?? nextAudibleSource(track, state.time);
    if (target !== null && Math.abs(element.currentTime - target) > 1e-3) seek(target);
    return 'stopped';
  }
  if (Math.abs(element.currentTime - source) > tolerance) seek(source);
  if (element.paused) void element.play().catch(() => {});
  return 'playing';
}
