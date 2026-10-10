import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDownToLine, ArrowUpRight, Check, CheckCircle2, Copy, Focus, FolderOpen, Headphones, Layers3, LoaderCircle, MousePointer2, Move3D, Pause, Pencil, Play, Plus, Redo2, Repeat2, Rotate3D, RotateCcw, Save, Scan, SlidersHorizontal, Undo2, Upload, Volume2, X } from 'lucide-react';
import { bakeKeyframeSequence, upsertMotionPointChanges, removeMotionPointEdit, EDITABLE_JOINT_NAMES, frameAtTime, frameTime, getKeyframeCount, makeCountMap, makeKeyframeSequence, removePoseKeyframe, removeRootKeyframe, removeRotationKeyframe, sampleTake, transferKeyframes, type ArrangementPlan, type BakedTake, type CountMap, type KeyframeTransferRequest, type KeyframeTransferTrack, JOINT_NAMES, type JointName, type KeyframeSequence, type Pose, type Quat, type Vec3 } from '../../../packages/core/src';
import { Stage, STAGE_JOINT_LABELS, type StageCamera, type StageCameraFocus, type StageTransformTool, type StageView } from './Stage';
import { demoAudio } from './demoAudio';
import { deleteScene, duplicateScene, listScenes, loadCurrentScene, loadScene, renameScene, saveScene, setCurrentScene as selectStoredScene } from './storage';
import { createScene, defaultSceneViewer, type SceneDocument } from './scene';
import { KeyframeTimeline } from './KeyframeEditor';
import { encodeSceneBackup, encodeSceneJsonBackup, decodeSceneBackup } from './sceneBackup';
import type { SceneSnapshot as Snapshot, SceneProject as Session } from './sceneProject';
import { useModalFocus } from './useModalFocus';
import { useEditorShortcuts } from './useEditorShortcuts';
import { addFootLock, analyzePose, applyFootLocks, buildAICandidate, canonicalEditRotation, captureFootLock, constrainBodyCollisions, evaluatePose, getKeyframeProtection, removeFootLock, simulatePhysicsTake, solveLimbIK, STANDARD_HUMAN_PROFILE, type FootLockProtection, type IKEffector, type LockedFoot } from '../../../packages/core/src';
import { getIKEffector } from './Stage';
import AIPanel from './AIPanel';
import { requestAIArrangement } from './aiClient';
import { RealismPanel, StepAssistanceSummary } from './RealismPanel';
import { analyzeStepAssistance, removeStepAssistance, setStepAssistance, type StepAssistanceReport } from '../../../packages/core/src';
import './Assistance.css';
import { useTimelinePlayback } from './useTimelinePlayback';
import { snapAudioOffset } from './audioTimeline';
import { useAudioWaveform } from './useAudioWaveform';
import { cloneCameraPose, createCameraTrackSampler, makeCameraTrack, moveCameraKeyframe, removeCameraKeyframe, sameCameraPose, upsertCameraKeyframe, validateCameraPose, type CameraPose, type SampledCameraPose } from '../../../packages/core/src';

type SceneAction = { type: 'new' } | { type: 'open' | 'copy' | 'delete'; id: string } | { type: 'import'; scene: SceneDocument<Session> } | { type: 'recoverAudio'; sceneId: string; countMapId: string; audio: Blob; audioName: string; name: string };
type KeyframeDeleteTarget = { kind: 'joint'; joint: JointName; frame: number } | { kind: 'root' | 'pose'; frame: number };
type TransferAction = { type: 'transferKeys'; originFrame: number; request: Omit<KeyframeTransferRequest, 'collision'>; sceneId: string; countMapId: string };
type AudioMoveAction = { type: 'moveAudio'; offsetSeconds: number; sceneId: string; countMapId: string };
type PoseAction = AudioMoveAction | { type: 'seek'; time: number } | { type: 'scene'; action: SceneAction } | { type: 'history'; direction: -1 | 1 } | { type: 'deleteKey'; target: KeyframeDeleteTarget } | TransferAction | { type: 'play' | 'save' | 'music' | 'teaching' | 'backup' | 'projectBackup' };
type PendingTransfer = { action: TransferAction; sequenceId: string; revision: number; collisions: KeyframeTransferTrack[] };
type ResetAction = 'music' | 'adoptAssist';
type AssistKind = 'ai' | 'physics' | 'steps';
type AssistAction = { type: 'assist'; kind: AssistKind; prompt?: string } | { type: 'adoptAssist' } | { type: 'previewAssist' } | { type: 'lockFoot'; foot: LockedFoot; endFrame: number } | { type: 'removeLock'; id: string } | { type: 'removeSteps' };
type AssistPayload = { kind: 'ai' | 'physics'; plan: ArrangementPlan | null; take: BakedTake; summary: string } | { kind: 'steps'; plan: ArrangementPlan | null; take: BakedTake; summary: string; manual: KeyframeSequence; report: StepAssistanceReport; baseSequenceId: string };
type AssistCandidate = AssistPayload & { sceneId: string; countMapId: string; baseRevision: number };
const initialMap = () => makeCountMap({ bpm: 120, musicBeatsPerDanceCount: 1, firstCountSourceSeconds: 0, startOctet: 0, octetCount: 8, audioDurationSeconds: 40 });
/** Empty manual scenes have a valid neutral animation before the first gesture. */
function neutralSnapshot(countMap: CountMap, title: string): Snapshot {
  const neutral = (): Pose => ({ root: [0, 1.05, 0], joints: Object.fromEntries(JOINT_NAMES.map(joint => [joint, [0, 0, 0, 1]])) as Pose['joints'] });
  const take: BakedTake = {
    id: `take-${crypto.randomUUID()}`, schemaVersion: 'preview-1', planId: `manual-${crypto.randomUUID()}`,
    countMapId: countMap.id, durationSeconds: countMap.durationSeconds, times: [0, countMap.durationSeconds],
    poses: [neutral(), neutral()], provenance: 'synthetic-demo',
  };
  return { title, countMap, plan: null, take, manual: makeKeyframeSequence(take, { pointInterpolation: 'hold-last-key-1' }) };
}
function initialSession(): Session {
  const countMap = initialMap();
  return { history: [neutralSnapshot(countMap, '我的第一段八拍')], historyIndex: 0, revision: 1, audioDuration: 40, teacherCheckedRevision: null };
}
const clonePose = (pose: Pose): Pose => ({ root: [...pose.root], joints: Object.fromEntries(JOINT_NAMES.map(joint => [joint, [...pose.joints[joint]]])) as Pose['joints'] });
function authorProtection(sequence: KeyframeSequence, frame: number, joints: ReadonlySet<JointName>, root: boolean): FootLockProtection {
  const protection = getKeyframeProtection(sequence, frame);
  return { ...protection, ...(root ? { root: 1 } : {}), joints: { ...protection.joints, ...Object.fromEntries([...joints].map(joint => [joint, 1])) } };
}
const rotationsDiffer = (a: Quat, b: Quat) => {
  const aLength = Math.hypot(...a), bLength = Math.hypot(...b);
  const sign = a.reduce((sum, value, axis) => sum + value * b[axis], 0) < 0 ? -1 : 1;
  return a.some((value, axis) => Math.abs(value / aLength - sign * b[axis] / bLength) > 1e-10);
};
const rootsDiffer = (a: Vec3, b: Vec3) => a.some((value, axis) => Math.abs(value - b[axis]) > 1e-9);
const posesDiffer = (a: Pose, b: Pose) => rootsDiffer(a.root, b.root) || JOINT_NAMES.some(joint => rotationsDiffer(a.joints[joint], b.joints[joint]));
const seconds = (value: number) => `${Math.floor(value / 60).toString().padStart(2, '0')}:${Math.floor(value % 60).toString().padStart(2, '0')}`;
const cameraMatches = (a: StageCamera | null, b: StageCamera) => !!a && [...a.position, ...a.target, a.zoom ?? 1].every((value, index) => Math.abs(value - [...b.position, ...b.target, b.zoom ?? 1][index]) < 1e-6);
function motionIsDynamic(take: BakedTake | null, time: number): boolean {
  if (!take) return false;
  const first = Math.max(0, time - 1 / 30), last = Math.min(take.durationSeconds, time + 1 / 30);
  if (last <= first) return false;
  const a = sampleTake(take, first), mid = sampleTake(take, time), b = sampleTake(take, last), dt = last - first;
  return (Math.hypot(...a.root.map((value, axis) => mid.root[axis] - value)) + Math.hypot(...mid.root.map((value, axis) => b.root[axis] - value))) / dt > .05 || JOINT_NAMES.some(joint => {
    const dotA = Math.min(1, Math.abs(a.joints[joint].reduce((sum, value, axis) => sum + value * mid.joints[joint][axis], 0)));
    const dotB = Math.min(1, Math.abs(mid.joints[joint].reduce((sum, value, axis) => sum + value * b.joints[joint][axis], 0)));
    return 2 * (Math.acos(dotA) + Math.acos(dotB)) / dt > .1;
  });
}
const errorMessage = (error: unknown) => error instanceof Error ? error.message : '操作未完成，请重试。';

export default function App() {
  const [session, setSession] = useState<Session>(initialSession);
  const [currentScene, setCurrentScene] = useState<SceneDocument<Session>>(() => createScene({ name: '我的第一段八拍', project: session, audio: null, audioName: '八拍节奏示例.wav', viewer: { ...defaultSceneViewer(), editorMode: 'keyframes' } }));
  const [sceneList, setSceneList] = useState<Awaited<ReturnType<typeof listScenes>>>([]);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [libraryBusy, setLibraryBusy] = useState(false);
  const [pendingSceneAction, setPendingSceneAction] = useState<SceneAction | null>(null);
  const [sceneActionBusy, setSceneActionBusy] = useState(false);
  const [renameTarget, setRenameTarget] = useState<{ id: string; name: string } | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [importScene, setImportScene] = useState<SceneDocument<Session> | null>(null);
  const [importName, setImportName] = useState('');
  const [importNeedsAudio, setImportNeedsAudio] = useState(false);
  const [audioRecoveryTarget, setAudioRecoveryTarget] = useState<{ sceneId: string; countMapId: string } | null>(null);
  const [importError, setImportError] = useState('');
  const [importBusy, setImportBusy] = useState(false);
  const importReadToken = useRef(0);
  const [pendingTransfer, setPendingTransfer] = useState<PendingTransfer | null>(null);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [audioName, setAudioName] = useState('八拍节奏示例.wav');
  const [ready, setReady] = useState(false);
  const [audioUrl, setAudioUrl] = useState('');
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [timelineInset, setTimelineInset] = useState(240);
  const timelineOverlayRef = useRef<HTMLDivElement>(null);
  const [selected, setSelected] = useState(0);
  const [view, setView] = useState<StageView>('front');
  const [camera, setCamera] = useState<StageCamera | null>(null);
  const [cameraSelected, setCameraSelected] = useState(false);
  const [cameraViewOverride, setCameraViewOverride] = useState(false);
  const [cameraRestoreExact, setCameraRestoreExact] = useState<SampledCameraPose | null>(null);
  const [cameraCancelKey, setCameraCancelKey] = useState(0);
  const [cameraResetKey, setCameraResetKey] = useState(0);
  const [cameraFocus, setCameraFocus] = useState<StageCameraFocus | null>(null);
  const cameraFocusCounter = useRef(0);
  const [cameraRestoreKey, setCameraRestoreKey] = useState(0);
  const [selectedJoint, setSelectedJoint] = useState<JointName | null>(null);
  const [selectedPoint, setSelectedPoint] = useState<JointName | 'root' | null>(null);
  const [jointPosition, setJointPosition] = useState<Vec3 | null>(null);
  const [mirror, setMirror] = useState(false);
  const [rate, setRate] = useState(1);
  const [loop, setLoop] = useState(false);
  const [countSound, setCountSound] = useState(false);
  const [page, setPage] = useState<'studio' | 'teaching'>('studio');
  const [transformTool, setTransformTool] = useState<StageTransformTool>('rotate');
  const [poseDraft, setPoseDraft] = useState<Pose | null>(null);
  const [collisionFeedback, setCollisionFeedback] = useState<string | null>(null);
  const [queuedPoseAction, setQueuedPoseAction] = useState<PoseAction | AssistAction | null>(null);
  const [pendingResetAction, setPendingResetAction] = useState<ResetAction | null>(null);
  const [assistCandidate, setAssistCandidate] = useState<AssistCandidate | null>(null);
  const [previewAssist, setPreviewAssist] = useState(false);
  const [assistBusy, setAssistBusy] = useState<AssistKind | null>(null);
  const [assistProgress, setAssistProgress] = useState(0);
  const [assistError, setAssistError] = useState('');
  const assistRun = useRef<{ controller: AbortController; sceneId: string; revision: number; countMapId: string } | null>(null);
  const stepReportCache = useRef(new WeakMap<KeyframeSequence, StepAssistanceReport>());
  const [ikTarget, setIKTarget] = useState<Vec3 | null>(null);
  const [ikResidual, setIKResidual] = useState<number | null>(null);
  const [busy, setBusy] = useState('');
  const [saveStatus, setSaveStatus] = useState<'dirty' | 'saving' | 'saved' | 'failed'>('dirty');
  const [notice, setNotice] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [draftBlob, setDraftBlob] = useState<Blob | null>(null);
  const [draftName, setDraftName] = useState('');
  const [draftDuration, setDraftDuration] = useState(40);
  const [draftTitle, setDraftTitle] = useState('我的第一段八拍');
  const [draftBpm, setDraftBpm] = useState(120);
  const [draftRelation, setDraftRelation] = useState<0.5 | 1 | 2>(1);
  const [draftFirst, setDraftFirst] = useState(0);
  const [draftStart, setDraftStart] = useState(1);
  const [draftOctets, setDraftOctets] = useState(8);
  const [draftError, setDraftError] = useState('');
  const [decoding, setDecoding] = useState(false);
  const audioReadToken = useRef(0);
  const decodingContext = useRef<AudioContext | null>(null);
  const [auditionCount, setAuditionCount] = useState(0);
  const audioRef = useRef<HTMLAudioElement>(null);
  const cueContext = useRef<AudioContext | null>(null);
  const audition = useRef<{ audio: HTMLAudioElement; url: string; frame: number } | null>(null);
  const sessionRef = useRef(session);
  const cameraRef = useRef<StageCamera | null>(null);
  const sceneChangeVersion = useRef(0);
  const poseDraftRef = useRef<Pose | null>(null);
  const draftRotationIntents = useRef(new Set<JointName>());
  const draftRootIntent = useRef(false);
  const poseDraftBaseline = useRef<{ status: typeof saveStatus; version: number } | null>(null);
  const pointGesture = useRef<{ sceneId: string; revision: number; time: number; snapshot: Snapshot; sequence: KeyframeSequence; before: Pose } | null>(null);
  const cameraGesture = useRef<{ sceneId: string; revision: number; time: number; snapshot: Snapshot; before: CameraPose; latest: CameraPose; status: typeof saveStatus; version: number; override: boolean } | null>(null);
  const storedActive = session.history[session.historyIndex];
  // Old music-only saves remain untouched until the first real edit, but are editable now.
  const active = useMemo(() => {
    if (storedActive.take) return storedActive;
    const neutral = neutralSnapshot(storedActive.countMap, storedActive.title);
    return { ...storedActive, take: neutral.take, manual: storedActive.manual ?? neutral.manual };
  }, [storedActive]);
  const cameraSampler = useMemo(() => active.cameraTrack ? createCameraTrackSampler(active.cameraTrack, active.countMap.durationSeconds) : null, [active.cameraTrack, active.countMap.durationSeconds]);
  const sampledCamera = useMemo(() => cameraSampler?.(time) ?? null, [cameraSampler, time]);
  const cameraTrackState = !cameraViewOverride && !previewAssist ? sampledCamera : null;
  const cameraValue = cameraTrackState ?? camera ?? { position: [2.4, 1.85, 4] as Vec3, target: [0, 1.04, 0] as Vec3, zoom: 1 };
  const manualSequence = useMemo(() => active.manual ?? (active.take ? makeKeyframeSequence(active.take) : null), [active.manual, active.take]);
  const editorFrame = frameAtTime(time, active.countMap.durationSeconds);
  const editorPose = poseDraft ?? (active.take ? sampleTake(active.take, time) : null);
  const manualKeyCount = useMemo(() => active.manual ? getKeyframeCount(active.manual) : 0, [active.manual]);
  const hasManualKeys = manualKeyCount > 0 || !!active.manual?.footLocks?.length || !!active.manual?.steps;
  const stepReport = useMemo(() => active.manual?.steps ? cachedStepReport(active.manual) : null, [active.manual]);
  const displayedTake = previewAssist && assistCandidate ? assistCandidate.take : active.take;
  const manualEditing = page === 'studio' && !previewAssist;
  const modalOpen = libraryOpen || importOpen || createOpen || aboutOpen || !!renameTarget || !!deleteTarget || !!pendingSceneAction || !!pendingResetAction || !!pendingTransfer;
  const timelinePlayback = useTimelinePlayback({
    restoreKey: `${currentScene.id}:${session.historyIndex}:${session.revision}`, audioRef, countMap: active.countMap, audioOffsetSeconds: active.audioOffsetSeconds ?? 0,
    rate, loopRange: loop ? { startSeconds: 0, endSeconds: active.countMap.durationSeconds } : null,
    time, onTimeChange: setTime, onPlayingChange: setPlaying,
    onError: () => setNotice('音频尚未就绪，或浏览器阻止了播放。请再点一次播放。'),
    beforePlay: async () => { if (!cueContext.current) cueContext.current = new AudioContext(); await cueContext.current.resume(); },
  });
  const waveform = useAudioWaveform(audioBlob, active.countMap);
  const lastCue = useRef(-1);
  useEffect(() => {
    if (!playing) { lastCue.current = -1; return; }
    const index = Math.floor(time / (60 / active.countMap.bpm * active.countMap.musicBeatsPerDanceCount));
    if (countSound && index !== lastCue.current) beep();
    lastCue.current = index;
  }, [time, playing, countSound, active.countMap]);
  const activeTransformTool = manualEditing && !cameraSelected ? transformTool : 'select';
  const editableSelectedJoint = selectedJoint !== null && JOINT_NAMES.includes(selectedJoint);
  const rotateUnavailable = !active.take ? '请先新建或导入场景。' : !selectedJoint ? '先点击人物，选择要调整的部位。' : !editableSelectedJoint ? '末端节点只读；请选择肩、肘、髋等可旋转关节。' : busy ? '请等待当前操作完成。' : null;
  const toolHelp = !active.take ? '请先新建或导入场景。' : previewAssist ? '正在看辅助候选。点旋转或移动，将切回原稿编辑。' : page === 'teaching' ? '点旋转或移动，返回编舞工作台编辑原稿。' : playing ? '点旋转或移动，暂停在当前帧开始编辑。' : mirror ? '点旋转或移动，退出镜像后编辑原始姿态。' : manualEditing && transformTool === 'ik' ? '拖动手脚目标 · 松开自动记录实际变化的关节' : manualEditing && transformTool === 'translate' ? '拖动 XYZ 箭头移动全身 · 世界空间（m）' : manualEditing && transformTool === 'rotate' ? editableSelectedJoint ? '拖动 XYZ 旋转环摆姿 · 相对父骨骼' : rotateUnavailable : selectedJoint ? editableSelectedJoint ? '已选中关节。点「旋转关节」开始摆姿。' : rotateUnavailable : '点击关节点选择，再旋转关节；移动作用于整个角色。';

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
      case 'create-title': closeCreate(); break;
      case 'about-title': setAboutOpen(false); break;
    }
  } });

  useEditorShortcuts({
    enabled: ready && manualEditing && !!active.take && !modalOpen && !busy && !sceneActionBusy && saveStatus !== 'saving',
    readOnly: mirror,
    onStep: direction => {
      if (playing) return;
      const end = Math.ceil(active.countMap.durationSeconds * 30);
      const next = Math.max(0, Math.min(end, editorFrame + direction));
      if (next !== editorFrame) seek(frameTime(next, active.countMap.durationSeconds));
    },
    onPlay: () => { void togglePlay(); },
    onDelete: () => {
      if (playing) return;
      deleteSelectedPoint();
    },
    onUndo: () => { if (!playing) navigateHistory(-1); },
    onRedo: () => { if (!playing) navigateHistory(1); },
  });

  useEffect(() => {
    const selector = 'details.studio-more[open], details.scene-extras[open], details.camera-options[open], details.kf-more-actions[open], details.operation-history[open]';
    function dismiss(event: PointerEvent) {
      if (document.querySelector('[aria-modal="true"]')) return;
      document.querySelectorAll<HTMLDetailsElement>(selector).forEach(details => {
        if (event.target instanceof Node && !details.contains(event.target)) details.open = false;
      });
    }
    function escape(event: KeyboardEvent) {
      if (document.querySelector('[aria-modal="true"]')) return;
      if (event.key === 'Escape') document.querySelectorAll<HTMLDetailsElement>(selector).forEach(details => { details.open = false; });
    }
    document.addEventListener('pointerdown', dismiss, true);
    document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', dismiss, true); document.removeEventListener('keydown', escape); };
  }, []);

  useEffect(() => {
    const overlay = timelineOverlayRef.current;
    if (!overlay) { setTimelineInset(0); return; }
    const measure = () => setTimelineInset(Math.ceil(overlay.getBoundingClientRect().height) + 16);
    const observer = new ResizeObserver(measure);
    observer.observe(overlay); measure();
    return () => observer.disconnect();
  }, [!!manualSequence]);

  useEffect(() => { sessionRef.current = session; }, [session]);
  useEffect(() => { cancelAssistance(); setAssistCandidate(null); setPreviewAssist(false); setIKTarget(null); setIKResidual(null); }, [currentScene.id, active.countMap.id, session.revision]);
  useEffect(() => { setIKTarget(null); setIKResidual(null); }, [editorFrame, selectedJoint]);
  useEffect(() => () => { assistRun.current?.controller.abort(); }, []);
  useEffect(() => {
    let cancelled = false;
    loadCurrentScene<Session>().then(saved => {
      if (cancelled) return;
      if (saved && saved.project.history?.length && saved.project.history[saved.project.historyIndex]?.countMap?.confirmed) {
        applyScene(saved);
      } else setAudioBlob(demoAudio());
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
  useEffect(() => {
    if (!notice) return;
    const id = window.setTimeout(() => setNotice(''), 7000);
    return () => window.clearTimeout(id);
  }, [notice]);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => { if ((saveStatus !== 'saved' || poseDraftRef.current) && ready) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [saveStatus, ready]);

  function beep() {
    const context = cueContext.current;
    if (!context || context.state !== 'running') return;
    const oscillator = context.createOscillator(), gain = context.createGain();
    oscillator.frequency.value = 880; gain.gain.setValueAtTime(0.045, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + 0.06);
    oscillator.connect(gain); gain.connect(context.destination);
    oscillator.start(); oscillator.stop(context.currentTime + 0.07);
  }
  useEffect(() => { if (modalOpen && timelinePlayback.isPending()) pause(); }, [modalOpen]);
  useEffect(() => () => { audioReadToken.current += 1; void decodingContext.current?.close().catch(() => {}); const run = audition.current; audition.current = null; run?.audio.pause(); if (run) { cancelAnimationFrame(run.frame); URL.revokeObjectURL(run.url); } void cueContext.current?.close(); }, []);

  function pause() {
    const wasPlaying = timelinePlayback.isPlaying();
    const raw = timelinePlayback.pause();
    if (wasPlaying) timelinePlayback.seek(frameTime(frameAtTime(raw, active.countMap.durationSeconds), active.countMap.durationSeconds));
  }
  function seek(next: number) {
    if (timelinePlayback.isPending()) pause();
    if (guardPose({ type: 'seek', time: next })) return;
    seekDirect(Math.max(0, Math.min(active.countMap.durationSeconds, next)));
  }
  function seekDirect(next: number) { setCameraViewOverride(false); timelinePlayback.seek(next); }
  async function togglePlay() {
    if (playing || timelinePlayback.isPending()) { pause(); return; }
    if (guardPose({ type: 'play' })) return;
    if (!displayedTake || !audioRef.current || !ready || !audioBlob) return;
    setCameraViewOverride(false);
    const start = loop ? 0 : time >= active.countMap.durationSeconds - .01 ? 0 : time;
    await timelinePlayback.play(start);
  }
  function moveAudio(offsetSeconds: number) {
    if (playing || !manualEditing || mirror || busy || !audioBlob) return;
    const action: AudioMoveAction = { type: 'moveAudio', offsetSeconds: snapAudioOffset(offsetSeconds, active.countMap.durationSeconds), sceneId: currentScene.id, countMapId: active.countMap.id };
    if (guardPose(action)) return;
    performAudioMove(action);
  }
  function performAudioMove(action: AudioMoveAction) {
    if (action.sceneId !== currentScene.id || action.countMapId !== active.countMap.id || playing || !manualEditing || mirror || busy) return;
    if (action.offsetSeconds === (active.audioOffsetSeconds ?? 0)) return;
    commit({ ...active, audioOffsetSeconds: action.offsetSeconds }, { label: '移动音乐' });
  }
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
  function jumpHistory(next: number) {
    if (playing || busy || modalOpen || next === session.historyIndex || next < 0 || next >= session.history.length) return;
    if (poseDraftRef.current) cancelPointGesture();
    cancelCameraGesture(true); restoreHistoryCamera(session.history[next], next - session.historyIndex);
    cancelAssistance(); pause(); setPreviewAssist(false);
    setSession(previous => { const updated = { ...previous, historyIndex: next, revision: previous.revision + 1, teacherCheckedRevision: null }; sessionRef.current = updated; return updated; });
    const operationTime = session.history[next].operation?.time;
    if (operationTime !== undefined) seekDirect(operationTime);
    markSceneDirty();
  }
  function navigateHistory(direction: -1 | 1) {
    if (guardPose({ type: 'history', direction })) return;
    const next = session.historyIndex + direction;
    if (next < 0 || next >= session.history.length) return;
    restoreHistoryCamera(session.history[next], direction);
    cancelAssistance(); pause(); setPreviewAssist(false);
    setSession(previous => { const updated = { ...previous, historyIndex: next, revision: previous.revision + 1, teacherCheckedRevision: null }; sessionRef.current = updated; return updated; });
    markSceneDirty();
  }
  function markSceneDirty() { sceneChangeVersion.current += 1; setSaveStatus('dirty'); }
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
      ? createCameraTrackSampler(makeCameraTrack(active.cameraTrack.baseCamera), active.countMap.durationSeconds)(0)
      : next.operation?.tracks?.includes('camera') && next.operation.time !== undefined
        ? createCameraTrackSampler(active.cameraTrack, active.countMap.durationSeconds)(next.operation.time)
        : null;
    if (!exact) return;
    rememberCamera(exact); setCameraRestoreExact(exact); setCameraRestoreKey(previous => previous + 1);
  }
  function cameraCanEdit() { return manualEditing && !!active.take && !playing && !mirror && !modalOpen && !busy && !sceneActionBusy && saveStatus !== 'saving'; }
  function selectCameraPoint(exactTime: number) {
    if (!cameraCanEdit()) return;
    if (poseDraftRef.current && !recordPointChanges()) return;
    finishCameraGesture(); seekDirect(exactTime);
    setCameraSelected(true); setSelectedJoint(null); setSelectedPoint(null); setTransformTool('select');
  }
  function cancelCameraGesture(stopStage = false) {
    const gesture = cameraGesture.current; cameraGesture.current = null;
    if (!gesture) return;
    if (stopStage) setCameraCancelKey(previous => previous + 1);
    setCamera(cloneCameraPose(gesture.before));
    // Stage restores the exact camera and runtime up before issuing cancel.
    // A legacy restore here would clamp that already-restored authored view.
    setCameraViewOverride(gesture.override);
    if (gesture.version === sceneChangeVersion.current) setSaveStatus(gesture.status);
  }
  function finishCameraGesture(): boolean {
    const gesture = cameraGesture.current; cameraGesture.current = null;
    if (!gesture) return false;
    if (gesture.sceneId !== currentScene.id || gesture.revision !== sessionRef.current.revision || sameCameraPose(gesture.before, gesture.latest, 1e-6)) {
      if (gesture.version === sceneChangeVersion.current) setSaveStatus(gesture.status);
      setCameraViewOverride(gesture.override); return false;
    }
    try {
      const duration = gesture.snapshot.countMap.durationSeconds;
      const track = gesture.snapshot.cameraTrack ?? makeCameraTrack(gesture.before);
      const next = upsertCameraKeyframe(track, gesture.time, gesture.latest, duration);
      if (next === track) {
        if (gesture.version === sceneChangeVersion.current) setSaveStatus(gesture.status);
        setCameraViewOverride(false); return false;
      }
      rememberCamera(gesture.latest);
      setCameraViewOverride(false); setView('free');
      commit({ ...gesture.snapshot, cameraTrack: next }, { label: '调整相机', time: gesture.time, tracks: ['camera'] });
      return true;
    } catch (error) {
      setCamera(cloneCameraPose(gesture.before));
      setCameraViewOverride(gesture.override); setCameraRestoreKey(previous => previous + 1);
      if (gesture.version === sceneChangeVersion.current) setSaveStatus(gesture.status);
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
  function changeCameraPoint(exactTime: number, value: CameraPose) {
    if (!cameraSelected || !cameraCanEdit()) return;
    finishCameraGesture();
    const latest = sessionRef.current, snapshot = latest.history[latest.historyIndex];
    try {
      const track = snapshot.cameraTrack ?? makeCameraTrack(cloneCameraPose(cameraRef.current ?? cameraValue));
      const next = upsertCameraKeyframe(track, exactTime, value, snapshot.countMap.durationSeconds);
      if (next === track) return;
      setCameraViewOverride(false); setView('free');
      commit({ ...snapshot, cameraTrack: next }, { label: '调整相机', time: exactTime, tracks: ['camera'] });
    } catch (error) { setNotice(errorMessage(error)); }
  }
  function moveCameraPoint(sourceTime: number, targetTime: number) {
    if (!cameraCanEdit()) return;
    finishCameraGesture();
    const latest = sessionRef.current, snapshot = latest.history[latest.historyIndex];
    if (!snapshot.cameraTrack) return;
    try {
      const next = moveCameraKeyframe(snapshot.cameraTrack, sourceTime, targetTime, snapshot.countMap.durationSeconds);
      if (next === snapshot.cameraTrack) return;
      commit({ ...snapshot, cameraTrack: next }, { label: '移动相机点', time: targetTime, tracks: ['camera'] });
      setCameraSelected(true); setSelectedJoint(null); setSelectedPoint(null); setTransformTool('select');
      seekDirect(targetTime);
    } catch (error) { setNotice(errorMessage(error)); }
  }
  function deleteCameraPoint() {
    if (!cameraSelected || !cameraCanEdit()) return;
    const exactTime = time;
    finishCameraGesture();
    const latest = sessionRef.current, snapshot = latest.history[latest.historyIndex];
    if (!snapshot.cameraTrack) return;
    try {
      const next = removeCameraKeyframe(snapshot.cameraTrack, exactTime, snapshot.countMap.durationSeconds);
      if (next === snapshot.cameraTrack) return;
      const { cameraTrack: _cameraTrack, ...withoutCamera } = snapshot;
      const nextSnapshot = next.keys.length ? { ...snapshot, cameraTrack: next } : withoutCamera;
      if (!next.keys.length) {
        rememberCamera(createCameraTrackSampler(snapshot.cameraTrack, snapshot.countMap.durationSeconds)(exactTime)); setView('free');
      }
      setCameraViewOverride(!next.keys.length);
      commit(nextSnapshot, { label: '删除相机点', time: exactTime, tracks: ['camera'] });
    } catch (error) { setNotice(errorMessage(error)); }
  }
  const handleJointPosition = useCallback((position: Vec3 | null) => { setJointPosition(position); }, []);
  function chooseJoint(joint: JointName | null) { finishCameraGesture(); setCameraSelected(false); setSelectedJoint(joint); setSelectedPoint(joint); if (joint && transformTool === 'select') setTransformTool('rotate'); markSceneDirty(); }
  function selectMotionPoint(exactTime: number, point: JointName | 'root') {
    if (playing || !manualEditing || modalOpen || busy) return;
    seek(exactTime); setCameraSelected(false); setSelectedPoint(point);
    if (point === 'root') setTransformTool('translate');
    else { setSelectedJoint(point); setTransformTool('rotate'); }
  }
  function chooseView(next: Exclude<StageView, 'free'>) { finishCameraGesture(); setCameraRestoreExact(null); setCameraViewOverride(true); setView(next); setCameraResetKey(previous => previous + 1); markSceneDirty(); }
  function focusCamera(kind: 'actor' | 'joint') {
    if (!displayedTake || !ready || busy || (kind === 'joint' && !selectedJoint)) return;
    finishCameraGesture(); setCameraRestoreExact(null); setCameraViewOverride(true);
    setCameraFocus({ key: ++cameraFocusCounter.current, kind, joint: kind === 'joint' ? selectedJoint! : undefined });
  }
  async function refreshScenes() { setSceneList(await listScenes()); }
  async function openLibrary() {
    pause(); setLibraryOpen(true); setLibraryBusy(true);
    try { await refreshScenes(); }
    catch (error) { setNotice(errorMessage(error)); }
    finally { setLibraryBusy(false); }
  }
  function applyScene(scene: SceneDocument<Session>, saved = true) {
    cameraGesture.current = null; setCameraRestoreExact(null); setCameraSelected(false); setCameraViewOverride(false);
    cancelAssistance(); setAssistCandidate(null); setPreviewAssist(false); pause(); closeCreate();
    const viewer = scene.viewer, map = scene.project.history[scene.project.historyIndex].countMap;
    setCurrentScene(scene); setSession(scene.project); sessionRef.current = scene.project;
    setAudioBlob(scene.audio); setAudioName(scene.audioName);
    const restoredTime = Math.max(0, Math.min(map.durationSeconds, viewer.time));
    setTime(restoredTime);
    setSelected(Math.max(0, Math.min(map.octetCount - 1, viewer.selectedSlot)));
    setView(viewer.view); setMirror(viewer.mirror); setRate(viewer.rate); setLoop(viewer.loop); setCountSound(viewer.countSound);
    setSelectedJoint(viewer.selectedJoint); setSelectedPoint(viewer.selectedJoint); setJointPosition(null); pointGesture.current = null;
    cameraRef.current = viewer.camera; setCamera(viewer.camera);
    setCameraRestoreKey(previous => previous + 1);
    setCameraFocus(null);
    setPendingTransfer(null);
    setPage('studio');
    setTransformTool(viewer.transformTool ?? 'rotate');
    poseDraftRef.current = null; setPoseDraft(null); poseDraftBaseline.current = null; setCollisionFeedback(null);
    draftRotationIntents.current.clear(); draftRootIntent.current = false;
    sceneChangeVersion.current += 1; setSaveStatus(saved ? 'saved' : 'dirty');
  }
  async function save(): Promise<boolean> { if (guardPose({ type: 'save' })) return false; return performSave(); }
  async function performSave(): Promise<boolean> {
    if (!audioBlob) { setNotice('原音乐缺失，请先恢复原音乐；编舞数据仍可下载为项目备份。'); return false; }
    const version = sceneChangeVersion.current, snapshot = sessionRef.current;
    setSaveStatus('saving');
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    const document: SceneDocument<Session> = {
      ...currentScene, project: snapshot, audio: audioBlob, audioName,
      viewer: { ...currentScene.viewer, view, camera: cameraRef.current, mirror, rate, loop, countSound, selectedSlot: selected, selectedJoint, time, editorMode: 'keyframes' as const, transformTool },
    };
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
        const project = initialSession(); project.history[0].title = '未命名场景';
        await selectStoredScene(null);
        applyScene(createScene({ name: '未命名场景', project, audio: demoAudio(), audioName: '八拍节奏示例.wav', viewer: { ...defaultSceneViewer(), editorMode: 'keyframes' } }), false);
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
          name: action.name, project: { ...sessionRef.current, teacherCheckedRevision: null }, audio: action.audio, audioName: action.audioName,
          viewer: { ...currentScene.viewer, view, camera: cameraRef.current, mirror, rate, loop, countSound, selectedSlot: selected, selectedJoint, time, editorMode: 'keyframes' as const, transformTool },
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
          else {
            const project = initialSession(); project.history[0].title = '未命名场景';
            applyScene(createScene({ name: '未命名场景', project, audio: demoAudio(), audioName: '八拍节奏示例.wav', viewer: { ...defaultSceneViewer(), editorMode: 'keyframes' } }), false);
          }
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
  async function confirmRename() {
    if (!renameTarget || !renameValue.trim()) return;
    const name = renameValue.trim();
    if (renameTarget.id === currentScene.id) {
      setCurrentScene(previous => ({ ...previous, name }));
      setSession(previous => ({ ...previous, history: previous.history.map(snapshot => ({ ...snapshot, title: name })) }));
      markSceneDirty(); setRenameTarget(null); setNotice('场景名称已修改，点击保存即可保留。');
    } else {
      setLibraryBusy(true);
      try { const renamed = await renameScene(renameTarget.id, name); if (!renamed) throw new Error('场景已被删除，请刷新列表。'); await refreshScenes(); setRenameTarget(null); setNotice('场景名称已保存。'); }
      catch (error) { setNotice(errorMessage(error)); }
      finally { setLibraryBusy(false); }
    }
  }
  function exportProject() {
    if (guardPose({ type: 'projectBackup' })) return;
    const blob = encodeSceneJsonBackup({ ...currentScene, project: sessionRef.current, audio: null, audioName, viewer: { ...currentScene.viewer, view, camera: cameraRef.current, mirror, rate, loop, countSound, selectedSlot: selected, selectedJoint, time, editorMode: 'keyframes' as const, transformTool } });
    const url = URL.createObjectURL(blob), link = document.createElement('a');
    link.href = url; link.download = 'choreo-studio-project.json'; link.click(); URL.revokeObjectURL(url);
    setNotice(poseDraftRef.current ? '已下载已写入的场景数据。姿态草稿和原音乐未包含。' : '已下载场景数据备份。原音乐未包含，请另外保留。');
  }
  async function exportFullScene() {
    if (!ready || busy || !audioBlob) return;
    if (guardPose({ type: 'backup' })) return;
    const capturedTime = playing ? currentEditTime() : time;
    pause(); setBusy('正在准备场景备份');
    const snapshot = sessionRef.current;
    try {
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
      const sceneSnapshot: SceneDocument<Session> = {
        ...currentScene, project: snapshot, audio: audioBlob, audioName,
        viewer: { ...currentScene.viewer, view, camera: cameraRef.current, mirror, rate, loop, countSound, selectedSlot: selected, selectedJoint, time: capturedTime, editorMode: 'keyframes' as const, transformTool },
      };
      const blob = await encodeSceneBackup(sceneSnapshot);
      const url = URL.createObjectURL(blob), link = document.createElement('a');
      link.href = url; link.download = `${currentScene.name.replace(/[\\/:*?"<>|]/g, '_').slice(0, 60) || 'scene'}.choreo`;
      link.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1000);
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
    setImportScene({
      ...currentScene, project: sessionRef.current, audio: null, audioName,
      viewer: { ...currentScene.viewer, view, camera: cameraRef.current, mirror, rate, loop, countSound, selectedSlot: selected, selectedJoint, time, editorMode: 'keyframes' as const, transformTool },
    });
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
  function openCreate() {
    if (guardPose({ type: 'music' })) return;
    cancelAudioRead(); stopAudition();
    pause(); setDraftBlob(audioBlob); setDraftName(audioName); setDraftDuration(session.audioDuration); setDraftTitle(currentScene.name);
    setDraftBpm(active.countMap.bpm); setDraftRelation(active.countMap.musicBeatsPerDanceCount);
    const octetSeconds = 60 / active.countMap.bpm * active.countMap.musicBeatsPerDanceCount * 8;
    const startOctet = Math.round((active.countMap.sourceOffsetSeconds - active.countMap.firstCountSourceSeconds) / octetSeconds);
    setDraftFirst(active.countMap.firstCountSourceSeconds); setDraftStart(startOctet + 1); setDraftOctets(active.countMap.octetCount); setDraftError(''); setCreateOpen(true);
  }
  function cancelAudioRead() {
    audioReadToken.current += 1;
    const context = decodingContext.current; decodingContext.current = null;
    if (context && context.state !== 'closed') void context.close().catch(() => {});
    setDecoding(false);
  }
  function closeCreate() {
    cancelAudioRead(); stopAudition(); setCreateOpen(false);
  }
  function useDemoMusic() {
    cancelAudioRead(); stopAudition();
    setDraftBlob(demoAudio()); setDraftName('八拍节奏示例.wav'); setDraftDuration(40); setDraftBpm(120); setDraftRelation(1); setDraftFirst(0); setDraftStart(1); setDraftOctets(8); setDraftError('');
  }
  async function chooseAudio(file: File | undefined) {
    if (!file) return;
    cancelAudioRead(); stopAudition();
    if (file.size > 100 * 1024 * 1024) { setDraftError('请选择小于 100 MB 的音频。'); return; }
    const token = audioReadToken.current;
    setDecoding(true); setDraftError('');
    let context: AudioContext | null = null;
    try {
      context = new AudioContext(); decodingContext.current = context;
      const bytes = await file.arrayBuffer();
      if (token !== audioReadToken.current) return;
      const decoded = await context.decodeAudioData(bytes);
      if (token !== audioReadToken.current) return;
      if (!Number.isFinite(decoded.duration)) throw new Error('音频时长无效。');
      if (decoded.duration > 600) throw new Error('请选择不超过 10 分钟的音频。');
      if (decoded.duration < 16) throw new Error('音乐至少需要 16 秒，才能选择完整的八拍组合。');
      setDraftBlob(file); setDraftName(file.name); setDraftDuration(decoded.duration); setDraftFirst(0); setDraftStart(1);
    } catch (error) { if (token === audioReadToken.current) setDraftError(error instanceof Error && /请选择|音乐至少/.test(error.message) ? error.message : '音频无法解码，请换用 MP3、WAV 或浏览器支持的音频文件。'); }
    finally {
      if (context && context.state !== 'closed') { try { await context.close(); } catch { /* An invalidated read may already have closed its context. */ } }
      if (token === audioReadToken.current) { decodingContext.current = null; setDecoding(false); }
    }
  }
  let draftMap: CountMap | null = null, mapError = '';
  try { draftMap = makeCountMap({ bpm: draftBpm, musicBeatsPerDanceCount: draftRelation, firstCountSourceSeconds: draftFirst, startOctet: draftStart - 1, octetCount: draftOctets, audioDurationSeconds: draftDuration }); }
  catch (error) { mapError = errorMessage(error); }
  function stopAudition() {
    const run = audition.current; audition.current = null;
    if (run) { run.audio.pause(); cancelAnimationFrame(run.frame); URL.revokeObjectURL(run.url); }
    setAuditionCount(0);
  }
  async function auditionCounts() {
    stopAudition(); if (!draftBlob || !draftMap) return;
    const url = URL.createObjectURL(draftBlob), audio = new Audio(url);
    const run = { audio, url, frame: 0 }; audition.current = run;
    const offset = draftMap.sourceOffsetSeconds, interval = 60 / draftBpm * draftRelation;
    audio.currentTime = offset;
    try {
      if (!cueContext.current) cueContext.current = new AudioContext(); await cueContext.current.resume();
      if (audition.current !== run) return;
      await audio.play();
      if (audition.current !== run) { audio.pause(); return; }
      let previous = -1;
      const tick = () => {
        if (audition.current !== run) return;
        const index = Math.floor(Math.max(0, audio.currentTime - offset) / interval);
        if (index >= 8) { stopAudition(); return; }
        if (index !== previous) { previous = index; setAuditionCount(index + 1); beep(); }
        run.frame = requestAnimationFrame(tick);
      };
      run.frame = requestAnimationFrame(tick);
    } catch { if (audition.current === run) { stopAudition(); setDraftError('试听未启动，请再试一次。'); } }
  }
  function confirmMusic() { if (hasManualKeys || active.cameraTrack?.keys.length) { setPendingResetAction('music'); return; } performConfirmMusic(); }
  function performConfirmMusic() {
    if (!draftMap || !draftBlob || decoding) return;
    cameraGesture.current = null; setCameraRestoreExact(null); setCameraSelected(false); setCameraViewOverride(false);
    cancelAssistance(); closeCreate(); pause();
    setAudioBlob(draftBlob); setAudioName(draftName); setTime(0); setSelected(0);
    setSession(previous => ({ history: [neutralSnapshot(draftMap!, draftTitle.trim() || '未命名组合')], historyIndex: 0, revision: previous.revision + 1, audioDuration: draftDuration, teacherCheckedRevision: null }));
    clearPoseDraft(); setQueuedPoseAction(null); markSceneDirty(); setCreateOpen(false); setPage('studio'); setTransformTool('rotate');
    setCurrentScene(previous => ({ ...previous, name: draftTitle.trim() || '未命名场景' }));
    setNotice('当前场景的音乐和选段已确认，可直接选择时间和部位开始手动编辑。');
  }
  function guardPose(action: PoseAction | AssistAction): boolean {
    if (cameraGesture.current) {
      const changed = finishCameraGesture();
      if (changed) { setQueuedPoseAction(action); return true; }
    }
    if (!poseDraftRef.current) return false;
    if (!recordPointChanges()) return true;
    setQueuedPoseAction(action); return true;
  }
  function clearPoseDraft(restoreStatus = false) {
    const baseline = poseDraftBaseline.current;
    poseDraftRef.current = null; setPoseDraft(null); poseDraftBaseline.current = null; setCollisionFeedback(null);
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
      if (rotationsDiffer(copied.joints[joint], previous.joints[joint])) {
        if (rotationsDiffer(copied.joints[joint], reference.joints[joint])) draftRotationIntents.current.add(joint);
        else draftRotationIntents.current.delete(joint);
      }
    }
    if (rootsDiffer(copied.root, previous.root)) draftRootIntent.current = rootsDiffer(copied.root, reference.root);
    if (manualSequence?.footLocks?.length) copied = applyFootLocks(copied, manualSequence.footLocks, time * 30, active.countMap.durationSeconds, authorProtection(manualSequence, time * 30, draftRotationIntents.current, draftRootIntent.current)).pose;
    // Linked IK/contact output uses the exact unit tuple the point writer will
    // store. Retained source channels are never normalized here.
    for (const joint of JOINT_NAMES) if (rotationsDiffer(copied.joints[joint], previous.joints[joint])) copied.joints[joint] = canonicalEditRotation(copied.joints[joint]);
    // Only new stage gestures enter this guard. Stored/imported points and
    // explicit numeric author edits retain their original channels exactly.
    const collision = constrainBodyCollisions(previous, copied);
    copied = collision.pose;
    const collisionMessage = !collision.limited ? null : collision.limitReason === 'joint-limit' ? '已达到关节建议边界' : collision.limitReason === 'sweep-budget' ? '移动幅度过大，请分段调整' : collision.blockingCollisions.floorPenetrations.length ? '已阻止穿地' : '已阻止身体穿插';
    setCollisionFeedback(collisionMessage);
    // Foot-lock outputs are linked changes, not new author protection. Keep
    // only the direct gesture intents; recordPointChanges captures all results.
    for (const joint of draftRotationIntents.current) if (!rotationsDiffer(copied.joints[joint], reference.joints[joint])) draftRotationIntents.current.delete(joint);
    if (!rootsDiffer(copied.root, reference.root)) draftRootIntent.current = false;
    if (!posesDiffer(copied, reference)) { clearPoseDraft(true); setCollisionFeedback(collisionMessage); return false; }
    if (!poseDraftRef.current) poseDraftBaseline.current = { status: saveStatus === 'saving' ? 'dirty' : saveStatus, version: sceneChangeVersion.current };
    poseDraftRef.current = copied; setPoseDraft(copied); setSaveStatus('dirty'); return true;
  }
  function beginPointGesture() {
    if (!active.take || !manualSequence || !manualEditing || playing || mirror || modalOpen || busy) return false;
    if (!pointGesture.current) setCollisionFeedback(null);
    pointGesture.current ??= { sceneId: currentScene.id, revision: session.revision, time, snapshot: active, sequence: manualSequence, before: clonePose(sampleTake(active.take, time)) };
    return true;
  }
  function cancelPointGesture() { pointGesture.current = null; clearPoseDraft(true); }
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
      commit({ ...snapshot, manual: next, take }, { label: `调整${tracks.map(track => track === 'root' ? '整体位移' : STAGE_JOINT_LABELS[track]).join('、')}`, time: exactTime, tracks });
      return true;
    } catch (error) { setNotice(errorMessage(error)); cancelPointGesture(); return false; }
  }
  function handleJointRotation(joint: JointName, rotation: Quat, phase: 'start' | 'change' | 'end') {
    if (phase === 'start') { beginPointGesture(); return; }
    if (phase === 'end') { recordPointChanges(); return; }
    if (!pointGesture.current && !beginPointGesture()) return;
    const next = clonePose(poseDraftRef.current ?? pointGesture.current!.before);
    next.joints[joint] = [...rotation]; updatePoseDraft(next);
    return poseDraftRef.current ?? pointGesture.current!.before;
  }
  function handleRootPosition(position: Vec3, phase: 'start' | 'change' | 'end') {
    if (phase === 'start') { beginPointGesture(); return; }
    if (phase === 'end') { recordPointChanges(); return; }
    if (!pointGesture.current && !beginPointGesture()) return;
    const next = clonePose(poseDraftRef.current ?? pointGesture.current!.before);
    next.root = [...position]; updatePoseDraft(next);
    return poseDraftRef.current ?? pointGesture.current!.before;
  }
  function handleIKTarget(effector: IKEffector, target: Vec3, phase: 'start' | 'change' | 'end') {
    if (phase === 'start') { beginPointGesture(); return; }
    if (phase === 'end') { recordPointChanges(); return; }
    if (!pointGesture.current && !beginPointGesture()) return;
    try {
      const source = poseDraftRef.current ?? pointGesture.current!.before;
      const result = solveLimbIK(source, effector, target);
      updatePoseDraft(result.pose);
      const accepted = poseDraftRef.current ?? pointGesture.current!.before;
      const endpoint = evaluatePose(accepted)[effector].position;
      setIKTarget([...target]); setIKResidual(Math.hypot(...endpoint.map((value, axis) => value - target[axis])));
      return accepted;
      } catch (error) { setNotice(errorMessage(error)); cancelPointGesture(); }
  }
  function changeMotionPointValue(exactTime: number, point: JointName | 'root', value: Vec3 | Quat) {
    if (!active.take || !manualSequence || playing || mirror || !manualEditing || modalOpen || busy || exactTime !== time) return;
    try {
      const before = sampleTake(active.take, exactTime), after = clonePose(before);
      if (point === 'root') after.root = value as Vec3;
      else {
        const length = Math.hypot(...value);
        if (!Number.isFinite(length) || length <= Number.EPSILON) throw new Error('旋转不能使用零四元数。');
        after.joints[point] = value.map(component => component / length) as Quat;
      }
      const next = upsertMotionPointChanges(manualSequence, exactTime, before, after, active.take);
      if (next === manualSequence) return;
      commit({ ...active, manual: next, take: bakeKeyframeSequence(next) }, { label: `调整${point === 'root' ? '整体位移' : STAGE_JOINT_LABELS[point]}`, time: exactTime, tracks: [point] });
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
        commit({ ...active, manual: next, take: bakeKeyframeSequence(next) }, { label: `恢复${point === 'root' ? '整体位移' : STAGE_JOINT_LABELS[point]}原始点`, time, tracks: [point] }); return;
      }
      if (frameTime(editorFrame, active.countMap.durationSeconds) === time) deleteKeyframe(point === 'root' ? { kind: 'root', frame: editorFrame } : { kind: 'joint', joint: point, frame: editorFrame });
    } catch (error) { setNotice(errorMessage(error)); }
  }
  function lockFoot(foot: LockedFoot, endFrame: number) {
    if (guardPose({ type: 'lockFoot', foot, endFrame })) return;
    if (!manualSequence || !editorPose || !manualEditing || playing || mirror || modalOpen) return;
    try {
      const contact = analyzePose(editorPose).feet[foot === 'LeftFoot' ? 'Left' : 'Right'];
      if (!contact.grounded || contact.minimumHeightMeters < -STANDARD_HUMAN_PROFILE.ground.penetrationToleranceMeters) throw new Error('请先将这只脚落在地面，再锁定支撑脚。');
      const lock = captureFootLock(editorPose, foot, editorFrame, endFrame);
      const next = addFootLock(manualSequence, lock), take = bakeKeyframeSequence(next);
      commit({ ...active, manual: next, take }, { label: '锁定支撑脚', time });
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
        await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
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
  function showAssistCandidate() {
    if (guardPose({ type: 'previewAssist' })) return;
    if (!validAssistCandidate()) { setNotice('作品已经改变，请重新生成候选。'); return; }
    pause(); setPreviewAssist(true); seekDirect(0);
  }
  function adoptAssistance() {
    if (!validAssistCandidate()) { setNotice('作品已经改变，请重新生成候选。'); return; }
    if (guardPose({ type: 'adoptAssist' })) return;
    if (assistCandidate?.kind !== 'steps' && hasManualKeys) { setPendingResetAction('adoptAssist'); return; }
    performAdoptAssistance();
  }
  function performAdoptAssistance() {
    if (!validAssistCandidate() || !assistCandidate) { setNotice('作品已经改变，请重新生成候选。'); return; }
    if (assistCandidate.kind === 'steps' && assistCandidate.report.stepCount === 0) { setNotice('当前路径没有可自动迈步的区间，请调整位移关键帧后重试。'); return; }
    commit({ ...active, plan: assistCandidate.plan, take: assistCandidate.take, manual: assistCandidate.kind === 'steps' ? assistCandidate.manual : undefined });
    clearPoseDraft(); setAssistCandidate(null); setPreviewAssist(false); seekDirect(0);
    setNotice(assistCandidate.kind === 'steps' ? '已采用自动步伐。老师关键帧、动作基底与脚锁保持原样；后续 K 帧会重算步伐。' : '已采用候选；原编舞及脚锁保留在撤销历史中。');
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
      commit({ ...active, manual: next, take: bakeKeyframeSequence(next) }, { label: '删除手动关键帧', time: frameTime(target.frame, active.countMap.durationSeconds), tracks: target.kind === 'root' ? ['root'] : target.kind === 'joint' ? [target.joint] : undefined });
      const scope = target.kind === 'joint' ? `${STAGE_JOINT_LABELS[target.joint]}的旋转 K` : target.kind === 'root' ? 'Root 位移 K' : '全部显式关键帧';
      setNotice(`已删除第 ${target.frame} 帧${scope}，可撤销恢复。`);
    } catch (error) { setNotice(errorMessage(error)); }
  }
  function requestKeyframeTransfer(request: Omit<KeyframeTransferRequest, 'collision'>) {
    if (!manualSequence || !active.take || playing || mirror || !manualEditing || busy) return;
    const action: TransferAction = { type: 'transferKeys', originFrame: editorFrame, request: { ...request, scope: request.scope.kind === 'joints' ? { ...request.scope, joints: [...request.scope.joints] } : { ...request.scope } }, sceneId: currentScene.id, countMapId: active.countMap.id };
    if (guardPose(action)) return;
    performKeyframeTransfer(action);
  }
  function performKeyframeTransfer(action: TransferAction, replacement?: PendingTransfer) {
    if (!manualSequence || !active.take || playing || mirror || !manualEditing || busy) return;
    if (poseDraftRef.current) {
      setPendingTransfer(null); guardPose(action); return;
    }
    if (action.sceneId !== currentScene.id || action.countMapId !== active.countMap.id || action.originFrame !== editorFrame) {
      setPendingTransfer(null); setNotice('来源场景、数拍或帧已改变，请重新操作关键帧。'); return;
    }
    if (replacement && (replacement.sequenceId !== manualSequence.id || replacement.revision !== session.revision)) {
      setPendingTransfer(null); setNotice('关键帧序列已改变，请重新检查目标帧。'); return;
    }
    try {
      const result = transferKeyframes(manualSequence, { ...action.request, collision: replacement ? 'replace' : 'reject' }, active.take);
      if (result.status === 'noop') {
        setPendingTransfer(null);
        setNotice('关键帧没有变化，未新增动画版本。'); return;
      }
      if (result.status === 'conflict') {
        setPendingTransfer({ action, sequenceId: manualSequence.id, revision: session.revision, collisions: result.collisions }); return;
      }
      // Baking can reject resource overflow; commit only after all checks pass.
      const take = bakeKeyframeSequence(result.sequence);
      const tracks: (JointName | 'root')[] = [...(JSON.stringify(result.sequence.root) !== JSON.stringify(manualSequence.root) ? ['root' as const] : []), ...JOINT_NAMES.filter(joint => JSON.stringify(result.sequence.rotations[joint] ?? []) !== JSON.stringify(manualSequence.rotations[joint] ?? []))];
      commit({ ...active, manual: result.sequence, take }, { label: `${action.request.operation === 'move' ? '移动' : '复制'}${tracks.map(track => track === 'root' ? '整体位移' : STAGE_JOINT_LABELS[track]).join('、')}关键帧`, time: frameTime(action.request.targetFrame, take.durationSeconds), tracks });
      setPendingTransfer(null); seekDirect(frameTime(action.request.targetFrame, take.durationSeconds));
      setNotice(`已${action.request.operation === 'move' ? '移动' : '复制'} ${result.sourceKeyCount} 条显式 K 到第 ${action.request.targetFrame} 帧，可撤销恢复。`);
    } catch (error) { setNotice(errorMessage(error)); }
  }
  function currentEditTime() {
    const rawTime = playing ? timelinePlayback.getTime() : time;
    return Math.max(0, Math.min(active.countMap.durationSeconds, rawTime));
  }
  function chooseTransformTool(tool: StageTransformTool) {
    if (tool === 'select') { finishCameraGesture(); setCameraSelected(false); setTransformTool(tool); markSceneDirty(); return; }
    if (!active.take || busy || (tool === 'rotate' && !editableSelectedJoint) || (tool === 'ik' && !getIKEffector(selectedJoint))) return;
    const snapped = currentEditTime();
    const wasPreview = previewAssist;
    finishCameraGesture(); setCameraSelected(false); pause(); setMirror(false); setPreviewAssist(false); setPage('studio'); setTransformTool(tool); setSelectedPoint(tool === 'translate' ? 'root' : selectedJoint);
    seekDirect(snapped); markSceneDirty();
    if (wasPreview) setNotice('已切回原稿编辑。候选尚未采用，松开后自动记录修改的数据点。');
  }
  function changeMirror(value: boolean) {
    setMirror(value); markSceneDirty();
  }
  function openTeachingPreview() {
    if (guardPose({ type: 'teaching' })) return;
    pause(); setPage(previous => previous === 'teaching' ? 'studio' : 'teaching');
    setPreviewAssist(false);
  }
  function setTeachingReview(checked: boolean) {
    if (page !== 'teaching' || !active.take || previewAssist || !ready || busy || sceneActionBusy || saveStatus === 'saving') return;
    setSession(previous => {
      const next = { ...previous, teacherCheckedRevision: checked ? previous.revision : null };
      sessionRef.current = next; return next;
    });
    markSceneDirty();
    setNotice(checked ? '已记录本版试看。试看记录不代表真实动作已通过教学审核。' : '已撤销本版试看记录。');
  }
  function executePoseAction(action: PoseAction | AssistAction) {
    switch (action.type) {
      case 'seek': seek(action.time); break;
      case 'scene': requestSceneAction(action.action); break;
      case 'history': navigateHistory(action.direction); break;
      case 'play': void togglePlay(); break;
      case 'save': void performSave(); break;
      case 'music': openCreate(); break;
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
    if (!queuedPoseAction || poseDraft) return;
    setQueuedPoseAction(null); executePoseAction(queuedPoseAction);
  }, [queuedPoseAction, poseDraft]);
  function confirmResetAction() {
    const action = pendingResetAction; setPendingResetAction(null);
    if (action === 'music') performConfirmMusic();
    else if (action === 'adoptAssist') performAdoptAssistance();
  }
  const playbackLoop = <button className={`icon-button ${loop ? 'toggled' : ''}`} aria-label="循环整段" title="循环整段" aria-pressed={loop} onClick={() => { setLoop(!loop); markSceneDirty(); if (!loop) seek(0); }}><Repeat2 size={18} />循环整段</button>;
  const playbackSpeed = <select aria-label="播放速度" value={rate} onChange={event => { setRate(Number(event.target.value)); markSceneDirty(); }}><option value={0.5}>0.5×</option><option value={0.75}>0.75×</option><option value={1}>1×</option></select>;
  const playbackTransport = <div className="player-main"><button className="play-button" aria-label={playing ? '暂停' : '播放'} disabled={!displayedTake || !ready || !audioBlob} onClick={togglePlay}>{playing ? <Pause size={19} fill="currentColor" /> : <Play size={19} fill="currentColor" />}</button><span className="time-display">{seconds(time)}<span> / {seconds(active.countMap.durationSeconds)}</span></span></div>;
  const playbackOptions = <details className="editor-disclosure playback-options"><summary>播放选项</summary><div className="player-options"><div className="playback-extra-options">{playbackLoop}<label className="playback-rate-option">速度{playbackSpeed}</label></div><button className={mirror ? 'option active' : 'option'} aria-pressed={mirror} onClick={() => changeMirror(!mirror)}><Copy size={14} />镜像观看</button><button className={countSound ? 'option active' : 'option'} aria-pressed={countSound} onClick={() => { setCountSound(!countSound); markSceneDirty(); }}><Volume2 size={15} />节拍提示</button><span>{mirror ? "镜像仅影响观看，坐标保持原始世界空间" : "播放与视角不修改动作数据"}</span></div></details>;
  const manualTimeline = manualSequence ? <KeyframeTimeline
    camera={{ track: active.cameraTrack, value: cloneCameraPose(cameraValue), selected: cameraSelected, onSelect: selectCameraPoint, onChange: changeCameraPoint, onMove: moveCameraPoint, onDelete: deleteCameraPoint }}
    audio={{ name: audioName, offsetSeconds: active.audioOffsetSeconds ?? 0, durationSeconds: active.countMap.durationSeconds, waveform, onMove: moveAudio, disabled: !audioBlob }}
    sequence={manualSequence} take={active.take ?? undefined} selectedJoint={selectedJoint} selectedPoint={selectedPoint} selectedTime={time}
    onSelectPoint={selectMotionPoint} onSelectJoint={chooseJoint} onPointValueChange={changeMotionPointValue} onDeletePoint={deleteSelectedPoint}
    frame={editorFrame} onFrame={frame => seek(frameTime(frame, active.countMap.durationSeconds))} playing={playing} mirror={mirror}
    readOnly={!manualEditing || !!busy || modalOpen || sceneActionBusy || saveStatus === 'saving'} dirty={!!poseDraft} transport={playbackTransport} playbackOptions={playbackOptions} onTime={seek}
    onTransferKeyframes={requestKeyframeTransfer}
  /> : null;

  const assistanceCandidatePanel = assistCandidate && <section className="assist-candidate" aria-label={assistCandidate.kind === 'steps' ? '步伐候选' : '辅助候选'}><div><strong>{assistCandidate.kind === 'steps' ? '步伐预览' : assistCandidate.kind === 'ai' ? 'AI 编排候选' : '重力候选'}</strong><p>{assistCandidate.summary}</p>{assistCandidate.kind === 'steps' && <StepAssistanceSummary report={assistCandidate.report} label="步伐预览结果" />}<small>{assistCandidate.kind === 'steps' ? '本地平地步伐计算；采用保留原关键帧、动作基底与脚锁。' : assistCandidate.kind === 'ai' ? 'Workers AI 选择原创动作与幅度，姿态受关节限位；接触与物理仍需检查。' : '内置人体与 Rapier 动态代理；尚未经过教师或实测人体验证。'}</small></div><div className="assist-actions">{(assistCandidate.kind !== 'steps' || assistCandidate.report.stepCount > 0) && <button className="button secondary compact" onClick={() => { if (previewAssist) { pause(); setPreviewAssist(false); } else showAssistCandidate(); }}>{previewAssist ? '返回原稿' : '预览候选'}</button>}<button className="button primary compact" disabled={!validAssistCandidate() || (assistCandidate.kind === 'steps' && assistCandidate.report.stepCount === 0)} onClick={adoptAssistance}>{assistCandidate.kind === 'steps' ? '采用步伐' : '采用候选'}</button><button className="text-button" onClick={() => { pause(); setPreviewAssist(false); setAssistCandidate(null); }}>{assistCandidate.kind === 'steps' ? '关闭预览' : '关闭候选'}</button></div></section>;

  return <div className="app-shell minimal-studio immersive-studio" style={{ '--timeline-overlay-height': `${timelineInset}px` } as React.CSSProperties}>
    <audio ref={audioRef} src={audioUrl || undefined} preload="auto" onLoadedMetadata={timelinePlayback.syncAudio} onError={() => { if (ready && audioUrl) setNotice('音乐无法播放。请重新导入支持的音频格式。'); }} />
    <main className="main-content">
      <header className="topbar">
        <div className="project-heading"><div className="project-title"><h1>{currentScene.name}</h1><button className="icon-button rename-current" aria-label="修改当前场景名称" title="修改场景名称" onClick={() => { setRenameTarget({ id: currentScene.id, name: currentScene.name }); setRenameValue(currentScene.name); }}><Pencil size={13} /></button></div></div>
        <div className="project-tools"><span className={`save-state ${saveStatus}`}><span />{saveStatus === 'saved' ? '已保存到本机' : saveStatus === 'saving' ? '保存中' : saveStatus === 'failed' ? '保存失败' : '有未保存更改'}</span><button className="button secondary compact scene-library-button" onClick={() => { void openLibrary(); }} disabled={!ready || sceneActionBusy || saveStatus === "saving"}><FolderOpen size={15} />场景</button><div className="history-tools"><button className="icon-button" title="撤销" aria-label="撤销" disabled={session.historyIndex === 0 || !!busy} onClick={() => navigateHistory(-1)}><Undo2 size={17} /></button><button className="icon-button" title="重做" aria-label="重做" disabled={session.historyIndex >= session.history.length - 1 || !!busy} onClick={() => navigateHistory(1)}><Redo2 size={17} /></button><details className="operation-history"><summary aria-label="操作记录" title="操作记录">记录</summary><div className="operation-history-list" role="list" aria-label="操作栈"><small>保留最近 {session.history.length} 个版本 · 一次拖动一步</small>{session.history.map((snapshot, index) => <button key={index} role="listitem" aria-current={index === session.historyIndex ? 'step' : undefined} className={index === session.historyIndex ? 'current' : index > session.historyIndex ? 'undone' : ''} onClick={() => jumpHistory(index)} disabled={playing || !!busy}>{snapshot.operation?.label ?? (index === 0 ? '导入／初始作品' : '既有操作')}<small>{snapshot.operation?.time === undefined ? '' : `${snapshot.operation.time.toPrecision(9)} s`}</small></button>)}</div></details></div><button className="button secondary compact save-button" onClick={save} disabled={!ready || !audioBlob || saveStatus === 'saving'}><Save size={15} />保存</button><details className="studio-more"><summary aria-label="更多工具"><SlidersHorizontal size={17} /></summary><div className="studio-more-content"><button className="button secondary compact new-project" title="调整当前场景的音乐与数拍" onClick={openCreate} disabled={!ready || !!busy}><Upload size={15} />导入音乐</button><button onClick={openTeachingPreview}>{page === 'teaching' ? '返回手动编辑' : '教学预览'}</button>{page === 'teaching' && <><button onClick={() => setTeachingReview(true)} disabled={!active.take || previewAssist || !ready || !!busy || sceneActionBusy || saveStatus === 'saving' || session.teacherCheckedRevision === session.revision} title="仅记录本版试看，不代表教学审核"><Check size={14} />{session.teacherCheckedRevision === session.revision ? '已记录本版试看' : '标记本版已试看'}</button>{session.teacherCheckedRevision === session.revision && <button onClick={() => setTeachingReview(false)} disabled={!!busy || sceneActionBusy || saveStatus === 'saving'}>撤销试看记录</button>}</>}<button onClick={() => setAboutOpen(true)}>使用说明与版本进展</button><details className="editor-disclosure backup-menu"><summary>场景备份</summary><div className="backup-actions disclosure-content"><button onClick={exportProject}>下载项目备份</button><button onClick={() => { void exportFullScene(); }} disabled={!ready || !audioBlob || !!busy}><ArrowDownToLine size={14} />下载完整场景包</button></div></details></div></details></div>
      </header>
      <section className="workspace-content">
        {ready && !audioBlob && <div className="missing-audio" role="alert"><strong>原音乐缺失</strong><p>编舞与数拍仍在。请关联原曲后恢复为新场景，当前作品会保留。</p><button className="button secondary compact" onClick={openAudioRecovery} disabled={!!busy || sceneActionBusy}>恢复原音乐</button></div>}
        <div className="studio-grid manual-workspace">
          <section className="viewer-panel" aria-label="3D动作预览">
            <div className="viewer-toolbar"><span className="viewer-title">{previewAssist ? '辅助预览' : page === 'teaching' ? '教学预览' : '舞台'}<span className="muted-divider">/</span><span className="viewer-muted">{view === 'free' ? '自由视角' : '3D'}</span></span><div className="camera-toolbar"><div className="segmented" aria-label="观看视角">{([['front', '正面'], ['back', '背面']] as const).map(([preset, label]) => <button key={preset} className={view === preset ? 'selected' : ''} aria-pressed={view === preset} onClick={() => chooseView(preset)}>{label}</button>)}</div><button className="icon-button" aria-label="全身取景" disabled={!displayedTake || !ready || !!busy} title="全身取景" onClick={() => focusCamera('actor')}><Scan size={16} /></button><details className="editor-disclosure camera-options"><summary aria-label="相机选项" title="相机选项"><SlidersHorizontal size={16} /></summary><div className="disclosure-content"><div className="segmented">{([['left', '左侧'], ['right', '右侧'], ['top', '顶视']] as const).map(([preset, label]) => <button key={preset} aria-pressed={view === preset} onClick={() => chooseView(preset)}>{label}</button>)}</div><button className="button secondary compact" aria-label="复位相机" onClick={() => chooseView('front')}><RotateCcw size={14} />复位相机</button><button className="button secondary compact" disabled={!displayedTake || !selectedJoint || !ready || !!busy} onClick={() => focusCamera('joint')}><Focus size={14} />聚焦关节</button><span>仅改变观看，不修改动作</span></div></details></div></div>
            <div className="stage-wrap"><Stage bottomOverlayInset={timelineInset} take={displayedTake} time={time} view={view} mirror={mirror} cameraState={camera ?? undefined} cameraTrackState={cameraTrackState} cameraRestoreExact={cameraRestoreExact} cameraEditRevision={session.revision} cameraCancelKey={cameraCancelKey} cameraTrackEditing={cameraSelected && cameraCanEdit()} onCameraGesture={handleCameraGesture} cameraResetKey={cameraResetKey} cameraRestoreKey={cameraRestoreKey} cameraFocus={cameraFocus ?? undefined} onCameraChange={handleCameraChange} onCameraInteraction={handleCameraInteraction} selectedJoint={selectedJoint} onSelectJoint={chooseJoint} onJointPositionChange={handleJointPosition} poseOverride={manualEditing ? poseDraft : null} collisionFeedback={collisionFeedback} editMode={manualEditing && !cameraSelected && !modalOpen && !busy && !sceneActionBusy && saveStatus !== 'saving'} transformTool={activeTransformTool} playing={playing} onJointRotationChange={handleJointRotation} onRootPositionChange={handleRootPosition} ikTarget={ikTarget} onIKTargetChange={handleIKTarget} onTransformCancel={cancelPointGesture} />{manualSequence && <div ref={timelineOverlayRef} className="timeline-overlay">{manualTimeline}</div>}</div>
            <div className="stage-edit-tools">
              <div className="stage-tool-buttons" role="group" aria-label="舞台编辑工具">
                <button aria-label="选择工具" aria-pressed={activeTransformTool === 'select'} className={activeTransformTool === 'select' ? 'selected' : ''} onClick={() => chooseTransformTool('select')} title="选择关节与移动相机；收起操作手柄"><MousePointer2 size={15} />选择</button>
                <button aria-label="旋转工具" aria-pressed={activeTransformTool === 'rotate'} className={activeTransformTool === 'rotate' ? 'selected' : ''} disabled={!!rotateUnavailable} onClick={() => chooseTransformTool('rotate')} title={rotateUnavailable ?? (previewAssist ? '回原稿并编辑关节旋转' : '暂停并编辑关节局部旋转')}><Rotate3D size={15} />旋转</button>
                <button aria-label="移动角色工具" aria-pressed={activeTransformTool === 'translate'} className={activeTransformTool === 'translate' ? 'selected' : ''} disabled={!active.take || !!busy} onClick={() => chooseTransformTool('translate')} title={!active.take ? '请先新建或导入场景' : previewAssist ? '回原稿并移动整个角色' : '暂停并移动整个角色；不改变骨长'}><Move3D size={15} />移动（整体）</button>
                {getIKEffector(selectedJoint) && <button aria-label="手脚 IK" aria-pressed={activeTransformTool === 'ik'} className={activeTransformTool === 'ik' ? 'selected' : ''} disabled={!active.take || !!busy} onClick={() => chooseTransformTool('ik')} title="拖动手脚目标；关节限位与骨长保持，松开自动记录变化的关节"><Move3D size={15} />手脚 IK</button>}
              </div>
              <div className="stage-tool-help"><span>{toolHelp}</span></div>
            </div>
            <details className="scene-extras"><summary aria-label="场景辅助工具"><SlidersHorizontal size={15} /></summary><div className="scene-extras-content">            <details className="editor-disclosure stage-diagnostics"><summary>舞台信息</summary><div className="scene-spacebar"><span>右手坐标 · Y↑ · +Z前向 · XZ地面 · 1单位=1m</span><span className="camera-coordinates" aria-label="相机世界坐标">相机 <b>X</b>{camera?.position[0].toFixed(2) ?? '—'} <b>Y</b>{camera?.position[1].toFixed(2) ?? '—'} <b>Z</b>{camera?.position[2].toFixed(2) ?? '—'}</span><span className="joint-coordinates" aria-label="选中关节世界坐标"><span>{selectedJoint ? `${STAGE_JOINT_LABELS[selectedJoint]} · 世界坐标（m）` : "点击人物选择部位"}</span><strong>{jointPosition ? jointPosition.map((value, index) => <span key={index}><b>{["X", "Y", "Z"][index]}</b>{value.toFixed(3)}</span>) : <span>未选部位</span>}</strong></span></div></details>

            {manualSequence && editorPose && <RealismPanel pose={previewAssist && assistCandidate ? sampleTake(assistCandidate.take, time) : editorPose} sequence={manualSequence} frame={editorFrame} duration={active.countMap.durationSeconds} disabled={!manualEditing || playing || mirror || modalOpen || !!busy || !!assistBusy} ikResidual={ikResidual} motionState={motionIsDynamic(displayedTake, time) ? 'dynamic' : 'quasi-static'} onLock={lockFoot} onRemoveLock={unlockFoot} onPhysics={() => { void generateAssistance('physics'); }} onCancel={cancelAssistance} simulating={assistBusy === 'physics'} progress={assistProgress} stepReport={stepReport} onSteps={() => { void generateAssistance('steps'); }} onRemoveSteps={disableStepAssistance} calculatingSteps={assistBusy === 'steps'} stepCandidate={assistCandidate?.kind === 'steps' ? assistanceCandidatePanel : null} />}
{page === 'studio' && <AIPanel onGenerate={prompt => { void generateAssistance('ai', prompt); }} onCancel={cancelAssistance} busy={assistBusy === 'ai'} disabled={!ready || !active.take || !!busy || !!assistBusy || modalOpen} error={assistError} />}</div></details>
          </section>

        </div>
        {assistCandidate?.kind !== 'steps' && assistanceCandidatePanel}


      </section>
    </main>
    {notice && <div className="toast" role="status"><CheckCircle2 size={18} /><span>{notice}</span><button aria-label="关闭提示" onClick={() => setNotice('')}><X size={15} /></button></div>}
    {pendingTransfer && <div className="modal-backdrop guard-backdrop"><section className="modal scene-confirm-modal" role="dialog" aria-modal="true" aria-labelledby="key-transfer-title"><div className="modal-heading"><h2 id="key-transfer-title">目标帧已有关键帧</h2></div><p className="modal-intro">第 {pendingTransfer.action.request.targetFrame} 帧的 {pendingTransfer.collisions.length} 条对应轨已有显式 K。继续将替换这些 K；来源没有 K 的目标轨保持原样。移动或复制会改变相邻 K 之间的插值，可撤销恢复。</p><div className="transfer-collisions">{pendingTransfer.collisions.map(track => <span key={track.kind === 'root' ? 'root' : track.joint}>{track.kind === 'root' ? 'Root 位移' : STAGE_JOINT_LABELS[track.joint]}</span>)}</div><div className="modal-actions"><button className="button secondary" onClick={() => setPendingTransfer(null)}>取消</button><button className="button primary" onClick={() => performKeyframeTransfer(pendingTransfer.action, pendingTransfer)}>替换并继续</button></div></section></div>}
    {importOpen && <div className="modal-backdrop import-backdrop"><section className="modal backup-import-modal" role="dialog" aria-modal="true" aria-labelledby="backup-import-title"><div className="modal-heading"><div><span className="eyebrow">SCENE BACKUP / 本机恢复</span><h2 id="backup-import-title">导入场景备份</h2></div><button className="icon-button" aria-label="关闭场景备份导入" disabled={sceneActionBusy} onClick={closeBackupImport}><X size={20} /></button></div><p className="modal-intro">完整场景包包含原音乐和正式动作。导入会创建独立场景，保留现有作品；所有读取和验证都在浏览器完成。</p><label className="upload-area backup-upload"><Upload size={24} /><strong>{importBusy ? '正在验证场景与音乐…' : '选择 .choreo 场景包或旧 JSON 备份'}</strong><span>完整包最多 132 MB · 旧 JSON 最多 32 MB</span><input type="file" accept=".choreo,.json" aria-label="选择场景备份文件" disabled={importBusy || sceneActionBusy} onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; void chooseSceneBackup(file); }} /></label>{importScene && <><label className="field rename-field">导入后的场景名称<input value={importName} maxLength={80} onChange={event => setImportName(event.target.value)} disabled={importBusy || sceneActionBusy} /></label><div className="backup-summary"><strong>{importScene.name}</strong><span>{importScene.project.history.length} 个历史版本 · {importScene.project.history[importScene.project.historyIndex].countMap.durationSeconds.toFixed(1)} 秒</span><span>音乐：{importScene.audioName}</span></div>{importNeedsAudio && <div className="legacy-audio"><p>旧 JSON 没有音乐。请重新选择原音乐；只能核对时长，请确认使用的是备份时的曲目。正式动作和数拍会完整保留。</p><label className="field">重新关联原音乐<input type="file" accept="audio/*" aria-label="重新关联原音乐" disabled={importBusy || sceneActionBusy} onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; void associateBackupAudio(file); }} /></label></div>}</>}{importError && <div className="form-error" role="alert">{importError}</div>}<div className="form-note">场景包保留已记录的动作与操作历史，也不带入教师确认。保存到本机成功后才切换场景。</div><div className="modal-actions"><button className="button secondary" disabled={sceneActionBusy} onClick={closeBackupImport}>取消</button><button className="button primary" disabled={!importScene?.audio || importNeedsAudio || !importName.trim() || importBusy || sceneActionBusy} onClick={confirmSceneImport}>{sceneActionBusy ? <LoaderCircle className="spin" size={15} /> : <Check size={15} />}作为新场景导入</button></div></section></div>}
    {pendingResetAction && <div className="modal-backdrop guard-backdrop"><section className="modal scene-confirm-modal" role="dialog" aria-modal="true" aria-labelledby="reset-keys-title"><div className="modal-heading"><h2 id="reset-keys-title">{pendingResetAction === 'adoptAssist' ? '采用候选并替换当前编舞？' : '清空手动关键帧并继续？'}</h2></div><p className="modal-intro">{pendingResetAction === 'adoptAssist' ? '采用候选会替换整段动作，并清空当前可编辑关键帧轨、脚锁与自动步伐；原编舞保留在撤销历史中。完成后可用撤销恢复这份手动序列。' : '调整音乐与数拍会清空当前动作和相机关键帧，并创建新的中立姿态场景。请先保存或复制场景以保留原编舞。'}</p><div className="modal-actions"><button className="button secondary" onClick={() => setPendingResetAction(null)}>取消</button><button className="button primary" onClick={confirmResetAction}>确认并继续</button></div></section></div>}
    {libraryOpen && <div className="modal-backdrop"><section className="modal scene-library-modal" role="dialog" aria-modal="true" aria-labelledby="library-title"><div className="modal-heading"><div><span className="eyebrow">SCENE LIBRARY / 本机管理</span><h2 id="library-title">本机场景</h2></div><button className="icon-button" aria-label="关闭场景列表" disabled={sceneActionBusy} onClick={() => setLibraryOpen(false)}><X size={20} /></button></div><p className="modal-intro">每个场景独立保留音乐、编排、相机与观看设置。仅保存在这个浏览器。</p><div className="library-toolbar"><span>{sceneList.length} 个已保存场景</span><button className="button secondary compact" disabled={sceneActionBusy || !!busy} onClick={openBackupImport}><Upload size={15} />导入场景备份</button><button className="button primary compact" disabled={sceneActionBusy} onClick={() => requestSceneAction({ type: 'new' })}><Plus size={15} />新建场景</button></div>{libraryBusy ? <div className="library-empty"><LoaderCircle className="spin" size={22} />正在读取本机场景…</div> : sceneList.length ? <div className="scene-list" role="list" aria-label="已保存场景">{sceneList.map(scene => <div role="listitem" key={scene.id} className={`scene-list-row ${scene.id === currentScene.id ? 'current' : ''}`}><span className="scene-list-icon"><Layers3 size={19} /></span><div className="scene-list-info"><strong>{scene.id === currentScene.id ? currentScene.name : scene.name}{scene.id === currentScene.id && <small>当前</small>}</strong><span>{scene.audioName}</span><span>保存于 {new Date(scene.updatedAt).toLocaleString('zh-CN', { hour12: false })}</span></div><div className="scene-list-actions"><button className="button secondary compact" aria-label={`打开场景 ${scene.id === currentScene.id ? currentScene.name : scene.name}`} onClick={() => requestSceneAction({ type: 'open', id: scene.id })} disabled={sceneActionBusy}>{scene.id === currentScene.id ? '已打开' : '打开'}</button><button className="text-button" aria-label={`复制场景 ${scene.id === currentScene.id ? currentScene.name : scene.name}`} disabled={sceneActionBusy} onClick={() => requestSceneAction({ type: 'copy', id: scene.id })}>复制</button><button className="text-button" aria-label={`改名场景 ${scene.id === currentScene.id ? currentScene.name : scene.name}`} onClick={() => { setRenameTarget({ id: scene.id, name: scene.id === currentScene.id ? currentScene.name : scene.name }); setRenameValue(scene.id === currentScene.id ? currentScene.name : scene.name); }}>改名</button><button className="text-button danger-text" aria-label={`删除场景 ${scene.id === currentScene.id ? currentScene.name : scene.name}`} onClick={() => setDeleteTarget({ id: scene.id, name: scene.id === currentScene.id ? currentScene.name : scene.name })}>删除</button></div></div>)}</div> : <div className="library-empty"><FolderOpen size={28} /><strong>还没有保存的场景</strong><p>关闭列表后点击“保存”，即可保留当前场景。</p></div>}<div className="form-note">导入音乐调整当前场景；“新建场景”创建独立作品，“复制”基于该场景的已保存版本。清理浏览器数据会删除本机保存的场景与音乐。</div></section></div>}
    {pendingSceneAction && <div className="modal-backdrop guard-backdrop"><section className="modal scene-confirm-modal" role="dialog" aria-modal="true" aria-labelledby="unsaved-title"><div className="modal-heading"><div><span className="eyebrow">未保存的修改</span><h2 id="unsaved-title">保留当前场景的修改？</h2></div></div><p className="modal-intro">「{currentScene.name}」有未保存的更改。选择保存后继续，或放弃这次修改。{pendingSceneAction.type === 'delete' && '继续后将删除该场景。'}{!audioBlob && (pendingSceneAction.type === 'recoverAudio' ? ' 原音乐缺失，无法保存旧场景；继续恢复会把最新已写入编舞与原音乐保存为新场景。' : ' 原音乐缺失，当前无法保存；请先恢复原音乐，或明确选择不保存继续。')}</p><div className="scene-guard-actions"><button className="button secondary" disabled={sceneActionBusy} onClick={() => setPendingSceneAction(null)}>取消</button><button className="button secondary" disabled={sceneActionBusy} onClick={() => { void executeSceneAction(pendingSceneAction); }}>不保存，继续</button><button className="button primary" disabled={sceneActionBusy || !audioBlob} onClick={() => { void saveThenContinue(); }}>{sceneActionBusy ? <LoaderCircle className="spin" size={15} /> : <Save size={15} />}保存后继续</button></div></section></div>}
    {renameTarget && <div className="modal-backdrop guard-backdrop"><section className="modal scene-confirm-modal" role="dialog" aria-modal="true" aria-labelledby="rename-title"><div className="modal-heading"><h2 id="rename-title">修改场景名称</h2><button className="icon-button" aria-label="取消场景改名" onClick={() => setRenameTarget(null)}><X size={19} /></button></div><label className="field rename-field">场景名称<input autoFocus value={renameValue} maxLength={80} onChange={event => setRenameValue(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') void confirmRename(); }} /></label><div className="modal-actions"><button className="button secondary" onClick={() => setRenameTarget(null)}>取消</button><button className="button primary" disabled={!renameValue.trim() || libraryBusy} onClick={() => { void confirmRename(); }}>确认改名</button></div></section></div>}
    {deleteTarget && <div className="modal-backdrop guard-backdrop"><section className="modal scene-confirm-modal" role="dialog" aria-modal="true" aria-labelledby="delete-title"><div className="modal-heading"><h2 id="delete-title">删除这个本机场景？</h2></div><p className="modal-intro">将删除「{deleteTarget.name}」及其本机保存的音乐。其他场景保持原样。</p><div className="modal-actions"><button className="button secondary" onClick={() => setDeleteTarget(null)}>取消</button><button className="button danger" disabled={sceneActionBusy} onClick={() => { const id = deleteTarget.id; setDeleteTarget(null); requestSceneAction({ type: 'delete', id }); }}>删除场景</button></div></section></div>}
    {createOpen && <div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) closeCreate(); }}><section className="modal create-modal" role="dialog" aria-modal="true" aria-labelledby="create-title"><div className="modal-heading"><div><span className="eyebrow">音乐设置 / MUSIC & TIMING</span><h2 id="create-title">先把音乐和数拍准备好</h2></div><button className="icon-button" aria-label="关闭音乐设置" onClick={closeCreate}><X size={20} /></button></div><p className="modal-intro">为当前场景调整音乐与数拍。音乐留在你的浏览器，确认后重建当前手动场景；新建独立场景请使用顶部“场景”。</p><label className="field full-field">作品名称<input value={draftTitle} maxLength={80} onChange={event => setDraftTitle(event.target.value)} /></label><label className="upload-area"><Upload size={24} /><strong>{decoding ? '正在解码音频…' : draftName || '选择一首音乐'}</strong><span>MP3 / WAV 等浏览器支持格式 · 100 MB 以内 · 最长 10 分钟</span><input type="file" accept="audio/*" aria-label="上传音乐文件" disabled={decoding} onChange={event => { stopAudition(); const file = event.target.files?.[0]; event.target.value = ''; void chooseAudio(file); }} /></label><div className="file-caption"><span>{draftDuration.toFixed(1)} 秒可用音频</span><button className="text-button" onClick={useDemoMusic}>使用原创节奏示例</button></div><div className="form-grid"><label className="field">音乐速度 BPM<input type="number" min={30} max={240} value={draftBpm} onChange={event => { stopAudition(); setDraftBpm(Number(event.target.value)); }} /></label><label className="field">每个舞蹈数拍对应<select value={draftRelation} onChange={event => { stopAudition(); setDraftRelation(Number(event.target.value) as 0.5 | 1 | 2); }}><option value={0.5}>半个音乐拍</option><option value={1}>一个音乐拍</option><option value={2}>两个音乐拍</option></select></label><label className="field">第一数拍位置（秒）<input type="number" min={0} step={0.01} value={draftFirst} onChange={event => { stopAudition(); setDraftFirst(Number(event.target.value)); }} /></label><label className="field">从第几个八拍开始<input type="number" min={1} step={1} value={draftStart} onChange={event => { stopAudition(); setDraftStart(Number(event.target.value)); }} /></label><label className="field">选取几个完整八拍<input type="number" min={2} max={60} step={1} value={draftOctets} onChange={event => { stopAudition(); setDraftOctets(Number(event.target.value)); }} /></label><div className="selection-summary"><span>实际选段</span><strong>{draftMap ? `${draftMap.durationSeconds.toFixed(1)} 秒` : '请调整范围'}</strong><small>{draftMap ? `${draftMap.sourceOffsetSeconds.toFixed(1)} – ${(draftMap.sourceOffsetSeconds + draftMap.durationSeconds).toFixed(1)} 秒` : '须满足 16–60 秒'}</small></div></div><div className="audition-row"><button className="button secondary compact" onClick={auditionCount ? stopAudition : auditionCounts} disabled={!draftMap || decoding}>{auditionCount ? <Pause size={15} /> : <Headphones size={15} />}试听 1–8 数拍</button><div>{Array.from({ length: 8 }, (_, index) => <span className={auditionCount === index + 1 ? 'active' : ''} key={index}>{index + 1}</span>)}</div></div><div className="form-note">当前由你手动确认 BPM 与数拍，只支持稳定 4/4 拍音乐；节奏检测暂未接入。调整数拍或音乐将重建当前场景的中立姿态，不沿用旧动作；其他场景保持原样。</div>{(draftError || mapError) && <div className="form-error" role="alert">{draftError || mapError}</div>}<div className="modal-actions"><button className="button secondary" onClick={closeCreate}>取消</button><button className="button primary" disabled={!draftMap || !draftBlob || decoding} onClick={confirmMusic}><Check size={16} />确认数拍，进入工作台</button></div></section></div>}
    {aboutOpen && <div className="modal-backdrop"><section className="modal about-modal" role="dialog" aria-modal="true" aria-labelledby="about-title"><div className="modal-heading"><div><span className="eyebrow">版本进展 / DEVELOPMENT</span><h2 id="about-title">从可操作，到真正可教学</h2></div><button className="icon-button" aria-label="关闭版本说明" onClick={() => setAboutOpen(false)}><X size={20} /></button></div><p className="modal-intro">按 v2.1 范围逐步实现。当前是独立预览协议，不冒充原工程包已完成集成。</p><div className="roadmap"><div className="current"><span>01</span><div><strong>交互与播放预览 <small>当前</small></strong><p>本地音频、动作与相机轨道、关节与 IK 自动记录、操作记录、3D 播放与本机保存。</p></div></div><div><span>02</span><div><strong>接入真实动作与原工程契约</strong><p>取得合法素材、人物和过渡记录，运行 Python 动作处理与接触检查。</p></div></div><div><span>03</span><div><strong>接入生产服务</strong><p>账号、私有项目、版本事务、持久任务、取消与权限检查。</p></div></div><div><span>04</span><div><strong>高精度烘焙与教师验证</strong><p>编舞完成后，基于动作与相机 Timeline 计算高精度碰撞、骨骼与蒙皮，产出稳定无抖动的只读视频；此阶段尚未实现。</p></div></div></div><div className="form-note">AI 编排通过 Workers AI 选择原创程序化动作与幅度，点击生成才调用模型。手脚 IK、脚锁和重力候选已提供；仍需真实动作与教师验证。保存只在本机。完整场景包包含原音乐，可导入为新场景；项目 JSON 不含音乐。当前不提供 MP4 或真实动作库。</div><a className="button primary full" href="https://github.com/DFerryman/ChoreographyStudio" target="_blank" rel="noreferrer">查看源码与阶段任务 <ArrowUpRight size={16} /></a></section></div>}
  </div>;
}
