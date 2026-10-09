import { useEffect, useRef, type RefObject } from 'react';
import type { CountMap } from '../../../packages/core/src';
import { createTimelinePlayback, type TimelineLoopRange } from './audioTimeline';

type Options = {
  restoreKey?: string;
  audioRef: RefObject<HTMLAudioElement | null>;
  countMap: CountMap;
  audioOffsetSeconds?: number;
  rate: number;
  loopRange?: TimelineLoopRange | null;
  time: number;
  onTimeChange: (time: number) => void;
  onPlayingChange: (playing: boolean) => void;
  onError?: (error: unknown) => void;
  beforePlay?: () => Promise<void> | void;
};

/** Call seek for user positioning; time changes from this hook do not seek again. */
export function useTimelinePlayback(options: Options) {
  const latest = useRef(options);
  latest.current = options;
  const playback = useRef<ReturnType<typeof createTimelinePlayback> | null>(null);
  if (!playback.current) playback.current = createTimelinePlayback({
    getConfig: () => ({ ...latest.current.countMap, audioOffsetSeconds: latest.current.audioOffsetSeconds, rate: latest.current.rate, loopRange: latest.current.loopRange }),
    getAudio: () => latest.current.audioRef.current,
    initialTime: options.time,
    onTimeChange: time => latest.current.onTimeChange(time),
    onPlayingChange: playing => latest.current.onPlayingChange(playing),
    onError: error => latest.current.onError?.(error),
    beforePlay: () => latest.current.beforePlay?.(),
    now: () => performance.now(),
    requestFrame: callback => requestAnimationFrame(callback),
    cancelFrame: id => cancelAnimationFrame(id),
    setTimer: (callback, milliseconds) => window.setTimeout(callback, milliseconds),
    clearTimer: id => window.clearTimeout(id),
  });
  const controller = playback.current;
  useEffect(() => { controller.refresh(); }, [controller, options.countMap, options.audioOffsetSeconds, options.rate, options.loopRange?.startSeconds, options.loopRange?.endSeconds]);
  useEffect(() => {
    // Scene restore/history can set time directly while stopped.
    if (!controller.isPlaying() && !controller.isPending()) controller.seek(options.time);
  }, [controller, options.time, options.countMap, options.restoreKey]);
  useEffect(() => {
    const sync = () => { if (!document.hidden) controller.syncAudio(); };
    document.addEventListener('visibilitychange', sync);
    return () => { document.removeEventListener('visibilitychange', sync); controller.destroy(); };
  }, [controller]);
  return controller;
}
