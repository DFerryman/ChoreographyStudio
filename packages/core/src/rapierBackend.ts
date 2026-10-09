/** One shared WASM initialization for geometric contacts and explicit physics. */
type Rapier = typeof import('@dimforge/rapier3d-compat');
let ready: Rapier | undefined;
let initialization: Promise<Rapier> | undefined;

export function loadRapierBackend(): Promise<Rapier> {
  if (!initialization) initialization = import('@dimforge/rapier3d-compat').then(async module => {
    await module.init(); ready = module; return module;
  }).catch(error => { initialization = undefined; throw error; });
  return initialization;
}
export async function initializeBodyCollisionBackend(): Promise<void> { await loadRapierBackend(); }
export function isBodyCollisionBackendReady(): boolean { return ready !== undefined; }
export function getReadyRapierBackend(): Rapier {
  if (!ready) throw new Error('身体碰撞引擎尚未就绪，请等待人物模型完成加载。');
  return ready;
}
