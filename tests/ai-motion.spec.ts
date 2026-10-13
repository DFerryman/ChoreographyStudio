import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { expect, test, type Page, type Route } from '@playwright/test';
import { bakeKeyframeSequence, makeKeyframeSequence, sampleTake, upsertMotionPointChanges, type Pose } from '../packages/core/src';
import { validateAIMotionRequest, type AIMotionRequest, type AIMotionResult } from '../packages/core/src/aiMotion';
import { makeAIMotionResultFixture } from '../packages/core/src/aiMotion.fixture';
import { createAIMotionSampler } from '../packages/core/src/aiMotionTrack';
import { unpackScene } from '../apps/web/src/compactScene';
import { clickRevealed, closeDisclosures } from './helpers';
import { backup, current, hiddenButton, openFixture, ready, save, screenshot, type Backup } from './realismHelpers';

const endpoint = '/api/motion/generate';
const candidate = (page: Page) => page.getByRole('region', { name: 'AI 候选', exact: true });
const canvas = (page: Page) => page.getByRole('img', { name: '人体编舞动作预览', exact: true });
const slider = (page: Page) => page.getByRole('slider', { name: '时间线进度', exact: true });
const reports = new WeakMap<Page, { errors: string[]; warnings: string[]; requests: string[]; expectedHttpErrors: string[] }>();

test.beforeEach(async ({ page }) => {
  const report = { errors: [] as string[], warnings: [] as string[], requests: [] as string[], expectedHttpErrors: [] as string[] };
  reports.set(page, report);
  page.on('pageerror', error => report.errors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'warning') report.warnings.push(message.text());
    if (message.type() !== 'error') return;
    if (message.location().url?.includes(endpoint) && /^Failed to load resource:/.test(message.text())) report.expectedHttpErrors.push(message.text());
    else report.errors.push(message.text());
  });
  page.on('request', request => { const path = new URL(request.url()).pathname; if (path.startsWith('/api/')) report.requests.push(`${request.method()} ${path}`); });
  // No unmocked business endpoint can reach a real service.
  await page.route('**/api/**', route => route.abort('blockedbyclient'));
});
test.afterEach(async ({ page }, info) => {
  const report = reports.get(page)!;
  await info.attach('mock-api-and-browser-diagnostics', { body: JSON.stringify(report), contentType: 'application/json' });
  expect(report.errors).toEqual([]);
  expect(report.warnings).toEqual([]);
  expect(report.requests.every(request => request === `POST ${endpoint}`)).toBe(true);
});

async function mockMotion(page: Page, answer?: (request: AIMotionRequest, index: number, route: Route) => Promise<void>) {
  const calls: AIMotionRequest[] = [];
  await page.route(`**${endpoint}`, async route => {
    const request = validateAIMotionRequest(route.request().postDataJSON());
    calls.push(request);
    if (answer) await answer(request, calls.length - 1, route);
    else await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(makeAIMotionResultFixture(request)) });
  });
  return calls;
}
async function generate(page: Page, prompt = '侧向移步，左臂抬起后自然收势。') {
  await closeDisclosures(page);
  await page.getByLabel('AI 生成动作', { exact: true }).click();
  await page.getByRole('textbox', { name: '动作描述', exact: true }).fill(prompt);
  await page.getByRole('button', { name: '生成 AI 候选', exact: true }).click();
}
async function seek(page: Page, time: number) {
  await closeDisclosures(page);
  await slider(page).evaluate((element: HTMLInputElement, value) => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(element, String(value));
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
  }, time);
  await expect.poll(async () => Number(await canvas(page).getAttribute('data-render-time'))).toBeCloseTo(time, 12);
}
async function setRange(page: Page, start: number, end: number) {
  await seek(page, start);
  await page.getByRole('button', { name: '设为选区起点', exact: true }).click();
  await seek(page, end);
  await page.getByRole('button', { name: '设为选区终点', exact: true }).click();
  await expect(page.locator('.tl-count-track')).toHaveAttribute('data-range-start', String(start));
  await expect(page.locator('.tl-count-track')).toHaveAttribute('data-range-end', String(end));
}
async function pose(page: Page): Promise<Pose> {
  return JSON.parse((await canvas(page).getAttribute('data-render-pose'))!);
}
async function audioHash(page: Page) {
  return page.locator('audio').evaluate(async (audio: HTMLAudioElement) => {
    const bytes = await (await fetch(audio.src)).arrayBuffer();
    return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(value => value.toString(16).padStart(2, '0')).join('');
  });
}
function expectOriginal(next: ReturnType<typeof current>, original: ReturnType<typeof current>) {
  expect(next.take).toEqual(original.take);
  expect(next.manual).toEqual(original.manual);
  expect(next.cameraTrack).toEqual(original.cameraTrack);
  expect(next.countMap).toEqual(original.countMap);
}
async function expectedVisible(page: Page, document: Backup, at: number) {
  const source = current(document);
  const sampler = createAIMotionSampler(time => sampleTake(source.take!, time), source.aiMotion);
  await seek(page, at);
  await expect.poll(async () => pose(page)).toEqual(sampler(at));
}
async function expectReviewDock(page: Page, mobile = false) {
  await expect(page.locator('.timeline-dock > .assist-candidate')).toHaveCount(1);
  const bounds = await candidate(page).boundingBox(), stageBounds = await canvas(page).boundingBox(), timelineBounds = await page.locator('.tl-viewport').boundingBox();
  expect(bounds).toBeTruthy(); expect(stageBounds).toBeTruthy(); expect(timelineBounds).toBeTruthy();
  expect(bounds!.y).toBeGreaterThanOrEqual(stageBounds!.y + stageBounds!.height - 1);
  expect(timelineBounds!.height).toBeGreaterThan(50);
  const dimensions = await page.evaluate(() => ({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth }));
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.width);
  for (const name of ['返回原稿', '采用候选', '关闭候选']) {
    const button = candidate(page).getByRole('button', { name, exact: true });
    await expect(button).toBeVisible();
    if (mobile) expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  }
}

test('@ai-motion full structured bones preview separately, adopt once, and undo without replacing original takes', async ({ page }, info) => {
  test.setTimeout(120_000);
  const calls = await mockMotion(page);
  await openFixture(page);
  const before = await backup(page), original = current(before);
  await generate(page);
  await expect(candidate(page)).toBeVisible();
  expect(calls).toHaveLength(1);
  expect(calls[0]).toMatchObject({ protocol: 'ai-motion-1', context: { target: { mode: 'full', startSeconds: 0, endSeconds: 16 }, audioUnderstanding: false } });
  expect(JSON.stringify(calls[0])).not.toContain('actionId');
  expect(calls[0].context.audio[0].hash).toBe(await audioHash(page));
  expect((await backup(page)).scene.project).toEqual(before.scene.project);
  await candidate(page).getByRole('button', { name: '预览候选', exact: true }).click();
  await seek(page, 8);
  await expect.poll(async () => (await pose(page)).root).toEqual([.2, 1.1, 0]);
  expect((await pose(page)).joints.LeftUpperArm).not.toEqual(sampleTake(original.take!, 8).joints.LeftUpperArm);
  await expectReviewDock(page);
  await screenshot(page, info, 'ai-motion-full-candidate.png');
  await page.setViewportSize({ width: 390, height: 900 });
  await expectReviewDock(page, true);
  await screenshot(page, info, 'ai-motion-full-candidate-390.png');
  await page.setViewportSize({ width: 1440, height: 1000 });
  expect((await backup(page)).scene.project).toEqual(before.scene.project);
  await candidate(page).getByRole('button', { name: '返回原稿', exact: true }).click();
  await expectedVisible(page, before, 8);
  await candidate(page).getByRole('button', { name: '采用候选', exact: true }).click();
  await expect(candidate(page)).toHaveCount(0);
  const adopted = await backup(page), motion = current(adopted).aiMotion!;
  expectOriginal(current(adopted), original);
  expect(adopted.scene.project.history).toHaveLength(before.scene.project.history.length + 1);
  expect(adopted.scene.project.revision).toBe(before.scene.project.revision + 1);
  expect(motion.patches).toHaveLength(1);
  expect(motion.patches[0].target.mode).toBe('full');
  await expectedVisible(page, adopted, 8);
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  expect(current(await backup(page))).toEqual(original);
  await expectedVisible(page, before, 8);
  await page.getByRole('button', { name: '重做', exact: true }).click();
  expect(current(await backup(page))).toEqual(current(adopted));
  await expectedVisible(page, adopted, 8);
  expect(calls).toHaveLength(1);
});

test('@ai-motion immutable interval context and fixed candidate survive adoption, save/reopen, and native backup', async ({ page }, info) => {
  test.setTimeout(180_000);
  const calls = await mockMotion(page);
  const fixture = await openFixture(page, false, source => {
    source.take.poses.forEach((value, index) => { value.root[0] = source.take.times[index] * .02; });
    const base = source.take, old = sampleTake(base, 2.5), changed = structuredClone(old);
    changed.joints.LeftUpperArm = [0, 0, Math.sin(.2), Math.cos(.2)];
    const manual = upsertMotionPointChanges(makeKeyframeSequence(base, { pointInterpolation: 'hold-last-key-1' }), 2.5, old, changed, base);
    source.take = bakeKeyframeSequence(manual);
    Object.assign(source.scene.project.history[0], { take: source.take, manual,
      cameraTrack: { schema: 'camera-track-1', baseCamera: { position: [0, 1.5, 5], target: [0, 1, 0] }, keys: [{ time: 2.50391, camera: { position: [.4, 1.5, 5], target: [0, 1, 0] } }] } });
    // A recorded camera owns the Stage view; the fixture must supply its initial viewer camera.
    Object.assign(source.scene.viewer, { camera: { position: [0, 1.5, 5], target: [0, 1, 0] } });
  });
  const before = await backup(page), original = current(before), expectedAudio = createHash('sha256').update(fixture.wave).digest('hex');
  expect(original.manual!.baseTake.times).toEqual([0, .7, 2.5, 4, 8, 12, 16]);
  await setRange(page, 4, 8);
  await generate(page);
  await expect(candidate(page)).toBeVisible();
  const request = calls[0];
  expect(request.context.target).toEqual({ mode: 'interval', startSeconds: 4, endSeconds: 8 });
  expect(request.context.before[0].time).toBe(3);
  expect(request.context.before.at(-1)!.time).toBe(4);
  expect(request.context.after[0].time).toBe(8);
  expect(request.context.after.at(-1)!.time).toBe(9);
  for (const value of [...request.context.before, ...request.context.after]) expect(value.pose).toEqual(sampleTake(original.take!, value.time));
  expect(request.context.boundaries.start.pose).toEqual(sampleTake(original.take!, 4));
  expect(request.context.boundaries.end.pose).toEqual(sampleTake(original.take!, 8));
  expect(request.context.boundaries.start.linearVelocity[0]).toBeCloseTo(.02, 8);
  expect(request.context.audio[0]).toMatchObject({ hash: expectedAudio, sourceOffsetSeconds: 1 });
  await setRange(page, 12, 14);
  await expect(page.getByLabel('候选目标区间', { exact: true })).toContainText('4–8 秒');
  await candidate(page).getByRole('button', { name: '预览候选', exact: true }).click();
  await expect.poll(async () => Number(await slider(page).inputValue())).toBe(4);
  await seek(page, 6);
  await expect.poll(async () => (await pose(page)).root).toEqual([.3, 1.1, 0]);
  expect((await backup(page)).scene.project).toEqual(before.scene.project);
  await candidate(page).getByRole('button', { name: '采用候选', exact: true }).click();
  const adopted = await backup(page);
  expectOriginal(current(adopted), original);
  expect(current(adopted).aiMotion!.patches[0].target).toEqual(request.context.target);
  expect(adopted.scene.project.history).toHaveLength(before.scene.project.history.length + 1);
  for (const at of [0, 3.713, 4, 8, 8.237, 16]) {
    await seek(page, at);
    await expect.poll(async () => pose(page)).toEqual(sampleTake(original.take!, at));
  }
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  expect(current(await backup(page))).toEqual(original);
  await page.getByRole('button', { name: '重做', exact: true }).click();
  expect(current(await backup(page))).toEqual(current(adopted));
  await seek(page, 6); await save(page);
  const saved = await backup(page);
  await page.reload(); await ready(page);
  const reopened = await backup(page);
  // Undo and redo advance the monotonic revision; compare the actual saved authority.
  expect(reopened.scene.project).toEqual(saved.scene.project);
  await expectedVisible(page, reopened, 6);
  expect(await audioHash(page)).toBe(expectedAudio);
  const pending = page.waitForEvent('download');
  await clickRevealed(page, hiddenButton(page, '下载完整场景包'));
  const path = await (await pending).path(); expect(path).toBeTruthy();
  const bytes = await readFile(path!), magic = Buffer.from('CHOREO-BUNDLE-1\n');
  expect(bytes.subarray(0, magic.length)).toEqual(magic);
  const length = bytes.readUInt32LE(magic.length), header = JSON.parse(bytes.subarray(magic.length + 4, magic.length + 4 + length).toString('utf8'));
  expect(unpackScene(header.scene).project).toEqual(reopened.scene.project);
  expect(bytes.subarray(magic.length + 4 + length)).toEqual(fixture.wave);
  await closeDisclosures(page);
  await page.getByRole('button', { name: '场景', exact: true }).click();
  await page.getByRole('dialog', { name: '本机场景', exact: true }).getByRole('button', { name: '导入场景备份', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '导入场景备份', exact: true });
  await dialog.getByLabel('选择场景备份文件', { exact: true }).setInputFiles({ name: 'ai-motion-preserved.choreo', mimeType: 'application/octet-stream', buffer: bytes });
  await expect(dialog.getByRole('button', { name: '作为新场景导入', exact: true })).toBeEnabled();
  await dialog.getByRole('button', { name: '作为新场景导入', exact: true }).click();
  await expect(dialog).toHaveCount(0); await ready(page);
  const imported = await backup(page);
  expect(imported.scene.project).toEqual({ ...reopened.scene.project, teacherCheckedRevision: null });
  expectOriginal(current(imported), original);
  await expectedVisible(page, imported, 6);
  expect(await audioHash(page)).toBe(expectedAudio);
  await screenshot(page, info, 'ai-motion-interval-restored.png');
  expect(calls).toHaveLength(1);
});

test('@ai-motion rejects invalid/provider results without templates or retry and refuses stale candidates', async ({ page }) => {
  test.setTimeout(120_000);
  const calls = await mockMotion(page, async (request, index, route) => {
    if (index === 1) await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ code: 'AI_GENERATION_FAILED' }) });
    else {
      const result: AIMotionResult = makeAIMotionResultFixture(request);
      if (index === 0) result.keyframes[0].time = request.context.target.endSeconds + 1;
      if (index === 2) result.keyframes[0].time = .02;
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(result) });
    }
  });
  await openFixture(page);
  const before = await backup(page);
  await generate(page);
  await expect(page.getByRole('alert')).toContainText('无法使用的动作数据');
  await expect(candidate(page)).toHaveCount(0);
  expect((await backup(page)).scene.project).toEqual(before.scene.project);
  await page.waitForTimeout(200); expect(calls).toHaveLength(1);
  await generate(page);
  await expect(page.getByRole('alert')).toContainText('生成失败');
  await expect(candidate(page)).toHaveCount(0);
  expect((await backup(page)).scene.project).toEqual(before.scene.project);
  await page.waitForTimeout(200); expect(calls).toHaveLength(2);
  await generate(page);
  await expect(candidate(page)).toBeVisible();
  await expect(candidate(page).getByRole('status')).toContainText('较急的移动或转动');
  await closeDisclosures(page);
  await page.getByRole('button', { name: '在当前时间记录镜头', exact: true }).click();
  // A committed source revision invalidates and clears the earlier candidate.
  await expect(candidate(page)).toHaveCount(0);
  const changed = await backup(page);
  expect(current(changed).aiMotion).toBeUndefined();
  expect(current(changed).take).toEqual(current(before).take);
  await expect(page.getByRole('button', { name: '采用候选', exact: true })).toHaveCount(0);
  expect((await backup(page)).scene.project).toEqual(changed.scene.project);
  expect(calls).toHaveLength(3);
});
