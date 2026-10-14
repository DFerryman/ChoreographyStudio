import { useState } from 'react';
import { AI_MOTION_PROMPT_MAX_LENGTH } from '../../../packages/core/src/aiMotion';
import type { TimelineRange } from './Timeline';
import { DEFAULT_MOTION_CREATION_MODE, evaluateMotionCreationPolicy, type MotionCreationMode } from './motionCreationPolicy';

export interface AIPanelProps {
  onGenerate: (prompt: string, mode: MotionCreationMode) => void;
  onCancel: () => void;
  busy: boolean;
  disabled: boolean;
  range: TimelineRange | null;
  duration: number;
  error?: string;
}

const seconds = (value: number) => `${Number(value.toFixed(2))} 秒`;

/** Creating material and arranging recordings are explicit separate operations. */
export default function AIPanel({ onGenerate, onCancel, busy, disabled, range, duration, error }: AIPanelProps) {
  const [prompt, setPrompt] = useState('');
  const [mode, setMode] = useState<MotionCreationMode>(DEFAULT_MOTION_CREATION_MODE);
  const policy = evaluateMotionCreationPolicy({ mode });
  const arranging = mode === 'arrange-existing';
  return <div className="ai-panel">
    <strong className="ai-panel-title">{arranging ? '编排已有动作素材' : '创作新动作素材'}</strong>
    <div className="ai-source-mode" role="radiogroup" aria-label="动作来源">
      <label><input type="radio" name="motion-creation-mode" checked={!arranging} disabled={busy} onChange={() => setMode('create')} /> 创作新动作</label>
      <label><input type="radio" name="motion-creation-mode" checked={arranging} disabled={busy} onChange={() => setMode('arrange-existing')} /> 编排已有素材</label>
    </div>
    <p className="form-note">{policy.message}</p>
    {arranging && <p className="form-note">AI 选择和组合现有片段，再检查关节、碰撞与接触；不承诺完成素材中没有的舞种或动作。音乐保留在本机。</p>}
    <p className="ai-range" aria-label="AI 目标区间">{range
      ? <>时间线选区 {seconds(range.start)}–{seconds(range.end)}。<span>只{arranging ? '编排' : '创作'}这一段，两端和区间外的原动作保留。</span></>
      : <>整段 0–{seconds(duration)}。<span>在时间线节拍行拖动可选择区间。</span></>}</p>
    <label className="field">动作描述
      <textarea aria-label="动作描述" rows={3} maxLength={AI_MOTION_PROMPT_MAX_LENGTH}
        value={prompt} onChange={event => setPrompt(event.target.value)} disabled={busy || disabled}
        placeholder="例如：轻柔舒展，前半段侧向律动，最后自然收势" />
    </label>
    <div className="button-row">
      <button className="button primary compact" type="button" onClick={() => onGenerate(prompt.trim(), mode)} disabled={busy || disabled || !prompt.trim() || !policy.allowed}>{arranging ? '编排素材候选' : '创作新动作'}</button>
      {busy && <button className="button secondary compact" type="button" onClick={onCancel}>取消编排</button>}
    </div>
    {busy && <p role="status">正在编排和检查素材候选…</p>}
    {error && <p className="form-error" role="alert">{error}</p>}
  </div>;
}
