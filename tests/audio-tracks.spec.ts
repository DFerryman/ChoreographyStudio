import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import { clickRevealed, closeDisclosures } from './helpers';
import { backup, current, diagnostics, hiddenButton, ready, save } from './realismHelpers';

declare global { interface Window { trackPlays: string[] } }

const reports = new WeakMap<Page, ReturnType<typeof diagnostics>>();
test.beforeEach(async ({ page }) => {
  reports.set(page, diagnostics(page));
  await page.route('**/api/**', route => route.abort('blockedbyclient'));
  // Record play() on detached track elements; the primary <audio> lives in the DOM.
  await page.addInitScript(() => {
    window.trackPlays = [];
    const play = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function () {
      if (!this.isConnected) window.trackPlays.push(this.src);
      return play.call(this);
    };
  });
});
test.afterEach(async ({ page }, info) => {
  const report = reports.get(page)!;
  await info.attach('browser-console-and-api', { body: JSON.stringify(report), contentType: 'application/json' });
  expect(report).toEqual({ errors: [], warnings: [], expectedHttpErrors: [], apiRequests: [] });
});

function wave(seconds: number, frequency: number) {
  const rate = 8000, samples = Math.round(rate * seconds), bytes = Buffer.alloc(44 + samples * 2);
  bytes.write('RIFF', 0); bytes.writeUInt32LE(36 + samples * 2, 4); bytes.write('WAVE', 8);
  bytes.write('fmt ', 12); bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(rate, 24); bytes.writeUInt32LE(rate * 2, 28); bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34);
  bytes.write('data', 36); bytes.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i++) bytes.writeInt16LE(Math.round(Math.sin(i / rate * Math.PI * 2 * frequency) * 1500), 44 + i * 2);
  return bytes;
}
const timeline = (page: Page) => page.getByRole('region', { name: '场景时间线', exact: true });
const lanes = (page: Page) => timeline(page).locator('.tl-extra-audio');
const clip = (page: Page, number: number) => timeline(page).getByRole('button', { name: `移动音轨 ${number} 片段`, exact: true });

async function addTrack(page: Page, name: string, bytes: Buffer, count: number) {
  await timeline(page).getByLabel('选择音轨音频文件', { exact: true }).setInputFiles({ name, mimeType: 'audio/wav', buffer: bytes });
  await expect(lanes(page)).toHaveCount(count);
}

for (const width of [1440, 390]) {
  test(`@audiotracks ${width}px imports several audio files onto separate tracks that move, mute, play, save and back up`, async ({ page }) => {
    test.setTimeout(150_000);
    await page.setViewportSize({ width, height: width === 1440 ? 1000 : 844 });
    await page.goto('/'); await ready(page);
    const before = current(await backup(page));
    expect(before).not.toHaveProperty('audioTracks');

    await addTrack(page, 'beat.wav', wave(5, 330), 1);
    await addTrack(page, 'voice.wav', wave(3, 550), 2);
    await expect(clip(page, 2)).toContainText('beat.wav');
    await expect(clip(page, 3)).toContainText('voice.wav');
    let snapshot = current(await backup(page));
    expect(snapshot.audioTracks!.map(track => [track.name, track.offsetSeconds])).toEqual([['beat.wav', 0], ['voice.wav', 0]]);
    expect(snapshot.audioTracks![0].durationSeconds).toBeCloseTo(5, 2);
    // Adding tracks never changes the CountMap, the primary music placement or motion.
    expect(snapshot.countMap).toEqual(before.countMap);
    expect(snapshot.take).toEqual(before.take);

    // Each clip moves independently on its own track; undo restores it.
    const box = (await clip(page, 3).boundingBox())!;
    await page.mouse.move(box.x + 6, box.y + box.height / 2); await page.mouse.down();
    await page.mouse.move(box.x + 86, box.y + box.height / 2, { steps: 8 }); await page.mouse.up();
    await expect.poll(async () => Number(await clip(page, 3).getAttribute('data-offset-seconds'))).toBeGreaterThan(0);
    await expect(clip(page, 2)).toHaveAttribute('data-offset-seconds', '0');
    const moved = Number(await clip(page, 3).getAttribute('data-offset-seconds'));
    expect(Math.abs(moved * 30 - Math.round(moved * 30))).toBeLessThan(1e-9);
    await page.getByRole('button', { name: '撤销', exact: true }).click();
    await expect(clip(page, 3)).toHaveAttribute('data-offset-seconds', '0');
    await page.getByRole('button', { name: '重做', exact: true }).click();
    await expect(clip(page, 3)).toHaveAttribute('data-offset-seconds', String(moved));

    await timeline(page).getByRole('button', { name: '静音音轨 3', exact: true }).click();
    await expect(timeline(page).getByRole('button', { name: '取消静音音轨 3', exact: true })).toHaveAttribute('aria-pressed', 'true');

    // Playback starts the unmuted track alongside the primary music.
    await page.getByRole('button', { name: '播放', exact: true }).click();
    await expect(page.getByRole('button', { name: '暂停', exact: true })).toBeVisible();
    await expect.poll(() => page.evaluate(() => window.trackPlays.length)).toBeGreaterThan(0);
    await page.getByRole('button', { name: '暂停', exact: true }).click();
    await expect(page.getByRole('button', { name: '播放', exact: true })).toBeVisible();

    // Placements, mute state and exact clip bytes survive save and reload.
    await save(page);
    await page.reload(); await ready(page);
    await expect(lanes(page)).toHaveCount(2);
    await expect(clip(page, 2)).toBeEnabled();
    await expect(clip(page, 3)).toHaveAttribute('data-offset-seconds', String(moved));
    await expect(timeline(page).getByRole('button', { name: '取消静音音轨 3', exact: true })).toBeVisible();
    snapshot = current(await backup(page));
    expect(snapshot.audioTracks).toEqual([
      expect.objectContaining({ name: 'beat.wav', offsetSeconds: 0 }),
      expect.objectContaining({ name: 'voice.wav', offsetSeconds: moved, muted: true }),
    ]);

    // The complete scene package carries both clips after the original music.
    const downloading = page.waitForEvent('download');
    await clickRevealed(page, hiddenButton(page, '下载完整场景包'));
    const bytes = await readFile((await (await downloading).path())!);
    const magic = 'CHOREO-BUNDLE-1\n'.length, length = bytes.readUInt32LE(magic);
    const header = JSON.parse(bytes.subarray(magic + 4, magic + 4 + length).toString('utf8'));
    expect(header.format).toBe('choreo-scene-bundle-3');
    expect(header.audioTracks.map((item: { byteLength: number }) => item.byteLength)).toEqual([wave(5, 330).length, wave(3, 550).length]);
    expect(bytes.length).toBe(magic + 4 + length + header.audio.byteLength + wave(5, 330).length + wave(3, 550).length);
    await closeDisclosures(page, '.studio-more, .studio-more .backup-menu');

    // Selecting a track offers delete; deleting is one undoable step.
    await timeline(page).getByRole('button', { name: '选择音轨 2', exact: true }).click();
    await page.getByRole('button', { name: '删除所选音轨', exact: true }).click();
    await expect(lanes(page)).toHaveCount(1);
    await expect(clip(page, 2)).toContainText('voice.wav');
    await page.getByRole('button', { name: '撤销', exact: true }).click();
    await expect(lanes(page)).toHaveCount(2);
  });
}
