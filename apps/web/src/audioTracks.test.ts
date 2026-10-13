import { describe, expect, it, vi } from 'vitest';
import { audioSegmentTrimBounds, audioTrackName, audioTrackOffsetBounds, audioTrackSourceTime, fitAudioTracks, pruneAudioClips, removeAudioSegment, snapAudioTrackOffset, splitAudioTrack, syncAudioTrackElement, trimAudioSegment, validateAudioTracks, type SceneAudioTrack } from './audioTracks';

const track = (patch: Partial<SceneAudioTrack> = {}): SceneAudioTrack => ({ id: 'a', name: 'a.wav', offsetSeconds: 2, durationSeconds: 5, ...patch });

describe('additional audio track placement', () => {
  it('keeps at least one frame of every clip inside the scene', () => {
    const clip = { durationSeconds: 5 };
    expect(audioTrackOffsetBounds(clip, 16)).toEqual({ min: -149 / 30, max: 479 / 30 });
    expect(snapAudioTrackOffset(-100, clip, 16)).toBe(-149 / 30);
    expect(snapAudioTrackOffset(100, clip, 16)).toBe(479 / 30);
    expect(snapAudioTrackOffset(1.01, clip, 16)).toBe(1);
    expect(Object.is(snapAudioTrackOffset(-0.001, clip, 16), 0)).toBe(true);
    expect(() => snapAudioTrackOffset(NaN, clip, 16)).toThrow();
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

describe('splitting and trimming added audio tracks', () => {
  it('splits the piece under a scene time at a whole frame and keeps the source timing', () => {
    const split = splitAudioTrack(track(), 3.51)!;
    expect(split.segments).toEqual([{ startSeconds: 0, endSeconds: 1.5 }, { startSeconds: 1.5, endSeconds: 5 }]);
    expect(split.offsetSeconds).toBe(2);
    expect(audioTrackSourceTime(split, 3.5, 16)).toBe(1.5);
    expect(splitAudioTrack(track(), 2)).toBeNull();
    expect(splitAudioTrack(track(), 7)).toBeNull();
    expect(splitAudioTrack(split, 3.5)).toBeNull();
    expect(splitAudioTrack(split, 4)!.segments).toHaveLength(3);
  });

  it('trims edges on whole frames without overlapping pieces, and silences trimmed audio', () => {
    const trimmed = trimAudioSegment(track(), 0, 'start', 1.012, 16)!;
    expect(trimmed.segments).toEqual([{ startSeconds: 1, endSeconds: 5 }]);
    expect(trimmed.offsetSeconds).toBe(2);
    expect(audioTrackSourceTime(trimmed, 2.5, 16)).toBeNull();
    expect(audioTrackSourceTime(trimmed, 3, 16)).toBe(1);
    const ended = trimAudioSegment(trimmed, 0, 'end', 4, 16)!;
    expect(audioTrackSourceTime(ended, 5.99, 16)).toBeCloseTo(3.99);
    expect(audioTrackSourceTime(ended, 6, 16)).toBeNull();
    // Clamped to at least one frame and to the neighbouring piece.
    expect(trimAudioSegment(ended, 0, 'start', 10, 16)!.segments).toEqual([{ startSeconds: 4 - 1 / 30, endSeconds: 4 }]);
    const split = splitAudioTrack(track(), 4)!;
    expect(trimAudioSegment(split, 0, 'end', 4, 16)).toBeNull();
    expect(trimAudioSegment(split, 1, 'start', 0, 16)).toBeNull();
    expect(audioSegmentTrimBounds(split, 1, 'start', 16)).toEqual({ min: 2, max: 5 - 1 / 30 });
    // Extending back to the whole clip stores no segments, exactly like an untouched track.
    expect(trimAudioSegment(trimmed, 0, 'start', -3, 16)).toEqual(track());
    expect(trimAudioSegment(track(), 0, 'end', 9, 16)).toBeNull();
  });

  it('keeps the audible part inside the scene', () => {
    const late = track({ offsetSeconds: 15 });
    expect(audioSegmentTrimBounds(late, 0, 'start', 16)!.max).toBeCloseTo(29 / 30);
    const early = track({ offsetSeconds: -4 });
    expect(audioSegmentTrimBounds(early, 0, 'end', 16)!.min).toBeCloseTo(4 + 1 / 30);
    const trimmed = trimAudioSegment(track(), 0, 'start', 3, 16)!;
    expect(audioTrackOffsetBounds(trimmed, 16)).toEqual({ min: -149 / 30, max: 479 / 30 - 3 });
  });

  it('removes one piece of a split track only when audio remains', () => {
    const split = splitAudioTrack(track(), 4)!;
    expect(removeAudioSegment(split, 0, 16)!.segments).toEqual([{ startSeconds: 2, endSeconds: 5 }]);
    expect(removeAudioSegment(track(), 0, 16)).toBeNull();
  });

  it('validates stored pieces strictly', () => {
    const base = { id: 'a', name: 'a.wav', offsetSeconds: 2, durationSeconds: 5.01 };
    expect(validateAudioTracks([{ ...base, segments: [{ startSeconds: 0, endSeconds: 1 }, { startSeconds: 2, endSeconds: 5.01 }] }], 16)[0].segments).toHaveLength(2);
    for (const segments of [[], [{ startSeconds: 0, endSeconds: 1.01 }], [{ startSeconds: 1, endSeconds: 1 }], [{ startSeconds: 0, endSeconds: 2 }, { startSeconds: 1, endSeconds: 3 }], [{ startSeconds: 0, endSeconds: 6 }], [{ startSeconds: 0, endSeconds: 1, extra: 1 }]])
      expect(() => validateAudioTracks([{ ...base, segments }], 16)).toThrow();
    // The audible part, not the whole clip, must reach into the scene.
    expect(() => validateAudioTracks([{ ...base, offsetSeconds: 15, segments: [{ startSeconds: 2, endSeconds: 3 }] }], 16)).toThrow();
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

  it('stops in trimmed gaps and waits at the next audible piece', () => {
    const gapped = { ...track(), segments: [{ startSeconds: 0, endSeconds: 1 }, { startSeconds: 2, endSeconds: 5 }] };
    const audio = element(.9, false);
    expect(syncAudioTrackElement(audio, gapped, { ...state, time: 3.5 })).toBe('stopped');
    expect(audio.pause).toHaveBeenCalledOnce(); expect(audio.currentTime).toBe(2);
    expect(syncAudioTrackElement(audio, gapped, { ...state, time: 4 })).toBe('playing');
  });
});
