import { useCallback, useEffect, useMemo, useRef } from 'react';

export type CountCue = {
  /** Create and resume the cue context inside a user gesture. */
  prepare: () => Promise<void>;
  /** A short count click; silent until prepare() has succeeded. */
  beep: () => void;
};

/** One shared AudioContext for count clicks during playback and music audition. */
export function useCountCue(): CountCue {
  const context = useRef<AudioContext | null>(null);
  useEffect(() => () => { void context.current?.close(); }, []);
  const prepare = useCallback(async () => {
    if (!context.current) context.current = new AudioContext();
    await context.current.resume();
  }, []);
  const beep = useCallback(() => {
    const audio = context.current;
    if (!audio || audio.state !== 'running') return;
    const oscillator = audio.createOscillator(), gain = audio.createGain();
    oscillator.frequency.value = 880; gain.gain.setValueAtTime(0.045, audio.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + 0.06);
    oscillator.connect(gain); gain.connect(audio.destination);
    oscillator.start(); oscillator.stop(audio.currentTime + 0.07);
  }, []);
  return useMemo(() => ({ prepare, beep }), [prepare, beep]);
}
