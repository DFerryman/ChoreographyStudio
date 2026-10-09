import { Matrix4, Quaternion, Vector3 } from 'three';
import type { Vec3 } from './motion-types';

/** Authored camera values. An omitted zoom retains the legacy default of 1. */
export interface CameraPose { position: Vec3; target: Vec3; zoom?: number }
export interface CameraKeyframe { time: number; camera: CameraPose }
export interface CameraTrack {
  schema: 'camera-track-1';
  baseCamera: CameraPose;
  /** Exact seconds, strictly increasing; no frame snapping or motion rebaking. */
  keys: CameraKeyframe[];
}
/** Preview orientation only: up is derived, never an authored/serialized channel. */
export interface SampledCameraPose extends CameraPose { up?: Vec3 }

export const MAX_CAMERA_KEYS = 4096;
export const CAMERA_COORDINATE_LIMIT = 1000;
export const MIN_CAMERA_DISTANCE = .01;
export const CAMERA_ZOOM_LIMITS = [.5, 4] as const;

function record(value: unknown, allowed: readonly string[]): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return (prototype === Object.prototype || prototype === null) && Object.keys(value).every(key => allowed.includes(key));
}
function vector(value: unknown): value is Vec3 {
  return Array.isArray(value) && value.length === 3 && Array.from(value).every(component => typeof component === 'number' && Number.isFinite(component) && Math.abs(component) <= CAMERA_COORDINATE_LIMIT);
}
function durationRange(duration: number): void {
  if (typeof duration !== 'number' || !Number.isFinite(duration) || duration <= 0) throw new Error('相机轨道需要有限且大于零的场景时长。');
}
function keyTime(time: number, duration: number): void {
  if (typeof time !== 'number' || !Number.isFinite(time) || time < 0 || time > duration) throw new Error('相机 K 时间必须是场景范围内的精确有限秒数。');
}

/** Strict, lossless validation shared by runtime edits and scene backup decoding. */
export function validateCameraPose(value: unknown): asserts value is CameraPose {
  if (!record(value, ['position', 'target', 'zoom']) || !vector(value.position) || !vector(value.target)) throw new Error('相机位置和目标需要三个有限坐标，绝对值不能超过 1000 米。');
  const position = value.position, target = value.target;
  if (Math.hypot(...position.map((component, axis) => component - target[axis])) < MIN_CAMERA_DISTANCE) throw new Error('相机位置和目标至少需要相距 0.01 米。');
  if (value.zoom !== undefined && (typeof value.zoom !== 'number' || !Number.isFinite(value.zoom) || value.zoom < CAMERA_ZOOM_LIMITS[0] || value.zoom > CAMERA_ZOOM_LIMITS[1])) throw new Error('相机缩放范围为 0.5 至 4。');
}

export function validateCameraTrack(value: unknown, duration: number): asserts value is CameraTrack {
  durationRange(duration);
  if (!record(value, ['schema', 'baseCamera', 'keys']) || value.schema !== 'camera-track-1' || !Array.isArray(value.keys)) throw new Error('相机轨道格式无效。');
  validateCameraPose(value.baseCamera);
  if (value.keys.length > MAX_CAMERA_KEYS) throw new Error(`相机轨道最多保存 ${MAX_CAMERA_KEYS} 个 K。`);
  let previous = -1;
  for (const key of value.keys) {
    if (!record(key, ['time', 'camera'])) throw new Error('相机 K 格式无效。');
    keyTime(key.time as number, duration);
    if ((key.time as number) <= previous) throw new Error('相机 K 时间必须严格递增且不能重复。');
    previous = key.time as number;
    validateCameraPose(key.camera);
  }
}

export function cloneCameraPose(camera: CameraPose): CameraPose {
  return { position: [...camera.position], target: [...camera.target], ...(camera.zoom !== undefined ? { zoom: camera.zoom } : {}) };
}
export function cloneCameraTrack(track: CameraTrack): CameraTrack {
  return { schema: track.schema, baseCamera: cloneCameraPose(track.baseCamera), keys: track.keys.map(key => ({ time: key.time, camera: cloneCameraPose(key.camera) })) };
}
export function makeCameraTrack(baseCamera: CameraPose): CameraTrack {
  validateCameraPose(baseCamera);
  return { schema: 'camera-track-1', baseCamera: cloneCameraPose(baseCamera), keys: [] };
}

/** Effective zoom equality preserves old records with no explicit zoom. */
export function sameCameraPose(a: CameraPose, b: CameraPose, epsilon = 0): boolean {
  if (!Number.isFinite(epsilon) || epsilon < 0) throw new Error('相机比较精度必须是有限非负数。');
  return a.position.every((component, axis) => Math.abs(component - b.position[axis]) <= epsilon)
    && a.target.every((component, axis) => Math.abs(component - b.target[axis]) <= epsilon)
    && Math.abs((a.zoom ?? 1) - (b.zoom ?? 1)) <= epsilon;
}

type CameraOrientation = { rotation: Quaternion; distance: number };
function orientation(camera: CameraPose): CameraOrientation {
  const back = new Vector3(...camera.position).sub(new Vector3(...camera.target));
  const distance = back.length();
  back.divideScalar(distance);
  const right = new Vector3(0, 1, 0).cross(back);
  // An exactly vertical view needs a deterministic basis without perturbing its direction.
  if (right.lengthSq() < 1e-24) right.set(1, 0, 0).addScaledVector(back, -back.x).normalize();
  else right.normalize();
  const up = new Vector3().crossVectors(back, right).normalize();
  return { rotation: new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(right, up, back)).normalize(), distance };
}

function exactSample(camera: CameraPose, frame: CameraOrientation): SampledCameraPose {
  return { ...cloneCameraPose(camera), up: new Vector3(0, 1, 0).applyQuaternion(frame.rotation).toArray() as Vec3 };
}
function interpolate(a: CameraPose, b: CameraPose, amount: number, from: CameraOrientation, to: CameraOrientation): SampledCameraPose {
  const rotation = from.rotation.clone().slerp(to.rotation, amount);
  const distance = Math.exp(Math.log(from.distance) * (1 - amount) + Math.log(to.distance) * amount);
  const target = new Vector3(...a.target).lerp(new Vector3(...b.target), amount);
  const position = new Vector3(0, 0, 1).applyQuaternion(rotation).multiplyScalar(distance).add(target);
  const up = new Vector3(0, 1, 0).applyQuaternion(rotation);
  return {
    position: position.toArray() as Vec3, target: target.toArray() as Vec3, up: up.toArray() as Vec3,
    zoom: Math.exp(Math.log(a.zoom ?? 1) * (1 - amount) + Math.log(b.zoom ?? 1) * amount),
  };
}

function sampleValidated(track: CameraTrack, time: number, frameFor: (camera: CameraPose) => CameraOrientation = orientation): SampledCameraPose {
  const keys = track.keys;
  if (!keys.length || time <= 0 && keys[0].time > 0) return exactSample(track.baseCamera, frameFor(track.baseCamera));
  if (time >= keys[keys.length - 1].time) return exactSample(keys[keys.length - 1].camera, frameFor(keys[keys.length - 1].camera));
  let low = 0, high = keys.length - 1;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (keys[middle].time < time) low = middle + 1;
    else high = middle;
  }
  const next = keys[low];
  if (time === next.time) return exactSample(next.camera, frameFor(next.camera));
  const previous = low ? keys[low - 1] : { time: 0, camera: track.baseCamera };
  return interpolate(previous.camera, next.camera, (time - previous.time) / (next.time - previous.time), frameFor(previous.camera), frameFor(next.camera));
}

/**
 * Base camera anchors t=0 unless an explicit zero key replaces it. Hold after the
 * last key. Exact keys retain their saved components; every preview derives up,
 * including vertical endpoints. Spherical positions can exceed authored bounds.
 */
export function sampleCameraTrack(track: CameraTrack, time: number, duration: number): SampledCameraPose {
  validateCameraTrack(track, duration);
  if (typeof time !== 'number' || !Number.isFinite(time)) throw new Error('相机播放时间必须是有限秒数。');
  return sampleValidated(track, Math.max(0, Math.min(duration, time)));
}

/** Validate/copy/precompute once; each subsequent preview only searches O(log n). */
export function createCameraTrackSampler(track: CameraTrack, duration: number): (time: number) => SampledCameraPose {
  validateCameraTrack(track, duration);
  const owned = cloneCameraTrack(track);
  const frames = new Map<CameraPose, CameraOrientation>();
  for (const camera of [owned.baseCamera, ...owned.keys.map(key => key.camera)]) frames.set(camera, orientation(camera));
  return time => {
    if (typeof time !== 'number' || !Number.isFinite(time)) throw new Error('相机播放时间必须是有限秒数。');
    return sampleValidated(owned, Math.max(0, Math.min(duration, time)), camera => frames.get(camera)!);
  };
}

/** A supplied camera equal to the current view is a no-op, including empty tracks. */
export function upsertCameraKeyframe(track: CameraTrack, time: number, camera: CameraPose, duration: number): CameraTrack {
  validateCameraTrack(track, duration); keyTime(time, duration); validateCameraPose(camera);
  if (sameCameraPose(sampleValidated(track, time), camera)) return track;
  const keys = track.keys.filter(key => key.time !== time);
  if (keys.length >= MAX_CAMERA_KEYS) throw new Error(`相机轨道最多保存 ${MAX_CAMERA_KEYS} 个 K。`);
  keys.push({ time, camera: cloneCameraPose(camera) });
  keys.sort((a, b) => a.time - b.time);
  return { ...track, keys };
}

/** Same-time target collisions require an explicit replace option; failure is atomic. */
export function moveCameraKeyframe(track: CameraTrack, sourceTime: number, targetTime: number, duration: number, options: { replace?: boolean } = {}): CameraTrack {
  validateCameraTrack(track, duration); keyTime(sourceTime, duration); keyTime(targetTime, duration);
  if (!record(options, ['replace']) || options.replace !== undefined && typeof options.replace !== 'boolean') throw new Error('相机 K 移动选项无效。');
  const source = track.keys.find(key => key.time === sourceTime);
  if (!source || sourceTime === targetTime) return track;
  if (track.keys.some(key => key.time === targetTime) && !options.replace) throw new Error('目标时刻已有相机 K，请先确认是否覆盖。');
  const keys = track.keys.filter(key => key.time !== sourceTime && key.time !== targetTime);
  keys.push({ time: targetTime, camera: cloneCameraPose(source.camera) });
  keys.sort((a, b) => a.time - b.time);
  return { ...track, keys };
}

export function removeCameraKeyframe(track: CameraTrack, time: number, duration: number): CameraTrack {
  validateCameraTrack(track, duration); keyTime(time, duration);
  if (!track.keys.some(key => key.time === time)) return track;
  return { ...track, keys: track.keys.filter(key => key.time !== time) };
}
