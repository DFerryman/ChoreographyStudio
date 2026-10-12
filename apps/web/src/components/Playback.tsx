import { Copy, Pause, Play, Volume2 } from 'lucide-react';
import { formatClock } from '../editor/format';
import { PLAYBACK_RATES } from '../playbackRates';

export function PlaybackTransport({ playing, disabled, time, duration, count, onToggle }: { playing: boolean; disabled: boolean; time: number; duration: number; count: string; onToggle: () => void }) {
  return <div className="player-main">
    <button className="play-button" aria-label={playing ? '暂停' : '播放'} title={`${playing ? '暂停' : '播放'}（Space）`} disabled={disabled} onClick={onToggle}>
      {playing ? <Pause size={14} fill="currentColor" /> : <Play size={14} fill="currentColor" />}
    </button>
    <span className="time-display">{formatClock(time)}.{Math.floor(time % 1 * 100).toString().padStart(2, '0')}<span> / {formatClock(duration)}</span></span>
    <span className="count-display" aria-label="当前八拍与拍数" title="第几个八拍 - 第几拍">{count}</span>
  </div>;
}

type OptionsProps = {
  rate: number; mirror: boolean; countSound: boolean;
  onRate: (rate: number) => void; onMirror: () => void; onCountSound: () => void;
};

/** Viewing options never modify the choreography or its arrangement. */
export function PlaybackOptions({ rate, mirror, countSound, onRate, onMirror, onCountSound }: OptionsProps) {
  return <div className="player-options" aria-label="播放选项">
    <label className="playback-rate-option">速度<select aria-label="播放速度" value={rate} onChange={event => onRate(Number(event.target.value))}>{PLAYBACK_RATES.map(value => <option key={value} value={value}>{value}×</option>)}</select></label>
    <button className={mirror ? 'option active' : 'option'} aria-pressed={mirror} onClick={onMirror}><Copy size={14} />镜像观看</button>
    <button className={countSound ? 'option active' : 'option'} aria-pressed={countSound} onClick={onCountSound}><Volume2 size={14} />节拍提示</button>
    <span>{mirror ? '镜像仅影响观看，坐标保持原始世界空间' : '播放与视角不修改动作数据'}</span>
  </div>;
}
