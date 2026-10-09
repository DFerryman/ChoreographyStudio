import { expect, test, type Page, type Route } from '@playwright/test';
import { AI_MODEL, AI_PROTOCOL, type AIChoreographyRequest } from '../packages/core/src/aiChoreography';
import { backup, current, diagnostics, frame, numeric, openFixture, ready, save } from './realismHelpers';
import { clickRevealed, reveal } from './helpers';

const endpoint = '**/api/choreography/generate';
const reports = new WeakMap<Page, ReturnType<typeof diagnostics>>();
test.beforeEach(async ({ page }) => {
  reports.set(page, diagnostics(page));
  // Fail closed for every API request, then override only generation with a
  // fixture. This applies to local and bounded online runs alike: no AI usage.
  await page.route('**/api/**', route => route.abort('blockedbyclient'));
});
test.afterEach(async ({ page }, info) => {
  const report = reports.get(page)!;
  await info.attach('mock-ai-browser-console-and-api', { body: JSON.stringify(report), contentType: 'application/json' });
  expect(report.errors).toEqual([]); expect(report.warnings).toEqual([]);
  expect(report.apiRequests.every(value => value === 'POST /api/choreography/generate')).toBe(true);
});

function result(request: AIChoreographyRequest, summary = '模拟结果 · 本地无推理') {
  return {
    protocol: AI_PROTOCOL, provider: 'cloudflare-workers-ai', model: AI_MODEL,
    countMapId: request.timing.countMapId, countMapVersion: request.timing.countMapVersion,
    durationSeconds: request.timing.durationSeconds,
    arrangement: { summary, slots: Array.from({ length: request.timing.octetCount }, (_, index) => ({ actionId: index % 2 ? 'side-reach' : 'step-touch', amplitude: .5 })) },
  };
}
async function fulfill(route: Route, value: unknown, status = 200) {
  await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(value) });
}
async function request(page: Page, prompt = '舒展手臂，动作幅度适中') {
  const input = page.getByRole('textbox', { name: '动作描述', exact: true, includeHidden: true });
  await reveal(page, input); await input.fill(prompt);
  await page.getByRole('button', { name: '生成 AI 候选', exact: true }).click();
}
const candidate = (page: Page) => page.getByLabel('辅助候选', { exact: true });

test('@ai mocked generation sends only description and confirmed timing; preview is read only and explicit adoption can be undone', async ({ page }) => {
  const inputs: AIChoreographyRequest[] = [];
  await page.route(endpoint, async route => {
    const input = route.request().postDataJSON() as AIChoreographyRequest; inputs.push(input);
    await fulfill(route, result(input));
  });
  const source = await openFixture(page), original = await backup(page);
  expect(inputs).toEqual([]);
  await request(page);
  await expect(candidate(page)).toContainText('AI 编排候选');
  await expect(candidate(page)).toContainText('模拟结果 · 本地无推理');
  expect(inputs).toHaveLength(1);
  expect(Object.keys(inputs[0]).sort()).toEqual(['prompt', 'protocol', 'timing']);
  expect(Object.keys(inputs[0].timing).sort()).toEqual(['bpm', 'confirmed', 'countMapId', 'countMapVersion', 'durationSeconds', 'musicBeatsPerDanceCount', 'octetCount']);
  expect(inputs[0].timing).toMatchObject({ countMapId: source.scene.project.history[0].countMap.id, bpm: 120, octetCount: 4, durationSeconds: 16, confirmed: true });
  expect(JSON.stringify(inputs[0])).not.toMatch(/realism-original\.wav|poses|manual|baseTake|audio|blob:/);
  expect((await backup(page)).scene.project).toEqual(original.scene.project);
  await candidate(page).getByRole('button', { name: '预览候选', exact: true }).click();
  await expect(candidate(page).getByRole('button', { name: '返回原稿', exact: true })).toBeVisible();
  expect((await backup(page)).scene.project).toEqual(original.scene.project);
  await candidate(page).getByRole('button', { name: '返回原稿', exact: true }).click();
  await candidate(page).getByRole('button', { name: '采用候选', exact: true }).click();
  await expect(candidate(page)).toHaveCount(0);
  const adopted = await backup(page), snapshot = current(adopted);
  expect(snapshot.take!.id).not.toBe(source.take.id);
  expect(snapshot.take!.countMapId).toBe(source.take.countMapId);
  expect(snapshot.take!.times.at(-1)).toBe(16);
  expect(snapshot.plan!.slots.map(slot => slot.actionId)).toEqual(['step-touch', 'side-reach', 'step-touch', 'side-reach']);
  expect(adopted.scene.project.revision).toBe(original.scene.project.revision + 1);
  await save(page); await page.reload(); await ready(page);
  expect((await backup(page)).scene.project).toEqual(adopted.scene.project);
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  expect(current(await backup(page)).take).toEqual(source.take);
  expect(inputs).toHaveLength(1);
  expect(reports.get(page)!.expectedHttpErrors).toEqual([]);
});

test('@ai cancel invalidates a delayed mock result and cannot replace a subsequent candidate', async ({ page }) => {
  const inputs: AIChoreographyRequest[] = [];
  let release: () => void = () => {};
  const gate = new Promise<void>(resolve => { release = resolve; });
  let resolved: () => void = () => {};
  const finished = new Promise<void>(resolve => { resolved = resolve; });
  await page.route(endpoint, async route => {
    const input = route.request().postDataJSON() as AIChoreographyRequest; inputs.push(input);
    if (inputs.length === 1) {
      await gate;
      try { await fulfill(route, result(input, '已取消的迟到结果')); } catch { /* The aborted browser request may already be gone. */ }
      finally { resolved(); }
    } else await fulfill(route, result(input, '当前候选 · 第二次显式请求'));
  });
  await openFixture(page); const original = await backup(page);
  await request(page, '第一个描述');
  await expect(page.getByRole('button', { name: '取消生成', exact: true })).toBeVisible();
  await expect.poll(() => inputs.length).toBe(1);
  await page.getByRole('button', { name: '取消生成', exact: true }).click();
  await expect(page.getByRole('button', { name: '生成 AI 候选', exact: true })).toBeEnabled();
  await request(page, '第二个描述');
  await expect(candidate(page)).toContainText('当前候选 · 第二次显式请求');
  release(); await finished;
  await expect(candidate(page)).toContainText('当前候选 · 第二次显式请求');
  await expect(candidate(page)).not.toContainText('已取消的迟到结果');
  expect(inputs).toHaveLength(2);
  expect((await backup(page)).scene.project).toEqual(original.scene.project);
  expect(reports.get(page)!.expectedHttpErrors).toEqual([]);
});

for (const [status, response] of [
  [429, { code: 'AI_RATE_LIMITED', message: 'AI 生成每分钟最多两次，请稍后再试。' }],
  [502, { code: 'AI_GENERATION_FAILED', message: 'AI 生成失败，请稍后手动重试。' }],
] as const) test(`@ai a mocked HTTP ${status} failure leaves the original editable and never automatically retries`, async ({ page }) => {
  let calls = 0;
  await page.route(endpoint, async route => { calls++; await fulfill(route, response, status); });
  await openFixture(page); const original = await backup(page);
  await request(page);
  await expect(page.getByRole('button', { name: '生成 AI 候选', exact: true })).toBeEnabled();
  await expect(page.getByRole('status').filter({ hasText: response.message })).toBeVisible();
  await expect(candidate(page)).toHaveCount(0);
  expect((await backup(page)).scene.project).toEqual(original.scene.project);
  await frame(page, 60); await numeric(page, 'Root X 位移（米）', .1);
  await clickRevealed(page, page.getByRole('button', { name: 'K 位移', exact: true, includeHidden: true }));
  expect(current(await backup(page)).manual!.root).toHaveLength(1);
  expect(calls).toBe(1);
  expect(reports.get(page)!.expectedHttpErrors).toHaveLength(1);
});

test('@ai a mismatched CountMap response is rejected before any candidate or history change', async ({ page }) => {
  let calls = 0;
  await page.route(endpoint, async route => {
    calls++; const response = result(route.request().postDataJSON() as AIChoreographyRequest); response.countMapId = 'another-project';
    await fulfill(route, response);
  });
  await openFixture(page); const original = await backup(page);
  await request(page);
  await expect(page.getByRole('button', { name: '生成 AI 候选', exact: true })).toBeEnabled();
  await expect(page.getByRole('status').filter({ hasText: 'AI 返回了无法使用的编排，请稍后手动重试。' })).toBeVisible();
  await expect(candidate(page)).toHaveCount(0);
  expect((await backup(page)).scene.project).toEqual(original.scene.project);
  expect(calls).toBe(1); expect(reports.get(page)!.expectedHttpErrors).toEqual([]);
});

test('@ai editing the original invalidates a mock candidate and removes its adoption action', async ({ page }) => {
  let calls = 0;
  await page.route(endpoint, async route => { calls++; await fulfill(route, result(route.request().postDataJSON() as AIChoreographyRequest)); });
  await openFixture(page);
  await request(page); await expect(candidate(page)).toContainText('AI 编排候选');
  await frame(page, 60); await numeric(page, 'Root X 位移（米）', .1);
  await clickRevealed(page, page.getByRole('button', { name: 'K 位移', exact: true, includeHidden: true }));
  const edited = await backup(page);
  await expect(candidate(page)).toHaveCount(0);
  await expect(page.getByRole('button', { name: '采用候选', exact: true })).toHaveCount(0);
  expect(current(edited).manual!.root).toHaveLength(1);
  expect(calls).toBe(1); expect(reports.get(page)!.expectedHttpErrors).toEqual([]);
});
