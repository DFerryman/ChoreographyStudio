import { ACTIONS, bakeKeyframeSequence, bakeLegacyKeyframeSequence, EDITABLE_JOINT_NAMES, getKeyframeCount, JOINT_NAMES, makeCountMap, MAX_KEYFRAME_COUNT, MAX_TAKE_SAMPLES, ROOT_TRANSLATION_LIMITS, type ArrangementPlan, type BakedTake, type CameraTrack, type CountMap, type JointName, type KeyframeSequence, type Pose, type Quat, type Vec3 } from '../../../packages/core/src';
import type { SceneDocument, SceneViewer } from './scene';
import type { SceneOperation, SceneProject, SceneSnapshot } from './sceneProject';
import { MAX_FOOT_LOCKS, type FootLock } from '../../../packages/core/src/footLocks';
import { packScene, unpackScene } from './compactScene';
import { SCENE_CAMERA_TRACK_LIMITS, validateProjectCameraTracks } from './sceneCameraTrack';

export const SCENE_BACKUP_LIMITS = {
  headerBytes: 32 * 1024 * 1024,
  audioBytes: 100 * 1024 * 1024,
  history: 12,
  totalSamples: 150_000,
  totalCameraKeys: SCENE_CAMERA_TRACK_LIMITS.totalKeys,
} as const;
export const SCENE_BUNDLE_MAGIC = 'CHOREO-BUNDLE-1\n';
const magic = new TextEncoder().encode(SCENE_BUNDLE_MAGIC);
const prefixBytes = magic.length + 4;
const maxFileBytes = prefixBytes + SCENE_BACKUP_LIMITS.headerBytes + SCENE_BACKUP_LIMITS.audioBytes;
const forbiddenKeys = new Set(['__proto__', 'prototype', 'constructor']);
const joints = new Set<string>(JOINT_NAMES);
const editable = new Set<string>(EDITABLE_JOINT_NAMES);
// Uploaded music may use vendor subtypes (for example audio/x-m4a). The import
// UI must still decode the bytes; safe MIME metadata does not prove playability.
const safeAudioType = (value: string) => value === 'application/octet-stream' || /^audio\/[a-z0-9][a-z0-9.+_-]{0,63}$/.test(value);
type RecordValue = Record<string, unknown>;
type ValidationContext = {
  strict: boolean;
  takes?: WeakMap<object, BakedTake>;
  frozenEquivalence?: WeakMap<object, WeakMap<BakedTake, Set<string>>>;
};
const fail = (message: string): never => { throw new Error(`场景备份无效：${message}`); };
const own = (value: RecordValue, key: string) => Object.prototype.hasOwnProperty.call(value, key);

function record(value: unknown, required: readonly string[], optional: readonly string[], label: string, context: ValidationContext): RecordValue {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail(`${label}格式错误。`);
  const object = value as RecordValue;
  if (required.some(key => !own(object, key))) fail(`${label}缺少必要字段。`);
  if (Object.keys(object).some(key => forbiddenKeys.has(key) || (context.strict && !required.includes(key) && !optional.includes(key)))) fail(`${label}含不支持的字段。`);
  return object;
}
function text(value: unknown, label: string, max = 200): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max || /[\u0000-\u001f]/.test(value)) fail(`${label}为空或超出范围。`);
  return value as string;
}
function finite(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) fail(`${label}必须是有限数字。`);
  return value as number;
}
function integer(value: unknown, min: number, max: number, label: string): number {
  const number = finite(value, label);
  if (!Number.isSafeInteger(number) || number < min || number > max) fail(`${label}必须是范围内的整数。`);
  return number;
}
function boolean(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') fail(`${label}必须是布尔值。`);
  return value as boolean;
}
function enumValue<T extends string | number>(value: unknown, options: readonly T[], label: string): T {
  if (!options.includes(value as T)) fail(`${label}不受支持。`);
  return value as T;
}
function array(value: unknown, min: number, max: number, label: string): unknown[] {
  if (!Array.isArray(value) || value.length < min || value.length > max) fail(`${label}数量超出范围。`);
  return value as unknown[];
}
function vector(value: unknown, count: 3, label: string): Vec3;
function vector(value: unknown, count: 4, label: string): Quat;
function vector(value: unknown, count: 3 | 4, label: string): Vec3 | Quat {
  const result = array(value, count, count, label).map(component => finite(component, label));
  if (count === 4 && Math.abs(Math.hypot(...result) - 1) > 1e-6) fail(`${label}必须是单位四元数。`);
  return result as Vec3 | Quat;
}
function close(actual: number, expected: number, label: string, tolerance = 1e-9) {
  if (Math.abs(actual - expected) > tolerance) fail(`${label}与已确认数据不一致。`);
}

function validateCountMap(value: unknown, audioDuration: number, context: ValidationContext): CountMap {
  const object = record(value, ['id', 'version', 'bpm', 'musicBeatsPerDanceCount', 'firstCountSourceSeconds', 'sourceOffsetSeconds', 'durationSeconds', 'octetCount', 'countTimesSeconds', 'confirmed'], [], '数拍', context);
  const bpm = finite(object.bpm, 'BPM'), relation = enumValue(object.musicBeatsPerDanceCount, [0.5, 1, 2] as const, '每舞蹈拍音乐拍数');
  const first = finite(object.firstCountSourceSeconds, '第一拍时间'), offset = finite(object.sourceOffsetSeconds, '选段开始时间');
  const octets = integer(object.octetCount, 2, 60, '八拍数量');
  const octetSeconds = 60 / bpm * relation * 8;
  const start = (offset - first) / octetSeconds;
  if (!Number.isFinite(start) || start < -1e-9 || Math.abs(start - Math.round(start)) > 1e-9) fail('选段起点必须是完整八拍边界。');
  let expected: CountMap;
  try { expected = makeCountMap({ bpm, musicBeatsPerDanceCount: relation, firstCountSourceSeconds: first, startOctet: Math.round(start), octetCount: octets, audioDurationSeconds: audioDuration }); }
  catch { fail('数拍、选段或音频时长不符合预览范围。'); }
  if (object.version !== 1 || object.confirmed !== true) fail('数拍版本无效或尚未确认。');
  const duration = finite(object.durationSeconds, '组合时长');
  close(duration, expected!.durationSeconds, '组合时长'); close(offset, expected!.sourceOffsetSeconds, '选段起点');
  const countTimes = array(object.countTimesSeconds, octets * 8 + 1, octets * 8 + 1, '数拍时间').map(time => finite(time, '数拍时间'));
  countTimes.forEach((time, index) => close(time, expected!.countTimesSeconds[index], '数拍时间'));
  return { id: text(object.id, '数拍 ID'), version: 1, bpm, musicBeatsPerDanceCount: relation, firstCountSourceSeconds: first, sourceOffsetSeconds: offset, durationSeconds: duration, octetCount: octets, countTimesSeconds: countTimes, confirmed: true };
}
function validatePlan(value: unknown, map: CountMap, context: ValidationContext): ArrangementPlan | null {
  if (value === null) return null;
  const object = record(value, ['id', 'countMapId', 'durationSeconds', 'slots', 'provenance'], [], '编排', context);
  if (object.countMapId !== map.id || object.provenance !== 'synthetic-demo') fail('编排的数拍绑定或来源无效。');
  const duration = finite(object.durationSeconds, '编排时长'); close(duration, map.durationSeconds, '编排时长');
  const slots = array(object.slots, map.octetCount, map.octetCount, '编排八拍').map((value, index) => {
    const slot = record(value, ['slotIndex', 'actionId', 'label', 'teachingCue', 'startSeconds', 'endSeconds', 'countStart', 'countEnd', 'role'], [], '编排八拍', context);
    if (slot.slotIndex !== index || slot.countStart !== index * 8 + 1 || slot.countEnd !== (index + 1) * 8) fail('编排的八拍索引或数拍范围不一致。');
    const startSeconds = finite(slot.startSeconds, '八拍开始时间'), endSeconds = finite(slot.endSeconds, '八拍结束时间');
    close(startSeconds, map.countTimesSeconds[index * 8], '八拍开始时间'); close(endSeconds, map.countTimesSeconds[(index + 1) * 8], '八拍结束时间');
    const role: ArrangementPlan['slots'][number]['role'] = index === 0 ? 'opening' : index === map.octetCount - 1 ? 'closing' : 'body';
    if (slot.role !== role) fail('编排的八拍角色不一致。');
    return { slotIndex: index, actionId: enumValue(slot.actionId, ACTIONS.map(action => action.id), '演示动作'), label: text(slot.label, '八拍名称', 500), teachingCue: text(slot.teachingCue, '动作提示', 1000), startSeconds, endSeconds, countStart: index * 8 + 1, countEnd: (index + 1) * 8, role };
  });
  return { id: text(object.id, '编排 ID'), countMapId: map.id, durationSeconds: duration, slots, provenance: 'synthetic-demo' };
}
function validatePose(value: unknown, context: ValidationContext): Pose {
  const object = record(value, ['root', 'joints'], [], '姿态', context);
  const rotations = record(object.joints, JOINT_NAMES, [], '25 个骨骼旋转', context);
  return { root: vector(object.root, 3, '源动作 Root'), joints: Object.fromEntries(JOINT_NAMES.map(joint => [joint, vector(rotations[joint], 4, '局部旋转')])) as Pose['joints'] };
}
function validateTake(value: unknown, map: CountMap, context: ValidationContext): BakedTake {
  const object = record(value, ['id', 'schemaVersion', 'planId', 'countMapId', 'durationSeconds', 'times', 'poses', 'provenance'], [], '动作', context);
  const cached = context.takes?.get(object);
  if (cached) {
    if (cached.countMapId !== map.id) fail('动作版本、来源或数拍绑定无效。');
    close(cached.durationSeconds, map.durationSeconds, '动作时长');
    return cached;
  }
  if (object.schemaVersion !== 'preview-1' || object.provenance !== 'synthetic-demo' || object.countMapId !== map.id) fail('动作版本、来源或数拍绑定无效。');
  const duration = finite(object.durationSeconds, '动作时长'); close(duration, map.durationSeconds, '动作时长');
  const times = array(object.times, 2, MAX_TAKE_SAMPLES, '动作采样时间').map(time => finite(time, '动作采样时间'));
  if (times[0] !== 0 || times.at(-1) !== duration || times.some((time, index) => time < 0 || time > duration || (index > 0 && time <= times[index - 1]))) fail('动作采样必须严格递增并保留精确首末时刻。');
  const poses = array(object.poses, times.length, times.length, '动作姿态').map(pose => validatePose(pose, context));
  const take: BakedTake = { id: text(object.id, '动作 ID'), schemaVersion: 'preview-1', planId: text(object.planId, '动作编排 ID'), countMapId: map.id, durationSeconds: duration, times, poses, provenance: 'synthetic-demo' };
  context.takes?.set(object, take);
  return take;
}
function matchesAuthority(actual: BakedTake, reference: BakedTake): boolean {
  return actual.times.length === reference.times.length && actual.times.every((time, index) => time === reference.times[index]) && actual.poses.every((pose, index) => {
    const wanted = reference.poses[index];
    return pose.root.every((component, axis) => Math.abs(component - wanted.root[axis]) <= 1e-9) && JOINT_NAMES.every(joint => {
      const rotation = pose.joints[joint], target = wanted.joints[joint];
      const sign = rotation.reduce((sum, component, axis) => sum + component * target[axis], 0) < 0 ? -1 : 1;
      return rotation.every((component, axis) => Math.abs(component - target[axis] * sign) <= 1e-8);
    });
  });
}
function validateManual(value: unknown, map: CountMap, take: BakedTake, context: ValidationContext): KeyframeSequence {
  const object = record(value, ['schema', 'id', 'fps', 'baseTake', 'rotations', 'root'], ['footLocks', 'authorKeyPriority', 'steps', 'pointEdits', 'pointBaseTake'], '手 K 序列', context);
  if (object.schema !== 'manual-keyframes-1' || object.fps !== 30) fail('手 K 版本或帧率无效。');
  const baseTake = validateTake(object.baseTake, map, context);
  if (baseTake.planId !== take.planId) fail('手 K 基底与动作编排绑定不同。');
  let pointBaseTake: BakedTake | undefined;
  if (object.pointBaseTake !== undefined) {
    const frozen = record(object.pointBaseTake, ['id', 'schemaVersion', 'planId', 'countMapId', 'durationSeconds', 'times', 'poses', 'provenance'], [], '数据点原动作', context);
    pointBaseTake = validateTake(frozen, map, context);
    if (pointBaseTake.planId !== baseTake.planId || pointBaseTake.countMapId !== baseTake.countMapId || pointBaseTake.durationSeconds !== baseTake.durationSeconds) fail('数据点原动作与手 K 基底绑定不同。');
  }
  const tracks = record(object.rotations, [], EDITABLE_JOINT_NAMES, '关节轨道', context);
  if (Object.keys(tracks).some(name => !editable.has(name))) fail('轨道包含不可编辑的末端关节。');
  const rotations = Object.fromEntries(Object.entries(tracks).map(([joint, values]) => [joint, array(values, 0, MAX_KEYFRAME_COUNT, '关节关键帧').map(value => {
    const key = record(value, ['frame', 'rotation'], [], '关节关键帧', context);
    return { frame: finite(key.frame, '关键帧索引'), rotation: vector(key.rotation, 4, '关键帧旋转') };
  })])) as KeyframeSequence['rotations'];
  const root = array(object.root, 0, MAX_KEYFRAME_COUNT, 'Root 关键帧').map(value => {
    const key = record(value, ['frame', 'position'], [], 'Root 关键帧', context);
    const position = vector(key.position, 3, 'Root 关键帧位置');
    const limits = [ROOT_TRANSLATION_LIMITS.x, ROOT_TRANSLATION_LIMITS.y, ROOT_TRANSLATION_LIMITS.z];
    if (position.some((component, axis) => component < limits[axis][0] || component > limits[axis][1])) fail('Root 关键帧超出编辑边界。');
    return { frame: finite(key.frame, '关键帧索引'), position };
  });
  const pointEdits: KeyframeSequence['pointEdits'] = object.pointEdits === undefined ? undefined : array(object.pointEdits, 0, MAX_KEYFRAME_COUNT, '动作数据点').map(value => {
    const point = record(value, ['time'], ['root', 'joints'], '动作数据点', context);
    const time = finite(point.time, '动作数据点时间');
    if (time < 0 || time > map.durationSeconds) fail('动作数据点时间超出场景范围。');
    let root: Vec3 | undefined;
    if (own(point, 'root')) {
      root = vector(point.root, 3, '动作数据点 Root');
      const limits = [ROOT_TRANSLATION_LIMITS.x, ROOT_TRANSLATION_LIMITS.y, ROOT_TRANSLATION_LIMITS.z];
      if (root.some((component, axis) => component < limits[axis][0] || component > limits[axis][1])) fail('动作数据点 Root 超出编辑边界。');
    }
    let rotations: Partial<Record<JointName, Quat>> | undefined;
    if (own(point, 'joints')) {
      const values = record(point.joints, [], JOINT_NAMES, '动作数据点关节', context);
      if (Object.keys(values).some(name => !joints.has(name))) fail('动作数据点包含未知关节。');
      rotations = Object.fromEntries(Object.entries(values).map(([joint, rotation]) => [joint, vector(rotation, 4, '动作数据点旋转')]));
    }
    if (root === undefined && !Object.keys(rotations ?? {}).length) fail('动作数据点没有记录任何通道。');
    return { time, ...(root !== undefined ? { root } : {}), ...(rotations !== undefined ? { joints: rotations } : {}) };
  });
  const finalFrame = Math.ceil(map.durationSeconds * 30);
  const footLocks: FootLock[] | undefined = object.footLocks === undefined ? undefined : array(object.footLocks, 0, MAX_FOOT_LOCKS, '脚锁').map(value => {
    const lock = record(value, ['schema', 'id', 'foot', 'startFrame', 'endFrame', 'target', 'rotation', 'blendFrames'], [], '脚锁', context);
    if (lock.schema !== 'foot-lock-1') fail('脚锁版本不受支持。');
    return {
      schema: 'foot-lock-1', id: text(lock.id, '脚锁 ID', 160), foot: enumValue(lock.foot, ['LeftFoot', 'RightFoot'] as const, '脚锁脚部'),
      startFrame: integer(lock.startFrame, 0, finalFrame, '脚锁开始帧'), endFrame: integer(lock.endFrame, 0, finalFrame, '脚锁结束帧'),
      target: vector(lock.target, 3, '脚锁世界锚点'), rotation: vector(lock.rotation, 4, '脚锁世界旋转'), blendFrames: integer(lock.blendFrames, 0, 15, '脚锁过渡帧'),
    };
  });
  const authorKeyPriority = object.authorKeyPriority === undefined ? undefined : enumValue(object.authorKeyPriority, ['author-key-priority-1'] as const, '作者关键帧优先版本');
  let steps: KeyframeSequence['steps'];
  if (object.steps !== undefined) {
    const assistance = record(object.steps, ['schema', 'startFrame', 'endFrame'], [], '自动步伐', { strict: true });
    if (assistance.schema !== 'ground-steps-1') fail('自动步伐版本不受支持。');
    const startFrame = integer(assistance.startFrame, 0, finalFrame, '自动步伐开始帧'), endFrame = integer(assistance.endFrame, 0, finalFrame, '自动步伐结束帧');
    if (endFrame <= startFrame) fail('自动步伐区间必须按时间递增。');
    if (authorKeyPriority === undefined) fail('自动步伐必须使用作者关键帧优先版本。');
    steps = { schema: 'ground-steps-1', startFrame, endFrame };
  }
  const sequence: KeyframeSequence = { schema: 'manual-keyframes-1', id: text(object.id, '手 K 序列 ID'), fps: 30, baseTake, rotations, root, ...(footLocks !== undefined ? { footLocks } : {}), ...(authorKeyPriority !== undefined ? { authorKeyPriority } : {}), ...(steps !== undefined ? { steps } : {}), ...(pointEdits !== undefined ? { pointEdits } : {}), ...(pointBaseTake !== undefined ? { pointBaseTake } : {}) };
  let expected: BakedTake;
  try { getKeyframeCount(sequence); expected = bakeKeyframeSequence(sequence); }
  catch { fail('手 K 轨道、脚锁、帧索引或采样资源无效。'); }
  if (pointBaseTake !== undefined) {
    // Only immutable source identity and all underlying evaluation inputs can
    // reuse this check. IDs and point overlays do not define that authority.
    const signature = JSON.stringify({ rotations, root, footLocks, authorKeyPriority, steps });
    const frozen = object.pointBaseTake as object;
    let sources = context.frozenEquivalence?.get(frozen);
    let signatures = sources?.get(baseTake);
    if (!signatures?.has(signature)) {
      const underlying: KeyframeSequence = { ...sequence, pointEdits: [] };
      delete underlying.pointBaseTake;
      let equivalent: boolean;
      try {
        equivalent = matchesAuthority(pointBaseTake, bakeKeyframeSequence(underlying));
        // Older unversioned contact files accepted either complete historical
        // evaluator. Match one entire output, never a mixture of its poses.
        if (!equivalent && authorKeyPriority === undefined && !steps && footLocks?.length) {
          delete underlying.pointEdits;
          equivalent = matchesAuthority(pointBaseTake, bakeKeyframeSequence(underlying));
        }
      } catch { fail('数据点原动作无法校验手 K 的原始求值。'); }
      if (!equivalent!) fail('数据点原动作与手 K 的完整采样时间或原始求值不一致。');
      if (context.frozenEquivalence) {
        if (!sources) { sources = new WeakMap(); context.frozenEquivalence.set(frozen, sources); }
        if (!signatures) { signatures = new Set(); sources.set(baseTake, signatures); }
        signatures.add(signature);
      }
    }
  }
  // v12 contacts could adjust even explicit K. Accept that historical output
  // only for an unversioned old sequence, checking the entire authority against
  // one deterministic evaluator. Never mix algorithms per pose or change a take
  // during import. Versioned author-priority sequences have no legacy fallback.
  if (!matchesAuthority(take, expected!) && sequence.authorKeyPriority === undefined && !sequence.steps && sequence.footLocks?.length) {
    const legacyExpected = bakeLegacyKeyframeSequence(sequence);
    if (matchesAuthority(take, legacyExpected)) expected = legacyExpected;
  }
  if (take.times.length !== expected!.times.length || take.times.some((time, index) => time !== expected!.times[index])) fail('手 K 动作没有保留基底与关键帧的完整采样时间。');
  take.poses.forEach((pose, index) => {
    const reference = expected!.poses[index];
    pose.root.forEach((component, axis) => close(component, reference.root[axis], '手 K 的 Root 动作'));
    for (const joint of JOINT_NAMES) {
      const actual = pose.joints[joint], wanted = reference.joints[joint];
      // q and -q express the same parent-local rotation; keep the imported bits.
      const sign = actual.reduce((sum, component, axis) => sum + component * wanted[axis], 0) < 0 ? -1 : 1;
      actual.forEach((component, axis) => close(component, wanted[axis] * sign, '手 K 的骨骼动作', 1e-8));
    }
  });
  return sequence;
}

function preflightSamples(project: RecordValue) {
  let samples = 0;
  const frozenTakes = new Set<object>();
  for (const snapshot of array(project.history, 1, SCENE_BACKUP_LIMITS.history, '历史')) {
    if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) fail('历史条目格式错误。');
    const entry = snapshot as RecordValue;
    const manual = entry.manual && typeof entry.manual === 'object' ? entry.manual as RecordValue : null;
    const candidates = [entry.take, manual?.baseTake];
    if (manual?.pointBaseTake !== undefined) {
      const frozen = manual.pointBaseTake;
      if (!frozen || typeof frozen !== 'object' || Array.isArray(frozen)) fail('数据点原动作格式错误。');
      if (!frozenTakes.has(frozen as object)) { frozenTakes.add(frozen as object); candidates.push(frozen); }
    }
    for (const value of candidates) {
      if (value == null) continue;
      if (typeof value !== 'object' || Array.isArray(value)) fail('动作格式错误。');
      samples += array((value as RecordValue).times, 2, MAX_TAKE_SAMPLES, '动作采样时间').length;
      if (samples > SCENE_BACKUP_LIMITS.totalSamples) fail('整个场景的动作样本超出备份范围。');
    }
  }
}
function validateProject(value: unknown, context: ValidationContext): SceneProject {
  const object = record(value, ['history', 'historyIndex', 'revision', 'audioDuration', 'teacherCheckedRevision'], [], '项目', context);
  try { validateProjectCameraTracks(object); }
  catch (error) { fail(error instanceof Error ? error.message : '相机轨道格式无效。'); }
  preflightSamples(object);
  const takeContext: ValidationContext = { ...context, takes: new WeakMap(), frozenEquivalence: new WeakMap() };
  const audioDuration = finite(object.audioDuration, '原音频时长');
  if (audioDuration < 16 || audioDuration > 600) fail('原音频必须是 16 秒至 10 分钟。');
  const history: SceneSnapshot[] = array(object.history, 1, SCENE_BACKUP_LIMITS.history, '历史').map(value => {
    const snapshot = record(value, ['title', 'countMap', 'plan', 'take'], ['manual', 'cameraTrack', 'audioOffsetSeconds', 'operation'], '历史条目', context);
    const countMap = validateCountMap(snapshot.countMap, audioDuration, context);
    let audioOffsetSeconds: number | undefined;
    if (own(snapshot, 'audioOffsetSeconds')) {
      audioOffsetSeconds = finite(snapshot.audioOffsetSeconds, '音乐轨偏移');
      if (Math.abs(audioOffsetSeconds) >= countMap.durationSeconds) fail('音乐轨偏移必须保留场景内的选段。');
      if (Math.abs(audioOffsetSeconds * 30 - Math.round(audioOffsetSeconds * 30)) > 1e-9) fail('音乐轨偏移必须对齐 30 fps 整帧。');
    }
    const plan = validatePlan(snapshot.plan, countMap, context);
    const take = snapshot.take === null ? null : validateTake(snapshot.take, countMap, takeContext);
    if (plan && take && plan.id !== take.planId) fail('动作与编排 ID 不一致。');
    if (!take && snapshot.manual != null) fail('手 K 序列缺少权威动作。');
    const manual = snapshot.manual === undefined ? undefined : validateManual(snapshot.manual, countMap, take!, takeContext);
    const cameraTrack = own(snapshot, 'cameraTrack') ? snapshot.cameraTrack as CameraTrack : undefined;
    const operation = snapshot.operation === undefined ? undefined : validateOperation(snapshot.operation, countMap.durationSeconds, context);
    return { title: text(snapshot.title, '作品名称'), countMap, plan, take, ...(manual ? { manual } : {}), ...(cameraTrack !== undefined ? { cameraTrack } : {}), ...(audioOffsetSeconds !== undefined ? { audioOffsetSeconds } : {}), ...(operation !== undefined ? { operation } : {}) };
  });
  const revision = integer(object.revision, 1, Number.MAX_SAFE_INTEGER, '作品版本');
  const teacherCheckedRevision = object.teacherCheckedRevision === null ? null : integer(object.teacherCheckedRevision, 1, revision, '试看版本');
  return { history, historyIndex: integer(object.historyIndex, 0, history.length - 1, '历史位置'), revision, audioDuration, teacherCheckedRevision };
}
function validateOperation(value: unknown, duration: number, context: ValidationContext): SceneOperation {
  const operation = record(value, ['label'], ['time', 'tracks'], '操作记录', context);
  let time: number | undefined;
  if (own(operation, 'time')) {
    time = finite(operation.time, '操作时间');
    if (time < 0 || time > duration) fail('操作时间超出场景范围。');
  }
  let tracks: SceneOperation['tracks'];
  if (own(operation, 'tracks')) {
    tracks = array(operation.tracks, 0, JOINT_NAMES.length + 2, '操作通道').map(track => enumValue(track, ['root', ...JOINT_NAMES, 'camera'] as const, '操作通道'));
    if (new Set(tracks).size !== tracks.length) fail('操作通道不能重复。');
  }
  return { label: text(operation.label, '操作名称'), ...(time !== undefined ? { time } : {}), ...(tracks !== undefined ? { tracks } : {}) };
}
function validateViewer(value: unknown, project: SceneProject, context: ValidationContext): SceneViewer {
  const object = record(value, ['camera', 'view', 'mirror', 'rate', 'loop', 'countSound', 'selectedSlot', 'selectedJoint', 'time'], ['gridVisible', 'axesVisible', 'rigMode', 'editorMode', 'transformTool'], '观看设置', context);
  const active = project.history[project.historyIndex];
  let camera: SceneViewer['camera'] = null;
  if (object.camera !== null) {
    const state = record(object.camera, ['position', 'target'], ['zoom'], '相机', context);
    const position = vector(state.position, 3, '相机位置'), target = vector(state.target, 3, '相机目标');
    if ([...position, ...target].some(component => Math.abs(component) > 1000) || Math.hypot(...position.map((component, axis) => component - target[axis])) < 0.01) fail('相机位置或方向超出范围。');
    const zoom = state.zoom === undefined ? undefined : finite(state.zoom, '相机缩放');
    if (zoom !== undefined && (zoom < 0.5 || zoom > 4)) fail('相机缩放超出范围。');
    camera = { position, target, ...(zoom !== undefined ? { zoom } : {}) };
  }
  const time = finite(object.time, '播放时间');
  if (time < 0 || time > active.countMap.durationSeconds) fail('播放时间超出当前组合。');
  if (object.selectedJoint !== null && !joints.has(object.selectedJoint as string)) fail('选中关节不存在。');
  return {
    camera, view: enumValue(object.view, ['front', 'back', 'left', 'right', 'top', 'free'] as const, '视角'), mirror: boolean(object.mirror, '镜像'), rate: enumValue(object.rate, [0.5, 0.75, 1] as const, '播放速度'), loop: boolean(object.loop, '循环'), countSound: boolean(object.countSound, '节拍提示'),
    selectedSlot: integer(object.selectedSlot, 0, active.countMap.octetCount - 1, '选中八拍'), selectedJoint: object.selectedJoint as JointName | null, time,
    ...(object.gridVisible !== undefined ? { gridVisible: boolean(object.gridVisible, '网格') } : {}),
    ...(object.axesVisible !== undefined ? { axesVisible: boolean(object.axesVisible, '坐标轴') } : {}),
    ...(object.rigMode !== undefined ? { rigMode: enumValue(object.rigMode, ['skeleton', 'body'] as const, '角色显示') } : {}),
    ...(object.editorMode !== undefined ? { editorMode: enumValue(object.editorMode, ['arrange', 'keyframes'] as const, '编辑模式') } : {}),
    ...(object.transformTool !== undefined ? { transformTool: enumValue(object.transformTool, ['select', 'rotate', 'translate', 'ik'] as const, '操作工具') } : {}),
  };
}
function validateScene(value: unknown, context: ValidationContext): SceneDocument<SceneProject> {
  const object = record(value, ['schema', 'id', 'name', 'createdAt', 'updatedAt', 'coordinateSystem', 'actor', 'project', 'audioName', 'viewer'], ['audio'], '场景', context);
  if (object.schema !== 'choreo-scene-1') fail('场景版本不受支持。');
  const coordinates = record(object.coordinateSystem, ['handedness', 'upAxis', 'forwardAxis', 'units', 'floorPlane', 'origin'], [], '坐标空间', context);
  const origin = vector(coordinates.origin, 3, '坐标原点');
  if (coordinates.handedness !== 'right' || coordinates.upAxis !== '+Y' || coordinates.forwardAxis !== '+Z' || coordinates.units !== 'm' || coordinates.floorPlane !== 'XZ' || origin.some(component => component !== 0)) fail('坐标空间必须是右手、Y 向上、+Z 前向的米制 XZ 地面。');
  const actor = record(object.actor, ['id', 'rigId', 'provenance', 'joints'], [], '角色', context);
  if (actor.id !== 'actor-1' || actor.rigId !== 'synthetic-skeleton-1' || actor.provenance !== 'synthetic-demo' || array(actor.joints, 25, 25, '角色骨骼').some((joint, index) => joint !== JOINT_NAMES[index])) fail('角色必须使用本版原创 25 关节骨架。');
  const createdAt = text(object.createdAt, '创建时间', 64), updatedAt = text(object.updatedAt, '修改时间', 64);
  if (!Number.isFinite(Date.parse(createdAt)) || !Number.isFinite(Date.parse(updatedAt))) fail('场景日期无效。');
  const project = validateProject(object.project, context);
  return { schema: 'choreo-scene-1', id: text(object.id, '场景 ID'), name: text(object.name, '场景名称'), createdAt, updatedAt, coordinateSystem: { handedness: 'right', upAxis: '+Y', forwardAxis: '+Z', units: 'm', floorPlane: 'XZ', origin }, actor: { id: 'actor-1', rigId: 'synthetic-skeleton-1', provenance: 'synthetic-demo', joints: [...JOINT_NAMES] }, project, audio: null, audioName: text(object.audioName, '原音频名称', 255), viewer: validateViewer(object.viewer, project, context) };
}

/** Native JSON parsing loses duplicate keys; check structure before it can hide an overwrite. */
function parseJson(bytes: ArrayBuffer): unknown {
  let source: string;
  try { source = new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { fail('项目 JSON 不是有效 UTF-8。'); }
  let index = 0;
  const whitespace = () => { while (/\s/.test(source![index] ?? '') && index < source!.length) index++; };
  const stringToken = () => {
    if (source![index] !== '"') fail('项目 JSON 格式错误。');
    const start = index++;
    while (index < source!.length) {
      const character = source![index++];
      if (character === '\\') index++;
      else if (character === '"') return source!.slice(start, index);
    }
    fail('项目 JSON 字符串不完整。');
  };
  const value = (depth: number): void => {
    if (depth > 32) fail('项目 JSON 嵌套过深。');
    whitespace();
    const character = source![index];
    if (character === '"') { stringToken(); return; }
    if (character === '{') {
      index++; whitespace(); const keys = new Set<string>();
      if (source![index] === '}') { index++; return; }
      while (index < source!.length) {
        const token = stringToken(); let key: string;
        try { key = JSON.parse(token!); } catch { fail('项目 JSON 字段无效。'); }
        if (forbiddenKeys.has(key!) || keys.has(key!)) fail('项目 JSON 含危险或重复字段。');
        keys.add(key!); whitespace(); if (source![index++] !== ':') fail('项目 JSON 格式错误。');
        value(depth + 1); whitespace(); const separator = source![index++];
        if (separator === '}') return;
        if (separator !== ',') fail('项目 JSON 格式错误。');
        whitespace();
      }
      fail('项目 JSON 对象不完整。');
    }
    if (character === '[') {
      index++; whitespace(); if (source![index] === ']') { index++; return; }
      while (index < source!.length) {
        value(depth + 1); whitespace(); const separator = source![index++];
        if (separator === ']') return;
        if (separator !== ',') fail('项目 JSON 格式错误。');
      }
      fail('项目 JSON 数组不完整。');
    }
    const start = index;
    while (index < source!.length && !/[\s,\]}]/.test(source![index])) index++;
    if (index === start) fail('项目 JSON 值无效。');
  };
  value(0); whitespace(); if (index !== source!.length) fail('项目 JSON 含多余数据。');
  try { return JSON.parse(source!); } catch { fail('项目 JSON 无法解析。'); }
}
async function digest(blob: Blob): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
  return Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('');
}

/** Full local backup: a bounded JSON header followed by the original audio bytes. */
export async function encodeSceneBackup(scene: SceneDocument<SceneProject>): Promise<Blob> {
  if (!(scene.audio instanceof Blob) || scene.audio.size < 1 || scene.audio.size > SCENE_BACKUP_LIMITS.audioBytes) fail('完整备份需要不超过 100 MiB 的原音频。');
  const audioBlob = scene.audio as Blob;
  const mimeType = audioBlob.type || 'application/octet-stream';
  if (!safeAudioType(mimeType)) fail('音频 MIME 类型不受支持。');
  // Explicit reconstructed fields leave editor-only state outside the container.
  const sanitized = validateScene(scene, { strict: false });
  const { audio: _audio, ...document } = sanitized;
  const audio = { byteLength: audioBlob.size, mimeType, sha256: await digest(audioBlob) };
  const header = new TextEncoder().encode(JSON.stringify({ format: 'choreo-scene-bundle-2', scene: packScene(document), audio }));
  if (header.byteLength > SCENE_BACKUP_LIMITS.headerBytes) fail('场景数据超过 32 MiB，请减少历史或采样数据。');
  const prefix = new Uint8Array(prefixBytes); prefix.set(magic); new DataView(prefix.buffer).setUint32(magic.length, header.byteLength, true);
  return new Blob([prefix, header, audioBlob], { type: 'application/octet-stream' });
}

/** Lossless project-only export uses the same shared authority tables as full bundles. */
export function encodeSceneJsonBackup(scene: SceneDocument<SceneProject>): Blob {
  const { audio: _audio, ...document } = validateScene(scene, { strict: false });
  const bytes = new TextEncoder().encode(JSON.stringify({ format: 'choreo-scene-backup-2', scene: packScene(document), audioIncluded: false }));
  if (bytes.byteLength > SCENE_BACKUP_LIMITS.headerBytes) fail('场景数据超过 32 MiB，请减少历史或采样数据。');
  return new Blob([bytes], { type: 'application/json' });
}

/** Read and validate without persistence; callers attach decoded music and create a new scene identity. */
export async function decodeSceneBackup(file: Blob): Promise<{ scene: SceneDocument<SceneProject>; needsAudio: boolean }> {
  if (!(file instanceof Blob) || file.size < 1 || file.size > maxFileBytes) fail('文件为空或超出完整备份大小上限。');
  const prefix = new Uint8Array(await file.slice(0, prefixBytes).arrayBuffer());
  const bundled = prefix.length >= magic.length && magic.every((byte, index) => prefix[index] === byte);
  if (!bundled) {
    if (file.size > SCENE_BACKUP_LIMITS.headerBytes) fail('旧版 JSON 数据超过 32 MiB。');
    const legacy = record(parseJson(await file.arrayBuffer()), ['format', 'scene', 'audioIncluded'], [], '旧版备份', { strict: true });
    if (!['choreo-scene-backup-1', 'choreo-scene-backup-2'].includes(legacy.format as string) || legacy.audioIncluded !== false) fail('备份格式不受支持。');
    const original = (legacy.format === 'choreo-scene-backup-2' ? unpackScene(legacy.scene) : legacy.scene) as RecordValue;
    const scene = validateScene(original, { strict: true });
    if (original.audio != null) fail('旧版 JSON 不能包含原音频。');
    scene.project.teacherCheckedRevision = null;
    return { scene, needsAudio: true };
  }
  if (prefix.length !== prefixBytes) fail('完整备份文件头不完整。');
  const headerLength = new DataView(prefix.buffer, prefix.byteOffset, prefix.byteLength).getUint32(magic.length, true);
  if (!headerLength || headerLength > SCENE_BACKUP_LIMITS.headerBytes || prefixBytes + headerLength >= file.size) fail('项目文件头长度无效或数据不完整。');
  const header = record(parseJson(await file.slice(prefixBytes, prefixBytes + headerLength).arrayBuffer()), ['format', 'scene', 'audio'], [], '完整备份', { strict: true });
  if (!['choreo-scene-bundle-1', 'choreo-scene-bundle-2'].includes(header.format as string)) fail('完整备份版本不受支持。');
  const metadata = record(header.audio, ['byteLength', 'mimeType', 'sha256'], [], '音频记录', { strict: true });
  const byteLength = integer(metadata.byteLength, 1, SCENE_BACKUP_LIMITS.audioBytes, '音频字节数');
  if (file.size !== prefixBytes + headerLength + byteLength) fail('原音频缺失、截断或有多余数据。');
  const mimeType = text(metadata.mimeType, '音频 MIME 类型', 100), sha256 = text(metadata.sha256, '音频校验值', 64);
  if (!safeAudioType(mimeType) || !/^[a-f0-9]{64}$/.test(sha256)) fail('音频类型或 SHA-256 校验记录无效。');
  const document = header.format === 'choreo-scene-bundle-2' ? unpackScene(header.scene) : header.scene;
  const scene = validateScene(document, { strict: true });
  if ((document as RecordValue).audio !== undefined) fail('原音频必须作为独立二进制数据保存。');
  const audio = file.slice(prefixBytes + headerLength, file.size, mimeType);
  if (await digest(audio) !== sha256) fail('原音频校验失败，文件可能已损坏。');
  scene.audio = audio; scene.project.teacherCheckedRevision = null;
  return { scene, needsAudio: false };
}
