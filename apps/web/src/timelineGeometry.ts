/** Display-only scale; authored frame indices and exact final times stay in core. */
export const TIMELINE_MAX_FRAME_PIXELS = 48;

const FRAMES_PER_SECOND = 30;
const EDGE_WIDTH = 32;
const MAX_EDGE_SCROLL = 18;
const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value));
const positive = (value: number) => Number.isFinite(value) ? Math.max(0, value) : 0;
const finite = (value: number) => Number.isFinite(value) ? value : 0;

function scaleBounds(fitWidth: number, duration: number) {
  const fit = positive(fitWidth);
  return { fit, maximum: Math.max(fit, Math.ceil(positive(duration) * FRAMES_PER_SECOND) * TIMELINE_MAX_FRAME_PIXELS) };
}

/** A 0–100 logarithmic slider gives the same relative change at every position. */
export function timelineWidth(fitWidth: number, duration: number, zoom: number): number {
  const { fit, maximum } = scaleBounds(fitWidth, duration);
  if (!fit || maximum === fit) return fit;
  const position = clamp(finite(zoom), 0, 100);
  if (position === 0) return fit;
  if (position === 100) return maximum;
  return fit * Math.pow(maximum / fit, position / 100);
}

/** Inverse of timelineWidth, also suitable for a width chosen with wheel/pinch. */
export function timelineZoomAtWidth(fitWidth: number, duration: number, width: number): number {
  const { fit, maximum } = scaleBounds(fitWidth, duration);
  if (!fit || maximum === fit) return 0;
  const bounded = clamp(positive(width), fit, maximum);
  return clamp(Math.log(bounded / fit) / Math.log(maximum / fit) * 100, 0, 100);
}

/** Keep an anchor time at its viewport X, except when either content edge prevents it. */
export function timelineAnchorScroll(time: number, width: number, duration: number, anchorX: number, visibleWidth: number): number {
  const contentWidth = positive(width), seconds = positive(duration);
  if (!contentWidth || !seconds) return 0;
  const position = timelineXAtTime(clamp(finite(time), 0, seconds), contentWidth, seconds);
  return clamp(position - finite(anchorX), 0, Math.max(0, contentWidth - positive(visibleWidth)));
}

/** Keep canonical display position across zoom, even when two frames share a time. */
export function timelineAnchorAtFraction(fraction: number, width: number, anchorX: number, visibleWidth: number): number {
  const contentWidth = positive(width);
  const position = clamp(finite(fraction), 0, 1) * contentWidth;
  return clamp(position - finite(anchorX), 0, Math.max(0, contentWidth - positive(visibleWidth)));
}

/**
 * Equal display spacing for canonical frames, including the possibly shorter last
 * interval. Before/after the scene, extend the regular 30 fps scale for audio.
 */
export function timelineXAtTime(time: number, width: number, duration: number): number {
  const contentWidth = positive(width), seconds = positive(duration);
  if (!contentWidth || !seconds) return 0;
  const boundedTime = finite(time), end = Math.ceil(seconds * FRAMES_PER_SECOND);
  const frameWidth = contentWidth / end;
  if (boundedTime >= seconds) return contentWidth + (boundedTime - seconds) * FRAMES_PER_SECOND * frameWidth;
  const previousTime = (end - 1) / FRAMES_PER_SECOND, previousX = (end - 1) * frameWidth;
  if (boundedTime === previousTime) return previousX;
  if (boundedTime < previousTime) return boundedTime * FRAMES_PER_SECOND * frameWidth;
  const tail = seconds - previousTime;
  return previousX + (tail > 0 ? (boundedTime - previousTime) / tail * frameWidth : 0);
}

/** Inverse display scale. X excludes the sticky label and can extend outside the scene. */
export function timelineTimeAtX(x: number, width: number, duration: number): number {
  const contentWidth = positive(width), seconds = positive(duration);
  if (!contentWidth || !seconds) return 0;
  const position = finite(x), end = Math.ceil(seconds * FRAMES_PER_SECOND);
  const frameWidth = contentWidth / end;
  if (position >= contentWidth) return seconds + (position - contentWidth) / frameWidth / FRAMES_PER_SECOND;
  const previousX = (end - 1) * frameWidth, previousTime = (end - 1) / FRAMES_PER_SECOND;
  if (position === previousX) return previousTime;
  if (position < previousX) return position / frameWidth / FRAMES_PER_SECOND;
  return previousTime + (position - previousX) / frameWidth * Math.max(0, seconds - previousTime);
}

/** Frame-aligned labels, spaced at least about 80 px apart. Minor ticks can remain one frame apart. */
export function timelineMajorTickFrames(pixelsPerFrame: number): number {
  const pixels = positive(pixelsPerFrame);
  if (!pixels) return 300;
  const needed = Math.min(Number.MAX_SAFE_INTEGER, 80 / pixels);
  const smallSteps = [1, 2, 5, 10, 15, 30, 60, 150, 300];
  const small = smallSteps.find(step => step >= needed);
  if (small !== undefined) return small;
  let scale = 10;
  while (300 * scale < needed) scale *= 10;
  return [30, 60, 150, 300].map(step => step * scale).find(step => step >= needed)!;
}

/** Per-animation-frame scroll delta. Outside the viewport, keep scrolling at full speed. */
export function timelineEdgeScroll(pointerX: number, left: number, right: number): number {
  if (![pointerX, left, right].every(Number.isFinite) || right <= left) return 0;
  // Avoid overlapping edge zones in a narrow lane: its center remains stationary.
  const edgeWidth = Math.min(EDGE_WIDTH, (right - left) / 2);
  if (pointerX < left + edgeWidth) return -MAX_EDGE_SCROLL * clamp((left + edgeWidth - pointerX) / edgeWidth, 0, 1);
  if (pointerX > right - edgeWidth) return MAX_EDGE_SCROLL * clamp((pointerX - right + edgeWidth) / edgeWidth, 0, 1);
  return 0;
}

/** Use the drag's original scale/source; auto-scroll adds to the pointer displacement. */
export function timelineDragTime(sourceTime: number, deltaPointer: number, deltaScroll: number, width: number, duration: number): number {
  const contentWidth = positive(width), seconds = positive(duration);
  const source = clamp(finite(sourceTime), 0, seconds);
  if (!contentWidth || !seconds) return source;
  const sourceX = timelineXAtTime(source, contentWidth, seconds);
  return clamp(timelineTimeAtX(sourceX + finite(deltaPointer) + finite(deltaScroll), contentWidth, seconds), 0, seconds);
}

/**
 * Sparse K drag uses its source frame identity, including two canonical frames
 * whose exact endpoint times happen to coincide after floating-point rounding.
 */
export function timelineDragFrame(sourceFrame: number, deltaPointer: number, deltaScroll: number, width: number, endFrame: number): number {
  const contentWidth = positive(width), end = Math.floor(positive(endFrame));
  const source = clamp(Math.round(finite(sourceFrame)), 0, end);
  if (!contentWidth || !end) return source;
  return clamp(Math.round(source + (finite(deltaPointer) + finite(deltaScroll)) / contentWidth * end), 0, end);
}
