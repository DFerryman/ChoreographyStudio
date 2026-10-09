import { describe, expect, it } from 'vitest';
import { frameAtTime, frameTime, lastFrame } from '../../../packages/core/src';
import {
  TIMELINE_MAX_FRAME_PIXELS, timelineAnchorAtFraction, timelineAnchorScroll, timelineDragFrame, timelineDragTime, timelineEdgeScroll,
  timelineMajorTickFrames, timelineTimeAtX, timelineWidth, timelineXAtTime, timelineZoomAtWidth,
} from './timelineGeometry';

describe('timeline display geometry', () => {
  it('can separate every regular frame of a long clip on a narrow screen', () => {
    const duration = 200, fit = 390;
    expect(timelineWidth(fit, duration, 0)).toBe(fit);
    const width = timelineWidth(fit, duration, 100);
    expect(width).toBe(288000);
    expect(width / (duration * 30)).toBe(TIMELINE_MAX_FRAME_PIXELS);
    const frame137 = timelineTimeAtX(137 * TIMELINE_MAX_FRAME_PIXELS, width, duration);
    const frame138 = timelineTimeAtX(138 * TIMELINE_MAX_FRAME_PIXELS, width, duration);
    expect(frame137).toBeCloseTo(137 / 30, 12);
    expect(frame138 - frame137).toBeCloseTo(1 / 30, 12);
  });

  it('uses a reversible logarithmic scale with equal relative slider increments', () => {
    for (const fit of [240, 390, 1280]) for (const duration of [2.005, 37.5, 200]) {
      for (const zoom of [0, 0.5, 12, 50, 73, 99, 100]) {
        const width = timelineWidth(fit, duration, zoom);
        expect(timelineZoomAtWidth(fit, duration, width)).toBeCloseTo(zoom, 10);
      }
      const a = timelineWidth(fit, duration, 20), b = timelineWidth(fit, duration, 40), c = timelineWidth(fit, duration, 60);
      expect(b / a).toBeCloseTo(c / b, 12);
    }
    expect(timelineWidth(390, 200, -10)).toBe(390);
    expect(timelineWidth(390, 200, 110)).toBe(288000);
    expect(timelineZoomAtWidth(390, 200, 1)).toBe(0);
    expect(timelineZoomAtWidth(390, 200, 400000)).toBe(100);
  });

  it('keeps an already-spacious short clip at fit size', () => {
    for (const zoom of [0, 25, 50, 100]) expect(timelineWidth(1600, 1, zoom)).toBe(1600);
    expect(timelineZoomAtWidth(1600, 1, 9000)).toBe(0);
  });

  it('anchors zoom at the visible time and clamps only when a content edge requires it', () => {
    const duration = 20, oldWidth = 2000, scroll = 475, anchorX = 125, visibleWidth = 400;
    const time = timelineTimeAtX(scroll + anchorX, oldWidth, duration);
    const nextWidth = 6000;
    const nextScroll = timelineAnchorScroll(time, nextWidth, duration, anchorX, visibleWidth);
    expect(timelineTimeAtX(nextScroll + anchorX, nextWidth, duration)).toBe(time);
    expect(timelineAnchorScroll(0, nextWidth, duration, anchorX, visibleWidth)).toBe(0);
    expect(timelineAnchorScroll(duration, nextWidth, duration, anchorX, visibleWidth)).toBe(nextWidth - visibleWidth);
    expect(timelineAnchorScroll(10, 200, duration, anchorX, visibleWidth)).toBe(0);
  });

  it('includes accumulated scrolling once without changing the drag source', () => {
    const source = 8, width = 12000, duration = 40;
    expect(timelineDragTime(source, 120, 480, width, duration)).toBe(10);
    expect(timelineDragTime(source, 120, 960, width, duration)).toBe(11.6);
    expect(timelineDragTime(source, -120, -480, width, duration)).toBe(6);
    expect(source).toBe(8);
    expect(timelineDragTime(source, -1e6, 0, width, duration)).toBe(0);
    expect(timelineDragTime(source, 1e6, 0, width, duration)).toBe(duration);
  });

  it('separates the Salsa last half-frame while keeping its canonical exact time', () => {
    const duration = 56.25, width = timelineWidth(390, duration, 100), end = lastFrame(duration);
    expect(end).toBe(1688);
    expect(width).toBe(81024);
    for (const frame of [0, 1, 137, end - 2, end - 1, end]) {
      const time = frameTime(frame, duration), x = timelineXAtTime(time, width, duration);
      expect(x).toBeCloseTo(frame * TIMELINE_MAX_FRAME_PIXELS, 9);
      expect(timelineTimeAtX(x, width, duration)).toBeCloseTo(time, 14);
    }
    expect(timelineTimeAtX(width, width, duration)).toBe(duration);
    expect(width - timelineXAtTime(frameTime(end - 1, duration), width, duration)).toBe(TIMELINE_MAX_FRAME_PIXELS);
  });

  it('stretches only a tiny tail without blowing up the full timeline width', () => {
    for (const duration of [1.000001, 1 + 1e-14]) {
      const width = timelineWidth(390, duration, 100), end = lastFrame(duration);
      expect(end).toBe(31);
      expect(width).toBe(1488);
      const previousX = timelineXAtTime(frameTime(end - 1, duration), width, duration);
      expect(previousX).toBe(1440);
      expect(width - previousX).toBe(TIMELINE_MAX_FRAME_PIXELS);
      expect(timelineXAtTime(duration, width, duration)).toBe(width);
      expect(timelineTimeAtX(width, width, duration)).toBe(duration);
      expect(timelineTimeAtX(previousX, width, duration)).toBe(1);
      const middleTime = 1 + (duration - 1) / 2;
      expect(timelineTimeAtX(timelineXAtTime(middleTime, width, duration), width, duration)).toBe(middleTime);
    }
  });

  it('uses the same piecewise scale for anchors and dragging into and out of the last frame', () => {
    const duration = 1.005, end = lastFrame(duration), width = timelineWidth(390, duration, 100);
    const previousTime = frameTime(end - 1, duration), previousX = timelineXAtTime(previousTime, width, duration);
    const endTime = frameTime(end, duration);
    expect(frameAtTime(timelineDragTime(previousTime, 24, 24, width, duration), duration)).toBe(end);
    expect(timelineDragTime(previousTime, 24, 24, width, duration)).toBe(endTime);
    expect(timelineDragTime(endTime, -24, -24, width, duration)).toBe(previousTime);
    expect(frameAtTime(timelineDragTime(endTime, -48, -48, width, duration), duration)).toBe(end - 2);
    const insideTail = timelineTimeAtX(previousX + 20, width, duration), anchorX = 100;
    const largerWidth = width * 2;
    const scroll = timelineAnchorScroll(insideTail, largerWidth, duration, anchorX, 100);
    expect(timelineTimeAtX(scroll + anchorX, largerWidth, duration)).toBe(insideTail);
    expect(timelineDragTime(endTime, 100, 0, width, duration)).toBe(duration);
    expect(timelineDragTime(0, -100, 0, width, duration)).toBe(0);
  });

  it('extends audio outside both edges at the regular frame scale, even with a tiny tail', () => {
    for (const duration of [1.005, 1 + 1e-14, 56.25]) {
      const width = timelineWidth(390, duration, 100);
      expect(timelineXAtTime(-1 / 30, width, duration)).toBe(-48);
      expect(timelineTimeAtX(-48, width, duration)).toBe(-1 / 30);
      expect(timelineXAtTime(duration + 1 / 30, width, duration)).toBeCloseTo(width + 48, 9);
      expect(timelineTimeAtX(width + 48, width, duration)).toBe(duration + 1 / 30);
      for (const time of [-2, -0.1, 0, 0.25, duration - 1e-15, duration, duration + 0.1, duration + 2]) {
        expect(timelineTimeAtX(timelineXAtTime(time, width, duration), width, duration)).toBeCloseTo(time, 12);
      }
    }
  });

  it('avoids division by zero at an existing rounded-up canonical endpoint', () => {
    const duration = 31 / 30, end = lastFrame(duration), width = timelineWidth(390, duration, 100);
    expect(end).toBe(32);
    expect(width).toBe(1536);
    expect(frameTime(end - 1, duration)).toBe(duration);
    expect(timelineXAtTime(duration, width, duration)).toBe(width);
    expect(timelineTimeAtX(width - 24, width, duration)).toBe(duration);
    expect(timelineTimeAtX(width, width, duration)).toBe(duration);
    expect(timelineTimeAtX(timelineXAtTime(1, width, duration), width, duration)).toBe(1);
  });

  it('preserves sparse K frame identity across auto-scroll and short or coincident final times', () => {
    for (const duration of [1.000001, 1 + 1e-14, 31 / 30]) {
      const end = lastFrame(duration), width = timelineWidth(390, duration, 100), source = end - 1;
      expect(timelineDragFrame(source, 0, 0, width, end)).toBe(source);
      expect(timelineDragFrame(source, 24, 24, width, end)).toBe(end);
      expect(timelineDragFrame(end, -24, -24, width, end)).toBe(source);
      expect(timelineDragFrame(end, -24, -72, width, end)).toBe(source - 1);
      expect(timelineDragFrame(source, 23.9, 0, width, end)).toBe(source);
      expect(timelineDragFrame(source, 24.1, 0, width, end)).toBe(end);
      expect(timelineDragFrame(source, -1e6, 0, width, end)).toBe(0);
      expect(timelineDragFrame(source, 1e6, 0, width, end)).toBe(end);
    }
    const end = lastFrame(31 / 30), width = timelineWidth(390, 31 / 30, 100);
    expect(frameTime(31, 31 / 30)).toBe(frameTime(32, 31 / 30));
    expect(timelineDragFrame(30, 0, 48, width, end)).toBe(31);
    expect(timelineDragFrame(31, 0, 48, width, end)).toBe(32);
    expect(timelineDragFrame(32, 0, -48, width, end)).toBe(31);
    expect(timelineDragFrame(31, 100, 100, 0, end)).toBe(31);
  });

  it('anchors canonical fractions across zoom without aliasing coincident final frame times', () => {
    const duration = 31 / 30, end = lastFrame(duration), width = timelineWidth(390, duration, 100);
    expect(frameTime(31, duration)).toBe(frameTime(32, duration));
    const anchorX = 100, visibleWidth = 100;
    for (const frame of [30, 31, 32]) {
      const fraction = frame / end;
      const oldScroll = timelineAnchorAtFraction(fraction, width, anchorX, visibleWidth);
      const newWidth = width * 4;
      const newScroll = timelineAnchorAtFraction(fraction, newWidth, anchorX, visibleWidth);
      expect((oldScroll + anchorX) / width * end).toBe(frame);
      expect((newScroll + anchorX) / newWidth * end).toBe(frame);
    }
    expect(timelineAnchorAtFraction(31 / end, width, anchorX, visibleWidth)).not.toBe(timelineAnchorAtFraction(32 / end, width, anchorX, visibleWidth));
    expect(timelineAnchorAtFraction(0, width, anchorX, 400)).toBe(0);
    expect(timelineAnchorAtFraction(1, width, anchorX, 400)).toBe(width - 400);
    expect(timelineAnchorAtFraction(-1, width, anchorX, 400)).toBe(0);
    expect(timelineAnchorAtFraction(2, width, anchorX, 400)).toBe(width - 400);
    expect(timelineAnchorAtFraction(0.5, 200, anchorX, 400)).toBe(0);
  });

  it('returns finite fraction anchor geometry before width or pointer measurement', () => {
    expect(timelineAnchorAtFraction(0.5, 0, 100, 390)).toBe(0);
    expect(timelineAnchorAtFraction(NaN, 1000, 100, 390)).toBe(0);
    expect(timelineAnchorAtFraction(0.5, NaN, 100, 390)).toBe(0);
    expect(timelineAnchorAtFraction(0.5, 1000, NaN, 390)).toBe(500);
    expect(timelineAnchorAtFraction(0.5, 1000, 100, NaN)).toBe(400);
  });

  it('chooses frame ticks at high zoom and uncluttered whole-frame labels at low zoom', () => {
    expect(timelineMajorTickFrames(100)).toBe(1);
    expect(timelineMajorTickFrames(40)).toBe(2);
    expect(timelineMajorTickFrames(TIMELINE_MAX_FRAME_PIXELS)).toBe(2);
    expect(timelineMajorTickFrames(8)).toBe(10);
    expect(timelineMajorTickFrames(80 / 15)).toBe(15);
    expect(timelineMajorTickFrames(80 / 30)).toBe(30);
    expect(timelineMajorTickFrames(80 / 60)).toBe(60);
    expect(timelineMajorTickFrames(80 / 150)).toBe(150);
    expect(timelineMajorTickFrames(80 / 300)).toBe(300);
    expect(timelineMajorTickFrames(0.1)).toBe(1500);
    expect(timelineMajorTickFrames(0.01)).toBe(15000);
  });

  it('accelerates toward each edge and continues outside while respecting direction and maximum', () => {
    const left = 100, right = 500;
    expect(timelineEdgeScroll(300, left, right)).toBe(0);
    expect(timelineEdgeScroll(132, left, right)).toBe(0);
    expect(timelineEdgeScroll(468, left, right)).toBe(0);
    expect(timelineEdgeScroll(116, left, right)).toBe(-9);
    expect(timelineEdgeScroll(484, left, right)).toBe(9);
    expect(timelineEdgeScroll(left, left, right)).toBe(-18);
    expect(timelineEdgeScroll(right, left, right)).toBe(18);
    expect(timelineEdgeScroll(left - 500, left, right)).toBe(-18);
    expect(timelineEdgeScroll(right + 500, left, right)).toBe(18);
    expect(timelineEdgeScroll(110, 100, 120)).toBe(0);
    expect(timelineEdgeScroll(100, 100, 120)).toBe(-18);
    expect(timelineEdgeScroll(120, 100, 120)).toBe(18);
    expect(timelineEdgeScroll(10, 20, 20)).toBe(0);
  });

  it('handles the unmeasured first render without NaN geometry', () => {
    expect(timelineWidth(0, 37.5, 50)).toBe(0);
    expect(timelineZoomAtWidth(0, 37.5, 100)).toBe(0);
    expect(timelineTimeAtX(100, 0, 37.5)).toBe(0);
    expect(timelineXAtTime(10, 0, 37.5)).toBe(0);
    expect(timelineAnchorScroll(10, 0, 37.5, 20, 0)).toBe(0);
    expect(timelineDragTime(10, 100, 100, 0, 37.5)).toBe(10);
    expect(timelineTimeAtX(-100, 390, 37.5)).toBeLessThan(0);
    expect(timelineTimeAtX(1000, 390, 37.5)).toBeGreaterThan(37.5);
  });
});
