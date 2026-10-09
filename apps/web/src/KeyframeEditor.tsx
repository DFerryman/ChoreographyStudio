import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { ChevronDown, ChevronUp, ChevronLeft, ChevronRight, Diamond, Minus, Music2, Plus, Trash2 } from 'lucide-react';
import { EDITABLE_JOINT_NAMES, frameTime, lastFrame, sampleTake, type BakedTake, type JointName, type KeyframeSequence, type KeyframeTransferRequest, type KeyframeTransferScope, type Quat, type Vec3 } from '../../../packages/core/src';
import { STAGE_JOINT_LABELS } from './Stage';
import { TIMELINE_MAX_FRAME_PIXELS, timelineAnchorAtFraction, timelineDragFrame, timelineEdgeScroll, timelineMajorTickFrames, timelineTimeAtX, timelineWidth, timelineXAtTime, timelineZoomAtWidth } from './timelineGeometry';
import './KeyframeEditor.css';

type Point = JointName | 'root';
const GROUPS: { id: string; label: string; joints: JointName[] }[] = [
  { id: 'body', label: '身体', joints: ['Hips', 'Spine', 'Chest', 'Neck', 'Head'] },
  { id: 'left-arm', label: '左臂', joints: ['LeftShoulder', 'LeftUpperArm', 'LeftForeArm', 'LeftHand', 'LeftHandTip'] },
  { id: 'right-arm', label: '右臂', joints: ['RightShoulder', 'RightUpperArm', 'RightForeArm', 'RightHand', 'RightHandTip'] },
  { id: 'left-leg', label: '左腿', joints: ['LeftUpperLeg', 'LeftLowerLeg', 'LeftFoot', 'LeftToe', 'LeftHeel'] },
  { id: 'right-leg', label: '右腿', joints: ['RightUpperLeg', 'RightLowerLeg', 'RightFoot', 'RightToe', 'RightHeel'] },
];
const pointLabel = (point: Point) => point === 'root' ? '整体位移' : STAGE_JOINT_LABELS[point];
const sameTime = (a: number, b: number) => Math.abs(a - b) < 1e-10;

/** Dense-track hit testing and sample navigation preserve exact source timestamps. */
function nearestIndex(times: number[], time: number): number {
  if (time <= times[0]) return 0;
  if (time >= times.at(-1)!) return times.length - 1;
  let low = 0, high = times.length - 1;
  while (high - low > 1) { const middle = (low + high) >>> 1; if (times[middle] <= time) low = middle; else high = middle; }
  return time - times[low] <= times[high] - time ? low : high;
}

type KeyframeTimelineProps = {
  sequence: KeyframeSequence;
  take?: BakedTake;
  frame: number;
  selectedTime?: number;
  selectedPoint?: Point | null;
  selectedJoint: JointName | null;
  onSelectPoint?: (time: number, point: Point) => void;
  onSelectJoint?: (joint: JointName) => void;
  onPointValueChange?: (time: number, point: Point, value: Vec3 | Quat) => void;
  onDeletePoint?: () => void;
  editStatus?: 'editing' | 'recorded';
  onFrame: (frame: number) => void;
  playing: boolean;
  mirror?: boolean;
  readOnly?: boolean;
  dirty: boolean;
  transport: ReactNode;
  playbackOptions: ReactNode;
  history?: ReactNode;
  audio?: { name: string; offsetSeconds: number; durationSeconds: number; waveform: number[]; onMove: (offsetSeconds: number) => void; disabled?: boolean };
  onTime: (time: number) => void;
  onTransferKeyframes: (request: Omit<KeyframeTransferRequest, 'collision'>) => void;
};

function PointValues({ point, time, value, sourceValue, sourceExact, pointBaseValue, pointBaseExact, manualValue, disabled, onChange }: {
  point: Point; time: number; value: Vec3 | Quat; sourceValue: Vec3 | Quat; sourceExact: boolean; pointBaseValue?: Vec3 | Quat; pointBaseExact: boolean; manualValue?: Vec3 | Quat; disabled: boolean;
  onChange?: KeyframeTimelineProps['onPointValueChange'];
}) {
  const signature = value.join(',');
  const [values, setValues] = useState<string[]>(value.map(String));
  const [error, setError] = useState('');
  const cancelled = useRef(false);
  useEffect(() => { setValues(value.map(String)); setError(''); }, [point, time, signature]);
  function commit() {
    if (cancelled.current) { cancelled.current = false; return; }
    if (disabled || !onChange) return;
    const parsed = values.map(text => text.trim() ? Number(text) : NaN);
    if (!parsed.every(Number.isFinite) || point !== 'root' && Math.hypot(...parsed) < Number.EPSILON) {
      setError('请输入有限数值，四元数不能全为 0。'); return;
    }
    setError('');
    if (parsed.some((component, index) => component !== value[index])) onChange(time, point, parsed as Vec3 | Quat);
  }
  return <div className="kf-point-values">
    <div className="kf-value-heading">{point === 'root' ? '世界位置 · m' : '局部旋转 · 四元数 XYZW'}<span>离开输入框自动记录</span></div>
    <div className="kf-value-fields">{values.map((component, index) => <label key={`${point}-${index}`}>{['X', 'Y', 'Z', 'W'][index]}<input aria-label={`${pointLabel(point)}${point === 'root' ? '位置' : '四元数'}${['X', 'Y', 'Z', 'W'][index]}`} type="number" step="any" value={component} disabled={disabled || !onChange} onChange={event => setValues(previous => previous.map((old, axis) => axis === index ? event.target.value : old))} onBlur={commit} onKeyDown={event => {
      if (event.key === 'Enter') event.currentTarget.blur();
      if (event.key === 'Escape') { event.stopPropagation(); cancelled.current = true; setValues(value.map(String)); setError(''); event.currentTarget.blur(); }
    }} /></label>)}</div>
    {error && <p className="kf-value-error" role="alert">{error}</p>}
    <details className="kf-source-values"><summary>{sourceExact ? '查看导入源值' : '查看源动画插值'}</summary><code>{sourceValue.map(String).join(' · ')}</code></details>
    {pointBaseValue && <details className="kf-source-values kf-point-base-values"><summary>{pointBaseExact ? '查看编辑前有效值' : '查看编辑前有效插值'}</summary><code>{pointBaseValue.map(String).join(' · ')}</code></details>}
    {manualValue && <details className="kf-source-values"><summary>查看原手动 K 值</summary><code>{manualValue.map(String).join(' · ')}</code></details>}
  </div>;
}

export function KeyframeTimeline(props: KeyframeTimelineProps) {
  const { sequence, frame, selectedJoint, onFrame, playing, mirror = false, readOnly = false, onTransferKeyframes, audio } = props;
  const take = props.take ?? sequence.pointBaseTake ?? sequence.baseTake;
  const duration = take.durationSeconds, end = lastFrame(duration);
  const time = props.selectedTime ?? frameTime(frame, duration);
  const selectedPoint = props.selectedPoint === undefined ? selectedJoint : props.selectedPoint;
  const selectedGroup = GROUPS.find(group => selectedPoint !== 'root' && selectedPoint && group.joints.includes(selectedPoint));
  const locked = playing || mirror || readOnly;
  const [expanded, setExpanded] = useState(true);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(() => new Set());
  const [zoom, setZoom] = useState(0);
  const [geometry, setGeometry] = useState({ visibleWidth: 1, labelWidth: 91 });
  const [panning, setPanning] = useState(false);
  const [scrubbing, setScrubbing] = useState(false);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const viewport = useRef<HTMLDivElement>(null);
  const rulerLabel = useRef<HTMLDivElement>(null);
  const panRef = useRef<{ pointerId: number; startX: number; startScroll: number; moved: boolean } | null>(null);
  const scrubRef = useRef<{ pointerId: number; element: HTMLInputElement } | null>(null);
  const scrollAnimation = useRef<number | null>(null);
  const zoomAnchor = useRef<{ fraction: number; x: number } | null>(null);
  const timeWidth = timelineWidth(geometry.visibleWidth, duration, zoom);
  const layoutRef = useRef({ geometry, timeWidth, time, duration });
  layoutRef.current = { geometry, timeWidth, time, duration };
  const position = (at: number) => timelineXAtTime(at, 100, duration);
  const moreDisclosure = useRef<HTMLDetailsElement>(null);
  const inspectorDisclosure = useRef<HTMLDetailsElement>(null);
  const pointEdits = sequence.pointEdits ?? [];
  const times = useMemo(() => [...new Set([...take.times, ...sequence.baseTake.times, ...(sequence.pointBaseTake?.times ?? []), ...sequence.root.map(key => frameTime(key.frame, duration)), ...Object.values(sequence.rotations).flatMap(keys => keys?.map(key => frameTime(key.frame, duration)) ?? []), ...pointEdits.map(edit => edit.time)])].sort((a, b) => a - b), [take, sequence, duration]);
  const sourceTimes = useMemo(() => new Set(sequence.baseTake.times), [sequence.baseTake]);
  const pointBaseTimes = useMemo(() => new Set(sequence.pointBaseTake?.times ?? []), [sequence.pointBaseTake]);
  // One SVG path per row avoids 130,000 DOM nodes; all points remain exact hit targets.
  const samplePaths = useMemo(() => {
    const paths = { source: '', evaluated: '' };
    for (const sampleTime of times) paths[sourceTimes.has(sampleTime) ? 'source' : 'evaluated'] += `M${timelineXAtTime(sampleTime, 10000, duration).toFixed(6)} 12h.01`;
    return paths;
  }, [times, sourceTimes, duration]);
  const sampleIndex = nearestIndex(times, time);
  const exactSample = sameTime(times[sampleIndex], time);
  const selectedPose = useMemo(() => sampleTake(take, time), [take, time]);
  const sourcePose = useMemo(() => sampleTake(sequence.baseTake, time), [sequence.baseTake, time]);
  const pointBasePose = useMemo(() => sequence.pointBaseTake ? sampleTake(sequence.pointBaseTake, time) : undefined, [sequence.pointBaseTake, time]);
  const wave = useMemo(() => audio?.waveform.filter(Number.isFinite).slice(0, 160) ?? [], [audio?.waveform]);
  type DragBase = { pointerId: number; element: HTMLButtonElement; startX: number; pointerX: number; startScroll: number; laneWidth: number; duration: number; moved: boolean };
  type KeyDrag = DragBase & { kind: 'key'; rowId: string; scope: KeyframeTransferScope; sourceFrame: number; targetFrame: number };
  type AudioDrag = DragBase & { kind: 'audio'; sourceOffset: number; targetOffset: number };
  type Drag = KeyDrag | AudioDrag;
  const [drag, setDrag] = useState<Drag | null>(null);
  const dragRef = useRef<Drag | null>(null);
  const suppressClick = useRef(false);
  const cancelledPointer = useRef<number | null>(null);
  function finishDrag(cancel = false) {
    const active = dragRef.current;
    if (!active) return;
    dragRef.current = null; setDrag(null);
    if (scrollAnimation.current !== null) cancelAnimationFrame(scrollAnimation.current);
    scrollAnimation.current = null;
    if (active.element.hasPointerCapture(active.pointerId)) active.element.releasePointerCapture(active.pointerId);
    if (cancel || active.moved) {
      suppressClick.current = true;
      if (cancel) cancelledPointer.current = active.pointerId;
      else window.setTimeout(() => { suppressClick.current = false; }, 0);
    }
    if (cancel || !active.moved || locked) return;
    if (active.kind === 'key' && active.sourceFrame !== active.targetFrame) onTransferKeyframes({ operation: 'move', scope: active.scope, sourceFrame: active.sourceFrame, targetFrame: active.targetFrame });
    else if (active.kind === 'audio' && audio && !audio.disabled && active.sourceOffset !== active.targetOffset) audio.onMove(active.targetOffset);
  }
  useEffect(() => { finishDrag(true); }, [sequence.id, sequence.baseTake.id, time, locked, audio?.offsetSeconds, audio?.name, audio?.disabled, audio?.durationSeconds]);
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
  useEffect(() => { setZoom(0); if (viewport.current) viewport.current.scrollLeft = 0; }, [sequence.baseTake.id]);
  useEffect(() => {
    if (selectedGroup) setExpandedGroups(previous => previous.has(selectedGroup.id) ? previous : new Set([...previous, selectedGroup.id]));
    if (selectedPoint) setExpanded(true);
  }, [selectedPoint]);
  useEffect(() => {
    if (!selectedPoint || playing || !expanded || dragRef.current || panRef.current || scrubRef.current) return;
    const nextPaint = requestAnimationFrame(() => {
      const container = viewport.current;
      const row = container?.querySelector<HTMLDivElement>(`[data-track-id="${selectedPoint}"]`);
      const point = row?.querySelector<HTMLButtonElement>('[data-selected-point="true"]');
      if (!container || !row || !point) return;
      const bounds = container.getBoundingClientRect(), rowBounds = row.getBoundingClientRect();
      if (rowBounds.top < bounds.top + 23) container.scrollTop -= bounds.top + 23 - rowBounds.top;
      else if (rowBounds.bottom > bounds.bottom) container.scrollTop += rowBounds.bottom - bounds.bottom;
      const pointBounds = point.getBoundingClientRect();
      const labelWidth = row.querySelector('.kf-lane-label')!.getBoundingClientRect().width;
      if (pointBounds.left < bounds.left + labelWidth + 8) container.scrollLeft -= bounds.left + labelWidth + 8 - pointBounds.left;
      else if (pointBounds.right > bounds.right - 8) container.scrollLeft += pointBounds.right - bounds.right + 8;
    });
    return () => cancelAnimationFrame(nextPaint);
  }, [selectedPoint, time, expanded, expandedGroups, playing, geometry.visibleWidth, geometry.labelWidth]);
  useEffect(() => {
    const cancel = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (!dragRef.current && event.target instanceof HTMLInputElement) return;
      if (dragRef.current || panRef.current || scrubRef.current) { event.preventDefault(); event.stopPropagation(); finishDrag(true); finishPan(true); finishScrub(); }
      else if (inspectorDisclosure.current?.open) { inspectorDisclosure.current.open = false; setInspectorOpen(false); }
      else if (moreDisclosure.current?.open && !document.querySelector('[aria-modal="true"]')) moreDisclosure.current.open = false;
    };
    const closeMore = (event: PointerEvent) => {
      if (event.isPrimary && !dragRef.current && !panRef.current && !scrubRef.current) { cancelledPointer.current = null; suppressClick.current = false; }
      if (moreDisclosure.current?.open && !moreDisclosure.current.contains(event.target as Node)) moreDisclosure.current.open = false;
      if (inspectorDisclosure.current?.open && !inspectorDisclosure.current.contains(event.target as Node)) { inspectorDisclosure.current.open = false; setInspectorOpen(false); }
    };
    const releaseCancelled = (event: PointerEvent) => { if (panRef.current?.pointerId === event.pointerId) finishPan(event.type === 'pointercancel'); if (cancelledPointer.current === event.pointerId) { cancelledPointer.current = null; window.setTimeout(() => { suppressClick.current = false; }, 0); } };
    document.addEventListener('keydown', cancel, true);
    document.addEventListener('pointerdown', closeMore, true);
    document.addEventListener('pointerup', releaseCancelled, true);
    document.addEventListener('pointercancel', releaseCancelled, true);
    return () => { document.removeEventListener('keydown', cancel, true); document.removeEventListener('pointerdown', closeMore, true); document.removeEventListener('pointerup', releaseCancelled, true); document.removeEventListener('pointercancel', releaseCancelled, true); };
  });
  useEffect(() => () => { const active = dragRef.current; if (active?.element.hasPointerCapture(active.pointerId)) active.element.releasePointerCapture(active.pointerId); if (scrollAnimation.current !== null) cancelAnimationFrame(scrollAnimation.current); }, []);
  function changeZoom(next: number, pointerX?: number) {
    const container = viewport.current;
    if (!container || dragRef.current || panRef.current || scrubRef.current) return;
    const bounded = Math.max(0, Math.min(100, next));
    if (bounded === zoom) return;
    let fraction = timelineXAtTime(time, 1, duration), x = fraction * timeWidth - container.scrollLeft;
    if (pointerX !== undefined) { x = Math.max(0, Math.min(geometry.visibleWidth, pointerX - container.getBoundingClientRect().left - geometry.labelWidth)); fraction = (container.scrollLeft + x) / timeWidth; }
    else if (x < 0 || x > geometry.visibleWidth) { x = geometry.visibleWidth / 2; fraction = (container.scrollLeft + x) / timeWidth; }
    zoomAnchor.current = { fraction, x }; setZoom(bounded);
  }
  useEffect(() => {
    const container = viewport.current;
    if (!container) return;
    const wheel = (event: WheelEvent) => { if (!event.ctrlKey && !event.metaKey) return; event.preventDefault(); changeZoom(zoom - Math.sign(event.deltaY) * 6, event.clientX); };
    container.addEventListener('wheel', wheel, { passive: false });
    return () => container.removeEventListener('wheel', wheel);
  }, [zoom, timeWidth, geometry, time, duration, expanded]);
  function updateDrag(active: Drag) {
    const pointerDelta = active.pointerX - active.startX;
    const scrollDelta = (viewport.current?.scrollLeft ?? active.startScroll) - active.startScroll;
    if (active.kind === 'key') active.targetFrame = timelineDragFrame(active.sourceFrame, pointerDelta, scrollDelta, active.laneWidth, lastFrame(active.duration));
    else { const sourceX = timelineXAtTime(active.sourceOffset, active.laneWidth, active.duration); const target = timelineTimeAtX(sourceX + pointerDelta + scrollDelta, active.laneWidth, active.duration); const bound = Math.max(0, Math.ceil(active.duration * 30) - 1) / 30; active.targetOffset = Math.max(-bound, Math.min(bound, Math.round(target * 30) / 30)); }
    setDrag({ ...active });
  }
  function scrollWhileDragging() {
    const active = dragRef.current, container = viewport.current;
    if (!active || !container) { scrollAnimation.current = null; return; }
    if (active.moved) { const rect = container.getBoundingClientRect(); const shift = timelineEdgeScroll(active.pointerX, rect.left + geometry.labelWidth, rect.left + container.clientWidth); if (shift) { const previous = container.scrollLeft; container.scrollLeft += shift; if (previous !== container.scrollLeft) updateDrag(active); } }
    scrollAnimation.current = requestAnimationFrame(scrollWhileDragging);
  }
  function beginDrag(event: ReactPointerEvent<HTMLButtonElement>, payload: Omit<KeyDrag, keyof DragBase> | Omit<AudioDrag, keyof DragBase>) {
    if (event.button !== 0 || !event.isPrimary || locked || dragRef.current || panRef.current || scrubRef.current || payload.kind === 'audio' && audio?.disabled) return;
    const lane = event.currentTarget.closest('.kf-lane-track');
    if (!lane) return;
    event.stopPropagation();
    const active = { ...payload, pointerId: event.pointerId, element: event.currentTarget, startX: event.clientX, pointerX: event.clientX, startScroll: viewport.current?.scrollLeft ?? 0, laneWidth: lane.getBoundingClientRect().width, duration, moved: false } as Drag;
    event.currentTarget.setPointerCapture(event.pointerId); dragRef.current = active; setDrag(active);
    scrollAnimation.current = requestAnimationFrame(scrollWhileDragging);
  }
  function moveDrag(event: ReactPointerEvent<HTMLButtonElement>) {
    const active = dragRef.current;
    if (!active || active.pointerId !== event.pointerId) return;
    active.pointerX = event.clientX;
    if (!active.moved && Math.abs(event.clientX - active.startX) < 4) return;
    event.preventDefault();
    active.moved = true; updateDrag(active);
  }
  function beginPan(event: ReactPointerEvent<HTMLDivElement>) {
    if (!event.isPrimary || event.button !== 0 || dragRef.current || panRef.current || scrubRef.current || !(event.target instanceof HTMLDivElement) || !event.target.classList.contains('kf-lane-track')) return;
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
    if (pan.moved) { suppressClick.current = true; if (cancel) cancelledPointer.current = pan.pointerId; else window.setTimeout(() => { suppressClick.current = false; }, 0); }
  }
  function scrubAt(element: HTMLInputElement, clientX: number) { const rect = element.parentElement!.getBoundingClientRect(); props.onTime(Math.max(0, Math.min(duration, timelineTimeAtX(clientX - rect.left, rect.width, duration)))); }
  function beginScrub(event: ReactPointerEvent<HTMLInputElement>) {
    if (!event.isPrimary || event.button !== 0 || playing || dragRef.current || panRef.current || scrubRef.current) return;
    event.preventDefault(); event.stopPropagation(); scrubRef.current = { pointerId: event.pointerId, element: event.currentTarget }; setScrubbing(true); event.currentTarget.setPointerCapture(event.pointerId); scrubAt(event.currentTarget, event.clientX);
  }
  function finishScrub() { const scrub = scrubRef.current; if (!scrub) return; scrubRef.current = null; setScrubbing(false); if (scrub.element.hasPointerCapture(scrub.pointerId)) scrub.element.releasePointerCapture(scrub.pointerId); }
  useEffect(() => { if (locked) { finishPan(true); finishScrub(); } }, [locked]);
  function selectPoint(nextTime: number, point: Point, inspect = false) {
    if (playing || suppressClick.current || dragRef.current) return;
    if (props.onSelectPoint) props.onSelectPoint(nextTime, point);
    else { if (point !== 'root') props.onSelectJoint?.(point); props.onTime(nextTime); }
    if (inspect) { setInspectorOpen(true); if (inspectorDisclosure.current) inspectorDisclosure.current.open = true; }
  }
  function seekLane(event: React.MouseEvent<HTMLDivElement>, point: Point, inspect = false) {
    if (playing || suppressClick.current || (event.target as Element).closest('button')) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const requestedTime = Math.max(0, Math.min(duration, timelineTimeAtX(event.clientX - rect.left, rect.width, duration)));
    const nearest = times[nearestIndex(times, requestedTime)];
    selectPoint(Math.abs(timelineXAtTime(nearest, rect.width, duration) - (event.clientX - rect.left)) <= 6 ? nearest : requestedTime, point, inspect);
  }
  function stepPoint(direction: -1 | 1, point: Point) {
    const nearest = nearestIndex(times, time);
    const index = exactSample ? nearest + direction : direction < 0 ? (times[nearest] < time ? nearest : nearest - 1) : (times[nearest] > time ? nearest : nearest + 1);
    if (index >= 0 && index < times.length) selectPoint(times[index], point);
  }
  function pointKeys(event: KeyboardEvent<HTMLElement>, point: Point) {
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); event.stopPropagation(); stepPoint(event.key === 'ArrowLeft' ? -1 : 1, point); }
    else if (event.key === 'Home' || event.key === 'End') { event.preventDefault(); event.stopPropagation(); selectPoint(event.key === 'Home' ? times[0] : times.at(-1)!, point); }
    else if (event.key === 'Enter') { event.preventDefault(); event.stopPropagation(); selectPoint(time, point, true); }
  }
  function toggleGroup(id: string) { finishDrag(true); finishPan(true); finishScrub(); setExpandedGroups(previous => { const next = new Set(previous); if (next.has(id)) next.delete(id); else next.add(id); return next; }); }
  function renderRow(id: string, label: string, rowFrames: number[], point: Point, scope: KeyframeTransferScope, options?: { child?: boolean; group?: boolean; joints?: JointName[] }) {
    const selected = options?.group ? selectedGroup?.id === id : selectedPoint === point;
    const rowEdits = pointEdits.filter(edit => options?.joints ? options.joints.some(joint => edit.joints?.[joint]) : point === 'root' ? edit.root : edit.joints?.[point]);
    const sparseTimes = new Set(rowFrames.map(keyFrame => frameTime(keyFrame, duration)));
    const selectedEdit = rowEdits.some(edit => sameTime(edit.time, time)) || sparseTimes.has(time);
    return <div key={id} className={`kf-lane ${selected ? 'selected' : ''} ${options?.child ? 'kf-joint-lane' : ''}`} data-track-id={id} aria-label={`${label}轨道`}>
      <div className="kf-lane-label">{options?.group ? <button className="kf-group-toggle" aria-label={`${expandedGroups.has(id) ? '收起' : '展开'}${label}轨道`} aria-expanded={expandedGroups.has(id)} onClick={() => toggleGroup(id)}><ChevronRight size={11} />{label}<span>{options.joints?.length}</span></button> : <button className="kf-track-select" aria-label={`选择${label}轨道`} onClick={() => selectPoint(time, point)}>{label}</button>}</div>
      <div className="kf-lane-track" data-frame-max={end} data-sample-count={times.length} data-source-count={sourceTimes.size} data-point-base-count={pointBaseTimes.size} role="slider" tabIndex={playing ? -1 : 0} aria-label={`${label}数据点时间`} aria-valuemin={0} aria-valuemax={duration} aria-valuenow={time} aria-valuetext={`${time} 秒 · ${exactSample ? `第 ${sampleIndex + 1} / ${times.length} 个数据点` : '新时间点'}`} onKeyDown={event => pointKeys(event, point)} onClick={event => seekLane(event, point)} onDoubleClick={event => seekLane(event, point, true)}>
        <svg className="kf-sample-dots" viewBox="0 0 10000 24" preserveAspectRatio="none" aria-hidden="true"><path className="kf-source-dots" d={samplePaths.source} /><path className="kf-evaluated-dots" d={samplePaths.evaluated} /></svg>
        {rowFrames.map(keyFrame => { const moving = drag?.kind === 'key' && drag.rowId === id && drag.sourceFrame === keyFrame; const shownFrame = moving ? drag.targetFrame : keyFrame; const keyTime = frameTime(keyFrame, duration); const keyPoint = options?.joints ? options.joints.find(joint => joint === selectedPoint && sequence.rotations[joint]?.some(key => key.frame === keyFrame)) ?? options.joints.find(joint => sequence.rotations[joint]?.some(key => key.frame === keyFrame)) ?? point : point;
          return <button key={keyFrame} className={`kf-lane-key ${sameTime(keyTime, time) && selected ? 'selected' : ''} ${moving && drag.moved ? 'dragging' : ''}`} data-frame={keyFrame} data-time={keyTime} data-point={keyPoint} aria-label={`${label}第 ${keyFrame} 帧关键帧`} title={`${label} · ${keyTime} 秒 · 拖动移动此轨记录`} style={{ left: `${position(frameTime(shownFrame, duration))}%` }} disabled={playing}
            onPointerDown={event => beginDrag(event, { kind: 'key', rowId: id, scope, sourceFrame: keyFrame, targetFrame: keyFrame })} onPointerMove={moveDrag} onPointerUp={event => { if (event.pointerId === dragRef.current?.pointerId) finishDrag(); }} onPointerCancel={() => finishDrag(true)} onLostPointerCapture={() => finishDrag(true)} onClick={event => { event.stopPropagation(); selectPoint(keyTime, keyPoint); }} onDoubleClick={event => { event.stopPropagation(); selectPoint(keyTime, keyPoint, true); }}><Diamond size={9} fill="currentColor" />{moving && drag.moved && <span className="kf-drag-time">{shownFrame} 帧</span>}</button>;
        })}
        {rowEdits.filter(edit => !sparseTimes.has(edit.time)).map(edit => { const editPoint = options?.joints ? options.joints.find(joint => joint === selectedPoint && edit.joints?.[joint]) ?? options.joints.find(joint => edit.joints?.[joint]) ?? point : point; return <button key={`edit-${edit.time}`} className="kf-lane-key kf-point-edit" data-time={edit.time} data-point={editPoint} aria-label={`${label}${edit.time} 秒修改点`} title={`${label} · ${edit.time} 秒 · 已修改`} style={{ left: `${position(edit.time)}%` }} disabled={playing} onClick={event => { event.stopPropagation(); selectPoint(edit.time, editPoint); }} onDoubleClick={event => { event.stopPropagation(); selectPoint(edit.time, editPoint, true); }}><Diamond size={9} fill="currentColor" /></button>; })}
        {selected && !options?.group && <button className={`kf-selected-point ${selectedEdit ? 'authored' : ''}`} data-selected-point="true" data-time={time} data-point={point} aria-label={`选中${label}${time} 秒数据点`} title={`${label} · ${time} 秒 · 双击查看数值`} style={{ left: `${position(time)}%`, pointerEvents: sparseTimes.has(time) ? 'none' : undefined }} disabled={playing} onKeyDown={event => pointKeys(event, point)} onClick={event => { event.stopPropagation(); selectPoint(time, point); }} onDoubleClick={event => { event.stopPropagation(); selectPoint(time, point, true); }} />}
        <span className="kf-row-playhead" style={{ left: `${position(time)}%` }} aria-hidden="true" />
      </div>
    </div>;
  }
  const audioOffset = drag?.kind === 'audio' ? drag.targetOffset : audio?.offsetSeconds ?? 0;
  const pixelsPerFrame = timeWidth / end;
  const tickStep = timelineMajorTickFrames(pixelsPerFrame);
  const ticks = Array.from({ length: Math.floor(end / tickStep) + 1 }, (_, i) => i * tickStep).filter(tick => tick < end);
  const gestureActive = !!drag || panning || scrubbing;
  const audioLeft = timelineXAtTime(audioOffset, timeWidth, duration);
  const audioWidth = audio ? timelineXAtTime(audioOffset + audio.durationSeconds, timeWidth, duration) - audioLeft : 0;
  const currentPoint = selectedPoint ?? 'root';
  const currentValue = currentPoint === 'root' ? selectedPose.root : selectedPose.joints[currentPoint];
  const sourceValue = currentPoint === 'root' ? sourcePose.root : sourcePose.joints[currentPoint];
  const pointBaseValue = pointBasePose ? currentPoint === 'root' ? pointBasePose.root : pointBasePose.joints[currentPoint] : undefined;
  const manualValue = currentPoint === 'root' ? sequence.root.find(key => sameTime(frameTime(key.frame, duration), time))?.position : sequence.rotations[currentPoint]?.find(key => sameTime(frameTime(key.frame, duration), time))?.rotation;
  const deletePoint = props.onDeletePoint;
  return <section className={`kf-timeline ${expanded ? '' : 'kf-collapsed'}`} aria-label="手动关键帧时间线">
    <div className="kf-timeline-toolbar">
      <div className="kf-timeline-transport">{props.transport}</div>
      <div className="kf-frame-controls"><button className="icon-button" aria-label="上一帧" disabled={frame === 0 || playing} onClick={() => onFrame(frame - 1)}><ChevronLeft size={14} /></button><label>帧<input aria-label="当前帧" type="number" min={0} max={end} step={1} value={frame} disabled={playing} onChange={event => { if (!event.target.value.trim()) return; const next = Number(event.target.value); if (Number.isFinite(next)) onFrame(Math.max(0, Math.min(end, Math.round(next)))); }} /></label><button className="icon-button" aria-label="下一帧" disabled={frame === end || playing} onClick={() => onFrame(frame + 1)}><ChevronRight size={14} /></button></div>
      <details ref={inspectorDisclosure} className="kf-point-inspector" open={inspectorOpen} onToggle={event => setInspectorOpen(event.currentTarget.open)}><summary aria-label="选中数据点数值" title="查看与编辑当前数据点数值"><span>{selectedPoint ? pointLabel(selectedPoint) : '选择部位'}</span><code data-time={time}>{Number(time.toFixed(6))}s</code>{props.editStatus && <i className={`kf-edit-status ${props.editStatus}`}>{props.editStatus === 'editing' ? '调整中' : '已记录'}</i>}</summary><div className="kf-point-popover">
        <div className="kf-point-heading"><strong>{pointLabel(currentPoint)}</strong><label>秒<input aria-label="当前时间（秒）" type="number" min={0} max={duration} step="any" value={time} disabled={playing} onChange={event => { if (event.target.value.trim() && Number.isFinite(Number(event.target.value))) props.onTime(Math.max(0, Math.min(duration, Number(event.target.value)))); }} /></label></div>
        <div className="kf-sample-navigation"><button aria-label="上一数据点" disabled={playing || time <= times[0]} onClick={() => stepPoint(-1, currentPoint)}><ChevronLeft size={12} /></button><span>{exactSample ? `${sourceTimes.has(time) ? '源样本' : pointBaseTimes.has(time) ? '编辑前样本' : '计算样本'} · ${sampleIndex + 1} / ${times.length}` : '新时间点 · 调整后自动记录'}</span><button aria-label="下一数据点" disabled={playing || time >= times.at(-1)!} onClick={() => stepPoint(1, currentPoint)}><ChevronRight size={12} /></button></div>
        <PointValues point={currentPoint} time={time} value={currentValue} sourceValue={sourceValue} sourceExact={sourceTimes.has(time)} pointBaseValue={pointBaseValue} pointBaseExact={pointBaseTimes.has(time)} manualValue={manualValue} disabled={locked} onChange={props.onPointValueChange} />
        {deletePoint && <button className="kf-delete-point" disabled={locked} onClick={deletePoint}><Trash2 size={12} />撤去本点修改</button>}
      </div></details>
      {props.history && <div className="kf-history-slot">{props.history}</div>}
      <button className="kf-collapse-button" aria-label={expanded ? '收起时间线' : '展开时间线'} aria-expanded={expanded} title={expanded ? '收起时间线' : '展开时间线'} onClick={() => { finishDrag(true); finishPan(true); finishScrub(); setExpanded(!expanded); }}>{expanded ? <ChevronDown size={16} /> : <ChevronUp size={16} />}</button>
      <details ref={moreDisclosure} className="kf-more" aria-label="更多时间线选项"><summary title="时间线选项">时间线选项</summary><div className="kf-more-popover">{props.playbackOptions}<p>点击人物关节会定位对应轨道。调整后自动记录该点及 IK 实际改变的关节。</p><p>轨道左右键切换精确数据点，Enter 查看数值。Ctrl / ⌘ + Z 撤销，Shift + Z 重做。</p></div></details>
    </div>
    {expanded && <><div className="kf-timeline-viewbar"><div className="kf-timeline-legend" aria-label="时间线数据图例"><span><i className="source" />源样本 {sourceTimes.size}</span><span><i className="evaluated" />计算 {times.length - sourceTimes.size}</span><span><Diamond size={8} fill="currentColor" />已修改</span></div>
      <div className="kf-zoom-controls" aria-label="时间线视图缩放"><button className={zoom === 0 ? 'active' : ''} aria-label="适合整段时间线" disabled={gestureActive} onClick={() => changeZoom(0)}>全段</button><button aria-label="缩小时间线" disabled={gestureActive || zoom === 0} onClick={() => changeZoom(zoom - 12.5)}><Minus size={11} /></button><input aria-label="时间线缩放" aria-valuetext={`每帧间距 ${pixelsPerFrame.toFixed(2)} 像素`} type="range" min={0} max={100} step={.5} value={zoom} disabled={gestureActive} onChange={event => changeZoom(Number(event.target.value))} /><button aria-label="放大时间线" disabled={gestureActive || zoom === 100} onClick={() => changeZoom(zoom + 12.5)}><Plus size={11} /></button><button className={zoom === 100 ? 'active' : ''} aria-label="逐帧查看时间线" disabled={gestureActive} onClick={() => changeZoom(100)}>逐帧</button><label className="kf-frame-spacing">间距<input aria-label="时间线每帧间距" type="number" min={Number((geometry.visibleWidth / end).toFixed(4))} max={Math.max(TIMELINE_MAX_FRAME_PIXELS, geometry.visibleWidth / end)} step={.5} value={Number(pixelsPerFrame.toFixed(2))} disabled={gestureActive} onChange={event => { const pixels = Number(event.target.value); if (event.target.value.trim() && Number.isFinite(pixels)) changeZoom(timelineZoomAtWidth(geometry.visibleWidth, duration, pixels * end)); }} />px</label></div>
    </div><div ref={viewport} className={`kf-lanes-viewport ${panning ? 'kf-panning' : ''}`} aria-label="分轨时间线" onPointerDown={beginPan} onPointerMove={movePan} onPointerUp={event => { if (event.pointerId === panRef.current?.pointerId) finishPan(); }} onPointerCancel={event => { if (event.pointerId === panRef.current?.pointerId) finishPan(true); }} onLostPointerCapture={event => { if (event.target === event.currentTarget && event.pointerId === panRef.current?.pointerId) finishPan(true); }} onScroll={() => { if (dragRef.current?.moved) updateDrag(dragRef.current); }}><div className="kf-lanes" data-pixels-per-frame={pixelsPerFrame} style={{ width: `${geometry.labelWidth + timeWidth}px`, '--kf-minor-spacing': `${pixelsPerFrame >= 8 ? pixelsPerFrame : 1000000}px`, '--kf-major-spacing': `${pixelsPerFrame * tickStep}px` } as CSSProperties}>
      <div className="kf-ruler-row"><div ref={rulerLabel} className="kf-lane-label">轨道 · 点选后调整</div><div className="kf-ruler"><div className="kf-ruler-ticks" aria-hidden="true">{ticks.map(tick => <span key={tick} style={{ left: `${tick / end * 100}%` }}>{tickStep < 30 ? `${tick}f` : `${Number((tick / 30).toFixed(2))}s`}</span>)}<span className="kf-end-tick" style={{ left: '100%' }}>{tickStep < 30 ? `${end}f` : `${duration}s`}</span></div><input aria-label="关键帧时间线进度" type="range" min={0} max={duration} step="any" value={time} disabled={playing} onChange={event => props.onTime(Number(event.target.value))} onPointerDown={beginScrub} onPointerMove={event => { if (scrubRef.current?.pointerId === event.pointerId) { event.preventDefault(); scrubAt(event.currentTarget, event.clientX); } }} onPointerUp={event => { if (event.pointerId === scrubRef.current?.pointerId) finishScrub(); }} onPointerCancel={event => { if (event.pointerId === scrubRef.current?.pointerId) finishScrub(); }} onLostPointerCapture={event => { if (event.pointerId === scrubRef.current?.pointerId) finishScrub(); }} /><span className="kf-ruler-playhead" style={{ left: `${position(time)}%` }} aria-hidden="true" /></div></div>
      {audio && <div className="kf-lane kf-audio-lane" data-track-id="audio" aria-label="音乐轨道"><div className="kf-lane-label"><Music2 size={11} /><span>音乐</span></div><div className="kf-lane-track kf-audio-content" data-frame-max={end} onClick={event => seekLane(event, currentPoint)}>
        <button className={`kf-audio-clip ${drag?.kind === 'audio' && drag.moved ? 'dragging' : ''}`} aria-label="移动音频片段" title={`${audio.name} · 拖动对齐音乐`} disabled={locked || audio.disabled} data-offset-seconds={audioOffset} data-duration-seconds={audio.durationSeconds} style={{ left: `${audioLeft / timeWidth * 100}%`, width: `${audioWidth / timeWidth * 100}%` }} onPointerDown={event => beginDrag(event, { kind: 'audio', sourceOffset: audio.offsetSeconds, targetOffset: audio.offsetSeconds })} onPointerMove={moveDrag} onPointerUp={event => { if (event.pointerId === dragRef.current?.pointerId) finishDrag(); }} onPointerCancel={() => finishDrag(true)} onLostPointerCapture={() => finishDrag(true)} onClick={event => event.stopPropagation()}><svg className="kf-waveform" viewBox={`0 0 ${Math.max(wave.length, 1)} 24`} preserveAspectRatio="none" aria-hidden="true">{wave.map((value, index) => { const amplitude = Math.max(.5, Math.min(1, Math.abs(value)) * 11); return <line key={index} x1={index + .5} x2={index + .5} y1={12 - amplitude} y2={12 + amplitude} />; })}</svg><span className="kf-audio-name" style={{ left: `${audioWidth > 0 ? Math.max(0, -audioLeft) / audioWidth * 100 : 0}%` }}>{drag?.kind === 'audio' && drag.moved ? `${audioOffset > 0 ? '+' : ''}${audioOffset.toFixed(3)} s` : audio.name}</span></button><span className="kf-row-playhead" style={{ left: `${position(time)}%` }} aria-hidden="true" />
      </div></div>}
      {renderRow('root', '整体位移', sequence.root.map(key => key.frame), 'root', { kind: 'root' })}
      {GROUPS.map(group => { const groupFrames = [...new Set(group.joints.flatMap(joint => (sequence.rotations[joint] ?? []).map(key => key.frame)))].sort((a, b) => a - b); const firstJoint = selectedPoint && selectedPoint !== 'root' && group.joints.includes(selectedPoint) ? selectedPoint : group.joints[0]; return <div key={group.id} className="kf-track-group">{renderRow(group.id, group.label, groupFrames, firstJoint, { kind: 'joints', joints: group.joints.filter(joint => EDITABLE_JOINT_NAMES.includes(joint)) }, { group: true, joints: group.joints })}{expandedGroups.has(group.id) && group.joints.map(joint => renderRow(joint, STAGE_JOINT_LABELS[joint], (sequence.rotations[joint] ?? []).map(key => key.frame), joint, { kind: 'joint', joint }, { child: true }))}</div>; })}
    </div></div></>}
  </section>;
}
