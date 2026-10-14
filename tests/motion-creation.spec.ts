import { writeFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import { closeDisclosures } from './helpers';
import { backup, current, diagnostics, openFixture, screenshot } from './realismHelpers';

const observations = new WeakMap<Page, {
  diagnostics: ReturnType<typeof diagnostics>;
  posts: string[];
  motionPriorRequests: string[];
}>();

test.beforeEach(async ({ page }) => {
  const report = { diagnostics: diagnostics(page), posts: [] as string[], motionPriorRequests: [] as string[] };
  observations.set(page, report);
  page.on('request', request => {
    if (request.method() === 'POST') report.posts.push(request.url());
    if (new URL(request.url()).pathname.startsWith('/motion-priors/')) report.motionPriorRequests.push(request.url());
  });
  await page.route('**/api/**', route => route.abort('blockedbyclient'));
  // Fail closed for a future generator pointed outside the ordinary API.
  // This test must never reach a real provider even if the UI regresses.
  await page.route('**/*', route => route.request().method() === 'POST' ? route.abort('blockedbyclient') : route.fallback());
});

test.afterEach(async ({ page }, info) => {
  const report = observations.get(page)!;
  await info.attach('creation-network-and-browser-diagnostics', { body: JSON.stringify(report), contentType: 'application/json' });
  await writeFile(info.outputPath('creation-network-and-browser-diagnostics.json'), JSON.stringify(report, null, 2));
  expect(report.diagnostics).toEqual({ errors: [], warnings: [], expectedHttpErrors: [], apiRequests: [] });
  expect(report.posts).toEqual([]);
  expect(report.motionPriorRequests).toEqual([]);
});

async function audioHash(page: Page): Promise<string> {
  return page.locator('audio').evaluate(async (audio: HTMLAudioElement) => {
    const bytes = await (await fetch(audio.src)).arrayBuffer();
    return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(value => value.toString(16).padStart(2, '0')).join('');
  });
}

async function selectInterval(page: Page, start: number, end: number): Promise<void> {
  for (const [time, boundary] of [[start, '起点'], [end, '终点']] as const) {
    await page.getByRole('slider', { name: '时间线进度', exact: true }).evaluate((element: HTMLInputElement, value) => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(element, String(value));
      element.dispatchEvent(new Event('input', { bubbles: true }));
      element.dispatchEvent(new Event('change', { bubbles: true }));
    }, time);
    await expect.poll(async () => Number(await page.getByRole('img', { name: '人体编舞动作预览', exact: true }).getAttribute('data-render-time'))).toBeCloseTo(time, 12);
    await page.getByRole('button', { name: `设为选区${boundary}`, exact: true }).click();
  }
}

test('@motion-creation a fresh 32-second Chinese dance request stays in creation mode without borrowing a prior, calling a model or changing the original', async ({ page }, info) => {
  test.setTimeout(120_000);
  await openFixture(page, false, source => {
    // An owned blank scene has no previously generated dance to borrow. Its
    // locally generated audio covers the whole CountMap without any upload.
    source.scene.name = '32 秒新动作创作回归';
    const snapshot = source.scene.project.history[0];
    snapshot.countMap.durationSeconds = snapshot.plan.durationSeconds = source.take.durationSeconds = 32;
    snapshot.countMap.octetCount = 8;
    snapshot.countMap.countTimesSeconds = Array.from({ length: 65 }, (_, index) => index * .5);
    const slots = snapshot.plan.slots;
    snapshot.plan.slots = Array.from({ length: 8 }, (_, slotIndex) => ({
      ...slots[slotIndex % slots.length], slotIndex, startSeconds: slotIndex * 4, endSeconds: (slotIndex + 1) * 4,
      countStart: slotIndex * 8 + 1, countEnd: (slotIndex + 1) * 8,
      role: slotIndex === 0 ? 'opening' as const : slotIndex === 7 ? 'closing' as const : 'body' as const,
    }));
    source.take.times = source.take.times.map(time => time * 2);
    for (const pose of source.take.poses) {
      pose.joints.LeftUpperArm = [0, 0, Math.sin(Math.PI / 24), Math.cos(Math.PI / 24)];
      pose.joints.RightUpperArm = [0, 0, -Math.sin(Math.PI / 24), Math.cos(Math.PI / 24)];
    }
    source.scene.project.audioDuration = 36;
    const rate = source.wave.readUInt32LE(24), samples = rate * 36;
    const wave = Buffer.alloc(44 + samples * 2);
    source.wave.copy(wave, 0, 0, 44);
    wave.writeUInt32LE(wave.length - 8, 4);
    wave.writeUInt32LE(samples * 2, 40);
    for (let index = 0; index < samples; index++) wave.writeInt16LE(Math.round(Math.sin(index / rate * Math.PI * 2 * 440) * 1200), 44 + index * 2);
    source.wave = wave;
  });
  const before = await backup(page), original = current(before), originalAudio = await audioHash(page);
  expect(original.countMap.durationSeconds).toBe(32);
  expect(original.aiMotion).toBeUndefined();
  expect(new Set(original.take!.poses.map(pose => JSON.stringify(pose))).size).toBe(1);

  await closeDisclosures(page);
  await selectInterval(page, 4, 9.5);
  await page.getByLabel('AI 动作', { exact: true }).click();
  const creation = page.getByRole('radio', { name: '创作新动作', exact: true });
  const arrangement = page.getByRole('radio', { name: '编排已有素材', exact: true });
  const prompt = page.getByRole('textbox', { name: '动作描述', exact: true });
  const intent = '创作一段中国古典舞，轻柔舒展，手臂划圆后侧步收势。';
  await expect(creation).toBeChecked();
  await expect(arrangement).not.toBeChecked();
  await expect(page.getByLabel('AI 目标区间', { exact: true })).toContainText('4 秒–9.5 秒');
  await prompt.fill(intent);
  const createButton = page.getByRole('button', { name: '创作新动作', exact: true });
  await expect(createButton).toBeVisible();
  await expect(createButton).toBeDisabled();
  // Exercise a native activation attempt: a disabled button must not dispatch
  // generation, rather than merely showing a warning after spending a call.
  await createButton.evaluate((button: HTMLButtonElement) => button.click());
  await expect(page.getByRole('region', { name: 'AI 候选', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '采用候选', exact: true })).toHaveCount(0);

  // Switching is an explicit preference only. It retains the user's intent
  // and cannot submit a planning request or invent an accepted candidate.
  await arrangement.check();
  await expect(arrangement).toBeChecked();
  await expect(prompt).toHaveValue(intent);
  await expect(page.getByLabel('AI 目标区间', { exact: true })).toContainText('只编排这一段');
  await expect(page.getByRole('button', { name: '编排素材候选', exact: true })).toBeEnabled();
  await creation.check();
  await expect(creation).toBeChecked();
  await expect(prompt).toHaveValue(intent);
  await expect(createButton).toBeDisabled();
  await expect(page.getByLabel('AI 目标区间', { exact: true })).toContainText('只创作这一段');
  await expect(page.getByRole('button', { name: '编排素材候选', exact: true })).toHaveCount(0);

  await screenshot(page, info, 'motion-creation-unavailable-1440.png');
  await page.setViewportSize({ width: 390, height: 900 });
  await expect(creation).toBeVisible();
  await expect(arrangement).toBeVisible();
  for (const mode of [creation, arrangement]) {
    // The associated label is the touch target; the radio itself stays small.
    const touchTarget = await mode.locator('..').boundingBox();
    expect(touchTarget).toBeTruthy();
    expect(touchTarget!.height).toBeGreaterThanOrEqual(44);
  }
  await expect(createButton).toBeVisible();
  await expect(createButton).toBeDisabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await screenshot(page, info, 'motion-creation-unavailable-390.png');

  const after = await backup(page);
  expect(after.scene.project).toEqual(before.scene.project);
  expect(current(after).take).toEqual(original.take);
  expect(current(after).manual).toEqual(original.manual);
  expect(current(after).cameraTrack).toEqual(original.cameraTrack);
  expect(current(after).countMap).toEqual(original.countMap);
  expect(current(after).aiMotion).toBeUndefined();
  expect(await audioHash(page)).toBe(originalAudio);
  expect(observations.get(page)!.posts).toEqual([]);
  expect(observations.get(page)!.motionPriorRequests).toEqual([]);
});
