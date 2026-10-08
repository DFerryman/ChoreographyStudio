import { useEffect, useMemo, useState } from 'react';
import { Quaternion, Vector3 } from 'three';
import { analyzePose, type MotionState } from '../../../packages/core/src/physics';
import { STANDARD_HUMAN_PROFILE } from '../../../packages/core/src/humanProfile';
import { lastFrame, type KeyframeSequence } from '../../../packages/core/src/keyframes';
import { evaluatePose } from '../../../packages/core/src/humanoid';
import { footLockWeight } from '../../../packages/core/src/footLocks';
import type { Pose } from '../../../packages/core/src/motion-types';
import './RealismPanel.css';

export interface RealismPanelProps {
  pose: Pose;
  sequence: KeyframeSequence;
  frame: number;
  duration: number;
  disabled: boolean;
  ikResidual?: number | null;
  motionState: MotionState;
  onLock: (foot: 'LeftFoot' | 'RightFoot', endFrame: number) => void;
  onRemoveLock: (id: string) => void;
  onPhysics: () => void;
  onCancel: () => void;
  simulating: boolean;
  progress: number;
}

const footName = (foot: 'LeftFoot' | 'RightFoot') => foot === 'LeftFoot' ? '左脚' : '右脚';

/** Optional context tools; physical configuration is supplied by the built-in profile. */
export function RealismPanel(props: RealismPanelProps) {
  const [open, setOpen] = useState(false);
  const [foot, setFoot] = useState<'LeftFoot' | 'RightFoot'>('LeftFoot');
  const end = lastFrame(props.duration);
  const [endFrame, setEndFrame] = useState(end);
  useEffect(() => { setEndFrame(end); }, [end, props.sequence.baseTake.id]);
  const analysis = useMemo(() => {
    if (!open) return { diagnostics: null, error: null };
    try { return { diagnostics: analyzePose(props.pose, { motionState: props.motionState }), error: null }; }
    catch (error) { return { diagnostics: null, error: error instanceof Error ? error.message : '当前姿态无法分析。' }; }
  }, [open, props.pose, props.motionState]);
  const diagnostics = analysis.diagnostics;
  const lockResiduals = useMemo(() => {
    if (!open || analysis.error || !props.sequence.footLocks?.length) return [];
    const world = evaluatePose(props.pose);
    return props.sequence.footLocks.flatMap(lock => {
      const weight = footLockWeight(lock, props.frame, end);
      if (weight <= 0) return [];
      const endpoint = world[lock.foot];
      const residual = new Vector3(...endpoint.position).distanceTo(new Vector3(...lock.target));
      const orientationDegrees = new Quaternion(...endpoint.rotation).angleTo(new Quaternion(...lock.rotation)) * 180 / Math.PI;
      return [{ id: lock.id, foot: lock.foot, residual, orientationDegrees, weight, reached: residual <= .005 && orientationDegrees <= 2 }];
    });
  }, [open, analysis.error, props.pose, props.sequence.footLocks, props.frame, end]);
  const unavailable = props.disabled || props.simulating;
  const intervalValid = Number.isInteger(endFrame) && endFrame > props.frame && endFrame <= end;
  const selectedFootContact = diagnostics?.feet[foot === 'LeftFoot' ? 'Left' : 'Right'];
  const canLockSupport = !!selectedFootContact?.grounded && selectedFootContact.minimumHeightMeters >= -STANDARD_HUMAN_PROFILE.ground.penetrationToleranceMeters;
  return <details className="realism-panel" onToggle={event => setOpen(event.currentTarget.open)}>
    <summary>真实约束</summary>
    {open && <div className="realism-content">
      <div className="realism-profile"><strong>标准中性人体 · {STANDARD_HUMAN_PROFILE.massKg} kg</strong><span>内置分段质量、质心、惯量与有限驱动</span><small>重力 {STANDARD_HUMAN_PROFILE.gravityMps2} m/s² · 摩擦 {STANDARD_HUMAN_PROFILE.ground.friction}</small></div>
      {props.ikResidual != null && <p className={props.ikResidual > .01 ? 'realism-warning' : 'realism-note'} aria-label="IK 目标残差">IK 目标残差 {(props.ikResidual * 100).toFixed(1)} cm</p>}
      {analysis.error && <p role="alert" className="realism-warning">{analysis.error}</p>}
      {diagnostics && <div className="realism-diagnostics" aria-label="人体接触与支撑诊断">
        <div><span>脚底高度</span><span aria-label="脚底离地高度">左 {(diagnostics.feet.Left.minimumHeightMeters * 100).toFixed(1)} / 右 {(diagnostics.feet.Right.minimumHeightMeters * 100).toFixed(1)} cm</span></div>
        <div><span>质心</span><span aria-label="人体质心">{diagnostics.centerOfMass.map(value => value.toFixed(2)).join(' · ')} m</span></div>
        <p className={diagnostics.balance === 'outside-support' ? 'realism-warning' : 'realism-note'} role="status">{diagnostics.balance === 'supported' ? '准静态质心位于支撑面内。' : diagnostics.balance === 'outside-support' ? '准静态支撑提示：质心投影位于支撑面外。' : diagnostics.balance === 'dynamic-unassessed' ? '动态动作：不使用站姿平衡判据。' : '飞行或无足接触：不使用站姿平衡判据。'}</p>
        {(diagnostics.floorPenetrations.length > 0 || diagnostics.selfCollisions.length > 0) && <p className="realism-warning" role="status">接触代理提示：穿地 {diagnostics.floorPenetrations.length} 处 · 身体穿插 {diagnostics.selfCollisions.length} 处</p>}
      </div>}
      <div className="realism-lock-fields">
        <label>支撑脚<select aria-label="脚锁部位" value={foot} disabled={unavailable} onChange={event => setFoot(event.target.value as typeof foot)}><option value="LeftFoot">左脚</option><option value="RightFoot">右脚</option></select></label>
        <label>结束帧<input aria-label="脚锁结束帧" type="number" min={Math.min(end, props.frame + 1)} max={end} step={1} value={endFrame} disabled={unavailable} onChange={event => { if (event.target.value.trim()) { const value = Number(event.target.value); if (Number.isFinite(value)) setEndFrame(Math.round(value)); } }} /></label>
      </div>
      <button className="button compact full" disabled={unavailable || !intervalValid || !canLockSupport} onClick={() => props.onLock(foot, endFrame)}>锁定支撑脚</button>
      {!canLockSupport && <p className="realism-note">先将这只脚落在地面，再锁定支撑。</p>}
      <p className="realism-note">从当前帧锁定到结束帧。脚锁保持脚底锚点；不可达位置仍会显示残差。</p>
      {lockResiduals.map(residual => <p key={residual.id} aria-label={`脚锁残差 ${footName(residual.foot)}`} className={!residual.reached && residual.weight > .999 ? 'realism-warning' : 'realism-note'}>{footName(residual.foot)}脚锁 · 位置 {(residual.residual * 100).toFixed(1)} cm · 朝向 {residual.orientationDegrees.toFixed(1)}° · {residual.weight < .999 ? `过渡 ${Math.round(residual.weight * 100)}%` : residual.reached ? '已到达' : '目标尚未到达'}</p>)}
      {props.sequence.footLocks?.length ? <ul className="realism-locks" aria-label="已保存脚锁">{props.sequence.footLocks.map(lock => <li key={lock.id}><span>{footName(lock.foot)} · {lock.startFrame}–{lock.endFrame} 帧</span><button aria-label={`解除脚锁 ${footName(lock.foot)} ${lock.startFrame}-${lock.endFrame}`} disabled={unavailable} onClick={() => props.onRemoveLock(lock.id)}>解除</button></li>)}</ul> : null}
      <div className="realism-physics">
        {props.simulating ? <><progress aria-label="重力模拟进度" max={1} value={Math.max(0, Math.min(1, props.progress))} /><button className="button compact full" onClick={props.onCancel}>取消模拟</button></> : <button className="button compact full" disabled={props.disabled} onClick={props.onPhysics}>生成重力候选</button>}
        <p className="realism-note">动态全身代理预览重力、接触和落地。采用候选后才修改作品。</p>
      </div>
    </div>}
  </details>;
}
