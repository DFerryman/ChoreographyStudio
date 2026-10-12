import { Check, LoaderCircle, Upload } from 'lucide-react';
import type { SceneDocument } from '../scene';
import type { SceneProject } from '../sceneProject';
import { Dialog } from './Dialog';

type Props = {
  scene: SceneDocument<SceneProject> | null;
  name: string;
  needsAudio: boolean;
  error: string;
  reading: boolean;
  saving: boolean;
  onName: (name: string) => void;
  onChooseBackup: (file: File | undefined) => void;
  onChooseAudio: (file: File | undefined) => void;
  onConfirm: () => void;
  onClose: () => void;
};

/** Read the chosen file once and reset the input so the same file can be chosen again. */
const takeFile = (input: HTMLInputElement) => { const file = input.files?.[0]; input.value = ''; return file; };

/** Validate a scene package or legacy JSON before it becomes an independent scene. */
export function BackupImportDialog({ scene, name, needsAudio, error, reading, saving, onName, onChooseBackup, onChooseAudio, onConfirm, onClose }: Props) {
  const locked = reading || saving;
  const snapshot = scene?.project.history[scene.project.historyIndex];
  return <Dialog titleId="backup-import-title" title="导入场景备份" eyebrow="SCENE BACKUP / 本机恢复" className="backup-import-modal" layer="import"
    closeLabel="关闭场景备份导入" closeDisabled={saving} onClose={onClose}
    intro="完整场景包包含原音乐和正式动作。导入会创建独立场景，保留现有作品；所有读取和验证都在浏览器完成。">
    <label className="upload-area backup-upload">
      <Upload size={24} />
      <strong>{reading ? '正在验证场景与音乐…' : '选择 .choreo 场景包或旧 JSON 备份'}</strong>
      <span>完整包最多 132 MB · 旧 JSON 最多 32 MB</span>
      <input type="file" accept=".choreo,.json" aria-label="选择场景备份文件" disabled={locked} onChange={event => onChooseBackup(takeFile(event.target))} />
    </label>
    {scene && snapshot && <>
      <label className="field rename-field">导入后的场景名称<input value={name} maxLength={80} onChange={event => onName(event.target.value)} disabled={locked} /></label>
      <div className="backup-summary">
        <strong>{scene.name}</strong>
        <span>{scene.project.history.length} 个历史版本 · {snapshot.countMap.durationSeconds.toFixed(1)} 秒</span>
        <span>音乐：{scene.audioName}</span>
      </div>
      {needsAudio && <div className="legacy-audio">
        <p>旧 JSON 没有音乐。请重新选择原音乐；只能核对时长，请确认使用的是备份时的曲目。正式动作和数拍会完整保留。</p>
        <label className="field">重新关联原音乐<input type="file" accept="audio/*" aria-label="重新关联原音乐" disabled={locked} onChange={event => onChooseAudio(takeFile(event.target))} /></label>
      </div>}
    </>}
    {error && <div className="form-error" role="alert">{error}</div>}
    <div className="form-note">场景包保留已记录的动作与操作历史，也不带入教师确认。保存到本机成功后才切换场景。</div>
    <div className="modal-actions">
      <button className="button secondary" disabled={saving} onClick={onClose}>取消</button>
      <button className="button primary" disabled={!scene?.audio || needsAudio || !name.trim() || locked} onClick={onConfirm}>{saving ? <LoaderCircle className="spin" size={15} /> : <Check size={15} />}作为新场景导入</button>
    </div>
  </Dialog>;
}
