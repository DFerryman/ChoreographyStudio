import { describe, expect, it } from 'vitest';
import { extractAudioWaveform } from './useAudioWaveform';

const buffer = (...channels: number[][]) => ({ length: channels[0].length, sampleRate: 4, numberOfChannels: channels.length, getChannelData: (index: number) => Float32Array.from(channels[index]) });

describe('source-backed local music waveform', () => {
  it('reads only the selected original samples and retains their relative amplitudes', () => {
    const audio = buffer([1, 1, 1, 1, .25, .25, .5, .5, 1, 1, 1, 1]);
    expect(extractAudioWaveform(audio, 1, 1, 2)).toEqual([.5, 1]);
  });
  it('shows signal on either channel without treating opposite channel phase as silence', () => {
    const audio = buffer([0, 0, .5, -.5], [1, -1, -.5, .5]);
    const values = extractAudioWaveform(audio, 0, 1, 2);
    expect(values[0]).toBe(1);
    expect(values[1]).toBeGreaterThan(.5);
    expect(values[1]).toBeLessThan(1);
  });
  it('keeps a silent source silent and refuses a selection beyond the decoded original music', () => {
    const audio = buffer([0, 0, 0, 0]);
    expect(extractAudioWaveform(audio, 0, 1, 4)).toEqual([0, 0, 0, 0]);
    expect(extractAudioWaveform(audio, .5, 1, 4)).toEqual([]);
    expect(extractAudioWaveform(audio, -1, 1)).toEqual([]);
  });
});
