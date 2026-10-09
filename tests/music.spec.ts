import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import { clickRevealed, closeDisclosures } from './helpers';
import { unpackScene } from '../apps/web/src/compactScene';

type Diagnostics = { errors: string[]; warnings: string[]; apiRequests: string[] };
type DecodeRequest = { ready: boolean; finished: boolean; release: (success: boolean) => void };
type PlayRequest = DecodeRequest & { audio: HTMLMediaElement };
declare global {
  interface Window { musicRaceDecode: DecodeRequest[]; musicRacePlay: PlayRequest[]; musicRaceExpectedDigest: string | null }
}
const diagnostics = new WeakMap<Page, Diagnostics>();

test.beforeEach(async ({ page }) => {
  const messages: Diagnostics = { errors: [], warnings: [], apiRequests: [] };
  diagnostics.set(page, messages);
  page.on('pageerror', error => messages.errors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error') messages.errors.push(message.text());
    if (message.type() === 'warning') messages.warnings.push(message.text());
  });
  page.on('request', request => {
    if (new URL(request.url()).pathname.startsWith('/api/')) messages.apiRequests.push(`${request.method()} ${request.url()}`);
  });
  page.on('dialog', dialog => { void (dialog.type() === 'beforeunload' ? dialog.accept() : dialog.dismiss()); });
  // Decode a real WAV with the browser, then hold its result behind a test-owned
  // barrier. No long timers, fake duration or production network are involved.
  await page.addInitScript(() => {
    window.musicRaceDecode = [];
    window.musicRaceExpectedDigest = null;
    const original = AudioContext.prototype.decodeAudioData;
    AudioContext.prototype.decodeAudioData = async function (bytes: ArrayBuffer) {
      // Only the exact upload armed by uploadHeld owns a race barrier. The
      // timeline also decodes audio for its waveform; those independent jobs
      // must neither consume an upload index nor remain artificially pending.
      const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), byte => byte.toString(16).padStart(2, '0')).join('');
      if (digest !== window.musicRaceExpectedDigest) return original.call(this, bytes);
      window.musicRaceExpectedDigest = null;
      let release!: (success: boolean) => void;
      const gate = new Promise<boolean>(resolve => { release = resolve; });
      const request: DecodeRequest = { ready: false, finished: false, release };
      window.musicRaceDecode.push(request);
      return original.call(this, bytes).then(async decoded => {
        request.ready = true;
        if (!await gate) throw new Error('Controlled late decode rejection');
        return decoded;
      }).finally(() => { request.finished = true; });
    };
  });
});

test.afterEach(async ({ page }, testInfo) => {
  const messages = diagnostics.get(page)!;
  await testInfo.attach('browser-console-and-api', { body: JSON.stringify(messages), contentType: 'application/json' });
  expect(messages.errors, 'Browser runtime errors').toEqual([]);
  expect(messages.warnings, 'Browser warnings').toEqual([]);
  expect(messages.apiRequests, 'Music selection, audition and local saving must stay in the browser').toEqual([]);
});

function originalWave(seconds = 40, frequency = 330) {
  const sampleRate = 8000, samples = sampleRate * seconds, bytes = Buffer.alloc(44 + samples * 2);
  bytes.write('RIFF', 0); bytes.writeUInt32LE(36 + samples * 2, 4); bytes.write('WAVE', 8);
  bytes.write('fmt ', 12); bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(sampleRate, 24); bytes.writeUInt32LE(sampleRate * 2, 28); bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34);
  bytes.write('data', 36); bytes.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i++) bytes.writeInt16LE(Math.round(Math.sin(i / sampleRate * Math.PI * 2 * frequency) * 1200), 44 + i * 2);
  return bytes;
}
const musicDialog = (page: Page) => page.getByRole('dialog', { name: '先把音乐和数拍准备好', exact: true });
const selectedFile = (page: Page) => musicDialog(page).locator('.upload-area strong');
const confirm = (page: Page) => musicDialog(page).getByRole('button', { name: '确认数拍，进入工作台', exact: true });
const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

async function ready(page: Page) {
  await page.goto('/');
  await expect(page.getByRole('button', { name: '播放', exact: true })).toBeEnabled();
  // Match the normal activation used by the shared stage/preview harness;
  // preserve the strict real-media readiness prerequisite and every assertion.
  await page.locator('.project-title h1').click();
  await expect.poll(() => page.locator('audio').evaluate((audio: HTMLAudioElement) => audio.readyState)).toBeGreaterThanOrEqual(2);
}
async function openMusic(page: Page) {
  await clickRevealed(page, page.getByRole('button', { name: '导入音乐', exact: true, includeHidden: true }));
  await expect(musicDialog(page)).toBeVisible();
}
async function uploadHeld(page: Page, name: string, bytes: Buffer, index = 0) {
  await page.evaluate(digest => { window.musicRaceExpectedDigest = digest; }, hash(bytes));
  await musicDialog(page).getByLabel('上传音乐文件', { exact: true }).setInputFiles({ name, mimeType: 'audio/wav', buffer: bytes });
  await expect.poll(() => page.evaluate(i => window.musicRaceDecode[i]?.ready ?? false, index)).toBe(true);
  await expect(selectedFile(page)).toHaveText('正在解码音频…');
}
async function releaseDecode(page: Page, index: number, success = true) {
  await page.evaluate(({ index, success }) => window.musicRaceDecode[index].release(success), { index, success });
  await expect.poll(() => page.evaluate(i => window.musicRaceDecode[i].finished, index)).toBe(true);
}
async function currentAudioHash(page: Page) {
  return page.locator('audio').evaluate(async (audio: HTMLAudioElement) => {
    const bytes = await (await fetch(audio.src)).arrayBuffer();
    return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), value => value.toString(16).padStart(2, '0')).join('');
  });
}
async function persistedMusic(page: Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('choreo-studio-preview', 2);
      request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
    });
    const record = await new Promise<{ audioName: string; audio: Blob; project: { audioDuration: number } }>((resolve, reject) => {
      const tx = db.transaction(['sceneMeta', 'scenes'], 'readonly');
      const marker = tx.objectStore('sceneMeta').get('currentSceneId');
      marker.onsuccess = () => {
        const scene = tx.objectStore('scenes').get(marker.result);
        scene.onsuccess = () => resolve(scene.result); scene.onerror = () => reject(scene.error);
      };
      marker.onerror = () => reject(marker.error);
    });
    db.close();
    const bytes = await record.audio.arrayBuffer();
    const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), value => value.toString(16).padStart(2, '0')).join('');
    return { name: record.audioName, duration: record.project.audioDuration, hash: digest, size: bytes.byteLength };
  });
}
async function confirmAndVerify(page: Page, name: string, expectedHash: string, duration: number) {
  await expect(confirm(page)).toBeEnabled();
  await confirm(page).click();
  await expect(musicDialog(page)).toHaveCount(0);
  await expect(page.locator('.kf-audio-name, .music-file strong').filter({ visible: true })).toHaveText(name);
  const downloading = page.waitForEvent('download');
  await clickRevealed(page, page.getByRole('button', { name: '下载项目备份', exact: true, includeHidden: true }));
  const path = await (await downloading).path();
  expect(path).toBeTruthy();
  const exported = JSON.parse(await readFile(path!, 'utf8'));
  if (exported.format === 'choreo-scene-backup-2') exported.scene = unpackScene(exported.scene);
  await closeDisclosures(page, '.studio-more, .studio-more .backup-menu');
  expect(exported.scene.audioName).toBe(name);
  expect(exported.scene.project.audioDuration).toBe(duration);
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.locator('.save-state')).toHaveText('已保存到本机');
  const saved = await persistedMusic(page);
  expect(saved.name).toBe(name); expect(saved.duration).toBe(duration); expect(saved.hash).toBe(expectedHash);
  expect(await currentAudioHash(page)).toBe(expectedHash);
}

test('late uploaded music cannot replace a newer original rhythm selection', async ({ page }) => {
  await ready(page);
  const demoHash = await currentAudioHash(page);
  await openMusic(page);
  await uploadHeld(page, 'slow-original-selection.wav', originalWave());
  await musicDialog(page).getByRole('button', { name: '使用原创节奏示例', exact: true }).click();
  await releaseDecode(page, 0);
  await expect(selectedFile(page)).toHaveText('八拍节奏示例.wav');
  await expect(musicDialog(page).getByRole('alert')).toHaveCount(0);
  await confirmAndVerify(page, '八拍节奏示例.wav', demoHash, 40);
});

test('closing and reopening music keeps a newer pending decode owned by the new draft', async ({ page }) => {
  await ready(page); await openMusic(page);
  await uploadHeld(page, 'closed-old-selection.wav', originalWave());
  await musicDialog(page).getByRole('button', { name: '关闭音乐设置', exact: true }).click();
  await expect(musicDialog(page)).toHaveCount(0);
  await openMusic(page);
  await expect(musicDialog(page).getByLabel('上传音乐文件', { exact: true })).toBeEnabled();
  const newest = originalWave(44, 550);
  await uploadHeld(page, 'newest-reopened-selection.wav', newest, 1);
  await releaseDecode(page, 0);
  // A stale finally block must not enable confirmation while request 1 still
  // owns the current draft. A stale successful result must not change its file.
  await expect(selectedFile(page)).toHaveText('正在解码音频…');
  await expect(confirm(page)).toBeDisabled();
  await expect(musicDialog(page).getByRole('alert')).toHaveCount(0);
  await releaseDecode(page, 1);
  await expect(selectedFile(page)).toHaveText('newest-reopened-selection.wav');
  await confirmAndVerify(page, 'newest-reopened-selection.wav', hash(newest), 44);
  expect((await persistedMusic(page)).size).toBe(newest.byteLength);
});

test('Escape closes music and a late decode failure cannot poison the reopened draft', async ({ page }) => {
  await ready(page);
  const demoHash = await currentAudioHash(page);
  await openMusic(page);
  await uploadHeld(page, 'cancelled-failing-selection.wav', originalWave());
  await musicDialog(page).press('Escape');
  await expect(musicDialog(page)).toHaveCount(0);
  await openMusic(page);
  await releaseDecode(page, 0, false);
  await expect(selectedFile(page)).toHaveText('八拍节奏示例.wav');
  await expect(musicDialog(page).getByRole('alert')).toHaveCount(0);
  await confirmAndVerify(page, '八拍节奏示例.wav', demoHash, 40);
});

async function holdAuditionPlay(page: Page) {
  await page.addInitScript(() => {
    window.musicRacePlay = [];
    const original = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function () {
      if (this.isConnected) return original.call(this);
      let release!: (success: boolean) => void;
      const gate = new Promise<boolean>(resolve => { release = resolve; });
      const request: PlayRequest = { audio: this, ready: false, finished: false, release };
      window.musicRacePlay.push(request);
      // The real media begins playing; hold the browser's successful play
      // fulfillment so close must own and pause it before await can complete.
      return original.call(this).then(async () => {
        request.ready = true;
        if (!await gate) throw new Error('Controlled late audition rejection');
      }).finally(() => { request.finished = true; });
    };
  });
}
for (const success of [true, false]) {
  test(`a pending audition ${success ? 'success' : 'failure'} cannot start or change a reopened music dialog`, async ({ page }) => {
    await holdAuditionPlay(page); await ready(page);
    const demoHash = await currentAudioHash(page);
    await openMusic(page);
    await musicDialog(page).getByRole('button', { name: '试听 1–8 数拍', exact: true }).click();
    await expect.poll(() => page.evaluate(() => window.musicRacePlay[0]?.ready ?? false)).toBe(true);
    await musicDialog(page).getByRole('button', { name: '取消', exact: true }).click();
    await expect(musicDialog(page)).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => window.musicRacePlay[0].audio.paused)).toBe(true);
    await openMusic(page);
    await page.evaluate(value => window.musicRacePlay[0].release(value), success);
    await expect.poll(() => page.evaluate(() => window.musicRacePlay[0].finished)).toBe(true);
    await expect(musicDialog(page).locator('.audition-row span.active')).toHaveCount(0);
    await expect(musicDialog(page).getByRole('alert')).toHaveCount(0);
    expect(await page.evaluate(() => window.musicRacePlay[0].audio.paused)).toBe(true);
    await confirmAndVerify(page, '八拍节奏示例.wav', demoHash, 40);
  });
}

for (const selection of [
  { relation: '0.5', start: 5, octets: 8, offset: 8.25 },
  { relation: '2', start: 3, octets: 2, offset: 16.25 },
]) {
  test(`mobile music settings preserve the confirmed start octet with relation ${selection.relation}`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await ready(page);
    const demoHash = await currentAudioHash(page);
    await openMusic(page);
    await musicDialog(page).getByRole('combobox', { name: '每个舞蹈数拍对应', exact: true }).selectOption(selection.relation);
    await musicDialog(page).getByLabel('音乐速度 BPM', { exact: true }).fill('120');
    await musicDialog(page).getByLabel('第一数拍位置（秒）', { exact: true }).fill('0.25');
    await musicDialog(page).getByLabel('从第几个八拍开始', { exact: true }).fill(String(selection.start));
    await musicDialog(page).getByLabel('选取几个完整八拍', { exact: true }).fill(String(selection.octets));
    await expect(musicDialog(page).locator('.selection-summary small')).toHaveText(`${selection.offset.toFixed(1)} – ${(selection.offset + 16).toFixed(1)} 秒`);
    await confirmAndVerify(page, '八拍节奏示例.wav', demoHash, 40);
    await openMusic(page);
    await expect(musicDialog(page).getByLabel('从第几个八拍开始', { exact: true })).toHaveValue(String(selection.start));
    await expect(musicDialog(page).getByRole('combobox', { name: '每个舞蹈数拍对应', exact: true })).toHaveValue(selection.relation);
    await expect(musicDialog(page).getByLabel('第一数拍位置（秒）', { exact: true })).toHaveValue('0.25');
    await expect(musicDialog(page).locator('.selection-summary small')).toHaveText(`${selection.offset.toFixed(1)} – ${(selection.offset + 16).toFixed(1)} 秒`);
    await confirmAndVerify(page, '八拍节奏示例.wav', demoHash, 40);
    const sourceOffset = await page.evaluate(async () => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open('choreo-studio-preview', 2);
        request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
      });
      const offset = await new Promise<number>((resolve, reject) => {
        const tx = db.transaction(['sceneMeta', 'scenes'], 'readonly');
        const marker = tx.objectStore('sceneMeta').get('currentSceneId');
        marker.onsuccess = () => {
          const scene = tx.objectStore('scenes').get(marker.result);
          scene.onsuccess = () => resolve(scene.result.project.history[scene.result.project.historyIndex].countMap.sourceOffsetSeconds);
          scene.onerror = () => reject(scene.error);
        };
        marker.onerror = () => reject(marker.error);
      });
      db.close(); return offset;
    });
    expect(sourceOffset).toBe(selection.offset);
  });
}
