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
} as const;

export type SceneAudioTrack = {
  /** Identifies the clip bytes in SceneDocument.audioClips. */
  id: string;
  name: string;
  /** Scene time at which the clip's first sample plays; whole 30 fps frames. */
  offsetSeconds: number;
  /** Decoded duration of the complete, unchanged clip. */
  durationSeconds: number;
  muted?: boolean;
};
export type SceneAudioClip = { id: string; blob: Blob };

const frames = (seconds: number) => Math.ceil(seconds * AUDIO_TRACK_FPS - 1e-9);

/** At least one frame of the clip always overlaps the scene. */
export function audioTrackOffsetBounds(trackDuration: number, sceneDuration: number) {
  return { min: -Math.max(0, frames(trackDuration) - 1) / AUDIO_TRACK_FPS, max: Math.max(0, frames(sceneDuration) - 1) / AUDIO_TRACK_FPS };
}

export function snapAudioTrackOffset(seconds: number, trackDuration: number, sceneDuration: number): number {
  if (!Number.isFinite(seconds) || !Number.isFinite(trackDuration) || trackDuration <= 0 || !Number.isFinite(sceneDuration) || sceneDuration <= 0) throw new Error('音轨位置无效。');
  const { min, max } = audioTrackOffsetBounds(trackDuration, sceneDuration);
  const frame = Math.max(Math.round(min * AUDIO_TRACK_FPS), Math.min(Math.round(max * AUDIO_TRACK_FPS), Math.round(seconds * AUDIO_TRACK_FPS)));
  return frame === 0 ? 0 : frame / AUDIO_TRACK_FPS;
}

/** Source position for a scene time, or null where this track is silent. */
export function audioTrackSourceTime(track: Pick<SceneAudioTrack, 'offsetSeconds' | 'durationSeconds'>, sceneTime: number, sceneDuration: number): number | null {
  if (!Number.isFinite(sceneTime) || sceneTime < 0 || sceneTime >= sceneDuration) return null;
  const source = sceneTime - track.offsetSeconds;
  return source >= 0 && source < track.durationSeconds - 1e-6 ? source : null;
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
    const allowed = ['id', 'name', 'offsetSeconds', 'durationSeconds', 'muted'];
    if (['id', 'name', 'offsetSeconds', 'durationSeconds'].some(key => !own(track, key)) || Object.keys(track).some(key => !allowed.includes(key))) throw new Error('音轨字段不完整或不受支持。');
    const { id, name, offsetSeconds, durationSeconds, muted } = track;
    if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(id) || ids.has(id)) throw new Error('音轨 ID 无效或重复。');
    ids.add(id);
    if (typeof name !== 'string' || !name.trim() || name.length > AUDIO_TRACK_LIMITS.nameLength || /[\u0000-\u001f\u007f]/.test(name)) throw new Error('音轨名称无效。');
    if (typeof durationSeconds !== 'number' || !Number.isFinite(durationSeconds) || durationSeconds < AUDIO_TRACK_LIMITS.minDurationSeconds || durationSeconds > AUDIO_TRACK_LIMITS.maxDurationSeconds) throw new Error('音轨时长超出范围。');
    if (typeof offsetSeconds !== 'number' || !Number.isFinite(offsetSeconds) || Math.abs(offsetSeconds * AUDIO_TRACK_FPS - Math.round(offsetSeconds * AUDIO_TRACK_FPS)) > 1e-9) throw new Error('音轨位置必须对齐 30 fps 整帧。');
    const { min, max } = audioTrackOffsetBounds(durationSeconds, sceneDuration);
    if (offsetSeconds < min - 1e-9 || offsetSeconds > max + 1e-9) throw new Error('音轨必须至少有一帧位于场景内。');
    if (muted !== undefined && typeof muted !== 'boolean') throw new Error('音轨静音设置无效。');
    return { id, name, offsetSeconds, durationSeconds, ...(muted ? { muted: true } : {}) };
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
    const { min, max } = audioTrackOffsetBounds(track.durationSeconds, sceneDuration);
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
    const target = source ?? (state.time - track.offsetSeconds < 0 ? 0 : null);
    if (target !== null && Math.abs(element.currentTime - target) > 1e-3) seek(target);
    return 'stopped';
  }
  if (Math.abs(element.currentTime - source) > tolerance) seek(source);
  if (element.paused) void element.play().catch(() => {});
  return 'playing';
}
