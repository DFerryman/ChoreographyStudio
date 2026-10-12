import { useEffect, useRef, useState } from 'react';
import { syncAudioTrackElement, type SceneAudioClip, type SceneAudioTrack } from './audioTracks';
import { extractAudioWaveform } from './useAudioWaveform';

type Options = {
  clips: readonly SceneAudioClip[];
  tracks: readonly SceneAudioTrack[];
  time: number;
  playing: boolean;
  rate: number;
  sceneDuration: number;
  /** The live scene clock; React time updates trail it slightly during playback. */
  getTime: () => number;
};
type Owned = { blob: Blob; url: string; element: HTMLAudioElement };

function release(owned: Owned) {
  owned.element.pause(); owned.element.removeAttribute('src'); owned.element.load();
  URL.revokeObjectURL(owned.url);
}

/**
 * Plays every additional audio track alongside the primary music, following
 * the scene clock. Elements are owned here and released with their clips.
 */
export function useAudioTrackMixer({ clips, tracks, time, playing, rate, sceneDuration, getTime }: Options) {
  const owned = useRef(new Map<string, Owned>());
  useEffect(() => {
    const live = new Set<string>();
    for (const clip of clips) {
      live.add(clip.id);
      const current = owned.current.get(clip.id);
      if (current?.blob === clip.blob) continue;
      if (current) release(current);
      const url = URL.createObjectURL(clip.blob), element = new Audio();
      element.preload = 'auto'; element.src = url;
      owned.current.set(clip.id, { blob: clip.blob, url, element });
    }
    for (const [id, current] of owned.current) if (!live.has(id)) { release(current); owned.current.delete(id); }
  }, [clips]);
  useEffect(() => () => { for (const current of owned.current.values()) release(current); owned.current.clear(); }, []);
  useEffect(() => {
    const at = playing ? getTime() : time, active = new Set<string>();
    for (const track of tracks) {
      const current = owned.current.get(track.id);
      if (!current) continue;
      active.add(track.id);
      syncAudioTrackElement(current.element, track, { time: at, playing, rate, sceneDuration });
    }
    // Tracks removed from the current snapshot (undo, delete) fall silent.
    for (const [id, current] of owned.current) if (!active.has(id) && !current.element.paused) current.element.pause();
  }, [tracks, time, playing, rate, sceneDuration, clips]);
}

const waveformCache = new WeakMap<Blob, number[]>();

/** Display-only waveforms for whole clips; decode failures leave a plain clip. */
export function useAudioClipWaveforms(clips: readonly SceneAudioClip[]): Record<string, number[]> {
  const [waveforms, setWaveforms] = useState<Record<string, number[]>>({});
  useEffect(() => {
    let cancelled = false;
    const known = Object.fromEntries(clips.flatMap(clip => waveformCache.has(clip.blob) ? [[clip.id, waveformCache.get(clip.blob)!]] : []));
    setWaveforms(known);
    const pending = clips.filter(clip => !waveformCache.has(clip.blob));
    if (!pending.length) return;
    void (async () => {
      for (const clip of pending) {
        let context: AudioContext | null = null;
        try {
          const bytes = await clip.blob.arrayBuffer();
          if (cancelled) return;
          context = new AudioContext();
          const buffer = await context.decodeAudioData(bytes);
          const values = extractAudioWaveform(buffer, 0, buffer.duration);
          waveformCache.set(clip.blob, values);
          if (!cancelled) setWaveforms(previous => ({ ...previous, [clip.id]: values }));
        } catch { waveformCache.set(clip.blob, []); }
        finally { if (context && context.state !== 'closed') void context.close().catch(() => {}); }
      }
    })();
    return () => { cancelled = true; };
  }, [clips]);
  return waveforms;
}
