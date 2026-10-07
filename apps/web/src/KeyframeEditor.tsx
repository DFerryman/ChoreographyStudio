import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Diamond, RotateCcw, Trash2 } from 'lucide-react';
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
  onFrame: (frame: number) => void;
  onTime: (time: number) => void;
  onPose: (pose: Pose) => void;
  onWriteJoint: () => void;
  onWriteRoot: () => void;
  onWritePose: () => void;
  onDiscard: () => void;
  onDelete: () => void;
  onNeutral: () => void;
};

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
    {dirty && <div className="kf-draft-note" role="status">姿态草稿 · 尚未写入关键帧<button onClick={props.onDiscard}>撤回草稿</button></div>}
    {mirror && <div className="kf-readonly-note">镜像仅用于观看。点舞台「旋转」或「移动（整体）」关闭镜像并继续编辑；已有草稿会保留。</div>}
    {props.readOnly && <div className="kf-readonly-note">当前为观看状态。点舞台旋转或移动，回原稿编辑。</div>}
    {playing && <div className="kf-readonly-note">播放中暂停编辑。点舞台旋转或移动，暂停到当前帧。</div>}
    <div id="kf-rotation-controls" className={`kf-transform-group ${props.transformTool === 'rotate' ? 'kf-transform-active' : ''}`}><div className="kf-group-heading"><h3>局部旋转</h3><span>{selectedJoint ? STAGE_JOINT_LABELS[selectedJoint] : '请选择关节'}</span></div><p>{selectedJoint && !editable ? '末端节点只读；请选择肩、肘、髋等可旋转骨骼。' : props.transformTool === 'rotate' ? '拖动舞台旋转环，或填写 XYZ 角度（相对父骨骼）。' : '相对父骨骼 · XYZ 角度 · 舞台旋转工具可显示操作环'}</p>{(['X', 'Y', 'Z'] as const).map((axis, index) => <AxisField key={axis} prefix="关节" axis={axis} value={angles[index]} bounds={[-180, 180]} step={0.1} disabled={!editable || locked} onChange={value => updateRotation(index, value)} />)}<button className="button secondary compact full" disabled={!editable || locked} onClick={props.onWriteJoint}><Diamond size={13} />K 当前关节</button></div>
    <div id="kf-root-controls" className={`kf-transform-group ${props.transformTool === 'translate' ? 'kf-transform-active' : ''}`}><div className="kf-group-heading"><h3>Root 位移</h3><span>世界空间 · 米</span></div><p>{props.transformTool === 'translate' ? '拖动舞台 XYZ 箭头，或填写坐标；移动整个角色。' : '整体世界位置：X/Z ±5 m，Y 0–3 m；保持骨长。'}</p>{(['X', 'Y', 'Z'] as const).map((axis, index) => <AxisField key={axis} prefix="Root" axis={axis} value={pose.root[index]} bounds={[ROOT_TRANSLATION_LIMITS.x, ROOT_TRANSLATION_LIMITS.y, ROOT_TRANSLATION_LIMITS.z][index]} step={0.01} disabled={locked} onChange={value => updateRoot(index, value)} />)}<button className="button secondary compact full" disabled={locked} onClick={props.onWriteRoot}><Diamond size={13} />K 位移</button></div>
    <div className="kf-write-actions"><button className="button primary full" disabled={locked} onClick={props.onWritePose}><Diamond size={15} />K 完整姿态</button><span>记录本帧的 19 个局部旋转与 Root 位移</span><button className="kf-delete-button" disabled={!keyed || locked} onClick={props.onDelete}><Trash2 size={13} />删除当前帧关键帧</button></div>
    <button className="kf-neutral-button" disabled={locked} onClick={props.onNeutral}><RotateCcw size={13} />从站姿开始</button>
  </section>;
}

export function KeyframeTimeline({ sequence, frame, onFrame, playing }: { sequence: KeyframeSequence; frame: number; onFrame: (frame: number) => void; playing: boolean }) {
  const frames = useMemo(() => getKeyframeFrames(sequence), [sequence]), duration = sequence.baseTake.durationSeconds, end = lastFrame(duration);
  const rotationTracks = useMemo(() => Object.entries(sequence.rotations), [sequence]);
  return <section className="kf-timeline" aria-label="手动关键帧时间线"><div className="timeline-heading"><div className="module-title"><span className="module-index">30</span><h2>关键帧序列 <span>{frames.length} 个关键时刻</span></h2></div><span className="kf-timeline-duration">{duration.toFixed(3)} s · {end} 帧</span></div><div className="kf-track"><input aria-label="关键帧时间线进度" type="range" min={0} max={end} step={1} value={frame} disabled={playing} onChange={event => onFrame(Number(event.target.value))} /><div className="kf-markers">{frames.map(keyFrame => <button key={keyFrame} className={keyFrame === frame ? 'selected' : ''} aria-label={`跳到第 ${keyFrame} 帧关键帧`} title={`${keyFrame} 帧 · ${frameTime(keyFrame, duration).toFixed(3)} 秒`} style={{ left: `${keyFrame / end * 100}%` }} disabled={playing} onClick={() => onFrame(keyFrame)}><Diamond size={11} fill="currentColor" /></button>)}<span className="kf-playhead" style={{ left: `${frame / end * 100}%` }} /></div></div><div className="kf-track-labels"><span>0 帧</span><span>{frame} 帧 · {frameTime(frame, duration).toFixed(3)} 秒</span><span>{end} 帧</span></div>{frames.length ? <div className="kf-key-list" role="list" aria-label="关键帧列表">{frames.map(keyFrame => { const tracks = rotationTracks.filter(([, keys]) => keys!.some(key => key.frame === keyFrame)).length, root = sequence.root.some(key => key.frame === keyFrame); return <button key={keyFrame} role="listitem" className={keyFrame === frame ? 'selected' : ''} aria-label={`第 ${keyFrame} 帧关键帧`} disabled={playing} onClick={() => onFrame(keyFrame)}><Diamond size={12} /><strong>{keyFrame} <small>帧</small></strong><span>{frameTime(keyFrame, duration).toFixed(3)} 秒</span><small>{tracks ? `${tracks} 旋转` : ''}{tracks && root ? ' + ' : ''}{root ? 'Root' : ''}</small></button>; })}</div> : <div className="kf-empty">还没有手动关键帧。调整姿态后点击 K，将这一帧写入序列。</div>}<div className="kf-track-footer"><span>旋转使用四元数插值 · 位移使用线性插值</span><span>未写入的姿态草稿不进入播放或场景备份</span></div></section>;
}
