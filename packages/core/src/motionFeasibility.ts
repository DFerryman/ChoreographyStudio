import { Quaternion, Vector3 } from 'three';
import { AVATAR_COLLISION_PROFILE } from './avatarCapsules.generated';
import { getBodyCollisionContacts, getCapsuleCollisions, getPoseColliders, type AvatarCollisionProfile } from './capsuleCollision';
import { createAIMotionSampler, estimateAIMotionBoundary, recomputeAIMotionPatchTangents, validateAIMotionTrack, type AIMotionPatch, type AIMotionPoseSampler } from './aiMotionTrack';
import { clonePose, evaluatePose, RIG_CALIBRATION_VERSION, RIG_DEFINITIONS } from './humanoid';
import { STANDARD_HUMAN_PROFILE } from './humanProfile';
import { JOINT_NAMES, type JointName, type Pose, type Quat, type Vec3 } from './motion-types';
import { loadRapierBackend } from './rapierBackend';

export type MotionSupportEffector = 'LeftFoot' | 'RightFoot' | 'LeftHand' | 'RightHand' | 'LeftLowerLeg' | 'RightLowerLeg' | 'Hips' | 'Chest' | 'Head';
/** These are hypotheses, not exemptions from geometry or dynamics checks. */
export interface MotionContactHint {
  startSeconds: number;
  endSeconds: number;
  mode: 'supported' | 'airborne' | 'unknown';
  effectors?: readonly MotionSupportEffector[];
  /** Planting requires the same world anchor; moving support is not called planted. */
  planted?: boolean;
}
export interface FunctionalJointEnvelope {
  /** LocalY component: limb pronation/twist, or ankle heading about the
   * neutral shin/sole-normal axis. Flexion is a separate measurement. */
  twistDegrees: readonly [number, number];
  flexionDegrees?: readonly [number, number];
  lateralDegrees?: readonly [number, number];
  swingDegrees?: number;
  marker?: boolean;
}
export interface MotionFeasibilityProfile {
  readonly id: string;
  readonly rigId: typeof RIG_CALIBRATION_VERSION;
  readonly bodyProfile: AvatarCollisionProfile;
  readonly envelopes: Readonly<Record<JointName, FunctionalJointEnvelope | null>>;
  readonly calibration: 'canonical-functional-engineering';
  readonly maxRootSpeedMps: number;
  readonly maxJointSpeedRadiansPerSecond: number;
  readonly maxRootAccelerationMps2: number;
  readonly maxJointAccelerationRadiansPerSecondSquared: number;
  readonly massKg: number;
  readonly gravityMps2: number;
  readonly friction: number;
  /** Finite-difference/proxy numerical tolerance, equivalent to 0.75 m/s². */
  readonly groundForceToleranceNewtons: number;
}
const envelope = (twist: readonly [number, number], swing: number): FunctionalJointEnvelope => Object.freeze({ twistDegrees: Object.freeze([...twist]) as readonly [number, number], swingDegrees: swing });
const hinge = (flexion: readonly [number, number], lateral: readonly [number, number], twist: readonly [number, number]): FunctionalJointEnvelope => Object.freeze({ flexionDegrees: Object.freeze([...flexion]) as readonly [number, number], lateralDegrees: Object.freeze([...lateral]) as readonly [number, number], twistDegrees: Object.freeze([...twist]) as readonly [number, number] });
const marker: FunctionalJointEnvelope = Object.freeze({ twistDegrees: Object.freeze([0, 0]) as readonly [number, number], swingDegrees: 0, marker: true });
/**
 * Generation-specific functional frames, not the editor's intrinsic-XYZ table.
 * Canonical children point down local -Y. Both elbows flex about -X, knees +X;
 * forearm pronation is longitudinal Y and may change orientation without bending
 * the elbow sideways. Elbow carry up to 15deg is a separate lateral component.
 * Bounds are conservative engineering assumptions, NOT individual/clinical ROM.
 * Imported CMU retarget carry ~30deg may need offline retargeting; locked source
 * endpoints that disagree are rejected, never "calibrated" by widening limits.
 * Collider fit remains Quaternius-specific. MHR skin is NOT certified by this.
 */
export const CANONICAL_MOTION_FEASIBILITY_PROFILE: MotionFeasibilityProfile = Object.freeze({
  id: 'neutral-rig-2-functional-proxy-1', rigId: RIG_CALIBRATION_VERSION,
  calibration: 'canonical-functional-engineering', bodyProfile: AVATAR_COLLISION_PROFILE,
  envelopes: Object.freeze({
    Hips: null,
    Spine: envelope([-35, 35], 55), Chest: envelope([-40, 40], 55),
    Neck: envelope([-65, 65], 55), Head: envelope([-40, 40], 45),
    LeftShoulder: envelope([-35, 35], 50), RightShoulder: envelope([-35, 35], 50),
    LeftUpperArm: Object.freeze({ ...hinge([-60, 180], [-45, 90], [-100, 100]), swingDegrees: 165 }),
    RightUpperArm: Object.freeze({ ...hinge([-60, 180], [-90, 45], [-100, 100]), swingDegrees: 165 }),
    LeftForeArm: hinge([-5, 155], [-15, 15], [-110, 110]), RightForeArm: hinge([-5, 155], [-15, 15], [-110, 110]),
    // Wrist sideways folding and axial motion are much smaller than flexion;
    // an isotropic85deg cone alone would admit an impossible side fold.
    LeftHand: Object.freeze({ ...hinge([-80, 85], [-40, 40], [-15, 15]), swingDegrees: 85 }),
    RightHand: Object.freeze({ ...hinge([-80, 85], [-40, 40], [-15, 15]), swingDegrees: 85 }),
    LeftHandTip: marker, RightHandTip: marker,
    LeftUpperLeg: hinge([-40, 125], [-30, 65], [-65, 65]), RightUpperLeg: hinge([-40, 125], [-65, 30], [-65, 65]),
    LeftLowerLeg: hinge([-160, 3], [-8, 8], [-25, 25]), RightLowerLeg: hinge([-160, 3], [-8, 8], [-25, 25]),
    // Heel→toe is+Z and sole normal−Y in this rig. X changes plantar/dorsal
    // flexion, Z rolls the sole sideways; a cone must not conflate them.
    LeftFoot: Object.freeze({ ...hinge([-60, 40], [-30, 30], [-30, 30]), swingDegrees: 65 }),
    RightFoot: Object.freeze({ ...hinge([-60, 40], [-30, 30], [-30, 30]), swingDegrees: 65 }),
    LeftToe: marker, RightToe: marker, LeftHeel: marker, RightHeel: marker,
  }),
  maxRootSpeedMps: 8, maxJointSpeedRadiansPerSecond: 16,
  maxRootAccelerationMps2: 65, maxJointAccelerationRadiansPerSecondSquared: 250,
  massKg: STANDARD_HUMAN_PROFILE.massKg, gravityMps2: STANDARD_HUMAN_PROFILE.gravityMps2,
  friction: STANDARD_HUMAN_PROFILE.ground.friction,
  groundForceToleranceNewtons: STANDARD_HUMAN_PROFILE.massKg * .75,
});
export type MotionFeasibilityCode = 'invalid-input' | 'invalid-profile' | 'locked-boundary' | 'joint-limit' | 'self-collision' | 'floor-penetration' | 'contact-mismatch' | 'contact-slide' | 'support-balance' | 'unsupported-flight' | 'ground-force' | 'ground-friction' | 'linear-speed' | 'angular-speed' | 'acceleration' | 'coverage' | 'correction-budget' | 'cancelled' | 'detector-error';
export interface MotionFeasibilityViolation {
  code: MotionFeasibilityCode;
  startSeconds: number;
  endSeconds: number;
  joint?: JointName;
  segments?: string[];
  measured?: number;
  limit?: number;
  message: string;
}
export interface MotionFeasibilityCorrection { time: number; kind: 'joint-projection' | 'ground-alignment' | 'tangent-damping' | 'collision-separation' | 'balance-adjustment'; joint?: JointName; amount: number }
/** Debug receipt at actual knots. It is not an interpolated acceptance gate. */
export interface MotionFeasibilityDiagnostic {
  stage: 'input' | 'joint-projection' | 'ground-alignment' | 'collision-separation' | 'balance-adjustment' | 'regularization' | 'conditioning';
  pass: number;
  samples: number;
  jointLimitCounts: Partial<Record<JointName, number>>;
  maxJointAccelerationRadiansPerSecondSquared: number;
  maxJointAccelerationJoint?: JointName;
  maxJointAccelerationTime?: number;
  groundForceViolations: number;
  groundFrictionViolations: number;
  minNormalForceNewtons: number;
  maxFrictionExcessNewtons: number;
  maxSelfDepthMeters: number;
  maxFloorDepthMeters: number;
}
export interface MotionFeasibilityReport {
  schema: 'motion-feasibility-1';
  status: 'accepted' | 'rejected' | 'cancelled';
  sourceHash: string;
  profileId: string;
  rigId: string;
  bodyProfileId: string;
  physicalParameters: { massKg: number; gravityMps2: number; friction: number; groundForceToleranceNewtons: number };
  target: AIMotionPatch['target'];
  scope: 'adaptive-sampled-kinematic-proxy';
  /** No articulated force/torque, muscle, exact skin or musical-quality claim. */
  articulatedDynamics: false;
  coverage: { complete: boolean; samples: number; maxGapSeconds: number; maxRootStepMeters: number; maxJointStepRadians: number; maxSamples: number };
  /** Additional one-sided near-knot angular derivative stencils. Endpoint
   * poses reuse the geometry mesh; poseSamples counts only new interior poses.
   * Neither finite mesh establishes continuous-time feasibility. */
  derivativeCoverage: { method: 'one-sided-so3-curvature'; complete: boolean; spans: number; stencils: number; poseSamples: number; maxPoseSamples: number; maxStepSeconds: number };
  violations: MotionFeasibilityViolation[];
  totalViolations: number;
  violationCounts: Partial<Record<MotionFeasibilityCode, number>>;
  corrections: MotionFeasibilityCorrection[];
  diagnostics?: MotionFeasibilityDiagnostic[];
  metrics: { maxRootSpeedMps: number; maxJointSpeedRadiansPerSecond: number; maxRootAccelerationMps2: number; maxJointAccelerationRadiansPerSecondSquared: number; maxSelfDepthMeters: number; maxFloorDepthMeters: number; supportedSamples: number; airborneSamples: number; unknownContactSamples: number; maxPoseCorrectionDegrees: number; maxRootCorrectionMeters: number; groundedForceSamples: number; minNormalForceNewtons: number; maxNormalForceNewtons: number; maxHorizontalContactForceNewtons: number; maxFrictionExcessNewtons: number };
  warnings: string[];
  /** Count of samples whose issue was inherited from a fixed endpoint pose. */
  inheritedBoundaryIssues?: number;
}
export interface SolveAIMotionFeasibilityOptions {
  sourceSampler: AIMotionPoseSampler;
  durationSeconds: number;
  signal?: AbortSignal;
  contacts?: readonly MotionContactHint[];
  profile?: MotionFeasibilityProfile;
  maxSamples?: number;
  correct?: boolean;
  /** Optional coupled offline conditioner. Identity, knots and locked anchors
   * remain immutable; the final detector and correction budget are mandatory. */
  conditionCandidate?: (patch: AIMotionPatch, signal?: AbortSignal) => Promise<AIMotionPatch>;
  /** Knot-stage diagnostics are opt-in and never replace adaptive inspection. */
  diagnostics?: boolean;
  /**
   * Fixed endpoints are the user's own motion and cannot be changed. When set,
   * joint-limit, self-contact and floor issues already present in a locked
   * endpoint pose are reported as warnings instead of rejecting the candidate.
   * Within `windowSeconds` of that endpoint, a joint that is already outside
   * its envelope may stay outside while it returns, and self-contact or floor
   * depth is tolerated up to the endpoint's own measured amount. All other
   * joints, all new issues and the rest of the curve stay strict.
   */
  inheritBoundaryIssues?: { windowSeconds: number };
  /** Stop inspecting at the first violation (the report is then a rejection
   * with incomplete coverage). Used when only accept/reject matters. */
  failFast?: boolean;
}
export interface MotionFeasibilityResult { patch?: AIMotionPatch; report: MotionFeasibilityReport }
const RAD = Math.PI / 180, DEG = 180 / Math.PI;
const MAX_GAP = 1 / 60, MAX_ROOT_STEP = .01, MAX_JOINT_STEP = 2 * RAD;
const SELF_TOLERANCE = STANDARD_HUMAN_PROFILE.ground.penetrationToleranceMeters + 2e-8;
const FLOOR_TOLERANCE = STANDARD_HUMAN_PROFILE.ground.penetrationToleranceMeters + 2e-8;
const CONTACT_DISTANCE = STANDARD_HUMAN_PROFILE.ground.contactToleranceMeters;
const MAX_CORRECTION_ANGLE = 20 * RAD, MAX_GROUND_CORRECTION = .06;
const MAX_RECORDED_VIOLATIONS = 120;
const MAX_DERIVATIVE_POSE_SAMPLES = 7208;
const EPS = 1e-7;
const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value));
const distance = (a: readonly number[], b: readonly number[]) => Math.hypot(...a.map((value, axis) => value - b[axis]));
const exactPose = (a: Pose, b: Pose) => a.root.every((value, axis) => value === b.root[axis]) && JOINT_NAMES.every(joint => a.joints[joint].every((value, axis) => value === b.joints[joint][axis]));
// Source derivatives are re-estimated and may differ across JS engines. This
// comparison tolerance does not authorize changing a frozen seam: compilation,
// tangent rebuilds and conditionCandidate retain those stored values exactly.
const sameVector = (a: readonly number[], b: readonly number[]) => a.every((value, axis) => Math.abs(value - b[axis]) <= 1e-5);
// Normalized relative SO(3) logs retain precision near zero. acos(raw dot)
// creates false motion even for identical Float32-rounded saved quaternions.
const angleBetween = (a: Quat, b: Quat) => Math.hypot(...logRotation(a, b));
const abort = (signal?: AbortSignal) => { if (signal?.aborted) throw new Error('motion-feasibility-cancelled'); };
const yieldTask = () => new Promise<void>(resolve => setTimeout(resolve, 0));

function normalized(rotation: Quat): Quaternion {
  if (!Array.isArray(rotation) || rotation.length !== 4 || !rotation.every(Number.isFinite) || Math.abs(Math.hypot(...rotation) - 1) > 1e-4) throw new Error('人体旋转必须是单位四元数。');
  return new Quaternion(...rotation).normalize();
}
export interface FunctionalJointMeasurement { twistDegrees: number; flexionDegrees: number; lateralDegrees: number; swingDegrees: number; errorDegrees: number }
/** Rotation-invariant measurements: q and -q have the same result. */
export function measureFunctionalJoint(joint: JointName, rotation: Quat, profile = CANONICAL_MOTION_FEASIBILITY_PROFILE): FunctionalJointMeasurement {
  const q = normalized(rotation), direction = new Vector3(0, -1, 0).applyQuaternion(q);
  const settings = profile.envelopes[joint];
  let twist = 2 * Math.atan2(q.y, q.w) * DEG;
  twist = ((twist + 180) % 360 + 360) % 360 - 180;
  const flexion = Math.atan2(direction.z, -direction.y) * DEG;
  const lateral = Math.atan2(direction.x, Math.hypot(direction.y, direction.z)) * DEG;
  const swing = Math.acos(clamp(-direction.y, -1, 1)) * DEG;
  const excess = (value: number, bounds: readonly [number, number]) => Math.max(0, bounds[0] - value, value - bounds[1]);
  const error = settings ? Math.max(excess(twist, settings.twistDegrees), settings.flexionDegrees ? excess(flexion, settings.flexionDegrees) : 0, settings.lateralDegrees ? excess(lateral, settings.lateralDegrees) : 0, settings.swingDegrees === undefined ? 0 : Math.max(0, swing - settings.swingDegrees), settings.marker ? q.angleTo(new Quaternion()) * DEG : 0) : 0;
  return { twistDegrees: twist, flexionDegrees: flexion, lateralDegrees: lateral, swingDegrees: swing, errorDegrees: error };
}
export function isFunctionalJointWithinLimits(joint: JointName, rotation: Quat, profile = CANONICAL_MOTION_FEASIBILITY_PROFILE): boolean { return measureFunctionalJoint(joint, rotation, profile).errorDegrees <= 1e-5; }
/** Nearest rotation inside the functional envelope (identity when already inside). */
export function projectFunctionalJoint(joint: JointName, rotation: Quat, profile: MotionFeasibilityProfile = CANONICAL_MOTION_FEASIBILITY_PROFILE): Quat { return projectJoint(joint, rotation, profile); }
function projectJoint(joint: JointName, rotation: Quat, profile: MotionFeasibilityProfile): Quat {
  const settings = profile.envelopes[joint], measurement = measureFunctionalJoint(joint, rotation, profile);
  if (!settings || measurement.errorDegrees <= 1e-5) return [...rotation];
  if (settings.marker) return [0, 0, 0, 1];
  const q = normalized(rotation), down = new Vector3(0, -1, 0);
  let direction = down.clone().applyQuaternion(q);
  if (settings.flexionDegrees && settings.lateralDegrees) {
    const flexion = clamp(measurement.flexionDegrees, ...settings.flexionDegrees) * RAD;
    const lateral = clamp(measurement.lateralDegrees, ...settings.lateralDegrees) * RAD;
    direction = new Vector3(Math.sin(lateral), -Math.cos(flexion) * Math.cos(lateral), Math.sin(flexion) * Math.cos(lateral));
  }
  const projectedSwingDegrees = Math.acos(clamp(-direction.y, -1, 1)) * DEG;
  if (settings.swingDegrees !== undefined && projectedSwingDegrees > settings.swingDegrees) {
    const swing = new Quaternion().setFromUnitVectors(down, direction);
    swing.slerp(new Quaternion(), 1 - settings.swingDegrees / projectedSwingDegrees);
    direction = down.clone().applyQuaternion(swing);
  }
  const swing = new Quaternion().setFromUnitVectors(down, direction);
  const twist = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), clamp(measurement.twistDegrees, ...settings.twistDegrees) * RAD);
  const result = swing.multiply(twist).normalize().toArray() as Quat;
  // Quaternion twist at the antipodal singularity may remain outside the limits.
  // A failed projection is not usable merely because the numeric plan was legal.
  return isFunctionalJointWithinLimits(joint, result, profile) ? result : [...rotation];
}

function validateProfile(profile: MotionFeasibilityProfile): void {
  if (profile.rigId !== RIG_CALIBRATION_VERSION || !profile.id || profile.calibration !== 'canonical-functional-engineering' || !profile.bodyProfile?.colliders?.length || ![profile.maxRootSpeedMps, profile.maxJointSpeedRadiansPerSecond, profile.maxRootAccelerationMps2, profile.maxJointAccelerationRadiansPerSecondSquared, profile.massKg, profile.gravityMps2, profile.friction, profile.groundForceToleranceNewtons].every(value => Number.isFinite(value) && value > 0)) throw new Error('人体求解配置或骨架版本无效。');
  for (const joint of JOINT_NAMES) {
    const settings = profile.envelopes?.[joint];
    if (settings === undefined) throw new Error('人体求解配置缺少关节。');
    if (!settings) continue;
    for (const range of [settings.twistDegrees, settings.flexionDegrees, settings.lateralDegrees]) if (range && (range.length !== 2 || !range.every(Number.isFinite) || range[0] > range[1] || range[0] < -180 || range[1] > 180)) throw new Error('人体关节范围无效。');
    if (!settings.twistDegrees || settings.swingDegrees !== undefined && (!Number.isFinite(settings.swingDegrees) || settings.swingDegrees < 0 || settings.swingDegrees > 180)) throw new Error('人体关节范围无效。');
  }
}
function emptyReport(patch: AIMotionPatch, profile: MotionFeasibilityProfile, maxSamples: number): MotionFeasibilityReport {
  return { schema: 'motion-feasibility-1', status: 'rejected', sourceHash: patch?.sourceHash ?? '', profileId: profile?.id ?? '', rigId: profile?.rigId ?? '', bodyProfileId: profile?.bodyProfile?.id ?? '', physicalParameters: { massKg: profile?.massKg ?? 0, gravityMps2: profile?.gravityMps2 ?? 0, friction: profile?.friction ?? 0, groundForceToleranceNewtons: profile?.groundForceToleranceNewtons ?? 0 }, target: patch?.target ? { ...patch.target } : { mode: 'full', startSeconds: 0, endSeconds: 0 }, scope: 'adaptive-sampled-kinematic-proxy', articulatedDynamics: false, coverage: { complete: false, samples: 0, maxGapSeconds: 0, maxRootStepMeters: 0, maxJointStepRadians: 0, maxSamples }, derivativeCoverage: { method: 'one-sided-so3-curvature', complete: false, spans: 0, stencils: 0, poseSamples: 0, maxPoseSamples: MAX_DERIVATIVE_POSE_SAMPLES, maxStepSeconds: 0 }, violations: [], totalViolations: 0, violationCounts: {}, corrections: [], metrics: { maxRootSpeedMps: 0, maxJointSpeedRadiansPerSecond: 0, maxRootAccelerationMps2: 0, maxJointAccelerationRadiansPerSecondSquared: 0, maxSelfDepthMeters: 0, maxFloorDepthMeters: 0, supportedSamples: 0, airborneSamples: 0, unknownContactSamples: 0, maxPoseCorrectionDegrees: 0, maxRootCorrectionMeters: 0, groundedForceSamples: 0, minNormalForceNewtons: 0, maxNormalForceNewtons: 0, maxHorizontalContactForceNewtons: 0, maxFrictionExcessNewtons: 0 }, warnings: ['检测为有限自适应几何采样、单侧近端点角曲率采样、骨架功能包络与 Quaternius 身体代理及汇总接触力检查；不证明连续时间、MHR 皮肤、人体力量或完整关节动力学。'] };
}
function addViolation(report: MotionFeasibilityReport, violation: MotionFeasibilityViolation): void {
  report.totalViolations++; report.violationCounts[violation.code] = (report.violationCounts[violation.code] ?? 0) + 1;
  if (report.violations.length < MAX_RECORDED_VIOLATIONS) { report.violations.push(violation); return; }
  const severity = (issue: MotionFeasibilityViolation) => Math.abs(issue.measured ?? 0) / Math.max(1e-8, Math.abs(issue.limit ?? 1));
  const matching = report.violations.flatMap((issue, index) => issue.code === violation.code ? [index] : []);
  if (matching.length) {
    const weakest = matching.reduce((a, b) => severity(report.violations[a]) < severity(report.violations[b]) ? a : b);
    if (severity(violation) > severity(report.violations[weakest])) report.violations[weakest] = violation;
    return;
  }
  // Keep at least one example of every category, including late immutable,
  // force, coverage or detector failures. A long early collision run must not
  // hide all later failure kinds from the reviewer of the bounded report.
  const counts = new Map<MotionFeasibilityCode, number>();
  for (const issue of report.violations) counts.set(issue.code, (counts.get(issue.code) ?? 0) + 1);
  let replace = -1;
  for (let index = report.violations.length - 1; index >= 0; index--) if (counts.get(report.violations[index].code)! > 1) { replace = index; break; }
  if (replace >= 0) report.violations[replace] = violation;
}
function locked(patch: AIMotionPatch, index: number): boolean { return index === 0 || patch.target.mode === 'interval' && index === patch.knots.length - 1; }
function checkBoundaries(patch: AIMotionPatch, options: SolveAIMotionFeasibilityOptions, report: MotionFeasibilityReport): void {
  for (const [index, knot] of patch.knots.entries()) {
    if (!locked(patch, index)) continue;
    const boundary = estimateAIMotionBoundary(options.sourceSampler, knot.time, index === 0 ? 'before' : 'after', options.durationSeconds);
    if (!exactPose(knot.pose, boundary.pose) || patch.target.mode === 'interval' && (!sameVector(knot.linearVelocity, boundary.linearVelocity) || JOINT_NAMES.some(joint => !sameVector(knot.angularVelocity[joint], boundary.angularVelocity[joint])))) addViolation(report, { code: 'locked-boundary', startSeconds: knot.time, endSeconds: knot.time, message: '只读区间端点或速度与原动作不一致，请重新生成。' });
  }
}
function logRotation(a: Quat, b: Quat): Vec3 {
  const q = normalized(a).invert().multiply(normalized(b));
  if (q.w < 0) q.set(-q.x, -q.y, -q.z, -q.w);
  const sine = Math.hypot(q.x, q.y, q.z), scale = sine < 1e-12 ? 2 : 2 * Math.atan2(sine, q.w) / sine;
  return [q.x * scale, q.y * scale, q.z * scale];
}
function expRotation(vector: Vec3): Quat {
  const angle = Math.hypot(...vector), amount = angle < 1e-10 ? .5 : Math.sin(angle / 2) / angle;
  return [vector[0] * amount, vector[1] * amount, vector[2] * amount, Math.cos(angle / 2)];
}
function clonePatch(patch: AIMotionPatch): AIMotionPatch {
  return { ...patch, ...(patch.motionOrigin ? { motionOrigin: structuredClone(patch.motionOrigin) } : {}), target: { ...patch.target }, knots: patch.knots.map(knot => ({ time: knot.time, pose: clonePose(knot.pose), linearVelocity: [...knot.linearVelocity], angularVelocity: Object.fromEntries(JOINT_NAMES.map(joint => [joint, [...knot.angularVelocity[joint]]])) as Record<JointName, Vec3> })) };
}
function validateConditionedCandidate(before: AIMotionPatch, after: AIMotionPatch, durationSeconds: number): void {
  validateAIMotionTrack({ schema: 'ai-motion-track-1', countMapId: 'feasibility', durationSeconds, patches: [after] }, { id: 'feasibility', durationSeconds });
  if (JSON.stringify({ ...before, knots: [] }) !== JSON.stringify({ ...after, knots: [] }) || before.knots.length !== after.knots.length) throw new Error('动作条件化修改了只读身份或时间范围。');
  for (const [index, knot] of before.knots.entries()) {
    const candidate = after.knots[index];
    if (candidate.time !== knot.time || locked(before, index) && (!exactPose(knot.pose, candidate.pose) || knot.linearVelocity.some((value, axis) => value !== candidate.linearVelocity[axis]) || JOINT_NAMES.some(joint => knot.angularVelocity[joint].some((value, axis) => value !== candidate.angularVelocity[joint][axis])))) throw new Error('动作条件化修改了只读端点或采样时间。');
  }
}
async function diagnoseKnots(patch: AIMotionPatch, profile: MotionFeasibilityProfile, signal: AbortSignal | undefined, stage: MotionFeasibilityDiagnostic['stage'], pass: number, diagnostics: MotionFeasibilityDiagnostic[]): Promise<void> {
  const receipt: MotionFeasibilityDiagnostic = { stage, pass, samples: patch.knots.length, jointLimitCounts: {}, maxJointAccelerationRadiansPerSecondSquared: 0, groundForceViolations: 0, groundFrictionViolations: 0, minNormalForceNewtons: Infinity, maxFrictionExcessNewtons: 0, maxSelfDepthMeters: 0, maxFloorDepthMeters: 0 };
  const com: Vec3[] = [], supported: boolean[] = [];
  for (const [index, knot] of patch.knots.entries()) {
    abort(signal); if (index && index % 64 === 0) { await yieldTask(); abort(signal); }
    com.push(centerOfMass(knot.pose)); supported.push(supportPoints(knot.pose, profile.bodyProfile).points.length > 0);
    for (const joint of JOINT_NAMES) if (!isFunctionalJointWithinLimits(joint, knot.pose.joints[joint], profile)) receipt.jointLimitCounts[joint] = (receipt.jointLimitCounts[joint] ?? 0) + 1;
    const contacts = getBodyCollisionContacts(knot.pose, profile.bodyProfile);
    receipt.maxSelfDepthMeters = Math.max(receipt.maxSelfDepthMeters, ...contacts.selfContacts.map(contact => contact.depthMeters));
    receipt.maxFloorDepthMeters = Math.max(receipt.maxFloorDepthMeters, -getMotionMinimumFloorHeight(knot.pose, profile.bodyProfile));
    if (index < 2) continue;
    const previous = patch.knots[index - 1], older = patch.knots[index - 2], dt = knot.time - previous.time, before = previous.time - older.time, middleDt = (dt + before) / 2;
    for (const joint of JOINT_NAMES) {
      const velocity = new Vector3(...logRotation(previous.pose.joints[joint], knot.pose.joints[joint])).applyQuaternion(new Quaternion(...previous.pose.joints[joint])).divideScalar(dt);
      const prior = new Vector3(...logRotation(older.pose.joints[joint], previous.pose.joints[joint])).applyQuaternion(new Quaternion(...older.pose.joints[joint])).divideScalar(before);
      const acceleration = velocity.distanceTo(prior) / middleDt;
      if (acceleration > receipt.maxJointAccelerationRadiansPerSecondSquared) { receipt.maxJointAccelerationRadiansPerSecondSquared = acceleration; receipt.maxJointAccelerationJoint = joint; receipt.maxJointAccelerationTime = previous.time; }
    }
    if (!supported[index] || !supported[index - 1] || !supported[index - 2]) continue;
    const acceleration = com[index].map((value, axis) => ((value - com[index - 1][axis]) / dt - (com[index - 1][axis] - com[index - 2][axis]) / before) / middleDt);
    const normal = profile.massKg * (profile.gravityMps2 + acceleration[1]), horizontal = profile.massKg * Math.hypot(acceleration[0], acceleration[2]), excess = horizontal - profile.friction * Math.max(0, normal);
    receipt.minNormalForceNewtons = Math.min(receipt.minNormalForceNewtons, normal); receipt.maxFrictionExcessNewtons = Math.max(receipt.maxFrictionExcessNewtons, excess);
    if (normal < -profile.groundForceToleranceNewtons) receipt.groundForceViolations++;
    if (excess > profile.groundForceToleranceNewtons) receipt.groundFrictionViolations++;
  }
  if (!Number.isFinite(receipt.minNormalForceNewtons)) receipt.minNormalForceNewtons = 0;
  diagnostics.push(receipt);
}
/** Filter only the derived correction field, retaining recorded movement itself.
 * Locked anchors have a zero field and are not touched. This is an offline
 * regularizer; every resulting curve must pass the complete detector again. */
async function regularizeCorrections(reference: AIMotionPatch, repaired: AIMotionPatch, signal?: AbortSignal): Promise<AIMotionPatch> {
  // Sparse curves already distribute a correction over long Hermite spans;
  // averaging their few control poses would attenuate a necessary floor lift.
  if (repaired.knots.length < 7) return recomputeAIMotionPatchTangents(repaired);
  const updated: AIMotionPatch = { ...repaired, knots: repaired.knots.map(knot => ({ ...knot, pose: clonePose(knot.pose), linearVelocity: [...knot.linearVelocity], angularVelocity: { ...knot.angularVelocity } })) };
  const fields = repaired.knots.map((knot, index) => ({
    root: knot.pose.root.map((value, axis) => value - reference.knots[index].pose.root[axis]) as Vec3,
    // Parent-coordinate correction vectors are comparable across a turning
    // source limb; child-frame logarithms cannot be averaged without transport.
    joints: Object.fromEntries(JOINT_NAMES.map(joint => [joint, new Vector3(...logRotation(reference.knots[index].pose.joints[joint], knot.pose.joints[joint])).applyQuaternion(normalized(reference.knots[index].pose.joints[joint])).toArray() as Vec3])) as Record<JointName, Vec3>,
  }));
  const sigma = .075, radius = .3, boundaryFade = .15;
  const smootherStep = (value: number) => { const u = clamp(value, 0, 1); return u * u * u * (10 + u * (-15 + 6 * u)); };
  for (const [index, knot] of updated.knots.entries()) {
    abort(signal); if (index && index % 32 === 0) { await yieldTask(); abort(signal); }
    if (locked(updated, index)) continue;
    const neighbors: { index: number; weight: number }[] = [];
    for (let neighbor = index; neighbor >= 0 && knot.time - repaired.knots[neighbor].time < radius; neighbor--) neighbors.push({ index: neighbor, weight: 0 });
    for (let neighbor = index + 1; neighbor < repaired.knots.length && repaired.knots[neighbor].time - knot.time < radius; neighbor++) neighbors.push({ index: neighbor, weight: 0 });
    let total = 0;
    for (const neighbor of neighbors) {
      const time = repaired.knots[neighbor.index].time, delta = time - knot.time;
      const previous = repaired.knots[Math.max(0, neighbor.index - 1)].time, next = repaired.knots[Math.min(repaired.knots.length - 1, neighbor.index + 1)].time;
      neighbor.weight = Math.exp(-.5 * Math.pow(delta / sigma, 2)) * Math.pow(1 - Math.pow(delta / radius, 2), 3) * (next - previous);
      total += neighbor.weight;
    }
    let fade = smootherStep((knot.time - repaired.target.startSeconds) / boundaryFade);
    if (repaired.target.mode === 'interval') fade *= smootherStep((repaired.target.endSeconds - knot.time) / boundaryFade);
    const correction: Vec3 = [0, 0, 0];
    for (const neighbor of neighbors) for (let axis = 0; axis < 3; axis++) correction[axis] += fields[neighbor.index].root[axis] * neighbor.weight / total * fade;
    knot.pose.root = reference.knots[index].pose.root.map((value, axis) => value + correction[axis]) as Vec3;
    for (const joint of JOINT_NAMES) {
      const field: Vec3 = [0, 0, 0];
      for (const neighbor of neighbors) for (let axis = 0; axis < 3; axis++) field[axis] += fields[neighbor.index].joints[joint][axis] * neighbor.weight / total * fade;
      const bodyField = new Vector3(...field).applyQuaternion(normalized(reference.knots[index].pose.joints[joint]).invert()).toArray() as Vec3;
      knot.pose.joints[joint] = normalized(reference.knots[index].pose.joints[joint]).multiply(new Quaternion(...expRotation(bodyField))).normalize().toArray() as Quat;
    }
  }
  return recomputeAIMotionPatchTangents(updated);
}
function inverseJacobian(rotation: Vec3, velocity: Vec3): Vec3 {
  const r = new Vector3(...rotation), v = new Vector3(...velocity), angle = r.length();
  const coefficient = angle < 1e-4 ? 1 / 12 + angle * angle / 720 : 1 / (angle * angle) - 1 / (2 * angle * Math.tan(angle / 2));
  const first = r.clone().cross(v);
  return v.addScaledVector(first, .5).addScaledVector(r.clone().cross(first), coefficient).toArray() as Vec3;
}
/** Exact component extrema of cubic-Hermite derivatives, conservative vector norm. */
function hermiteVelocityBound(a: Vec3, b: Vec3, va: Vec3, vb: Vec3, dt: number): number {
  const components = a.map((value, axis) => {
    const A = 6 * (value - b[axis]) / dt + 3 * (va[axis] + vb[axis]);
    const B = 6 * (b[axis] - value) / dt - 4 * va[axis] - 2 * vb[axis];
    const C = va[axis];
    const times = [0, 1], critical = A ? -B / (2 * A) : -1;
    if (critical > 0 && critical < 1) times.push(critical);
    return Math.max(...times.map(u => Math.abs(A * u * u + B * u + C)));
  });
  return Math.hypot(...components);
}
/** Shared detector mesh for offline conditioners: exact knots, quarter points
 * and bounded Root/rotation steps. Throws when coverage cannot be represented
 * or fit in the finite budget; callers must not substitute a partial grid. */
export function getMotionFeasibilitySampleTimes(patch: AIMotionPatch, maxSamples = 12000): number[] {
  const times = [patch.knots[0].time];
  for (let index = 1; index < patch.knots.length; index++) {
    const previous = patch.knots[index - 1], next = patch.knots[index], dt = next.time - previous.time;
    const linearBound = hermiteVelocityBound(previous.pose.root, next.pose.root, previous.linearVelocity, next.linearVelocity, dt);
    let angularBound = 0;
    for (const joint of JOINT_NAMES) {
      const rotation = logRotation(previous.pose.joints[joint], next.pose.joints[joint]);
      angularBound = Math.max(angularBound, hermiteVelocityBound([0, 0, 0], rotation, previous.angularVelocity[joint], inverseJacobian(rotation, next.angularVelocity[joint]), dt));
    }
    // Quarter points avoid aliasing symmetric Hermite velocity/acceleration
    // ripples that appear identical at both ends and the midpoint.
    const steps = Math.max(4, Math.ceil(dt / MAX_GAP), Math.ceil(linearBound * dt / MAX_ROOT_STEP), Math.ceil(angularBound * dt / MAX_JOINT_STEP));
    if (!Number.isFinite(steps) || times.length + steps > maxSamples) throw new Error('motion-feasibility-coverage');
    // Every interval midpoint and both exact knots are included, even sub-frame spans.
    const evenSteps = steps % 2 ? steps + 1 : steps;
    if (times.length + evenSteps > maxSamples) throw new Error('motion-feasibility-coverage');
    for (let step = 1; step <= evenSteps; step++) {
      const time = step === evenSteps ? next.time : previous.time + dt * step / evenSteps;
      if (!Number.isFinite(time) || !(time > times[times.length - 1])) throw new Error('motion-feasibility-coverage');
      times.push(time);
    }
  }
  return times;
}
function worldPoint(pose: ReturnType<typeof evaluatePose>, joint: JointName, offset: readonly number[]): Vec3 { return new Vector3(...offset as Vec3).applyQuaternion(new Quaternion(...pose[joint].rotation)).add(new Vector3(...pose[joint].position)).toArray() as Vec3; }
export function computeMotionCenterOfMass(pose: Pose): Vec3 {
  const fk = evaluatePose(pose), center = new Vector3();
  for (const segment of STANDARD_HUMAN_PROFILE.segments) center.addScaledVector(new Vector3(...worldPoint(fk, segment.proximal, segment.proximalOffset)).lerp(new Vector3(...worldPoint(fk, segment.distal, segment.distalOffset)), segment.centerFraction), segment.massFraction);
  return center.toArray() as Vec3;
}
function colliderBottomVertices(collider: ReturnType<typeof getPoseColliders>[number]): Vec3[] {
  if (collider.shape === 'capsule') return [collider.proximal, collider.distal].map(point => [point[0], point[1] - collider.radiusMeters, point[2]]);
  const rotation = new Quaternion(...collider.rotation);
  if (collider.shape === 'box') return [-1, 1].flatMap(x => [-1, 1].flatMap(y => [-1, 1].map(z => new Vector3(x * collider.halfExtents[0], y * collider.halfExtents[1], z * collider.halfExtents[2]).applyQuaternion(rotation).add(new Vector3(...collider.center)).toArray() as Vec3)));
  const position = new Vector3(...collider.position);
  return collider.definition.vertices.map(vertex => new Vector3(...vertex).applyQuaternion(rotation).add(position).toArray() as Vec3);
}
/** Generation floor geometry retains both the legacy sole and the original
 * calibrated Foot hull. Native rigid toe vertices extend beyond that sole box;
 * dropping the hull misses real tilted-toe skin penetration. This does not
 * alter legacy playback geometry, body fitting or its 82mm sole contract. */
function motionFloorDepths(pose: Pose, body: AvatarCollisionProfile): { segmentId: string; depthMeters: number }[] {
  const colliders = getPoseColliders(pose, body), depths = new Map<string, number>();
  for (const collider of colliders) depths.set(collider.id, -Math.min(...colliderBottomVertices(collider).map(vertex => vertex[1])));
  if (body.footGround) {
    const fk = evaluatePose(pose), ground = body.footGround;
    for (const foot of ['LeftFoot', 'RightFoot'] as const) {
      const id = colliders.find(collider => collider.definition.family === 'foot' && collider.definition.proximal === foot)?.id ?? foot;
      const heights: number[] = [];
      for (const x of [-ground.halfWidthMeters, ground.halfWidthMeters]) for (const z of [ground.heelZ, ground.toeZ]) for (const y of [-ground.soleOffsetMeters, ground.topOffsetMeters ?? -.004]) heights.push(worldPoint(fk, foot, [x, y, z])[1]);
      depths.set(id, Math.max(depths.get(id) ?? -Infinity, -Math.min(...heights)));
    }
  }
  return [...depths].map(([segmentId, depthMeters]) => ({ segmentId, depthMeters }));
}
/** Shared generation-only lower envelope, including source Foot convex hulls
 * and legacy sole corners. No Rapier World or source mutation is required. */
export function getMotionMinimumFloorHeight(pose: Pose, body: AvatarCollisionProfile = AVATAR_COLLISION_PROFILE): number {
  return -Math.max(...motionFloorDepths(pose, body).map(contact => contact.depthMeters));
}
/** Same floor oracle restricted to one calibrated Foot. This is an offline
 * conditioning target, not an exemption from the whole-trajectory detector. */
export function getMotionFootMinimumFloorHeight(pose: Pose, foot: 'LeftFoot' | 'RightFoot', body: AvatarCollisionProfile = AVATAR_COLLISION_PROFILE): number {
  if (foot !== 'LeftFoot' && foot !== 'RightFoot') throw new Error('脚部地面查询需要有效的脚名称。');
  const ids = new Set(body.colliders.filter(collider => collider.family === 'foot' && collider.proximal === foot).map(collider => collider.id));
  ids.add(foot);
  const contacts = motionFloorDepths(pose, body).filter(contact => ids.has(contact.segmentId));
  if (!contacts.length) throw new Error('脚部地面查询缺少已校准的脚部几何。');
  return -Math.max(...contacts.map(contact => contact.depthMeters));
}
export function inferMotionSupportGeometry(pose: Pose, body: AvatarCollisionProfile = AVATAR_COLLISION_PROFILE): { points: Vec3[]; effectors: Set<MotionSupportEffector> } {
  const fk = evaluatePose(pose), points: Vec3[] = [], effectors = new Set<MotionSupportEffector>();
  const record = (joint: JointName, point: Vec3) => {
    if (point[1] > CONTACT_DISTANCE || point[1] < -FLOOR_TOLERANCE) return;
    points.push(point);
    if (['LeftFoot', 'RightFoot', 'LeftHand', 'RightHand', 'LeftLowerLeg', 'RightLowerLeg', 'Hips', 'Chest', 'Head'].includes(joint)) effectors.add(joint as MotionSupportEffector);
  };
  for (const collider of getPoseColliders(pose, body)) {
    const vertices = colliderBottomVertices(collider);
    for (const vertex of vertices) record(collider.definition.proximal, vertex);
    // Distal capsule contacts belong to the end effector, e.g. palms/knees.
    if (collider.shape === 'capsule') record(collider.definition.distal, vertices[1]);
  }
  if (body.footGround) for (const foot of ['LeftFoot', 'RightFoot'] as const) {
    const ground = body.footGround;
    for (const x of [-ground.halfWidthMeters, ground.halfWidthMeters]) for (const z of [ground.heelZ, ground.toeZ]) for (const y of [-ground.soleOffsetMeters, ground.topOffsetMeters ?? -.004]) record(foot, worldPoint(fk, foot, [x, y, z]));
  }
  return { points, effectors };
}
const centerOfMass = computeMotionCenterOfMass;
const supportPoints = inferMotionSupportGeometry;
function hull(points: Vec3[]): Vec3[] {
  const sorted = [...points].sort((a, b) => a[0] - b[0] || a[2] - b[2]);
  const cross = (o: Vec3, a: Vec3, b: Vec3) => (a[0] - o[0]) * (b[2] - o[2]) - (a[2] - o[2]) * (b[0] - o[0]);
  const half = (values: Vec3[]) => { const result: Vec3[] = []; for (const point of values) { while (result.length >= 2 && cross(result[result.length - 2], result[result.length - 1], point) <= 0) result.pop(); result.push(point); } return result; };
  const lower = half(sorted), upper = half(sorted.reverse()); lower.pop(); upper.pop(); return [...lower, ...upper];
}
function supportDistance(point: Vec3, points: Vec3[]): number {
  const polygon = hull(points);
  if (!polygon.length) return Infinity;
  if (polygon.length === 1) return Math.hypot(point[0] - polygon[0][0], point[2] - polygon[0][2]);
  let minimum = Infinity, inside = polygon.length >= 3;
  for (let index = 0; index < polygon.length; index++) {
    const a = polygon[index], b = polygon[(index + 1) % polygon.length];
    const dx = b[0] - a[0], dz = b[2] - a[2], length = dx * dx + dz * dz;
    const u = length ? clamp(((point[0] - a[0]) * dx + (point[2] - a[2]) * dz) / length, 0, 1) : 0;
    minimum = Math.min(minimum, Math.hypot(point[0] - a[0] - u * dx, point[2] - a[2] - u * dz));
    if (dx * (point[2] - a[2]) - dz * (point[0] - a[0]) < -EPS) inside = false;
  }
  return inside ? 0 : minimum;
}
function validContacts(hints: readonly MotionContactHint[], patch: AIMotionPatch): boolean {
  const names = new Set<MotionSupportEffector>(['LeftFoot', 'RightFoot', 'LeftHand', 'RightHand', 'LeftLowerLeg', 'RightLowerLeg', 'Hips', 'Chest', 'Head']);
  return hints.length <= 128 && hints.every(hint => Number.isFinite(hint.startSeconds) && Number.isFinite(hint.endSeconds) && hint.startSeconds >= patch.target.startSeconds && hint.endSeconds <= patch.target.endSeconds && hint.startSeconds < hint.endSeconds && ['supported', 'airborne', 'unknown'].includes(hint.mode) && (hint.effectors === undefined || hint.effectors.length <= 9 && hint.effectors.every(name => names.has(name))) && (hint.planted === undefined || typeof hint.planted === 'boolean') && !(hint.planted && (hint.mode !== 'supported' || !hint.effectors?.length)));
}
type Limb = { upper: JointName; lower: JointName; effector: MotionSupportEffector };
function limbForSegment(segmentId: string, body: AvatarCollisionProfile): Limb | undefined {
  const definition = body.colliders.find(collider => collider.id === segmentId);
  if (!definition || !['arm', 'leg', 'foot'].includes(definition.family)) return;
  const side = definition.proximal.startsWith('Left') ? 'Left' : definition.proximal.startsWith('Right') ? 'Right' : undefined;
  if (!side) return;
  const arm = definition.family === 'arm';
  return { upper: `${side}${arm ? 'UpperArm' : 'UpperLeg'}` as JointName, lower: `${side}${arm ? 'ForeArm' : 'LowerLeg'}` as JointName, effector: `${side}${arm ? 'Hand' : 'Foot'}` };
}
/** Bounded, functional-profile CCD; the editing-ROM IK adapter is intentionally
 * not reused because it prohibits normal forearm longitudinal pronation. */
function solveFunctionalLimbIK(input: Pose, limb: Limb, target: Vec3, profile: MotionFeasibilityProfile): Pose {
  const result = clonePose(input), goal = new Vector3(...target);
  let best = clonePose(input), residual = distance(evaluatePose(input)[limb.effector].position, target);
  for (let iteration = 0; iteration < 6; iteration++) {
    for (const joint of [limb.lower, limb.upper]) {
      const fk = evaluatePose(result), origin = new Vector3(...fk[joint].position);
      const a = new Vector3(...fk[limb.effector].position).sub(origin), b = goal.clone().sub(origin);
      if (a.lengthSq() < 1e-10 || b.lengthSq() < 1e-10) continue;
      const delta = new Quaternion().setFromUnitVectors(a.normalize(), b.normalize());
      const angle = delta.angleTo(new Quaternion());
      if (angle > 3 * RAD) delta.slerp(new Quaternion(), 1 - 3 * RAD / angle);
      const parent = RIG_DEFINITIONS.find(definition => definition.name === joint)!.parent!;
      const parentWorld = new Quaternion(...fk[parent].rotation);
      const localDelta = parentWorld.clone().invert().multiply(delta).multiply(parentWorld);
      const proposed = localDelta.multiply(new Quaternion(...result.joints[joint])).normalize().toArray() as Quat;
      result.joints[joint] = projectJoint(joint, proposed, profile);
    }
    const nextResidual = distance(evaluatePose(result)[limb.effector].position, target);
    if (nextResidual < residual) { residual = nextResidual; best = clonePose(result); }
    if (residual < .002) break;
  }
  return best;
}
function collisionCost(pose: Pose, profile: MotionFeasibilityProfile): number {
  const collisions = getCapsuleCollisions(pose, profile.bodyProfile);
  return collisions.selfCollisions.reduce((sum, collision) => sum + Math.max(0, collision.depthMeters - SELF_TOLERANCE) ** 2, 0)
    + motionFloorDepths(pose, profile.bodyProfile).reduce((sum, collision) => sum + Math.max(0, collision.depthMeters - FLOOR_TOLERANCE) ** 2 * 2, 0);
}
function separateSmallCollisions(input: Pose, profile: MotionFeasibilityProfile): { pose: Pose; changed: boolean; amount: number } {
  let result = clonePose(input), cost = collisionCost(result, profile), changed = false;
  for (let iteration = 0; iteration < 8 && cost > 1e-12; iteration++) {
    const geometry = getBodyCollisionContacts(result, profile.bodyProfile);
    const contact = [...geometry.selfContacts].sort((a, b) => b.depthMeters - a.depthMeters)[0];
    if (!contact) break;
    // Prefer freeing an arm from the trunk/leg; feet keep their floor role.
    const limbs = contact.segments.map(segment => limbForSegment(segment, profile.bodyProfile));
    const selected = limbs.findIndex(limb => limb?.effector.endsWith('Hand'));
    const index = selected >= 0 ? selected : limbs.findIndex(Boolean), limb = limbs[index];
    if (!limb) break;
    const fk = evaluatePose(result), witness = contact.points[index], proximal = fk[limb.upper].position;
    const leverage = Math.max(.07, distance(witness, proximal));
    const offset = new Vector3(...contact.normal).multiplyScalar((index === 0 ? -1 : 1) * Math.min(.04, (contact.depthMeters + .004) * distance(fk[limb.effector].position, proximal) / leverage));
    const target = new Vector3(...fk[limb.effector].position).add(offset).toArray() as Vec3;
    const proposed = solveFunctionalLimbIK(result, limb, target, profile);
    if ([limb.upper, limb.lower].some(joint => angleBetween(input.joints[joint], proposed.joints[joint]) > MAX_CORRECTION_ANGLE)) break;
    const nextCost = collisionCost(proposed, profile);
    if (nextCost >= cost - 1e-12) break;
    result = proposed; cost = nextCost; changed = true;
  }
  return { pose: result, changed, amount: Math.max(...JOINT_NAMES.map(joint => angleBetween(input.joints[joint], result.joints[joint]))) * DEG };
}
function balanceSmallError(input: Pose, profile: MotionFeasibilityProfile): { pose: Pose; changed: boolean; amount: number } {
  let result = clonePose(input), contacts = supportPoints(result, profile.bodyProfile);
  let residual = contacts.points.length ? supportDistance(centerOfMass(result), contacts.points) : 0;
  if (residual <= .055 || residual > .14) return { pose: result, changed: false, amount: 0 };
  const originalCost = collisionCost(result, profile);
  // Adjust the torso over existing support. Root/feet cannot be translated with
  // the COM: that would move the polygon too and would not solve balance.
  for (let iteration = 0; iteration < 24 && residual > .045; iteration++) {
    let best = result, bestResidual = residual;
    for (const axis of [new Vector3(1, 0, 0), new Vector3(0, 0, 1)]) for (const sign of [-1, 1]) {
      const candidate = clonePose(result);
      candidate.joints.Spine = new Quaternion(...candidate.joints.Spine).multiply(new Quaternion().setFromAxisAngle(axis, sign * .5 * RAD)).normalize().toArray() as Quat;
      if (!isFunctionalJointWithinLimits('Spine', candidate.joints.Spine, profile) || angleBetween(input.joints.Spine, candidate.joints.Spine) > 12 * RAD) continue;
      const distance = supportDistance(centerOfMass(candidate), supportPoints(candidate, profile.bodyProfile).points);
      if (distance >= bestResidual || collisionCost(candidate, profile) > originalCost + 1e-9) continue;
      best = candidate; bestResidual = distance;
    }
    if (best === result) break;
    result = best; residual = bestResidual;
  }
  const amount = angleBetween(input.joints.Spine, result.joints.Spine) * DEG;
  return { pose: result, changed: amount > 1e-7, amount };
}
type Sample = { time: number; pose: Pose; com: Vec3; support: ReturnType<typeof supportPoints> };
/** C1 Hermite curves can have their largest one-sided curvature next to a
 * knot. Quarter-grid finite differences average that peak away, especially
 * across opposite endpoint curvatures. Probe each side independently without
 * spending additional Rapier/COM geometry evaluations. */
async function inspectAngularCurvature(patch: AIMotionPatch, sampler: AIMotionPoseSampler, samples: readonly Sample[], options: SolveAIMotionFeasibilityOptions, profile: MotionFeasibilityProfile, report: MotionFeasibilityReport, allowance: (time: number) => number = () => 0, inherited: () => void = () => {}): Promise<void> {
  const endpoints = new Map(samples.map(sample => [sample.time, sample.pose]));
  for (let index = 1; index < patch.knots.length; index++) {
    abort(options.signal);
    if (index % 32 === 0) { await yieldTask(); abort(options.signal); }
    if (report.derivativeCoverage.poseSamples + 4 > MAX_DERIVATIVE_POSE_SAMPLES) throw new Error('motion-feasibility-derivative-coverage');
    const start = patch.knots[index - 1].time, end = patch.knots[index].time, h = (end - start) / 2048;
    const startPose = endpoints.get(start), endPose = endpoints.get(end);
    if (!startPose || !endPose) throw new Error('motion-feasibility-derivative-coverage');
    for (const forward of [true, false]) {
      const times = forward ? [start, start + h, start + 2 * h] : [end - 2 * h, end - h, end];
      if (!times.every(Number.isFinite) || !(times[0] < times[1] && times[1] < times[2]) || times[0] < start || times[2] > end) throw new Error('motion-feasibility-derivative-coverage');
      const poses = forward ? [startPose, sampler(times[1]), sampler(times[2])] : [sampler(times[0]), sampler(times[1]), endPose];
      report.derivativeCoverage.poseSamples += 2;
      const before = times[1] - times[0], after = times[2] - times[1], middle = (before + after) / 2;
      report.derivativeCoverage.maxStepSeconds = Math.max(report.derivativeCoverage.maxStepSeconds, before, after);
      let maximumSpeed = 0, maximumAcceleration = 0, fastest: JointName = 'Hips', accelerating: JointName = 'Hips';
      for (const joint of JOINT_NAMES) {
        const incoming = new Vector3(...logRotation(poses[0].joints[joint], poses[1].joints[joint])).applyQuaternion(normalized(poses[0].joints[joint])).divideScalar(before);
        const outgoing = new Vector3(...logRotation(poses[1].joints[joint], poses[2].joints[joint])).applyQuaternion(normalized(poses[1].joints[joint])).divideScalar(after);
        const speed = Math.max(incoming.length(), outgoing.length()), acceleration = outgoing.distanceTo(incoming) / middle;
        if (![speed, acceleration].every(Number.isFinite)) throw new Error('近端点角速度或曲率未得到有限值。');
        if (speed > maximumSpeed) { maximumSpeed = speed; fastest = joint; }
        if (acceleration > maximumAcceleration) { maximumAcceleration = acceleration; accelerating = joint; }
      }
      report.metrics.maxJointSpeedRadiansPerSecond = Math.max(report.metrics.maxJointSpeedRadiansPerSecond, maximumSpeed);
      report.metrics.maxJointAccelerationRadiansPerSecondSquared = Math.max(report.metrics.maxJointAccelerationRadiansPerSecondSquared, maximumAcceleration);
      if (maximumSpeed > profile.maxJointSpeedRadiansPerSecond + EPS) addViolation(report, { code: 'angular-speed', startSeconds: times[0], endSeconds: times[2], joint: fastest, measured: maximumSpeed, limit: profile.maxJointSpeedRadiansPerSecond, message: '插值近端点角速度超出配置。' });
      if (maximumAcceleration > profile.maxJointAccelerationRadiansPerSecondSquared + EPS && maximumAcceleration <= allowance(times[1])) inherited();
      else if (maximumAcceleration > profile.maxJointAccelerationRadiansPerSecondSquared + EPS) addViolation(report, { code: 'acceleration', startSeconds: times[0], endSeconds: times[2], joint: accelerating, measured: maximumAcceleration, limit: profile.maxJointAccelerationRadiansPerSecondSquared, message: '插值近端点单侧角曲率超过配置。' });
      report.derivativeCoverage.stencils++;
    }
    report.derivativeCoverage.spans++;
  }
  report.derivativeCoverage.complete = report.derivativeCoverage.spans === patch.knots.length - 1 && report.derivativeCoverage.stencils === 2 * (patch.knots.length - 1);
}
async function inspect(patch: AIMotionPatch, options: SolveAIMotionFeasibilityOptions, profile: MotionFeasibilityProfile, maxSamples: number, corrections: MotionFeasibilityCorrection[], diagnostics?: MotionFeasibilityDiagnostic[]): Promise<MotionFeasibilityReport> {
  const report = emptyReport(patch, profile, maxSamples); report.corrections = corrections;
  if (diagnostics) report.diagnostics = diagnostics;
  checkBoundaries(patch, options, report);
  if (report.totalViolations) return report;
  let times: number[];
  try { times = getMotionFeasibilitySampleTimes(patch, maxSamples); } catch { addViolation(report, { code: 'coverage', startSeconds: patch.target.startSeconds, endSeconds: patch.target.endSeconds, message: '动作过快或检测预算不足，无法覆盖整段插值，请缩短区间或降低动作速度。' }); return report; }
  const sampler = createAIMotionSampler(options.sourceSampler, { schema: 'ai-motion-track-1', countMapId: 'feasibility', durationSeconds: options.durationSeconds, patches: [patch] });
  const samples: Sample[] = [], plantAnchors = new Map<MotionContactHint, Map<MotionSupportEffector, { position: Vec3; rotation: Quat }>>();
  const inherited = options.inheritBoundaryIssues ? boundaryIssues(patch, profile, options.sourceSampler, options.durationSeconds) : undefined;
  const window = Math.max(0, options.inheritBoundaryIssues?.windowSeconds ?? 0);
  let inheritedCount = 0;
  const near = (time: number) => inherited?.filter(issue => Math.abs(issue.time - time) <= window) ?? [];
  // Next to a fixed endpoint whose own motion is already this abrupt, the
  // seam may match (never exceed by more than 15%) that original acceleration.
  const accelerationAllowance = (time: number) => Math.max(0, ...near(time).map(issue => issue.acceleration * 1.15));
  const tolerated = (time: number, isLocked: boolean, amount: (issue: BoundaryIssues) => number | undefined, measured: number) => {
    if (!inherited) return false;
    const allowed = Math.max(0, ...near(time).map(issue => amount(issue) ?? -1));
    if (isLocked || measured <= allowed + 1e-6) { inheritedCount++; return true; }
    return false;
  };
  let quietSince = patch.target.startSeconds;
  for (const [index, time] of times.entries()) {
    abort(options.signal);
    if (options.failFast && report.totalViolations) break;
    if (index && index % 64 === 0) { await yieldTask(); abort(options.signal); }
    const pose = sampler(time), com = centerOfMass(pose), support = supportPoints(pose, profile.bodyProfile);
    const sample = { time, pose, com, support }; samples.push(sample); report.coverage.samples++;
    const isLocked = time === patch.target.startSeconds || patch.target.mode === 'interval' && time === patch.target.endSeconds;
    for (const joint of JOINT_NAMES) {
      const measured = measureFunctionalJoint(joint, pose.joints[joint], profile);
      if (measured.errorDegrees > 1e-5 && !tolerated(time, isLocked, issue => issue.joints.has(joint) ? Infinity : undefined, measured.errorDegrees)) addViolation(report, { code: isLocked ? 'locked-boundary' : 'joint-limit', startSeconds: time, endSeconds: time, joint, measured: measured.errorDegrees, limit: 0, message: isLocked ? '原动作的只读端点不符合当前功能关节配置，请另选区间或先进行明确的重定向。' : '插值姿态超出功能关节活动范围。' });
    }
    const collisions = getCapsuleCollisions(pose, profile.bodyProfile);
    for (const collision of collisions.selfCollisions) {
      report.metrics.maxSelfDepthMeters = Math.max(report.metrics.maxSelfDepthMeters, collision.depthMeters);
      if (tolerated(time, isLocked, issue => issue.self.get(pairKey(collision.segments)), collision.depthMeters)) continue;
      addViolation(report, { code: isLocked ? 'locked-boundary' : 'self-collision', startSeconds: time, endSeconds: time, segments: collision.segments, measured: collision.depthMeters, limit: SELF_TOLERANCE, message: isLocked ? '原动作只读端点存在身体代理穿插，请另选区间。' : '插值动作出现身体代理穿插。' });
    }
    for (const collision of motionFloorDepths(pose, profile.bodyProfile).filter(contact => contact.depthMeters > FLOOR_TOLERANCE)) {
      report.metrics.maxFloorDepthMeters = Math.max(report.metrics.maxFloorDepthMeters, collision.depthMeters);
      if (tolerated(time, isLocked, issue => issue.floor.get(collision.segmentId), collision.depthMeters)) continue;
      addViolation(report, { code: isLocked ? 'locked-boundary' : 'floor-penetration', startSeconds: time, endSeconds: time, segments: [collision.segmentId], measured: collision.depthMeters, limit: FLOOR_TOLERANCE, message: isLocked ? '原动作只读端点穿入地面，请另选区间。' : '插值动作穿入地面。' });
    }
    if (support.points.length) report.metrics.supportedSamples++; else report.metrics.airborneSamples++;
    const hints = (options.contacts ?? []).filter(hint => time >= hint.startSeconds && time <= hint.endSeconds);
    if (!hints.length || hints.every(hint => hint.mode === 'unknown')) report.metrics.unknownContactSamples++;
    for (const hint of hints) {
      if (hint.mode === 'airborne' && support.points.length || hint.mode === 'supported' && (!support.points.length || hint.effectors?.some(effector => !support.effectors.has(effector)))) addViolation(report, { code: 'contact-mismatch', startSeconds: time, endSeconds: time, message: '模型或动作先验声明的支撑状态与实际身体／地面接触不符。' });
      if (hint.planted && hint.effectors) {
        const fk = evaluatePose(pose); let anchors = plantAnchors.get(hint);
        if (!anchors) { anchors = new Map(); plantAnchors.set(hint, anchors); }
        for (const effector of hint.effectors) {
          const anchor = anchors.get(effector), position = fk[effector].position, rotation = fk[effector].rotation;
          if (!anchor) anchors.set(effector, { position: [...position], rotation: [...rotation] });
          else if (distance(anchor.position, position) > .015 || angleBetween(anchor.rotation, rotation) > 2 * RAD) addViolation(report, { code: 'contact-slide', startSeconds: hint.startSeconds, endSeconds: time, joint: effector, measured: distance(anchor.position, position) > .015 ? distance(anchor.position, position) : angleBetween(anchor.rotation, rotation) * DEG, limit: distance(anchor.position, position) > .015 ? .015 : 2, message: '声明固定的支撑点在世界空间滑动或转动。' });
        }
      }
    }
    if (!index) continue;
    const previous = samples[index - 1], dt = time - previous.time;
    report.coverage.maxGapSeconds = Math.max(report.coverage.maxGapSeconds, dt);
    const rootStep = distance(pose.root, previous.pose.root), angularSteps = JOINT_NAMES.map(joint => angleBetween(pose.joints[joint], previous.pose.joints[joint]));
    const angularStep = Math.max(...angularSteps), fastestJoint = JOINT_NAMES[angularSteps.indexOf(angularStep)];
    report.coverage.maxRootStepMeters = Math.max(report.coverage.maxRootStepMeters, rootStep); report.coverage.maxJointStepRadians = Math.max(report.coverage.maxJointStepRadians, angularStep);
    const rootSpeed = rootStep / dt, angularSpeed = angularStep / dt;
    if (![rootSpeed, angularSpeed].every(Number.isFinite)) throw new Error('动作速度计算未得到有限值。');
    report.metrics.maxRootSpeedMps = Math.max(report.metrics.maxRootSpeedMps, rootSpeed); report.metrics.maxJointSpeedRadiansPerSecond = Math.max(report.metrics.maxJointSpeedRadiansPerSecond, angularSpeed);
    if (rootSpeed > profile.maxRootSpeedMps + EPS) addViolation(report, { code: 'linear-speed', startSeconds: previous.time, endSeconds: time, measured: rootSpeed, limit: profile.maxRootSpeedMps, message: 'Root 移动速度超出配置。' });
    if (angularSpeed > profile.maxJointSpeedRadiansPerSecond + EPS) addViolation(report, { code: 'angular-speed', startSeconds: previous.time, endSeconds: time, joint: fastestJoint, measured: angularSpeed, limit: profile.maxJointSpeedRadiansPerSecond, message: '关节转动速度超出配置。' });
    const comSpeed = distance(com, previous.com) / dt;
    if (!Number.isFinite(comSpeed)) throw new Error('质心速度计算未得到有限值。');
    // Quasi-static balance only. Fast turns/floor transitions do not inherit an
    // upright standing predicate; all verified body contacts enter the polygon.
    if (comSpeed >= .08 || angularSpeed >= .3) quietSince = time;
    const fullHoldEnding = patch.target.mode === 'full' && time === patch.target.endSeconds;
    if (fullHoldEnding && !support.points.length) addViolation(report, { code: 'contact-mismatch', startSeconds: time, endSeconds: time, message: '完整动作以保持结束，结束姿态不能悬浮在空中。' });
    if (support.points.length && (time - quietSince >= .25 || fullHoldEnding)) {
      const outside = supportDistance(com, support.points);
      if (outside > .055) addViolation(report, { code: 'support-balance', startSeconds: previous.time, endSeconds: time, measured: outside, limit: .055, message: '近静止姿态的质心投影离开实际支撑范围。' });
    }
    if (index < 2) continue;
    const older = samples[index - 2], before = previous.time - older.time, middleDt = (dt + before) / 2;
    const acceleration = (current: Vec3, prior: Vec3, earliest: Vec3): Vec3 => current.map((value, axis) => ((value - prior[axis]) / dt - (prior[axis] - earliest[axis]) / before) / middleDt) as Vec3;
    const rootAcceleration = Math.hypot(...acceleration(pose.root, previous.pose.root, older.pose.root));
    const angularAccelerations = JOINT_NAMES.map(joint => {
      // Transport both body-frame logarithms into the same parent-coordinate
      // frame; subtracting vectors in different rotating child frames is wrong.
      const velocity = new Vector3(...logRotation(previous.pose.joints[joint], pose.joints[joint])).applyQuaternion(new Quaternion(...previous.pose.joints[joint])).divideScalar(dt);
      const prior = new Vector3(...logRotation(older.pose.joints[joint], previous.pose.joints[joint])).applyQuaternion(new Quaternion(...older.pose.joints[joint])).divideScalar(before);
      return velocity.distanceTo(prior) / middleDt;
    });
    const angularAcceleration = Math.max(...angularAccelerations), acceleratingJoint = JOINT_NAMES[angularAccelerations.indexOf(angularAcceleration)];
    if (![rootAcceleration, angularAcceleration].every(Number.isFinite)) throw new Error('动作加速度计算未得到有限值。');
    report.metrics.maxRootAccelerationMps2 = Math.max(report.metrics.maxRootAccelerationMps2, rootAcceleration); report.metrics.maxJointAccelerationRadiansPerSecondSquared = Math.max(report.metrics.maxJointAccelerationRadiansPerSecondSquared, angularAcceleration);
    const inheritedAngular = rootAcceleration <= profile.maxRootAccelerationMps2 + EPS && angularAcceleration > profile.maxJointAccelerationRadiansPerSecondSquared + EPS && angularAcceleration <= accelerationAllowance(time);
    if (inheritedAngular) inheritedCount++;
    else if (rootAcceleration > profile.maxRootAccelerationMps2 + EPS || angularAcceleration > profile.maxJointAccelerationRadiansPerSecondSquared + EPS) addViolation(report, { code: 'acceleration', startSeconds: older.time, endSeconds: time, ...(rootAcceleration > profile.maxRootAccelerationMps2 ? {} : { joint: acceleratingJoint }), measured: rootAcceleration > profile.maxRootAccelerationMps2 ? rootAcceleration : angularAcceleration, limit: rootAcceleration > profile.maxRootAccelerationMps2 ? profile.maxRootAccelerationMps2 : profile.maxJointAccelerationRadiansPerSecondSquared, message: '动作出现超过配置的加速度跳变。' });
    const comAcceleration = acceleration(com, previous.com, older.com);
    if (!comAcceleration.every(Number.isFinite)) throw new Error('质心加速度计算未得到有限值。');
    // Newton's aggregate contact balance on the horizontal floor. This checks
    // only admissible net force: it does not distribute contact impulses or
    // establish achievable joint torques, muscles, exact pressure/COP or safety.
    // The 0.75 m/s²-equivalent tolerance is explicit numerical/proxy uncertainty,
    // never changed to accept an individual clip. Unsupported flight uses its
    // separate approximate ballistic check below.
    if (support.points.length && previous.support.points.length && older.support.points.length) {
      const normal = profile.massKg * (profile.gravityMps2 + comAcceleration[1]);
      const horizontal = profile.massKg * Math.hypot(comAcceleration[0], comAcceleration[2]);
      const available = profile.friction * Math.max(0, normal), tolerance = profile.groundForceToleranceNewtons;
      if (!report.metrics.groundedForceSamples++) { report.metrics.minNormalForceNewtons = normal; report.metrics.maxNormalForceNewtons = normal; }
      else { report.metrics.minNormalForceNewtons = Math.min(report.metrics.minNormalForceNewtons, normal); report.metrics.maxNormalForceNewtons = Math.max(report.metrics.maxNormalForceNewtons, normal); }
      report.metrics.maxHorizontalContactForceNewtons = Math.max(report.metrics.maxHorizontalContactForceNewtons, horizontal);
      report.metrics.maxFrictionExcessNewtons = Math.max(report.metrics.maxFrictionExcessNewtons, horizontal - available);
      // Support inferred while leaving an endpoint that is itself below the
      // floor is not meaningful; that transition inherits the endpoint's state.
      const invalidFloor = near(time).some(issue => issue.floor.size > 0);
      if ((normal < -tolerance || horizontal > available + tolerance) && invalidFloor) inheritedCount++;
      else if (normal < -tolerance) addViolation(report, { code: 'ground-force', startSeconds: older.time, endSeconds: time, measured: normal, limit: -tolerance, message: '支撑状态要求地面向下拉人体，汇总接触力不成立。' });
      else if (horizontal > available + tolerance) addViolation(report, { code: 'ground-friction', startSeconds: older.time, endSeconds: time, measured: horizontal, limit: available + tolerance, message: '支撑所需水平力超过当前摩擦与法向力允许值。' });
    }
    if (!support.points.length && !previous.support.points.length && !older.support.points.length) {
      const acc = comAcceleration, gravityError = Math.abs(acc[1] + profile.gravityMps2), horizontal = Math.hypot(acc[0], acc[2]);
      // Leaving an endpoint that is itself below the floor cannot be classified
      // as supported; that transition inherits the endpoint's invalid contact.
      const fromInvalidFloor = near(time).some(issue => issue.floor.size > 0);
      if ((gravityError > 4 || horizontal > 3) && fromInvalidFloor) inheritedCount++;
      else if (gravityError > 4 || horizontal > 3) addViolation(report, { code: 'unsupported-flight', startSeconds: older.time, endSeconds: time, measured: Math.max(gravityError, horizontal), limit: gravityError > 4 ? 4 : 3, message: '无支撑的质心轨迹不符合近似重力运动，发现悬浮或无来源的加速。' });
    }
  }
  if (inheritedCount) {
    report.inheritedBoundaryIssues = inheritedCount;
    report.warnings.push('固定端点的原动作本身超出人体包络或存在接触穿插；仅在端点衔接时段内容许这些原有问题逐步恢复，其余部分仍按原标准检查。');
  }
  report.coverage.complete = report.coverage.samples === times.length && report.coverage.maxGapSeconds <= MAX_GAP + EPS && report.coverage.maxRootStepMeters <= MAX_ROOT_STEP + EPS && report.coverage.maxJointStepRadians <= MAX_JOINT_STEP + EPS;
  if (!report.coverage.complete) addViolation(report, { code: 'coverage', startSeconds: patch.target.startSeconds, endSeconds: patch.target.endSeconds, message: '插值变化超过检测步长，不能采用覆盖不完整的候选。' });
  if (options.failFast && report.totalViolations) { report.status = 'rejected'; return report; }
  try { await inspectAngularCurvature(patch, sampler, samples, options, profile, report, time => {
    const allowed = accelerationAllowance(time);
    return allowed > profile.maxJointAccelerationRadiansPerSecondSquared ? allowed : 0;
  }, () => inheritedCount++); }
  catch (error) {
    if (!(error instanceof Error) || error.message !== 'motion-feasibility-derivative-coverage') throw error;
    addViolation(report, { code: 'coverage', startSeconds: patch.target.startSeconds, endSeconds: patch.target.endSeconds, message: '单侧角曲率采样无法完整表示或超过预算，候选不能采用。' });
  }
  report.status = !report.totalViolations && report.coverage.complete && report.derivativeCoverage.complete ? 'accepted' : 'rejected';
  return report;
}

type BoundaryIssues = { time: number; joints: Map<JointName, number>; self: Map<string, number>; floor: Map<string, number>; acceleration: number };
const pairKey = (segments: readonly string[]) => [...segments].sort().join('|');
/** Measured issues of the locked endpoint poses, used only as inherited allowances. */
function boundaryIssues(patch: AIMotionPatch, profile: MotionFeasibilityProfile, source: AIMotionPoseSampler, duration: number): BoundaryIssues[] {
  const knots = patch.target.mode === 'interval' ? [patch.knots[0], patch.knots.at(-1)!] : [patch.knots[0]];
  return knots.map((knot, index) => {
    // The original motion's own angular acceleration just outside the seam.
    let acceleration = 0;
    const h = 1 / 60, direction = index === 0 ? -1 : 1, times = [0, 1, 2].map(step => knot.time + direction * step * h);
    if (times.every(time => time >= 0 && time <= duration)) {
      const poses = times.map(time => source(time));
      for (const joint of JOINT_NAMES) {
        const first = new Vector3(...logRotation(poses[0].joints[joint], poses[1].joints[joint])).applyQuaternion(normalized(poses[0].joints[joint])).divideScalar(h);
        const second = new Vector3(...logRotation(poses[1].joints[joint], poses[2].joints[joint])).applyQuaternion(normalized(poses[1].joints[joint])).divideScalar(h);
        acceleration = Math.max(acceleration, second.distanceTo(first) / h);
      }
    }
    const joints = new Map<JointName, number>(), self = new Map<string, number>(), floor = new Map<string, number>();
    for (const joint of JOINT_NAMES) { const error = measureFunctionalJoint(joint, knot.pose.joints[joint], profile).errorDegrees; if (error > 1e-5) joints.set(joint, error); }
    for (const collision of getCapsuleCollisions(knot.pose, profile.bodyProfile).selfCollisions) self.set(pairKey(collision.segments), Math.max(self.get(pairKey(collision.segments)) ?? 0, collision.depthMeters + .003));
    for (const contact of motionFloorDepths(knot.pose, profile.bodyProfile)) if (contact.depthMeters > FLOOR_TOLERANCE) floor.set(contact.segmentId, contact.depthMeters + .003);
    return { time: knot.time, joints, self, floor, acceleration };
  });
}

/** Small newly generated errors only; never silently rescue an impossible action. */
async function alignFloorTrajectory(patch: AIMotionPatch, profile: MotionFeasibilityProfile, signal: AbortSignal | undefined, corrections: MotionFeasibilityCorrection[]): Promise<boolean> {
  const needed: { time: number; lift: number }[] = [];
  for (const [index, knot] of patch.knots.entries()) {
    abort(signal); if (index && index % 32 === 0) { await yieldTask(); abort(signal); }
    if (locked(patch, index)) continue;
    const depth = -getMotionMinimumFloorHeight(knot.pose, profile.bodyProfile);
    if (depth > FLOOR_TOLERANCE && depth <= MAX_GROUND_CORRECTION) needed.push({ time: knot.time, lift: depth + .001 });
  }
  if (!needed.length) return false;
  // Isolated dense per-frame lifts have a threshold jump. Use a compact C2
  // clearance envelope instead: each bump covers its required knot, while the
  // eighth norm joins overlapping bumps without a hard maximum corner. A
  // locked anchor has a C2 zero field; insufficient boundary room still rejects
  // at the final detector rather than moving that source anchor.
  const radius = .25, boundaryFade = .15;
  const smootherStep = (value: number) => { const u = clamp(value, 0, 1); return u * u * u * (10 + u * (-15 + 6 * u)); };
  for (const [index, knot] of patch.knots.entries()) {
    if (locked(patch, index)) continue;
    let lift = 0;
    if (patch.knots.length < 7) lift = needed.find(item => item.time === knot.time)?.lift ?? 0;
    else {
      let total = 0;
      for (const item of needed) {
        const u = Math.abs(item.time - knot.time) / radius;
        if (u >= 1) continue;
        const bump = item.lift * Math.pow(1 - u * u, 3);
        total += Math.pow(bump, 8);
      }
      lift = Math.pow(total, 1 / 8) * smootherStep((knot.time - patch.target.startSeconds) / boundaryFade);
      if (patch.target.mode === 'interval') lift *= smootherStep((patch.target.endSeconds - knot.time) / boundaryFade);
    }
    if (lift < 1e-9) continue;
    knot.pose.root[1] += lift; corrections.push({ time: knot.time, kind: 'ground-alignment', amount: lift });
  }
  return true;
}
async function correctKnots(patch: AIMotionPatch, profile: MotionFeasibilityProfile, options: SolveAIMotionFeasibilityOptions, corrections: MotionFeasibilityCorrection[], balanceTimes: number[], pass: number, diagnostics?: MotionFeasibilityDiagnostic[]): Promise<boolean> {
  let changed = false;
  for (const stage of ['joint-projection', 'ground-alignment', 'collision-separation', 'balance-adjustment'] as const) {
    let stageChanged = false;
    if (stage === 'ground-alignment') {
      stageChanged = await alignFloorTrajectory(patch, profile, options.signal, corrections);
      changed ||= stageChanged;
      if (diagnostics && stageChanged) await diagnoseKnots(patch, profile, options.signal, stage, pass, diagnostics);
      continue;
    }
    for (const [index, knot] of patch.knots.entries()) {
      if (locked(patch, index)) continue;
      abort(options.signal);
      if (index && index % 32 === 0) { await yieldTask(); abort(options.signal); }
      if (stage === 'joint-projection') for (const joint of JOINT_NAMES) {
        const proposed = projectJoint(joint, knot.pose.joints[joint], profile), amount = angleBetween(knot.pose.joints[joint], proposed);
        if (amount > 1e-7 && amount <= MAX_CORRECTION_ANGLE && isFunctionalJointWithinLimits(joint, proposed, profile)) { knot.pose.joints[joint] = proposed; corrections.push({ time: knot.time, kind: 'joint-projection', joint, amount: amount * DEG }); stageChanged = true; }
      }
      if (stage === 'collision-separation') {
        const separated = separateSmallCollisions(knot.pose, profile);
        if (separated.changed) { knot.pose = separated.pose; corrections.push({ time: knot.time, kind: 'collision-separation', amount: separated.amount }); stageChanged = true; }
      }
      if (stage === 'balance-adjustment' && balanceTimes.some(time => Math.abs(time - knot.time) <= MAX_GAP * 2)) {
        const balanced = balanceSmallError(knot.pose, profile);
        if (balanced.changed) { knot.pose = balanced.pose; corrections.push({ time: knot.time, kind: 'balance-adjustment', joint: 'Spine', amount: balanced.amount }); stageChanged = true; }
      }
    }
    changed ||= stageChanged;
    if (diagnostics && stageChanged) await diagnoseKnots(patch, profile, options.signal, stage, pass, diagnostics);
  }
  return changed;
}
function checkCorrectionBudget(input: AIMotionPatch, patch: AIMotionPatch, report: MotionFeasibilityReport): void {
  for (const [index, knot] of patch.knots.entries()) {
    const original = input.knots[index], root = distance(knot.pose.root, original.pose.root);
    report.metrics.maxRootCorrectionMeters = Math.max(report.metrics.maxRootCorrectionMeters, root);
    if (root > MAX_GROUND_CORRECTION + EPS) addViolation(report, { code: 'correction-budget', startSeconds: knot.time, endSeconds: knot.time, measured: root, limit: MAX_GROUND_CORRECTION, message: '数值修订偏离原候选过大，需要重新规划动作。' });
    for (const joint of JOINT_NAMES) {
      const amount = angleBetween(original.pose.joints[joint], knot.pose.joints[joint]);
      report.metrics.maxPoseCorrectionDegrees = Math.max(report.metrics.maxPoseCorrectionDegrees, amount * DEG);
      if (amount > MAX_CORRECTION_ANGLE + EPS) addViolation(report, { code: 'correction-budget', startSeconds: knot.time, endSeconds: knot.time, joint, measured: amount * DEG, limit: MAX_CORRECTION_ANGLE * DEG, message: '数值修订关节幅度过大，需要重新规划动作。' });
    }
  }
  if (report.totalViolations) report.status = 'rejected';
}
/**
 * Offline, bounded solver + fail-closed acceptance. Caller data/source poses are
 * never mutated. Only a separate accepted patch may be offered for adoption.
 * No per-display-frame correction, model call, provider retry or scene writes.
 */
export async function solveAIMotionFeasibility(input: AIMotionPatch, options: SolveAIMotionFeasibilityOptions): Promise<MotionFeasibilityResult> {
  const profile = options.profile ?? CANONICAL_MOTION_FEASIBILITY_PROFILE;
  const maxSamples = options.maxSamples ?? 12000;
  let report = emptyReport(input, profile, maxSamples);
  try {
    abort(options.signal);
    try { validateProfile(profile); } catch (error) { addViolation(report, { code: 'invalid-profile', startSeconds: report.target.startSeconds, endSeconds: report.target.endSeconds, message: error instanceof Error ? error.message : '人体配置无效。' }); return { report }; }
    if (!Number.isInteger(maxSamples) || maxSamples < 3 || maxSamples > 20000 || !Number.isFinite(options.durationSeconds) || options.durationSeconds <= 0 || options.durationSeconds > 60 || typeof options.sourceSampler !== 'function') throw new Error('人体求解输入或检测预算无效。');
    validateAIMotionTrack({ schema: 'ai-motion-track-1', countMapId: 'feasibility', durationSeconds: options.durationSeconds, patches: [input] }, { id: 'feasibility', durationSeconds: options.durationSeconds });
    if (!validContacts(options.contacts ?? [], input)) throw new Error('人体求解接触计划无效。');
    let patch = clonePatch(input);
    await loadRapierBackend(); abort(options.signal);
    const corrections: MotionFeasibilityCorrection[] = [];
    const diagnostics: MotionFeasibilityDiagnostic[] | undefined = options.diagnostics ? [] : undefined;
    if (diagnostics) await diagnoseKnots(patch, profile, options.signal, 'input', 0, diagnostics);
    report = await inspect(patch, options, profile, maxSamples, corrections, diagnostics);
    if (report.status === 'accepted') return { patch, report };
    // Immutable anchors and incomplete detectors cannot be repaired by moving data.
    if (options.correct === false || report.violationCounts['locked-boundary'] || report.violationCounts.coverage) return { report };
    for (let pass = 0; pass < 3; pass++) {
      const changed = await correctKnots(patch, profile, options, corrections, report.violations.filter(issue => issue.code === 'support-balance').map(issue => issue.endSeconds), pass + 1, diagnostics);
      if (!changed) break;
      patch = await regularizeCorrections(input, patch, options.signal);
      if (diagnostics) await diagnoseKnots(patch, profile, options.signal, 'regularization', pass + 1, diagnostics);
      if (options.conditionCandidate) {
        const conditioned = await options.conditionCandidate(clonePatch(patch), options.signal); abort(options.signal);
        validateConditionedCandidate(patch, conditioned, options.durationSeconds); patch = clonePatch(conditioned);
        if (diagnostics) await diagnoseKnots(patch, profile, options.signal, 'conditioning', pass + 1, diagnostics);
      }
      report = await inspect(patch, options, profile, maxSamples, corrections, diagnostics);
      checkCorrectionBudget(input, patch, report);
      if (report.status === 'accepted') return { patch, report };
      if (report.violationCounts['correction-budget'] || report.violationCounts.coverage || report.violationCounts['locked-boundary']) return { report };
    }
    // Do not attenuate dense tangents independently: that introduces a speed
    // pulse inside each 30Hz cell. Unresolved curves require a new coherent
    // trajectory, rather than hiding overshoot by another display-time clamp.
    return { report };
  } catch (error) {
    const cancelled = options.signal?.aborted || error instanceof Error && error.message === 'motion-feasibility-cancelled';
    report.status = cancelled ? 'cancelled' : 'rejected'; report.coverage.complete = false; report.derivativeCoverage.complete = false;
    addViolation(report, { code: cancelled ? 'cancelled' : report.coverage.samples ? 'detector-error' : 'invalid-input', startSeconds: report.target.startSeconds, endSeconds: report.target.endSeconds, message: cancelled ? '已取消动作求解。' : '动作求解或检测未完成，候选不能采用。' });
    return { report };
  }
}
