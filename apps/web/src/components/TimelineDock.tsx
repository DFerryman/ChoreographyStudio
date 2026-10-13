import { forwardRef, useCallback, useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';

const STORAGE_KEY = 'choreo.timelineHeight';
const MIN_HEIGHT = 150;
/** The stage always keeps at least this much room above the Timeline. */
const MIN_STAGE = 220;

function maxHeight(): number {
  const top = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--topbar-height')) || 52;
  return Math.max(MIN_HEIGHT, window.innerHeight - top - MIN_STAGE);
}
function defaultHeight(): number {
  return Math.round(window.innerHeight * (window.innerWidth <= 680 ? .44 : .3));
}
function storedHeight(): number | null {
  try { const value = Number(window.localStorage.getItem(STORAGE_KEY)); return Number.isFinite(value) && value > 0 ? value : null; } catch { return null; }
}
function clampHeight(value: number): number {
  return Math.round(Math.min(maxHeight(), Math.max(MIN_HEIGHT, value)));
}

/**
 * The Timeline is docked under the stage rather than covering it. A splitter
 * resizes the split; the height is a per-viewer convenience, never scene data.
 */
export const TimelineDock = forwardRef<HTMLDivElement, { children: ReactNode }>(function TimelineDock({ children }, ref) {
  const [height, setHeight] = useState(() => clampHeight(storedHeight() ?? defaultHeight()));
  const drag = useRef<{ pointerId: number; startY: number; startHeight: number } | null>(null);

  const commit = useCallback((value: number) => {
    const next = clampHeight(value);
    setHeight(next);
    try { window.localStorage.setItem(STORAGE_KEY, String(next)); } catch { /* storage is optional */ }
  }, []);

  useEffect(() => {
    const fit = () => setHeight(previous => clampHeight(previous));
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, []);

  function begin(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { pointerId: event.pointerId, startY: event.clientY, startHeight: height };
  }
  function move(event: PointerEvent<HTMLDivElement>) {
    const current = drag.current;
    if (!current || current.pointerId !== event.pointerId) return;
    setHeight(clampHeight(current.startHeight + current.startY - event.clientY));
  }
  function end(event: PointerEvent<HTMLDivElement>) {
    const current = drag.current;
    if (!current || current.pointerId !== event.pointerId) return;
    drag.current = null;
    commit(current.startHeight + current.startY - event.clientY);
  }
  function keys(event: KeyboardEvent<HTMLDivElement>) {
    const step = event.shiftKey ? 80 : 20;
    const next = event.key === 'ArrowUp' ? height + step : event.key === 'ArrowDown' ? height - step
      : event.key === 'Home' ? maxHeight() : event.key === 'End' ? MIN_HEIGHT : null;
    if (next === null) return;
    event.preventDefault(); event.stopPropagation(); commit(next);
  }

  return <div ref={ref} className="timeline-dock" style={{ '--timeline-height': `${height}px` } as CSSProperties}>
    <div className="timeline-splitter" role="separator" aria-orientation="horizontal" aria-label="调整舞台与时间线高度" title="拖动调整舞台与时间线高度"
      aria-valuemin={MIN_HEIGHT} aria-valuenow={height} tabIndex={0}
      onPointerDown={begin} onPointerMove={move} onPointerUp={end} onPointerCancel={end} onKeyDown={keys} />
    {children}
  </div>;
});
