import type { AIMotionTarget } from '../../../../packages/core/src/aiMotion';
import { AI_MOTION_STATIC_WARNING, type AIMotionQuality } from '../../../../packages/core/src/aiMotionTrack';

/** An AI candidate is previewed and adopted explicitly; the original stays authoritative until then. */
export function AssistCandidatePanel({ summary, target, quality, previewing, valid, onTogglePreview, onAdopt, onClose }: {
  summary: string; target: AIMotionTarget; quality?: AIMotionQuality; previewing: boolean; valid: boolean;
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
