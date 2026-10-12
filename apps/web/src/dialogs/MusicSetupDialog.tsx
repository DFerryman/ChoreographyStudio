import { Check, Headphones, Pause, Upload } from 'lucide-react';
import type { BeatRelation, MusicSetup } from '../hooks/useMusicSetup';
import { Dialog } from './Dialog';

/** Music and eight-count timing for the current scene; never a choreography mode. */
export function MusicSetupDialog({ setup, onConfirm }: { setup: MusicSetup; onConfirm: () => void }) {
  const { draft, map, mapError, error, decoding, auditionCount, update } = setup;
  const number = (value: string) => Number(value);
  return <Dialog titleId="create-title" title="先把音乐和数拍准备好" eyebrow="音乐设置 / MUSIC & TIMING" className="create-modal"
    closeLabel="关闭音乐设置" onClose={setup.close} dismissOnBackdrop
    intro="为当前场景调整音乐与数拍。音乐留在你的浏览器，确认后重建当前手动场景；新建独立场景请使用顶部“场景”。">
    <label className="field full-field">作品名称<input value={draft.title} maxLength={80} onChange={event => update('title', event.target.value)} /></label>
    <label className="upload-area">
      <Upload size={24} />
      <strong>{decoding ? '正在解码音频…' : draft.name || '选择一首音乐'}</strong>
      <span>MP3 / WAV 等浏览器支持格式 · 100 MB 以内 · 最长 10 分钟</span>
      <input type="file" accept="audio/*" aria-label="上传音乐文件" disabled={decoding} onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; void setup.chooseAudio(file); }} />
    </label>
    <div className="file-caption">
      <span>{draft.duration.toFixed(1)} 秒可用音频</span>
      <button className="text-button" onClick={setup.applyDemo}>使用原创节奏示例</button>
    </div>
    <div className="form-grid">
      <label className="field">音乐速度 BPM<input type="number" min={30} max={240} value={draft.bpm} onChange={event => update('bpm', number(event.target.value))} /></label>
      <label className="field">每个舞蹈数拍对应<select value={draft.relation} onChange={event => update('relation', number(event.target.value) as BeatRelation)}>
        <option value={0.5}>半个音乐拍</option><option value={1}>一个音乐拍</option><option value={2}>两个音乐拍</option>
      </select></label>
      <label className="field">第一数拍位置（秒）<input type="number" min={0} step={0.01} value={draft.first} onChange={event => update('first', number(event.target.value))} /></label>
      <label className="field">从第几个八拍开始<input type="number" min={1} step={1} value={draft.start} onChange={event => update('start', number(event.target.value))} /></label>
      <label className="field">选取几个完整八拍<input type="number" min={2} max={60} step={1} value={draft.octets} onChange={event => update('octets', number(event.target.value))} /></label>
      <div className="selection-summary">
        <span>实际选段</span>
        <strong>{map ? `${map.durationSeconds.toFixed(1)} 秒` : '请调整范围'}</strong>
        <small>{map ? `${map.sourceOffsetSeconds.toFixed(1)} – ${(map.sourceOffsetSeconds + map.durationSeconds).toFixed(1)} 秒` : '须满足 16–60 秒'}</small>
      </div>
    </div>
    <div className="audition-row">
      <button className="button secondary compact" onClick={setup.toggleAudition} disabled={!map || decoding}>{auditionCount ? <Pause size={15} /> : <Headphones size={15} />}试听 1–8 数拍</button>
      <div className="audition-counts">{Array.from({ length: 8 }, (_, index) => <span className={auditionCount === index + 1 ? 'active' : ''} key={index}>{index + 1}</span>)}</div>
    </div>
    <div className="form-note">当前由你手动确认 BPM 与数拍，只支持稳定 4/4 拍音乐；节奏检测暂未接入。调整数拍或音乐将重建当前场景的中立姿态，不沿用旧动作；其他场景保持原样。</div>
    {(error || mapError) && <div className="form-error" role="alert">{error || mapError}</div>}
    <div className="modal-actions">
      <button className="button secondary" onClick={setup.close}>取消</button>
      <button className="button primary" disabled={!map || !draft.blob || decoding} onClick={onConfirm}><Check size={16} />确认数拍，进入工作台</button>
    </div>
  </Dialog>;
}
