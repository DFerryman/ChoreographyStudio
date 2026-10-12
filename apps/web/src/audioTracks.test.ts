import { describe, expect, it, vi } from 'vitest';
import { audioTrackName, audioTrackOffsetBounds, audioTrackSourceTime, fitAudioTracks, pruneAudioClips, snapAudioTrackOffset, syncAudioTrackElement, type SceneAudioTrack } from './audioTracks';

const track = (patch: Partial<SceneAudioTrack> = {}): SceneAudioTrack => ({ id: 'a', name: 'a.wav', offsetSeconds: 2, durationSeconds: 5, ...patch });

describe('additional audio track placement', () => {
  it('keeps at least one frame of every clip inside the scene', () => {
    expect(audioTrackOffsetBounds(5, 16)).toEqual({ min: -149 / 30, max: 479 / 30 });
    expect(snapAudioTrackOffset(-100, 5, 16)).toBe(-149 / 30);
    expect(snapAudioTrackOffset(100, 5, 16)).toBe(479 / 30);
    expect(snapAudioTrackOffset(1.01, 5, 16)).toBe(1);
    expect(Object.is(snapAudioTrackOffset(-0.001, 5, 16), 0)).toBe(true);
    expect(() => snapAudioTrackOffset(NaN, 5, 16)).toThrow();
  });

  it('maps scene time to the clip source and is silent outside the clip or scene', () => {
    expect(audioTrackSourceTime(track(), 1.9, 16)).toBeNull();
    expect(audioTrackSourceTime(track(), 2, 16)).toBe(0);
    expect(audioTrackSourceTime(track(), 4.5, 16)).toBe(2.5);
    expect(audioTrackSourceTime(track(), 7, 16)).toBeNull();
    expect(audioTrackSourceTime(track({ offsetSeconds: -1 }), 0, 16)).toBe(1);
    expect(audioTrackSourceTime(track({ offsetSeconds: 14 }), 16, 16)).toBeNull();
  });

  it('cleans file names and keeps only tracks that still fit a new duration', () => {
    expect(audioTrackName('  beat\u0000.mp3 ')).toBe('beat.mp3');
    expect(audioTrackName('\u0001')).toBe('音轨');
    expect(fitAudioTracks([track({ offsetSeconds: 2 }), track({ id: 'b', offsetSeconds: 20 })], 16).map(item => item.id)).toEqual(['a']);
  });

  it('keeps clip bytes referenced by any history entry so undo and redo still play', () => {
    const blob = new Blob(['x']);
    const project = { history: [{ audioTracks: [track()] }, {}] };
    expect(pruneAudioClips([{ id: 'a', blob }, { id: 'b', blob }], project).map(clip => clip.id)).toEqual(['a']);
  });
});

describe('audio track element sync', () => {
  function element(currentTime = 0, paused = true) {
    const audio = { currentTime, playbackRate: 1, paused, play: vi.fn(() => { audio.paused = false; return Promise.resolve(); }), pause: vi.fn(() => { audio.paused = true; }) };
    return audio;
  }
  const state = { time: 3, playing: true, rate: .5, sceneDuration: 16 };

  it('starts at the exact source position with the shared rate', () => {
    const audio = element();
    expect(syncAudioTrackElement(audio, track(), state)).toBe('playing');
    expect(audio.currentTime).toBe(1); expect(audio.playbackRate).toBe(.5); expect(audio.play).toHaveBeenCalledOnce();
  });

  it('corrects only noticeable drift while playing', () => {
    const audio = element(1.05, false);
    syncAudioTrackElement(audio, track(), state);
    expect(audio.currentTime).toBe(1.05); expect(audio.play).not.toHaveBeenCalled();
    audio.currentTime = 1.5; syncAudioTrackElement(audio, track(), state);
    expect(audio.currentTime).toBe(1);
  });

  it('pauses when muted, paused or outside the clip', () => {
    for (const [patch, next] of [[{ muted: true }, state], [{}, { ...state, playing: false }], [{}, { ...state, time: 10 }]] as const) {
      const audio = element(0, false);
      expect(syncAudioTrackElement(audio, track(patch), next)).toBe('stopped');
      expect(audio.pause).toHaveBeenCalledOnce();
    }
    const before = element(3, true);
    syncAudioTrackElement(before, track(), { ...state, time: 1 });
    expect(before.currentTime).toBe(0);
  });
});
