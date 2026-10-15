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

const seconds = (value: number) => `${Number(value.toFixed(2))} s`;

/** The only way to author character motion: describe it and review a candidate. */
export default function AIPanel({ onGenerate, onCancel, busy, disabled, range, duration, error }: AIPanelProps) {
  const [prompt, setPrompt] = useState('');
  return <div className="ai-panel">
    <strong className="ai-panel-title">AI dance generation</strong>
    <p className="form-note">Describe the style, energy and movement. The AI choreographs new keyposes on the counts; the app turns them into footwork and body motion and checks joints, collisions and support. Only the description and beat information are sent; the music stays on this device.</p>
    <p className="ai-range" aria-label="AI target range">{range
      ? <>Timeline range {seconds(range.start)}–{seconds(range.end)}. <span>Only this range is generated; both ends and everything outside stay.</span></>
      : <>Whole scene 0–{seconds(duration)}. <span>Drag on the Timeline count row to pick a range.</span></>}</p>
    <label className="field">Dance description
      <textarea aria-label="Dance description" rows={3} maxLength={AI_MOTION_PROMPT_MAX_LENGTH}
        value={prompt} onChange={event => setPrompt(event.target.value)} disabled={busy || disabled}
        placeholder="e.g. energetic hip-hop with punches, side steps and a turn at the end" />
    </label>
    <div className="button-row">
      <button className="button primary compact" type="button" onClick={() => onGenerate(prompt.trim())} disabled={busy || disabled || !prompt.trim()}>Generate AI candidate</button>
      {busy && <button className="button secondary compact" type="button" onClick={onCancel}>Cancel generation</button>}
    </div>
    {busy && <p role="status">Generating a dance candidate…</p>}
    {error && <p className="form-error" role="alert">{error}</p>}
  </div>;
}
