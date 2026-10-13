import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { JOINT_NAMES, makeCountMap, makeKeyframeSequence, rotationFromDegrees, sampleTake, type BakedTake, type Pose } from '../../../packages/core/src';
import { RIG_DEFINITIONS } from '../../../packages/core/src/humanoid';
import { AI_MOTION_REQUEST_MAX_BYTES } from '../../../packages/core/src/aiMotion';
import { makeAIMotionResultFixture } from '../../../packages/core/src/aiMotion.fixture';
import { appendAIMotionPatch, compileAIMotionPatch, createAIMotionSampler } from '../../../packages/core/src/aiMotionTrack';
import type { SceneSnapshot } from './sceneProject';
import { buildAIMotionRequest, sourceStampForAIMotion, type BuildAIMotionRequestOptions } from './aiMotionContext';

function fixture() {
  const countMap = makeCountMap({ bpm: 120, musicBeatsPerDanceCount: 1, firstCountSourceSeconds: 3, octetCount: 4, audioDurationSeconds: 40 });
  const times = [0, .113, 1.017, 3.271, countMap.durationSeconds];
  const pose = (time: number): Pose => ({ root: [time / 4, 1.05, 0],
    joints: Object.fromEntries(JOINT_NAMES.map(name => [name, name === 'Head' ? rotationFromDegrees([0, time * 10, 0]) : [0, 0, 0, 1]])) as Pose['joints'] });
  const take: BakedTake = { id: 'nonuniform-author', schemaVersion: 'preview-1', planId: 'original-plan', countMapId: countMap.id,
    durationSeconds: countMap.durationSeconds, times, poses: times.map(pose), provenance: 'synthetic-demo' };
  const snapshot: SceneSnapshot = { title: '原动作', countMap, plan: null, take, manual: makeKeyframeSequence(take) };
  const options: BuildAIMotionRequestOptions = { prompt: '转身抬手，保持原动作两端', sceneId: 'local-scene', baseRevision: 7, snapshot,
    range: { start: 2.113, end: 5.717 }, audioBlob: new Blob(['original local music'], { type: 'audio/wav' }), audioName: '主音乐.wav', audioDurationSeconds: 40 };
  return { countMap, take, snapshot, options };
}

describe('captured structured-motion context (local only, no inference)', () => {
  it('retains actual times, authoritative poses and derivatives without changing legacy motion', async () => {
    const { take, snapshot, options } = fixture();
    // Legacy author data is identity/provenance context, not an instruction to
    // rebake a different take over the already authoritative stored take.
    snapshot.manual!.root = [{ frame: 30, position: [99, 99, 99] }];
    const original = JSON.stringify(snapshot);
    const request = await buildAIMotionRequest(options);
    const { start, end } = request.context.boundaries;
    expect(request.context.target).toEqual({ mode: 'interval', startSeconds: 2.113, endSeconds: 5.717 });
    expect(request.context.initialPose).toEqual(sampleTake(take, 2.113));
    expect(start.pose).toEqual(sampleTake(take, 2.113));
    expect(end.pose).toEqual(sampleTake(take, 5.717));
    expect(start.linearVelocity[0]).toBeCloseTo(.25, 8);
    expect(end.linearVelocity[0]).toBeCloseTo(.25, 8);
    expect(start.angularVelocity.Head[1]).toBeCloseTo(10 * Math.PI / 180, 8);
    expect(start.support).toBe('unknown'); expect(start.supportConfidence).toBe(0);
    expect(end.support).toBe('unknown'); expect(end.supportConfidence).toBe(0);
    expect(request.context.before).toHaveLength(4); expect(request.context.after).toHaveLength(4);
    expect(request.context.before[0].time).toBeCloseTo(1.113, 12);
    expect(request.context.before.at(-1)!.time).toBe(2.113);
    expect(request.context.after[0].time).toBe(5.717);
    expect(request.context.after.at(-1)!.time).toBeCloseTo(6.717, 12);
    for (const point of [...request.context.before, ...request.context.after]) expect(point.pose).toEqual(sampleTake(take, point.time));
    expect(JSON.stringify(snapshot)).toBe(original);
    expect(take.times).toEqual([0, .113, 1.017, 3.271, 16]);
  });

  it('uses the canonical skeleton and confirmed CountMap separately from music placement', async () => {
    const { snapshot, options } = fixture(); snapshot.audioOffsetSeconds = 2;
    const originalCounts = structuredClone(snapshot.countMap);
    const request = await buildAIMotionRequest(options);
    expect(request.context.skeleton.id).toBe('neutral-rig-2');
    expect(request.context.skeleton.joints).toEqual(RIG_DEFINITIONS.map(joint => ({ name: joint.name, parent: joint.parent, offset: [...joint.offset], restRotation: [0, 0, 0, 1] })));
    expect(request.context.skeleton.coordinateSystem).toBe('right-handed-y-up-z-forward');
    expect(request.context.timing).toEqual(originalCounts);
    expect(request.context.timing.countTimesSeconds).not.toBe(snapshot.countMap.countTimesSeconds);
    expect(snapshot.countMap).toEqual(originalCounts);
    expect(request.context.audio[0]).toMatchObject({ offsetSeconds: 2, sourceOffsetSeconds: 3, durationSeconds: 40, coverage: { startSeconds: 2, endSeconds: 16 } });
  });

  it('describes world foot positions and velocities from FK without inventing contact or changing the source', async () => {
    const { options, take } = fixture();
    for (const [index, pose] of take.poses.entries()) pose.joints.LeftUpperLeg = rotationFromDegrees([take.times[index] * 10, 0, 0]);
    const original = JSON.stringify(take);
    const request = await buildAIMotionRequest(options);
    for (const boundary of [request.context.boundaries.start, request.context.boundaries.end]) {
      const angle = boundary.time * 10 * Math.PI / 180, omega = 10 * Math.PI / 180;
      // Independently derived from the calibrated 0.112m hip spread, 0.05m
      // hip drop and 0.46m + 0.45m leg chain, rather than calling the helper.
      const leftPosition = [boundary.time / 4 + .112, 1.05 - .05 - .91 * Math.cos(angle), -.91 * Math.sin(angle)];
      const leftVelocity = [.25, .91 * Math.sin(angle) * omega, -.91 * Math.cos(angle) * omega];
      const feet = boundary.footKinematics!;
      for (let axis = 0; axis < 3; axis++) {
        expect(feet.left.position[axis]).toBeCloseTo(leftPosition[axis], 11);
        expect(feet.left.velocity[axis]).toBeCloseTo(leftVelocity[axis], 8);
        expect(feet.right.position[axis]).toBeCloseTo([boundary.time / 4 - .112, .09, 0][axis], 11);
        expect(feet.right.velocity[axis]).toBeCloseTo([.25, 0, 0][axis], 8);
      }
      expect(boundary.support).toBe('unknown'); expect(boundary.supportConfidence).toBe(0);
    }
    expect(JSON.stringify(take)).toBe(original);
  });

  it('captures source mapping, mute and missing assets, sending hashes rather than bytes', async () => {
    const { snapshot, options } = fixture();
    const extra = new Blob(['extra local audio']);
    snapshot.audioOffsetSeconds = -2;
    snapshot.audioTracks = [
      { id: 'backing', name: '伴奏.wav', durationSeconds: 5, offsetSeconds: -1, muted: true },
      { id: 'missing', name: '未包含的音轨.wav', durationSeconds: 2, offsetSeconds: 8 },
    ];
    options.audioClips = [{ id: 'backing', blob: extra }];
    const request = await buildAIMotionRequest(options);
    expect(request.context.audioUnderstanding).toBe(false);
    expect(request.context.audio[0]).toMatchObject({ hash: createHash('sha256').update('original local music').digest('hex'), availability: 'available', sourceOffsetSeconds: 3, offsetSeconds: -2, coverage: { startSeconds: 0, endSeconds: 14 } });
    expect(request.context.audio[1]).toEqual({ id: 'backing', name: '伴奏.wav', hash: createHash('sha256').update('extra local audio').digest('hex'), durationSeconds: 5, offsetSeconds: -1, sourceOffsetSeconds: 0, muted: true, availability: 'available', coverage: { startSeconds: 0, endSeconds: 4 } });
    expect(request.context.audio[2]).toEqual({ id: 'missing', name: '未包含的音轨.wav', hash: null, durationSeconds: 2, offsetSeconds: 8, sourceOffsetSeconds: 0, muted: false, availability: 'missing', coverage: { startSeconds: 8, endSeconds: 10 } });
    const body = JSON.stringify(request);
    expect(body).not.toContain('original local music'); expect(body).not.toContain('extra local audio');
    for (const privateField of ['take', 'manual', 'cameraTrack', 'blob', 'bytes']) expect(body).not.toContain(`"${privateField}":`);
    expect(new TextEncoder().encode(body).byteLength).toBeLessThanOrEqual(AI_MOTION_REQUEST_MAX_BYTES);
  });

  it('keeps full generation bounded, and can describe music-only scenes without an available audio asset', async () => {
    const { options, snapshot } = fixture();
    options.range = null; options.audioBlob = null;
    snapshot.take = null; delete snapshot.manual;
    const request = await buildAIMotionRequest(options);
    expect(request.context.target).toEqual({ mode: 'full', startSeconds: 0, endSeconds: 16 });
    expect(request.context.before).toEqual([]); expect(request.context.after).toEqual([]);
    expect(request.context.initialPose.root).toEqual([0, 1.05, 0]);
    expect(request.context.boundaries.start.linearVelocity).toEqual([0, 0, 0]);
    expect(request.context.ending).toBe('hold');
    expect(request.context.audio[0]).toMatchObject({ availability: 'missing', hash: null });
    const unknownDuration = await buildAIMotionRequest({ ...options, audioDurationSeconds: undefined });
    expect(unknownDuration.context.audio[0]).toMatchObject({ availability: 'missing', durationSeconds: 0, coverage: null });
  });

  it('clips readonly context to scene edges, retaining precise fractional endpoints', async () => {
    const { options } = fixture();
    options.range = { start: 0, end: 15.83 };
    const request = await buildAIMotionRequest(options);
    expect(request.context.before).toEqual([]);
    expect(request.context.after[0].time).toBe(15.83);
    expect(request.context.after.at(-1)!.time).toBe(16);
    expect(request.context.boundaries.start.time).toBe(0);
    expect(request.context.boundaries.end.time).toBe(15.83);
  });

  it('gives equivalent source snapshots one SHA, while source and audio placement edits change it', async () => {
    const { options } = fixture();
    const original = await buildAIMotionRequest(options);
    const same = await buildAIMotionRequest({ ...options, prompt: '另一个描述', baseRevision: 8, snapshot: structuredClone(options.snapshot), range: null });
    expect(same.context.sourceHash).toBe(original.context.sourceHash);
    expect(same.context.requestId).not.toBe(original.context.requestId);
    const moved = await buildAIMotionRequest({ ...options, snapshot: { ...options.snapshot, audioOffsetSeconds: 1 } });
    expect(moved.context.sourceHash).not.toBe(original.context.sourceHash);
    const changedTake = structuredClone(options.snapshot); changedTake.take!.poses[1].root[0] += .01;
    const changed = await buildAIMotionRequest({ ...options, snapshot: changedTake });
    expect(changed.context.sourceHash).not.toBe(original.context.sourceHash);
    const changedManual = structuredClone(options.snapshot); changedManual.manual!.root = [{ frame: 30, position: [1, 1.05, 0] }];
    const author = await buildAIMotionRequest({ ...options, snapshot: changedManual });
    expect(author.context.sourceHash).not.toBe(original.context.sourceHash);
  });

  it('provides effective existing AI motion as context and includes that layer in the source identity', async () => {
    const { options, snapshot, take } = fixture();
    const fullRequest = await buildAIMotionRequest({ ...options, range: null });
    const base = (time: number) => sampleTake(take, time);
    const layer = appendAIMotionPatch(undefined, compileAIMotionPatch(fullRequest, makeAIMotionResultFixture(fullRequest), base), snapshot.countMap);
    snapshot.aiMotion = layer;
    const originalLayer = JSON.stringify(layer);
    const request = await buildAIMotionRequest(options);
    const effective = createAIMotionSampler(base, layer);
    expect(request.context.initialPose).toEqual(effective(2.113));
    expect(request.context.initialPose).not.toEqual(base(2.113));
    expect(request.context.boundaries.end.pose).toEqual(effective(5.717));
    for (const point of [...request.context.before, ...request.context.after]) expect(point.pose).toEqual(effective(point.time));
    expect(request.context.sourceHash).not.toBe(fullRequest.context.sourceHash);
    expect(JSON.stringify(layer)).toBe(originalLayer);
    await expect(buildAIMotionRequest({ ...options, snapshot: { ...snapshot, aiMotion: { ...layer, countMapId: 'other-map' } } })).rejects.toThrow(/数拍绑定/);
  });

  it('uses a compact synchronous source stamp without serializing dense author motion', () => {
    const { snapshot, options } = fixture();
    const clips = [{ id: 'extra', blob: new Blob(['one']) }];
    snapshot.audioTracks = [{ id: 'extra', name: 'extra.wav', durationSeconds: 5, offsetSeconds: 0 }];
    const stamp = sourceStampForAIMotion(snapshot, options.audioBlob, clips);
    expect(stamp.length).toBeLessThan(200);
    expect(sourceStampForAIMotion(snapshot, options.audioBlob, clips)).toBe(stamp);
    expect(sourceStampForAIMotion({ ...snapshot, title: '另一标题' }, options.audioBlob, clips)).toBe(stamp);
    expect(sourceStampForAIMotion({ ...snapshot, audioOffsetSeconds: 1 }, options.audioBlob, clips)).not.toBe(stamp);
    expect(sourceStampForAIMotion(snapshot, new Blob(['different']), clips)).not.toBe(stamp);
    expect(sourceStampForAIMotion(snapshot, options.audioBlob, [{ id: 'extra', blob: new Blob(['two']) }])).not.toBe(stamp);
    expect(sourceStampForAIMotion({ ...snapshot, take: structuredClone(snapshot.take) }, options.audioBlob, clips)).not.toBe(stamp);
  });

  it('captures a readonly request before asynchronous hashing and caches each immutable Blob hash', async () => {
    const { options } = fixture();
    let resolveRead!: (buffer: ArrayBuffer) => void;
    const localBytes = await options.audioBlob!.arrayBuffer();
    const read = vi.spyOn(options.audioBlob!, 'arrayBuffer').mockReturnValue(new Promise(resolve => { resolveRead = resolve; }));
    const pending = buildAIMotionRequest(options);
    options.range!.start = 3; options.range!.end = 6;
    options.prompt = '后续变化'; options.sceneId = 'different-scene'; options.baseRevision = 99;
    options.snapshot.take!.poses[0].root[0] = 100;
    resolveRead(localBytes);
    const request = await pending;
    expect(request.context.target).toEqual({ mode: 'interval', startSeconds: 2.113, endSeconds: 5.717 });
    expect(request.prompt).toBe('转身抬手，保持原动作两端');
    expect(request.context.sceneId).toBe('local-scene'); expect(request.context.baseRevision).toBe(7);
    expect(Object.isFrozen(request.context.target)).toBe(true);
    expect(Object.isFrozen(request.context.before[0].pose.joints.Head)).toBe(true);
    await buildAIMotionRequest(options);
    expect(read).toHaveBeenCalledOnce();
  });

  it('honors cancellation before work and during a pending local audio hash without inference or retries', async () => {
    const { options } = fixture();
    const cancelled = new AbortController(); cancelled.abort();
    const read = vi.spyOn(options.audioBlob!, 'arrayBuffer');
    await expect(buildAIMotionRequest({ ...options, signal: cancelled.signal })).rejects.toMatchObject({ name: 'AbortError' });
    expect(read).not.toHaveBeenCalled();
    const controller = new AbortController();
    let resolveRead!: (buffer: ArrayBuffer) => void;
    read.mockReturnValue(new Promise(resolve => { resolveRead = resolve; }));
    const pending = buildAIMotionRequest({ ...options, signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    resolveRead(new TextEncoder().encode('original local music').buffer);
    expect(read).toHaveBeenCalledOnce();
  });
});
