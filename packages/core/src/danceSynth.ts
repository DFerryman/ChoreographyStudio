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
import { DANCE_MOVES, type DanceEnergy, type DanceMoveId, type DancePlan } from './dancePlan';

export const DANCE_SYNTH_VERSION = 'dance-synth-1' as const;
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
export interface DanceSegment { move: DanceMoveId; startSeconds: number; endSeconds: number; mirror: boolean }
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

/**
 * Layer functions. `beat` is the time in beats since the move began (0 = on
 * the count), `side` is +1 (lead left) or -1 (lead right), `amp(a, period)`
 * returns the amplitude limited by tempo for an oscillation of `period` beats.
 */
type Amp = (amplitude: number, periodBeats: number, linear?: boolean) => number;
function moveLayers(move: DanceMoveId, beat: number, side: number, amp: Amp, energy: number): Layers {
  const l = neutralLayers(), L = l.left, R = l.right;
  const lead = side > 0 ? L : R, trail = side > 0 ? R : L;
  const c1 = Math.cos(TAU * beat), s1 = Math.sin(TAU * beat);
  const c2 = Math.cos(TAU * beat / 2), s2 = Math.sin(TAU * beat / 2);
  const s4 = Math.sin(TAU * beat / 4);
  const down = (a: number) => amp(a, 1, true) * (.5 + .5 * c1); // deepest on the count
  const e = energy;
  // Arms: `elev` is the angle from hanging (0) towards overhead (π), `fwd` the
  // azimuth from the side plane (0) towards the front (π/2).
  const swingArms = (base: number, size: number, period: number) => {
    const wave = amp(size, period) * (period === 2 ? s2 : s1);
    L.elev = base + Math.max(0, wave); R.elev = base + Math.max(0, -wave); L.fwd = R.fwd = 1.1;
  };
  switch (move) {
    case 'groove':
      l.bounce = down(.035 * e); l.swayX = amp(.03 * e, 2, true) * s2; l.spineSide = amp(.05, 2) * s2;
      l.headTilt = amp(.05, 2) * s2;
      L.elev = .3 + amp(.25 * e, 2) * (.5 + .5 * s2); R.elev = .3 + amp(.25 * e, 2) * (.5 - .5 * s2); L.fwd = R.fwd = 1.2; L.elbow = R.elbow = .8;
      break;
    case 'bounce':
      l.bounce = down(.06 * e); l.spineFlex = amp(.08, 1) * (.5 + .5 * c1); l.headNod = amp(.12, 1) * (.5 + .5 * c1);
      L.elev = R.elev = .5; L.fwd = R.fwd = 1; L.elbow = R.elbow = 1.2 + amp(.35 * e, 1) * c1;
      break;
    case 'step-touch': case 'side-step':
      l.bounce = down(.025 * e); swingArms(.3, .35 * e, 2); L.elbow = R.elbow = .9;
      l.spineTwist = amp(.08, 2) * s2; l.headTurn = -amp(.06, 2) * s2;
      break;
    case 'forward-back': case 'box-step': case 'v-step':
      l.bounce = down(.02 * e); l.chestTwist = amp(.1, 2) * s2;
      lead.elev = .4 + amp(.3 * e, 2) * (.5 - .5 * c2); trail.elev = .4 + amp(.3 * e, 2) * (.5 + .5 * c2);
      L.fwd = R.fwd = .5; L.elbow = R.elbow = .7;
      break;
    case 'march':
      swingArms(.2, .45 * e, 2); L.elbow = R.elbow = 1; l.spineTwist = amp(.06, 2) * s2;
      break;
    case 'turn':
      l.bounce = .015 * e; L.elev = R.elev = .95 + amp(.15, 4) * s4; L.fwd = R.fwd = .35; L.elbow = R.elbow = .35;
      l.headTurn = .12 * side;
      break;
    case 'hip-sway':
      l.swayX = amp(.06 * e, 2, true) * s2; l.hipRoll = amp(.07 * e, 2) * s2; l.weightBias = amp(.45, 2, true) * s2;
      l.spineSide = -amp(.06, 2) * s2; l.chestSide = -amp(.04, 2) * s2; l.bounce = down(.015);
      L.elev = R.elev = .6; L.fwd = R.fwd = .95; L.elbow = R.elbow = 1.25; L.twist = R.twist = .3;
      break;
    case 'arm-wave': {
      const wave = amp(.3 * e, 2) * s2;
      L.elev = 2 + wave; R.elev = 2 - wave; L.fwd = R.fwd = .45; L.elbow = .3 - .2 * s2; R.elbow = .3 + .2 * s2;
      L.wrist = amp(.3, 1) * s1; R.wrist = -amp(.3, 1) * s1;
      l.spineSide = amp(.07, 2) * -s2; l.swayX = amp(.03, 2, true) * s2; l.bounce = down(.015);
      break;
    }
    case 'reach-up': {
      const up = .5 - .5 * c2;
      lead.elev = .35 + amp(2 * e, 2) * up; lead.elbow = .5 - .35 * up;
      trail.elev = .35 + amp(2 * e, 2) * (1 - up); trail.elbow = .5 - .35 * (1 - up);
      L.fwd = R.fwd = .75; l.spineSide = amp(.06, 2) * (side > 0 ? -1 : 1) * (2 * up - 1); l.headNod = -.06; l.bounce = down(.015);
      break;
    }
    case 'punch': {
      const out = (phase: number) => Math.max(0, Math.sin(TAU * phase / 2)) ** 2;
      const pl = out(beat), pr = out(beat + 1);
      // sin² pulses oscillate once per beat with half their peak amplitude.
      const pulse = (a: number) => 2 * amp(a / 2, 1);
      L.elev = .5 + pulse(1 * e) * pl; L.elbow = 1.8 - pulse(1.5 * e) * pl;
      R.elev = .5 + pulse(1 * e) * pr; R.elbow = 1.8 - pulse(1.5 * e) * pr;
      L.fwd = R.fwd = 1.4; l.chestTwist = pulse(.14 * e) * (pr - pl); l.bounce = down(.04 * e); l.spineFlex = .06;
      break;
    }
    case 'body-roll': {
      const roll = (lag: number) => Math.sin(TAU * (beat / 2 - lag));
      l.chestFlex = amp(.18 * e, 2) * roll(0); l.spineFlex = amp(.12 * e, 2) * roll(.12); l.hipPitch = -amp(.08 * e, 2) * roll(.25);
      l.headNod = amp(.12, 2) * roll(-.1); l.bounce = amp(.03, 2, true) * (.5 + .5 * roll(.25));
      L.elev = R.elev = .45; L.fwd = R.fwd = .6; L.elbow = R.elbow = .9;
      break;
    }
    case 'clap': {
      const close = Math.max(0, Math.cos(TAU * beat / 2)) ** 3;
      L.elev = R.elev = .75 + .25 * close; L.fwd = R.fwd = 1.05 + .3 * close; L.twist = R.twist = .2 + .55 * close;
      L.elbow = R.elbow = 1.1; l.bounce = down(.03 * e); l.headNod = amp(.06, 1) * c1;
      break;
    }
    case 'kick':
      l.spineFlex = -.04; L.elev = R.elev = .7; L.fwd = R.fwd = .3; L.elbow = R.elbow = .9; l.bounce = down(.015);
      break;
    case 'lunge': {
      const hold = smoother(beat / 1.2) * (1 - smoother((beat - 2) / 1.2));
      l.lunge = .09 * e * hold; lead.elev = .35 + 1.15 * hold; lead.fwd = .25; lead.elbow = .5 - .35 * hold;
      trail.elev = .35 + .55 * hold; trail.fwd = .4; trail.elbow = .9; l.spineSide = -.1 * side * hold; l.headTurn = .25 * side * hold;
      break;
    }
    case 'shoulder-pop': {
      const pop = (phase: number) => Math.max(0, Math.cos(TAU * phase / 2)) ** 2;
      L.shrug = 2 * amp(.11 * e, 1) * pop(beat); R.shrug = 2 * amp(.11 * e, 1) * pop(beat + 1);
      l.chestSide = amp(.05, 2) * (pop(beat + 1) - pop(beat)); l.bounce = down(.025 * e);
      L.elev = R.elev = .45; L.fwd = R.fwd = .9; L.elbow = R.elbow = 1.4;
      break;
    }
    case 'pose': {
      const breath = amp(.04, 4) * s4;
      lead.elev = 2.1; lead.fwd = .5; lead.elbow = .15; trail.elev = .65; trail.fwd = .4; trail.elbow = .45;
      l.spineSide = -.07 * side; l.headTurn = .2 * side; l.headNod = -.05 + breath; l.chestFlex = -.04 + breath;
      break;
    }
  }
  return l;
}

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
type FootOp = { beat: number; foot: Foot; to: (stance: Stance) => FootState; height?: number; reach?: Swing['reach']; recenter?: boolean };
function moveFootwork(move: DanceMoveId, beats: number, side: number, scale: number): { ops: FootOp[]; facingDelta?: number } {
  const lead: Foot = side > 0 ? 'L' : 'R', trail: Foot = side > 0 ? 'R' : 'L';
  const d = .22 * scale, ops: FootOp[] = [];
  const repeat = (pattern: (offset: number) => FootOp[]) => { for (let offset = 0; offset + 4 <= beats + 1e-9; offset += 4) ops.push(...pattern(offset)); };
  switch (move) {
    case 'step-touch':
      repeat(o => [
        { beat: o, foot: lead, to: s => homeFoot(s, lead, side * d) },
        { beat: o + 1, foot: trail, to: s => homeFoot(s, trail, side * d) },
        { beat: o + 2, foot: trail, to: s => homeFoot(s, trail) },
        { beat: o + 3, foot: lead, to: s => homeFoot(s, lead) },
      ]);
      break;
    case 'side-step':
      // Travel two step-togethers to one side; the stance centre moves with it.
      repeat(o => [
        { beat: o, foot: lead, to: s => homeFoot(s, lead, side * d) },
        { beat: o + 1, foot: trail, to: s => homeFoot(s, trail, side * d), recenter: true },
        { beat: o + 2, foot: lead, to: s => homeFoot(s, lead, side * d) },
        { beat: o + 3, foot: trail, to: s => homeFoot(s, trail, side * d), recenter: true },
      ]);
      break;
    case 'forward-back':
      repeat(o => [
        { beat: o, foot: lead, to: s => homeFoot(s, lead, 0, d) },
        { beat: o + 1, foot: lead, to: s => homeFoot(s, lead) },
        { beat: o + 2, foot: trail, to: s => homeFoot(s, trail, 0, -d * .8) },
        { beat: o + 3, foot: trail, to: s => homeFoot(s, trail) },
      ]);
      break;
    case 'box-step':
      repeat(o => [
        { beat: o, foot: lead, to: s => homeFoot(s, lead, 0, d) },
        { beat: o + 1, foot: trail, to: s => homeFoot(s, trail, -side * d * .5, d) },
        { beat: o + 2, foot: lead, to: s => homeFoot(s, lead) },
        { beat: o + 3, foot: trail, to: s => homeFoot(s, trail) },
      ]);
      break;
    case 'v-step':
      repeat(o => [
        { beat: o, foot: lead, to: s => homeFoot(s, lead, side * d * .55, d * .8, side * .2) },
        { beat: o + 1, foot: trail, to: s => homeFoot(s, trail, -side * d * .55, d * .8, -side * .2) },
        { beat: o + 2, foot: lead, to: s => homeFoot(s, lead) },
        { beat: o + 3, foot: trail, to: s => homeFoot(s, trail) },
      ]);
      break;
    case 'march':
      for (let beat = 0; beat < beats; beat++) {
        const foot = beat % 2 ? trail : lead;
        ops.push({ beat, foot, to: s => homeFoot(s, foot), height: .06 * scale + .02 });
      }
      break;
    case 'kick':
      for (let beat = 0; beat + 2 <= beats; beat += 2) {
        const foot = (beat / 2) % 2 ? trail : lead;
        ops.push({ beat, foot, to: s => homeFoot(s, foot), height: .04, reach: { lateral: 0, forward: .24 * scale, height: .14 * scale } });
      }
      break;
    case 'lunge':
      repeat(o => [
        { beat: o, foot: lead, to: s => homeFoot(s, lead, side * .2 * scale) },
        { beat: o + 3, foot: lead, to: s => homeFoot(s, lead) },
      ]);
      break;
    case 'turn': {
      // Alternate feet, each turning 90° per step, so both feet advance 90° every
      // two beats and the pelvis (their circular mean) never twists >45°.
      const first: Foot = side > 0 ? 'L' : 'R', second: Foot = first === 'L' ? 'R' : 'L';
      const steps = Math.floor(beats);
      for (let beat = 0; beat < steps; beat++) {
        const foot = beat % 2 ? second : first, quarter = Math.floor(beat / 2) + 1;
        ops.push({ beat, foot, to: s => {
          const yaw = s.facing + side * Math.PI / 2 * quarter;
          const lateral = foot === 'L' ? FOOT_HALF_WIDTH : -FOOT_HALF_WIDTH;
          return { x: s.center[0] + lateral * Math.cos(yaw), z: s.center[1] - lateral * Math.sin(yaw), yaw };
        } });
      }
      // Complete the second foot when an odd number of steps was scheduled.
      return { ops, facingDelta: side * Math.PI / 2 * Math.ceil(steps / 2) };
    }
    default: break;
  }
  return { ops };
}

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
  const down = new Vector3(0, -1, 0), elev = clamp(params.elev, 0, 2.6), fwd = clamp(params.fwd, -.3, 1.57);
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
export function scheduleDanceSegments(plan: DancePlan, startSeconds: number, endSeconds: number, beatSeconds: number): DanceSegment[] {
  const segments: DanceSegment[] = [];
  const firstBeat = Math.ceil(startSeconds / beatSeconds - 1e-6);
  const lastBeat = Math.floor(endSeconds / beatSeconds + 1e-6);
  let beat = firstBeat, index = 0, cycle = 0;
  while (beat < lastBeat && plan.moves.length) {
    const item = plan.moves[index], beats = Math.min(item.beats, lastBeat - beat);
    if (beats >= 1) segments.push({ move: item.move, startSeconds: beat * beatSeconds, endSeconds: (beat + beats) * beatSeconds, mirror: item.mirror !== (cycle % 2 === 1) });
    beat += beats; index++;
    if (index >= plan.moves.length) { index = 0; cycle++; }
  }
  return segments;
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

  // Schedule moves on the musical beat grid between the blend windows.
  const segments = footEnd - footStart >= b ? scheduleDanceSegments(plan, footStart, footEnd, b) : [];
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
    return 2 * Math.max(plan.moves.some(move => move.move === 'turn') ? 2 : 1, Math.ceil(span / .3));
  })();
  const scheduled: DanceSegment[] = [];
  const footworkEnd = footEnd - returnBeats * b;
  for (const segment of segments) {
    if (segment.startSeconds >= footworkEnd - 1e-9) { scheduled.push({ ...segment }); continue; }
    scheduled.push(segment);
    const info = DANCE_MOVES.find(move => move.id === segment.move)!;
    if (!info.footwork) continue;
    const beats = Math.round((segment.endSeconds - segment.startSeconds) / b);
    let side = segment.mirror ? 1 : -1;
    // Keep travel inside the stage: lead away from the far side.
    const offset = [stance.center[0] - stance.travelOrigin[0], stance.center[1] - stance.travelOrigin[1]];
    if (Math.hypot(...offset) > STAGE_RADIUS * .55) {
      const lateralAxis = [Math.cos(stance.facing), -Math.sin(stance.facing)];
      side = offset[0] * lateralAxis[0] + offset[1] * lateralAxis[1] > 0 ? -1 : 1;
    }
    // Shorter steps at fast tempos keep the swing-leg acceleration in budget.
    const { ops } = moveFootwork(segment.move, beats, side, clamp(intensity * (.55 + .45 * energy), .15, 1) * clamp((b / .5) ** 1.5, .6, 1));
    const segmentStance: Stance = { ...stance, L: { ...stance.L }, R: { ...stance.R }, center: [...stance.center] as [number, number] };
    for (const op of ops) {
      // Steps land on the count; they must finish before the reserved return.
      const land = segment.startSeconds + (op.beat + 1) * b - (op.reach ? .5 * b : 0);
      if (land > footworkEnd + 1e-9 || land - swingSeconds < footStart - 1e-9) continue;
      const destination = op.to(segmentStance);
      addSwing(op.foot, op.reach ? segment.startSeconds + (op.beat + 1.5) * b : land, destination, op.height ?? .07, op.reach, op.reach ? b : swingSeconds);
      if (op.recenter) { recenter(); segmentStance.center = [...stance.center]; }
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
    const begin = Math.max(footStart, swings.at(-1)?.t1 ?? footStart) + .05;
    // Steps never run into the end seam: fewer, longer steps when time is short
    // (the seam displacement absorbs any remainder).
    const fit = Math.floor((footEnd - begin) / (2 * .3));
    const pairs = Math.min(fit, Math.max(1, Math.ceil(distance / .3), Math.ceil(turn / (80 * RAD))));
    const stepSeconds = pairs > 0 ? Math.min(b, (footEnd - begin) / (2 * pairs)) : 0;
    const duration = Math.min(swingSeconds, stepSeconds * .85);
    const order: Foot[] = Math.hypot(final.L.x - fromL.x, final.L.z - fromL.z) >= Math.hypot(final.R.x - fromR.x, final.R.z - fromR.z) ? ['L', 'R'] : ['R', 'L'];
    let land = begin;
    for (let pair = 1; pair <= pairs; pair++) {
      for (const foot of order) {
        land += stepSeconds;
        if (land - duration < footStart) continue;
        const from = foot === 'L' ? fromL : fromR, to = final[foot], u = pair / pairs;
        addSwing(foot, land, { x: lerp(from.x, to.x, u), z: lerp(from.z, to.z, u), yaw: from.yaw + wrapAngle(to.yaw - from.yaw) * u }, .05, undefined, duration);
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

  // Tempo-aware amplitude limit for an oscillation of `period` beats.
  const amp: Amp = (amplitude, period, linear) => {
    const omega = TAU / (period * b);
    const limit = (linear ? COM_ACCELERATION : LAYER_ACCELERATION) / (omega * omega);
    return Math.sign(amplitude) * Math.min(Math.abs(amplitude) * intensity, limit);
  };
  const envelope = (time: number) => smoother((time - t0) / startBlend) * (interval ? smoother((t1 - time) / endBlend) : smoother((t1 - .4 - time) / Math.max(.3, endBlend - .4)));
  const layersAt = (time: number): Layers => {
    const result = neutralLayers(), half = .5 * b;
    for (const segment of scheduled) {
      if (time < segment.startSeconds - half || time > segment.endSeconds + half) continue;
      const weight = smoother((time - segment.startSeconds + half) / (2 * half)) * (1 - smoother((time - segment.endSeconds + half) / (2 * half)));
      if (weight <= 0) continue;
      addScaled(result, moveLayers(segment.move, (time - segment.startSeconds) / b, segment.mirror ? 1 : -1, amp, energy), weight);
    }
    const scaled = neutralLayers();
    addScaled(scaled, result, envelope(time));
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
  const shift = clamp((b / .55) ** 2, .35, 1) * .42;
  for (const [index, swing] of swings.entries()) {
    keys.push({ time: (swing.t0 + swing.t1) / 2, value: swing.foot === 'L' ? .5 - shift : .5 + shift });
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
  // Pelvis height: reach cap by erosion then blur, so it never exceeds the cap.
  const radius = Math.max(2, Math.round(.12 / (duration / steps)));
  const raw = frames.map(frame => Math.min(frame.desiredY, frame.capY));
  const eroded = raw.map((_, index) => { let low = Infinity; for (let k = Math.max(0, index - 2 * radius); k <= Math.min(raw.length - 1, index + 2 * radius); k++) low = Math.min(low, raw[k]); return low; });
  const heights = eroded.map((_, index) => {
    let total = 0, weight = 0;
    for (let k = Math.max(0, index - radius); k <= Math.min(raw.length - 1, index + radius); k++) { const w = 1 - Math.abs(k - index) / (radius + 1); total += eroded[k] * w; weight += w; }
    return Math.min(total / weight, raw[index]);
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
  const result: { time: number; pose: Pose }[] = [];
  for (const [index, frame] of frames.entries()) {
    if (index === 0) continue;
    if (interval && index === frames.length - 1) continue;
    const tau0 = frame.time - t0, tau1 = t1 - frame.time;
    let pose = applyDisplacements(generated[index], [
      { displacement: startDisplacement, tau: tau0, width: startWidth, sign: 1 },
      ...(endDisplacement ? [{ displacement: endDisplacement, tau: tau1, width: endWidth, sign: -1 as const }] : []),
    ]);
    // Displaced legs are no longer exactly solved; lift the pelvis a few
    // millimetres if that dips a foot into the floor.
    if (tau0 < startWidth || endDisplacement && tau1 < endWidth) {
      // Joints that are inside the envelope at the boundary stay inside; joints
      // the boundary itself places outside are left to return gradually.
      for (const joint of JOINT_NAMES) if (!outside.has(joint)) pose.joints[joint] = projectFunctionalJoint(joint, pose.joints[joint], SYNTH_PROFILE);
      // Keep the lowest point on the floor while the seam mixes two leg
      // configurations: lift small dips, and lower small hovers when the
      // boundary itself stands on the floor. Continuous in the measured
      // height; large offsets (a boundary below the floor, a real jump) are
      // left alone for the inherited tolerance and the gate.
      const lowest = getMotionMinimumFloorHeight(pose);
      const grounded = tau0 < startWidth && startGrounded || !!endDisplacement && tau1 < endWidth && endGrounded;
      const error = lowest - .0015;
      // Both corrections fade in from zero at the fixed boundary itself.
      const seamFade = smoother(tau0 / .12) * (endDisplacement ? smoother(tau1 / .12) : 1);
      const weight = seamFade * (error < 0 ? 1 - smoother((-error - .025) / .025) : grounded ? 1 - smoother((error - .015) / .025) : 0);
      if (weight > 0) pose = { ...pose, root: [pose.root[0], pose.root[1] - error * weight, pose.root[2]] };
    }
    result.push({ time: frame.time, pose });
  }
  repairArmContacts(result, time => time - t0 < startWidth || interval && t1 - time < endWidth,
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
    const rotate = (pose: Pose, angle: number): Pose => ({ ...pose, joints: { ...pose.joints, [joint]: projectFunctionalJoint(joint,
      toQuat(new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), sign * angle).multiply(new Quaternion(...pose.joints[joint]))), SYNTH_PROFILE) } });
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
  // Legs: hip joint positions from the pelvis, analytic IK to the ankle targets.
  const hipsWorld = hips.clone();
  for (const [side, sign, foot] of [['Left', 1, frame.L], ['Right', -1, frame.R]] as const) {
    const hip = new Vector3(sign * HIP_HALF_WIDTH, -HIP_DROP, 0).applyQuaternion(hipsWorld).add(new Vector3(...root));
    const footWorld = yawQuat(foot.yaw);
    // Knees track the toes, turned slightly out.
    const knee = new Vector3(0, 0, 1).applyQuaternion(footWorld).add(new Vector3(sign * .3, 0, 0).applyQuaternion(footWorld));
    const { thigh, shin } = solveLeg(hip, new Vector3(foot.x, foot.y, foot.z), knee);
    joints[`${side}UpperLeg`] = hipsWorld.clone().invert().multiply(thigh);
    joints[`${side}LowerLeg`] = thigh.clone().invert().multiply(shin);
    joints[`${side}Foot`] = shin.clone().invert().multiply(footWorld);
  }
  const pose: Pose = { root, joints: {} as Pose['joints'] };
  for (const joint of JOINT_NAMES) pose.joints[joint] = projectFunctionalJoint(joint, toQuat(joints[joint]), SYNTH_PROFILE);
  return pose;
}
