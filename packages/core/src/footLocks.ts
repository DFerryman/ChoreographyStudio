import { Quaternion, Vector3 } from 'three';
import { clonePose, evaluatePose } from './humanoid';
import { solveLimbIK } from './ik';
import { constrainJointRotation } from './jointConstraints';
import type { Pose, Quat, Vec3 } from './motion-types';

export type LockedFoot = 'LeftFoot' | 'RightFoot';
/** World-space ankle anchor and sole orientation, never a joint-center floor proxy. */
export type FootLock = {
  schema: 'foot-lock-1'; id: string; foot: LockedFoot;
  startFrame: number; endFrame: number;
  target: Vec3; rotation: Quat; blendFrames: number;
};
export const MAX_FOOT_LOCKS = 32;
let fallbackId = 0;
const id = () => `foot_${(typeof crypto !== 'undefined' ? crypto.randomUUID?.() : undefined) ?? `${Date.now()}_${++fallbackId}`}`;
const finiteVector = (value: unknown, length: number): value is number[] => Array.isArray(value) && value.length === length && value.every(component => typeof component === 'number' && Number.isFinite(component));

export function cloneFootLock(lock: FootLock): FootLock { return { ...lock, target: [...lock.target], rotation: [...lock.rotation] }; }

/** Shared strict validation for local scenes, bounded backups and editing. */
export function validateFootLocks(locks: readonly FootLock[], durationSeconds: number): void {
  if (!Array.isArray(locks) || locks.length > MAX_FOOT_LOCKS || !Number.isFinite(durationSeconds) || durationSeconds <= 0 || durationSeconds > 60) throw new Error('脚锁数量或时长超出当前预览范围。');
  const end = Math.ceil(durationSeconds * 30), ids = new Set<string>();
  for (const lock of locks) {
    if (!lock || typeof lock !== 'object' || lock.schema !== 'foot-lock-1' || typeof lock.id !== 'string' || !lock.id || lock.id.length > 160 || ids.has(lock.id) || !['LeftFoot', 'RightFoot'].includes(lock.foot)) throw new Error('脚锁版本、标识或脚部无效。');
    if (!Number.isInteger(lock.startFrame) || !Number.isInteger(lock.endFrame) || lock.startFrame < 0 || lock.endFrame > end || lock.endFrame <= lock.startFrame || !Number.isInteger(lock.blendFrames) || lock.blendFrames < 0 || lock.blendFrames > 15) throw new Error('脚锁起止或过渡帧无效。');
    if (!finiteVector(lock.target, 3) || lock.target.some((value: number) => Math.abs(value) > 10) || !finiteVector(lock.rotation, 4) || Math.abs(Math.hypot(...lock.rotation) - 1) > 1e-6) throw new Error('脚锁锚点或单位旋转无效。');
    ids.add(lock.id);
  }
  for (const foot of ['LeftFoot', 'RightFoot'] as const) {
    const sorted = locks.filter(lock => lock.foot === foot).sort((a, b) => a.startFrame - b.startFrame);
    // Intervals are closed; a shared endpoint is an ambiguous double anchor.
    for (let index = 1; index < sorted.length; index++) if (sorted[index].startFrame <= sorted[index - 1].endFrame) throw new Error('同一只脚的脚锁区间不能重叠。');
  }
}

export function captureFootLock(pose: Pose, foot: LockedFoot, startFrame: number, endFrame: number, blendFrames = 3): FootLock {
  if (!['LeftFoot', 'RightFoot'].includes(foot)) throw new Error('只能锁定左右脚。');
  const world = evaluatePose(pose)[foot];
  return { schema: 'foot-lock-1', id: id(), foot, startFrame, endFrame, target: [...world.position], rotation: [...world.rotation], blendFrames };
}

export function footLockWeight(lock: FootLock, frame: number, finalFrame: number): number {
  const rounded = Math.round(frame);
  if (Math.abs(frame - rounded) < 1e-7) frame = rounded;
  if (frame < lock.startFrame || frame > lock.endFrame) return 0;
  if (!lock.blendFrames) return 1;
  const length = Math.min(lock.blendFrames, (lock.endFrame - lock.startFrame) / 2);
  const enter = lock.startFrame === 0 ? 1 : Math.min(1, (frame - lock.startFrame) / length);
  const leave = lock.endFrame === finalFrame ? 1 : Math.min(1, (lock.endFrame - frame) / length);
  const weight = Math.max(0, Math.min(enter, leave));
  return weight * weight * (3 - 2 * weight);
}

export type FootLockResult = {
  pose: Pose; adjustedRoot: boolean;
  residuals: { id: string; foot: LockedFoot; residual: number; orientationResidual: number; weight: number; reached: boolean }[];
};

/**
 * Explicit support constraints only: lower Root Y if a anchored foot would be
 * beyond the fixed leg reach. Independent IK never moves Root. Impossible
 * horizontal reach or ankle orientation is reported rather than stretching.
 */
export function applyFootLocks(pose: Pose, locks: readonly FootLock[], frame: number, durationSeconds: number): FootLockResult {
  validateFootLocks(locks, durationSeconds);
  if (!Number.isFinite(frame) || frame < 0 || frame > Math.ceil(durationSeconds * 30)) throw new Error('脚锁求值帧超出范围。');
  const finalFrame = Math.ceil(durationSeconds * 30);
  const active = locks.map(lock => ({ lock, weight: footLockWeight(lock, frame, finalFrame) })).filter(item => item.weight > 0);
  const result = clonePose(pose), world = evaluatePose(result);
  let rootY = result.root[1];
  for (const { lock, weight } of active) {
    const upper = lock.foot === 'LeftFoot' ? 'LeftUpperLeg' : 'RightUpperLeg';
    const origin = world[upper].position;
    const horizontal = Math.hypot(origin[0] - lock.target[0], origin[2] - lock.target[2]);
    const reach = 0.46 + 0.45;
    if (horizontal < reach && origin[1] > lock.target[1]) {
      const maxY = lock.target[1] + Math.sqrt(reach * reach - horizontal * horizontal) - (origin[1] - result.root[1]);
      rootY = Math.min(rootY, result.root[1] + weight * (Math.max(0, maxY) - result.root[1]));
    }
  }
  result.root[1] = rootY;
  const residuals: FootLockResult['residuals'] = [];
  for (const { lock, weight } of active) {
    const solved = solveLimbIK(result, lock.foot, lock.target, { preserveEndRotation: lock.rotation });
    for (const joint of solved.changedJoints) result.joints[joint] = constrainJointRotation(joint, new Quaternion(...result.joints[joint]).slerp(new Quaternion(...solved.pose.joints[joint]), weight).normalize().toArray() as Quat);
    const endpoint = evaluatePose(result)[lock.foot];
    const residual = new Vector3(...endpoint.position).distanceTo(new Vector3(...lock.target));
    const orientationResidual = new Quaternion(...endpoint.rotation).angleTo(new Quaternion(...lock.rotation));
    residuals.push({ id: lock.id, foot: lock.foot, residual, orientationResidual, weight, reached: residual <= 0.005 && orientationResidual <= Math.PI / 180 * 2 });
  }
  return { pose: result, adjustedRoot: Math.abs(rootY - pose.root[1]) > 1e-10, residuals };
}
