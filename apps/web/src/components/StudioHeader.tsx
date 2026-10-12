import { ArrowDownToLine, BookOpen, Check, FolderOpen, GraduationCap, History, Music, Pencil, Redo2, Save, SlidersHorizontal, Undo2 } from 'lucide-react';
import type { SceneSnapshot } from '../sceneProject';

export type SaveStatus = 'dirty' | 'saving' | 'saved' | 'failed';
const SAVE_LABELS: Record<SaveStatus, string> = { saved: '已保存到本机', saving: '保存中', failed: '保存失败', dirty: '有未保存更改' };

type Props = {
  sceneName: string;
  saveStatus: SaveStatus;
  history: SceneSnapshot[];
  historyIndex: number;
  ready: boolean;
  busy: boolean;
  playing: boolean;
  sceneBusy: boolean;
  hasAudio: boolean;
  teaching: { active: boolean; checked: boolean; canMark: boolean; canUnmark: boolean };
  onRename: () => void;
  onLibrary: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onJumpHistory: (index: number) => void;
  onSave: () => void;
  onMusic: () => void;
  onTeaching: () => void;
  onTeachingReview: (checked: boolean) => void;
  onAbout: () => void;
  onExportProject: () => void;
  onExportScene: () => void;
};

/** One quiet bar: scene identity, save state, history and folded secondary tools. */
export function StudioHeader(props: Props) {
  const { sceneName, saveStatus, history, historyIndex, ready, busy, playing, sceneBusy, hasAudio, teaching } = props;
  const saving = saveStatus === 'saving';
  return <header className="topbar">
    <div className="project-heading">
      <div className="project-title">
        <h1 title={sceneName}>{sceneName}</h1>
        <button className="icon-button rename-current" aria-label="修改当前场景名称" title="修改场景名称" onClick={props.onRename}><Pencil size={13} /></button>
      </div>
      <span className={`save-state ${saveStatus}`} aria-live="polite"><span />{SAVE_LABELS[saveStatus]}</span>
    </div>
    <div className="project-tools">
      <button className="button secondary compact scene-library-button" onClick={props.onLibrary} disabled={!ready || sceneBusy || saving} title="打开、新建或导入本机场景"><FolderOpen size={14} />场景</button>
      <div className="history-tools">
        <button className="icon-button" title="撤销（Ctrl/⌘ Z）" aria-label="撤销" disabled={historyIndex === 0 || busy} onClick={props.onUndo}><Undo2 size={14} /></button>
        <button className="icon-button" title="重做（Ctrl/⌘ ⇧ Z）" aria-label="重做" disabled={historyIndex >= history.length - 1 || busy} onClick={props.onRedo}><Redo2 size={14} /></button>
        <details className="operation-history">
          <summary aria-label="操作记录" title="操作记录"><History size={14} /></summary>
          <div className="operation-history-list floating-panel" role="list" aria-label="操作栈">
            <small>保留最近 {history.length} 个版本 · 一次拖动一步 · 点击可跳回</small>
            {history.map((snapshot, index) => <button key={index} role="listitem" aria-current={index === historyIndex ? 'step' : undefined}
              className={index === historyIndex ? 'current' : index > historyIndex ? 'undone' : ''} onClick={() => props.onJumpHistory(index)} disabled={playing || busy}>
              {snapshot.operation?.label ?? (index === 0 ? '导入／初始作品' : '既有操作')}
              <small>{snapshot.operation?.time === undefined ? '' : `${snapshot.operation.time.toPrecision(9)} s`}</small>
            </button>)}
          </div>
        </details>
      </div>
      <button className="button primary compact save-button" onClick={props.onSave} disabled={!ready || !hasAudio || saving} title="保存到本机（Ctrl/⌘ S）"><Save size={14} />保存</button>
      <details className="studio-more">
        <summary aria-label="更多工具" title="更多工具"><SlidersHorizontal size={14} /></summary>
        <div className="studio-more-content floating-panel">
          <button className="menu-item new-project" title="调整当前场景的音乐与数拍" onClick={props.onMusic} disabled={!ready || busy}><Music size={14} />导入音乐</button>
          <button className="menu-item" onClick={props.onTeaching}><GraduationCap size={14} />{teaching.active ? '返回编辑' : '教学预览'}</button>
          {teaching.active && <>
            <button className="menu-item" onClick={() => props.onTeachingReview(true)} disabled={!teaching.canMark || teaching.checked} title="仅记录本版试看，不代表教学审核"><Check size={14} />{teaching.checked ? '已记录本版试看' : '标记本版已试看'}</button>
            {teaching.checked && <button className="menu-item" onClick={() => props.onTeachingReview(false)} disabled={!teaching.canUnmark}>撤销试看记录</button>}
          </>}
          <details className="editor-disclosure backup-menu">
            <summary>场景备份</summary>
            <div className="backup-actions disclosure-content">
              <button className="menu-item" onClick={props.onExportProject}><ArrowDownToLine size={14} />下载项目备份</button>
              <button className="menu-item" onClick={props.onExportScene} disabled={!ready || !hasAudio || busy}><ArrowDownToLine size={14} />下载完整场景包</button>
            </div>
          </details>
          <button className="menu-item" onClick={props.onAbout}><BookOpen size={14} />使用说明与版本进展</button>
        </div>
      </details>
    </div>
  </header>;
}
