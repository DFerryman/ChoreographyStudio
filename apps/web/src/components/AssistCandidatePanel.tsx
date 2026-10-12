import type { StepAssistanceReport } from '../../../../packages/core/src';
import { StepAssistanceSummary } from '../RealismPanel';

export type AssistCandidateView = { kind: 'ai' | 'physics' | 'steps'; summary: string; report?: StepAssistanceReport };

const TITLES = { steps: '步伐预览', ai: 'AI 编排候选', physics: '重力候选' };
const NOTES = {
  steps: '本地平地步伐计算；采用保留原关键帧、动作基底与脚锁。',
  ai: 'Workers AI 选择原创动作与幅度，姿态受关节限位；接触与物理仍需检查。',
  physics: '内置人体与 Rapier 动态代理；尚未经过教师或实测人体验证。',
};

/** A candidate is previewed and adopted explicitly; the original stays authoritative until then. */
export function AssistCandidatePanel({ candidate, previewing, valid, onTogglePreview, onAdopt, onClose }: {
  candidate: AssistCandidateView; previewing: boolean; valid: boolean;
  onTogglePreview: () => void; onAdopt: () => void; onClose: () => void;
}) {
  const steps = candidate.kind === 'steps', empty = steps && candidate.report?.stepCount === 0;
  return <section className="assist-candidate" aria-label={steps ? '步伐候选' : '辅助候选'}>
    <div>
      <strong>{TITLES[candidate.kind]}</strong>
      <p>{candidate.summary}</p>
      {steps && candidate.report && <StepAssistanceSummary report={candidate.report} label="步伐预览结果" />}
      <small>{NOTES[candidate.kind]}</small>
    </div>
    <div className="assist-actions">
      {!empty && <button className="button secondary compact" onClick={onTogglePreview}>{previewing ? '返回原稿' : '预览候选'}</button>}
      <button className="button primary compact" disabled={!valid || empty} onClick={onAdopt}>{steps ? '采用步伐' : '采用候选'}</button>
      <button className="text-button" onClick={onClose}>{steps ? '关闭预览' : '关闭候选'}</button>
    </div>
  </section>;
}
