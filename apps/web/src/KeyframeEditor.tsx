import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ArrowRight, ChevronLeft, ChevronRight, ClipboardPaste, Copy, Diamond, RotateCcw, Trash2 } from 'lucide-react';
import { EDITABLE_JOINT_NAMES, ROOT_TRANSLATION_LIMITS, frameTime, getKeyframeFrames, lastFrame, rotationFromDegrees, type JointName, type KeyframeSequence, type KeyframeTransferRequest, type KeyframeTransferScope, type Pose, type Vec3 } from '../../../packages/core/src';
import { STAGE_JOINT_LABELS, type StageTransformTool } from './Stage';
import './KeyframeEditor.css';
import { constrainJointRotation, getJointRotationLimits, isJointRotationWithinLimits, jointRotationToDegrees } from '../../../packages/core/src';

export type KeyframeEditorProps = {
  sequence: KeyframeSequence;
  pose: Pose;
  frame: number;
  selectedJoint: JointName | null;
  playing: boolean;
  mirror: boolean;
  readOnly?: boolean;
  transformTool?: StageTransformTool;
  clipboard: { frame: number; fromDraft: boolean } | null;
  onPose: (pose: Pose) => void;
  onCopyPose: () => void;
  onPastePose: (includeRoot: boolean) => void;
};

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

function formatAxisValue(value: number, prefix: '关节' | 'Root'): string {
  const standard = value.toFixed(prefix === 'Root' ? 3 : 1);
  const precise = value.toFixed(prefix === 'Root' ? 9 : 6);
  // Keep familiar trailing decimals for ordinary values, while retaining
  // meaningful author precision without exposing quaternion round-off noise.
  return Number(precise) === Number(standard) ? standard : precise.replace(/\.?0+$/, '');
}

function AxisField({ prefix, axis, value, bounds, step, disabled, onChange }: {
  prefix: '关节' | 'Root'; axis: 'X' | 'Y' | 'Z'; value: number; bounds: readonly [number, number]; step: number; disabled: boolean; onChange: (value: number, source: 'slider' | 'number') => void;
}) {
  const [text, setText] = useState(formatAxisValue(value, prefix));
  const focused = useRef(false);
  useEffect(() => { if (!focused.current) setText(formatAxisValue(value, prefix)); }, [value, prefix]);
  const label = `${prefix} ${axis} ${prefix === 'Root' ? '位移（米）' : '旋转（度）'}`;
  const numberBounds = prefix === '关节' ? [-180, 180] as const : bounds;
  return <div className={`kf-axis kf-axis-${axis.toLowerCase()}`}>
    <span>{axis}</span>
    <input type="range" aria-label={`${prefix} ${axis} 滑条`} min={bounds[0]} max={bounds[1]} step={step} value={Math.max(bounds[0], Math.min(bounds[1], value))} disabled={disabled} onChange={event => onChange(Number(event.target.value), 'slider')} />
    <input type="number" aria-label={label} aria-describedby={prefix === '关节' && !disabled ? 'kf-authoring-note' : undefined} min={numberBounds[0]} max={numberBounds[1]} step={step} value={text} disabled={disabled} onFocus={() => { focused.current = true; }} onBlur={() => { focused.current = false; setText(formatAxisValue(value, prefix)); }} onChange={event => {
      const raw = event.target.value; setText(raw);
      if (!raw.trim()) return;
      const next = Number(raw);
      if (Number.isFinite(next)) onChange(Math.max(numberBounds[0], Math.min(numberBounds[1], next)), 'number');
    }} />
    <small>{prefix === 'Root' ? 'm' : '°'}</small>
  </div>;
}

export function KeyframeEditor(props: KeyframeEditorProps) {
  const { sequence, pose, frame, selectedJoint, playing, mirror } = props;
  const editable = selectedJoint !== null && EDITABLE_JOINT_NAMES.includes(selectedJoint);
  const locked = playing || mirror || props.readOnly === true;
  const angles: Vec3 = selectedJoint ? jointRotationToDegrees(selectedJoint, pose.joints[selectedJoint]) : [0, 0, 0];
  const rotationBounds = selectedJoint ? getJointRotationLimits(selectedJoint) : [[-180, 180], [-180, 180], [-180, 180]] as const;
  const outsideLimits = editable && selectedJoint !== null && !isJointRotationWithinLimits(selectedJoint, pose.joints[selectedJoint]);
  const jointKeys = selectedJoint ? sequence.rotations[selectedJoint] ?? [] : [];
  const jointKeyed = jointKeys.some(key => key.frame === frame);
  const rootKeyed = sequence.root.some(key => key.frame === frame);
  function updateRotation(axis: number, value: number, source: 'slider' | 'number') {
    if (!selectedJoint || !editable || locked) return;
    const next: Vec3 = [...angles]; next[axis] = value;
    const rotation = rotationFromDegrees(next);
    props.onPose({ ...pose, root: [...pose.root], joints: { ...pose.joints, [selectedJoint]: source === 'slider' ? constrainJointRotation(selectedJoint, rotation) : rotation } });
  }
  function updateRoot(axis: number, value: number) {
    if (locked) return;
    const root: Vec3 = [...pose.root]; root[axis] = value;
    props.onPose({ ...pose, root, joints: { ...pose.joints } });
  }
  return <section className="kf-editor" aria-label="手动关键帧编辑器">
    <div className="kf-heading"><div className="module-title"><h2>姿态调整</h2></div><span className="kf-state">舞台拖动 · 数值微调</span></div>
    {mirror && <div className="kf-readonly-note">镜像仅用于观看。点舞台「旋转」或「移动（整体）」关闭镜像并继续编辑；已有草稿会保留。</div>}
    {props.readOnly && <div className="kf-readonly-note">当前为观看状态。点舞台旋转或移动，回原稿编辑。</div>}
    {playing && <div className="kf-readonly-note">播放中暂停编辑。点舞台旋转或移动，暂停到当前帧。</div>}
    <div id="kf-rotation-controls" className={`kf-transform-group ${props.transformTool === 'rotate' ? 'kf-transform-active' : ''}`}>
      <div className="kf-group-heading"><h3 title="相对父骨骼 · XYZ 角度">局部旋转</h3><span>{editable ? '滑条为人体建议' : selectedJoint ? '只读末端' : '请选择关节'}</span></div>
      {!selectedJoint && <p>点击人物的关节点，在舞台上拖动摆姿。</p>}
      {selectedJoint && !editable && <p>末端节点只读；请选择肩、肘、髋等骨骼。</p>}
      {editable && <p id="kf-authoring-note">数值可设 ±180°，写 K 保留老师姿态。</p>}
      {outsideLimits && <p className="kf-constraint-note" role="status">超出标准人体建议，按老师设定保留；自动修正不会覆盖手 K。</p>}
      <div className={`kf-track-status ${jointKeyed ? 'keyed' : ''}`} aria-label="当前关节轨道状态">{!selectedJoint ? '未选关节' : !editable ? '末端节点只读 · 无可编辑旋转轨' : <><Diamond size={11} /><span>{jointKeyed ? '本帧已写旋转 K' : '本帧未写旋转 K'} · {jointKeys.length} 个键</span></>}</div>
      {selectedJoint && (['X', 'Y', 'Z'] as const).map((axis, index) => <AxisField key={axis} prefix="关节" axis={axis} value={angles[index]} bounds={rotationBounds[index]} step={0.1} disabled={!editable || locked} onChange={(value, source) => updateRotation(index, value, source)} />)}
    </div>
    <div id="kf-root-controls" className={`kf-transform-group ${props.transformTool === 'translate' ? 'kf-transform-active' : ''}`}>
      <div className="kf-group-heading"><h3 title="整体世界位置 · X/Z ±5 m · Y 0–3 m">Root 位移</h3><span>世界空间 · 米</span></div>
      <div className={`kf-track-status ${rootKeyed ? 'keyed' : ''}`} aria-label="Root 轨道状态"><Diamond size={11} /><span>{rootKeyed ? '本帧已写 Root K' : '本帧未写 Root K'} · {sequence.root.length} 个键</span></div>
      {(['X', 'Y', 'Z'] as const).map((axis, index) => <AxisField key={axis} prefix="Root" axis={axis} value={pose.root[index]} bounds={[ROOT_TRANSLATION_LIMITS.x, ROOT_TRANSLATION_LIMITS.y, ROOT_TRANSLATION_LIMITS.z][index]} step={0.01} disabled={locked} onChange={value => updateRoot(index, value)} />)}
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
      <p>粘贴先成为草稿，写 K 后生效。关节姿态保留当前位置，姿态与位置同时复用 Root。</p>
      <span className="kf-clipboard-note">内存暂存 · 切换场景或刷新后清空</span>
      </div>
    </details>
  </section>;
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
  const empty = filter === 'joint' ? !selectedJoint ? '请在舞台或列表选择关节，查看它的旋转关键帧。' : !editable ? '这个末端节点只读，没有可编辑旋转轨。请选择肩、肘、髋等骨骼。' : `${STAGE_JOINT_LABELS[selectedJoint]}尚无显式旋转 K，当前使用基底动画；写入「K 当前关节」后在此查看。` : filter === 'root' ? 'Root 尚无显式位移 K，当前使用基底动画；写入「K 位移」后在此查看。' : '还没有手动关键帧。调整姿态后点击 K，将这一帧写入序列。';
  return <section className="kf-timeline" aria-label="手动关键帧时间线">
    <div className="kf-timeline-transport">{props.transport}<button className="button primary kf-record" aria-label="K 完整姿态" title="在当前帧记录完整姿态，中间自动插帧；每次写入均可撤销" disabled={locked} onClick={props.onWritePose}><Diamond size={15} fill={keyed ? 'currentColor' : 'none'} />{keyed ? '更新关键帧' : '添加关键帧'}</button></div>
    <div className="timeline-heading"><div className="module-title"><h2>时间轴 <span>{frames.length} 个关键时刻</span></h2></div><span className="kf-timeline-duration">30 FPS · {duration.toFixed(3)} s</span></div>
    <div className="kf-frame-controls"><button className="icon-button" aria-label="上一帧" disabled={frame === 0 || playing} onClick={() => onFrame(frame - 1)}><ChevronLeft size={17} /></button><label>帧<input aria-label="当前帧" type="number" min={0} max={end} step={1} value={frame} disabled={playing} onChange={event => { if (!event.target.value.trim()) return; const next = Number(event.target.value); if (Number.isFinite(next)) onFrame(Math.max(0, Math.min(end, Math.round(next)))); }} /></label><button className="icon-button" aria-label="下一帧" disabled={frame === end || playing} onClick={() => onFrame(frame + 1)}><ChevronRight size={17} /></button><label className="kf-time-field">秒<input aria-label="当前时间（秒）" type="number" min={0} max={duration} step={1 / 30} value={Number(frameTime(frame, duration).toFixed(6))} disabled={playing} onChange={event => { if (!event.target.value.trim()) return; const next = Number(event.target.value); if (Number.isFinite(next)) props.onTime(Math.max(0, Math.min(duration, next))); }} /></label></div>
    <div className="kf-timeline-controls"><label className="kf-filter-field"><span>查看轨道</span><select aria-label="关键帧轨道筛选" value={filter} onChange={event => setFilter(event.target.value as typeof filter)}><option value="all">全部轨道</option><option value="joint">选中关节</option><option value="root">Root 位移</option></select></label><div className="kf-filter-status" aria-label="筛选轨道状态"><strong>{trackName}</strong><span>{trackStatus}</span></div><KeyNavigation frames={frames} frame={frame} playing={playing} onFrame={onFrame} timeline /></div>
    <div className="kf-track"><input aria-label="关键帧时间线进度" type="range" min={0} max={end} step={1} value={frame} disabled={playing} onChange={event => onFrame(Number(event.target.value))} /><div className="kf-markers">{frames.map(keyFrame => <button key={keyFrame} className={keyFrame === frame ? 'selected' : ''} aria-label={`跳到第 ${keyFrame} 帧关键帧`} title={`${keyFrame} 帧 · ${frameTime(keyFrame, duration).toFixed(3)} 秒`} style={{ left: `${keyFrame / end * 100}%` }} disabled={playing} onClick={() => onFrame(keyFrame)}><Diamond size={11} fill="currentColor" /></button>)}<span className="kf-playhead" style={{ left: `${frame / end * 100}%` }} /></div></div>
    <div className="kf-track-labels"><span>0 帧</span><span>{frame} 帧 · {frameTime(frame, duration).toFixed(3)} 秒</span><span>{end} 帧</span></div>
    {props.dirty && <div className="kf-draft-note" role="status">姿态草稿 · 尚未写入关键帧<button disabled={locked} onClick={props.onDiscard}>撤回草稿</button></div>}
    {!frames.length && <div className="kf-empty">{empty}</div>}
    {props.playbackOptions}
    <details className="kf-disclosure kf-key-details"><summary>关键帧明细</summary>{frames.length ? <div className="kf-key-list" role="list" aria-label="关键帧列表">{frames.map(keyFrame => {
      const tracks = rotationTracks.filter(([, keys]) => keys!.some(key => key.frame === keyFrame)).length, root = sequence.root.some(key => key.frame === keyFrame);
      const trackLabel = filter === 'joint' && selectedJoint ? `${STAGE_JOINT_LABELS[selectedJoint]}旋转` : filter === 'root' ? 'Root 位移' : `${tracks ? `${tracks} 旋转` : ''}${tracks && root ? ' + ' : ''}${root ? 'Root' : ''}`;
      return <button key={keyFrame} role="listitem" className={keyFrame === frame ? 'selected' : ''} aria-label={`第 ${keyFrame} 帧关键帧`} disabled={playing} onClick={() => onFrame(keyFrame)}><Diamond size={12} /><strong>{keyFrame} <small>帧</small></strong><span>{frameTime(keyFrame, duration).toFixed(3)} 秒</span><small>{trackLabel}</small></button>;
    })}</div> : <div className="kf-empty">{empty}</div>}</details>
    <details className="kf-disclosure kf-more-actions">
      <summary>更多编辑操作</summary>
      <div className="kf-disclosure-content kf-advanced-actions">
        <button className="button secondary compact" disabled={!editable || locked} onClick={props.onWriteJoint}><Diamond size={13} />K 当前关节</button>
        <button className="button secondary compact" disabled={locked} onClick={props.onWriteRoot}><Diamond size={13} />K 位移</button>
        <button className="kf-delete-button" disabled={!editable || !jointKeyed || locked} onClick={props.onDeleteJoint}><Trash2 size={13} />删除当前关节 K</button>
        <button className="kf-delete-button" disabled={!rootKeyed || locked} onClick={props.onDeleteRoot}><Trash2 size={13} />删除 Root K</button>
        <button className="kf-delete-button" disabled={!keyed || locked} onClick={props.onDelete}><Trash2 size={13} />删除当前帧关键帧</button>
        <button className="kf-neutral-button" disabled={locked} onClick={props.onNeutral}><RotateCcw size={13} />从站姿开始</button>
      </div>
    </details>
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
  </section>;
}
