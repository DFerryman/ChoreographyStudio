import { mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { clickRevealed, closeDisclosures, reveal } from './helpers';
test.beforeEach(async ({ page }) => { await page.route('**/api/**', route => route.abort('blockedbyclient')); });
import { editStageValue, expectStageValue } from './stageInteractions';

type Backup = {
  scene: {
    id: string;
    project: {
      revision: number;
      historyIndex: number;
      history: { take: unknown; manual?: { root: { frame: number; position: number[] }[]; rotations: Record<string, unknown[]> } }[];
    };
    viewer: { time: number; editorMode: string };
  };
};

const current = (backup: Backup) => backup.scene.project.history[backup.scene.project.historyIndex];
const disclosure = (page: Page, name: string) => page.locator('summary').filter({ hasText: new RegExp(`^${name}$`) }).or(page.locator(`summary[aria-label="${name}"]`)).locator('..');
const hiddenButton = (page: Page, name: string) => page.getByRole('button', { name, exact: true, includeHidden: true });

async function noOverflow(page: Page) {
  const size = await page.evaluate(() => ({ client: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }));
  expect(size.scroll).toBeLessThanOrEqual(size.client);
}

async function keyboardToggle(details: Locator, open: boolean) {
  const summary = details.locator(':scope > summary');
  await summary.focus(); await expect(summary).toBeFocused();
  await summary.press('Enter');
  if (open) await expect(details).toHaveAttribute('open', '');
  else await expect(details).not.toHaveAttribute('open');
}

async function backup(page: Page): Promise<Backup> {
  const pending = page.waitForEvent('download');
  await clickRevealed(page, hiddenButton(page, '下载项目备份'));
  const path = await (await pending).path(); expect(path).toBeTruthy();
  const document = JSON.parse(await readFile(path!, 'utf8')) as Backup;
  await closeDisclosures(page, '.studio-more, .studio-more .backup-menu');
  return document;
}

for (const width of [320, 390, 768, 1440]) {
  test(`@layout ${width}px full-window scene has floating tracks and keyboard disclosures preserve scene data`, async ({ page }, testInfo) => {
    const errors: string[] = [], warnings: string[] = [], apiRequests: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => {
      if (message.type() === 'error') errors.push(message.text());
      if (message.type() === 'warning') warnings.push(message.text());
    });
    page.on('request', request => { if (new URL(request.url()).pathname.startsWith('/api/')) apiRequests.push(request.url()); });
    page.on('dialog', dialog => { void (dialog.type() === 'beforeunload' ? dialog.accept() : dialog.dismiss()); });
    await page.setViewportSize({ width, height: width >= 768 ? 1000 : 844 });
    await page.goto('/');
    await expect(page.getByRole('button', { name: '播放', exact: true })).toBeEnabled();
    await expect(hiddenButton(page, '手动 K帧')).toHaveAttribute('aria-pressed', 'true');
    await expect(hiddenButton(page, '手动 K帧')).toBeHidden();
    const stage = page.getByRole('region', { name: '3D动作预览', exact: true });
    const timeline = page.getByRole('region', { name: '手动关键帧时间线', exact: true });
    await expect(stage).toBeVisible(); await expect(timeline).toBeVisible();
    await expect(page.getByRole('region', { name: '手动关键帧编辑器', exact: true, includeHidden: true })).toHaveCount(0);
    await expect(page.getByRole('combobox', { name: '选择关节', exact: true, includeHidden: true })).toHaveCount(0);
    await expect(page.getByRole('spinbutton', { name: /^(关节|Root) [XYZ]/, includeHidden: true })).toHaveCount(0);
    await expect(page.getByRole('slider', { name: /^(关节|Root) [XYZ]/, includeHidden: true })).toHaveCount(0);
    await expect(page.locator('.manual-workspace > .inspector')).toHaveCount(0);
    await expect(page.locator('.sidebar, .workspace-toolbar, .workspace-footer')).toHaveCount(0);
    await expect(page.getByRole('list', { name: '八拍时间线', exact: true })).toHaveCount(0);
    await expect(page.getByRole('group', { name: '舞台编辑工具', exact: true }).getByRole('button')).toHaveCount(3);
    await expect(hiddenButton(page, '旋转关节')).toHaveCount(0);
    await expect(hiddenButton(page, '移动角色')).toHaveCount(0);

    const visibleMenus = ['更多工具', '相机选项', '场景辅助工具', '更多编辑操作'];
    const names = [...visibleMenus, '舞台信息', '播放选项', '姿态复用', '关键帧明细', '键盘快捷键', '移动与复制关键帧', '真实约束', 'AI 编排', '场景备份'];
    for (const name of names) {
      const details = disclosure(page, name);
      await expect(details).toHaveCount(1); await expect(details).not.toHaveAttribute('open');
      if (visibleMenus.includes(name)) await expect(details.locator(':scope > summary')).toBeVisible();
      else await expect(details.locator(':scope > summary')).toBeHidden();
    }
    for (const name of ['导入音乐', '聚焦关节', '镜像观看', '复制当前姿态', '删除当前帧关键帧', '移动当前范围关键帧', '下载完整场景包']) {
      await expect(hiddenButton(page, name)).toBeHidden();
    }
    await expect(page.getByRole('spinbutton', { name: '当前时间（秒）', exact: true, includeHidden: true })).toBeHidden();
    await expect(page.getByRole('combobox', { name: '关键帧轨道筛选', exact: true, includeHidden: true })).toBeHidden();
    const write = page.getByRole('button', { name: 'K 完整姿态', exact: true });
    await page.locator('.project-title').scrollIntoViewIfNeeded();
    if (width >= 1200) await expect(write).toBeInViewport();
    await write.scrollIntoViewIfNeeded(); await expect(write).toBeInViewport(); await expect(write).toBeEnabled();
    expect((await write.boundingBox())!.height).toBeGreaterThanOrEqual(width < 768 ? 44 : 34);
    await noOverflow(page);
    const stageBox = (await stage.boundingBox())!, workspaceBox = (await page.locator('.manual-workspace').boundingBox())!;
    expect(stageBox.width).toBeGreaterThanOrEqual(workspaceBox.width - 2);
    const canvasBox = (await page.getByRole('img', { name: '人体编舞动作预览', exact: true }).boundingBox())!;
    expect(canvasBox.width).toBeGreaterThanOrEqual(stageBox.width - 2);
    const viewport = page.viewportSize()!;
    expect(canvasBox.width).toBeGreaterThanOrEqual(width - 2);
    expect(canvasBox.y).toBeLessThanOrEqual(60);
    expect(canvasBox.height).toBeGreaterThanOrEqual(viewport.height - 60);
    expect(canvasBox.y + canvasBox.height).toBeLessThanOrEqual(viewport.height + 2);
    const timelineBox = (await timeline.boundingBox())!;
    expect(timelineBox.x).toBeGreaterThanOrEqual(canvasBox.x);
    expect(timelineBox.x + timelineBox.width).toBeLessThanOrEqual(canvasBox.x + canvasBox.width);
    expect(timelineBox.y).toBeGreaterThan(canvasBox.y);
    expect(timelineBox.y).toBeLessThan(canvasBox.y + canvasBox.height);
    expect(timelineBox.y + timelineBox.height).toBeLessThanOrEqual(canvasBox.y + canvasBox.height);
    expect(await page.locator('.timeline-overlay').evaluate(element => getComputedStyle(element).position)).toBe('absolute');
    await page.getByRole('heading', { name: '我的第一段八拍', exact: true }).scrollIntoViewIfNeeded();
    const screenshot = await page.screenshot({ fullPage: true });
    await testInfo.attach(`manual-layout-${width}.png`, { body: screenshot, contentType: 'image/png' });
    if (process.env.CHOREO_SCREENSHOT_DIR) {
      await mkdir(process.env.CHOREO_SCREENSHOT_DIR, { recursive: true });
      await page.screenshot({ path: join(process.env.CHOREO_SCREENSHOT_DIR, `manual-layout-${width}.png`), fullPage: true });
    }

    const frame = page.getByRole('spinbutton', { name: '当前帧', exact: true });
    await frame.fill('120'); await frame.press('Tab');
    await editStageValue(page, 'Root X 位移（米）', 1.25);
    await expect(page.getByRole('status').filter({ hasText: '姿态草稿 · 尚未写入关键帧' })).toBeVisible();
    await write.click();
    const authored = await backup(page);
    expect(current(authored).manual!.root[0].frame).toBe(120);
    expect(current(authored).manual!.root[0].position[0]).toBeCloseTo(1.25, 3);
    expect(Object.keys(current(authored).manual!.rotations)).toHaveLength(19);
    expect(authored.scene.viewer.time).toBe(4);
    expect(authored.scene.viewer.editorMode).toBe('keyframes');
    await closeDisclosures(page);

    for (const name of names) {
      const details = disclosure(page, name);
      await reveal(page, details);
      await keyboardToggle(details, true); await noOverflow(page);
      if (name === '更多工具') {
        await expect(hiddenButton(page, '导入音乐')).toBeVisible();
        await expect(hiddenButton(page, '手动 K帧')).toBeVisible();
      }
      if (name === '场景辅助工具') {
        await expect(disclosure(page, '真实约束').locator(':scope > summary')).toBeVisible();
        await expect(disclosure(page, 'AI 编排').locator(':scope > summary')).toBeVisible();
      }
      if (name === '舞台信息') await expect(page.getByLabel('相机世界坐标', { exact: true })).toBeVisible();
      if (name === '播放选项') await expect(hiddenButton(page, '镜像观看')).toBeVisible();
      if (name === '关键帧明细') await expect(page.getByRole('listitem', { name: '第 120 帧关键帧', exact: true })).toBeVisible();
      if (name === '姿态复用') {
        const copy = hiddenButton(page, '复制当前姿态');
        await copy.focus(); await copy.press('Enter');
        await expect(page.getByLabel('已复制姿态', { exact: true })).toHaveText('第 120 帧 · 动画姿态');
        await expect(hiddenButton(page, '粘贴关节姿态')).toBeEnabled();
      }
      if (name === '更多编辑操作') await expect(hiddenButton(page, '删除当前帧关键帧')).toBeEnabled();
      if (name === '移动与复制关键帧') await expect(hiddenButton(page, '复制当前范围关键帧')).toBeEnabled();
      await keyboardToggle(details, false);
      await closeDisclosures(page);
      await expect(frame).toHaveValue('120');
    }
    await expectStageValue(page, 'Root X 位移（米）', 1.25, .0005);
    const preserved = await backup(page);
    expect(preserved.scene.id).toBe(authored.scene.id);
    expect(preserved.scene.project).toEqual(authored.scene.project);
    expect(preserved.scene.viewer.time).toBe(authored.scene.viewer.time);
    await page.getByRole('button', { name: '保存', exact: true }).click();
    await expect(page.locator('.save-state')).toHaveText('已保存到本机');
    await page.reload();
    await expect(frame).toHaveValue('120');
    for (const name of names) await expect(disclosure(page, name)).not.toHaveAttribute('open');
    const restored = await backup(page);
    expect(restored.scene.id).toBe(preserved.scene.id); expect(restored.scene.project).toEqual(preserved.scene.project);
    expect(restored.scene.viewer.time).toBe(4);
    await noOverflow(page);
    await testInfo.attach('browser-console-and-api', { body: JSON.stringify({ errors, warnings, apiRequests }), contentType: 'application/json' });
    expect(errors, 'Layout and disclosure flows have no browser errors').toEqual([]);
    expect(warnings, 'Layout and disclosure flows have no browser warnings').toEqual([]);
    expect(apiRequests, 'Layout and manual editing stay local').toEqual([]);
  });
}
