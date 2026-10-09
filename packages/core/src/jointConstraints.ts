import { rotationFromDegrees, rotationToDegrees } from './keyframes';
import type { JointName, Quat, Vec3 } from './motion-types';

export type JointAxisLimits = readonly [number, number];
export type JointRotationLimits = readonly [JointAxisLimits, JointAxisLimits, JointAxisLimits];
type Profile = {
  limits: JointRotationLimits;
  axis?: 0 | 1;
  /** Quaternion twist about the longitudinal axis, in degrees. */
  twist?: JointAxisLimits;
  /** Total swing away from the longitudinal rest axis, in degrees. */
  cone?: number;
  /** Near-hinge secondary swing radii, respectively about local Y and Z. */
  secondary?: readonly [number, number];
  readOnly?: boolean;
  unrestricted?: boolean;
};

function bounds(x: JointAxisLimits, y: JointAxisLimits, z: JointAxisLimits): JointRotationLimits {
  return Object.freeze([Object.freeze([...x]), Object.freeze([...y]), Object.freeze([...z])]) as JointRotationLimits;
}

function ball(x: JointAxisLimits, y: JointAxisLimits, z: JointAxisLimits, cone: number): Profile {
  return { limits: bounds(x, y, z), axis: 1, twist: y, cone };
}

const terminal: Profile = { limits: bounds([0, 0], [0, 0], [0, 0]), readOnly: true };
// The extra quaternion degree covers the tiny X twist introduced by permitted
// secondary intrinsic Y/Z rotations. The Euler flexion bounds stay strict.
const elbow: Profile = { limits: bounds([-145, 0], [-8, 8], [-5, 5]), axis: 0, twist: [-146, 1], secondary: [8, 5] };
const knee: Profile = { limits: bounds([0, 145], [-4, 4], [-3, 3]), axis: 0, twist: [-1, 146], secondary: [4, 3] };

/**
 * Conservative editing envelopes for the original preview rig, not clinical ROM
 * or a collision/whole-body solver. The logical joint frames have no rest
 * pre-rotation. +Y is up, +Z is forward, anatomical Left is +X; limb children
 * point along -Y. Thus elbows flex about -X and knees about +X on BOTH sides.
 * Left shoulder/hip abduction is +Z; right abduction is -Z. Hips rotates the
 * entire actor and remains unrestricted. Six terminal markers stay read-only.
 *
 * Euler bounds are the numeric-control envelope. Quaternion swing/twist also
 * limits combined extremes: being inside every Euler bound alone is not enough.
 * Do not apply this table while loading, sampling, baking or migrating a take.
 */
const profiles: Record<JointName, Profile> = {
  Hips: { limits: bounds([-180, 180], [-180, 180], [-180, 180]), unrestricted: true },
  Spine: ball([-20, 35], [-25, 25], [-25, 25], 40),
  Chest: ball([-20, 35], [-30, 30], [-25, 25], 40),
  Neck: ball([-25, 35], [-45, 45], [-25, 25], 40),
  Head: ball([-20, 25], [-25, 25], [-20, 20], 30),
  LeftShoulder: ball([-20, 20], [-20, 20], [-10, 30], 35),
  RightShoulder: ball([-20, 20], [-20, 20], [-30, 10], 35),
  LeftUpperArm: ball([-120, 45], [-65, 65], [-15, 150], 150),
  RightUpperArm: ball([-120, 45], [-65, 65], [-150, 15], 150),
  LeftForeArm: elbow,
  RightForeArm: elbow,
  LeftHand: ball([-60, 60], [-15, 15], [-25, 25], 65),
  RightHand: ball([-60, 60], [-15, 15], [-25, 25], 65),
  LeftHandTip: terminal,
  RightHandTip: terminal,
  LeftUpperLeg: ball([-110, 25], [-35, 35], [-20, 45], 110),
  RightUpperLeg: ball([-110, 25], [-35, 35], [-45, 20], 110),
  LeftLowerLeg: knee,
  RightLowerLeg: knee,
  LeftFoot: ball([-20, 40], [-12, 12], [-15, 25], 45),
  RightFoot: ball([-20, 40], [-12, 12], [-25, 15], 45),
  LeftToe: terminal,
  RightToe: terminal,
  LeftHeel: terminal,
  RightHeel: terminal,
};

const epsilon = 1e-7;
const toDegrees = 180 / Math.PI;
const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value));
const inside = (value: number, [low, high]: JointAxisLimits) => value >= low - epsilon && value <= high + epsilon;
const wrapDegrees = (angle: number) => ((angle + 180) % 360 + 360) % 360 - 180;

function profile(joint: JointName): Profile {
  const result = Object.hasOwn(profiles, joint) ? profiles[joint] : undefined;
  if (!result) throw new Error('关节不属于当前预览骨架。');
  return result;
}

function normalize(rotation: Quat): Quat {
  if (!Array.isArray(rotation) || rotation.length !== 4 || rotation.some(value => typeof value !== 'number' || !Number.isFinite(value))) {
    throw new Error('局部旋转必须包含四个有限的 XYZW 分量。');
  }
  const scale = Math.max(...rotation.map(Math.abs));
  if (scale <= Number.EPSILON) throw new Error('局部旋转不能是零四元数或无效四元数。');
  // Scale first so a finite, large input cannot overflow during normalization.
  const scaled = rotation.map(value => value / scale) as Quat;
  const length = Math.hypot(...scaled);
  return scaled.map(value => value / length) as Quat;
}

/** Canonicalize only a new edit, so saving its displayed draft is bit-exact. */
export function canonicalEditRotation(rotation: Quat): Quat {
  const robust = normalize(rotation), length = Math.hypot(...rotation);
  const result = Number.isFinite(length) ? rotation.map(value => value / length) as Quat : robust;
  if (Math.hypot(...result) === 1) return result;
  // Repeated division can cycle between adjacent floats. Adjust one component
  // by one representable step instead; this only settles floating-point rounding.
  // A jump across 1 moves to the next largest nonzero component, whose smaller
  // step can resolve a skipped value. It does not change the editing envelopes.
  const order = [0, 1, 2, 3].filter(axis => result[axis] !== 0).sort((a, b) => Math.abs(result[b]) - Math.abs(result[a]));
  const bits = new DataView(new ArrayBuffer(8));
  let rank = 0;
  for (let step = 0; step <= 64; step++) {
    const norm = Math.hypot(...result);
    if (norm === 1) return result;
    if (step === 64) break;
    const axis = order[rank], sign = Math.sign(result[axis]);
    bits.setFloat64(0, Math.abs(result[axis]));
    bits.setBigUint64(0, bits.getBigUint64(0) + (norm > 1 ? -1n : 1n));
    result[axis] = sign * bits.getFloat64(0);
    if ((norm - 1) * (Math.hypot(...result) - 1) < 0) rank = (rank + 1) % order.length;
  }
  throw new Error('局部旋转未能规范化为稳定的单位四元数。');
}

function withinEuler(degrees: Vec3, limits: JointRotationLimits): boolean {
  return degrees.every((angle, axis) => inside(angle, limits[axis]));
}

function multiply(a: Quat, b: Quat): Quat {
  const [x, y, z, w] = a, [u, v, s, t] = b;
  return [w * u + x * t + y * s - z * v, w * v - x * s + y * t + z * u, w * s + x * v - y * u + z * t, w * t - x * u - y * v - z * s];
}

/** A left twist factor: q = twist * swing, with swing orthogonal to that axis. */
function swingTwist(rotation: Quat, axis: 0 | 1): { twist: number; swing: Quat; angle: number } {
  const length = Math.hypot(rotation[axis], rotation[3]);
  const twist: Quat = [0, 0, 0, 1];
  if (length > 1e-12) { twist[axis] = rotation[axis] / length; twist[3] = rotation[3] / length; }
  let swing = multiply([-twist[0], -twist[1], -twist[2], twist[3]], rotation);
  if (swing[3] < 0) swing = swing.map(value => -value) as Quat;
  return {
    twist: wrapDegrees(2 * Math.atan2(twist[axis], twist[3]) * toDegrees),
    swing,
    angle: 2 * Math.atan2(Math.hypot(swing[0], swing[1], swing[2]), Math.max(0, swing[3])) * toDegrees,
  };
}

function within(rotation: Quat, settings: Profile): boolean {
  if (settings.readOnly || settings.unrestricted) return true;
  if (!withinEuler(rotationToDegrees(rotation), settings.limits)) return false;
  const decomposition = swingTwist(rotation, settings.axis!);
  if (!inside(decomposition.twist, settings.twist!)) return false;
  if (settings.cone !== undefined && decomposition.angle > settings.cone + epsilon) return false;
  if (settings.secondary) {
    const length = Math.hypot(decomposition.swing[1], decomposition.swing[2]);
    if (length > 1e-12) {
      const y = decomposition.angle * decomposition.swing[1] / length / settings.secondary[0];
      const z = decomposition.angle * decomposition.swing[2] / length / settings.secondary[1];
      if (y * y + z * z > 1 + 1e-9) return false;
    }
  }
  return true;
}

/** Check both the public predicate and the normalization used to save a K. */
function withinAfterNormalization(rotation: Quat, settings: Profile): boolean {
  if (!within(normalize(rotation), settings)) return false;
  const length = Math.hypot(...rotation);
  const saved = rotation.map(value => value / length) as Quat;
  return within(normalize(saved), settings);
}

function fromNeutral(rotation: Quat, amount: number): Quat {
  const q = rotation[3] < 0 ? rotation.map(value => -value) as Quat : rotation;
  const angle = Math.acos(clamp(q[3], -1, 1));
  if (angle < 1e-12) return [0, 0, 0, 1];
  const scale = Math.sin(angle * amount) / Math.sin(angle);
  return normalize([q[0] * scale, q[1] * scale, q[2] * scale, Math.cos(angle * amount)]);
}

/** Read-only, intrinsic XYZ bounds for numeric controls. */
export function getJointRotationLimits(joint: JointName): JointRotationLimits {
  return profile(joint).limits;
}

/** Display an existing rotation without repairing it or changing its authority. */
export function jointRotationToDegrees(joint: JointName, rotation: Quat): Vec3 {
  profile(joint);
  return rotationToDegrees(normalize(rotation));
}

export function isJointRotationWithinLimits(joint: JointName, rotation: Quat): boolean {
  return within(normalize(rotation), profile(joint));
}

/**
 * Project a newly edited joint only. Existing takes/keys must retain their values.
 * Numerically stable legal rotations retain their orientation and sign. A
 * coupled violation or a boundary unstable under normalization moves the
 * Euler-bounded quaternion toward neutral along its shortest SLERP arc, which
 * may select the equivalent quaternion sign. The result satisfies both the
 * numeric and physical envelopes even after K normalization.
 */
export function constrainJointRotation(joint: JointName, rotation: Quat): Quat {
  const settings = profile(joint), normalized = canonicalEditRotation(rotation);
  if (withinAfterNormalization(normalized, settings)) return normalized;
  const degrees = rotationToDegrees(normalized).map((value, axis) => clamp(value, ...settings.limits[axis])) as Vec3;
  const bounded = canonicalEditRotation(rotationFromDegrees(degrees));
  if (withinAfterNormalization(bounded, settings)) return bounded;
  let low = 0, high = 1;
  for (let iteration = 0; iteration < 60; iteration++) {
    const middle = (low + high) / 2;
    if (within(normalize(fromNeutral(bounded, middle)), settings)) low = middle;
    else high = middle;
  }
  // A boundary result can cross the same envelope after another normalization
  // during a K write. Move a tiny distance inward and verify the returned unit
  // quaternion with the public predicate's normalization; keep the limits strict.
  for (let inset = 1e-12; ; inset *= 2) {
    const projected = canonicalEditRotation(fromNeutral(bounded, Math.max(0, low - inset)));
    if (withinAfterNormalization(projected, settings)) return projected;
  }
}

/** Convenience for intrinsic XYZ numeric input; persists the returned quaternion. */
export function constrainJointRotationDegrees(joint: JointName, degrees: Vec3): Vec3 {
  const settings = profile(joint);
  // Validate even unrestricted/read-only input; ordinary numeric angles clamp
  // before conversion so typing 720 cannot wrap around into an unrelated pose.
  const supplied = rotationFromDegrees(degrees);
  const bounded = settings.readOnly || settings.unrestricted ? supplied : rotationFromDegrees(degrees.map((value, axis) => clamp(value, ...settings.limits[axis])) as Vec3);
  return jointRotationToDegrees(joint, constrainJointRotation(joint, bounded));
}
