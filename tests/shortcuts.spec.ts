import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import { clickRevealed, closeDisclosures } from './helpers';
import { bakePlan, createNeutralTake, makeCountMap, makePlan } from '../packages/core/src';
import { unpackScene } from '../apps/web/src/compactScene';
import { openFixture, ready as waitForReady } from './realismHelpers';

test.setTimeout(120_000);

type Snapshot = {
  countMap: { durationSeconds: number; sourceOffsetSeconds: number };
  take: { id: string; times: number[]; poses: unknown[] };
  manual?: unknown;
  cameraTrack?: { keys: { time: number }[] };
};
type Backup = {
  scene: {
    project: { revision: number; historyIndex: number; history: Snapshot[] };
    viewer: { time: number; camera: unknown };
  };
};
const current = (backup: Backup) => backup.scene.project.history[backup.scene.project.historyIndex];
const frameInput = (page: Page) => page.getByRole('spinbutton', { name: '当前帧', exact: true });
const timeline = (page: Page) => page.getByRole('region', { name: '场景时间线', exact: true });
const rangeReadout = (page: Page) => page.getByLabel('当前选区', { exact: true });
const diagnostics = new WeakMap<Page, { errors: string[]; warnings: string[]; apiRequests: string[] }>();
type PlaybackRequest = { ready: boolean; settled: boolean; release: (success: boolean) => void };
declare global {
  interface Window {
    shortcutPlayback: { hold: 'resume' | 'play' | null; resumes: PlaybackRequest[]; plays: PlaybackRequest[] };
  }
}

test.beforeEach(async ({ page }) => {
  const report = { errors: [] as string[], warnings: [] as string[], apiRequests: [] as string[] };
  diagnostics.set(page, report);
  page.on('pageerror', error => report.errors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error') report.errors.push(message.text());
    if (message.type() === 'warning') report.warnings.push(message.text());
  });
  page.on('request', request => {
    if (new URL(request.url()).pathname.startsWith('/api/')) report.apiRequests.push(request.url());
  });
  page.on('dialog', dialog => { void (dialog.type() === 'beforeunload' ? dialog.accept() : dialog.dismiss()); });
});

test.afterEach(async ({ page }, testInfo) => {
  const report = diagnostics.get(page)!;
  await testInfo.attach('browser-console-and-api', { body: JSON.stringify(report), contentType: 'application/json' });
  expect(report.errors, 'Manual shortcuts have no browser runtime errors').toEqual([]);
  expect(report.warnings, 'Manual shortcuts have no browser warnings').toEqual([]);
  expect(report.apiRequests, 'Manual shortcuts stay in the browser').toEqual([]);
});

async function ready(page: Page) {
  await page.goto('/');
  await waitForReady(page);
  await expect(timeline(page)).toBeVisible();
  await expect(page.getByRole('button', { name: /^(添加|更新)关键帧$|旋转工具|移动角色工具/, includeHidden: true })).toHaveCount(0);
}

async function backup(page: Page): Promise<Backup> {
  const download = page.getByRole('button', { name: '下载项目备份', exact: true, includeHidden: true });
  const downloading = page.waitForEvent('download');
  await clickRevealed(page, download);
  const path = await (await downloading).path();
  expect(path).toBeTruthy();
  const wire = JSON.parse(await readFile(path!, 'utf8'));
  const document = { ...wire, scene: wire.format === 'choreo-scene-backup-2' ? unpackScene(wire.scene) : wire.scene } as Backup;
  await closeDisclosures(page, '.studio-more, .studio-more .backup-menu');
  return document;
}

async function stageFocus(page: Page) {
  const stage = page.getByRole('region', { name: '3D 动画舞台', exact: true });
  await stage.focus();
  await expect(stage).toBeFocused();
}

async function key(page: Page, shortcut: string) {
  await stageFocus(page);
  await page.keyboard.press(shortcut);
}

async function frame(page: Page, value: number) {
  await frameInput(page).fill(String(value));
  await expect(frameInput(page)).toHaveValue(String(value));
  await expect(timeline(page)).toHaveAttribute('data-frame', String(value));
}

/** Record the current view on the Camera track; the track stays selected. */
async function cameraKey(page: Page) {
  await page.getByRole('button', { name: '在当前时间记录镜头', exact: true }).click();
  await expect(timeline(page).locator('.tl-lane[data-track-id="camera"]')).toHaveClass(/selected/);
}

async function controlledPlayback(page: Page) {
  await page.addInitScript(() => {
    window.shortcutPlayback = { hold: null, resumes: [], plays: [] };
    function hold(result: Promise<void>, list: PlaybackRequest[]): Promise<void> {
      let release!: (success: boolean) => void;
      const gate = new Promise<boolean>(resolve => { release = resolve; });
      const request: PlaybackRequest = { ready: false, settled: false, release };
      list.push(request);
      return result.then(async () => {
        request.ready = true;
        if (!await gate) throw new Error('Controlled obsolete playback rejection');
      }).finally(() => { request.settled = true; });
    }
    const resume = AudioContext.prototype.resume;
    AudioContext.prototype.resume = function () {
      const result = resume.call(this);
      return window.shortcutPlayback.hold === 'resume' ? hold(result, window.shortcutPlayback.resumes) : result;
    };
    const play = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function () {
      const result = play.call(this);
      return window.shortcutPlayback.hold === 'play' ? hold(result, window.shortcutPlayback.plays) : result;
    };
  });
}

async function held(page: Page, kind: 'resumes' | 'plays', index: number) {
  await expect.poll(() => page.evaluate(({ kind, index }) => window.shortcutPlayback[kind][index]?.ready ?? false, { kind, index })).toBe(true);
}

async function release(page: Page, kind: 'resumes' | 'plays', index: number, success = true) {
  await page.evaluate(({ kind, index, success }) => window.shortcutPlayback[kind][index].release(success), { kind, index, success });
  await expect.poll(() => page.evaluate(({ kind, index }) => window.shortcutPlayback[kind][index].settled, { kind, index })).toBe(true);
}

async function expectPaused(page: Page) {
  await expect(page.getByRole('button', { name: '播放', exact: true })).toBeVisible();
  await expect.poll(() => page.locator('audio').evaluate((audio: HTMLAudioElement) => audio.paused)).toBe(true);
}

async function expectNoPlaybackError(page: Page) {
  await expect(page.getByRole('status').filter({ hasText: '音频尚未就绪' })).toHaveCount(0);
}

test('@shortcuts frame arrows preserve the exact non-uniform final interval and leave focused numeric inputs alone', async ({ page }) => {
  await openFixture(page, false, source => {
    const countMap = makeCountMap({ bpm: 117, musicBeatsPerDanceCount: 1, firstCountSourceSeconds: 1, octetCount: 4, audioDurationSeconds: 20 });
    const plan = makePlan(countMap), take = createNeutralTake(bakePlan(plan, countMap));
    source.take = take;
    Object.assign(source.scene.project.history[0], { countMap, plan, take });
  });
  await expect(frameInput(page)).toBeVisible();
  const baseline = await backup(page);
  const duration = current(baseline).countMap.durationSeconds;
  const end = Math.ceil(duration * 30);
  expect(duration * 30).not.toBe(end);

  await key(page, 'ArrowLeft'); await expect(frameInput(page)).toHaveValue('0');
  await key(page, 'ArrowRight'); await expect(frameInput(page)).toHaveValue('1');
  await stageFocus(page);
  await page.keyboard.down('ArrowRight'); await expect(frameInput(page)).toHaveValue('2');
  await page.keyboard.down('ArrowRight'); await expect(frameInput(page)).toHaveValue('3');
  await page.keyboard.up('ArrowRight');

  // A focused numeric field keeps its native keys; no global shortcut fires.
  await frameInput(page).focus(); await frameInput(page).press('ArrowLeft'); await frameInput(page).press('i'); await frameInput(page).press('Space');
  await expect(page.getByRole('button', { name: '播放', exact: true })).toBeVisible();
  await expect(rangeReadout(page)).toHaveText('未选区');

  await frame(page, end - 1);
  await key(page, 'ArrowRight'); await expect(frameInput(page)).toHaveValue(String(end));
  expect(Number(await timeline(page).getAttribute('data-time'))).toBeCloseTo(duration, 6);
  const atEnd = await backup(page);
  expect(atEnd.scene.viewer.time).toBe(duration);
  expect(atEnd.scene.project).toEqual(baseline.scene.project);
  await key(page, 'ArrowRight'); await expect(frameInput(page)).toHaveValue(String(end));
  await key(page, 'ArrowLeft'); await expect(frameInput(page)).toHaveValue(String(end - 1));
  expect(Number(await timeline(page).getAttribute('data-time'))).toBeCloseTo((end - 1) / 30, 6);
});

test('@shortcuts beat, edge and range keys navigate without changing the scene', async ({ page }) => {
  await ready(page);
  const baseline = await backup(page);
  const duration = current(baseline).countMap.durationSeconds, end = Math.ceil(duration * 30);
  // The demo rhythm is 120 BPM: one dance count every 0.5 s (15 frames).
  await frame(page, 7);
  await key(page, 'Shift+ArrowRight'); await expect(frameInput(page)).toHaveValue('15');
  await key(page, 'Shift+ArrowRight'); await expect(frameInput(page)).toHaveValue('30');
  await key(page, 'Shift+ArrowLeft'); await expect(frameInput(page)).toHaveValue('15');
  await key(page, 'i'); await expect(rangeReadout(page)).toHaveText(`0.5s–${duration}s · ${duration - .5}s`);
  await frame(page, 120);
  await key(page, 'o'); await expect(rangeReadout(page)).toHaveText('0.5s–4s · 3.5s');
  await expect(timeline(page).locator('[data-track-id="counts"] .tl-lane-track')).toHaveAttribute('data-range-start', '0.5');
  // Home/End visit the range edges first, then the scene edges.
  await key(page, 'Home'); await expect(frameInput(page)).toHaveValue('15');
  await key(page, 'Home'); await expect(frameInput(page)).toHaveValue('0');
  await key(page, 'End'); await expect(frameInput(page)).toHaveValue('120');
  await key(page, 'End'); await expect(frameInput(page)).toHaveValue(String(end));
  await key(page, 'Escape'); await expect(rangeReadout(page)).toHaveText('未选区');
  const after = await backup(page);
  expect(after.scene.project).toEqual(baseline.scene.project);
});

test('@shortcuts camera keys: Delete removes the selected key, K stays inert and keyboard history restores it exactly', async ({ page }) => {
  await ready(page); await frame(page, 120);
  const baseline = await backup(page);
  await key(page, 'k');
  expect((await backup(page)).scene.project).toEqual(baseline.scene.project);
  await cameraKey(page);
  const authored = current(await backup(page));
  expect(authored.cameraTrack!.keys.map(item => item.time)).toEqual([4]);
  expect(authored.take).toEqual(current(baseline).take);
  expect(authored.manual).toEqual(current(baseline).manual);

  await key(page, 'Delete');
  const deleted = current(await backup(page));
  expect(deleted.cameraTrack).toBeUndefined();
  await key(page, 'Control+z'); expect(current(await backup(page))).toEqual(authored);
  await key(page, 'Control+Shift+z'); expect(current(await backup(page))).toEqual(deleted);
  await key(page, 'Control+z'); expect(current(await backup(page))).toEqual(authored);
  await key(page, 'Control+y'); expect(current(await backup(page))).toEqual(deleted);
  await key(page, 'Meta+z'); expect(current(await backup(page))).toEqual(authored);
  await key(page, 'Meta+Shift+z'); expect(current(await backup(page))).toEqual(deleted);
  await key(page, 'Meta+z'); expect(current(await backup(page))).toEqual(authored);

  // Without a key at the current time, Delete and K change nothing.
  await frame(page, 121);
  const beforeMark = await backup(page);
  await key(page, 'k'); await key(page, 'Delete');
  expect((await backup(page)).scene.project).toEqual(beforeMark.scene.project);
  // Leaving camera record mode makes Delete inert even on a key.
  await frame(page, 120);
  await timeline(page).getByRole('button', { name: '结束镜头录制', exact: true }).click();
  await key(page, 'Delete');
  expect((await backup(page)).scene.project).toEqual(beforeMark.scene.project);
});

test('@shortcuts recorded camera edits allow immediate seeking and playback while open dialogs suspend editing keys', async ({ page }) => {
  await ready(page); await frame(page, 120); await cameraKey(page);
  const recorded = await backup(page);
  await key(page, 'ArrowRight'); await expect(frameInput(page)).toHaveValue('121');
  await page.getByRole('button', { name: '场景', exact: true }).click();
  const modal = page.getByRole('dialog', { name: '本机场景', exact: true });
  await expect(modal).toBeVisible();
  for (const shortcut of ['k', 'Delete', 'Control+z', 'ArrowLeft', 'i']) await page.keyboard.press(shortcut);
  // A real Space on a focused dialog button retains its native action. This
  // synthetic stage event checks that the modal also suspends global Space.
  await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', code: 'Space', bubbles: true, cancelable: true })));
  await expect(modal).toBeVisible(); await expect(frameInput(page)).toHaveValue('121');
  await expect(rangeReadout(page)).toHaveText('未选区');
  await page.keyboard.press('Escape'); await expect(modal).toHaveCount(0);
  expect((await backup(page)).scene.project).toEqual(recorded.scene.project);
  await key(page, 'Space');
  await expect(page.getByRole('button', { name: '暂停', exact: true })).toBeVisible();
  await key(page, 'Space'); await expect(page.getByRole('button', { name: '播放', exact: true })).toBeVisible();
  expect((await backup(page)).scene.project).toEqual(recorded.scene.project);
});

test('@shortcuts composition, modified keys, repeated writes and native focused controls never trigger stage edits', async ({ page }) => {
  await ready(page); await frame(page, 120); await cameraKey(page);
  const baseline = await backup(page);
  await stageFocus(page);
  await page.evaluate(() => {
    const events: KeyboardEventInit[] = [
      { key: 'k', repeat: true }, { key: 'Delete', repeat: true }, { key: ' ', code: 'Space', repeat: true },
      { key: 'z', ctrlKey: true, repeat: true }, { key: 'k', isComposing: true }, { key: 'i', isComposing: true },
      { key: 'ArrowRight', altKey: true }, { key: 'ArrowRight', ctrlKey: true }, { key: 'k', metaKey: true }, { key: 'o', ctrlKey: true },
    ];
    for (const options of events) window.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...options }));
    const prevented = new KeyboardEvent('keydown', { key: 'Delete', bubbles: true, cancelable: true });
    prevented.preventDefault(); window.dispatchEvent(prevented);
  });
  await expect(frameInput(page)).toHaveValue('120');
  await expect(page.getByRole('button', { name: '播放', exact: true })).toBeVisible();
  await expect(rangeReadout(page)).toHaveText('未选区');

  await page.evaluate(() => {
    const editable = document.createElement('div');
    editable.id = 'shortcut-contenteditable'; editable.contentEditable = 'true';
    editable.textContent = 'Native text'; document.body.append(editable); editable.focus();
  });
  await page.keyboard.press('k'); await page.keyboard.press('ArrowLeft');
  await expect(page.locator('#shortcut-contenteditable')).toContainText('k');
  await expect(frameInput(page)).toHaveValue('120');
  await page.locator('#shortcut-contenteditable').evaluate(element => element.remove());
  expect((await backup(page)).scene.project).toEqual(baseline.scene.project);
});

test('@shortcuts Space uses the real music clock while playback locks frame writes and history', async ({ page }) => {
  await ready(page); await frame(page, 120); await cameraKey(page);
  const baseline = await backup(page);
  const offset = current(baseline).countMap.sourceOffsetSeconds;
  await key(page, 'Space'); await expect(page.getByRole('button', { name: '暂停', exact: true })).toBeVisible();
  await expect.poll(() => page.locator('audio').evaluate((audio: HTMLAudioElement) => audio.currentTime)).toBeGreaterThan(offset + 4.1);
  await key(page, 'k'); await key(page, 'Delete'); await key(page, 'Control+z'); await key(page, 'i');
  await page.locator('audio').evaluate((audio: HTMLAudioElement, sourceTime) => { audio.currentTime = sourceTime; }, offset + 7.2);
  await expect.poll(async () => Number(await frameInput(page).inputValue())).toBeGreaterThanOrEqual(216);
  await key(page, 'Space'); await expect(page.getByRole('button', { name: '播放', exact: true })).toBeVisible();
  const audio = await page.locator('audio').evaluate((audio: HTMLAudioElement) => ({ paused: audio.paused, time: audio.currentTime }));
  expect(audio.paused).toBe(true);
  const pausedFrame = Number(await frameInput(page).inputValue());
  expect(pausedFrame).toBe(Math.round((audio.time - offset) * 30));
  const paused = await backup(page);
  expect(paused.scene.viewer.time).toBeCloseTo(pausedFrame / 30, 9);
  expect(paused.scene.project).toEqual(baseline.scene.project);
  await expect(rangeReadout(page)).toHaveText('未选区');
});

test('@shortcuts a real canvas reached by Tab advances editor frames without moving the camera', async ({ page }) => {
  await ready(page); await frame(page, 120);
  const baseline = await backup(page);
  const stage = page.getByRole('region', { name: '3D 动画舞台', exact: true });
  const canvas = stage.locator('canvas');
  await stage.focus(); await page.keyboard.press('Tab'); await expect(canvas).toBeFocused();
  await page.keyboard.press('ArrowRight'); await expect(frameInput(page)).toHaveValue('121');
  await page.keyboard.press('ArrowLeft'); await expect(frameInput(page)).toHaveValue('120');
  const after = await backup(page);
  expect(after.scene.viewer.camera).toEqual(baseline.scene.viewer.camera);
  expect(after.scene.project).toEqual(baseline.scene.project);
});

test('@shortcuts repeated Space and a new modal cancel pending audio resume before it can play', async ({ page }) => {
  await controlledPlayback(page); await ready(page); await frame(page, 120);
  const baseline = await backup(page);
  await page.evaluate(() => { window.shortcutPlayback.hold = 'resume'; });
  await key(page, 'Space'); await held(page, 'resumes', 0);
  await key(page, 'Space'); await release(page, 'resumes', 0);
  await expectPaused(page); await expectNoPlaybackError(page);

  await key(page, 'Space'); await held(page, 'resumes', 1);
  await clickRevealed(page, page.getByRole('button', { name: '导入音乐', exact: true, includeHidden: true }));
  const music = page.getByRole('dialog', { name: '先把音乐和数拍准备好', exact: true });
  await expect(music).toBeVisible();
  await release(page, 'resumes', 1, false);
  await expect(music).toBeVisible(); await expectPaused(page); await expectNoPlaybackError(page);
  await page.keyboard.press('Escape'); await expect(music).toHaveCount(0);
  expect((await backup(page)).scene.project).toEqual(baseline.scene.project);
});

test('@shortcuts seeking or a recorded camera edit cancels pending play and obsolete results cannot interrupt newer playback', async ({ page }) => {
  await controlledPlayback(page); await ready(page); await frame(page, 120);
  await page.evaluate(() => { window.shortcutPlayback.hold = 'play'; });
  await key(page, 'Space'); await held(page, 'plays', 0);
  await frame(page, 180); await release(page, 'plays', 0);
  await expectPaused(page); await expect(frameInput(page)).toHaveValue('180'); await expectNoPlaybackError(page);

  await key(page, 'Space'); await held(page, 'plays', 1);
  await cameraKey(page);
  await release(page, 'plays', 1, false);
  await expectPaused(page); await expectNoPlaybackError(page);
  const recorded = await backup(page);
  expect(current(recorded).cameraTrack!.keys.map(item => item.time)).toEqual([6]);

  await key(page, 'Space'); await held(page, 'plays', 2);
  await key(page, 'Space'); await expectPaused(page);
  await page.evaluate(() => { window.shortcutPlayback.hold = null; });
  await key(page, 'Space'); await expect(page.getByRole('button', { name: '暂停', exact: true })).toBeVisible();
  await release(page, 'plays', 2, false);
  await expect(page.getByRole('button', { name: '暂停', exact: true })).toBeVisible(); await expectNoPlaybackError(page);
  await expect.poll(() => page.locator('audio').evaluate((audio: HTMLAudioElement) => audio.paused)).toBe(false);
  await key(page, 'Space'); await expectPaused(page);

  await page.evaluate(() => { window.shortcutPlayback.hold = 'play'; });
  await key(page, 'Space'); await held(page, 'plays', 3);
  await key(page, 'Space'); await expectPaused(page);
  await page.evaluate(() => { window.shortcutPlayback.hold = null; });
  await key(page, 'Space'); await expect(page.getByRole('button', { name: '暂停', exact: true })).toBeVisible();
  await release(page, 'plays', 3);
  await expect(page.getByRole('button', { name: '暂停', exact: true })).toBeVisible(); await expectNoPlaybackError(page);
  await expect.poll(() => page.locator('audio').evaluate((audio: HTMLAudioElement) => audio.paused)).toBe(false);
  await key(page, 'Space'); await expectPaused(page);
  expect((await backup(page)).scene.project).toEqual(recorded.scene.project);
});

test('@shortcuts Space restarts from the last frame and loops the scene or the selected range', async ({ page }) => {
  await ready(page);
  const baseline = await backup(page);
  const end = Math.ceil(current(baseline).countMap.durationSeconds * 30);
  const offset = current(baseline).countMap.sourceOffsetSeconds;
  await frame(page, end);
  await key(page, 'Space'); await expect(page.getByRole('button', { name: '暂停', exact: true })).toBeVisible();
  await expect.poll(() => page.locator('audio').evaluate((audio: HTMLAudioElement) => audio.currentTime)).toBeLessThan(offset + 1.5);
  await key(page, 'Space'); await expectPaused(page);
  await page.getByRole('button', { name: '循环整段', exact: true }).click();
  await key(page, 'Space'); await expect(page.getByRole('button', { name: '暂停', exact: true })).toBeVisible();
  await expect.poll(() => page.locator('audio').evaluate((audio: HTMLAudioElement) => audio.currentTime)).toBeGreaterThan(offset + 0.1);
  await key(page, 'Space'); await expectPaused(page);
  // With a range, looping starts at its start and stays within it.
  await frame(page, 30); await key(page, 'i'); await frame(page, 45); await key(page, 'o');
  await expect(page.getByRole('button', { name: '循环选区', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await frame(page, 300);
  await key(page, 'Space'); await expect(page.getByRole('button', { name: '暂停', exact: true })).toBeVisible();
  const seen: number[] = [];
  for (let index = 0; index < 12; index++) { seen.push(Number(await timeline(page).getAttribute('data-time'))); await page.waitForTimeout(80); }
  await key(page, 'Space'); await expectPaused(page);
  expect(Math.min(...seen)).toBeGreaterThanOrEqual(1 - 1e-6);
  expect(Math.max(...seen)).toBeLessThanOrEqual(1.5 + 1e-6);
  expect((await backup(page)).scene.project).toEqual(baseline.scene.project);
});
