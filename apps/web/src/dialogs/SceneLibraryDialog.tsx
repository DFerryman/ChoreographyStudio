import { FolderOpen, Layers3, LoaderCircle, Plus, Upload } from 'lucide-react';
import type { SceneMetadata as SceneSummary } from '../scene';
import { Dialog } from './Dialog';

type Props = {
  scenes: SceneSummary[];
  currentId: string;
  currentName: string;
  loading: boolean;
  busy: boolean;
  importDisabled: boolean;
  onClose: () => void;
  onImport: () => void;
  onNew: () => void;
  onOpen: (id: string) => void;
  onCopy: (id: string) => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string, name: string) => void;
};

const savedAt = (iso: string) => new Date(iso).toLocaleString('zh-CN', { hour12: false });

/** Local scene management: every scene owns its music, choreography and view. */
export function SceneLibraryDialog({ scenes, currentId, currentName, loading, busy, importDisabled, onClose, onImport, onNew, onOpen, onCopy, onRename, onDelete }: Props) {
  return <Dialog titleId="library-title" title="本机场景" eyebrow="SCENE LIBRARY / 本机管理" className="scene-library-modal"
    closeLabel="关闭场景列表" closeDisabled={busy} onClose={onClose} dismissOnBackdrop
    intro="每个场景独立保留音乐、编排、相机与观看设置。仅保存在这个浏览器。">
    <div className="library-toolbar">
      <span>{scenes.length} 个已保存场景</span>
      <button className="button secondary compact" disabled={busy || importDisabled} onClick={onImport}><Upload size={15} />导入场景备份</button>
      <button className="button primary compact" disabled={busy} onClick={onNew}><Plus size={15} />新建场景</button>
    </div>
    {loading ? <div className="library-empty"><LoaderCircle className="spin" size={22} />正在读取本机场景…</div>
      : scenes.length ? <div className="scene-list" role="list" aria-label="已保存场景">{scenes.map(scene => {
        const current = scene.id === currentId, name = current ? currentName : scene.name;
        return <div role="listitem" key={scene.id} className={`scene-list-row ${current ? 'current' : ''}`}>
          <span className="scene-list-icon"><Layers3 size={19} /></span>
          <div className="scene-list-info">
            <strong>{name}{current && <small>当前</small>}</strong>
            <span>{scene.audioName}</span>
            <span>保存于 {savedAt(scene.updatedAt)}</span>
          </div>
          <div className="scene-list-actions">
            <button className="button secondary compact" aria-label={`打开场景 ${name}`} onClick={() => onOpen(scene.id)} disabled={busy}>{current ? '已打开' : '打开'}</button>
            <button className="text-button" aria-label={`复制场景 ${name}`} disabled={busy} onClick={() => onCopy(scene.id)}>复制</button>
            <button className="text-button" aria-label={`改名场景 ${name}`} onClick={() => onRename(scene.id, name)}>改名</button>
            <button className="text-button danger-text" aria-label={`删除场景 ${name}`} onClick={() => onDelete(scene.id, name)}>删除</button>
          </div>
        </div>;
      })}</div>
      : <div className="library-empty"><FolderOpen size={28} /><strong>还没有保存的场景</strong><p>关闭列表后点击“保存”，即可保留当前场景。</p></div>}
    <div className="form-note">导入音乐调整当前场景；“新建场景”创建独立作品，“复制”基于该场景的已保存版本。清理浏览器数据会删除本机保存的场景与音乐。</div>
  </Dialog>;
}
