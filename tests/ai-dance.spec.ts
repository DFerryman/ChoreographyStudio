import { writeFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import { sampleTake, type Pose } from '../packages/core/src';
import { DANCE_PLAN_MODEL, DANCE_PLAN_PROTOCOL, validateDancePlanRequest, type DancePlanRequest, type DancePlanResult } from '../packages/core/src/dancePlan';
import { closeDisclosures } from './helpers';
import { backup, current, openFixture, screenshot } from './realismHelpers';

const endpoint = '/api/dance/plan';
const candidate = (page: Page) => page.getByRole('region', { name: 'AI 候选', exact: true });
const canvas = (page: Page) => page.getByRole('img', { name: '人体编舞动作预览', exact: true });
const slider = (page: Page) => page.getByRole('slider', { name: '时间线进度', exact: true });
const reports = new WeakMap<Page, { errors: string[]; warnings: string[]; requests: string[] }>();

test.beforeEach(async ({ page }) => {
  const report = { errors: [] as string[], warnings: [] as string[], requests: [] as string[] };
  reports.set(page, report);
  page.on('pageerror', error => report.errors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'warning') report.warnings.push(message.text());
    // A deliberately failing mocked planner logs its HTTP status; nothing else may.
    if (message.type() === 'error' && !(message.location().url?.includes(endpoint) && /^Failed to load resource:/.test(message.text()))) report.errors.push(message.text());
  });
  page.on('request', request => { const path = new URL(request.url()).pathname; if (path.startsWith('/api/')) report.requests.push(`${request.method()} ${path}`); });
  // No unmocked business endpoint can reach a real service or real inference.
  await page.route('**/api/**', route => route.abort('blockedbyclient'));
});
test.afterEach(async ({ page }, info) => {
  const report = reports.get(page)!;
  await writeFile(info.outputPath('browser-diagnostics.json'), JSON.stringify(report, null, 2));
  expect(report.errors).toEqual([]);
  expect(report.warnings).toEqual([]);
  expect(report.requests.every(request => request === `POST ${endpoint}`)).toBe(true);
});

/** Mock only the semantic planner. Synthesis, the feasibility gate (with
 * Rapier), adoption and undo run their real application paths. */
async function mockPlanner(page: Page, answer: (request: DancePlanRequest) => { status: number; body: unknown }) {
  const calls: DancePlanRequest[] = [];
  await page.route(`**${endpoint}`, async route => {
    const request = validateDancePlanRequest(route.request().postDataJSON());
    calls.push(request);
    const { status, body } = answer(request);
    await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
  });
  return calls;
}
const aiPlan = (): DancePlanResult => ({ protocol: DANCE_PLAN_PROTOCOL, source: 'ai', model: DANCE_PLAN_MODEL, plan: {
  summary: '流行律动：点步、手臂波浪、转身与定格。', style: 'pop', energy: 'medium',
  moves: [{ move: 'groove', beats: 4, mirror: false }, { move: 'step-touch', beats: 4, mirror: false }, { move: 'arm-wave', beats: 4, mirror: true },
    { move: 'turn', beats: 4, mirror: false }, { move: 'pose', beats: 2, mirror: false }],
} });
async function openHealthyFixture(page: Page) {
  return openFixture(page, false, source => {
    for (const value of source.take.poses) {
      value.joints.LeftUpperArm = [0, 0, Math.sin(Math.PI / 24), Math.cos(Math.PI / 24)];
      value.joints.RightUpperArm = [0, 0, -Math.sin(Math.PI / 24), Math.cos(Math.PI / 24)];
    }
  });
}
async function generate(page: Page, prompt: string) {
  await closeDisclosures(page);
  await page.getByLabel('AI 生成动作', { exact: true }).click();
  await page.getByRole('textbox', { name: '动作描述', exact: true }).fill(prompt);
  await page.getByRole('button', { name: '生成 AI 候选', exact: true }).click();
  const outcome = await Promise.race([
    candidate(page).waitFor({ state: 'visible', timeout: 150_000 }).then(() => 'candidate'),
    page.getByRole('alert').waitFor({ state: 'visible', timeout: 150_000 }).then(async () => `rejected: ${await page.getByRole('alert').innerText()}`),
  ]);
  expect(outcome).toBe('candidate');
  await expect(candidate(page).getByLabel('动作约束检查', { exact: true })).toHaveAttribute('data-feasibility-status', 'accepted');
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
function maxDifference(a: Pose, b: Pose): number {
  let difference = Math.max(...a.root.map((value, axis) => Math.abs(value - b.root[axis])));
  for (const joint of Object.keys(a.joints) as (keyof Pose['joints'])[]) difference = Math.max(difference, ...a.joints[joint].map((value, axis) => Math.abs(value - b.joints[joint][axis])));
  return difference;
}
async function pose(page: Page): Promise<Pose> { return JSON.parse((await canvas(page).getAttribute('data-render-pose'))!); }

test('@ai-dance full-scene plan is synthesized, passes the gate, previews, adopts once and undoes', async ({ page }, info) => {
  test.setTimeout(240_000);
  const calls = await mockPlanner(page, () => ({ status: 200, body: aiPlan() }));
  await openHealthyFixture(page);
  const before = await backup(page), original = current(before);
  await generate(page, '来一段流行舞，有点步和转身');
  expect(calls).toHaveLength(1);
  // Only the description and coarse musical framing leave the browser.
  expect(Object.keys(calls[0]).sort()).toEqual(['beatSeconds', 'beats', 'bpm', 'prompt', 'protocol', 'target']);
  expect(calls[0].target).toEqual({ mode: 'full', durationSeconds: 16 });
  await expect(candidate(page).getByLabel('规划来源', { exact: true })).toHaveCount(0);
  expect((await backup(page)).scene.project).toEqual(before.scene.project);
  await candidate(page).getByRole('button', { name: '预览候选', exact: true }).click();
  const shown: Pose[] = [];
  for (const at of [3.1, 6.4, 9.7, 12.2]) { await seek(page, at); shown.push(await pose(page)); expect(shown.at(-1)).not.toEqual(sampleTake(original.take!, at)); }
  expect(new Set(shown.map(value => JSON.stringify(value))).size).toBe(shown.length);
  await screenshot(page, info, 'ai-dance-full-candidate.png');
  await candidate(page).getByRole('button', { name: '采用候选', exact: true }).click();
  await expect(candidate(page)).toHaveCount(0);
  const adopted = await backup(page), motion = current(adopted).aiMotion!;
  expect(current(adopted).take).toEqual(original.take);
  expect(adopted.scene.project.history).toHaveLength(before.scene.project.history.length + 1);
  expect(motion.patches).toHaveLength(1);
  expect(motion.patches[0]).toMatchObject({ provider: 'cloudflare-workers-ai', model: DANCE_PLAN_MODEL, target: { mode: 'full', startSeconds: 0, endSeconds: 16 },
    motionOrigin: { kind: 'dance-synthesis', generator: 'dance-synth-1', planSource: 'ai', style: 'pop' } });
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  expect(current(await backup(page))).toEqual(original);
  await page.getByRole('button', { name: '重做', exact: true }).click();
  expect(current(await backup(page))).toEqual(current(adopted));
});

test('@ai-dance a failing planner falls back to the local planner and still yields an accepted candidate', async ({ page }) => {
  test.setTimeout(240_000);
  const calls = await mockPlanner(page, () => ({ status: 503, body: { code: 'AI_UNAVAILABLE', message: 'AI 生成暂时不可用。' } }));
  await openHealthyFixture(page);
  await generate(page, '街舞，有力量的出拳和律动');
  expect(calls).toHaveLength(1);
  await expect(candidate(page).getByLabel('规划来源', { exact: true })).toContainText('AI 服务暂时不可用');
  await candidate(page).getByRole('button', { name: '采用候选', exact: true }).click();
  const motion = current(await backup(page)).aiMotion!;
  expect(motion.patches[0]).toMatchObject({ provider: 'local', model: 'local-dance-planner-1', motionOrigin: { kind: 'dance-synthesis', planSource: 'local', style: 'hiphop' } });
});

test('@ai-dance an off-beat range is regenerated with both ends and the outside unchanged', async ({ page }) => {
  test.setTimeout(240_000);
  const calls = await mockPlanner(page, () => ({ status: 200, body: { ...aiPlan(), plan: { ...aiPlan().plan, moves: [{ move: 'turn', beats: 8, mirror: false }] } } }));
  await openHealthyFixture(page);
  const original = current(await backup(page));
  await seek(page, 4.37);
  await page.getByRole('button', { name: '设为选区起点', exact: true }).click();
  await seek(page, 9.81);
  await page.getByRole('button', { name: '设为选区终点', exact: true }).click();
  // Range buttons place the ends on the actual (frame) grid; read them back.
  const track = page.locator('.tl-count-track');
  const start = Number(await track.getAttribute('data-range-start')), end = Number(await track.getAttribute('data-range-end'));
  expect(start % .5).not.toBe(0); expect(end % .5).not.toBe(0);
  // The application's own rendering of the original before generation.
  const checks = [1.2, start, end, 13.4], before = new Map<number, Pose>();
  for (const at of checks) { await seek(page, at); before.set(at, await pose(page)); }
  await generate(page, '转身');
  expect(calls[0].target).toEqual({ mode: 'interval', durationSeconds: end - start });
  await candidate(page).getByRole('button', { name: '采用候选', exact: true }).click();
  const adopted = current(await backup(page));
  expect(adopted.aiMotion!.patches[0].target).toEqual({ mode: 'interval', startSeconds: start, endSeconds: end });
  // Seeking may land one ulp inside the range, where the seam is continuous
  // to ~1e-30; outside and at both ends the original is kept.
  for (const at of checks) { await seek(page, at); expect(maxDifference(await pose(page), before.get(at)!), `time ${at}`).toBeLessThan(1e-12); }
  await seek(page, 7); expect(await pose(page)).not.toEqual(sampleTake(original.take!, 7));
});
