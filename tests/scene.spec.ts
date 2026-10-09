import { applyStageViewOffset, selectStageJoint, expectStageSelection } from './stageInteractions';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { PerspectiveCamera, Vector3 } from 'three';
import { expect, test, type Page } from '@playwright/test';
import { clickRevealed, closeDisclosures, reveal } from './helpers';

type Camera = { position: [number, number, number]; target: [number, number, number]; zoom?: number };
type Backup = {
  scene: {
    id: string;
    name: string;
    audioName: string;
    project: { historyIndex: number; history: { take: unknown; plan: unknown }[] };
    viewer: { camera: Camera; view: string; mirror: boolean; rate: number; loop: boolean; countSound: boolean; selectedSlot: number; selectedJoint: string | null; time: number };
  };
};

const diagnostics = new WeakMap<Page, { errors: string[]; warnings: string[] }>();
test.beforeEach(async ({ page }) => {
  const messages = { errors: [] as string[], warnings: [] as string[] };
  diagnostics.set(page, messages);
  page.on('pageerror', error => messages.errors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error') messages.errors.push(message.text());
    if (message.type() === 'warning') messages.warnings.push(message.text());
  });
  page.on('dialog', dialog => { void (dialog.type() === 'beforeunload' ? dialog.accept() : dialog.dismiss()); });
});
test.afterEach(async ({ page }, testInfo) => {
  const messages = diagnostics.get(page)!;
  await testInfo.attach('browser-console', { body: JSON.stringify(messages), contentType: 'application/json' });
  expect(messages.errors, 'Browser runtime errors').toEqual([]);
});

async function ready(page: Page) {
  await page.goto('/');
  await expect(page.getByRole('button', { name: '播放', exact: true })).toBeEnabled();
  await expect(page.getByLabel('相机世界坐标')).not.toContainText('—');
  await expect.poll(() => page.locator('audio').evaluate((audio: HTMLAudioElement) => audio.readyState)).toBeGreaterThanOrEqual(2);
}

async function backup(page: Page): Promise<Backup> {
  const downloading = page.waitForEvent('download');
  await clickRevealed(page, page.getByRole('button', { name: '下载项目备份', exact: true, includeHidden: true }));
  const path = await (await downloading).path();
  expect(path).toBeTruthy();
  return JSON.parse(await readFile(path!, 'utf8')) as Backup;
}

const projectHash = (document: Backup) => createHash('sha256').update(JSON.stringify(document.scene.project)).digest('hex');
const distance = (camera: Camera) => Math.hypot(...camera.position.map((value, i) => value - camera.target[i]));
function sameCamera(actual: Camera, expected: Camera) {
  expect(actual, 'The rendered scene must expose its concrete camera').toBeTruthy();
  expect(expected, 'A saved camera must retain its concrete position and target').toBeTruthy();
  [...actual.position, ...actual.target, actual.zoom ?? 1].forEach((value, i) => {
    expect(value).toBeCloseTo([...expected.position, ...expected.target, expected.zoom ?? 1][i], 5);
  });
}
async function coordinateText(page: Page) { await reveal(page, page.getByLabel('相机世界坐标')); return page.getByLabel('相机世界坐标').innerText(); }
async function coordinateValues(page: Page) { return (await coordinateText(page)).match(/-?\d+\.\d+/g)?.map(Number) ?? []; }
async function waitCamera(page: Page, camera: Camera) {
  await expect.poll(() => coordinateValues(page)).toEqual(camera.position.map(value => Number(value.toFixed(2))));
}

async function drag(page: Page, button: 'left' | 'right', start = [0.7, 0.42], end = [0.86, 0.49]) {
  await closeDisclosures(page, '.studio-more, .scene-extras, .camera-options, .kf-more, .kf-more-actions');
  const canvas = page.getByRole('img', { name: '人体编舞动作预览' });
  await canvas.scrollIntoViewIfNeeded();
  const box = (await canvas.boundingBox())!;
  await page.mouse.move(box.x + box.width * start[0], box.y + box.height * start[1]);
  await page.mouse.down({ button });
  await page.mouse.move(box.x + box.width * end[0], box.y + box.height * end[1], { steps: 8 });
  await page.mouse.up({ button });
}

async function save(page: Page) {
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.locator('.save-state')).toHaveText('已保存到本机');
}
async function renameCurrent(page: Page, name: string) {
  await page.getByRole('button', { name: '修改当前场景名称', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '修改场景名称', exact: true });
  await dialog.getByLabel('场景名称').fill(name);
  await dialog.getByRole('button', { name: '确认改名', exact: true }).click();
  await expect(page.locator('.project-title h1')).toHaveText(name);
}
async function library(page: Page) {
  await page.getByRole('button', { name: '场景', exact: true }).click();
  return page.getByRole('dialog', { name: '本机场景', exact: true });
}
async function newScene(page: Page) {
  await (await library(page)).getByRole('button', { name: '新建场景', exact: true }).click();
  await expect(page.locator('.project-title h1')).toHaveText('未命名场景');
  await expect(page.getByRole('button', { name: '播放', exact: true })).toBeEnabled();
  await expect(page.getByLabel('相机世界坐标')).not.toContainText('—');
}
async function openScene(page: Page, name: string) {
  await (await library(page)).getByRole('button', { name: `打开场景 ${name}`, exact: true }).click();
}
function fixtureWave() {
  const sampleRate = 8000, samples = sampleRate * 20;
  const bytes = Buffer.alloc(44 + samples * 2);
  bytes.write('RIFF', 0); bytes.writeUInt32LE(36 + samples * 2, 4); bytes.write('WAVE', 8);
  bytes.write('fmt ', 12); bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(sampleRate, 24); bytes.writeUInt32LE(sampleRate * 2, 28); bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34);
  bytes.write('data', 36); bytes.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i++) bytes.writeInt16LE(Math.round(Math.sin(i / sampleRate * Math.PI * 2 * 330) * 1600), 44 + i * 2);
  return bytes;
}
async function audioHash(page: Page) {
  return page.locator('audio').evaluate(async (audio: HTMLAudioElement) => {
    const bytes = await (await fetch(audio.src)).arrayBuffer();
    const hash = await crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('');
  });
}

test('camera gestures and presets change the view, preserve the take, and keep joint picking distinct from dragging', async ({ page }) => {
  test.setTimeout(90_000);
  await ready(page);
  const original = await backup(page);
  const originalProject = projectHash(original);
  for (const [label, axis, direction] of [['背面', 2, -1], ['左侧', 0, 1], ['右侧', 0, -1], ['顶视', 1, 1], ['正面', 2, 1]] as const) {
    await clickRevealed(page, page.getByRole('button', { name: label, exact: true, includeHidden: true }));
    await expect.poll(async () => {
      const position = await coordinateValues(page);
      const offset = position.map((value, i) => value - (i === 1 ? 0.95 : 0));
      return offset[axis] * direction > 0.5 && Math.abs(offset[axis]) > Math.max(...offset.filter((_, i) => i !== axis));
    }).toBe(true);
  }
  await clickRevealed(page, page.getByRole('button', { name: '复位相机', exact: true, includeHidden: true }));
  await waitCamera(page, original.scene.viewer.camera);
  const resetPreset = await backup(page);
  sameCamera(resetPreset.scene.viewer.camera, original.scene.viewer.camera);

  const beforeOrbit = await coordinateText(page);
  await drag(page, 'left');
  await expect.poll(() => coordinateText(page)).not.toBe(beforeOrbit);
  const orbited = await backup(page);
  expect(orbited.scene.viewer.view).toBe('free');
  expect(orbited.scene.viewer.camera.position).not.toEqual(original.scene.viewer.camera.position);
  expect(projectHash(orbited)).toBe(originalProject);

  // Forward-project a known landmark through the publicly exported camera.
  // This never reads renderer internals or duplicates its raycast selection algorithm.
  await closeDisclosures(page, '.studio-more, .scene-extras, .camera-options, .kf-more, .kf-more-actions');
  const canvas = page.getByRole('img', { name: '人体编舞动作预览' });
  await canvas.scrollIntoViewIfNeeded();
  const box = (await canvas.boundingBox())!;
  const camera = new PerspectiveCamera(40, box.width / box.height, 0.05, 80);
  camera.position.fromArray(orbited.scene.viewer.camera.position);
  camera.zoom = orbited.scene.viewer.camera.zoom ?? 1;
  await applyStageViewOffset(page, camera);
  camera.lookAt(new Vector3(...orbited.scene.viewer.camera.target));
  camera.updateProjectionMatrix(); camera.updateMatrixWorld(true);
  const point = new Vector3(0, 1.05, 0).project(camera);
  await page.mouse.click(box.x + (point.x + 1) * box.width / 2, box.y + (1 - point.y) * box.height / 2);
  await expectStageSelection(page, 'Hips');
  await expect(page.getByLabel('选中关节世界坐标')).toContainText('Y1.050');
  const beforeDrag = await coordinateText(page);
  await drag(page, 'left', [0.72, 0.42], [0.9, 0.49]);
  await expect.poll(() => coordinateText(page)).not.toBe(beforeDrag);
  await expectStageSelection(page, 'Hips');

  const beforePan = await backup(page);
  const beforePanText = await coordinateText(page);
  await drag(page, 'right', [0.7, 0.55], [0.76, 0.61]);
  await expect.poll(() => coordinateText(page)).not.toBe(beforePanText);
  const panned = await backup(page);
  expect(panned.scene.viewer.camera.target).not.toEqual(beforePan.scene.viewer.camera.target);
  const beforeZoom = await coordinateText(page);
  await closeDisclosures(page, '.studio-more, .scene-extras, .camera-options, .kf-more, .kf-more-actions');
  await canvas.scrollIntoViewIfNeeded();
  const zoomBox = (await canvas.boundingBox())!;
  await page.mouse.move(zoomBox.x + zoomBox.width * 0.7, zoomBox.y + zoomBox.height * 0.4);
  await page.mouse.wheel(0, 500);
  await expect.poll(() => coordinateText(page)).not.toBe(beforeZoom);
  const zoomed = await backup(page);
  expect(distance(zoomed.scene.viewer.camera)).toBeGreaterThan(distance(panned.scene.viewer.camera) + 0.05);
  await clickRevealed(page, page.getByRole('button', { name: '复位相机', exact: true, includeHidden: true }));
  await waitCamera(page, original.scene.viewer.camera);
  await expect(page.getByRole('button', { name: '正面', exact: true })).toHaveAttribute('aria-pressed', 'true');
  const final = await backup(page);
  sameCamera(final.scene.viewer.camera, original.scene.viewer.camera);
  expect(projectHash(final), 'Camera movement and joint inspection must not mutate the choreography').toBe(originalProject);
});

test('saved scenes independently restore audio, choreography and camera settings, while copied scenes can change and be deleted', async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  await ready(page);
  await clickRevealed(page, page.getByRole('button', { name: '八拍编排', exact: true, includeHidden: true }));
  const wave = fixtureWave(), expectedAudio = createHash('sha256').update(wave).digest('hex');
  await clickRevealed(page, page.getByRole('button', { name: '导入音乐', exact: true, includeHidden: true }));
  const music = page.getByRole('dialog', { name: '先把音乐和数拍准备好', exact: true });
  await music.getByLabel('作品名称').fill('场景 A · 原音频');
  await music.getByLabel('上传音乐文件').setInputFiles({ name: 'scene-A-original.wav', mimeType: 'audio/wav', buffer: wave });
  await expect(music).toContainText('20.0 秒可用音频');
  await music.getByLabel('选取几个完整八拍').fill('4');
  await music.getByRole('button', { name: '确认数拍，进入工作台', exact: true }).click();
  await page.getByRole('button', { name: '生成模板初稿', exact: true }).click();
  await page.getByRole('listitem', { name: /^第2个八拍/ }).click();
  await page.getByRole('button', { name: '背面', exact: true }).click();
  await drag(page, 'left', [0.75, 0.43], [0.83, 0.46]);
  await expect(page.locator('.viewer-muted')).toHaveText('自由视角');
  await selectStageJoint(page, 'LeftHand');
  await page.getByRole('combobox', { name: '播放速度', exact: true }).selectOption('0.5');
  await clickRevealed(page, page.getByRole('button', { name: '镜像观看', exact: true, includeHidden: true }));
  await page.getByRole('button', { name: '循环当前八拍', exact: true }).click();
  await clickRevealed(page, page.getByRole('button', { name: '节拍提示', exact: true, includeHidden: true }));
  await save(page);
  const sceneA = await backup(page);

  await newScene(page); await clickRevealed(page, page.getByRole('button', { name: '八拍编排', exact: true, includeHidden: true }));
  await renameCurrent(page, '场景 B · 节奏示例');
  await page.getByRole('listitem', { name: /^第3个八拍/ }).click();
  await clickRevealed(page, page.getByRole('button', { name: '左侧', exact: true, includeHidden: true }));
  await selectStageJoint(page, 'RightHand');
  await page.getByRole('combobox', { name: '播放速度', exact: true }).selectOption('0.75');
  await save(page);
  const sceneB = await backup(page), sceneBAudio = await audioHash(page);
  expect(sceneA.scene.id).not.toBe(sceneB.scene.id);
  expect(projectHash(sceneA)).not.toBe(projectHash(sceneB));
  expect(sceneBAudio).not.toBe(expectedAudio);

  await page.reload();
  await expect(page.locator('.project-title h1')).toHaveText(sceneB.scene.name);
  await expect(page.locator('.save-state')).toHaveText('已保存到本机');
  await expect(page.getByRole('combobox', { name: '播放速度', exact: true })).toHaveValue('0.75');
  await expectStageSelection(page, 'RightHand');
  await expect(page.getByRole('listitem', { name: /^第3个八拍/ })).toHaveClass(/selected/);
  await waitCamera(page, sceneB.scene.viewer.camera);
  let restored = await backup(page);
  sameCamera(restored.scene.viewer.camera, sceneB.scene.viewer.camera);
  expect(projectHash(restored)).toBe(projectHash(sceneB));
  expect(await audioHash(page)).toBe(sceneBAudio);

  await openScene(page, sceneA.scene.name);
  await expect(page.locator('.project-title h1')).toHaveText(sceneA.scene.name);
  await expect(page.getByRole('combobox', { name: '播放速度', exact: true })).toHaveValue('0.5');
  await expectStageSelection(page, 'LeftHand');
  await expect(page.getByRole('button', { name: '镜像观看', exact: true, includeHidden: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: '循环当前八拍', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: '节拍提示', exact: true, includeHidden: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('listitem', { name: /^第2个八拍/ })).toHaveClass(/selected/);
  await waitCamera(page, sceneA.scene.viewer.camera);
  restored = await backup(page);
  sameCamera(restored.scene.viewer.camera, sceneA.scene.viewer.camera);
  expect(restored.scene.viewer.view).toBe('free');
  expect(restored.scene.viewer.time).toBe(sceneA.scene.viewer.time);
  expect(projectHash(restored)).toBe(projectHash(sceneA));
  expect(await audioHash(page)).toBe(expectedAudio);
  await page.reload();
  await expect(page.locator('.project-title h1')).toHaveText(sceneA.scene.name);
  await expect(page.locator('.save-state')).toHaveText('已保存到本机');
  await waitCamera(page, sceneA.scene.viewer.camera);
  sameCamera((await backup(page)).scene.viewer.camera, sceneA.scene.viewer.camera);
  expect(await audioHash(page)).toBe(expectedAudio);
  await openScene(page, sceneB.scene.name);
  await expect(page.locator('.project-title h1')).toHaveText(sceneB.scene.name);
  await waitCamera(page, sceneB.scene.viewer.camera);
  restored = await backup(page);
  sameCamera(restored.scene.viewer.camera, sceneB.scene.viewer.camera);
  expect(projectHash(restored)).toBe(projectHash(sceneB));

  await (await library(page)).getByRole('button', { name: `复制场景 ${sceneB.scene.name}`, exact: true }).click();
  await expect(page.locator('.project-title h1')).toHaveText(`${sceneB.scene.name} 副本`);
  await expect(page.getByLabel('选中关节世界坐标')).toContainText('右腕');
  await expect(page.getByLabel('选中关节世界坐标').locator('strong')).toContainText('Y');
  const copied = await backup(page);
  expect(copied.scene.id).not.toBe(sceneB.scene.id);
  expect(projectHash(copied)).toBe(projectHash(sceneB));
  sameCamera(copied.scene.viewer.camera, sceneB.scene.viewer.camera);
  expect(await audioHash(page)).toBe(sceneBAudio);
  await page.reload();
  await expect(page.locator('.project-title h1')).toHaveText(copied.scene.name);
  await expect(page.locator('.save-state')).toHaveText('已保存到本机');
  await waitCamera(page, copied.scene.viewer.camera);
  const copiedAfterRefresh = await backup(page);
  expect(copiedAfterRefresh.scene.id).toBe(copied.scene.id);
  expect(projectHash(copiedAfterRefresh)).toBe(projectHash(sceneB));
  expect(await audioHash(page)).toBe(sceneBAudio);
  await testInfo.attach('copy-refresh', { body: JSON.stringify({ copiedId: copied.scene.id, restoredId: copiedAfterRefresh.scene.id }), contentType: 'application/json' });
  await renameCurrent(page, '独立副本 C');
  await page.getByRole('listitem', { name: /^第1个八拍/ }).click();
  await page.getByRole('button', { name: '换一个八拍', exact: true }).click();
  await page.getByRole('region', { name: '替换候选' }).getByRole('button', { name: '采用', exact: true }).click();
  await save(page);
  await openScene(page, sceneB.scene.name);
  await expect(page.locator('.project-title h1')).toHaveText(sceneB.scene.name);
  expect(projectHash(await backup(page)), 'Editing a copied scene must preserve the original choreography').toBe(projectHash(sceneB));
  await (await library(page)).getByRole('button', { name: '删除场景 独立副本 C', exact: true }).click();
  await page.getByRole('dialog', { name: '删除这个本机场景？', exact: true }).getByRole('button', { name: '删除场景', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '删除这个本机场景？', exact: true })).toHaveCount(0);
  const remaining = await library(page);
  await expect(remaining.getByRole('button', { name: '打开场景 独立副本 C', exact: true })).toHaveCount(0);
  await expect(remaining.getByRole('button', { name: `打开场景 ${sceneA.scene.name}`, exact: true })).toBeVisible();
  await expect(remaining.getByRole('button', { name: `打开场景 ${sceneB.scene.name}`, exact: true })).toBeVisible();
});

test('cancel, failed save and discard during a dirty scene switch preserve the correct drafts and saved scenes', async ({ page }) => {
  test.setTimeout(120_000);
  await ready(page);
  await clickRevealed(page, page.getByRole('button', { name: '八拍编排', exact: true, includeHidden: true }));
  await renameCurrent(page, '保护场景 A'); await save(page);
  const sceneA = await backup(page);
  await newScene(page); await clickRevealed(page, page.getByRole('button', { name: '八拍编排', exact: true, includeHidden: true })); await renameCurrent(page, '保护场景 B'); await save(page);
  await page.getByRole('listitem', { name: /^第2个八拍/ }).click();
  await page.getByRole('button', { name: '换一个八拍', exact: true }).click();
  await page.getByRole('region', { name: '替换候选' }).getByRole('button', { name: '采用', exact: true }).click();
  const draft = await backup(page);
  await openScene(page, sceneA.scene.name);
  const guard = page.getByRole('dialog', { name: '保留当前场景的修改？', exact: true });
  await expect(guard).toBeVisible();
  await guard.getByRole('button', { name: '取消', exact: true }).click();
  await page.getByRole('button', { name: '关闭场景列表', exact: true }).click();
  expect(projectHash(await backup(page))).toBe(projectHash(draft));
  await expect(page.locator('.project-title h1')).toHaveText('保护场景 B');

  await openScene(page, sceneA.scene.name);
  await expect(guard).toBeVisible();
  // A browser-local failure injection only; it creates no network traffic or server writes.
  await page.evaluate(() => {
    const original = IDBDatabase.prototype.transaction;
    (window as unknown as { restoreSceneTransactions: () => void }).restoreSceneTransactions = () => { IDBDatabase.prototype.transaction = original; };
    IDBDatabase.prototype.transaction = function (...args: Parameters<IDBDatabase['transaction']>) {
      if (args[1] === 'readwrite') throw new DOMException('Simulated storage full', 'QuotaExceededError');
      return original.apply(this, args);
    };
  });
  await guard.getByRole('button', { name: '保存后继续', exact: true }).click();
  await expect(page.locator('.save-state')).toHaveText('保存失败');
  await expect(guard).toBeVisible();
  await expect(page.locator('.project-title h1')).toHaveText('保护场景 B');
  await page.evaluate(() => (window as unknown as { restoreSceneTransactions: () => void }).restoreSceneTransactions());
  await guard.getByRole('button', { name: '取消', exact: true }).click();
  await page.getByRole('button', { name: '关闭场景列表', exact: true }).click();
  expect(projectHash(await backup(page))).toBe(projectHash(draft));

  await openScene(page, sceneA.scene.name);
  await guard.getByRole('button', { name: '保存后继续', exact: true }).click();
  await expect(page.locator('.project-title h1')).toHaveText(sceneA.scene.name);
  expect(projectHash(await backup(page))).toBe(projectHash(sceneA));
  await openScene(page, '保护场景 B');
  await expect(page.locator('.project-title h1')).toHaveText('保护场景 B');
  await waitCamera(page, draft.scene.viewer.camera);
  const savedB = await backup(page);
  expect(projectHash(savedB)).toBe(projectHash(draft));
  await clickRevealed(page, page.getByRole('button', { name: '右侧', exact: true, includeHidden: true }));
  await openScene(page, sceneA.scene.name);
  await guard.getByRole('button', { name: '不保存，继续', exact: true }).click();
  await expect(page.locator('.project-title h1')).toHaveText(sceneA.scene.name);
  await openScene(page, '保护场景 B');
  await expect(page.locator('.project-title h1')).toHaveText('保护场景 B');
  await waitCamera(page, savedB.scene.viewer.camera);
  const afterDiscard = await backup(page);
  expect(projectHash(afterDiscard)).toBe(projectHash(savedB));
  sameCamera(afterDiscard.scene.viewer.camera, savedB.scene.viewer.camera);
});
