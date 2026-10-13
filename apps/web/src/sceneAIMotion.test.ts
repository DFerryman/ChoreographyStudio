import { beforeEach, describe, expect, it } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { makeAIMotionFixture, makeAIMotionResultFixture } from '../../../packages/core/src/aiMotion.fixture';
import { appendAIMotionPatch, compileAIMotionPatch, createAIMotionSampler } from '../../../packages/core/src/aiMotionTrack';
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
    const encoded = packed.scene as { project: SceneProject };
    encoded.project.history[1].aiMotion!.patches[0].knots[0].pose.root[0] += .01;
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
