import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDownToLine, ArrowRight, ArrowUpRight, Check, CheckCircle2, CircleHelp, Copy, FileAudio, FolderOpen, GitBranch, Headphones, Layers3, LoaderCircle, Pause, Pencil, Play, Plus, Redo2, Repeat2, RotateCcw, Save, Sparkles, Undo2, Upload, Volume2, X } from 'lucide-react';
import { bakePlan, bakeKeyframeSequence, countAt, createNeutralTake, EDITABLE_JOINT_NAMES, frameAtTime, frameTime, getKeyframeCount, makeCountMap, makeKeyframeSequence, makePlan, removePoseKeyframe, replaceSlot, sampleTake, setPoseKeyframe, upsertRootKeyframe, upsertRotationKeyframe, type ArrangementPlan, JOINT_NAMES, type BakedTake, type CountMap, type JointName, type KeyframeSequence, type Pose, type Quat, type Vec3 } from '../../../packages/core/src';
import { Stage, STAGE_JOINT_LABELS, type StageCamera, type StageView } from './Stage';
import { demoAudio } from './demoAudio';
import { deleteScene, duplicateScene, listScenes, loadCurrentScene, loadScene, renameScene, saveScene, setCurrentScene as selectStoredScene } from './storage';
import { createScene, type SceneDocument } from './scene';
import { KeyframeEditor, KeyframeTimeline } from './KeyframeEditor';

type Snapshot = { title: string; countMap: CountMap; plan: ArrangementPlan | null; take: BakedTake | null; manual?: KeyframeSequence };
type Session = { history: Snapshot[]; historyIndex: number; revision: number; audioDuration: number; teacherCheckedRevision: number | null };
type SceneAction = { type: 'new' } | { type: 'open' | 'copy' | 'delete'; id: string };
type PoseAction = { type: 'seek'; time: number } | { type: 'mode'; mode: 'arrange' | 'keyframes' } | { type: 'scene'; action: SceneAction } | { type: 'history'; direction: -1 | 1 } | { type: 'selection'; index: number } | { type: 'candidate'; simpler: boolean } | { type: 'play' | 'save' | 'music' | 'generate' | 'adopt' | 'neutral' | 'deleteKey' | 'teaching' };
type ResetAction = 'generate' | 'adopt' | 'music' | 'neutral';
type Candidate = { baseRevision: number; slotIndex: number; plan: ArrangementPlan; take: BakedTake };
const initialMap = () => makeCountMap({ bpm: 120, musicBeatsPerDanceCount: 1, firstCountSourceSeconds: 0, startOctet: 0, octetCount: 8, audioDurationSeconds: 40 });
function initialSession(): Session {
  const countMap = initialMap(), plan = makePlan(countMap);
  return { history: [{ title: '我的第一段八拍', countMap, plan, take: bakePlan(plan, countMap) }], historyIndex: 0, revision: 1, audioDuration: 40, teacherCheckedRevision: null };
}
const clonePose = (pose: Pose): Pose => ({ root: [...pose.root], joints: Object.fromEntries(JOINT_NAMES.map(joint => [joint, [...pose.joints[joint]]])) as Pose['joints'] });
const posesDiffer = (a: Pose, b: Pose) => a.root.some((value, index) => Math.abs(value - b.root[index]) > 1e-6) || JOINT_NAMES.some(joint => Math.abs(a.joints[joint].reduce((dot, value, index) => dot + value * b.joints[joint][index], 0)) < 1 - 1e-7);
const seconds = (value: number) => `${Math.floor(value / 60).toString().padStart(2, '0')}:${Math.floor(value % 60).toString().padStart(2, '0')}`;
const cameraMatches = (a: StageCamera | null, b: StageCamera) => !!a && [...a.position, ...a.target, a.zoom ?? 1].every((value, index) => Math.abs(value - [...b.position, ...b.target, b.zoom ?? 1][index]) < 1e-6);
const errorMessage = (error: unknown) => error instanceof Error ? error.message : '操作未完成，请重试。';

export default function App() {
  const [session, setSession] = useState<Session>(initialSession);
  const [currentScene, setCurrentScene] = useState<SceneDocument<Session>>(() => createScene({ name: '我的第一段八拍', project: session, audio: null, audioName: '八拍节奏示例.wav' }));
  const [sceneList, setSceneList] = useState<Awaited<ReturnType<typeof listScenes>>>([]);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [libraryBusy, setLibraryBusy] = useState(false);
  const [pendingSceneAction, setPendingSceneAction] = useState<SceneAction | null>(null);
  const [sceneActionBusy, setSceneActionBusy] = useState(false);
  const [renameTarget, setRenameTarget] = useState<{ id: string; name: string } | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [audioName, setAudioName] = useState('八拍节奏示例.wav');
  const [ready, setReady] = useState(false);
  const [audioUrl, setAudioUrl] = useState('');
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [selected, setSelected] = useState(0);
  const [view, setView] = useState<StageView>('front');
  const [camera, setCamera] = useState<StageCamera | null>(null);
  const [cameraResetKey, setCameraResetKey] = useState(0);
  const [cameraRestoreKey, setCameraRestoreKey] = useState(0);
  const [selectedJoint, setSelectedJoint] = useState<JointName | null>(null);
  const [jointPosition, setJointPosition] = useState<Vec3 | null>(null);
  const [mirror, setMirror] = useState(false);
  const [rate, setRate] = useState(1);
  const [loop, setLoop] = useState(false);
  const [countSound, setCountSound] = useState(false);
  const [page, setPage] = useState<'studio' | 'teaching'>('studio');
  const [editorMode, setEditorMode] = useState<'arrange' | 'keyframes'>('arrange');
  const [poseDraft, setPoseDraft] = useState<Pose | null>(null);
  const [pendingPoseAction, setPendingPoseAction] = useState<PoseAction | null>(null);
  const [queuedPoseAction, setQueuedPoseAction] = useState<PoseAction | null>(null);
  const [pendingResetAction, setPendingResetAction] = useState<ResetAction | null>(null);
  const [candidate, setCandidate] = useState<Candidate | null>(null);
  const [previewCandidate, setPreviewCandidate] = useState(false);
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
  const [auditionCount, setAuditionCount] = useState(0);
  const audioRef = useRef<HTMLAudioElement>(null);
  const cueContext = useRef<AudioContext | null>(null);
  const audition = useRef<{ audio: HTMLAudioElement; url: string; frame: number } | null>(null);
  const sessionRef = useRef(session);
  const cameraRef = useRef<StageCamera | null>(null);
  const sceneChangeVersion = useRef(0);
  const poseDraftRef = useRef<Pose | null>(null);
  const poseDraftBaseline = useRef<{ status: typeof saveStatus; version: number } | null>(null);
  const active = session.history[session.historyIndex];
  const manualSequence = useMemo(() => active.manual ?? (active.take ? makeKeyframeSequence(active.take) : null), [active.manual, active.take]);
  const editorFrame = frameAtTime(time, active.countMap.durationSeconds);
  const editorPose = poseDraft ?? (active.take ? sampleTake(active.take, time) : null);
  const manualKeyCount = useMemo(() => active.manual ? getKeyframeCount(active.manual) : 0, [active.manual]);
  const hasManualKeys = manualKeyCount > 0;
  const displayedTake = previewCandidate && candidate ? candidate.take : active.take;
  const currentCount = countAt(active.countMap, time);
  const stale = candidate && candidate.baseRevision !== session.revision;

  useEffect(() => { sessionRef.current = session; }, [session]);
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
    if (!audioBlob) return;
    const url = URL.createObjectURL(audioBlob); setAudioUrl(url);
    return () => URL.revokeObjectURL(url);
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
  useEffect(() => {
    const audio = audioRef.current;
    if (!playing || !audio) return;
    let frame = 0, lastUpdate = 0, lastCount = -1;
    const tick = (timestamp: number) => {
      let next = Math.max(0, audio.currentTime - active.countMap.sourceOffsetSeconds);
      const rangeStart = selected * active.countMap.durationSeconds / active.countMap.octetCount;
      const rangeEnd = rangeStart + active.countMap.durationSeconds / active.countMap.octetCount;
      if (loop && (next >= rangeEnd || next < rangeStart - 0.02)) {
        audio.currentTime = active.countMap.sourceOffsetSeconds + rangeStart; next = rangeStart; lastCount = -1;
      } else if (next >= active.countMap.durationSeconds || audio.ended) {
        audio.pause(); setPlaying(false); setTime(active.countMap.durationSeconds); return;
      }
      const countIndex = Math.floor(next / (60 / active.countMap.bpm * active.countMap.musicBeatsPerDanceCount));
      if (countSound && countIndex !== lastCount) { beep(); lastCount = countIndex; }
      if (timestamp - lastUpdate > 1000 / 30) { setTime(next); lastUpdate = timestamp; }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing, active.countMap, loop, selected, countSound]);
  useEffect(() => {
    const sync = () => { if (!document.hidden && audioRef.current && playing) setTime(Math.max(0, audioRef.current.currentTime - active.countMap.sourceOffsetSeconds)); };
    document.addEventListener('visibilitychange', sync);
    return () => document.removeEventListener('visibilitychange', sync);
  }, [playing, active.countMap]);
  useEffect(() => { if (audioRef.current) audioRef.current.playbackRate = rate; }, [rate]);
  useEffect(() => () => { audition.current?.audio.pause(); if (audition.current) { cancelAnimationFrame(audition.current.frame); URL.revokeObjectURL(audition.current.url); } void cueContext.current?.close(); }, []);

  function pause() { audioRef.current?.pause(); setPlaying(false); if (playing && editorMode === 'keyframes') { const raw = Math.max(0, (audioRef.current?.currentTime ?? active.countMap.sourceOffsetSeconds + time) - active.countMap.sourceOffsetSeconds); const snapped = frameTime(frameAtTime(raw, active.countMap.durationSeconds), active.countMap.durationSeconds); setTime(snapped); if (audioRef.current) audioRef.current.currentTime = active.countMap.sourceOffsetSeconds + snapped; } }
  function seek(next: number) {
    if (guardPose({ type: 'seek', time: next })) return;
    seekDirect(editorMode === 'keyframes' && !playing ? frameTime(frameAtTime(next, active.countMap.durationSeconds), active.countMap.durationSeconds) : next);
  }
  function seekDirect(next: number) {
    const value = Math.max(0, Math.min(active.countMap.durationSeconds, next));
    if (audioRef.current) audioRef.current.currentTime = active.countMap.sourceOffsetSeconds + value;
    setTime(value);
  }
  async function togglePlay() {
    if (playing) { pause(); return; }
    if (guardPose({ type: 'play' })) return;
    if (!displayedTake || !audioRef.current || !ready) return;
    if (!cueContext.current) cueContext.current = new AudioContext();
    await cueContext.current.resume();
    const audio = audioRef.current;
    if (time >= active.countMap.durationSeconds - 0.01) seekDirect(loop ? selected * active.countMap.durationSeconds / active.countMap.octetCount : 0);
    else if (loop) seekDirect(selected * active.countMap.durationSeconds / active.countMap.octetCount);
    else audio.currentTime = active.countMap.sourceOffsetSeconds + time;
    audio.playbackRate = rate;
    try { await audio.play(); setPlaying(true); } catch { setNotice('音频尚未就绪，或浏览器阻止了播放。请再点一次播放。'); }
  }
  function changeSelection(index: number) { if (guardPose({ type: 'selection', index })) return; setSelected(index); seek(index * active.countMap.durationSeconds / active.countMap.octetCount); markSceneDirty(); }
  function commit(next: Snapshot) {
    pause(); setPreviewCandidate(false);
    setSession(previous => {
      const history = [...previous.history.slice(0, previous.historyIndex + 1), next].slice(-12);
      const nextSession = { ...previous, history, historyIndex: history.length - 1, revision: previous.revision + 1, teacherCheckedRevision: null };
      sessionRef.current = nextSession; return nextSession;
    });
    markSceneDirty();
  }
  function generate() { if (guardPose({ type: 'generate' })) return; if (hasManualKeys) { setPendingResetAction('generate'); return; } void performGenerate(); }
  async function performGenerate() {
    if (busy) return;
    setBusy('正在编排模板'); pause();
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    try {
      const plan = makePlan(active.countMap), take = bakePlan(plan, active.countMap);
      commit({ ...active, plan, take, manual: undefined }); setCandidate(null); setSelected(0); seek(0);
      setNotice('模板初稿已生成。请播放查看，或选择一个八拍换段。');
    } catch (error) { setNotice(errorMessage(error)); }
    finally { setBusy(''); }
  }
  async function requestCandidate(simpler = false) {
    if (guardPose({ type: 'candidate', simpler })) return;
    if (busy || !active.plan || !active.take) return;
    pause(); setBusy(simpler ? '正在查找更简单的演示动作' : '正在生成替换预览');
    const revision = session.revision;
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    try {
      const result = replaceSlot(active.plan, active.take, active.countMap, selected, simpler);
      setCandidate({ ...result, baseRevision: revision, slotIndex: selected }); setPreviewCandidate(true);
      seek(selected * active.countMap.durationSeconds / active.countMap.octetCount);
    } catch (error) { setNotice(errorMessage(error)); }
    finally { setBusy(''); }
  }
  function adopt() { if (!candidate || candidate.baseRevision !== session.revision) { setNotice('作品已经改变，请重新生成候选。'); return; } if (guardPose({ type: 'adopt' })) return; if (hasManualKeys) { setPendingResetAction('adopt'); return; } performAdopt(); }
  function performAdopt() {
    if (!candidate || candidate.baseRevision !== session.revision) { setNotice('作品已经改变，请重新生成候选。'); return; }
    commit({ ...active, plan: candidate.plan, take: candidate.take, manual: undefined }); setCandidate(null);
    setNotice('已采用这个八拍。其他八拍保持原样。');
  }
  function navigateHistory(direction: -1 | 1) {
    if (guardPose({ type: 'history', direction })) return;
    const next = session.historyIndex + direction;
    if (next < 0 || next >= session.history.length) return;
    pause(); setPreviewCandidate(false); setTime(0);
    setSession(previous => ({ ...previous, historyIndex: next, revision: previous.revision + 1, teacherCheckedRevision: null }));
    markSceneDirty();
  }
  function markSceneDirty() { sceneChangeVersion.current += 1; setSaveStatus('dirty'); }
  const handleCameraChange = useCallback((next: StageCamera) => {
    if (cameraMatches(cameraRef.current, next)) return;
    cameraRef.current = next; setCamera(next);
  }, []);
  const handleCameraInteraction = useCallback(() => { setView('free'); sceneChangeVersion.current += 1; setSaveStatus('dirty'); }, []);
  const handleJointPosition = useCallback((position: Vec3 | null) => { setJointPosition(position); }, []);
  function chooseJoint(joint: JointName | null) { setSelectedJoint(joint); markSceneDirty(); }
  function chooseView(next: Exclude<StageView, 'free'>) { setView(next); setCameraResetKey(previous => previous + 1); markSceneDirty(); }
  async function refreshScenes() { setSceneList(await listScenes()); }
  async function openLibrary() {
    pause(); setLibraryOpen(true); setLibraryBusy(true);
    try { await refreshScenes(); }
    catch (error) { setNotice(errorMessage(error)); }
    finally { setLibraryBusy(false); }
  }
  function applyScene(scene: SceneDocument<Session>, saved = true) {
    pause(); stopAudition();
    const viewer = scene.viewer, map = scene.project.history[scene.project.historyIndex].countMap;
    setCurrentScene(scene); setSession(scene.project); sessionRef.current = scene.project;
    setAudioBlob(scene.audio ?? demoAudio()); setAudioName(scene.audioName);
    const restoredTime = Math.max(0, Math.min(map.durationSeconds, viewer.time));
    setTime(viewer.editorMode === 'keyframes' ? frameTime(frameAtTime(restoredTime, map.durationSeconds), map.durationSeconds) : restoredTime);
    setSelected(Math.max(0, Math.min(map.octetCount - 1, viewer.selectedSlot)));
    setView(viewer.view); setMirror(viewer.mirror); setRate(viewer.rate); setLoop(viewer.loop); setCountSound(viewer.countSound);
    setSelectedJoint(viewer.selectedJoint); setJointPosition(null);
    cameraRef.current = viewer.camera; setCamera(viewer.camera);
    setCameraRestoreKey(previous => previous + 1);
    setCandidate(null); setPreviewCandidate(false); setPage('studio'); setEditorMode(viewer.editorMode ?? 'arrange');
    poseDraftRef.current = null; setPoseDraft(null); poseDraftBaseline.current = null;
    sceneChangeVersion.current += 1; setSaveStatus(saved ? 'saved' : 'dirty');
  }
  async function save(): Promise<boolean> { if (guardPose({ type: 'save' })) return false; return performSave(); }
  async function performSave(): Promise<boolean> {
    const version = sceneChangeVersion.current, snapshot = sessionRef.current;
    setSaveStatus('saving');
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    const document: SceneDocument<Session> = {
      ...currentScene, project: snapshot, audio: audioBlob, audioName,
      viewer: { ...currentScene.viewer, view, camera: cameraRef.current, mirror, rate, loop, countSound, selectedSlot: selected, selectedJoint, time, editorMode },
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
        applyScene(createScene({ name: '未命名场景', project, audio: demoAudio(), audioName: '八拍节奏示例.wav' }), false);
        setNotice('已新建独立场景。保存后可在本机场景列表中重新打开。');
      } else if (action.type === 'open') {
        const scene = await loadScene<Session>(action.id);
        if (!scene) throw new Error('这个场景已被删除。');
        await selectStoredScene(scene.id); applyScene(scene); setNotice(`已打开场景「${scene.name}」。`);
      } else if (action.type === 'copy') {
        const copy = await duplicateScene<Session>(action.id);
        if (!copy) throw new Error('这个场景已被删除。');
        applyScene(copy); setNotice('已复制并打开新场景，原场景仍保留在本机。');
      } else {
        await deleteScene(action.id);
        if (action.id === currentScene.id) {
          const remaining = await listScenes();
          const next = remaining.length ? await loadScene<Session>(remaining[0].id) : null;
          if (next) { await selectStoredScene(next.id); applyScene(next); }
          else {
            const project = initialSession(); project.history[0].title = '未命名场景';
            applyScene(createScene({ name: '未命名场景', project, audio: demoAudio(), audioName: '八拍节奏示例.wav' }), false);
          }
        }
        setNotice('场景已从本机删除。');
      }
      setLibraryOpen(false); setPendingSceneAction(null); await refreshScenes();
    } catch (error) { setNotice(errorMessage(error)); }
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
    const blob = new Blob([JSON.stringify({ format: 'choreo-scene-backup-1', scene: { ...currentScene, project: session, audio: undefined, audioName, viewer: { ...currentScene.viewer, view, camera: cameraRef.current, mirror, rate, loop, countSound, selectedSlot: selected, selectedJoint, time, editorMode } }, audioIncluded: false }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob), link = document.createElement('a');
    link.href = url; link.download = 'choreo-studio-project.json'; link.click(); URL.revokeObjectURL(url);
    setNotice(poseDraftRef.current ? '已下载已写入的场景数据。姿态草稿和原音乐未包含。' : '已下载场景数据备份。原音乐未包含，请另外保留。');
  }
  function openCreate() {
    if (guardPose({ type: 'music' })) return;
    pause(); setDraftBlob(audioBlob); setDraftName(audioName); setDraftDuration(session.audioDuration); setDraftTitle(currentScene.name);
    setDraftBpm(active.countMap.bpm); setDraftRelation(active.countMap.musicBeatsPerDanceCount);
    setDraftFirst(active.countMap.firstCountSourceSeconds); setDraftStart(1); setDraftOctets(active.countMap.octetCount); setDraftError(''); setCreateOpen(true);
  }
  async function chooseAudio(file: File | undefined) {
    if (!file) return;
    if (file.size > 100 * 1024 * 1024) { setDraftError('请选择小于 100 MB 的音频。'); return; }
    setDecoding(true); setDraftError('');
    let context: AudioContext | null = null;
    try {
      context = new AudioContext(); const decoded = await context.decodeAudioData(await file.arrayBuffer());
      if (decoded.duration > 600) throw new Error('请选择不超过 10 分钟的音频。');
      if (decoded.duration < 16) throw new Error('音乐至少需要 16 秒，才能选择完整的八拍组合。');
      setDraftBlob(file); setDraftName(file.name); setDraftDuration(decoded.duration); setDraftFirst(0); setDraftStart(1);
    } catch (error) { setDraftError(error instanceof Error && /请选择|音乐至少/.test(error.message) ? error.message : '音频无法解码，请换用 MP3、WAV 或浏览器支持的音频文件。'); }
    finally { if (context) await context.close(); setDecoding(false); }
  }
  let draftMap: CountMap | null = null, mapError = '';
  try { draftMap = makeCountMap({ bpm: draftBpm, musicBeatsPerDanceCount: draftRelation, firstCountSourceSeconds: draftFirst, startOctet: draftStart - 1, octetCount: draftOctets, audioDurationSeconds: draftDuration }); }
  catch (error) { mapError = errorMessage(error); }
  function stopAudition() {
    if (audition.current) { audition.current.audio.pause(); cancelAnimationFrame(audition.current.frame); URL.revokeObjectURL(audition.current.url); audition.current = null; }
    setAuditionCount(0);
  }
  async function auditionCounts() {
    stopAudition(); if (!draftBlob || !draftMap) return;
    const url = URL.createObjectURL(draftBlob), audio = new Audio(url);
    const offset = draftMap.sourceOffsetSeconds, interval = 60 / draftBpm * draftRelation;
    audio.currentTime = offset;
    try {
      if (!cueContext.current) cueContext.current = new AudioContext(); await cueContext.current.resume(); await audio.play();
      let previous = -1;
      const tick = () => {
        const index = Math.floor(Math.max(0, audio.currentTime - offset) / interval);
        if (index >= 8) { stopAudition(); return; }
        if (index !== previous) { previous = index; setAuditionCount(index + 1); beep(); }
        if (audition.current) audition.current.frame = requestAnimationFrame(tick);
      };
      audition.current = { audio, url, frame: requestAnimationFrame(tick) };
    } catch { audio.pause(); URL.revokeObjectURL(url); setDraftError('试听未启动，请再试一次。'); }
  }
  function confirmMusic() { if (hasManualKeys) { setPendingResetAction('music'); return; } performConfirmMusic(); }
  function performConfirmMusic() {
    if (!draftMap || !draftBlob || decoding) return;
    stopAudition(); pause();
    setAudioBlob(draftBlob); setAudioName(draftName); setCandidate(null); setPreviewCandidate(false); setTime(0); setSelected(0);
    setSession(previous => ({ history: [{ title: draftTitle.trim() || '未命名组合', countMap: draftMap!, plan: null, take: null }], historyIndex: 0, revision: previous.revision + 1, audioDuration: draftDuration, teacherCheckedRevision: null }));
    clearPoseDraft(); setPendingPoseAction(null); setQueuedPoseAction(null); markSceneDirty(); setCreateOpen(false); setPage('studio'); setEditorMode('arrange');
    setCurrentScene(previous => ({ ...previous, name: draftTitle.trim() || '未命名场景' }));
    setNotice('当前场景的数拍和选段已确认。现在可以生成模板初稿。');
  }
  function guardPose(action: PoseAction): boolean {
    if (!poseDraftRef.current) return false;
    pause(); setPendingPoseAction(action); return true;
  }
  function clearPoseDraft(restoreStatus = false) {
    const baseline = poseDraftBaseline.current;
    poseDraftRef.current = null; setPoseDraft(null); poseDraftBaseline.current = null;
    if (restoreStatus && baseline && baseline.version === sceneChangeVersion.current) setSaveStatus(baseline.status);
  }
  function updatePoseDraft(next: Pose) {
    if (!active.take || playing || mirror || editorMode !== 'keyframes') return;
    const reference = sampleTake(active.take, frameTime(editorFrame, active.countMap.durationSeconds));
    if (!posesDiffer(next, reference)) { clearPoseDraft(true); return; }
    if (!poseDraftRef.current) poseDraftBaseline.current = { status: saveStatus === 'saving' ? 'dirty' : saveStatus, version: sceneChangeVersion.current };
    const copied = clonePose(next); poseDraftRef.current = copied; setPoseDraft(copied); setSaveStatus('dirty');
  }
  function handleJointRotation(joint: JointName, rotation: Quat, phase: 'start' | 'change' | 'end') {
    if (!active.take || !EDITABLE_JOINT_NAMES.includes(joint) || editorMode !== 'keyframes' || playing || mirror || phase === 'start') return;
    const next = clonePose(poseDraftRef.current ?? sampleTake(active.take, frameTime(editorFrame, active.countMap.durationSeconds)));
    next.joints[joint] = [...rotation]; updatePoseDraft(next);
  }
  function writeKeyframe(kind: 'joint' | 'root' | 'pose'): boolean {
    if (!manualSequence || !active.take || !editorPose || playing || mirror) return false;
    if (kind === 'joint' && (!selectedJoint || !EDITABLE_JOINT_NAMES.includes(selectedJoint))) return false;
    try {
      const pose = poseDraftRef.current ?? editorPose;
      const next = kind === 'pose' ? setPoseKeyframe(manualSequence, editorFrame, pose) : kind === 'root' ? upsertRootKeyframe(manualSequence, editorFrame, pose.root) : upsertRotationKeyframe(manualSequence, selectedJoint!, editorFrame, pose.joints[selectedJoint!]);
      const take = bakeKeyframeSequence(next), remaining = poseDraftRef.current;
      commit({ ...active, manual: next, take });
      if (remaining && kind !== 'pose' && posesDiffer(remaining, sampleTake(take, frameTime(editorFrame, take.durationSeconds)))) {
        const copied = clonePose(remaining); poseDraftRef.current = copied; setPoseDraft(copied);
        poseDraftBaseline.current = { status: 'dirty', version: sceneChangeVersion.current };
      } else clearPoseDraft();
      setNotice(`已写入第 ${editorFrame} 帧${kind === 'joint' ? '的关节旋转' : kind === 'root' ? '的 Root 位移' : '的完整姿态'}。`); return true;
    } catch (error) { setNotice(errorMessage(error)); return false; }
  }
  function deleteKeyframe() {
    if (guardPose({ type: 'deleteKey' })) return;
    if (!manualSequence || !active.take) return;
    try { const next = removePoseKeyframe(manualSequence, editorFrame); commit({ ...active, manual: next, take: bakeKeyframeSequence(next) }); setNotice(`已删除第 ${editorFrame} 帧全部显式关键帧，可撤销恢复。`); }
    catch (error) { setNotice(errorMessage(error)); }
  }
  function startNeutral() {
    if (guardPose({ type: 'neutral' })) return;
    if (hasManualKeys) { setPendingResetAction('neutral'); return; }
    performNeutral();
  }
  function performNeutral() {
    if (!active.take) return;
    try { const take = createNeutralTake(active.take), manual = makeKeyframeSequence(take); commit({ ...active, take, manual }); clearPoseDraft(); seekDirect(0); setNotice('已从站姿开始。音乐与数拍保持原样，调整姿态后显式写入 K帧。'); }
    catch (error) { setNotice(errorMessage(error)); }
  }
  function changeEditorMode(mode: 'arrange' | 'keyframes') {
    if (guardPose({ type: 'mode', mode })) return;
    if (mode === 'keyframes' && !active.take) return;
    pause(); setEditorMode(mode); setPreviewCandidate(false); setPage('studio');
    if (mode === 'keyframes') seekDirect(frameTime(editorFrame, active.countMap.durationSeconds));
    markSceneDirty();
  }
  function openTeachingPreview() {
    if (guardPose({ type: 'teaching' })) return;
    pause(); setPage('teaching'); if (editorMode !== 'arrange') { setEditorMode('arrange'); markSceneDirty(); }
    setPreviewCandidate(false);
  }
  function executePoseAction(action: PoseAction) {
    switch (action.type) {
      case 'seek': seek(action.time); break;
      case 'mode': changeEditorMode(action.mode); break;
      case 'scene': requestSceneAction(action.action); break;
      case 'history': navigateHistory(action.direction); break;
      case 'selection': changeSelection(action.index); break;
      case 'candidate': void requestCandidate(action.simpler); break;
      case 'play': void togglePlay(); break;
      case 'save': void performSave(); break;
      case 'music': openCreate(); break;
      case 'generate': generate(); break;
      case 'adopt': adopt(); break;
      case 'neutral': startNeutral(); break;
      case 'deleteKey': deleteKeyframe(); break;
      case 'teaching': openTeachingPreview(); break;
    }
  }
  function finishPoseAction(write: boolean) {
    if (!pendingPoseAction) return;
    if (write && !writeKeyframe('pose')) return;
    if (!write) clearPoseDraft(true);
    const action = pendingPoseAction; setPendingPoseAction(null); setQueuedPoseAction(action);
  }
  useEffect(() => {
    if (!queuedPoseAction || poseDraft) return;
    setQueuedPoseAction(null); executePoseAction(queuedPoseAction);
  }, [queuedPoseAction, poseDraft]);
  function confirmResetAction() {
    const action = pendingResetAction; setPendingResetAction(null);
    if (action === 'generate') void performGenerate();
    else if (action === 'adopt') performAdopt();
    else if (action === 'music') performConfirmMusic();
    else if (action === 'neutral') performNeutral();
  }
  const slots = active.plan?.slots ?? Array.from({ length: active.countMap.octetCount }, (_, index) => ({ slotIndex: index, label: '等待编排', actionId: '', teachingCue: '确认数拍后生成模板初稿', startSeconds: index * active.countMap.durationSeconds / active.countMap.octetCount, endSeconds: (index + 1) * active.countMap.durationSeconds / active.countMap.octetCount }));
  const selectedSlot = slots[Math.min(selected, slots.length - 1)];

  return <div className="app-shell">
    <audio ref={audioRef} src={audioUrl || undefined} preload="auto" onLoadedMetadata={() => { if (audioRef.current) audioRef.current.currentTime = active.countMap.sourceOffsetSeconds + time; }} onEnded={() => { pause(); setTime(active.countMap.durationSeconds); }} onError={() => { if (ready && audioUrl) setNotice('音乐无法播放。请重新导入支持的音频格式。'); }} />
    <aside className="sidebar">
      <a className="brand" href="#" onClick={event => { event.preventDefault(); setPage('studio'); }} aria-label="八拍 首页"><span className="brand-mark"><i /><i /><i /></span><span className="brand-name">八拍</span></a>
      <nav aria-label="主导航">
        <button className={page === 'studio' ? 'nav-item active' : 'nav-item'} aria-current={page === 'studio' ? 'page' : undefined} onClick={() => setPage('studio')}><Layers3 size={21} /><span>编舞工作台</span></button>
        <button className={page === 'teaching' ? 'nav-item active' : 'nav-item'} aria-current={page === 'teaching' ? 'page' : undefined} onClick={openTeachingPreview}><Headphones size={21} /><span>教学预览</span></button>
      </nav>
      <div className="sidebar-bottom"><button className="help-link" onClick={() => setAboutOpen(true)} aria-label="使用说明与版本进展"><CircleHelp size={20} /><span>版本说明</span></button><a className="repo-link" href="https://github.com/DFerryman/ChoreographyStudio" target="_blank" rel="noreferrer" aria-label="查看GitHub源码"><GitBranch size={19} /><span>源码</span></a><div className="sidebar-status"><span />S0 预览</div></div>
    </aside>

    <main className="main-content">
      <header className="topbar">
        <div className="project-heading"><div className="breadcrumbs">创作空间 <span>/</span> {page === 'studio' ? '编舞工作台' : '教学预览'}</div><div className="project-title"><h1>{currentScene.name}</h1><button className="icon-button rename-current" aria-label="修改当前场景名称" title="修改场景名称" onClick={() => { setRenameTarget({ id: currentScene.id, name: currentScene.name }); setRenameValue(currentScene.name); }}><Pencil size={13} /></button><span className="local-tag">本机场景</span></div></div>
        <div className="project-tools"><span className={`save-state ${saveStatus}`}><span />{saveStatus === 'saved' ? '已保存到本机' : saveStatus === 'saving' ? '保存中' : saveStatus === 'failed' ? '保存失败' : '有未保存更改'}</span><button className="button secondary compact scene-library-button" onClick={() => { void openLibrary(); }} disabled={!ready || sceneActionBusy || saveStatus === "saving"}><FolderOpen size={15} />场景</button><div className="history-tools"><button className="icon-button" title="撤销" aria-label="撤销" disabled={session.historyIndex === 0 || !!busy} onClick={() => navigateHistory(-1)}><Undo2 size={17} /></button><button className="icon-button" title="重做" aria-label="重做" disabled={session.historyIndex >= session.history.length - 1 || !!busy} onClick={() => navigateHistory(1)}><Redo2 size={17} /></button></div><button className="button secondary compact save-button" onClick={save} disabled={!ready || saveStatus === 'saving'}><Save size={15} />保存</button><button className="button primary compact new-project" title="调整当前场景的音乐与数拍" onClick={openCreate} disabled={!ready || !!busy}><Upload size={15} />导入音乐</button></div>
      </header>
      <section className="workspace-content">
        <div className="workspace-toolbar"><div><h2>{page === 'studio' ? editorMode === 'keyframes' ? '关键帧工作台' : '编排工作台' : '教学工作台'}</h2><span>{active.countMap.octetCount} 个八拍 <i /> {Math.round(active.countMap.durationSeconds * 10) / 10} 秒</span></div><div className="workspace-mode" role="group" aria-label="编舞模式"><button aria-pressed={editorMode === 'arrange'} className={editorMode === 'arrange' ? 'selected' : ''} onClick={() => changeEditorMode('arrange')}>八拍编排</button><button aria-pressed={editorMode === 'keyframes'} className={editorMode === 'keyframes' ? 'selected' : ''} disabled={!active.take} onClick={() => changeEditorMode('keyframes')}>手动 K帧</button></div><button className="version-pill" onClick={() => setAboutOpen(true)}><span />交互预览 <ArrowUpRight size={13} /></button></div>
        <div className="studio-grid">
          <section className="viewer-panel" aria-label="3D动作预览">
            <div className="viewer-toolbar"><span className="viewer-title"><span className="live-dot" />{previewCandidate ? '替换预览' : '动作预览'}<span className="muted-divider">/</span><span className="viewer-muted">{view === 'free' ? '自由视角' : active.manual ? '手动编舞' : '关节骨架'}</span></span><div className="camera-toolbar"><div className="segmented" aria-label="观看视角">{([['front', '正面'], ['back', '背面'], ['left', '左侧'], ['right', '右侧'], ['top', '顶视']] as const).map(([preset, label]) => <button key={preset} className={view === preset ? 'selected' : ''} aria-pressed={view === preset} onClick={() => chooseView(preset)}>{label}</button>)}</div><button className="icon-button camera-reset" aria-label="复位相机" title="复位到正面全身" onClick={() => chooseView('front')}><RotateCcw size={16} /></button></div></div>
            <div className="stage-wrap"><Stage take={displayedTake} time={time} view={view} mirror={mirror} cameraState={camera ?? undefined} cameraResetKey={cameraResetKey} cameraRestoreKey={cameraRestoreKey} onCameraChange={handleCameraChange} onCameraInteraction={handleCameraInteraction} selectedJoint={selectedJoint} onSelectJoint={chooseJoint} onJointPositionChange={handleJointPosition} poseOverride={editorMode === 'keyframes' ? poseDraft : null} editMode={editorMode === 'keyframes' && page === 'studio'} playing={playing} onJointRotationChange={handleJointRotation} /><div className="stage-status"><span className="stage-tag">25 关节 · 原创骨架</span><span className="stage-hint"><span className="desktop-camera-hint">拖动旋转 · 右键平移 · 滚轮缩放</span><span className="mobile-camera-hint">单指旋转 · 双指平移/缩放</span></span></div><div className="count-overlay"><span>第 {currentCount.octet} 个八拍</span><strong>{currentCount.count}<small> / 8</small></strong></div>{!active.take && <div className="empty-overlay"><Sparkles size={24} /><strong>音乐准备好了</strong><p>生成模板初稿，开始查看你的组合。</p></div>}</div>
            <div className="scene-spacebar"><span>右手坐标 · Y↑ · +Z前向 · XZ地面 · 1单位=1m</span><span className="camera-coordinates" aria-label="相机世界坐标">相机 <b>X</b>{camera?.position[0].toFixed(2) ?? '—'} <b>Y</b>{camera?.position[1].toFixed(2) ?? '—'} <b>Z</b>{camera?.position[2].toFixed(2) ?? '—'}</span></div>
            <div className="player"><div className="player-main"><button className="play-button" aria-label={playing ? '暂停' : '播放'} disabled={!displayedTake || !ready} onClick={togglePlay}>{playing ? <Pause size={19} fill="currentColor" /> : <Play size={19} fill="currentColor" />}</button><span className="time-display">{seconds(time)}<span> / {seconds(active.countMap.durationSeconds)}</span></span><input aria-label="播放进度" type="range" min={0} max={active.countMap.durationSeconds} step={0.01} value={time} disabled={!displayedTake} onChange={event => seek(Number(event.target.value))} style={{ '--progress': `${time / active.countMap.durationSeconds * 100}%` } as React.CSSProperties} /><button className={`icon-button ${loop ? 'toggled' : ''}`} aria-label="循环当前八拍" title="循环当前八拍" aria-pressed={loop} onClick={() => { setLoop(!loop); markSceneDirty(); if (!loop) seek(selected * active.countMap.durationSeconds / active.countMap.octetCount); }}><Repeat2 size={18} /></button><select aria-label="播放速度" value={rate} onChange={event => { setRate(Number(event.target.value)); markSceneDirty(); }}><option value={0.5}>0.5×</option><option value={0.75}>0.75×</option><option value={1}>1×</option></select></div><div className="player-options"><button className={mirror ? 'option active' : 'option'} aria-pressed={mirror} onClick={() => { setMirror(!mirror); markSceneDirty(); }}><Copy size={14} />镜像观看</button><button className={countSound ? 'option active' : 'option'} aria-pressed={countSound} onClick={() => { setCountSound(!countSound); markSceneDirty(); }}><Volume2 size={15} />节拍提示</button><span>{mirror ? "镜像仅影响观看，坐标保持原始世界空间" : "播放与视角不修改动作数据"}</span></div></div><div className="joint-inspector"><label>{editorMode === 'keyframes' ? '选择关节 · 局部旋转' : '选择关节 · 世界坐标'}<select aria-label="选择关节" value={selectedJoint ?? ""} onChange={event => chooseJoint((event.target.value || null) as JointName | null)}><option value="">未选择</option>{JOINT_NAMES.map(joint => <option key={joint} value={joint}>{STAGE_JOINT_LABELS[joint]}</option>)}</select></label><div className="joint-coordinates" aria-label="选中关节世界坐标"><span>{selectedJoint ? `${STAGE_JOINT_LABELS[selectedJoint]} · 世界坐标（m）` : "点击骨架关节点查看坐标"}</span><strong>{jointPosition ? jointPosition.map((value, index) => <span key={index}><b>{["X", "Y", "Z"][index]}</b>{value.toFixed(3)}</span>) : <span className="joint-selection-note">选择关节查看坐标，切换手动 K帧可编辑姿态。</span>}</strong></div></div>
          </section>
          <aside className={editorMode === 'keyframes' ? 'inspector keyframe-inspector' : 'inspector'}>{editorMode === 'keyframes' && manualSequence && editorPose ? <KeyframeEditor sequence={manualSequence} pose={editorPose} frame={editorFrame} selectedJoint={selectedJoint} dirty={!!poseDraft} playing={playing} mirror={mirror} onFrame={frame => seek(frameTime(frame, active.countMap.durationSeconds))} onTime={next => seek(frameTime(frameAtTime(next, active.countMap.durationSeconds), active.countMap.durationSeconds))} onPose={updatePoseDraft} onWriteJoint={() => { writeKeyframe('joint'); }} onWriteRoot={() => { writeKeyframe('root'); }} onWritePose={() => { writeKeyframe('pose'); }} onDiscard={() => clearPoseDraft(true)} onDelete={deleteKeyframe} onNeutral={startNeutral} /> : <>
            <section className="music-card"><div className="section-heading"><div className="module-title"><span className="module-index">01</span><h2>音乐与数拍</h2></div><button className="text-button" onClick={openCreate} disabled={!ready || !!busy}>调整</button></div><div className="music-file"><span className="file-icon"><FileAudio size={21} /></span><div><strong title={audioName}>{audioName}</strong><small>{audioName === '八拍节奏示例.wav' ? '原创节奏示例 · 本机生成' : '本机音频 · 不上传服务器'}</small></div></div><div className="waveform" aria-hidden="true">{Array.from({ length: 52 }, (_, index) => <i key={index} style={{ height: `${8 + Math.abs(Math.sin(index * 1.7) * Math.cos(index * 0.47)) * 30}px`, opacity: index / 52 <= time / active.countMap.durationSeconds ? 1 : 0.34 }} />)}</div><div className="music-metrics"><div><strong>{active.countMap.bpm}<small> BPM</small></strong><span>稳定节奏 · 手动确认</span></div><div><strong>{active.countMap.octetCount}<small> 个八拍</small></strong><span>{Math.round(active.countMap.durationSeconds * 10) / 10} 秒完整选段</span></div></div><div className="confirmed-note"><CheckCircle2 size={14} />数拍已确认<span>4/4</span></div></section>
            <section className="edit-card"><div className="section-heading"><div className="module-title"><span className="module-index">02</span><h2>{page === 'studio' ? '修改这一段' : '当前教学段落'}</h2></div><span className="octet-pill">{(selected + 1).toString().padStart(2, '0')} / {active.countMap.octetCount.toString().padStart(2, '0')}</span></div><div className="selected-phrase"><h3>{selectedSlot?.label ?? '等待编排'}</h3><p>{selectedSlot?.teachingCue ?? '选择一个八拍查看动作提示'}</p><span>第 {selected + 1} 个八拍 · {selectedSlot?.startSeconds.toFixed(1)} – {selectedSlot?.endSeconds.toFixed(1)} 秒</span></div>{page === 'studio' ? <><button className="button primary full" onClick={() => requestCandidate()} disabled={!active.take || !!busy}><Sparkles size={16} />换一个八拍<ArrowRight size={16} /></button><button className="button secondary full" onClick={() => requestCandidate(true)} disabled={!active.take || !!busy}><Layers3 size={16} />试试更简单</button><p className="edit-footnote">预览后采用，只替换选中的八拍。</p></> : <><button className="button primary full" onClick={() => { setLoop(true); markSceneDirty(); seek(selectedSlot.startSeconds); if (!playing) void togglePlay(); }} disabled={!active.take}><Repeat2 size={16} />循环练习这一段</button><button className="button secondary full" onClick={() => { setSession(previous => ({ ...previous, teacherCheckedRevision: previous.revision })); markSceneDirty(); setNotice('已记录本版试看。演示记录不代表真实动作已通过教学审核。'); }} disabled={!active.take || previewCandidate || session.teacherCheckedRevision === session.revision} title={previewCandidate ? '请先切回原稿，再记录这一版试看' : undefined}><Check size={16} />{session.teacherCheckedRevision === session.revision ? '已记录本版试看' : '标记本版已试看'}</button><p className="edit-footnote">本版是合成动作演示。<br />真实教学素材与视频导出正在后续阶段接入。</p></>}</section>
            {candidate && <section className={`candidate-card ${stale ? 'expired' : ''}`} aria-label="替换候选"><div className="candidate-title"><span className="candidate-icon"><Sparkles size={15} /></span><strong>{stale ? '候选已过期' : '替换候选'}</strong><span>第 {candidate.slotIndex + 1} 段</span></div><p>{stale ? '作品版本已经改变。可以观看，但需重新生成才能采用。' : candidate.plan.slots[candidate.slotIndex].label}</p><button className="text-button" onClick={() => { pause(); setPreviewCandidate(!previewCandidate); seek(candidate.slotIndex * active.countMap.durationSeconds / active.countMap.octetCount); }}>{previewCandidate ? '切回原稿' : '查看替换预览'} <ArrowRight size={14} /></button><div className="candidate-actions"><button className="button primary compact" disabled={!!stale} onClick={adopt}><Check size={14} />采用</button><button className="button secondary compact" onClick={() => { pause(); setCandidate(null); setPreviewCandidate(false); }}>放弃</button></div></section>}
          </>} </aside>
        </div>
        {editorMode === 'keyframes' && manualSequence ? <KeyframeTimeline sequence={manualSequence} frame={editorFrame} onFrame={frame => seek(frameTime(frame, active.countMap.durationSeconds))} playing={playing} /> : <section className="timeline-panel"><div className="timeline-heading"><div><div className="module-title"><span className="module-index">03</span><h2>{active.manual ? '基底八拍编排' : '你的八拍组合'} <span>{active.countMap.octetCount} 段</span></h2></div></div><button className="button compact secondary" onClick={generate} disabled={!!busy || !ready}>{busy ? <LoaderCircle className="spin" size={15} /> : <Sparkles size={15} />}{busy || (active.take ? '重新生成模板初稿' : '生成模板初稿')}</button></div><div className="octet-list" role="list" aria-label="八拍时间线">{slots.map((slot, index) => <button key={index} role="listitem" aria-label={`第${index + 1}个八拍 ${slot.label}`} className={`octet-card ${index === selected ? 'selected' : ''} ${playing && currentCount.octet === index + 1 ? 'playing' : ''}`} onClick={() => changeSelection(index)}><div className="octet-top"><span>{(index + 1).toString().padStart(2, '0')}</span>{index === selected ? <span className="selected-dot" /> : <span className="mini-wave"><i /><i /><i /></span>}</div><strong>{slot.label}</strong><small>{slot.startSeconds.toFixed(0)}–{slot.endSeconds.toFixed(0)} 秒</small><div className="count-ticks">{Array.from({ length: 8 }, (_, count) => <i key={count} className={playing && currentCount.octet === index + 1 && currentCount.count === count + 1 ? 'current' : ''} />)}</div></button>)}</div><div className="timeline-footer"><span><span className="legend-dot" />当前选择<span className="legend-dot pale" />完整八拍</span><span>{active.manual ? '手动编舞 · 卡片为基底标签' : '合成动作模板'} <i /> 作品 v{session.revision}</span></div></section>}
        <footer className="workspace-footer"><span><span className="small-dot" />此预览使用原创合成动作，用于验证操作流程，尚不代表可教学的真实舞蹈。</span><button onClick={exportProject}><ArrowDownToLine size={14} />下载项目备份</button></footer>
      </section>
    </main>
    {notice && <div className="toast" role="status"><CheckCircle2 size={18} /><span>{notice}</span><button aria-label="关闭提示" onClick={() => setNotice('')}><X size={15} /></button></div>}
    {pendingPoseAction && <div className="modal-backdrop guard-backdrop"><section className="modal scene-confirm-modal" role="dialog" aria-modal="true" aria-labelledby="pose-guard-title"><div className="modal-heading"><div><span className="eyebrow">未写入的姿态草稿</span><h2 id="pose-guard-title">写入这份姿态草稿？</h2></div></div><p className="modal-intro">当前姿态尚未进入关键帧序列。写入完整姿态会记录本帧的 19 个局部旋转和 Root 位移，然后继续操作；放弃只撤回这次草稿。{mirror && '请取消并关闭镜像后再写入。'}</p><div className="scene-guard-actions"><button className="button secondary" onClick={() => setPendingPoseAction(null)}>取消</button><button className="button secondary" onClick={() => finishPoseAction(false)}>放弃草稿，继续</button><button className="button primary" disabled={mirror || playing} onClick={() => finishPoseAction(true)}><Save size={14} />写入完整姿态后继续</button></div></section></div>}
    {pendingResetAction && <div className="modal-backdrop guard-backdrop"><section className="modal scene-confirm-modal" role="dialog" aria-modal="true" aria-labelledby="reset-keys-title"><div className="modal-heading"><h2 id="reset-keys-title">{pendingResetAction === 'adopt' ? '固化当前手动编舞并换段？' : '清空手动关键帧并继续？'}</h2></div><p className="modal-intro">{pendingResetAction === 'adopt' ? '采用换段会把当前手动动画固化到新的动作基底，所选八拍以外保持当前姿态；可编辑关键帧轨将清空。' : pendingResetAction === 'music' ? '调整音乐与数拍会清空当前手动关键帧，并创建新的动作草稿。请先保存或复制场景以保留原编舞。' : pendingResetAction === 'neutral' ? '将使用固定站姿作为新基底，并清空当前手动关键帧。音乐、数拍与相机保持原样。' : '重新生成模板会替换当前动作，并清空手动关键帧。'}{pendingResetAction !== 'music' && '完成后可用撤销恢复这份手动序列。'}</p><div className="modal-actions"><button className="button secondary" onClick={() => setPendingResetAction(null)}>取消</button><button className="button primary" onClick={confirmResetAction}>确认并继续</button></div></section></div>}
    {libraryOpen && <div className="modal-backdrop"><section className="modal scene-library-modal" role="dialog" aria-modal="true" aria-labelledby="library-title"><div className="modal-heading"><div><span className="eyebrow">SCENE LIBRARY / 本机管理</span><h2 id="library-title">本机场景</h2></div><button className="icon-button" aria-label="关闭场景列表" disabled={sceneActionBusy} onClick={() => setLibraryOpen(false)}><X size={20} /></button></div><p className="modal-intro">每个场景独立保留音乐、编排、相机与观看设置。仅保存在这个浏览器。</p><div className="library-toolbar"><span>{sceneList.length} 个已保存场景</span><button className="button primary compact" disabled={sceneActionBusy} onClick={() => requestSceneAction({ type: 'new' })}><Plus size={15} />新建场景</button></div>{libraryBusy ? <div className="library-empty"><LoaderCircle className="spin" size={22} />正在读取本机场景…</div> : sceneList.length ? <div className="scene-list" role="list" aria-label="已保存场景">{sceneList.map(scene => <div role="listitem" key={scene.id} className={`scene-list-row ${scene.id === currentScene.id ? 'current' : ''}`}><span className="scene-list-icon"><Layers3 size={19} /></span><div className="scene-list-info"><strong>{scene.id === currentScene.id ? currentScene.name : scene.name}{scene.id === currentScene.id && <small>当前</small>}</strong><span>{scene.audioName}</span><span>保存于 {new Date(scene.updatedAt).toLocaleString('zh-CN', { hour12: false })}</span></div><div className="scene-list-actions"><button className="button secondary compact" aria-label={`打开场景 ${scene.id === currentScene.id ? currentScene.name : scene.name}`} onClick={() => requestSceneAction({ type: 'open', id: scene.id })} disabled={sceneActionBusy}>{scene.id === currentScene.id ? '已打开' : '打开'}</button><button className="text-button" aria-label={`复制场景 ${scene.id === currentScene.id ? currentScene.name : scene.name}`} disabled={sceneActionBusy} onClick={() => requestSceneAction({ type: 'copy', id: scene.id })}>复制</button><button className="text-button" aria-label={`改名场景 ${scene.id === currentScene.id ? currentScene.name : scene.name}`} onClick={() => { setRenameTarget({ id: scene.id, name: scene.id === currentScene.id ? currentScene.name : scene.name }); setRenameValue(scene.id === currentScene.id ? currentScene.name : scene.name); }}>改名</button><button className="text-button danger-text" aria-label={`删除场景 ${scene.id === currentScene.id ? currentScene.name : scene.name}`} onClick={() => setDeleteTarget({ id: scene.id, name: scene.id === currentScene.id ? currentScene.name : scene.name })}>删除</button></div></div>)}</div> : <div className="library-empty"><FolderOpen size={28} /><strong>还没有保存的场景</strong><p>关闭列表后点击“保存”，即可保留当前场景。</p></div>}<div className="form-note">导入音乐调整当前场景；“新建场景”创建独立作品，“复制”基于该场景的已保存版本。清理浏览器数据会删除本机保存的场景与音乐。</div></section></div>}
    {pendingSceneAction && <div className="modal-backdrop guard-backdrop"><section className="modal scene-confirm-modal" role="dialog" aria-modal="true" aria-labelledby="unsaved-title"><div className="modal-heading"><div><span className="eyebrow">未保存的修改</span><h2 id="unsaved-title">保留当前场景的修改？</h2></div></div><p className="modal-intro">「{currentScene.name}」有未保存的更改。选择保存后继续，或放弃这次修改。{pendingSceneAction.type === 'delete' && '继续后将删除该场景。'}</p><div className="scene-guard-actions"><button className="button secondary" disabled={sceneActionBusy} onClick={() => setPendingSceneAction(null)}>取消</button><button className="button secondary" disabled={sceneActionBusy} onClick={() => { void executeSceneAction(pendingSceneAction); }}>不保存，继续</button><button className="button primary" disabled={sceneActionBusy} onClick={() => { void saveThenContinue(); }}>{sceneActionBusy ? <LoaderCircle className="spin" size={15} /> : <Save size={15} />}保存后继续</button></div></section></div>}
    {renameTarget && <div className="modal-backdrop guard-backdrop"><section className="modal scene-confirm-modal" role="dialog" aria-modal="true" aria-labelledby="rename-title"><div className="modal-heading"><h2 id="rename-title">修改场景名称</h2><button className="icon-button" aria-label="取消场景改名" onClick={() => setRenameTarget(null)}><X size={19} /></button></div><label className="field rename-field">场景名称<input autoFocus value={renameValue} maxLength={80} onChange={event => setRenameValue(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') void confirmRename(); }} /></label><div className="modal-actions"><button className="button secondary" onClick={() => setRenameTarget(null)}>取消</button><button className="button primary" disabled={!renameValue.trim() || libraryBusy} onClick={() => { void confirmRename(); }}>确认改名</button></div></section></div>}
    {deleteTarget && <div className="modal-backdrop guard-backdrop"><section className="modal scene-confirm-modal" role="dialog" aria-modal="true" aria-labelledby="delete-title"><div className="modal-heading"><h2 id="delete-title">删除这个本机场景？</h2></div><p className="modal-intro">将删除「{deleteTarget.name}」及其本机保存的音乐。其他场景保持原样。</p><div className="modal-actions"><button className="button secondary" onClick={() => setDeleteTarget(null)}>取消</button><button className="button danger" disabled={sceneActionBusy} onClick={() => { const id = deleteTarget.id; setDeleteTarget(null); requestSceneAction({ type: 'delete', id }); }}>删除场景</button></div></section></div>}
    {createOpen && <div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) { stopAudition(); setCreateOpen(false); } }}><section className="modal create-modal" role="dialog" aria-modal="true" aria-labelledby="create-title"><div className="modal-heading"><div><span className="eyebrow">音乐设置 / MUSIC & TIMING</span><h2 id="create-title">先把音乐和数拍准备好</h2></div><button className="icon-button" aria-label="关闭音乐设置" onClick={() => { stopAudition(); setCreateOpen(false); }}><X size={20} /></button></div><p className="modal-intro">为当前场景调整音乐与数拍。音乐留在你的浏览器，确认后替换当前初稿；新建独立场景请使用顶部“场景”。</p><label className="field full-field">作品名称<input value={draftTitle} maxLength={80} onChange={event => setDraftTitle(event.target.value)} /></label><label className="upload-area"><Upload size={24} /><strong>{decoding ? '正在解码音频…' : draftName || '选择一首音乐'}</strong><span>MP3 / WAV 等浏览器支持格式 · 100 MB 以内 · 最长 10 分钟</span><input type="file" accept="audio/*" aria-label="上传音乐文件" disabled={decoding} onChange={event => { stopAudition(); void chooseAudio(event.target.files?.[0]); }} /></label><div className="file-caption"><span>{draftDuration.toFixed(1)} 秒可用音频</span><button className="text-button" onClick={() => { stopAudition(); setDraftBlob(demoAudio()); setDraftName('八拍节奏示例.wav'); setDraftDuration(40); setDraftBpm(120); setDraftRelation(1); setDraftFirst(0); setDraftStart(1); setDraftOctets(8); setDraftError(''); }}>使用原创节奏示例</button></div><div className="form-grid"><label className="field">音乐速度 BPM<input type="number" min={30} max={240} value={draftBpm} onChange={event => { stopAudition(); setDraftBpm(Number(event.target.value)); }} /></label><label className="field">每个舞蹈数拍对应<select value={draftRelation} onChange={event => { stopAudition(); setDraftRelation(Number(event.target.value) as 0.5 | 1 | 2); }}><option value={0.5}>半个音乐拍</option><option value={1}>一个音乐拍</option><option value={2}>两个音乐拍</option></select></label><label className="field">第一数拍位置（秒）<input type="number" min={0} step={0.01} value={draftFirst} onChange={event => { stopAudition(); setDraftFirst(Number(event.target.value)); }} /></label><label className="field">从第几个八拍开始<input type="number" min={1} step={1} value={draftStart} onChange={event => { stopAudition(); setDraftStart(Number(event.target.value)); }} /></label><label className="field">选取几个完整八拍<input type="number" min={2} max={60} step={1} value={draftOctets} onChange={event => { stopAudition(); setDraftOctets(Number(event.target.value)); }} /></label><div className="selection-summary"><span>实际选段</span><strong>{draftMap ? `${draftMap.durationSeconds.toFixed(1)} 秒` : '请调整范围'}</strong><small>{draftMap ? `${draftMap.sourceOffsetSeconds.toFixed(1)} – ${(draftMap.sourceOffsetSeconds + draftMap.durationSeconds).toFixed(1)} 秒` : '须满足 16–60 秒'}</small></div></div><div className="audition-row"><button className="button secondary compact" onClick={auditionCount ? stopAudition : auditionCounts} disabled={!draftMap || decoding}>{auditionCount ? <Pause size={15} /> : <Headphones size={15} />}试听 1–8 数拍</button><div>{Array.from({ length: 8 }, (_, index) => <span className={auditionCount === index + 1 ? 'active' : ''} key={index}>{index + 1}</span>)}</div></div><div className="form-note">当前由你手动确认 BPM 与数拍，只支持稳定 4/4 拍音乐；节奏检测暂未接入。调整数拍或音乐将重建当前场景的草稿，不沿用旧动作；其他场景保持原样。</div>{(draftError || mapError) && <div className="form-error" role="alert">{draftError || mapError}</div>}<div className="modal-actions"><button className="button secondary" onClick={() => { stopAudition(); setCreateOpen(false); }}>取消</button><button className="button primary" disabled={!draftMap || !draftBlob || decoding} onClick={confirmMusic}><Check size={16} />确认数拍，进入工作台</button></div></section></div>}
    {aboutOpen && <div className="modal-backdrop"><section className="modal about-modal" role="dialog" aria-modal="true" aria-labelledby="about-title"><div className="modal-heading"><div><span className="eyebrow">版本进展 / DEVELOPMENT</span><h2 id="about-title">从可操作，到真正可教学</h2></div><button className="icon-button" aria-label="关闭版本说明" onClick={() => setAboutOpen(false)}><X size={20} /></button></div><p className="modal-intro">按 v2.1 范围逐步实现。当前是独立预览协议，不冒充原工程包已完成集成。</p><div className="roadmap"><div className="current"><span>01</span><div><strong>交互与播放预览 <small>当前</small></strong><p>本地音频、模板编排、手动 K帧、骨骼旋转、场景管理、3D播放与本机保存。</p></div></div><div><span>02</span><div><strong>接入真实动作与原工程契约</strong><p>取得合法素材、人物和过渡记录，运行 Python 动作处理与接触检查。</p></div></div><div><span>03</span><div><strong>接入生产服务</strong><p>账号、私有项目、版本事务、持久任务、取消与权限检查。</p></div></div><div><span>04</span><div><strong>教师验证与教学视频</strong><p>固定版 MP4、真实设备音画测试与教师试跳，达到门槛后有限发布。</p></div></div></div><div className="form-note">预览不调用生成模型；动作是原创程序化样例。保存只在本机。下载的项目备份不包含原音乐，不提供 MP4 或真实动作库。</div><a className="button primary full" href="https://github.com/DFerryman/ChoreographyStudio" target="_blank" rel="noreferrer">查看源码与阶段任务 <ArrowUpRight size={16} /></a></section></div>}
  </div>;
}
