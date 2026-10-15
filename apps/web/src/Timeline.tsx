import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { Camera, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Diamond, Maximize2, Music2, Plus, Repeat2, Scissors, SkipBack, SkipForward, Trash2, Volume2, VolumeX, X } from 'lucide-react';
import { frameAtTime, frameTime, lastFrame, type CameraPose, type CameraTrack, type Vec3 } from '../../../packages/core/src';
import { audioSegmentTrimBounds, audioTrackOffsetBounds, audioTrackSegments, splitAudioTrack, trimAudioSegment, type AudioTrackSegment } from './audioTracks';
import { timelineAnchorAtFraction, timelineEdgeScroll, timelinePinchZoom, timelineMajorTickFrames, timelineTimeAtX, timelineWidth, timelineXAtTime, timelineZoomAtWidth } from './timelineGeometry';
import { isInteractiveTarget } from './useEditorShortcuts';
import './Timeline.css';

/** A frame-aligned time range; view state for playback and future AI edits. */
export type TimelineRange = { start: number; end: number };

/** Camera authoring is the only keyed track; character motion comes from AI candidates. */
export type CameraTimelineProps = {
  track?: CameraTrack;
  value: CameraPose;
  selected: boolean;
  onSelect: (time: number) => void;
  onAdd: () => void;
  onChange: (time: number, value: CameraPose) => void;
  onMove: (sourceTime: number, targetTime: number) => void;
  onDelete: () => void;
  /** Leave record mode; navigation then only changes the view. */
  onDeselect: () => void;
};

export type AudioTimelineProps = { name: string; offsetSeconds: number; durationSeconds: number; waveform: number[]; onMove: (offsetSeconds: number) => void; disabled?: boolean };

/** One additional imported audio file on its own track. */
export type AudioTrackLane = { id: string; name: string; offsetSeconds: number; durationSeconds: number; segments?: AudioTrackSegment[]; waveform: number[]; muted: boolean; missing: boolean };
export type AudioTracksTimelineProps = {
  tracks: AudioTrackLane[];
  canAdd: boolean;
  onAdd: (file: File) => void;
  onMove: (id: string, offsetSeconds: number) => void;
  /** Split the track's audible piece under the playhead into two. */
  onSplit: (id: string) => void;
  /** Move one edge of one audible piece to a clip source time. */
  onTrim: (id: string, index: number, edge: 'start' | 'end', sourceSeconds: number) => void;
  onRemoveSegment: (id: string, index: number) => void;
  onToggleMute: (id: string) => void;
  onRemove: (id: string) => void;
};

type TimelineProps = {
  duration: number;
  time: number;
  playing: boolean;
  readOnly: boolean;
  /** Dance-count onsets relative to the scene, plus its exact end. */
  countTimes: readonly number[];
  range: TimelineRange | null;
  onRange: (range: TimelineRange | null) => void;
  onTime: (time: number) => void;
  loop: boolean;
  onLoop: () => void;
  transport: ReactNode;
  playbackOptions: ReactNode;
  camera: CameraTimelineProps;
  audio: AudioTimelineProps;
  audioTracks: AudioTracksTimelineProps;
};

const SNAP_PIXELS = 6;
const sameTime = (a: number, b: number) => Math.abs(a - b) < 1e-9;
const seconds = (value: number) => `${Number(value.toFixed(3))}s`;

function nearestIndex(times: readonly number[], time: number): number {
  if (time <= times[0]) return 0;
  if (time >= times.at(-1)!) return times.length - 1;
  let low = 0, high = times.length - 1;
  while (high - low > 1) { const middle = (low + high) >>> 1; if (times[middle] <= time) low = middle; else high = middle; }
  return time - times[low] <= times[high] - time ? low : high;
}

function CameraValues({ time, value, keyTime, duration, disabled, onChange, onMove }: {
  time: number; value: CameraPose; keyTime?: number; duration: number; disabled: boolean;
  onChange: CameraTimelineProps['onChange']; onMove: CameraTimelineProps['onMove'];
}) {
  const effectiveZoom = value.zoom ?? 1;
  const components = [...value.position, ...value.target, effectiveZoom];
  const signature = components.join(',');
  const [values, setValues] = useState(() => components.map(String));
  const [error, setError] = useState('');
  const [keySeconds, setKeySeconds] = useState(String(keyTime ?? time));
  const cancelled = useRef(false);
  const timeCancelled = useRef(false);
  useEffect(() => { setValues(components.map(String)); setError(''); }, [time, signature]);
  useEffect(() => { setKeySeconds(String(keyTime ?? time)); }, [keyTime, time]);
  function commit() {
    if (cancelled.current) { cancelled.current = false; return; }
    if (disabled) return;
    const parsed = values.map(text => text.trim() ? Number(text) : NaN);
    if (!parsed.every(Number.isFinite) || parsed.slice(0, 6).some(component => Math.abs(component) > 1000)
      || parsed[6] < .5 || parsed[6] > 4
      || Math.hypot(...parsed.slice(0, 3).map((component, axis) => component - parsed[axis + 3])) < .01) {
      setError('位置与目标需在 ±1000 m 内且相距至少 0.01 m，缩放范围为 0.5–4。'); return;
    }
    setError('');
    if (parsed.some((component, index) => component !== components[index])) onChange(time, {
      position: parsed.slice(0, 3) as Vec3, target: parsed.slice(3, 6) as Vec3,
      ...(value.zoom !== undefined || parsed[6] !== effectiveZoom ? { zoom: parsed[6] } : {}),
    });
  }
  function moveKey() {
    if (timeCancelled.current) { timeCancelled.current = false; return; }
    if (disabled || keyTime === undefined) return;
    const parsed = keySeconds.trim() ? Number(keySeconds) : NaN;
    if (!Number.isFinite(parsed) || parsed < 0 || parsed > duration) { setError(`关键帧时间需在 0–${duration} 秒内。`); return; }
    setError('');
    if (parsed !== keyTime) { setKeySeconds(String(keyTime)); onMove(keyTime, parsed); }
  }
  const field = (index: number, label: string, aria: string) => <label key={index}>{label}<input aria-label={aria} type="number" step="any" min={index === 6 ? .5 : -1000} max={index === 6 ? 4 : 1000} value={values[index]} disabled={disabled}
    onChange={event => setValues(previous => previous.map((old, axis) => axis === index ? event.target.value : old))} onBlur={commit} onKeyDown={event => {
      if (event.key === 'Enter') event.currentTarget.blur();
      if (event.key === 'Escape') { event.stopPropagation(); cancelled.current = true; setValues(components.map(String)); setError(''); event.currentTarget.blur(); }
    }} /></label>;
  return <div className="tl-camera-values">
    <div className="tl-value-heading">镜头位置 · m<span>离开输入框自动记录</span></div>
    <div className="tl-value-fields">{[0, 1, 2].map(index => field(index, ['X', 'Y', 'Z'][index], `镜头位置${['X', 'Y', 'Z'][index]}`))}</div>
    <div className="tl-value-heading">注视目标 · m</div>
    <div className="tl-value-fields">{[3, 4, 5].map(index => field(index, ['X', 'Y', 'Z'][index - 3], `镜头目标${['X', 'Y', 'Z'][index - 3]}`))}</div>
    <div className="tl-value-fields">{field(6, '缩放', '镜头缩放')}{keyTime !== undefined && <label>关键帧秒<input aria-label="镜头关键帧时间（秒）" type="number" min={0} max={duration} step="any" value={keySeconds} disabled={disabled}
      onChange={event => setKeySeconds(event.target.value)} onBlur={moveKey} onKeyDown={event => {
        if (event.key === 'Enter') event.currentTarget.blur();
        if (event.key === 'Escape') { event.stopPropagation(); timeCancelled.current = true; setKeySeconds(String(keyTime)); setError(''); event.currentTarget.blur(); }
      }} /></label>}</div>
    {error && <p className="tl-value-error" role="alert">{error}</p>}
  </div>;
}

type DragBase = { pointerId: number; element: HTMLElement; startX: number; pointerX: number; startContentX: number; moved: boolean; touch: boolean };
/** Two touch points zoom around their midpoint; fraction is the content position under it at the start. */
type Pinch = { ids: [number, number]; startDistance: number; startWidth: number; fraction: number };
const DOUBLE_TAP_MS = 320;
const DOUBLE_TAP_PIXELS = 24;
type CameraDrag = DragBase & { kind: 'camera'; sourceTime: number; targetTime: number };
/** trackId is absent for the primary CountMap music. */
type AudioDrag = DragBase & { kind: 'audio'; trackId?: string; sourceOffset: number; targetOffset: number };
/** Drag one edge of one audible piece of an added track; values are clip source seconds. */
type TrimDrag = DragBase & { kind: 'trim'; trackId: string; index: number; edge: 'start' | 'end'; sourceValue: number; targetValue: number };
/** create: drag a new range from an anchor; start/end: move one edge; move: shift the whole range. */
type RangeDrag = DragBase & { kind: 'range'; mode: 'create' | 'start' | 'end' | 'move'; anchor: number; source: TimelineRange | null; target: TimelineRange | null };
type Drag = CameraDrag | AudioDrag | TrimDrag | RangeDrag;

/**
 * Music (plus any added audio tracks) and camera over one shared time axis. A count row
 * underneath the ruler selects ranges; character motion is never keyed here.
 */
export function SceneTimeline(props: TimelineProps) {
  const { duration, time, playing, readOnly, range, camera, audio, audioTracks } = props;
  const end = lastFrame(duration);
  const frame = frameAtTime(time, duration);
  const locked = playing || readOnly;
  const [expanded, setExpanded] = useState(true);
  const [zoom, setZoom] = useState(0);
  const [geometry, setGeometry] = useState({ visibleWidth: 1, labelWidth: 84 });
  const [panning, setPanning] = useState(false);
  const [scrubbing, setScrubbing] = useState(false);
  const [pinching, setPinching] = useState(false);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [selectedTrack, setSelectedTrack] = useState<string | null>(null);
  const [selectedSegment, setSelectedSegment] = useState(0);
  const trackFile = useRef<HTMLInputElement>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const rulerLabel = useRef<HTMLDivElement>(null);
  const moreDisclosure = useRef<HTMLDetailsElement>(null);
  const dragRef = useRef<Drag | null>(null);
  const panRef = useRef<{ pointerId: number; startX: number; startScroll: number; moved: boolean } | null>(null);
  const scrubRef = useRef<{ pointerId: number; element: HTMLInputElement } | null>(null);
  const scrollAnimation = useRef<number | null>(null);
  const touches = useRef(new Map<number, { x: number; y: number }>());
  const pinchRef = useRef<Pinch | null>(null);
  const lastTap = useRef<{ at: number; x: number } | null>(null);
  /** When a touch double-tap was handled; the browser's synthesized dblclick that follows is ignored. */
  const touchDoubleTap = useRef(-Infinity);
  const zoomAnchor = useRef<{ fraction: number; x: number } | null>(null);
  const suppressClick = useRef(false);
  const timeWidth = timelineWidth(geometry.visibleWidth, duration, zoom);
  const layoutRef = useRef({ geometry, timeWidth, time, duration });
  layoutRef.current = { geometry, timeWidth, time, duration };
  const position = (at: number) => timelineXAtTime(at, 100, duration);
  const snap = (at: number) => frameTime(frameAtTime(Math.max(0, Math.min(duration, at)), duration), duration);

  const cameraKeys = camera.track?.keys ?? [];
  const cameraTimes = useMemo(() => cameraKeys.map(key => key.time), [cameraKeys]);
  const cameraKey = cameraKeys.find(key => key.time === time);
  const wave = useMemo(() => audio.waveform.filter(Number.isFinite).slice(0, 160), [audio.waveform]);
  const octets = useMemo(() => {
    const onsets = props.countTimes.slice(0, -1);
    const result: { index: number; start: number; end: number }[] = [];
    for (let index = 0; index * 8 < onsets.length; index += 1) result.push({ index, start: onsets[index * 8], end: props.countTimes[Math.min(props.countTimes.length - 1, index * 8 + 8)] });
    return result;
  }, [props.countTimes]);

  // ── Layout, zoom and follow ───────────────────────────────────────────────
  useLayoutEffect(() => {
    const container = viewport.current, label = rulerLabel.current;
    if (!container || !label) return;
    const measure = () => {
      const labelWidth = label.getBoundingClientRect().width;
      const next = { visibleWidth: Math.max(1, container.clientWidth - labelWidth), labelWidth };
      const current = layoutRef.current;
      if (Math.abs(next.visibleWidth - current.geometry.visibleWidth) < .5 && Math.abs(next.labelWidth - current.geometry.labelWidth) < .5) return;
      finishDrag(true); finishPan(true); finishScrub();
      const fraction = timelineXAtTime(current.time, 1, current.duration);
      const cursorX = fraction * current.timeWidth - container.scrollLeft;
      zoomAnchor.current = cursorX < 0 || cursorX > current.geometry.visibleWidth
        ? { fraction: (container.scrollLeft + current.geometry.visibleWidth / 2) / current.timeWidth, x: next.visibleWidth / 2 }
        : { fraction, x: Math.max(0, Math.min(next.visibleWidth, cursorX)) };
      setGeometry(next);
    };
    measure();
    const observer = new ResizeObserver(measure); observer.observe(container); observer.observe(label);
    return () => observer.disconnect();
  }, [expanded]);
  useLayoutEffect(() => {
    const anchor = zoomAnchor.current;
    if (anchor && viewport.current) viewport.current.scrollLeft = timelineAnchorAtFraction(anchor.fraction, timeWidth, anchor.x, geometry.visibleWidth);
    zoomAnchor.current = null;
  }, [timeWidth, geometry.visibleWidth, duration]);
  useLayoutEffect(() => {
    // Keep a paused, positioned playhead visible after keyboard/button
    // navigation. Playback never scrolls the view: the playhead moves instead.
    const container = viewport.current;
    if (playing || !expanded || !container || dragRef.current || panRef.current || scrubRef.current) return;
    const x = timelineXAtTime(time, timeWidth, duration);
    if (x < container.scrollLeft + 8) container.scrollLeft = Math.max(0, x - 24);
    else if (x > container.scrollLeft + geometry.visibleWidth - 8) container.scrollLeft = x - geometry.visibleWidth + 24;
  }, [time]);
  useEffect(() => { setZoom(0); if (viewport.current) viewport.current.scrollLeft = 0; }, [duration]);

  function changeZoom(next: number, pointerX?: number) {
    const container = viewport.current;
    if (!container || dragRef.current || panRef.current || scrubRef.current || pinchRef.current) return;
    const bounded = Math.max(0, Math.min(100, next));
    if (bounded === zoom) return;
    let fraction = timelineXAtTime(time, 1, duration), x = fraction * timeWidth - container.scrollLeft;
    if (pointerX !== undefined) { x = Math.max(0, Math.min(geometry.visibleWidth, pointerX - container.getBoundingClientRect().left - geometry.labelWidth)); fraction = (container.scrollLeft + x) / timeWidth; }
    else if (x < 0 || x > geometry.visibleWidth) { x = geometry.visibleWidth / 2; fraction = (container.scrollLeft + x) / timeWidth; }
    zoomAnchor.current = { fraction, x }; setZoom(bounded);
  }
  /** Fit the selected range to the visible lane width, with a small margin. */
  function zoomToRange() {
    if (!range || !viewport.current || dragRef.current) return;
    const fit = timelineXAtTime(range.end, 1, duration) - timelineXAtTime(range.start, 1, duration);
    const width = geometry.visibleWidth / Math.max(1e-6, fit * 1.1);
    const nextZoom = timelineZoomAtWidth(geometry.visibleWidth, duration, width);
    const center = (timelineXAtTime(range.start, 1, duration) + timelineXAtTime(range.end, 1, duration)) / 2;
    zoomAnchor.current = { fraction: center, x: geometry.visibleWidth / 2 };
    if (nextZoom === zoom) { viewport.current.scrollLeft = timelineAnchorAtFraction(center, timeWidth, geometry.visibleWidth / 2, geometry.visibleWidth); zoomAnchor.current = null; }
    else setZoom(nextZoom);
  }
  useEffect(() => {
    const container = viewport.current;
    if (!container) return;
    const wheel = (event: WheelEvent) => { if (!event.ctrlKey && !event.metaKey) return; event.preventDefault(); changeZoom(zoom - Math.sign(event.deltaY) * 6, event.clientX); };
    container.addEventListener('wheel', wheel, { passive: false });
    return () => container.removeEventListener('wheel', wheel);
  }, [zoom, timeWidth, geometry, time, duration, expanded]);

  // ── Dragging keys, the music clip and ranges ──────────────────────────────
  function laneContentX(element: HTMLElement, clientX: number) {
    const lane = element.closest('.tl-lane-track') ?? element;
    return clientX - lane.getBoundingClientRect().left;
  }
  function snapToCounts(at: number, laneWidth: number) {
    if (!props.countTimes.length) return snap(at);
    const nearest = props.countTimes[nearestIndex(props.countTimes, at)];
    const distance = Math.abs(timelineXAtTime(nearest, laneWidth, duration) - timelineXAtTime(at, laneWidth, duration));
    return distance <= SNAP_PIXELS ? snap(nearest) : snap(at);
  }
  function updateDrag(active: Drag) {
    const lane = active.element.closest('.tl-lane-track') ?? active.element;
    const laneWidth = lane.getBoundingClientRect().width;
    const contentX = laneContentX(active.element, active.pointerX);
    const delta = contentX - active.startContentX;
    if (active.kind === 'camera') {
      const sourceX = timelineXAtTime(active.sourceTime, laneWidth, duration);
      active.targetTime = Math.max(0, Math.min(duration, timelineTimeAtX(sourceX + delta, laneWidth, duration)));
    } else if (active.kind === 'audio') {
      const sourceX = timelineXAtTime(active.sourceOffset, laneWidth, duration);
      const bound = Math.max(0, end - 1) / 30;
      const lane = active.trackId ? audioTracks.tracks.find(track => track.id === active.trackId) : undefined;
      const { min, max } = lane ? audioTrackOffsetBounds(lane, duration) : { min: -bound, max: bound };
      active.targetOffset = Math.max(min, Math.min(max, Math.round(timelineTimeAtX(sourceX + delta, laneWidth, duration) * 30) / 30));
    } else if (active.kind === 'trim') {
      const lane = audioTracks.tracks.find(track => track.id === active.trackId);
      if (lane) {
        const sceneEdge = lane.offsetSeconds + active.sourceValue;
        const pointer = timelineTimeAtX(timelineXAtTime(sceneEdge, laneWidth, duration) + delta, laneWidth, duration) - lane.offsetSeconds;
        const next = trimAudioSegment(lane, active.index, active.edge, pointer, duration);
        active.targetValue = next ? audioTrackSegments(next)[active.index][active.edge === 'start' ? 'startSeconds' : 'endSeconds'] : active.sourceValue;
      }
    } else {
      const pointer = Math.max(0, Math.min(duration, timelineTimeAtX(contentX, laneWidth, duration)));
      const snapped = snapToCounts(pointer, laneWidth);
      const source = active.source;
      let next: TimelineRange | null = null;
      if (active.mode === 'create') next = { start: Math.min(active.anchor, snapped), end: Math.max(active.anchor, snapped) };
      else if (source && active.mode === 'start') next = { start: Math.min(snapped, source.end), end: Math.max(snapped, source.end) };
      else if (source && active.mode === 'end') next = { start: Math.min(source.start, snapped), end: Math.max(source.start, snapped) };
      else if (source) {
        const length = source.end - source.start;
        const shift = timelineTimeAtX(timelineXAtTime(source.start, laneWidth, duration) + delta, laneWidth, duration) - source.start;
        const start = snap(Math.max(0, Math.min(duration - length, source.start + shift)));
        next = { start, end: snap(Math.min(duration, start + length)) };
      }
      active.target = next && next.end - next.start > 1e-9 ? next : null;
    }
    setDrag({ ...active });
  }
  function scrollWhileDragging() {
    const active = dragRef.current, container = viewport.current;
    if (!active || !container) { scrollAnimation.current = null; return; }
    if (active.moved) {
      const rect = container.getBoundingClientRect();
      const shift = timelineEdgeScroll(active.pointerX, rect.left + geometry.labelWidth, rect.left + container.clientWidth);
      if (shift) { const previous = container.scrollLeft; container.scrollLeft += shift; if (previous !== container.scrollLeft) updateDrag(active); }
    }
    scrollAnimation.current = requestAnimationFrame(scrollWhileDragging);
  }
  function beginDrag(event: ReactPointerEvent<HTMLElement>, payload: Omit<CameraDrag, keyof DragBase> | Omit<AudioDrag, keyof DragBase> | Omit<TrimDrag, keyof DragBase> | Omit<RangeDrag, keyof DragBase>) {
    if (event.button !== 0 || !event.isPrimary || (payload.kind === 'range' ? playing : locked) || dragRef.current || panRef.current || scrubRef.current || pinchRef.current) return;
    if (payload.kind === 'audio' && (payload.trackId ? audioTracks.tracks.find(track => track.id === payload.trackId)?.missing !== false : audio.disabled)) return;
    if (payload.kind === 'trim' && audioTracks.tracks.find(track => track.id === payload.trackId)?.missing !== false) return;
    event.stopPropagation();
    const active = { ...payload, pointerId: event.pointerId, element: event.currentTarget, startX: event.clientX, pointerX: event.clientX, startContentX: laneContentX(event.currentTarget, event.clientX), moved: false, touch: event.pointerType === 'touch' } as Drag;
    event.currentTarget.setPointerCapture(event.pointerId); dragRef.current = active; setDrag(active);
    scrollAnimation.current = requestAnimationFrame(scrollWhileDragging);
  }
  function moveDrag(event: ReactPointerEvent<HTMLElement>) {
    const active = dragRef.current;
    if (!active || active.pointerId !== event.pointerId) return;
    active.pointerX = event.clientX;
    if (!active.moved && Math.abs(event.clientX - active.startX) < 4) return;
    event.preventDefault();
    active.moved = true; updateDrag(active);
  }
  function finishDrag(cancel = false) {
    const active = dragRef.current;
    if (!active) return;
    dragRef.current = null; setDrag(null);
    if (scrollAnimation.current !== null) cancelAnimationFrame(scrollAnimation.current);
    scrollAnimation.current = null;
    if (active.element.hasPointerCapture(active.pointerId)) active.element.releasePointerCapture(active.pointerId);
    if (cancel || active.moved) { suppressClick.current = true; window.setTimeout(() => { suppressClick.current = false; }, 0); }
    if (cancel || (active.kind === 'range' ? playing : locked)) return;
    if (!active.moved) {
      // A plain press in the count row positions the playhead.
      if (active.kind === 'range' && active.mode === 'create') {
        props.onTime(active.anchor);
        // Touch has no reliable dblclick: a second tap nearby selects the eight-count.
        if (active.touch) {
          const now = performance.now(), previous = lastTap.current;
          if (previous && now - previous.at <= DOUBLE_TAP_MS && Math.abs(previous.x - active.startX) <= DOUBLE_TAP_PIXELS) { lastTap.current = null; touchDoubleTap.current = now; selectOctetAtTime(active.anchor); }
          else lastTap.current = { at: now, x: active.startX };
        }
      }
      return;
    }
    if (active.kind === 'camera' && active.sourceTime !== active.targetTime) camera.onMove(active.sourceTime, active.targetTime);
    else if (active.kind === 'audio' && active.trackId) { if (active.sourceOffset !== active.targetOffset) audioTracks.onMove(active.trackId, active.targetOffset); }
    else if (active.kind === 'trim') { if (active.sourceValue !== active.targetValue) audioTracks.onTrim(active.trackId, active.index, active.edge, active.targetValue); }
    else if (active.kind === 'audio' && !audio.disabled && active.sourceOffset !== active.targetOffset) audio.onMove(active.targetOffset);
    else if (active.kind === 'range') props.onRange(active.target);
  }
  const dragHandlers = {
    onPointerMove: moveDrag,
    onPointerUp: (event: ReactPointerEvent<HTMLElement>) => { if (event.pointerId === dragRef.current?.pointerId) finishDrag(); },
    onPointerCancel: () => finishDrag(true),
    onLostPointerCapture: (event: ReactPointerEvent<HTMLElement>) => { if (event.pointerId === dragRef.current?.pointerId) finishDrag(true); },
  };
  const trackSignature = audioTracks.tracks.map(track => `${track.id}:${track.offsetSeconds}:${track.missing}:${audioTrackSegments(track).map(segment => `${segment.startSeconds}-${segment.endSeconds}`).join(',')}`).join('|');
  useEffect(() => { finishDrag(true); }, [locked, audio.offsetSeconds, audio.name, audio.disabled, trackSignature, camera.track, duration]);
  useEffect(() => { if (selectedTrack && !audioTracks.tracks.some(track => track.id === selectedTrack)) setSelectedTrack(null); }, [audioTracks.tracks, selectedTrack]);
  function selectTrack(id: string | null, segment = 0) { setSelectedTrack(id); setSelectedSegment(segment); }
  useEffect(() => () => { const active = dragRef.current; if (active?.element.hasPointerCapture(active.pointerId)) active.element.releasePointerCapture(active.pointerId); if (scrollAnimation.current !== null) cancelAnimationFrame(scrollAnimation.current); }, []);

  function beginRange(event: ReactPointerEvent<HTMLDivElement>) {
    if ((event.target as Element).closest('button')) return;
    const lane = event.currentTarget;
    const anchor = snapToCounts(Math.max(0, Math.min(duration, timelineTimeAtX(laneContentX(lane, event.clientX), lane.getBoundingClientRect().width, duration))), lane.getBoundingClientRect().width);
    beginDrag(event, { kind: 'range', mode: 'create', anchor, source: range, target: range });
  }
  /** Double-clicking an eight-count in the count row selects that whole phrase. */
  function selectOctetAt(event: React.MouseEvent<HTMLDivElement>) {
    if (playing || fromTouchDoubleTap() || (event.target as Element).closest('button')) return;
    const rect = event.currentTarget.getBoundingClientRect();
    selectOctetAtTime(timelineTimeAtX(event.clientX - rect.left, rect.width, duration));
  }
  function fromTouchDoubleTap() { return performance.now() - touchDoubleTap.current < 600; }
  function selectOctetAtTime(at: number) {
    const octet = octets.find(item => at >= item.start && at < item.end) ?? octets.at(-1);
    if (octet) props.onRange({ start: snap(octet.start), end: snap(octet.end) });
  }

  // ── Panning and ruler scrubbing ───────────────────────────────────────────
  function beginPan(event: ReactPointerEvent<HTMLDivElement>) {
    if (!event.isPrimary || event.button !== 0 || dragRef.current || panRef.current || scrubRef.current || pinchRef.current || !(event.target instanceof HTMLDivElement) || !event.target.classList.contains('tl-pannable')) return;
    panRef.current = { pointerId: event.pointerId, startX: event.clientX, startScroll: event.currentTarget.scrollLeft, moved: false };
  }
  function movePan(event: ReactPointerEvent<HTMLDivElement>) {
    const pan = panRef.current;
    if (!pan || pan.pointerId !== event.pointerId) return;
    const delta = event.clientX - pan.startX;
    if (!pan.moved && Math.abs(delta) < 4) return;
    event.preventDefault();
    if (!pan.moved) { event.currentTarget.setPointerCapture(event.pointerId); pan.moved = true; setPanning(true); }
    event.currentTarget.scrollLeft = pan.startScroll - delta;
  }
  function finishPan(cancel = false) {
    const pan = panRef.current;
    if (!pan) return;
    panRef.current = null; setPanning(false);
    if (viewport.current?.hasPointerCapture(pan.pointerId)) viewport.current.releasePointerCapture(pan.pointerId);
    if (pan.moved || cancel) { suppressClick.current = true; window.setTimeout(() => { suppressClick.current = false; }, 0); }
  }
  function scrubAt(element: HTMLInputElement, clientX: number) { const rect = element.parentElement!.getBoundingClientRect(); props.onTime(Math.max(0, Math.min(duration, timelineTimeAtX(clientX - rect.left, rect.width, duration)))); }
  function beginScrub(event: ReactPointerEvent<HTMLInputElement>) {
    if (!event.isPrimary || event.button !== 0 || playing || dragRef.current || panRef.current || scrubRef.current || pinchRef.current) return;
    event.preventDefault(); event.stopPropagation(); scrubRef.current = { pointerId: event.pointerId, element: event.currentTarget }; setScrubbing(true); event.currentTarget.setPointerCapture(event.pointerId); scrubAt(event.currentTarget, event.clientX);
  }
  function finishScrub() { const scrub = scrubRef.current; if (!scrub) return; scrubRef.current = null; setScrubbing(false); if (scrub.element.hasPointerCapture(scrub.pointerId)) scrub.element.releasePointerCapture(scrub.pointerId); }
  useEffect(() => { if (locked) { finishPan(true); finishScrub(); } }, [locked]);

  // ── Touch pinch, trackpad gestures and keyboard zoom ──────────────────────
  /** Anchor a zoom so the content fraction stays under viewport X (relative to the lane area). */
  function zoomAround(nextZoom: number, fraction: number, clientX: number) {
    const container = viewport.current;
    if (!container) return;
    const x = Math.max(0, Math.min(geometry.visibleWidth, clientX - container.getBoundingClientRect().left - geometry.labelWidth));
    const bounded = Math.max(0, Math.min(100, nextZoom));
    zoomAnchor.current = { fraction, x };
    if (bounded === zoom) { container.scrollLeft = timelineAnchorAtFraction(fraction, timeWidth, x, geometry.visibleWidth); zoomAnchor.current = null; }
    else setZoom(bounded);
  }
  function fractionAt(clientX: number) {
    const container = viewport.current!;
    const x = Math.max(0, Math.min(geometry.visibleWidth, clientX - container.getBoundingClientRect().left - geometry.labelWidth));
    return Math.max(0, Math.min(1, (container.scrollLeft + x) / timeWidth));
  }
  function touchDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.pointerType !== 'touch') return;
    touches.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (touches.current.size !== 2 || pinchRef.current || !viewport.current) return;
    // A second finger turns any pending one-finger gesture into a pinch; the
    // first gesture is cancelled, never committed.
    finishDrag(true); finishPan(true); finishScrub();
    const [[idA, a], [idB, b]] = [...touches.current.entries()];
    pinchRef.current = { ids: [idA, idB], startDistance: Math.hypot(a.x - b.x, a.y - b.y), startWidth: timeWidth, fraction: fractionAt((a.x + b.x) / 2) };
    lastTap.current = null; setPinching(true);
    event.preventDefault(); event.stopPropagation();
  }
  function touchMove(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.pointerType !== 'touch' || !touches.current.has(event.pointerId)) return;
    touches.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const pinch = pinchRef.current;
    if (!pinch) return;
    event.preventDefault(); event.stopPropagation();
    const a = touches.current.get(pinch.ids[0]), b = touches.current.get(pinch.ids[1]);
    if (!a || !b) return;
    // Spreading zooms; moving both fingers together also pans the midpoint.
    zoomAround(timelinePinchZoom(geometry.visibleWidth, duration, pinch.startWidth, pinch.startDistance, Math.hypot(a.x - b.x, a.y - b.y)), pinch.fraction, (a.x + b.x) / 2);
  }
  function touchUp(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.pointerType !== 'touch') return;
    touches.current.delete(event.pointerId);
    const pinch = pinchRef.current;
    if (pinch && pinch.ids.includes(event.pointerId)) {
      pinchRef.current = null; setPinching(false);
      suppressClick.current = true; window.setTimeout(() => { suppressClick.current = false; }, 0);
    }
  }
  useEffect(() => {
    // Safari: trackpad pinch (macOS) and touch pinch (iPad) arrive as gesture
    // events. Always keep them from zooming the page; touch pinches are
    // already handled through pointer events above.
    const container = viewport.current;
    if (!container) return;
    let start: { width: number; fraction: number } | null = null;
    type Gesture = Event & { scale: number; clientX?: number };
    const centre = (event: Gesture) => event.clientX ?? container.getBoundingClientRect().left + geometry.labelWidth + geometry.visibleWidth / 2;
    const begin = (event: Event) => { event.preventDefault(); start = touches.current.size ? null : { width: timeWidth, fraction: fractionAt(centre(event as Gesture)) }; };
    const change = (event: Event) => {
      event.preventDefault();
      const gesture = event as Gesture;
      if (!start || touches.current.size || dragRef.current || panRef.current || scrubRef.current || !Number.isFinite(gesture.scale)) return;
      zoomAround(timelineZoomAtWidth(geometry.visibleWidth, duration, start.width * gesture.scale), start.fraction, centre(gesture));
    };
    const finish = (event: Event) => { event.preventDefault(); start = null; };
    container.addEventListener('gesturestart', begin);
    container.addEventListener('gesturechange', change);
    container.addEventListener('gestureend', finish);
    return () => { container.removeEventListener('gesturestart', begin); container.removeEventListener('gesturechange', change); container.removeEventListener('gestureend', finish); };
  });
  useEffect(() => {
    // = / - zoom around the playhead; backslash fits the whole scene (also with a
    // hardware keyboard on iPad). Focused controls and dialogs keep their keys.
    const keydown = (event: globalThis.KeyboardEvent) => {
      if (!expanded || event.defaultPrevented || event.isComposing || event.ctrlKey || event.metaKey || event.altKey
        || document.querySelector('[aria-modal="true"]') || isInteractiveTarget(document.activeElement) || event.composedPath().some(isInteractiveTarget)) return;
      const step = event.key === '=' || event.key === '+' ? 10 : event.key === '-' || event.key === '_' ? -10 : 0;
      if (step) { event.preventDefault(); changeZoom(zoom + step); }
      else if (event.key === '\\') { event.preventDefault(); changeZoom(0); }
    };
    window.addEventListener('keydown', keydown);
    return () => window.removeEventListener('keydown', keydown);
  });
  useEffect(() => {
    const keydown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (dragRef.current || panRef.current || scrubRef.current) { event.preventDefault(); event.stopPropagation(); finishDrag(true); finishPan(true); finishScrub(); }
    };
    const closeMenus = (event: PointerEvent) => {
      if (moreDisclosure.current?.open && !moreDisclosure.current.contains(event.target as Node)) moreDisclosure.current.open = false;
    };
    const release = (event: PointerEvent) => { if (panRef.current?.pointerId === event.pointerId) finishPan(event.type === 'pointercancel'); };
    document.addEventListener('keydown', keydown, true);
    document.addEventListener('pointerdown', closeMenus, true);
    document.addEventListener('pointerup', release, true);
    document.addEventListener('pointercancel', release, true);
    return () => { document.removeEventListener('keydown', keydown, true); document.removeEventListener('pointerdown', closeMenus, true); document.removeEventListener('pointerup', release, true); document.removeEventListener('pointercancel', release, true); };
  });

  // ── Lane clicks and camera navigation ─────────────────────────────────────
  function seekLane(event: React.MouseEvent<HTMLDivElement>) {
    if (playing || suppressClick.current || (event.target as Element).closest('button')) return;
    const rect = event.currentTarget.getBoundingClientRect();
    props.onTime(Math.max(0, Math.min(duration, timelineTimeAtX(event.clientX - rect.left, rect.width, duration))));
  }
  function selectCamera(nextTime: number, inspect = false) {
    if (playing || suppressClick.current || dragRef.current) return;
    camera.onSelect(nextTime);
    if (inspect) setInspectorOpen(true);
  }
  function seekCameraLane(event: React.MouseEvent<HTMLDivElement>, inspect = false) {
    if (playing || suppressClick.current || (event.target as Element).closest('button')) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const requested = Math.max(0, Math.min(duration, timelineTimeAtX(event.clientX - rect.left, rect.width, duration)));
    const nearest = cameraTimes.length ? cameraTimes[nearestIndex(cameraTimes, requested)] : undefined;
    // Clicking the camera lane positions time only; the explicit camera
    // selection (record mode) stays as the user left it.
    const target = nearest !== undefined && Math.abs(timelineXAtTime(nearest, rect.width, duration) - (event.clientX - rect.left)) <= SNAP_PIXELS ? nearest : requested;
    if (camera.selected || inspect) selectCamera(target, inspect); else props.onTime(target);
  }
  function stepCamera(direction: -1 | 1) {
    if (!cameraTimes.length) return;
    const target = direction < 0 ? cameraTimes.filter(key => key < time - 1e-9).at(-1) : cameraTimes.find(key => key > time + 1e-9);
    if (target !== undefined) selectCamera(target);
  }
  function cameraLaneKeys(event: KeyboardEvent<HTMLElement>) {
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); event.stopPropagation(); stepCamera(event.key === 'ArrowLeft' ? -1 : 1); }
    else if (event.key === 'Enter') { event.preventDefault(); event.stopPropagation(); selectCamera(time, true); }
  }

  // ── Render ────────────────────────────────────────────────────────────────
  const pixelsPerFrame = timeWidth / end;
  const tickStep = timelineMajorTickFrames(pixelsPerFrame);
  const ticks = Array.from({ length: Math.floor(end / tickStep) + 1 }, (_, i) => i * tickStep).filter(tick => tick < end);
  const gestureActive = !!drag || panning || scrubbing || pinching;
  const shownRange = drag?.kind === 'range' && drag.moved ? drag.target : range;
  const rangeStyle = shownRange ? { left: `${position(shownRange.start)}%`, width: `${position(shownRange.end) - position(shownRange.start)}%` } : undefined;
  const rangeShade = shownRange && <span className="tl-range-shade" style={rangeStyle} aria-hidden="true" />;
  const audioOffset = drag?.kind === 'audio' && !drag.trackId ? drag.targetOffset : audio.offsetSeconds;
  const audioLeft = timelineXAtTime(audioOffset, timeWidth, duration);
  const audioWidth = timelineXAtTime(audioOffset + audio.durationSeconds, timeWidth, duration) - audioLeft;
  const inRange = !!range && time >= range.start - 1e-9 && time <= range.end + 1e-9;
  const trackIndex = selectedTrack ? audioTracks.tracks.findIndex(track => track.id === selectedTrack) : -1;
  const shownTrack = trackIndex >= 0 ? audioTracks.tracks[trackIndex] : null;
  const shownSegments = shownTrack ? audioTrackSegments(shownTrack) : [];
  const shownSegmentIndex = Math.min(selectedSegment, Math.max(0, shownSegments.length - 1));
  const shownSegment = shownSegments[shownSegmentIndex];
  const canSplit = !!shownTrack && !shownTrack.missing && !!splitAudioTrack(shownTrack, time);
  const navigate = (next: number) => { if (!playing) props.onTime(Math.max(0, Math.min(duration, next))); };

  return <section className={`tl-timeline ${expanded ? '' : 'tl-collapsed'}`} aria-label="场景时间线" data-time={time} data-frame={frame}>
    <div className="tl-toolbar">
      <div className="tl-transport">
        <button className="icon-button" aria-label={range ? '跳到选区起点' : '跳到开头'} title={range ? '跳到选区起点（Home）' : '跳到开头（Home）'} disabled={playing} onClick={() => navigate(range && time > range.start + 1e-9 ? range.start : 0)}><SkipBack size={13} /></button>
        {props.transport}
        <button className="icon-button" aria-label={range ? '跳到选区终点' : '跳到结尾'} title={range ? '跳到选区终点（End）' : '跳到结尾（End）'} disabled={playing} onClick={() => navigate(range && time < range.end - 1e-9 ? range.end : duration)}><SkipForward size={13} /></button>
      </div>
      <div className="tl-frame-controls">
        <button className="icon-button" aria-label="上一帧" title="上一帧（←；Shift+← 上一拍）" disabled={frame === 0 || playing} onClick={() => navigate(frameTime(frame - 1, duration))}><ChevronLeft size={14} /></button>
        <label>帧<input aria-label="当前帧" type="number" min={0} max={end} step={1} value={frame} disabled={playing} onChange={event => { if (!event.target.value.trim()) return; const next = Number(event.target.value); if (Number.isFinite(next)) navigate(frameTime(Math.max(0, Math.min(end, Math.round(next))), duration)); }} /></label>
        <button className="icon-button" aria-label="下一帧" title="下一帧（→；Shift+→ 下一拍）" disabled={frame === end || playing} onClick={() => navigate(frameTime(frame + 1, duration))}><ChevronRight size={14} /></button>
      </div>
      <div className="tl-range-controls" role="group" aria-label="时间选区">
        <button aria-label="设为选区起点" title="以当前帧为选区起点（I）" disabled={playing} onClick={() => props.onRange({ start: time, end: range && range.end > time ? range.end : duration })}>起点</button>
        <button aria-label="设为选区终点" title="以当前帧为选区终点（O）" disabled={playing} onClick={() => props.onRange({ start: range && range.start < time ? range.start : 0, end: time })}>终点</button>
        <output className={`tl-range-readout ${range ? 'active' : ''}`} aria-label="当前选区" title={range ? '选区用于循环播放；未来 AI 只修改这一段人物动作' : '在节拍行拖动选择时间段，双击八拍选中整段'}>{range ? `${seconds(range.start)}–${seconds(range.end)} · ${seconds(range.end - range.start)}` : '未选区'}</output>
        <button className={`tl-loop ${props.loop ? 'active' : ''}`} aria-label={range ? '循环选区' : '循环整段'} aria-pressed={props.loop} title={range ? '循环播放选区' : '循环整段'} onClick={props.onLoop}><Repeat2 size={13} /></button>
        {range && <button aria-label="缩放到选区" title="把选区放大到可见宽度" disabled={gestureActive} onClick={zoomToRange}><Maximize2 size={12} /></button>}
        {range && <button aria-label="清除选区" title="清除选区（Esc）" disabled={playing} onClick={() => props.onRange(null)}><X size={12} /></button>}
      </div>
      {expanded && <div className="tl-zoom-controls" aria-label="时间线视图缩放">
        <button className={zoom === 0 ? 'active' : ''} aria-label="适合整段时间线" disabled={gestureActive} onClick={() => changeZoom(0)}>全段</button>
        <input aria-label="时间线缩放" title="缩放：双指捏合、Ctrl/⌘+滚轮或 = / -；\ 显示全段" aria-valuetext={`每帧间距 ${pixelsPerFrame.toFixed(2)} 像素`} type="range" min={0} max={100} step={.5} value={zoom} disabled={gestureActive} onChange={event => changeZoom(Number(event.target.value))} />
        <button className={zoom === 100 ? 'active' : ''} aria-label="逐帧查看时间线" disabled={gestureActive} onClick={() => changeZoom(100)}>逐帧</button>
      </div>}
      <details ref={moreDisclosure} className="tl-more" aria-label="更多时间线选项"><summary title="时间线选项">时间线选项</summary><div className="tl-popover">
        {props.playbackOptions}
        <p>时间线包含音乐（可添加多条音轨）与镜头轨。人物动作由 AI 生成；在节拍行拖动可选择起止时间，双击某个八拍可整段选中，选区用于循环播放，并将作为 AI 只修改这一段的范围。</p>
        <p>拖动音乐片段对齐节拍；音乐轨的“＋”可导入更多音频，每个文件放在独立音轨上，可分别拖动、静音或删除。选中音轨后可在播放头处“分割”，拖动片段两端可裁剪，裁掉的部分不会播放。选中镜头轨后拖动画面会在当前时间记录镜头，“＋”在当前时间记录当前视角，菱形可拖动改时间。</p>
        <p>快捷键：Space 播放，←/→ 逐帧，Shift+←/→ 逐拍，Home/End 起止，I/O 设选区，Esc 清除选区，Delete 删除选中镜头关键帧，Ctrl/⌘+滚轮缩放。</p>
      </div></details>
      <button className="tl-collapse" aria-label={expanded ? '收起时间线' : '展开时间线'} aria-expanded={expanded} title={expanded ? '收起时间线' : '展开时间线'} onClick={() => { finishDrag(true); finishPan(true); finishScrub(); setExpanded(!expanded); }}>{expanded ? <ChevronDown size={16} /> : <ChevronUp size={16} />}</button>
    </div>
    {expanded && <div ref={viewport} className={`tl-viewport ${panning ? 'tl-panning' : ''}`} aria-label="分轨时间线" onPointerDown={beginPan} onPointerMove={movePan}
      onPointerDownCapture={touchDown} onPointerMoveCapture={touchMove} onPointerUpCapture={touchUp} onPointerCancelCapture={touchUp}
      onPointerUp={event => { if (event.pointerId === panRef.current?.pointerId) finishPan(); }} onPointerCancel={event => { if (event.pointerId === panRef.current?.pointerId) finishPan(true); }}
      onScroll={() => { if (dragRef.current?.moved) updateDrag(dragRef.current); }}>
      <div className="tl-lanes" data-pixels-per-frame={pixelsPerFrame} style={{ width: `${geometry.labelWidth + timeWidth}px`, '--tl-minor-spacing': `${pixelsPerFrame >= 8 ? pixelsPerFrame : 1000000}px`, '--tl-major-spacing': `${pixelsPerFrame * tickStep}px` } as CSSProperties}>
        <span className={`tl-playhead ${playing ? 'playing' : ''}`} style={{ left: `${geometry.labelWidth + timelineXAtTime(time, timeWidth, duration)}px` }} aria-hidden="true" />
        <div className="tl-ruler-row"><div ref={rulerLabel} className="tl-lane-label">时间</div><div className="tl-ruler">
          <div className="tl-ruler-ticks" aria-hidden="true">{ticks.map(tick => <span key={tick} style={{ left: `${tick / end * 100}%` }}>{tickStep < 30 ? `${tick}f` : `${Number((tick / 30).toFixed(2))}s`}</span>)}<span className="tl-end-tick" style={{ left: '100%' }}>{tickStep < 30 ? `${end}f` : `${duration}s`}</span></div>
          {rangeShade}
          <input aria-label="时间线进度" type="range" min={0} max={duration} step="any" value={time} disabled={playing} onChange={event => props.onTime(Number(event.target.value))} onPointerDown={beginScrub}
            onPointerMove={event => { if (scrubRef.current?.pointerId === event.pointerId) { event.preventDefault(); scrubAt(event.currentTarget, event.clientX); } }}
            onPointerUp={event => { if (event.pointerId === scrubRef.current?.pointerId) finishScrub(); }} onPointerCancel={event => { if (event.pointerId === scrubRef.current?.pointerId) finishScrub(); }}
            onLostPointerCapture={event => { if (event.pointerId === scrubRef.current?.pointerId) finishScrub(); }} />
          <span className="tl-ruler-playhead" style={{ left: `${position(time)}%` }} aria-hidden="true" />
        </div></div>
        <div className="tl-lane tl-count-lane" data-track-id="counts" aria-label="节拍与选区">
          <div className="tl-lane-label" title="拖动选择时间段；双击八拍整段选中">节拍</div>
          <div className="tl-lane-track tl-count-track" data-range-start={range?.start} data-range-end={range?.end} onPointerDown={beginRange} onDoubleClick={selectOctetAt} {...dragHandlers}>
            {octets.map(octet => <span key={octet.index} className="tl-octet" style={{ left: `${position(octet.start)}%`, width: `${position(octet.end) - position(octet.start)}%` }} aria-hidden="true">{octet.index + 1}</span>)}
            {shownRange && <span className={`tl-range ${inRange ? 'contains-playhead' : ''}`} style={rangeStyle}>
              <button className="tl-range-body" aria-label="拖动移动选区" title="拖动移动选区；双击缩放到选区" disabled={playing} onPointerDown={event => range && beginDrag(event, { kind: 'range', mode: 'move', anchor: range.start, source: range, target: range })} onDoubleClick={() => { if (!fromTouchDoubleTap()) zoomToRange(); }} {...dragHandlers} />
              <button className="tl-range-handle start" aria-label="拖动选区起点" disabled={playing} onPointerDown={event => range && beginDrag(event, { kind: 'range', mode: 'start', anchor: range.end, source: range, target: range })} {...dragHandlers} />
              <button className="tl-range-handle end" aria-label="拖动选区终点" disabled={playing} onPointerDown={event => range && beginDrag(event, { kind: 'range', mode: 'end', anchor: range.start, source: range, target: range })} {...dragHandlers} />
            </span>}
          </div>
        </div>
        <div className="tl-lane tl-audio-lane" data-track-id="audio" aria-label="音乐轨道"><div className="tl-lane-label"><Music2 size={11} /><span className="tl-lane-name">音乐</span>
            <button className="tl-add-key" aria-label="添加音轨" title={audioTracks.canAdd ? '导入另一个音频文件，放在新的音轨上（当前时间起）' : '音轨数量已达上限'} disabled={locked || !audioTracks.canAdd} onClick={() => trackFile.current?.click()}><Plus size={11} /></button>
            <input ref={trackFile} type="file" accept="audio/*" hidden aria-label="选择音轨音频文件" onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) audioTracks.onAdd(file); }} />
          </div>
          <div className="tl-lane-track tl-pannable tl-audio-content" onClick={seekLane}>
            {rangeShade}
            <button className={`tl-audio-clip ${drag?.kind === 'audio' && drag.moved ? 'dragging' : ''}`} aria-label="移动音频片段" title={`${audio.name} · 拖动对齐音乐`} disabled={locked || audio.disabled} data-offset-seconds={audioOffset} data-duration-seconds={audio.durationSeconds}
              style={{ left: `${audioLeft / timeWidth * 100}%`, width: `${audioWidth / timeWidth * 100}%` }} onPointerDown={event => beginDrag(event, { kind: 'audio', sourceOffset: audio.offsetSeconds, targetOffset: audio.offsetSeconds })} {...dragHandlers} onClick={event => event.stopPropagation()}>
              <svg className="tl-waveform" viewBox={`0 0 ${Math.max(wave.length, 1)} 24`} preserveAspectRatio="none" aria-hidden="true">{wave.map((value, index) => { const amplitude = Math.max(.5, Math.min(1, Math.abs(value)) * 11); return <line key={index} x1={index + .5} x2={index + .5} y1={12 - amplitude} y2={12 + amplitude} />; })}</svg>
              <span className="tl-audio-name" style={{ left: `${audioWidth > 0 ? Math.max(0, -audioLeft) / audioWidth * 100 : 0}%` }}>{drag?.kind === 'audio' && drag.moved ? `${audioOffset > 0 ? '+' : ''}${audioOffset.toFixed(3)} s` : audio.name}</span>
            </button>
          </div>
        </div>
        {audioTracks.tracks.map((track, index) => {
          const moving = drag?.kind === 'audio' && drag.trackId === track.id;
          const trimming = drag?.kind === 'trim' && drag.trackId === track.id ? drag : null;
          const offset = moving ? drag.targetOffset : track.offsetSeconds;
          const segments = audioTrackSegments(track).map((segment, at) => trimming?.index === at ? { ...segment, [trimming.edge === 'start' ? 'startSeconds' : 'endSeconds']: trimming.targetValue } : segment);
          const percent = (at: number) => timelineXAtTime(at, timeWidth, duration) / timeWidth * 100;
          const trackWave = track.waveform.filter(Number.isFinite).slice(0, 160);
          const number = index + 2;
          const trimmed = segments.length > 1 || segments[0].startSeconds > 0 || segments[0].endSeconds < track.durationSeconds;
          return <div key={track.id} className={`tl-lane tl-audio-lane tl-extra-audio ${selectedTrack === track.id ? 'selected' : ''} ${track.muted ? 'muted' : ''}`} data-track-id={`audio-${track.id}`} aria-label={`音轨 ${number}`}>
            <div className="tl-lane-label">
              <button className="tl-track-select" aria-label={`选择音轨 ${number}`} aria-pressed={selectedTrack === track.id} title={`${track.name}${track.missing ? ' · 音频缺失' : ''}`} onClick={() => selectTrack(selectedTrack === track.id ? null : track.id)}><Music2 size={11} /><span>音轨{number}</span></button>
              <button className="tl-add-key" aria-label={track.muted ? `取消静音音轨 ${number}` : `静音音轨 ${number}`} aria-pressed={track.muted} title={track.muted ? '取消静音' : '静音'} disabled={locked} onClick={() => audioTracks.onToggleMute(track.id)}>{track.muted ? <VolumeX size={11} /> : <Volume2 size={11} />}</button>
            </div>
            <div className="tl-lane-track tl-pannable tl-audio-content" onClick={seekLane}>
              {rangeShade}
              {trimmed && <span className="tl-audio-ghost" style={{ left: `${percent(offset)}%`, width: `${percent(offset + track.durationSeconds) - percent(offset)}%` }} aria-hidden="true" />}
              {segments.map((segment, at) => {
                const left = percent(offset + segment.startSeconds), right = percent(offset + segment.endSeconds);
                const bins = trackWave.length, from = bins * segment.startSeconds / track.durationSeconds, span = Math.max(bins * (segment.endSeconds - segment.startSeconds) / track.durationSeconds, 1e-3);
                const piece = segments.length > 1 ? ` ${at + 1}/${segments.length}` : '';
                const label = `${track.name}${track.missing ? '（缺失）' : ''}`;
                const sceneStart = offset + segment.startSeconds, sceneEnd = offset + segment.endSeconds;
                const handle = (edge: 'start' | 'end') => {
                  const value = edge === 'start' ? segment.startSeconds : segment.endSeconds;
                  const canTrim = !!audioSegmentTrimBounds(track, at, edge, duration);
                  return <button key={edge} className={`tl-trim-handle ${edge} ${trimming?.index === at && trimming.edge === edge && trimming.moved ? 'dragging' : ''}`} data-edge={edge} data-source-seconds={value}
                    aria-label={`裁剪音轨 ${number} 片段${piece}${edge === 'start' ? '起点' : '终点'}`} title={edge === 'start' ? '拖动裁剪开头；之前的音频不会播放' : '拖动裁剪结尾；之后的音频不会播放'}
                    disabled={locked || track.missing || !canTrim} style={{ left: `${edge === 'start' ? left : right}%` }}
                    onPointerDown={event => beginDrag(event, { kind: 'trim', trackId: track.id, index: at, edge, sourceValue: value, targetValue: value })} {...dragHandlers}
                    onClick={event => { event.stopPropagation(); selectTrack(track.id, at); }} />;
                };
                return [
                  <button key={`clip-${at}`} className={`tl-audio-clip ${moving && drag.moved ? 'dragging' : ''} ${trimming?.index === at && trimming.moved ? 'trimming' : ''} ${track.missing ? 'missing' : ''} ${selectedTrack === track.id && shownSegmentIndex === at ? 'selected' : ''}`}
                    aria-label={`移动音轨 ${number} 片段${piece}`} title={`${track.name}${track.missing ? ' · 音频缺失，请删除后重新添加' : ' · 拖动调整位置，拖动两端裁剪'}`} disabled={locked || track.missing}
                    data-offset-seconds={offset} data-duration-seconds={track.durationSeconds} data-segment-start={segment.startSeconds} data-segment-end={segment.endSeconds}
                    style={{ left: `${left}%`, width: `${right - left}%` }} onPointerDown={event => beginDrag(event, { kind: 'audio', trackId: track.id, sourceOffset: track.offsetSeconds, targetOffset: track.offsetSeconds })} {...dragHandlers} onClick={event => { event.stopPropagation(); selectTrack(track.id, at); }}>
                    <svg className="tl-waveform" viewBox={`${from} 0 ${span} 24`} preserveAspectRatio="none" aria-hidden="true">{trackWave.map((value, bin) => { const amplitude = Math.max(.5, Math.min(1, Math.abs(value)) * 11); return <line key={bin} x1={bin + .5} x2={bin + .5} y1={12 - amplitude} y2={12 + amplitude} />; })}</svg>
                    <span className="tl-audio-name" style={{ left: `${right > left ? Math.max(0, -left) / (right - left) * 100 : 0}%` }}>{moving && drag.moved ? `${offset > 0 ? '+' : ''}${offset.toFixed(3)} s` : trimming?.index === at && trimming.moved ? `${seconds(sceneStart)}–${seconds(sceneEnd)}` : label}</span>
                  </button>,
                  handle('start'), handle('end'),
                ];
              })}
            </div>
          </div>;
        })}
        <div className={`tl-lane tl-camera-lane ${camera.selected ? 'selected' : ''}`} data-track-id="camera" aria-label="镜头轨道">
          <div className="tl-lane-label">
            <button className="tl-track-select" aria-label="选择镜头轨道" aria-pressed={camera.selected} title={camera.selected ? '镜头录制中：调整画面会在当前时间记录' : '选中后调整画面会在当前时间记录镜头'} onClick={() => selectCamera(time)}><Camera size={11} /><span>镜头</span><span className="tl-key-count">{cameraKeys.length}</span></button>
            <button className="tl-add-key" aria-label="在当前时间记录镜头" title="在当前时间记录当前视角" disabled={locked} onClick={camera.onAdd}><Plus size={11} /></button>
          </div>
          <div className="tl-lane-track tl-pannable" data-key-count={cameraKeys.length} role="slider" tabIndex={playing ? -1 : 0} aria-label="镜头关键帧" aria-valuemin={0} aria-valuemax={duration} aria-valuenow={time}
            aria-valuetext={`${time} 秒 · ${cameraKey ? '镜头关键帧' : '无镜头关键帧'}`} onKeyDown={cameraLaneKeys} onClick={event => seekCameraLane(event)} onDoubleClick={event => seekCameraLane(event, true)}>
            {rangeShade}
            {cameraKeys.map(key => {
              const moving = drag?.kind === 'camera' && drag.sourceTime === key.time;
              const shownTime = moving ? drag.targetTime : key.time;
              return <button key={key.time} className={`tl-key ${sameTime(key.time, time) && camera.selected ? 'selected' : ''} ${moving && drag.moved ? 'dragging' : ''}`} data-time={key.time} data-camera-key="true" aria-label={`镜头${key.time} 秒关键帧`} title={`镜头 · ${key.time} 秒 · 拖动改时间，双击编辑数值`}
                style={{ left: `${position(shownTime)}%` }} disabled={playing} onPointerDown={event => beginDrag(event, { kind: 'camera', sourceTime: key.time, targetTime: key.time })} {...dragHandlers}
                onClick={event => { event.stopPropagation(); selectCamera(key.time); }} onDoubleClick={event => { event.stopPropagation(); selectCamera(key.time, true); }}><Diamond size={9} fill="currentColor" />{moving && drag.moved && <span className="tl-drag-time">{Number(shownTime.toFixed(6))} 秒</span>}</button>;
            })}
          </div>
        </div>
      </div>
    </div>}
    {shownTrack && <div className="tl-camera-bar tl-track-bar" role="group" aria-label="音轨设置">
      <span className="tl-camera-status"><Music2 size={12} />{`音轨 ${trackIndex + 2} · ${shownTrack.name}${shownSegments.length > 1 ? ` · 片段 ${shownSegmentIndex + 1}/${shownSegments.length}` : ''} · ${seconds(shownTrack.offsetSeconds + shownSegment.startSeconds)}–${seconds(shownTrack.offsetSeconds + shownSegment.endSeconds)}${shownTrack.missing ? ' · 音频缺失' : ''}`}</span>
      <button aria-label="在播放头处分割所选音轨" title={canSplit ? '在播放头处把片段分成两段' : '把播放头移到该音轨片段内部后可分割'} disabled={locked || !canSplit} onClick={() => audioTracks.onSplit(shownTrack.id)}><Scissors size={12} />分割</button>
      {shownSegments.length > 1 && <button className="tl-danger" aria-label="删除所选片段" title="只删除这一段；其余片段保持原位" disabled={locked || shownTrack.missing} onClick={() => audioTracks.onRemoveSegment(shownTrack.id, shownSegmentIndex)}><Trash2 size={12} />删片段</button>}
      <button aria-label={shownTrack.muted ? '取消静音所选音轨' : '静音所选音轨'} aria-pressed={shownTrack.muted} disabled={locked} onClick={() => audioTracks.onToggleMute(shownTrack.id)}>{shownTrack.muted ? <VolumeX size={12} /> : <Volume2 size={12} />}{shownTrack.muted ? '取消静音' : '静音'}</button>
      <button className="tl-danger" aria-label="删除所选音轨" disabled={locked} onClick={() => audioTracks.onRemove(shownTrack.id)}><Trash2 size={12} />删除</button>
      <button aria-label="关闭音轨设置" onClick={() => selectTrack(null)}>完成</button>
    </div>}
    {camera.selected && <div className="tl-camera-bar" role="group" aria-label="镜头关键帧">
      <span className="tl-camera-status"><Camera size={12} />{playing ? '镜头轨 · 播放中' : cameraKey ? `镜头关键帧 ${cameraTimes.indexOf(time) + 1} / ${cameraTimes.length} · ${seconds(time)}` : `镜头录制 · ${seconds(time)} · 调整画面即记录`}</span>
      <button aria-label="编辑镜头数值" aria-expanded={inspectorOpen} disabled={playing} onClick={() => setInspectorOpen(!inspectorOpen)}>数值</button>
      {cameraKey && <button className="tl-danger" aria-label="删除镜头关键帧" disabled={locked} onClick={camera.onDelete}><Trash2 size={12} />删除</button>}
      <button aria-label="结束镜头录制" title="结束录制；之后调整画面只改变观看视角" onClick={() => { setInspectorOpen(false); camera.onDeselect(); }}>完成</button>
      {inspectorOpen && <div className="tl-popover tl-camera-popover"><CameraValues time={time} value={camera.value} keyTime={cameraKey?.time} duration={duration} disabled={locked} onChange={camera.onChange} onMove={camera.onMove} /></div>}
    </div>}
  </section>;
}
