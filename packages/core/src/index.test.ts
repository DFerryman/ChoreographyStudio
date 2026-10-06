import { describe, expect, it } from 'vitest';
import { ACTIONS, JOINT_NAMES, bakePlan, countAt, makeCountMap, makePlan, replaceSlot, sampleTake, type BakedTake, type Pose, type Quat } from './index';

const input = { bpm: 120, musicBeatsPerDanceCount: 1 as const, firstCountSourceSeconds: 0, startOctet: 0, octetCount: 8, audioDurationSeconds: 90 };
const pose = (x: number, rotation: Quat): Pose => ({
  root: [x, 1.05, 0],
  joints: Object.fromEntries(JOINT_NAMES.map(name => [name, [...rotation]])) as Pose['joints'],
});
const angleZ = (radians: number): Quat => [0, 0, Math.sin(radians / 2), Math.cos(radians / 2)];

describe('confirmed music count mapping', () => {
  it('selects a zero-based source octet and retains exact complete count timing', () => {
    const map = makeCountMap({ ...input, firstCountSourceSeconds: 1.25, startOctet: 2 });
    expect(map.sourceOffsetSeconds).toBe(9.25);
    expect(map.durationSeconds).toBe(32);
    expect(map.countTimesSeconds).toHaveLength(65);
    expect(map.countTimesSeconds.at(-1)).toBe(32);
    expect(map.confirmed).toBe(true);
  });

  it.each([
    { bpm: 0 }, { bpm: Number.NaN }, { firstCountSourceSeconds: -0.1 },
    { startOctet: -1 }, { startOctet: 0.5 }, { octetCount: 4.5 },
    { octetCount: 3 }, { octetCount: 16 }, { audioDurationSeconds: 31.9 },
    { firstCountSourceSeconds: 59, audioDurationSeconds: 90 },
    { musicBeatsPerDanceCount: 3 },
  ])('rejects an invalid or incomplete selection: %j', invalid => {
    expect(() => makeCountMap({ ...input, ...invalid } as typeof input)).toThrow();
  });

  it('uses the music-to-dance count ratio when checking audio bounds', () => {
    const half = makeCountMap({ ...input, musicBeatsPerDanceCount: 0.5, octetCount: 8 });
    const double = makeCountMap({ ...input, musicBeatsPerDanceCount: 2, octetCount: 4 });
    expect(half.durationSeconds).toBe(16);
    expect(double.durationSeconds).toBe(32);
    expect(double.countTimesSeconds[1]).toBe(1);
    expect(() => makeCountMap({ ...input, musicBeatsPerDanceCount: 2, octetCount: 4, startOctet: 2, audioDurationSeconds: 47.9 })).toThrow(/超出音频/);
  });

  it('requires at least two octets even when a single slow octet lasts sixteen seconds', () => {
    expect(() => makeCountMap({ ...input, bpm: 30, octetCount: 1 })).toThrow(/至少 2/);
    expect(makeCountMap({ ...input, bpm: 30, octetCount: 2 }).durationSeconds).toBe(32);
  });

  it('enforces explicit preview resource limits before allocating count arrays', () => {
    expect(() => makeCountMap({ ...input, bpm: 29.99 })).toThrow(/当前预览支持 30–240 BPM/);
    expect(() => makeCountMap({ ...input, bpm: 240.01 })).toThrow(/当前预览支持 30–240 BPM/);
    expect(() => makeCountMap({ ...input, octetCount: 1_000_000_000 })).toThrow(/当前预览支持最多 60/);
    // Supported edges are legal when the selected complete phrases fit 16–60 s.
    expect(makeCountMap({ ...input, bpm: 240, musicBeatsPerDanceCount: 0.5, octetCount: 60 }).durationSeconds).toBe(60);
  });

  it('keeps the final pose on count eight and clamps seek bounds', () => {
    const map = makeCountMap(input);
    expect(countAt(map, 0)).toEqual({ octet: 1, count: 1 });
    expect(countAt(map, 0.5)).toEqual({ octet: 1, count: 2 });
    expect(countAt(map, 4)).toEqual({ octet: 2, count: 1 });
    expect(countAt(map, 31.999)).toEqual({ octet: 8, count: 8 });
    expect(countAt(map, 32)).toEqual({ octet: 8, count: 8 });
    expect(countAt(map, 100)).toEqual({ octet: 8, count: 8 });
    expect(countAt(map, -10)).toEqual({ octet: 1, count: 1 });
  });
});

describe('BakedTake playback contract', () => {
  it('samples a short nonuniform ending interval and SLERPs instead of lerping rotations', () => {
    const take: BakedTake = {
      id: 'fixture', planId: 'plan', countMapId: 'map', schemaVersion: 'preview-1',
      provenance: 'synthetic-demo', durationSeconds: 1.02, times: [0, 1, 1.02],
      poses: [pose(0, angleZ(0)), pose(10, angleZ(Math.PI / 2)), pose(20, angleZ(Math.PI))],
    };
    const sampled = sampleTake(take, 1.01);
    expect(sampled.root[0]).toBeCloseTo(15, 10);
    expect(sampled.joints.Head[2]).toBeCloseTo(Math.sin(3 * Math.PI / 8), 10);
    expect(sampled.joints.Head[3]).toBeCloseTo(Math.cos(3 * Math.PI / 8), 10);
    expect(sampleTake(take, 1.02)).toEqual(take.poses[2]);
    expect(sampleTake(take, 20)).toEqual(take.poses[2]);
    expect(sampleTake(take, -1)).toEqual(take.poses[0]);
    sampled.root[0] = -5;
    expect(take.poses[1].root[0]).toBe(10);
  });

  it('treats antipodal quaternions as the same orientation rather than a full spin', () => {
    const q = angleZ(Math.PI / 3);
    const take: BakedTake = {
      id: 'fixture', planId: 'plan', countMapId: 'map', schemaVersion: 'preview-1',
      provenance: 'synthetic-demo', durationSeconds: 1, times: [0, 1],
      poses: [pose(0, q), pose(1, q.map(value => -value) as Quat)],
    };
    const middle = sampleTake(take, 0.5).joints.LeftUpperArm;
    expect(middle[2]).toBeCloseTo(q[2], 12);
    expect(middle[3]).toBeCloseTo(q[3], 12);
    expect(Math.hypot(...middle)).toBeCloseTo(1, 12);
  });

  it('bakes exact slot boundaries and exact D even when neither is on the 30 Hz grid', () => {
    const map = makeCountMap({ ...input, bpm: 137, octetCount: 6 });
    const plan = makePlan(map);
    const take = bakePlan(plan, map);
    expect(JOINT_NAMES).toHaveLength(25);
    expect(take.schemaVersion).toBe('preview-1');
    expect(take.provenance).toBe('synthetic-demo');
    expect(take.times.at(-1)).toBe(map.durationSeconds);
    for (const slot of plan.slots) expect(take.times).toContain(slot.startSeconds);
    for (let index = 1; index < take.times.length; index++) expect(take.times[index]).toBeGreaterThan(take.times[index - 1]);
    expect(Math.hypot(...sampleTake(take, map.durationSeconds - 0.007).joints.LeftUpperArm)).toBeCloseTo(1, 10);
  });

  it('raises both arms outward for the +Z-facing preview rig, keeping anatomical left on +X', () => {
    const map = makeCountMap(input), plan = makePlan(map), take = bakePlan(plan, map);
    const raised = sampleTake(take, 26); // middle of the overhead-reach octet
    // Rotating rest (0,-1,0): x = 2(w*z - x*y). An outward left
    // forearm points toward +X; the right points toward -X.
    const directionX = ([x, y, z, w]: Quat) => 2 * (w * z - x * y);
    expect(directionX(raised.joints.LeftUpperArm)).toBeGreaterThan(0.5);
    expect(directionX(raised.joints.RightUpperArm)).toBeLessThan(-0.5);
    expect(raised.root[1]).toBe(1.05);
  });
});

describe('single-octet candidate replacement', () => {
  it('changes the interior while preserving every outside interpolated pose and boundary support sample', () => {
    const map = makeCountMap({ ...input, bpm: 137, octetCount: 6 });
    const plan = makePlan(map);
    const take = bakePlan(plan, map);
    const serialized = JSON.stringify({ plan, take });
    const slot = plan.slots[2];
    const result = replaceSlot(plan, take, map, 2);
    expect(result.plan.id).not.toBe(plan.id);
    expect(result.take.id).not.toBe(take.id);
    expect(result.take.planId).toBe(result.plan.id);
    expect(result.plan.slots[2].actionId).not.toBe(slot.actionId);
    expect(result.take.times).toEqual(take.times);
    expect(JSON.stringify({ plan, take })).toBe(serialized);
    const start = take.times.indexOf(slot.startSeconds), end = take.times.indexOf(slot.endSeconds);
    for (let index = 0; index < take.times.length; index++) {
      if (index <= start + 1 || index >= end - 1) expect(result.take.poses[index]).toEqual(take.poses[index]);
    }
    // Exercise interval interiors, not only copied baked knots. Any outside
    // interpolation must depend solely on preserved support samples.
    for (let index = 0; index < 333; index++) {
      const time = map.durationSeconds * (index + 0.314) / 333;
      if (time < slot.startSeconds || time > slot.endSeconds) expect(sampleTake(result.take, time)).toEqual(sampleTake(take, time));
    }
    const middle = (slot.startSeconds + slot.endSeconds) / 2;
    expect(sampleTake(result.take, middle)).not.toEqual(sampleTake(take, middle));
    for (const index of [0, 1, 3, 4, 5]) expect(result.plan.slots[index]).toEqual(plan.slots[index]);
  });

  it('simplifies strictly and reports when there is no easier legal demo action', () => {
    const map = makeCountMap(input), plan = makePlan(map), take = bakePlan(plan, map);
    const result = replaceSlot(plan, take, map, 1, true);
    const oldAction = ACTIONS.find(action => action.id === plan.slots[1].actionId)!;
    const newAction = ACTIONS.find(action => action.id === result.plan.slots[1].actionId)!;
    expect(newAction.complexity).toBeLessThan(oldAction.complexity);
    expect(() => replaceSlot(plan, take, map, 0, true)).toThrow(/最简单/);
    expect(() => replaceSlot(plan, take, map, 99)).toThrow(/有效八拍/);
    expect(() => replaceSlot(plan, { ...take, planId: 'stale-plan' }, map, 1)).toThrow(/版本不匹配/);
  });
});
