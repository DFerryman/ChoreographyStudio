/** An AI candidate is previewed and adopted explicitly; the original stays authoritative until then. */
export function AssistCandidatePanel({ summary, previewing, valid, onTogglePreview, onAdopt, onClose }: {
  summary: string; previewing: boolean; valid: boolean;
  onTogglePreview: () => void; onAdopt: () => void; onClose: () => void;
}) {
  return <section className="assist-candidate" aria-label="AI 候选">
    <div>
      <strong>AI 动作候选</strong>
      <p>{summary}</p>
      <small>Workers AI 选择原创动作与幅度，姿态受关节限位；碰撞与接触由预览自动处理。</small>
    </div>
    <div className="assist-actions">
      <button className="button secondary compact" onClick={onTogglePreview}>{previewing ? '返回原稿' : '预览候选'}</button>
      <button className="button primary compact" disabled={!valid} onClick={onAdopt}>采用候选</button>
      <button className="text-button" onClick={onClose}>关闭候选</button>
    </div>
  </section>;
}
