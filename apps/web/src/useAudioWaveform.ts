import { useEffect, useRef, useState } from 'react';
import type { CountMap } from '../../../packages/core/src';

type WaveformBuffer = Pick<AudioBuffer, 'length' | 'sampleRate' | 'numberOfChannels' | 'getChannelData'>;
const WAVEFORM_BINS = 160;

/** Summarize actual samples from the unchanged source selection, including all channels. */
export function extractAudioWaveform(buffer: WaveformBuffer, sourceOffsetSeconds: number, durationSeconds: number, bins = WAVEFORM_BINS): number[] {
  if (!Number.isFinite(sourceOffsetSeconds) || sourceOffsetSeconds < 0 || !Number.isFinite(durationSeconds) || durationSeconds <= 0
    || !Number.isFinite(buffer.sampleRate) || buffer.sampleRate <= 0 || buffer.numberOfChannels < 1 || !Number.isInteger(bins) || bins < 1 || bins > 1000) return [];
  const first = Math.round(sourceOffsetSeconds * buffer.sampleRate);
  const last = Math.min(buffer.length, Math.round((sourceOffsetSeconds + durationSeconds) * buffer.sampleRate));
  if (first >= last || (sourceOffsetSeconds + durationSeconds) * buffer.sampleRate > buffer.length + 1) return [];
  const channels = Array.from({ length: buffer.numberOfChannels }, (_, index) => buffer.getChannelData(index));
  const amplitudes = Array.from({ length: bins }, (_, bin) => {
    const start = first + Math.floor((last - first) * bin / bins);
    const end = Math.min(last, Math.max(start + 1, first + Math.floor((last - first) * (bin + 1) / bins)));
    let energy = 0, peak = 0, samples = 0;
    for (const channel of channels) for (let index = start; index < end; index += 1) {
      const value = Number.isFinite(channel[index]) ? channel[index] : 0;
      energy += value * value; peak = Math.max(peak, Math.abs(value)); samples += 1;
    }
    return samples ? .7 * Math.sqrt(energy / samples) + .3 * peak : 0;
  });
  const maximum = Math.max(...amplitudes);
  return maximum > 0 ? amplitudes.map(value => value / maximum) : amplitudes;
}

/** Decode locally for display; waveform errors never change playback or project data. */
export function useAudioWaveform(audioBlob: Blob | null, countMap: CountMap): number[] {
  const [waveform, setWaveform] = useState<number[]>([]);
  const generation = useRef(0);
  useEffect(() => {
    const run = ++generation.current;
    let context: AudioContext | null = null;
    const current = () => generation.current === run;
    const close = () => {
      if (context && context.state !== 'closed') void context.close().catch(() => {});
    };
    setWaveform([]);
    if (!audioBlob || audioBlob.size > 100 * 1024 * 1024) return;
    void (async () => {
      try {
        const bytes = await audioBlob.arrayBuffer();
        if (!current()) return;
        context = new AudioContext();
        const buffer = await context.decodeAudioData(bytes);
        if (!current() || buffer.duration > 600) return;
        const values = extractAudioWaveform(buffer, countMap.sourceOffsetSeconds, countMap.durationSeconds);
        if (current()) setWaveform(values);
      } catch { if (current()) setWaveform([]); }
      finally { close(); }
    })();
    return () => { generation.current += 1; close(); };
  }, [audioBlob, countMap.sourceOffsetSeconds, countMap.durationSeconds]);
  return waveform;
}
