import type { AIMotionTarget } from '../../../../packages/core/src/aiMotion';
import { AI_MOTION_STATIC_WARNING, type AIMotionQuality } from '../../../../packages/core/src/aiMotionTrack';
import type { MotionFeasibilityReport } from '../../../../packages/core/src/motionFeasibility';

/** An AI candidate is previewed and adopted explicitly; the original stays authoritative until then. */
export function AssistCandidatePanel({ summary, target, quality, feasibility, limitations, maxHandAdaptationMeters, maxSoleAdaptationRadians, maxFootMarkerAdaptationMeters, maxFootAdaptationMeters, maxRetargetSoleRadians, endingAdaptationSeconds, previewing, valid, onTogglePreview, onAdopt, onClose }: {
  summary: string; target: AIMotionTarget; quality?: AIMotionQuality; feasibility?: MotionFeasibilityReport; limitations?: readonly string[]; maxHandAdaptationMeters?: number; maxSoleAdaptationRadians?: number; maxFootMarkerAdaptationMeters?: number; maxFootAdaptationMeters?: number; maxRetargetSoleRadians?: number; endingAdaptationSeconds?: number; previewing: boolean; valid: boolean;
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
      {feasibility && <small aria-label="动作约束检查" data-feasibility-status={feasibility.status} data-feasibility-profile={feasibility.profileId}>
        关节、身体碰撞与接触的简化模型检查通过。动作依据真人动捕编排，仍请预览确认。
      </small>}
      <details className="assist-candidate-details">
        <summary>适配量与检查范围{maxHandAdaptationMeters !== undefined && maxHandAdaptationMeters > .15 && ` · 手部 ${Math.round(maxHandAdaptationMeters * 100)} 厘米`}{maxFootAdaptationMeters !== undefined && maxFootAdaptationMeters > .03 && ` · 脚部 ${Math.round(maxFootAdaptationMeters * 100)} 厘米`}</summary>
      {feasibility && <small aria-label="动作约束范围">检查采用默认人物的简化身体模型，尚未验证其他人物皮肤及完整人体力量、关节动力学。</small>}
      {maxHandAdaptationMeters !== undefined && maxHandAdaptationMeters > .15 && <small aria-label="人体比例适配">
        人物适配时，手部位置最多调整约 {Math.round(maxHandAdaptationMeters * 100)} 厘米；后续检查还会微调，请预览确认动作幅度。
      </small>}
      {maxSoleAdaptationRadians !== undefined && maxSoleAdaptationRadians > Math.PI / 180 && <small aria-label="足部轨迹适配">
        足掌平滑时，方向最多调整约 {Math.round(maxSoleAdaptationRadians * 180 / Math.PI)}°，脚尖与脚跟位置最多调整约 {Math.round((maxFootMarkerAdaptationMeters ?? 0) * 100)} 厘米。
      </small>}
      {maxFootAdaptationMeters !== undefined && maxFootAdaptationMeters > .03 && <small aria-label="站姿适配">
        步态与收势适配时，脚部位置最多调整约 {Math.round(maxFootAdaptationMeters * 100)} 厘米，请预览确认步幅。
      </small>}
      {maxRetargetSoleRadians !== undefined && maxRetargetSoleRadians > Math.PI / 180 && <small aria-label="脚部朝向适配">
        人物与收势适配时，脚部世界朝向最多改变约 {Math.round(maxRetargetSoleRadians * 180 / Math.PI)}°。
      </small>}
      </details>
      {endingAdaptationSeconds !== undefined && <small aria-label="收势适配">末尾 {Number(endingAdaptationSeconds.toFixed(2))} 秒调整为稳定收势，请预览确认。</small>}
      {!!limitations?.length && <p className="assist-candidate-warning" role="status">描述仅部分满足：{limitations.join('；')}</p>}
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
