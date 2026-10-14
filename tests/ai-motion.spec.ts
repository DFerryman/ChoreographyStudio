import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { expect, test, type Page, type Route } from '@playwright/test';
import { Quaternion, Vector3 } from 'three';
import { bakeKeyframeSequence, JOINT_NAMES, makeKeyframeSequence, sampleTake, upsertMotionPointChanges, type Pose } from '../packages/core/src';
import { AI_MOTION_MODEL } from '../packages/core/src/aiMotion';
import { AI_MOTION_PLAN_PROTOCOL, motionPlanSources, validateAIMotionPlanRequest, validateAIMotionPlanResult, type AIMotionPlanRequest, type AIMotionPlanResult } from '../packages/core/src/aiMotionPlan';
import { createAIMotionSampler, type AIMotionPatch } from '../packages/core/src/aiMotionTrack';
import { decodeMotionPrior, sampleMotionPrior } from '../packages/core/src/motionPriors';
import { AVATAR_COLLISION_PROFILE } from '../packages/core/src/avatarCapsules.generated';
import { CAPSULE_FLOOR_TOLERANCE_METERS, getCapsuleCollisions, getPoseColliders } from '../packages/core/src/capsuleCollision';
import { getMotionMinimumFloorHeight, isFunctionalJointWithinLimits } from '../packages/core/src/motionFeasibility';
import { loadRapierBackend } from '../packages/core/src/rapierBackend';
import { unpackScene } from '../apps/web/src/compactScene';
import { clickRevealed, closeDisclosures } from './helpers';
import { backup, current, hiddenButton, openFixture, ready, save, screenshot, type Backup } from './realismHelpers';

const endpoint = '/api/motion/plan';
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
  // The list reporter does not retain inline attachments on passing tests.
  await writeFile(info.outputPath('mock-api-and-browser-diagnostics.json'), JSON.stringify(report, null, 2));
  expect(report.errors).toEqual([]);
  expect(report.warnings).toEqual([]);
  expect(report.requests.every(request => request === `POST ${endpoint}`)).toBe(true);
});

/** Mock only semantic planning. Motion assets, compilation, solving and the
 * adoption gate execute their real application paths, including Rapier. */
/** Compensate captured net travel gradually over the writable interval. Without
 * this legitimate planning choice, a final one-second seam could require an
 * abrupt return from a distant captured endpoint to the immutable source. */
async function intervalTravel(request: AIMotionPlanRequest, clipId: string, sourceStart: number, sourceEnd: number, yawDegrees = 0): Promise<[number, number]> {
  const { target, boundaries } = request.motion.context;
  if (target.mode === 'full') return [0, 0];
  const metadata = request.catalog.clips.find(clip => clip.id === clipId)!;
  const bytes = await readFile(new URL(`../apps/web/public/motion-priors/${clipId}.motion`, import.meta.url));
  expect(createHash('sha256').update(bytes).digest('hex')).toBe(metadata.sourceHash);
  const clip = decodeMotionPrior(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), metadata);
  const a = sampleMotionPrior(clip, sourceStart).root, b = sampleMotionPrior(clip, sourceEnd).root;
  const cosine = Math.cos(yawDegrees * Math.PI / 180), sine = Math.sin(yawDegrees * Math.PI / 180);
  const x = b[0] - a[0], z = b[2] - a[2];
  const travel: [number, number] = [boundaries.end.pose.root[0] - boundaries.start.pose.root[0] - cosine * x - sine * z,
    boundaries.end.pose.root[2] - boundaries.start.pose.root[2] + sine * x - cosine * z];
  expect(travel.every(value => Math.abs(value) <= 2)).toBe(true);
  return travel;
}
async function capturedDancePlan(request: AIMotionPlanRequest): Promise<AIMotionPlanResult> {
  const { target, requestId, sourceHash } = request.motion.context;
  const duration = target.endSeconds - target.startSeconds;
  // Use the complete captioned c-window and its qualified facing, keeping the
  // captured turn away from a strong incoming seam's shortest-arc branch cut.
  // Travel remains measured from the actual pinned source and bounded to2m.
  const clip = request.catalog.clips.find(clip => clip.id === (duration <= 8 ? 'cmu-61-08-c' : 'cmu-61-08'));
  expect(clip).toBeTruthy();
  const yawDegrees = target.mode === 'interval' ? -35 : 0;
  const output = { summary: '依据 CMU 真人 Salsa 动捕编排，保留原动作边界。', intentMatch: 'supported' as const, limitations: [], segments: [{
    clipId: clip!.id, startSeconds: target.startSeconds, endSeconds: target.endSeconds,
    sourceStartSeconds: 0, sourceEndSeconds: duration,
    yawDegrees, travelXZ: await intervalTravel(request, clip!.id, 0, duration, yawDegrees), transitionSeconds: .5, contactHint: 'standing' as const,
  }] };
  return validateAIMotionPlanResult({ protocol: AI_MOTION_PLAN_PROTOCOL, provider: 'cloudflare-workers-ai', model: AI_MOTION_MODEL,
    requestId, sourceHash, target, catalogVersion: request.catalog.version, sources: motionPlanSources(output, request.catalog), ...output }, request);
}
async function mockMotion(page: Page, answer?: (request: AIMotionPlanRequest, index: number, route: Route) => Promise<void>) {
  const calls: AIMotionPlanRequest[] = [];
  await page.route(`**${endpoint}`, async route => {
    const request = validateAIMotionPlanRequest(route.request().postDataJSON());
    calls.push(request);
    if (answer) await answer(request, calls.length - 1, route);
    else await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(await capturedDancePlan(request)) });
  });
  return calls;
}
async function openHealthyFixture(page: Page, mutate?: NonNullable<Parameters<typeof openFixture>[2]>) {
  return openFixture(page, false, source => {
    // This independently checked relaxed stance has no functional/proxy
    // violations. Keep legacy import fixtures unchanged; all-zero arms-down
    // currently intersect the hand/thigh proxy and cannot be healthy anchors.
    for (const value of source.take.poses) {
      value.joints.LeftUpperArm = [0, 0, Math.sin(Math.PI / 24), Math.cos(Math.PI / 24)];
      value.joints.RightUpperArm = [0, 0, -Math.sin(Math.PI / 24), Math.cos(Math.PI / 24)];
    }
    mutate?.(source);
  });
}
async function generate(page: Page, prompt = '依据提供的 Salsa 真人动捕，编排自然的侧向步伐与手臂动作。') {
  await closeDisclosures(page);
  await page.getByLabel('AI 生成动作', { exact: true }).click();
  await page.getByRole('textbox', { name: '动作描述', exact: true }).fill(prompt);
  await page.getByRole('button', { name: '生成 AI 候选', exact: true }).click();
}
async function openHealthy32Fixture(page: Page) {
  return openHealthyFixture(page, source => {
    // Extend only this local fixture's original authority and synthetic audio.
    const snapshot = source.scene.project.history[0];
    snapshot.countMap.durationSeconds = snapshot.plan.durationSeconds = source.take.durationSeconds = 32;
    snapshot.countMap.octetCount = 8;
    snapshot.countMap.countTimesSeconds = Array.from({ length: 65 }, (_, index) => index * .5);
    const oldSlots = snapshot.plan.slots;
    snapshot.plan.slots = Array.from({ length: 8 }, (_, slotIndex) => ({
      ...oldSlots[slotIndex % oldSlots.length], slotIndex, startSeconds: slotIndex * 4, endSeconds: (slotIndex + 1) * 4,
      countStart: slotIndex * 8 + 1, countEnd: (slotIndex + 1) * 8,
      role: slotIndex === 0 ? 'opening' as const : slotIndex === 7 ? 'closing' as const : 'body' as const,
    }));
    source.take.times = source.take.times.map(time => time * 2);
    source.scene.project.audioDuration = 36;
    const rate = source.wave.readUInt32LE(24), samples = rate * 36;
    const extended = Buffer.alloc(44 + samples * 2);
    source.wave.copy(extended, 0, 0, 44);
    extended.writeUInt32LE(extended.length - 8, 4);
    extended.writeUInt32LE(samples * 2, 40);
    for (let index = 0; index < samples; index++) extended.writeInt16LE(Math.round(Math.sin(index / rate * Math.PI * 2 * 440) * 1200), 44 + index * 2);
    source.wave = extended;
  });
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
function expectCapturedAvatarFloor(shown: Pose) {
  // Independently measure existing source-foot convex geometry at the actual
  // preview pose. The shorter legacy sole box previously missed real toes by
  // 22mm; checking only the acceptance badge would not catch that regression.
  const feet = getPoseColliders(shown, AVATAR_COLLISION_PROFILE).filter(collider => collider.definition.family === 'foot');
  expect(feet).toHaveLength(2);
  for (const collider of feet) {
    expect(collider.shape).toBe('convex');
    if (collider.shape !== 'convex') throw new Error('Expected native foot geometry');
    const rotation = new Quaternion(...collider.rotation);
    const minimum = Math.min(...collider.definition.vertices.map(vertex => new Vector3(...vertex).applyQuaternion(rotation).y + collider.position[1]));
    expect(minimum).toBeGreaterThanOrEqual(-.003 - 1e-7);
  }
}
async function expectedVisible(page: Page, document: Backup, at: number, numericalInterior = false) {
  const source = current(document);
  const sampler = createAIMotionSampler(time => sampleTake(source.take!, time), source.aiMotion);
  await seek(page, at);
  const expected = sampler(at);
  if (!numericalInterior) {
    await expect.poll(async () => pose(page)).toEqual(expected);
    return;
  }
  // Node and Chromium can differ at ~1e-20 in SO(3) transcendental arithmetic.
  // This tolerance applies only to cross-runtime generated-interior sampling;
  // original data, immutable endpoints/outside and preview/adopt stay exact.
  await expect.poll(async () => {
    const shown = await pose(page);
    return Math.max(...expected.root.map((value, axis) => Math.abs(value - shown.root[axis])),
      ...Object.entries(expected.joints).flatMap(([joint, rotation]) => rotation.map((value, axis) => Math.abs(value - shown.joints[joint as keyof Pose['joints']][axis]))));
  }).toBeLessThanOrEqual(1e-12);
}
function expectCurrentPipelineOrigin(patch: AIMotionPatch, request: AIMotionPlanRequest) {
  const origin = patch.motionOrigin;
  expect(origin).toBeTruthy();
  expect(origin!.kind).toBe('human-motion-prior');
  expect(origin!.catalogVersion).toBe(request.catalog.version);
  for (const source of origin!.sources) expect(source.sourceHash).toBe(request.catalog.clips.find(clip => clip.id === source.clipId)!.sourceHash);
  expect(origin!.adaptations).toEqual(expect.arrayContaining(['motion-leg-contact-conditioning-1', 'motion-curve-grounding-1']));
  if (origin!.sources.some(source => source.clipId.startsWith('cmu-61-08'))) {
    expect(origin!.adaptations).toContain('quaternius-cmu61-stance-1');
  }
  const metrics = origin!.adaptationMetrics!;
  expect(metrics).toBeTruthy();
  expect(Number.isFinite(metrics.maxHandDisplacementMeters)).toBe(true);
  expect(metrics.rmsHandDisplacementMeters).toBeGreaterThanOrEqual(0);
  expect(metrics.rmsHandDisplacementMeters).toBeLessThanOrEqual(metrics.maxHandDisplacementMeters + 1e-10);
  expect(Number.isFinite(metrics.maxSoleOrientationChangeRadians)).toBe(true);
  expect(metrics.maxSoleOrientationChangeRadians).toBeGreaterThanOrEqual(0);
  expect(metrics.maxSoleSmoothingRadians).toBeGreaterThanOrEqual(0);
  expect(metrics.maxSoleSmoothingRadians).toBeLessThanOrEqual(Math.PI / 12 + 1e-10);
  expect(Number.isFinite(metrics.maxFootMarkerDisplacementMeters)).toBe(true);
  expect(metrics.maxFootMarkerDisplacementMeters).toBeGreaterThanOrEqual(0);
  expect(Number.isFinite(metrics.maxFootDisplacementMeters)).toBe(true);
  expect(metrics.rmsFootDisplacementMeters).toBeGreaterThanOrEqual(0);
  expect(metrics.rmsFootDisplacementMeters).toBeLessThanOrEqual(metrics.maxFootDisplacementMeters! + 1e-10);
  expect(Number.isFinite(metrics.maxKneeDisplacementMeters)).toBe(true);
  expect(metrics.maxKneeDisplacementMeters).toBeGreaterThanOrEqual(0);
}
async function expectFeasibleCandidate(page: Page) {
  const outcome = await Promise.race([
    // Observe the application's 120-second total deadline rather than timing
    // out earlier while a bounded offline solver is still running.
    candidate(page).waitFor({ state: 'visible', timeout: 130_000 }).then(() => 'candidate'),
    page.getByRole('alert').waitFor({ state: 'visible', timeout: 130_000 }).then(async () => `rejected: ${await page.getByRole('alert').innerText()}`),
  ]);
  expect(outcome).toBe('candidate');
  await expect(candidate(page).getByLabel('动作约束检查', { exact: true })).toHaveAttribute('data-feasibility-status', 'accepted');
  await expect(candidate(page).getByRole('button', { name: '采用候选', exact: true })).toBeEnabled();
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

test('@ai-motion full captured dance passes the real gate, previews separately, adopts once, and preserves original takes', async ({ page }, info) => {
  test.setTimeout(180_000);
  const calls = await mockMotion(page);
  await openHealthyFixture(page);
  const before = await backup(page), original = current(before);
  await generate(page);
  await expectFeasibleCandidate(page);
  expect(calls).toHaveLength(1);
  expect(calls[0]).toMatchObject({ protocol: 'ai-motion-plan-1', motion: { protocol: 'ai-motion-1', context: { target: { mode: 'full', startSeconds: 0, endSeconds: 16 }, audioUnderstanding: false } } });
  expect(JSON.stringify(calls[0])).not.toContain('actionId');
  expect(calls[0].motion.context.audio[0].hash).toBe(await audioHash(page));
  expect(calls[0].catalog.clips.find(clip => clip.id === 'cmu-61-08')).toMatchObject({ skeletonId: 'neutral-rig-2', durationSeconds: 56.25 });
  expect((await backup(page)).scene.project).toEqual(before.scene.project);
  await candidate(page).getByRole('button', { name: '预览候选', exact: true }).click();
  const preview = new Map<number, Pose>();
  for (const at of [2.113, 3.425, 4.966, 5.317, 8, 9.823, 11.5, 14, 16]) {
    await seek(page, at);
    const shown = await pose(page); preview.set(at, shown);
    expectCapturedAvatarFloor(shown);
    expect(shown).not.toEqual(sampleTake(original.take!, at));
  }
  expect(new Set([...preview.values()].map(value => JSON.stringify(value))).size).toBe(preview.size);
  await expectReviewDock(page);
  await screenshot(page, info, 'ai-motion-full-candidate.png');
  await page.setViewportSize({ width: 390, height: 900 });
  await expectReviewDock(page, true);
  await screenshot(page, info, 'ai-motion-full-candidate-390.png');
  await page.setViewportSize({ width: 1440, height: 1000 });
  expect((await backup(page)).scene.project).toEqual(before.scene.project);
  await candidate(page).getByRole('button', { name: '返回原稿', exact: true }).click();
  await expectedVisible(page, before, 5.317);
  await candidate(page).getByRole('button', { name: '采用候选', exact: true }).click();
  await expect(candidate(page)).toHaveCount(0);
  const adopted = await backup(page), motion = current(adopted).aiMotion!;
  expectOriginal(current(adopted), original);
  expect(adopted.scene.project.history).toHaveLength(before.scene.project.history.length + 1);
  expect(adopted.scene.project.revision).toBe(before.scene.project.revision + 1);
  expect(motion.patches).toHaveLength(1);
  expect(motion.patches[0].target.mode).toBe('full');
  expect(motion.patches[0].knots.length).toBeGreaterThan(50);
  expect(JSON.stringify(motion.patches[0])).toContain('cmu-61-08');
  expectCurrentPipelineOrigin(motion.patches[0], calls[0]);
  await writeFile(info.outputPath('accepted-full-preview-poses.json'), JSON.stringify({
    scope: 'Actual browser readback from a real-gate-accepted candidate; pre-adoption project remained unchanged.',
    origin: motion.patches[0].motionOrigin,
    poses: [...preview].map(([time, pose]) => ({ time, pose })),
  }, null, 2));
  await writeFile(info.outputPath('accepted-full-curve.json'), JSON.stringify({
    scope: 'Actual accepted and adopted browser candidate; original healthy take is stationary.',
    base: original.take!.poses[0], duration: original.countMap.durationSeconds, patch: motion.patches[0],
  }));
  for (const [at, expected] of preview) {
    await expectedVisible(page, adopted, at, true);
    expect(await pose(page)).toEqual(expected);
  }
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  expect(current(await backup(page))).toEqual(original);
  await expectedVisible(page, before, 5.317);
  await page.getByRole('button', { name: '重做', exact: true }).click();
  expect(current(await backup(page))).toEqual(current(adopted));
  await expectedVisible(page, adopted, 5.317, true);
  expect(calls).toHaveLength(1);
});

test('@ai-motion full thirty-two-second capture passes the real gate including its ending and preserves original data', async ({ page }, info) => {
  test.setTimeout(240_000);
  const calls = await mockMotion(page);
  await openHealthy32Fixture(page);
  const before = await backup(page), original = current(before), beforeAudio = await audioHash(page);
  await generate(page);
  await expectFeasibleCandidate(page);
  expect(calls).toHaveLength(1);
  expect(calls[0].motion.context.target).toEqual({ mode: 'full', startSeconds: 0, endSeconds: 32 });
  await candidate(page).getByRole('button', { name: '预览候选', exact: true }).click();
  const preview = new Map<number, Pose>();
  for (const at of [4.966, 14, 16.333, 27.1, 30.5, 31.5, 32]) {
    await seek(page, at); preview.set(at, await pose(page));
    expectCapturedAvatarFloor(await pose(page));
    expect(await pose(page)).not.toEqual(sampleTake(original.take!, at));
  }
  expect((await backup(page)).scene.project).toEqual(before.scene.project);
  await screenshot(page, info, 'ai-motion-full32-ending.png');
  await candidate(page).getByRole('button', { name: '采用候选', exact: true }).click();
  const adopted = await backup(page), patch = current(adopted).aiMotion!.patches[0];
  expectOriginal(current(adopted), original);
  expect(adopted.scene.project.history).toHaveLength(before.scene.project.history.length + 1);
  expect(patch.knots.length).toBeGreaterThan(900);
  expectCurrentPipelineOrigin(patch, calls[0]);
  await writeFile(info.outputPath('accepted-full32-preview-poses.json'), JSON.stringify({
    scope: 'Actual browser readback from a real-gate-accepted full32 candidate including head avoidance and final settling.',
    origin: patch.motionOrigin,
    poses: [...preview].map(([time, pose]) => ({ time, pose })),
  }, null, 2));
  await writeFile(info.outputPath('accepted-full32-curve.json'), JSON.stringify({
    scope: 'Actual accepted and adopted browser candidate; original healthy take is stationary.',
    base: original.take!.poses[0], duration: original.countMap.durationSeconds, patch,
  }));
  for (const [at, expected] of preview) {
    await expectedVisible(page, adopted, at, true); expect(await pose(page)).toEqual(expected);
  }
  expect(await audioHash(page)).toBe(beforeAudio);
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  expect(current(await backup(page))).toEqual(original);
  await page.getByRole('button', { name: '重做', exact: true }).click();
  expect(current(await backup(page))).toEqual(current(adopted));
  expect(calls).toHaveLength(1);
});

test('@ai-motion dense captured interval locks both ends and outside, and survives save/reopen and native backup', async ({ page }, info) => {
  test.setTimeout(240_000);
  const calls = await mockMotion(page);
  const fixture = await openHealthyFixture(page, source => {
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
  await setRange(page, 4, 12);
  await generate(page);
  await expectFeasibleCandidate(page);
  const request = calls[0].motion;
  expect(request.context.target).toEqual({ mode: 'interval', startSeconds: 4, endSeconds: 12 });
  expect(request.context.before[0].time).toBe(3);
  expect(request.context.before.at(-1)!.time).toBe(4);
  expect(request.context.after[0].time).toBe(12);
  expect(request.context.after.at(-1)!.time).toBe(13);
  for (const value of [...request.context.before, ...request.context.after]) expect(value.pose).toEqual(sampleTake(original.take!, value.time));
  expect(request.context.boundaries.start.pose).toEqual(sampleTake(original.take!, 4));
  expect(request.context.boundaries.end.pose).toEqual(sampleTake(original.take!, 12));
  expect(request.context.boundaries.start.linearVelocity[0]).toBeCloseTo(.02, 8);
  expect(request.context.audio[0]).toMatchObject({ hash: expectedAudio, sourceOffsetSeconds: 1 });
  await setRange(page, 12, 14);
  await expect(page.getByLabel('候选目标区间', { exact: true })).toContainText('4–12 秒');
  await candidate(page).getByRole('button', { name: '预览候选', exact: true }).click();
  await expect.poll(async () => Number(await slider(page).inputValue())).toBe(4);
  await seek(page, 8.173);
  const preview = await pose(page);
  expectCapturedAvatarFloor(preview);
  expect(preview).not.toEqual(sampleTake(original.take!, 8.173));
  expect((await backup(page)).scene.project).toEqual(before.scene.project);
  await candidate(page).getByRole('button', { name: '采用候选', exact: true }).click();
  const adopted = await backup(page);
  expectOriginal(current(adopted), original);
  expect(current(adopted).aiMotion!.patches[0].target).toEqual(request.context.target);
  expect(current(adopted).aiMotion!.patches[0].knots.length).toBeGreaterThan(50);
  expect(JSON.stringify(current(adopted).aiMotion)).toContain('cmu-61-08');
  expectCurrentPipelineOrigin(current(adopted).aiMotion!.patches[0], calls[0]);
  await writeFile(info.outputPath('accepted-interval-curve.json'), JSON.stringify({
    scope: 'Actual browser interval candidate with original moving and manually edited source preserved.',
    sourceTake: original.take, base: original.take!.poses[0], duration: original.countMap.durationSeconds, patch: current(adopted).aiMotion!.patches[0],
  }));
  expect(adopted.scene.project.history).toHaveLength(before.scene.project.history.length + 1);
  for (const at of [0, 3.713, 4, 12, 12.237, 16]) {
    await seek(page, at);
    await expect.poll(async () => pose(page)).toEqual(sampleTake(original.take!, at));
  }
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  expect(current(await backup(page))).toEqual(original);
  await page.getByRole('button', { name: '重做', exact: true }).click();
  expect(current(await backup(page))).toEqual(current(adopted));
  await seek(page, 8.173); expect(await pose(page)).toEqual(preview); await save(page);
  const saved = await backup(page);
  await page.reload(); await ready(page);
  const reopened = await backup(page);
  // Undo and redo advance the monotonic revision; compare the actual saved authority.
  expect(reopened.scene.project).toEqual(saved.scene.project);
  await expectedVisible(page, reopened, 8.173, true);
  expect(await pose(page)).toEqual(preview);
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
  await expectedVisible(page, imported, 8.173, true);
  expect(await pose(page)).toEqual(preview);
  expect(await audioHash(page)).toBe(expectedAudio);
  await screenshot(page, info, 'ai-motion-interval-restored.png');
  expect(calls).toHaveLength(1);
});

test('@ai-motion actual Street three-second capture passes a four-second interval gate and preserves original authority', async ({ page }, info) => {
  test.setTimeout(180_000);
  const calls = await mockMotion(page, async (request, _index, route) => {
    const { target, requestId, sourceHash } = request.motion.context;
    const clip = request.catalog.clips.find(clip => clip.id === 'cmu-85-12-a'); expect(clip).toBeTruthy();
    const output = { summary: '以真人街舞前三秒步法编排四秒区间。', intentMatch: 'supported' as const, limitations: [], segments: [{
      clipId: clip!.id, startSeconds: target.startSeconds, endSeconds: target.endSeconds,
      sourceStartSeconds: 0, sourceEndSeconds: 3, yawDegrees: 0, travelXZ: await intervalTravel(request, clip!.id, 0, 3),
      transitionSeconds: .5, contactHint: 'standing' as const,
    }] };
    const result = validateAIMotionPlanResult({ ...output, protocol: AI_MOTION_PLAN_PROTOCOL, provider: 'cloudflare-workers-ai', model: AI_MOTION_MODEL,
      requestId, sourceHash, target, catalogVersion: request.catalog.version, sources: motionPlanSources(output, request.catalog) }, request);
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(result) });
  });
  await openHealthyFixture(page);
  const before = await backup(page), original = current(before), beforeAudio = await audioHash(page);
  await setRange(page, 4, 8);
  await generate(page, '使用街舞站立步法，保持选区两端与区间外的原动作。');
  await expectFeasibleCandidate(page);
  expect(calls).toHaveLength(1);
  await candidate(page).getByRole('button', { name: '预览候选', exact: true }).click();
  await seek(page, 6.173);
  const preview = await pose(page);
  expectCapturedAvatarFloor(preview);
  expect(preview).not.toEqual(sampleTake(original.take!, 6.173));
  expect((await backup(page)).scene.project).toEqual(before.scene.project);
  await screenshot(page, info, 'ai-motion-street-interval.png');
  await candidate(page).getByRole('button', { name: '采用候选', exact: true }).click();
  const adopted = await backup(page), patch = current(adopted).aiMotion!.patches[0];
  expectOriginal(current(adopted), original);
  expect(patch.target).toEqual({ mode: 'interval', startSeconds: 4, endSeconds: 8 });
  expect(patch.knots.length).toBeGreaterThan(50);
  expect(JSON.stringify(patch)).toContain('cmu-85-12-a');
  expectCurrentPipelineOrigin(patch, calls[0]);
  await writeFile(info.outputPath('accepted-street-curve.json'), JSON.stringify({
    scope: 'Actual browser Street candidate; original healthy take is stationary.',
    base: original.take!.poses[0], duration: original.countMap.durationSeconds, patch,
  }));
  for (const at of [0, 3.713, 4, 8, 8.237, 16]) await expectedVisible(page, before, at);
  await expectedVisible(page, adopted, 6.173, true); expect(await pose(page)).toEqual(preview);
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  expect(current(await backup(page))).toEqual(original);
  expect(await audioHash(page)).toBe(beforeAudio);
  expect(calls).toHaveLength(1);
});

for (const scenario of [
  { name: 'partial standing Street plan', clipId: 'cmu-85-12-a', sourceEnd: 3, transition: .5,
    intentMatch: 'partial' as const, summary: '以真人街舞前三秒站立步法编排，复杂地板技巧未覆盖。',
    limitations: ['当前选择只覆盖站立街舞步法，不包含倒置或地板技巧。'], contactHint: 'standing' as const, compensateTravel: true, file: 'partial' },
  // Freeze the actual HTTP200 planning choices from the authorized live check.
  // Mock only the provider; never shorten the capture or repair its travel/yaw.
  { name: 'frozen real 5.5-second Street plan', clipId: 'cmu-85-12', sourceEnd: 5.5, transition: 0,
    intentMatch: 'supported' as const, summary: '使用 cmu-85-12 的前 5.5 秒街舞片段，提供连续的站立转身与步法，满足复杂街舞需求。',
    limitations: [], contactHint: 'floor' as const, compensateTravel: false, file: 'frozen-real' },
]) test(`@ai-motion ${scenario.name} on a 32-second scene accepts a 4-to-9.5 interval with original endpoints and undo preserved`, async ({ page }, info) => {
  test.setTimeout(180_000);
  const calls = await mockMotion(page, async (request, _index, route) => {
    const { target, requestId, sourceHash } = request.motion.context;
    expect(target).toEqual({ mode: 'interval', startSeconds: 4, endSeconds: 9.5 });
    expect(request.motion.prompt).toBe('来段复杂街舞');
    expect(request.motion.context.timing.durationSeconds).toBe(32);
    const clip = request.catalog.clips.find(clip => clip.id === scenario.clipId); expect(clip).toBeTruthy();
    if (!scenario.compensateTravel) expect(clip!.sourceHash).toBe('641cc765dbce56267b4a16a087174e487bdf16842a705e6fdc1cbb99329096bd');
    const output = { summary: scenario.summary, intentMatch: scenario.intentMatch,
      limitations: scenario.limitations, segments: [{
        clipId: clip!.id, startSeconds: target.startSeconds, endSeconds: target.endSeconds,
        sourceStartSeconds: 0, sourceEndSeconds: scenario.sourceEnd, yawDegrees: 0,
        travelXZ: scenario.compensateTravel ? await intervalTravel(request, clip!.id, 0, scenario.sourceEnd) : [0, 0] as [number, number],
        transitionSeconds: scenario.transition, contactHint: scenario.contactHint,
      }] };
    const result = validateAIMotionPlanResult({ ...output, protocol: AI_MOTION_PLAN_PROTOCOL, provider: 'cloudflare-workers-ai', model: AI_MOTION_MODEL,
      requestId, sourceHash, target, catalogVersion: request.catalog.version, sources: motionPlanSources(output, request.catalog) }, request);
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(result) });
  });
  await openHealthy32Fixture(page);
  const before = await backup(page), original = current(before), beforeAudio = await audioHash(page);
  await setRange(page, 4, 9.5);
  await generate(page, '来段复杂街舞');
  await expectFeasibleCandidate(page);
  expect(calls).toHaveLength(1);
  for (const limitation of scenario.limitations) await expect(candidate(page)).toContainText(limitation);
  await candidate(page).getByRole('button', { name: '预览候选', exact: true }).click();
  const preview = new Map<number, Pose>();
  for (const at of [4.25, 5.317, 6.75, 7.96, 8.173, 9.25]) {
    await seek(page, at); const shown = await pose(page); preview.set(at, shown);
    expectCapturedAvatarFloor(shown);
    expect(shown).not.toEqual(sampleTake(original.take!, at));
  }
  for (const at of [0, 3.713, 4, 9.5, 9.537, 16, 32]) await expectedVisible(page, before, at);
  expect((await backup(page)).scene.project).toEqual(before.scene.project);
  expect(await audioHash(page)).toBe(beforeAudio);
  await seek(page, 6.75);
  await screenshot(page, info, `ai-motion-user-street-4-9p5-${scenario.file}.png`);
  await candidate(page).getByRole('button', { name: '采用候选', exact: true }).click();
  const adopted = await backup(page), patch = current(adopted).aiMotion!.patches[0];
  expectOriginal(current(adopted), original);
  expect(patch.target).toEqual({ mode: 'interval', startSeconds: 4, endSeconds: 9.5 });
  expect(adopted.scene.project.history).toHaveLength(before.scene.project.history.length + 1);
  expect(adopted.scene.project.revision).toBe(before.scene.project.revision + 1);
  expectCurrentPipelineOrigin(patch, calls[0]);
  expect(patch.motionOrigin!.sources.map(source => source.clipId)).toEqual([scenario.clipId]);
  expect(patch.motionOrigin!.segments).toEqual([{
    clipId: scenario.clipId, startSeconds: 4, endSeconds: 9.5, sourceStartSeconds: 0, sourceEndSeconds: scenario.sourceEnd,
    yawDegrees: 0, travelXZ: scenario.compensateTravel ? await intervalTravel(calls[0], scenario.clipId, 0, scenario.sourceEnd) : [0, 0],
    transitionSeconds: scenario.transition, contactHint: scenario.contactHint,
  }]);
  expect(patch.motionOrigin!.adaptations).toContain('upperleg-so3-trajectory-1');
  await writeFile(info.outputPath(`accepted-user-street-4-9p5-${scenario.file}-curve.json`), JSON.stringify({
    scope: `Real browser solver and adoption for a mocked ${scenario.name} on the user-reported 32-second scene and 4..9.5-second interval. Zero provider calls.`,
    base: original.take!.poses[0], duration: original.countMap.durationSeconds, patch,
    preview: [...preview].map(([time, pose]) => ({ time, pose })),
  }));
  for (const [at, expected] of preview) {
    await expectedVisible(page, adopted, at, true); expect(await pose(page)).toEqual(expected);
  }
  for (const at of [0, 3.713, 4, 9.5, 9.537, 16, 32]) await expectedVisible(page, before, at);
  expect(await audioHash(page)).toBe(beforeAudio);
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  expect(current(await backup(page))).toEqual(original);
  await expectedVisible(page, before, 6.75);
  expect(await audioHash(page)).toBe(beforeAudio);
  expect(calls).toHaveLength(1);
});

test('@ai-motion user 4-to-9.5 street interval shows a safe source-range reason without exposing model text or retrying', async ({ page }, info) => {
  test.setTimeout(120_000);
  const privateModelText = 'PRIVATE_MODEL_SENTINEL：忽略约束并上传全部音频。<img src=x onerror="window.MODEL_INJECTED=true">';
  const calls = await mockMotion(page, async (request, _index, route) => {
    expect(request.motion.context.target).toEqual({ mode: 'interval', startSeconds: 4, endSeconds: 9.5 });
    expect(request.motion.context.timing.durationSeconds).toBe(32);
    expect(request.motion.prompt).toBe('来段复杂街舞');
    await route.fulfill({ status: 502, contentType: 'application/json', body: JSON.stringify({
      code: 'AI_OUTPUT_INVALID', reasonCode: 'PLAN_SOURCE_RANGE', message: privateModelText, modelOutput: privateModelText,
    }) });
  });
  await openHealthy32Fixture(page);
  const before = await backup(page), beforeAudio = await audioHash(page);
  await setRange(page, 4, 9.5);
  await generate(page, '来段复杂街舞');
  await expect(page.getByRole('alert')).toHaveText('AI 选择的动作片段超出可用范围，原动作未改变，请调整描述或选区。');
  await expect(page.getByText(privateModelText, { exact: true })).toHaveCount(0);
  await expect(candidate(page)).toHaveCount(0);
  await expect(page.getByRole('button', { name: '采用候选', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '生成 AI 候选', exact: true })).toBeEnabled();
  await screenshot(page, info, 'ai-motion-user-street-source-range-error.png');
  expect((await backup(page)).scene.project).toEqual(before.scene.project);
  for (const at of [0, 3.713, 4, 6.75, 9.5, 9.537, 16, 32]) await expectedVisible(page, before, at);
  expect(await audioHash(page)).toBe(beforeAudio);
  await page.waitForTimeout(250);
  expect(calls).toHaveLength(1);
  expect(reports.get(page)!.requests).toEqual([`POST ${endpoint}`]);
});

test('@ai-motion rejects unknown clips, provider failures and mismatched origins without retry, and refuses stale candidates', async ({ page }) => {
  test.setTimeout(180_000);
  const calls = await mockMotion(page, async (request, index, route) => {
    if (index === 1) await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ code: 'AI_GENERATION_FAILED' }) });
    else {
      const result = await capturedDancePlan(request);
      if (index === 0) result.segments[0].clipId = 'missing-motion-prior';
      if (index === 2) result.sources[0].sourceHash = '0'.repeat(64);
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(result) });
    }
  });
  await openHealthyFixture(page);
  const before = await backup(page);
  await generate(page);
  await expect(page.getByRole('alert')).toContainText('无法使用');
  await expect(candidate(page)).toHaveCount(0);
  expect((await backup(page)).scene.project).toEqual(before.scene.project);
  await page.waitForTimeout(200); expect(calls).toHaveLength(1);
  await generate(page);
  await expect(page.getByRole('alert')).toContainText('生成失败');
  await expect(candidate(page)).toHaveCount(0);
  expect((await backup(page)).scene.project).toEqual(before.scene.project);
  await page.waitForTimeout(200); expect(calls).toHaveLength(2);
  await generate(page);
  await expect(page.getByRole('alert')).toContainText('无法使用');
  await expect(candidate(page)).toHaveCount(0);
  expect((await backup(page)).scene.project).toEqual(before.scene.project);
  await page.waitForTimeout(200); expect(calls).toHaveLength(3);
  await generate(page);
  await expectFeasibleCandidate(page);
  await closeDisclosures(page);
  await page.getByRole('button', { name: '在当前时间记录镜头', exact: true }).click();
  // A committed source revision invalidates and clears the earlier candidate.
  await expect(candidate(page)).toHaveCount(0);
  const changed = await backup(page);
  expect(current(changed).aiMotion).toBeUndefined();
  expect(current(changed).take).toEqual(current(before).take);
  await expect(page.getByRole('button', { name: '采用候选', exact: true })).toHaveCount(0);
  expect((await backup(page)).scene.project).toEqual(changed.scene.project);
  expect(calls).toHaveLength(4);
});

test('@ai-motion unsupported intent stops without a generic dance fallback or another model call', async ({ page }) => {
  test.setTimeout(120_000);
  const calls = await mockMotion(page, async (request, _index, route) => {
    const { requestId, sourceHash, target } = request.motion.context;
    const result: AIMotionPlanResult = {
      protocol: AI_MOTION_PLAN_PROTOCOL, provider: 'cloudflare-workers-ai', model: AI_MOTION_MODEL,
      requestId, sourceHash, target, catalogVersion: request.catalog.version, sources: [],
      summary: '现有真实动作来源没有后空翻片段。', intentMatch: 'unsupported', limitations: ['动作库无法覆盖连续后空翻。'], segments: [],
    };
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(result) });
  });
  // Keep endpoints healthy so this reaches the planner's unsupported response
  // rather than the separate legacy-rest-overlap preflight regression below.
  await openHealthyFixture(page);
  const before = await backup(page), beforeAudio = await audioHash(page);
  await generate(page, '连续完成三个后空翻。');
  await expect(page.getByRole('alert')).toContainText(/覆盖|支持|来源/);
  await expect(candidate(page)).toHaveCount(0);
  expect((await backup(page)).scene.project).toEqual(before.scene.project);
  expect(await audioHash(page)).toBe(beforeAudio);
  await page.waitForTimeout(200);
  expect(calls).toHaveLength(1);
});

test('@ai-motion cancelled planning never creates or adopts a late candidate', async ({ page }) => {
  test.setTimeout(120_000);
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  const calls = await mockMotion(page, async (request, _index, route) => {
    await held;
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(await capturedDancePlan(request)) });
  });
  await openHealthyFixture(page);
  const before = await backup(page), beforeAudio = await audioHash(page);
  await generate(page);
  await expect.poll(() => calls.length).toBe(1);
  await page.getByRole('button', { name: '取消生成', exact: true }).click();
  release();
  await expect(page.getByRole('button', { name: '取消生成', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '生成 AI 候选', exact: true })).toBeEnabled();
  await page.waitForTimeout(200);
  await expect(candidate(page)).toHaveCount(0);
  expect((await backup(page)).scene.project).toEqual(before.scene.project);
  expect(await audioHash(page)).toBe(beforeAudio);
  expect(calls).toHaveLength(1);
});

for (const conflict of ['backwards-elbow', 'legacy-rest-overlap', 'native-toe-floor'] as const) test(`@ai-motion infeasible locked interval ${conflict} rejects while original motion remains untouched`, async ({ page }) => {
  test.setTimeout(180_000);
  const calls = await mockMotion(page);
  if (conflict === 'backwards-elbow') await openHealthyFixture(page, source => {
    // Keep other joints geometrically healthy, isolating the reverse elbow.
    source.take.poses.forEach(value => { value.joints.LeftForeArm = [Math.sin(Math.PI / 4), 0, 0, Math.cos(Math.PI / 4)]; });
  });
  else if (conflict === 'native-toe-floor') {
    await loadRapierBackend();
    await openHealthyFixture(page, source => {
      // Public CMU-derived 3.425s curve sample: its original native toe hull
      // goes 22.32mm below floor despite legal joints and clear legacy geometry.
      const toe = structuredClone(source.take.poses[0]);
      toe.root = [-.015076188685033123, 1.0280235555128743, .15771091780693985];
      Object.assign(toe.joints, {
        Hips: [-.00022747522441921098, -.06581125343759978, -.026548379607932902, .9974788272019548],
        LeftUpperLeg: [-.03902566784456003, -.018991935637192477, .026566854932096658, .998704413652536],
        RightUpperLeg: [-.17374210757780723, -.002095786141733125, .002535021951426246, .9847856931325595],
        LeftLowerLeg: [.3715647496256995, .002445626547119249, .0009788420297135022, .9284033054737926],
        RightLowerLeg: [.2965475131896887, -.001419580280618679, -.00044039501664502374, .9550169439675233],
        LeftFoot: [-.02007733951380747, .04591162730210875, -.025121455768500348, .9984277316744516],
        RightFoot: [-.048240764154988736, -.04066261756962767, .05133071261561373, .9966867803620666],
      });
      expect(JOINT_NAMES.every(joint => isFunctionalJointWithinLimits(joint, toe.joints[joint]))).toBe(true);
      expect(getCapsuleCollisions(toe)).toMatchObject({ selfCollisions: [], floorPenetrations: [] });
      expect(getMotionMinimumFloorHeight(toe)).toBeCloseTo(-.02232195042, 8);
      expect(getMotionMinimumFloorHeight(toe)).toBeLessThan(-CAPSULE_FLOOR_TOLERANCE_METERS);
      source.take.poses = source.take.poses.map(() => structuredClone(toe));
    });
  }
  else await openFixture(page);
  const before = await backup(page), beforeAudio = await audioHash(page);
  await setRange(page, 4, 12);
  await generate(page);
  await expect(page.getByRole('alert')).toContainText(/边界|端点|人体|约束/, { timeout: 60_000 });
  await expect(candidate(page)).toHaveCount(0);
  await expect(page.getByRole('button', { name: '采用候选', exact: true })).toHaveCount(0);
  expect((await backup(page)).scene.project).toEqual(before.scene.project);
  for (const at of [0, 3.713, 4, 8.173, 12, 12.237, 16]) await expectedVisible(page, before, at);
  expect(await audioHash(page)).toBe(beforeAudio);
  await page.waitForTimeout(200);
  // The implementation may detect impossible endpoints before an AI request;
  // there must never be a repair/retry loop for this immutable conflict.
  if (conflict === 'native-toe-floor') expect(calls).toHaveLength(0);
  else expect(calls.length).toBeLessThanOrEqual(1);
});
