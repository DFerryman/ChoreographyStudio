import { useState } from 'react';
import { AI_MOTION_PROMPT_MAX_LENGTH } from '../../../packages/core/src/aiMotion';
import type { TimelineRange } from './Timeline';

export interface AIPanelProps {
  onGenerate: (prompt: string) => void;
  onCancel: () => void;
  busy: boolean;
  disabled: boolean;
  range: TimelineRange | null;
  duration: number;
  error?: string;
}

const seconds = (value: number) => `${Number(value.toFixed(2))} 秒`;

/** The only way to author character motion: describe it and review a candidate. */
export default function AIPanel({ onGenerate, onCancel, busy, disabled, range, duration, error }: AIPanelProps) {
  const [prompt, setPrompt] = useState('');
  return <div className="ai-panel">
    <strong className="ai-panel-title">AI 生成人物动作</strong>
    <p className="form-note">描述风格、节奏和动作。AI 只从动作库挑选并排列动作，程序按数拍合成步伐，并检查关节、碰撞与接触。只发送描述和节拍信息，音乐保留在本机。</p>
    <p className="ai-range" aria-label="AI 目标区间">{range
      ? <>时间线选区 {seconds(range.start)}–{seconds(range.end)}。<span>只生成这一段，两端和区间外的原动作保留。</span></>
      : <>整段 0–{seconds(duration)}。<span>在时间线节拍行拖动可选择区间。</span></>}</p>
    <label className="field">动作描述
      <textarea aria-label="动作描述" rows={3} maxLength={AI_MOTION_PROMPT_MAX_LENGTH}
        value={prompt} onChange={event => setPrompt(event.target.value)} disabled={busy || disabled}
        placeholder="例如：轻柔舒展，前半段侧向律动，最后自然收势" />
    </label>
    <div className="button-row">
      <button className="button primary compact" type="button" onClick={() => onGenerate(prompt.trim())} disabled={busy || disabled || !prompt.trim()}>生成 AI 候选</button>
      {busy && <button className="button secondary compact" type="button" onClick={onCancel}>取消生成</button>}
    </div>
    {busy && <p role="status">正在生成动作候选…</p>}
    {error && <p className="form-error" role="alert">{error}</p>}
  </div>;
}
