import { createHash } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { JOINT_NAMES, rotationToDegrees, sampleTake, type BakedTake, type JointName } from '../packages/core/src';
import type { SceneDocument } from '../apps/web/src/scene';
import type { SceneProject } from '../apps/web/src/sceneProject';
import { encodeSceneBackup } from '../apps/web/src/sceneBackup';
import { closeDisclosures, reveal } from './helpers';
import { backup, current, diagnostics, fixture, ready, save, screenshot } from './realismHelpers';
import { editStageValue, expectStageValue, selectStageJoint } from './stageInteractions';

const timeline = (page: Page) => page.getByRole('region', { name: '手动关键帧时间线', exact: true });
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

async function atTime(page: Page, time: number) {
  const input = timeline(page).getByRole('spinbutton', { name: '当前时间（秒）', exact: true, includeHidden: true });
  await reveal(page, input); await input.fill(String(time)); await input.press('Tab');
  await expect(input).toHaveValue(String(time));
  await closeDisclosures(page, '.kf-point-inspector');
}

async function manualWorkspace(page: Page) {
  await expect(timeline(page)).toBeVisible();
  await expect(page.getByRole('group', { name: '编舞模式', exact: true, includeHidden: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /八拍编排|手动 K帧|换一个八拍|试试更简单|生成模板初稿/, includeHidden: true })).toHaveCount(0);
}

function unchangedChannels(take: BakedTake, original: BakedTake, changed: JointName[]) {
  take.times.forEach((time, index) => {
    const before = sampleTake(original, time), after = take.poses[index];
    expect(after.root).toEqual(before.root);
    for (const joint of JOINT_NAMES) if (!changed.includes(joint)) expect(after.joints[joint]).toEqual(before.joints[joint]);
  });
}

for (const width of [1440, 390]) {
  test(`@manualworkspace ${width}px a new scene holds one key, interpolates to the next, and preserves exact undo and saved animation`, async ({ page }, info) => {
    test.setTimeout(180_000);
    await page.setViewportSize({ width, height: width === 1440 ? 1000 : 844 });
    await page.goto('/'); await ready(page); await save(page);
    await page.getByRole('button', { name: '场景', exact: true }).click();
    await page.getByRole('dialog', { name: '本机场景', exact: true }).getByRole('button', { name: '新建场景', exact: true }).click();
    await ready(page); await manualWorkspace(page);
    const initial = await backup(page), base = current(initial).take!;
    expect(current(initial).plan).toBeNull();
    expect(current(initial).manual!.pointInterpolation).toBe('hold-last-key-1');
    expect(current(initial).manual!.pointEdits ?? []).toEqual([]);

    await atTime(page, 2); await selectStageJoint(page, 'Head');
    await editStageValue(page, '关节 X 旋转（度）', -10);
    await expectStageValue(page, '关节 X 旋转（度）', -10);
    const first = await backup(page), one = current(first);
    expect(first.scene.project.history).toHaveLength(initial.scene.project.history.length + 1);
    expect(one.manual!.pointEdits).toHaveLength(1);
    expect(one.manual!.pointEdits![0].time).toBe(2);
    const firstRotation = one.manual!.pointEdits![0].joints!.Head!;
    expect(one.take!.times).toEqual([0, 2, base.durationSeconds]);
    unchangedChannels(one.take!, base, ['Head']);
    for (let frame = 60; frame <= Math.floor(base.durationSeconds * 30); frame++) {
      expect(sampleTake(one.take!, frame / 30).joints.Head, `A single key must hold after frame ${frame}`).toEqual(firstRotation);
    }
    await atTime(page, 4); await expectStageValue(page, '关节 X 旋转（度）', -10);
    await atTime(page, base.durationSeconds); await expectStageValue(page, '关节 X 旋转（度）', -10);
    expect((await backup(page)).scene.project).toEqual(first.scene.project);

    await atTime(page, 6); await editStageValue(page, '关节 X 旋转（度）', 10);
    await expectStageValue(page, '关节 X 旋转（度）', 10);
    const second = await backup(page), two = current(second);
    expect(second.scene.project.history).toHaveLength(first.scene.project.history.length + 1);
    expect(two.manual!.pointEdits!.map(edit => edit.time)).toEqual([2, 6]);
    expect(two.take!.times).toEqual([0, 2, 6, base.durationSeconds]);
    unchangedChannels(two.take!, base, ['Head']);
    expect(sampleTake(two.take!, 2).joints.Head).toEqual(firstRotation);
    expect(rotationToDegrees(sampleTake(two.take!, 4).joints.Head)[0]).toBeCloseTo(0, 6);
    const secondRotation = two.manual!.pointEdits![1].joints!.Head!;
    for (let frame = 180; frame <= Math.floor(base.durationSeconds * 30); frame++) {
      expect(sampleTake(two.take!, frame / 30).joints.Head, `The second key must hold after frame ${frame}`).toEqual(secondRotation);
    }
    await atTime(page, 4); await expectStageValue(page, '关节 X 旋转（度）', 0);
    await atTime(page, base.durationSeconds); await expectStageValue(page, '关节 X 旋转（度）', 10);
    await page.getByRole('button', { name: '撤销', exact: true }).click();
    expect(current(await backup(page))).toEqual(one);
    await expectStageValue(page, '关节 X 旋转（度）', -10);
    await page.getByRole('button', { name: '重做', exact: true }).click();
    const redone = await backup(page);
    expect(current(redone)).toEqual(two);
    expect(redone.scene.project.history).toEqual(second.scene.project.history);
    expect(redone.scene.project.historyIndex).toBe(second.scene.project.historyIndex);
    expect(redone.scene.project.revision).toBe(second.scene.project.revision + 2);
    await expectStageValue(page, '关节 X 旋转（度）', 10);
    await save(page); await page.reload(); await ready(page); await manualWorkspace(page);
    expect((await backup(page)).scene.project).toEqual(redone.scene.project);
    await atTime(page, 4); await expectStageValue(page, '关节 X 旋转（度）', 0);
    await screenshot(page, info, `manual-hold-${width}.png`);
  });
}

test('@manualworkspace native legacy arrange import restores directly into manual editing without changing motion or music', async ({ page }) => {
  test.setTimeout(120_000);
  const source = fixture();
  const legacy = {
    ...source.scene, audio: new Blob([new Uint8Array(source.wave)], { type: 'audio/wav' }),
    viewer: { ...source.scene.viewer, editorMode: 'arrange', time: .7, selectedJoint: 'LeftForeArm' },
  } as unknown as SceneDocument<SceneProject>;
  const bytes = Buffer.from(await (await encodeSceneBackup(legacy)).arrayBuffer());
  await page.goto('/'); await ready(page); await save(page);
  await page.getByRole('button', { name: '场景', exact: true }).click();
  await page.getByRole('dialog', { name: '本机场景', exact: true }).getByRole('button', { name: '导入场景备份', exact: true }).click();
  const importer = page.getByRole('dialog', { name: '导入场景备份', exact: true });
  await importer.getByLabel('选择场景备份文件', { exact: true }).setInputFiles({ name: 'legacy-arrange.choreo', mimeType: 'application/octet-stream', buffer: bytes });
  await importer.getByRole('button', { name: '作为新场景导入', exact: true }).click();
  await expect(importer).toHaveCount(0); await ready(page); await manualWorkspace(page);
  const restored = await backup(page);
  expect(restored.scene.project).toEqual(source.scene.project);
  expect(restored.scene.viewer.editorMode).toBe('keyframes');
  expect(restored.scene.viewer.time).toBe(.7);
  expect(restored.scene.viewer.selectedJoint).toBe('LeftForeArm');
  expect(restored.scene.audioName).toBe(source.scene.audioName);
  const audioHash = await page.locator('audio').evaluate(async (audio: HTMLAudioElement) => {
    const audioBytes = await (await fetch(audio.src)).arrayBuffer();
    return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', audioBytes)), byte => byte.toString(16).padStart(2, '0')).join('');
  });
  expect(audioHash).toBe(createHash('sha256').update(source.wave).digest('hex'));
  await save(page); await page.reload(); await ready(page); await manualWorkspace(page);
  expect((await backup(page)).scene.project).toEqual(source.scene.project);
});
