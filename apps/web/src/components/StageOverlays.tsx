import type { ReactNode } from 'react';
import { RotateCcw, Scan, Sparkles, SwitchCamera } from 'lucide-react';
import type { StageView } from '../Stage';

type PresetView = Exclude<StageView, 'free'>;
const PRIMARY_VIEWS: [PresetView, string][] = [['front', '正面'], ['back', '背面']];
const SECONDARY_VIEWS: [PresetView, string][] = [['left', '左侧'], ['right', '右侧'], ['top', '顶视']];
const AXES = ['X', 'Y', 'Z'];

/** Camera presets and framing only change the view, never the choreography. */
export function CameraBar({ view, canFrame, camera, onView, onFrame, children }: {
  view: StageView; canFrame: boolean; camera: readonly number[] | null;
  onView: (view: PresetView) => void; onFrame: () => void; children?: ReactNode;
}) {
  return <div className="viewer-toolbar">
    <div className="camera-toolbar floating-bar">
      <div className="segmented" aria-label="观看视角">{PRIMARY_VIEWS.map(([preset, label]) =>
        <button key={preset} className={view === preset ? 'selected' : ''} aria-pressed={view === preset} onClick={() => onView(preset)}>{label}</button>)}</div>
      <button className="icon-button" aria-label="全身取景" disabled={!canFrame} title="全身取景" onClick={onFrame}><Scan size={13} /></button>
      <details className="editor-disclosure camera-options">
        <summary aria-label="相机选项" title="更多视角"><SwitchCamera size={13} /></summary>
        <div className="disclosure-content floating-panel">
          <div className="segmented">{SECONDARY_VIEWS.map(([preset, label]) =>
            <button key={preset} aria-pressed={view === preset} onClick={() => onView(preset)}>{label}</button>)}</div>
          <button className="button secondary compact" aria-label="复位相机" onClick={() => onView('front')}><RotateCcw size={14} />复位相机</button>
          <span className="camera-coordinates" aria-label="相机世界坐标">相机 {AXES.map((axis, index) => <span key={axis}><b>{axis}</b>{camera?.[index].toFixed(2) ?? '—'} </span>)}</span>
          <span>右手坐标 · Y↑ · +Z前向 · 1单位=1m · 仅改变观看</span>
        </div>
      </details>
      {children && <span className="toolbar-divider" aria-hidden="true" />}
      {children}
    </div>
  </div>;
}

/** All character motion comes from AI; its prompt lives behind one stage button. */
export function AIDock({ busy, children }: { busy: boolean; children: ReactNode }) {
  return <details className="scene-extras ai-dock">
    <summary aria-label="AI 生成动作" title="用 AI 生成人物动作"><Sparkles size={13} /><span>AI 动作</span>{busy && <i className="ai-dock-busy" aria-hidden="true" />}</summary>
    <div className="scene-extras-content floating-panel">{children}</div>
  </details>;
}
