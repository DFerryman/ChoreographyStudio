import { createScene, sceneMetadata, type SceneDocument, type SceneMetadata, type SceneViewer } from './scene';

export type StoredProject<T> = { project: T; audio: Blob | null; audioName: string };
const DATABASE_NAME = 'choreo-studio-preview';
const DATABASE_VERSION = 2;
const CURRENT_SCENE = 'currentSceneId';
const LEGACY_MIGRATED = 'legacyProjectMigrated';

function openStore(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    let blocked = false;
    request.onupgradeneeded = () => {
      const db = request.result;
      // Keep the v1 record untouched, including its original uploaded audio.
      for (const store of ['projects', 'scenes', 'sceneIndex', 'sceneMeta']) {
        if (!db.objectStoreNames.contains(store)) db.createObjectStore(store);
      }
    };
    request.onsuccess = () => {
      if (blocked) { request.result.close(); return; }
      request.result.onversionchange = () => request.result.close();
      resolve(request.result);
    };
    request.onerror = () => reject(request.error ?? new Error('无法打开本地存储'));
    request.onblocked = () => {
      blocked = true;
      reject(new Error('请关闭其他打开的旧版工作台后重试本地存储。'));
    };
  });
}

/** Request success is not a committed save: all APIs resolve on transaction completion. */
function transact<T>(db: IDBDatabase, stores: string[], mode: IDBTransactionMode, run: (transaction: IDBTransaction) => () => T): Promise<T> {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(stores, mode);
    let outcome: (() => T) | undefined;
    transaction.oncomplete = () => { if (outcome) resolve(outcome()); };
    transaction.onerror = () => reject(transaction.error ?? new Error('本地存储事务失败'));
    transaction.onabort = () => reject(transaction.error ?? new Error('本地存储事务已中断'));
    try { outcome = run(transaction); }
    catch (error) { transaction.abort(); reject(error); }
  });
}

async function withStore<T>(run: (db: IDBDatabase) => Promise<T>): Promise<T> {
  const db = await openStore();
  try { return await run(db); }
  finally { db.close(); }
}

function isScene(value: unknown): value is SceneDocument<unknown, unknown> {
  if (!value || typeof value !== 'object') return false;
  const document = value as Partial<SceneDocument<unknown, unknown>>;
  return document.schema === 'choreo-scene-1' && typeof document.id === 'string' && typeof document.name === 'string';
}

export async function saveScene<TProject, TViewer = SceneViewer>(scene: SceneDocument<TProject, TViewer>): Promise<SceneDocument<TProject, TViewer>> {
  if (!isScene(scene)) throw new Error('场景格式不受支持。');
  const saved = { ...scene, name: scene.name.trim() || '未命名场景', updatedAt: new Date().toISOString() };
  return withStore(db => transact(db, ['scenes', 'sceneIndex', 'sceneMeta'], 'readwrite', transaction => {
    transaction.objectStore('scenes').put(saved, saved.id);
    transaction.objectStore('sceneIndex').put(sceneMetadata(saved), saved.id);
    const meta = transaction.objectStore('sceneMeta');
    meta.put(saved.id, CURRENT_SCENE);
    meta.put(true, LEGACY_MIGRATED);
    return () => saved;
  }));
}

export async function loadScene<TProject, TViewer = SceneViewer>(id: string): Promise<SceneDocument<TProject, TViewer> | null> {
  return withStore(db => transact(db, ['scenes'], 'readonly', transaction => {
    let result: SceneDocument<TProject, TViewer> | null = null;
    const request = transaction.objectStore('scenes').get(id);
    request.onsuccess = () => { if (isScene(request.result)) result = request.result as SceneDocument<TProject, TViewer>; };
    return () => result;
  }));
}

export async function listScenes(): Promise<SceneMetadata[]> {
  return withStore(db => transact(db, ['sceneIndex'], 'readonly', transaction => {
    let result: SceneMetadata[] = [];
    const request = transaction.objectStore('sceneIndex').getAll();
    request.onsuccess = () => { result = request.result as SceneMetadata[]; };
    return () => result.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) || left.id.localeCompare(right.id));
  }));
}

export async function setCurrentScene(id: string | null): Promise<void> {
  return withStore(db => transact(db, ['scenes', 'sceneMeta'], 'readwrite', transaction => {
    const meta = transaction.objectStore('sceneMeta');
    if (id === null) {
      meta.delete(CURRENT_SCENE);
      meta.put(true, LEGACY_MIGRATED);
    } else {
      const request = transaction.objectStore('scenes').get(id);
      request.onsuccess = () => {
        if (!isScene(request.result)) { transaction.abort(); return; }
        meta.put(id, CURRENT_SCENE);
        meta.put(true, LEGACY_MIGRATED);
      };
    }
    return () => undefined;
  }));
}

function legacyName(project: unknown): string {
  const session = project as { history?: { title?: unknown }[]; historyIndex?: number } | null;
  const title = session?.history?.[session.historyIndex ?? 0]?.title;
  return typeof title === 'string' && title.trim() ? title : '已保存的编舞场景';
}

async function migrateLegacy<TProject, TViewer>(db: IDBDatabase, options: { legacyViewer?: TViewer; legacyName?: string }): Promise<void> {
  return transact(db, ['projects', 'scenes', 'sceneIndex', 'sceneMeta'], 'readwrite', transaction => {
    const meta = transaction.objectStore('sceneMeta');
    const migrated = meta.get(LEGACY_MIGRATED);
    migrated.onsuccess = () => {
      if (migrated.result === true) return;
      const legacy = transaction.objectStore('projects').get('current');
      legacy.onsuccess = () => {
        const value = legacy.result as StoredProject<TProject> | undefined;
        if (value?.project) {
          const scene = createScene<TProject, TViewer>({
            name: options.legacyName ?? legacyName(value.project), project: value.project,
            audio: value.audio ?? null, audioName: value.audioName ?? '', viewer: options.legacyViewer,
          });
          transaction.objectStore('scenes').put(scene, scene.id);
          transaction.objectStore('sceneIndex').put(sceneMetadata(scene), scene.id);
          meta.put(scene.id, CURRENT_SCENE);
        }
        meta.put(true, LEGACY_MIGRATED);
      };
    };
    return () => undefined;
  });
}

export async function loadCurrentScene<TProject, TViewer = SceneViewer>(options: { legacyViewer?: TViewer; legacyName?: string } = {}): Promise<SceneDocument<TProject, TViewer> | null> {
  return withStore(async db => {
    await migrateLegacy<TProject, TViewer>(db, options);
    return transact(db, ['sceneMeta', 'scenes'], 'readonly', transaction => {
      let result: SceneDocument<TProject, TViewer> | null = null;
      const current = transaction.objectStore('sceneMeta').get(CURRENT_SCENE);
      current.onsuccess = () => {
        if (typeof current.result !== 'string') return;
        const scene = transaction.objectStore('scenes').get(current.result);
        scene.onsuccess = () => { if (isScene(scene.result)) result = scene.result as SceneDocument<TProject, TViewer>; };
      };
      return () => result;
    });
  });
}

export async function deleteScene(id: string): Promise<void> {
  return withStore(db => transact(db, ['scenes', 'sceneIndex', 'sceneMeta'], 'readwrite', transaction => {
    transaction.objectStore('scenes').delete(id);
    transaction.objectStore('sceneIndex').delete(id);
    const meta = transaction.objectStore('sceneMeta');
    const current = meta.get(CURRENT_SCENE);
    current.onsuccess = () => { if (current.result === id) meta.delete(CURRENT_SCENE); };
    meta.put(true, LEGACY_MIGRATED);
    return () => undefined;
  }));
}

export async function renameScene(id: string, name: string): Promise<SceneMetadata | null> {
  return withStore(db => transact(db, ['scenes', 'sceneIndex'], 'readwrite', transaction => {
    let result: SceneMetadata | null = null;
    const request = transaction.objectStore('scenes').get(id);
    request.onsuccess = () => {
      if (!isScene(request.result)) return;
      const renamed = { ...request.result, name: name.trim() || '未命名场景', updatedAt: new Date().toISOString() };
      result = sceneMetadata(renamed);
      transaction.objectStore('scenes').put(renamed, id);
      transaction.objectStore('sceneIndex').put(result, id);
    };
    return () => result;
  }));
}

export async function duplicateScene<TProject, TViewer = SceneViewer>(id: string, name?: string): Promise<SceneDocument<TProject, TViewer> | null> {
  const original = await loadScene<TProject, TViewer>(id);
  if (!original) return null;
  return saveScene(createScene({
    name: name?.trim() || `${original.name} 副本`, project: original.project,
    audio: original.audio, audioName: original.audioName, viewer: original.viewer,
  }));
}

// Kept for a smooth v1 UI transition; new scene operations never write this old record.
export async function saveProject<T>(value: StoredProject<T>): Promise<void> {
  return withStore(db => transact(db, ['projects'], 'readwrite', transaction => {
    transaction.objectStore('projects').put(value, 'current');
    return () => undefined;
  }));
}
export async function loadProject<T>(): Promise<StoredProject<T> | null> {
  return withStore(db => transact(db, ['projects'], 'readonly', transaction => {
    let result: StoredProject<T> | null = null;
    const request = transaction.objectStore('projects').get('current');
    request.onsuccess = () => { result = request.result ?? null; };
    return () => result;
  }));
}
