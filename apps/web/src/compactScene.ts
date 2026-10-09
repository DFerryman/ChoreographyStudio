import { JOINT_NAMES, type BakedTake, type Pose, type Quat, type Vec3 } from '../../../packages/core/src/motion-types';
import { validateProjectCameraTracks } from './sceneCameraTrack';

/** Lossless wire storage only. Runtime scenes keep their ordinary full snapshots. */
export const COMPACT_SCENE_LIMITS = { takes: 36, samplesPerTake: 6001, totalSamples: 150_000, history: 12 } as const;
type TakeMetadata = Omit<BakedTake, 'times' | 'poses'>;
type PoseChange = { index: number; root?: Vec3; joints?: Partial<Pose['joints']> };
type PackedTake = { kind: 'full'; take: BakedTake } | { kind: 'delta'; reference: number; metadata: TakeMetadata; times?: number[]; changes: PoseChange[] };
export type CompactScene = { schema: 'compact-scene-1'; scene: unknown; takes: PackedTake[] };
type ObjectValue = Record<string, unknown>;
const fail = (): never => { throw new Error('场景压缩数据无效或超出资源范围。'); };
const takeFields = ['id', 'schemaVersion', 'planId', 'countMapId', 'durationSeconds', 'times', 'poses', 'provenance'];
const metadataFields = takeFields.filter(key => key !== 'times' && key !== 'poses');
function object(value: unknown, allowed?: readonly string[], required: readonly string[] = allowed ?? []): ObjectValue {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail();
  const result = value as ObjectValue;
  if (Object.keys(result).some(key => ['__proto__', 'prototype', 'constructor'].includes(key) || allowed && !allowed.includes(key)) || required.some(key => !Object.hasOwn(result, key))) fail();
  return result;
}
function array(value: unknown, maximum: number): unknown[] { if (!Array.isArray(value) || value.length > maximum) return fail(); return value; }
function integer(value: unknown, maximum: number): number { if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > maximum) return fail(); return value; }
function vector(value: unknown, length: 3): Vec3;
function vector(value: unknown, length: 4): Quat;
function vector(value: unknown, length: number): Vec3 | Quat {
  const values = array(value, length); if (values.length !== length || values.some(component => typeof component !== 'number' || !Number.isFinite(component))) fail();
  return [...values] as Vec3 | Quat;
}
function metadata(value: unknown): TakeMetadata {
  const data = object(value, metadataFields);
  for (const key of ['id', 'planId', 'countMapId']) if (typeof data[key] !== 'string' || !(data[key] as string).length || (data[key] as string).length > 200) fail();
  if (data.schemaVersion !== 'preview-1' || data.provenance !== 'synthetic-demo' || typeof data.durationSeconds !== 'number' || !Number.isFinite(data.durationSeconds) || data.durationSeconds <= 0 || data.durationSeconds > 60 + 1e-8) return fail();
  return { id: data.id as string, schemaVersion: 'preview-1', planId: data.planId as string, countMapId: data.countMapId as string, durationSeconds: data.durationSeconds, provenance: 'synthetic-demo' };
}
function sampleTimes(value: unknown, duration: number): number[] {
  const values = array(value, COMPACT_SCENE_LIMITS.samplesPerTake);
  if (values.length < 2 || values[0] !== 0 || values.at(-1) !== duration || values.some((time, index) => typeof time !== 'number' || !Number.isFinite(time) || time < 0 || time > duration || index > 0 && time <= (values[index - 1] as number))) fail();
  return [...values] as number[];
}
function pose(value: unknown): Pose {
  const data = object(value, ['root', 'joints']), joints = object(data.joints, JOINT_NAMES);
  return { root: vector(data.root, 3), joints: Object.fromEntries(JOINT_NAMES.map(joint => [joint, vector(joints[joint], 4)])) as Pose['joints'] };
}
function copyPose(value: Pose): Pose { return { root: [...value.root], joints: Object.fromEntries(JOINT_NAMES.map(joint => [joint, [...value.joints[joint]]])) as Pose['joints'] }; }
const equalVector = (a: readonly number[], b: readonly number[]) => a.length === b.length && a.every((value, index) => Object.is(value, b[index]));
const equalTimes = (a: readonly number[], b: readonly number[]) => equalVector(a, b);
function commonTimes(a: readonly number[], b: readonly number[]): number {
  let left = 0, right = 0, common = 0;
  while (left < a.length && right < b.length) {
    if (a[left] === b[right]) { common++; left++; right++; }
    else if (a[left] < b[right]) left++;
    else right++;
  }
  return common;
}
function equalTake(a: BakedTake, b: BakedTake): boolean {
  return metadataFields.every(key => Object.is(a[key as keyof BakedTake], b[key as keyof BakedTake])) && equalTimes(a.times, b.times) && a.poses.length === b.poses.length && a.poses.every((value, index) => equalVector(value.root, b.poses[index].root) && JOINT_NAMES.every(joint => equalVector(value.joints[joint], b.poses[index].joints[joint])));
}
function takeMetadata(take: BakedTake): TakeMetadata {
  return { id: take.id, schemaVersion: take.schemaVersion, planId: take.planId, countMapId: take.countMapId, durationSeconds: take.durationSeconds, provenance: take.provenance };
}
function sceneHistory(value: unknown) {
  const scene = object(value), project = object(scene.project), history = array(project.history, COMPACT_SCENE_LIMITS.history);
  if (!history.length) fail();
  try { validateProjectCameraTracks(project); } catch { fail(); }
  return { scene, project, history: history.map(value => object(value)) };
}

/** Sharing and deltas preserve exact numbers; they never resample or rebake motion. */
export function packScene(value: unknown): CompactScene {
  const source = sceneHistory(value), takes: PackedTake[] = [], originals: BakedTake[] = [];
  const identities = new WeakMap<object, number>();
  const frozenReferences = new Set<number>();
  let referencedSamples = 0, tableSamples = 0;
  function reference(value: unknown, chargeEveryReference = true): { $take: number } {
    const data = object(value, takeFields) as unknown as BakedTake;
    // Inputs normally came from strict scene validation. Keep the wire utility
    // independently bounded before considering a large take for a delta.
    const meta = metadata(takeMetadata(data)), times = sampleTimes(data.times, meta.durationSeconds);
    if (array(data.poses, COMPACT_SCENE_LIMITS.samplesPerTake).length !== times.length) fail();
    if (chargeEveryReference) referencedSamples += times.length;
    if (referencedSamples > COMPACT_SCENE_LIMITS.totalSamples) fail();
    const known = identities.get(data);
    if (known !== undefined) return { $take: known };
    const duplicate = originals.findIndex(previous => previous.id === data.id && equalTake(previous, data));
    if (duplicate >= 0) { identities.set(data, duplicate); return { $take: duplicate }; }
    if (takes.length >= COMPACT_SCENE_LIMITS.takes) fail();
    // Prefer the immediately preceding authority on this exact grid; imported
    // source grids also share exact sample timestamps with derived authorities.
    let parent = -1;
    for (let index = originals.length - 1; index >= 0; index--) {
      const previous = originals[index];
      if (previous.durationSeconds === data.durationSeconds && previous.countMapId === data.countMapId && equalTimes(previous.times, data.times)) { parent = index; break; }
    }
    if (parent < 0) {
      let shared = -1;
      for (let index = originals.length - 1; index >= 0; index--) {
        if (originals[index].durationSeconds !== data.durationSeconds || originals[index].countMapId !== data.countMapId) continue;
        const count = commonTimes(originals[index].times, times);
        if (count > shared) { shared = count; parent = index; }
      }
    }
    let packed: PackedTake = { kind: 'full', take: data };
    if (parent >= 0) {
      const prior = originals[parent], previousByTime = new Map(prior.times.map((time, index) => [time, prior.poses[index]]));
      const changes: PoseChange[] = [];
      for (const [index, current] of data.poses.entries()) {
        const previous = previousByTime.get(times[index]), change: PoseChange = { index };
        if (!previous || !equalVector(previous.root, current.root)) change.root = [...current.root];
        for (const joint of JOINT_NAMES) if (!previous || !equalVector(previous.joints[joint], current.joints[joint])) (change.joints ??= {})[joint] = [...current.joints[joint]];
        if (change.root || change.joints) changes.push(change);
      }
      const delta: PackedTake = { kind: 'delta', reference: parent, metadata: meta, ...(equalTimes(prior.times, times) ? {} : { times }), changes };
      // Unrelated takes can share a binding but little motion. Avoid an inflated
      // delta while retaining compact point edits and exact nonuniform grids.
      if (JSON.stringify(delta).length < JSON.stringify(packed).length) packed = delta;
    }
    tableSamples += times.length; if (tableSamples > COMPACT_SCENE_LIMITS.totalSamples) fail();
    const index = takes.length; takes.push(packed); originals.push(data); identities.set(data, index); return { $take: index };
  }
  const history = source.history.map(snapshot => {
    const result: ObjectValue = { ...snapshot, take: snapshot.take === null ? null : reference(snapshot.take) };
    if (snapshot.manual !== undefined) {
      const manual = object(snapshot.manual), next: ObjectValue = { ...manual, baseTake: reference(manual.baseTake) };
      if (manual.pointBaseTake !== undefined) {
        const frozen = reference(manual.pointBaseTake, false); frozenReferences.add(frozen.$take); next.pointBaseTake = frozen;
      }
      result.manual = next;
    }
    return result;
  });
  // Existing take/base history budgets keep their original per-reference
  // accounting. A shared frozen authority is charged once, since it is stored
  // and expanded once rather than copied for every point-edit operation.
  for (const index of frozenReferences) referencedSamples += originals[index].times.length;
  if (referencedSamples > COMPACT_SCENE_LIMITS.totalSamples) fail();
  return { schema: 'compact-scene-1', scene: { ...source.scene, project: { ...source.project, history } }, takes };
}

/** Decode a bounded, acyclic table, then let the ordinary scene validator run. */
export function unpackScene(value: unknown): unknown {
  const packed = object(value, ['schema', 'scene', 'takes']); if (packed.schema !== 'compact-scene-1') fail();
  const source = sceneHistory(packed.scene), entries = array(packed.takes, COMPACT_SCENE_LIMITS.takes), lengths: number[] = [];
  let tableSamples = 0;
  // Preflight every table allocation and every historical reference before
  // expanding deltas. Backward-only references rule out cycles and fanout bombs.
  for (const [index, entry] of entries.entries()) {
    const data = object(entry);
    let length = 0;
    if (data.kind === 'full') {
      object(data, ['kind', 'take']); const take = object(data.take, takeFields), meta = metadata(Object.fromEntries(metadataFields.map(key => [key, take[key]])));
      length = sampleTimes(take.times, meta.durationSeconds).length;
      if (array(take.poses, COMPACT_SCENE_LIMITS.samplesPerTake).length !== length) fail();
    } else if (data.kind === 'delta') {
      object(data, ['kind', 'reference', 'metadata', 'times', 'changes'], ['kind', 'reference', 'metadata', 'changes']);
      const prior = integer(data.reference, index - 1), meta = metadata(data.metadata);
      length = data.times === undefined ? lengths[prior] : sampleTimes(data.times, meta.durationSeconds).length;
      array(data.changes, COMPACT_SCENE_LIMITS.samplesPerTake);
    } else fail();
    if (!length) fail(); lengths.push(length); tableSamples += length; if (tableSamples > COMPACT_SCENE_LIMITS.totalSamples) fail();
  }
  let referencedSamples = 0;
  function resolveIndex(value: unknown): number {
    const data = object(value, ['$take']); const index = integer(data.$take, entries.length - 1);
    referencedSamples += lengths[index]; if (!lengths[index] || referencedSamples > COMPACT_SCENE_LIMITS.totalSamples) fail(); return index;
  }
  const frozenReferences = new Set<number>();
  const snapshotReferences = source.history.map(snapshot => {
    const manual = snapshot.manual === undefined ? null : object(snapshot.manual);
    let frozen: number | null = null;
    if (manual?.pointBaseTake !== undefined) {
      const reference = object(manual.pointBaseTake, ['$take']); frozen = integer(reference.$take, entries.length - 1);
      if (!lengths[frozen]) fail(); frozenReferences.add(frozen);
    }
    return { take: snapshot.take === null ? null : resolveIndex(snapshot.take), base: manual === null ? null : resolveIndex(manual.baseTake), frozen };
  });
  for (const index of frozenReferences) referencedSamples += lengths[index];
  if (referencedSamples > COMPACT_SCENE_LIMITS.totalSamples) fail();
  const takes: BakedTake[] = [];
  for (const entry of entries) {
    const data = entry as ObjectValue;
    if (data.kind === 'full') {
      const raw = data.take as ObjectValue, meta = metadata(Object.fromEntries(metadataFields.map(key => [key, raw[key]])));
      takes.push({ ...meta, times: sampleTimes(raw.times, meta.durationSeconds), poses: (raw.poses as unknown[]).map(pose) });
      continue;
    }
    const prior = takes[data.reference as number], meta = metadata(data.metadata), times = sampleTimes(data.times === undefined ? prior.times : data.times, meta.durationSeconds);
    const byTime = new Map(prior.times.map((time, index) => [time, prior.poses[index]])), changes = data.changes as unknown[], changed = new Map<number, PoseChange>();
    let previousIndex = -1;
    for (const value of changes) {
      const change = object(value, ['index', 'root', 'joints'], ['index']), index = integer(change.index, times.length - 1);
      if (index <= previousIndex || change.root === undefined && change.joints === undefined) fail(); previousIndex = index;
      const patch: PoseChange = { index, ...(change.root === undefined ? {} : { root: vector(change.root, 3) }) };
      if (change.joints !== undefined) {
        const joints = object(change.joints, JOINT_NAMES, []); if (!Object.keys(joints).length) fail();
        patch.joints = Object.fromEntries(Object.entries(joints).map(([joint, rotation]) => [joint, vector(rotation, 4)]));
      }
      changed.set(index, patch);
    }
    const poses = times.map((time, index): Pose => {
      const previous = byTime.get(time), change = changed.get(index);
      if (!previous && (!change?.root || !change.joints || JOINT_NAMES.some(joint => !change.joints![joint]))) fail();
      const result = previous ? copyPose(previous) : { root: [...change!.root!] as Vec3, joints: {} as Pose['joints'] };
      if (change?.root) result.root = [...change.root];
      for (const joint of JOINT_NAMES) if (change?.joints?.[joint]) result.joints[joint] = [...change.joints[joint]!];
      return result;
    });
    takes.push({ ...meta, times, poses });
  }
  const history = source.history.map((snapshot, index) => ({ ...snapshot, take: snapshotReferences[index].take === null ? null : takes[snapshotReferences[index].take!], ...(snapshot.manual === undefined ? {} : { manual: { ...object(snapshot.manual), baseTake: takes[snapshotReferences[index].base!], ...(snapshotReferences[index].frozen === null ? {} : { pointBaseTake: takes[snapshotReferences[index].frozen!] }) } }) }));
  return { ...source.scene, project: { ...source.project, history } };
}
