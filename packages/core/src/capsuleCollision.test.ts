import { beforeAll, describe, expect, it } from 'vitest';
import { Quaternion, Vector3 } from 'three';
import { AVATAR_COLLISION_PROFILE } from './avatarCapsules.generated';
import { evaluatePose } from './humanoid';
import { canonicalEditRotation, isJointRotationWithinLimits } from './jointConstraints';
import { bakeKeyframeSequence, makeKeyframeSequence, rotationFromDegrees } from './keyframes';
import { upsertMotionPointChanges } from './motionPoints';
import { JOINT_NAMES, type BakedTake, type JointName, type Pose, type Vec3 } from './motion-types';
import { initializeBodyCollisionBackend, isBodyCollisionBackendReady } from './rapierBackend';
import {
  areCapsulesAnatomicallyAdjacent, CAPSULE_FLOOR_TOLERANCE_METERS,
  boxBoxPenetrationDepth, capsuleBoxPenetrationDepth, constrainPoseCollisions, finiteSegmentDistance, getCapsuleCollisions, getPoseCapsules, getPoseColliders, segmentAABBDistance,
  convexColliderPenetrationDepth, type AvatarCollisionProfile, type EvaluatedBox, type EvaluatedCapsule, type EvaluatedConvex,
} from './capsuleCollision';

beforeAll(async () => { await initializeBodyCollisionBackend(); });

const neutral = (height = 1.05): Pose => ({ root: [0, height, 0], joints: Object.fromEntries(JOINT_NAMES.map(joint => [joint, [0, 0, 0, 1]])) as Pose['joints'] });
const withRotation = (pose: Pose, joint: JointName, degrees: Vec3): Pose => ({ root: pose.root, joints: { ...pose.joints, [joint]: rotationFromDegrees(degrees) } });
const box = (center: Vec3 = [0, 0, 0], halfExtents: Vec3 = [1, 1, 1], degrees: Vec3 = [0, 0, 0]): EvaluatedBox => ({
  shape: 'box', id: 'box', center, halfExtents, rotation: rotationFromDegrees(degrees),
  definition: { shape: 'box', id: 'box', anatomicalRegion: 'fixture', proximal: 'Hips', distal: 'Hips', attachmentJoints: ['Hips'], family: 'trunk', centerOffset: [0, 0, 0], halfExtents, localRotation: [0, 0, 0, 1] },
});
const capsule = (proximal: Vec3, distal: Vec3, radiusMeters = .1): EvaluatedCapsule => ({
  shape: 'capsule', id: 'capsule', proximal, distal, radiusMeters,
  definition: { shape: 'capsule', id: 'capsule', anatomicalRegion: 'fixture', proximal: 'LeftHand', distal: 'LeftHand', attachmentJoints: ['LeftHand'], family: 'arm', proximalOffset: [0, 0, 0], distalOffset: [0, 0, 0], radiusMeters },
});
const convex = (center: Vec3 = [0, 0, 0], halfExtents: Vec3 = [1, 1, 1], degrees: Vec3 = [0, 0, 0]): EvaluatedConvex => {
  const bounds = box(center, halfExtents, degrees), vertices = [-1, 1].flatMap(x => [-1, 1].flatMap(y => [-1, 1].map(z => [x * halfExtents[0], y * halfExtents[1], z * halfExtents[2]] as Vec3)));
  return {
    shape: 'convex', id: 'convex', position: center, rotation: bounds.rotation, bounds,
    definition: { ...bounds.definition, shape: 'convex', vertices, indices: [0, 1, 2, 1, 3, 2, 4, 6, 5, 5, 6, 7, 0, 4, 1, 1, 4, 5, 2, 3, 6, 3, 7, 6, 0, 2, 4, 2, 6, 4, 1, 5, 3, 3, 5, 7], bboxCenterOffset: [0, 0, 0], bboxHalfExtents: halfExtents, bboxRotation: [0, 0, 0, 1] },
  };
};

describe('finite segment distance', () => {
  it('finds an interior crossing at both ordinary and sub-millimeter scales', () => {
    for (const scale of [1, 1e-4, 1e-8]) {
      expect(finiteSegmentDistance([0, 0, 0], [scale, scale, 0], [-scale, 0, 0], [2 * scale, scale, 0])).toBeLessThan(scale * 1e-12);
    }
  });

  it('handles overlapping, separated and reversed parallel segments symmetrically', () => {
    const cases: { a: Vec3[]; b: Vec3[]; distance: number }[] = [
      { a: [[0, 0, 0], [10, 0, 0]], b: [[2, 1, 0], [3, 1, 0]], distance: 1 },
      { a: [[0, 0, 0], [1, 0, 0]], b: [[2, 1, 0], [3, 1, 0]], distance: Math.sqrt(2) },
      { a: [[0, 0, 0], [10, 0, 0]], b: [[3, 1, 0], [2, 1, 0]], distance: 1 },
      { a: [[0, 0, 0], [1, 0, 0]], b: [[2, 0, 0], [3, 0, 0]], distance: 1 },
    ];
    for (const { a, b, distance } of cases) {
      expect(finiteSegmentDistance(a[0], a[1], b[0], b[1])).toBeCloseTo(distance, 12);
      expect(finiteSegmentDistance(b[0], b[1], a[0], a[1])).toBeCloseTo(distance, 12);
    }
  });

  it('clamps to finite ends and supports point/segment and point/point cases', () => {
    expect(finiteSegmentDistance([0, 0, 0], [1, 0, 0], [2, 1, 0], [2, -1, 0])).toBe(1);
    expect(finiteSegmentDistance([2, 1, 0], [2, 1, 0], [0, 0, 0], [3, 0, 0])).toBe(1);
    expect(finiteSegmentDistance([0, 0, 0], [3, 0, 0], [2, 1, 0], [2, 1, 0])).toBe(1);
    expect(finiteSegmentDistance([0, 0, 0], [0, 0, 0], [1, 2, 2], [1, 2, 2])).toBe(3);
  });

  it('retains the interior solution of nearly parallel segments', () => {
    expect(finiteSegmentDistance([0, 0, 0], [1, 0, 0], [0, 1e-9, 0], [1, -1e-9, 0])).toBeLessThan(1e-14);
    expect(finiteSegmentDistance([0, 0, 0], [1, 0, 0], [0, 1e-9, .1], [1, -1e-9, .1])).toBeCloseTo(.1, 12);
  });
});

describe('mixed box and capsule narrow phase', () => {
  it('minimizes segment-to-box distance at faces, edges and corners', () => {
    expect(segmentAABBDistance([-2, 0, 0], [2, 0, 0], [1, 1, 1])).toBe(0);
    expect(segmentAABBDistance([-2, 2, 0], [2, 2, 0], [1, 1, 1])).toBe(1);
    expect(segmentAABBDistance([2, 2, 2], [3, 3, 3], [1, 1, 1])).toBeCloseTo(Math.sqrt(3), 12);
    expect(segmentAABBDistance([-2, 5, 0], [5, -2, 0], [1, 1, 1])).toBeCloseTo(Math.SQRT1_2, 12);
    expect(segmentAABBDistance([3, 0, 0], [3, 0, 0], [1, 1, 1])).toBe(2);
  });

  it('distinguishes tangent, separated and contained oriented boxes', () => {
    expect(boxBoxPenetrationDepth(box(), box([2, 0, 0]))).toBeCloseTo(0, 12);
    expect(boxBoxPenetrationDepth(box(), box([2.25, 0, 0]))).toBeCloseTo(-.25, 12);
    expect(boxBoxPenetrationDepth(box(), box([0, 0, 0], [.25, .25, .25]))).toBeCloseTo(1.25, 12);
    expect(boxBoxPenetrationDepth(box(), box([2.1, 2.1, 0], [1, 1, 1], [0, 0, 45]))).toBeLessThan(-.5);
  });

  it('keeps OBB overlap depth invariant under a common rigid rotation and translation', () => {
    const a = box([.3, -.4, .5], [.3, .5, .7], [12, 25, -31]), b = box([.45, -.5, .8], [.2, .35, .4], [-17, 33, 8]);
    const rotation = new Quaternion(...rotationFromDegrees([32, -71, 15])), translation = new Vector3(2, 1, -3);
    const transformed = (source: EvaluatedBox): EvaluatedBox => ({ ...source, center: new Vector3(...source.center).applyQuaternion(rotation).add(translation).toArray() as Vec3, rotation: rotation.clone().multiply(new Quaternion(...source.rotation)).toArray() as EvaluatedBox['rotation'] });
    expect(boxBoxPenetrationDepth(transformed(a), transformed(b))).toBeCloseTo(boxBoxPenetrationDepth(a, b), 12);
    expect(boxBoxPenetrationDepth(a, b)).toBeCloseTo(boxBoxPenetrationDepth(b, a), 12);
  });

  it('tracks capsule penetration past an intersecting axis instead of flattening at its radius', () => {
    expect(capsuleBoxPenetrationDepth(capsule([1.2, -.2, 0], [1.2, .2, 0]), box())).toBeCloseTo(-.1, 12);
    expect(capsuleBoxPenetrationDepth(capsule([1.05, -.2, 0], [1.05, .2, 0]), box())).toBeCloseTo(.05, 12);
    expect(capsuleBoxPenetrationDepth(capsule([.9, -.2, 0], [.9, .2, 0]), box())).toBeCloseTo(.2, 12);
    expect(capsuleBoxPenetrationDepth(capsule([.5, -.2, 0], [.5, .2, 0]), box())).toBeCloseTo(.6, 12);
    expect(capsuleBoxPenetrationDepth(capsule([-2, 0, 0], [2, 0, 0]), box())).toBeCloseTo(1.1, 12);
  });
});

describe('cached Rapier convex narrow phase', () => {
  it('rejects broadphase-only overlaps and finds genuine convex contacts', () => {
    const a = convex(), vertices: Vec3[] = [[0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1]];
    a.definition = { ...a.definition, vertices, indices: [0, 2, 1, 0, 1, 3, 0, 3, 2, 1, 2, 3], bboxCenterOffset: [.5, .5, .5], bboxHalfExtents: [.5, .5, .5] };
    a.bounds = box([.5, .5, .5], [.5, .5, .5]);
    const apart: EvaluatedConvex = { ...a, position: [.8, .8, 0], bounds: box([1.3, 1.3, .5], [.5, .5, .5]) };
    expect(boxBoxPenetrationDepth(a.bounds, apart.bounds)).toBeGreaterThan(0);
    expect(convexColliderPenetrationDepth(a, apart)).toBeLessThanOrEqual(0);
    const overlapping: EvaluatedConvex = { ...a, position: [.2, .2, 0], bounds: box([.7, .7, .5], [.5, .5, .5]) };
    expect(convexColliderPenetrationDepth(a, overlapping)).toBeGreaterThan(.1);
  });

  it('supports capsule/convex contacts and contained convex shapes with signed metric depths', () => {
    expect(convexColliderPenetrationDepth(capsule([.9, -.2, 0], [.9, .2, 0]), convex())).toBeCloseTo(.2, 5);
    expect(convexColliderPenetrationDepth(convex(), convex([0, 0, 0], [.25, .25, .25]))).toBeCloseTo(1.25, 5);
    expect(convexColliderPenetrationDepth(convex(), convex([2.25, 0, 0]))).toBeCloseTo(-.25, 5);
  });

  it('uses exact SAT for coincident box-shaped hulls so an escape rotation cannot increase an underestimated budget', () => {
    const a = convex([0, 0, 0], [.2, .2, .2]), b = convex([0, 0, 0], [.2, .2, .2]);
    expect(convexColliderPenetrationDepth(a, b)).toBeCloseTo(.4, 12);
    const head = { ...b.definition, id: 'head-box', proximal: 'Head' as const, distal: 'Head' as const, attachmentJoints: ['Head' as const], anatomicalRegion: 'head-box', family: 'head' as const,
      vertices: b.definition.vertices.map(vertex => [vertex[0], vertex[1] - .61, vertex[2]] as Vec3), bboxCenterOffset: [0, -.61, 0] as Vec3 };
    const profile: AvatarCollisionProfile = { id: 'coincident-hull-escape', colliders: [a.definition, head] };
    const source = neutral(2), proposed = withRotation(source, 'Head', [0, 0, 2]);
    expect(getCapsuleCollisions(source, profile).selfCollisions[0].depthMeters).toBeCloseTo(.4, 12);
    expect(getCapsuleCollisions(proposed, profile).selfCollisions[0].depthMeters).toBeLessThan(.4);
    const result = constrainPoseCollisions(source, proposed, profile);
    expect(result.limited).toBe(false);
    expect(result.pose).toBe(proposed);
  });

  it('uses actual transformed hull vertices for the floor instead of its broadphase box', () => {
    const shape = convex([0, 0, 0], [.1, .3, .2]);
    const profile: AvatarCollisionProfile = { id: 'convex-floor', colliders: [shape.definition] };
    const lowered = withRotation(neutral(.1), 'Hips', [0, 0, 180]);
    expect(getCapsuleCollisions(lowered, profile).floorPenetrations[0].depthMeters).toBeCloseTo(.2, 12);
  });
});

describe('offline avatar body geometry and read-only world transforms', () => {
  it('transforms every fitted endpoint by the same canonical FK as the avatar', () => {
    const pose = withRotation(withRotation(neutral(), 'Hips', [20, 35, -10]), 'LeftUpperArm', [-45, 12, 50]);
    const before = structuredClone(pose), joints = evaluatePose(pose), capsules = getPoseCapsules(pose);
    expect(capsules).toHaveLength(AVATAR_COLLISION_PROFILE.colliders.filter(collider => collider.shape === 'capsule').length);
    for (const capsule of capsules) {
      for (const end of ['proximal', 'distal'] as const) {
        const joint = capsule.definition[end], offset = capsule.definition[`${end}Offset`];
        const expected = new Vector3(...offset).applyQuaternion(new Quaternion(...joints[joint].rotation)).add(new Vector3(...joints[joint].position));
        expect(capsule[end]).toEqual(expected.toArray());
      }
      expect(capsule.radiusMeters).toBeGreaterThan(0);
      expect(capsule.radiusMeters).toBe(capsule.definition.radiusMeters);
    }
    const colliders = getPoseColliders(pose);
    expect(colliders).toHaveLength(AVATAR_COLLISION_PROFILE.colliders.length);
    for (const collider of colliders) if (collider.shape === 'convex') {
      expect(collider.position).toEqual(joints[collider.definition.proximal].position);
      expect(collider.rotation).toEqual(joints[collider.definition.proximal].rotation);
      const expectedCenter = new Vector3(...collider.definition.bboxCenterOffset).applyQuaternion(new Quaternion(...collider.rotation)).add(new Vector3(...collider.position));
      expect(collider.bounds.center).toEqual(expectedCenter.toArray());
    }
    getCapsuleCollisions(pose);
    expect(pose).toEqual(before);
  });

  it('excludes joined segments and shoulder/hip attachments but checks forearm against chest', () => {
    const find = (proximal: JointName, family?: string) => AVATAR_COLLISION_PROFILE.colliders.find(item => item.proximal === proximal && (!family || item.family === family))!;
    const chest = find('Chest', 'trunk'), pelvis = find('Hips', 'trunk'), upperArm = find('LeftUpperArm'), forearm = find('LeftForeArm');
    expect(areCapsulesAnatomicallyAdjacent(chest, upperArm)).toBe(true);
    expect(areCapsulesAnatomicallyAdjacent(pelvis, find('LeftUpperLeg'))).toBe(true);
    expect(areCapsulesAnatomicallyAdjacent(upperArm, forearm)).toBe(true);
    expect(areCapsulesAnatomicallyAdjacent(chest, forearm)).toBe(false);
    expect(areCapsulesAnatomicallyAdjacent(find('LeftUpperLeg'), find('RightUpperLeg'))).toBe(false);
  });

  it('keeps the calibrated 82 mm sole corners for upright and inverted feet', () => {
    const standing = getCapsuleCollisions(neutral());
    expect(standing.floorPenetrations).toEqual([]);
    const lowered = getCapsuleCollisions(neutral(.95));
    expect(lowered.floorPenetrations.find(item => item.segmentId === 'Left-foot')?.depthMeters).toBeCloseTo(.092, 12);
    const inverted = withRotation(neutral(.945), 'LeftFoot', [180, 0, 0]);
    // An inverted shoe's top (-4 mm locally) is now its lowest world corner.
    expect(getCapsuleCollisions(inverted).floorPenetrations.find(item => item.segmentId === 'Left-foot')?.depthMeters).toBeCloseTo(.011, 12);
  });

  it('avoids the fitted boxes’ forearm/body false positives in the neutral source hulls', () => {
    expect(isBodyCollisionBackendReady()).toBe(true);
    const contacts = getCapsuleCollisions(neutral()).selfCollisions;
    expect(contacts.map(pair => pair.segments.join('|')).sort()).toEqual(['Left-hand|Left-thigh', 'Right-hand|Right-thigh']);
    expect(contacts.every(pair => pair.depthMeters > .003)).toBe(true);
  });
});

describe('gesture-only collision path guard', () => {
  it('returns a clear proposal and all components exactly, including unusual author values', () => {
    const source = neutral(2);
    source.joints.Head = [0, 0, -.012345678901234567, .999923789];
    source.joints.LeftToe = [-0, .002, 0, .999998];
    const proposed = withRotation(source, 'Hips', [0, 128, 0]);
    const before = structuredClone(source), candidate = structuredClone(proposed);
    const result = constrainPoseCollisions(source, proposed);
    expect(result.limited).toBe(false);
    expect(result.acceptedFraction).toBe(1);
    expect(result.pose).toBe(proposed);
    expect(result.pose.joints.Head).toBe(proposed.joints.Head);
    expect(result.pose.joints.LeftToe).toBe(proposed.joints.LeftToe);
    expect(source).toEqual(before);
    expect(proposed).toEqual(candidate);
  });

  it('keeps a no-op exact and does only one geometry evaluation', () => {
    const source = neutral(), candidate = structuredClone(source), result = constrainPoseCollisions(source, candidate);
    expect(result.pose).toBe(candidate);
    expect(result.limited).toBe(false);
    expect(result.sampleCount).toBe(1);
  });

  it('stops downward Root at the sole floor boundary and keeps every joint exact', () => {
    const source = neutral(), proposed = { ...source, root: [2, .95, 1] as Vec3 };
    const result = constrainPoseCollisions(source, proposed);
    expect(result.limited).toBe(true);
    expect(result.limitReason).toBe('collision');
    expect(result.pose.root[1]).toBeCloseTo(1.042 - CAPSULE_FLOOR_TOLERANCE_METERS, 7);
    expect(result.acceptedFraction).toBeCloseTo(.11, 6);
    expect(result.pose.root[0]).toBeCloseTo(2 * result.acceptedFraction, 12);
    expect(result.pose.joints).toEqual(source.joints);
    for (const joint of JOINT_NAMES) expect(result.pose.joints[joint]).toBe(proposed.joints[joint]);
    expect(result.blockingCollisions.floorPenetrations.some(item => item.segmentId === 'Left-foot')).toBe(true);
    expect(result.collisions.floorPenetrations).toEqual([]);
    expect(result.sampleCount).toBeLessThan(30);
  });

  it('allows an existing floor intersection to escape but blocks any deepening', () => {
    const source = neutral(.95), up = { ...source, root: [0, 1.05, 0] as Vec3 }, down = { ...source, root: [0, .9, 0] as Vec3 };
    expect(constrainPoseCollisions(source, up).pose).toBe(up);
    const blocked = constrainPoseCollisions(source, down);
    expect(blocked.limited).toBe(true);
    expect(blocked.acceptedFraction).toBeLessThan(1e-6);
    expect(blocked.pose.root[1]).toBeGreaterThanOrEqual(.95 - 1e-8);
  });

  it('keeps repeated small blocked Root gestures bit-exact without accumulating a penetration budget', () => {
    const source = neutral(), first = constrainPoseCollisions(source, { ...source, root: [0, .8, 0] });
    expect(first.limited).toBe(true);
    let accepted = first.pose;
    for (let attempt = 0; attempt < 100; attempt++) {
      const blocked = constrainPoseCollisions(accepted, { ...accepted, root: [accepted.root[0], accepted.root[1] - .01, accepted.root[2]] });
      expect(blocked.limited).toBe(true);
      expect(blocked.pose).toBe(accepted);
      expect(blocked.acceptedFraction).toBe(0);
      accepted = blocked.pose;
    }
    expect(accepted).toBe(first.pose);
    expect(getCapsuleCollisions(accepted).floorPenetrations).toEqual([]);
  });

  it('keeps 100 repeated convex self-contact attempts exact across f32 contact rounding', () => {
    const source = withRotation(neutral(2), 'LeftUpperArm', [0, 0, 15]), hand = evaluatePose(source).LeftHand.position;
    const center = hand.map((value, i) => value - source.root[i] + (i === 0 ? .04 : 0)) as Vec3;
    const obstacle = convex([0, 0, 0], [.015, .015, .015]).definition;
    const profile: AvatarCollisionProfile = { id: 'repeat-convex-contact', colliders: [
      { ...obstacle, id: 'obstacle', vertices: obstacle.vertices.map(vertex => vertex.map((value, i) => value + center[i]) as Vec3), bboxCenterOffset: center },
      { ...capsule([0, 0, 0], [0, 0, 0], .01).definition, id: 'moving-hand' },
    ] };
    const proposed = withRotation(source, 'LeftUpperArm', [0, 0, 25]), first = constrainPoseCollisions(source, proposed, profile);
    expect(first.limited).toBe(true);
    expect(first.acceptedFraction).toBeGreaterThan(0);
    const accepted = first.pose;
    for (let attempt = 0; attempt < 100; attempt++) {
      const blocked = constrainPoseCollisions(accepted, proposed, profile);
      expect(blocked.limited).toBe(true);
      expect(blocked.pose).toBe(accepted);
      expect(blocked.acceptedFraction).toBe(0);
    }
  });

  it('does not spend distance samples on collision-invariant Root translation', () => {
    const source = neutral(), proposed = { ...source, root: [5, 1.05, -5] as Vec3 }, result = constrainPoseCollisions(source, proposed);
    expect(result.pose).toBe(proposed);
    expect(result.limited).toBe(false);
    expect(result.sampleCount).toBe(2);
  });

  it('allows whole-body yaw with existing self overlap because every pair undergoes a shared rigid transform', () => {
    const source = withRotation(neutral(), 'LeftUpperArm', [0, 0, -90]);
    expect(getCapsuleCollisions(source).selfCollisions.length).toBeGreaterThan(0);
    const proposed = withRotation(source, 'Hips', [0, 128, 0]), result = constrainPoseCollisions(source, proposed);
    expect(result.limited).toBe(false);
    expect(result.pose).toBe(proposed);
  });

  it('stops at a swept intersection even though both endpoint poses are clear', () => {
    const source = withRotation(neutral(2), 'LeftUpperArm', [0, 0, 15]);
    const proposed: Pose = { ...source, joints: { ...source.joints, LeftUpperArm: canonicalEditRotation(new Quaternion(...source.joints.LeftUpperArm).multiply(new Quaternion(...rotationFromDegrees([25, 0, 0]))).toArray() as Pose['joints']['LeftUpperArm']) } };
    const midpoint = { ...source, joints: { ...source.joints, LeftUpperArm: new Quaternion(...source.joints.LeftUpperArm).slerp(new Quaternion(...proposed.joints.LeftUpperArm), .5).toArray() as Pose['joints']['LeftUpperArm'] } };
    const hand = evaluatePose(midpoint).LeftHand.position;
    const obstacle = { ...box().definition, id: 'obstacle', centerOffset: hand.map((value, i) => value - source.root[i]) as Vec3, halfExtents: [.015, .015, .015] as Vec3 };
    const moving = { ...capsule([0, 0, 0], [0, 0, 0], .01).definition, id: 'moving-hand' };
    const profile: AvatarCollisionProfile = { id: 'swept-test', colliders: [obstacle, moving] };
    expect(isJointRotationWithinLimits('LeftUpperArm', source.joints.LeftUpperArm)).toBe(true);
    expect(isJointRotationWithinLimits('LeftUpperArm', proposed.joints.LeftUpperArm)).toBe(true);
    expect(getCapsuleCollisions(source, profile).selfCollisions).toEqual([]);
    expect(getCapsuleCollisions(proposed, profile).selfCollisions).toEqual([]);
    expect(getCapsuleCollisions(midpoint, profile).selfCollisions).toHaveLength(1);
    const result = constrainPoseCollisions(source, proposed, profile);
    expect(result.limited).toBe(true);
    expect(result.acceptedFraction).toBeGreaterThan(0);
    expect(result.acceptedFraction).toBeLessThan(.5);
    expect(result.blockingCollisions.selfCollisions).toHaveLength(1);
    expect(result.collisions.selfCollisions).toEqual([]);
    for (const joint of JOINT_NAMES.filter(joint => joint !== 'LeftUpperArm')) expect(result.pose.joints[joint]).toBe(proposed.joints[joint]);
  });

  it('allows a pre-existing self intersection to escape while refusing a path that first deepens it', () => {
    const source = withRotation(neutral(2), 'LeftUpperArm', [0, 0, 15]), hand = evaluatePose(source).LeftHand.position;
    const obstacle = { ...box().definition, id: 'obstacle', centerOffset: hand.map((value, i) => value - source.root[i] + (i === 0 ? .02 : 0)) as Vec3, halfExtents: [.015, .015, .015] as Vec3 };
    const profile: AvatarCollisionProfile = { id: 'escape-test', colliders: [obstacle, { ...capsule([0, 0, 0], [0, 0, 0], .01).definition, id: 'moving-hand' }] };
    expect(getCapsuleCollisions(source, profile).selfCollisions).toHaveLength(1);
    const escape = withRotation(source, 'LeftUpperArm', [0, 0, 10]);
    expect(constrainPoseCollisions(source, escape, profile).pose).toBe(escape);
    const deeper = constrainPoseCollisions(source, withRotation(source, 'LeftUpperArm', [0, 0, 20]), profile);
    expect(deeper.limited).toBe(true);
    expect(deeper.pose).toBe(source);
    expect(deeper.acceptedFraction).toBe(0);
  });

  it('does not create an out-of-envelope intermediate edit between two legal endpoint rotations', () => {
    const source = withRotation(neutral(2), 'LeftHand', [-60, 10, -10]), proposed = withRotation(source, 'LeftHand', [-60, -10, 10]);
    expect(isJointRotationWithinLimits('LeftHand', source.joints.LeftHand)).toBe(true);
    expect(isJointRotationWithinLimits('LeftHand', proposed.joints.LeftHand)).toBe(true);
    const midpoint = new Quaternion(...source.joints.LeftHand).slerp(new Quaternion(...proposed.joints.LeftHand), .5).toArray() as Pose['joints']['LeftHand'];
    expect(isJointRotationWithinLimits('LeftHand', midpoint)).toBe(false);
    const profile: AvatarCollisionProfile = { id: 'nonconvex-limit', colliders: [box().definition] };
    const result = constrainPoseCollisions(source, proposed, profile);
    expect(result.limited).toBe(true);
    expect(result.limitReason).toBe('joint-limit');
    expect(isJointRotationWithinLimits('LeftHand', result.pose.joints.LeftHand)).toBe(true);
  });

  it('returns finite normalized changed quaternions without altering unchanged channels when limited', () => {
    const source = neutral(2), proposed = withRotation(source, 'Hips', [0, 0, 180]);
    proposed.root = [0, .1, 0];
    const result = constrainPoseCollisions(source, proposed);
    expect(result.limited).toBe(true);
    expect(result.pose.joints.Hips.every(Number.isFinite)).toBe(true);
    expect(Math.hypot(...result.pose.joints.Hips)).toBeCloseTo(1, 14);
    expect(Math.hypot(...result.pose.joints.Hips)).toBe(1);
    expect(result.pose.joints.Hips.map(value => value / Math.hypot(...result.pose.joints.Hips))).toEqual(result.pose.joints.Hips);
    expect(isJointRotationWithinLimits('Hips', result.pose.joints.Hips)).toBe(true);
    for (const joint of JOINT_NAMES.filter(joint => joint !== 'Hips')) expect(result.pose.joints[joint]).toBe(proposed.joints[joint]);
    expect(result.acceptedFraction).toBeLessThan(1);
  });

  it('saves a collision-limited visible pose to the exact-time author point without changing any component', () => {
    const source = neutral(2), proposed = withRotation(source, 'Hips', [0, 0, 180]);
    proposed.root = [0, .1, 0];
    const result = constrainPoseCollisions(source, proposed);
    expect(result.limited).toBe(true);
    const take: BakedTake = { id: 'visible-pose', schemaVersion: 'preview-1', planId: 'plan', countMapId: 'map', durationSeconds: 1, times: [0, 1], poses: [source, structuredClone(source)], provenance: 'synthetic-demo' };
    const sequence = upsertMotionPointChanges(makeKeyframeSequence(take), 0, source, result.pose, take);
    const saved = bakeKeyframeSequence(sequence).poses[0];
    expect(saved).toEqual(result.pose);
  });
});

describe('reusable profile configuration', () => {
  const footDefinition = (side: 'Left' | 'Right', width: number) => ({ ...box().definition, id: `${side}-shoe`, anatomicalRegion: `${side}-foot`, family: 'foot' as const, proximal: `${side}Foot` as const, distal: `${side}Foot` as const, attachmentJoints: [`${side}Foot` as const], halfExtents: [width, .1, .1] as Vec3 });
  it('uses each replacement profile and rebuilds its pair cache independently of the default or id', () => {
    const narrow: AvatarCollisionProfile = { id: 'replacement', colliders: [footDefinition('Left', .05), footDefinition('Right', .05)] };
    const broad: AvatarCollisionProfile = { id: 'replacement', colliders: [footDefinition('Left', .2), footDefinition('Right', .2)] };
    const pose = neutral(2);
    expect(getPoseColliders(pose, narrow)).toHaveLength(2);
    expect(getCapsuleCollisions(pose, narrow).selfCollisions).toEqual([]);
    expect(getCapsuleCollisions(pose, broad).selfCollisions).toHaveLength(1);
    expect(getCapsuleCollisions(pose, broad).selfCollisions[0].depthMeters).toBeCloseTo(.176, 12);
    expect(getCapsuleCollisions(pose, narrow).selfCollisions).toEqual([]);
  });

  it('uses replacement foot geometry and optional shoe corners rather than the default 82 mm sole', () => {
    const profile: AvatarCollisionProfile = { id: 'replacement-feet', colliders: [footDefinition('Left', .05)] };
    const pose = neutral(1);
    expect(getCapsuleCollisions(pose, profile).floorPenetrations[0]).toEqual({ segmentId: 'Left-shoe', depthMeters: expect.closeTo(.06, 12) });
    const corners: AvatarCollisionProfile = { ...profile, footGround: { halfWidthMeters: .03, soleOffsetMeters: .02, heelZ: -.04, toeZ: .08 } };
    expect(getCapsuleCollisions(pose, corners).floorPenetrations).toEqual([]);
    const proposed = { ...pose, root: [0, .9, 0] as Vec3 };
    expect(constrainPoseCollisions(pose, proposed, profile).limited).toBe(true);
  });

  it('rejects malformed geometry and duplicate ids before evaluating an asset', () => {
    const source = footDefinition('Left', .05);
    expect(() => getPoseColliders(neutral(), { id: 'bad', colliders: [{ ...source, halfExtents: [.05, 0, .1] }] })).toThrow(/正尺寸/);
    expect(() => getPoseColliders(neutral(), { id: 'bad', colliders: [source, source] })).toThrow(/标识/);
    expect(() => getPoseColliders(neutral(), { id: 'bad', colliders: [{ ...source, localRotation: [0, 0, 0, 0] }] })).toThrow(/单位四元数/);
    expect(() => getPoseColliders(neutral(), { id: 'bad', colliders: [{ ...capsule([0, 0, 0], [0, 0, 0]).definition, radiusMeters: NaN }] })).toThrow(/正半径/);
  });
});
