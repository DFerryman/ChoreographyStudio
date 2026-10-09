import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { ArrowRight, ChevronDown, ChevronUp, Minus, Music2, Plus, ChevronLeft, ChevronRight, ClipboardPaste, Copy, Diamond, RotateCcw, Trash2 } from 'lucide-react';
import { EDITABLE_JOINT_NAMES, frameTime, getKeyframeFrames, lastFrame, type JointName, type KeyframeSequence, type KeyframeTransferRequest, type KeyframeTransferScope } from '../../../packages/core/src';
import { STAGE_JOINT_LABELS } from './Stage';
import './KeyframeEditor.css';

function neighboringFrames(frames: number[], frame: number) {
  let previous: number | undefined;
  for (const keyFrame of frames) {
    if (keyFrame >= frame) break;
    previous = keyFrame;
  }
  return { previous, next: frames.find(keyFrame => keyFrame > frame) };
}

function KeyNavigation({ frames, frame, playing, onFrame, timeline = false }: {
  frames: number[]; frame: number; playing: boolean; onFrame: (frame: number) => void; timeline?: boolean;
}) {
  const { previous, next } = neighboringFrames(frames, frame);
  return <div className="kf-key-navigation" aria-label={timeline ? '筛选轨道关键帧跳转' : '全部轨道关键帧跳转'}>
    <button aria-label={timeline ? '时间线上一关键帧' : '上一关键帧'} disabled={playing || previous === undefined} onClick={() => { if (previous !== undefined) onFrame(previous); }}><ChevronLeft size={14} />上一 K</button>
    <button aria-label={timeline ? '时间线下一关键帧' : '下一关键帧'} disabled={playing || next === undefined} onClick={() => { if (next !== undefined) onFrame(next); }}>下一 K<ChevronRight size={14} /></button>
  </div>;
}

type KeyframeTimelineProps = {
  sequence: KeyframeSequence;
  frame: number;
  selectedJoint: JointName | null;
  onFrame: (frame: number) => void;
  playing: boolean;
  mirror?: boolean;
  readOnly?: boolean;
  dirty: boolean;
  transport: ReactNode;
  playbackOptions: ReactNode;
  audio?: { name: string; offsetSeconds: number; durationSeconds: number; waveform: number[]; onMove: (offsetSeconds: number) => void; disabled?: boolean };
  onTime: (time: number) => void;
  onWriteJoint: () => void;
  onWriteRoot: () => void;
  onWritePose: () => void;
  onDiscard: () => void;
  onDelete: () => void;
  onDeleteJoint: () => void;
  onDeleteRoot: () => void;
  onNeutral: () => void;
  onTransferKeyframes: (request: Omit<KeyframeTransferRequest, 'collision'>) => void;
  clipboard: { frame: number; fromDraft: boolean } | null;
  onCopyPose: () => void;
  onPastePose: (includeRoot: boolean) => void;
};

export function KeyframeTimeline(props: KeyframeTimelineProps) {
  const { sequence, frame, selectedJoint, onFrame, playing, mirror = false, readOnly = false, onTransferKeyframes } = props;
  const [filter, setFilter] = useState<'all' | 'joint' | 'root'>('all');
  const [targetText, setTargetText] = useState(() => String(Math.min(frame + 30, lastFrame(sequence.baseTake.durationSeconds))));
  useEffect(() => { setTargetText(String(Math.min(frame + 30, lastFrame(sequence.baseTake.durationSeconds)))); }, [sequence.baseTake.id]);
  const editable = selectedJoint !== null && EDITABLE_JOINT_NAMES.includes(selectedJoint);
  const frames = useMemo(() => {
    if (filter === 'root') return sequence.root.map(key => key.frame);
    if (filter === 'joint') return selectedJoint && editable ? (sequence.rotations[selectedJoint] ?? []).map(key => key.frame) : [];
    return getKeyframeFrames(sequence);
  }, [sequence, filter, selectedJoint, editable]);
  const duration = sequence.baseTake.durationSeconds, end = lastFrame(duration);
  const locked = playing || mirror || readOnly;
  const keyed = getKeyframeFrames(sequence).includes(frame);
  const jointKeyed = !!(selectedJoint && sequence.rotations[selectedJoint]?.some(key => key.frame === frame));
  const rootKeyed = sequence.root.some(key => key.frame === frame);
  const rotationTracks = useMemo(() => Object.entries(sequence.rotations), [sequence]);
  const sourceKeyCount = filter === 'root' ? Number(sequence.root.some(key => key.frame === frame)) : filter === 'joint' ? Number(!!(editable && selectedJoint && sequence.rotations[selectedJoint]?.some(key => key.frame === frame))) : rotationTracks.filter(([, keys]) => keys!.some(key => key.frame === frame)).length + Number(sequence.root.some(key => key.frame === frame));
  const targetFrame = Number(targetText);
  const targetValid = !!targetText.trim() && Number.isInteger(targetFrame) && targetFrame >= 0 && targetFrame <= end;
  const transferUnavailable = playing ? '播放中请先暂停，再移动或复制关键帧。' : mirror ? '镜像仅用于观看，请回原始视图编辑关键帧。' : readOnly ? '当前仅可观看，请返回原稿编辑关键帧。' : filter === 'joint' && !editable ? selectedJoint ? '末端节点只读，没有可移动或复制的旋转 K。' : '请先选择一个可编辑关节。' : !sourceKeyCount ? '本帧在当前范围内没有显式 K；插值姿态和基底端点不参与操作。' : !targetValid ? `请输入 0–${end} 范围内的整数目标帧。` : targetFrame === frame ? '目标与源帧相同，请选择另一个目标帧。' : null;
  function requestTransfer(operation: 'move' | 'copy') {
    if (transferUnavailable) return;
    const scope: KeyframeTransferScope = filter === 'joint' && selectedJoint ? { kind: 'joint', joint: selectedJoint } : { kind: filter === 'root' ? 'root' : 'all' };
    onTransferKeyframes({ operation, scope, sourceFrame: frame, targetFrame });
  }
  const trackName = filter === 'root' ? 'Root 位移' : filter === 'joint' ? selectedJoint ? `${STAGE_JOINT_LABELS[selectedJoint]} · 局部旋转` : '未选关节' : '全部轨道';
  const trackStatus = filter === 'joint' && !editable ? selectedJoint ? '末端节点只读' : '请选择关节' : `${frames.includes(frame) ? '本帧已写 K' : '本帧未写 K'} · ${frames.length} 个关键时刻`;
  const empty = filter === 'joint' ? !selectedJoint ? '请在舞台点击人物部位，查看它的旋转关键帧。' : !editable ? '这个末端节点只读，没有可编辑旋转轨。请选择肩、肘、髋等骨骼。' : `${STAGE_JOINT_LABELS[selectedJoint]}尚无显式旋转 K，当前使用基底动画；写入「K 当前关节」后在此查看。` : filter === 'root' ? 'Root 尚无显式位移 K，当前使用基底动画；写入「K 位移」后在此查看。' : '还没有手动关键帧。调整姿态后点击 K，将这一帧写入序列。';
  const groups: { id: string; label: string; joints: JointName[] }[] = [
    { id: 'body', label: '身体', joints: ['Hips', 'Spine', 'Chest', 'Neck', 'Head'] },
    { id: 'left-arm', label: '左臂', joints: ['LeftShoulder', 'LeftUpperArm', 'LeftForeArm', 'LeftHand'] },
    { id: 'right-arm', label: '右臂', joints: ['RightShoulder', 'RightUpperArm', 'RightForeArm', 'RightHand'] },
    { id: 'left-leg', label: '左腿', joints: ['LeftUpperLeg', 'LeftLowerLeg', 'LeftFoot'] },
    { id: 'right-leg', label: '右腿', joints: ['RightUpperLeg', 'RightLowerLeg', 'RightFoot'] },
  ];
  type DragBase = { pointerId: number; element: HTMLButtonElement; startX: number; laneWidth: number; moved: boolean };
  type KeyDrag = DragBase & { kind: 'key'; rowId: string; scope: KeyframeTransferScope; sourceFrame: number; targetFrame: number };
  type AudioDrag = DragBase & { kind: 'audio'; sourceOffset: number; targetOffset: number };
  type Drag = KeyDrag | AudioDrag;
  const [expanded, setExpanded] = useState(true);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(() => new Set());
  const [zoom, setZoom] = useState(1);
  const [drag, setDrag] = useState<Drag | null>(null);
  const dragRef = useRef<Drag | null>(null);
  const suppressClick = useRef(false);
  const cancelledPointer = useRef<number | null>(null);
  const moreDisclosure = useRef<HTMLDetailsElement>(null);
  const { audio } = props;
  const selectedGroup = groups.find(group => selectedJoint && (group.joints.includes(selectedJoint) || group.id === 'left-arm' && selectedJoint === 'LeftHandTip' || group.id === 'right-arm' && selectedJoint === 'RightHandTip' || group.id === 'left-leg' && ['LeftToe', 'LeftHeel'].includes(selectedJoint) || group.id === 'right-leg' && ['RightToe', 'RightHeel'].includes(selectedJoint)));
  function finishDrag(cancel = false) {
    const active = dragRef.current;
    if (!active) return;
    dragRef.current = null;
    setDrag(null);
    if (active.element.hasPointerCapture(active.pointerId)) active.element.releasePointerCapture(active.pointerId);
    if (cancel || active.moved) {
      suppressClick.current = true;
      if (cancel) cancelledPointer.current = active.pointerId;
      else window.setTimeout(() => { suppressClick.current = false; }, 0);
    }
    if (cancel || !active.moved || locked) return;
    if (active.kind === 'key' && active.sourceFrame !== active.targetFrame) onTransferKeyframes({ operation: 'move', scope: active.scope, sourceFrame: active.sourceFrame, targetFrame: active.targetFrame });
    else if (active.kind === 'audio' && audio && !audio.disabled && active.sourceOffset !== active.targetOffset) audio.onMove(active.targetOffset);
  }
  useEffect(() => { finishDrag(true); }, [sequence.id, sequence.baseTake.id, frame, locked, audio?.offsetSeconds, audio?.name, audio?.disabled, audio?.durationSeconds, zoom]);
  useEffect(() => {
    const cancel = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (dragRef.current) { event.preventDefault(); event.stopPropagation(); finishDrag(true); }
      else if (moreDisclosure.current?.open && !document.querySelector('[aria-modal="true"]')) { moreDisclosure.current.open = false; moreDisclosure.current.querySelector('summary')?.focus(); }
    };
    document.addEventListener('keydown', cancel, true);
    return () => document.removeEventListener('keydown', cancel, true);
  });
  useEffect(() => {
    const closeMore = (event: PointerEvent) => {
      if (event.isPrimary && !dragRef.current) { cancelledPointer.current = null; suppressClick.current = false; }
      if (moreDisclosure.current?.open && !moreDisclosure.current.contains(event.target as Node)) moreDisclosure.current.open = false;
    };
    const releaseCancelled = (event: PointerEvent) => { if (cancelledPointer.current === event.pointerId) { cancelledPointer.current = null; window.setTimeout(() => { suppressClick.current = false; }, 0); } };
    document.addEventListener('pointerdown', closeMore, true);
    document.addEventListener('pointerup', releaseCancelled, true);
    document.addEventListener('pointercancel', releaseCancelled, true);
    return () => { document.removeEventListener('pointerdown', closeMore, true); document.removeEventListener('pointerup', releaseCancelled, true); document.removeEventListener('pointercancel', releaseCancelled, true); const active = dragRef.current; if (active?.element.hasPointerCapture(active.pointerId)) active.element.releasePointerCapture(active.pointerId); };
  }, []);
  function beginKeyDrag(event: ReactPointerEvent<HTMLButtonElement>, rowId: string, scope: KeyframeTransferScope, sourceFrame: number) {
    beginDrag(event, { kind: 'key', rowId, scope, sourceFrame, targetFrame: sourceFrame });
  }
  function beginDrag(event: ReactPointerEvent<HTMLButtonElement>, payload: Omit<KeyDrag, keyof DragBase> | Omit<AudioDrag, keyof DragBase>) {
    if (event.button !== 0 || !event.isPrimary || locked || dragRef.current || payload.kind === 'audio' && audio?.disabled) return;
    const lane = event.currentTarget.closest('.kf-lane-track');
    if (!lane) return;
    event.stopPropagation();
    const active = { ...payload, pointerId: event.pointerId, element: event.currentTarget, startX: event.clientX, laneWidth: lane.getBoundingClientRect().width, moved: false } as Drag;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = active;
    setDrag(active);
  }
  function moveDrag(event: ReactPointerEvent<HTMLButtonElement>) {
    const active = dragRef.current;
    if (!active || active.pointerId !== event.pointerId) return;
    const delta = event.clientX - active.startX;
    if (!active.moved && Math.abs(delta) < 4) return;
    event.preventDefault();
    const shift = delta / Math.max(active.laneWidth, 1) * duration;
    if (active.kind === 'key') active.targetFrame = Math.max(0, Math.min(end, Math.round((frameTime(active.sourceFrame, duration) + shift) * 30)));
    else { const bound = Math.max(0, Math.ceil(duration * 30) - 1) / 30; active.targetOffset = Math.max(-bound, Math.min(bound, Math.round((active.sourceOffset + shift) * 30) / 30)); }
    active.moved = true;
    setDrag({ ...active });
  }
  function seekLane(event: React.MouseEvent<HTMLDivElement>) {
    if (playing || suppressClick.current || event.target !== event.currentTarget) return;
    const rect = event.currentTarget.getBoundingClientRect();
    onFrame(Math.max(0, Math.min(end, Math.round((event.clientX - rect.left) / rect.width * duration * 30))));
  }
  function toggleGroup(id: string) { finishDrag(true); setExpandedGroups(previous => { const next = new Set(previous); if (next.has(id)) next.delete(id); else next.add(id); return next; }); }
  function renderRow(id: string, label: string, rowFrames: number[], scope: KeyframeTransferScope, options?: { selected?: boolean; child?: boolean; group?: boolean }) {
    return <div key={id} className={`kf-lane ${options?.selected ? 'selected' : ''} ${options?.child ? 'kf-joint-lane' : ''}`} data-track-id={id} aria-label={`${label}轨道`}>
      <div className="kf-lane-label">{options?.group ? <button className="kf-group-toggle" aria-label={`${expandedGroups.has(id) ? '收起' : '展开'}${label}轨道`} aria-expanded={expandedGroups.has(id)} onClick={() => toggleGroup(id)}><ChevronRight size={12} />{label}</button> : <span>{label}</span>}</div>
      <div className="kf-lane-track" data-frame-max={end} onClick={seekLane}>
        {rowFrames.map(keyFrame => { const moving = drag?.kind === 'key' && drag.rowId === id && drag.sourceFrame === keyFrame; const shownFrame = moving ? drag.targetFrame : keyFrame; return <button key={keyFrame} className={`kf-lane-key ${keyFrame === frame ? 'selected' : ''} ${moving && drag.moved ? 'dragging' : ''}`} data-frame={keyFrame} aria-label={`${label}第 ${keyFrame} 帧关键帧`} title={`${label} · 第 ${keyFrame} 帧 · 拖动移动`} style={{ left: `${frameTime(shownFrame, duration) / duration * 100}%` }} disabled={playing}
          onPointerDown={event => beginKeyDrag(event, id, scope, keyFrame)} onPointerMove={moveDrag} onPointerUp={event => { if (event.pointerId === dragRef.current?.pointerId) finishDrag(); }} onPointerCancel={() => finishDrag(true)} onLostPointerCapture={() => finishDrag(true)} onClick={event => { event.stopPropagation(); if (!suppressClick.current && !dragRef.current) onFrame(keyFrame); }}><Diamond size={12} fill="currentColor" />{moving && drag.moved && <span className="kf-drag-time">{shownFrame} 帧</span>}</button>; })}
        <span className="kf-row-playhead" style={{ left: `${frameTime(frame, duration) / duration * 100}%` }} aria-hidden="true" />
      </div>
    </div>;
  }
  const audioOffset = drag?.kind === 'audio' ? drag.targetOffset : audio?.offsetSeconds ?? 0;
  const tickStep = duration / zoom <= 8 ? 1 : duration / zoom <= 24 ? 2 : 5;
  const ticks = Array.from({ length: Math.floor(duration / tickStep) + 1 }, (_, i) => i * tickStep).filter(time => time < duration);
  const wave = useMemo(() => audio?.waveform.filter(Number.isFinite).slice(0, 160) ?? [], [audio?.waveform]);
  return <section className={`kf-timeline ${expanded ? '' : 'kf-collapsed'}`} aria-label="手动关键帧时间线">
    <div className="kf-timeline-toolbar">
      <div className="kf-timeline-transport">{props.transport}</div>
      <div className="kf-frame-controls"><button className="icon-button" aria-label="上一帧" disabled={frame === 0 || playing} onClick={() => onFrame(frame - 1)}><ChevronLeft size={15} /></button><label>帧<input aria-label="当前帧" type="number" min={0} max={end} step={1} value={frame} disabled={playing} onChange={event => { if (!event.target.value.trim()) return; const next = Number(event.target.value); if (Number.isFinite(next)) onFrame(Math.max(0, Math.min(end, Math.round(next)))); }} /></label><button className="icon-button" aria-label="下一帧" disabled={frame === end || playing} onClick={() => onFrame(frame + 1)}><ChevronRight size={15} /></button></div>
      <button className="button primary kf-record" aria-label="K 完整姿态" title="在当前帧记录完整姿态" disabled={locked} onClick={props.onWritePose}><Diamond size={14} fill={keyed ? 'currentColor' : 'none'} />{keyed ? '更新关键帧' : '添加关键帧'}</button>
      <button className="kf-collapse-button" aria-label={expanded ? '收起时间线' : '展开时间线'} aria-expanded={expanded} title={expanded ? '收起时间线' : '展开时间线'} onClick={() => { finishDrag(true); setExpanded(!expanded); }}>{expanded ? <ChevronDown size={17} /> : <ChevronUp size={17} />}</button>
      <details ref={moreDisclosure} className="kf-more" aria-label="更多编辑操作"><summary title="更多编辑操作">更多编辑操作</summary><div className="kf-more-popover">
    <div className="kf-timeline-controls"><label className="kf-filter-field"><span>操作范围</span><select aria-label="关键帧轨道筛选" value={filter} onChange={event => setFilter(event.target.value as typeof filter)}><option value="all">全部轨道</option><option value="joint">选中关节</option><option value="root">Root 位移</option></select></label><div className="kf-filter-status" aria-label="筛选轨道状态"><strong>{trackName}</strong><span>{trackStatus}</span></div><KeyNavigation frames={frames} frame={frame} playing={playing} onFrame={onFrame} timeline /></div>
<label className="kf-time-field">秒<input aria-label="当前时间（秒）" type="number" min={0} max={duration} step={1 / 30} value={Number(frameTime(frame, duration).toFixed(6))} disabled={playing} onChange={event => { if (!event.target.value.trim()) return; const next = Number(event.target.value); if (Number.isFinite(next)) props.onTime(Math.max(0, Math.min(duration, next))); }} /></label>
    {props.playbackOptions}
    <details className="kf-disclosure kf-key-details"><summary>关键帧明细</summary>{frames.length ? <div className="kf-key-list" role="list" aria-label="关键帧列表">{frames.map(keyFrame => {
      const tracks = rotationTracks.filter(([, keys]) => keys!.some(key => key.frame === keyFrame)).length, root = sequence.root.some(key => key.frame === keyFrame);
      const trackLabel = filter === 'joint' && selectedJoint ? `${STAGE_JOINT_LABELS[selectedJoint]}旋转` : filter === 'root' ? 'Root 位移' : `${tracks ? `${tracks} 旋转` : ''}${tracks && root ? ' + ' : ''}${root ? 'Root' : ''}`;
      return <button key={keyFrame} role="listitem" className={keyFrame === frame ? 'selected' : ''} aria-label={`第 ${keyFrame} 帧关键帧`} disabled={playing} onClick={() => onFrame(keyFrame)}><Diamond size={12} /><strong>{keyFrame} <small>帧</small></strong><span>{frameTime(keyFrame, duration).toFixed(3)} 秒</span><small>{trackLabel}</small></button>;
    })}</div> : <div className="kf-empty">{empty}</div>}</details>
    <div className="kf-more-actions">
      <div className="kf-disclosure-content kf-advanced-actions">
        <button className="button secondary compact" disabled={!editable || locked} onClick={props.onWriteJoint}><Diamond size={13} />K 当前关节</button>
        <button className="button secondary compact" disabled={locked} onClick={props.onWriteRoot}><Diamond size={13} />K 位移</button>
        <button className="kf-delete-button" disabled={!editable || !jointKeyed || locked} onClick={props.onDeleteJoint}><Trash2 size={13} />删除当前关节 K</button>
        <button className="kf-delete-button" disabled={!rootKeyed || locked} onClick={props.onDeleteRoot}><Trash2 size={13} />删除 Root K</button>
        <button className="kf-delete-button" disabled={!keyed || locked} onClick={props.onDelete}><Trash2 size={13} />删除当前帧关键帧</button>
        <button className="kf-neutral-button" disabled={locked} onClick={props.onNeutral}><RotateCcw size={13} />从站姿开始</button>
      </div>
      <details className="kf-disclosure kf-pose-reuse" aria-label="姿态复用">
        <summary>姿态复用</summary>
        <div className="kf-disclosure-content">
          <div className={`kf-clipboard-status ${props.clipboard ? 'ready' : ''}`} aria-label="已复制姿态" role="status">{props.clipboard ? `第 ${props.clipboard.frame} 帧 · ${props.clipboard.fromDraft ? '姿态草稿' : '动画姿态'}` : '未复制姿态'}</div>
          <button className="kf-pose-copy" disabled={locked} onClick={props.onCopyPose}><Copy size={13} aria-hidden="true" />复制当前姿态</button>
          <div className="kf-pose-paste-actions">
            <button disabled={!props.clipboard || locked} onClick={() => props.onPastePose(false)}><ClipboardPaste size={13} aria-hidden="true" />粘贴关节姿态</button>
            <button disabled={!props.clipboard || locked} onClick={() => props.onPastePose(true)}><ClipboardPaste size={13} aria-hidden="true" />粘贴姿态与位置</button>
          </div>
          <p>粘贴先成为草稿，写 K 后生效。关节姿态保留当前位置，姿态与位置同时复用。</p>
          <span className="kf-clipboard-note">内存暂存 · 切换场景或刷新后清空</span>
        </div>
      </details>
    </div>
    <details className="kf-disclosure kf-transfer-panel" aria-label="关键帧移动与复制">
      <summary>移动与复制关键帧</summary>
      <div className="kf-disclosure-content">
      <div className="kf-transfer-heading"><span>第 {frame} 帧 · {sourceKeyCount} 个显式 K · {trackName}</span></div>
      <div className="kf-transfer-controls"><label className="kf-transfer-destination"><span>目标帧</span><input type="number" data-modal-focus-fallback aria-label="关键帧目标帧" min={0} max={end} step={1} value={targetText} disabled={playing || mirror || readOnly} onChange={event => setTargetText(event.target.value)} /></label><div className="kf-transfer-actions"><button aria-label="复制当前范围关键帧" title={transferUnavailable ?? '保留源帧，将当前范围内的显式 K 复制到目标帧'} disabled={!!transferUnavailable} onClick={() => requestTransfer('copy')}><Copy size={14} aria-hidden="true" />复制到目标帧</button><button aria-label="移动当前范围关键帧" title={transferUnavailable ?? '移除源帧，将当前范围内的显式 K 移到目标帧'} disabled={!!transferUnavailable} onClick={() => requestTransfer('move')}><ArrowRight size={14} aria-hidden="true" />移动到目标帧</button></div></div>
      <p className="kf-transfer-status" aria-label="关键帧移动与复制状态" role="status">{transferUnavailable ?? `将本帧 ${sourceKeyCount} 个显式 K ${targetValid ? `放到第 ${targetFrame} 帧` : ''}；目标已有同轨 K 时先确认替换。`}</p>
      <span className="kf-transfer-note">仅处理已写入的键 · 按上方轨道范围操作 · 会改变相邻区间的插值 · 音乐与场景时长保持不变</span>
      </div>
    </details>
    <details className="kf-shortcuts"><summary>键盘快捷键</summary><div id="editor-shortcuts-help"><p>先聚焦舞台。输入框与按钮保留原有键盘操作。</p><dl><div><dt>← / →</dt><dd>上一帧 / 下一帧</dd></div><div><dt>空格</dt><dd>播放 / 暂停</dd></div><div><dt>K / Delete</dt><dd>记录 / 删除当前关节；移动工具作用于 Root，IK 记录完整姿态</dd></div><div><dt>Ctrl / ⌘ + Z</dt><dd>撤销；加 Shift 重做</dd></div></dl><p>播放时只响应空格；镜像、观看和对话框中不编辑。离开草稿需要确认。</p></div></details>
      </div></details>
    </div>
    {expanded && <div className="kf-lanes-viewport" aria-label="分轨时间线"><div className="kf-lanes" style={{ width: `calc(100% * ${zoom})` }}>
      <div className="kf-ruler-row"><div className="kf-lane-label kf-zoom-controls"><button aria-label="缩小时间线" disabled={zoom === 1} onClick={() => setZoom(value => Math.max(1, value / 2))}><Minus size={12} /></button><span>{zoom}×</span><button aria-label="放大时间线" disabled={zoom === 8} onClick={() => setZoom(value => Math.min(8, value * 2))}><Plus size={12} /></button></div><div className="kf-ruler"><div className="kf-ruler-ticks" aria-hidden="true">{ticks.map(time => <span key={time} style={{ left: `${time / duration * 100}%` }}>{time}s</span>)}<span className="kf-end-tick" style={{ left: '100%' }}>{duration.toFixed(duration % 1 ? 2 : 0)}s</span></div><input aria-label="关键帧时间线进度" type="range" min={0} max={end} step={1} value={frame} disabled={playing} onChange={event => onFrame(Number(event.target.value))} /><span className="kf-ruler-playhead" style={{ left: `${frameTime(frame, duration) / duration * 100}%` }} aria-hidden="true" /></div></div>
      <div className="kf-lane kf-audio-lane" data-track-id="audio" aria-label="音乐轨道"><div className="kf-lane-label"><Music2 size={12} /><span>音乐</span></div><div className="kf-lane-track kf-audio-content" data-frame-max={end} onClick={seekLane}>
        {audio && audio.durationSeconds > 0 ? <button className={`kf-audio-clip ${drag?.kind === 'audio' && drag.moved ? 'dragging' : ''}`} aria-label="移动音频片段" title={`${audio.name} · 拖动对齐音乐`} disabled={locked || audio.disabled} data-offset-seconds={audioOffset} data-duration-seconds={audio.durationSeconds} style={{ left: `${audioOffset / duration * 100}%`, width: `${audio.durationSeconds / duration * 100}%` }} onPointerDown={event => beginDrag(event, { kind: 'audio', sourceOffset: audio.offsetSeconds, targetOffset: audio.offsetSeconds })} onPointerMove={moveDrag} onPointerUp={event => { if (event.pointerId === dragRef.current?.pointerId) finishDrag(); }} onPointerCancel={() => finishDrag(true)} onLostPointerCapture={() => finishDrag(true)} onClick={event => event.stopPropagation()}>
          <svg className="kf-waveform" viewBox={`0 0 ${Math.max(wave.length, 1)} 24`} preserveAspectRatio="none" aria-hidden="true">{wave.map((value, index) => { const amplitude = Math.max(.5, Math.min(1, Math.abs(value)) * 11); return <line key={index} x1={index + .5} x2={index + .5} y1={12 - amplitude} y2={12 + amplitude} />; })}</svg><span className="kf-audio-name" style={{ left: `${Math.max(0, -audioOffset) / audio.durationSeconds * 100}%` }}>{drag?.kind === 'audio' && drag.moved ? `${audioOffset > 0 ? '+' : ''}${audioOffset.toFixed(3)} s` : audio.name}</span>
        </button> : <span className="kf-no-audio">未关联音乐</span>}
        <span className="kf-row-playhead" style={{ left: `${frameTime(frame, duration) / duration * 100}%` }} aria-hidden="true" />
      </div></div>
      {renderRow('root', '整体位移', sequence.root.map(key => key.frame), { kind: 'root' })}
      {groups.map(group => { const groupFrames = [...new Set(group.joints.flatMap(joint => (sequence.rotations[joint] ?? []).map(key => key.frame)))].sort((a, b) => a - b); return <div key={group.id} className="kf-track-group">{renderRow(group.id, group.label, groupFrames, { kind: 'joints', joints: group.joints }, { selected: selectedGroup?.id === group.id, group: true })}{expandedGroups.has(group.id) && group.joints.map(joint => renderRow(joint, STAGE_JOINT_LABELS[joint], (sequence.rotations[joint] ?? []).map(key => key.frame), { kind: 'joint', joint }, { selected: selectedJoint === joint, child: true }))}</div>; })}
    </div></div>}
    {props.dirty && <div className="kf-draft-note" role="status">姿态草稿 · 尚未写入关键帧<button disabled={locked} onClick={props.onDiscard}>撤回草稿</button></div>}
  </section>;
}
