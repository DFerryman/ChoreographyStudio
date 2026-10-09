import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import {
  CAMERA_COORDINATE_LIMIT, CAMERA_ZOOM_LIMITS, MAX_CAMERA_KEYS, MIN_CAMERA_DISTANCE,
  cloneCameraTrack, createCameraTrackSampler, makeCameraTrack, moveCameraKeyframe, removeCameraKeyframe,
  sameCameraPose, sampleCameraTrack, upsertCameraKeyframe, validateCameraPose, validateCameraTrack,
  type CameraPose, type CameraTrack,
} from './index';

const duration = 3.07123456789;
const base = (): CameraPose => ({ position: [.312345678901, 1.3, 4.12345678901], target: [.1, 1.3, -.2] });
const back = (): CameraPose => ({ position: [-.2, 1.7, -5.23456789012], target: [.2, 1.1, .3], zoom: 1.7 });
const keyed = (): CameraTrack => ({ schema: 'camera-track-1', baseCamera: base(), keys: [{ time: .7039123456789, camera: back() }, { time: 2.5039123456789, camera: { position: [4, 2, 0], target: [0, 1, 0], zoom: .8 } }] });
const authored = (sample: CameraPose): CameraPose => ({ position: sample.position, target: sample.target, ...(sample.zoom !== undefined ? { zoom: sample.zoom } : {}) });
const distance = (camera: CameraPose) => Math.hypot(...camera.position.map((value, axis) => value - camera.target[axis]));

describe('exact-second independent camera tracks', () => {
  it('retains exact base/key tuples and optional zoom at endpoints, with held boundaries', () => {
    const track = keyed(), original = structuredClone(track);
    for (const time of [-10, 0]) expect(authored(sampleCameraTrack(track, time, duration))).toEqual(track.baseCamera);
    for (const key of track.keys) expect(authored(sampleCameraTrack(track, key.time, duration))).toEqual(key.camera);
    for (const time of [duration, 100]) expect(authored(sampleCameraTrack(track, time, duration))).toEqual(track.keys[1].camera);
    const sample = sampleCameraTrack(track, 0, duration);
    expect(Object.hasOwn(sample, 'zoom')).toBe(false);
    sample.position[0] = 20;
    expect(track).toEqual(original);
  });

  it('uses base as the implicit zero anchor before the first key and explicit zero overrides it', () => {
    const track = keyed(), midpoint = sampleCameraTrack(track, track.keys[0].time / 2, duration);
    expect(midpoint.position).not.toEqual(base().position);
    expect(midpoint.position).not.toEqual(back().position);
    expect(midpoint.target).toEqual(base().target.map((value, axis) => (value + back().target[axis]) / 2));
    const zero: CameraPose = { position: [3, 2, 1], target: [0, 1, 0] };
    const explicit = upsertCameraKeyframe(track, 0, zero, duration);
    expect(authored(sampleCameraTrack(explicit, -1, duration))).toEqual(zero);
    expect(authored(sampleCameraTrack(removeCameraKeyframe(explicit, 0, duration), 0, duration))).toEqual(track.baseCamera);
    expect(authored(sampleCameraTrack(makeCameraTrack(base()), duration / 2, duration))).toEqual(base());
  });

  it('does not round off-grid keys or merge neighboring exact seconds', () => {
    const time = .4312345678901234, neighbor = time + Number.EPSILON;
    let track = upsertCameraKeyframe(makeCameraTrack(base()), time, back(), duration);
    const second: CameraPose = { position: [3, 2, 1], target: [1, 0, 0], zoom: 2 };
    track = upsertCameraKeyframe(track, neighbor, second, duration);
    expect(track.keys.map(key => key.time)).toEqual([time, neighbor]);
    expect(authored(sampleCameraTrack(track, time, duration))).toEqual(back());
    expect(authored(sampleCameraTrack(track, neighbor, duration))).toEqual(second);
  });

  it('clones stored values without recomputation or writable aliases', () => {
    const camera = base(), track = makeCameraTrack(camera);
    camera.position[0] += 1;
    expect(track.baseCamera).toEqual(base());
    const authored = back(), edited = upsertCameraKeyframe(track, .43123456789, authored, duration);
    authored.target[0] = 30;
    expect(edited.keys[0].camera).toEqual(back());
    const clone = cloneCameraTrack(edited);
    expect(clone).toEqual(edited);
    clone.keys[0].camera.position[0] = 99;
    clone.baseCamera.target[1] = 20;
    expect(edited.keys[0].camera).toEqual(back());
    expect(edited.baseCamera).toEqual(base());
    expect(track.keys).toEqual([]);
  });
});

describe('continuous camera preview without passing through the target', () => {
  it('turns an opposing view around the target instead of collapsing linear positions', () => {
    const track: CameraTrack = { schema: 'camera-track-1', baseCamera: { position: [0, 1, 4], target: [0, 1, 0] }, keys: [{ time: 2, camera: { position: [0, 1, -4], target: [0, 1, 0] } }] };
    const middle = sampleCameraTrack(track, 1, duration);
    expect(distance(middle)).toBeCloseTo(4, 12);
    expect(Math.abs(middle.position[0])).toBeCloseTo(4, 12);
    expect(middle.position[1]).toBeCloseTo(1, 12);
    expect(middle.up).toEqual([0, 1, 0]);
    let prior = new Vector3(...track.baseCamera.position).sub(new Vector3(...track.baseCamera.target));
    for (let step = 1; step < 200; step += 1) {
      const sampled = sampleCameraTrack(track, step / 100, duration);
      const direction = new Vector3(...sampled.position).sub(new Vector3(...sampled.target));
      expect(direction.length()).toBeCloseTo(4, 12);
      expect(direction.angleTo(prior)).toBeLessThan(.016);
      prior = direction;
    }
  });

  it('interpolates target linearly and distance/zoom geometrically', () => {
    const track: CameraTrack = { schema: 'camera-track-1', baseCamera: { position: [0, 0, 2], target: [0, 0, 0], zoom: .5 }, keys: [{ time: 2, camera: { position: [2, 4, 14], target: [2, 4, 6], zoom: 2 } }] };
    const midpoint = sampleCameraTrack(track, 1, duration);
    expect(midpoint.target).toEqual([1, 2, 3]);
    expect(midpoint.position).toEqual([1, 2, 7]);
    expect(midpoint.zoom).toBe(1);
    expect(midpoint.up).toEqual([0, 1, 0]);
  });

  it('keeps full orientation and up continuous through vertical views', () => {
    const track: CameraTrack = { schema: 'camera-track-1', baseCamera: { position: [0, 4, .001], target: [0, 0, 0] }, keys: [{ time: 2, camera: { position: [0, 4, -.001], target: [0, 0, 0] } }] };
    let priorUp: Vector3 | undefined;
    for (let step = 1; step < 200; step += 1) {
      const sample = sampleCameraTrack(track, step / 100, duration);
      const back = new Vector3(...sample.position).sub(new Vector3(...sample.target)).normalize();
      const up = new Vector3(...sample.up!);
      expect(up.length()).toBeCloseTo(1, 12);
      expect(up.dot(back)).toBeCloseTo(0, 12);
      if (priorUp) expect(up.angleTo(priorUp)).toBeLessThan(.016);
      priorUp = up;
    }
    const exactVertical = { ...track, baseCamera: { position: [0, 4, 0], target: [0, 0, 0] } as CameraPose };
    const sample = sampleCameraTrack(exactVertical, .5, duration);
    expect([...sample.position, ...sample.up!].every(Number.isFinite)).toBe(true);
    expect(distance(sample)).toBeGreaterThan(3.99);
  });

  it('is finite and stays separated for valid extreme cameras without clipping authored values', () => {
    const near: CameraPose = { position: [1000, 1000, 999.98], target: [1000, 1000, 1000], zoom: CAMERA_ZOOM_LIMITS[0] };
    const far: CameraPose = { position: [-1000, -1000, -1000], target: [1000, 1000, 1000], zoom: CAMERA_ZOOM_LIMITS[1] };
    const track: CameraTrack = { schema: 'camera-track-1', baseCamera: near, keys: [{ time: duration, camera: far }] };
    for (let step = 1; step < 100; step += 1) {
      const sample = sampleCameraTrack(track, duration * step / 100, duration);
      expect([...sample.position, ...sample.target, ...sample.up!, sample.zoom!].every(Number.isFinite)).toBe(true);
      expect(distance(sample)).toBeGreaterThanOrEqual(MIN_CAMERA_DISTANCE - 1e-10);
      expect(sample.zoom).toBeGreaterThanOrEqual(.5);
      expect(sample.zoom).toBeLessThanOrEqual(4);
    }
    expect(authored(sampleCameraTrack(track, duration, duration))).toEqual(far);
  });

  it('converges to exact neighboring key values without changing a saved tuple', () => {
    const track = keyed(), original = structuredClone(track);
    for (const key of track.keys) for (const side of [-1, 1]) {
      const sample = sampleCameraTrack(track, key.time + side * 1e-9, duration);
      sample.position.forEach((value, axis) => expect(value).toBeCloseTo(key.camera.position[axis], 7));
      sample.target.forEach((value, axis) => expect(value).toBeCloseTo(key.camera.target[axis], 7));
    }
    expect(track).toEqual(original);
  });

  it('precomputes an owned sampler, retains exact values and never rereads external mutable data', () => {
    const track = keyed(), original = structuredClone(track), sampler = createCameraTrackSampler(track, duration);
    const times = [0, .1, track.keys[0].time, .9, track.keys[1].time, duration];
    const expected = times.map(time => sampleCameraTrack(original, time, duration));
    track.baseCamera.position[0] = 999;
    track.keys[0].camera.target[1] = -999;
    track.keys.length = 0;
    Object.defineProperty(track, 'keys', { get: () => { throw new Error('External track was reread'); } });
    for (let pass = 0; pass < 3; pass += 1) expect(times.map(sampler)).toEqual(expected);
    const first = sampler(.1); first.position[0] = 999; first.up![1] = -999;
    expect(sampler(.1)).toEqual(expected[1]);
    for (const invalid of [NaN, Infinity]) expect(() => sampler(invalid)).toThrow();
  });

  it('supplies a continuous derived up even at exact vertical keys and held endpoints', () => {
    const vertical: CameraPose = { position: [0, 4, 0], target: [0, 0, 0] };
    const track: CameraTrack = { schema: 'camera-track-1', baseCamera: base(), keys: [{ time: 2, camera: vertical }] };
    const sampler = createCameraTrackSampler(track, duration), key = sampler(2), before = sampler(2 - 1e-9), held = sampler(duration);
    expect(authored(key)).toEqual(vertical);
    key.up!.forEach((value, axis) => expect(value).toBeCloseTo([0, 0, -1][axis], 12));
    expect(held).toEqual(key);
    expect(new Vector3(...key.up!).angleTo(new Vector3(...before.up!))).toBeLessThan(1e-7);
    expect(new Vector3(...before.position).sub(new Vector3(...before.target)).normalize().angleTo(new Vector3(0, 1, 0))).toBeLessThan(1e-7);
  });
});

describe('atomic camera key operations', () => {
  it('returns the same object for no-op recording, movement and removal', () => {
    const track = keyed();
    expect(upsertCameraKeyframe(track, track.keys[0].time, back(), duration)).toBe(track);
    expect(() => upsertCameraKeyframe(track, .1, sampleCameraTrack(track, .1, duration), duration)).toThrow();
    expect(upsertCameraKeyframe(track, .1, authored(sampleCameraTrack(track, .1, duration)), duration)).toBe(track);
    expect(moveCameraKeyframe(track, track.keys[0].time, track.keys[0].time, duration)).toBe(track);
    expect(moveCameraKeyframe(track, .5, .6, duration)).toBe(track);
    expect(removeCameraKeyframe(track, .5, duration)).toBe(track);
    const empty = makeCameraTrack(base());
    expect(upsertCameraKeyframe(empty, .5, { ...base(), zoom: 1 }, duration)).toBe(empty);
    expect(sameCameraPose(base(), { ...base(), zoom: 1 })).toBe(true);
    const noisy = base(); noisy.position[0] += 1e-10;
    expect(sameCameraPose(base(), noisy)).toBe(false);
    expect(sameCameraPose(base(), noisy, 1e-9)).toBe(true);
  });

  it('moves exact payloads without touching base or other keys and rejects collisions atomically', () => {
    const track = keyed(), original = structuredClone(track), time = .91234567890123;
    const moved = moveCameraKeyframe(track, track.keys[0].time, time, duration);
    expect(moved.keys.map(key => key.time)).toEqual([time, track.keys[1].time]);
    expect(moved.keys[0].camera).toEqual(track.keys[0].camera);
    expect(moved.keys[1]).toBe(track.keys[1]);
    expect(moved.baseCamera).toBe(track.baseCamera);
    expect(() => moveCameraKeyframe(track, track.keys[0].time, track.keys[1].time, duration)).toThrow(/已有/);
    const replaced = moveCameraKeyframe(track, track.keys[0].time, track.keys[1].time, duration, { replace: true });
    expect(replaced.keys).toEqual([{ time: track.keys[1].time, camera: track.keys[0].camera }]);
    expect(track).toEqual(original);
    expect(removeCameraKeyframe(moved, time, duration).keys).toEqual([track.keys[1]]);
  });

  it('enforces the key cap atomically while allowing replacement at the cap', () => {
    const track: CameraTrack = { schema: 'camera-track-1', baseCamera: base(), keys: Array.from({ length: MAX_CAMERA_KEYS }, (_, index) => ({ time: index / MAX_CAMERA_KEYS, camera: back() })) };
    validateCameraTrack(track, duration);
    const camera: CameraPose = { position: [3, 2, 1], target: [0, 1, 0] }, original = structuredClone(track);
    expect(() => upsertCameraKeyframe(track, 2, camera, duration)).toThrow(/4096/);
    const replaced = upsertCameraKeyframe(track, track.keys[0].time, camera, duration);
    expect(replaced.keys).toHaveLength(MAX_CAMERA_KEYS);
    expect(replaced.keys[0].camera).toEqual(camera);
    expect(track).toEqual(original);
  });
});

describe('strict lossless camera validation', () => {
  it('rejects malformed or non-finite cameras, unsafe bounds and preview-only fields', () => {
    for (const camera of [
      null, {}, { ...base(), position: [0, 1] }, { ...base(), position: new Array(3) }, { ...base(), position: [0, Infinity, 4] },
      { ...base(), target: [0, NaN, 0] }, { ...base(), position: [CAMERA_COORDINATE_LIMIT + 1, 0, 0] },
      { position: [0, 0, 0], target: [0, 0, MIN_CAMERA_DISTANCE / 2] },
      { ...base(), zoom: .49 }, { ...base(), zoom: 4.01 }, { ...base(), zoom: NaN },
      { ...base(), up: [0, 1, 0] }, { ...base(), unrelated: true },
    ]) expect(() => validateCameraPose(camera)).toThrow();
    expect(() => validateCameraPose({ position: [0, 0, 0], target: [0, 0, MIN_CAMERA_DISTANCE], zoom: .5 })).not.toThrow();
    expect(() => validateCameraPose({ position: [1000, -1000, 1000], target: [-1000, 1000, -1000], zoom: 4 })).not.toThrow();
  });

  it('rejects invalid schema, unsorted/duplicate/out-of-range seconds and excessive arrays', () => {
    for (const track of [
      null, { ...keyed(), schema: 'camera-track-2' }, { ...keyed(), extra: true },
      { ...keyed(), keys: [{ time: -.1, camera: base() }] },
      { ...keyed(), keys: [{ time: duration + .1, camera: base() }] },
      { ...keyed(), keys: [{ time: NaN, camera: base() }] },
      { ...keyed(), keys: [{ time: .5, camera: base() }, { time: .5, camera: back() }] },
      { ...keyed(), keys: [...keyed().keys].reverse() },
      { ...keyed(), keys: [{ time: .5, camera: base(), extra: true }] },
      { ...keyed(), keys: Array.from({ length: MAX_CAMERA_KEYS + 1 }, (_, index) => ({ time: index / MAX_CAMERA_KEYS, camera: base() })) },
    ]) expect(() => validateCameraTrack(track, duration)).toThrow();
    for (const invalid of [0, -1, NaN, Infinity]) expect(() => validateCameraTrack(keyed(), invalid)).toThrow();
    for (const invalid of [NaN, Infinity]) expect(() => sampleCameraTrack(keyed(), invalid, duration)).toThrow();
    for (const invalid of [-.1, duration + .1, NaN]) expect(() => moveCameraKeyframe(keyed(), .5, invalid, duration)).toThrow();
  });
});
