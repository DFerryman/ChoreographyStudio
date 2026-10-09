import { JOINT_NAMES, type BakedTake, type JointName, type Pose, type Quat, type Vec3 } from './motion-types';
import { bakeKeyframeSequence, getKeyframeCount, MAX_TAKE_SAMPLES, ROOT_TRANSLATION_LIMITS, type KeyframeSequence } from './keyframes';
import { sampleTake } from './index';

/** An exact-time channel overlay; omitted channels retain their original authority. */
export interface MotionPointChannels {
  root?: Vec3;
  joints?: Partial<Record<JointName, Quat>>;
}
export interface MotionPointEdit extends MotionPointChannels { time: number }
export type MotionPointTrack = 'root' | JointName;

const joints = new Set<string>(JOINT_NAMES);
const CHANGE_EPSILON = 1e-9;
let fallbackId = 0;
const newId = (prefix = 'keys') => `${prefix}_${(typeof crypto !== 'undefined' ? crypto.randomUUID?.() : undefined) ?? `${Date.now()}_point_${++fallbackId}`}`;

function pointTime(time: number, duration: number): void {
  if (typeof time !== 'number' || !Number.isFinite(time) || time < 0 || time > duration) throw new Error('数据点时间必须是动作范围内的精确有限时刻。');
}

function vector(value: Vec3, edited: boolean): Vec3 {
  if (!Array.isArray(value) || value.length !== 3 || value.some(component => typeof component !== 'number' || !Number.isFinite(component))) throw new Error('Root 数据点必须包含三个有限坐标。');
  const bounds = [ROOT_TRANSLATION_LIMITS.x, ROOT_TRANSLATION_LIMITS.y, ROOT_TRANSLATION_LIMITS.z];
  if (edited && value.some((component, axis) => component < bounds[axis][0] || component > bounds[axis][1])) throw new Error('Root 位移范围为 X/Z −5 至 5 米，Y 0 至 3 米。');
  return [...value];
}

function quaternion(value: Quat, normalize: boolean): Quat {
  if (!Array.isArray(value) || value.length !== 4 || value.some(component => typeof component !== 'number' || !Number.isFinite(component))) throw new Error('旋转数据点必须包含四个有限分量。');
  const norm = Math.hypot(...value);
  if (!Number.isFinite(norm) || norm <= Number.EPSILON) throw new Error('旋转数据点不能使用零四元数。');
  if (!normalize && Math.abs(norm - 1) > 1e-6) throw new Error('旋转数据点必须使用单位四元数。');
  return normalize ? value.map(component => component / norm) as Quat : [...value];
}

/** q and -q represent the same rotation and must not create an operation. */
function sameRotation(a: Quat, b: Quat): boolean {
  return Math.min(Math.max(...a.map((value, axis) => Math.abs(value - b[axis]))), Math.max(...a.map((value, axis) => Math.abs(value + b[axis])))) <= CHANGE_EPSILON;
}
const sameRoot = (a: Vec3, b: Vec3) => a.every((value, axis) => Math.abs(value - b[axis]) <= CHANGE_EPSILON);

export function cloneMotionPointEdits(edits: readonly MotionPointEdit[]): MotionPointEdit[] {
  return edits.map(edit => ({
    time: edit.time,
    ...(edit.root !== undefined ? { root: [...edit.root] as Vec3 } : {}),
    ...(edit.joints !== undefined ? { joints: Object.fromEntries(Object.entries(edit.joints).map(([joint, rotation]) => [joint, [...rotation!] as Quat])) } : {}),
  }));
}

/** Shared by sequence validation and backup decoding; returns channel count. */
export function validateMotionPointEdits(edits: MotionPointEdit[] | undefined, duration: number): number {
  if (edits === undefined) return 0;
  if (!Array.isArray(edits)) throw new Error('数据点修改必须是数组。');
  let count = 0;
  for (const [index, edit] of edits.entries()) {
    if (!edit || typeof edit !== 'object' || Array.isArray(edit) || Object.keys(edit).some(key => !['time', 'root', 'joints'].includes(key))) throw new Error('数据点修改格式无效。');
    pointTime(edit.time, duration);
    if (index && edit.time <= edits[index - 1].time) throw new Error('数据点修改时间必须严格递增且不能重复。');
    let channels = 0;
    if (edit.root !== undefined) { vector(edit.root, true); channels += 1; }
    if (edit.joints !== undefined) {
      if (!edit.joints || typeof edit.joints !== 'object' || Array.isArray(edit.joints)) throw new Error('旋转数据点轨道无效。');
      for (const [joint, rotation] of Object.entries(edit.joints)) {
        if (!joints.has(joint)) throw new Error('旋转数据点包含未知关节。');
        quaternion(rotation!, false); channels += 1;
      }
    }
    if (!channels) throw new Error('数据点修改必须包含至少一个通道。');
    count += channels;
  }
  return count;
}

/** Apply after all sparse-key and automatic assistance evaluation. */
export function applyMotionPointEdits(take: BakedTake, edits: readonly MotionPointEdit[] | undefined): BakedTake {
  if (!edits?.length) return take;
  const times = [...new Set([...take.times, ...edits.map(edit => edit.time)])].sort((a, b) => a - b);
  if (times.length > MAX_TAKE_SAMPLES) throw new Error('数据点修改后的动作样本超出预览范围，请减少新增时刻。');
  const original = new Map(take.times.map((time, index) => [time, take.poses[index]]));
  const overlays = new Map(edits.map(edit => [edit.time, edit]));
  const poses = times.map(time => {
    const source = original.get(time) ?? sampleTake(take, time);
    const pose: Pose = { root: [...source.root], joints: Object.fromEntries(JOINT_NAMES.map(joint => [joint, [...source.joints[joint]]])) as Pose['joints'] };
    const edit = overlays.get(time);
    if (edit?.root) pose.root = [...edit.root];
    for (const [joint, rotation] of Object.entries(edit?.joints ?? {})) pose.joints[joint as JointName] = [...rotation!] as Quat;
    return pose;
  });
  return { ...take, times, poses };
}

export function freezePointAuthority(sequence: KeyframeSequence, authority: BakedTake): BakedTake {
  const copy = (pose: Pose): Pose => ({ root: [...pose.root], joints: Object.fromEntries(JOINT_NAMES.map(joint => [joint, [...pose.joints[joint]]])) as Pose['joints'] });
  if (!sequence.pointEdits?.length) return { ...authority, times: [...authority.times], poses: authority.poses.map(copy) };
  // Older point-only files did not store their pre-edit authority. Recover its
  // grid and edited channels from the evaluator, retaining saved bits for every
  // channel that those overlays never changed. Previously edited source bits
  // cannot be recovered more precisely than the old schema actually stored.
  const original = bakeKeyframeSequence({ ...sequence, pointEdits: [] });
  const stored = new Map(authority.times.map((time, index) => [time, authority.poses[index]]));
  const oldEdits = new Map(sequence.pointEdits.map(edit => [edit.time, edit]));
  return { ...authority, id: newId('take'), times: [...original.times], poses: original.times.map((time, index) => {
    const pose = copy(stored.get(time) ?? sampleTake(authority, time)), edit = oldEdits.get(time);
    if (edit?.root) pose.root = [...original.poses[index].root];
    for (const joint of Object.keys(edit?.joints ?? {}) as JointName[]) pose.joints[joint] = [...original.poses[index].joints[joint]];
    return pose;
  }) };
}

function finish(sequence: KeyframeSequence, edits: MotionPointEdit[], authority?: BakedTake): KeyframeSequence {
  // Preserve legacy sparse/contact semantics. Only the final point overlay changes.
  const next: KeyframeSequence = { ...sequence, id: newId(), pointEdits: edits,
    ...(!sequence.pointBaseTake && authority ? { pointBaseTake: freezePointAuthority(sequence, authority) } : {}),
  };
  getKeyframeCount(next);
  bakeKeyframeSequence(next); // Check the authoritative sample cap before committing.
  return next;
}

/** Explicitly add/update supplied channels, including any of the 25 stored joints. */
export function upsertMotionPoint(sequence: KeyframeSequence, time: number, channels: MotionPointChannels, authority?: BakedTake): KeyframeSequence {
  getKeyframeCount(sequence); pointTime(time, sequence.baseTake.durationSeconds);
  if (!channels || typeof channels !== 'object' || Array.isArray(channels) || Object.keys(channels).some(key => !['root', 'joints'].includes(key))) throw new Error('数据点通道格式无效。');
  const root = channels.root === undefined ? undefined : vector(channels.root, true);
  let rotations: Partial<Record<JointName, Quat>> | undefined;
  if (channels.joints !== undefined) {
    if (!channels.joints || typeof channels.joints !== 'object' || Array.isArray(channels.joints)) throw new Error('旋转数据点轨道无效。');
    rotations = {};
    for (const [joint, rotation] of Object.entries(channels.joints)) {
      if (!joints.has(joint)) throw new Error('旋转数据点包含未知关节。');
      rotations[joint as JointName] = quaternion(rotation!, true);
    }
  }
  if (root === undefined && !Object.keys(rotations ?? {}).length) return sequence;
  const previous = sequence.pointEdits?.find(edit => edit.time === time);
  if ((root === undefined || (previous?.root && sameRoot(root, previous.root))) && Object.entries(rotations ?? {}).every(([joint, rotation]) => previous?.joints?.[joint as JointName] && sameRotation(rotation!, previous.joints[joint as JointName]!))) return sequence;
  const edits = cloneMotionPointEdits(sequence.pointEdits ?? []);
  const edit = edits.find(edit => edit.time === time) ?? { time };
  if (!edits.includes(edit)) edits.push(edit);
  if (root !== undefined) edit.root = root;
  if (Object.keys(rotations ?? {}).length) edit.joints = { ...edit.joints, ...rotations };
  edits.sort((a, b) => a.time - b.time);
  return finish(sequence, edits, authority);
}

/** One gesture commits exactly its changed channels, including IK-dependent changes. */
export function upsertMotionPointChanges(sequence: KeyframeSequence, time: number, before: Pose, after: Pose, authority?: BakedTake): KeyframeSequence {
  getKeyframeCount(sequence); pointTime(time, sequence.baseTake.durationSeconds);
  if (!before?.joints || !after?.joints) throw new Error('数据点操作缺少前后姿态。');
  const priorRoot = vector(before.root, false), nextRoot = vector(after.root, false);
  const channels: MotionPointChannels = {};
  if (!sameRoot(priorRoot, nextRoot)) channels.root = nextRoot;
  for (const joint of JOINT_NAMES) {
    const prior = quaternion(before.joints[joint], false), next = quaternion(after.joints[joint], false);
    if (!sameRotation(prior, next)) (channels.joints ??= {})[joint] = next;
  }
  return upsertMotionPoint(sequence, time, channels, authority);
}

/** Remove only a local override; original evaluated samples and sparse keys remain. */
export function removeMotionPointEdit(sequence: KeyframeSequence, time: number, track: MotionPointTrack, authority?: BakedTake): KeyframeSequence {
  getKeyframeCount(sequence); pointTime(time, sequence.baseTake.durationSeconds);
  if (track !== 'root' && !joints.has(track)) throw new Error('数据点轨道无效。');
  const previous = sequence.pointEdits?.find(edit => edit.time === time);
  if (!previous || (track === 'root' ? previous.root === undefined : previous.joints?.[track] === undefined)) return sequence;
  const edits = cloneMotionPointEdits(sequence.pointEdits ?? []);
  const edit = edits.find(edit => edit.time === time)!;
  if (track === 'root') delete edit.root;
  else {
    delete edit.joints![track];
    if (!Object.keys(edit.joints!).length) delete edit.joints;
  }
  return finish(sequence, edits.filter(edit => edit.root !== undefined || Object.keys(edit.joints ?? {}).length), authority);
}

export function getMotionPointEditCount(sequence: KeyframeSequence): number {
  getKeyframeCount(sequence);
  return validateMotionPointEdits(sequence.pointEdits, sequence.baseTake.durationSeconds);
}

/** Includes source, sparse-key, contact, assistance and exact overlay timestamps. */
export function getMotionPointTimes(sequence: KeyframeSequence, authority?: BakedTake): number[] {
  if (!authority) return [...bakeKeyframeSequence(sequence).times];
  return [...new Set([...authority.times, ...(sequence.pointEdits ?? []).map(edit => edit.time)])].sort((a, b) => a - b);
}
