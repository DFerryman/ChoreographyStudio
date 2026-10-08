import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Quaternion, Vector3 } from 'three';
import { analyzePose, type MotionState } from '../../../packages/core/src/physics';
import { STANDARD_HUMAN_PROFILE } from '../../../packages/core/src/humanProfile';
import { lastFrame, type KeyframeSequence } from '../../../packages/core/src/keyframes';
import { evaluatePose } from '../../../packages/core/src/humanoid';
import { footLockWeight } from '../../../packages/core/src/footLocks';
import type { Pose } from '../../../packages/core/src/motion-types';
import { getPoseGuidance } from './poseGuidance';
import { STAGE_JOINT_LABELS } from './Stage';
import './RealismPanel.css';
import type { StepAssistanceReport } from '../../../packages/core/src';

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
  stepReport: StepAssistanceReport | null;
  onSteps: () => void;
  onRemoveSteps: () => void;
  calculatingSteps: boolean;
  stepCandidate?: ReactNode;
}

const footName = (foot: 'LeftFoot' | 'RightFoot') => foot === 'LeftFoot' ? '左脚' : '右脚';

/** Results are calculated on sequence changes, never on each playback frame. */
export function StepAssistanceSummary({ report, label = '自动步伐状态' }: { report: StepAssistanceReport; label?: string }) {
  // A stationary interval needs no steps; it is not an unsupported motion.
  const stationary = new Set(report.issues.filter(issue => issue.code === 'stationary').map(issue => `${issue.startFrame}:${issue.endFrame}`));
  const skipped = report.segments.filter(segment => segment.status === 'skipped' && !stationary.has(`${segment.startFrame}:${segment.endFrame}`));
  const issues = report.issues.filter(issue => issue.code !== 'stationary');
  return <div className="realism-step-report" aria-label={label}>
    <p className="realism-note">{report.stepCount} 步 · 支撑残差 {(report.maxStanceResidualMeters * 100).toFixed(1)} cm · 朝向 {(report.maxOrientationResidualRadians * 180 / Math.PI).toFixed(1)}°</p>
    {report.maxRootLoweringMeters > .001 && <p className="realism-note">步伐间轻微屈身，最多 {(report.maxRootLoweringMeters * 100).toFixed(1)} cm。</p>}
    {skipped.length > 0 && <p className="realism-warning">跳过区间：{skipped.map(segment => `${segment.startFrame}–${segment.endFrame} 帧`).join('、')}。</p>}
    {issues.length > 0 && <ul className="realism-step-issues" aria-label="步伐跳过原因">{issues.map((issue, index) => <li key={`${issue.code}-${issue.startFrame}-${issue.endFrame}-${index}`}>{issue.startFrame}–{issue.endFrame} 帧：{issue.message}</li>)}</ul>}
    {report.stepCount === 0 && <p className="realism-note">当前没有可自动迈步的平地位移区间。</p>}
  </div>;
}

/** Optional context tools; physical configuration is supplied by the built-in profile. */
export function RealismPanel(props: RealismPanelProps) {
  const [open, setOpen] = useState(false);
  const [foot, setFoot] = useState<'LeftFoot' | 'RightFoot'>('LeftFoot');
  const end = lastFrame(props.duration);
  const [endFrame, setEndFrame] = useState(end);
  const poseGuidance = useMemo(() => getPoseGuidance(props.pose), [props.pose]);
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
  const unavailable = props.disabled || props.simulating || props.calculatingSteps;
  const intervalValid = Number.isInteger(endFrame) && endFrame > props.frame && endFrame <= end;
  const selectedFootContact = diagnostics?.feet[foot === 'LeftFoot' ? 'Left' : 'Right'];
  const canLockSupport = !!selectedFootContact?.grounded && selectedFootContact.minimumHeightMeters >= -STANDARD_HUMAN_PROFILE.ground.penetrationToleranceMeters;
  return <details className="realism-panel" onToggle={event => setOpen(event.currentTarget.open)}>
    <summary aria-label="真实约束"><span>真实约束</span>{props.sequence.steps && <span> · 自动步伐</span>}{poseGuidance.outsideSuggestedRange.length > 0 && <span className="realism-warning" aria-label="关节超限数量"> · {poseGuidance.outsideSuggestedRange.length} 处超出建议</span>}{poseGuidance.shoulderCoupling.length > 0 && <span className="realism-warning"> · 肩部需配合</span>}</summary>
    {open && <div className="realism-content">
      <div className="realism-steps">
        <div className="realism-step-heading"><strong>自动步伐</strong>{props.sequence.steps && <button className="text-button" disabled={unavailable} onClick={props.onRemoveSteps}>关闭自动步伐</button>}</div>
        <p className="realism-note">位移 K 之间自动迈步；老师 K 优先，脚锁高于自动步伐。</p>
        <button className="button compact full" disabled={unavailable} onClick={props.onSteps}>{props.calculatingSteps ? '正在计算步伐' : '预览步伐'}</button>
        {props.stepCandidate}
        {props.stepReport && <StepAssistanceSummary report={props.stepReport} />}
        <p className="realism-note">适用于平地小范围移动。过快、悬空、转身或脚锁冲突会提示跳过；不是全身动力学模拟。</p>
      </div>
      <div className="realism-profile"><strong>标准中性人体 · {STANDARD_HUMAN_PROFILE.massKg} kg</strong><span>内置分段质量、质心、惯量与有限驱动</span><small>重力 {STANDARD_HUMAN_PROFILE.gravityMps2} m/s² · 摩擦 {STANDARD_HUMAN_PROFILE.ground.friction}</small></div>
      {poseGuidance.outsideSuggestedRange.length > 0 && <p className="realism-warning" aria-label="全身关节超限部位">超出建议：{poseGuidance.outsideSuggestedRange.map(joint => STAGE_JOINT_LABELS[joint]).join('、')}。按老师原姿态保留，请检查这些部位的动作幅度。</p>}
      {poseGuidance.shoulderCoupling.length > 0 && <p className="realism-warning" aria-label="肩部配合检查">大幅举臂请配合{poseGuidance.shoulderCoupling.map(side => side === 'Left' ? '左侧' : '右侧').join('、')}肩部，关键帧按老师原姿态保留。</p>}
      <p className="realism-note">还需结合肩部配合、身体接触与动态支撑检查动作可行性。</p>
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
      <p className="realism-note">从当前帧锁定到结束帧。手动姿态与关键帧优先，脚锁冲突时显示残差。</p>
      {lockResiduals.map(residual => <p key={residual.id} aria-label={`脚锁残差 ${footName(residual.foot)}`} className={!residual.reached && residual.weight > .999 ? 'realism-warning' : 'realism-note'}>{footName(residual.foot)}脚锁 · 位置 {(residual.residual * 100).toFixed(1)} cm · 朝向 {residual.orientationDegrees.toFixed(1)}° · {residual.weight < .999 ? `过渡 ${Math.round(residual.weight * 100)}%` : residual.reached ? '已到达' : '目标尚未到达'}</p>)}
      {props.sequence.footLocks?.length ? <ul className="realism-locks" aria-label="已保存脚锁">{props.sequence.footLocks.map(lock => <li key={lock.id}><span>{footName(lock.foot)} · {lock.startFrame}–{lock.endFrame} 帧</span><button aria-label={`解除脚锁 ${footName(lock.foot)} ${lock.startFrame}-${lock.endFrame}`} disabled={unavailable} onClick={() => props.onRemoveLock(lock.id)}>解除</button></li>)}</ul> : null}
      <div className="realism-physics">
        {props.simulating ? <><progress aria-label="重力模拟进度" max={1} value={Math.max(0, Math.min(1, props.progress))} /><button className="button compact full" onClick={props.onCancel}>取消模拟</button></> : <button className="button compact full" disabled={props.disabled} onClick={props.onPhysics}>生成重力候选</button>}
        <p className="realism-note">动态全身代理预览重力、接触和落地。采用候选后才修改作品。</p>
      </div>
    </div>}
  </details>;
}
