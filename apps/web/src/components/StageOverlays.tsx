import type { ReactNode } from 'react';
import { Focus, MousePointer2, Move3D, RotateCcw, Rotate3D, Scan, SlidersHorizontal, Waypoints } from 'lucide-react';
import type { StageTransformTool, StageView } from '../Stage';

type PresetView = Exclude<StageView, 'free'>;
const PRIMARY_VIEWS: [PresetView, string][] = [['front', '正面'], ['back', '背面']];
const SECONDARY_VIEWS: [PresetView, string][] = [['left', '左侧'], ['right', '右侧'], ['top', '顶视']];

/** Camera presets and framing only change the view, never the choreography. */
export function CameraBar({ title, view, canFrame, canFocusJoint, onView, onFrame }: {
  title: string; view: StageView; canFrame: boolean; canFocusJoint: boolean;
  onView: (view: PresetView) => void; onFrame: (kind: 'actor' | 'joint') => void;
}) {
  return <div className="viewer-toolbar">
    <span className="viewer-title">{title}<span className="muted-divider">/</span><span className="viewer-muted">{view === 'free' ? '自由视角' : '3D'}</span></span>
    <div className="camera-toolbar floating-bar">
      <div className="segmented" aria-label="观看视角">{PRIMARY_VIEWS.map(([preset, label]) =>
        <button key={preset} className={view === preset ? 'selected' : ''} aria-pressed={view === preset} onClick={() => onView(preset)}>{label}</button>)}</div>
      <button className="icon-button" aria-label="全身取景" disabled={!canFrame} title="全身取景" onClick={() => onFrame('actor')}><Scan size={16} /></button>
      <details className="editor-disclosure camera-options">
        <summary aria-label="相机选项" title="相机选项"><SlidersHorizontal size={16} /></summary>
        <div className="disclosure-content floating-panel">
          <div className="segmented">{SECONDARY_VIEWS.map(([preset, label]) =>
            <button key={preset} aria-pressed={view === preset} onClick={() => onView(preset)}>{label}</button>)}</div>
          <button className="button secondary compact" aria-label="复位相机" onClick={() => onView('front')}><RotateCcw size={14} />复位相机</button>
          <button className="button secondary compact" disabled={!canFocusJoint} onClick={() => onFrame('joint')}><Focus size={14} />聚焦关节</button>
          <span>仅改变观看，不修改动作</span>
        </div>
      </details>
    </div>
  </div>;
}

type ToolState = { active: StageTransformTool; rotateUnavailable: string | null; translateDisabled: boolean; ikAvailable: boolean; previewing: boolean; hasTake: boolean };

/** Select → rotate / move / IK; each gesture records only real channel changes. */
export function StageEditTools({ tools, help, onTool }: { tools: ToolState; help: string; onTool: (tool: StageTransformTool) => void }) {
  const { active, rotateUnavailable, translateDisabled, ikAvailable, previewing, hasTake } = tools;
  const toolButton = (tool: StageTransformTool, label: string, text: string, icon: ReactNode, disabled: boolean, title: string) =>
    <button aria-label={label} aria-pressed={active === tool} className={active === tool ? 'selected' : ''} disabled={disabled} onClick={() => onTool(tool)} title={title}>{icon}{text}</button>;
  return <div className="stage-edit-tools floating-bar">
    <div className="stage-tool-buttons" role="group" aria-label="舞台编辑工具">
      {toolButton('select', '选择工具', '选择', <MousePointer2 size={15} />, false, '选择关节与移动相机；收起操作手柄')}
      {toolButton('rotate', '旋转工具', '旋转', <Rotate3D size={15} />, !!rotateUnavailable, rotateUnavailable ?? (previewing ? '回原稿并编辑关节旋转' : '暂停并编辑关节局部旋转'))}
      {toolButton('translate', '移动角色工具', '移动（整体）', <Move3D size={15} />, translateDisabled, !hasTake ? '请先新建或导入场景' : previewing ? '回原稿并移动整个角色' : '暂停并移动整个角色；不改变骨长')}
      {ikAvailable && toolButton('ik', '手脚 IK', '手脚 IK', <Waypoints size={15} />, translateDisabled, '拖动手脚目标；关节限位与骨长保持，松开自动记录变化的关节')}
    </div>
    <div className="stage-tool-help"><span>{help}</span></div>
  </div>;
}

/** Coordinates, realism and AI stay folded behind one stage button. */
export function SceneExtras({ children }: { children: ReactNode }) {
  return <details className="scene-extras">
    <summary aria-label="场景辅助工具" title="舞台信息、真实感与 AI 辅助"><SlidersHorizontal size={15} /></summary>
    <div className="scene-extras-content floating-panel">{children}</div>
  </details>;
}

export function StageDiagnostics({ camera, jointLabel, jointPosition }: { camera: readonly number[] | null; jointLabel: string | null; jointPosition: readonly number[] | null }) {
  const axes = ['X', 'Y', 'Z'];
  return <details className="editor-disclosure stage-diagnostics">
    <summary>舞台信息</summary>
    <div className="scene-spacebar">
      <span>右手坐标 · Y↑ · +Z前向 · XZ地面 · 1单位=1m</span>
      <span className="camera-coordinates" aria-label="相机世界坐标">相机 {axes.map((axis, index) => <span key={axis}><b>{axis}</b>{camera?.[index].toFixed(2) ?? '—'} </span>)}</span>
      <span className="joint-coordinates" aria-label="选中关节世界坐标">
        <span>{jointLabel ? `${jointLabel} · 世界坐标（m）` : '点击人物选择部位'}</span>
        <strong>{jointPosition ? jointPosition.map((value, index) => <span key={index}><b>{axes[index]}</b>{value.toFixed(3)}</span>) : <span>未选部位</span>}</strong>
      </span>
    </div>
  </details>;
}
