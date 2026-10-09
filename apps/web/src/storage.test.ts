import { IDBFactory, IDBObjectStore } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createScene, defaultSceneViewer, type SceneViewer } from './scene';
import { deleteScene, duplicateScene, listScenes, loadCurrentScene, loadProject, loadScene, renameScene, saveProject, saveScene, setCurrentScene } from './storage';
import type { CameraTrack } from '../../../packages/core/src/cameraTrack';

const audioBytes = async (blob: Blob | null) => blob ? [...new Uint8Array(await blob.arrayBuffer())] : null;
const scene = (name: string, bytes: number[], viewer: SceneViewer = defaultSceneViewer()) => createScene({
  name, project: { steps: [name], revision: 1 }, audio: new Blob([new Uint8Array(bytes)], { type: 'audio/wav' }),
  audioName: `${name}.wav`, viewer,
});

async function seedLegacy(value: unknown): Promise<void> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('choreo-studio-preview', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('projects');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction('projects', 'readwrite');
    transaction.objectStore('projects').put(value, 'current');
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error);
  });
  db.close();
}

function cameraScene() {
  const track: CameraTrack = { schema: 'camera-track-1', baseCamera: { position: [4.1128377319291, 3, -5], target: [.4, 1.4, -.3] }, keys: [
    { time: .008337038683859493, camera: { position: [3.99551433211, 2, -4], target: [.1, 1.3, -.2], zoom: 1.137 } },
    { time: 3.0219137159934, camera: { position: [-4, 3, 1.2], target: [.3, 1.1, -.5] } },
  ] };
  const take = { times: [0, .008337038683859493, .0219137159934, 4.137], poses: [{ root: [8, -1, -9], joints: { Head: [Number.EPSILON, 0, 0, 1] } }] };
  const original = { title: '保存的原稿', countMap: { durationSeconds: 4.137 }, take, manual: { baseTake: take }, audioOffsetSeconds: .1 };
  const history: (typeof original & { cameraTrack?: CameraTrack; operation?: { label: string; time: number; tracks: string[] } })[] = [
    original, { ...original, cameraTrack: track, operation: { label: '移动相机', time: track.keys[0].time, tracks: ['camera'] } },
  ];
  return createScene({ name: '相机作品', audio: new Blob([new Uint8Array([0, 255, 19, 10])], { type: 'audio/wav' }), audioName: 'original.wav', project: {
    history, historyIndex: 0, revision: 2, audioDuration: 40, teacherCheckedRevision: null,
  } });
}

async function overwriteStoredScene(value: ReturnType<typeof cameraScene>) {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('choreo-studio-preview', 2);
    request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
  });
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction('scenes', 'readwrite');
    transaction.objectStore('scenes').put(value, value.id);
    transaction.oncomplete = () => resolve(); transaction.onabort = () => reject(transaction.error);
  });
  db.close();
}

beforeEach(() => { vi.stubGlobal('indexedDB', new IDBFactory()); });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('explicit local scene persistence', () => {
  it('reopens and copies optional camera history exactly, including an undone position, while isolating edits and preserving source motion and audio', async () => {
    const original = cameraScene(), before = structuredClone(original.project);
    const saved = await saveScene(original), restored = await loadCurrentScene<typeof original.project>();
    expect(restored?.project).toEqual(before);
    expect(restored?.project.history[0]).not.toHaveProperty('cameraTrack');
    expect(restored?.project.history[1].cameraTrack?.baseCamera).not.toHaveProperty('zoom');
    expect(await audioBytes(restored?.audio ?? null)).toEqual([0, 255, 19, 10]);
    const copy = await duplicateScene<typeof original.project>(saved.id);
    if (!copy?.project.history[1].cameraTrack) throw new Error('missing copied camera track');
    copy.project.historyIndex = 1;
    copy.project.history[1].cameraTrack.keys[0].camera.position[0] = 99;
    await saveScene(copy);
    expect((await loadScene<typeof original.project>(saved.id))?.project).toEqual(before);
    expect((await loadScene<typeof original.project>(copy.id))?.project.history[1].take).toEqual(before.history[1].take);
    expect(original.project).toEqual(before);
  });

  it('rejects invalid camera saves atomically and refuses corrupt stored tracks on load, selection, copying or renaming', async () => {
    const good = await saveScene(scene('有效作品', [7])), camera = await saveScene(cameraScene());
    await setCurrentScene(good.id);
    const invalid = structuredClone(camera); invalid.project.history[1].cameraTrack!.keys[0].time = 99;
    await expect(saveScene(invalid)).rejects.toThrow(/相机/);
    expect((await loadScene<typeof camera.project>(camera.id))?.project).toEqual(camera.project);
    expect((await loadCurrentScene())?.id).toBe(good.id);
    await overwriteStoredScene(invalid);
    await expect(loadScene(camera.id)).rejects.toThrow(/相机/);
    await expect(setCurrentScene(camera.id)).rejects.toThrow();
    await expect(duplicateScene(camera.id)).rejects.toThrow(/相机/);
    await expect(renameScene(camera.id, '不应提交')).rejects.toThrow();
    expect((await loadCurrentScene())?.id).toBe(good.id);
    expect((await listScenes()).find(value => value.id === camera.id)?.name).toBe(camera.name);
    expect(await listScenes()).toHaveLength(2);
  });

  it('reopens two independent scenes with exact original music, camera and editor state', async () => {
    const viewer: SceneViewer = {
      ...defaultSceneViewer(), view: 'free', camera: { position: [3.2, 2.8, -4.5], target: [0.4, 1.1, 0.7], zoom: 1.3 },
      selectedJoint: 'LeftForeArm', selectedSlot: 3, time: 6.125, mirror: true, rate: 0.75, countSound: true,
    };
    const first = await saveScene(scene('第一场景', [0, 255, 42, 19], viewer));
    const second = await saveScene(scene('第二场景', [9, 8, 7]));
    expect((await listScenes()).map(value => value.id).sort()).toEqual([first.id, second.id].sort());
    expect((await listScenes())[0]).not.toHaveProperty('audio');
    expect((await listScenes())[0]).not.toHaveProperty('project');
    const loaded = await loadScene<typeof first.project>(first.id);
    expect(loaded?.viewer).toEqual(viewer);
    expect(loaded?.project).toEqual(first.project);
    expect(loaded?.coordinateSystem).toEqual({ handedness: 'right', upAxis: '+Y', forwardAxis: '+Z', units: 'm', floorPlane: 'XZ', origin: [0, 0, 0] });
    expect(loaded?.actor.rigId).toBe('synthetic-skeleton-1');
    expect(await audioBytes(loaded?.audio ?? null)).toEqual([0, 255, 42, 19]);
    expect(await audioBytes((await loadScene(second.id))?.audio ?? null)).toEqual([9, 8, 7]);
    expect((await loadCurrentScene())?.id).toBe(second.id);
    await setCurrentScene(first.id);
    expect((await loadCurrentScene())?.id).toBe(first.id);
  });

  it('copies a scene under a new identity and never mutates the source when the copy is edited', async () => {
    const original = await saveScene(scene('原稿', [1, 2, 3]));
    const copy = await duplicateScene<typeof original.project>(original.id);
    expect(copy?.id).not.toBe(original.id);
    expect(copy?.name).toBe('原稿 副本');
    expect(await audioBytes(copy?.audio ?? null)).toEqual([1, 2, 3]);
    if (!copy) throw new Error('missing copied scene');
    copy.project.steps.push('新动作');
    copy.viewer.camera = { position: [8, 3, 0], target: [0, 1, 0] };
    await saveScene(copy);
    const restored = await loadScene<typeof original.project>(original.id);
    expect(restored?.project.steps).toEqual(['原稿']);
    expect(restored?.viewer.camera).toBeNull();
    expect((await listScenes()).length).toBe(2);
  });

  it('renames or deletes only the selected scene and clears the marker only when deleting the current scene', async () => {
    const first = await saveScene(scene('第一场景', [1]));
    const second = await saveScene(scene('第二场景', [2]));
    expect((await renameScene(first.id, '独立改名'))?.name).toBe('独立改名');
    expect((await loadCurrentScene())?.id).toBe(second.id);
    expect(await audioBytes((await loadScene(first.id))?.audio ?? null)).toEqual([1]);
    await deleteScene(first.id);
    expect(await loadScene(first.id)).toBeNull();
    expect((await loadCurrentScene())?.id).toBe(second.id);
    await deleteScene(second.id);
    expect(await loadCurrentScene()).toBeNull();
    expect(await listScenes()).toEqual([]);
  });

  it('upgrades the v1 saved project once without losing music or resurrecting it after explicit deletion', async () => {
    const legacy = { project: { history: [{ title: '旧作品', notes: [1, 2] }], historyIndex: 0 }, audio: new Blob([new Uint8Array([6, 5, 4])]), audioName: '旧音乐.wav' };
    await seedLegacy(legacy);
    const viewer = { ...defaultSceneViewer(), selectedJoint: 'Head' as const };
    const migrated = await loadCurrentScene<typeof legacy.project>({ legacyViewer: viewer });
    expect(migrated?.name).toBe('旧作品');
    expect(migrated?.viewer).toEqual(viewer);
    expect(await audioBytes(migrated?.audio ?? null)).toEqual([6, 5, 4]);
    expect((await loadProject())?.project).toEqual(legacy.project);
    expect((await listScenes()).length).toBe(1);
    if (!migrated) throw new Error('missing migrated scene');
    await saveScene({ ...migrated, name: '修改后的场景' });
    await saveProject({ ...legacy, project: { ...legacy.project, history: [{ title: '旧字段后来变化', notes: [] }] } });
    expect((await loadCurrentScene())?.name).toBe('修改后的场景');
    expect((await listScenes()).length).toBe(1);
    await deleteScene(migrated.id);
    expect(await loadCurrentScene()).toBeNull();
    expect(await listScenes()).toEqual([]);
  });

  it('keeps an unsaved new scene separate without erasing stored scenes or selecting a missing scene', async () => {
    const saved = await saveScene(scene('保留场景', [13]));
    await setCurrentScene(null);
    expect(await loadCurrentScene()).toBeNull();
    expect((await listScenes()).map(value => value.id)).toEqual([saved.id]);
    await expect(setCurrentScene('missing-scene')).rejects.toThrow();
    expect(await loadCurrentScene()).toBeNull();
  });

  it('rejects an aborted save after its document request succeeds and keeps document, library and current marker atomic', async () => {
    const original = await saveScene(scene('已提交场景', [2, 4, 6]));
    const put = IDBObjectStore.prototype.put;
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, ...args: Parameters<typeof put>) {
      const request = put.apply(this, args);
      if (this.name === 'scenes') request.addEventListener('success', () => this.transaction.abort());
      return request;
    });
    await expect(saveScene({ ...original, name: '不应提交的名字', audio: new Blob([new Uint8Array([99])]) })).rejects.toThrow();
    vi.restoreAllMocks();
    const restored = await loadScene(original.id);
    expect(restored?.name).toBe('已提交场景');
    expect(await audioBytes(restored?.audio ?? null)).toEqual([2, 4, 6]);
    expect((await listScenes())[0]?.name).toBe('已提交场景');
    expect((await loadCurrentScene())?.id).toBe(original.id);
  });

  it('does not report a successful load when a readonly transaction aborts after returning its request result', async () => {
    const saved = await saveScene(scene('可读场景', [7]));
    const get = IDBObjectStore.prototype.get;
    vi.spyOn(IDBObjectStore.prototype, 'get').mockImplementation(function (this: IDBObjectStore, ...args: Parameters<typeof get>) {
      const request = get.apply(this, args);
      if (this.name === 'scenes') request.addEventListener('success', () => this.transaction.abort());
      return request;
    });
    await expect(loadScene(saved.id)).rejects.toThrow();
  });
});
