import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { AlertTriangle, CheckCircle2, LoaderCircle, Save, X } from 'lucide-react';
import {
  cloneCameraPose, countAt, createCameraTrackSampler, frameAtTime, frameTime, getKeyframeCount, JOINT_NAMES, lastFrame, sampleTake,
  makeCameraTrack, moveCameraKeyframe, removeCameraKeyframe, sameCameraPose, upsertCameraKeyframe, validateCameraPose, validateCameraTrack,
  type CameraPose, type CameraTrack, type SampledCameraPose,
} from '../../../packages/core/src';
import { analyzeAIMotionPatch, appendAIMotionPatch, compileAIMotionPatch, createAIMotionSampler, type AIMotionQuality, type AIMotionTrack } from '../../../packages/core/src/aiMotionTrack';
import type { AIMotionTarget } from '../../../packages/core/src/aiMotion';
import { Stage, type StageCamera, type StageCameraFocus, type StageView } from './Stage';
import { DEFAULT_AVATAR, isAvatarId, type AvatarId } from './Humanoid';
import { SceneTimeline, type TimelineRange } from './Timeline';
import AIPanel from './AIPanel';
import { requestAIMotion } from './aiClient';
import { buildAIMotionRequest, sourceStampForAIMotion } from './aiMotionContext';
import { demoAudio } from './demoAudio';
import { deleteScene, duplicateScene, listScenes, loadCurrentScene, loadScene, renameScene, saveScene, setCurrentScene as selectStoredScene } from './storage';
import { createScene, type SceneDocument, type SceneMetadata, type SceneViewer } from './scene';
import { decodeSceneBackup, encodeSceneBackup, encodeSceneJsonBackup } from './sceneBackup';
import type { SceneSnapshot as Snapshot, SceneProject as Session } from './sceneProject';
import { snapAudioOffset } from './audioTimeline';
import { AUDIO_TRACK_LIMITS, audioTrackName, fitAudioTracks, pruneAudioClips, removeAudioSegment, snapAudioTrackOffset, splitAudioTrack, trimAudioSegment, type SceneAudioClip, type SceneAudioTrack } from './audioTracks';
import { useAudioClipWaveforms, useAudioTrackMixer } from './useAudioTrackMixer';
import { useModalFocus } from './useModalFocus';
import { useEditorShortcuts } from './useEditorShortcuts';
import { useTimelinePlayback } from './useTimelinePlayback';
import { useAudioWaveform } from './useAudioWaveform';
import { useCountCue } from './hooks/useCountCue';
import { useMusicSetup } from './hooks/useMusicSetup';
import { useFloatingMenus } from './hooks/useFloatingMenus';
import { useNotice, useOverlayInset, useUnsavedGuard } from './hooks/useLayoutHelpers';
import { blankSceneDocument, DEMO_AUDIO_NAME, FIRST_SCENE_NAME, initialSession, manualViewer, neutralSnapshot, UNTITLED_SCENE_NAME } from './editor/sceneModel';
import { downloadBlob, errorMessage, safeFileName } from './editor/format';
import { StudioHeader, type SaveStatus } from './components/StudioHeader';
import { AIDock, CameraBar } from './components/StageOverlays';
import { TimelineDock } from './components/TimelineDock';
import { PlaybackOptions, PlaybackTransport } from './components/Playback';
import { AssistCandidatePanel } from './components/AssistCandidatePanel';
import { ConfirmDialog, Dialog } from './dialogs/Dialog';
import { SceneLibraryDialog } from './dialogs/SceneLibraryDialog';
import { BackupImportDialog } from './dialogs/BackupImportDialog';
import { MusicSetupDialog } from './dialogs/MusicSetupDialog';
import { AboutDialog } from './dialogs/AboutDialog';

type SceneAction = { type: 'new' } | { type: 'open' | 'copy' | 'delete'; id: string } | { type: 'import'; scene: SceneDocument<Session> } | { type: 'recoverAudio'; sceneId: string; countMapId: string; audio: Blob; audioName: string; name: string };
type AudioMoveAction = { type: 'moveAudio'; offsetSeconds: number; sceneId: string; countMapId: string };
type ResetAction = 'music' | 'adoptAssist';
/** Any action that must first resolve an in-progress camera gesture. */
type GuardedAction = AudioMoveAction | { type: 'seek'; time: number } | { type: 'scene'; action: SceneAction } | { type: 'history'; direction: -1 | 1 }
  | { type: 'play' | 'save' | 'music' | 'teaching' | 'backup' | 'projectBackup' | 'adoptAssist' | 'previewAssist' } | { type: 'assist'; prompt: string };
type AssistCandidate = { aiMotion: AIMotionTrack; target: AIMotionTarget; summary: string; quality: AIMotionQuality; sceneId: string; countMapId: string; baseRevision: number; sourceStamp: string };
type CameraGesture = { sceneId: string; revision: number; time: number; snapshot: Snapshot; before: CameraPose; latest: CameraPose; status: SaveStatus; version: number; override: boolean };
type NamedTarget = { id: string; name: string };

const DEFAULT_CAMERA: StageCamera = { position: [2.4, 1.85, 4], target: [0, 1.04, 0], zoom: 1 };
const cameraMatches = (a: StageCamera | null, b: StageCamera) => !!a && [...a.position, ...a.target, a.zoom ?? 1].every((value, index) => Math.abs(value - [...b.position, ...b.target, b.zoom ?? 1][index]) < 1e-6);
const nextFrame = () => new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
const NO_AUDIO_TRACKS: SceneAudioTrack[] = [];

async function decodeAudioDuration(blob: Blob): Promise<number> {
  const context = new AudioContext();
  try { return (await context.decodeAudioData(await blob.arrayBuffer())).duration; }
  finally { await context.close().catch(() => {}); }
}

/** Explicitly record a camera key at an exact time, even when it equals the current view. */
function withCameraKey(track: CameraTrack, time: number, camera: CameraPose, duration: number): CameraTrack {
  const next = { ...track, keys: [...track.keys.filter(key => key.time !== time), { time, camera: cloneCameraPose(camera) }].sort((a, b) => a.time - b.time) };
  validateCameraTrack(next, duration);
  return next;
}

const AVATAR_STORAGE_KEY = 'choreo.avatar';

export default function App() {
  // ── Scene, persistence and library ────────────────────────────────────────
  const [session, setSession] = useState<Session>(() => initialSession());
  const [currentScene, setCurrentScene] = useState<SceneDocument<Session>>(() => createScene({ name: FIRST_SCENE_NAME, project: session, audio: null, audioName: DEMO_AUDIO_NAME, viewer: manualViewer() }));
  const [sceneList, setSceneList] = useState<SceneMetadata[]>([]);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [libraryBusy, setLibraryBusy] = useState(false);
  const [pendingSceneAction, setPendingSceneAction] = useState<SceneAction | null>(null);
  const [sceneActionBusy, setSceneActionBusy] = useState(false);
  const [renameTarget, setRenameTarget] = useState<NamedTarget | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<NamedTarget | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [importScene, setImportScene] = useState<SceneDocument<Session> | null>(null);
  const [importName, setImportName] = useState('');
  const [importNeedsAudio, setImportNeedsAudio] = useState(false);
  const [audioRecoveryTarget, setAudioRecoveryTarget] = useState<{ sceneId: string; countMapId: string } | null>(null);
  const [importError, setImportError] = useState('');
  const [importBusy, setImportBusy] = useState(false);
  const importReadToken = useRef(0);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('dirty');
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useNotice();
  const [ready, setReady] = useState(false);

  // ── Audio, playback and the Timeline range ────────────────────────────────
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [audioName, setAudioName] = useState(DEMO_AUDIO_NAME);
  const [audioUrl, setAudioUrl] = useState('');
  /** Bytes of additional audio tracks; placements live in history snapshots. */
  const [audioClips, setAudioClips] = useState<SceneAudioClip[]>([]);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [rate, setRate] = useState(1);
  const [loop, setLoop] = useState(false);
  const [countSound, setCountSound] = useState(false);
  const [mirror, setMirror] = useState(false);
  const [selected, setSelected] = useState(0);
  const [page, setPage] = useState<'studio' | 'teaching'>('studio');
  /** Frame-aligned view range: loops playback and is the future AI edit target. */
  const [range, setRange] = useState<TimelineRange | null>(null);
  const [queuedAction, setQueuedAction] = useState<GuardedAction | null>(null);
  const [pendingResetAction, setPendingResetAction] = useState<ResetAction | null>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const cue = useCountCue();
  const music = useMusicSetup(cue);

  // ── Camera ────────────────────────────────────────────────────────────────
  const [view, setView] = useState<StageView>('front');
  // The character is a per-viewer preference, never scene data.
  const [avatar, setAvatar] = useState<AvatarId>(() => { try { const stored = window.localStorage.getItem(AVATAR_STORAGE_KEY); return isAvatarId(stored) ? stored : DEFAULT_AVATAR; } catch { return DEFAULT_AVATAR; } });
  const chooseAvatar = useCallback((next: AvatarId) => {
    setAvatar(next);
    try { window.localStorage.setItem(AVATAR_STORAGE_KEY, next); } catch { /* storage is optional */ }
  }, []);
  const [camera, setCamera] = useState<StageCamera | null>(null);
  const [cameraSelected, setCameraSelected] = useState(false);
  const [cameraViewOverride, setCameraViewOverride] = useState(false);
  const [cameraRestoreExact, setCameraRestoreExact] = useState<SampledCameraPose | null>(null);
  const [cameraCancelKey, setCameraCancelKey] = useState(0);
  const [cameraResetKey, setCameraResetKey] = useState(0);
  const [cameraRestoreKey, setCameraRestoreKey] = useState(0);
  const [cameraFocus, setCameraFocus] = useState<StageCameraFocus | null>(null);
  const cameraFocusCounter = useRef(0);
  const cameraRef = useRef<StageCamera | null>(null);
  const cameraGesture = useRef<CameraGesture | null>(null);
  const sessionRef = useRef(session);
  const sceneIdRef = useRef(currentScene.id);
  sceneIdRef.current = currentScene.id;
  const sceneChangeVersion = useRef(0);

  // ── AI candidates ─────────────────────────────────────────────────────────
  const [assistCandidate, setAssistCandidate] = useState<AssistCandidate | null>(null);
  const [previewAssist, setPreviewAssist] = useState(false);
  const [assistBusy, setAssistBusy] = useState(false);
  const [assistError, setAssistError] = useState('');
  const assistRun = useRef<{ controller: AbortController; sceneId: string; revision: number; countMapId: string; sourceStamp: string } | null>(null);

  // ── Derived state ─────────────────────────────────────────────────────────
  const storedActive = session.history[session.historyIndex];
  // Old music-only saves remain untouched until the first real edit.
  const active = useMemo(() => {
    if (storedActive.take) return storedActive;
    const neutral = neutralSnapshot(storedActive.countMap, storedActive.title, storedActive.plan?.id);
    return { ...storedActive, take: neutral.take, manual: storedActive.manual ?? neutral.manual };
  }, [storedActive]);
  const activeRef = useRef(active); activeRef.current = active;
  const audioBlobRef = useRef(audioBlob); audioBlobRef.current = audioBlob;
  const audioClipsRef = useRef(audioClips); audioClipsRef.current = audioClips;
  const duration = active.countMap.durationSeconds;
  const cameraSampler = useMemo(() => active.cameraTrack ? createCameraTrackSampler(active.cameraTrack, duration) : null, [active.cameraTrack, duration]);
  const sampledCamera = useMemo(() => cameraSampler?.(time) ?? null, [cameraSampler, time]);
  const cameraTrackState = !cameraViewOverride ? sampledCamera : null;
  const cameraValue = cameraTrackState ?? camera ?? DEFAULT_CAMERA;
  const editorFrame = frameAtTime(time, duration);
  const legacyKeyCount = useMemo(() => active.manual ? getKeyframeCount(active.manual) : 0, [active.manual]);
  const hasLegacyAuthoring = legacyKeyCount > 0 || !!active.manual?.footLocks?.length || !!active.manual?.steps;
  const displayedTake = active.take;
  const currentMotionSampler = useMemo(() => active.take ? createAIMotionSampler(at => sampleTake(active.take!, at), active.aiMotion) : undefined, [active.take, active.aiMotion]);
  const displayedMotionSampler = useMemo(() => active.take && previewAssist && assistCandidate && assistCandidate.baseRevision === session.revision
    ? createAIMotionSampler(at => sampleTake(active.take!, at), assistCandidate.aiMotion) : currentMotionSampler,
  [active.take, previewAssist, assistCandidate, session.revision, currentMotionSampler]);
  const editing = page === 'studio' && !previewAssist;
  const modalOpen = libraryOpen || importOpen || music.open || aboutOpen || !!renameTarget || !!deleteTarget || !!pendingSceneAction || !!pendingResetAction;
  /** Work-level locks: a dialog, a long operation or a save in progress. */
  const workLocked = modalOpen || !!busy || sceneActionBusy || saveStatus === 'saving';
  const countPosition = countAt(active.countMap, time);
  const shownRange = useMemo(() => previewAssist && assistCandidate
    ? { start: assistCandidate.target.startSeconds, end: assistCandidate.target.endSeconds } : range, [previewAssist, assistCandidate, range]);
  const loopRange = useMemo(() => loop ? shownRange ? { startSeconds: shownRange.start, endSeconds: shownRange.end } : { startSeconds: 0, endSeconds: duration } : null, [loop, shownRange, duration]);

  const timelineDockRef = useRef<HTMLDivElement>(null);
  const timelineInset = useOverlayInset(timelineDockRef, ready, 0);
  const timelinePlayback = useTimelinePlayback({
    restoreKey: `${currentScene.id}:${session.historyIndex}:${session.revision}`, audioRef, countMap: active.countMap, audioOffsetSeconds: active.audioOffsetSeconds ?? 0,
    rate, loopRange, time, onTimeChange: setTime, onPlayingChange: setPlaying,
    onError: () => setNotice('音频尚未就绪，或浏览器阻止了播放。请再点一次播放。'),
    beforePlay: cue.prepare,
  });
  const waveform = useAudioWaveform(audioBlob, active.countMap);
  const audioTracks = active.audioTracks ?? NO_AUDIO_TRACKS;
  useAudioTrackMixer({ clips: audioClips, tracks: audioTracks, time, playing, rate, sceneDuration: duration, getTime: timelinePlayback.getTime });
  const trackWaveforms = useAudioClipWaveforms(audioClips);
  const audioTrackLanes = useMemo(() => {
    const present = new Set(audioClips.map(clip => clip.id));
    return audioTracks.map(track => ({ ...track, muted: !!track.muted, missing: !present.has(track.id), waveform: trackWaveforms[track.id] ?? [] }));
  }, [audioTracks, audioClips, trackWaveforms]);

  /** Persistable viewer state; never contains candidates, ranges or selections. */
  function captureViewer(at = time): SceneViewer {
    return { ...currentScene.viewer, view, camera: cameraRef.current, mirror, rate, loop, countSound, selectedSlot: selected, selectedJoint: null, time: at, editorMode: 'keyframes' };
  }
  function markSceneDirty() { sceneChangeVersion.current += 1; setSaveStatus('dirty'); }

  // ── Effects ───────────────────────────────────────────────────────────────
  const lastCue = useRef(-1);
  useEffect(() => {
    if (!playing) { lastCue.current = -1; return; }
    const index = Math.floor(time / (60 / active.countMap.bpm * active.countMap.musicBeatsPerDanceCount));
    if (countSound && index !== lastCue.current) cue.beep();
    lastCue.current = index;
  }, [time, playing, countSound, active.countMap, cue]);

  useModalFocus({ onEscape: dialog => {
    if (sceneActionBusy || importBusy || busy || saveStatus === 'saving') return;
    switch (dialog.getAttribute('aria-labelledby')) {
      case 'reset-keys-title': setPendingResetAction(null); break;
      case 'unsaved-title': setPendingSceneAction(null); break;
      case 'rename-title': setRenameTarget(null); break;
      case 'delete-title': setDeleteTarget(null); break;
      case 'backup-import-title': closeBackupImport(); break;
      case 'library-title': setLibraryOpen(false); break;
      case 'create-title': music.close(); break;
      case 'about-title': setAboutOpen(false); break;
    }
  } });

  useEditorShortcuts({
    enabled: ready && page === 'studio' && !modalOpen && !busy && !sceneActionBusy && saveStatus !== 'saving',
    readOnly: false,
    onStep: direction => { if (!playing) stepFrames(direction); },
    onStepCount: direction => { if (!playing) stepCount(direction); },
    onJump: edge => { if (!playing) seek(edge === 'start' ? range && time > range.start + 1e-9 ? range.start : 0 : range && time < range.end - 1e-9 ? range.end : duration); },
    onMark: edge => { if (!playing) markRange(edge); },
    onClearRange: () => changeRange(null),
    onPlay: () => { void togglePlay(); },
    onDelete: () => { if (!playing && cameraSelected) deleteCameraPoint(); },
    onUndo: () => { if (!playing) navigateHistory(-1); },
    onRedo: () => { if (!playing) navigateHistory(1); },
    onSave: () => { if (audioBlob) void save(); },
  });
  useFloatingMenus();

  useEffect(() => { sessionRef.current = session; }, [session]);
  useEffect(() => { cancelAssistance(); setAssistCandidate(null); setPreviewAssist(false); }, [currentScene.id, active.countMap.id, session.revision]);
  useEffect(() => { setRange(previous => previous && previous.end <= duration ? previous : null); }, [duration]);
  useEffect(() => () => { assistRun.current?.controller.abort(); }, []);
  useEffect(() => {
    let cancelled = false;
    loadCurrentScene<Session>().then(saved => {
      if (cancelled) return;
      if (saved && saved.project.history?.length && saved.project.history[saved.project.historyIndex]?.countMap?.confirmed) applyScene(saved);
      else setAudioBlob(demoAudio());
      setReady(true);
    }).catch(() => { if (!cancelled) { setAudioBlob(demoAudio()); setReady(true); setNotice('本地存储暂不可用。仍可体验，但请导出项目备份。'); } });
    return () => { cancelled = true; };
  }, []);
  useEffect(() => {
    if (!audioBlob) { setAudioUrl(''); return; }
    const url = URL.createObjectURL(audioBlob); setAudioUrl(url);
    const audio = audioRef.current;
    return () => {
      // Stop owned native range requests before revoking their source. A new
      // explicit src wins even while currentSrc still reports the previous URL.
      if (audio && (audio.src === url || (!audio.getAttribute('src') && audio.currentSrc === url))) {
        audio.pause(); audio.removeAttribute('src'); audio.load();
      }
      URL.revokeObjectURL(url);
    };
  }, [audioBlob]);
  useUnsavedGuard(useCallback(() => saveStatus !== 'saved', [saveStatus]), ready);
  useEffect(() => { if (modalOpen && timelinePlayback.isPending()) pause(); }, [modalOpen]);

  // ── Playback, navigation and ranges ───────────────────────────────────────
  function pause() {
    const wasPlaying = timelinePlayback.isPlaying();
    const raw = timelinePlayback.pause();
    if (wasPlaying) timelinePlayback.seek(frameTime(frameAtTime(raw, duration), duration));
  }
  function seek(next: number) {
    if (timelinePlayback.isPending()) pause();
    if (guard({ type: 'seek', time: next })) return;
    seekDirect(Math.max(0, Math.min(duration, next)));
  }
  function seekDirect(next: number) {
    setCameraViewOverride(false); timelinePlayback.seek(next);
  }
  function stepFrames(direction: -1 | 1) {
    const next = Math.max(0, Math.min(lastFrame(duration), editorFrame + direction));
    if (next !== editorFrame) seek(frameTime(next, duration));
  }
  /** Move to the previous/next dance-count onset (or the exact scene end). */
  function stepCount(direction: -1 | 1) {
    const counts = active.countMap.countTimesSeconds;
    const target = direction < 0 ? counts.filter(count => count < time - 1e-6).at(-1) : counts.find(count => count > time + 1e-6);
    if (target !== undefined) seek(frameTime(frameAtTime(target, duration), duration));
  }
  function changeRange(next: TimelineRange | null) {
    if (!next) { setRange(null); return; }
    const start = frameTime(frameAtTime(Math.min(next.start, next.end), duration), duration);
    const end = frameTime(frameAtTime(Math.max(next.start, next.end), duration), duration);
    setRange(end > start ? { start, end } : null);
  }
  function markRange(edge: 'in' | 'out') {
    if (edge === 'in') changeRange({ start: time, end: range && range.end > time ? range.end : duration });
    else changeRange({ start: range && range.start < time ? range.start : 0, end: time });
  }
  async function togglePlay() {
    if (playing || timelinePlayback.isPending()) { pause(); return; }
    if (guard({ type: 'play' })) return;
    if (!displayedTake || !audioRef.current || !ready || !audioBlob) return;
    setCameraViewOverride(false);
    const start = loop && shownRange
      ? time >= shownRange.start && time < shownRange.end - .01 ? time : shownRange.start
      : time >= duration - .01 ? 0 : time;
    await timelinePlayback.play(start);
  }
  function moveAudio(offsetSeconds: number) {
    if (playing || !editing || busy || !audioBlob) return;
    const action: AudioMoveAction = { type: 'moveAudio', offsetSeconds: snapAudioOffset(offsetSeconds, duration), sceneId: currentScene.id, countMapId: active.countMap.id };
    if (guard(action)) return;
    performAudioMove(action);
  }
  function performAudioMove(action: AudioMoveAction) {
    if (action.sceneId !== currentScene.id || action.countMapId !== active.countMap.id || playing || !editing || busy) return;
    if (action.offsetSeconds === (active.audioOffsetSeconds ?? 0)) return;
    commit({ ...active, audioOffsetSeconds: action.offsetSeconds }, { label: '移动音乐' });
  }

  // ── Additional audio tracks ───────────────────────────────────────────────
  function audioTracksEditable() { return !playing && editing && !workLocked; }
  /** Apply one track-list change to the latest committed snapshot as one history entry. */
  function editAudioTracks(label: string, edit: (tracks: SceneAudioTrack[]) => SceneAudioTrack[] | null) {
    if (!audioTracksEditable()) return;
    finishCameraGesture();
    const latest = sessionRef.current, snapshot = latest.history[latest.historyIndex];
    const next = edit(snapshot.audioTracks ?? []);
    if (!next) return;
    const { audioTracks: _previous, ...rest } = snapshot;
    commit(next.length ? { ...rest, audioTracks: next } : rest, { label });
  }
  /** Import another audio file onto a new track starting at the current time. */
  async function addAudioTrack(file: File) {
    if (!audioTracksEditable()) return;
    if (audioTracks.length >= AUDIO_TRACK_LIMITS.tracks) { setNotice(`最多只能添加 ${AUDIO_TRACK_LIMITS.tracks} 条音轨。`); return; }
    if (!file.size || file.size > AUDIO_TRACK_LIMITS.clipBytes) { setNotice('音轨音频必须在 100 MB 以内。'); return; }
    const used = pruneAudioClips(audioClips, sessionRef.current).reduce((sum, clip) => sum + clip.blob.size, 0);
    if (used + file.size > AUDIO_TRACK_LIMITS.totalBytes) { setNotice('全部音轨合计不能超过 200 MB。'); return; }
    const target = { sceneId: currentScene.id, countMapId: active.countMap.id, time };
    pause(); setBusy('正在读取音轨');
    let durationSeconds: number;
    try { durationSeconds = await decodeAudioDuration(file); }
    catch { setNotice('无法解码这个音频文件，请选择浏览器支持的音频格式。'); return; }
    finally { setBusy(''); }
    if (!Number.isFinite(durationSeconds) || durationSeconds < AUDIO_TRACK_LIMITS.minDurationSeconds || durationSeconds > AUDIO_TRACK_LIMITS.maxDurationSeconds) { setNotice('音轨音频时长需在 10 分钟以内。'); return; }
    const latest = sessionRef.current, snapshot = latest.history[latest.historyIndex];
    if (sceneIdRef.current !== target.sceneId || snapshot.countMap.id !== target.countMapId) { setNotice('场景已经改变，音轨未添加。'); return; }
    if ((snapshot.audioTracks?.length ?? 0) >= AUDIO_TRACK_LIMITS.tracks) { setNotice(`最多只能添加 ${AUDIO_TRACK_LIMITS.tracks} 条音轨。`); return; }
    const id = crypto.randomUUID();
    const offsetSeconds = snapAudioTrackOffset(target.time, { durationSeconds }, snapshot.countMap.durationSeconds);
    setAudioClips(previous => [...previous, { id, blob: file }]);
    finishCameraGesture();
    const current = sessionRef.current.history[sessionRef.current.historyIndex];
    commit({ ...current, audioTracks: [...current.audioTracks ?? [], { id, name: audioTrackName(file.name), offsetSeconds, durationSeconds }] }, { label: '添加音轨', time: target.time });
    setNotice('已添加音轨。可拖动片段调整位置，选择音轨可静音或删除。');
  }
  function moveAudioTrack(id: string, offsetSeconds: number) {
    editAudioTracks('移动音轨', tracks => {
      const track = tracks.find(item => item.id === id);
      if (!track) return null;
      const snapped = snapAudioTrackOffset(offsetSeconds, track, duration);
      return snapped === track.offsetSeconds ? null : tracks.map(item => item.id === id ? { ...item, offsetSeconds: snapped } : item);
    });
  }
  function toggleAudioTrackMute(id: string) {
    const track = audioTracks.find(item => item.id === id);
    if (!track) return;
    editAudioTracks(track.muted ? '取消静音音轨' : '静音音轨', tracks => tracks.map(item => {
      if (item.id !== id) return item;
      const { muted: _muted, ...rest } = item;
      return item.muted ? rest : { ...rest, muted: true };
    }));
  }
  /** Split the selected track's audible piece under the playhead into two. */
  function splitAudioTrackAt(id: string) {
    const track = audioTracks.find(item => item.id === id);
    if (!track || !audioTracksEditable()) return;
    if (!splitAudioTrack(track, time)) { setNotice('播放头需位于该音轨的片段内部（不在片段边缘）才能分割。'); return; }
    editAudioTracks('分割音轨', tracks => {
      const current = tracks.find(item => item.id === id), next = current && splitAudioTrack(current, time);
      return next ? tracks.map(item => item.id === id ? next : item) : null;
    });
  }
  /** Move one edge of one audible piece; audio outside the pieces never plays. */
  function trimAudioTrack(id: string, index: number, edge: 'start' | 'end', sourceSeconds: number) {
    editAudioTracks('裁剪音轨', tracks => {
      const current = tracks.find(item => item.id === id), next = current && trimAudioSegment(current, index, edge, sourceSeconds, duration);
      return next ? tracks.map(item => item.id === id ? next : item) : null;
    });
  }
  function removeAudioTrackSegment(id: string, index: number) {
    editAudioTracks('删除音轨片段', tracks => {
      const current = tracks.find(item => item.id === id), next = current && removeAudioSegment(current, index, duration);
      return next ? tracks.map(item => item.id === id ? next : item) : null;
    });
  }
  function removeAudioTrack(id: string) {
    if (!audioTracksEditable()) return;
    editAudioTracks('删除音轨', tracks => tracks.some(item => item.id === id) ? tracks.filter(item => item.id !== id) : null);
    setNotice('已删除音轨；可撤销恢复。');
  }

  // ── History ───────────────────────────────────────────────────────────────
  /** Every committed change is one history entry and a new revision. */
  function commit(next: Snapshot, operation: Snapshot['operation'] = { label: '编辑场景' }) {
    next = { ...next, operation };
    cancelAssistance(); pause(); setPreviewAssist(false);
    setSession(previous => {
      const history = [...previous.history.slice(0, previous.historyIndex + 1), next].slice(-12);
      const nextSession = { ...previous, history, historyIndex: history.length - 1, revision: previous.revision + 1, teacherCheckedRevision: null };
      sessionRef.current = nextSession; return nextSession;
    });
    markSceneDirty();
  }
  function moveHistoryIndex(next: number) {
    cancelAssistance(); pause(); setPreviewAssist(false);
    setSession(previous => { const updated = { ...previous, historyIndex: next, revision: previous.revision + 1, teacherCheckedRevision: null }; sessionRef.current = updated; return updated; });
  }
  function jumpHistory(next: number) {
    if (playing || busy || modalOpen || next === session.historyIndex || next < 0 || next >= session.history.length) return;
    cancelCameraGesture(true); restoreHistoryCamera(session.history[next], next - session.historyIndex);
    moveHistoryIndex(next);
    const operationTime = session.history[next].operation?.time;
    if (operationTime !== undefined) seekDirect(operationTime);
    markSceneDirty();
  }
  function navigateHistory(direction: -1 | 1) {
    if (guard({ type: 'history', direction })) return;
    const next = session.historyIndex + direction;
    if (next < 0 || next >= session.history.length) return;
    restoreHistoryCamera(session.history[next], direction);
    moveHistoryIndex(next);
    markSceneDirty();
  }

  // ── Camera view and Camera track ──────────────────────────────────────────
  const rememberCamera = useCallback((next: StageCamera) => {
    // Derived spherical previews may extend beyond authored coordinate limits.
    // Keep that exact runtime view while preserving a valid viewer fallback.
    const authored = cloneCameraPose(next);
    try { validateCameraPose(authored); cameraRef.current = authored; } catch { /* runtime view only */ }
    setCamera(authored);
  }, []);
  const handleCameraChange = useCallback((next: StageCamera) => {
    if (cameraMatches(cameraRef.current, next)) return;
    rememberCamera(next);
  }, [rememberCamera]);
  const handleCameraInteraction = useCallback(() => { setCameraViewOverride(true); setView('free'); sceneChangeVersion.current += 1; setSaveStatus('dirty'); }, []);
  function restoreHistoryCamera(next: Snapshot, direction: number) {
    setCameraViewOverride(false); setCameraRestoreExact(null);
    if (!active.cameraTrack || next.cameraTrack) return;
    const exact = direction < 0
      ? createCameraTrackSampler(makeCameraTrack(active.cameraTrack.baseCamera), duration)(0)
      : next.operation?.tracks?.includes('camera') && next.operation.time !== undefined
        ? createCameraTrackSampler(active.cameraTrack, duration)(next.operation.time)
        : null;
    if (!exact) return;
    rememberCamera(exact); setCameraRestoreExact(exact); setCameraRestoreKey(previous => previous + 1);
  }
  function cameraCanEdit() { return editing && !!active.take && !playing && !mirror && !workLocked; }
  function restoreGestureStatus(gesture: CameraGesture) { if (gesture.version === sceneChangeVersion.current) setSaveStatus(gesture.status); }
  function selectCameraPoint(exactTime: number) {
    if (!cameraCanEdit()) return;
    finishCameraGesture(); seekDirect(exactTime);
    setCameraSelected(true);
  }
  function deselectCamera() { finishCameraGesture(); setCameraSelected(false); }
  function cancelCameraGesture(stopStage = false) {
    const gesture = cameraGesture.current; cameraGesture.current = null;
    if (!gesture) return;
    if (stopStage) setCameraCancelKey(previous => previous + 1);
    setCamera(cloneCameraPose(gesture.before));
    // Stage restores the exact camera and runtime up before issuing cancel.
    setCameraViewOverride(gesture.override);
    restoreGestureStatus(gesture);
  }
  function finishCameraGesture(): boolean {
    const gesture = cameraGesture.current; cameraGesture.current = null;
    if (!gesture) return false;
    if (gesture.sceneId !== currentScene.id || gesture.revision !== sessionRef.current.revision || sameCameraPose(gesture.before, gesture.latest, 1e-6)) {
      restoreGestureStatus(gesture); setCameraViewOverride(gesture.override); return false;
    }
    try {
      const track = gesture.snapshot.cameraTrack ?? makeCameraTrack(gesture.before);
      const next = upsertCameraKeyframe(track, gesture.time, gesture.latest, gesture.snapshot.countMap.durationSeconds);
      if (next === track) { restoreGestureStatus(gesture); setCameraViewOverride(false); return false; }
      rememberCamera(gesture.latest);
      setCameraViewOverride(false); setView('free');
      commit({ ...gesture.snapshot, cameraTrack: next }, { label: '调整相机', time: gesture.time, tracks: ['camera'] });
      return true;
    } catch (error) {
      setCamera(cloneCameraPose(gesture.before));
      setCameraViewOverride(gesture.override); setCameraRestoreKey(previous => previous + 1);
      restoreGestureStatus(gesture);
      setNotice(errorMessage(error)); return false;
    }
  }
  function handleCameraGesture(value: StageCamera, phase: 'start' | 'change' | 'end' | 'cancel') {
    if (phase === 'start') {
      if (!cameraSelected || !cameraCanEdit()) return;
      setCameraRestoreExact(null);
      const latest = sessionRef.current, snapshot = latest.history[latest.historyIndex];
      cameraGesture.current = { sceneId: currentScene.id, revision: latest.revision, time, snapshot,
        before: cloneCameraPose(value), latest: cloneCameraPose(value), status: saveStatus,
        version: sceneChangeVersion.current, override: cameraViewOverride };
      return;
    }
    const gesture = cameraGesture.current;
    if (!gesture) return;
    if (phase === 'cancel') { cancelCameraGesture(); return; }
    gesture.latest = cloneCameraPose(value); setCamera(cloneCameraPose(value));
    setCameraViewOverride(true);
    if (!sameCameraPose(gesture.before, value, 1e-6)) setSaveStatus('dirty');
    if (phase === 'end') finishCameraGesture();
  }
  /** Run a Camera-track edit against the latest committed snapshot. */
  function editCameraTrack(edit: (snapshot: Snapshot) => void) {
    finishCameraGesture();
    const latest = sessionRef.current;
    try { edit(latest.history[latest.historyIndex]); } catch (error) { setNotice(errorMessage(error)); }
  }
  /** Explicit “record the current view here”, independent of record mode. */
  function addCameraPoint() {
    if (!cameraCanEdit()) return;
    const exactTime = time, value = cloneCameraPose(cameraRef.current ?? cameraValue);
    editCameraTrack(snapshot => {
      const track = snapshot.cameraTrack ?? makeCameraTrack(value);
      const existing = track.keys.find(key => key.time === exactTime);
      if (existing && sameCameraPose(existing.camera, value, 1e-9)) { setCameraSelected(true); setNotice('此时间已有相同的镜头关键帧。'); return; }
      const next = withCameraKey(track, exactTime, value, snapshot.countMap.durationSeconds);
      setCameraViewOverride(false); setView('free'); setCameraSelected(true);
      commit({ ...snapshot, cameraTrack: next }, { label: '记录镜头', time: exactTime, tracks: ['camera'] });
    });
  }
  function changeCameraPoint(exactTime: number, value: CameraPose) {
    if (!cameraSelected || !cameraCanEdit()) return;
    editCameraTrack(snapshot => {
      const track = snapshot.cameraTrack ?? makeCameraTrack(cloneCameraPose(cameraRef.current ?? cameraValue));
      const next = upsertCameraKeyframe(track, exactTime, value, snapshot.countMap.durationSeconds);
      if (next === track) return;
      setCameraViewOverride(false); setView('free');
      commit({ ...snapshot, cameraTrack: next }, { label: '调整相机', time: exactTime, tracks: ['camera'] });
    });
  }
  function moveCameraPoint(sourceTime: number, targetTime: number) {
    if (!cameraCanEdit()) return;
    editCameraTrack(snapshot => {
      if (!snapshot.cameraTrack) return;
      const next = moveCameraKeyframe(snapshot.cameraTrack, sourceTime, targetTime, snapshot.countMap.durationSeconds);
      if (next === snapshot.cameraTrack) return;
      commit({ ...snapshot, cameraTrack: next }, { label: '移动相机点', time: targetTime, tracks: ['camera'] });
      setCameraSelected(true);
      seekDirect(targetTime);
    });
  }
  function deleteCameraPoint() {
    if (!cameraSelected || !cameraCanEdit()) return;
    const exactTime = time;
    editCameraTrack(snapshot => {
      if (!snapshot.cameraTrack) return;
      const next = removeCameraKeyframe(snapshot.cameraTrack, exactTime, snapshot.countMap.durationSeconds);
      if (next === snapshot.cameraTrack) return;
      const { cameraTrack: _cameraTrack, ...withoutCamera } = snapshot;
      // Removing the last key removes the track and keeps its view in place.
      if (!next.keys.length) { rememberCamera(createCameraTrackSampler(snapshot.cameraTrack, snapshot.countMap.durationSeconds)(exactTime)); setView('free'); }
      setCameraViewOverride(!next.keys.length);
      commit(next.keys.length ? { ...snapshot, cameraTrack: next } : withoutCamera, { label: '删除相机点', time: exactTime, tracks: ['camera'] });
    });
  }
  function chooseView(next: Exclude<StageView, 'free'>) { finishCameraGesture(); setCameraRestoreExact(null); setCameraViewOverride(true); setView(next); setCameraResetKey(previous => previous + 1); markSceneDirty(); }
  function frameActor() {
    if (!displayedTake || !ready || busy) return;
    finishCameraGesture(); setCameraRestoreExact(null); setCameraViewOverride(true);
    setCameraFocus({ key: ++cameraFocusCounter.current, kind: 'actor' });
  }

  /** Resolve an in-progress camera gesture first; the action reruns once it is recorded. */
  function guard(action: GuardedAction): boolean {
    if (cameraGesture.current && finishCameraGesture()) { setQueuedAction(action); return true; }
    return false;
  }

  // ── AI candidates ─────────────────────────────────────────────────────────
  function cancelAssistance() {
    const run = assistRun.current; assistRun.current = null; run?.controller.abort();
    setAssistBusy(false);
  }
  async function generateAssistance(prompt: string) {
    if (guard({ type: 'assist', prompt })) return;
    if (!active.take || assistRun.current || busy || !ready) return;
    pause(); setAssistError(''); setAssistCandidate(null); setPreviewAssist(false);
    const source = active;
    const targetRange = range ? { start: range.start, end: range.end } : null;
    const run = { controller: new AbortController(), sceneId: currentScene.id, revision: session.revision, countMapId: source.countMap.id,
      sourceStamp: sourceStampForAIMotion(source, audioBlob, audioClips) };
    assistRun.current = run; setAssistBusy(true);
    const valid = () => assistRun.current === run && !run.controller.signal.aborted && sceneIdRef.current === run.sceneId && sessionRef.current.revision === run.revision &&
      sourceStampForAIMotion(activeRef.current, audioBlobRef.current, audioClipsRef.current) === run.sourceStamp;
    try {
      const request = await buildAIMotionRequest({ prompt, sceneId: run.sceneId, baseRevision: run.revision, snapshot: source,
        range: targetRange, audioBlob, audioName, audioDurationSeconds: session.audioDuration, audioClips, signal: run.controller.signal });
      if (!valid()) return;
      const response = await requestAIMotion(request, run.controller.signal);
      if (!valid() || !currentMotionSampler) return;
      const patch = compileAIMotionPatch(request, response, currentMotionSampler);
      const quality = analyzeAIMotionPatch(patch);
      const aiMotion = appendAIMotionPatch(source.aiMotion, patch, source.countMap);
      setAssistCandidate({ aiMotion, target: request.context.target, summary: response.summary, quality, sceneId: run.sceneId,
        countMapId: run.countMapId, baseRevision: run.revision, sourceStamp: run.sourceStamp });
      setNotice('候选已就绪。预览和采用分开操作，原稿尚未改变。');
    } catch (error) { if (valid()) { setAssistError(errorMessage(error)); setNotice(errorMessage(error)); } }
    finally { if (assistRun.current === run) { assistRun.current = null; setAssistBusy(false); } }
  }
  function validAssistCandidate() {
    return !!assistCandidate && assistCandidate.sceneId === currentScene.id && assistCandidate.countMapId === active.countMap.id && assistCandidate.baseRevision === session.revision &&
      sourceStampForAIMotion(active, audioBlob, audioClips) === assistCandidate.sourceStamp;
  }
  const STALE_CANDIDATE = '作品已经改变，请重新生成候选。';
  function showAssistCandidate() {
    if (guard({ type: 'previewAssist' })) return;
    if (!validAssistCandidate()) { setNotice(STALE_CANDIDATE); return; }
    pause(); setPreviewAssist(true); seekDirect(assistCandidate!.target.startSeconds);
  }
  function adoptAssistance() {
    if (!validAssistCandidate()) { setNotice(STALE_CANDIDATE); return; }
    if (guard({ type: 'adoptAssist' })) return;
    if (hasLegacyAuthoring && assistCandidate!.target.mode === 'full') { setPendingResetAction('adoptAssist'); return; }
    performAdoptAssistance();
  }
  function performAdoptAssistance() {
    if (!validAssistCandidate() || !assistCandidate) { setNotice(STALE_CANDIDATE); return; }
    const start = assistCandidate.target.startSeconds;
    commit({ ...active, aiMotion: assistCandidate.aiMotion }, {
      label: assistCandidate.target.mode === 'interval' ? '采用 AI 区间动作' : '采用 AI 整段动作', time: start, tracks: ['root', ...JOINT_NAMES],
    });
    setAssistCandidate(null); setPreviewAssist(false); seekDirect(start);
    setNotice('已采用 AI 动作；原动作保留在撤销历史中。');
  }
  function closeAssistCandidate() { pause(); setPreviewAssist(false); setAssistCandidate(null); }
  function toggleAssistPreview() { if (previewAssist) { pause(); setPreviewAssist(false); } else showAssistCandidate(); }

  // ── Scenes: open, save, import, export ────────────────────────────────────
  async function refreshScenes() { setSceneList(await listScenes()); }
  async function openLibrary() {
    pause(); setLibraryOpen(true); setLibraryBusy(true);
    try { await refreshScenes(); }
    catch (error) { setNotice(errorMessage(error)); }
    finally { setLibraryBusy(false); }
  }
  function applyScene(scene: SceneDocument<Session>, saved = true) {
    cameraGesture.current = null; setCameraRestoreExact(null); setCameraSelected(false); setCameraViewOverride(false);
    cancelAssistance(); setAssistCandidate(null); setPreviewAssist(false); pause(); music.close();
    const viewer = scene.viewer, map = scene.project.history[scene.project.historyIndex].countMap;
    setCurrentScene(scene); setSession(scene.project); sessionRef.current = scene.project;
    setAudioBlob(scene.audio); setAudioName(scene.audioName); setAudioClips(scene.audioClips ?? []);
    setTime(Math.max(0, Math.min(map.durationSeconds, viewer.time)));
    setSelected(Math.max(0, Math.min(map.octetCount - 1, viewer.selectedSlot)));
    setView(viewer.view); setMirror(viewer.mirror); setRate(viewer.rate); setLoop(viewer.loop); setCountSound(viewer.countSound);
    setRange(null);
    cameraRef.current = viewer.camera; setCamera(viewer.camera);
    setCameraRestoreKey(previous => previous + 1);
    setCameraFocus(null);
    setPage('studio');
    setQueuedAction(null);
    sceneChangeVersion.current += 1; setSaveStatus(saved ? 'saved' : 'dirty');
  }
  async function save(): Promise<boolean> { if (guard({ type: 'save' })) return false; return performSave(); }
  async function performSave(): Promise<boolean> {
    if (!audioBlob) { setNotice('原音乐缺失，请先恢复原音乐；编舞数据仍可下载为项目备份。'); return false; }
    const version = sceneChangeVersion.current, snapshot = sessionRef.current;
    setSaveStatus('saving');
    await nextFrame();
    const document: SceneDocument<Session> = { ...currentScene, project: snapshot, audio: audioBlob, audioName, audioClips: pruneAudioClips(audioClips, snapshot), viewer: captureViewer() };
    try {
      const saved = await saveScene(document);
      setCurrentScene(previous => previous.id === saved.id ? { ...previous, updatedAt: saved.updatedAt } : previous);
      setSaveStatus(sceneChangeVersion.current === version && sessionRef.current === snapshot ? 'saved' : 'dirty');
      try { await refreshScenes(); } catch { setNotice('场景已保存，但列表暂时未刷新。'); }
      return true;
    } catch { setSaveStatus('failed'); setNotice('保存失败，可能是浏览器存储空间不足。请下载项目备份。'); return false; }
  }
  async function executeSceneAction(action: SceneAction) {
    setSceneActionBusy(true);
    try {
      if (action.type === 'new') {
        await selectStoredScene(null);
        applyScene(blankSceneDocument(), false);
        setNotice('已新建独立场景。保存后可在本机场景列表中重新打开。');
      } else if (action.type === 'open') {
        const scene = await loadScene<Session>(action.id);
        if (!scene) throw new Error('这个场景已被删除。');
        await selectStoredScene(scene.id); applyScene(scene); setNotice(`已打开场景「${scene.name}」。`);
      } else if (action.type === 'copy') {
        const copy = await duplicateScene<Session>(action.id);
        if (!copy) throw new Error('这个场景已被删除。');
        applyScene(copy); setNotice('已复制并打开新场景，原场景仍保留在本机。');
      } else if (action.type === 'import' || action.type === 'recoverAudio') {
        // Saving music, scene and current marker is one committed transaction.
        // A rejected transaction never replaces the currently open work.
        if (action.type === 'recoverAudio' && (action.sceneId !== currentScene.id || action.countMapId !== active.countMap.id)) throw new Error('恢复目标场景或数拍已改变，请重新关联音乐。');
        // Capture the current formal project now rather than the modal's older read-only preview.
        const document = action.type === 'import' ? action.scene : createScene({
          name: action.name, project: { ...sessionRef.current, teacherCheckedRevision: null }, audio: action.audio, audioName: action.audioName, audioClips: pruneAudioClips(audioClips, sessionRef.current), viewer: captureViewer(),
        });
        const saved = await saveScene(document);
        applyScene(saved); closeBackupImport();
        setNotice(`已将「${saved.name}」作为新场景导入，原场景保留。`);
      } else {
        await deleteScene(action.id);
        if (action.id === currentScene.id) {
          const remaining = await listScenes();
          const next = remaining.length ? await loadScene<Session>(remaining[0].id) : null;
          if (next) { await selectStoredScene(next.id); applyScene(next); }
          else applyScene(blankSceneDocument(), false);
        }
        setNotice('场景已从本机删除。');
      }
      setLibraryOpen(false); setPendingSceneAction(null);
      try { await refreshScenes(); } catch { setNotice('操作已完成，但本机场景列表暂时未刷新。'); }
    } catch (error) {
      if (action.type === 'import' || action.type === 'recoverAudio') setImportError(`导入未保存：${errorMessage(error)}。当前场景保持原样，请检查本机空间后重试。`);
      setNotice(errorMessage(error));
    }
    finally { setSceneActionBusy(false); }
  }
  function requestSceneAction(action: SceneAction) {
    if (action.type === 'open' && action.id === currentScene.id) { setLibraryOpen(false); return; }
    if (guard({ type: 'scene', action })) return;
    pause();
    const leavesCurrent = action.type !== 'delete' || action.id === currentScene.id;
    if (leavesCurrent && saveStatus !== 'saved') setPendingSceneAction(action);
    else void executeSceneAction(action);
  }
  async function saveThenContinue() {
    if (!pendingSceneAction) return;
    const action = pendingSceneAction; setSceneActionBusy(true);
    if (await save()) await executeSceneAction(action);
    else setSceneActionBusy(false);
  }
  function startRename(target: NamedTarget) { setRenameTarget(target); setRenameValue(target.name); }
  async function confirmRename() {
    if (!renameTarget || !renameValue.trim()) return;
    const name = renameValue.trim();
    if (renameTarget.id === currentScene.id) {
      setCurrentScene(previous => ({ ...previous, name }));
      setSession(previous => ({ ...previous, history: previous.history.map(snapshot => ({ ...snapshot, title: name })) }));
      markSceneDirty(); setRenameTarget(null); setNotice('场景名称已修改，点击保存即可保留。');
      return;
    }
    setLibraryBusy(true);
    try { const renamed = await renameScene(renameTarget.id, name); if (!renamed) throw new Error('场景已被删除，请刷新列表。'); await refreshScenes(); setRenameTarget(null); setNotice('场景名称已保存。'); }
    catch (error) { setNotice(errorMessage(error)); }
    finally { setLibraryBusy(false); }
  }
  function exportProject() {
    if (guard({ type: 'projectBackup' })) return;
    downloadBlob(encodeSceneJsonBackup({ ...currentScene, project: sessionRef.current, audio: null, audioName, viewer: captureViewer() }), 'choreo-studio-project.json');
    setNotice('已下载场景数据备份。原音乐未包含，请另外保留。');
  }
  async function exportFullScene() {
    if (!ready || busy || !audioBlob) return;
    if (guard({ type: 'backup' })) return;
    const capturedTime = playing ? timelinePlayback.getTime() : time;
    pause(); setBusy('正在准备场景备份');
    const snapshot = sessionRef.current;
    try {
      await nextFrame();
      const blob = await encodeSceneBackup({ ...currentScene, project: snapshot, audio: audioBlob, audioName, audioClips, viewer: captureViewer(Math.max(0, Math.min(duration, capturedTime))) });
      downloadBlob(blob, `${safeFileName(currentScene.name)}.choreo`);
      setNotice('已下载完整场景包，包含原音乐、全部音轨、动作、历史与相机。可从“场景”重新导入。');
    } catch (error) { setNotice(`备份未完成：${errorMessage(error)}`); }
    finally { setBusy(''); }
  }
  function closeBackupImport() {
    importReadToken.current += 1;
    setImportOpen(false); setImportScene(null); setImportNeedsAudio(false); setImportError(''); setImportBusy(false);
    setAudioRecoveryTarget(null);
  }
  function openBackupImport() {
    setAudioRecoveryTarget(null);
    pause(); setImportOpen(true); setImportScene(null); setImportNeedsAudio(false); setImportError(''); setImportName('');
  }
  function openAudioRecovery() {
    setAudioRecoveryTarget({ sceneId: currentScene.id, countMapId: active.countMap.id });
    pause(); setImportOpen(true); setImportError(''); setImportNeedsAudio(true);
    setImportName(`${currentScene.name.slice(0, 75)} 恢复`);
    setImportScene({ ...currentScene, project: sessionRef.current, audio: null, audioName, viewer: captureViewer() });
  }
  async function validateImportedAudio(blob: Blob, project: Session) {
    if (!blob.size || blob.size > 100 * 1024 * 1024) throw new Error('原音乐必须在 100 MB 以内。');
    const context = new AudioContext();
    try {
      const audio = await context.decodeAudioData(await blob.arrayBuffer());
      if (!Number.isFinite(audio.duration) || audio.duration < 16 || audio.duration > 600) throw new Error('原音乐需为 16 秒至 10 分钟的可解码音频。');
      if (Math.abs(audio.duration - project.audioDuration) > 0.1) throw new Error('音乐时长与备份不一致，请选择备份时的原音乐。');
      if (project.history.some(item => item.countMap.sourceOffsetSeconds + item.countMap.durationSeconds > audio.duration + 0.01)) throw new Error('音乐不足以覆盖备份中的选段。');
    } finally { await context.close(); }
  }
  async function chooseSceneBackup(file: File | undefined) {
    if (!file || importBusy) return;
    const token = ++importReadToken.current;
    setImportBusy(true); setImportError(''); setImportScene(null); setImportNeedsAudio(false);
    setAudioRecoveryTarget(null);
    try {
      const result = await decodeSceneBackup(file);
      if (result.scene.audio) await validateImportedAudio(result.scene.audio, result.scene.project);
      if (token !== importReadToken.current) return;
      setImportScene(result.scene); setImportNeedsAudio(result.needsAudio);
      setImportName(`${result.scene.name.slice(0, 75)} 导入`);
    } catch (error) { if (token === importReadToken.current) setImportError(`无法导入：${errorMessage(error)}`); }
    finally { if (token === importReadToken.current) setImportBusy(false); }
  }
  async function associateBackupAudio(file: File | undefined) {
    if (!file || !importScene || importBusy) return;
    const token = ++importReadToken.current, target = importScene;
    setImportBusy(true); setImportError('');
    try {
      await validateImportedAudio(file, target.project);
      if (token !== importReadToken.current) return;
      setImportScene({ ...target, audio: file, audioName: file.name }); setImportNeedsAudio(false);
    } catch (error) { if (token === importReadToken.current) setImportError(`音乐未关联：${errorMessage(error)}`); }
    finally { if (token === importReadToken.current) setImportBusy(false); }
  }
  function confirmSceneImport() {
    if (!importScene?.audio || importNeedsAudio || !importName.trim() || importBusy || sceneActionBusy) return;
    setImportError('');
    if (audioRecoveryTarget) {
      requestSceneAction({ type: 'recoverAudio', ...audioRecoveryTarget, audio: importScene.audio, audioName: importScene.audioName, name: importName }); return;
    }
    const scene = createScene({ name: importName, project: { ...importScene.project, teacherCheckedRevision: null }, audio: importScene.audio, audioName: importScene.audioName, audioClips: importScene.audioClips, viewer: importScene.viewer });
    requestSceneAction({ type: 'import', scene });
  }

  // ── Music and timing ──────────────────────────────────────────────────────
  function openMusicSetup() {
    if (guard({ type: 'music' })) return;
    pause();
    music.show({ blob: audioBlob, name: audioName, duration: session.audioDuration, title: currentScene.name, countMap: active.countMap });
  }
  function confirmMusic() { if (active.plan || hasLegacyAuthoring || active.cameraTrack?.keys.length) { setPendingResetAction('music'); return; } performConfirmMusic(); }
  function performConfirmMusic() {
    const { draft, map } = music;
    if (!map || !draft.blob || music.decoding) return;
    const title = draft.title.trim();
    cameraGesture.current = null; setCameraRestoreExact(null); setCameraSelected(false); setCameraViewOverride(false);
    cancelAssistance(); music.close(); pause();
    setAudioBlob(draft.blob); setAudioName(draft.name); setTime(0); setSelected(0); setRange(null);
    // Additional audio tracks are independent of the CountMap; keep those that still fit.
    const keptTracks = fitAudioTracks(active.audioTracks, map.durationSeconds);
    const neutral = neutralSnapshot(map, title || '未命名组合');
    setSession(previous => ({ history: [keptTracks.length ? { ...neutral, audioTracks: keptTracks } : neutral], historyIndex: 0, revision: previous.revision + 1, audioDuration: draft.duration, teacherCheckedRevision: null }));
    setQueuedAction(null); markSceneDirty(); setPage('studio');
    setCurrentScene(previous => ({ ...previous, name: title || UNTITLED_SCENE_NAME }));
    setNotice('音乐和选段已确认。可用 AI 生成人物动作，并在时间线上编排镜头。');
  }

  // ── Viewing modes ─────────────────────────────────────────────────────────
  function openTeachingPreview() {
    if (guard({ type: 'teaching' })) return;
    pause(); deselectCamera(); setPage(previous => previous === 'teaching' ? 'studio' : 'teaching');
    setPreviewAssist(false);
  }
  const canReviewTeaching = page === 'teaching' && !!active.take && !previewAssist && ready && !busy && !sceneActionBusy && saveStatus !== 'saving';
  function setTeachingReview(checked: boolean) {
    if (!canReviewTeaching) return;
    setSession(previous => {
      const next = { ...previous, teacherCheckedRevision: checked ? previous.revision : null };
      sessionRef.current = next; return next;
    });
    markSceneDirty();
    setNotice(checked ? '已记录本版试看。试看记录不代表真实动作已通过教学审核。' : '已撤销本版试看记录。');
  }

  // ── Guarded action queue ──────────────────────────────────────────────────
  function executeGuardedAction(action: GuardedAction) {
    switch (action.type) {
      case 'seek': seek(action.time); break;
      case 'scene': requestSceneAction(action.action); break;
      case 'history': navigateHistory(action.direction); break;
      case 'play': void togglePlay(); break;
      case 'save': void performSave(); break;
      case 'music': openMusicSetup(); break;
      case 'teaching': openTeachingPreview(); break;
      case 'backup': void exportFullScene(); break;
      case 'projectBackup': exportProject(); break;
      case 'moveAudio': performAudioMove(action); break;
      case 'assist': void generateAssistance(action.prompt); break;
      case 'adoptAssist': adoptAssistance(); break;
      case 'previewAssist': showAssistCandidate(); break;
    }
  }
  useEffect(() => {
    if (!queuedAction) return;
    setQueuedAction(null); executeGuardedAction(queuedAction);
  }, [queuedAction]);
  function confirmResetAction() {
    const action = pendingResetAction; setPendingResetAction(null);
    if (action === 'music') performConfirmMusic();
    else if (action === 'adoptAssist') performAdoptAssistance();
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return <div className="app-shell studio" style={{ '--timeline-overlay-height': `${timelineInset}px` } as CSSProperties}>
    <audio ref={audioRef} src={audioUrl || undefined} preload="auto" onLoadedMetadata={timelinePlayback.syncAudio} onError={() => { if (ready && audioUrl) setNotice('音乐无法播放。请重新导入支持的音频格式。'); }} />
    <main className="main-content">
      <StudioHeader sceneName={currentScene.name} saveStatus={saveStatus} history={session.history} historyIndex={session.historyIndex}
        ready={ready} busy={!!busy} playing={playing} sceneBusy={sceneActionBusy} hasAudio={!!audioBlob}
        teaching={{ active: page === 'teaching', checked: session.teacherCheckedRevision === session.revision, canMark: canReviewTeaching, canUnmark: !busy && !sceneActionBusy && saveStatus !== 'saving' }}
        onRename={() => startRename({ id: currentScene.id, name: currentScene.name })} onLibrary={() => { void openLibrary(); }}
        onUndo={() => navigateHistory(-1)} onRedo={() => navigateHistory(1)} onJumpHistory={jumpHistory} onSave={() => { void save(); }}
        onMusic={openMusicSetup} onTeaching={openTeachingPreview} onTeachingReview={setTeachingReview} onAbout={() => setAboutOpen(true)}
        onExportProject={exportProject} onExportScene={() => { void exportFullScene(); }} />
      <section className="workspace-content">
        {ready && !audioBlob && <div className="missing-audio" role="alert"><strong>原音乐缺失</strong><p>动作与数拍仍在。请关联原曲后恢复为新场景，当前作品会保留。</p><button className="button secondary compact" onClick={openAudioRecovery} disabled={!!busy || sceneActionBusy}>恢复原音乐</button></div>}
        <section className="viewer-panel" aria-label="3D动作预览">
          <div className="stage-area">
            <CameraBar view={view} canFrame={!!displayedTake && ready && !busy} camera={camera?.position ?? null} avatar={avatar} onAvatar={chooseAvatar} onView={chooseView} onFrame={frameActor}>
              {page === 'studio' && <AIDock busy={assistBusy}>
                <AIPanel onGenerate={prompt => { void generateAssistance(prompt); }} onCancel={cancelAssistance} busy={assistBusy} range={range} duration={duration}
                  disabled={!ready || !active.take || !!busy || assistBusy || modalOpen} error={assistError} />
              </AIDock>}
            </CameraBar>
            <div className="stage-wrap">
              <Stage take={displayedTake} poseSampler={displayedMotionSampler} time={time} getPlaybackTime={timelinePlayback.getTime} view={view} mirror={mirror}
                cameraState={camera ?? undefined} cameraTrackState={cameraTrackState} cameraTrackSampler={!cameraViewOverride ? cameraSampler ?? undefined : undefined} cameraRestoreExact={cameraRestoreExact} cameraEditRevision={session.revision}
                cameraCancelKey={cameraCancelKey} cameraTrackEditing={cameraSelected && cameraCanEdit()} onCameraGesture={handleCameraGesture}
                cameraResetKey={cameraResetKey} cameraRestoreKey={cameraRestoreKey} cameraFocus={cameraFocus ?? undefined}
                onCameraChange={handleCameraChange} onCameraInteraction={handleCameraInteraction}
                selectedJoint={null} jointPicking={false} timelineKeys editMode={false} transformTool="select" playing={playing}
                avatar={avatar} onAvatarError={message => { setNotice(`人物更换失败：${message}`); chooseAvatar(DEFAULT_AVATAR); }} />
            </div>
          </div>
          {ready && <TimelineDock ref={timelineDockRef}>
            {assistCandidate && <AssistCandidatePanel summary={assistCandidate.summary} target={assistCandidate.target} quality={assistCandidate.quality} previewing={previewAssist} valid={validAssistCandidate()}
              onTogglePreview={toggleAssistPreview} onAdopt={adoptAssistance} onClose={closeAssistCandidate} />}
            <SceneTimeline duration={duration} time={time} playing={playing} readOnly={!editing || workLocked || mirror}
              countTimes={active.countMap.countTimesSeconds} range={shownRange} onRange={changeRange} onTime={seek}
              loop={loop} onLoop={() => { setLoop(!loop); markSceneDirty(); }}
              camera={{ track: active.cameraTrack, value: cloneCameraPose(cameraValue), selected: cameraSelected, onSelect: selectCameraPoint, onAdd: addCameraPoint, onChange: changeCameraPoint, onMove: moveCameraPoint, onDelete: deleteCameraPoint, onDeselect: deselectCamera }}
              audio={{ name: audioName, offsetSeconds: active.audioOffsetSeconds ?? 0, durationSeconds: duration, waveform, onMove: moveAudio, disabled: !audioBlob }}
              audioTracks={{ tracks: audioTrackLanes, canAdd: audioTracks.length < AUDIO_TRACK_LIMITS.tracks && !busy, onAdd: file => { void addAudioTrack(file); }, onMove: moveAudioTrack, onSplit: splitAudioTrackAt, onTrim: trimAudioTrack, onRemoveSegment: removeAudioTrackSegment, onToggleMute: toggleAudioTrackMute, onRemove: removeAudioTrack }}
              transport={<PlaybackTransport playing={playing} disabled={!displayedTake || !ready || !audioBlob} time={time} duration={duration} count={`${countPosition.octet}-${countPosition.count}`} onToggle={() => { void togglePlay(); }} />}
              playbackOptions={<PlaybackOptions rate={rate} mirror={mirror} countSound={countSound}
                onRate={value => { setRate(value); markSceneDirty(); }} onMirror={() => { setMirror(!mirror); markSceneDirty(); }} onCountSound={() => { setCountSound(!countSound); markSceneDirty(); }} />}
            />
          </TimelineDock>}
        </section>
      </section>
    </main>

    {notice && <Toast message={notice} onClose={() => setNotice('')} />}

    {importOpen && <BackupImportDialog scene={importScene} name={importName} needsAudio={importNeedsAudio} error={importError} reading={importBusy} saving={sceneActionBusy}
      onName={setImportName} onChooseBackup={file => { void chooseSceneBackup(file); }} onChooseAudio={file => { void associateBackupAudio(file); }} onConfirm={confirmSceneImport} onClose={closeBackupImport} />}
    {pendingResetAction && <ConfirmDialog titleId="reset-keys-title" confirmLabel="确认并继续" onCancel={() => setPendingResetAction(null)} onConfirm={confirmResetAction}
      title={pendingResetAction === 'adoptAssist' ? '采用 AI 候选并替换当前动作？' : '替换当前动作与镜头并继续？'}
      intro={pendingResetAction === 'adoptAssist' ? '采用候选会替换整段人物播放内容；原始动作与作者数据保留，可撤销恢复。镜头与音乐不变。' : '调整音乐与数拍会清空当前人物动作和镜头关键帧，并创建新的中立姿态场景。请先保存或复制场景以保留原作品。'} />}
    {libraryOpen && <SceneLibraryDialog scenes={sceneList} currentId={currentScene.id} currentName={currentScene.name} loading={libraryBusy} busy={sceneActionBusy} importDisabled={!!busy}
      onClose={() => setLibraryOpen(false)} onImport={openBackupImport} onNew={() => requestSceneAction({ type: 'new' })}
      onOpen={id => requestSceneAction({ type: 'open', id })} onCopy={id => requestSceneAction({ type: 'copy', id })}
      onRename={(id, name) => startRename({ id, name })} onDelete={(id, name) => setDeleteTarget({ id, name })} />}
    {pendingSceneAction && <Dialog titleId="unsaved-title" title="保留当前场景的修改？" eyebrow="未保存的修改" layer="guard" className="scene-confirm-modal"
      intro={<>「{currentScene.name}」有未保存的更改。选择保存后继续，或放弃这次修改。{pendingSceneAction.type === 'delete' && '继续后将删除该场景。'}{!audioBlob && (pendingSceneAction.type === 'recoverAudio' ? ' 原音乐缺失，无法保存旧场景；继续恢复会把最新作品与原音乐保存为新场景。' : ' 原音乐缺失，当前无法保存；请先恢复原音乐，或明确选择不保存继续。')}</>}>
      <div className="scene-guard-actions">
        <button className="button secondary" disabled={sceneActionBusy} onClick={() => setPendingSceneAction(null)}>取消</button>
        <button className="button secondary" disabled={sceneActionBusy} onClick={() => { void executeSceneAction(pendingSceneAction); }}>不保存，继续</button>
        <button className="button primary" disabled={sceneActionBusy || !audioBlob} onClick={() => { void saveThenContinue(); }}>{sceneActionBusy ? <LoaderCircle className="spin" size={15} /> : <Save size={15} />}保存后继续</button>
      </div>
    </Dialog>}
    {renameTarget && <Dialog titleId="rename-title" title="修改场景名称" layer="guard" className="scene-confirm-modal" closeLabel="取消场景改名" onClose={() => setRenameTarget(null)}>
      <label className="field rename-field">场景名称<input autoFocus value={renameValue} maxLength={80} onChange={event => setRenameValue(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') void confirmRename(); }} /></label>
      <div className="modal-actions">
        <button className="button secondary" onClick={() => setRenameTarget(null)}>取消</button>
        <button className="button primary" disabled={!renameValue.trim() || libraryBusy} onClick={() => { void confirmRename(); }}>确认改名</button>
      </div>
    </Dialog>}
    {deleteTarget && <ConfirmDialog titleId="delete-title" title="删除这个本机场景？" confirmLabel="删除场景" confirmTone="danger" confirmDisabled={sceneActionBusy}
      intro={`将删除「${deleteTarget.name}」及其本机保存的音乐。其他场景保持原样。`}
      onCancel={() => setDeleteTarget(null)} onConfirm={() => { const id = deleteTarget.id; setDeleteTarget(null); requestSceneAction({ type: 'delete', id }); }} />}
    {music.open && <MusicSetupDialog setup={music} onConfirm={confirmMusic} />}
    {aboutOpen && <AboutDialog onClose={() => setAboutOpen(false)} />}
  </div>;
}

/** Short feedback near the work; errors read as warnings, not confirmations. */
function Toast({ message, onClose }: { message: string; onClose: () => void }) {
  const warning = /失败|无法|不能|未完成|未保存|缺失|错误|请先|请重新|已改变|不可用|阻止|无效|超出/.test(message);
  return <div className={`toast ${warning ? 'warning' : ''}`} role="status">
    {warning ? <AlertTriangle size={17} /> : <CheckCircle2 size={17} />}
    <span>{message}</span>
    <button aria-label="关闭提示" onClick={onClose}><X size={15} /></button>
  </div>;
}
