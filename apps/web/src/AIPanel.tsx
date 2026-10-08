import { useState } from 'react';
import { AI_PROMPT_MAX_LENGTH } from '../../../packages/core/src/aiChoreography';

export interface AIPanelProps {
  onGenerate: (prompt: string) => void;
  onCancel: () => void;
  busy: boolean;
  disabled: boolean;
  error?: string;
}

export default function AIPanel({ onGenerate, onCancel, busy, disabled, error }: AIPanelProps) {
  const [prompt, setPrompt] = useState('');
  return <details className="editor-disclosure ai-panel">
    <summary>AI 编排</summary>
    <div className="disclosure-content">
    <p className="form-note">描述想要的节奏和动作。AI 只接收文字与已确认数拍，音乐保留在本机。</p>
    <label className="field">动作描述
      <textarea aria-label="动作描述" rows={3} maxLength={AI_PROMPT_MAX_LENGTH}
        value={prompt} onChange={event => setPrompt(event.target.value)} disabled={busy || disabled}
        placeholder="例如：轻柔舒展，前半段侧向律动，最后自然收势" />
    </label>
    <p className="form-note">从现有六种原创动作安排顺序和幅度，生成后先预览，再决定是否采用。</p>
    <div className="button-row">
      <button className="button primary compact" type="button" onClick={() => onGenerate(prompt.trim())} disabled={busy || disabled || !prompt.trim()}>生成 AI 候选</button>
      {busy && <button className="button secondary compact" type="button" onClick={onCancel}>取消生成</button>}
    </div>
    {busy && <p role="status">正在生成编排候选…</p>}
    {error && <p className="form-error" role="alert">{error}</p>}
    </div>
  </details>;
}
