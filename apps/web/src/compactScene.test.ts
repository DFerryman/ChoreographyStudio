import { describe, expect, it } from 'vitest';
import { JOINT_NAMES, type BakedTake, type Pose, type Quat } from '../../../packages/core/src/motion-types';
import { COMPACT_SCENE_LIMITS, packScene, unpackScene, type CompactScene } from './compactScene';
import type { CameraTrack } from '../../../packages/core/src/cameraTrack';
import { makeAIMotionFixture, makeAIMotionResultFixture } from '../../../packages/core/src/aiMotion.fixture';
import { appendAIMotionPatch, compileAIMotionPatch, createAIMotionSampler, MAX_AI_MOTION_TRACK_KNOTS, type AIMotionPatch } from '../../../packages/core/src/aiMotionTrack';

function take(id: string, times = [0, 0.008337038683859493, 0.0219137159934, 1.137]): BakedTake {
  return { id, schemaVersion: 'preview-1', planId: 'plan', countMapId: 'map', durationSeconds: times.at(-1)!, times, poses: times.map((time, index): Pose => ({
    root: [Math.sin(time), 1 + time / 50, Math.cos(time)],
    joints: Object.fromEntries(JOINT_NAMES.map((joint, jointIndex) => { const angle = (time + jointIndex + index / 1000) / 40; return [joint, [Math.sin(angle), 0, 0, Math.cos(angle)] as Quat]; })) as Pose['joints'],
  })), provenance: 'synthetic-demo' };
}
function scene(takes: BakedTake[], base = takes[0]) {
  return { schema: 'choreo-scene-1', id: 'scene', viewer: { time: 0.008337038683859493 }, project: { history: takes.map((take, index) => ({ title: `operation ${index}`, take, manual: { id: 'sparse', baseTake: base, rotations: { Spine: [{ frame: 0, rotation: [0, 0, 0, 1] }] }, root: [], pointEdits: [{ time: 0.0219137159934, joint: 'Head', rotation: [0, 0, 0, 1] }] }, operation: { label: '更新头部', time: 0.0219137159934 } })), historyIndex: takes.length - 1, revision: takes.length } };
}
const wire = (value: unknown) => JSON.parse(JSON.stringify(value));

function denseMotionScene(historyLength = 12) {
  const request = makeAIMotionFixture(), map = request.context.timing;
  const base = take('original-ai-base', [0, map.durationSeconds]); base.countMapId = map.id;
  base.poses = base.times.map(() => structuredClone(request.context.initialPose));
  const sample = () => structuredClone(request.context.initialPose);
  const patch = compileAIMotionPatch(request, makeAIMotionResultFixture(request), sample);
  const sampler = createAIMotionSampler(sample, appendAIMotionPatch(undefined, patch, map));
  const dense: AIMotionPatch = { ...patch, knots: Array.from({ length: 1801 }, (_, index) => {
    const time = index === 1800 ? map.durationSeconds : index * map.durationSeconds / 1800;
    return { time, pose: sampler(time), linearVelocity: [0, 0, 0], angularVelocity: structuredClone(patch.knots.at(-1)!.angularVelocity) };
  }), motionOrigin: { kind: 'human-motion-prior', catalogVersion: 'test-catalog-1', sources: [{ clipId: 'test-capture', sourceHash: 'c'.repeat(64) }], segments: [{
    clipId: 'test-capture', startSeconds: 0, endSeconds: map.durationSeconds, sourceStartSeconds: 0, sourceEndSeconds: map.durationSeconds,
    yawDegrees: 0, travelXZ: [0, 0], transitionSeconds: .25, contactHint: 'standing',
  }] } };
  const track = appendAIMotionPatch(undefined, dense, map);
  return { schema: 'choreo-scene-1', project: { history: Array.from({ length: historyLength }, (_, index) => ({
    title: `camera edit ${index}`, countMap: map, take: base, aiMotion: structuredClone(track),
    cameraTrack: { schema: 'camera-track-1', baseCamera: { position: [4, 3, -5], target: [0, 1, 0] }, keys: [] } as CameraTrack,
  })), historyIndex: historyLength - 1, revision: historyLength } };
}

describe('lossless compact scene history', () => {
  it('deduplicates independently cloned dense AI curves across twelve histories without changing their data or provenance', () => {
    const original = denseMotionScene(), before = structuredClone(original), packed = packScene(original);
    expect(packed.schema).toBe('compact-scene-2');
    if (packed.schema !== 'compact-scene-2') throw new Error('Missing dense motion dictionary');
    expect(packed.motionPatches).toHaveLength(1);
    expect(packed.motionPatches[0].knots).toHaveLength(1801);
    const encoded = JSON.stringify(packed);
    expect(new TextEncoder().encode(encoded).byteLength).toBeLessThan(32 * 1024 * 1024);
    expect(encoded.length).toBeLessThan(JSON.stringify(original).length / 8);
    const restored = unpackScene(JSON.parse(encoded)) as typeof original;
    expect(restored).toEqual(before);
    expect(new Set(restored.project.history.map(snapshot => snapshot.aiMotion.patches[0])).size).toBe(1);
    expect(original).toEqual(before);
  }, 15_000);

  it('keeps distinct dense patch payloads with the same ID and preserves old compact inline layers', () => {
    const original = denseMotionScene(2);
    original.project.history[1].aiMotion.patches[0].knots[500].pose.root[0] += .00197136527919;
    const packed = packScene(original);
    if (packed.schema !== 'compact-scene-2') throw new Error('Missing dense motion dictionary');
    expect(packed.motionPatches).toHaveLength(2);
    expect(unpackScene(wire(packed))).toEqual(original);
    // v1 stored AI curves inline. Existing saves remain readable with their
    // original model provenance, even though new saves use a shared table.
    const legacy = wire(packed); legacy.schema = 'compact-scene-1'; delete legacy.motionPatches;
    legacy.scene.project.history.forEach((snapshot: any, index: number) => { snapshot.aiMotion = wire(original.project.history[index].aiMotion); });
    expect(unpackScene(legacy)).toEqual(original);
  });

  it.each(['missing-reference', 'extra-reference-field', 'inline-patch', 'unused-table-entry', 'duplicate-track-reference', 'invalid-quaternion', 'bad-source', 'oversized-patch', 'oversized-table', 'total-table-knots', 'total-track-knots'] as const)('rejects corrupt or unbounded AI dictionary data: %s', kind => {
    const packed = wire(packScene(denseMotionScene(1)));
    const references = packed.scene.project.history[0].aiMotion.patches;
    if (kind === 'missing-reference') references[0].$motionPatch = 4;
    if (kind === 'extra-reference-field') references[0].other = true;
    if (kind === 'inline-patch') references[0] = packed.motionPatches[0];
    if (kind === 'unused-table-entry') packed.motionPatches.push(structuredClone(packed.motionPatches[0]));
    if (kind === 'duplicate-track-reference') references.push({ $motionPatch: 0 });
    if (kind === 'invalid-quaternion') packed.motionPatches[0].knots[50].pose.joints.Head = [0, 0, 0, 0];
    if (kind === 'bad-source') packed.motionPatches[0].motionOrigin.sources[0].sourceHash = 'invalid';
    if (kind === 'oversized-patch') packed.motionPatches[0].knots.push(...Array.from({ length: 3 }, () => packed.motionPatches[0].knots[0]));
    if (kind === 'oversized-table') packed.motionPatches = Array.from({ length: COMPACT_SCENE_LIMITS.motionPatches + 1 }, () => packed.motionPatches[0]);
    if (kind === 'total-table-knots') packed.motionPatches = Array.from({ length: Math.floor(COMPACT_SCENE_LIMITS.totalMotionKnots / 1801) + 1 }, () => packed.motionPatches[0]);
    if (kind === 'total-track-knots') {
      packed.motionPatches = Array.from({ length: Math.floor(MAX_AI_MOTION_TRACK_KNOTS / 1801) + 1 }, (_, index) => ({ ...packed.motionPatches[0], id: `patch-${index}`, requestId: `request-${index}` }));
      packed.motionPatches.forEach((patch: any, index: number) => { if (index > 0) patch.target.mode = 'interval'; });
      packed.scene.project.history[0].aiMotion.patches = packed.motionPatches.map((_: unknown, index: number) => ({ $motionPatch: index }));
    }
    expect(() => unpackScene(packed)).toThrow('场景压缩数据无效');
  });

  it('enforces the unchanged 32 MiB serialized cap before restoring dense dictionary data', () => {
    const packed = packScene(denseMotionScene(1));
    (packed.scene as any).oversizedMetadata = '测'.repeat(Math.ceil(COMPACT_SCENE_LIMITS.wireBytes / 3));
    expect(() => unpackScene(packed)).toThrow('场景压缩数据无效');
  });

  it('preserves twelve camera-only operations and exact off-grid keys while storing unchanged Take and base only once', () => {
    const source = take('source'), original = scene(Array.from({ length: 12 }, () => source));
    const withCamera = { ...original, project: { ...original.project, historyIndex: 6, history: original.project.history.map((snapshot, index) => ({ ...snapshot, countMap: { durationSeconds: source.durationSeconds }, cameraTrack: {
      schema: 'camera-track-1', baseCamera: { position: [4, 3, -5], target: [0, 1, 0] }, keys: [
        { time: .008337038683859493, camera: { position: [index + .137, 2, -4], target: [.1, 1.3, -.2], zoom: 1.137 } },
        { time: .0219137159934, camera: { position: [-4, 3, 1.2], target: [.3, 1.1, -.5] } },
      ],
    } as CameraTrack, operation: { label: '移动相机', time: .008337038683859493, tracks: ['camera'] } })) } };
    const packed = packScene(withCamera);
    expect(packed.takes).toHaveLength(1);
    const restored = unpackScene(wire(packed)) as typeof withCamera;
    expect(restored).toEqual(withCamera);
    expect(new Set(restored.project.history.map(snapshot => snapshot.take)).size).toBe(1);
    expect(restored.project.history[0].take).toEqual(source);
    const corrupt = wire(packed); corrupt.scene.project.history[0].cameraTrack.keys[0].time = 2;
    expect(() => unpackScene(corrupt)).toThrow('场景压缩数据无效');
    withCamera.project.history[0].cameraTrack.keys[0].camera.zoom = NaN;
    expect(() => packScene(withCamera)).toThrow('场景压缩数据无效');
  });

  it('restores nonuniform timestamps, all 25 channels, sparse keys, metadata and history exactly', () => {
    const base = take('source'), edited = structuredClone(base); edited.id = 'edited';
    edited.poses[1].joints.LeftHandTip = [0, .5, 0, Math.sqrt(.75)];
    edited.poses[2].root = [-4.1128377319291, .7417331959127, 2.99551433211];
    const original = scene([base, edited], structuredClone(base));
    const packed = packScene(original);
    expect(packed.takes).toHaveLength(2);
    expect(packed.takes[1].kind).toBe('delta');
    expect(unpackScene(wire(packed))).toEqual(original);
    expect(original.project.history[0].take.poses[1].joints.LeftHandTip).not.toEqual(edited.poses[1].joints.LeftHandTip);
  });

  it('stores added exact timestamps with complete new samples and removed grids without resampling', () => {
    const base = take('source'), inserted = take('inserted', [0, .00197136527919, ...base.times.slice(1)]), removed = structuredClone(inserted);
    removed.id = 'removed'; removed.times.splice(2, 1); removed.poses.splice(2, 1);
    const original = scene([base, inserted, removed]);
    expect(unpackScene(wire(packScene(original)))).toEqual(original);
  });

  it('preserves zero-take scenes and independently identifies distinct take payloads with the same ID', () => {
    const empty = { project: { history: [{ title: 'music', take: null }] } };
    expect(unpackScene(wire(packScene(empty)))).toEqual(empty);
    const first = take('shared-id'), second = structuredClone(first); second.poses[1].root[0] += .03;
    const original = scene([first, second]);
    expect(unpackScene(wire(packScene(original)))).toEqual(original);
  });

  it('keeps twelve dense imported-scene operations below the 32 MiB header limit', () => {
    const times = Array.from({ length: 5040 }, (_, index) => index === 5039 ? 37.5 : index * 37.5 / 5039);
    const source = take('dense-source', times), history: BakedTake[] = [source];
    for (let index = 1; index < 12; index++) {
      // Immutable edits share the original unchanged pose objects in memory;
      // the wire must also avoid duplicating those thousands of full poses.
      const previous = history.at(-1)!, poses = [...previous.poses];
      poses[index] = { ...poses[index], joints: { ...poses[index].joints, Head: [0, Math.sin(index / 100), 0, Math.cos(index / 100)] } };
      history.push({ ...previous, id: `edit-${index}`, poses });
    }
    const base = take('dense-base', Array.from({ length: 4499 }, (_, index) => index === 4498 ? 37.5 : index * 37.5 / 4498));
    const original = scene(history, base), encoded = JSON.stringify(packScene(original));
    expect(encoded.length).toBeLessThan(32 * 1024 * 1024);
    expect(encoded.length).toBeLessThan(JSON.stringify(original).length / 5);
    const restored = unpackScene(JSON.parse(encoded)) as ReturnType<typeof scene>;
    expect(restored.project.history[11].take).toEqual(history[11]);
    expect(restored.project.history[0].manual.baseTake).toEqual(base);
    expect(restored.project.history.map(snapshot => snapshot.take.id)).toEqual(history.map(take => take.id));
  }, 15_000);

  it('stores the exact frozen point authority once across twelve dense histories', () => {
    const times = Array.from({ length: 5040 }, (_, index) => index === 5039 ? 37.5 : index * 37.5 / 5039);
    const frozen = take('saved-authority', times), base = take('source-base', Array.from({ length: 4499 }, (_, index) => index === 4498 ? 37.5 : index * 37.5 / 4498));
    const takes = Array.from({ length: 12 }, (_, index) => ({ ...frozen, id: `point-authority-${index}` }));
    const original = scene(takes, base);
    const withFrozen = { ...original, project: { ...original.project, history: original.project.history.map(snapshot => ({ ...snapshot, manual: { ...snapshot.manual, pointBaseTake: frozen } })) } };
    const packed = packScene(withFrozen), encoded = JSON.stringify(packed);
    expect(encoded.length).toBeLessThan(32 * 1024 * 1024);
    const restored = unpackScene(JSON.parse(encoded)) as typeof withFrozen;
    expect(restored).toEqual(withFrozen);
    expect(new Set(restored.project.history.map(snapshot => snapshot.manual.pointBaseTake)).size).toBe(1);
    // Twelve 5,040-sample histories plus a 4,499-sample source exercise the
    // full codec and deep equality while other test files can run in parallel.
  }, 45_000);

  it('rejects distinct frozen references when their once-only allocation exceeds the shared budget', () => {
    const source = take('source', Array.from({ length: 5040 }, (_, index) => index === 5039 ? 37.5 : index * 37.5 / 5039));
    const original = scene(Array.from({ length: 12 }, () => source));
    const independent = { ...original, project: { ...original.project, history: original.project.history.map((snapshot, index) => ({ ...snapshot, manual: { ...snapshot.manual, pointBaseTake: { ...source, id: `independent-frozen-${index}` } } })) } };
    expect(() => packScene(independent)).toThrow('场景压缩数据无效');
    const packed = packScene(original) as CompactScene;
    const templates = Array.from({ length: 12 }, (_, index) => ({ kind: 'delta', reference: 0, metadata: { id: `independent-frozen-${index}`, schemaVersion: 'preview-1', planId: 'plan', countMapId: 'map', durationSeconds: 37.5, provenance: 'synthetic-demo' }, changes: [] }));
    (packed.takes as any[]).push(...templates);
    ((packed.scene as any).project.history as any[]).forEach((snapshot, index) => { snapshot.manual.pointBaseTake = { $take: index + 1 }; });
    expect(() => unpackScene(packed)).toThrow('场景压缩数据无效');
  }, 15_000);

  it.each(['forward', 'cycle', 'missing-full-pose', 'unknown-joint', 'duplicate-index', 'oversized-grid', 'oversized-history', 'extra-reference-field'] as const)('rejects malformed or unbounded %s compact data', kind => {
    const original = take('source'), second = structuredClone(original); second.id = 'second'; second.poses[1].root[0] += 1;
    const packed = wire(packScene(scene([original, second]))) as CompactScene;
    const delta = packed.takes[1] as any;
    if (kind === 'forward' || kind === 'cycle') delta.reference = kind === 'forward' ? 10 : 1;
    if (kind === 'missing-full-pose') { delta.times = [0, .005, ...original.times.slice(1)]; delta.changes = []; }
    if (kind === 'unknown-joint') delta.changes[0].joints = { Ghost: [0, 0, 0, 1] };
    if (kind === 'duplicate-index') delta.changes.push(structuredClone(delta.changes[0]));
    if (kind === 'oversized-grid') delta.times = Array.from({ length: 6002 }, (_, index) => index / 1000);
    if (kind === 'oversized-history') (packed.scene as any).project.history = Array.from({ length: 13 }, () => (packed.scene as any).project.history[0]);
    if (kind === 'extra-reference-field') (packed.scene as any).project.history[0].take = { $take: 0, other: true };
    expect(() => unpackScene(packed)).toThrow('场景压缩数据无效');
  });

  it('rejects dangerous keys and invalid pose vectors before restoring a scene', () => {
    const packed = wire(packScene(scene([take('source')])));
    packed.takes[0].take.poses[0].joints = JSON.parse('{"__proto__":[0,0,0,1]}');
    expect(() => unpackScene(packed)).toThrow();
    const invalid = wire(packScene(scene([take('source')]))); invalid.takes[0].take.poses[0].root = [0, 1, null];
    expect(() => unpackScene(invalid)).toThrow();
  });
});
