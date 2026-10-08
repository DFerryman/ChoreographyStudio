import { Matrix4, Quaternion, Vector3 } from 'three';
import type { Collider } from '@dimforge/rapier3d-compat';
import { STANDARD_HUMAN_PROFILE as PROFILE, type HumanSegment } from './humanProfile';
import { clonePose, evaluatePose } from './humanoid';
import { constrainJointRotation } from './jointConstraints';
import { JOINT_NAMES, type BakedTake, type Pose, type Quat, type Vec3 } from './motion-types';
import { sampleTake } from './index';

export type MotionState = 'quasi-static' | 'dynamic' | 'airborne';
export interface EvaluatedSegment {
  id: string; proximal: Vec3; distal: Vec3; center: Vec3;
  massKg: number; radiusMeters: number; definition: HumanSegment;
}
export interface FootContact {
  minimumHeightMeters: number;
  soleCorners: Vec3[];
  contactPoints: Vec3[];
  grounded: boolean;
}
export interface PoseDiagnostics {
  profileId: typeof PROFILE.id;
  centerOfMass: Vec3;
  segments: EvaluatedSegment[];
  /** Pose-dependent aggregate principal inertia, in kg m². */
  principalInertia: Vec3;
  inertiaFrame: Quat;
  feet: Record<'Left' | 'Right', FootContact>;
  supportPolygon: Vec3[];
  balance: 'supported' | 'outside-support' | 'dynamic-unassessed' | 'airborne';
  floorPenetrations: { segmentId: string; depthMeters: number }[];
  selfCollisions: { segments: [string, string]; depthMeters: number }[];
}

const vector = (v: readonly number[]) => new Vector3(v[0], v[1], v[2]);
const tuple = (v: Vector3) => v.toArray() as Vec3;
const rotation = (q: Quat) => new Quaternion(...q);
const object = (v: readonly number[]) => ({ x: v[0], y: v[1], z: v[2] });
const quaternionObject = (q: Quat) => ({ x: q[0], y: q[1], z: q[2], w: q[3] });
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

/** Convex hull in the ground XZ plane; points retain y=0. */
function hull(points: Vec3[]): Vec3[] {
  const sorted = [...new Map(points.map(p => [`${p[0].toFixed(8)},${p[2].toFixed(8)}`, [p[0], 0, p[2]] as Vec3])).values()]
    .sort((a, b) => a[0] - b[0] || a[2] - b[2]);
  if (sorted.length < 3) return sorted;
  const cross = (a: Vec3, b: Vec3, c: Vec3) => (b[0] - a[0]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[0] - a[0]);
  const lower: Vec3[] = [], upper: Vec3[] = [];
  for (const p of sorted) { while (lower.length >= 2 && cross(lower.at(-2)!, lower.at(-1)!, p) <= 0) lower.pop(); lower.push(p); }
  for (const p of [...sorted].reverse()) { while (upper.length >= 2 && cross(upper.at(-2)!, upper.at(-1)!, p) <= 0) upper.pop(); upper.push(p); }
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}
function insideSupport(point: Vec3, polygon: Vec3[]): boolean {
  return polygon.length >= 3 && polygon.every((a, index) => {
    const b = polygon[(index + 1) % polygon.length];
    return (b[0] - a[0]) * (point[2] - a[2]) - (b[2] - a[2]) * (point[0] - a[0]) >= -1e-7;
  });
}

/** Symmetric tensor eigensystem. Columns of basis are principal inertia axes. */
function principalAxes(tensor: number[][]): { principalInertia: Vec3; inertiaFrame: Quat } {
  const a = tensor.map(row => [...row]);
  const basis = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  for (let iteration = 0; iteration < 24; iteration++) {
    let p = 0, q = 1;
    for (const [i, j] of [[0, 1], [0, 2], [1, 2]]) if (Math.abs(a[i][j]) > Math.abs(a[p][q])) { p = i; q = j; }
    if (Math.abs(a[p][q]) < 1e-10) break;
    const angle = .5 * Math.atan2(2 * a[p][q], a[q][q] - a[p][p]);
    const c = Math.cos(angle), s = Math.sin(angle);
    const oldP = a[p][p], oldQ = a[q][q], oldPQ = a[p][q];
    a[p][p] = c * c * oldP - 2 * s * c * oldPQ + s * s * oldQ;
    a[q][q] = s * s * oldP + 2 * s * c * oldPQ + c * c * oldQ;
    a[p][q] = a[q][p] = 0;
    for (let k = 0; k < 3; k++) if (k !== p && k !== q) {
      const pk = a[p][k], qk = a[q][k];
      a[p][k] = a[k][p] = c * pk - s * qk;
      a[q][k] = a[k][q] = s * pk + c * qk;
    }
    for (let k = 0; k < 3; k++) {
      const kp = basis[k][p], kq = basis[k][q];
      basis[k][p] = c * kp - s * kq; basis[k][q] = s * kp + c * kq;
    }
  }
  const m = new Matrix4().set(basis[0][0], basis[0][1], basis[0][2], 0, basis[1][0], basis[1][1], basis[1][2], 0, basis[2][0], basis[2][1], basis[2][2], 0, 0, 0, 0, 1);
  return { principalInertia: [Math.max(.001, a[0][0]), Math.max(.001, a[1][1]), Math.max(.001, a[2][2])], inertiaFrame: new Quaternion().setFromRotationMatrix(m).normalize().toArray() as Quat };
}

function segmentDistance(a: EvaluatedSegment, b: EvaluatedSegment): number {
  const p = vector(a.proximal), q = vector(b.proximal), u = vector(a.distal).sub(p), v = vector(b.distal).sub(q), w = p.clone().sub(q);
  const aa = u.dot(u), bb = u.dot(v), cc = v.dot(v), dd = u.dot(w), ee = v.dot(w);
  if (aa < 1e-12 && cc < 1e-12) return p.distanceTo(q);
  let s = aa > 1e-12 ? clamp((bb * ee - cc * dd) / Math.max(1e-12, aa * cc - bb * bb), 0, 1) : 0;
  let t = cc > 1e-12 ? clamp((bb * s + ee) / cc, 0, 1) : 0;
  if (aa > 1e-12) s = clamp((bb * t - dd) / aa, 0, 1);
  if (cc > 1e-12) t = clamp((bb * s + ee) / cc, 0, 1);
  return p.addScaledVector(u, s).distanceTo(q.addScaledVector(v, t));
}
function related(a: HumanSegment, b: HumanSegment): boolean {
  if ((a.id === 'thorax' && b.family === 'head') || (b.id === 'thorax' && a.family === 'head')) return true;
  if ([a.proximal, a.distal].some(joint => joint === b.proximal || joint === b.distal)) return true;
  // Anatomical attachments naturally overlap their trunk proxies.
  return (a.id === 'thorax' && b.id.endsWith('upper-arm')) || (b.id === 'thorax' && a.id.endsWith('upper-arm'))
    || (a.id === 'pelvis' && b.id.endsWith('thigh')) || (b.id === 'pelvis' && a.id.endsWith('thigh'));
}

/** Read-only proxy diagnostics. Static balance is a hint only for quiet poses. */
export function analyzePose(pose: Pose, options: { motionState?: MotionState } = {}): PoseDiagnostics {
  const joints = evaluatePose(pose);
  const point = (joint: keyof typeof joints, offset: readonly number[]) => tuple(vector(offset).applyQuaternion(rotation(joints[joint].rotation)).add(vector(joints[joint].position)));
  const segments = PROFILE.segments.map(definition => {
    const proximal = point(definition.proximal, definition.proximalOffset), distal = point(definition.distal, definition.distalOffset);
    return { id: definition.id, proximal, distal, center: tuple(vector(proximal).lerp(vector(distal), definition.centerFraction)), massKg: definition.massFraction * PROFILE.massKg, radiusMeters: definition.radiusMeters, definition };
  });
  const centerOfMass = tuple(segments.reduce((sum, s) => sum.addScaledVector(vector(s.center), s.massKg / PROFILE.massKg), new Vector3()));
  const tensor = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (const segment of segments) {
    const axis = vector(segment.distal).sub(vector(segment.proximal));
    const length = axis.length(); axis.normalize();
    const parallel = .5 * segment.massKg * segment.radiusMeters ** 2;
    const perpendicular = segment.massKg * (3 * segment.radiusMeters ** 2 + length ** 2) / 12;
    const u = tuple(axis), d = tuple(vector(segment.center).sub(vector(centerOfMass))), d2 = d.reduce((sum, value) => sum + value * value, 0);
    let local: number[][] | undefined;
    if (segment.definition.family === 'foot') {
      const [x, y, z] = PROFILE.foot.halfExtents;
      const diagonal = [segment.massKg * (y * y + z * z) / 3, segment.massKg * (x * x + z * z) / 3, segment.massKg * (x * x + y * y) / 3];
      const axes = [new Vector3(1, 0, 0), new Vector3(0, 1, 0), new Vector3(0, 0, 1)].map(v => tuple(v.applyQuaternion(rotation(joints[segment.definition.proximal].rotation))));
      local = [0, 1, 2].map(i => [0, 1, 2].map(j => diagonal.reduce((sum, value, k) => sum + value * axes[k][i] * axes[k][j], 0)));
    }
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) tensor[i][j] += (local?.[i][j] ?? ((i === j ? perpendicular : 0) + (parallel - perpendicular) * u[i] * u[j])) + segment.massKg * ((i === j ? d2 : 0) - d[i] * d[j]);
  }
  const feet = Object.fromEntries((['Left', 'Right'] as const).map(side => {
    const joint = `${side}Foot` as const;
    const soleCorners = [-PROFILE.foot.halfWidthMeters, PROFILE.foot.halfWidthMeters].flatMap(x => [PROFILE.foot.heelZ, PROFILE.foot.toeZ].map(z => point(joint, [x, -PROFILE.foot.soleOffsetMeters, z])));
    const topCorners = [-PROFILE.foot.halfWidthMeters, PROFILE.foot.halfWidthMeters].flatMap(x => [PROFILE.foot.heelZ, PROFILE.foot.toeZ].map(z => point(joint, [x, -.004, z])));
    const minimumHeightMeters = Math.min(...[...soleCorners, ...topCorners].map(p => p[1]));
    const contactPoints = soleCorners.filter(p => Math.abs(p[1]) <= PROFILE.ground.contactToleranceMeters && p[1] <= minimumHeightMeters + .012);
    return [side, { minimumHeightMeters, soleCorners, contactPoints, grounded: contactPoints.length > 0 }];
  })) as PoseDiagnostics['feet'];
  const supportPolygon = hull([...feet.Left.contactPoints, ...feet.Right.contactPoints]);
  const balance = options.motionState === 'dynamic' ? 'dynamic-unassessed' : options.motionState === 'airborne' || !supportPolygon.length ? 'airborne' : insideSupport(centerOfMass, supportPolygon) ? 'supported' : 'outside-support';
  const floorPenetrations = segments.flatMap(segment => {
    const minimum = segment.definition.family === 'foot' ? feet[segment.id.startsWith('Left') ? 'Left' : 'Right'].minimumHeightMeters : Math.min(segment.proximal[1], segment.distal[1]) - segment.radiusMeters;
    return minimum < -PROFILE.ground.penetrationToleranceMeters ? [{ segmentId: segment.id, depthMeters: -minimum }] : [];
  });
  const selfCollisions: PoseDiagnostics['selfCollisions'] = [];
  for (let i = 0; i < segments.length; i++) for (let j = i + 1; j < segments.length; j++) {
    const a = segments[i], b = segments[j];
    if (related(a.definition, b.definition)) continue;
    const depthMeters = a.radiusMeters + b.radiusMeters - segmentDistance(a, b);
    if (depthMeters > .012) selfCollisions.push({ segments: [a.id, b.id], depthMeters });
  }
  return { profileId: PROFILE.id, centerOfMass, segments, ...principalAxes(tensor), feet, supportPolygon, balance, floorPenetrations, selfCollisions };
}

export interface PhysicsTakeResult {
  take: BakedTake;
  profileId: typeof PROFILE.id;
  engine: 'rapier-0.21.0';
  fixedStepSeconds: number;
  stepCount: number;
  maxRootDisplacementMeters: number;
  airborneSamples: number;
  groundedSamples: number;
  maxLandingSpeedMps: number;
}
type BodyState = { position: Vec3; rotation: Quat; grounded: boolean };
let rapierInitialization: Promise<typeof import('@dimforge/rapier3d-compat')> | undefined;
async function loadRapier() {
  if (!rapierInitialization) rapierInitialization = import('@dimforge/rapier3d-compat').then(async module => { await module.init(); return module; }).catch(error => { rapierInitialization = undefined; throw error; });
  return rapierInitialization;
}
function abort(signal?: AbortSignal) { if (signal?.aborted) throw new DOMException('物理预览已取消。', 'AbortError'); }
function validate(take: BakedTake): number[] {
  const { durationSeconds: duration, times, poses } = take;
  if (!Number.isFinite(duration) || duration <= 0 || duration > PROFILE.simulation.maxDurationSeconds || times.length < 2 || times.length !== poses.length || times.length > PROFILE.simulation.maxSamples) throw new Error('物理预览需要 60 秒以内的有效动作与最多 6001 个样本。');
  if (times[0] !== 0 || times.at(-1) !== duration || times.some((time, index) => !Number.isFinite(time) || time < 0 || index > 0 && time <= times[index - 1])) throw new Error('物理预览的采样时刻必须递增，并包含起点和精确终点。');
  poses.forEach(pose => { evaluatePose(pose); if (pose.root.some(value => Math.abs(value) > 1000)) throw new Error('物理预览坐标超出资源范围。'); });
  const output = [...times];
  for (let frame = 0; frame / PROFILE.simulation.outputFps < duration; frame++) output.push(frame / PROFILE.simulation.outputFps);
  output.sort((a, b) => a - b);
  const unique = output.filter((time, index) => !index || time - output[index - 1] > 1e-9);
  if (unique.length > PROFILE.simulation.maxSamples) throw new Error('物理预览会超过 6001 个显式样本，请减少输入采样。');
  // Preserve every source timestamp exactly, including a source near a grid time.
  const result = unique.map(time => times.find(source => Math.abs(source - time) <= 1e-9) ?? time);
  return result;
}
function constrained(pose: Pose): Pose {
  const result = clonePose(pose);
  for (const joint of JOINT_NAMES) result.joints[joint] = constrainJointRotation(joint, result.joints[joint]);
  return result;
}
function contentId(take: BakedTake): string {
  let hash = 2166136261;
  for (const character of JSON.stringify([take.id, take.times, take.poses, PROFILE.id])) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619) >>> 0;
  return `physics_${hash.toString(16)}`;
}

/**
 * Explicit, cancellable dynamic-body assistance. Rapier 0.21.0 (Apache-2.0)
 * solves gravity, floor contacts, restitution and friction. Animated segment
 * colliders use the authored joint intent; their aggregate mass/CM/inertia feeds
 * one dynamic envelope, not a full independently driven jointed ragdoll.
 * Grounded XZ/upright drives are bounded. In flight those drives are released;
 * takeoff uses authored upward velocity and landing is a real contact response.
 * This function never mutates the supplied take, and is not called by playback.
 */
export async function simulatePhysicsTake(take: BakedTake, options: { signal?: AbortSignal; onProgress?: (fraction: number) => void } = {}): Promise<PhysicsTakeResult> {
  const outputTimes = validate(take);
  abort(options.signal);
  const RAPIER = await loadRapier();
  abort(options.signal);
  const dt = PROFILE.simulation.fixedStepSeconds, steps = Math.ceil(take.durationSeconds / dt);
  if (steps > PROFILE.simulation.maxSteps) throw new Error('物理预览固定步数超出范围。');
  const world = new RAPIER.World({ x: 0, y: -PROFILE.gravityMps2, z: 0 });
  world.timestep = dt;
  const initial = constrained(sampleTake(take, 0));
  const initialAnalysis = analyzePose(initial, { motionState: 'dynamic' });
  try {
    const ground = world.createCollider(RAPIER.ColliderDesc.cuboid(2048, .1, 2048).setTranslation(0, -.1, 0).setFriction(PROFILE.ground.friction).setRestitution(PROFILE.ground.restitution));
    const body = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(...initial.root).setCanSleep(false).setCcdEnabled(true));
    const colliders: Collider[] = initialAnalysis.segments.map(segment => {
      const description = segment.definition.family === 'foot'
        ? RAPIER.ColliderDesc.cuboid(...PROFILE.foot.halfExtents)
        : RAPIER.ColliderDesc.capsule(vector(segment.distal).distanceTo(vector(segment.proximal)) / 2, segment.radiusMeters);
      return world.createCollider(description.setDensity(0).setFriction(PROFILE.ground.friction).setRestitution(PROFILE.ground.restitution), body);
    });
    function updateEnvelope(pose: Pose, analysis: PoseDiagnostics) {
      const joints = evaluatePose(pose);
      analysis.segments.forEach((segment, index) => {
        const center = segment.definition.family === 'foot'
          ? vector(PROFILE.foot.center).applyQuaternion(rotation(joints[segment.definition.proximal].rotation)).add(vector(joints[segment.definition.proximal].position))
          : vector(segment.proximal).lerp(vector(segment.distal), .5);
        const orientation = segment.definition.family === 'foot'
          ? rotation(joints[segment.definition.proximal].rotation)
          : new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), vector(segment.distal).sub(vector(segment.proximal)).normalize());
        colliders[index].setTranslationWrtParent(object(tuple(center.sub(vector(pose.root)))));
        colliders[index].setRotationWrtParent(quaternionObject(orientation.toArray() as Quat));
      });
      body.setAdditionalMassProperties(PROFILE.massKg, object(tuple(vector(analysis.centerOfMass).sub(vector(pose.root)))), object(analysis.principalInertia), quaternionObject(analysis.inertiaFrame), true);
    }
    updateEnvelope(initial, initialAnalysis);
    const sourceVelocity = (time: number): Vec3 => {
      const before = Math.max(0, time - dt), after = Math.min(take.durationSeconds, time + dt);
      const a = sampleTake(take, before).root, b = sampleTake(take, after).root;
      return b.map((value, axis) => clamp((value - a[axis]) / Math.max(dt, after - before), -PROFILE.drive.maxTakeoffSpeedMps, PROFILE.drive.maxTakeoffSpeedMps)) as Vec3;
    };
    body.setLinvel(object(sourceVelocity(0)), true);
    const initialGrounded = Math.min(initialAnalysis.feet.Left.minimumHeightMeters, initialAnalysis.feet.Right.minimumHeightMeters) <= PROFILE.ground.contactToleranceMeters;
    const states: BodyState[] = [{ position: [...initial.root], rotation: [0, 0, 0, 1], grounded: initialGrounded }];
    let grounded = initialGrounded, previousIntentGrounded = initialGrounded, maxLandingSpeedMps = 0, airborneDownwardSpeed = 0;
    for (let step = 0; step < steps; step++) {
      abort(options.signal);
      const time = Math.min(step * dt, take.durationSeconds), desired = constrained(sampleTake(take, time)), analysis = analyzePose(desired, { motionState: 'dynamic' });
      updateEnvelope(desired, analysis);
      const velocity = body.linvel(), position = body.translation(), intendedVelocity = sourceVelocity(time);
      const intentGrounded = Math.min(analysis.feet.Left.minimumHeightMeters, analysis.feet.Right.minimumHeightMeters) <= PROFILE.ground.contactToleranceMeters;
      body.resetForces(true); body.resetTorques(true);
      if (grounded && previousIntentGrounded && !intentGrounded && intendedVelocity[1] > .15) body.applyImpulse({ x: 0, y: PROFILE.massKg * Math.max(0, intendedVelocity[1] - velocity.y), z: 0 }, true);
      if (grounded && (intentGrounded || intendedVelocity[1] <= .15)) {
        const acceleration = new Vector3(
          PROFILE.drive.positionGainPerSecondSquared * (desired.root[0] - position.x) + PROFILE.drive.velocityGainPerSecond * (intendedVelocity[0] - velocity.x),
          0,
          PROFILE.drive.positionGainPerSecondSquared * (desired.root[2] - position.z) + PROFILE.drive.velocityGainPerSecond * (intendedVelocity[2] - velocity.z),
        ).multiplyScalar(PROFILE.massKg).clampLength(0, PROFILE.drive.maxHorizontalForceNewtons);
        body.addForce(object(tuple(acceleration)), true);
        let q = body.rotation();
        const sign = q.w < 0 ? -1 : 1, angularVelocity = body.angvel();
        const torque = new Vector3(
          -2 * sign * q.x * PROFILE.drive.angularPositionGainPerSecondSquared - angularVelocity.x * PROFILE.drive.angularVelocityGainPerSecond,
          -2 * sign * q.y * PROFILE.drive.angularPositionGainPerSecondSquared - angularVelocity.y * PROFILE.drive.angularVelocityGainPerSecond,
          -2 * sign * q.z * PROFILE.drive.angularPositionGainPerSecondSquared - angularVelocity.z * PROFILE.drive.angularVelocityGainPerSecond,
        ).multiplyScalar(Math.max(...analysis.principalInertia)).clampLength(0, PROFILE.drive.maxUprightTorqueNewtonMeters);
        body.addTorque(object(tuple(torque)), true);
      }
      const preContactDownwardSpeed = Math.max(0, -body.linvel().y);
      if (!grounded) airborneDownwardSpeed = Math.max(airborneDownwardSpeed, preContactDownwardSpeed);
      world.step();
      let newGrounded = false;
      for (const collider of colliders) world.contactPair(collider, ground, manifold => {
        for (let contact = 0; contact < manifold.numContacts(); contact++) if (manifold.contactDist(contact) < .005) newGrounded = true;
      });
      // CCD can stop the velocity one step before the manifold is reported.
      // Retain the airborne approach speed until the actual contact appears.
      if (!grounded && newGrounded) maxLandingSpeedMps = Math.max(maxLandingSpeedMps, airborneDownwardSpeed);
      if (newGrounded) airborneDownwardSpeed = 0;
      grounded = newGrounded; previousIntentGrounded = intentGrounded;
      const p = body.translation(), q = body.rotation();
      if (![p.x, p.y, p.z, q.x, q.y, q.z, q.w].every(Number.isFinite) || Math.max(Math.abs(p.x), Math.abs(p.y), Math.abs(p.z)) > 1100) throw new Error('物理预览未得到有限稳定结果，原作品保持不变。');
      states.push({ position: [p.x, p.y, p.z], rotation: [q.x, q.y, q.z, q.w], grounded });
      if (step % 240 === 239) { options.onProgress?.((step + 1) / steps); await new Promise<void>(resolve => setTimeout(resolve, 0)); }
    }
    abort(options.signal);
    let maxRootDisplacementMeters = 0, airborneSamples = 0, groundedSamples = 0;
    const poses = outputTimes.map(time => {
      const fractional = time / dt, low = Math.min(states.length - 1, Math.floor(fractional + 1e-9)), high = Math.min(states.length - 1, low + 1), amount = clamp(fractional - low, 0, 1);
      const pose = constrained(sampleTake(take, time));
      const position = vector(states[low].position).lerp(vector(states[high].position), amount);
      const correction = rotation(states[low].rotation).slerp(rotation(states[high].rotation), amount);
      maxRootDisplacementMeters = Math.max(maxRootDisplacementMeters, position.distanceTo(vector(pose.root)));
      pose.root = tuple(position); pose.joints.Hips = correction.multiply(rotation(pose.joints.Hips)).normalize().toArray() as Quat;
      if (states[low].grounded) groundedSamples++; else airborneSamples++;
      return pose;
    });
    options.onProgress?.(1);
    return {
      take: { ...take, id: contentId(take), times: outputTimes, poses }, profileId: PROFILE.id, engine: 'rapier-0.21.0', fixedStepSeconds: dt, stepCount: steps,
      maxRootDisplacementMeters, airborneSamples, groundedSamples, maxLandingSpeedMps,
    };
  } finally { world.free(); }
}
