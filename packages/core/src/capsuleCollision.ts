import { Quaternion, Vector3 } from 'three';
import { AVATAR_COLLISION_PROFILE } from './avatarCapsules.generated';
import { STANDARD_HUMAN_PROFILE } from './humanProfile';
import { evaluatePose, RIG_DEFINITIONS, type EvaluatedPose } from './humanoid';
import { canonicalEditRotation, isJointRotationWithinLimits } from './jointConstraints';
import { JOINT_NAMES, type JointName, type Pose, type Quat, type Vec3 } from './motion-types';
import { getReadyRapierBackend } from './rapierBackend';
import type { Shape } from '@dimforge/rapier3d-compat';

type ColliderCommon = {
  readonly id: string; readonly anatomicalRegion: string;
  readonly proximal: JointName; readonly distal: JointName;
  readonly attachmentJoints: readonly JointName[];
  readonly family: 'trunk' | 'head' | 'arm' | 'leg' | 'foot';
};
export type AvatarColliderDefinition = ColliderCommon & (
  { readonly shape: 'capsule'; readonly proximalOffset: readonly [number, number, number]; readonly distalOffset: readonly [number, number, number]; readonly radiusMeters: number }
  | { readonly shape: 'box'; readonly centerOffset: readonly [number, number, number]; readonly halfExtents: readonly [number, number, number]; readonly localRotation: readonly [number, number, number, number] }
  | { readonly shape: 'convex'; readonly vertices: readonly (readonly [number, number, number])[]; readonly indices: readonly number[]; readonly bboxCenterOffset: readonly [number, number, number]; readonly bboxHalfExtents: readonly [number, number, number]; readonly bboxRotation: readonly [number, number, number, number] }
);
export interface AvatarCollisionProfile {
  readonly id: string;
  readonly colliders: readonly AvatarColliderDefinition[];
  /** Optional renderer-calibrated shoe corners, expressed in each Foot frame. */
  readonly footGround?: { readonly halfWidthMeters: number; readonly soleOffsetMeters: number; readonly heelZ: number; readonly toeZ: number; readonly topOffsetMeters?: number };
}
export type AvatarCapsuleDefinition = Extract<AvatarColliderDefinition, { shape: 'capsule' }>;
export type AvatarBoxDefinition = Extract<AvatarColliderDefinition, { shape: 'box' }>;
export type AvatarConvexDefinition = Extract<AvatarColliderDefinition, { shape: 'convex' }>;
export interface EvaluatedCapsule {
  shape: 'capsule';
  id: string;
  proximal: Vec3;
  distal: Vec3;
  radiusMeters: number;
  definition: AvatarCapsuleDefinition;
}
export interface EvaluatedBox {
  shape: 'box';
  id: string;
  center: Vec3;
  rotation: Quat;
  halfExtents: readonly [number, number, number];
  definition: AvatarBoxDefinition;
}
export interface EvaluatedConvex {
  shape: 'convex'; id: string; position: Vec3; rotation: Quat;
  bounds: EvaluatedBox; definition: AvatarConvexDefinition;
}
export type EvaluatedCollider = EvaluatedCapsule | EvaluatedBox | EvaluatedConvex;
export interface CapsuleCollisions {
  profileId: string;
  selfCollisions: { segments: [string, string]; depthMeters: number }[];
  floorPenetrations: { segmentId: string; depthMeters: number }[];
}
/** Small skin-proxy overlap is tolerated; this is independent of mass/inertia. */
export const CAPSULE_SELF_TOLERANCE_METERS = .003;
export const CAPSULE_FLOOR_TOLERANCE_METERS = STANDARD_HUMAN_PROFILE.ground.penetrationToleranceMeters;
export const CAPSULE_SWEEP_ROTATION_STEP_RADIANS = 2 * Math.PI / 180;
export const CAPSULE_SWEEP_TRANSLATION_STEP_METERS = .01;
const MAX_SWEEP_SAMPLES = 2048;
const DEPTH_ROUNDING_METERS = 1e-8;
const BISECTION_ITERATIONS = 22;
const clamp01 = (value: number) => Math.max(0, Math.min(1, value));
const dot = (a: readonly number[], b: readonly number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const subtract = (a: readonly number[], b: readonly number[]): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: readonly number[], b: readonly number[]): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

/**
 * Shortest distance between two finite segments, including parallel and point
 * segments. After clamping one parameter the other is recomputed at that end;
 * independent clamping of an infinite-line solution gives the wrong answer.
 * The cross-product determinant avoids subtracting nearly equal squared dots.
 */
export function finiteSegmentDistance(a0: readonly number[], a1: readonly number[], b0: readonly number[], b1: readonly number[]): number {
  const u = subtract(a1, a0), v = subtract(b1, b0), w = subtract(a0, b0);
  const aa = dot(u, u), bb = dot(u, v), cc = dot(v, v), dd = dot(u, w), ee = dot(v, w);
  let s = 0, t = 0;
  if (aa === 0 && cc === 0) return Math.hypot(...w);
  if (aa === 0) t = clamp01(ee / cc);
  else if (cc === 0) s = clamp01(-dd / aa);
  else {
    const normal = cross(u, v), determinant = dot(normal, normal);
    if (determinant > Number.EPSILON ** 2 * aa * cc) s = clamp01(dot(cross(v, w), normal) / determinant);
    t = (bb * s + ee) / cc;
    if (t < 0) { t = 0; s = clamp01(-dd / aa); }
    else if (t > 1) { t = 1; s = clamp01((bb - dd) / aa); }
  }
  return Math.hypot(w[0] + s * u[0] - t * v[0], w[1] + s * u[1] - t * v[1], w[2] + s * u[2] - t * v[2]);
}

function worldPoint(joints: EvaluatedPose, joint: JointName, offset: readonly number[]): Vec3 {
  return new Vector3(offset[0], offset[1], offset[2]).applyQuaternion(new Quaternion(...joints[joint].rotation)).add(new Vector3(...joints[joint].position)).toArray() as Vec3;
}
function collidersFromFK(joints: EvaluatedPose, profile: AvatarCollisionProfile): EvaluatedCollider[] {
  validateProfile(profile);
  return profile.colliders.map(definition => definition.shape === 'capsule' ? {
    shape: 'capsule', id: definition.id,
    proximal: worldPoint(joints, definition.proximal, definition.proximalOffset),
    distal: worldPoint(joints, definition.distal, definition.distalOffset),
    radiusMeters: definition.radiusMeters, definition,
  } : definition.shape === 'box' ? {
    shape: 'box', id: definition.id, center: worldPoint(joints, definition.proximal, definition.centerOffset),
    rotation: new Quaternion(...joints[definition.proximal].rotation).multiply(new Quaternion(...definition.localRotation).normalize()).normalize().toArray() as Quat,
    halfExtents: definition.halfExtents, definition,
  } : {
    shape: 'convex', id: definition.id, position: joints[definition.proximal].position, rotation: joints[definition.proximal].rotation, definition,
    bounds: {
      shape: 'box', id: definition.id, center: worldPoint(joints, definition.proximal, definition.bboxCenterOffset),
      rotation: new Quaternion(...joints[definition.proximal].rotation).multiply(new Quaternion(...definition.bboxRotation).normalize()).normalize().toArray() as Quat,
      halfExtents: definition.bboxHalfExtents,
      definition: { ...definition, shape: 'box', centerOffset: definition.bboxCenterOffset, halfExtents: definition.bboxHalfExtents, localRotation: definition.bboxRotation },
    },
  });
}

/** Renderer and editor diagnostics use the same canonical FK and offline fit. */
export function getPoseColliders(pose: Pose, profile: AvatarCollisionProfile = AVATAR_COLLISION_PROFILE): EvaluatedCollider[] { return collidersFromFK(evaluatePose(pose), profile); }
export function getPoseCapsules(pose: Pose, profile: AvatarCollisionProfile = AVATAR_COLLISION_PROFILE): EvaluatedCapsule[] { return getPoseColliders(pose, profile).filter((collider): collider is EvaluatedCapsule => collider.shape === 'capsule'); }

/** Only neighboring segments and actual shoulder/hip attachments are excluded. */
export function areCapsulesAnatomicallyAdjacent(a: AvatarColliderDefinition, b: AvatarColliderDefinition): boolean {
  if (a.attachmentJoints.some(joint => b.attachmentJoints.includes(joint))) return true;
  // Head and ribcage overlap through the short neck's attachment envelope.
  if (a.anatomicalRegion === 'head' && b.anatomicalRegion === 'thorax' || b.anatomicalRegion === 'head' && a.anatomicalRegion === 'thorax') return true;
  const attachment = (trunk: AvatarColliderDefinition, limb: AvatarColliderDefinition) => trunk.family === 'trunk'
    && (trunk.proximal === 'Chest' && ['LeftUpperArm', 'RightUpperArm'].includes(limb.proximal)
      || trunk.proximal === 'Hips' && ['LeftUpperLeg', 'RightUpperLeg'].includes(limb.proximal));
  return attachment(a, b) || attachment(b, a);
}

type Pair = { a: number; b: number };
const pairCache = new WeakMap<AvatarCollisionProfile, Pair[]>();
const validatedProfiles = new WeakSet<AvatarCollisionProfile>();
/** Profiles are immutable assets; validate once before evaluating their geometry. */
function validateProfile(profile: AvatarCollisionProfile): void {
  if (validatedProfiles.has(profile)) return;
  const validVector = (value: unknown, length: number): value is readonly number[] => Array.isArray(value) && value.length === length && value.every(component => typeof component === 'number' && Number.isFinite(component));
  if (!profile || typeof profile !== 'object' || typeof profile.id !== 'string' || !profile.id || !Array.isArray(profile.colliders) || !profile.colliders.length || profile.colliders.length > 128) throw new Error('人体碰撞配置需要有效标识和 1–128 个碰撞体。');
  const ids = new Set<string>();
  for (const collider of profile.colliders) {
    if (!collider || typeof collider.id !== 'string' || !collider.id || ids.has(collider.id) || !JOINT_NAMES.includes(collider.proximal) || !JOINT_NAMES.includes(collider.distal) || !Array.isArray(collider.attachmentJoints) || !collider.attachmentJoints.length || collider.attachmentJoints.some((joint: JointName) => !JOINT_NAMES.includes(joint)) || !['trunk', 'head', 'arm', 'leg', 'foot'].includes(collider.family) || typeof collider.anatomicalRegion !== 'string') throw new Error('人体碰撞体的标识、骨骼或解剖区域无效。');
    ids.add(collider.id);
    if (collider.shape === 'capsule') {
      if (!validVector(collider.proximalOffset, 3) || !validVector(collider.distalOffset, 3) || !Number.isFinite(collider.radiusMeters) || collider.radiusMeters <= 0) throw new Error('胶囊体需要有限端点和正半径。');
    } else if (collider.shape === 'box') {
      if (!validVector(collider.centerOffset, 3) || !validVector(collider.halfExtents, 3) || collider.halfExtents.some((value: number) => value <= 0) || !validVector(collider.localRotation, 4) || Math.abs(Math.hypot(...collider.localRotation) - 1) > 1e-6) throw new Error('盒碰撞体需要有限中心、正尺寸和单位四元数。');
    } else if (collider.shape === 'convex') {
      if (!Array.isArray(collider.vertices) || collider.vertices.length < 4 || collider.vertices.length > 4096 || collider.vertices.some((vertex: readonly number[]) => !validVector(vertex, 3) || vertex.some(value => !Number.isFinite(Math.fround(value)))) || !Array.isArray(collider.indices) || collider.indices.length < 12 || collider.indices.length % 3 || collider.indices.length > 24576 || collider.indices.some((index: number) => !Number.isInteger(index) || index < 0 || index >= collider.vertices.length) || !validVector(collider.bboxCenterOffset, 3) || !validVector(collider.bboxHalfExtents, 3) || collider.bboxHalfExtents.some((value: number) => value <= 0) || !validVector(collider.bboxRotation, 4) || Math.abs(Math.hypot(...collider.bboxRotation) - 1) > 1e-6) throw new Error('凸包碰撞体需要有限顶点、三角索引和有效包围盒。');
      const inverse = new Quaternion(...collider.bboxRotation).normalize().invert();
      if (collider.vertices.some((vertex: readonly number[]) => new Vector3(...subtract(vertex, collider.bboxCenterOffset)).applyQuaternion(inverse).toArray().some((value, axis) => Math.abs(value) > collider.bboxHalfExtents[axis] + 1e-6))) throw new Error('凸包包围盒必须包含所有顶点。');
    } else throw new Error('人体碰撞体形状不受支持。');
  }
  if (profile.footGround) {
    const foot = profile.footGround;
    if (![foot.halfWidthMeters, foot.soleOffsetMeters, foot.heelZ, foot.toeZ, foot.topOffsetMeters ?? -.004].every(Number.isFinite) || foot.halfWidthMeters <= 0 || foot.soleOffsetMeters <= 0 || foot.heelZ >= foot.toeZ) throw new Error('脚底碰撞角点标定无效。');
  }
  validatedProfiles.add(profile);
}
const ancestors = new Map<JointName, Set<JointName>>();
for (const definition of RIG_DEFINITIONS) ancestors.set(definition.name, new Set([definition.name, ...(definition.parent ? ancestors.get(definition.parent)! : [])]));
function pairsFor(profile: AvatarCollisionProfile): Pair[] {
  let pairs = pairCache.get(profile);
  if (!pairs) {
    pairs = profile.colliders.flatMap((a, i) => profile.colliders.slice(i + 1).flatMap((b, offset) => areCapsulesAnatomicallyAdjacent(a, b) ? [] : [{ a: i, b: i + offset + 1 }]));
    pairCache.set(profile, pairs);
  }
  return pairs;
}
type Geometry = { profile: AvatarCollisionProfile; pairs: Pair[]; colliders: EvaluatedCollider[]; selfDepths: number[]; floorDepths: { segmentId: string; depthMeters: number }[] };

/** Exact segment/AABB distance from the convex quadratic on each face interval. */
export function segmentAABBDistance(start: readonly number[], end: readonly number[], halfExtents: readonly number[]): number {
  const direction = subtract(end, start), cuts = [0, 1];
  for (let axis = 0; axis < 3; axis++) if (direction[axis] !== 0) for (const sign of [-1, 1]) {
    const time = (sign * halfExtents[axis] - start[axis]) / direction[axis];
    if (time > 0 && time < 1) cuts.push(time);
  }
  cuts.sort((a, b) => a - b);
  const squaredDistance = (time: number) => start.reduce((sum, value, axis) => sum + Math.max(0, Math.abs(value + direction[axis] * time) - halfExtents[axis]) ** 2, 0);
  let minimum = Math.min(squaredDistance(0), squaredDistance(1));
  for (let i = 1; i < cuts.length; i++) {
    const low = cuts[i - 1], high = cuts[i], middle = (low + high) / 2;
    let quadratic = 0, linear = 0;
    for (let axis = 0; axis < 3; axis++) {
      const coordinate = start[axis] + middle * direction[axis];
      if (Math.abs(coordinate) <= halfExtents[axis]) continue;
      quadratic += direction[axis] ** 2;
      linear += direction[axis] * (start[axis] - Math.sign(coordinate) * halfExtents[axis]);
    }
    const time = quadratic ? Math.max(low, Math.min(high, -linear / quadratic)) : middle;
    minimum = Math.min(minimum, squaredDistance(low), squaredDistance(high), squaredDistance(time));
  }
  return Math.sqrt(minimum);
}
const boxAxisCache = new WeakMap<EvaluatedBox, Vec3[]>();
function boxAxes(box: EvaluatedBox): Vec3[] {
  let axes = boxAxisCache.get(box);
  if (!axes) {
    const rotation = new Quaternion(...box.rotation);
    axes = ([[1, 0, 0], [0, 1, 0], [0, 0, 1]] as Vec3[]).map(axis => new Vector3(...axis).applyQuaternion(rotation).toArray() as Vec3);
    boxAxisCache.set(box, axes);
  }
  return axes;
}
const projectedRadius = (axis: readonly number[], axes: readonly Vec3[], halfExtents: readonly number[]) => axes.reduce((sum, boxAxis, i) => sum + Math.abs(dot(axis, boxAxis)) * halfExtents[i], 0);

/** Signed overlap along the full 15 separating axes, in world meters. */
export function boxBoxPenetrationDepth(a: EvaluatedBox, b: EvaluatedBox): number {
  const axesA = boxAxes(a), axesB = boxAxes(b), delta = subtract(b.center, a.center);
  const axes = [...axesA, ...axesB, ...axesA.flatMap(axisA => axesB.map(axisB => cross(axisA, axisB)))];
  let minimum = Infinity;
  for (const candidate of axes) {
    const length = Math.hypot(...candidate);
    if (length < 1e-14) continue;
    const axis = candidate.map(value => value / length);
    minimum = Math.min(minimum, projectedRadius(axis, axesA, a.halfExtents) + projectedRadius(axis, axesB, b.halfExtents) - Math.abs(dot(delta, axis)));
  }
  return minimum;
}
/** Capsule/OBB depth. Inside the box, use segment+box Minkowski face normals. */
export function capsuleBoxPenetrationDepth(capsule: EvaluatedCapsule, box: EvaluatedBox): number {
  const inverse = new Quaternion(...box.rotation).invert();
  const local = (point: Vec3) => new Vector3(...subtract(point, box.center)).applyQuaternion(inverse).toArray() as Vec3;
  const start = local(capsule.proximal), end = local(capsule.distal), distance = segmentAABBDistance(start, end, box.halfExtents);
  if (distance > 0) return capsule.radiusMeters - distance;
  const direction = subtract(end, start), center = start.map((value, i) => (value + end[i]) / 2);
  const unitAxes: Vec3[] = [[1, 0, 0], [0, 1, 0], [0, 0, 1]], axes = [...unitAxes, ...unitAxes.map(axis => cross(direction, axis))];
  let minimum = Infinity;
  for (const candidate of axes) {
    const length = Math.hypot(...candidate);
    if (length < 1e-14) continue;
    const axis = candidate.map(value => value / length);
    const radius = axis.reduce((sum, value, i) => sum + Math.abs(value) * box.halfExtents[i], 0);
    minimum = Math.min(minimum, radius + Math.abs(dot(direction, axis)) / 2 + capsule.radiusMeters - Math.abs(dot(center, axis)));
  }
  return minimum;
}

type RawShape = ReturnType<Shape['intoRaw']>;
const rawShapes = new WeakMap<AvatarColliderDefinition, RawShape>();
const preparedConvexProfiles = new WeakSet<AvatarCollisionProfile>();
const releaseRawShape = new FinalizationRegistry<RawShape>(shape => shape.free());
function cachedRawShape(definition: AvatarBoxDefinition | AvatarConvexDefinition): RawShape {
  let shape = rawShapes.get(definition);
  if (!shape) {
    const engine = getReadyRapierBackend();
    // Build the f32 hull once, from vertices rather than trusting external mesh
    // winding or convexity. Each subsequent contact reuses the same WASM shape.
    shape = definition.shape === 'box' ? new engine.Cuboid(...definition.halfExtents).intoRaw()
      : new engine.ConvexPolyhedron(new Float32Array(definition.vertices.flat())).intoRaw();
    if (!shape) throw new Error('无法建立有效的身体凸包碰撞体。');
    rawShapes.set(definition, shape); releaseRawShape.register(definition, shape);
  }
  return shape;
}
function colliderBounds(collider: EvaluatedCollider): EvaluatedBox {
  if (collider.shape === 'box') return collider;
  if (collider.shape === 'convex') return collider.bounds;
  const halfExtents = collider.proximal.map((value, axis) => Math.abs(collider.distal[axis] - value) / 2 + collider.radiusMeters) as Vec3;
  return {
    shape: 'box', id: collider.id, center: collider.proximal.map((value, axis) => (value + collider.distal[axis]) / 2) as Vec3,
    rotation: [0, 0, 0, 1], halfExtents,
    definition: { ...collider.definition, shape: 'box', centerOffset: [0, 0, 0], localRotation: [0, 0, 0, 1], halfExtents },
  };
}
function backendShape(collider: EvaluatedCollider) {
  if (collider.shape !== 'capsule') return { shape: cachedRawShape(collider.definition), position: collider.shape === 'convex' ? collider.position : collider.center, rotation: collider.rotation, owned: false };
  const axis = new Vector3(...subtract(collider.distal, collider.proximal)), length = axis.length();
  return {
    shape: new (getReadyRapierBackend().Capsule)(length / 2, collider.radiusMeters).intoRaw(),
    position: collider.proximal.map((value, i) => (value + collider.distal[i]) / 2) as Vec3,
    rotation: length ? new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), axis.divideScalar(length)).toArray() as Quat : [0, 0, 0, 1] as Quat, owned: true,
  };
}
const boxlikeCache = new WeakMap<AvatarConvexDefinition, AvatarBoxDefinition | null>();
/** A hull containing all eight exact AABB corners is that box, not merely boxed. */
function exactBoxlikeHull(collider: EvaluatedConvex): EvaluatedBox | null {
  let definition = boxlikeCache.get(collider.definition);
  if (definition === undefined) {
    const vertices = collider.definition.vertices;
    const minimum = [0, 1, 2].map(axis => Math.min(...vertices.map(vertex => vertex[axis])));
    const maximum = [0, 1, 2].map(axis => Math.max(...vertices.map(vertex => vertex[axis])));
    const corners = new Set<number>();
    if (minimum.every((value, i) => value < maximum[i])) for (const vertex of vertices) {
      let corner = 0, isCorner = true;
      for (let axis = 0; axis < 3; axis++) {
        if (vertex[axis] === maximum[axis]) corner |= 1 << axis;
        else if (vertex[axis] !== minimum[axis]) isCorner = false;
      }
      if (isCorner) corners.add(corner);
    }
    definition = corners.size === 8 ? {
      ...collider.definition, shape: 'box', localRotation: [0, 0, 0, 1],
      centerOffset: minimum.map((value, i) => (value + maximum[i]) / 2) as Vec3,
      halfExtents: minimum.map((value, i) => (maximum[i] - value) / 2) as Vec3,
    } : null;
    boxlikeCache.set(collider.definition, definition);
  }
  if (!definition) return null;
  return {
    shape: 'box', id: collider.id, center: new Vector3(...definition.centerOffset).applyQuaternion(new Quaternion(...collider.rotation)).add(new Vector3(...collider.position)).toArray() as Vec3,
    rotation: collider.rotation, halfExtents: definition.halfExtents, definition,
  };
}
/** Convex contact queries only: no World, dynamics, gravity or animation solve. */
export function convexColliderPenetrationDepth(a: EvaluatedCollider, b: EvaluatedCollider): number {
  // EPA can underestimate perfectly coincident box-shaped hulls, then jump on a
  // tiny escape rotation. Exact box hulls use stable analytic penetration.
  a = a.shape === 'convex' ? exactBoxlikeHull(a) ?? a : a;
  b = b.shape === 'convex' ? exactBoxlikeHull(b) ?? b : b;
  if (a.shape !== 'convex' && b.shape !== 'convex') return colliderDepth(a, b);
  const broadDepth = boxBoxPenetrationDepth(colliderBounds(a), colliderBounds(b));
  if (broadDepth < 0) return broadDepth;
  const engine = getReadyRapierBackend(), resources: { free(): void }[] = [];
  try {
    const aa = backendShape(a);
    if (aa.owned) resources.push(aa.shape);
    const bb = backendShape(b);
    if (bb.owned) resources.push(bb.shape);
    const inverseA = new Quaternion(...aa.rotation).invert();
    // Use the first shape's frame to keep f32 contact precision independent of
    // Root placement or a common rotation of the entire character.
    const relativePosition = new Vector3(...subtract(bb.position, aa.position)).applyQuaternion(inverseA);
    const relativeRotation = inverseA.multiply(new Quaternion(...bb.rotation)).normalize();
    const posA = engine.VectorOps.intoRaw({ x: 0, y: 0, z: 0 }); resources.push(posA);
    const rotA = engine.RotationOps.intoRaw({ x: 0, y: 0, z: 0, w: 1 }); resources.push(rotA);
    const posB = engine.VectorOps.intoRaw(relativePosition); resources.push(posB);
    const rotB = engine.RotationOps.intoRaw(relativeRotation); resources.push(rotB);
    const contact = aa.shape.contactShape(posA, rotA, bb.shape, posB, rotB, CAPSULE_SELF_TOLERANCE_METERS);
    if (!contact) return -Infinity;
    resources.push(contact);
    // Rapier 0.21 exports raw contacts through a packed buffer. Keep ownership
    // here so the existing finally also releases contacts if decoding fails.
    const components = new Float32Array(13);
    contact.getComponents(components);
    const distance = components[0];
    if (!Number.isFinite(distance)) throw new Error('身体碰撞检测未得到有限结果。');
    return -distance;
  } finally {
    for (const resource of resources.reverse()) resource.free();
  }
}
function convexMinimumHeight(collider: EvaluatedConvex): number {
  const [x, y, z, w] = collider.rotation;
  const row = [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)];
  let minimum = Infinity;
  for (const vertex of collider.definition.vertices) minimum = Math.min(minimum, dot(row, vertex) + collider.position[1]);
  return minimum;
}
function colliderDepth(a: EvaluatedCollider, b: EvaluatedCollider): number {
  if (a.shape === 'convex' || b.shape === 'convex') return convexColliderPenetrationDepth(a, b);
  if (a.shape === 'capsule') return b.shape === 'capsule'
    ? a.radiusMeters + b.radiusMeters - finiteSegmentDistance(a.proximal, a.distal, b.proximal, b.distal)
    : capsuleBoxPenetrationDepth(a, b);
  return b.shape === 'capsule' ? capsuleBoxPenetrationDepth(b, a) : boxBoxPenetrationDepth(a, b);
}

/** Geometry only: no center of mass, principal axes, World, gravity or support solving. */
function geometry(pose: Pose, profile: AvatarCollisionProfile, invariantDepths?: (number | undefined)[]): Geometry {
  validateProfile(profile);
  if (profile.colliders.some(collider => collider.shape === 'convex')) {
    getReadyRapierBackend();
    if (!preparedConvexProfiles.has(profile)) {
      for (const collider of profile.colliders) if (collider.shape === 'convex') cachedRawShape(collider);
      preparedConvexProfiles.add(profile);
    }
  }
  const joints = evaluatePose(pose), colliders = collidersFromFK(joints, profile), pairs = pairsFor(profile);
  const selfDepths = pairs.map((pair, i) => {
    if (invariantDepths?.[i] !== undefined) return invariantDepths[i]!;
    return colliderDepth(colliders[pair.a], colliders[pair.b]);
  });
  const floorDepths = colliders.filter(collider => !profile.footGround || collider.definition.family !== 'foot').map(collider => ({
    segmentId: collider.id, depthMeters: collider.shape === 'capsule'
      ? collider.radiusMeters - Math.min(collider.proximal[1], collider.distal[1])
      : collider.shape === 'box' ? projectedRadius([0, 1, 0], boxAxes(collider), collider.halfExtents) - collider.center[1]
        : -convexMinimumHeight(collider),
  }));
  if (profile.footGround) for (const side of ['Left', 'Right'] as const) {
    const foot = `${side}Foot` as const, corners = profile.footGround;
    // Keep the existing 82 mm sole and top corners, including inverted feet.
    const heights = [-corners.halfWidthMeters, corners.halfWidthMeters].flatMap(x => [corners.heelZ, corners.toeZ].flatMap(z =>
      [-corners.soleOffsetMeters, corners.topOffsetMeters ?? -.004].map(y => worldPoint(joints, foot, [x, y, z])[1]),
    ));
    floorDepths.push({ segmentId: colliders.find(collider => collider.definition.family === 'foot' && collider.definition.proximal === foot)?.id ?? `${side}-foot`, depthMeters: -Math.min(...heights) });
  }
  return { profile, pairs, colliders, selfDepths, floorDepths };
}
function diagnostics(state: Geometry): CapsuleCollisions {
  return {
    profileId: state.profile.id,
    selfCollisions: state.selfDepths.flatMap((depthMeters, i) => depthMeters > CAPSULE_SELF_TOLERANCE_METERS + DEPTH_ROUNDING_METERS
      ? [{ segments: [state.colliders[state.pairs[i].a].id, state.colliders[state.pairs[i].b].id] as [string, string], depthMeters }] : []),
    floorPenetrations: state.floorDepths.filter(item => item.depthMeters > CAPSULE_FLOOR_TOLERANCE_METERS + DEPTH_ROUNDING_METERS),
  };
}

/** Read-only skin-proxy overlaps; this never changes imported or saved motion. */
export function getCapsuleCollisions(pose: Pose, profile: AvatarCollisionProfile = AVATAR_COLLISION_PROFILE): CapsuleCollisions { return diagnostics(geometry(pose, profile)); }

export interface BodyCollisionContact {
  segments: [string, string];
  depthMeters: number;
  /** Common world-space witnesses and A's outward normal towards B. */
  points: [Vec3, Vec3];
  normal: Vec3;
}
export interface BodyCollisionContacts {
  collisions: CapsuleCollisions;
  selfContacts: BodyCollisionContact[];
  /** Greatest signed floor depth, including calibrated sole corners. */
  floorDepthMeters: number;
}

function contactWitnesses(a: EvaluatedCollider, b: EvaluatedCollider): Pick<BodyCollisionContact, 'points' | 'normal'> | undefined {
  const engine = getReadyRapierBackend(), resources: { free(): void }[] = [];
  try {
    const aa = backendShape(a), bb = backendShape(b);
    if (aa.owned) resources.push(aa.shape);
    if (bb.owned) resources.push(bb.shape);
    const rotationA = new Quaternion(...aa.rotation), inverseA = rotationA.clone().invert();
    const relativePosition = new Vector3(...subtract(bb.position, aa.position)).applyQuaternion(inverseA);
    const relativeRotation = inverseA.multiply(new Quaternion(...bb.rotation)).normalize();
    const posA = engine.VectorOps.intoRaw({ x: 0, y: 0, z: 0 }); resources.push(posA);
    const rotA = engine.RotationOps.intoRaw({ x: 0, y: 0, z: 0, w: 1 }); resources.push(rotA);
    const posB = engine.VectorOps.intoRaw(relativePosition); resources.push(posB);
    const rotB = engine.RotationOps.intoRaw(relativeRotation); resources.push(rotB);
    const contact = aa.shape.contactShape(posA, rotA, bb.shape, posB, rotB, CAPSULE_SELF_TOLERANCE_METERS);
    if (!contact) return undefined;
    resources.push(contact);
    // [distance, point1.xyz, point2.xyz, normal1.xyz, normal2.xyz]. The decoded
    // values are ordinary JS data; only the owned raw contact needs freeing.
    const components = new Float32Array(13);
    contact.getComponents(components);
    const worldPoint = (offset: number) => new Vector3(components[offset], components[offset + 1], components[offset + 2]).applyQuaternion(rotationA).add(new Vector3(...aa.position)).toArray() as Vec3;
    const normal = new Vector3(components[7], components[8], components[9]).applyQuaternion(rotationA);
    if (normal.lengthSq() < 1e-12 || !normal.toArray().every(Number.isFinite)) return undefined;
    return { points: [worldPoint(1), worldPoint(4)], normal: normal.normalize().toArray() as Vec3 };
  } finally {
    for (const resource of resources.reverse()) resource.free();
  }
}

/** Read-only contact geometry for deterministic derived previews, never a World. */
export function getBodyCollisionContacts(pose: Pose, profile: AvatarCollisionProfile = AVATAR_COLLISION_PROFILE): BodyCollisionContacts {
  const state = geometry(pose, profile), collisions = diagnostics(state);
  const selfContacts = state.selfDepths.flatMap((depthMeters, i) => {
    if (depthMeters <= CAPSULE_SELF_TOLERANCE_METERS + DEPTH_ROUNDING_METERS) return [];
    const { a, b } = state.pairs[i], witnesses = contactWitnesses(state.colliders[a], state.colliders[b]);
    return witnesses ? [{ segments: [state.colliders[a].id, state.colliders[b].id] as [string, string], depthMeters, ...witnesses }] : [];
  });
  return { collisions, selfContacts, floorDepthMeters: Math.max(...state.floorDepths.map(item => item.depthMeters)) };
}

export interface CapsuleCollisionConstraintResult {
  pose: Pose;
  limited: boolean;
  acceptedFraction: number;
  collisions: CapsuleCollisions;
  blockingCollisions: CapsuleCollisions;
  blockingJoints: JointName[];
  limitReason: 'collision' | 'joint-limit' | 'sweep-budget' | null;
  /** Number of pose geometry evaluations, including the initial pose. */
  sampleCount: number;
}

/**
 * Limit a new gesture increment along its shortest SLERP/linear Root path.
 * Every changed rotation advances at most 2 degrees and mixed Root at most
 * 1 cm per sample; the first new/deeper overlap is bisected. Existing overlaps
 * are budgets for that individual pair, permitting escape without deepening.
 * Root-only translation has invariant self distances and monotonic floor depths,
 * so its exact endpoint/bisection path needs no distance-based subdivision.
 * This is a bounded geometric guard, not a cloth solver or continuous mesh CCD.
 * Never use it for loading, seeking, playback, author keys or explicit paste.
 */
export function constrainPoseCollisions(previous: Pose, proposed: Pose, profile: AvatarCollisionProfile = AVATAR_COLLISION_PROFILE): CapsuleCollisionConstraintResult {
  const initial = geometry(previous, profile), pairs = initial.pairs;
  // Validate all proposed channels once, even if this becomes a no-op.
  evaluatePose(proposed);
  const changed = JOINT_NAMES.filter(joint => previous.joints[joint].some((value, i) => !Object.is(value, proposed.joints[joint][i])));
  const rootChanged = previous.root.some((value, i) => !Object.is(value, proposed.root[i]));
  if (!changed.length && !rootChanged) return {
    pose: proposed, limited: false, acceptedFraction: 1, collisions: diagnostics(initial),
    blockingCollisions: { profileId: profile.id, selfCollisions: [], floorPenetrations: [] }, blockingJoints: [], limitReason: null, sampleCount: 1,
  };
  const rotations = changed.map(joint => {
    const from = new Quaternion(...previous.joints[joint]).normalize(), to = new Quaternion(...proposed.joints[joint]).normalize();
    const dot = from.dot(to), sign = dot < 0 ? -1 : 1;
    const chord = Math.hypot(from.x - sign * to.x, from.y - sign * to.y, from.z - sign * to.z, from.w - sign * to.w);
    const sum = Math.hypot(from.x + sign * to.x, from.y + sign * to.y, from.z + sign * to.z, from.w + sign * to.w);
    return { joint, from, to, angle: 4 * Math.atan2(chord, sum), enforceLimit: isJointRotationWithinLimits(joint, previous.joints[joint]) && isJointRotationWithinLimits(joint, proposed.joints[joint]) };
  });
  // Shared ancestor rotations and Root translation are rigid transforms of
  // both proxies, so their relative overlap stays exactly unchanged.
  const invariantDepths = pairs.map((pair, i) => {
    const a = profile.colliders[pair.a], b = profile.colliders[pair.b];
    const anchors = [a.proximal, a.distal, b.proximal, b.distal];
    return changed.every(joint => anchors.every(anchor => ancestors.get(anchor)!.has(joint) === ancestors.get(anchors[0])!.has(joint))) ? initial.selfDepths[i] : undefined;
  });
  const rootDistance = Math.hypot(...subtract(proposed.root, previous.root));
  const requiredSteps = changed.length ? Math.max(1, Math.ceil(rootDistance / CAPSULE_SWEEP_TRANSLATION_STEP_METERS), ...rotations.map(rotation => Math.ceil(rotation.angle / CAPSULE_SWEEP_ROTATION_STEP_RADIANS))) : 1;
  const steps = Math.min(MAX_SWEEP_SAMPLES, requiredSteps);
  const selfBudgets = initial.selfDepths.map(depth => Math.max(CAPSULE_SELF_TOLERANCE_METERS, depth));
  const floorBudgets = initial.floorDepths.map(item => Math.max(CAPSULE_FLOOR_TOLERANCE_METERS, item.depthMeters));
  let sampleCount = 1;
  const interpolate = (amount: number): Pose => {
    if (amount === 1) return proposed;
    if (amount === 0) return previous;
    const joints = { ...proposed.joints };
    for (const rotation of rotations) joints[rotation.joint] = canonicalEditRotation(rotation.from.clone().slerp(rotation.to, amount).toArray() as Quat);
    return { joints, root: rootChanged ? previous.root.map((value, i) => value + amount * (proposed.root[i] - value)) as Vec3 : proposed.root };
  };
  const inspect = (amount: number) => {
    const pose = interpolate(amount), state = geometry(pose, profile, invariantDepths);
    if (!changed.length) {
      // Pure translation cannot change self distances. Evaluate floor depths
      // linearly to avoid cancellation from translating large world coordinates.
      state.selfDepths = initial.selfDepths;
      const deltaY = pose.root[1] - previous.root[1];
      state.floorDepths = initial.floorDepths.map(item => ({ ...item, depthMeters: item.depthMeters - deltaY }));
    }
    sampleCount++;
    const blockingCollisions: CapsuleCollisions = {
      profileId: profile.id,
      selfCollisions: state.selfDepths.flatMap((depthMeters, i) => depthMeters > selfBudgets[i]
        ? [{ segments: [state.colliders[pairs[i].a].id, state.colliders[pairs[i].b].id] as [string, string], depthMeters }] : []),
      floorPenetrations: state.floorDepths.filter((item, i) => item.depthMeters > floorBudgets[i]),
    };
    const blockingJoints = rotations.filter(rotation => rotation.enforceLimit && !isJointRotationWithinLimits(rotation.joint, pose.joints[rotation.joint])).map(rotation => rotation.joint);
    return { pose, state, blockingCollisions, blockingJoints, blocked: !!(blockingCollisions.selfCollisions.length || blockingCollisions.floorPenetrations.length || blockingJoints.length) };
  };
  let accepted = { pose: previous, state: initial }, acceptedFraction = 0;
  for (let step = 1; step <= steps; step++) {
    const amount = step / requiredSteps, next = inspect(amount);
    if (next.blocked) {
      let low = acceptedFraction, high = amount;
      if (!changed.length) {
        // Exact Root-only contact fraction; a tiny inward offset handles final
        // floating-point subtraction without granting a fresh overlap budget.
        const descent = previous.root[1] - proposed.root[1];
        low = Math.max(0, Math.min(1, ...floorBudgets.map((budget, i) => (budget - initial.floorDepths[i].depthMeters) / descent)) - Number.EPSILON * 8);
        if (low > 0) accepted = inspect(low);
      } else {
        for (let iteration = 0; iteration < BISECTION_ITERATIONS; iteration++) {
          const middle = (low + high) / 2, test = inspect(middle);
          if (test.blocked) high = middle;
          else { low = middle; accepted = test; }
        }
      }
      // Contact queries use f32. A clipped sub-micrometer/sub-microradian
      // remainder must not become a fresh author edit on every pointer event.
      if (rootDistance * low < 1e-7 && rotations.every(rotation => rotation.angle * low < 1e-6)) {
        low = 0; accepted = { pose: previous, state: initial };
      }
      // Do not turn a legacy out-of-envelope channel into another invalid edit.
      if (rotations.some(rotation => isJointRotationWithinLimits(rotation.joint, proposed.joints[rotation.joint]) && !isJointRotationWithinLimits(rotation.joint, accepted.pose.joints[rotation.joint]))) {
        low = 0; accepted = { pose: previous, state: initial };
      }
      return { pose: accepted.pose, limited: true, acceptedFraction: low, collisions: diagnostics(accepted.state), blockingCollisions: next.blockingCollisions, blockingJoints: next.blockingJoints, limitReason: next.blockingJoints.length ? 'joint-limit' : 'collision', sampleCount };
    }
    accepted = next; acceptedFraction = amount;
  }
  return {
    pose: accepted.pose, limited: requiredSteps > steps, acceptedFraction,
    collisions: diagnostics(accepted.state), blockingCollisions: { profileId: profile.id, selfCollisions: [], floorPenetrations: [] }, blockingJoints: [],
    limitReason: requiredSteps > steps ? 'sweep-budget' : null, sampleCount,
  };
}

/** General names for the mixed capsule/OBB body profile. */
export const getBodyCollisions = getCapsuleCollisions;
export const constrainBodyCollisions = constrainPoseCollisions;
