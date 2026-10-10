import { JOINT_NAMES, type BakedTake, type JointName, type Pose, type Quat, type Vec3 } from './motion-types';
// The index only re-exports this module; sampleTake is a function declaration and
// is called after module initialization, not while constructing these constants.
import { sampleTake } from './index';
import { applyFootLocks, cloneFootLock, validateFootLocks, type FootLock, type FootLockProtection } from './footLocks';
import { accumulateStepResiduals, applyStepAssistance, buildStepPlan, validateStepAssistance, type StepAssistance, type StepAssistanceReport } from './stepAssistance';
import { applyMotionPointEdits, cloneMotionPointEdits, freezePointAuthority, validateMotionPointEdits, type MotionPointEdit } from './motionPoints';

export const EDITABLE_JOINT_NAMES: readonly JointName[] = JOINT_NAMES.filter(name => !name.endsWith('HandTip') && !name.endsWith('Toe') && !name.endsWith('Heel'));
export const EDITABLE_JOINTS = EDITABLE_JOINT_NAMES;
export const ROOT_TRANSLATION_LIMITS = { x: [-5, 5], y: [0, 3], z: [-5, 5] } as const;
export const MAX_KEYFRAME_COUNT = 4096;
/** Shared input/output bound, with room for base samples plus 30 Hz edit knots. */
export const MAX_TAKE_SAMPLES = 6001;
export interface RotationKeyframe { frame: number; rotation: Quat }
export interface RootKeyframe { frame: number; position: Vec3 }
export interface KeyframeSequence {
  schema: 'manual-keyframes-1';
  id: string;
  fps: 30;
  /** An immutable snapshot of the authoritative take before this edit layer. */
  baseTake: BakedTake;
  rotations: Partial<Record<JointName, RotationKeyframe[]>>;
  root: RootKeyframe[];
  /** New edits declare author precedence; absence is accepted for legacy data. */
  authorKeyPriority?: 'author-key-priority-1';
  /** Only listed sparse tracks hold their final author key; legacy tracks retain saved endpoint semantics. */
  trackInterpolation?: { schema: 'hold-last-key-1'; tracks: Array<'root' | JointName> };
  /** Fresh manual motion uses exact-time author tracks; imported source edits remain local overlays. */
  pointInterpolation?: 'hold-last-key-1';
  /** Optional persistent world-space support constraints; legacy absence is untouched. */
  footLocks?: FootLock[];
  /** Optional versioned flat-ground stepping, derived around author keys. */
  steps?: StepAssistance;
  /** Exact-time edits; pointInterpolation distinguishes fresh author tracks from source-local overlays. */
  pointEdits?: MotionPointEdit[];
  /** Original saved/evaluated authority before point edits; preserve its stored bits. */
  pointBaseTake?: BakedTake;
}

export type KeyframeTransferScope =
  { kind: 'all' } |
  { kind: 'joint'; joint: JointName } |
  /** Transfer this nonempty, unique set of authored rotation tracks atomically. */
  { kind: 'joints'; joints: JointName[] } |
  { kind: 'root' };
/** Collisions identify occupied concrete tracks, even for a grouped request. */
export type KeyframeTransferTrack = Extract<KeyframeTransferScope, { kind: 'joint' | 'root' }>;
/** Legacy frame callers retain their 19-joint scope; exact-time callers include all 25 point tracks. */
export type KeyframeTransferInput = {
  operation: 'move' | 'copy';
  scope: KeyframeTransferScope;
} & (
  { sourceFrame: number; targetFrame: number; sourceTime?: never; targetTime?: never } |
  { sourceTime: number; targetTime: number; sourceFrame?: never; targetFrame?: never }
);
export type KeyframeTransferRequest = KeyframeTransferInput & {
  /** Replacing occupied tracks requires explicit confirmation by the caller. */
  collision?: 'reject' | 'replace';
};
export type KeyframeTransferResult = {
  sequence: KeyframeSequence;
  /** Normalized seconds are available for every valid request and result. */
  sourceTime: number;
  targetTime: number;
  /** Applied concrete channels; empty for no-ops and unresolved conflicts. */
  changedTracks: KeyframeTransferTrack[];
  /** Count channels once, even when an old sparse key and point overlay coexist. */
  sourceKeyCount: number;
} & (
  { status: 'noop'; reason: 'same-frame' | 'empty-source' | 'unchanged' } |
  { status: 'conflict'; collisions: KeyframeTransferTrack[] } |
  { status: 'changed'; replaced: KeyframeTransferTrack[] }
);

const FPS = 30;
let fallbackId = 0;
const newId = (prefix: string) => `${prefix}_${(typeof crypto !== 'undefined' ? crypto.randomUUID?.() : undefined) ?? `${Date.now()}_${++fallbackId}`}`;
const editable = new Set<JointName>(EDITABLE_JOINT_NAMES);
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const finite = (value: number, label: string) => {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${label}必须是有限数字。`);
};

function validateDuration(duration: number): void {
  finite(duration, '动作时长');
  if (duration <= 0 || duration > 60) throw new Error('关键帧动作时长必须大于 0 且不超过 60 秒。');
}

/** The last frame is an extra, possibly short interval ending at exact D. */
export function lastFrame(durationSeconds: number): number {
  validateDuration(durationSeconds);
  return Math.ceil(durationSeconds * FPS);
}

export function frameTime(frame: number, durationSeconds: number): number {
  const end = lastFrame(durationSeconds);
  if (!Number.isInteger(frame) || frame < 0 || frame > end) throw new Error('关键帧索引必须是动作范围内的整数。');
  return frame === end ? durationSeconds : frame / FPS;
}

/** Pick the nearest actual frame, considering the short final interval. */
export function frameAtTime(time: number, durationSeconds: number): number {
  finite(time, '关键帧时间');
  const end = lastFrame(durationSeconds);
  const bounded = clamp(time, 0, durationSeconds);
  const before = Math.min(end, Math.floor(bounded * FPS));
  const after = Math.min(end, before + 1);
  return bounded - frameTime(before, durationSeconds) < frameTime(after, durationSeconds) - bounded ? before : after;
}

function vector(value: Vec3, label: string): Vec3 {
  if (!Array.isArray(value) || value.length !== 3) throw new Error(`${label}必须包含三个坐标。`);
  for (const component of value) finite(component, label);
  return [...value];
}

function normalizedRotation(value: Quat): Quat {
  if (!Array.isArray(value) || value.length !== 4) throw new Error('局部旋转必须包含 XYZW 四个分量。');
  for (const component of value) finite(component, '局部旋转');
  const norm = Math.hypot(...value);
  if (!Number.isFinite(norm) || norm <= Number.EPSILON) throw new Error('局部旋转不能是零四元数或无效四元数。');
  return value.map(component => component / norm) as Quat;
}

function rootPosition(value: Vec3): Vec3 {
  const copied = vector(value, 'Root 位移');
  const bounds = [ROOT_TRANSLATION_LIMITS.x, ROOT_TRANSLATION_LIMITS.y, ROOT_TRANSLATION_LIMITS.z];
  copied.forEach((component, axis) => {
    if (component < bounds[axis][0] || component > bounds[axis][1]) throw new Error('Root 位移范围为 X/Z −5 至 5 米，Y 0 至 3 米。');
  });
  return copied;
}

/** Intrinsic XYZ Euler degrees, matching the renderer's parent-local convention. */
export function rotationFromDegrees(degrees: Vec3): Quat {
  const [x, y, z] = vector(degrees, '旋转角度').map(value => value * Math.PI / 180);
  const sx = Math.sin(x / 2), cx = Math.cos(x / 2);
  const sy = Math.sin(y / 2), cy = Math.cos(y / 2);
  const sz = Math.sin(z / 2), cz = Math.cos(z / 2);
  return normalizedRotation([sx * cy * cz + cx * sy * sz, cx * sy * cz - sx * cy * sz, cx * cy * sz + sx * sy * cz, cx * cy * cz - sx * sy * sz]);
}

export function rotationToDegrees(rotation: Quat): Vec3 {
  const [x, y, z, w] = normalizedRotation(rotation);
  const m11 = 1 - 2 * (y * y + z * z);
  const m12 = 2 * (x * y - z * w);
  const m13 = 2 * (x * z + y * w);
  const m22 = 1 - 2 * (x * x + z * z);
  const m23 = 2 * (y * z - x * w);
  const m32 = 2 * (y * z + x * w);
  const m33 = 1 - 2 * (x * x + y * y);
  const middle = Math.asin(clamp(m13, -1, 1));
  const first = Math.abs(m13) < 0.9999999 ? Math.atan2(-m23, m33) : Math.atan2(m32, m22);
  const third = Math.abs(m13) < 0.9999999 ? Math.atan2(-m12, m11) : 0;
  return [first, middle, third].map(value => value * 180 / Math.PI) as Vec3;
}

function copyPose(pose: Pose): Pose {
  return { root: [...pose.root], joints: Object.fromEntries(JOINT_NAMES.map(name => [name, [...pose.joints[name]]])) as Pose['joints'] };
}

function validatePose(pose: Pose): void {
  if (!pose || typeof pose !== 'object' || !pose.joints || typeof pose.joints !== 'object') throw new Error('关键帧姿态缺少骨骼。');
  vector(pose.root, '源动作 Root');
  for (const name of JOINT_NAMES) {
    const q = pose.joints[name];
    normalizedRotation(q);
    if (Math.abs(Math.hypot(...q) - 1) > 1e-6) throw new Error('源动作必须使用单位四元数。');
  }
}

function validateTake(take: BakedTake): void {
  if (!take || take.schemaVersion !== 'preview-1' || take.provenance !== 'synthetic-demo' || !take.id || !take.planId || !take.countMapId) throw new Error('关键帧源动作版本或来源无效。');
  validateDuration(take.durationSeconds);
  if (!Array.isArray(take.times) || !Array.isArray(take.poses) || take.times.length < 2 || take.times.length > MAX_TAKE_SAMPLES || take.times.length !== take.poses.length) throw new Error('关键帧源动作样本数量无效或超出预览范围。');
  if (take.times[0] !== 0 || take.times.at(-1) !== take.durationSeconds) throw new Error('关键帧源动作必须保留精确的 0 和结束时刻。');
  for (const [index, time] of take.times.entries()) {
    finite(time, '源动作采样时间');
    if (time < 0 || time > take.durationSeconds || (index > 0 && time <= take.times[index - 1])) throw new Error('源动作采样时间必须严格递增。');
    validatePose(take.poses[index]);
  }
}

function assertEditable(joint: JointName): void {
  if (!editable.has(joint)) throw new Error('这个节点不在 19 个可编辑骨骼中。');
}

function validateSequence(sequence: KeyframeSequence): void {
  if (!sequence || sequence.schema !== 'manual-keyframes-1' || sequence.fps !== FPS || !sequence.id || !sequence.rotations || typeof sequence.rotations !== 'object' || Array.isArray(sequence.rotations) || !Array.isArray(sequence.root)) throw new Error('关键帧序列格式或帧率无效。');
  if (sequence.authorKeyPriority !== undefined && sequence.authorKeyPriority !== 'author-key-priority-1') throw new Error('作者关键帧优先版本无效。');
  if (sequence.pointInterpolation !== undefined && sequence.pointInterpolation !== 'hold-last-key-1') throw new Error('作者数据点插值版本无效。');
  if (sequence.trackInterpolation !== undefined) {
    const interpolation = sequence.trackInterpolation;
    if (!interpolation || interpolation.schema !== 'hold-last-key-1' || !Array.isArray(interpolation.tracks) || interpolation.tracks.length > EDITABLE_JOINT_NAMES.length + 1 || new Set(interpolation.tracks).size !== interpolation.tracks.length || Object.keys(interpolation).some(key => !['schema', 'tracks'].includes(key))) throw new Error('作者关键帧插值版本或轨道无效。');
    for (const track of interpolation.tracks) {
      if (track !== 'root') assertEditable(track);
      if (!(track === 'root' ? sequence.root.length : sequence.rotations[track]?.length)) throw new Error('作者关键帧插值轨道必须包含关键帧。');
    }
  }
  validateTake(sequence.baseTake);
  if (sequence.pointBaseTake !== undefined) {
    validateTake(sequence.pointBaseTake);
    if (sequence.pointBaseTake.planId !== sequence.baseTake.planId || sequence.pointBaseTake.countMapId !== sequence.baseTake.countMapId || sequence.pointBaseTake.durationSeconds !== sequence.baseTake.durationSeconds) throw new Error('数据点源动作与原始动作绑定不一致。');
  }
  if (sequence.footLocks !== undefined) validateFootLocks(sequence.footLocks, sequence.baseTake.durationSeconds);
  if (sequence.steps !== undefined) {
    validateStepAssistance(sequence.steps, sequence.baseTake.durationSeconds);
    if (sequence.authorKeyPriority !== 'author-key-priority-1') throw new Error('自动迈步必须声明作者关键帧优先。');
  }
  let count = sequence.root.length + validateMotionPointEdits(sequence.pointEdits, sequence.baseTake.durationSeconds);
  const tracks = Object.entries(sequence.rotations) as [JointName, RotationKeyframe[]][];
  for (const [joint, keys] of tracks) {
    assertEditable(joint);
    if (!Array.isArray(keys)) throw new Error('局部旋转轨必须是关键帧数组。');
    count += keys.length;
  }
  if (count > MAX_KEYFRAME_COUNT) throw new Error(`当前预览最多支持 ${MAX_KEYFRAME_COUNT} 条关键帧记录。`);
  const validateKeys = <T extends { frame: number }>(keys: T[], validateValue: (key: T) => void) => {
    for (const [index, key] of keys.entries()) {
      if (!key || typeof key !== 'object') throw new Error('关键帧记录无效。');
      frameTime(key.frame, sequence.baseTake.durationSeconds);
      if (index > 0 && key.frame <= keys[index - 1].frame) throw new Error('同一轨的关键帧必须严格递增且不能重复。');
      validateValue(key);
    }
  };
  validateKeys(sequence.root, key => { rootPosition(key.position); });
  for (const [, keys] of tracks) validateKeys(keys, key => {
    normalizedRotation(key.rotation);
    if (Math.abs(Math.hypot(...key.rotation) - 1) > 1e-6) throw new Error('关键帧旋转必须使用单位四元数。');
  });
}

function copySequence(sequence: KeyframeSequence): KeyframeSequence {
  return {
    ...sequence, id: newId('keys'),
    rotations: Object.fromEntries(Object.entries(sequence.rotations).map(([joint, keys]) => [joint, keys!.map(key => ({ frame: key.frame, rotation: [...key.rotation] as Quat }))])),
    root: sequence.root.map(key => ({ frame: key.frame, position: [...key.position] as Vec3 })),
    ...(sequence.trackInterpolation !== undefined ? { trackInterpolation: { ...sequence.trackInterpolation, tracks: [...sequence.trackInterpolation.tracks] } } : {}),
    ...(sequence.footLocks !== undefined ? { footLocks: sequence.footLocks.map(cloneFootLock) } : {}),
    ...(sequence.steps !== undefined ? { steps: { ...sequence.steps } } : {}),
    ...(sequence.pointEdits !== undefined ? { pointEdits: cloneMotionPointEdits(sequence.pointEdits) } : {}),
  };
}

function withPointAuthority(sequence: KeyframeSequence, authority?: BakedTake): KeyframeSequence {
  return !sequence.pointBaseTake && authority ? { ...sequence, pointBaseTake: freezePointAuthority(sequence, authority), pointEdits: sequence.pointEdits ?? [] } : sequence;
}

export function makeKeyframeSequence(baseTake: BakedTake, options: { pointInterpolation?: KeyframeSequence['pointInterpolation'] } = {}): KeyframeSequence {
  validateTake(baseTake);
  if (options.pointInterpolation !== undefined && options.pointInterpolation !== 'hold-last-key-1') throw new Error('作者数据点插值版本无效。');
  return {
    schema: 'manual-keyframes-1', id: newId('keys'), fps: FPS, authorKeyPriority: 'author-key-priority-1',
    baseTake: { ...baseTake, times: [...baseTake.times], poses: baseTake.poses.map(copyPose) },
    rotations: {}, root: [],
    ...(options.pointInterpolation !== undefined ? { pointInterpolation: options.pointInterpolation } : {}),
  };
}

/** Support edits are explicit, immutable and independent of sparse track keys. */
export function addFootLock(sequence: KeyframeSequence, lock: FootLock): KeyframeSequence {
  validateSequence(sequence);
  const next = copySequence(sequence);
  next.footLocks = [...(next.footLocks ?? []), cloneFootLock(lock)].sort((a, b) => a.startFrame - b.startFrame || a.foot.localeCompare(b.foot));
  return finishMutation(next, sequence);
}

export function removeFootLock(sequence: KeyframeSequence, lockId: string): KeyframeSequence {
  validateSequence(sequence);
  if (!sequence.footLocks?.some(lock => lock.id === lockId)) return sequence;
  const next = copySequence(sequence);
  next.footLocks = next.footLocks!.filter(lock => lock.id !== lockId);
  return finishMutation(next, sequence);
}

/** Explicit adoption retains every source/author track and contact. */
export function setStepAssistance(sequence: KeyframeSequence, startFrame = 0, endFrame = lastFrame(sequence.baseTake.durationSeconds)): KeyframeSequence {
  validateSequence(sequence);
  const steps: StepAssistance = { schema: 'ground-steps-1', startFrame, endFrame };
  validateStepAssistance(steps, sequence.baseTake.durationSeconds);
  if (sequence.steps?.schema === steps.schema && sequence.steps.startFrame === startFrame && sequence.steps.endFrame === endFrame) return sequence;
  const next = copySequence(sequence); next.steps = steps;
  return finishMutation(next, sequence);
}

export function removeStepAssistance(sequence: KeyframeSequence): KeyframeSequence {
  validateSequence(sequence);
  if (!sequence.steps) return sequence;
  const next = copySequence(sequence); delete next.steps;
  return finishMutation(next, sequence);
}

function upsert<T extends { frame: number }>(keys: T[], key: T): T[] {
  return [...keys.filter(previous => previous.frame !== key.frame), key].sort((a, b) => a.frame - b.frame);
}

function finishMutation(sequence: KeyframeSequence, previous: KeyframeSequence): KeyframeSequence {
  // Includes the aggregate cap before returning a possibly atomic whole-pose write.
  sequence.authorKeyPriority = 'author-key-priority-1';
  const changedRoot = JSON.stringify(sequence.root) !== JSON.stringify(previous.root);
  const changedJoints = JOINT_NAMES.filter(joint => JSON.stringify(sequence.rotations[joint] ?? []) !== JSON.stringify(previous.rotations[joint] ?? []));
  if (changedRoot || changedJoints.length) {
    const held = new Set(previous.trackInterpolation?.tracks ?? []);
    if (changedRoot) held.add('root');
    for (const joint of changedJoints) held.add(joint);
    const tracks = (['root', ...EDITABLE_JOINT_NAMES] as const).filter(track => held.has(track) && (track === 'root' ? sequence.root.length : sequence.rotations[track]?.length));
    if (tracks.length) sequence.trackInterpolation = { schema: 'hold-last-key-1', tracks };
    else delete sequence.trackInterpolation;
  }
  validateSequence(sequence);
  if (previous.pointBaseTake) {
    const changedAssistance = JSON.stringify(sequence.footLocks ?? []) !== JSON.stringify(previous.footLocks ?? []) || JSON.stringify(sequence.steps) !== JSON.stringify(previous.steps) || (sequence.authorKeyPriority !== previous.authorKeyPriority && !!sequence.footLocks?.length);
    if (changedRoot || changedJoints.length || changedAssistance) {
      const derived = materializeKeyframeSequence({ ...sequence, pointBaseTake: undefined, pointEdits: [] }, true).take;
      // Contacts and steps can couple Root and limb channels across the scene.
      // Without those solvers, recompute only the explicitly changed tracks.
      if (changedAssistance || sequence.footLocks?.length || sequence.steps || previous.footLocks?.length || previous.steps) sequence.pointBaseTake = derived;
      else {
        const stored = new Map(previous.pointBaseTake.times.map((time, index) => [time, previous.pointBaseTake!.poses[index]]));
        sequence.pointBaseTake = { ...derived, poses: derived.times.map((time, index) => {
          const pose = copyPose(stored.get(time) ?? derived.poses[index]);
          if (changedRoot) pose.root = [...derived.poses[index].root];
          for (const joint of changedJoints) pose.joints[joint] = [...derived.poses[index].joints[joint]];
          return pose;
        }) };
      }
      if (new Set([...sequence.pointBaseTake.times, ...(sequence.pointEdits ?? []).map(edit => edit.time)]).size > MAX_TAKE_SAMPLES) throw new Error('数据点修改后的动作样本超出预览范围，请减少新增时刻。');
    }
  }
  return sequence;
}

export function upsertRotationKeyframe(sequence: KeyframeSequence, joint: JointName, frame: number, rotation: Quat): KeyframeSequence {
  validateSequence(sequence); assertEditable(joint); frameTime(frame, sequence.baseTake.durationSeconds);
  const q = normalizedRotation(rotation);
  const next = copySequence(sequence);
  next.rotations[joint] = upsert(next.rotations[joint] ?? [], { frame, rotation: q });
  return finishMutation(next, sequence);
}

export function upsertRootKeyframe(sequence: KeyframeSequence, frame: number, position: Vec3): KeyframeSequence {
  validateSequence(sequence); frameTime(frame, sequence.baseTake.durationSeconds);
  const next = copySequence(sequence);
  next.root = upsert(next.root, { frame, position: rootPosition(position) });
  return finishMutation(next, sequence);
}

/** Commit all editable rotations and the root as one immutable operation. */
export function setPoseKeyframe(sequence: KeyframeSequence, frame: number, pose: Pose): KeyframeSequence {
  validateSequence(sequence); frameTime(frame, sequence.baseTake.durationSeconds);
  if (!pose || typeof pose !== 'object' || !pose.joints) throw new Error('完整姿态缺少骨骼。');
  const position = rootPosition(pose.root);
  const rotations = EDITABLE_JOINT_NAMES.map(joint => [joint, normalizedRotation(pose.joints[joint])] as const);
  const next = copySequence(sequence);
  next.root = upsert(next.root, { frame, position });
  for (const [joint, rotation] of rotations) next.rotations[joint] = upsert(next.rotations[joint] ?? [], { frame, rotation });
  return finishMutation(next, sequence);
}

export function removeRotationKeyframe(sequence: KeyframeSequence, joint: JointName, frame: number, authority?: BakedTake): KeyframeSequence {
  validateSequence(sequence); assertEditable(joint); frameTime(frame, sequence.baseTake.durationSeconds);
  if (!sequence.rotations[joint]?.some(key => key.frame === frame)) return sequence;
  const previous = withPointAuthority(sequence, authority), next = copySequence(previous);
  const keys = next.rotations[joint]?.filter(key => key.frame !== frame) ?? [];
  if (keys.length) next.rotations[joint] = keys;
  else delete next.rotations[joint];
  return finishMutation(next, previous);
}

export function removeRootKeyframe(sequence: KeyframeSequence, frame: number, authority?: BakedTake): KeyframeSequence {
  validateSequence(sequence); frameTime(frame, sequence.baseTake.durationSeconds);
  if (!sequence.root.some(key => key.frame === frame)) return sequence;
  const previous = withPointAuthority(sequence, authority), next = copySequence(previous);
  next.root = next.root.filter(key => key.frame !== frame);
  return finishMutation(next, previous);
}

/** Remove every explicit root/rotation key at this frame, not the baked sample. */
export function removePoseKeyframe(sequence: KeyframeSequence, frame: number, authority?: BakedTake): KeyframeSequence {
  validateSequence(sequence); frameTime(frame, sequence.baseTake.durationSeconds);
  if (!sequence.root.some(key => key.frame === frame) && !Object.values(sequence.rotations).some(keys => keys!.some(key => key.frame === frame))) return sequence;
  const previous = withPointAuthority(sequence, authority), next = copySequence(previous);
  next.root = next.root.filter(key => key.frame !== frame);
  for (const joint of EDITABLE_JOINT_NAMES) {
    const keys = next.rotations[joint]?.filter(key => key.frame !== frame) ?? [];
    if (keys.length) next.rotations[joint] = keys;
    else delete next.rotations[joint];
  }
  return finishMutation(next, previous);
}

type TransferPayload = { track: KeyframeTransferTrack; sparse?: Quat | Vec3; point?: Quat | Vec3 };

function transferPayload(sequence: KeyframeSequence, track: KeyframeTransferTrack, time: number, frame: number | undefined): TransferPayload {
  const edit = sequence.pointEdits?.find(edit => edit.time === time);
  return track.kind === 'root'
    ? { track, sparse: frame === undefined ? undefined : sequence.root.find(key => key.frame === frame)?.position, point: edit?.root }
    : { track, sparse: frame === undefined ? undefined : sequence.rotations[track.joint]?.find(key => key.frame === frame)?.rotation, point: edit?.joints?.[track.joint] };
}

function sameTransferPayload(a: TransferPayload, b: TransferPayload): boolean {
  const same = (left: Quat | Vec3 | undefined, right: Quat | Vec3 | undefined) => left === undefined ? right === undefined : right !== undefined && left.every((value, axis) => value === right[axis]);
  return same(a.sparse, b.sparse) && same(a.point, b.point);
}

/** Clear the specified authored channel only; source/calculated samples are never records. */
function clearTransferChannel(sequence: KeyframeSequence, track: KeyframeTransferTrack, time: number, frame: number | undefined): void {
  if (frame !== undefined) {
    if (track.kind === 'root') sequence.root = sequence.root.filter(key => key.frame !== frame);
    else {
      const retained = sequence.rotations[track.joint]?.filter(key => key.frame !== frame) ?? [];
      if (retained.length) sequence.rotations[track.joint] = retained;
      else delete sequence.rotations[track.joint];
    }
  }
  const edit = sequence.pointEdits?.find(edit => edit.time === time);
  if (!edit) return;
  if (track.kind === 'root') delete edit.root;
  else if (edit.joints) {
    delete edit.joints[track.joint];
    if (!Object.keys(edit.joints).length) delete edit.joints;
  }
  if (edit.root === undefined && !Object.keys(edit.joints ?? {}).length) sequence.pointEdits = sequence.pointEdits!.filter(point => point !== edit);
}

/** Transfer authored layers together, preserving their respective interpolation semantics. */
export function transferKeyframes(sequence: KeyframeSequence, request: KeyframeTransferRequest, authority?: BakedTake): KeyframeTransferResult {
  validateSequence(sequence);
  if (!request || !['move', 'copy'].includes(request.operation) || !request.scope || !['all', 'joint', 'joints', 'root'].includes(request.scope.kind) || (request.collision !== undefined && !['reject', 'replace'].includes(request.collision))) throw new Error('关键帧移动或复制请求无效。');
  const { operation, scope, collision = 'reject' } = request;
  const exact = request.sourceTime !== undefined || request.targetTime !== undefined;
  const framed = request.sourceFrame !== undefined || request.targetFrame !== undefined;
  if (exact && framed) throw new Error('关键帧移动或复制只能指定一组帧索引或精确秒值。');
  const duration = sequence.baseTake.durationSeconds;
  const checkTime = (time: number) => {
    finite(time, '数据点时间');
    if (time < 0 || time > duration) throw new Error('数据点时间必须在动作范围内。');
    return time;
  };
  const sourceTime = exact ? checkTime(request.sourceTime!) : frameTime(request.sourceFrame!, duration);
  const targetTime = exact ? checkTime(request.targetTime!) : frameTime(request.targetFrame!, duration);
  const exactFrame = (time: number) => {
    const frame = frameAtTime(time, duration);
    return frameTime(frame, duration) === time ? frame : undefined;
  };
  const sourceFrame = exact ? exactFrame(sourceTime) : request.sourceFrame;
  const targetFrame = exact ? exactFrame(targetTime) : request.targetFrame;
  const availableJoints = exact ? JOINT_NAMES : EDITABLE_JOINT_NAMES;
  const assertTrack = (joint: JointName) => {
    if (exact) {
      if (!(JOINT_NAMES as readonly string[]).includes(joint)) throw new Error('作者数据点包含未知可编辑骨骼。');
    } else assertEditable(joint);
  };
  if (scope.kind === 'joint') assertTrack(scope.joint);
  let groupedJoints: Set<JointName> | undefined;
  if (scope.kind === 'joints') {
    if (!Array.isArray(scope.joints) || !scope.joints.length || scope.joints.length > availableJoints.length) throw new Error('关键帧关节分组必须是非空且不重复的可编辑骨骼数组。');
    groupedJoints = new Set(scope.joints);
    if (groupedJoints.size !== scope.joints.length) throw new Error('关键帧关节分组必须是非空且不重复的可编辑骨骼数组。');
    for (const joint of groupedJoints) assertTrack(joint);
  }
  const joints = scope.kind === 'root' ? [] : scope.kind === 'joint' ? [scope.joint] : groupedJoints ? availableJoints.filter(joint => groupedJoints.has(joint)) : availableJoints;
  const tracks: KeyframeTransferTrack[] = joints.map(joint => ({ kind: 'joint', joint }));
  if (scope.kind === 'all' || scope.kind === 'root') tracks.push({ kind: 'root' });
  const sources = tracks.map(track => transferPayload(sequence, track, sourceTime, sourceFrame)).filter(payload => payload.sparse !== undefined || payload.point !== undefined);
  const sourceKeyCount = sources.length;
  const common = { sequence, sourceTime, targetTime, sourceKeyCount, changedTracks: [] as KeyframeTransferTrack[] };
  if (sourceTime === targetTime) return { ...common, status: 'noop', reason: 'same-frame' };
  if (!sourceKeyCount) return { ...common, status: 'noop', reason: 'empty-source' };
  if (targetFrame === undefined && sources.some(payload => payload.sparse !== undefined)) throw new Error('旧稀疏 K 只能移动或复制到 30fps 帧时刻，请选择帧时刻；精确修改点可使用任意秒值。');

  const targets = sources.map(({ track }) => transferPayload(sequence, track, targetTime, targetFrame));
  const collisions = targets.filter(payload => payload.sparse !== undefined || payload.point !== undefined).map(({ track }) => track);
  if (collisions.length && collision === 'reject') return { ...common, status: 'conflict', collisions };

  // A confirmed copy of identical explicit payloads is not an animation change.
  if (operation === 'copy' && sources.every((payload, index) => sameTransferPayload(payload, targets[index]))) return { ...common, status: 'noop', reason: 'unchanged' };

  const count = getKeyframeCount(sequence), records = (payload: TransferPayload) => Number(payload.sparse !== undefined) + Number(payload.point !== undefined);
  if (count + (operation === 'copy' ? sources.reduce((sum, payload) => sum + records(payload), 0) : 0) - targets.reduce((sum, payload) => sum + records(payload), 0) > MAX_KEYFRAME_COUNT) throw new Error(`当前预览最多支持 ${MAX_KEYFRAME_COUNT} 条关键帧记录。`);
  // Freeze the old layers before removing their records, so an overlay cannot
  // become a permanent source value at its former time.
  const previous = withPointAuthority(sequence, authority), next = copySequence(previous);
  for (const payload of sources) {
    const { track, sparse, point } = payload;
    if (operation === 'move') clearTransferChannel(next, track, sourceTime, sourceFrame);
    clearTransferChannel(next, track, targetTime, targetFrame);
    if (sparse !== undefined) {
      if (track.kind === 'root') next.root = upsert(next.root, { frame: targetFrame!, position: [...sparse] as Vec3 });
      else next.rotations[track.joint] = upsert(next.rotations[track.joint] ?? [], { frame: targetFrame!, rotation: [...sparse] as Quat });
    }
    if (point !== undefined) {
      const edit = next.pointEdits?.find(edit => edit.time === targetTime) ?? { time: targetTime };
      if (!(next.pointEdits ??= []).includes(edit)) next.pointEdits.push(edit);
      if (track.kind === 'root') edit.root = [...point] as Vec3;
      else (edit.joints ??= {})[track.joint] = [...point] as Quat;
    }
  }
  next.pointEdits?.sort((a, b) => a.time - b.time);
  const sparseChanged = JSON.stringify(next.root) !== JSON.stringify(previous.root) || JOINT_NAMES.some(joint => JSON.stringify(next.rotations[joint] ?? []) !== JSON.stringify(previous.rotations[joint] ?? []));
  // Pure point operations keep legacy contact/author-priority semantics intact.
  if (sparseChanged) finishMutation(next, previous);
  else validateSequence(next);
  // Legacy sparse-only callers already bake before commit. Every new exact or
  // point-layer operation validates its final sample grid here as well.
  if (exact || sources.some(payload => payload.point !== undefined) || targets.some(payload => payload.point !== undefined)) bakeKeyframeSequence(next);
  const changedTracks = sources.filter((payload, index) => operation === 'move' || !sameTransferPayload(payload, targets[index])).map(({ track }) => track);
  return { status: 'changed', sequence: next, sourceTime, targetTime, sourceKeyCount, changedTracks, replaced: collisions };
}

export function getKeyframeFrames(sequence: KeyframeSequence): number[] {
  validateSequence(sequence);
  return [...new Set([...sequence.root.map(key => key.frame), ...Object.values(sequence.rotations).flatMap(keys => keys!.map(key => key.frame))])].sort((a, b) => a - b);
}

export function getKeyframeCount(sequence: KeyframeSequence): number {
  validateSequence(sequence);
  return sequence.root.length + Object.values(sequence.rotations).reduce((count, keys) => count + keys!.length, 0) + validateMotionPointEdits(sequence.pointEdits, sequence.baseTake.durationSeconds);
}

/** A short fade leaves room for assistance between, rather than freezing tracks. */
const AUTHOR_PROTECTION_RADIUS_FRAMES = 3;

function nearestKeyProtection(keys: readonly { frame: number }[], frame: number): number {
  if (!keys.length) return 0;
  let low = 0, high = keys.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (keys[middle].frame < frame) low = middle + 1;
    else high = middle;
  }
  const distance = Math.min(low < keys.length ? Math.abs(keys[low].frame - frame) : Infinity, low > 0 ? Math.abs(keys[low - 1].frame - frame) : Infinity);
  if (distance < 1e-7) return 1;
  if (distance >= AUTHOR_PROTECTION_RADIUS_FRAMES) return 0;
  const remaining = 1 - distance / AUTHOR_PROTECTION_RADIUS_FRAMES;
  return remaining * remaining * (3 - 2 * remaining);
}

function keyframeProtection(sequence: KeyframeSequence, frame: number): FootLockProtection {
  const protection: FootLockProtection = {};
  const heldTracks = new Set(sequence.trackInterpolation?.tracks ?? []);
  const weightAt = (keys: readonly { frame: number }[], track: 'root' | JointName) =>
    heldTracks.has(track) && keys.length && frame >= keys.at(-1)!.frame ? 1 : nearestKeyProtection(keys, frame);
  const root = weightAt(sequence.root, 'root');
  if (root > 0) protection.root = root;
  for (const [joint, keys] of Object.entries(sequence.rotations)) {
    const weight = weightAt(keys!, joint as JointName);
    if (weight > 0) (protection.joints ??= {})[joint as JointName] = weight;
  }
  return protection;
}

/** Author K and versioned final holds override contacts; neighboring transitions retain their fade. */
export function getKeyframeProtection(sequence: KeyframeSequence, frame: number): FootLockProtection {
  validateSequence(sequence);
  finite(frame, '作者关键帧保护求值帧');
  if (frame < 0 || frame > lastFrame(sequence.baseTake.durationSeconds)) throw new Error('作者关键帧保护求值帧超出范围。');
  return keyframeProtection(sequence, frame);
}

/** Shared shortest-path interpolation for frame-based and exact-time author tracks. */
export function interpolateKeyframeRotation(a: Quat, b: Quat, amount: number): Quat {
  const qa = normalizedRotation(a);
  let qb = normalizedRotation(b);
  let dot = qa.reduce((sum, value, index) => sum + value * qb[index], 0);
  if (dot < 0) { qb = qb.map(value => -value) as Quat; dot = -dot; }
  dot = clamp(dot, -1, 1);
  if (dot > 0.9995) return normalizedRotation(qa.map((value, index) => value + amount * (qb[index] - value)) as Quat);
  const angle = Math.acos(dot);
  const denominator = Math.sin(angle);
  const left = Math.sin((1 - amount) * angle) / denominator;
  const right = Math.sin(amount * angle) / denominator;
  return normalizedRotation(qa.map((value, index) => left * value + right * qb[index]) as Quat);
}

function trackWithEndpoints<T extends { frame: number }>(keys: T[], start: T, end: T, holdLast = false): T[] {
  return [...(keys[0].frame === 0 ? [] : [start]), ...keys, ...(holdLast || keys.at(-1)!.frame === end.frame ? [] : [end])];
}

function evaluateTrack<T extends { frame: number }>(keys: T[], time: number, duration: number, interpolate: (a: T, b: T, amount: number) => Quat | Vec3): Quat | Vec3 {
  let low = 0, high = keys.length - 1;
  while (high - low > 1) {
    const middle = Math.floor((low + high) / 2);
    if (frameTime(keys[middle].frame, duration) <= time) low = middle;
    else high = middle;
  }
  const start = frameTime(keys[low].frame, duration);
  const end = frameTime(keys[high].frame, duration);
  const amount = end === start ? 0 : clamp((time - start) / (end - start), 0, 1);
  return interpolate(keys[low], keys[high], amount);
}

/** Materialize one authority for both renderer playback and JSON export. */
export function bakeKeyframeSequence(sequence: KeyframeSequence): BakedTake {
  if (sequence.pointBaseTake) {
    validateSequence(sequence);
    const source = sequence.pointBaseTake;
    return applyMotionPointEdits({ ...source, id: newId('take'), times: [...source.times], poses: source.poses.map(copyPose) }, sequence.pointEdits, sequence.pointInterpolation);
  }
  return materializeKeyframeSequence(sequence, sequence.pointEdits === undefined || sequence.authorKeyPriority !== undefined).take;
}

/** Same planner and final FK measurements as the authoritative bake. */
export function analyzeStepAssistance(sequence: KeyframeSequence): StepAssistanceReport {
  return materializeKeyframeSequence(sequence, sequence.pointEdits === undefined || sequence.authorKeyPriority !== undefined).report;
}

/**
 * Strict verification of saved pre-priority authority only. Opening old scenes
 * keeps their saved take; new edits must always use bakeKeyframeSequence.
 */
export function bakeLegacyKeyframeSequence(sequence: KeyframeSequence): BakedTake {
  return materializeKeyframeSequence(sequence, false).take;
}

function materializeKeyframeSequence(sequence: KeyframeSequence, respectAuthorKeys: boolean): { take: BakedTake; report: StepAssistanceReport } {
  validateSequence(sequence);
  if (!respectAuthorKeys && sequence.authorKeyPriority !== undefined) throw new Error('已声明作者关键帧优先的作品不能使用旧脚锁求值。');
  if (!respectAuthorKeys && sequence.steps) throw new Error('自动迈步不能使用旧脚锁求值。');
  const base = sequence.baseTake;
  const frames = getKeyframeFrames(sequence);
  const locks = sequence.footLocks ?? [];
  if (!frames.length && !locks.length && !sequence.steps) {
    const authority = sequence.pointBaseTake ?? base;
    return { take: applyMotionPointEdits({ ...authority, id: newId('take'), times: [...authority.times], poses: authority.poses.map(copyPose) }, sequence.pointEdits, sequence.pointInterpolation), report: buildStepPlan(sequence, () => base.poses[0]).report };
  }
  const duration = base.durationSeconds, finalFrame = lastFrame(duration);
  // Solved samples, not thousands of sparse K records. Preserve exact source
  // knots and the short final interval alongside the 30 Hz contact sampling.
  const contactTimes = locks.length ? Array.from({ length: finalFrame + 1 }, (_, frame) => frameTime(frame, duration)) : [];
  const authorTimes = [...new Set([...base.times, ...frames.map(frame => frameTime(frame, duration)), ...contactTimes])].sort((a, b) => a - b);
  const initial = base.poses[0], final = base.poses.at(-1)!;
  const heldTracks = new Set(sequence.trackInterpolation?.tracks ?? []);
  const rotations = Object.entries(sequence.rotations).filter(([, keys]) => keys!.length).map(([joint, keys]) => {
    const name = joint as JointName;
    return [name, trackWithEndpoints(keys!, { frame: 0, rotation: initial.joints[name] }, { frame: finalFrame, rotation: final.joints[name] }, heldTracks.has(name))] as const;
  });
  const roots = sequence.root.length ? trackWithEndpoints(sequence.root, { frame: 0, position: initial.root }, { frame: finalFrame, position: final.root }, heldTracks.has('root')) : [];
  const sourceSamples = new Map(base.times.map((time, index) => [time, base.poses[index]]));
  const rawAuthoredAtTime = (time: number): Pose => {
    // Keep base sample bits exactly for every untouched channel and support knot.
    const pose = copyPose(sourceSamples.get(time) ?? sampleTake(base, time));
    for (const [joint, keys] of rotations) pose.joints[joint] = evaluateTrack(keys, time, duration, (a, b, amount) => {
      if (amount === 0) return [...a.rotation] as Quat;
      if (amount === 1) return [...b.rotation] as Quat;
      return interpolateKeyframeRotation(a.rotation, b.rotation, amount);
    }) as Quat;
    if (roots.length) pose.root = evaluateTrack(roots, time, duration, (a, b, amount) => {
      if (amount === 0) return [...a.position] as Vec3;
      if (amount === 1) return [...b.position] as Vec3;
      return a.position.map((value, axis) => value + amount * (b.position[axis] - value)) as Vec3;
    }) as Vec3;
    return pose;
  };
  // Adding assistance knots must not reevaluate untouched source channels with
  // a different SLERP/nlerp path. Sample the original author authority at new
  // knots, retaining original pose bits at all existing source/K/contact knots.
  const authorTake: BakedTake | null = sequence.steps ? { ...base, times: authorTimes, poses: authorTimes.map(rawAuthoredAtTime) } : null;
  const authoredAtTime = authorTake ? (time: number) => sampleTake(authorTake, time) : rawAuthoredAtTime;
  const plan = buildStepPlan(sequence, (frame, exactTime) => authoredAtTime(exactTime ?? (frame === finalFrame ? duration : frame / FPS)), authorTimes);
  const stepTimes = plan.segments.filter(segment => segment.status === 'supported').flatMap(segment => Array.from({ length: segment.endFrame - segment.startFrame + 1 }, (_, index) => frameTime(segment.startFrame + index, duration)));
  const times = [...new Set([...authorTimes, ...stepTimes])].sort((a, b) => a - b);
  if (times.length > MAX_TAKE_SAMPLES) throw new Error('手 K 后的动作样本超出预览范围，请减少新增帧时刻。');
  const poses = times.map(time => {
    const authored = authoredAtTime(time), frame = time === duration ? finalFrame : time * FPS;
    const protection = respectAuthorKeys ? keyframeProtection(sequence, frame) : undefined;
    let pose = applyStepAssistance(authored, plan, frame, protection);
    if (locks.length) pose = applyFootLocks(pose, locks, frame, duration, protection).pose;
    accumulateStepResiduals(plan.report, plan, authored, pose, frame);
    return pose;
  });
  const authority = sequence.pointBaseTake ? { ...sequence.pointBaseTake, id: newId('take'), times: [...sequence.pointBaseTake.times], poses: sequence.pointBaseTake.poses.map(copyPose) } : { ...base, id: newId('take'), times, poses };
  return { take: applyMotionPointEdits(authority, sequence.pointEdits, sequence.pointInterpolation), report: plan.report };
}

/** Neutral FK starting point; timing, selected music and arrangement binding stay. */
export function createNeutralTake(reference: BakedTake): BakedTake {
  validateTake(reference);
  return {
    ...reference, id: newId('take'), times: [...reference.times],
    poses: reference.times.map(() => ({ root: [0, 1.05, 0], joints: Object.fromEntries(JOINT_NAMES.map(joint => [joint, [0, 0, 0, 1]])) as Pose['joints'] })),
  };
}
