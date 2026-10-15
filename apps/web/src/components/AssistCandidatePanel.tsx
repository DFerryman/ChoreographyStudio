import type { AIMotionTarget } from '../../../../packages/core/src/aiMotion';
import { AI_MOTION_STATIC_WARNING, type AIMotionQuality } from '../../../../packages/core/src/aiMotionTrack';
import type { MotionFeasibilityReport } from '../../../../packages/core/src/motionFeasibility';

/** An AI candidate is previewed and adopted explicitly; the original stays authoritative until then. */
export function AssistCandidatePanel({ summary, target, quality, feasibility, planSource, fallbackReason, intensity, moves, previewing, valid, onTogglePreview, onAdopt, onClose }: {
  summary: string; target: AIMotionTarget; quality?: AIMotionQuality; feasibility?: MotionFeasibilityReport;
  planSource: 'ai' | 'local'; fallbackReason?: string; intensity: number; moves: readonly string[]; previewing: boolean; valid: boolean;
  onTogglePreview: () => void; onAdopt: () => void; onClose: () => void;
}) {
  return <section className="assist-candidate" aria-label="AI 候选">
    <div className="assist-candidate-copy">
      <div className="assist-candidate-heading">
        <strong>AI 动作候选</strong>
        <small aria-label="候选目标区间">{target.mode === 'interval'
          ? `仅替换 ${Number(target.startSeconds.toFixed(2))}–${Number(target.endSeconds.toFixed(2))} 秒；两端与区间外保持。`
          : `替换整段 0–${Number(target.endSeconds.toFixed(2))} 秒人物动作。`} 原动作可撤销恢复。</small>
      </div>
      <p className="assist-candidate-summary" title={summary}>{summary}</p>
      {planSource === 'local' && <p className="assist-candidate-warning" role="status" aria-label="规划来源">
        {fallbackReason ? `${fallbackReason}，` : ''}本次由本地规则根据描述关键词规划动作。
      </p>}
      {feasibility && <small aria-label="动作约束检查" data-feasibility-status={feasibility.status} data-feasibility-profile={feasibility.profileId}>
        双脚着地与步伐、关节范围、身体碰撞和支撑受力的简化模型检查通过，仍请预览确认。
      </small>}
      <details className="assist-candidate-details">
        <summary>动作组成与检查范围{intensity < 1 && ` · 幅度 ${Math.round(intensity * 100)}%`}</summary>
        {!!moves.length && <small aria-label="动作组成">动作：{moves.join('、')}。</small>}
        {intensity < 1 && <small aria-label="幅度调整">为满足关节与受力约束，动作幅度降低到约 {Math.round(intensity * 100)}%。</small>}
        {!!feasibility?.inheritedBoundaryIssues && <small aria-label="端点原有问题">选区端点的原动作本身超出人体包络或存在穿插；仅端点附近容许不超过原有程度的同类问题。</small>}
        {feasibility && <small aria-label="动作约束范围">检查采用默认人物的简化身体模型，不代表完整人体力量或关节动力学验证。</small>}
      </details>
      {quality?.warnings.includes(AI_MOTION_STATIC_WARNING) && <p className="assist-candidate-warning" role="status">{AI_MOTION_STATIC_WARNING}</p>}
      {quality?.warnings.some(warning => warning !== AI_MOTION_STATIC_WARNING) && <p className="assist-candidate-warning" role="status">候选包含较急的移动或转动，先预览再决定是否采用。</p>}
      {!valid && <small role="status">作品已改变，请重新生成候选。</small>}
    </div>
    <div className="assist-actions">
      <button className="button secondary compact" onClick={onTogglePreview}>{previewing ? '返回原稿' : '预览候选'}</button>
      <button className="button primary compact" disabled={!valid} onClick={onAdopt}>采用候选</button>
      <button className="text-button" onClick={onClose}>关闭候选</button>
    </div>
  </section>;
}
