import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { AlertTriangle, CheckCircle2, LoaderCircle, Save, X } from 'lucide-react';
import {
  addFootLock, analyzePose, analyzeStepAssistance, applyFootLocks, bakeKeyframeSequence, buildAICandidate, canonicalEditRotation, captureFootLock,
  cloneCameraPose, createCameraTrackSampler, EDITABLE_JOINT_NAMES, evaluatePose, frameAtTime, frameTime, getKeyframeCount, JOINT_NAMES,
  makeCameraTrack, makeKeyframeSequence, moveCameraKeyframe, removeCameraKeyframe, removeFootLock, removeMotionPointEdit, removePoseKeyframe,
  removeRootKeyframe, removeRotationKeyframe, removeStepAssistance, sameCameraPose, sampleTake, setStepAssistance, simulatePhysicsTake, solveLimbIK,
  STANDARD_HUMAN_PROFILE, transferKeyframes, upsertCameraKeyframe, upsertMotionPointChanges, validateCameraPose,
  type ArrangementPlan, type BakedTake, type CameraPose, type IKEffector, type JointName, type KeyframeSequence, type KeyframeTransferInput,
  type KeyframeTransferTrack, type LockedFoot, type Pose, type Quat, type SampledCameraPose, type StepAssistanceReport, type Vec3,
} from '../../../packages/core/src';
import { getIKEffector, Stage, STAGE_JOINT_LABELS, type StageCamera, type StageCameraFocus, type StageTransformTool, type StageView } from './Stage';
import { KeyframeTimeline } from './KeyframeEditor';
import { RealismPanel } from './RealismPanel';
import AIPanel from './AIPanel';
import { requestAIArrangement } from './aiClient';
import { demoAudio } from './demoAudio';
import { deleteScene, duplicateScene, listScenes, loadCurrentScene, loadScene, renameScene, saveScene, setCurrentScene as selectStoredScene } from './storage';
import { createScene, type SceneDocument, type SceneMetadata, type SceneViewer } from './scene';
import { decodeSceneBackup, encodeSceneBackup, encodeSceneJsonBackup } from './sceneBackup';
import type { SceneSnapshot as Snapshot, SceneProject as Session } from './sceneProject';
import { snapAudioOffset } from './audioTimeline';
import { useModalFocus } from './useModalFocus';
import { useEditorShortcuts } from './useEditorShortcuts';
import { useTimelinePlayback } from './useTimelinePlayback';
import { useAudioWaveform } from './useAudioWaveform';
import { useCountCue } from './hooks/useCountCue';
import { useMusicSetup } from './hooks/useMusicSetup';
import { useFloatingMenus } from './hooks/useFloatingMenus';
import { useNotice, useOverlayInset, useUnsavedGuard } from './hooks/useLayoutHelpers';
import { authorProtection, clonePose, motionIsDynamic, posesDiffer, rootsDiffer, rotationsDiffer } from './editor/poseMath';
import { blankSceneDocument, DEMO_AUDIO_NAME, FIRST_SCENE_NAME, initialSession, manualViewer, neutralSnapshot, UNTITLED_SCENE_NAME } from './editor/sceneModel';
import { downloadBlob, errorMessage, safeFileName } from './editor/format';
import { StudioHeader, type SaveStatus } from './components/StudioHeader';
import { CameraBar, SceneExtras, StageDiagnostics, StageEditTools } from './components/StageOverlays';
import { TimelineDock } from './components/TimelineDock';
import { PlaybackOptions, PlaybackTransport } from './components/Playback';
import { AssistCandidatePanel } from './components/AssistCandidatePanel';
import { ConfirmDialog, Dialog } from './dialogs/Dialog';
import { SceneLibraryDialog } from './dialogs/SceneLibraryDialog';
import { BackupImportDialog } from './dialogs/BackupImportDialog';
import { MusicSetupDialog } from './dialogs/MusicSetupDialog';
import { AboutDialog } from './dialogs/AboutDialog';

type SceneAction = { type: 'new' } | { type: 'open' | 'copy' | 'delete'; id: string } | { type: 'import'; scene: SceneDocument<Session> } | { type: 'recoverAudio'; sceneId: string; countMapId: string; audio: Blob; audioName: string; name: string };
type KeyframeDeleteTarget = { kind: 'joint'; joint: JointName; frame: number } | { kind: 'root' | 'pose'; frame: number };
type TransferAction = { type: 'transferKeys'; originTime: number; request: KeyframeTransferInput; sceneId: string; countMapId: string };
type AudioMoveAction = { type: 'moveAudio'; offsetSeconds: number; sceneId: string; countMapId: string };
type PoseAction = AudioMoveAction | TransferAction | { type: 'seek'; time: number } | { type: 'scene'; action: SceneAction } | { type: 'history'; direction: -1 | 1 } | { type: 'deleteKey'; target: KeyframeDeleteTarget } | { type: 'play' | 'save' | 'music' | 'teaching' | 'backup' | 'projectBackup' };
type PendingTransfer = { action: TransferAction; sequenceId: string; revision: number; collisions: KeyframeTransferTrack[] };
type ResetAction = 'music' | 'adoptAssist';
type AssistKind = 'ai' | 'physics' | 'steps';
type AssistAction = { type: 'assist'; kind: AssistKind; prompt?: string } | { type: 'adoptAssist' } | { type: 'previewAssist' } | { type: 'lockFoot'; foot: LockedFoot; endFrame: number } | { type: 'removeLock'; id: string } | { type: 'removeSteps' };
/** Any action that must first resolve an in-progress pose or camera gesture. */
type GuardedAction = PoseAction | AssistAction;
type AssistPayload = { kind: 'ai' | 'physics'; plan: ArrangementPlan | null; take: BakedTake; summary: string } | { kind: 'steps'; plan: ArrangementPlan | null; take: BakedTake; summary: string; manual: KeyframeSequence; report: StepAssistanceReport; baseSequenceId: string };
type AssistCandidate = AssistPayload & { sceneId: string; countMapId: string; baseRevision: number };
type PointGesture = { sceneId: string; revision: number; time: number; snapshot: Snapshot; sequence: KeyframeSequence; before: Pose };
type CameraGesture = { sceneId: string; revision: number; time: number; snapshot: Snapshot; before: CameraPose; latest: CameraPose; status: SaveStatus; version: number; override: boolean };
type NamedTarget = { id: string; name: string };

const DEFAULT_CAMERA: StageCamera = { position: [2.4, 1.85, 4], target: [0, 1.04, 0], zoom: 1 };
const cameraMatches = (a: StageCamera | null, b: StageCamera) => !!a && [...a.position, ...a.target, a.zoom ?? 1].every((value, index) => Math.abs(value - [...b.position, ...b.target, b.zoom ?? 1][index]) < 1e-6);
const trackLabel = (track: JointName | 'root') => track === 'root' ? '整体位移' : STAGE_JOINT_LABELS[track];
const nextFrame = () => new Promise<void>(resolve => requestAnimationFrame(() => resolve()));

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

  // ── Audio and playback ────────────────────────────────────────────────────
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [audioName, setAudioName] = useState(DEMO_AUDIO_NAME);
  const [audioUrl, setAudioUrl] = useState('');
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [rate, setRate] = useState(1);
  const [loop, setLoop] = useState(false);
  const [countSound, setCountSound] = useState(false);
  const [mirror, setMirror] = useState(false);
  const [selected, setSelected] = useState(0);
  const [page, setPage] = useState<'studio' | 'teaching'>('studio');
  const audioRef = useRef<HTMLAudioElement>(null);
  const cue = useCountCue();
  const music = useMusicSetup(cue);

  // ── Camera ────────────────────────────────────────────────────────────────
  const [view, setView] = useState<StageView>('front');
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

  // ── Pose authoring ────────────────────────────────────────────────────────
  const [selectedJoint, setSelectedJoint] = useState<JointName | null>(null);
  const [selectedPoint, setSelectedPoint] = useState<JointName | 'root' | null>(null);
  const [jointPosition, setJointPosition] = useState<Vec3 | null>(null);
  const [transformTool, setTransformTool] = useState<StageTransformTool>('rotate');
  const [poseDraft, setPoseDraft] = useState<Pose | null>(null);
  // Presentation only: preview corrections never enter author data or history.
  const [collisionPreview, setCollisionPreview] = useState(false);
  const [queuedAction, setQueuedAction] = useState<GuardedAction | null>(null);
  const [pendingResetAction, setPendingResetAction] = useState<ResetAction | null>(null);
  const [pendingTransfer, setPendingTransfer] = useState<PendingTransfer | null>(null);
  const [ikTarget, setIKTarget] = useState<Vec3 | null>(null);
  const [ikResidual, setIKResidual] = useState<number | null>(null);
  const sessionRef = useRef(session);
  const sceneChangeVersion = useRef(0);
  const poseDraftRef = useRef<Pose | null>(null);
  const draftRotationIntents = useRef(new Set<JointName>());
  const draftRootIntent = useRef(false);
  const poseDraftBaseline = useRef<{ status: SaveStatus; version: number } | null>(null);
  const pointGesture = useRef<PointGesture | null>(null);

  // ── Optional assistance (AI, physics, steps) ──────────────────────────────
  const [assistCandidate, setAssistCandidate] = useState<AssistCandidate | null>(null);
  const [previewAssist, setPreviewAssist] = useState(false);
  const [assistBusy, setAssistBusy] = useState<AssistKind | null>(null);
  const [assistProgress, setAssistProgress] = useState(0);
  const [assistError, setAssistError] = useState('');
  const assistRun = useRef<{ controller: AbortController; sceneId: string; revision: number; countMapId: string } | null>(null);
  const stepReportCache = useRef(new WeakMap<KeyframeSequence, StepAssistanceReport>());

  // ── Derived state ─────────────────────────────────────────────────────────
  const storedActive = session.history[session.historyIndex];
  // Old music-only saves remain untouched until the first real edit, but are editable now.
  const active = useMemo(() => {
    if (storedActive.take) return storedActive;
    const neutral = neutralSnapshot(storedActive.countMap, storedActive.title, storedActive.plan?.id);
    return { ...storedActive, take: neutral.take, manual: storedActive.manual ?? neutral.manual };
  }, [storedActive]);
  const duration = active.countMap.durationSeconds;
  const cameraSampler = useMemo(() => active.cameraTrack ? createCameraTrackSampler(active.cameraTrack, duration) : null, [active.cameraTrack, duration]);
  const sampledCamera = useMemo(() => cameraSampler?.(time) ?? null, [cameraSampler, time]);
  const cameraTrackState = !cameraViewOverride && !previewAssist ? sampledCamera : null;
  const cameraValue = cameraTrackState ?? camera ?? DEFAULT_CAMERA;
  const manualSequence = useMemo(() => active.manual ?? (active.take ? makeKeyframeSequence(active.take) : null), [active.manual, active.take]);
  const editorFrame = frameAtTime(time, duration);
  const editorPose = poseDraft ?? (active.take ? sampleTake(active.take, time) : null);
  const manualKeyCount = useMemo(() => active.manual ? getKeyframeCount(active.manual) : 0, [active.manual]);
  const hasManualKeys = manualKeyCount > 0 || !!active.manual?.footLocks?.length || !!active.manual?.steps;
  const stepReport = useMemo(() => active.manual?.steps ? cachedStepReport(active.manual) : null, [active.manual]);
  const displayedTake = previewAssist && assistCandidate ? assistCandidate.take : active.take;
  const manualEditing = page === 'studio' && !previewAssist;
  const modalOpen = libraryOpen || importOpen || music.open || aboutOpen || !!renameTarget || !!deleteTarget || !!pendingSceneAction || !!pendingResetAction || !!pendingTransfer;
  /** Work-level locks: a dialog, a long operation or a save in progress. */
  const workLocked = modalOpen || !!busy || sceneActionBusy || saveStatus === 'saving';
  const activeTransformTool = manualEditing && !cameraSelected ? transformTool : 'select';
  const editableSelectedJoint = selectedJoint !== null && JOINT_NAMES.includes(selectedJoint);
  const rotateUnavailable = !active.take ? '请先新建或导入场景。' : !selectedJoint ? '先点击人物，选择要调整的部位。' : !editableSelectedJoint ? '末端节点只读；请选择肩、肘、髋等可旋转关节。' : busy ? '请等待当前操作完成。' : null;
  const toolHelp = describeTool();

  const timelineOverlayRef = useRef<HTMLDivElement>(null);
  /** Body parts pointed at from Timeline track headers; display only. */
  const [linkedJoints, setLinkedJoints] = useState<readonly JointName[] | null>(null);
  const timelineInset = useOverlayInset(timelineOverlayRef, !!manualSequence, 0);
  const timelinePlayback = useTimelinePlayback({
    restoreKey: `${currentScene.id}:${session.historyIndex}:${session.revision}`, audioRef, countMap: active.countMap, audioOffsetSeconds: active.audioOffsetSeconds ?? 0,
    rate, loopRange: loop ? { startSeconds: 0, endSeconds: duration } : null,
    time, onTimeChange: setTime, onPlayingChange: setPlaying,
    onError: () => setNotice('音频尚未就绪，或浏览器阻止了播放。请再点一次播放。'),
    beforePlay: cue.prepare,
  });
  const waveform = useAudioWaveform(audioBlob, active.countMap);

  function describeTool(): string {
    if (!active.take) return '请先新建或导入场景。';
    if (previewAssist) return '正在看辅助候选。点旋转或移动，将切回原稿编辑。';
    if (page === 'teaching') return '点旋转或移动，返回编舞工作台编辑原稿。';
    if (playing) return '点旋转或移动，暂停在当前帧开始编辑。';
    if (collisionPreview) return '碰撞预览中 · 点选部位或工具，恢复原姿态继续编辑。';
    if (mirror) return '点旋转或移动，退出镜像后编辑原始姿态。';
    if (manualEditing && transformTool === 'ik') return '拖动手脚目标 · 松开自动记录实际变化的关节';
    if (manualEditing && transformTool === 'translate') return '拖动 XYZ 箭头移动全身 · 世界空间（m）';
    if (manualEditing && transformTool === 'rotate') return editableSelectedJoint ? '拖动 XYZ 旋转环摆姿 · 相对父骨骼' : rotateUnavailable ?? '';
    if (selectedJoint) return editableSelectedJoint ? '已选中关节。点「旋转关节」开始摆姿。' : rotateUnavailable ?? '';
    return '点击关节点选择，再旋转关节；移动作用于整个角色。';
  }
  /** Persistable viewer state; never contains drafts, candidates or selection previews. */
  function captureViewer(at = time): SceneViewer {
    return { ...currentScene.viewer, view, camera: cameraRef.current, mirror, rate, loop, countSound, selectedSlot: selected, selectedJoint, time: at, editorMode: 'keyframes', transformTool };
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
      case 'key-transfer-title': setPendingTransfer(null); break;
      case 'rename-title': setRenameTarget(null); break;
      case 'delete-title': setDeleteTarget(null); break;
      case 'backup-import-title': closeBackupImport(); break;
      case 'library-title': setLibraryOpen(false); break;
      case 'create-title': music.close(); break;
      case 'about-title': setAboutOpen(false); break;
    }
  } });

  useEditorShortcuts({
    enabled: ready && manualEditing && !!active.take && !modalOpen && !busy && !sceneActionBusy && saveStatus !== 'saving',
    readOnly: mirror,
    onStep: direction => {
      if (playing) return;
      const next = Math.max(0, Math.min(Math.ceil(duration * 30), editorFrame + direction));
      if (next !== editorFrame) seek(frameTime(next, duration));
    },
    onPlay: () => { void togglePlay(); },
    onDelete: () => { if (!playing) deleteSelectedPoint(); },
    onUndo: () => { if (!playing) navigateHistory(-1); },
    onRedo: () => { if (!playing) navigateHistory(1); },
    onSave: () => { if (audioBlob) void save(); },
  });
  useFloatingMenus();

  useEffect(() => { sessionRef.current = session; }, [session]);
  useEffect(() => { cancelAssistance(); setAssistCandidate(null); setPreviewAssist(false); setIKTarget(null); setIKResidual(null); }, [currentScene.id, active.countMap.id, session.revision]);
  useEffect(() => { setIKTarget(null); setIKResidual(null); }, [editorFrame, selectedJoint]);
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
  useUnsavedGuard(useCallback(() => saveStatus !== 'saved' || !!poseDraftRef.current, [saveStatus]), ready);
  useEffect(() => { if (modalOpen && timelinePlayback.isPending()) pause(); }, [modalOpen]);

  // ── Playback and time ─────────────────────────────────────────────────────
  function pause() {
    const wasPlaying = timelinePlayback.isPlaying();
    const raw = timelinePlayback.pause();
    if (wasPlaying) timelinePlayback.seek(frameTime(frameAtTime(raw, duration), duration));
  }
  function seek(next: number) {
    if (timelinePlayback.isPending()) pause();
    if (guardPose({ type: 'seek', time: next })) return;
    seekDirect(Math.max(0, Math.min(duration, next)));
  }
  /** Timeline positioning shows the derived collision preview; edits show the author pose. */
  function seekDirect(next: number, presentation: 'author' | 'preview' = 'preview') {
    setCollisionPreview(presentation === 'preview');
    setCameraViewOverride(false); timelinePlayback.seek(next);
  }
  async function togglePlay() {
    if (playing || timelinePlayback.isPending()) { pause(); return; }
    if (guardPose({ type: 'play' })) return;
    if (!displayedTake || !audioRef.current || !ready || !audioBlob) return;
    setCollisionPreview(true);
    setCameraViewOverride(false);
    const start = loop ? 0 : time >= duration - .01 ? 0 : time;
    await timelinePlayback.play(start);
  }
  function currentEditTime() {
    const rawTime = playing ? timelinePlayback.getTime() : time;
    return Math.max(0, Math.min(duration, rawTime));
  }
  function moveAudio(offsetSeconds: number) {
    if (playing || !manualEditing || mirror || busy || !audioBlob) return;
    const action: AudioMoveAction = { type: 'moveAudio', offsetSeconds: snapAudioOffset(offsetSeconds, duration), sceneId: currentScene.id, countMapId: active.countMap.id };
    if (guardPose(action)) return;
    performAudioMove(action);
  }
  function performAudioMove(action: AudioMoveAction) {
    if (action.sceneId !== currentScene.id || action.countMapId !== active.countMap.id || playing || !manualEditing || mirror || busy) return;
    if (action.offsetSeconds === (active.audioOffsetSeconds ?? 0)) return;
    commit({ ...active, audioOffsetSeconds: action.offsetSeconds }, { label: '移动音乐' });
  }

  // ── History ───────────────────────────────────────────────────────────────
  /** Every committed change is one history entry and a new revision. */
  function commit(next: Snapshot, operation: Snapshot['operation'] = { label: '编辑场景' }) {
    next = { ...next, operation };
    setCollisionPreview(false);
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
    if (poseDraftRef.current) cancelPointGesture();
    cancelCameraGesture(true); restoreHistoryCamera(session.history[next], next - session.historyIndex);
    moveHistoryIndex(next);
    const operationTime = session.history[next].operation?.time;
    if (operationTime !== undefined) seekDirect(operationTime, 'author');
    else setCollisionPreview(false);
    markSceneDirty();
  }
  function navigateHistory(direction: -1 | 1) {
    if (guardPose({ type: 'history', direction })) return;
    const next = session.historyIndex + direction;
    if (next < 0 || next >= session.history.length) return;
    setCollisionPreview(false);
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
  const handleJointPosition = useCallback((position: Vec3 | null) => { setJointPosition(position); }, []);
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
  function cameraCanEdit() { return manualEditing && !!active.take && !playing && !mirror && !workLocked; }
  function selectCameraTrack() { setCameraSelected(true); setSelectedJoint(null); setSelectedPoint(null); setTransformTool('select'); }
  function restoreGestureStatus(gesture: CameraGesture) { if (gesture.version === sceneChangeVersion.current) setSaveStatus(gesture.status); }
  function selectCameraPoint(exactTime: number) {
    if (!cameraCanEdit()) return;
    if (poseDraftRef.current && !recordPointChanges()) return;
    finishCameraGesture(); seekDirect(exactTime);
    selectCameraTrack();
  }
  function cancelCameraGesture(stopStage = false) {
    const gesture = cameraGesture.current; cameraGesture.current = null;
    if (!gesture) return;
    if (stopStage) setCameraCancelKey(previous => previous + 1);
    setCamera(cloneCameraPose(gesture.before));
    // Stage restores the exact camera and runtime up before issuing cancel.
    // A legacy restore here would clamp that already-restored authored view.
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
      selectCameraTrack();
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
  function focusCamera(kind: 'actor' | 'joint') {
    if (!displayedTake || !ready || busy || (kind === 'joint' && !selectedJoint)) return;
    finishCameraGesture(); setCameraRestoreExact(null); setCameraViewOverride(true);
    setCameraFocus({ key: ++cameraFocusCounter.current, kind, joint: kind === 'joint' ? selectedJoint! : undefined });
  }

  // ── Selection and tools ───────────────────────────────────────────────────
  function chooseJoint(joint: JointName | null) {
    finishCameraGesture(); setCameraSelected(false);
    if (joint) {
      if (playing && manualEditing) { const exactTime = currentEditTime(); pause(); seekDirect(exactTime, 'author'); }
      else setCollisionPreview(false);
    }
    setSelectedJoint(joint); setSelectedPoint(joint);
    if (joint && transformTool === 'select') setTransformTool('rotate');
    markSceneDirty();
  }
  function selectMotionPoint(exactTime: number, point: JointName | 'root') {
    if (playing || !manualEditing || modalOpen || busy) return;
    seek(exactTime); setCollisionPreview(false); setCameraSelected(false); setSelectedPoint(point);
    if (point === 'root') setTransformTool('translate');
    else { setSelectedJoint(point); setTransformTool('rotate'); }
  }
  function chooseTransformTool(tool: StageTransformTool) {
    if (tool === 'select') { finishCameraGesture(); setCameraSelected(false); setTransformTool(tool); markSceneDirty(); return; }
    if (!active.take || busy || (tool === 'rotate' && !editableSelectedJoint) || (tool === 'ik' && !getIKEffector(selectedJoint))) return;
    const snapped = currentEditTime();
    const wasPreview = previewAssist;
    finishCameraGesture(); setCameraSelected(false); pause(); setMirror(false); setPreviewAssist(false); setPage('studio'); setTransformTool(tool); setSelectedPoint(tool === 'translate' ? 'root' : selectedJoint);
    seekDirect(snapped, 'author'); markSceneDirty();
    if (wasPreview) setNotice('已切回原稿编辑。候选尚未采用，松开后自动记录修改的数据点。');
  }

  // ── Pose gestures: one gesture records one history entry ──────────────────
  /** Resolve an in-progress gesture first; the action reruns once it is recorded. */
  function guardPose(action: GuardedAction): boolean {
    if (cameraGesture.current && finishCameraGesture()) { setQueuedAction(action); return true; }
    if (!poseDraftRef.current) return false;
    if (!recordPointChanges()) return true;
    setQueuedAction(action); return true;
  }
  function clearPoseDraft(restoreStatus = false) {
    const baseline = poseDraftBaseline.current;
    poseDraftRef.current = null; setPoseDraft(null); poseDraftBaseline.current = null;
    draftRotationIntents.current.clear(); draftRootIntent.current = false;
    setIKTarget(null); setIKResidual(null);
    if (restoreStatus && baseline && baseline.version === sceneChangeVersion.current) setSaveStatus(baseline.status);
  }
  function updatePoseDraft(next: Pose): boolean {
    if (timelinePlayback.isPending()) pause();
    if (!active.take || playing || mirror || !manualEditing || modalOpen) return false;
    const reference = pointGesture.current?.before ?? sampleTake(active.take, time);
    const previous = poseDraftRef.current ?? reference;
    let copied = clonePose(next);
    // Stage drag/IK propose constrained poses; direct numbers and explicit
    // reuse express the author's intent. Automatic contacts must not replace it.
    for (const joint of JOINT_NAMES) {
      if (!rotationsDiffer(copied.joints[joint], previous.joints[joint])) continue;
      if (rotationsDiffer(copied.joints[joint], reference.joints[joint])) draftRotationIntents.current.add(joint);
      else draftRotationIntents.current.delete(joint);
    }
    if (rootsDiffer(copied.root, previous.root)) draftRootIntent.current = rootsDiffer(copied.root, reference.root);
    if (manualSequence?.footLocks?.length) copied = applyFootLocks(copied, manualSequence.footLocks, time * 30, duration, authorProtection(manualSequence, time * 30, draftRotationIntents.current, draftRootIntent.current)).pose;
    // Linked IK/contact output uses the exact unit tuple the point writer will
    // store. Retained source channels are never normalized here.
    for (const joint of JOINT_NAMES) if (rotationsDiffer(copied.joints[joint], previous.joints[joint])) copied.joints[joint] = canonicalEditRotation(copied.joints[joint]);
    // Collision response belongs to the derived viewing pose. Author gestures
    // may pass through the floor/body without moving the whole actor first.
    // Foot-lock outputs are linked changes, not new author protection. Keep
    // only the direct gesture intents; recordPointChanges captures all results.
    for (const joint of draftRotationIntents.current) if (!rotationsDiffer(copied.joints[joint], reference.joints[joint])) draftRotationIntents.current.delete(joint);
    if (!rootsDiffer(copied.root, reference.root)) draftRootIntent.current = false;
    if (!posesDiffer(copied, reference)) { clearPoseDraft(true); return false; }
    if (!poseDraftRef.current) poseDraftBaseline.current = { status: saveStatus === 'saving' ? 'dirty' : saveStatus, version: sceneChangeVersion.current };
    poseDraftRef.current = copied; setPoseDraft(copied); setSaveStatus('dirty'); return true;
  }
  function beginPointGesture() {
    if (!active.take || !manualSequence || !manualEditing || collisionPreview || playing || mirror || modalOpen || busy) return false;
    pointGesture.current ??= { sceneId: currentScene.id, revision: session.revision, time, snapshot: active, sequence: manualSequence, before: clonePose(sampleTake(active.take, time)) };
    return true;
  }
  function cancelPointGesture() { pointGesture.current = null; clearPoseDraft(true); }
  /** Commit only the channels a gesture actually changed at its exact time. */
  function recordPointChanges(): boolean {
    const gesture = pointGesture.current;
    const after = poseDraftRef.current;
    if (!after) { pointGesture.current = null; return true; }
    if (!manualSequence || !active.take) return false;
    if (gesture && (gesture.sceneId !== currentScene.id || gesture.revision !== sessionRef.current.revision)) { cancelPointGesture(); return false; }
    const exactTime = gesture?.time ?? time, before = gesture?.before ?? sampleTake(active.take, exactTime);
    const source = gesture?.sequence ?? manualSequence, snapshot = gesture?.snapshot ?? active;
    try {
      const next = upsertMotionPointChanges(source, exactTime, before, after, snapshot.take ?? undefined);
      if (next === source) { cancelPointGesture(); return true; }
      const tracks: (JointName | 'root')[] = [...(rootsDiffer(before.root, after.root) ? ['root' as const] : []), ...JOINT_NAMES.filter(joint => rotationsDiffer(before.joints[joint], after.joints[joint]))];
      const take = bakeKeyframeSequence(next);
      clearPoseDraft(); pointGesture.current = null;
      commit({ ...snapshot, manual: next, take }, { label: `调整${tracks.map(trackLabel).join('、')}`, time: exactTime, tracks });
      return true;
    } catch (error) { setNotice(errorMessage(error)); cancelPointGesture(); return false; }
  }
  /** Shared start/change/end routing for rotation, Root and IK gestures. */
  function routeGesture(phase: 'start' | 'change' | 'end', propose: (current: Pose) => void): Pose | void {
    if (phase === 'start') { beginPointGesture(); return; }
    if (phase === 'end') { recordPointChanges(); return; }
    if (!pointGesture.current && !beginPointGesture()) return;
    propose(poseDraftRef.current ?? pointGesture.current!.before);
    return poseDraftRef.current ?? pointGesture.current!.before;
  }
  function handleJointRotation(joint: JointName, rotation: Quat, phase: 'start' | 'change' | 'end') {
    return routeGesture(phase, current => { const next = clonePose(current); next.joints[joint] = [...rotation]; updatePoseDraft(next); });
  }
  function handleRootPosition(position: Vec3, phase: 'start' | 'change' | 'end') {
    return routeGesture(phase, current => { const next = clonePose(current); next.root = [...position]; updatePoseDraft(next); });
  }
  function handleIKTarget(effector: IKEffector, target: Vec3, phase: 'start' | 'change' | 'end') {
    if (phase !== 'change') return routeGesture(phase, () => {});
    if (!pointGesture.current && !beginPointGesture()) return;
    try {
      updatePoseDraft(solveLimbIK(poseDraftRef.current ?? pointGesture.current!.before, effector, target).pose);
      const accepted = poseDraftRef.current ?? pointGesture.current!.before;
      const endpoint = evaluatePose(accepted)[effector].position;
      setIKTarget([...target]); setIKResidual(Math.hypot(...endpoint.map((value, axis) => value - target[axis])));
      return accepted;
    } catch (error) { setNotice(errorMessage(error)); cancelPointGesture(); }
  }
  function changeMotionPointValue(exactTime: number, point: JointName | 'root', value: Vec3 | Quat) {
    if (!active.take || !manualSequence || playing || mirror || !manualEditing || modalOpen || busy || exactTime !== time) return;
    try {
      setCollisionPreview(false);
      const before = sampleTake(active.take, exactTime), after = clonePose(before);
      if (point === 'root') after.root = value as Vec3;
      else {
        const length = Math.hypot(...value);
        if (!Number.isFinite(length) || length <= Number.EPSILON) throw new Error('旋转不能使用零四元数。');
        after.joints[point] = value.map(component => component / length) as Quat;
      }
      const next = upsertMotionPointChanges(manualSequence, exactTime, before, after, active.take);
      if (next === manualSequence) return;
      commit({ ...active, manual: next, take: bakeKeyframeSequence(next) }, { label: `调整${trackLabel(point)}`, time: exactTime, tracks: [point] });
    } catch (error) { setNotice(errorMessage(error)); }
  }
  function deleteSelectedPoint() {
    if (cameraSelected) { deleteCameraPoint(); return; }
    if (!manualSequence || !active.take || playing || mirror || !manualEditing || modalOpen || busy) return;
    const point = transformTool === 'translate' ? 'root' : selectedPoint ?? selectedJoint;
    if (!point) return;
    try {
      const next = removeMotionPointEdit(manualSequence, time, point, active.take);
      if (next !== manualSequence) {
        commit({ ...active, manual: next, take: bakeKeyframeSequence(next) }, { label: `恢复${trackLabel(point)}原始点`, time, tracks: [point] }); return;
      }
      if (frameTime(editorFrame, duration) === time) deleteKeyframe(point === 'root' ? { kind: 'root', frame: editorFrame } : { kind: 'joint', joint: point, frame: editorFrame });
    } catch (error) { setNotice(errorMessage(error)); }
  }
  function deleteKeyframe(target: KeyframeDeleteTarget = { kind: 'pose', frame: editorFrame }) {
    if (!manualSequence || !active.take || playing || mirror || !manualEditing) return;
    if (target.kind === 'joint' && !EDITABLE_JOINT_NAMES.includes(target.joint)) return;
    const hasRoot = manualSequence.root.some(key => key.frame === target.frame);
    const hasJoint = target.kind === 'joint' && manualSequence.rotations[target.joint]?.some(key => key.frame === target.frame);
    const hasPose = hasRoot || Object.values(manualSequence.rotations).some(keys => keys?.some(key => key.frame === target.frame));
    if (!(target.kind === 'joint' ? hasJoint : target.kind === 'root' ? hasRoot : hasPose)) return;
    if (guardPose({ type: 'deleteKey', target })) return;
    try {
      const next = target.kind === 'joint' ? removeRotationKeyframe(manualSequence, target.joint, target.frame, active.take) : target.kind === 'root' ? removeRootKeyframe(manualSequence, target.frame, active.take) : removePoseKeyframe(manualSequence, target.frame, active.take);
      commit({ ...active, manual: next, take: bakeKeyframeSequence(next) }, { label: '删除手动关键帧', time: frameTime(target.frame, duration), tracks: target.kind === 'root' ? ['root'] : target.kind === 'joint' ? [target.joint] : undefined });
      const scope = target.kind === 'joint' ? `${STAGE_JOINT_LABELS[target.joint]}的旋转 K` : target.kind === 'root' ? 'Root 位移 K' : '全部显式关键帧';
      setNotice(`已删除第 ${target.frame} 帧${scope}，可撤销恢复。`);
    } catch (error) { setNotice(errorMessage(error)); }
  }

  // ── Keyframe transfer ─────────────────────────────────────────────────────
  function requestKeyframeTransfer(request: KeyframeTransferInput) {
    if (!manualSequence || !active.take || playing || mirror || !manualEditing || busy) return;
    const scope = request.scope.kind === 'joints' ? { ...request.scope, joints: [...request.scope.joints] } : { ...request.scope };
    const action: TransferAction = { type: 'transferKeys', originTime: time, request: { ...request, scope }, sceneId: currentScene.id, countMapId: active.countMap.id };
    if (guardPose(action)) return;
    performKeyframeTransfer(action);
  }
  function performKeyframeTransfer(action: TransferAction, replacement?: PendingTransfer) {
    if (!manualSequence || !active.take || playing || mirror || !manualEditing || busy) return;
    if (poseDraftRef.current) { setPendingTransfer(null); guardPose(action); return; }
    if (action.sceneId !== currentScene.id || action.countMapId !== active.countMap.id || action.originTime !== time) {
      setPendingTransfer(null); setNotice('来源场景、数拍或时刻已改变，请重新操作关键帧。'); return;
    }
    if (replacement && (replacement.sequenceId !== manualSequence.id || replacement.revision !== session.revision)) {
      setPendingTransfer(null); setNotice('关键帧序列已改变，请重新检查目标帧。'); return;
    }
    try {
      const result = transferKeyframes(manualSequence, { ...action.request, collision: replacement ? 'replace' : 'reject' }, active.take);
      if (result.status === 'noop') { setPendingTransfer(null); setNotice('关键帧没有变化，未新增动画版本。'); return; }
      if (result.status === 'conflict') { setPendingTransfer({ action, sequenceId: manualSequence.id, revision: session.revision, collisions: result.collisions }); return; }
      // Baking can reject resource overflow; commit only after all checks pass.
      const take = bakeKeyframeSequence(result.sequence);
      const tracks = result.changedTracks.map(track => track.kind === 'root' ? 'root' as const : track.joint);
      const verb = action.request.operation === 'move' ? '移动' : '复制';
      commit({ ...active, manual: result.sequence, take }, { label: `${verb}${tracks.map(trackLabel).join('、')}关键帧`, time: result.targetTime, tracks });
      setPendingTransfer(null); seekDirect(result.targetTime, 'author');
      setNotice(`已${verb} ${result.sourceKeyCount} 条作者关键帧到 ${result.targetTime} 秒，可撤销恢复。`);
    } catch (error) { setNotice(errorMessage(error)); }
  }

  // ── Foot locks and assistance candidates ─────────────────────────────────
  function lockFoot(foot: LockedFoot, endFrame: number) {
    if (guardPose({ type: 'lockFoot', foot, endFrame })) return;
    if (!manualSequence || !editorPose || !manualEditing || playing || mirror || modalOpen) return;
    try {
      const contact = analyzePose(editorPose).feet[foot === 'LeftFoot' ? 'Left' : 'Right'];
      if (!contact.grounded || contact.minimumHeightMeters < -STANDARD_HUMAN_PROFILE.ground.penetrationToleranceMeters) throw new Error('请先将这只脚落在地面，再锁定支撑脚。');
      const next = addFootLock(manualSequence, captureFootLock(editorPose, foot, editorFrame, endFrame));
      commit({ ...active, manual: next, take: bakeKeyframeSequence(next) }, { label: '锁定支撑脚', time });
      setNotice(`已锁定${foot === 'LeftFoot' ? '左脚' : '右脚'}第 ${editorFrame}–${endFrame} 帧的世界位置与朝向，可撤销。`);
    } catch (error) { setNotice(errorMessage(error)); }
  }
  function unlockFoot(id: string) {
    if (guardPose({ type: 'removeLock', id })) return;
    if (!manualSequence || !manualEditing || playing || mirror || modalOpen) return;
    try { const next = removeFootLock(manualSequence, id); commit({ ...active, manual: next, take: bakeKeyframeSequence(next) }, { label: '解除支撑脚锁', time }); setNotice('已解除脚锁，可撤销恢复。'); }
    catch (error) { setNotice(errorMessage(error)); }
  }
  function cancelAssistance() {
    const run = assistRun.current; assistRun.current = null; run?.controller.abort();
    setAssistBusy(null); setAssistProgress(0);
  }
  function cachedStepReport(sequence: KeyframeSequence): StepAssistanceReport {
    let report = stepReportCache.current.get(sequence);
    if (!report) { report = analyzeStepAssistance(sequence); stepReportCache.current.set(sequence, report); }
    return report;
  }
  function disableStepAssistance() {
    if (guardPose({ type: 'removeSteps' })) return;
    if (!manualSequence?.steps || !manualEditing || playing || mirror || modalOpen || busy || assistBusy) return;
    try {
      const next = removeStepAssistance(manualSequence);
      commit({ ...active, manual: next, take: bakeKeyframeSequence(next) });
      setNotice('已关闭自动步伐。老师关键帧与脚锁保持原样，可撤销恢复。');
    } catch (error) { setNotice(errorMessage(error)); }
  }
  async function generateAssistance(kind: AssistKind, prompt?: string) {
    if (guardPose({ type: 'assist', kind, prompt })) return;
    if (!active.take || assistRun.current || busy || !ready) return;
    if (kind === 'steps' && (!manualSequence || !manualEditing || playing || mirror || modalOpen)) return;
    pause(); setAssistError(''); setAssistCandidate(null); setPreviewAssist(false);
    const run = { controller: new AbortController(), sceneId: currentScene.id, revision: session.revision, countMapId: active.countMap.id };
    assistRun.current = run; setAssistBusy(kind); setAssistProgress(0);
    const valid = () => assistRun.current === run && !run.controller.signal.aborted && sessionRef.current.revision === run.revision;
    try {
      let next: AssistPayload;
      if (kind === 'ai') {
        const response = await requestAIArrangement(prompt ?? '', active.countMap, run.controller.signal);
        if (!valid()) return;
        const generated = buildAICandidate(active.countMap, response);
        next = { kind, plan: generated.plan, take: generated.take, summary: response.arrangement.summary };
      } else if (kind === 'physics') {
        const result = await simulatePhysicsTake(active.take, { signal: run.controller.signal, onProgress: progress => { if (valid()) setAssistProgress(progress); } });
        next = { kind, plan: active.plan, take: result.take, summary: `Rapier · 固定步长重力与地面碰撞 · 最大 Root 变化 ${result.maxRootDisplacementMeters.toFixed(2)} m` };
      } else {
        // Yield once so that the local calculation's busy state is visible.
        // The immutable original remains the authority until explicit adoption.
        const source = manualSequence!;
        await nextFrame();
        if (!valid()) return;
        const manual = setStepAssistance(source), take = bakeKeyframeSequence(manual), report = cachedStepReport(manual);
        next = { kind, manual, take, report, baseSequenceId: source.id, plan: active.plan, summary: `${report.stepCount} 步 · 位移 K 之间自动迈步，老师 K 与脚锁优先。` };
      }
      if (!valid()) return;
      setAssistCandidate({ ...next, sceneId: run.sceneId, countMapId: run.countMapId, baseRevision: run.revision });
      if (next.kind === 'steps' && next.report.stepCount > 0) { setPreviewAssist(true); seekDirect(0); }
      setNotice(next.kind === 'steps' ? next.report.stepCount > 0 ? '正在预览步伐，原稿尚未改变。采用后才保存自动步伐。' : '当前路径没有可自动迈步的区间，请查看跳过原因。原稿保持原样。' : '候选已就绪。预览和采用分开操作，原稿尚未改变。');
    } catch (error) { if (valid()) { setAssistError(errorMessage(error)); setNotice(errorMessage(error)); } }
    finally { if (assistRun.current === run) { assistRun.current = null; setAssistBusy(null); } }
  }
  function validAssistCandidate() {
    return !!assistCandidate && assistCandidate.sceneId === currentScene.id && assistCandidate.countMapId === active.countMap.id && assistCandidate.baseRevision === session.revision && (assistCandidate.kind !== 'steps' || assistCandidate.baseSequenceId === manualSequence?.id);
  }
  const STALE_CANDIDATE = '作品已经改变，请重新生成候选。';
  function showAssistCandidate() {
    if (guardPose({ type: 'previewAssist' })) return;
    if (!validAssistCandidate()) { setNotice(STALE_CANDIDATE); return; }
    pause(); setPreviewAssist(true); seekDirect(0);
  }
  function adoptAssistance() {
    if (!validAssistCandidate()) { setNotice(STALE_CANDIDATE); return; }
    if (guardPose({ type: 'adoptAssist' })) return;
    if (assistCandidate?.kind !== 'steps' && hasManualKeys) { setPendingResetAction('adoptAssist'); return; }
    performAdoptAssistance();
  }
  function performAdoptAssistance() {
    if (!validAssistCandidate() || !assistCandidate) { setNotice(STALE_CANDIDATE); return; }
    if (assistCandidate.kind === 'steps' && assistCandidate.report.stepCount === 0) { setNotice('当前路径没有可自动迈步的区间，请调整位移关键帧后重试。'); return; }
    commit({ ...active, plan: assistCandidate.plan, take: assistCandidate.take, manual: assistCandidate.kind === 'steps' ? assistCandidate.manual : undefined });
    clearPoseDraft(); setAssistCandidate(null); setPreviewAssist(false); seekDirect(0);
    setNotice(assistCandidate.kind === 'steps' ? '已采用自动步伐。老师关键帧、动作基底与脚锁保持原样；后续 K 帧会重算步伐。' : '已采用候选；原编舞及脚锁保留在撤销历史中。');
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
    setCollisionPreview(false);
    cameraGesture.current = null; setCameraRestoreExact(null); setCameraSelected(false); setCameraViewOverride(false);
    cancelAssistance(); setAssistCandidate(null); setPreviewAssist(false); pause(); music.close();
    const viewer = scene.viewer, map = scene.project.history[scene.project.historyIndex].countMap;
    setCurrentScene(scene); setSession(scene.project); sessionRef.current = scene.project;
    setAudioBlob(scene.audio); setAudioName(scene.audioName);
    setTime(Math.max(0, Math.min(map.durationSeconds, viewer.time)));
    setSelected(Math.max(0, Math.min(map.octetCount - 1, viewer.selectedSlot)));
    setView(viewer.view); setMirror(viewer.mirror); setRate(viewer.rate); setLoop(viewer.loop); setCountSound(viewer.countSound);
    setSelectedJoint(viewer.selectedJoint); setSelectedPoint(viewer.selectedJoint); setJointPosition(null); pointGesture.current = null;
    cameraRef.current = viewer.camera; setCamera(viewer.camera);
    setCameraRestoreKey(previous => previous + 1);
    setCameraFocus(null);
    setPendingTransfer(null);
    setPage('studio');
    setTransformTool(viewer.transformTool ?? 'rotate');
    poseDraftRef.current = null; setPoseDraft(null); poseDraftBaseline.current = null;
    draftRotationIntents.current.clear(); draftRootIntent.current = false;
    sceneChangeVersion.current += 1; setSaveStatus(saved ? 'saved' : 'dirty');
  }
  async function save(): Promise<boolean> { if (guardPose({ type: 'save' })) return false; return performSave(); }
  async function performSave(): Promise<boolean> {
    if (!audioBlob) { setNotice('原音乐缺失，请先恢复原音乐；编舞数据仍可下载为项目备份。'); return false; }
    const version = sceneChangeVersion.current, snapshot = sessionRef.current;
    setSaveStatus('saving');
    await nextFrame();
    const document: SceneDocument<Session> = { ...currentScene, project: snapshot, audio: audioBlob, audioName, viewer: captureViewer() };
    try {
      const saved = await saveScene(document);
      setCurrentScene(previous => previous.id === saved.id ? { ...previous, updatedAt: saved.updatedAt } : previous);
      setSaveStatus(sceneChangeVersion.current === version && sessionRef.current === snapshot && !poseDraftRef.current ? 'saved' : 'dirty');
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
        // A recovery's write-draft guard can create newer K keys. Capture the
        // current formal project now, after that guard, rather than the modal's
        // older read-only preview. Ordinary file import retains its own payload.
        const document = action.type === 'import' ? action.scene : createScene({
          name: action.name, project: { ...sessionRef.current, teacherCheckedRevision: null }, audio: action.audio, audioName: action.audioName, viewer: captureViewer(),
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
    if (guardPose({ type: 'scene', action })) return;
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
    if (guardPose({ type: 'projectBackup' })) return;
    downloadBlob(encodeSceneJsonBackup({ ...currentScene, project: sessionRef.current, audio: null, audioName, viewer: captureViewer() }), 'choreo-studio-project.json');
    setNotice(poseDraftRef.current ? '已下载已写入的场景数据。姿态草稿和原音乐未包含。' : '已下载场景数据备份。原音乐未包含，请另外保留。');
  }
  async function exportFullScene() {
    if (!ready || busy || !audioBlob) return;
    if (guardPose({ type: 'backup' })) return;
    const capturedTime = playing ? currentEditTime() : time;
    pause(); setBusy('正在准备场景备份');
    const snapshot = sessionRef.current;
    try {
      await nextFrame();
      const blob = await encodeSceneBackup({ ...currentScene, project: snapshot, audio: audioBlob, audioName, viewer: captureViewer(capturedTime) });
      downloadBlob(blob, `${safeFileName(currentScene.name)}.choreo`);
      setNotice('已下载完整场景包，包含原音乐、已写入动作、历史与相机。可从“场景”重新导入。');
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
    const scene = createScene({ name: importName, project: { ...importScene.project, teacherCheckedRevision: null }, audio: importScene.audio, audioName: importScene.audioName, viewer: importScene.viewer });
    requestSceneAction({ type: 'import', scene });
  }

  // ── Music and timing ──────────────────────────────────────────────────────
  function openMusicSetup() {
    if (guardPose({ type: 'music' })) return;
    pause();
    music.show({ blob: audioBlob, name: audioName, duration: session.audioDuration, title: currentScene.name, countMap: active.countMap });
  }
  function confirmMusic() { if (hasManualKeys || active.cameraTrack?.keys.length) { setPendingResetAction('music'); return; } performConfirmMusic(); }
  function performConfirmMusic() {
    const { draft, map } = music;
    if (!map || !draft.blob || music.decoding) return;
    const title = draft.title.trim();
    cameraGesture.current = null; setCameraRestoreExact(null); setCameraSelected(false); setCameraViewOverride(false);
    cancelAssistance(); music.close(); pause();
    setAudioBlob(draft.blob); setAudioName(draft.name); setTime(0); setSelected(0);
    setSession(previous => ({ history: [neutralSnapshot(map, title || '未命名组合')], historyIndex: 0, revision: previous.revision + 1, audioDuration: draft.duration, teacherCheckedRevision: null }));
    clearPoseDraft(); setQueuedAction(null); markSceneDirty(); setPage('studio'); setTransformTool('rotate');
    setCurrentScene(previous => ({ ...previous, name: title || UNTITLED_SCENE_NAME }));
    setNotice('当前场景的音乐和选段已确认，可直接选择时间和部位开始手动编辑。');
  }

  // ── Viewing modes ─────────────────────────────────────────────────────────
  function openTeachingPreview() {
    if (guardPose({ type: 'teaching' })) return;
    pause(); setPage(previous => previous === 'teaching' ? 'studio' : 'teaching');
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
      case 'deleteKey': deleteKeyframe(action.target); break;
      case 'teaching': openTeachingPreview(); break;
      case 'backup': void exportFullScene(); break;
      case 'projectBackup': exportProject(); break;
      case 'transferKeys': performKeyframeTransfer(action); break;
      case 'moveAudio': performAudioMove(action); break;
      case 'assist': void generateAssistance(action.kind, action.prompt); break;
      case 'adoptAssist': adoptAssistance(); break;
      case 'previewAssist': showAssistCandidate(); break;
      case 'lockFoot': lockFoot(action.foot, action.endFrame); break;
      case 'removeLock': unlockFoot(action.id); break;
      case 'removeSteps': disableStepAssistance(); break;
    }
  }
  useEffect(() => {
    if (!queuedAction || poseDraft) return;
    setQueuedAction(null); executeGuardedAction(queuedAction);
  }, [queuedAction, poseDraft]);
  function confirmResetAction() {
    const action = pendingResetAction; setPendingResetAction(null);
    if (action === 'music') performConfirmMusic();
    else if (action === 'adoptAssist') performAdoptAssistance();
  }

  // ── Render ────────────────────────────────────────────────────────────────
  const candidatePanel = assistCandidate && <AssistCandidatePanel candidate={assistCandidate} previewing={previewAssist} valid={validAssistCandidate()}
    onTogglePreview={toggleAssistPreview} onAdopt={adoptAssistance} onClose={closeAssistCandidate} />;
  const stageTitle = previewAssist ? '辅助预览' : page === 'teaching' ? '教学预览' : '舞台';

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
        {ready && !audioBlob && <div className="missing-audio" role="alert"><strong>原音乐缺失</strong><p>编舞与数拍仍在。请关联原曲后恢复为新场景，当前作品会保留。</p><button className="button secondary compact" onClick={openAudioRecovery} disabled={!!busy || sceneActionBusy}>恢复原音乐</button></div>}
        <section className="viewer-panel" aria-label="3D动作预览">
          <div className="stage-area">
            <CameraBar title={stageTitle} view={view} canFrame={!!displayedTake && ready && !busy} canFocusJoint={!!displayedTake && !!selectedJoint && ready && !busy} onView={chooseView} onFrame={focusCamera}>
              <SceneExtras>
                <StageDiagnostics camera={camera?.position ?? null} jointLabel={selectedJoint ? STAGE_JOINT_LABELS[selectedJoint] : null} jointPosition={jointPosition} />
                {manualSequence && editorPose && <RealismPanel pose={previewAssist && assistCandidate ? sampleTake(assistCandidate.take, time) : editorPose} sequence={manualSequence} frame={editorFrame} duration={duration}
                  disabled={!manualEditing || playing || mirror || modalOpen || !!busy || !!assistBusy} ikResidual={ikResidual} motionState={motionIsDynamic(displayedTake, time) ? 'dynamic' : 'quasi-static'}
                  onLock={lockFoot} onRemoveLock={unlockFoot} onPhysics={() => { void generateAssistance('physics'); }} onCancel={cancelAssistance} simulating={assistBusy === 'physics'} progress={assistProgress}
                  stepReport={stepReport} onSteps={() => { void generateAssistance('steps'); }} onRemoveSteps={disableStepAssistance} calculatingSteps={assistBusy === 'steps'}
                  stepCandidate={assistCandidate?.kind === 'steps' ? candidatePanel : null} />}
                {page === 'studio' && <AIPanel onGenerate={prompt => { void generateAssistance('ai', prompt); }} onCancel={cancelAssistance} busy={assistBusy === 'ai'} disabled={!ready || !active.take || !!busy || !!assistBusy || modalOpen} error={assistError} />}
              </SceneExtras>
            </CameraBar>
            <div className="stage-wrap">
              <Stage take={displayedTake} time={time} view={view} mirror={mirror}
                cameraState={camera ?? undefined} cameraTrackState={cameraTrackState} cameraRestoreExact={cameraRestoreExact} cameraEditRevision={session.revision}
                cameraCancelKey={cameraCancelKey} cameraTrackEditing={cameraSelected && cameraCanEdit()} onCameraGesture={handleCameraGesture}
                cameraResetKey={cameraResetKey} cameraRestoreKey={cameraRestoreKey} cameraFocus={cameraFocus ?? undefined}
                onCameraChange={handleCameraChange} onCameraInteraction={handleCameraInteraction}
                selectedJoint={selectedJoint} linkedJoints={linkedJoints} onSelectJoint={chooseJoint} onJointPositionChange={handleJointPosition}
                poseOverride={manualEditing ? poseDraft : null} collisionPreview={collisionPreview || previewAssist || page === 'teaching'}
                editMode={manualEditing && !cameraSelected && !workLocked} transformTool={activeTransformTool} playing={playing}
                onJointRotationChange={handleJointRotation} onRootPositionChange={handleRootPosition} ikTarget={ikTarget} onIKTargetChange={handleIKTarget} onTransformCancel={cancelPointGesture} />
            </div>
            <StageEditTools help={toolHelp} onTool={chooseTransformTool} tools={{ active: activeTransformTool, rotateUnavailable, translateDisabled: !active.take || !!busy, ikAvailable: !!getIKEffector(selectedJoint), previewing: previewAssist, hasTake: !!active.take }} />
          </div>
          {manualSequence && <TimelineDock ref={timelineOverlayRef}>
            <KeyframeTimeline
              camera={{ track: active.cameraTrack, value: cloneCameraPose(cameraValue), selected: cameraSelected, onSelect: selectCameraPoint, onChange: changeCameraPoint, onMove: moveCameraPoint, onDelete: deleteCameraPoint }}
              audio={{ name: audioName, offsetSeconds: active.audioOffsetSeconds ?? 0, durationSeconds: duration, waveform, onMove: moveAudio, disabled: !audioBlob }}
              sequence={manualSequence} take={active.take ?? undefined} selectedJoint={selectedJoint} selectedPoint={selectedPoint} selectedTime={time}
              onSelectPoint={selectMotionPoint} onSelectJoint={chooseJoint} onHoverJoints={setLinkedJoints} onPointValueChange={changeMotionPointValue} onDeletePoint={deleteSelectedPoint}
              frame={editorFrame} onFrame={frame => seek(frameTime(frame, duration))} playing={playing} mirror={mirror}
              readOnly={!manualEditing || workLocked} dirty={!!poseDraft} onTime={seek} onTransferKeyframes={requestKeyframeTransfer}
              transport={<PlaybackTransport playing={playing} disabled={!displayedTake || !ready || !audioBlob} time={time} duration={duration} onToggle={() => { void togglePlay(); }} />}
              playbackOptions={<PlaybackOptions loop={loop} rate={rate} mirror={mirror} countSound={countSound}
                onLoop={() => { setLoop(!loop); markSceneDirty(); if (!loop) seek(0); }} onRate={value => { setRate(value); markSceneDirty(); }}
                onMirror={() => { setMirror(!mirror); markSceneDirty(); }} onCountSound={() => { setCountSound(!countSound); markSceneDirty(); }} />}
            />
          </TimelineDock>}
        </section>
        {assistCandidate?.kind !== 'steps' && candidatePanel}
      </section>
    </main>

    {notice && <Toast message={notice} onClose={() => setNotice('')} />}

    {pendingTransfer && <ConfirmDialog titleId="key-transfer-title" title="目标帧已有关键帧" confirmLabel="替换并继续"
      intro={`${pendingTransfer.action.request.targetTime ?? frameTime(pendingTransfer.action.request.targetFrame!, duration)} 秒的 ${pendingTransfer.collisions.length} 条对应轨已有作者关键帧。继续将替换这些通道的 K 与修改点；来源没有记录的目标轨保持原样。移动或复制会改变相邻记录之间的插值，可撤销恢复。`}
      onCancel={() => setPendingTransfer(null)} onConfirm={() => performKeyframeTransfer(pendingTransfer.action, pendingTransfer)}>
      <div className="transfer-collisions">{pendingTransfer.collisions.map(track => <span key={track.kind === 'root' ? 'root' : track.joint}>{track.kind === 'root' ? 'Root 位移' : STAGE_JOINT_LABELS[track.joint]}</span>)}</div>
    </ConfirmDialog>}
    {importOpen && <BackupImportDialog scene={importScene} name={importName} needsAudio={importNeedsAudio} error={importError} reading={importBusy} saving={sceneActionBusy}
      onName={setImportName} onChooseBackup={file => { void chooseSceneBackup(file); }} onChooseAudio={file => { void associateBackupAudio(file); }} onConfirm={confirmSceneImport} onClose={closeBackupImport} />}
    {pendingResetAction && <ConfirmDialog titleId="reset-keys-title" confirmLabel="确认并继续" onCancel={() => setPendingResetAction(null)} onConfirm={confirmResetAction}
      title={pendingResetAction === 'adoptAssist' ? '采用候选并替换当前编舞？' : '清空手动关键帧并继续？'}
      intro={pendingResetAction === 'adoptAssist' ? '采用候选会替换整段动作，并清空当前可编辑关键帧轨、脚锁与自动步伐；原编舞保留在撤销历史中。完成后可用撤销恢复这份手动序列。' : '调整音乐与数拍会清空当前动作和相机关键帧，并创建新的中立姿态场景。请先保存或复制场景以保留原编舞。'} />}
    {libraryOpen && <SceneLibraryDialog scenes={sceneList} currentId={currentScene.id} currentName={currentScene.name} loading={libraryBusy} busy={sceneActionBusy} importDisabled={!!busy}
      onClose={() => setLibraryOpen(false)} onImport={openBackupImport} onNew={() => requestSceneAction({ type: 'new' })}
      onOpen={id => requestSceneAction({ type: 'open', id })} onCopy={id => requestSceneAction({ type: 'copy', id })}
      onRename={(id, name) => startRename({ id, name })} onDelete={(id, name) => setDeleteTarget({ id, name })} />}
    {pendingSceneAction && <Dialog titleId="unsaved-title" title="保留当前场景的修改？" eyebrow="未保存的修改" layer="guard" className="scene-confirm-modal"
      intro={<>「{currentScene.name}」有未保存的更改。选择保存后继续，或放弃这次修改。{pendingSceneAction.type === 'delete' && '继续后将删除该场景。'}{!audioBlob && (pendingSceneAction.type === 'recoverAudio' ? ' 原音乐缺失，无法保存旧场景；继续恢复会把最新已写入编舞与原音乐保存为新场景。' : ' 原音乐缺失，当前无法保存；请先恢复原音乐，或明确选择不保存继续。')}</>}>
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
