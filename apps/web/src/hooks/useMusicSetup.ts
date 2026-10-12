import { useCallback, useEffect, useRef, useState } from 'react';
import { makeCountMap, type CountMap } from '../../../../packages/core/src';
import { demoAudio } from '../demoAudio';
import { DEMO_AUDIO_NAME } from '../editor/sceneModel';
import { errorMessage } from '../editor/format';
import type { CountCue } from './useCountCue';

export type BeatRelation = 0.5 | 1 | 2;
export type MusicDraft = {
  blob: Blob | null; name: string; duration: number; title: string;
  bpm: number; relation: BeatRelation; first: number; start: number; octets: number;
};
export type MusicDraftField = Exclude<keyof MusicDraft, 'blob' | 'name' | 'duration'>;

const MAX_AUDIO_BYTES = 100 * 1024 * 1024;
const demoDraft = (): Omit<MusicDraft, 'title'> => ({ blob: demoAudio(), name: DEMO_AUDIO_NAME, duration: 40, bpm: 120, relation: 1, first: 0, start: 1, octets: 8 });

/**
 * Music and CountMap setup for the current scene. Reads, decodes and audition
 * playback are owned operations: closing, replacing or unmounting invalidates
 * them so late results can never reopen or change the dialog.
 */
export function useMusicSetup(cue: CountCue) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<MusicDraft>(() => ({ ...demoDraft(), blob: null, name: '', title: '' }));
  const [error, setError] = useState('');
  const [decoding, setDecoding] = useState(false);
  const [auditionCount, setAuditionCount] = useState(0);
  const readToken = useRef(0);
  const decodingContext = useRef<AudioContext | null>(null);
  const audition = useRef<{ audio: HTMLAudioElement; url: string; frame: number } | null>(null);

  const stopAudition = useCallback(() => {
    const run = audition.current; audition.current = null;
    if (run) { run.audio.pause(); cancelAnimationFrame(run.frame); URL.revokeObjectURL(run.url); }
    setAuditionCount(0);
  }, []);
  const cancelRead = useCallback(() => {
    readToken.current += 1;
    const context = decodingContext.current; decodingContext.current = null;
    if (context && context.state !== 'closed') void context.close().catch(() => {});
    setDecoding(false);
  }, []);
  useEffect(() => () => { cancelRead(); stopAudition(); }, [cancelRead, stopAudition]);

  let map: CountMap | null = null, mapError = '';
  try { map = makeCountMap({ bpm: draft.bpm, musicBeatsPerDanceCount: draft.relation, firstCountSourceSeconds: draft.first, startOctet: draft.start - 1, octetCount: draft.octets, audioDurationSeconds: draft.duration }); }
  catch (reason) { mapError = errorMessage(reason); }

  /** Reopening restores the confirmed CountMap, including a nonzero start phrase. */
  function show(current: { blob: Blob | null; name: string; duration: number; title: string; countMap: CountMap }) {
    cancelRead(); stopAudition();
    const { countMap } = current;
    const octetSeconds = 60 / countMap.bpm * countMap.musicBeatsPerDanceCount * 8;
    const startOctet = Math.round((countMap.sourceOffsetSeconds - countMap.firstCountSourceSeconds) / octetSeconds);
    setDraft({ blob: current.blob, name: current.name, duration: current.duration, title: current.title, bpm: countMap.bpm, relation: countMap.musicBeatsPerDanceCount, first: countMap.firstCountSourceSeconds, start: startOctet + 1, octets: countMap.octetCount });
    setError(''); setOpen(true);
  }
  const close = useCallback(() => { cancelRead(); stopAudition(); setOpen(false); }, [cancelRead, stopAudition]);
  function update<K extends MusicDraftField>(field: K, value: MusicDraft[K]) {
    if (field !== 'title') stopAudition();
    setDraft(previous => ({ ...previous, [field]: value }));
  }
  function applyDemo() {
    cancelRead(); stopAudition();
    setDraft(previous => ({ ...demoDraft(), title: previous.title })); setError('');
  }
  async function chooseAudio(file: File | undefined) {
    if (!file) return;
    cancelRead(); stopAudition();
    if (file.size > MAX_AUDIO_BYTES) { setError('请选择小于 100 MB 的音频。'); return; }
    const token = readToken.current;
    setDecoding(true); setError('');
    let context: AudioContext | null = null;
    try {
      context = new AudioContext(); decodingContext.current = context;
      const bytes = await file.arrayBuffer();
      if (token !== readToken.current) return;
      const decoded = await context.decodeAudioData(bytes);
      if (token !== readToken.current) return;
      if (!Number.isFinite(decoded.duration)) throw new Error('音频时长无效。');
      if (decoded.duration > 600) throw new Error('请选择不超过 10 分钟的音频。');
      if (decoded.duration < 16) throw new Error('音乐至少需要 16 秒，才能选择完整的八拍组合。');
      setDraft(previous => ({ ...previous, blob: file, name: file.name, duration: decoded.duration, first: 0, start: 1 }));
    } catch (reason) {
      if (token === readToken.current) setError(reason instanceof Error && /请选择|音乐至少/.test(reason.message) ? reason.message : '音频无法解码，请换用 MP3、WAV 或浏览器支持的音频文件。');
    } finally {
      if (context && context.state !== 'closed') { try { await context.close(); } catch { /* An invalidated read may already have closed its context. */ } }
      if (token === readToken.current) { decodingContext.current = null; setDecoding(false); }
    }
  }
  /** Play the first eight counts of the selection with count clicks. */
  async function startAudition() {
    stopAudition(); if (!draft.blob || !map) return;
    const url = URL.createObjectURL(draft.blob), audio = new Audio(url);
    const run = { audio, url, frame: 0 }; audition.current = run;
    const offset = map.sourceOffsetSeconds, interval = 60 / draft.bpm * draft.relation;
    audio.currentTime = offset;
    try {
      await cue.prepare();
      if (audition.current !== run) return;
      await audio.play();
      if (audition.current !== run) { audio.pause(); return; }
      let previous = -1;
      const tick = () => {
        if (audition.current !== run) return;
        const index = Math.floor(Math.max(0, audio.currentTime - offset) / interval);
        if (index >= 8) { stopAudition(); return; }
        if (index !== previous) { previous = index; setAuditionCount(index + 1); cue.beep(); }
        run.frame = requestAnimationFrame(tick);
      };
      run.frame = requestAnimationFrame(tick);
    } catch { if (audition.current === run) { stopAudition(); setError('试听未启动，请再试一次。'); } }
  }
  const toggleAudition = () => { if (auditionCount) stopAudition(); else void startAudition(); };

  return { open, draft, map, mapError, error, decoding, auditionCount, show, close, update, applyDemo, chooseAudio, toggleAudition, stopAudition };
}

export type MusicSetup = ReturnType<typeof useMusicSetup>;
