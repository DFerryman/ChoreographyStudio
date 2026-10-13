import { beforeEach, describe, expect, it } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { makeAIMotionFixture, makeAIMotionResultFixture } from '../../../packages/core/src/aiMotion.fixture';
import { appendAIMotionPatch, compileAIMotionPatch, createAIMotionSampler, type AIMotionKnot } from '../../../packages/core/src/aiMotionTrack';
import { makeKeyframeSequence, rotationFromDegrees, sampleTake, type BakedTake } from '../../../packages/core/src';
import { createScene } from './scene';
import type { SceneProject } from './sceneProject';
import { buildAIMotionRequest } from './aiMotionContext';
import { decodeSceneBackup, encodeSceneBackup, encodeSceneJsonBackup } from './sceneBackup';
import { packScene, unpackScene } from './compactScene';
import { loadScene, saveScene } from './storage';

beforeEach(() => { globalThis.indexedDB = new IDBFactory(); });

async function motionScene() {
  const fixture = makeAIMotionFixture('interval'), map = fixture.context.timing;
  const times = [0, .7, 4, 8, 12, map.durationSeconds];
  const take: BakedTake = { id: 'original-ai-test', schemaVersion: 'preview-1', planId: 'original-ai-plan', countMapId: map.id,
    durationSeconds: map.durationSeconds, times,
    poses: times.map(time => ({ root: [time / 100, 1.05, 0], joints: { ...structuredClone(fixture.context.initialPose.joints), Head: rotationFromDegrees([0, time / 2, 0]) } })),
    provenance: 'synthetic-demo' };
  const manual = makeKeyframeSequence(take, { pointInterpolation: 'hold-last-key-1' });
  const cameraTrack = { schema: 'camera-track-1' as const, baseCamera: { position: [2.4, 1.85, 4] as [number, number, number], target: [0, 1.04, 0] as [number, number, number] }, keys: [] };
  const project: SceneProject = { history: [{ title: 'Original', countMap: map, plan: null, take, manual, cameraTrack }],
    historyIndex: 0, revision: 1, audioDuration: 40, teacherCheckedRevision: null };
  const scene = createScene({ name: 'Motion round trip', project, audio: new Blob([new Uint8Array([0, 255, 10, 42])], { type: 'audio/wav' }), audioName: 'original.wav' });
  const source = project.history[0], original = structuredClone(source);
  const request = await buildAIMotionRequest({ prompt: '抬左臂，保留两端', sceneId: scene.id, baseRevision: project.revision,
    snapshot: source, range: { start: 4.1, end: 8.2 }, audioBlob: scene.audio, audioName: scene.audioName, audioDurationSeconds: project.audioDuration });
  const patch = compileAIMotionPatch(request, makeAIMotionResultFixture(request), time => sampleTake(take, time));
  const aiMotion = appendAIMotionPatch(undefined, patch, map);
  project.history.push({ ...source, aiMotion, operation: { label: '采用 AI 区间动作', time: 4.1, tracks: ['root'] } });
  project.historyIndex = 1; project.revision = 2;
  return { scene, original };
}

describe('model motion scene persistence', () => {
  it('roundtrips dense prior curves and twelve snapshots through compact JSON and complete audio without rounding seams', async () => {
    const { scene, original } = await motionScene(), active = scene.project.history[1];
    const patch = active.aiMotion!.patches[0], start = patch.target.startSeconds, end = patch.target.endSeconds;
    const base = (time: number) => sampleTake(active.take!, time), originalCurve = createAIMotionSampler(base, active.aiMotion);
    const boundaryStart = structuredClone(patch.knots[0]), boundaryEnd = structuredClone(patch.knots.at(-1)!);
    patch.knots = Array.from({ length: 1801 }, (_, index): AIMotionKnot => {
      if (index === 0) return boundaryStart;
      if (index === 1800) return boundaryEnd;
      const time = start + (end - start) * index / 1800;
      return { time, pose: originalCurve(time), linearVelocity: [0, 0, 0],
        angularVelocity: Object.fromEntries(Object.keys(boundaryStart.angularVelocity).map(joint => [joint, [0, 0, 0]])) as AIMotionKnot['angularVelocity'] };
    });
    patch.motionOrigin = { kind: 'human-motion-prior', catalogVersion: 'test-dense-catalog-1', sources: [{ clipId: 'capture-fixture', sourceHash: 'c'.repeat(64) }], segments: [{
      clipId: 'capture-fixture', startSeconds: start, endSeconds: end, sourceStartSeconds: 0, sourceEndSeconds: end - start,
      yawDegrees: 0, travelXZ: [0, 0], transitionSeconds: .25, contactHint: 'standing',
    }] };
    scene.project.history = [scene.project.history[0], ...Array.from({ length: 11 }, (_, index) => ({ ...active,
      aiMotion: structuredClone(active.aiMotion), operation: { label: `相机查看 ${index + 1}`, time: 4.1, tracks: ['camera' as const] },
    }))];
    scene.project.historyIndex = 11; scene.project.revision = 12;
    const before = structuredClone(scene.project), jsonFile = encodeSceneJsonBackup(scene), fullFile = await encodeSceneBackup(scene);
    const json = JSON.parse(await jsonFile.text());
    expect(json.scene.schema).toBe('compact-scene-2');
    expect(json.scene.motionPatches).toHaveLength(1);
    expect(json.scene.motionPatches[0].knots).toHaveLength(1801);
    expect(jsonFile.size).toBeLessThan(32 * 1024 * 1024);
    for (const file of [jsonFile, fullFile]) {
      const restored = (await decodeSceneBackup(file)).scene, snapshot = restored.project.history[11];
      expect(restored.project).toEqual(before);
      expect(snapshot.aiMotion!.patches[0].knots).toEqual(patch.knots);
      expect(snapshot.take).toEqual(original.take); expect(snapshot.manual).toEqual(original.manual);
      const sample = createAIMotionSampler(time => sampleTake(snapshot.take!, time), snapshot.aiMotion);
      for (const time of [0, .7, start - .0000001, start, end, end + .0000001, 12.12345]) expect(sample(time)).toEqual(base(time));
      if (restored.audio) expect(await restored.audio.arrayBuffer()).toEqual(await scene.audio!.arrayBuffer());
    }
    expect(scene.project).toEqual(before);

    // Old compact v1 JSON and complete bundles carried inline AI layers. Use
    // one old snapshot so compatibility is tested below the original byte cap.
    const legacyJson = structuredClone(json); legacyJson.scene.schema = 'compact-scene-1'; delete legacyJson.scene.motionPatches;
    legacyJson.scene.scene.project.history = [legacyJson.scene.scene.project.history[11]];
    legacyJson.scene.scene.project.historyIndex = 0;
    legacyJson.scene.scene.project.history[0].aiMotion = structuredClone(active.aiMotion);
    const oldJsonFile = new Blob([JSON.stringify(legacyJson)]);
    const fullBytes = new Uint8Array(await fullFile.arrayBuffer()), magicLength = new TextEncoder().encode('CHOREO-BUNDLE-1\n').length;
    const prefixLength = magicLength + 4, headerLength = new DataView(fullBytes.buffer).getUint32(magicLength, true);
    const oldHeader = JSON.parse(new TextDecoder().decode(fullBytes.slice(prefixLength, prefixLength + headerLength)));
    oldHeader.scene = legacyJson.scene;
    const header = new TextEncoder().encode(JSON.stringify(oldHeader)), prefix = fullBytes.slice(0, prefixLength);
    new DataView(prefix.buffer).setUint32(magicLength, header.byteLength, true);
    const oldFullFile = new Blob([prefix, header, fullBytes.slice(prefixLength + headerLength)]);
    for (const file of [oldJsonFile, oldFullFile]) {
      const restored = (await decodeSceneBackup(file)).scene;
      expect(restored.project.history[0].aiMotion).toEqual(active.aiMotion);
      expect(restored.project.history[0].take).toEqual(original.take);
      if (restored.audio) expect(await restored.audio.arrayBuffer()).toEqual(await scene.audio!.arrayBuffer());
    }
  }, 45_000);

  it('keeps original nonuniform motion and authors through storage, compact JSON and complete audio bundles', async () => {
    const { scene, original } = await motionScene();
    const saved = await saveScene(scene), loaded = await loadScene<SceneProject>(saved.id);
    expect(loaded).toBeTruthy();
    const compact = unpackScene(packScene({ ...scene, audio: null })) as typeof scene;
    const json = await decodeSceneBackup(encodeSceneJsonBackup(scene));
    const bundle = await decodeSceneBackup(await encodeSceneBackup(scene));
    for (const restored of [loaded!, compact, json.scene, bundle.scene]) {
      expect(restored.project).toEqual(scene.project);
      const active = restored.project.history[restored.project.historyIndex];
      expect(active.take).toEqual(original.take);
      expect(active.manual).toEqual(original.manual);
      expect(active.cameraTrack).toEqual(original.cameraTrack);
      const sampler = createAIMotionSampler(time => sampleTake(active.take!, time), active.aiMotion);
      for (const time of [0, .123456, .7, 3.99999, 4.1, 8.2, 8.20001, 12.12345, 32]) {
        expect(sampler(time)).toEqual(sampleTake(original.take!, time));
      }
      expect(sampler(6.15)).not.toEqual(sampleTake(original.take!, 6.15));
    }
    expect(Array.from(new Uint8Array(await bundle.scene.audio!.arrayBuffer())))
      .toEqual(Array.from(new Uint8Array(await scene.audio!.arrayBuffer())));
    expect(scene.project.history[0]).toEqual(original);
  });

  it('rejects corrupted AI data at save, direct IndexedDB load and compact encoding', async () => {
    const { scene } = await motionScene();
    const invalid = structuredClone(scene);
    invalid.project.history[1].aiMotion!.patches[0].knots[1].pose.joints.Head = [0, 0, 0, 0];
    await expect(saveScene(invalid)).rejects.toThrow('AI');
    expect(() => packScene(invalid)).toThrow();
    const saved = await saveScene(scene);
    await new Promise<void>((resolve, reject) => {
      const open = indexedDB.open('choreo-studio-preview', 2);
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const db = open.result, transaction = db.transaction('scenes', 'readwrite');
        transaction.objectStore('scenes').put({ ...invalid, id: saved.id }, saved.id);
        transaction.oncomplete = () => { db.close(); resolve(); };
        transaction.onerror = () => { db.close(); reject(transaction.error); };
      };
    });
    await expect(loadScene(saved.id)).rejects.toThrow('AI');
  });

  it('preserves generic historical storage records without the new motion extension', async () => {
    const legacy = createScene({ name: 'Legacy generic record', project: { title: 'Legacy' }, audio: null, audioName: '' });
    await saveScene(legacy);
    expect((await loadScene<{ title: string }>(legacy.id))?.project).toEqual(legacy.project);
  });

  it('rejects valid-looking compact layers whose seam no longer matches the expanded original take', async () => {
    const { scene } = await motionScene();
    const packed = structuredClone(packScene({ ...scene, audio: null }));
    if (packed.schema !== 'compact-scene-2') throw new Error('AI history must use its patch dictionary');
    packed.motionPatches[0].knots[0].pose.root[0] += .01;
    expect(() => unpackScene(packed)).toThrow();
  });

  it('saves and restores full regeneration after an earlier AI layer is replaced', async () => {
    const { scene } = await motionScene();
    const source = scene.project.history[0], base = (time: number) => sampleTake(source.take!, time);
    const first = await buildAIMotionRequest({ prompt: '转头再回正', sceneId: scene.id, baseRevision: 2, snapshot: source });
    const result = makeAIMotionResultFixture(first);
    result.keyframes = [
      { time: .1, root: base(.1).root, rotations: { Head: [0, 80, 0] } },
      { time: 1, root: base(1).root, rotations: { Head: [0, 0, 0] } },
      { time: 32, root: base(32).root, rotations: { Head: [0, 0, 0] } },
    ];
    const firstTrack = appendAIMotionPatch(undefined, compileAIMotionPatch(first, result, base), source.countMap);
    const snapshot = { ...source, aiMotion: firstTrack };
    const second = await buildAIMotionRequest({ prompt: '重新设计整段抬臂', sceneId: scene.id, baseRevision: 3, snapshot });
    const secondPatch = compileAIMotionPatch(second, makeAIMotionResultFixture(second), createAIMotionSampler(base, firstTrack));
    const aiMotion = appendAIMotionPatch(firstTrack, secondPatch, source.countMap);
    scene.project = { ...scene.project, history: [source, { ...source, aiMotion }], historyIndex: 1, revision: 4 };
    const saved = await saveScene(scene);
    expect((await loadScene<SceneProject>(saved.id))?.project).toEqual(scene.project);
    expect((await decodeSceneBackup(await encodeSceneBackup(scene))).scene.project).toEqual(scene.project);
    expect(aiMotion.patches).toHaveLength(1);
    expect(scene.project.history[0]).toEqual(source);
  });
});
