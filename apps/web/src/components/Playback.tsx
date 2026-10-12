import { Copy, Pause, Play, Repeat2, Volume2 } from 'lucide-react';
import { formatClock } from '../editor/format';

export function PlaybackTransport({ playing, disabled, time, duration, onToggle }: { playing: boolean; disabled: boolean; time: number; duration: number; onToggle: () => void }) {
  return <div className="player-main">
    <button className="play-button" aria-label={playing ? '暂停' : '播放'} title={`${playing ? '暂停' : '播放'}（Space）`} disabled={disabled} onClick={onToggle}>
      {playing ? <Pause size={14} fill="currentColor" /> : <Play size={14} fill="currentColor" />}
    </button>
    <span className="time-display">{formatClock(time)}<span> / {formatClock(duration)}</span></span>
  </div>;
}

type OptionsProps = {
  loop: boolean; rate: number; mirror: boolean; countSound: boolean;
  onLoop: () => void; onRate: (rate: number) => void; onMirror: () => void; onCountSound: () => void;
};

const RATES = [0.5, 0.75, 1];

/** Viewing options never modify the choreography or its arrangement. */
export function PlaybackOptions({ loop, rate, mirror, countSound, onLoop, onRate, onMirror, onCountSound }: OptionsProps) {
  return <details className="editor-disclosure playback-options">
    <summary>播放选项</summary>
    <div className="player-options">
      <div className="playback-extra-options">
        <button className={`icon-button ${loop ? 'toggled' : ''}`} aria-label="循环整段" title="循环整段" aria-pressed={loop} onClick={onLoop}><Repeat2 size={14} />循环整段</button>
        <label className="playback-rate-option">速度<select aria-label="播放速度" value={rate} onChange={event => onRate(Number(event.target.value))}>{RATES.map(value => <option key={value} value={value}>{value}×</option>)}</select></label>
      </div>
      <button className={mirror ? 'option active' : 'option'} aria-pressed={mirror} onClick={onMirror}><Copy size={14} />镜像观看</button>
      <button className={countSound ? 'option active' : 'option'} aria-pressed={countSound} onClick={onCountSound}><Volume2 size={14} />节拍提示</button>
      <span>{mirror ? '镜像仅影响观看，坐标保持原始世界空间' : '播放与视角不修改动作数据'}</span>
    </div>
  </details>;
}
