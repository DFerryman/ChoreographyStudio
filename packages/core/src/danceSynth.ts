/**
 * Constraint-first dance synthesis.
 *
 * Instead of asking a model for joint angles (or retargeting a small set of
 * captured clips and rejecting whatever fails), poses are *constructed* inside
 * the rig's physical envelope:
 *
 *  - feet are planted at fixed world positions on the floor and only move
 *    during explicit, beat-aligned swing phases (no foot sliding);
 *  - legs are solved with exact two-bone IK, knees following the toes;
 *  - the pelvis travels over the support foot by a smooth weight-transfer
 *    curve, so the centre of mass stays over the base of support;
 *  - pelvis height is capped by leg reach, so planted feet are always reached;
 *  - upper-body layers are smooth functions of beat phase whose amplitudes are
 *    limited by tempo, keeping angular and centre-of-mass acceleration inside
 *    the profile used by the final feasibility gate;
 *  - every joint is finally projected into its functional envelope;
 *  - fixed boundaries are joined by C2 blends from the boundary pose and its
 *    measured velocity, so seams are continuous in pose and velocity.
 *
 * The output is a dense pose stream for `compileAIMotionPosePatch`; the final
 * acceptance still comes from the independent feasibility gate.
 */
import { Matrix4, Quaternion, Vector3 } from 'three';
import type { AIMotionBoundary, AIMotionTarget } from './aiMotion';
import { evaluatePose } from './humanoid';
import { JOINT_NAMES, type JointName, type Pose, type Quat, type Vec3 } from './motion-types';
import { getCapsuleCollisions } from './capsuleCollision';
import { CANONICAL_MOTION_FEASIBILITY_PROFILE, getMotionMinimumFloorHeight, isFunctionalJointWithinLimits, projectFunctionalJoint, type MotionFeasibilityProfile } from './motionFeasibility';
import { mirrorDancePose, type DanceEnergy, type DancePlan, type DancePose } from './dancePlan';

export const DANCE_SYNTH_VERSION = 'dance-synth-2' as const;
const THIGH = .46, SHIN = .45, HIP_DROP = .05, HIP_HALF_WIDTH = .112;
/** Ankle height above the floor when the calibrated Foot hull just touches it. */
export const DANCE_ANKLE_FLOOR_HEIGHT = .0836 + .0015;
const MAX_REACH = .893;
const STAND_HEIGHT = DANCE_ANKLE_FLOOR_HEIGHT + HIP_DROP + .875;
const FOOT_HALF_WIDTH = .11;
const STAGE_RADIUS = 1.6;
const TAU = Math.PI * 2;
const RAD = Math.PI / 180;
/** Per-layer acceleration budget, well below the 250 rad/s² gate limit. */
const LAYER_ACCELERATION = 110;
const COM_ACCELERATION = 3.2;
/** Projection target: the gate's envelope shrunk by a margin, so Hermite
 * interpolation between dense samples cannot overshoot the real limits. */
const MARGIN = 1.5;
const shrink = (range: readonly [number, number] | undefined) => range && range[1] - range[0] > 4 * MARGIN ? [range[0] + MARGIN, range[1] - MARGIN] as const : range;
const SYNTH_PROFILE: MotionFeasibilityProfile = { ...CANONICAL_MOTION_FEASIBILITY_PROFILE, id: 'dance-synth-margin',
  envelopes: Object.fromEntries(JOINT_NAMES.map(joint => {
    const envelope = CANONICAL_MOTION_FEASIBILITY_PROFILE.envelopes[joint];
    return [joint, !envelope || envelope.marker ? envelope : { ...envelope, twistDegrees: shrink(envelope.twistDegrees)!,
      ...(envelope.flexionDegrees ? { flexionDegrees: shrink(envelope.flexionDegrees) } : {}),
      ...(envelope.lateralDegrees ? { lateralDegrees: shrink(envelope.lateralDegrees) } : {}),
      ...(envelope.swingDegrees !== undefined ? { swingDegrees: envelope.swingDegrees - MARGIN } : {}) }];
  })) as MotionFeasibilityProfile['envelopes'] };

type Foot = 'L' | 'R';
interface FootState { x: number; z: number; yaw: number }
interface Swing { foot: Foot; t0: number; t1: number; from: FootState; to: FootState; height: number; reach?: { lateral: number; forward: number; height: number } }
export interface DanceSegment { move: string; startSeconds: number; endSeconds: number; mirror: boolean }
export interface DanceSynthInput {
  target: AIMotionTarget;
  start: AIMotionBoundary;
  end: AIMotionBoundary;
  beatSeconds: number;
  plan: DancePlan;
  /** Backoff scale in (0, 1]; reduces every amplitude and step length. */
  intensity: number;
  /** Sample period; defaults to 1/30 s and grows only to respect the knot budget. */
  maxSamples?: number;
}
export interface DanceSynthResult {
  samples: { time: number; pose: Pose }[];
  segments: DanceSegment[];
  steps: number;
  blendSeconds: { start: number; end: number };
}

const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value));
/** Quintic smoothstep: zero first and second derivatives at both ends. */
const smoother = (value: number) => { const u = clamp(value, 0, 1); return u * u * u * (10 + u * (-15 + 6 * u)); };
const lerp = (a: number, b: number, u: number) => a + (b - a) * u;
const wrapAngle = (angle: number) => Math.atan2(Math.sin(angle), Math.cos(angle));
const yawQuat = (yaw: number) => new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), yaw);
const euler = (x: number, y: number, z: number) => new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), x)
  .multiply(new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), z)).multiply(new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), y));
const toQuat = (q: Quaternion): Quat => { q.normalize(); return [q.x, q.y, q.z, q.w]; };

// ── Upper-body layer parameters ────────────────────────────────────────────
interface ArmParams { elev: number; fwd: number; twist: number; elbow: number; wrist: number; shrug: number }
interface Layers {
  bounce: number; swayX: number; swayZ: number; hipRoll: number; hipPitch: number; hipYaw: number; weightBias: number; lunge: number;
  spineFlex: number; spineSide: number; spineTwist: number; chestFlex: number; chestSide: number; chestTwist: number;
  headNod: number; headTurn: number; headTilt: number;
  left: ArmParams; right: ArmParams;
}
const NEUTRAL_ARM: ArmParams = { elev: .26, fwd: .15, twist: 0, elbow: .18, wrist: 0, shrug: 0 };
function neutralLayers(): Layers {
  return { bounce: 0, swayX: 0, swayZ: 0, hipRoll: 0, hipPitch: 0, hipYaw: 0, weightBias: 0, lunge: 0,
    spineFlex: 0, spineSide: 0, spineTwist: 0, chestFlex: 0, chestSide: 0, chestTwist: 0,
    headNod: 0, headTurn: 0, headTilt: 0, left: { ...NEUTRAL_ARM }, right: { ...NEUTRAL_ARM } };
}
const ARM_KEYS = ['elev', 'fwd', 'twist', 'elbow', 'wrist', 'shrug'] as const;
const SCALAR_KEYS = ['bounce', 'swayX', 'swayZ', 'hipRoll', 'hipPitch', 'hipYaw', 'weightBias', 'lunge', 'spineFlex', 'spineSide', 'spineTwist', 'chestFlex', 'chestSide', 'chestTwist', 'headNod', 'headTurn', 'headTilt'] as const;
function addScaled(target: Layers, source: Layers, weight: number): void {
  const base = neutralLayers();
  for (const key of SCALAR_KEYS) target[key] += (source[key] - base[key]) * weight;
  for (const side of ['left', 'right'] as const) for (const key of ARM_KEYS) target[side][key] += (source[side][key] - base[side][key]) * weight;
}

/** Absolute layer values for one AI/local keypose (see DancePose scales). */
function poseLayers(pose: DancePose): Layers {
  const l = neutralLayers(), [lr, lf, lb, rr, rf, rb] = pose.arms;
  const arm = (raise: number, direction: number, bend: number): ArmParams => ({ elev: .15 + raise * .235, fwd: direction * .157, twist: 0, elbow: .1 + bend * .22, wrist: 0, shrug: 0 });
  l.left = arm(lr, lf, lb); l.right = arm(rr, rf, rb);
  l.spineFlex = l.chestFlex = pose.torso[0] * .05;
  l.spineSide = l.chestSide = pose.torso[1] * .05;
  l.spineTwist = l.chestTwist = pose.torso[2] * .06;
  l.headNod = pose.head[0] * .07; l.headTurn = pose.head[1] * .13;
  l.swayX = pose.hips[0] * .012; l.hipRoll = -pose.hips[0] * .012; l.weightBias = pose.hips[0] * .05;
  l.bounce = pose.hips[1] * .014;
  return l;
}
const flatten = (layers: Layers) => [...SCALAR_KEYS.map(key => layers[key]), ...ARM_KEYS.map(key => layers.left[key]), ...ARM_KEYS.map(key => layers.right[key])];
function unflatten(values: readonly number[]): Layers {
  const l = neutralLayers();
  SCALAR_KEYS.forEach((key, index) => { l[key] = values[index]; });
  ARM_KEYS.forEach((key, index) => { l.left[key] = values[SCALAR_KEYS.length + index]; l.right[key] = values[SCALAR_KEYS.length + ARM_KEYS.length + index]; });
  return l;
}
/** Linear (metres) layers get a centre-of-mass budget; the rest are angles. */
const LINEAR_KEYS = new Set<string>(['bounce', 'swayX', 'swayZ', 'lunge', 'weightBias']);
/** Trunk rotations move most of the body mass: their acceleration budget is
 * set by the centre-of-mass (friction) budget, not the joint limit. */
const TRUNK_KEYS = new Set<string>(['hipRoll', 'hipPitch', 'hipYaw', 'spineFlex', 'spineSide', 'spineTwist', 'chestFlex', 'chestSide', 'chestTwist']);
const TRUNK_ACCELERATION = 9, ARM_ACCELERATION = 70;

// ── Footwork ───────────────────────────────────────────────────────────────
interface Stance { L: FootState; R: FootState; center: [number, number]; facing: number; travelOrigin: [number, number] }
const local = (stance: Stance, lateral: number, forward: number): [number, number] => {
  const c = Math.cos(stance.facing), s = Math.sin(stance.facing);
  // +lateral is the dancer's left (+X when facing +Z).
  return [stance.center[0] + lateral * c + forward * s, stance.center[1] - lateral * s + forward * c];
};
const homeFoot = (stance: Stance, foot: Foot, lateral = 0, forward = 0, yaw = 0): FootState => {
  const [x, z] = local(stance, (foot === 'L' ? FOOT_HALF_WIDTH : -FOOT_HALF_WIDTH) + lateral, forward);
  return { x, z, yaw: stance.facing + yaw };
};
// ── Leg IK ─────────────────────────────────────────────────────────────────
/** Exact two-bone IK. Returns world rotations of thigh and shin. */
function solveLeg(hip: Vector3, ankle: Vector3, knee: Vector3Like): { thigh: Quaternion; shin: Quaternion } {
  const toAnkle = ankle.clone().sub(hip);
  let distance = toAnkle.length();
  const u = distance > 1e-6 ? toAnkle.clone().divideScalar(distance) : new Vector3(0, -1, 0);
  distance = clamp(distance, .2, THIGH + SHIN - .004);
  let pole = new Vector3(knee.x, knee.y, knee.z);
  pole.addScaledVector(u, -pole.dot(u));
  if (pole.lengthSq() < 1e-8) pole = new Vector3(0, 0, 1).addScaledVector(u, -u.z);
  pole.normalize();
  const along = (THIGH * THIGH - SHIN * SHIN + distance * distance) / (2 * distance);
  const height = Math.sqrt(Math.max(0, THIGH * THIGH - along * along));
  const kneePoint = hip.clone().addScaledVector(u, along).addScaledVector(pole, height);
  const end = hip.clone().addScaledVector(u, distance);
  const thighDir = kneePoint.clone().sub(hip).normalize(), shinDir = end.clone().sub(kneePoint).normalize();
  const hinge = new Vector3().crossVectors(pole, u).normalize();
  const frame = (direction: Vector3) => {
    const y = direction.clone().negate(), z = new Vector3().crossVectors(hinge, y).normalize(), x = new Vector3().crossVectors(y, z).normalize();
    return new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(x, y, z));
  };
  return { thigh: frame(thighDir), shin: frame(shinDir) };
}
type Vector3Like = { x: number; y: number; z: number };

function armRotation(params: ArmParams, sign: number): Quaternion {
  const elev = clamp(params.elev, 0, 2.6);
  // Above the shoulder the arm cannot point behind the body: lift the minimum
  // direction smoothly so overhead arms never cross the flexion wrap-around.
  const down = new Vector3(0, -1, 0), fwd = Math.max(clamp(params.fwd, -.3, 1.57), .25 * smoother((elev - 1.1) / .6));
  const direction = new Vector3(sign * Math.sin(elev) * Math.cos(fwd), -Math.cos(elev), Math.sin(elev) * Math.sin(fwd)).normalize();
  return new Quaternion().setFromUnitVectors(down, direction).multiply(new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), sign * params.twist));
}

/** Ankle positions, foot headings and their velocities at a boundary. */
function boundaryFeet(boundary: AIMotionBoundary) {
  const h = 1e-3, advanced: Pose = { root: boundary.pose.root.map((value, axis) => value + boundary.linearVelocity[axis] * h) as Vec3, joints: {} as Pose['joints'] };
  for (const joint of JOINT_NAMES) {
    const omega = new Vector3(...boundary.angularVelocity[joint]);
    advanced.joints[joint] = toQuat(new Quaternion(...boundary.pose.joints[joint]).multiply(expQuat(omega.multiplyScalar(h))));
  }
  const now = evaluatePose(boundary.pose), next = evaluatePose(advanced);
  const heading = (rotation: Quat) => { const forward = new Vector3(0, 0, 1).applyQuaternion(new Quaternion(...rotation)); return Math.atan2(forward.x, forward.z); };
  const foot = (joint: 'LeftFoot' | 'RightFoot') => ({ position: new Vector3(...now[joint].position), velocity: new Vector3(...next[joint].position).sub(new Vector3(...now[joint].position)).divideScalar(h),
    yaw: heading(now[joint].rotation), yawVelocity: wrapAngle(heading(next[joint].rotation) - heading(now[joint].rotation)) / h });
  return { L: foot('LeftFoot'), R: foot('RightFoot') };
}
/** Facing of a pose from its pelvis forward axis, projected to the floor. */
function poseFacing(pose: Pose): number {
  const forward = new Vector3(0, 0, 1).applyQuaternion(new Quaternion(...pose.joints.Hips));
  return Math.hypot(forward.x, forward.z) > .2 ? Math.atan2(forward.x, forward.z) : 0;
}
/** Planted foot states inferred from a boundary; feet off the floor get a default stance. */
function boundaryStance(boundary: AIMotionBoundary, direction: 1 | -1): { L: FootState; R: FootState; grounded: boolean } {
  const pose = boundary.pose, fk = evaluatePose(pose), facing = poseFacing(pose), kinematics = boundaryFeet(boundary);
  const footState = (joint: 'LeftFoot' | 'RightFoot'): FootState => {
    const forward = new Vector3(0, 0, 1).applyQuaternion(new Quaternion(...fk[joint].rotation));
    const yaw = Math.hypot(forward.x, forward.z) > .3 ? Math.atan2(forward.x, forward.z) : facing;
    // A foot caught mid-step is planted where that step lands (start) or
    // where it took off (end), not where it hangs in the air.
    const { velocity, position } = kinematics[joint === 'LeftFoot' ? 'L' : 'R'];
    const moving = position.y > DANCE_ANKLE_FLOOR_HEIGHT + .015 || Math.hypot(velocity.x, velocity.z) > .15;
    const lead = moving ? .18 * direction : 0, dx = clamp(velocity.x * lead, -.3, .3), dz = clamp(velocity.z * lead, -.3, .3);
    // Feet stay within ±40° of the pelvis so leg twist remains comfortable.
    return { x: fk[joint].position[0] + dx, z: fk[joint].position[2] + dz, yaw: facing + clamp(wrapAngle(yaw - facing), -.7, .7) };
  };
  const L = footState('LeftFoot'), R = footState('RightFoot');
  const lowest = Math.min(fk.LeftFoot.position[1], fk.RightFoot.position[1]);
  const spread = Math.hypot(L.x - R.x, L.z - R.z);
  const grounded = lowest < DANCE_ANKLE_FLOOR_HEIGHT + .12 && spread > .1 && spread < .7;
  if (grounded) return { L, R, grounded };
  const c = Math.cos(facing), s = Math.sin(facing), [x, , z] = pose.root;
  return { L: { x: x + FOOT_HALF_WIDTH * c, z: z - FOOT_HALF_WIDTH * s, yaw: facing }, R: { x: x - FOOT_HALF_WIDTH * c, z: z + FOOT_HALF_WIDTH * s, yaw: facing }, grounded };
}

// ── Seams: displacement mapping onto fixed boundaries ──────────────────────
type Displacement = { root: Vec3; rootVelocity: Vec3; joints: Record<JointName, { value: Vector3; velocity: Vector3 }> };
const logQuat = (q: Quaternion): Vector3 => {
  const r = q.clone(); if (r.w < 0) r.set(-r.x, -r.y, -r.z, -r.w);
  const sine = Math.hypot(r.x, r.y, r.z);
  return sine < 1e-12 ? new Vector3(2 * r.x, 2 * r.y, 2 * r.z) : new Vector3(r.x, r.y, r.z).multiplyScalar(2 * Math.atan2(sine, r.w) / sine);
};
const expQuat = (v: Vector3): Quaternion => {
  const angle = v.length();
  return angle < 1e-12 ? new Quaternion() : new Quaternion().setFromAxisAngle(v.clone().divideScalar(angle), angle);
};
function inverseRightJacobian(rotation: Vector3, velocity: Vector3): Vector3 {
  const angle = rotation.length();
  const coefficient = angle < 1e-4 ? 1 / 12 + angle * angle / 720 : 1 / (angle * angle) - 1 / (2 * angle * Math.tan(angle / 2));
  const first = rotation.clone().cross(velocity);
  return velocity.clone().addScaledVector(first, .5).addScaledVector(rotation.clone().cross(first), coefficient);
}
/**
 * Offset (in pose and velocity) between the generated curve and a fixed
 * boundary. `next` is the generated pose `dt` seconds inside the range.
 */
function boundaryDisplacement(boundary: AIMotionBoundary, generated: Pose, next: Pose, dt: number, direction: 1 | -1): Displacement {
  const joints = {} as Displacement['joints'];
  for (const joint of JOINT_NAMES) {
    const g = new Quaternion(...generated.joints[joint]), n = new Quaternion(...next.joints[joint]);
    const value = logQuat(g.clone().invert().multiply(new Quaternion(...boundary.pose.joints[joint])));
    const generatedVelocity = logQuat(g.clone().invert().multiply(n)).multiplyScalar(direction / dt);
    // For q = g·exp(δ): q⁻¹q' = exp(δ)⁻¹·ω_g·exp(δ) + J_r(δ)·δ'. Solve δ'(0) so
    // the seam velocity equals the boundary's exactly.
    const carried = generatedVelocity.applyQuaternion(expQuat(value).invert());
    joints[joint] = { value, velocity: inverseRightJacobian(value, new Vector3(...boundary.angularVelocity[joint]).sub(carried)) };
  }
  return { root: boundary.pose.root.map((value, axis) => value - generated.root[axis]) as Vec3,
    rootVelocity: boundary.linearVelocity.map((value, axis) => value - (next.root[axis] - generated.root[axis]) * direction / dt) as Vec3, joints };
}
/**
 * Seam width so the displacement's own acceleration stays within a budget:
 * a quintic fade of value D and slope V over W peaks at about
 * 5.77·D/W² + 3.94·V/W.
 */
function fadeWidth(displacement: Displacement, beat: number, duration: number, scale: number): number {
  const needed = (value: number, velocity: number, budget: number) => (3.94 * velocity + Math.sqrt((3.94 * velocity) ** 2 + 4 * budget * 5.77 * value)) / (2 * budget);
  let width = Math.max(.8, 1.6 * beat, needed(Math.hypot(...displacement.root), Math.hypot(...displacement.rootVelocity), 1.2));
  for (const joint of JOINT_NAMES) width = Math.max(width, needed(displacement.joints[joint].value.length(), displacement.joints[joint].velocity.length(), 45));
  return Math.min(duration, width * scale);
}
/** Quintic Hermite fade: value D and slope V at τ=0, zero value/slope/curvature at τ=W. */
function fadeWeights(tau: number, width: number): [number, number] {
  const u = clamp(tau / width, 0, 1), u3 = u * u * u;
  return [1 - u3 * (10 - 15 * u + 6 * u * u), width * (u - u3 * (6 - 8 * u + 3 * u * u))];
}
function applyDisplacements(pose: Pose, items: { displacement: Displacement; tau: number; width: number; sign: 1 | -1 }[]): Pose {
  const root: Vec3 = [...pose.root], joints = {} as Pose['joints'];
  const offsets = Object.fromEntries(JOINT_NAMES.map(joint => [joint, new Vector3()])) as Record<JointName, Vector3>;
  for (const { displacement, tau, width, sign } of items) {
    if (tau >= width) continue;
    // τ runs away from the boundary; for the end boundary d/dt = −d/dτ.
    const [h0, h1] = fadeWeights(tau, width);
    // Pelvis momentum is absorbed over a short window (see the position seam).
    const speed = Math.hypot(...displacement.rootVelocity), momentum = clamp(.3 + speed / 2.5, .35, .9);
    const [, r1] = tau < momentum ? fadeWeights(tau, momentum) : [0, 0];
    for (let axis = 0; axis < 3; axis++) root[axis] += displacement.root[axis] * h0 + sign * displacement.rootVelocity[axis] * r1;
    for (const joint of JOINT_NAMES) offsets[joint].addScaledVector(displacement.joints[joint].value, h0).addScaledVector(displacement.joints[joint].velocity, sign * h1);
  }
  for (const joint of JOINT_NAMES) joints[joint] = toQuat(new Quaternion(...pose.joints[joint]).multiply(expQuat(offsets[joint])));
  return { root, joints };
}
function poseDistance(a: Pose, b: Pose): number {
  let angle = 0;
  for (const joint of JOINT_NAMES) angle = Math.max(angle, new Quaternion(...a.joints[joint]).angleTo(new Quaternion(...b.joints[joint])));
  return Math.max(angle, Math.hypot(...a.root.map((value, axis) => value - b.root[axis])) * 2);
}

// ── Scheduling ─────────────────────────────────────────────────────────────
const ENERGY: Record<DanceEnergy, number> = { low: .6, medium: .85, high: 1 };
/** Pose keys on the beat grid between `start` and `end`, cycling the plan's order. */
export function scheduleDancePoses(plan: DancePlan, startSeconds: number, endSeconds: number, beatSeconds: number): { keys: { time: number; pose: DancePose }[]; segments: DanceSegment[] } {
  const keys: { time: number; pose: DancePose }[] = [], segments: DanceSegment[] = [];
  const firstBeat = Math.ceil(startSeconds / beatSeconds - 1e-6), lastBeat = Math.floor(endSeconds / beatSeconds + 1e-6);
  let beat = firstBeat, index = 0;
  while (beat <= lastBeat && plan.order.length) {
    const ref = plan.order[index % plan.order.length], phrase = plan.phrases[ref.phrase] ?? plan.phrases[0];
    const begin = beat;
    for (const pose of phrase.poses) {
      if (beat > lastBeat) break;
      keys.push({ time: beat * beatSeconds, pose: ref.mirror ? mirrorDancePose(pose) : pose }); beat++;
    }
    segments.push({ move: `phrase-${String.fromCharCode(65 + ref.phrase)}${ref.mirror ? "'" : ''}`, startSeconds: begin * beatSeconds, endSeconds: Math.min(beat, lastBeat) * beatSeconds, mirror: ref.mirror });
    index++;
  }
  return { keys, segments: segments.filter(segment => segment.endSeconds > segment.startSeconds) };
}


export function synthesizeDance(input: DanceSynthInput): DanceSynthResult {
  const { target, beatSeconds: b, plan } = input;
  const intensity = clamp(input.intensity, .05, 1), seamScale = 1 + (1 - intensity) * 1.5, energy = ENERGY[plan.energy] ?? .85;
  const t0 = target.startSeconds, t1 = target.endSeconds, duration = t1 - t0;
  const interval = target.mode === 'interval';
  const startPose = input.start.pose, endPose = input.end.pose;
  // Footwork stays off the floor-contact boundaries; seams are blended windows.
  const startStance = boundaryStance(input.start, 1);
  const facing0 = poseFacing(startPose);
  const startBlend = Math.min(duration * .3, Math.max(.45, b) * (startStance.grounded ? 1 : 2) + .25 * poseDistance(startPose, neutralStandingPose(startPose, startStance)));
  const endStance = interval ? boundaryStance(input.end, -1) : undefined;
  const endBlend = interval ? Math.min(duration * .3, Math.max(.45, b) * (endStance!.grounded ? 1 : 2)) : Math.min(duration * .3, Math.max(1.4, 2.5 * b));
  // Footwork waits until the seam displacement has mostly faded, so the two
  // stance phases (original and generated) are never mixed mid-step.
  const neutralDisplacement = (boundary: AIMotionBoundary, stanceOf: { L: FootState; R: FootState }) => {
    const reference = neutralStandingPose(boundary.pose, stanceOf);
    return boundaryDisplacement(boundary, reference, reference, 1, 1);
  };
  const estimatedStart = fadeWidth(neutralDisplacement(input.start, startStance), b, duration, seamScale);
  const estimatedEnd = interval ? fadeWidth(neutralDisplacement(input.end, endStance!), b, duration, seamScale) : 0;
  const footStart = t0 + Math.max(startBlend, .7 * estimatedStart), footEnd = t1 - Math.max(endBlend, .7 * estimatedEnd);

  // Keyposes on the musical beat grid between the blend windows.
  const { keys: poseKeys, segments: scheduled } = footEnd - footStart >= b ? scheduleDancePoses(plan, footStart, footEnd, b) : { keys: [], segments: [] };
  // Reserve beats at the end for steps that reach the end stance.
  const stance: Stance = { L: { ...startStance.L }, R: { ...startStance.R }, center: [(startStance.L.x + startStance.R.x) / 2, (startStance.L.z + startStance.R.z) / 2], facing: facing0, travelOrigin: [startPose.root[0], startPose.root[2]] };
  const swings: Swing[] = [];
  const swingSeconds = Math.min(.5, .72 * b);
  const addSwing = (foot: Foot, landTime: number, to: FootState, height: number, reach?: Swing['reach'], duration = swingSeconds) => {
    const from = { ...stance[foot] };
    const distance = Math.hypot(to.x - from.x, to.z - from.z), turn = Math.abs(wrapAngle(to.yaw - from.yaw));
    if (!reach && distance < .02 && turn < 3 * RAD && height <= .03) return;
    swings.push({ foot, t0: landTime - duration, t1: landTime, from, to: { ...to, yaw: from.yaw + wrapAngle(to.yaw - from.yaw) }, height, reach });
    stance[foot] = { ...to, yaw: from.yaw + wrapAngle(to.yaw - from.yaw) };
  };
  const recenter = () => {
    stance.center = [(stance.L.x + stance.R.x) / 2, (stance.L.z + stance.R.z) / 2];
    stance.facing = (stance.L.yaw + stance.R.yaw) / 2;
  };
  // Momentum at the start seam: a body that is travelling, or caught with one
  // foot in the air, finishes that step so the pelvis comes to rest between
  // the feet instead of drifting past the support.
  {
    const kinematics = boundaryFeet(input.start), v = input.start.linearVelocity, speed = Math.hypot(v[0], v[2]);
    const rest: [number, number] = [startPose.root[0] + clamp(v[0] * .3, -.35, .35), startPose.root[2] + clamp(v[2] * .3, -.35, .35)];
    const airborne = (['L', 'R'] as const).filter(foot => kinematics[foot].position.y > DANCE_ANKLE_FLOOR_HEIGHT + .015);
    let foot: Foot | undefined = airborne.length === 1 ? airborne[0] : undefined;
    if (!foot && airborne.length === 0 && speed > .3) {
      const along = (side: Foot) => (stance[side].x - rest[0]) * v[0] + (stance[side].z - rest[1]) * v[2];
      foot = along('L') < along('R') ? 'L' : 'R';
    }
    if (foot) {
      const other: Foot = foot === 'L' ? 'R' : 'L', anchor = stance[other];
      let x = 2 * rest[0] - anchor.x, z = 2 * rest[1] - anchor.z;
      // Keep the landing on its own side and at a comfortable width.
      const lateral = [Math.cos(facing0), -Math.sin(facing0)], sideSign = foot === 'L' ? 1 : -1;
      const across = (x - anchor.x) * lateral[0] + (z - anchor.z) * lateral[1];
      if (across * sideSign < .14) { x += lateral[0] * (sideSign * .14 - across); z += lateral[1] * (sideSign * .14 - across); }
      const dx = x - anchor.x, dz = z - anchor.z, distance = Math.hypot(dx, dz), limited = clamp(distance, .16, .45);
      const landing: FootState = { x: anchor.x + dx / distance * limited, z: anchor.z + dz / distance * limited, yaw: stance[foot].yaw };
      if (airborne.length) { startStance[foot] = { ...landing }; stance[foot] = { ...landing }; }
      else addSwing(foot, t0 + .1 + swingSeconds, landing, .05);
      recenter();
    }
  }

  // Steps needed to arrive at the end stance (interval) or a neutral stance (full).
  const returnBeats = (() => {
    if (!interval) return 2;
    const span = Math.max(Math.hypot(endStance!.L.x - startStance.L.x, endStance!.L.z - startStance.L.z), Math.hypot(endStance!.R.x - startStance.R.x, endStance!.R.z - startStance.R.z));
    return 2 * Math.max(poseKeys.some(key => key.pose.step.startsWith('turn')) ? 2 : 1, Math.ceil(span / .3));
  })();
  const footworkEnd = footEnd - returnBeats * b;
  // Footwork: each keypose's step lands on its count. Step length shrinks at
  // fast tempos so the swing-leg acceleration stays in budget.
  {
    const d = .22 * clamp(intensity * (.55 + .45 * energy), .15, 1) * clamp((b / .5) ** 1.5, .6, 1);
    let home: Stance = { ...stance, L: { ...stance.L }, R: { ...stance.R }, center: [...stance.center] as [number, number] };
    let pendingTurn: Foot | undefined, lastFoot: Foot = 'R';
    const offHome = (foot: Foot) => { const h = homeFoot(home, foot); return Math.hypot(stance[foot].x - h.x, stance[foot].z - h.z) + Math.abs(wrapAngle(stance[foot].yaw - h.yaw)) * .2; };
    for (const { time: land, pose } of poseKeys) {
      if (pose.step === 'none' || land > footworkEnd + 1e-9 || land - swingSeconds < footStart - 1e-9) continue;
      const step = pose.step;
      let foot: Foot, to: FootState;
      if (step === 'together') {
        if (pendingTurn) { foot = pendingTurn; pendingTurn = undefined; }
        else { foot = offHome('L') >= offHome('R') ? 'L' : 'R'; if (offHome(foot) < .03) continue; }
        to = homeFoot(home, foot);
      } else if (step === 'turn-L' || step === 'turn-R') {
        if (pendingTurn) { foot = pendingTurn; pendingTurn = undefined; to = homeFoot(home, foot); }
        else {
          // Only turn further when there is time left to turn back to the
          // fixed end facing with comfortable quarter-turn steps.
          const facing = home.facing + (step === 'turn-L' ? 1 : -1) * Math.PI / 2;
          const finalFacing = interval ? (endStance!.L.yaw + endStance!.R.yaw) / 2 : facing;
          const quartersBack = Math.ceil(Math.abs(wrapAngle(facing - finalFacing)) / (Math.PI / 2) - 1e-6);
          if (footworkEnd - land < (quartersBack * 2 + 2) * b) continue;
          // Rotate the stance a quarter turn; the leading foot steps now, the
          // other follows on the next turn/together count.
          home = { ...home, facing };
          foot = step === 'turn-L' ? 'L' : 'R'; pendingTurn = foot === 'L' ? 'R' : 'L';
          to = homeFoot(home, foot);
        }
      } else if (step === 'travel-L' || step === 'travel-R') {
        const side = step === 'travel-L' ? 1 : -1, travelled = [home.center[0] - home.travelOrigin[0], home.center[1] - home.travelOrigin[1]];
        const lateral = [Math.cos(home.facing), -Math.sin(home.facing)];
        // Stay on the stage: travelling further out becomes closing the feet.
        if (Math.hypot(...travelled) > STAGE_RADIUS * .55 && (travelled[0] * lateral[0] + travelled[1] * lateral[1]) * side > 0) { foot = offHome('L') >= offHome('R') ? 'L' : 'R'; to = homeFoot(home, foot); }
        else {
          // Alternate open (lead foot) and close (trail foot): the centre moves half a step each time.
          const lead: Foot = side > 0 ? 'L' : 'R';
          foot = lastFoot === lead ? (lead === 'L' ? 'R' : 'L') : lead;
          home = { ...home, center: local(home, side * d / 2, 0) };
          to = homeFoot(home, foot);
        }
      } else {
        foot = step.startsWith('L') ? 'L' : 'R';
        const out = foot === 'L' ? 1 : -1;
        to = step.endsWith('side') ? homeFoot(home, foot, out * d) : step.endsWith('front') ? homeFoot(home, foot, 0, d) : homeFoot(home, foot, 0, -d * .8);
      }
      if (pendingTurn && foot === pendingTurn && !step.startsWith('turn') && step !== 'together') continue;
      addSwing(foot, land, to, .06);
      lastFoot = foot;
    }
    recenter();
  }
  // Return steps: alternate feet from the current stance to the final stance.
  {
    const final = interval ? endStance! : (() => {
      const facing = (stance.L.yaw + stance.R.yaw) / 2, center: [number, number] = [(stance.L.x + stance.R.x) / 2, (stance.L.z + stance.R.z) / 2];
      const s: Stance = { L: stance.L, R: stance.R, center, facing, travelOrigin: stance.travelOrigin };
      return { L: homeFoot(s, 'L'), R: homeFoot(s, 'R'), grounded: true };
    })();
    const fromL = { ...stance.L }, fromR = { ...stance.R };
    const distance = Math.max(Math.hypot(final.L.x - fromL.x, final.L.z - fromL.z), Math.hypot(final.R.x - fromR.x, final.R.z - fromR.z));
    const turn = Math.max(Math.abs(wrapAngle(final.L.yaw - fromL.yaw)), Math.abs(wrapAngle(final.R.yaw - fromR.yaw)));
    // Enough alternating steps that none is longer than 30 cm or turns > 80°.
    const wanted = Math.max(1, Math.ceil(distance / .3), Math.ceil(turn / (80 * RAD)));
    let begin = Math.max(footStart, swings.at(-1)?.t1 ?? footStart) + .05;
    // In short ranges a long start seam can leave no room to reach the end
    // stance; the return steps then start right after the start blend rather
    // than leaving the end seam to slide (or turn) the feet over the floor.
    if ((distance > .05 || turn > 10 * RAD) && Math.floor((footEnd - begin) / (2 * .3)) < wanted) begin = Math.max(t0 + startBlend, swings.at(-1)?.t1 ?? t0) + .05;
    // Steps never run into the end seam: fewer, longer steps when time is short
    // (the seam displacement absorbs any remainder).
    const fit = Math.floor((footEnd - begin) / (2 * .3));
    const pairs = Math.min(fit, wanted);
    const stepSeconds = pairs > 0 ? Math.min(b, (footEnd - begin) / (2 * pairs)) : 0;
    const duration = Math.min(swingSeconds, stepSeconds * .85);
    // Body-frame offset of a foot from a stance centre (inverse of `local`).
    const bodyOffset = (foot: FootState, centre: [number, number], facing: number): [number, number] => {
      const dx = foot.x - centre[0], dz = foot.z - centre[1], c = Math.cos(facing), sn = Math.sin(facing);
      return [dx * c - dz * sn, dx * sn + dz * c];
    };
    const fromCentre: [number, number] = [(fromL.x + fromR.x) / 2, (fromL.z + fromR.z) / 2], toCentre: [number, number] = [(final.L.x + final.R.x) / 2, (final.L.z + final.R.z) / 2];
    const fromFacing = fromL.yaw + wrapAngle(fromR.yaw - fromL.yaw) / 2, toFacing = final.L.yaw + wrapAngle(final.R.yaw - final.L.yaw) / 2;
    const turnBy = wrapAngle(toFacing - fromFacing);
    const order: Foot[] = Math.hypot(final.L.x - fromL.x, final.L.z - fromL.z) >= Math.hypot(final.R.x - fromR.x, final.R.z - fromR.z) ? ['L', 'R'] : ['R', 'L'];
    let land = begin;
    for (let pair = 1; pair <= pairs; pair++) {
      for (const foot of order) {
        land += stepSeconds;
        if (land - duration < begin - .05) continue;
        const from = foot === 'L' ? fromL : fromR, to = final[foot], u = pair / pairs;
        // Intermediate stances turn about the moving stance centre (feet keep
        // their own sides), instead of sliding straight across each other.
        const facing = fromFacing + turnBy * u, c = Math.cos(facing), sn = Math.sin(facing);
        const [lateral, forward] = [lerp(bodyOffset(from, fromCentre, fromFacing)[0], bodyOffset(to, toCentre, toFacing)[0], u), lerp(bodyOffset(from, fromCentre, fromFacing)[1], bodyOffset(to, toCentre, toFacing)[1], u)];
        const cx = lerp(fromCentre[0], toCentre[0], u), cz = lerp(fromCentre[1], toCentre[1], u);
        addSwing(foot, land, { x: cx + lateral * c + forward * sn, z: cz - lateral * sn + forward * c, yaw: from.yaw + wrapAngle(to.yaw - from.yaw) * u }, .05, undefined, duration);
      }
    }
  }
  swings.sort((a, b) => a.t0 - b.t0);

  // ── Sample grid ──────────────────────────────────────────────────────────
  const maxSamples = Math.min(1800, input.maxSamples ?? 1800);
  const steps = Math.min(maxSamples, Math.max(3, Math.ceil(duration * 30)));
  const times: number[] = [];
  for (let index = 1; index <= steps; index++) times.push(index === steps ? t1 : t0 + duration * index / steps);
  if (interval) times.pop();

  // Keypose curves: each parameter passes through its pose on the count with
  // smooth (C1, cubic Hermite) transitions. A change between neighbouring
  // counts is limited so that its peak acceleration fits the joint (angles)
  // or centre-of-mass (metres) budget at this tempo; intensity scales every
  // deviation from neutral.
  const neutral = flatten(neutralLayers());
  const budgets = [...SCALAR_KEYS.map(key => LINEAR_KEYS.has(key) ? COM_ACCELERATION : TRUNK_KEYS.has(key) ? TRUNK_ACCELERATION : LAYER_ACCELERATION),
    ...ARM_KEYS.map(() => ARM_ACCELERATION), ...ARM_KEYS.map(() => ARM_ACCELERATION)];
  const curve = poseKeys.map(key => flatten(poseLayers(key.pose)).map((value, index) => neutral[index] + (value - neutral[index]) * intensity * (.75 + .25 * energy)));
  for (let k = 1; k < curve.length; k++) for (let index = 0; index < neutral.length; index++) {
    const limit = budgets[index] * b * b / 7.5;
    curve[k][index] = clamp(curve[k][index], curve[k - 1][index] - limit, curve[k - 1][index] + limit);
  }
  const groove = energy * intensity * Math.min(.018, COM_ACCELERATION / (TAU / b) ** 2);
  const envelope = (time: number) => smoother((time - t0) / Math.max(startBlend, Math.min(1, duration * .3))) * (interval ? smoother((t1 - time) / Math.max(endBlend, Math.min(1, duration * .3))) : smoother((t1 - .4 - time) / Math.max(.3, endBlend - .4)));
  const layersAt = (time: number): Layers => {
    let values = neutral;
    if (curve.length) {
      const first = poseKeys[0].time, k = clamp(Math.floor((time - first) / b), -1, curve.length - 1);
      if (k < 0 || k === curve.length - 1) values = curve[clamp(k, 0, curve.length - 1)];
      else {
        const u = (time - poseKeys[k].time) / b, u2 = u * u, u3 = u2 * u;
        const h00 = 2 * u3 - 3 * u2 + 1, h10 = u3 - 2 * u2 + u, h01 = -2 * u3 + 3 * u2, h11 = u3 - u2;
        const before = curve[Math.max(0, k - 1)], a = curve[k], c = curve[k + 1], after = curve[Math.min(curve.length - 1, k + 2)];
        // Tangents at half Catmull–Rom strength: flowing but still landing on the count.
        values = a.map((value, index) => h00 * value + h10 * .25 * (c[index] - before[index]) + h01 * c[index] + h11 * .25 * (after[index] - value));
      }
    }
    const layers = unflatten(values);
    // A light knee groove on every count keeps the body alive between poses.
    if (curve.length) {
      const span = smoother((time - poseKeys[0].time + b) / b) * smoother((poseKeys.at(-1)!.time + b - time) / b);
      layers.bounce += span * groove * (.5 + .5 * Math.cos(TAU * (time - poseKeys[0].time) / b));
    }
    const scaled = neutralLayers();
    addScaled(scaled, layers, envelope(time));
    return scaled;
  };
  const footAt = (foot: Foot, time: number): { x: number; y: number; z: number; yaw: number; swing: number } => {
    let state = foot === 'L' ? startStance.L : startStance.R;
    for (const swing of swings) {
      if (swing.foot !== foot) continue;
      if (time >= swing.t1) { state = swing.to; continue; }
      if (time <= swing.t0) break;
      // Lift and set down with zero vertical velocity and acceleration.
      const u = (time - swing.t0) / (swing.t1 - swing.t0), s = smoother(u), lift = u < .5 ? smoother(2 * u) : smoother(2 - 2 * u);
      let x = lerp(swing.from.x, swing.to.x, s), z = lerp(swing.from.z, swing.to.z, s), y = DANCE_ANKLE_FLOOR_HEIGHT + swing.height * lift;
      if (swing.reach) {
        const c = Math.cos(swing.from.yaw), sn = Math.sin(swing.from.yaw);
        x += (swing.reach.lateral * c + swing.reach.forward * sn) * lift; z += (-swing.reach.lateral * sn + swing.reach.forward * c) * lift;
        y += swing.reach.height * lift;
      }
      return { x, y, z, yaw: lerp(swing.from.yaw, swing.to.yaw, s), swing: lift };
    }
    return { ...state, y: DANCE_ANKLE_FLOOR_HEIGHT, swing: 0 };
  };
  // Weight transfer: on the stance foot at each swing middle, centred otherwise.
  const keys: { time: number; value: number }[] = [{ time: t0, value: .5 }];
  // The shift is sized by the actual time to the neighbouring steps (quick
  // return steps can be closer than a beat), so the side-to-side pelvis
  // acceleration stays within the friction budget.
  const middle = (swing: Swing) => (swing.t0 + swing.t1) / 2;
  for (const [index, swing] of swings.entries()) {
    const gap = Math.min(b, index > 0 ? middle(swing) - middle(swings[index - 1]) : b, index + 1 < swings.length ? middle(swings[index + 1]) - middle(swing) : b);
    const shift = clamp((gap / .55) ** 2, .2, 1) * .42;
    keys.push({ time: middle(swing), value: swing.foot === 'L' ? .5 - shift : .5 + shift });
    // Long double-support gaps return the weight to the centre between steps.
    const next = swings[index + 1];
    if (!next || next.t0 - swing.t1 > 1.4 * b) {
      const settle = swing.t1 + .45 * b;
      keys.push({ time: settle, value: .5 });
      if (next) keys.push({ time: Math.max(settle + .05, next.t0 - .45 * b), value: .5 });
    }
  }
  keys.push({ time: Math.min(t1, footEnd + .3 * b), value: .5 }, { time: t1, value: .5 });
  keys.sort((a, b) => a.time - b.time);
  const weightAt = (time: number) => {
    let index = keys.findIndex(key => key.time > time);
    if (index <= 0) return index === 0 ? keys[0].value : keys.at(-1)!.value;
    const a = keys[index - 1], c = keys[index], u = (time - a.time) / Math.max(1e-6, c.time - a.time);
    return lerp(a.value, c.value, .5 - .5 * Math.cos(Math.PI * clamp(u, 0, 1)));
  };

  // First pass: everything except pelvis height.
  type Frame = { time: number; layers: Layers; L: ReturnType<typeof footAt>; R: ReturnType<typeof footAt>; root: [number, number]; yaw: number; desiredY: number; capY: number };
  const frames: Frame[] = [];
  for (const time of [t0, ...times, ...(interval ? [t1] : [])]) {
    const layers = layersAt(time), L = footAt('L', time), R = footAt('R', time);
    const wl = clamp(weightAt(time) + layers.weightBias * .5, .08, .92);
    const yaw = (L.yaw + R.yaw) / 2 + layers.hipYaw;
    const c = Math.cos(yaw), s = Math.sin(yaw);
    // Pelvis over the weighted support plus a small forward offset (mid-foot).
    let x = lerp(R.x, L.x, wl) + .025 * s + layers.swayX * c + layers.swayZ * s;
    let z = lerp(R.z, L.z, wl) + .025 * c - layers.swayX * s + layers.swayZ * c;
    // Weight stays nearer the centre while lunging.
    const centred = clamp(layers.lunge / .06, 0, 1) * .5;
    x = lerp(x, (L.x + R.x) / 2, centred); z = lerp(z, (L.z + R.z) / 2, centred);
    frames.push({ time, layers, L, R, root: [x, z], yaw, desiredY: STAND_HEIGHT - layers.bounce - layers.lunge, capY: Infinity });
  }
  // Position-space seams: pelvis and both feet start exactly where (and as
  // fast as) the boundary has them, then fade to the generated stance with a
  // quintic over the seam width. Legs are then solved by IK, so the remaining
  // joint-space seam residual is small and feet do not dip through the floor.
  {
    const seams = [{ boundary: input.start, frame: frames[0], width: estimatedStart, at: (time: number) => time - t0, sign: 1 as const },
      ...(interval ? [{ boundary: input.end, frame: frames.at(-1)!, width: estimatedEnd, at: (time: number) => t1 - time, sign: -1 as const }] : [])]
      .map(seam => {
        const feet = boundaryFeet(seam.boundary);
        return { ...seam, feet, root: [seam.boundary.pose.root[0] - seam.frame.root[0], seam.boundary.pose.root[2] - seam.frame.root[1]],
          drop: clamp(seam.boundary.pose.root[1] - seam.frame.desiredY, -.3, .05),
          L: { x: feet.L.position.x - seam.frame.L.x, y: feet.L.position.y - seam.frame.L.y, z: feet.L.position.z - seam.frame.L.z, yaw: wrapAngle(feet.L.yaw - seam.frame.L.yaw) },
          R: { x: feet.R.position.x - seam.frame.R.x, y: feet.R.position.y - seam.frame.R.y, z: feet.R.position.z - seam.frame.R.z, yaw: wrapAngle(feet.R.yaw - seam.frame.R.yaw) } };
      });
    for (const frame of frames) for (const seam of seams) {
      const tau = seam.at(frame.time);
      if (tau >= seam.width) continue;
      const v = seam.boundary.linearVelocity, [h0] = fadeWeights(tau, seam.width);
      // Momentum is absorbed over a short, friction-feasible window: the
      // pelvis keeps its boundary velocity, then stops over the support.
      const momentum = clamp(.3 + Math.hypot(v[0], v[2]) / 2.5, .35, .9), [, h1] = tau < momentum ? fadeWeights(tau, momentum) : [0, 0];
      frame.root = [frame.root[0] + seam.root[0] * h0 + seam.sign * v[0] * h1, frame.root[1] + seam.root[1] * h0 + seam.sign * v[2] * h1];
      // Only lower towards a boundary: raising onto near-straight legs makes the
      // knee angle hypersensitive; the joint-space seam covers the remainder.
      frame.desiredY += seam.drop * h0;
      for (const side of ['L', 'R'] as const) {
        const foot = frame[side], offset = seam[side], velocity = seam.feet[side].velocity;
        // Feet settle faster than the pelvis: a foot caught in the air lands.
        const width = Math.min(seam.width, clamp(.3 + 1.5 * Math.hypot(offset.x, offset.y, offset.z) + .15 * velocity.length(), .3, 1.2));
        const [f0, f1] = tau < width ? fadeWeights(tau, width) : [0, 0];
        const y = foot.y + offset.y * f0 + seam.sign * velocity.y * f1;
        foot.x += offset.x * f0 + seam.sign * velocity.x * f1; foot.z += offset.z * f0 + seam.sign * velocity.z * f1;
        foot.yaw += offset.yaw * f0 + seam.sign * seam.feet[side].yawVelocity * f1;
        // Never below the floor unless the boundary itself is.
        foot.y = Math.max(y, Math.min(DANCE_ANKLE_FLOOR_HEIGHT, seam.feet[side].position.y));
      }
      frame.yaw = (frame.L.yaw + frame.R.yaw) / 2 + frame.layers.hipYaw;
    }
  }
  // Feet must not cross or touch (turning or interpolated stances): keep a
  // minimum ankle spacing, wider when the feet point in different directions.
  for (const frame of frames) {
    const dx = frame.L.x - frame.R.x, dz = frame.L.z - frame.R.z, spacing = Math.hypot(dx, dz);
    const minimum = .2 + .06 * Math.min(1, Math.abs(wrapAngle(frame.L.yaw - frame.R.yaw)) / (Math.PI / 2));
    if (spacing < minimum && spacing > 1e-6) {
      const push = (minimum - spacing) / 2 / spacing;
      frame.L.x += dx * push; frame.L.z += dz * push; frame.R.x -= dx * push; frame.R.z -= dz * push;
    }
  }
  // Pelvis travel: a short Gaussian filter removes acceleration corners where
  // weight-transfer segments meet. Feet are solved afterwards, so they stay put.
  {
    const dt = duration / steps, sigma = .08, reach = Math.ceil(3 * sigma / dt);
    const xs = frames.map(frame => frame.root[0]), zs = frames.map(frame => frame.root[1]);
    for (const [index, frame] of frames.entries()) {
      let x = 0, z = 0, total = 0;
      for (let k = Math.max(0, index - reach); k <= Math.min(frames.length - 1, index + reach); k++) {
        const w = Math.exp(-.5 * ((k - index) * dt / sigma) ** 2); x += xs[k] * w; z += zs[k] * w; total += w;
      }
      frame.root = [x / total, z / total];
    }
  }
  // Leg reach caps the pelvis height for the (smoothed) pelvis position.
  for (const frame of frames) {
    const c = Math.cos(frame.yaw), s = Math.sin(frame.yaw), [x, z] = frame.root;
    for (const [foot, sign] of [[frame.L, 1], [frame.R, -1]] as const) {
      const horizontal = Math.hypot(foot.x - (x + sign * HIP_HALF_WIDTH * c), foot.z - (z - sign * HIP_HALF_WIDTH * s));
      frame.capY = Math.min(frame.capY, foot.y + HIP_DROP + Math.sqrt(Math.max(.04, MAX_REACH * MAX_REACH - horizontal * horizontal)));
    }
  }
  // Pelvis height: the (smooth) desired height minus a smooth reach excess.
  // The excess over the leg-reach cap is dilated by three standard deviations
  // and then Gaussian-blurred, so the result still stays under the cap while
  // its own acceleration stays small (no min-filter corners).
  const step = duration / steps, sigma = .1, spread = Math.max(1, Math.ceil(3 * sigma / step));
  const excess = frames.map(frame => Math.max(0, frame.desiredY - frame.capY));
  const dilated = excess.map((_, index) => { let high = 0; for (let k = Math.max(0, index - spread); k <= Math.min(excess.length - 1, index + spread); k++) high = Math.max(high, excess[k]); return high; });
  const heights = frames.map((frame, index) => {
    let total = 0, weight = 0;
    for (let k = Math.max(0, index - spread); k <= Math.min(dilated.length - 1, index + spread); k++) { const w = Math.exp(-.5 * ((k - index) * step / sigma) ** 2); total += dilated[k] * w; weight += w; }
    return frame.desiredY - Math.max(total / weight, excess[index]);
  });

  // Second pass: construct poses.
  const generated = frames.map((frame, index) => buildPose(frame, heights[index]));
  // Join fixed boundaries (and the full-mode initial pose) by displacement
  // mapping: exact pose and velocity at the seam, fading out with zero slope
  // and curvature. Larger offsets get longer fades.
  const dt = frames[1].time - frames[0].time;
  const startDisplacement = boundaryDisplacement(input.start, generated[0], generated[1], dt, 1);
  const endDisplacement = interval ? boundaryDisplacement(input.end, generated.at(-1)!, generated.at(-2)!, frames.at(-1)!.time - frames.at(-2)!.time, -1) : undefined;
  const startWidth = fadeWidth(startDisplacement, b, duration, seamScale), endWidth = endDisplacement ? fadeWidth(endDisplacement, b, duration, seamScale) : 0;
  const touchesFloor = (pose: Pose) => getMotionMinimumFloorHeight(pose) < .02;
  const startGrounded = touchesFloor(startPose), endGrounded = interval && touchesFloor(endPose);
  const outside = new Set<JointName>();
  for (const pose of interval ? [startPose, endPose] : [startPose]) for (const joint of JOINT_NAMES) if (!isFunctionalJointWithinLimits(joint, pose.joints[joint])) outside.add(joint);
  const result: { time: number; pose: Pose }[] = [], lifts: { lift: number; fade: number }[] = [];
  for (const [index, frame] of frames.entries()) {
    if (index === 0) continue;
    if (interval && index === frames.length - 1) continue;
    const tau0 = frame.time - t0, tau1 = t1 - frame.time;
    let pose = applyDisplacements(generated[index], [
      { displacement: startDisplacement, tau: tau0, width: startWidth, sign: 1 },
      ...(endDisplacement ? [{ displacement: endDisplacement, tau: tau1, width: endWidth, sign: -1 as const }] : []),
    ]);
    // Displaced legs no longer reach the feet exactly. Re-solve them by IK to
    // the (already seam-displaced) foot targets and blend that in from the
    // boundary, where the original legs are kept exactly, so planted feet do
    // not dip or slide while the rest of the body is displaced.
    const legWeight = Math.min(1 - fadeWeights(tau0, Math.min(startWidth, .6))[0], endDisplacement ? 1 - fadeWeights(tau1, Math.min(endWidth, .6))[0] : 1);
    if (legWeight > 0 && (tau0 < startWidth || !!endDisplacement && tau1 < endWidth)) {
      const solved = legJoints(new Quaternion(...pose.joints.Hips), pose.root, frame.L, frame.R);
      for (const [joint, rotation] of Object.entries(solved) as [JointName, Quaternion][]) {
        if (outside.has(joint)) continue;
        pose.joints[joint] = projectFunctionalJoint(joint, toQuat(new Quaternion(...pose.joints[joint]).slerp(rotation, legWeight)), SYNTH_PROFILE);
      }
    }
    // Lift the pelvis a few millimetres if anything still dips into the floor.
    const inSeam = tau0 < startWidth || !!endDisplacement && tau1 < endWidth;
    if (inSeam) {
      // Joints that are inside the envelope at the boundary stay inside; joints
      // the boundary itself places outside are left to return gradually.
      for (const joint of JOINT_NAMES) if (!outside.has(joint)) pose.joints[joint] = projectFunctionalJoint(joint, pose.joints[joint], SYNTH_PROFILE);
    }
    {
      // Keep the lowest point on the floor while the seam mixes two leg
      // configurations: lift small dips, and lower small hovers when the
      // boundary itself stands on the floor. Continuous in the measured
      // height; large offsets (a boundary below the floor, a real jump) are
      // left alone for the inherited tolerance and the gate.
      const lowest = getMotionMinimumFloorHeight(pose);
      const grounded = tau0 < startWidth && startGrounded || !!endDisplacement && tau1 < endWidth && endGrounded;
      // Seams move the legs quickly; keep more clearance there so the curve
      // between samples cannot dip below the floor tolerance.
      const error = lowest - (inSeam ? .008 : .003);
      // Both corrections fade in from zero at the fixed boundary itself.
      const seamFade = smoother(tau0 / .12) * (endDisplacement ? smoother(tau1 / .12) : 1);
      // Outside seams only dips are lifted (deep knee bends with a tilted foot).
      const weight = error < 0 ? 1 - smoother((-error - .025) / .025) : inSeam && grounded ? 1 - smoother((error - .015) / .025) : 0;
      lifts.push({ lift: -error * weight, fade: seamFade });
    }
    result.push({ time: frame.time, pose });
  }
  // The lowest body point switches between heel, toe and other parts, so the
  // raw per-sample lift has corners. Lifts are dilated then blurred (and
  // never less than needed); lowerings are blurred and may exceed the raw amount by
  // at most 4 mm (they target 8 mm clearance, so the floor is still clear).
  // Both still fade to zero at fixed boundaries.
  {
    const sigma = .05, spread = Math.max(1, Math.ceil(3 * sigma / (duration / steps)));
    // A one-sigma dilation keeps the blurred lift at (or within a fraction of
    // a millimetre of) the raw lift without holding the body up for long.
    const near = Math.max(1, Math.ceil(sigma / (duration / steps)));
    const window = (values: number[], pick: (a: number, b: number) => number) => values.map((value, index) => {
      let out = value; for (let k = Math.max(0, index - near); k <= Math.min(values.length - 1, index + near); k++) out = pick(out, values[k]); return out; });
    const blur = (values: number[]) => values.map((_, index) => {
      let total = 0, weight = 0;
      for (let k = Math.max(0, index - spread); k <= Math.min(values.length - 1, index + spread); k++) { const w = Math.exp(-.5 * ((k - index) * (duration / steps) / sigma) ** 2); total += values[k] * w; weight += w; }
      return total / weight; });
    const up = blur(window(lifts.map(item => Math.max(0, item.lift)), Math.max));
    const down = blur(lifts.map(item => Math.max(0, -item.lift)));
    for (const [index, sample] of result.entries()) {
      const lift = Math.max(up[index], Math.max(0, lifts[index].lift)) - Math.min(down[index], Math.max(0, -lifts[index].lift) + .004);
      if (lift) sample.pose = { ...sample.pose, root: [sample.pose.root[0], sample.pose.root[1] + lift * lifts[index].fade, sample.pose.root[2]] };
    }
  }
  repairArmContacts(result, () => true,
    // The correction itself fades to zero at fixed boundaries.
    time => smoother((time - t0) / .3) * (interval ? smoother((t1 - time) / .3) : 1), duration / steps, outside);
  return { samples: result, segments: scheduled, steps: swings.length, blendSeconds: { start: Math.max(startBlend, startWidth), end: interval ? Math.max(endBlend, endWidth) : endBlend } };
}

/**
 * Seams interpolate between two arm configurations and can sweep a forearm
 * through the pelvis or a thigh. Abduct the affected upper arm just enough,
 * with a smooth correction profile, wherever the body proxies report contact.
 */
function repairArmContacts(samples: { time: number; pose: Pose }[], inSeam: (time: number) => boolean, fade: (time: number) => number, dt: number, outside: Set<JointName>): void {
  let collisions: typeof getCapsuleCollisions;
  try { getCapsuleCollisions(samples[0]?.pose ?? neutralStandingPose({ root: [0, 1, 0], joints: {} as Pose['joints'] }, { L: { x: .1, z: 0, yaw: 0 }, R: { x: -.1, z: 0, yaw: 0 } })); collisions = getCapsuleCollisions; }
  catch { return; } // Collision backend not loaded; the gate still decides.
  for (const [side, sign] of [['Left', 1], ['Right', -1]] as const) {
    const joint = `${side}UpperArm` as JointName;
    if (outside.has(joint)) continue;
    const touches = (pose: Pose) => collisions(pose).selfCollisions.some(collision => collision.segments.some(segment => segment.startsWith(`${side}-`) && /arm|hand/i.test(segment)));
    const fore = `${side}ForeArm` as JointName;
    // Open the arm away from the body and straighten the elbow a little: this
    // frees a hand from the pelvis, thighs and the head alike.
    const rotate = (pose: Pose, angle: number): Pose => {
      const elbow = new Quaternion(...pose.joints[fore]), bent = 2 * Math.atan2(Math.hypot(elbow.x, elbow.y, elbow.z), Math.abs(elbow.w));
      const opened = elbow.multiply(new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), Math.min(angle * .8, Math.max(0, bent - .1))));
      return { ...pose, joints: { ...pose.joints,
        [joint]: projectFunctionalJoint(joint, toQuat(new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), sign * angle).multiply(new Quaternion(...pose.joints[joint]))), SYNTH_PROFILE),
        [fore]: outside.has(fore) ? pose.joints[fore] : projectFunctionalJoint(fore, toQuat(opened), SYNTH_PROFILE) } };
    };
    const needed = samples.map(sample => {
      if (!inSeam(sample.time) || !touches(sample.pose)) return 0;
      for (let angle = 4 * RAD; angle <= 36 * RAD; angle += 4 * RAD) if (!touches(rotate(sample.pose, angle))) return angle + 2 * RAD;
      return 36 * RAD;
    });
    if (!needed.some(Boolean)) continue;
    // Dilate then blur: the smoothed profile still covers every needed sample.
    const radius = Math.max(1, Math.round(.12 / dt));
    const dilated = needed.map((_, index) => Math.max(...needed.slice(Math.max(0, index - 2 * radius), index + 2 * radius + 1)));
    const smooth = dilated.map((_, index) => {
      let total = 0, weight = 0;
      for (let k = Math.max(0, index - radius); k <= Math.min(dilated.length - 1, index + radius); k++) { const w = 1 - Math.abs(k - index) / (radius + 1); total += dilated[k] * w; weight += w; }
      return total / weight;
    });
    for (const [index, sample] of samples.entries()) { const angle = smooth[index] * fade(sample.time); if (angle > 1e-6) sample.pose = rotate(sample.pose, angle); }
  }
}

type FootTarget = { x: number; y: number; z: number; yaw: number };
/** Legs by analytic IK from the pelvis (root + Hips rotation) to the ankle targets. */
function legJoints(hips: Quaternion, root: Vec3, left: FootTarget, right: FootTarget): Partial<Record<JointName, Quaternion>> {
  const joints: Partial<Record<JointName, Quaternion>> = {};
  for (const [side, sign, foot] of [['Left', 1, left], ['Right', -1, right]] as const) {
    const hip = new Vector3(sign * HIP_HALF_WIDTH, -HIP_DROP, 0).applyQuaternion(hips).add(new Vector3(...root));
    const footWorld = yawQuat(foot.yaw);
    // Knees track the toes, turned slightly out.
    const knee = new Vector3(0, 0, 1).applyQuaternion(footWorld).add(new Vector3(sign * .3, 0, 0).applyQuaternion(footWorld));
    const { thigh, shin } = solveLeg(hip, new Vector3(foot.x, foot.y, foot.z), knee);
    joints[`${side}UpperLeg`] = hips.clone().invert().multiply(thigh);
    joints[`${side}LowerLeg`] = thigh.clone().invert().multiply(shin);
    joints[`${side}Foot`] = shin.clone().invert().multiply(footWorld);
  }
  return joints;
}

function neutralStandingPose(reference: Pose, stance: { L: FootState; R: FootState }): Pose {
  const layers = neutralLayers(), L = { ...stance.L, y: DANCE_ANKLE_FLOOR_HEIGHT, swing: 0 }, R = { ...stance.R, y: DANCE_ANKLE_FLOOR_HEIGHT, swing: 0 };
  const yaw = (L.yaw + R.yaw) / 2;
  return buildPose({ layers, L, R, root: [(L.x + R.x) / 2 + .025 * Math.sin(yaw), (L.z + R.z) / 2 + .025 * Math.cos(yaw)], yaw }, Math.min(STAND_HEIGHT, reference.root[1] + .5));
}

function buildPose(frame: { layers: Layers; L: { x: number; y: number; z: number; yaw: number; swing: number }; R: { x: number; y: number; z: number; yaw: number; swing: number }; root: [number, number]; yaw: number }, height: number): Pose {
  const { layers } = frame, joints = {} as Record<JointName, Quaternion>;
  for (const joint of JOINT_NAMES) joints[joint] = new Quaternion();
  const hips = yawQuat(frame.yaw).multiply(euler(layers.hipPitch, 0, layers.hipRoll));
  joints.Hips = hips;
  joints.Spine = euler(layers.spineFlex, layers.spineTwist, -layers.spineSide);
  joints.Chest = euler(layers.chestFlex, layers.chestTwist, -layers.chestSide);
  joints.Neck = euler(layers.headNod * .4, layers.headTurn * .4 - (layers.spineTwist + layers.chestTwist) * .5, -layers.headTilt * .4 + (layers.spineSide + layers.chestSide) * .3);
  joints.Head = euler(layers.headNod * .6 - (layers.spineFlex + layers.chestFlex) * .35, layers.headTurn * .6, -layers.headTilt * .6 + (layers.spineSide + layers.chestSide) * .3);
  for (const [side, sign] of [['Left', 1], ['Right', -1]] as const) {
    const params = side === 'Left' ? layers.left : layers.right;
    joints[`${side}Shoulder`] = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), sign * params.shrug);
    joints[`${side}UpperArm`] = armRotation(params, sign);
    joints[`${side}ForeArm`] = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), -clamp(params.elbow, 0, 2.5));
    joints[`${side}Hand`] = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), params.wrist);
  }
  const root: Vec3 = [frame.root[0], height, frame.root[1]];
  Object.assign(joints, legJoints(hips, root, frame.L, frame.R));
  const pose: Pose = { root, joints: {} as Pose['joints'] };
  for (const joint of JOINT_NAMES) pose.joints[joint] = projectFunctionalJoint(joint, toQuat(joints[joint]), SYNTH_PROFILE);
  return pose;
}
