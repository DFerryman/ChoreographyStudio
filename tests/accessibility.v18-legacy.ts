import { expect, test, type Locator, type Page } from '@playwright/test';
import { clickRevealed } from './helpers';
import { editStageValue, expectStageValue } from './stageInteractions';

const diagnostics = new WeakMap<Page, { errors: string[]; warnings: string[]; apiRequests: string[] }>();
test.beforeEach(async ({ page }) => {
  const report = { errors: [] as string[], warnings: [] as string[], apiRequests: [] as string[] };
  diagnostics.set(page, report);
  page.on('pageerror', error => report.errors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error') report.errors.push(message.text());
    if (message.type() === 'warning') report.warnings.push(message.text());
  });
  page.on('request', request => { if (new URL(request.url()).pathname.startsWith('/api/')) report.apiRequests.push(request.url()); });
  page.on('dialog', dialog => { void (dialog.type() === 'beforeunload' ? dialog.accept() : dialog.dismiss()); });
});
test.afterEach(async ({ page }, testInfo) => {
  const report = diagnostics.get(page)!;
  await testInfo.attach('browser-console-and-api', { body: JSON.stringify(report), contentType: 'application/json' });
  expect(report.errors, 'Keyboard modal flows have no browser runtime errors').toEqual([]);
  expect(report.warnings, 'Keyboard modal flows have no browser warnings').toEqual([]);
  expect(report.apiRequests, 'Modal keyboard handling stays local').toEqual([]);
});

async function ready(page: Page) {
  await page.goto('/');
  await expect(page.getByRole('button', { name: '播放', exact: true })).toBeEnabled();
  await expect.poll(() => page.locator('audio').evaluate((audio: HTMLAudioElement) => audio.readyState)).toBeGreaterThanOrEqual(2);
}

async function focusInside(dialog: Locator) {
  await expect.poll(() => dialog.evaluate(element => element.contains(document.activeElement))).toBe(true);
}

test('music and progress dialogs trap keyboard focus, cancel safely and restore their triggers', async ({ page }) => {
  await ready(page);
  const trigger = page.getByRole('button', { name: '导入音乐', exact: true, includeHidden: true });
  await clickRevealed(page, trigger);
  const music = page.getByRole('dialog', { name: '先把音乐和数拍准备好', exact: true });
  const close = music.getByRole('button', { name: '关闭音乐设置', exact: true });
  const confirm = music.getByRole('button', { name: '确认数拍，进入工作台', exact: true });
  await expect(close).toBeFocused();
  await page.keyboard.press('Shift+Tab'); await expect(confirm).toBeFocused();
  await page.keyboard.press('Tab'); await expect(close).toBeFocused();
  const title = music.getByRole('textbox', { name: '作品名称', exact: true });
  await title.fill('取消不会重建当前场景');
  await page.getByRole('button', { name: '播放', exact: true }).evaluate((button: HTMLButtonElement) => button.focus());
  await focusInside(music);
  await page.keyboard.press('Escape');
  await expect(music).toHaveCount(0); await expect(trigger).toBeFocused();
  await expect(page.getByRole('heading', { name: '我的第一段八拍', exact: true })).toBeVisible();

  const progress = page.getByRole('button', { name: '使用说明与版本进展', exact: true, includeHidden: true });
  await clickRevealed(page, progress);
  const about = page.getByRole('dialog', { name: '从可操作，到真正可教学', exact: true });
  await expect(about.getByRole('button', { name: '关闭版本说明', exact: true })).toBeFocused();
  await page.keyboard.press('Shift+Tab'); await expect(about.getByRole('link', { name: '查看源码与阶段任务', exact: true })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(about).toHaveCount(0); await expect(progress).toBeFocused();
});

test('mobile stacked dialogs preserve autofocus, choose the higher guard layer and retain an unwritten draft', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await ready(page);
  await page.getByRole('button', { name: '保存', exact: true }).click();
  // The compact header deliberately hides this status on phones; still wait for
  // the transaction's saved state before opening the saved scene's actions.
  await expect(page.locator('.save-state')).toHaveClass(/\bsaved\b/);
  await expect(page.locator('.save-state')).toHaveText('已保存到本机');
  const scenes = page.getByRole('button', { name: '场景', exact: true });
  await scenes.click();
  const library = page.getByRole('dialog', { name: '本机场景', exact: true });
  const renameTrigger = library.getByRole('button', { name: '改名场景 我的第一段八拍', exact: true });
  await renameTrigger.click();
  const rename = page.getByRole('dialog', { name: '修改场景名称', exact: true });
  const name = rename.getByRole('textbox', { name: '场景名称', exact: true });
  await expect(name).toBeFocused();
  await name.fill('不会执行的名称');
  await page.keyboard.press('Escape');
  await expect(rename).toHaveCount(0); await expect(renameTrigger).toBeFocused();
  await expect(library).toBeVisible();
  await page.keyboard.press('Escape'); await expect(library).toHaveCount(0); await expect(scenes).toBeFocused();

  await clickRevealed(page, page.getByRole('button', { name: '手动 K帧', exact: true, includeHidden: true }));
  await editStageValue(page, 'Root X 位移（米）', 1.25);
  const draft = page.getByRole('status').filter({ hasText: '姿态草稿 · 尚未写入关键帧' });
  await expect(draft).toBeVisible();
  await scenes.click();
  const newScene = library.getByRole('button', { name: '新建场景', exact: true });
  await newScene.click();
  const guard = page.getByRole('dialog', { name: '写入这份姿态草稿？', exact: true });
  const cancel = guard.getByRole('button', { name: '取消', exact: true });
  await expect(cancel).toBeFocused();
  // This guard precedes the library in DOM order but its backdrop has a higher z-index.
  await page.keyboard.press('Shift+Tab'); await expect(guard.getByRole('button', { name: '写入完整姿态后继续', exact: true })).toBeFocused();
  await page.keyboard.press('Tab'); await expect(cancel).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(guard).toHaveCount(0); await expect(newScene).toBeFocused();
  await expect(library).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(library).toHaveCount(0); await expect(scenes).toBeFocused();
  await expect(draft).toBeVisible(); await expectStageValue(page, 'Root X 位移（米）', 1.25, .0005);
  await expect(page.getByRole('button', { name: '撤销', exact: true })).toBeDisabled();
});
