import { beforeAll, describe, expect, it } from 'vitest';
import { Quaternion, Vector3 } from 'three';
import { AVATAR_COLLISION_PROFILE } from './avatarCapsules.generated';
import { getBodyCollisions, getPoseColliders, type AvatarCollisionProfile } from './capsuleCollision';
import { resolveCollisionPreview, sampleCollisionPreview } from './collisionPreview';
import { evaluatePose, RIG_DEFINITIONS } from './humanoid';
import { sampleTake } from './index';
import { rotationFromDegrees } from './keyframes';
import { JOINT_NAMES, type BakedTake, type JointName, type Pose, type Vec3 } from './motion-types';
import { initializeBodyCollisionBackend } from './rapierBackend';

beforeAll(async () => { await initializeBodyCollisionBackend(); });
const neutral = (height = 1.05): Pose => ({ root: [0, height, 0], joints: { ...Object.fromEntries(JOINT_NAMES.map(joint => [joint, [0, 0, 0, 1]])) as Pose['joints'], LeftUpperArm: rotationFromDegrees([0, 0, 20]), RightUpperArm: rotationFromDegrees([0, 0, -20]) } });
const turn = (pose: Pose, joint: JointName, degrees: Vec3): Pose => ({ root: pose.root, joints: { ...pose.joints, [joint]: rotationFromDegrees(degrees) } });
const take = (poses: Pose[], times = [0, .012345, .0289, .0347]): BakedTake => ({ id: 'same-id', schemaVersion: 'preview-1', planId: 'plan', countMapId: 'map', durationSeconds: times.at(-1)!, times, poses, provenance: 'synthetic-demo' });
const penetration = (pose: Pose, profile = AVATAR_COLLISION_PROFILE) => getBodyCollisions(pose, profile).selfCollisions.reduce((sum, contact) => sum + Math.max(0, contact.depthMeters - .003) ** 2, 0);
function freeze<T>(value: T): T {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}

describe('derived collision preview', () => {
  it('returns the same pose and every exact tuple when there is no contact', () => {
    const source = freeze(turn(neutral(), 'Head', [0, 175.321, 0]));
    const result = resolveCollisionPreview(source);
    expect(result.corrected).toBe(false);
    expect(result.pose).toBe(source);
    expect(result.collisions).toEqual({ profileId: AVATAR_COLLISION_PROFILE.id, selfCollisions: [], floorPenetrations: [] });
  });

  it('keeps authored floor penetration intact and visibly derives a floor-supported pose', () => {
    const source = freeze(turn(neutral(.42), 'Head', [12.345, 0, 0])), original = structuredClone(source);
    const result = resolveCollisionPreview(source);
    expect(result.sourceCollisions.floorPenetrations.length).toBeGreaterThan(0);
    expect(result.corrected).toBe(true);
    expect(result.pose.root[1]).toBeGreaterThan(source.root[1]);
    expect(getBodyCollisions(result.pose).floorPenetrations).toEqual([]);
    expect(result.pose.root[0]).toBe(source.root[0]); expect(result.pose.root[2]).toBe(source.root[2]);
    expect(result.pose.joints).toBe(source.joints);
    expect(source).toEqual(original);
  });

  it('reduces real arm/body penetration while preserving unrelated source rotations and bone lengths', () => {
    const source = freeze(turn(turn(neutral(), 'LeftUpperArm', [0, 0, -90]), 'Head', [0, 12.345, 0]));
    const result = resolveCollisionPreview(source);
    expect(penetration(source)).toBeGreaterThan(0);
    expect(penetration(result.pose)).toBeLessThan(penetration(source) * .2);
    expect(result.pose.joints.Head).toBe(source.joints.Head);
    expect(result.pose.joints.RightUpperArm).toBe(source.joints.RightUpperArm);
    const world = evaluatePose(result.pose);
    for (const definition of RIG_DEFINITIONS) if (definition.parent) {
      expect(new Vector3(...world[definition.name].position).distanceTo(new Vector3(...world[definition.parent].position))).toBeCloseTo(Math.hypot(...definition.offset), 12);
    }
  });

  it('evaluates the same exact off-grid and short final times independently of access order', () => {
    const source = freeze(take([neutral(.42), turn(neutral(.5), 'LeftUpperArm', [0, 0, -90]), neutral(.6), neutral(.7)])), original = structuredClone(source);
    const points = [0, .005, .012345, .02, .0289, .0337, .0347];
    const forward = points.map(time => sampleCollisionPreview(source, time));
    const independentSource = freeze(structuredClone(source));
    const reverse = [...points].reverse().map(time => sampleCollisionPreview(independentSource, time));
    reverse.reverse().forEach((result, index) => expect(result).toEqual(forward[index]));
    points.forEach((time, index) => expect(sampleCollisionPreview(source, time).pose).toEqual(forward[index].pose));
    expect(source).toEqual(original);
    expect(source.times).toEqual([0, .012345, .0289, .0347]);
    expect(reverse[0]).not.toBe(forward[0]); // A separate Take forces cold evaluation.
  });

  it('corrects a colliding interpolation midpoint instead of relying on clear source endpoints', () => {
    const a = turn(neutral(), 'LeftUpperArm', [0, 0, 10]), b = turn(neutral(), 'LeftUpperArm', [0, 0, -169]);
    const source = take([a, b], [0, .04123]), middle = sampleTake(source, .020615);
    expect(getBodyCollisions(a).selfCollisions).toEqual([]);
    expect(getBodyCollisions(b).selfCollisions).toEqual([]);
    expect(penetration(middle)).toBeGreaterThan(0);
    expect(penetration(sampleCollisionPreview(source, .020615).pose)).toBeLessThan(penetration(middle));
  });

  it('never reuses a preview for a replacement Take with the same animation ID', () => {
    const lowered = take([neutral(.4), neutral(.4)], [0, 1]), clear = take([neutral(), neutral()], [0, 1]);
    expect(sampleCollisionPreview(lowered, .25).corrected).toBe(true);
    expect(sampleCollisionPreview(clear, .25).corrected).toBe(false);
    expect(sampleCollisionPreview(clear, .25).pose).toEqual(sampleTake(clear, .25));
  });

  it('keys contact caches by profile identity as well as take identity', () => {
    const source = take([neutral(.4), neutral(.4)], [0, 1]);
    const profile: AvatarCollisionProfile = { id: AVATAR_COLLISION_PROFILE.id, colliders: [{ shape: 'box', id: 'fixture', anatomicalRegion: 'fixture', proximal: 'Head', distal: 'Head', attachmentJoints: ['Head'], family: 'head', centerOffset: [0, 0, 0], halfExtents: [.01, .01, .01], localRotation: [0, 0, 0, 1] }] };
    expect(sampleCollisionPreview(source, .4).corrected).toBe(true);
    expect(sampleCollisionPreview(source, .4, profile).corrected).toBe(false);
    expect(getPoseColliders(sampleCollisionPreview(source, .4, profile).pose, profile)).toHaveLength(1);
  });

  it('reports an inseparable rigid-proxy overlap within its finite iteration budget', () => {
    const shared = { shape: 'box' as const, anatomicalRegion: 'fixture', proximal: 'Hips' as const, distal: 'Hips' as const, family: 'trunk' as const, centerOffset: [0, 0, 0] as Vec3, halfExtents: [.1, .1, .1] as Vec3, localRotation: [0, 0, 0, 1] as const };
    const profile: AvatarCollisionProfile = { id: 'rigid-overlap', colliders: [{ ...shared, id: 'a', attachmentJoints: ['LeftFoot'] }, { ...shared, id: 'b', attachmentJoints: ['RightFoot'] }] };
    const source = freeze(neutral(2)), result = resolveCollisionPreview(source, profile);
    expect(result.iterations).toBeLessThanOrEqual(4);
    expect(result.pose).toBe(source);
    expect(result.corrected).toBe(false);
    expect(result.collisions.selfCollisions).toEqual(getBodyCollisions(source, profile).selfCollisions);
    expect(result.collisions.selfCollisions[0].depthMeters).toBeCloseTo(.2, 12);
    expect(result.sourceCollisions).toEqual(result.collisions);
  });

  it('keeps a nearby floor-supported path continuous and preserves the unmodified source channel', () => {
    const poses = [.419999, .42, .420001].map(height => freeze(turn(neutral(height), 'Head', [0, 13.123456789, 0])));
    const previews = poses.map(pose => resolveCollisionPreview(pose));
    for (let index = 0; index < previews.length; index++) {
      expect(getBodyCollisions(previews[index].pose).floorPenetrations).toEqual([]);
      expect(previews[index].pose.joints.Head).toBe(poses[index].joints.Head);
      if (index) expect(new Vector3(...previews[index].pose.root).distanceTo(new Vector3(...previews[index - 1].pose.root))).toBeLessThan(1e-9);
    }
  });

  it('does not make a large rotation branch jump for a small perturbation of one arm contact', () => {
    const poses = [-90.001, -90, -89.999].map(angle => turn(neutral(), 'LeftUpperArm', [0, 0, angle]));
    const previews = poses.map(pose => resolveCollisionPreview(pose));
    for (let index = 1; index < previews.length; index++) for (const joint of JOINT_NAMES) {
      expect(new Quaternion(...previews[index].pose.joints[joint]).angleTo(new Quaternion(...previews[index - 1].pose.joints[joint]))).toBeLessThan(.03);
    }
    previews.forEach((result, index) => expect(penetration(result.pose)).toBeLessThan(penetration(poses[index]) * .2));
  });

  it('recomputes the same pose after an exact-time cache has exceeded its bounded working set', () => {
    const source = freeze(take([neutral(.42), neutral(.42)], [0, 1]));
    const first = sampleCollisionPreview(source, .012345);
    for (let index = 0; index < 257; index++) sampleCollisionPreview(source, index / 256);
    const refreshed = sampleCollisionPreview(source, .012345);
    expect(refreshed).not.toBe(first);
    expect(refreshed).toEqual(first);
  });
});
