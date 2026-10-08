import { Quaternion, Vector3 } from 'three';
import { clonePose, evaluatePose, RIG_DEFINITIONS } from './humanoid';
import { STANDARD_HUMAN_PROFILE } from './humanProfile';
import { solveLimbIK } from './ik';
import { constrainJointRotation, isJointRotationWithinLimits } from './jointConstraints';
import type { FootLockProtection, LockedFoot } from './footLocks';
import type { KeyframeSequence } from './keyframes';
import type { JointName, Pose, Quat, Vec3 } from './motion-types';

/** Persist intent, never generated samples or thousands of artificial author K. */
export type StepAssistance = { schema: 'ground-steps-1'; startFrame: number; endFrame: number };
export type StepAssistanceIssue = { startFrame: number; endFrame: number; code: string; message: string };
export type StepAssistanceSegment = { startFrame: number; endFrame: number; stepCount: number; status: 'supported' | 'skipped' };
export type StepAssistanceReport = {
  stepCount: number; segments: StepAssistanceSegment[]; issues: StepAssistanceIssue[];
  maxStanceResidualMeters: number; maxOrientationResidualRadians: number; maxRootLoweringMeters: number;
};
type FootStep = { foot: LockedFoot; startFrame: number; endFrame: number; from: Vec3; to: Vec3 };
type PlannedSegment = StepAssistanceSegment & {
  initial: Record<LockedFoot, Vec3>; rotations: Record<LockedFoot, Quat>; steps: FootStep[];
};
export type StepPlan = { segments: PlannedSegment[]; report: StepAssistanceReport };
export type StepTarget = { foot: LockedFoot; position: Vec3; rotation: Quat; swinging: boolean; weight: number };
const feet = ['LeftFoot', 'RightFoot'] as const;
const legJoints: readonly JointName[] = ['LeftUpperLeg', 'LeftLowerLeg', 'LeftFoot', 'RightUpperLeg', 'RightLowerLeg', 'RightFoot'];
/** Versioned editor defaults, not a measured or dynamically balanced gait. */
export const GROUND_STEP_DEFAULTS = Object.freeze({
  maxFootStrideMeters: .20, liftMeters: .045, maxRootLoweringMeters: .04,
  minimumSwingSlotFrames: 8, transitionFrames: 3, maxSteps: 128,
});
const smooth = (value: number) => { const u = Math.max(0, Math.min(1, value)); return u * u * (3 - 2 * u); };
const quintic = (u: number) => u * u * u * (u * (u * 6 - 15) + 10);
const distance = (a: Vec3, b: Vec3) => Math.hypot(...a.map((value, axis) => value - b[axis]));
const horizontalDistance = (a: Vec3, b: Vec3) => Math.hypot(a[0] - b[0], a[2] - b[2]);
const copyVector = (v: readonly number[]) => [...v] as Vec3;
const interpolate = (a: Vec3, b: Vec3, u: number) => a.map((value, axis) => value + (b[axis] - value) * u) as Vec3;
export const emptyStepReport = (): StepAssistanceReport => ({ stepCount: 0, segments: [], issues: [], maxStanceResidualMeters: 0, maxOrientationResidualRadians: 0, maxRootLoweringMeters: 0 });

export function validateStepAssistance(value: StepAssistance, duration: number): void {
  if (!Number.isFinite(duration) || duration <= 0 || duration > 60 || !value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !['schema', 'startFrame', 'endFrame'].includes(key)) || value.schema !== 'ground-steps-1' || !Number.isInteger(value.startFrame) || !Number.isInteger(value.endFrame) || value.startFrame < 0 || value.endFrame > Math.ceil(duration * 30) || value.endFrame <= value.startFrame) throw new Error('自动迈步版本或起止帧无效。');
}

function soleHeight(pose: Pose, foot: LockedFoot): { minimum: number; maximum: number; tilt: number } {
  const world = evaluatePose(pose)[foot], rotation = new Quaternion(...world.rotation);
  const heights = [-STANDARD_HUMAN_PROFILE.foot.halfWidthMeters, STANDARD_HUMAN_PROFILE.foot.halfWidthMeters].flatMap(x =>
    [STANDARD_HUMAN_PROFILE.foot.heelZ, STANDARD_HUMAN_PROFILE.foot.toeZ].map(z => new Vector3(x, -STANDARD_HUMAN_PROFILE.foot.soleOffsetMeters, z).applyQuaternion(rotation).y + world.position[1]));
  return { minimum: Math.min(...heights), maximum: Math.max(...heights), tilt: new Vector3(0, 1, 0).applyQuaternion(rotation).angleTo(new Vector3(0, 1, 0)) };
}

function segmentEnvelope(segment: StepAssistanceSegment, frame: number): number {
  return smooth(Math.min((frame - segment.startFrame) / GROUND_STEP_DEFAULTS.transitionFrames, (segment.endFrame - frame) / GROUND_STEP_DEFAULTS.transitionFrames));
}

/** Stateless targets: random seeking never advances a gait state machine. */
export function getStepTargets(plan: StepPlan, frame: number): StepTarget[] {
  const segment = plan.segments.find(item => item.status === 'supported' && frame > item.startFrame && frame < item.endFrame);
  if (!segment) return [];
  const weight = segmentEnvelope(segment, frame);
  return feet.map(foot => {
    let position = copyVector(segment.initial[foot]), swinging = false;
    for (const step of segment.steps.filter(item => item.foot === foot)) {
      if (frame <= step.startFrame) break;
      if (frame >= step.endFrame) { position = copyVector(step.to); continue; }
      const u = (frame - step.startFrame) / (step.endFrame - step.startFrame);
      position = interpolate(step.from, step.to, quintic(u));
      position[1] += GROUND_STEP_DEFAULTS.liftMeters * 64 * u ** 3 * (1 - u) ** 3;
      swinging = true; break;
    }
    return { foot, position, rotation: [...segment.rotations[foot]], swinging, weight };
  });
}

/** Only derived Y and the six leg rotations may change. Author bits win. */
export function applyStepAssistance(pose: Pose, plan: StepPlan, frame: number, protection: FootLockProtection = {}): Pose {
  const targets = getStepTargets(plan, frame);
  if (!targets.length) return pose;
  const result = clonePose(pose), world = evaluatePose(result);
  const thigh = Math.abs(RIG_DEFINITIONS.find(item => item.name === 'LeftLowerLeg')!.offset[1]);
  const shin = Math.abs(RIG_DEFINITIONS.find(item => item.name === 'LeftFoot')!.offset[1]);
  const reach = thigh + shin - .0005;
  let requiredY = pose.root[1];
  for (const target of targets) {
    const upper = target.foot === 'LeftFoot' ? 'LeftUpperLeg' : 'RightUpperLeg';
    const origin = world[upper].position, horizontal = horizontalDistance(origin, target.position);
    if (horizontal < reach && origin[1] > target.position[1]) requiredY = Math.min(requiredY, target.position[1] + Math.sqrt(reach * reach - horizontal * horizontal) - (origin[1] - pose.root[1]));
  }
  const lowering = Math.min(GROUND_STEP_DEFAULTS.maxRootLoweringMeters, Math.max(0, pose.root[1] - requiredY));
  if ((protection.root ?? 0) !== 1) result.root[1] -= lowering * targets[0].weight * (1 - (protection.root ?? 0));
  for (const target of targets) {
    const solved = solveLimbIK(result, target.foot, target.position, { preserveEndRotation: target.rotation });
    const chain = target.foot === 'LeftFoot' ? ['LeftUpperLeg', 'LeftLowerLeg', 'LeftFoot'] as const : ['RightUpperLeg', 'RightLowerLeg', 'RightFoot'] as const;
    for (const joint of chain) {
      const authorWeight = protection.joints?.[joint] ?? 0;
      if (authorWeight === 1) continue;
      const rotation = new Quaternion(...pose.joints[joint]).slerp(new Quaternion(...solved.pose.joints[joint]), target.weight * (1 - authorWeight)).normalize().toArray() as Quat;
      result.joints[joint] = authorWeight > 0 ? rotation : constrainJointRotation(joint, rotation);
    }
  }
  return result;
}

/** Measure the final pose, including subsequent explicit locks/protected K. */
export function accumulateStepResiduals(report: StepAssistanceReport, plan: StepPlan, authored: Pose, actual: Pose, frame: number): void {
  const targets = getStepTargets(plan, frame);
  if (!targets.length) return;
  report.maxRootLoweringMeters = Math.max(report.maxRootLoweringMeters, Math.max(0, authored.root[1] - actual.root[1]));
  const world = evaluatePose(actual);
  for (const target of targets.filter(item => !item.swinging)) {
    report.maxStanceResidualMeters = Math.max(report.maxStanceResidualMeters, distance(world[target.foot].position, target.position));
    report.maxOrientationResidualRadians = Math.max(report.maxOrientationResidualRadians, new Quaternion(...world[target.foot].rotation).angleTo(new Quaternion(...target.rotation)));
  }
}

/**
 * Flat, upright, constant-facing routes only. Unsupported authored intervals
 * remain intact and do not prevent neighboring eligible intervals from working.
 * inputPoseAt consumes original author interpolation before any assistance.
 */
export function buildStepPlan(sequence: KeyframeSequence, inputPoseAt: (frame: number, exactTime?: number) => Pose, authorKnotTimes: readonly number[] = sequence.baseTake.times): StepPlan {
  const report = emptyStepReport(), plan: StepPlan = { segments: [], report }, intent = sequence.steps;
  if (!intent) return plan;
  validateStepAssistance(intent, sequence.baseTake.durationSeconds);
  if (!Array.isArray(authorKnotTimes) || authorKnotTimes.length > 6001 || authorKnotTimes.some(time => !Number.isFinite(time) || time < 0 || time > sequence.baseTake.durationSeconds)) throw new Error('自动迈步的原始采样时刻无效。');
  const boundaries = new Set([intent.startFrame, intent.endFrame]);
  for (const key of [...sequence.root, ...legJoints.flatMap(joint => sequence.rotations[joint] ?? [])]) if (key.frame > intent.startFrame && key.frame < intent.endFrame) boundaries.add(key.frame);
  for (const lock of sequence.footLocks ?? []) for (const frame of [lock.startFrame, lock.endFrame]) if (frame > intent.startFrame && frame < intent.endFrame) boundaries.add(frame);
  // Split source path direction/stops as well as explicitly recorded Root K.
  let previousDirection: Vec3 | null = null, previousMoving: boolean | null = null;
  for (let frame = intent.startFrame; frame < intent.endFrame; frame++) {
    const a = inputPoseAt(frame).root, b = inputPoseAt(frame + 1).root;
    const length = horizontalDistance(a, b), moving = length > .00001;
    const direction: Vec3 | null = moving ? [(b[0] - a[0]) / length, 0, (b[2] - a[2]) / length] : null;
    if (previousMoving !== null && (moving !== previousMoving || direction && previousDirection && direction[0] * previousDirection[0] + direction[2] * previousDirection[2] < Math.cos(Math.PI / 36))) boundaries.add(frame);
    previousDirection = direction; previousMoving = moving;
  }
  const frames = [...boundaries].sort((a, b) => a - b);
  for (let index = 1; index < frames.length; index++) {
    const startFrame = frames[index - 1], endFrame = frames[index], first = inputPoseAt(startFrame), last = inputPoseAt(endFrame);
    const initialWorld = evaluatePose(first), finalWorld = evaluatePose(last);
    const segment: PlannedSegment = { startFrame, endFrame, stepCount: 0, status: 'skipped', initial: { LeftFoot: copyVector(initialWorld.LeftFoot.position), RightFoot: copyVector(initialWorld.RightFoot.position) }, rotations: { LeftFoot: [...initialWorld.LeftFoot.rotation], RightFoot: [...initialWorld.RightFoot.rotation] }, steps: [] };
    plan.segments.push(segment);
    const reject = (code: string, message: string) => report.issues.push({ startFrame, endFrame, code, message });
    const length = horizontalDistance(first.root, last.root);
    if (length < .025) { reject('stationary', '位移很小，保留原姿态。'); continue; }
    if ((sequence.footLocks ?? []).some(lock => lock.startFrame < endFrame && lock.endFrame > startFrame)) { reject('explicit-foot-lock', '此段存在手动脚锁，保留原脚锁与作者姿态。'); continue; }
    const hips = new Quaternion(...initialWorld.Hips.rotation), forward = new Vector3(0, 0, 1).applyQuaternion(hips), side = new Vector3(1, 0, 0).applyQuaternion(hips);
    const direction = new Vector3(last.root[0] - first.root[0], 0, last.root[2] - first.root[2]).normalize();
    if (Math.max(Math.abs(direction.dot(forward)), Math.abs(direction.dot(side))) < Math.cos(Math.PI / 12)) { reject('diagonal-route', '当前辅助只支持正前后与左右平地移动。'); continue; }
    // Imported authority may contain crucial non-30-Hz knots. Checking only
    // integer frames can miss a brief authored jump, impossible pose or Root
    // excursion even though that exact knot is retained in the final Take.
    const sourceKnots = authorKnotTimes.map(time => ({ frame: time === sequence.baseTake.durationSeconds ? Math.ceil(time * 30) : time * 30, exactTime: time })).filter(point => point.frame >= startFrame && point.frame <= endFrame);
    // Do not round-trip time through frame/30 or deduplicate by fractional
    // frame: multiplication can collapse two distinct, very close source times.
    const checkedPoints: { frame: number; exactTime?: number }[] = [...Array.from({ length: endFrame - startFrame + 1 }, (_, offset) => ({ frame: startFrame + offset })), ...sourceKnots].sort((a, b) => a.frame - b.frame);
    let unsupported: [string, string] | null = null;
    for (const { frame, exactTime } of checkedPoints) {
      const pose = inputPoseAt(frame, exactTime), world = evaluatePose(pose), up = new Vector3(0, 1, 0).applyQuaternion(new Quaternion(...world.Hips.rotation));
      if (Math.abs(pose.root[1] - first.root[1]) > .02 || up.angleTo(new Vector3(0, 1, 0)) > Math.PI / 18 || new Quaternion(...world.Hips.rotation).angleTo(hips) > Math.PI / 18) { unsupported = ['vertical-or-turning', '此段含高度变化、倾倒或转身，保留作者动作。']; break; }
      if (legJoints.some(joint => !isJointRotationWithinLimits(joint, pose.joints[joint]))) { unsupported = ['authored-leg-pose', '此段腿部作者姿态超出辅助范围，保留手 K。']; break; }
      if (new Vector3(...world.LeftFoot.position).sub(new Vector3(...world.RightFoot.position)).dot(side) < STANDARD_HUMAN_PROFILE.foot.halfWidthMeters * 2 + .005) { unsupported = ['crossed-feet', '此段含交叉或过近脚位，保留作者动作。']; break; }
      if (feet.some(foot => { const sole = soleHeight(pose, foot); return sole.minimum < -STANDARD_HUMAN_PROFILE.ground.penetrationToleranceMeters || sole.maximum > STANDARD_HUMAN_PROFILE.ground.contactToleranceMeters || sole.tilt > Math.PI / 18; })) { unsupported = ['airborne-or-uneven-feet', '此段包含腾空或非平地站姿，保留原动作。']; break; }
    }
    if (unsupported) { reject(...unsupported); continue; }
    const pairCount = Math.ceil(Math.max(...feet.map(foot => horizontalDistance(initialWorld[foot].position, finalWorld[foot].position))) / GROUND_STEP_DEFAULTS.maxFootStrideMeters);
    const stepCount = 2 * pairCount, available = endFrame - startFrame - 2 * GROUND_STEP_DEFAULTS.transitionFrames;
    if (!pairCount || available < stepCount * GROUND_STEP_DEFAULTS.minimumSwingSlotFrames) { reject('too-fast', '到达时间不足以完成迈步，请增加时间或缩短位移。'); continue; }
    if (report.stepCount + stepCount > GROUND_STEP_DEFAULTS.maxSteps) { reject('step-budget', '此段超出自动步数范围，保留原动作。'); continue; }
    const leading: LockedFoot = Math.abs(direction.dot(side)) > Math.abs(direction.dot(forward)) && direction.dot(side) < 0 ? 'RightFoot' : 'LeftFoot';
    const order = [leading, leading === 'LeftFoot' ? 'RightFoot' : 'LeftFoot'] as LockedFoot[];
    const slotLength = available / stepCount;
    for (let pair = 0; pair < pairCount; pair++) for (let footIndex = 0; footIndex < 2; footIndex++) {
      const foot = order[footIndex], slotStart = startFrame + GROUND_STEP_DEFAULTS.transitionFrames + (pair * 2 + footIndex) * slotLength;
      segment.steps.push({ foot, startFrame: slotStart + slotLength * .1, endFrame: slotStart + slotLength * .9, from: interpolate(initialWorld[foot].position, finalWorld[foot].position, pair / pairCount), to: interpolate(initialWorld[foot].position, finalWorld[foot].position, (pair + 1) / pairCount) });
    }
    segment.stepCount = stepCount; segment.status = 'supported';
    // Validate actual mature-IK output before enabling this derived interval.
    const isolated: StepPlan = { segments: [segment], report: emptyStepReport() };
    for (const { frame, exactTime } of checkedPoints) {
      const pose = inputPoseAt(frame, exactTime), assisted = applyStepAssistance(pose, isolated, frame), targets = getStepTargets(isolated, frame), world = evaluatePose(assisted);
      if (targets.some(target => !target.swinging && (distance(world[target.foot].position, target.position) > .005 || new Quaternion(...world[target.foot].rotation).angleTo(new Quaternion(...target.rotation)) > Math.PI / 90)) || feet.some(foot => soleHeight(assisted, foot).minimum < -STANDARD_HUMAN_PROFILE.ground.penetrationToleranceMeters) || new Vector3(...world.LeftFoot.position).sub(new Vector3(...world.RightFoot.position)).dot(side) < STANDARD_HUMAN_PROFILE.foot.halfWidthMeters * 2 + .005) { unsupported = ['unreachable-steps', '受限腿部无法完成此段落脚，保留原动作。']; break; }
    }
    if (unsupported) { segment.status = 'skipped'; segment.stepCount = 0; segment.steps = []; reject(...unsupported); continue; }
    report.stepCount += stepCount;
  }
  report.segments = plan.segments.map(({ startFrame, endFrame, status, stepCount }) => ({ startFrame, endFrame, status, stepCount }));
  return plan;
}
