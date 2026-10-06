import { useEffect, useRef, useState } from 'react';
import { ArrowDownToLine, ArrowRight, ArrowUpRight, Check, CheckCircle2, ChevronDown, CircleHelp, Copy, FileAudio, GitBranch, Headphones, Layers3, LoaderCircle, Music2, Pause, Play, Plus, Redo2, Repeat2, Save, Sparkles, Undo2, Upload, Volume2, X } from 'lucide-react';
import { bakePlan, countAt, makeCountMap, makePlan, replaceSlot, type ArrangementPlan, type BakedTake, type CountMap } from '../../../packages/core/src';
import { Stage } from './Stage';
import { demoAudio } from './demoAudio';
import { loadProject, saveProject } from './storage';

type Snapshot = { title: string; countMap: CountMap; plan: ArrangementPlan | null; take: BakedTake | null };
type Session = { history: Snapshot[]; historyIndex: number; revision: number; audioDuration: number; teacherCheckedRevision: number | null };
type Candidate = { baseRevision: number; slotIndex: number; plan: ArrangementPlan; take: BakedTake };
const initialMap = () => makeCountMap({ bpm: 120, musicBeatsPerDanceCount: 1, firstCountSourceSeconds: 0, startOctet: 0, octetCount: 8, audioDurationSeconds: 40 });
function initialSession(): Session {
  const countMap = initialMap(), plan = makePlan(countMap);
  return { history: [{ title: '我的第一段八拍', countMap, plan, take: bakePlan(plan, countMap) }], historyIndex: 0, revision: 1, audioDuration: 40, teacherCheckedRevision: null };
}
const seconds = (value: number) => `${Math.floor(value / 60).toString().padStart(2, '0')}:${Math.floor(value % 60).toString().padStart(2, '0')}`;
const errorMessage = (error: unknown) => error instanceof Error ? error.message : '操作未完成，请重试。';

export default function App() {
  const [session, setSession] = useState<Session>(initialSession);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [audioName, setAudioName] = useState('八拍节奏示例.wav');
  const [ready, setReady] = useState(false);
  const [audioUrl, setAudioUrl] = useState('');
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [selected, setSelected] = useState(2);
  const [view, setView] = useState<'front' | 'back'>('front');
  const [mirror, setMirror] = useState(false);
  const [rate, setRate] = useState(1);
  const [loop, setLoop] = useState(false);
  const [countSound, setCountSound] = useState(false);
  const [page, setPage] = useState<'studio' | 'teaching'>('studio');
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
  const active = session.history[session.historyIndex];
  const displayedTake = previewCandidate && candidate ? candidate.take : active.take;
  const currentCount = countAt(active.countMap, time);
  const stale = candidate && candidate.baseRevision !== session.revision;

  useEffect(() => { sessionRef.current = session; }, [session]);
  useEffect(() => {
    let cancelled = false;
    loadProject<Session>().then(saved => {
      if (cancelled) return;
      if (saved && saved.project.history?.length && saved.project.history[saved.project.historyIndex]?.countMap?.confirmed) {
        setSession(saved.project); setAudioBlob(saved.audio ?? demoAudio()); setAudioName(saved.audioName); setSaveStatus('saved');
        setSelected(Math.min(2, saved.project.history[saved.project.historyIndex].countMap.octetCount - 1));
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
    const warn = (event: BeforeUnloadEvent) => { if (saveStatus !== 'saved' && ready) { event.preventDefault(); event.returnValue = ''; } };
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

  function pause() { audioRef.current?.pause(); setPlaying(false); }
  function seek(next: number) {
    const value = Math.max(0, Math.min(active.countMap.durationSeconds, next));
    if (audioRef.current) audioRef.current.currentTime = active.countMap.sourceOffsetSeconds + value;
    setTime(value);
  }
  async function togglePlay() {
    if (playing) { pause(); return; }
    if (!displayedTake || !audioRef.current || !ready) return;
    if (!cueContext.current) cueContext.current = new AudioContext();
    await cueContext.current.resume();
    const audio = audioRef.current;
    if (time >= active.countMap.durationSeconds - 0.01) seek(loop ? selected * active.countMap.durationSeconds / active.countMap.octetCount : 0);
    else if (loop) seek(selected * active.countMap.durationSeconds / active.countMap.octetCount);
    else audio.currentTime = active.countMap.sourceOffsetSeconds + time;
    audio.playbackRate = rate;
    try { await audio.play(); setPlaying(true); } catch { setNotice('音频尚未就绪，或浏览器阻止了播放。请再点一次播放。'); }
  }
  function changeSelection(index: number) { setSelected(index); seek(index * active.countMap.durationSeconds / active.countMap.octetCount); }
  function commit(next: Snapshot) {
    pause(); setPreviewCandidate(false);
    setSession(previous => {
      const history = [...previous.history.slice(0, previous.historyIndex + 1), next].slice(-12);
      return { ...previous, history, historyIndex: history.length - 1, revision: previous.revision + 1, teacherCheckedRevision: null };
    });
    setSaveStatus('dirty');
  }
  async function generate() {
    if (busy) return;
    setBusy('正在编排模板'); pause();
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    try {
      const plan = makePlan(active.countMap), take = bakePlan(plan, active.countMap);
      commit({ ...active, plan, take }); setCandidate(null); setSelected(0); seek(0);
      setNotice('模板初稿已生成。请播放查看，或选择一个八拍换段。');
    } catch (error) { setNotice(errorMessage(error)); }
    finally { setBusy(''); }
  }
  async function requestCandidate(simpler = false) {
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
  function adopt() {
    if (!candidate || candidate.baseRevision !== session.revision) { setNotice('作品已经改变，请重新生成候选。'); return; }
    commit({ ...active, plan: candidate.plan, take: candidate.take }); setCandidate(null);
    setNotice('已采用这个八拍。其他八拍保持原样。');
  }
  function navigateHistory(direction: -1 | 1) {
    const next = session.historyIndex + direction;
    if (next < 0 || next >= session.history.length) return;
    pause(); setPreviewCandidate(false); setTime(0);
    setSession(previous => ({ ...previous, historyIndex: next, revision: previous.revision + 1, teacherCheckedRevision: null }));
    setSaveStatus('dirty');
  }
  async function save() {
    const snapshot = session, blob = audioBlob, name = audioName;
    setSaveStatus('saving');
    try {
      await saveProject({ project: snapshot, audio: blob, audioName: name });
      setSaveStatus(sessionRef.current === snapshot ? 'saved' : 'dirty');
    } catch { setSaveStatus('failed'); setNotice('保存失败，可能是浏览器存储空间不足。请下载项目备份。'); }
  }
  function exportProject() {
    const blob = new Blob([JSON.stringify({ format: 'choreo-studio-preview-1', session, audioName, audioIncluded: false }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob), link = document.createElement('a');
    link.href = url; link.download = 'choreo-studio-project.json'; link.click(); URL.revokeObjectURL(url);
    setNotice('已下载项目数据备份。原音乐未包含，请另外保留。');
  }
  function openCreate() {
    pause(); setDraftBlob(audioBlob); setDraftName(audioName); setDraftDuration(session.audioDuration); setDraftTitle(active.title);
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
  function confirmMusic() {
    if (!draftMap || !draftBlob || decoding) return;
    stopAudition(); pause();
    setAudioBlob(draftBlob); setAudioName(draftName); setCandidate(null); setPreviewCandidate(false); setTime(0); setSelected(0);
    setSession(previous => ({ history: [{ title: draftTitle.trim() || '未命名组合', countMap: draftMap!, plan: null, take: null }], historyIndex: 0, revision: previous.revision + 1, audioDuration: draftDuration, teacherCheckedRevision: null }));
    setSaveStatus('dirty'); setCreateOpen(false); setPage('studio');
    setNotice('数拍和选段已确认。现在可以生成模板初稿。');
  }
  const slots = active.plan?.slots ?? Array.from({ length: active.countMap.octetCount }, (_, index) => ({ slotIndex: index, label: '等待编排', actionId: '', teachingCue: '确认数拍后生成模板初稿', startSeconds: index * active.countMap.durationSeconds / active.countMap.octetCount, endSeconds: (index + 1) * active.countMap.durationSeconds / active.countMap.octetCount }));
  const selectedSlot = slots[Math.min(selected, slots.length - 1)];

  return <div className="app-shell">
    <audio ref={audioRef} src={audioUrl || undefined} preload="auto" onEnded={() => { pause(); setTime(active.countMap.durationSeconds); }} onError={() => { if (ready && audioUrl) setNotice('音乐无法播放。请重新导入支持的音频格式。'); }} />
    <aside className="sidebar">
      <a className="brand" href="#" onClick={event => { event.preventDefault(); setPage('studio'); }} aria-label="八拍 首页"><span className="brand-mark"><i /><i /><i /></span><span>八拍<span className="brand-en">CHOREO STUDIO</span></span></a>
      <div className="workspace-label">创作空间 <ChevronDown size={14} /></div>
      <nav aria-label="主导航">
        <button className={page === 'studio' ? 'nav-item active' : 'nav-item'} onClick={() => setPage('studio')}><Layers3 size={18} />编舞工作台<span className="nav-dot" /></button>
        <button className={page === 'teaching' ? 'nav-item active' : 'nav-item'} onClick={() => { pause(); setPage('teaching'); }}><Headphones size={18} />教学预览</button>
      </nav>
      <div className="sidebar-project"><span>当前作品</span><button onClick={() => setPage('studio')}><span className="project-icon"><Music2 size={17} /></span><span>{active.title}<small>{active.countMap.octetCount} 个八拍 · {Math.round(active.countMap.durationSeconds * 10) / 10} 秒</small></span></button></div>
      <div className="sidebar-bottom"><div className="preview-card"><span className="eyebrow">一起把第一段舞做好</span><p>从一首音乐，<br />到一个可以修改的组合。</p><button onClick={() => setAboutOpen(true)}>查看本版进展 <ArrowUpRight size={15} /></button></div><button className="help-link" onClick={() => setAboutOpen(true)}><CircleHelp size={16} />使用说明与版本进展</button><div className="profile"><span>DF</span><div>我的创作空间<small>本地预览 · 音乐留在浏览器</small></div></div></div>
    </aside>

    <main className="main-content">
      <header className="topbar"><div className="breadcrumbs">创作空间 <span>/</span> {page === 'studio' ? '编舞工作台' : '教学预览'}</div><div className="top-actions"><button className="version-pill" onClick={() => setAboutOpen(true)}><span />阶段一 · 交互预览</button><a href="https://github.com/DFerryman/ChoreographyStudio" target="_blank" rel="noreferrer" className="repo-link" aria-label="查看GitHub源码"><GitBranch size={17} /></a></div></header>
      <section className="workspace-content">
        <div className="page-heading"><div><div className="eyebrow heading-eyebrow">MAKE ROOM FOR MOVEMENT</div><h1>{page === 'studio' ? '把灵感，编进八拍。' : '慢下来，看清每一个动作。'}</h1><p>{page === 'studio' ? '听音乐、看动作，再把不满意的一段换掉。' : '切换视角、慢放与循环，让每个八拍更清楚。'}</p></div><button className="button secondary new-project" onClick={openCreate} disabled={!ready || !!busy}><Plus size={17} />新建 / 上传音乐</button></div>
        <div className="project-bar"><div className="project-title"><span className="project-mini-icon"><Music2 size={17} /></span><strong>{active.title}</strong><span className="local-tag">本地作品</span></div><div className="project-tools"><span className={`save-state ${saveStatus}`}><span />{saveStatus === 'saved' ? '已保存到本机' : saveStatus === 'saving' ? '保存中' : saveStatus === 'failed' ? '保存失败' : '有未保存更改'}</span><button className="icon-button" title="撤销" aria-label="撤销" disabled={session.historyIndex === 0 || !!busy} onClick={() => navigateHistory(-1)}><Undo2 size={17} /></button><button className="icon-button" title="重做" aria-label="重做" disabled={session.historyIndex >= session.history.length - 1 || !!busy} onClick={() => navigateHistory(1)}><Redo2 size={17} /></button><button className="button compact secondary" onClick={save} disabled={!ready || saveStatus === 'saving'}><Save size={15} />保存</button></div></div>
        <div className="studio-grid">
          <section className="viewer-panel" aria-label="3D动作预览">
            <div className="viewer-toolbar"><span className="viewer-title"><span />{previewCandidate ? '替换预览' : '动作预览'}<span className="muted-divider">/</span><span className="viewer-muted">原创合成人偶</span></span><div className="segmented" aria-label="观看视角"><button className={view === 'front' ? 'selected' : ''} onClick={() => setView('front')}>正面</button><button className={view === 'back' ? 'selected' : ''} onClick={() => setView('back')}>背面</button></div></div>
            <div className="stage-wrap"><Stage take={displayedTake} time={time} view={view} mirror={mirror} /><div className="stage-status"><span className="stage-tag">单人 · 动作演示</span><span className="stage-hint">{mirror ? '镜像观看 · 左右显示已翻转' : view === 'front' ? '正面观看 · 左右按人偶身体理解' : '背面观看 · 与人偶同向'}</span></div><div className="count-overlay"><span>第 {currentCount.octet} 个八拍</span><strong>{currentCount.count}<small> / 8</small></strong></div>{!active.take && <div className="empty-overlay"><Sparkles size={24} /><strong>音乐准备好了</strong><p>生成模板初稿，开始查看你的组合。</p></div>}</div>
            <div className="player"><div className="player-main"><button className="play-button" aria-label={playing ? '暂停' : '播放'} disabled={!displayedTake || !ready} onClick={togglePlay}>{playing ? <Pause size={19} fill="currentColor" /> : <Play size={19} fill="currentColor" />}</button><span className="time-display">{seconds(time)}<span> / {seconds(active.countMap.durationSeconds)}</span></span><input aria-label="播放进度" type="range" min={0} max={active.countMap.durationSeconds} step={0.01} value={time} disabled={!displayedTake} onChange={event => seek(Number(event.target.value))} style={{ '--progress': `${time / active.countMap.durationSeconds * 100}%` } as React.CSSProperties} /><button className={`icon-button ${loop ? 'toggled' : ''}`} aria-label="循环当前八拍" title="循环当前八拍" aria-pressed={loop} onClick={() => { setLoop(!loop); if (!loop) seek(selected * active.countMap.durationSeconds / active.countMap.octetCount); }}><Repeat2 size={18} /></button><select aria-label="播放速度" value={rate} onChange={event => setRate(Number(event.target.value))}><option value={0.5}>0.5×</option><option value={0.75}>0.75×</option><option value={1}>1×</option></select></div><div className="player-options"><button className={mirror ? 'option active' : 'option'} aria-pressed={mirror} onClick={() => setMirror(!mirror)}><Copy size={14} />镜像观看</button><button className={countSound ? 'option active' : 'option'} aria-pressed={countSound} onClick={() => setCountSound(!countSound)}><Volume2 size={15} />节拍提示</button><span>教学慢放不改变原作品</span></div></div>
          </section>
          <aside className="inspector">
            <section className="music-card"><div className="section-heading"><h2>音乐与数拍</h2><button className="text-button" onClick={openCreate} disabled={!ready || !!busy}>调整</button></div><div className="music-file"><span className="file-icon"><FileAudio size={21} /></span><div><strong title={audioName}>{audioName}</strong><small>{audioName === '八拍节奏示例.wav' ? '原创节奏示例 · 本机生成' : '本机音频 · 不上传服务器'}</small></div></div><div className="waveform" aria-hidden="true">{Array.from({ length: 52 }, (_, index) => <i key={index} style={{ height: `${8 + Math.abs(Math.sin(index * 1.7) * Math.cos(index * 0.47)) * 30}px`, opacity: index / 52 <= time / active.countMap.durationSeconds ? 1 : 0.34 }} />)}</div><div className="music-metrics"><div><strong>{active.countMap.bpm}<small> BPM</small></strong><span>稳定节奏 · 手动确认</span></div><div><strong>{active.countMap.octetCount}<small> 个八拍</small></strong><span>{Math.round(active.countMap.durationSeconds * 10) / 10} 秒完整选段</span></div></div><div className="confirmed-note"><CheckCircle2 size={14} />数拍已确认<span>4/4</span></div></section>
            <section className="edit-card"><div className="section-heading"><h2>{page === 'studio' ? '修改这一段' : '当前教学段落'}</h2><span className="octet-pill">{(selected + 1).toString().padStart(2, '0')} / {active.countMap.octetCount.toString().padStart(2, '0')}</span></div><div className="selected-phrase"><span className="eyebrow">第 {selected + 1} 个八拍</span><h3>{selectedSlot?.label ?? '等待编排'}</h3><p>{selectedSlot?.teachingCue ?? '选择一个八拍查看动作提示'}</p><span>{selectedSlot?.startSeconds.toFixed(1)} – {selectedSlot?.endSeconds.toFixed(1)} 秒</span></div>{page === 'studio' ? <><button className="button primary full" onClick={() => requestCandidate()} disabled={!active.take || !!busy}><Sparkles size={16} />换一个八拍<ArrowRight size={16} /></button><button className="button secondary full" onClick={() => requestCandidate(true)} disabled={!active.take || !!busy}><Layers3 size={16} />试试更简单</button><p className="edit-footnote">先预览，再决定是否采用。<br />只替换选中的八拍，其他段落保持原样。</p></> : <><button className="button primary full" onClick={() => { setLoop(true); seek(selectedSlot.startSeconds); if (!playing) void togglePlay(); }} disabled={!active.take}><Repeat2 size={16} />循环练习这一段</button><button className="button secondary full" onClick={() => { setSession(previous => ({ ...previous, teacherCheckedRevision: previous.revision })); setSaveStatus('dirty'); setNotice('已记录本版试看。演示记录不代表真实动作已通过教学审核。'); }} disabled={!active.take || session.teacherCheckedRevision === session.revision}><Check size={16} />{session.teacherCheckedRevision === session.revision ? '已记录本版试看' : '标记本版已试看'}</button><p className="edit-footnote">本版是合成动作演示。<br />真实教学素材与视频导出正在后续阶段接入。</p></>}</section>
            {candidate && <section className={`candidate-card ${stale ? 'expired' : ''}`} aria-label="替换候选"><div className="candidate-title"><Sparkles size={15} /><strong>{stale ? '候选已过期' : '新的八拍，准备好了'}</strong><span>第 {candidate.slotIndex + 1} 段</span></div><p>{stale ? '作品版本已经改变。可以观看，但需重新生成才能采用。' : candidate.plan.slots[candidate.slotIndex].label}</p><button className="text-button" onClick={() => { pause(); setPreviewCandidate(!previewCandidate); seek(candidate.slotIndex * active.countMap.durationSeconds / active.countMap.octetCount); }}>{previewCandidate ? '切回原稿' : '查看替换预览'} <ArrowRight size={14} /></button><div className="candidate-actions"><button className="button primary compact" disabled={!!stale} onClick={adopt}><Check size={14} />采用</button><button className="button secondary compact" onClick={() => { pause(); setCandidate(null); setPreviewCandidate(false); }}>放弃</button></div></section>}
          </aside>
        </div>
        <section className="timeline-panel"><div className="timeline-heading"><div><h2>你的八拍组合 <span>{active.countMap.octetCount} 段</span></h2><p>点选一个八拍，听这一段，也改这一段。</p></div><button className="button compact secondary" onClick={generate} disabled={!!busy || !ready}>{busy ? <LoaderCircle className="spin" size={15} /> : <Sparkles size={15} />}{busy || (active.take ? '重新生成模板初稿' : '生成模板初稿')}</button></div><div className="octet-list" role="list" aria-label="八拍时间线">{slots.map((slot, index) => <button key={index} role="listitem" aria-label={`第${index + 1}个八拍 ${slot.label}`} className={`octet-card ${index === selected ? 'selected' : ''} ${playing && currentCount.octet === index + 1 ? 'playing' : ''}`} onClick={() => changeSelection(index)}><div className="octet-top"><span>{(index + 1).toString().padStart(2, '0')}</span>{index === selected ? <span className="selected-dot" /> : <span className="mini-wave"><i /><i /><i /></span>}</div><div className={`phrase-art art-${index % 4}`}><i /><i /><i /></div><strong>{slot.label}</strong><small>{slot.startSeconds.toFixed(0)}–{slot.endSeconds.toFixed(0)} 秒</small><div className="count-ticks">{Array.from({ length: 8 }, (_, count) => <i key={count} className={playing && currentCount.octet === index + 1 && currentCount.count === count + 1 ? 'current' : ''} />)}</div></button>)}</div><div className="timeline-footer"><span><span className="legend-dot" />当前选择<span className="legend-dot pale" />完整八拍</span><span>一个主题 · 合成动作模板 · 作品 v{session.revision}</span></div></section>
        <footer className="workspace-footer"><span><span className="small-dot" />此预览使用原创合成动作，用于验证操作流程，尚不代表可教学的真实舞蹈。</span><button onClick={exportProject}><ArrowDownToLine size={14} />下载项目备份</button></footer>
      </section>
    </main>
    {notice && <div className="toast" role="status"><CheckCircle2 size={18} /><span>{notice}</span><button aria-label="关闭提示" onClick={() => setNotice('')}><X size={15} /></button></div>}
    {createOpen && <div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) { stopAudition(); setCreateOpen(false); } }}><section className="modal create-modal" role="dialog" aria-modal="true" aria-labelledby="create-title"><div className="modal-heading"><div><span className="eyebrow">START WITH YOUR MUSIC</span><h2 id="create-title">先把音乐和数拍准备好</h2></div><button className="icon-button" aria-label="关闭音乐设置" onClick={() => { stopAudition(); setCreateOpen(false); }}><X size={20} /></button></div><p className="modal-intro">音乐留在你的浏览器。试听并确认第一拍，再选择完整的八拍。</p><label className="field full-field">作品名称<input value={draftTitle} maxLength={80} onChange={event => setDraftTitle(event.target.value)} /></label><label className="upload-area"><Upload size={24} /><strong>{decoding ? '正在解码音频…' : draftName || '选择一首音乐'}</strong><span>MP3 / WAV 等浏览器支持格式 · 100 MB 以内 · 最长 10 分钟</span><input type="file" accept="audio/*" aria-label="上传音乐文件" disabled={decoding} onChange={event => { stopAudition(); void chooseAudio(event.target.files?.[0]); }} /></label><div className="file-caption"><span>{draftDuration.toFixed(1)} 秒可用音频</span><button className="text-button" onClick={() => { stopAudition(); setDraftBlob(demoAudio()); setDraftName('八拍节奏示例.wav'); setDraftDuration(40); setDraftBpm(120); setDraftRelation(1); setDraftFirst(0); setDraftStart(1); setDraftOctets(8); setDraftError(''); }}>使用原创节奏示例</button></div><div className="form-grid"><label className="field">音乐速度 BPM<input type="number" min={30} max={240} value={draftBpm} onChange={event => { stopAudition(); setDraftBpm(Number(event.target.value)); }} /></label><label className="field">每个舞蹈数拍对应<select value={draftRelation} onChange={event => { stopAudition(); setDraftRelation(Number(event.target.value) as 0.5 | 1 | 2); }}><option value={0.5}>半个音乐拍</option><option value={1}>一个音乐拍</option><option value={2}>两个音乐拍</option></select></label><label className="field">第一数拍位置（秒）<input type="number" min={0} step={0.01} value={draftFirst} onChange={event => { stopAudition(); setDraftFirst(Number(event.target.value)); }} /></label><label className="field">从第几个八拍开始<input type="number" min={1} step={1} value={draftStart} onChange={event => { stopAudition(); setDraftStart(Number(event.target.value)); }} /></label><label className="field">选取几个完整八拍<input type="number" min={2} max={60} step={1} value={draftOctets} onChange={event => { stopAudition(); setDraftOctets(Number(event.target.value)); }} /></label><div className="selection-summary"><span>实际选段</span><strong>{draftMap ? `${draftMap.durationSeconds.toFixed(1)} 秒` : '请调整范围'}</strong><small>{draftMap ? `${draftMap.sourceOffsetSeconds.toFixed(1)} – ${(draftMap.sourceOffsetSeconds + draftMap.durationSeconds).toFixed(1)} 秒` : '须满足 16–60 秒'}</small></div></div><div className="audition-row"><button className="button secondary compact" onClick={auditionCount ? stopAudition : auditionCounts} disabled={!draftMap || decoding}>{auditionCount ? <Pause size={15} /> : <Headphones size={15} />}试听 1–8 数拍</button><div>{Array.from({ length: 8 }, (_, index) => <span className={auditionCount === index + 1 ? 'active' : ''} key={index}>{index + 1}</span>)}</div></div><div className="form-note">当前由你手动确认 BPM 与数拍，只支持稳定 4/4 拍音乐；节奏检测暂未接入。调整数拍或音乐将创建新的草稿，不沿用旧动作。</div>{(draftError || mapError) && <div className="form-error" role="alert">{draftError || mapError}</div>}<div className="modal-actions"><button className="button secondary" onClick={() => { stopAudition(); setCreateOpen(false); }}>取消</button><button className="button primary" disabled={!draftMap || !draftBlob || decoding} onClick={confirmMusic}><Check size={16} />确认数拍，进入工作台</button></div></section></div>}
    {aboutOpen && <div className="modal-backdrop"><section className="modal about-modal" role="dialog" aria-modal="true" aria-labelledby="about-title"><div className="modal-heading"><div><span className="eyebrow">BUILDING IN THE OPEN</span><h2 id="about-title">从可操作，到真正可教学</h2></div><button className="icon-button" aria-label="关闭版本说明" onClick={() => setAboutOpen(false)}><X size={20} /></button></div><p className="modal-intro">按 v2.1 范围逐步实现。当前是独立预览协议，不冒充原工程包已完成集成。</p><div className="roadmap"><div className="current"><span>01</span><div><strong>交互与播放预览 <small>当前</small></strong><p>本地音频、手动数拍、模板初稿、八拍替换、撤销重做、3D观看、本机保存。</p></div></div><div><span>02</span><div><strong>接入真实动作与原工程契约</strong><p>取得合法素材、人物和过渡记录，运行 Python 动作处理与接触检查。</p></div></div><div><span>03</span><div><strong>接入生产服务</strong><p>账号、私有项目、版本事务、持久任务、取消与权限检查。</p></div></div><div><span>04</span><div><strong>教师验证与教学视频</strong><p>固定版 MP4、真实设备音画测试与教师试跳，达到门槛后有限发布。</p></div></div></div><div className="form-note">预览不调用生成模型；动作是原创程序化样例。保存只在本机。下载的项目备份不包含原音乐，不提供 MP4 或真实动作库。</div><a className="button primary full" href="https://github.com/DFerryman/ChoreographyStudio" target="_blank" rel="noreferrer">查看源码与阶段任务 <ArrowUpRight size={16} /></a></section></div>}
  </div>;
}
