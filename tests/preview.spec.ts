import { createHash } from 'node:crypto';
import { inflateSync } from 'node:zlib';
import { expect, test, type Page } from '@playwright/test';
import { clickRevealed, closeDisclosures } from './helpers';
import { backup, current, openFixture } from './realismHelpers';

function waveFixture(duration = 20): Buffer {
  const sampleRate = 8000, samples = duration * sampleRate;
  const result = Buffer.alloc(44 + samples * 2);
  result.write('RIFF', 0); result.writeUInt32LE(36 + samples * 2, 4); result.write('WAVE', 8);
  result.write('fmt ', 12); result.writeUInt32LE(16, 16); result.writeUInt16LE(1, 20);
  result.writeUInt16LE(1, 22); result.writeUInt32LE(sampleRate, 24); result.writeUInt32LE(sampleRate * 2, 28);
  result.writeUInt16LE(2, 32); result.writeUInt16LE(16, 34); result.write('data', 36); result.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i++) result.writeInt16LE(Math.round(Math.sin(i / sampleRate * Math.PI * 2 * 220) * 1800), 44 + i * 2);
  return result;
}

// Decode screenshot pixels rather than trusting the mere existence of a WebGL canvas.
function pngColors(png: Buffer): Set<string> {
  const width = png.readUInt32BE(16), height = png.readUInt32BE(20);
  const channels = png[25] === 6 ? 4 : png[25] === 2 ? 3 : 0;
  if (png[24] !== 8 || !channels || png[28] !== 0) throw new Error('Unexpected screenshot PNG format');
  const parts: Buffer[] = [];
  for (let offset = 8; offset < png.length;) {
    const length = png.readUInt32BE(offset), type = png.toString('ascii', offset + 4, offset + 8);
    if (type === 'IDAT') parts.push(png.subarray(offset + 8, offset + 8 + length));
    offset += length + 12;
  }
  const decoded = inflateSync(Buffer.concat(parts)), stride = width * channels;
  const pixels = Buffer.alloc(height * stride), colors = new Set<string>();
  const paeth = (a: number, b: number, c: number) => {
    const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
    return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
  };
  for (let y = 0; y < height; y++) {
    const filter = decoded[y * (stride + 1)];
    for (let x = 0; x < stride; x++) {
      const index = y * stride + x;
      const a = x >= channels ? pixels[index - channels] : 0;
      const b = y ? pixels[index - stride] : 0;
      const c = y && x >= channels ? pixels[index - stride - channels] : 0;
      const predictor = filter === 0 ? 0 : filter === 1 ? a : filter === 2 ? b : filter === 3 ? Math.floor((a + b) / 2) : paeth(a, b, c);
      pixels[index] = (decoded[y * (stride + 1) + x + 1] + predictor) & 255;
    }
    for (let x = 0; x < width; x += 3) {
      const i = y * stride + x * channels;
      colors.add(`${pixels[i]},${pixels[i + 1]},${pixels[i + 2]}`);
    }
  }
  return colors;
}

async function ready(page: Page) {
  await page.goto('/');
  // Give media loading an ordinary user interaction without changing the
  // scene, its initial clock or playback. The title has no editing action.
  await page.locator('.project-title h1').click();
  await expect(page.getByRole('button', { name: '播放', exact: true })).toBeEnabled();
  await expect.poll(() => page.locator('audio').evaluate((audio: HTMLAudioElement) => audio.readyState)).toBeGreaterThanOrEqual(2);
}

const timeline = (page: Page) => page.getByRole('region', { name: '手动关键帧时间线', exact: true });
const clock = (page: Page) => timeline(page).getByRole('slider', { name: '关键帧时间线进度', exact: true });

async function assertManualWorkspace(page: Page) {
  await expect(timeline(page)).toBeVisible();
  await expect(page.getByRole('group', { name: '编舞模式', exact: true, includeHidden: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /八拍编排|手动 K帧|换一个八拍|试试更简单|生成模板初稿/, includeHidden: true })).toHaveCount(0);
  await expect(page.getByRole('list', { name: '八拍时间线', exact: true, includeHidden: true })).toHaveCount(0);
}

test.beforeEach(async ({ page }, testInfo) => {
  const problems: string[] = [], consoleMessages: string[] = [];
  page.on('pageerror', error => problems.push(error.message));
  page.on('console', message => {
    const detail = `${message.text()} ${message.location().url ?? ''}`;
    if (message.type() === 'error') problems.push(detail);
    if (message.type() === 'error' || message.type() === 'warning') consoleMessages.push(`${message.type()}: ${detail}`);
  });
  page.on('dialog', dialog => { void (dialog.type() === 'beforeunload' ? dialog.accept() : dialog.dismiss()); });
  testInfo.annotations.push({ type: 'browser-check', description: 'Chromium smoke checks do not establish real-device audio/video synchronization or production rendering performance.' });
  (page as Page & { diagnostics?: () => Promise<void> }).diagnostics = async () => {
    await testInfo.attach('browser-console', { body: consoleMessages.join('\n') || 'No console errors or warnings.', contentType: 'text/plain' });
    expect(problems, 'Browser runtime errors').toEqual([]);
  };
});

test.afterEach(async ({ page }) => {
  await (page as Page & { diagnostics: () => Promise<void> }).diagnostics();
});

test('renders a nonblank 3D pose and advances audio time during playback', async ({ page }) => {
  await openFixture(page, false, source => {
    source.take.poses.forEach((pose, index) => { pose.root[0] = source.take.times[index] / 20; });
  });
  const canvas = page.getByRole('img', { name: '人体编舞动作预览' });
  await expect(canvas).toBeVisible();
  const initialFrame = await canvas.screenshot();
  expect(pngColors(initialFrame).size, 'Rendered canvas should contain varied scene pixels').toBeGreaterThan(100);
  await page.screenshot({ path: '/tmp/choreo-desktop.png', fullPage: true });
  await page.getByRole('button', { name: '播放', exact: true }).click();
  await expect(page.getByRole('button', { name: '暂停', exact: true })).toBeVisible();
  await expect.poll(() => page.locator('audio').evaluate((audio: HTMLAudioElement) => audio.currentTime)).toBeGreaterThan(1);
  // The source timeline stores exact seconds, including nonuniform imported
  // timestamps; playback must advance the actual scene clock beside the audio.
  await expect.poll(() => page.getByRole('slider', { name: '关键帧时间线进度', exact: true }).inputValue().then(Number)).toBeGreaterThan(1);
  await page.getByRole('button', { name: '暂停', exact: true }).click();
  const movingFrame = await canvas.screenshot();
  expect(movingFrame.equals(initialFrame), 'Displayed pose should respond to playback time').toBe(false);
  const paused = Number(await page.getByRole('slider', { name: '关键帧时间线进度', exact: true }).inputValue());
  await page.waitForTimeout(250);
  expect(Number(await page.getByRole('slider', { name: '关键帧时间线进度', exact: true }).inputValue())).toBe(paused);
});

test('the default workspace exposes manual editing directly without the removed arranging controls', async ({ page }) => {
  await ready(page);
  await assertManualWorkspace(page);
  await clickRevealed(page, page.getByRole('button', { name: '导入音乐', exact: true, includeHidden: true }));
  await page.getByRole('dialog', { name: '先把音乐和数拍准备好', exact: true }).press('Escape');
  await assertManualWorkspace(page);
  const baseline = await backup(page);
  expect(current(baseline).take).toBeTruthy();
  expect(current(baseline).plan).toBeNull();
  expect(current(baseline).manual!.pointEdits ?? []).toEqual([]);
});

test('teaching preview keeps the manual Timeline and exact choreography accessible', async ({ page }) => {
  await openFixture(page);
  const before = await backup(page);
  await clickRevealed(page, page.getByRole('button', { name: '教学预览', exact: true, includeHidden: true }));
  await assertManualWorkspace(page);
  expect((await backup(page)).scene.project).toEqual(before.scene.project);
  await clickRevealed(page, page.getByRole('button', { name: '返回手动编辑', exact: true, includeHidden: true }));
  await assertManualWorkspace(page);
  expect((await backup(page)).scene.project).toEqual(before.scene.project);
});

test('uploads original fixture audio and restores saved project and identical audio bytes', async ({ page }) => {
  await ready(page);
  const wave = waveFixture();
  const expectedHash = createHash('sha256').update(wave).digest('hex');
  await clickRevealed(page, page.getByRole('button', { name: '导入音乐', exact: true, includeHidden: true }));
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('作品名称').fill('保存恢复测试组合');
  await dialog.getByLabel('上传音乐文件').setInputFiles({ name: 'original-fixture.wav', mimeType: 'audio/wav', buffer: wave });
  await expect(dialog).toContainText('20.0 秒可用音频');
  await dialog.getByLabel('选取几个完整八拍').fill('4');
  await dialog.getByLabel('第一数拍位置（秒）').fill('2');
  await dialog.getByRole('button', { name: '确认数拍，进入工作台' }).click();
  await assertManualWorkspace(page);
  await expect(page.getByRole('button', { name: '播放', exact: true })).toBeEnabled();
  const prepared = await backup(page);
  expect(current(prepared).countMap.durationSeconds).toBe(16);
  expect(current(prepared).plan).toBeNull();
  expect(current(prepared).manual!.pointEdits ?? []).toEqual([]);
  expect(current(prepared).take!.poses.every(pose => JSON.stringify(pose) === JSON.stringify(current(prepared).take!.poses[0]))).toBe(true);
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.locator('.save-state')).toHaveText('已保存到本机');
  await page.reload();
  await expect(page.locator('.project-title')).toContainText('保存恢复测试组合');
  await expect(page.locator('.kf-audio-name')).toHaveText('original-fixture.wav');
  await expect(page.locator('.save-state')).toHaveText('已保存到本机');
  await assertManualWorkspace(page);
  expect((await backup(page)).scene.project).toEqual(prepared.scene.project);
  const restoredHash = await page.locator('audio').evaluate(async (audio: HTMLAudioElement) => {
    const bytes = await (await fetch(audio.src)).arrayBuffer();
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
  });
  expect(restoredHash).toBe(expectedHash);
  await page.getByRole('button', { name: '播放', exact: true }).click();
  await expect.poll(() => page.locator('audio').evaluate((audio: HTMLAudioElement) => audio.currentTime)).toBeGreaterThan(2.2);
  await expect.poll(() => clock(page).inputValue().then(Number)).toBeGreaterThan(0.2);
  const sourceTime = await page.locator('audio').evaluate((audio: HTMLAudioElement) => audio.currentTime);
  const relativeTime = Number(await clock(page).inputValue());
  expect(sourceTime - relativeTime, 'Restored music selection must retain its two-second source offset').toBeGreaterThan(1.8);
  expect(sourceTime - relativeTime).toBeLessThan(2.5);
});

test('rejects invalid count ranges and starts an editable neutral take when CountMap changes', async ({ page }) => {
  await ready(page);
  await closeDisclosures(page, '.studio-more');
  // The compact studio exposes the same music/count settings through More.
  await clickRevealed(page, page.getByRole('button', { name: '导入音乐', exact: true, includeHidden: true }));
  const dialog = page.getByRole('dialog'), confirm = dialog.getByRole('button', { name: '确认数拍，进入工作台' });
  await dialog.getByLabel('选取几个完整八拍').fill('3');
  await expect(confirm).toBeDisabled();
  await expect(dialog.getByRole('alert')).toContainText('16–60 秒');
  await dialog.getByLabel('选取几个完整八拍').fill('8');
  await dialog.getByLabel('从第几个八拍开始').fill('4');
  await expect(confirm).toBeDisabled();
  await expect(dialog.getByRole('alert')).toContainText('音频');
  await dialog.getByLabel('从第几个八拍开始').fill('1');
  await dialog.getByLabel('选取几个完整八拍').fill('4.5');
  await expect(confirm).toBeDisabled();
  await expect(dialog.getByRole('alert')).toContainText('完整八拍');
  await dialog.getByLabel('选取几个完整八拍').fill('4');
  await dialog.getByLabel('音乐速度 BPM').fill('100');
  await expect(confirm).toBeEnabled();
  await confirm.click();
  await expect(page.getByRole('button', { name: '播放', exact: true })).toBeEnabled();
  await expect(page.getByRole('button', { name: '撤销', exact: true })).toBeDisabled();
  await assertManualWorkspace(page);
  const rebuilt = current(await backup(page));
  expect(rebuilt.countMap.bpm).toBe(100);
  expect(rebuilt.countMap.octetCount).toBe(4);
  expect(rebuilt.take!.durationSeconds).toBe(19.2);
  expect(rebuilt.plan).toBeNull();
  expect(rebuilt.manual!.pointEdits ?? []).toEqual([]);
  expect(rebuilt.take!.poses.every(pose => JSON.stringify(pose) === JSON.stringify(rebuilt.take!.poses[0]))).toBe(true);
});

for (const width of [390, 320]) {
  test(`fits a ${width}px screen without page or music-dialog horizontal overflow`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await ready(page);
    if (width === 390) await page.screenshot({ path: '/tmp/choreo-mobile.png', fullPage: true });
    const overflow = () => page.evaluate(() => ({ width: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }));
    const body = await overflow();
    expect(body.scroll).toBeLessThanOrEqual(body.width);
    await expect(page.getByRole('img', { name: '人体编舞动作预览' })).toBeVisible();
    await clickRevealed(page, page.getByRole('button', { name: '导入音乐', exact: true, includeHidden: true }));
    await expect(page.getByRole('dialog')).toBeVisible();
    const modal = await overflow();
    expect(modal.scroll).toBeLessThanOrEqual(modal.width);
  });
}
