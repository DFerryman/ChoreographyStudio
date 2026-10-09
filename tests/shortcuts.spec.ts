import { editStageValue, expectStageValue, selectStageJoint } from './stageInteractions';
import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import { clickRevealed, reveal } from './helpers';

type Snapshot = {
  countMap: { durationSeconds: number; sourceOffsetSeconds: number };
  take: { id: string; times: number[]; poses: unknown[] };
  manual?: {
    id: string;
    rotations: Partial<Record<string, { frame: number; rotation: number[] }[]>>;
    root: { frame: number; position: number[] }[];
  };
};
type Backup = {
  scene: {
    project: { revision: number; historyIndex: number; history: Snapshot[] };
    viewer: { time: number; camera: unknown };
  };
};
const current = (backup: Backup) => backup.scene.project.history[backup.scene.project.historyIndex];
const frameInput = (page: Page) => page.getByRole('spinbutton', { name: '当前帧', exact: true });
const draft = (page: Page) => page.getByRole('status').filter({ hasText: '姿态草稿 · 尚未写入关键帧' });
const guard = (page: Page) => page.getByRole('dialog', { name: '写入这份姿态草稿？', exact: true });
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
  await expect(page.getByRole('button', { name: '播放', exact: true })).toBeEnabled();
  await expect.poll(() => page.locator('audio').evaluate((audio: HTMLAudioElement) => audio.readyState)).toBeGreaterThanOrEqual(2);
  const editor = page.getByRole('region', { name: '手动关键帧时间线', exact: true });
  if (!await editor.isVisible()) await clickRevealed(page, page.getByRole('button', { name: '手动 K帧', exact: true, includeHidden: true }));
  await expect(editor).toBeVisible();
}

async function backup(page: Page): Promise<Backup> {
  const download = page.getByRole('button', { name: '下载项目备份', exact: true, includeHidden: true });
  const downloading = page.waitForEvent('download');
  await clickRevealed(page, download);
  const path = await (await downloading).path();
  expect(path).toBeTruthy();
  return JSON.parse(await readFile(path!, 'utf8')) as Backup;
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

async function number(page: Page, name: string, value: number) {
  await editStageValue(page, name, value);
}

async function frame(page: Page, value: number) {
  await number(page, '当前帧', value);
  await expect(frameInput(page)).toHaveValue(String(value));
}

async function filter(page: Page, value: 'joint' | 'root') {
  const input = page.getByRole('combobox', { name: '关键帧轨道筛选', exact: true, includeHidden: true });
  await reveal(page, input);
  await input.selectOption(value);
}

async function selectJoint(page: Page, joint: string) {
  await selectStageJoint(page, joint as Parameters<typeof selectStageJoint>[1]);
}

async function rootKey(page: Page, value = 1.2) {
  await page.getByRole('button', { name: '移动角色工具', exact: true }).click();
  await number(page, 'Root X 位移（米）', value);
  await expect(draft(page)).toBeVisible();
  await key(page, 'k');
  await expect(draft(page)).toHaveCount(0);
  await filter(page, 'root');
  await expect(page.getByLabel('筛选轨道状态', { exact: true })).toContainText('本帧已写 K');
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
  await ready(page);
  await clickRevealed(page, page.getByRole('button', { name: '导入音乐', exact: true, includeHidden: true }));
  const music = page.getByRole('dialog', { name: '先把音乐和数拍准备好', exact: true });
  await music.getByRole('spinbutton', { name: '音乐速度 BPM', exact: true }).fill('117');
  await music.getByRole('spinbutton', { name: '选取几个完整八拍', exact: true }).fill('4');
  await music.getByRole('button', { name: '确认数拍，进入工作台', exact: true }).click();
  await expect(music).toHaveCount(0);
  await clickRevealed(page, page.getByRole('button', { name: '八拍编排', exact: true, includeHidden: true }));
  await page.getByRole('button', { name: '生成模板初稿', exact: true }).click();
  await clickRevealed(page, page.getByRole('button', { name: '手动 K帧', exact: true, includeHidden: true }));
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

  const seconds = page.getByRole('spinbutton', { name: '当前时间（秒）', exact: true, includeHidden: true });
  await reveal(page, seconds);
  await seconds.focus(); await seconds.press('ArrowLeft'); await seconds.press('k'); await seconds.press('Space');
  await expect(frameInput(page)).toHaveValue('3');
  await expect(page.getByRole('button', { name: '播放', exact: true })).toBeVisible();
  await expect(draft(page)).toHaveCount(0);

  await frame(page, end - 1);
  await key(page, 'ArrowRight'); await expect(frameInput(page)).toHaveValue(String(end));
  const finalTime = Number(await seconds.inputValue());
  expect(finalTime).toBeCloseTo(duration, 6);
  const atEnd = await backup(page);
  expect(atEnd.scene.viewer.time).toBe(duration);
  expect(atEnd.scene.project).toEqual(baseline.scene.project);
  expect(current(atEnd).take.times.at(-1)).toBe(duration);
  await key(page, 'ArrowRight'); await expect(frameInput(page)).toHaveValue(String(end));
  await key(page, 'ArrowLeft'); await expect(frameInput(page)).toHaveValue(String(end - 1));
  expect(Number(await seconds.inputValue())).toBeCloseTo((end - 1) / 30, 6);
});

test('@shortcuts K and Delete affect the active joint or Root track and keyboard history restores the exact animation', async ({ page }) => {
  await ready(page); await frame(page, 120);
  await selectJoint(page, 'LeftUpperArm');
  await page.getByRole('button', { name: '旋转工具', exact: true }).click();
  await number(page, '关节 Z 旋转（度）', 45);
  await key(page, 'k'); await expect(draft(page)).toHaveCount(0);
  await filter(page, 'joint');
  await expect(page.getByLabel('筛选轨道状态', { exact: true })).toContainText('本帧已写 K');
  await rootKey(page);
  const authored = current(await backup(page));
  expect(authored.manual!.rotations.LeftUpperArm).toHaveLength(1);
  expect(authored.manual!.root).toHaveLength(1);
  expect(authored.manual!.root[0].position[0]).toBeCloseTo(1.2, 5);

  await key(page, 'Delete');
  const deletedRoot = current(await backup(page));
  expect(deletedRoot.manual!.root).toEqual([]);
  expect(deletedRoot.manual!.rotations).toEqual(authored.manual!.rotations);
  await key(page, 'Control+z'); expect(current(await backup(page))).toEqual(authored);
  await key(page, 'Control+Shift+z'); expect(current(await backup(page))).toEqual(deletedRoot);
  await key(page, 'Control+z'); expect(current(await backup(page))).toEqual(authored);
  await key(page, 'Control+y'); expect(current(await backup(page))).toEqual(deletedRoot);
  await key(page, 'Meta+z'); expect(current(await backup(page))).toEqual(authored);
  await key(page, 'Meta+Shift+z'); expect(current(await backup(page))).toEqual(deletedRoot);
  await key(page, 'Meta+z'); expect(current(await backup(page))).toEqual(authored);

  await frame(page, 120);
  await page.getByRole('button', { name: '旋转工具', exact: true }).click();
  await key(page, 'Delete');
  const deletedJoint = current(await backup(page));
  expect(deletedJoint.manual!.rotations.LeftUpperArm).toBeUndefined();
  expect(deletedJoint.manual!.root).toEqual(authored.manual!.root);
  await key(page, 'Control+z'); expect(current(await backup(page))).toEqual(authored);
});

test('@shortcuts draft guards stop keyboard seeking and playback, keep dialogs inert to editing keys, and cancel safely', async ({ page }) => {
  await ready(page); await frame(page, 120); await rootKey(page);
  const baseline = await backup(page);
  await number(page, 'Root X 位移（米）', 2);
  await key(page, 'ArrowRight'); await expect(guard(page)).toBeVisible();
  for (const shortcut of ['k', 'Delete', 'Control+z', 'ArrowLeft']) await page.keyboard.press(shortcut);
  // A real Space on the focused Cancel button retains its native action. This
  // synthetic stage event checks that the modal also suspends global Space.
  await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', code: 'Space', bubbles: true, cancelable: true })));
  await expect(guard(page)).toBeVisible(); await expect(frameInput(page)).toHaveValue('120');
  await expect(draft(page)).toBeVisible();
  await page.keyboard.press('Escape'); await expect(guard(page)).toHaveCount(0);
  await expect(draft(page)).toBeVisible();
  await expectStageValue(page, 'Root X 位移（米）', 2, .000005);

  await key(page, 'Space'); await expect(guard(page)).toBeVisible();
  await expect(page.getByRole('button', { name: '播放', exact: true })).toBeVisible();
  await guard(page).getByRole('button', { name: '放弃草稿，继续', exact: true }).click();
  await expect(guard(page)).toHaveCount(0); await expect(draft(page)).toHaveCount(0);
  await expect(page.getByRole('button', { name: '暂停', exact: true })).toBeVisible();
  await key(page, 'Space'); await expect(page.getByRole('button', { name: '播放', exact: true })).toBeVisible();
  expect((await backup(page)).scene.project).toEqual(baseline.scene.project);
});

test('@shortcuts composition, modified keys, repeated writes and native focused controls never trigger stage edits', async ({ page }) => {
  await ready(page); await frame(page, 120); await rootKey(page);
  const baseline = await backup(page);
  await stageFocus(page);
  await page.evaluate(() => {
    const events: KeyboardEventInit[] = [
      { key: 'k', repeat: true }, { key: 'Delete', repeat: true }, { key: ' ', code: 'Space', repeat: true },
      { key: 'z', ctrlKey: true, repeat: true }, { key: 'k', isComposing: true },
      { key: 'ArrowRight', altKey: true }, { key: 'ArrowRight', ctrlKey: true }, { key: 'k', metaKey: true },
    ];
    for (const options of events) window.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...options }));
    const prevented = new KeyboardEvent('keydown', { key: 'Delete', bubbles: true, cancelable: true });
    prevented.preventDefault(); window.dispatchEvent(prevented);
  });
  await expect(frameInput(page)).toHaveValue('120');
  await expect(page.getByRole('button', { name: '播放', exact: true })).toBeVisible();

  const mirror = page.getByRole('button', { name: '镜像观看', exact: true, includeHidden: true });
  await reveal(page, mirror);
  await mirror.focus(); await page.keyboard.press('Space');
  await expect(mirror).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: '播放', exact: true })).toBeVisible();
  await key(page, 'k'); await key(page, 'Delete'); await key(page, 'ArrowRight'); await key(page, 'Control+z');
  await expect(frameInput(page)).toHaveValue('120');
  await mirror.click(); await expect(mirror).toHaveAttribute('aria-pressed', 'false');

  await page.evaluate(() => {
    const editable = document.createElement('div');
    editable.id = 'shortcut-contenteditable'; editable.contentEditable = 'true';
    editable.textContent = 'Native text'; document.body.append(editable); editable.focus();
  });
  await page.keyboard.press('k'); await page.keyboard.press('ArrowLeft');
  await expect(page.locator('#shortcut-contenteditable')).toContainText('k');
  await expect(frameInput(page)).toHaveValue('120');
  await page.locator('#shortcut-contenteditable').evaluate(element => element.remove());

  await page.getByRole('button', { name: '选择工具', exact: true }).click();
  await selectJoint(page, ''); await key(page, 'k'); await key(page, 'Delete');
  await selectJoint(page, 'LeftHandTip'); await key(page, 'k'); await key(page, 'Delete');
  expect((await backup(page)).scene.project).toEqual(baseline.scene.project);
});

test('@shortcuts Space uses the real music clock while playback locks frame writes and history', async ({ page }) => {
  await ready(page); await frame(page, 120); await rootKey(page);
  const baseline = await backup(page);
  const offset = current(baseline).countMap.sourceOffsetSeconds;
  await key(page, 'Space'); await expect(page.getByRole('button', { name: '暂停', exact: true })).toBeVisible();
  await expect.poll(() => page.locator('audio').evaluate((audio: HTMLAudioElement) => audio.currentTime)).toBeGreaterThan(offset + 4.1);
  await key(page, 'k'); await key(page, 'Delete'); await key(page, 'Control+z');
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

test('@shortcuts seeking or drafting cancels pending play and obsolete results cannot interrupt newer playback', async ({ page }) => {
  await controlledPlayback(page); await ready(page); await frame(page, 120);
  await page.getByRole('button', { name: '移动角色工具', exact: true }).click();
  const baseline = await backup(page);
  await page.evaluate(() => { window.shortcutPlayback.hold = 'play'; });
  await key(page, 'Space'); await held(page, 'plays', 0);
  await frame(page, 180); await release(page, 'plays', 0);
  await expectPaused(page); await expect(frameInput(page)).toHaveValue('180'); await expectNoPlaybackError(page);

  await key(page, 'Space'); await held(page, 'plays', 1);
  await number(page, 'Root X 位移（米）', 2);
  await expect(draft(page)).toBeVisible();
  await release(page, 'plays', 1, false);
  await expectPaused(page); await expect(draft(page)).toBeVisible(); await expectNoPlaybackError(page);
  await page.getByRole('button', { name: '撤回草稿', exact: true }).click();
  await expect(draft(page)).toHaveCount(0);

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
  expect((await backup(page)).scene.project).toEqual(baseline.scene.project);
});

test('@shortcuts Space restarts from the last frame and starts phrase looping without cancelling its own seek', async ({ page }) => {
  await ready(page);
  const baseline = await backup(page);
  const end = Math.ceil(current(baseline).countMap.durationSeconds * 30);
  const offset = current(baseline).countMap.sourceOffsetSeconds;
  await frame(page, end);
  await key(page, 'Space'); await expect(page.getByRole('button', { name: '暂停', exact: true })).toBeVisible();
  await expect.poll(() => page.locator('audio').evaluate((audio: HTMLAudioElement) => audio.currentTime)).toBeLessThan(offset + 1.5);
  await key(page, 'Space'); await expectPaused(page);
  await page.getByRole('button', { name: '循环当前八拍', exact: true }).click();
  await key(page, 'Space'); await expect(page.getByRole('button', { name: '暂停', exact: true })).toBeVisible();
  await expect.poll(() => page.locator('audio').evaluate((audio: HTMLAudioElement) => audio.currentTime)).toBeGreaterThan(offset + 0.1);
  await key(page, 'Space'); await expectPaused(page);
  expect((await backup(page)).scene.project).toEqual(baseline.scene.project);
});
