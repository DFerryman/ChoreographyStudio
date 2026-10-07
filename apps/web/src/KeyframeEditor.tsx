import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, ClipboardPaste, Copy, Diamond, RotateCcw, Trash2 } from 'lucide-react';
import { EDITABLE_JOINT_NAMES, ROOT_TRANSLATION_LIMITS, frameTime, getKeyframeFrames, lastFrame, rotationFromDegrees, rotationToDegrees, type JointName, type KeyframeSequence, type Pose, type Vec3 } from '../../../packages/core/src';
import { STAGE_JOINT_LABELS, type StageTransformTool } from './Stage';
import './KeyframeEditor.css';

export type KeyframeEditorProps = {
  sequence: KeyframeSequence;
  pose: Pose;
  frame: number;
  selectedJoint: JointName | null;
  dirty: boolean;
  playing: boolean;
  mirror: boolean;
  readOnly?: boolean;
  transformTool?: StageTransformTool;
  clipboard: { frame: number; fromDraft: boolean } | null;
  onFrame: (frame: number) => void;
  onTime: (time: number) => void;
  onPose: (pose: Pose) => void;
  onWriteJoint: () => void;
  onWriteRoot: () => void;
  onWritePose: () => void;
  onDiscard: () => void;
  onDelete: () => void;
  onDeleteJoint: () => void;
  onDeleteRoot: () => void;
  onNeutral: () => void;
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
    <button aria-label={timeline ? '时间线上一关键帧' : '上一关键帧'} disabled={playing || previous === undefined} onClick={() => { if (previous !== undefined) onFrame(previous); }}><ChevronLeft size={14} />上一关键帧</button>
    <button aria-label={timeline ? '时间线下一关键帧' : '下一关键帧'} disabled={playing || next === undefined} onClick={() => { if (next !== undefined) onFrame(next); }}>下一关键帧<ChevronRight size={14} /></button>
  </div>;
}

function AxisField({ prefix, axis, value, bounds, step, disabled, onChange }: {
  prefix: '关节' | 'Root'; axis: 'X' | 'Y' | 'Z'; value: number; bounds: readonly [number, number]; step: number; disabled: boolean; onChange: (value: number) => void;
}) {
  const [text, setText] = useState(value.toFixed(prefix === 'Root' ? 3 : 1));
  const focused = useRef(false);
  useEffect(() => { if (!focused.current) setText(value.toFixed(prefix === 'Root' ? 3 : 1)); }, [value, prefix]);
  const label = `${prefix} ${axis} ${prefix === 'Root' ? '位移（米）' : '旋转（度）'}`;
  return <div className={`kf-axis kf-axis-${axis.toLowerCase()}`}>
    <span>{axis}</span>
    <input type="range" aria-label={`${prefix} ${axis} 滑条`} min={bounds[0]} max={bounds[1]} step={step} value={Math.max(bounds[0], Math.min(bounds[1], value))} disabled={disabled} onChange={event => onChange(Number(event.target.value))} />
    <input type="number" aria-label={label} min={bounds[0]} max={bounds[1]} step={step} value={text} disabled={disabled} onFocus={() => { focused.current = true; }} onBlur={() => { focused.current = false; setText(value.toFixed(prefix === 'Root' ? 3 : 1)); }} onChange={event => {
      const raw = event.target.value; setText(raw);
      if (!raw.trim()) return;
      const next = Number(raw);
      if (Number.isFinite(next)) onChange(Math.max(bounds[0], Math.min(bounds[1], next)));
    }} />
    <small>{prefix === 'Root' ? 'm' : '°'}</small>
  </div>;
}

export function KeyframeEditor(props: KeyframeEditorProps) {
  const { sequence, pose, frame, selectedJoint, dirty, playing, mirror } = props;
  const duration = sequence.baseTake.durationSeconds;
  const end = lastFrame(duration), time = frameTime(frame, duration);
  const editable = selectedJoint !== null && EDITABLE_JOINT_NAMES.includes(selectedJoint);
  const locked = playing || mirror || props.readOnly === true;
  const angles: Vec3 = selectedJoint ? rotationToDegrees(pose.joints[selectedJoint]) : [0, 0, 0];
  const keyFrames = useMemo(() => getKeyframeFrames(sequence), [sequence]);
  const keyed = keyFrames.includes(frame);
  const jointKeys = selectedJoint ? sequence.rotations[selectedJoint] ?? [] : [];
  const jointKeyed = jointKeys.some(key => key.frame === frame);
  const rootKeyed = sequence.root.some(key => key.frame === frame);
  function updateRotation(axis: number, value: number) {
    if (!selectedJoint || !editable || locked) return;
    const next: Vec3 = [...angles]; next[axis] = value;
    props.onPose({ ...pose, root: [...pose.root], joints: { ...pose.joints, [selectedJoint]: rotationFromDegrees(next) } });
  }
  function updateRoot(axis: number, value: number) {
    if (locked) return;
    const root: Vec3 = [...pose.root]; root[axis] = value;
    props.onPose({ ...pose, root, joints: { ...pose.joints } });
  }
  return <section className="kf-editor" aria-label="手动关键帧编辑器">
    <div className="kf-heading"><div className="module-title"><span className="module-index">K</span><h2>手动 K帧</h2></div><span className={`kf-state ${dirty ? 'draft' : ''}`}>{dirty ? '未写入草稿' : playing ? '播放中' : '编辑姿态'}</span></div>
    <div className="kf-frame-controls"><button className="icon-button" aria-label="上一帧" disabled={frame === 0 || playing} onClick={() => props.onFrame(frame - 1)}><ChevronLeft size={17} /></button><label>帧<input aria-label="当前帧" type="number" min={0} max={end} step={1} value={frame} disabled={playing} onChange={event => { const next = Number(event.target.value); if (Number.isFinite(next)) props.onFrame(Math.max(0, Math.min(end, Math.round(next)))); }} /></label><button className="icon-button" aria-label="下一帧" disabled={frame === end || playing} onClick={() => props.onFrame(frame + 1)}><ChevronRight size={17} /></button><label className="kf-time-field">秒<input aria-label="当前时间（秒）" type="number" min={0} max={duration} step={1 / 30} value={Number(time.toFixed(6))} disabled={playing} onChange={event => { const next = Number(event.target.value); if (Number.isFinite(next)) props.onTime(Math.max(0, Math.min(duration, next))); }} /></label></div>
    <div className="kf-frame-note"><span>30 FPS · 0–{end} 帧</span><span>{keyed ? '本帧已有关键帧' : '本帧没有关键帧'}</span></div>
    <KeyNavigation frames={keyFrames} frame={frame} playing={playing} onFrame={props.onFrame} />
    <span className="kf-navigation-note">跳转全部轨道中已写入的关键帧</span>
    {dirty && <div className="kf-draft-note" role="status">姿态草稿 · 尚未写入关键帧<button disabled={locked} onClick={props.onDiscard}>撤回草稿</button></div>}
    {mirror && <div className="kf-readonly-note">镜像仅用于观看。点舞台「旋转」或「移动（整体）」关闭镜像并继续编辑；已有草稿会保留。</div>}
    {props.readOnly && <div className="kf-readonly-note">当前为观看状态。点舞台旋转或移动，回原稿编辑。</div>}
    {playing && <div className="kf-readonly-note">播放中暂停编辑。点舞台旋转或移动，暂停到当前帧。</div>}
    <section className="kf-pose-reuse" aria-label="姿态复用">
      <div className="kf-group-heading"><h3>姿态复用</h3><span>仅当前场景</span></div>
      <div className={`kf-clipboard-status ${props.clipboard ? 'ready' : ''}`} aria-label="已复制姿态" role="status">{props.clipboard ? `第 ${props.clipboard.frame} 帧 · ${props.clipboard.fromDraft ? '姿态草稿' : '动画姿态'}` : '未复制姿态'}</div>
      <button className="kf-pose-copy" disabled={locked} onClick={props.onCopyPose}><Copy size={13} aria-hidden="true" />复制当前姿态</button>
      <div className="kf-pose-paste-actions">
        <button disabled={!props.clipboard || locked} onClick={() => props.onPastePose(false)}><ClipboardPaste size={13} aria-hidden="true" />粘贴关节姿态</button>
        <button disabled={!props.clipboard || locked} onClick={() => props.onPastePose(true)}><ClipboardPaste size={13} aria-hidden="true" />粘贴姿态与位置</button>
      </div>
      <p>粘贴先成为草稿，写 K 后生效。关节姿态保留当前位置，姿态与位置同时复用 Root。</p>
      <span className="kf-clipboard-note">内存暂存 · 切换场景或刷新后清空</span>
    </section>
    <div id="kf-rotation-controls" className={`kf-transform-group ${props.transformTool === 'rotate' ? 'kf-transform-active' : ''}`}>
      <div className="kf-group-heading"><h3>局部旋转</h3><span>{selectedJoint ? STAGE_JOINT_LABELS[selectedJoint] : '请选择关节'}</span></div>
      <p>{selectedJoint && !editable ? '末端节点只读；请选择肩、肘、髋等可旋转骨骼。' : props.transformTool === 'rotate' ? '拖动舞台旋转环，或填写 XYZ 角度（相对父骨骼）。' : '相对父骨骼 · XYZ 角度 · 舞台旋转工具可显示操作环'}</p>
      <div className={`kf-track-status ${jointKeyed ? 'keyed' : ''}`} aria-label="当前关节轨道状态">{!selectedJoint ? '未选关节 · 请在舞台或列表选择' : !editable ? '末端节点只读 · 无可编辑旋转轨' : <><Diamond size={11} /><span>{jointKeyed ? '本帧已写旋转 K' : '本帧未写旋转 K'} · {jointKeys.length} 个显式键{!jointKeys.length && ' · 使用基底动画'}</span></>}</div>
      {(['X', 'Y', 'Z'] as const).map((axis, index) => <AxisField key={axis} prefix="关节" axis={axis} value={angles[index]} bounds={[-180, 180]} step={0.1} disabled={!editable || locked} onChange={value => updateRotation(index, value)} />)}
      <div className="kf-track-actions"><button className="button secondary compact" disabled={!editable || locked} onClick={props.onWriteJoint}><Diamond size={13} />K 当前关节</button><button className="kf-delete-button" disabled={!editable || !jointKeyed || locked} onClick={props.onDeleteJoint}><Trash2 size={13} />删除当前关节 K</button></div>
    </div>
    <div id="kf-root-controls" className={`kf-transform-group ${props.transformTool === 'translate' ? 'kf-transform-active' : ''}`}>
      <div className="kf-group-heading"><h3>Root 位移</h3><span>世界空间 · 米</span></div>
      <p>{props.transformTool === 'translate' ? '拖动舞台 XYZ 箭头，或填写坐标；移动整个角色。' : '整体世界位置：X/Z ±5 m，Y 0–3 m；保持骨长。'}</p>
      <div className={`kf-track-status ${rootKeyed ? 'keyed' : ''}`} aria-label="Root 轨道状态"><Diamond size={11} /><span>{rootKeyed ? '本帧已写 Root K' : '本帧未写 Root K'} · {sequence.root.length} 个显式键{!sequence.root.length && ' · 使用基底动画'}</span></div>
      {(['X', 'Y', 'Z'] as const).map((axis, index) => <AxisField key={axis} prefix="Root" axis={axis} value={pose.root[index]} bounds={[ROOT_TRANSLATION_LIMITS.x, ROOT_TRANSLATION_LIMITS.y, ROOT_TRANSLATION_LIMITS.z][index]} step={0.01} disabled={locked} onChange={value => updateRoot(index, value)} />)}
      <div className="kf-track-actions"><button className="button secondary compact" disabled={locked} onClick={props.onWriteRoot}><Diamond size={13} />K 位移</button><button className="kf-delete-button" disabled={!rootKeyed || locked} onClick={props.onDeleteRoot}><Trash2 size={13} />删除 Root K</button></div>
    </div>
    <div className="kf-write-actions"><button className="button primary full" disabled={locked} onClick={props.onWritePose}><Diamond size={15} />K 完整姿态</button><span>记录本帧的 19 个局部旋转与 Root 位移</span><button className="kf-delete-button" disabled={!keyed || locked} onClick={props.onDelete}><Trash2 size={13} />删除当前帧关键帧</button><span className="kf-delete-note">移除本帧全部关节与 Root 的显式键</span></div>
    <button className="kf-neutral-button" disabled={locked} onClick={props.onNeutral}><RotateCcw size={13} />从站姿开始</button>
  </section>;
}

export function KeyframeTimeline({ sequence, frame, selectedJoint, onFrame, playing }: { sequence: KeyframeSequence; frame: number; selectedJoint: JointName | null; onFrame: (frame: number) => void; playing: boolean }) {
  const [filter, setFilter] = useState<'all' | 'joint' | 'root'>('all');
  const editable = selectedJoint !== null && EDITABLE_JOINT_NAMES.includes(selectedJoint);
  const frames = useMemo(() => {
    if (filter === 'root') return sequence.root.map(key => key.frame);
    if (filter === 'joint') return selectedJoint && editable ? (sequence.rotations[selectedJoint] ?? []).map(key => key.frame) : [];
    return getKeyframeFrames(sequence);
  }, [sequence, filter, selectedJoint, editable]);
  const duration = sequence.baseTake.durationSeconds, end = lastFrame(duration);
  const rotationTracks = useMemo(() => Object.entries(sequence.rotations), [sequence]);
  const trackName = filter === 'root' ? 'Root 位移' : filter === 'joint' ? selectedJoint ? `${STAGE_JOINT_LABELS[selectedJoint]} · 局部旋转` : '未选关节' : '全部轨道';
  const trackStatus = filter === 'joint' && !editable ? selectedJoint ? '末端节点只读' : '请选择关节' : `${frames.includes(frame) ? '本帧已写 K' : '本帧未写 K'} · ${frames.length} 个关键时刻`;
  const empty = filter === 'joint' ? !selectedJoint ? '请在舞台或列表选择关节，查看它的旋转关键帧。' : !editable ? '这个末端节点只读，没有可编辑旋转轨。请选择肩、肘、髋等骨骼。' : `${STAGE_JOINT_LABELS[selectedJoint]}尚无显式旋转 K，当前使用基底动画；写入「K 当前关节」后在此查看。` : filter === 'root' ? 'Root 尚无显式位移 K，当前使用基底动画；写入「K 位移」后在此查看。' : '还没有手动关键帧。调整姿态后点击 K，将这一帧写入序列。';
  return <section className="kf-timeline" aria-label="手动关键帧时间线">
    <div className="timeline-heading"><div className="module-title"><span className="module-index">30</span><h2>关键帧序列 <span>{frames.length} 个关键时刻</span></h2></div><span className="kf-timeline-duration">{duration.toFixed(3)} s · {end} 帧</span></div>
    <div className="kf-timeline-controls"><label className="kf-filter-field"><span>查看轨道</span><select aria-label="关键帧轨道筛选" value={filter} onChange={event => setFilter(event.target.value as typeof filter)}><option value="all">全部轨道</option><option value="joint">选中关节</option><option value="root">Root 位移</option></select></label><div className="kf-filter-status" aria-label="筛选轨道状态"><strong>{trackName}</strong><span>{trackStatus}</span></div><KeyNavigation frames={frames} frame={frame} playing={playing} onFrame={onFrame} timeline /></div>
    <div className="kf-track"><input aria-label="关键帧时间线进度" type="range" min={0} max={end} step={1} value={frame} disabled={playing} onChange={event => onFrame(Number(event.target.value))} /><div className="kf-markers">{frames.map(keyFrame => <button key={keyFrame} className={keyFrame === frame ? 'selected' : ''} aria-label={`跳到第 ${keyFrame} 帧关键帧`} title={`${keyFrame} 帧 · ${frameTime(keyFrame, duration).toFixed(3)} 秒`} style={{ left: `${keyFrame / end * 100}%` }} disabled={playing} onClick={() => onFrame(keyFrame)}><Diamond size={11} fill="currentColor" /></button>)}<span className="kf-playhead" style={{ left: `${frame / end * 100}%` }} /></div></div>
    <div className="kf-track-labels"><span>0 帧</span><span>{frame} 帧 · {frameTime(frame, duration).toFixed(3)} 秒</span><span>{end} 帧</span></div>
    {frames.length ? <div className="kf-key-list" role="list" aria-label="关键帧列表">{frames.map(keyFrame => {
      const tracks = rotationTracks.filter(([, keys]) => keys!.some(key => key.frame === keyFrame)).length, root = sequence.root.some(key => key.frame === keyFrame);
      const trackLabel = filter === 'joint' && selectedJoint ? `${STAGE_JOINT_LABELS[selectedJoint]}旋转` : filter === 'root' ? 'Root 位移' : `${tracks ? `${tracks} 旋转` : ''}${tracks && root ? ' + ' : ''}${root ? 'Root' : ''}`;
      return <button key={keyFrame} role="listitem" className={keyFrame === frame ? 'selected' : ''} aria-label={`第 ${keyFrame} 帧关键帧`} disabled={playing} onClick={() => onFrame(keyFrame)}><Diamond size={12} /><strong>{keyFrame} <small>帧</small></strong><span>{frameTime(keyFrame, duration).toFixed(3)} 秒</span><small>{trackLabel}</small></button>;
    })}</div> : <div className="kf-empty">{empty}</div>}
    <div className="kf-track-footer"><span>仅显示显式键 · 隐式基底端点不计入列表</span><span>旋转四元数插值 · 位移线性插值 · 草稿未写入</span></div>
  </section>;
}
