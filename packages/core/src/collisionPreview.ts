import { Quaternion, Vector3 } from 'three';
import { AVATAR_COLLISION_PROFILE } from './avatarCapsules.generated';
import {
  CAPSULE_FLOOR_TOLERANCE_METERS, CAPSULE_SELF_TOLERANCE_METERS,
  getBodyCollisionContacts, type AvatarCollisionProfile, type BodyCollisionContacts, type CapsuleCollisions,
} from './capsuleCollision';
import { evaluatePose, RIG_DEFINITIONS } from './humanoid';
import { sampleTake } from './index';
import { canonicalEditRotation, constrainJointRotation, isJointRotationWithinLimits } from './jointConstraints';
import { JOINT_NAMES, type BakedTake, type JointName, type Pose, type Quat, type Vec3 } from './motion-types';

export interface CollisionPreviewResult {
  pose: Pose;
  corrected: boolean;
  sourceCollisions: CapsuleCollisions;
  /** Residual contacts remain visible when the bounded projection cannot solve them. */
  collisions: CapsuleCollisions;
  iterations: number;
}

const MAX_ITERATIONS = 4;
const MAX_ROTATION_STEP = .3;
const CACHE_POINTS = 256;
const parents = new Map(RIG_DEFINITIONS.map(definition => [definition.name, definition.parent]));
const ancestors = new Map<JointName, Set<JointName>>();
for (const definition of RIG_DEFINITIONS) ancestors.set(definition.name, new Set([definition.name, ...(definition.parent ? ancestors.get(definition.parent)! : [])]));
const mobility = (joint: JointName) => joint.endsWith('UpperArm') || joint.endsWith('ForeArm') || joint.endsWith('UpperLeg') ? 1
  : joint.endsWith('Shoulder') || joint.endsWith('LowerLeg') ? .7
    : joint.endsWith('Hand') || joint.endsWith('Foot') ? .35
      : ['Spine', 'Chest', 'Neck', 'Head'].includes(joint) ? .2 : 0;
const selfCost = (state: BodyCollisionContacts) => state.collisions.selfCollisions.reduce((sum, contact) => sum + (contact.depthMeters - CAPSULE_SELF_TOLERANCE_METERS) ** 2, 0);
const familyPriority = (family: string) => family === 'arm' ? 4 : family === 'leg' || family === 'foot' ? 3 : family === 'head' ? 2 : 1;

function corrections(pose: Pose, state: BodyCollisionContacts, profile: AvatarCollisionProfile): { joint: JointName; delta: Vector3; score: number }[] {
  const world = evaluatePose(pose), definitions = new Map(profile.colliders.map(collider => [collider.id, collider]));
  const votes = new Map<JointName, { gradient: Vector3; denominator: number }>();
  for (const contact of state.selfContacts) {
    const a = definitions.get(contact.segments[0])!, b = definitions.get(contact.segments[1])!;
    const normal = new Vector3(...contact.normal), excess = contact.depthMeters - CAPSULE_SELF_TOLERANCE_METERS + 1e-5;
    let best: { joint: JointName; gradient: Vector3; score: number } | undefined;
    for (const joint of JOINT_NAMES) {
      if (!mobility(joint)) continue;
      const movesA = ancestors.get(a.proximal)!.has(joint), movesB = ancestors.get(b.proximal)!.has(joint);
      if (movesA === movesB) continue; // A common rigid ancestor cannot separate the pair.
      // Prefer releasing a limb from the body over bending the trunk or moving
      // a planted leg merely to accommodate an intersecting hand.
      if (familyPriority(movesA ? a.family : b.family) < familyPriority(movesA ? b.family : a.family)) continue;
      const point = contact.points[movesA ? 0 : 1];
      const gradient = new Vector3(...point).sub(new Vector3(...world[joint].position)).cross(normal).multiplyScalar(movesA ? -1 : 1);
      if (gradient.lengthSq() < 1e-10) continue;
      const score = gradient.lengthSq() * mobility(joint);
      if (!best || score > best.score) best = { joint, gradient, score };
    }
    if (!best) continue;
    const vote = votes.get(best.joint) ?? { gradient: new Vector3(), denominator: 0 };
    vote.gradient.addScaledVector(best.gradient, excess); vote.denominator += best.gradient.lengthSq(); votes.set(best.joint, vote);
  }
  return [...votes].map(([joint, vote]) => {
    const delta = vote.gradient.divideScalar(vote.denominator + 1e-8), length = delta.length();
    if (length > MAX_ROTATION_STEP) delta.multiplyScalar(MAX_ROTATION_STEP / length);
    return { joint, delta, score: length * mobility(joint) };
  }).filter(candidate => candidate.delta.lengthSq() > 1e-12).sort((a, b) => b.score - a.score || JOINT_NAMES.indexOf(a.joint) - JOINT_NAMES.indexOf(b.joint));
}

function rotated(pose: Pose, source: Pose, joint: JointName, delta: Vector3, scale: number): Pose {
  const parent = parents.get(joint), world = evaluatePose(pose);
  const parentRotation = parent ? new Quaternion(...world[parent].rotation) : new Quaternion();
  const angle = delta.length() * scale;
  const localDelta = new Quaternion().setFromAxisAngle(delta.clone().normalize(), angle)
    .premultiply(parentRotation.clone().invert()).multiply(parentRotation);
  const rotation = localDelta.multiply(new Quaternion(...pose.joints[joint])).normalize().toArray() as Quat;
  // Imported out-of-envelope channels retain their authored values unless this
  // contact actually needs them. Valid source joints keep anatomical guidance.
  const accepted = isJointRotationWithinLimits(joint, source.joints[joint]) ? constrainJointRotation(joint, rotation) : canonicalEditRotation(rotation);
  return { root: pose.root, joints: { ...pose.joints, [joint]: accepted } };
}

/**
 * Deterministic, read-only contact projection of one authored pose. It preserves
 * the rig's fixed offsets and untouched tuples; it is not a dynamics/balance or
 * high-precision skinning solve. Each accepted rotation must reduce true proxy
 * penetration. Floor support is a minimum Root lift after self-contact solving.
 */
export function resolveCollisionPreview(source: Pose, profile: AvatarCollisionProfile = AVATAR_COLLISION_PROFILE): CollisionPreviewResult {
  let pose = source, state = getBodyCollisionContacts(source, profile), iterations = 0;
  const sourceCollisions = state.collisions;
  for (; iterations < MAX_ITERATIONS && state.collisions.selfCollisions.length; iterations++) {
    const cost = selfCost(state), candidates = corrections(pose, state, profile);
    let accepted = false;
    for (const scale of [1, .5]) {
      let proposed = pose;
      for (const candidate of candidates) proposed = rotated(proposed, source, candidate.joint, candidate.delta, scale);
      if (JOINT_NAMES.every(joint => proposed.joints[joint].every((value, axis) => Object.is(value, pose.joints[joint][axis])))) continue;
      const next = getBodyCollisionContacts(proposed, profile);
      if (selfCost(next) < cost - Math.max(1e-12, cost * 1e-6)) {
        pose = proposed; state = next; accepted = true; break;
      }
    }
    if (!accepted) break;
  }
  if (state.floorDepthMeters > CAPSULE_FLOOR_TOLERANCE_METERS + 1e-8) {
    const lift = state.floorDepthMeters - CAPSULE_FLOOR_TOLERANCE_METERS + 1e-6;
    pose = { joints: pose.joints, root: [pose.root[0], pose.root[1] + lift, pose.root[2]] as Vec3 };
    state = getBodyCollisionContacts(pose, profile);
  }
  return { pose, corrected: pose !== source, sourceCollisions, collisions: state.collisions, iterations };
}

const previews = new WeakMap<BakedTake, WeakMap<AvatarCollisionProfile, Map<number, CollisionPreviewResult>>>();

/**
 * Sample the exact authored timestamp before projection. Cache keys use Take
 * and profile identity, never IDs or previous displayed poses, so seeks, reverse
 * scrubbing, edits and undo cannot advance a hidden physical simulation.
 * Returned values are read-only presentation data; never persist or edit them.
 */
export function sampleCollisionPreview(take: BakedTake, time: number, profile: AvatarCollisionProfile = AVATAR_COLLISION_PROFILE): CollisionPreviewResult {
  if (!Number.isFinite(time)) throw new Error('碰撞预览时间必须是有限数值。');
  let profiles = previews.get(take);
  if (!profiles) { profiles = new WeakMap(); previews.set(take, profiles); }
  let points = profiles.get(profile);
  if (!points) { points = new Map(); profiles.set(profile, points); }
  const cached = points.get(time);
  if (cached) { points.delete(time); points.set(time, cached); return cached; }
  const result = resolveCollisionPreview(sampleTake(take, time), profile);
  points.set(time, result);
  if (points.size > CACHE_POINTS) points.delete(points.keys().next().value!);
  return result;
}
