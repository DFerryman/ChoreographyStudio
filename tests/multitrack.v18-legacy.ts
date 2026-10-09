import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import {
  bakeKeyframeSequence, makeKeyframeSequence, rotationFromDegrees,
  upsertRootKeyframe, upsertRotationKeyframe, type BakedTake, type JointName,
} from '../packages/core/src';
import type { SceneSnapshot } from '../apps/web/src/sceneProject';
import { clickRevealed } from './helpers';
import {
  backup, current, diagnostics, draft, frame, hiddenButton, numeric,
  openFixture, ready, save, screenshot,
} from './realismHelpers';
import { expectStageValue, stageValue } from './stageInteractions';

// Seed a valid local scene, then operate its real canvas, buttons and pointer
// handlers. Exact exported sparse tracks expose changes hidden by interpolation.
const reports = new WeakMap<Page, ReturnType<typeof diagnostics>>();
test.beforeEach(async ({ page }) => {
  reports.set(page, diagnostics(page));
  await page.route('**/api/**', route => route.abort('blockedbyclient'));
});
test.afterEach(async ({ page }, info) => {
  const report = reports.get(page)!;
  await info.attach('browser-console-and-api', { body: JSON.stringify(report), contentType: 'application/json' });
  expect(report).toEqual({ errors: [], warnings: [], expectedHttpErrors: [], apiRequests: [] });
});

const timeline = (page: Page) => page.getByRole('region', { name: '手动关键帧时间线', exact: true });
const cursor = (page: Page) => timeline(page).getByRole('spinbutton', { name: '当前帧', exact: true });
const lane = (page: Page, id: string) => timeline(page).locator(`.kf-lane[data-track-id="${id}"]`);
const mark = (page: Page, id: string, at: number) => lane(page, id).locator(`.kf-lane-key[data-frame="${at}"]`);
const clip = (page: Page) => timeline(page).getByRole('button', { name: '移动音频片段', exact: true });
const collision = (page: Page) => page.getByRole('dialog', { name: '目标帧已有关键帧', exact: true });

async function closeDisclosures(page: Page) {
  const opened = page.locator('details[open]');
  while (await opened.count()) {
    await opened.last().locator(':scope > summary').click();
  }
}

async function keyedScene(page: Page) {
  let base!: BakedTake;
  const source = await openFixture(page, false, seed => {
    base = structuredClone(seed.take);
    let manual = makeKeyframeSequence(base);
    manual = upsertRootKeyframe(manual, 30, [.2, 1.05, 0]);
    manual = upsertRootKeyframe(manual, 90, [.8, 1.05, 0]);
    const rotations: [JointName, number, number][] = [
      ['LeftUpperArm', 30, 20], ['LeftUpperArm', 90, 35],
      ['LeftForeArm', 30, 10], ['LeftHand', 90, 4],
      ['RightUpperArm', 30, -20], ['Chest', 60, 4], ['LeftFoot', 30, 3],
    ];
    for (const [joint, at, angle] of rotations) {
      manual = upsertRotationKeyframe(manual, joint, at, rotationFromDegrees([0, 0, angle]));
    }
    const take = bakeKeyframeSequence(manual);
    Object.assign(seed.scene.project.history[0], { manual, take });
    // openFixture verifies the actual authority against this supplied take.
    seed.take = take;
  });
  const initial = await backup(page);
  await closeDisclosures(page);
  return { source, base, initial };
}

async function audioHash(page: Page) {
  return page.locator('audio').evaluate(async (audio: HTMLAudioElement) => {
    const bytes = await (await fetch(audio.src)).arrayBuffer();
    return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), byte => byte.toString(16).padStart(2, '0')).join('');
  });
}

async function watchStageProjection(page: Page) {
  await page.evaluate(() => {
    const stage = document.querySelector<HTMLElement>('.stage3d')!;
    const state = { pointer: null as number | null, downOffset: null as number | null, heldOffsets: [] as number[], releaseOffset: null as number | null, cleanup: () => {} };
    const offset = () => Number(stage.getAttribute('data-camera-offset-y'));
    const down = (event: PointerEvent) => {
      if (!(event.target instanceof HTMLCanvasElement) || !stage.contains(event.target) || event.button !== 0) return;
      state.pointer = event.pointerId; state.downOffset = offset(); state.heldOffsets.push(offset());
    };
    const move = (event: PointerEvent) => { if (event.pointerId === state.pointer) state.heldOffsets.push(offset()); };
    const up = (event: PointerEvent) => {
      if (event.pointerId !== state.pointer) return;
      state.releaseOffset = offset(); state.pointer = null;
    };
    const observer = new MutationObserver(() => { if (state.pointer !== null) state.heldOffsets.push(offset()); });
    observer.observe(stage, { attributes: true, attributeFilter: ['data-camera-offset-y'] });
    document.addEventListener('pointerdown', down, true); document.addEventListener('pointermove', move, true); document.addEventListener('pointerup', up, true);
    state.cleanup = () => {
      observer.disconnect(); document.removeEventListener('pointerdown', down, true);
      document.removeEventListener('pointermove', move, true); document.removeEventListener('pointerup', up, true);
    };
    (window as unknown as { multitrackProjectionAudit: typeof state }).multitrackProjectionAudit = state;
  });
}

async function finishStageProjectionWatch(page: Page) {
  return page.evaluate(() => {
    const state = (window as unknown as { multitrackProjectionAudit: { downOffset: number | null; heldOffsets: number[]; releaseOffset: number | null; cleanup: () => void } }).multitrackProjectionAudit;
    state.cleanup();
    return { downOffset: state.downOffset, heldOffsets: state.heldOffsets, releaseOffset: state.releaseOffset };
  });
}

async function dragKey(page: Page, id: string, source: number, target: number, cancel = false) {
  await closeDisclosures(page);
  const key = mark(page, id, source);
  await expect(key).toBeVisible();
  await key.scrollIntoViewIfNeeded();
  const box = (await key.boundingBox())!;
  const rail = (await lane(page, id).locator('.kf-lane-track').boundingBox())!;
  const end = Number(await timeline(page).getByRole('slider', { name: '关键帧时间线进度', exact: true }).getAttribute('max'));
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + (target - source) / end * rail.width, box.y + box.height / 2, { steps: 8 });
  if (cancel) await page.keyboard.press('Escape');
  await page.mouse.up();
}

async function dragAudio(page: Page, deltaFrames: number, cancel = false) {
  await closeDisclosures(page);
  const audio = clip(page);
  await expect(audio).toBeVisible();
  const box = (await audio.boundingBox())!;
  const rail = (await audio.locator('..').boundingBox())!;
  const viewport = (await timeline(page).locator('.kf-lanes-viewport').boundingBox())!;
  const end = Number(await timeline(page).getByRole('slider', { name: '关键帧时间线进度', exact: true }).getAttribute('max'));
  const delta = deltaFrames / end * rail.width;
  const visibleLeft = Math.max(box.x, rail.x, viewport.x), visibleRight = Math.min(box.x + box.width, rail.x + rail.width, viewport.x + viewport.width);
  // Pick a visible point whose destination also remains within the viewport.
  const x = delta < 0 ? visibleRight - 18 : visibleLeft + 18;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y); await page.mouse.down();
  await page.mouse.move(x + delta, y, { steps: 8 });
  if (cancel) await page.keyboard.press('Escape');
  await page.mouse.up();
}

function expectMotionUnchanged(actual: SceneSnapshot, original: SceneSnapshot) {
  expect(actual.countMap).toEqual(original.countMap);
  expect(actual.plan).toEqual(original.plan);
  expect(actual.manual).toEqual(original.manual);
  expect(actual.take).toEqual(original.take);
}

for (const width of [1440, 390]) {
  test(`@multitrack ${width}px stage fills the workspace beneath the overlay and explicit K adds or updates one time`, async ({ page }, info) => {
    test.setTimeout(120_000);
    const height = width === 1440 ? 1000 : 844;
    await page.setViewportSize({ width, height });
    const source = await openFixture(page);
    const original = await backup(page);
    await closeDisclosures(page);
    const canvas = page.getByRole('img', { name: '人体编舞动作预览', exact: true });
    const before = (await canvas.boundingBox())!;
    const overlay = (await timeline(page).boundingBox())!;
    expect(before.width).toBeGreaterThanOrEqual(width * .95);
    expect(before.height).toBeGreaterThanOrEqual(height * .75);
    expect(overlay.x).toBeGreaterThanOrEqual(before.x - 1);
    expect(overlay.x + overlay.width).toBeLessThanOrEqual(before.x + before.width + 1);
    expect(overlay.y).toBeGreaterThan(before.y);
    expect(overlay.y + overlay.height).toBeLessThanOrEqual(before.y + before.height + 1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBeLessThanOrEqual(height + 4);
    for (const id of ['root', 'body', 'left-arm', 'right-arm', 'left-leg', 'right-leg']) {
      await expect(lane(page, id)).toBeVisible();
    }
    await expect(clip(page)).toBeVisible();
    expect((await clip(page).boundingBox())!.y).toBeLessThan((await lane(page, 'root').boundingBox())!.y);
    for (const control of [timeline(page).getByRole('button', { name: 'K 完整姿态', exact: true }), cursor(page)]) {
      await expect(control).toBeInViewport();
      if (width === 390) expect((await control.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    }
    for (const name of ['导入音乐', '下载完整场景包', '复制当前姿态']) {
      await expect(hiddenButton(page, name)).toBeHidden();
    }
    await expect(page.getByRole('spinbutton', { name: /^(关节|Root) [XYZ]/, includeHidden: true })).toHaveCount(0);
    await page.getByRole('button', { name: '收起时间线', exact: true }).click();
    expect((await canvas.boundingBox())!).toEqual(before);
    await page.getByRole('button', { name: '展开时间线', exact: true }).click();
    expect((await canvas.boundingBox())!).toEqual(before);

    await frame(page, 30);
    expect((await backup(page)).scene.project).toEqual(original.scene.project);
    await closeDisclosures(page);
    const write = timeline(page).getByRole('button', { name: 'K 完整姿态', exact: true });
    await expect(write).toHaveText('添加关键帧');
    await write.click();
    await expect(write).toHaveText('更新关键帧');
    const first = await backup(page);
    const firstSnapshot = current(first);
    expect(firstSnapshot.manual!.root.map(key => key.frame)).toEqual([30]);
    expect(Object.keys(firstSnapshot.manual!.rotations)).toHaveLength(19);
    expect(Object.values(firstSnapshot.manual!.rotations).every(keys => keys!.map(key => key.frame).join() === '30')).toBe(true);
    expect(firstSnapshot.manual!.baseTake).toEqual(source.take);
    await closeDisclosures(page);
    await watchStageProjection(page);
    await numeric(page, 'Root X 位移（米）', .25);
    await expect(draft(page)).toBeVisible();
    const projectionAudit = await finishStageProjectionWatch(page);
    expect(projectionAudit.downOffset).not.toBeNull();
    expect(projectionAudit.heldOffsets.length).toBeGreaterThanOrEqual(5);
    expect(projectionAudit.heldOffsets.every(offset => offset === projectionAudit.downOffset)).toBe(true);
    expect(projectionAudit.releaseOffset).toBe(projectionAudit.downOffset);
    const latestInset = (Math.ceil((await page.locator('.timeline-overlay').boundingBox())!.height) + 16) / 2;
    await expect.poll(async () => Number(await page.getByRole('region', { name: '3D 动画舞台', exact: true }).getAttribute('data-camera-offset-y'))).toBe(latestInset);
    expect(latestInset).toBeGreaterThan(projectionAudit.downOffset!);
    await info.attach('actual-drag-projection', { body: JSON.stringify({ ...projectionAudit, latestInset }), contentType: 'application/json' });
    const formedRoot = await Promise.all(['X', 'Y', 'Z'].map(axis => stageValue(page, `Root ${axis} 位移（米）`)));
    // A pointer enters CSS pixels; verify its intended displacement separately
    // from the exact draft values that explicit K must preserve.
    expect(formedRoot[0]).toBeCloseTo(.25, 5);
    expect(current(await backup(page))).toEqual(firstSnapshot);
    await closeDisclosures(page);
    await write.click();
    await expect(draft(page)).toBeHidden();
    await expectStageValue(page, 'Root X 位移（米）', formedRoot[0]);
    const updated = await backup(page);
    expect(current(updated).manual!.root).toHaveLength(1);
    expect(current(updated).manual!.root[0].frame).toBe(30);
    expect(current(updated).manual!.root[0].position).toEqual(formedRoot);
    expect(current(updated).countMap).toEqual(current(original).countMap);
    expect(current(updated).manual!.baseTake).toEqual(source.take);
    expect(updated.scene.project.history).toHaveLength(first.scene.project.history.length + 1);
    await page.getByRole('button', { name: '撤销', exact: true }).click();
    expect(current(await backup(page))).toEqual(firstSnapshot);
    await page.getByRole('button', { name: '重做', exact: true }).click();
    expect(current(await backup(page))).toEqual(current(updated));
    if (width === 390) {
      await dragKey(page, 'root', 30, 60);
      const moved = current(await backup(page));
      expect(moved.manual!.root).toEqual([{ ...current(updated).manual!.root[0], frame: 60 }]);
      expect(moved.manual!.rotations).toEqual(current(updated).manual!.rotations);
      await dragAudio(page, 30);
      await expect(clip(page)).toHaveAttribute('data-offset-seconds', '1');
      const shifted = current(await backup(page));
      expect(shifted.audioOffsetSeconds).toBe(1);
      expectMotionUnchanged(shifted, moved);
    }
    expect(await audioHash(page)).toBe(createHash('sha256').update(source.wave).digest('hex'));
    await closeDisclosures(page);
    await screenshot(page, info, `multitrack-stage-${width}.png`);
  });
}

test('@multitrack Root, grouped arm and expanded joint dragging move only their explicit source tracks; Escape keeps authority', async ({ page }, info) => {
  test.setTimeout(120_000);
  const { source, base, initial } = await keyedScene(page);
  const original = current(initial);
  // Cursor intentionally differs from the dragged K: the marker owns source.
  await frame(page, 150);
  await dragKey(page, 'root', 30, 60);
  await expect(mark(page, 'root', 60)).toBeVisible();
  await expect(cursor(page)).toHaveValue('60');
  const rooted = await backup(page), rootSnapshot = current(rooted);
  expect(rootSnapshot.manual!.root).toEqual(original.manual!.root.map(key => key.frame === 30 ? { ...key, frame: 60 } : key));
  expect(rootSnapshot.manual!.rotations).toEqual(original.manual!.rotations);
  expect(rooted.scene.project.history).toHaveLength(initial.scene.project.history.length + 1);

  await dragKey(page, 'left-arm', 30, 120);
  await expect(mark(page, 'left-arm', 120)).toBeVisible();
  const grouped = await backup(page), groupSnapshot = current(grouped);
  for (const joint of Object.keys(original.manual!.rotations) as JointName[]) {
    const expected = rootSnapshot.manual!.rotations[joint]!.map(key => ['LeftUpperArm', 'LeftForeArm'].includes(joint) && key.frame === 30 ? { ...key, frame: 120 } : key).sort((a, b) => a.frame - b.frame);
    expect(groupSnapshot.manual!.rotations[joint]).toEqual(expected);
  }
  expect(groupSnapshot.manual!.root).toEqual(rootSnapshot.manual!.root);
  await closeDisclosures(page);
  await timeline(page).getByRole('button', { name: '展开左臂轨道', exact: true }).click();
  await expect(lane(page, 'LeftUpperArm')).toBeVisible();
  await dragKey(page, 'LeftUpperArm', 120, 180);
  const singled = await backup(page), singleSnapshot = current(singled);
  expect(singleSnapshot.manual!.rotations.LeftUpperArm).toEqual(groupSnapshot.manual!.rotations.LeftUpperArm!.map(key => key.frame === 120 ? { ...key, frame: 180 } : key));
  for (const joint of Object.keys(groupSnapshot.manual!.rotations) as JointName[]) {
    if (joint !== 'LeftUpperArm') expect(singleSnapshot.manual!.rotations[joint]).toEqual(groupSnapshot.manual!.rotations[joint]);
  }
  expect(singleSnapshot.manual!.root).toEqual(groupSnapshot.manual!.root);
  await dragKey(page, 'LeftUpperArm', 180, 210, true);
  expect((await backup(page)).scene.project).toEqual(singled.scene.project);
  expect(singleSnapshot.manual!.baseTake).toEqual(base);
  expect(singleSnapshot.countMap).toEqual(original.countMap);
  expect(singleSnapshot.plan).toEqual(original.plan);
  expect(await audioHash(page)).toBe(createHash('sha256').update(source.wave).digest('hex'));
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  expect(current(await backup(page))).toEqual(groupSnapshot);
  await page.getByRole('button', { name: '重做', exact: true }).click();
  expect(current(await backup(page))).toEqual(singleSnapshot);
  await closeDisclosures(page); await screenshot(page, info, 'multitrack-expanded-joint.png');
});

test('@multitrack colliding grouped K waits for explicit replacement, preserves target-only tracks and supports undo', async ({ page }) => {
  const { initial, base } = await keyedScene(page);
  const original = current(initial);
  await frame(page, 210);
  await dragKey(page, 'left-arm', 30, 90);
  await expect(collision(page)).toBeVisible();
  await expect(collision(page).locator('.transfer-collisions > span')).toHaveCount(1);
  await expect(collision(page).locator('.transfer-collisions')).toHaveText('左肩');
  await collision(page).getByRole('button', { name: '取消', exact: true }).click();
  expect((await backup(page)).scene.project).toEqual(initial.scene.project);
  await expect(cursor(page)).toHaveValue('210');
  await dragKey(page, 'left-arm', 30, 90);
  await expect(collision(page)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(collision(page)).toBeHidden();
  expect((await backup(page)).scene.project).toEqual(initial.scene.project);
  await dragKey(page, 'left-arm', 30, 90);
  await collision(page).getByRole('button', { name: '替换并继续', exact: true }).click();
  await expect(collision(page)).toBeHidden();
  const changed = await backup(page), snapshot = current(changed);
  expect(snapshot.manual!.rotations.LeftUpperArm).toEqual([{ ...original.manual!.rotations.LeftUpperArm![0], frame: 90 }]);
  expect(snapshot.manual!.rotations.LeftForeArm).toEqual([{ ...original.manual!.rotations.LeftForeArm![0], frame: 90 }]);
  for (const joint of Object.keys(original.manual!.rotations) as JointName[]) {
    if (!['LeftUpperArm', 'LeftForeArm'].includes(joint)) expect(snapshot.manual!.rotations[joint]).toEqual(original.manual!.rotations[joint]);
  }
  expect(snapshot.manual!.root).toEqual(original.manual!.root);
  expect(snapshot.manual!.baseTake).toEqual(base);
  expect(snapshot.countMap).toEqual(original.countMap);
  expect(changed.scene.project.history).toHaveLength(initial.scene.project.history.length + 1);
  await expect(cursor(page)).toHaveValue('90');
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  expect(current(await backup(page))).toEqual(original);
  await page.getByRole('button', { name: '重做', exact: true }).click();
  expect(current(await backup(page))).toEqual(snapshot);
});

test('@multitrack audio can move later or earlier independently, clock advances through silence and history preserves exact motion', async ({ page }) => {
  test.setTimeout(120_000);
  const { source, initial } = await keyedScene(page);
  const original = current(initial);
  await dragAudio(page, 120);
  await expect(clip(page)).toHaveAttribute('data-offset-seconds', '4');
  const later = await backup(page), laterSnapshot = current(later);
  expect(laterSnapshot.audioOffsetSeconds).toBe(4);
  expectMotionUnchanged(laterSnapshot, original);
  expect(later.scene.project.history).toHaveLength(initial.scene.project.history.length + 1);
  await closeDisclosures(page);
  await frame(page, 0);
  await page.getByRole('button', { name: '播放', exact: true }).click();
  await expect.poll(async () => Number(await cursor(page).inputValue())).toBeGreaterThan(0);
  expect(Number(await cursor(page).inputValue())).toBeLessThan(120);
  expect(await page.locator('audio').evaluate((audio: HTMLAudioElement) => audio.paused || audio.muted)).toBe(true);
  await page.getByRole('button', { name: '暂停', exact: true }).click();
  await frame(page, 150);
  await expect.poll(() => page.locator('audio').evaluate((audio: HTMLAudioElement) => audio.currentTime)).toBeCloseTo(2, 4);
  await page.getByRole('button', { name: '播放', exact: true }).click();
  await expect.poll(() => page.locator('audio').evaluate((audio: HTMLAudioElement) => audio.paused || audio.muted)).toBe(false);
  await page.getByRole('button', { name: '暂停', exact: true }).click();
  await dragAudio(page, -240);
  await expect(clip(page)).toHaveAttribute('data-offset-seconds', '-4');
  const earlier = await backup(page), earlierSnapshot = current(earlier);
  expect(earlierSnapshot.audioOffsetSeconds).toBe(-4);
  expectMotionUnchanged(earlierSnapshot, original);
  await closeDisclosures(page);
  // Allow two seconds to observe real media playback before crossing the
  // selected segment's end; a 300 ms window is too short for browser polling.
  await frame(page, 300);
  await expect.poll(() => page.locator('audio').evaluate((audio: HTMLAudioElement) => audio.currentTime)).toBeCloseTo(15, 4);
  await page.getByRole('button', { name: '播放', exact: true }).click();
  await expect.poll(() => page.locator('audio').evaluate((audio: HTMLAudioElement) => audio.paused || audio.muted)).toBe(false);
  await expect.poll(async () => Number(await cursor(page).inputValue())).toBeGreaterThanOrEqual(366);
  expect(await page.locator('audio').evaluate((audio: HTMLAudioElement) => audio.paused || audio.muted)).toBe(true);
  await expect(page.getByRole('button', { name: '暂停', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '暂停', exact: true }).click();
  await dragAudio(page, 30, true);
  expect((await backup(page)).scene.project).toEqual(earlier.scene.project);
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  expect(current(await backup(page))).toEqual(laterSnapshot);
  await page.getByRole('button', { name: '重做', exact: true }).click();
  expect(current(await backup(page))).toEqual(earlierSnapshot);
  expect(await audioHash(page)).toBe(createHash('sha256').update(source.wave).digest('hex'));
});

test('@multitrack moved audio and sparse keys survive save, refresh and full original-audio backup restore into an independent scene', async ({ page }) => {
  test.setTimeout(120_000);
  const { source, base } = await keyedScene(page);
  await dragKey(page, 'root', 30, 60);
  await dragAudio(page, -60);
  await expect(clip(page)).toHaveAttribute('data-offset-seconds', '-2');
  await frame(page, 75);
  await save(page);
  const saved = await backup(page);
  await page.reload(); await ready(page);
  await expect(cursor(page)).toHaveValue('75');
  expect((await backup(page)).scene.project).toEqual(saved.scene.project);
  const downloading = page.waitForEvent('download');
  await clickRevealed(page, hiddenButton(page, '下载完整场景包'));
  const path = await (await downloading).path(); expect(path).toBeTruthy();
  const bytes = await readFile(path!);
  const magic = Buffer.from('CHOREO-BUNDLE-1\n');
  expect(bytes.subarray(0, magic.length)).toEqual(magic);
  const headerLength = bytes.readUInt32LE(magic.length);
  const header = JSON.parse(bytes.subarray(magic.length + 4, magic.length + 4 + headerLength).toString('utf8'));
  const originalAudio = bytes.subarray(magic.length + 4 + headerLength);
  expect(originalAudio).toEqual(source.wave);
  expect(header.audio.sha256).toBe(createHash('sha256').update(source.wave).digest('hex'));
  expect(header.scene.project).toEqual(saved.scene.project);
  await closeDisclosures(page);
  await page.getByRole('button', { name: '场景', exact: true }).click();
  await page.getByRole('dialog', { name: '本机场景', exact: true }).getByRole('button', { name: '导入场景备份', exact: true }).click();
  const importing = page.getByRole('dialog', { name: '导入场景备份', exact: true });
  await importing.getByLabel('选择场景备份文件', { exact: true }).setInputFiles({ name: 'multitrack-original.choreo', mimeType: 'application/octet-stream', buffer: bytes });
  const confirm = importing.getByRole('button', { name: '作为新场景导入', exact: true });
  await expect(confirm).toBeEnabled();
  await confirm.click();
  await expect(importing).toBeHidden();
  const restored = await backup(page);
  expect(restored.scene.id).not.toBe(saved.scene.id);
  expect(restored.scene.project).toEqual({ ...saved.scene.project, teacherCheckedRevision: null });
  expect(current(restored).audioOffsetSeconds).toBe(-2);
  expect(current(restored).manual!.baseTake).toEqual(base);
  expect(restored.scene.viewer.time).toBe(2.5);
  expect(await audioHash(page)).toBe(createHash('sha256').update(source.wave).digest('hex'));
  await page.reload(); await ready(page);
  expect((await backup(page)).scene.project).toEqual(restored.scene.project);
  await closeDisclosures(page);
  await expect(clip(page)).toHaveAttribute('data-offset-seconds', '-2');
});
