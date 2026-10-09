import { MAX_CAMERA_KEYS, validateCameraTrack } from '../../../packages/core/src/cameraTrack';

/** Camera keys have a separate budget; they never consume or reshape Take samples. */
export const SCENE_CAMERA_TRACK_LIMITS = { history: 12, totalKeys: MAX_CAMERA_KEYS * 12 } as const;

/**
 * Validate only the optional camera extension, without touching legacy projects
 * or rebuilding motion. Storage and the wire codec otherwise accept generic
 * project payloads; a track requires its own snapshot's confirmed duration.
 */
export function validateProjectCameraTracks(value: unknown): void {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return;
  const history = (value as Record<string, unknown>).history;
  if (!Array.isArray(history)) return;
  let totalKeys = 0;
  for (const value of history) {
    if (!value || typeof value !== 'object' || Array.isArray(value) || !Object.hasOwn(value, 'cameraTrack')) continue;
    if (history.length > SCENE_CAMERA_TRACK_LIMITS.history) throw new Error('相机轨道的历史数量超出范围。');
    const snapshot = value as Record<string, unknown>;
    const countMap = snapshot.countMap;
    const duration = countMap && typeof countMap === 'object' && !Array.isArray(countMap)
      ? (countMap as Record<string, unknown>).durationSeconds : undefined;
    if (typeof duration !== 'number' || !Number.isFinite(duration) || duration <= 0) throw new Error('相机轨道缺少有效的场景时长。');
    validateCameraTrack(snapshot.cameraTrack, duration);
    totalKeys += snapshot.cameraTrack.keys.length;
    if (totalKeys > SCENE_CAMERA_TRACK_LIMITS.totalKeys) throw new Error('整个场景的相机关键帧数量超出范围。');
  }
}
