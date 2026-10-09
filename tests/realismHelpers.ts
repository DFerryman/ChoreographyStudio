import { mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, type Page, type TestInfo } from '@playwright/test';
import { PerspectiveCamera, Vector3 } from 'three';
import { JOINT_NAMES, type BakedTake, type JointName, type Pose, type Vec3 } from '../packages/core/src';
import type { SceneDocument } from '../apps/web/src/scene';
import type { SceneProject } from '../apps/web/src/sceneProject';
import { clickRevealed, closeDisclosures, reveal } from './helpers';
import { applyStageViewOffset, editStageValue, selectStageJoint } from './stageInteractions';

export type Backup = { scene: SceneDocument<SceneProject> };
export const current = (backup: Backup) => backup.scene.project.history[backup.scene.project.historyIndex];
export const draft = (page: Page) => page.getByRole('status').filter({ hasText: '姿态草稿 · 尚未写入关键帧' });
export const hiddenButton = (page: Page, name: string) => page.getByRole('button', { name, exact: true, includeHidden: true });
export async function openRealism(page: Page) {
  await closeDisclosures(page, '.studio-more, .kf-more, .kf-more-actions');
  const panel = page.locator('details.realism-panel');
  await reveal(page, panel.locator(':scope > summary'));
  if (!(await panel.evaluate((element: HTMLDetailsElement) => element.open))) await panel.locator(':scope > summary').click();
  await expect(panel.getByText('标准中性人体', { exact: false })).toBeVisible();
}

export function fixture(floating = false) {
  const countMap = { id: 'realism-count-map', version: 1, bpm: 120, musicBeatsPerDanceCount: 1 as const, firstCountSourceSeconds: 1, sourceOffsetSeconds: 1, durationSeconds: 16, octetCount: 4, countTimesSeconds: Array.from({ length: 33 }, (_, i) => i * .5), confirmed: true as const };
  const plan = {
    id: 'realism-plan', countMapId: countMap.id, durationSeconds: 16, provenance: 'synthetic-demo' as const,
    slots: ['step-touch', 'side-reach', 'groove', 'settle'].map((actionId, slotIndex) => ({ slotIndex, actionId, label: '原创本地真实约束回归', teachingCue: '本地回归', startSeconds: slotIndex * 4, endSeconds: (slotIndex + 1) * 4, countStart: slotIndex * 8 + 1, countEnd: (slotIndex + 1) * 8, role: slotIndex === 0 ? 'opening' as const : slotIndex === 3 ? 'closing' as const : 'body' as const })),
  };
  const times = [0, .7, 2.5, 4, 8, 12, 16];
  const poses = times.map((): Pose => ({ root: [0, floating ? 1.8 : 1.05, 0], joints: Object.fromEntries(JOINT_NAMES.map(joint => [joint, [0, 0, 0, 1]])) as Pose['joints'] }));
  const take: BakedTake = { id: 'realism-nonuniform-base', schemaVersion: 'preview-1', planId: plan.id, countMapId: countMap.id, durationSeconds: 16, times, poses, provenance: 'synthetic-demo' };
  const scene = {
    schema: 'choreo-scene-1', id: 'realism-local-scene', name: floating ? '浮空人体物理回归' : '人体约束本地回归', createdAt: '2026-10-08T04:00:00.000Z', updatedAt: '2026-10-08T04:00:00.000Z',
    coordinateSystem: { handedness: 'right', upAxis: '+Y', forwardAxis: '+Z', units: 'm', floorPlane: 'XZ', origin: [0, 0, 0] },
    actor: { id: 'actor-1', rigId: 'synthetic-skeleton-1', provenance: 'synthetic-demo', joints: [...JOINT_NAMES] },
    project: { history: [{ title: '人体约束本地回归', countMap, plan, take }], historyIndex: 0, revision: 1, audioDuration: 20, teacherCheckedRevision: null },
    audioName: 'realism-original.wav', viewer: { camera: null, view: 'front', mirror: false, rate: 1, loop: false, countSound: false, selectedSlot: 0, selectedJoint: null, time: 0, editorMode: 'keyframes', transformTool: 'select' },
  };
  const rate = 8000, samples = rate * 20, wave = Buffer.alloc(44 + samples * 2);
  wave.write('RIFF', 0); wave.writeUInt32LE(wave.length - 8, 4); wave.write('WAVE', 8); wave.write('fmt ', 12); wave.writeUInt32LE(16, 16);
  wave.writeUInt16LE(1, 20); wave.writeUInt16LE(1, 22); wave.writeUInt32LE(rate, 24); wave.writeUInt32LE(rate * 2, 28); wave.writeUInt16LE(2, 32); wave.writeUInt16LE(16, 34);
  wave.write('data', 36); wave.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i++) wave.writeInt16LE(Math.round(Math.sin(i / rate * Math.PI * 2 * 440) * 1200), 44 + i * 2);
  return { scene, take, wave };
}

export async function ready(page: Page) {
  await expect(page.getByRole('button', { name: '播放', exact: true })).toBeEnabled();
  await expect(page.getByLabel('相机世界坐标')).not.toContainText('—');
  await expect.poll(() => page.locator('audio').evaluate((audio: HTMLAudioElement) => audio.readyState)).toBeGreaterThanOrEqual(2);
}
export async function openFixture(page: Page, floating = false, mutate?: (source: ReturnType<typeof fixture>) => void) {
  const source = fixture(floating);
  mutate?.(source);
  await page.goto('/'); await ready(page);
  await page.evaluate(async ({ scene, bytes }) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('choreo-studio-preview', 2); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
    });
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(['scenes', 'sceneIndex', 'sceneMeta'], 'readwrite');
      tx.objectStore('scenes').put({ ...scene, audio: new Blob([new Uint8Array(bytes)], { type: 'audio/wav' }) }, scene.id);
      const { schema, id, name, createdAt, updatedAt, audioName } = scene;
      tx.objectStore('sceneIndex').put({ schema, id, name, createdAt, updatedAt, audioName }, id);
      tx.objectStore('sceneMeta').put(id, 'currentSceneId'); tx.objectStore('sceneMeta').put(true, 'legacyProjectMigrated');
      tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error);
    }); db.close();
  }, { scene: source.scene, bytes: Array.from(source.wave) });
  await page.reload(); await ready(page);
  await expect(page.locator('.project-title h1')).toHaveText(source.scene.name);
  expect(current(await backup(page)).take).toEqual(source.take);
  return source;
}
export async function backup(page: Page): Promise<Backup> {
  const pending = page.waitForEvent('download'); await clickRevealed(page, hiddenButton(page, '下载项目备份'));
  const path = await (await pending).path(); expect(path).toBeTruthy();
  const document = JSON.parse(await readFile(path!, 'utf8')) as Backup;
  await closeDisclosures(page, '.studio-more, .studio-more .backup-menu');
  return document;
}
export async function numeric(page: Page, label: string, value: number) {
  await editStageValue(page, label, value);
}
export const frame = (page: Page, value: number) => numeric(page, '当前帧', value);
export const select = (page: Page, joint: JointName) => selectStageJoint(page, joint);
export async function jointPosition(page: Page): Promise<Vec3> {
  const label = page.getByLabel('选中关节世界坐标', { exact: true });
  await reveal(page, label);
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  const position = Array.from((await label.locator('strong').innerText()).matchAll(/[XYZ]\s*(-?\d+(?:\.\d+)?)/g), match => Number(match[1])) as Vec3;
  await closeDisclosures(page, '.scene-extras');
  return position;
}
export async function save(page: Page) {
  await page.getByRole('button', { name: '保存', exact: true }).click(); await expect(page.locator('.save-state')).toHaveText('已保存到本机');
}
export async function projection(page: Page, backup: Backup) {
  await closeDisclosures(page, '.studio-more, .scene-extras, .camera-options, .kf-more, .kf-more-actions');
  const canvas = page.getByRole('img', { name: '人体编舞动作预览' }); await canvas.scrollIntoViewIfNeeded();
  const box = (await canvas.boundingBox())!, state = backup.scene.viewer.camera!;
  const camera = new PerspectiveCamera(40, box.width / box.height, .05, 80);
  camera.position.fromArray(state.position); camera.zoom = state.zoom ?? 1;
  await applyStageViewOffset(page, camera);
  camera.lookAt(new Vector3(...state.target)); camera.updateProjectionMatrix(); camera.updateMatrixWorld(true);
  return { canvas, point: (world: Vec3) => { const point = new Vector3(...world).project(camera); return { x: box.x + (point.x + 1) * box.width / 2, y: box.y + (1 - point.y) * box.height / 2 }; } };
}
export async function screenshot(page: Page, info: TestInfo, name: string) {
  await info.attach(name, { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });
  if (process.env.CHOREO_SCREENSHOT_DIR) { await mkdir(process.env.CHOREO_SCREENSHOT_DIR, { recursive: true }); await page.screenshot({ path: join(process.env.CHOREO_SCREENSHOT_DIR, name), fullPage: true }); }
}

export function diagnostics(page: Page) {
  const report = { errors: [] as string[], warnings: [] as string[], expectedHttpErrors: [] as string[], apiRequests: [] as string[] };
  page.on('pageerror', error => report.errors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error') {
      const location = message.location().url;
      if (location.includes('/api/choreography/generate') && /^Failed to load resource:/.test(message.text())) report.expectedHttpErrors.push(message.text());
      else report.errors.push(message.text());
    }
    if (message.type() === 'warning') report.warnings.push(message.text());
  });
  page.on('request', request => { if (new URL(request.url()).pathname.startsWith('/api/')) report.apiRequests.push(`${request.method()} ${new URL(request.url()).pathname}`); });
  page.on('dialog', dialog => { void (dialog.type() === 'beforeunload' ? dialog.accept() : dialog.dismiss()); });
  return report;
}
