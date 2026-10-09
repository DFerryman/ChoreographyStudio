import type { CountMap } from '../../../packages/core/src';

export const AUDIO_TIMELINE_FPS = 30;
type MusicSelection = Pick<CountMap, 'durationSeconds' | 'sourceOffsetSeconds'>;
export type TimelineLoopRange = { startSeconds: number; endSeconds: number };

/** Placement changes do not alter the CountMap or its original source segment. */
export function snapAudioOffset(seconds: number, durationSeconds: number): number {
  if (!Number.isFinite(seconds) || !Number.isFinite(durationSeconds) || durationSeconds <= 0) throw new Error('音乐轨位置无效。');
  const limit = Math.max(0, Math.ceil(durationSeconds * AUDIO_TIMELINE_FPS) - 1);
  const frame = Math.max(-limit, Math.min(limit, Math.round(seconds * AUDIO_TIMELINE_FPS)));
  return frame === 0 ? 0 : frame / AUDIO_TIMELINE_FPS;
}

export function audioClipRange(map: MusicSelection, offsetSeconds = 0) {
  const startSeconds = Math.max(0, offsetSeconds);
  const endSeconds = Math.min(map.durationSeconds, map.durationSeconds + offsetSeconds);
  return {
    startSeconds, endSeconds,
    sourceStartSeconds: map.sourceOffsetSeconds + startSeconds - offsetSeconds,
    sourceEndSeconds: map.sourceOffsetSeconds + endSeconds - offsetSeconds,
  };
}

/** null denotes the scene's silent lead-in/tail or its completed endpoint. */
export function audioSourceTime(map: MusicSelection, offsetSeconds: number, sceneTime: number): number | null {
  const clip = audioClipRange(map, offsetSeconds);
  if (sceneTime + 1e-9 < clip.startSeconds || sceneTime >= clip.endSeconds - 1e-9 || sceneTime < 0 || sceneTime >= map.durationSeconds) return null;
  return Math.max(clip.sourceStartSeconds, map.sourceOffsetSeconds + sceneTime - offsetSeconds);
}

export type TimelinePlaybackConfig = MusicSelection & {
  audioOffsetSeconds?: number;
  rate: number;
  loopRange?: TimelineLoopRange | null;
};
export type TimelineAudio = Pick<HTMLAudioElement, 'currentTime' | 'playbackRate' | 'paused' | 'muted' | 'play' | 'pause'>;
export type TimelinePlaybackOptions = {
  getConfig: () => TimelinePlaybackConfig;
  getAudio: () => TimelineAudio | null;
  initialTime?: number;
  onTimeChange: (time: number) => void;
  onPlayingChange: (playing: boolean) => void;
  onError?: (error: unknown) => void;
  beforePlay?: () => Promise<void> | void;
  now: () => number;
  requestFrame: (callback: () => void) => number;
  cancelFrame: (id: number) => void;
  setTimer: (callback: () => void, milliseconds: number) => number;
  clearTimer: (id: number) => void;
};

/** The scene clock is authoritative, including where its music track is silent. */
export function createTimelinePlayback(options: TimelinePlaybackOptions) {
  let position = options.initialTime ?? 0, anchor = options.now(), clockRate = options.getConfig().rate;
  let playing = false, pending: number | null = null, generation = 0;
  let frame: number | null = null, boundaryTimer: number | null = null;
  let mediaIntent = 0, mediaOwner: number | null = null, ownedAudio: TimelineAudio | null = null;
  let lastReported = -Infinity;

  const clampTime = (seconds: number) => Math.max(0, Math.min(options.getConfig().durationSeconds, seconds));
  function sceneTime() {
    if (!playing) return position;
    const config = options.getConfig();
    let next = position + (options.now() - anchor) / 1000 * clockRate;
    const loop = config.loopRange;
    if (loop && loop.endSeconds > loop.startSeconds && (next >= loop.endSeconds || next < loop.startSeconds)) {
      const length = loop.endSeconds - loop.startSeconds;
      next = loop.startSeconds + ((next - loop.startSeconds) % length + length) % length;
    }
    return Math.max(0, Math.min(config.durationSeconds, next));
  }
  function clearBoundary() {
    if (boundaryTimer !== null) options.clearTimer(boundaryTimer);
    boundaryTimer = null;
  }
  function stopAudio() {
    clearBoundary(); mediaIntent += 1; mediaOwner = null;
    if (ownedAudio) { ownedAudio.muted = true; ownedAudio.pause(); }
    const audio = options.getAudio();
    if (audio && audio !== ownedAudio) { audio.muted = true; audio.pause(); }
    ownedAudio = null;
  }
  function setSource(audio: TimelineAudio, source: number) {
    // A new source may not yet have metadata; syncAudio/onLoadedMetadata retries.
    try { audio.currentTime = source; } catch { /* not seekable yet */ }
  }
  function placeAudio(audio: TimelineAudio, time: number, force: boolean) {
    const config = options.getConfig(), offset = config.audioOffsetSeconds ?? 0;
    const source = audioSourceTime(config, offset, time);
    audio.playbackRate = config.rate;
    if (source === null) {
      stopAudio();
      const clip = audioClipRange(config, offset);
      setSource(audio, time < clip.startSeconds ? clip.sourceStartSeconds : clip.sourceEndSeconds);
      return null;
    }
    if (force || Math.abs(audio.currentTime - source) > .08) setSource(audio, source);
    return source;
  }
  function scheduleBoundary(time: number) {
    clearBoundary();
    const config = options.getConfig(), clip = audioClipRange(config, config.audioOffsetSeconds ?? 0);
    const boundary = Math.min(clip.endSeconds, config.loopRange?.endSeconds ?? config.durationSeconds);
    if (boundary <= time || config.rate <= 0) return;
    // The audio is paused at its selected source end even between animation frames.
    boundaryTimer = options.setTimer(() => { boundaryTimer = null; tick(); }, (boundary - time) / config.rate * 1000);
  }
  async function startAudio(audio: TimelineAudio, time: number, force: boolean) {
    if (placeAudio(audio, time, force) === null) return;
    if (ownedAudio === audio && mediaOwner !== null) { scheduleBoundary(time); return; }
    if (ownedAudio && ownedAudio !== audio) stopAudio();
    const owner = ++mediaIntent; mediaOwner = owner; ownedAudio = audio; audio.muted = false;
    try {
      await audio.play();
      if (mediaOwner !== owner || ownedAudio !== audio || (!playing && pending === null)) {
        // A late promise must not pause a newer playback that owns this element.
        if (ownedAudio !== audio || mediaOwner === null) { audio.muted = true; audio.pause(); }
        return;
      }
      scheduleBoundary(sceneTime());
    } catch (error) {
      if (mediaOwner !== owner) return;
      pause(); options.onError?.(error);
      throw error;
    }
  }
  function scheduleFrame() {
    if (frame === null && playing) frame = options.requestFrame(() => { frame = null; tick(); });
  }
  function tick() {
    if (!playing) return;
    const config = options.getConfig(), next = sceneTime();
    if (!config.loopRange && next >= config.durationSeconds) { pause(); seek(config.durationSeconds); return; }
    // Re-anchor after wraps so time stays bounded over arbitrarily long loops.
    const raw = position + (options.now() - anchor) / 1000 * clockRate;
    const wrapped = Math.abs(raw - next) > 1e-8;
    if (wrapped) { position = next; anchor = options.now(); stopAudio(); }
    const audio = options.getAudio();
    if (audio) void startAudio(audio, next, wrapped).catch(() => {});
    if (wrapped || options.now() - lastReported >= 1000 / AUDIO_TIMELINE_FPS) {
      options.onTimeChange(next); lastReported = options.now();
    }
    scheduleFrame();
  }
  function pause() {
    position = sceneTime(); anchor = options.now(); playing = false; pending = null; generation += 1;
    if (frame !== null) options.cancelFrame(frame);
    frame = null; stopAudio(); options.onTimeChange(position); options.onPlayingChange(false);
    return position;
  }
  function seek(seconds: number) {
    if (pending !== null) pause();
    position = clampTime(seconds); anchor = options.now();
    stopAudio();
    const audio = options.getAudio();
    if (audio) {
      placeAudio(audio, position, true);
      if (playing) void startAudio(audio, position, true).catch(() => {});
    }
    options.onTimeChange(position);
    return position;
  }
  async function play(seconds = position) {
    if (playing || pending !== null) return;
    const audio = options.getAudio();
    if (!audio) return;
    const run = ++generation; pending = run;
    position = clampTime(seconds); anchor = options.now();
    try {
      await options.beforePlay?.();
      if (pending !== run) return;
      await startAudio(audio, position, true);
      if (pending !== run) return;
      pending = null; playing = true; anchor = options.now(); clockRate = options.getConfig().rate;
      options.onPlayingChange(true); options.onTimeChange(position); lastReported = options.now();
      scheduleBoundary(position); scheduleFrame();
    } catch (error) { if (pending === run) { pause(); options.onError?.(error); } }
  }
  function refresh() {
    position = sceneTime(); anchor = options.now(); clockRate = options.getConfig().rate;
    const audio = options.getAudio();
    if (!audio) { if (playing || pending !== null) pause(); return; }
    placeAudio(audio, position, true);
    if (playing) void startAudio(audio, position, true).catch(() => {});
  }
  function syncAudio() {
    const audio = options.getAudio();
    if (!audio) return;
    const next = sceneTime();
    placeAudio(audio, next, true);
    if (playing) void startAudio(audio, next, true).catch(() => {});
  }
  function destroy() { pause(); }
  return { play, pause, seek, getTime: sceneTime, isPending: () => pending !== null, isPlaying: () => playing, refresh, syncAudio, destroy };
}
