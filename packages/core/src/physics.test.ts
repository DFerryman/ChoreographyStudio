import { describe, expect, it } from 'vitest';
import { STANDARD_HUMAN_PROFILE as profile } from './humanProfile';
import { analyzePose, simulatePhysicsTake } from './physics';
import { JOINT_NAMES, type BakedTake, type Pose } from './motion-types';
import { isJointRotationWithinLimits } from './jointConstraints';
import { rotationFromDegrees } from './keyframes';

const neutral = (height = 1.05): Pose => ({ root: [0, height, 0], joints: Object.fromEntries(JOINT_NAMES.map(joint => [joint, [0, 0, 0, 1]])) as Pose['joints'] });
const take = (poses: Pose[], times = poses.map((_, index) => index / (poses.length - 1))): BakedTake => ({ id: 'physics-source', schemaVersion: 'preview-1', planId: 'plan', countMapId: 'map', durationSeconds: times.at(-1)!, times, poses, provenance: 'synthetic-demo' });
const at = (result: BakedTake, time: number) => result.poses[result.times.findIndex(t => Math.abs(t - time) < 1e-8)];

describe('built-in neutral human profile and read-only diagnostics', () => {
  it('has symmetric, immutable, positive segment masses adding to the entire 70 kg body', () => {
    expect(profile.segments.reduce((sum, segment) => sum + segment.massFraction, 0)).toBeCloseTo(1, 12);
    expect(profile.massKg).toBe(70);
    expect(profile.heightMeters).toBe(1.85);
    expect(profile.gravityMps2).toBe(9.81);
    for (const segment of profile.segments) {
      expect(segment.massFraction).toBeGreaterThan(0);
      expect(Object.isFrozen(segment)).toBe(true);
      expect(Object.isFrozen(segment.proximalOffset)).toBe(true);
      if (segment.id.startsWith('Left-')) expect(profile.segments.find(other => other.id === segment.id.replace('Left-', 'Right-'))?.massFraction).toBe(segment.massFraction);
    }
    expect(Object.isFrozen(profile)).toBe(true);
    expect(Object.isFrozen(profile.drive)).toBe(true);
    expect(profile.drive.maxHorizontalForceNewtons).toBeGreaterThan(0);
    expect(profile.ground.friction).toBeGreaterThan(0);
  });

  it('uses weighted segment centers, and moving one arm shifts COM and inertia', () => {
    const source = neutral(), before = structuredClone(source);
    const resting = analyzePose(source);
    expect(resting.centerOfMass[0]).toBeCloseTo(0, 10);
    expect(Math.abs(resting.centerOfMass[1] - source.root[1])).toBeGreaterThan(.001);
    expect(resting.segments.reduce((sum, segment) => sum + segment.massKg, 0)).toBeCloseTo(70, 10);
    const raised = structuredClone(source);
    raised.joints.LeftUpperArm = rotationFromDegrees([0, 0, 90]);
    const result = analyzePose(raised);
    expect(result.centerOfMass[0]).toBeGreaterThan(resting.centerOfMass[0] + .012);
    expect(result.centerOfMass[1]).toBeGreaterThan(resting.centerOfMass[1] + .008);
    expect(result.principalInertia).not.toEqual(resting.principalInertia);
    expect(result.principalInertia.every(value => Number.isFinite(value) && value > 0)).toBe(true);
    expect(Math.hypot(...result.inertiaFrame)).toBeCloseTo(1, 10);
    expect(source).toEqual(before);
  });

  it('calibrates the sole against rendered geometry instead of toe/heel marker centers', () => {
    const standing = analyzePose(neutral());
    expect(standing.feet.Left.minimumHeightMeters).toBeCloseTo(.008, 10);
    expect(standing.feet.Left.soleCorners).toHaveLength(4);
    expect(standing.balance).toBe('supported');
    expect(standing.floorPenetrations).toEqual([]);
    expect(standing.selfCollisions).toEqual([]);
    const lowered = analyzePose(neutral(.95));
    expect(lowered.floorPenetrations.find(item => item.segmentId === 'Left-foot')?.depthMeters).toBeCloseTo(.092, 10);
    expect(lowered.feet.Left.grounded).toBe(false);
  });

  it('only applies a support-polygon hint to quasi-static poses, allowing flight and dynamic turns', () => {
    const source = neutral();
    source.joints.RightUpperLeg = rotationFromDegrees([-40, 0, 0]);
    expect(analyzePose(source).balance).toBe('outside-support');
    expect(analyzePose(source, { motionState: 'dynamic' }).balance).toBe('dynamic-unassessed');
    expect(analyzePose(source, { motionState: 'airborne' }).balance).toBe('airborne');
    expect(analyzePose(neutral(2)).balance).toBe('airborne');
  });

  it('filters anatomical neighboring overlap but diagnoses non-adjacent limb/body crossing', () => {
    const pose = neutral();
    pose.joints.LeftUpperArm = rotationFromDegrees([0, 0, -90]);
    const diagnostics = analyzePose(pose);
    expect(diagnostics.selfCollisions.length).toBeGreaterThan(0);
    expect(diagnostics.selfCollisions.some(pair => pair.segments.includes('Left-forearm') || pair.segments.includes('Left-hand'))).toBe(true);
    expect(diagnostics.selfCollisions.every(pair => pair.depthMeters > .012)).toBe(true);
  });
});

describe('explicit fixed-step Rapier gravity assistance', () => {
  it('uses dynamic gravity for a floating body, then real ground contact stops the fall', async () => {
    const source = take([neutral(2.05), neutral(2.05)]);
    const before = structuredClone(source);
    const result = await simulatePhysicsTake(source);
    expect(result.engine).toBe('rapier-0.21.0');
    expect(result.stepCount).toBe(120);
    expect(result.fixedStepSeconds).toBe(1 / 120);
    expect(at(result.take, .2).root[1]).toBeCloseTo(2.05 - .5 * 9.81 * .2 ** 2, 1);
    expect(result.take.poses.at(-1)!.root[1]).toBeLessThan(1.1);
    expect(result.take.poses.at(-1)!.root[1]).toBeGreaterThan(1);
    const landed = analyzePose(result.take.poses.at(-1)!);
    expect(landed.feet.Left.minimumHeightMeters).toBeGreaterThan(-.012);
    expect(result.groundedSamples).toBeGreaterThan(0);
    expect(result.airborneSamples).toBeGreaterThan(0);
    expect(result.maxLandingSpeedMps).toBeGreaterThan(3);
    expect(source).toEqual(before);
  });

  it('keeps a quiet standing intent near calibrated floor contact without joint drift', async () => {
    const result = await simulatePhysicsTake(take([neutral(), neutral()], [0, 2]));
    const final = result.take.poses.at(-1)!;
    expect(final.root[1]).toBeCloseTo(1.042, 2);
    expect(Math.abs(final.root[0])).toBeLessThan(.015);
    expect(Math.abs(final.root[2])).toBeLessThan(.015);
    expect(analyzePose(final).feet.Left.minimumHeightMeters).toBeGreaterThan(-.012);
    expect(final.joints.LeftLowerLeg).toEqual([0, 0, 0, 1]);
    expect(final.joints.RightLowerLeg).toEqual([0, 0, 0, 1]);
  });

  it('releases position drives in flight rather than following an impossible floating authored path', async () => {
    const a = neutral(2.05), b = neutral(2.55);
    const result = await simulatePhysicsTake(take([a, b]));
    const pose = at(result.take, .2);
    expect(pose.root[1]).toBeCloseTo(2.05 + .5 * .2 - .5 * 9.81 * .2 ** 2, 1);
    expect(pose.root[1]).toBeLessThan(2.05);
    expect(result.maxRootDisplacementMeters).toBeGreaterThan(1);
  });

  it('uses finite grounded drives and friction, so an extreme horizontal intent cannot teleport the body', async () => {
    const a = neutral(), b = neutral(); b.root[0] = 10;
    const result = await simulatePhysicsTake(take([a, b], [0, .2]));
    const final = result.take.poses.at(-1)!;
    expect(final.root[0]).toBeGreaterThan(0);
    expect(final.root[0]).toBeLessThan(2);
    expect(result.maxRootDisplacementMeters).toBeGreaterThan(8);
    expect(result.take.poses.every(pose => pose.root.every(Number.isFinite))).toBe(true);
    expect(analyzePose(final).feet.Left.minimumHeightMeters).toBeGreaterThan(-.02);
  });

  it('derives takeoff intent but bounds it, and lands through contact rather than teleporting', async () => {
    const source = take([neutral(), neutral(), neutral(1.25), neutral(1.55), neutral(1.25), neutral()], [0, .1, .2, .4, .6, .8]);
    const result = await simulatePhysicsTake(source);
    expect(Math.max(...result.take.poses.map(pose => pose.root[1]))).toBeGreaterThan(1.10);
    expect(result.airborneSamples).toBeGreaterThan(0);
    expect(result.maxLandingSpeedMps).toBeGreaterThan(.5);
    expect(result.take.poses.at(-1)!.root[1]).toBeLessThan(1.12);
    for (let index = 1; index < result.take.poses.length; index++) expect(Math.abs(result.take.poses[index].root[1] - result.take.poses[index - 1].root[1])).toBeLessThan(.2);
  });

  it('preserves explicit source times and a nonuniform exact end, and reproduces results', async () => {
    const source = take([neutral(1.5), neutral(1.5), neutral(1.5)], [0, .137, 1.037]);
    const one = await simulatePhysicsTake(source), two = await simulatePhysicsTake(source);
    expect(one.take.times).toContain(.137);
    expect(one.take.times.at(-1)).toBe(1.037);
    expect(one.take.poses).toEqual(two.take.poses);
    expect(one.take.id).toBe(two.take.id);
    expect(one.take.id).not.toBe(source.id);
    expect(one.stepCount).toBe(125);
    expect(one.take.times.length).toBeLessThanOrEqual(6001);
    expect(one.take.planId).toBe(source.planId);
    expect(one.take.countMapId).toBe(source.countMapId);
  });

  it('handles the actual 60-second scene envelope within fixed-step and output resource limits', async () => {
    const source = take([neutral(), neutral()], [0, 60]);
    const progress: number[] = [];
    const result = await simulatePhysicsTake(source, { onProgress: fraction => progress.push(fraction) });
    expect(result.stepCount).toBe(7200);
    expect(result.take.times).toHaveLength(1801);
    expect(result.take.times.at(-1)).toBe(60);
    expect(progress.at(-1)).toBe(1);
    expect(progress.every((value, index) => !index || value >= progress[index - 1])).toBe(true);
    expect(result.take.poses.every(pose => pose.root.every(Number.isFinite))).toBe(true);
    expect(result.take.poses.at(-1)!.root[1]).toBeGreaterThan(1);
    expect(result.take.poses.at(-1)!.root[1]).toBeLessThan(1.1);
    expect(result.take.poses.at(-1)!.root[0]).toBeCloseTo(0, 1);
    expect(result.take.poses.at(-1)!.root[2]).toBeCloseTo(0, 1);
    expect(source.poses).toEqual([neutral(), neutral()]);
  }, 15000);

  it('constrains future simulated joints while preserving the entire legacy input', async () => {
    const pose = neutral(1.4);
    pose.joints.LeftLowerLeg = rotationFromDegrees([-90, 40, 0]);
    pose.joints.LeftForeArm = rotationFromDegrees([60, 0, 0]);
    const source = take([pose, structuredClone(pose)], [0, .1]);
    const before = structuredClone(source);
    const result = await simulatePhysicsTake(source);
    for (const output of result.take.poses) for (const joint of JOINT_NAMES) expect(isJointRotationWithinLimits(joint, output.joints[joint])).toBe(true);
    expect(source).toEqual(before);
  });

  it('rejects invalid times/duration/sample growth and supports cancellation without partial results', async () => {
    await expect(simulatePhysicsTake(take([neutral(), neutral()], [0, 61]))).rejects.toThrow(/60/);
    await expect(simulatePhysicsTake(take([neutral(), neutral(), neutral()], [0, .5, .5]))).rejects.toThrow(/时刻/);
    const times = Array.from({ length: 6001 }, (_, index) => index === 0 ? 0 : index === 6000 ? 60 : index / 100 + .00001);
    await expect(simulatePhysicsTake(take(times.map(() => neutral()), times))).rejects.toThrow(/6001/);
    const controller = new AbortController(); controller.abort();
    await expect(simulatePhysicsTake(take([neutral(), neutral()]), { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
    const mid = new AbortController();
    await expect(simulatePhysicsTake(take([neutral(), neutral()], [0, 5]), { signal: mid.signal, onProgress: fraction => { if (fraction > 0) mid.abort(); } })).rejects.toMatchObject({ name: 'AbortError' });
    expect((await simulatePhysicsTake(take([neutral(), neutral()], [0, .1]))).take.poses.length).toBe(4);
  });
});
