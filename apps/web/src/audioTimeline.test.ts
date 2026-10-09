import { describe, expect, it, vi } from 'vitest';
import { audioClipRange, audioSourceTime, createTimelinePlayback, snapAudioOffset, type TimelinePlaybackConfig } from './audioTimeline';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}
async function settle() { for (let index = 0; index < 6; index += 1) await Promise.resolve(); }
function fixture(offset = 0) {
  let now = 0, nextId = 0;
  const frames = new Map<number, () => void>(), timers = new Map<number, { callback: () => void; at: number }>();
  const config: TimelinePlaybackConfig = { durationSeconds: 20, sourceOffsetSeconds: 10, audioOffsetSeconds: offset, rate: 1 };
  const audio = {
    currentTime: 0, playbackRate: 1, paused: true, muted: false,
    play: vi.fn(async () => { audio.paused = false; }),
    pause: vi.fn(() => { audio.paused = true; }),
  };
  const onTimeChange = vi.fn(), onPlayingChange = vi.fn(), onError = vi.fn();
  const beforePlay = vi.fn((): Promise<void> | void => {});
  const controller = createTimelinePlayback({
    getConfig: () => config, getAudio: () => audio,
    onTimeChange, onPlayingChange, onError, beforePlay,
    now: () => now,
    requestFrame: callback => { const id = ++nextId; frames.set(id, callback); return id; },
    cancelFrame: id => { frames.delete(id); },
    setTimer: (callback, milliseconds) => { const id = ++nextId; timers.set(id, { callback, at: now + milliseconds }); return id; },
    clearTimer: id => { timers.delete(id); },
  });
  async function advance(seconds: number, runFrames = true) {
    now += seconds * 1000;
    const due = [...timers.entries()].filter(([, timer]) => timer.at <= now);
    due.forEach(([id, timer]) => { if (timers.delete(id)) timer.callback(); });
    if (runFrames) {
      const scheduled = [...frames.entries()];
      scheduled.forEach(([id, callback]) => { if (frames.delete(id)) callback(); });
    }
    await settle();
  }
  return { controller, config, audio, onTimeChange, onPlayingChange, onError, beforePlay, advance, frames, timers };
}

describe('audio track placement', () => {
  it('snaps to 30 fps and retains at least a fraction of a frame inside a nonuniform duration', () => {
    expect(snapAudioOffset(1.018, 20)).toBe(31 / 30);
    expect(snapAudioOffset(-1.018, 20)).toBe(-31 / 30);
    expect(snapAudioOffset(20, 20)).toBe(599 / 30);
    expect(snapAudioOffset(-20, 20)).toBe(-599 / 30);
    const limit = snapAudioOffset(100, 20.017);
    expect(limit).toBe(20);
    expect(limit).toBeLessThan(20.017);
    expect(() => snapAudioOffset(NaN, 20)).toThrow();
  });
  it('clips placement to the scene and maps only into the unchanged original selected segment', () => {
    const map = { durationSeconds: 20, sourceOffsetSeconds: 10 };
    expect(audioClipRange(map, 3)).toEqual({ startSeconds: 3, endSeconds: 20, sourceStartSeconds: 10, sourceEndSeconds: 27 });
    expect(audioClipRange(map, -3)).toEqual({ startSeconds: 0, endSeconds: 17, sourceStartSeconds: 13, sourceEndSeconds: 30 });
    expect(audioSourceTime(map, 3, 2)).toBeNull();
    expect(audioSourceTime(map, 3, 3)).toBe(10);
    expect(audioSourceTime(map, -3, 0)).toBe(13);
    expect(audioSourceTime(map, -3, 17)).toBeNull();
    expect(audioSourceTime(map, 0, 20)).toBeNull();
  });
});

describe('independent scene playback clock', () => {
  it('advances through a positive shift lead-in and plays from the selected source start only', async () => {
    const f = fixture(2);
    await f.controller.play(0);
    expect(f.controller.isPlaying()).toBe(true);
    expect(f.audio.play).not.toHaveBeenCalled();
    expect(f.audio.muted).toBe(true);
    expect(f.audio.currentTime).toBe(10);
    await f.advance(1);
    expect(f.controller.getTime()).toBe(1);
    expect(f.audio.play).not.toHaveBeenCalled();
    await f.advance(1.1);
    expect(f.audio.play).toHaveBeenCalledOnce();
    expect(f.audio.currentTime).toBeCloseTo(10.1);
    expect(f.audio.muted).toBe(false);
    expect(f.controller.pause()).toBeCloseTo(2.1);
    await f.advance(3);
    expect(f.controller.getTime()).toBeCloseTo(2.1);
    expect(f.audio.paused).toBe(true);
  });
  it('stops the negative-shift selected audio at its source end and advances through the silent tail', async () => {
    const f = fixture(-3);
    await f.controller.play();
    expect(f.audio.currentTime).toBe(13);
    await f.advance(17.001, false);
    expect(f.audio.currentTime).toBe(30);
    expect(f.audio.paused).toBe(true);
    expect(f.audio.muted).toBe(true);
    expect(f.controller.isPlaying()).toBe(true);
    expect(f.controller.getTime()).toBeCloseTo(17.001);
    await f.advance(2.999);
    expect(f.controller.getTime()).toBe(20);
    expect(f.controller.isPlaying()).toBe(false);
    expect(f.audio.play).toHaveBeenCalledOnce();
  });
  it('seeks both playing and stopped clocks without playing outside the selected source', async () => {
    const f = fixture(2);
    f.controller.seek(8);
    expect(f.audio.currentTime).toBe(16);
    expect(f.audio.play).not.toHaveBeenCalled();
    await f.controller.play(8);
    await f.advance(1);
    expect(f.controller.getTime()).toBe(9);
    f.controller.seek(1);
    expect(f.audio.paused).toBe(true);
    expect(f.audio.muted).toBe(true);
    await f.advance(1);
    expect(f.audio.currentTime).toBe(10);
    expect(f.audio.paused).toBe(false);
    expect(f.controller.getTime()).toBe(2);
  });
  it('wraps a loop across a silent lead-in and keeps the music clip unchanged', async () => {
    const f = fixture(2);
    f.config.loopRange = { startSeconds: 1, endSeconds: 5 };
    await f.controller.play(1);
    await f.advance(2);
    expect(f.audio.currentTime).toBe(11);
    await f.advance(2.3);
    expect(f.controller.getTime()).toBeCloseTo(1.3);
    expect(f.audio.paused).toBe(true);
    await f.advance(.7);
    expect(f.controller.getTime()).toBeCloseTo(2);
    expect(f.audio.currentTime).toBeCloseTo(10);
    expect(f.audio.play).toHaveBeenCalledTimes(2);
  });
  it('changes rate without jumping the scene clock and stops at the scene boundary', async () => {
    const f = fixture(3);
    await f.controller.play();
    await f.advance(2);
    f.config.rate = .5; f.controller.refresh();
    expect(f.controller.getTime()).toBe(2);
    await f.advance(4);
    expect(f.controller.getTime()).toBe(4);
    expect(f.audio.currentTime).toBe(11);
    expect(f.audio.playbackRate).toBe(.5);
    await f.advance(32);
    expect(f.controller.getTime()).toBe(20);
    expect(f.audio.paused).toBe(true);
    expect(f.audio.muted).toBe(true);
  });
  it('cancels a late audio-context resume before audio.play or the scene clock can start', async () => {
    const f = fixture(), resume = deferred();
    f.beforePlay.mockReturnValueOnce(resume.promise);
    const play = f.controller.play();
    expect(f.controller.isPending()).toBe(true);
    f.controller.pause(); resume.resolve(); await play;
    expect(f.audio.play).not.toHaveBeenCalled();
    expect(f.controller.isPlaying()).toBe(false);
    expect(f.frames.size).toBe(0);
  });
  it('cancels a late audio.play resolution and retains the paused scene', async () => {
    const f = fixture(), ready = deferred();
    f.audio.play.mockImplementationOnce(() => ready.promise);
    const play = f.controller.play(4); await settle();
    f.controller.pause(); ready.resolve(); await play;
    expect(f.controller.isPlaying()).toBe(false);
    expect(f.controller.getTime()).toBe(4);
    expect(f.audio.paused).toBe(true);
    expect(f.audio.muted).toBe(true);
    expect(f.onPlayingChange).not.toHaveBeenCalledWith(true);
  });
  it('does not let an obsolete play promise pause newer playback on the same element', async () => {
    const f = fixture(), first = deferred(), second = deferred();
    f.audio.play.mockImplementationOnce(() => first.promise).mockImplementationOnce(() => second.promise);
    const old = f.controller.play(1); await settle();
    f.controller.pause();
    const current = f.controller.play(3); await settle();
    const pausedCalls = f.audio.pause.mock.calls.length;
    first.resolve(); await old;
    expect(f.audio.pause.mock.calls.length).toBe(pausedCalls);
    second.resolve(); await current;
    expect(f.controller.isPlaying()).toBe(true);
    expect(f.controller.getTime()).toBe(3);
  });
  it('reports a blocked play once and leaves no clock or timers running', async () => {
    const f = fixture();
    f.audio.play.mockRejectedValueOnce(new Error('blocked'));
    await f.controller.play();
    expect(f.onError).toHaveBeenCalledOnce();
    expect(f.controller.isPlaying()).toBe(false);
    expect(f.controller.isPending()).toBe(false);
    expect(f.frames.size).toBe(0);
    expect(f.timers.size).toBe(0);
  });
});
