/**
 * Phase 1 preview contract, deliberately separate from the unverified v2.1 rig.
 * This module contains original procedural poses, not recorded dance material.
 * Coordinates: meters, right handed, +Y up, +Z forward. Local rest limbs point down.
 * A pose's root includes the 1.05 m neutral hip height. Quaternions are [x,y,z,w].
 */
import { JOINT_NAMES, type BakedTake, type JointName, type Pose, type Quat, type Vec3 } from './motion-types';
export { JOINT_NAMES } from './motion-types';
export type { BakedTake, JointName, Pose, Quat, Vec3 } from './motion-types';
export * from './keyframes';
export * from './motionPoints';
export * from './jointConstraints';
export * from './humanoid';
export * from './ik';
export * from './footLocks';
export * from './humanProfile';
export * from './physics';
export * from './capsuleCollision';
export * from './rapierBackend';
export { AVATAR_COLLISION_PROFILE } from './avatarCapsules.generated';
export * from './aiChoreography';
export * from './stepAssistance';

export interface CountMap {
  id: string;
  version: number;
  bpm: number;
  musicBeatsPerDanceCount: 0.5 | 1 | 2;
  firstCountSourceSeconds: number;
  sourceOffsetSeconds: number;
  durationSeconds: number;
  octetCount: number;
  /** Relative to the selected take: count onsets plus the exact ending D. */
  countTimesSeconds: number[];
  confirmed: true;
}
export interface CountMapInput {
  bpm: number;
  musicBeatsPerDanceCount: 0.5 | 1 | 2;
  firstCountSourceSeconds: number;
  /** Zero based index in the source music. The interface displays this + 1. */
  startOctet?: number;
  octetCount: number;
  audioDurationSeconds: number;
}

export interface DemoAction {
  id: string;
  label: string;
  cue: string;
  /** Preview estimate only; these movements have not been reviewed by teachers. */
  complexity: 1 | 2 | 3;
  provenance: 'synthetic-demo';
}
export const ACTIONS: readonly DemoAction[] = [
  { id: 'step-touch', label: '左右点步', cue: '小幅左右重心移动，手臂自然摆动。', complexity: 1, provenance: 'synthetic-demo' },
  { id: 'side-reach', label: '侧向舒展', cue: '交替向两侧抬手，肩膀保持放松。', complexity: 2, provenance: 'synthetic-demo' },
  { id: 'groove', label: '轻柔律动', cue: '跟随拍点轻屈膝，双手在身前自然摆动。', complexity: 1, provenance: 'synthetic-demo' },
  { id: 'diagonal-reach', label: '斜向伸展', cue: '交替向斜上方伸手，保持动作幅度舒适。', complexity: 2, provenance: 'synthetic-demo' },
  { id: 'overhead-reach', label: '双手上展', cue: '双手缓缓向上展开，再回到身体两侧。', complexity: 2, provenance: 'synthetic-demo' },
  { id: 'settle', label: '舒展收势', cue: '双手放松，轻缓移动重心，回到自然站姿。', complexity: 1, provenance: 'synthetic-demo' },
];

export interface ArrangementSlot {
  slotIndex: number;
  actionId: string;
  label: string;
  teachingCue: string;
  startSeconds: number;
  endSeconds: number;
  /** Both inclusive, one based dance counts within this arrangement. */
  countStart: number;
  countEnd: number;
  role: 'opening' | 'body' | 'closing';
}
export interface ArrangementPlan {
  id: string;
  countMapId: string;
  durationSeconds: number;
  slots: ArrangementSlot[];
  provenance: 'synthetic-demo';
}
const EPSILON = 1e-9;
const FPS = 30;
let fallbackId = 0;
const id = (prefix: string) => `${prefix}_${(typeof crypto !== 'undefined' ? crypto.randomUUID?.() : undefined) ?? `${Date.now()}_${++fallbackId}`}`;
const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value));
const finite = (value: number, label: string) => {
  if (!Number.isFinite(value)) throw new Error(`${label}必须是有限数字。`);
};
const countSeconds = (map: CountMap) => 60 / map.bpm * map.musicBeatsPerDanceCount;

/** Build an explicitly confirmed selection of whole eight-count phrases. */
export function makeCountMap(input: CountMapInput): CountMap {
  const { bpm, musicBeatsPerDanceCount, firstCountSourceSeconds, octetCount, audioDurationSeconds } = input;
  const startOctet = input.startOctet ?? 0;
  finite(bpm, 'BPM');
  finite(firstCountSourceSeconds, '第一拍时间');
  finite(audioDurationSeconds, '音频时长');
  if (bpm < 30 || bpm > 240) throw new Error('当前预览支持 30–240 BPM，请在此范围内确认数拍。');
  if (![0.5, 1, 2].includes(musicBeatsPerDanceCount)) throw new Error('每舞蹈拍对应的音乐拍数必须为 0.5、1 或 2。');
  if (firstCountSourceSeconds < 0) throw new Error('第一拍时间不能早于音频开头。');
  if (!Number.isInteger(startOctet) || startOctet < 0) throw new Error('起始八拍索引必须是非负整数。');
  if (!Number.isInteger(octetCount) || octetCount < 2) throw new Error('八拍数量必须是至少 2 的整数，不能使用不完整八拍。');
  if (octetCount > 60) throw new Error('当前预览支持最多 60 个完整八拍。');
  if (audioDurationSeconds <= 0) throw new Error('音频时长必须大于 0。');
  const secondsPerCount = 60 / bpm * musicBeatsPerDanceCount;
  const durationSeconds = octetCount * 8 * secondsPerCount;
  const sourceOffsetSeconds = firstCountSourceSeconds + startOctet * 8 * secondsPerCount;
  if (durationSeconds < 16 - EPSILON || durationSeconds > 60 + EPSILON) {
    throw new Error('请选择完整八拍，使组合时长介于 16–60 秒。');
  }
  if (sourceOffsetSeconds + durationSeconds > audioDurationSeconds + EPSILON) {
    throw new Error('所选完整八拍超出音频范围，请减少八拍数量或提前起点。');
  }
  return {
    id: id('countmap'), version: 1, bpm, musicBeatsPerDanceCount,
    firstCountSourceSeconds, sourceOffsetSeconds, durationSeconds, octetCount,
    countTimesSeconds: Array.from({ length: octetCount * 8 + 1 }, (_, index) => index * secondsPerCount),
    confirmed: true,
  };
}

export function makePlan(map: CountMap): ArrangementPlan {
  if (!map.confirmed) throw new Error('请先确认数拍。');
  const sequence = ['step-touch', 'side-reach', 'groove', 'diagonal-reach', 'step-touch', 'side-reach', 'overhead-reach'];
  const slots = Array.from({ length: map.octetCount }, (_, slotIndex): ArrangementSlot => {
    const actionId = slotIndex === map.octetCount - 1 ? 'settle' : sequence[slotIndex % sequence.length];
    const action = getAction(actionId);
    return {
      slotIndex, actionId, label: action.label, teachingCue: action.cue,
      startSeconds: map.countTimesSeconds[slotIndex * 8],
      endSeconds: map.countTimesSeconds[(slotIndex + 1) * 8],
      countStart: slotIndex * 8 + 1, countEnd: (slotIndex + 1) * 8,
      role: slotIndex === 0 ? 'opening' : slotIndex === map.octetCount - 1 ? 'closing' : 'body',
    };
  });
  return { id: id('plan'), countMapId: map.id, durationSeconds: map.durationSeconds, slots, provenance: 'synthetic-demo' };
}

const identity = (): Quat => [0, 0, 0, 1];
const neutralPose = (): Pose => ({
  root: [0, 1.05, 0],
  joints: Object.fromEntries(JOINT_NAMES.map(name => [name, identity()])) as Record<JointName, Quat>,
});
const copyPose = (pose: Pose): Pose => ({
  root: [...pose.root],
  joints: Object.fromEntries(JOINT_NAMES.map(name => [name, [...pose.joints[name]]])) as Record<JointName, Quat>,
});
function normalizeQuaternion(q: Quat): Quat {
  const length = Math.hypot(...q);
  if (length <= Number.EPSILON) throw new Error('姿态含无效的零四元数。');
  return q.map(value => value / length) as Quat;
}
function slerp(a: Quat, b: Quat, amount: number): Quat {
  const qa = normalizeQuaternion(a);
  let qb = normalizeQuaternion(b);
  let dot = qa.reduce((sum, value, index) => sum + value * qb[index], 0);
  if (dot < 0) { qb = qb.map(value => -value) as Quat; dot = -dot; }
  dot = clamp(dot, -1, 1);
  if (dot > 0.9995) return normalizeQuaternion(qa.map((value, index) => value + amount * (qb[index] - value)) as Quat);
  const theta = Math.acos(dot);
  const denominator = Math.sin(theta);
  const left = Math.sin((1 - amount) * theta) / denominator;
  const right = Math.sin(amount * theta) / denominator;
  return normalizeQuaternion(qa.map((value, index) => left * value + right * qb[index]) as Quat);
}
function mixPose(a: Pose, b: Pose, amount: number): Pose {
  return {
    root: a.root.map((value, index) => value + amount * (b.root[index] - value)) as Vec3,
    joints: Object.fromEntries(JOINT_NAMES.map(name => [name, slerp(a.joints[name], b.joints[name], amount)])) as Record<JointName, Quat>,
  };
}
/** Quaternion for intrinsic XYZ Euler angles. No renderer or runtime solver is used. */
function euler(x = 0, y = 0, z = 0): Quat {
  const sx = Math.sin(x / 2), cx = Math.cos(x / 2);
  const sy = Math.sin(y / 2), cy = Math.cos(y / 2);
  const sz = Math.sin(z / 2), cz = Math.cos(z / 2);
  return [sx * cy * cz + cx * sy * sz, cx * sy * cz - sx * cy * sz, cx * cy * sz + sx * sy * cz, cx * cy * cz - sx * sy * sz];
}
function getAction(actionId: string): DemoAction {
  const action = ACTIONS.find(candidate => candidate.id === actionId);
  if (!action) throw new Error(`演示动作包不包含动作 ${actionId}。`);
  return action;
}
const smooth = (amount: number) => {
  const x = clamp(amount, 0, 1);
  return x * x * x * (x * (x * 6 - 15) + 10);
};

function proceduralPose(actionId: string, beat: number): Pose {
  const pose = neutralPose();
  const pulse = (1 - Math.cos(Math.PI * beat)) / 2;
  const alternate = Math.sin(Math.PI * beat / 2);
  const breath = Math.sin(Math.PI * beat / 8) ** 2;
  // Facing +Z: anatomical Left is +X. Positive Z lifts that arm outward.
  pose.joints.LeftShoulder = euler(0, 0, 0.04);
  pose.joints.RightShoulder = euler(0, 0, -0.04);
  pose.joints.LeftUpperArm = euler(0, 0, 0.12);
  pose.joints.RightUpperArm = euler(0, 0, -0.12);
  pose.joints.LeftForeArm = euler(-0.08);
  pose.joints.RightForeArm = euler(-0.08);
  if (actionId === 'step-touch') {
    pose.root[0] = 0.055 * alternate;
    pose.root[1] += 0.006 * pulse;
    pose.joints.LeftUpperArm = euler(0.10 * alternate, 0, 0.18);
    pose.joints.RightUpperArm = euler(-0.10 * alternate, 0, -0.18);
    pose.joints.LeftUpperLeg = euler(-0.025 * alternate);
    pose.joints.RightUpperLeg = euler(0.025 * alternate);
  } else if (actionId === 'side-reach') {
    pose.root[0] = 0.045 * alternate;
    pose.joints.Chest = euler(0, 0, -0.025 * alternate);
    pose.joints.LeftUpperArm = euler(-0.08, 0, 0.30 + 0.85 * (1 - alternate) / 2);
    pose.joints.RightUpperArm = euler(-0.08, 0, -(0.30 + 0.85 * (1 + alternate) / 2));
  } else if (actionId === 'groove') {
    pose.root[0] = 0.025 * alternate;
    pose.root[1] -= 0.014 * pulse;
    pose.joints.LeftUpperLeg = euler(-0.065 * pulse);
    pose.joints.RightUpperLeg = euler(-0.065 * pulse);
    pose.joints.LeftLowerLeg = euler(0.13 * pulse);
    pose.joints.RightLowerLeg = euler(0.13 * pulse);
    pose.joints.LeftUpperArm = euler(-0.10, 0, 0.30);
    pose.joints.RightUpperArm = euler(-0.10, 0, -0.30);
    pose.joints.LeftForeArm = euler(-0.32 - 0.22 * pulse);
    pose.joints.RightForeArm = euler(-0.32 - 0.22 * pulse);
  } else if (actionId === 'diagonal-reach') {
    pose.joints.Chest = euler(0, 0.055 * alternate);
    pose.joints.LeftUpperArm = euler(-0.25, 0, 0.30 + 1.55 * (1 - alternate) / 2);
    pose.joints.RightUpperArm = euler(-0.25, 0, -(0.30 + 1.55 * (1 + alternate) / 2));
    pose.joints.Head = euler(0, 0.035 * alternate);
  } else if (actionId === 'overhead-reach') {
    pose.joints.LeftUpperArm = euler(-0.10, 0, 0.15 + 2.35 * breath);
    pose.joints.RightUpperArm = euler(-0.10, 0, -(0.15 + 2.35 * breath));
    pose.joints.LeftForeArm = euler(-0.08 - 0.15 * breath);
    pose.joints.RightForeArm = euler(-0.08 - 0.15 * breath);
  } else if (actionId === 'settle') {
    pose.root[0] = 0.015 * alternate * (1 - breath);
    pose.joints.LeftUpperArm = euler(0, 0, 0.12 + 0.3 * breath);
    pose.joints.RightUpperArm = euler(0, 0, -(0.12 + 0.3 * breath));
  } else {
    getAction(actionId); // Fail rather than silently rendering an unsupported action.
  }
  return pose;
}

function validatePlan(plan: ArrangementPlan, map: CountMap): void {
  if (plan.countMapId !== map.id || Math.abs(plan.durationSeconds - map.durationSeconds) > EPSILON) throw new Error('编排与数拍版本不匹配。');
  if (plan.slots.length !== map.octetCount) throw new Error('编排必须覆盖全部完整八拍。');
  plan.slots.forEach((slot, index) => {
    if (slot.slotIndex !== index || Math.abs(slot.startSeconds - map.countTimesSeconds[index * 8]) > EPSILON || Math.abs(slot.endSeconds - map.countTimesSeconds[(index + 1) * 8]) > EPSILON) {
      throw new Error('编排八拍边界与已确认数拍不匹配。');
    }
    getAction(slot.actionId);
  });
}

function poseForPlan(plan: ArrangementPlan, map: CountMap, time: number): Pose {
  const secondsPerCount = countSeconds(map);
  const octetSeconds = secondsPerCount * 8;
  const index = Math.min(plan.slots.length - 1, Math.floor(time / octetSeconds));
  const evaluate = (slotIndex: number) => {
    const slot = plan.slots[slotIndex];
    return proceduralPose(slot.actionId, (time - slot.startSeconds) / secondsPerCount);
  };
  // This is baking-time blending only. Playback never solves or edits poses.
  const radius = Math.min(0.3, secondsPerCount * 0.6);
  if (index > 0 && time - plan.slots[index].startSeconds < radius) {
    const boundary = plan.slots[index].startSeconds;
    return mixPose(evaluate(index - 1), evaluate(index), smooth((time - boundary + radius) / (2 * radius)));
  }
  if (index < plan.slots.length - 1 && plan.slots[index].endSeconds - time < radius) {
    const boundary = plan.slots[index].endSeconds;
    return mixPose(evaluate(index), evaluate(index + 1), smooth((time - boundary + radius) / (2 * radius)));
  }
  return evaluate(index);
}

export function bakePlan(plan: ArrangementPlan, map: CountMap): BakedTake {
  validatePlan(plan, map);
  const end = map.durationSeconds;
  const boundaries = [0, end, ...plan.slots.map(slot => slot.startSeconds), ...plan.slots.map(slot => slot.endSeconds)];
  const rawTimes = [...boundaries];
  for (let frame = 1; frame / FPS < end - EPSILON; frame += 1) {
    const time = frame / FPS;
    // Prefer exact contract boundaries to a nearly equal floating-point grid time.
    if (!boundaries.some(boundary => Math.abs(boundary - time) < 1e-12)) rawTimes.push(time);
  }
  rawTimes.sort((a, b) => a - b);
  const times = rawTimes.filter((time, index) => index === 0 || time - rawTimes[index - 1] > 1e-12);
  times[times.length - 1] = end;
  return {
    id: id('take'), schemaVersion: 'preview-1', planId: plan.id, countMapId: map.id,
    durationSeconds: end, times, poses: times.map(time => poseForPlan(plan, map, time)), provenance: 'synthetic-demo',
  };
}

/** Interpolate by explicit sample timestamps, including nonuniform ending samples. */
export function sampleTake(take: BakedTake, time: number): Pose {
  finite(time, '播放时间');
  const { times, poses } = take;
  if (times.length < 2 || times.length !== poses.length) throw new Error('烘焙样本缺失或时间与姿态数量不匹配。');
  if (time <= times[0]) return copyPose(poses[0]);
  if (time >= times[times.length - 1]) return copyPose(poses[poses.length - 1]);
  let low = 0, high = times.length - 1;
  while (high - low > 1) {
    const middle = Math.floor((low + high) / 2);
    if (times[middle] <= time) low = middle;
    else high = middle;
  }
  if (time === times[low]) return copyPose(poses[low]);
  const amount = (time - times[low]) / (times[high] - times[low]);
  return mixPose(poses[low], poses[high], amount);
}

export function countAt(map: CountMap, time: number): { octet: number; count: number } {
  finite(time, '播放时间');
  const totalCounts = map.octetCount * 8;
  const index = Math.min(totalCounts - 1, Math.floor(clamp(time, 0, map.durationSeconds) / countSeconds(map) + EPSILON));
  return { octet: Math.floor(index / 8) + 1, count: index % 8 + 1 };
}

/**
 * Produce a candidate; accepting/discarding it belongs to UI state.
 * All samples outside the selected octet, its endpoints, and their nearest inner
 * samples remain exact copies. Thus interpolation and tangent support outside
 * the range stay unchanged. The inner motion uses a quintic blend envelope.
 */
export function replaceSlot(plan: ArrangementPlan, take: BakedTake, map: CountMap, slotIndex: number, simpler = false): { plan: ArrangementPlan; take: BakedTake } {
  validatePlan(plan, map);
  if (take.planId !== plan.id || take.countMapId !== map.id) throw new Error('当前动作、编排与数拍版本不匹配。');
  if (!Number.isInteger(slotIndex) || slotIndex < 0 || slotIndex >= plan.slots.length) throw new Error('请选择一个有效八拍。');
  const selected = plan.slots[slotIndex];
  const current = getAction(selected.actionId);
  const candidates = ACTIONS.filter(action => action.id !== current.id && (!simpler || action.complexity < current.complexity));
  if (!candidates.length) throw new Error('已经是当前演示包最简单的动作，没有更简单的合法替代。');
  const currentIndex = ACTIONS.findIndex(action => action.id === current.id);
  const next = candidates.find(action => ACTIONS.indexOf(action) > currentIndex) ?? candidates[0];
  const newPlan: ArrangementPlan = {
    ...plan, id: id('plan'),
    slots: plan.slots.map(slot => slot.slotIndex === slotIndex
      ? { ...slot, actionId: next.id, label: next.label, teachingCue: next.cue }
      : { ...slot }),
  };
  const startIndex = take.times.findIndex(time => Math.abs(time - selected.startSeconds) < 1e-12);
  const endIndex = take.times.findIndex(time => Math.abs(time - selected.endSeconds) < 1e-12);
  if (startIndex < 0 || endIndex <= startIndex + 2) throw new Error('替换需要包含完整八拍边界和内部样本。');
  const fadeStart = take.times[startIndex + 1];
  const fadeEnd = take.times[endIndex - 1];
  const fadeSeconds = Math.min(0.4, (fadeEnd - fadeStart) / 4);
  const poses = take.poses.map((pose, index) => {
    const time = take.times[index];
    if (time <= fadeStart || time >= fadeEnd) return copyPose(pose);
    const amount = smooth((time - fadeStart) / fadeSeconds) * smooth((fadeEnd - time) / fadeSeconds);
    return mixPose(pose, poseForPlan(newPlan, map, time), amount);
  });
  return {
    plan: newPlan,
    take: { ...take, id: id('take'), planId: newPlan.id, times: [...take.times], poses },
  };
}
