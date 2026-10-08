import { createHash } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { Euler, Quaternion } from 'three';
import { backup, current, diagnostics, draft, numeric, openFixture, save, screenshot, select } from './realismHelpers';
import { expectStageValue } from './stageInteractions';

test.beforeEach(async ({ page }) => { await page.route('**/api/**', route => route.abort('blockedbyclient')); });

for (const width of [1440, 390]) {
  test(`@timeline ${width}px sparse pose keys are recorded beside the playhead, interpolate and survive undo, saving and a draft guard`, async ({ page }, info) => {
    test.setTimeout(120_000);
    const report = diagnostics(page);
    await page.setViewportSize({ width, height: width === 1440 ? 1000 : 844 });
    const source = await openFixture(page);
    const original = await backup(page);
    const timeline = page.getByRole('region', { name: '手动关键帧时间线', exact: true });
    const stage = page.getByRole('region', { name: '3D动作预览', exact: true });
    const record = timeline.getByRole('button', { name: 'K 完整姿态', exact: true });
    const cursor = timeline.getByRole('spinbutton', { name: '当前帧', exact: true });
    const progress = timeline.getByRole('slider', { name: '关键帧时间线进度', exact: true });
    const guard = page.getByRole('dialog', { name: '写入这份姿态草稿？', exact: true });
    await expect(stage.getByRole('region', { name: '手动关键帧时间线', exact: true })).toHaveCount(1);
    await expect(page.getByRole('slider', { name: '播放进度', exact: true })).toHaveCount(0);
    await expect(progress).toHaveAttribute('step', '1');
    await expect(page.getByRole('region', { name: '手动关键帧编辑器', exact: true, includeHidden: true })).toHaveCount(0);
    await expect(page.getByRole('combobox', { name: '选择关节', exact: true, includeHidden: true })).toHaveCount(0);
    await expect(page.getByRole('spinbutton', { name: /^(关节|Root) [XYZ]/, includeHidden: true })).toHaveCount(0);
    for (const label of ['更多编辑操作', '关键帧明细', '移动与复制关键帧', '键盘快捷键']) {
      const details = timeline.locator('details').filter({ has: page.locator('summary').filter({ hasText: new RegExp(`^${label}$`) }) });
      await expect(details).not.toHaveAttribute('open');
    }
    await page.locator('.project-title').scrollIntoViewIfNeeded();
    if (width === 1440) await expect(record).toBeInViewport();
    else {
      for (const control of [record, cursor, timeline.getByRole('button', { name: '下一帧', exact: true })]) {
        expect((await control.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      }
    }
    await select(page, 'LeftUpperArm');
    const snapshots: ReturnType<typeof current>[] = [];
    for (const [frame, angle, x] of [[0, 0, 0], [90, 60, .9], [240, 15, 1.2]]) {
      await cursor.fill(String(frame)); await cursor.press('Tab');
      await numeric(page, '关节 Z 旋转（度）', angle);
      await numeric(page, 'Root X 位移（米）', x);
      if (frame) await expect(timeline.getByRole('status').filter({ hasText: '姿态草稿 · 尚未写入关键帧' })).toBeVisible();
      await expect(record).toHaveText('添加关键帧');
      await record.click();
      await expect(draft(page)).toBeHidden();
      await expect(record).toHaveText('更新关键帧');
      await expect(progress).toHaveValue(String(frame));
      snapshots.push(current(await backup(page)));
    }
    const authored = await backup(page), take = current(authored);
    expect(take.manual!.root.map(key => key.frame)).toEqual([0, 90, 240]);
    expect(Object.keys(take.manual!.rotations)).toHaveLength(19);
    expect(Object.values(take.manual!.rotations).every(keys => keys!.map(key => key.frame).join() === '0,90,240')).toBe(true);
    expect(take.manual!.baseTake).toEqual(source.take);
    expect(take.take.times[0]).toBe(0); expect(take.take.times.at(-1)).toBe(16);
    expect(source.take.times.every(time => take.take.times.includes(time))).toBe(true);
    expect(take.countMap).toEqual(current(original).countMap);
    expect(take.plan).toEqual(current(original).plan);
    await expect(timeline.getByRole('button', { name: /^跳到第 \d+ 帧关键帧$/ })).toHaveCount(3);
    // The visible midpoint follows the same 0 -> 60 degree arc and 0 -> .9m
    // displacement. Verify the exact recorded endpoints independently below;
    // the stage gesture may differ from its requested value by subpixel input.
    await cursor.fill('45'); await cursor.press('Tab');
    await expectStageValue(page, '关节 Z 旋转（度）', 30, .05);
    await expectStageValue(page, 'Root X 位移（米）', .45, .0005);
    const rotations = take.manual!.rotations.LeftUpperArm!;
    for (const [index, time] of take.take.times.entries()) {
      if (time > 3) continue;
      const expected = new Quaternion(...rotations[0].rotation).slerp(new Quaternion(...rotations[1].rotation), time / 3);
      expect(Math.abs(expected.dot(new Quaternion(...take.take.poses[index].joints.LeftUpperArm)))).toBeCloseTo(1, 10);
      const rootKeys = take.manual!.root;
      expect(take.take.poses[index].root[0]).toBeCloseTo(rootKeys[0].position[0] + (rootKeys[1].position[0] - rootKeys[0].position[0]) * time / 3, 10);
    }
    await expect(progress).toHaveValue('45');
    await page.getByRole('button', { name: '撤销', exact: true }).click();
    expect(current(await backup(page))).toEqual(snapshots[1]);
    await page.getByRole('button', { name: '重做', exact: true }).click();
    expect(current(await backup(page))).toEqual(take);
    // Existing history navigation returns to frame 0; explicitly choose the
    // interpolated frame whose restoration this workflow verifies.
    await cursor.fill('45'); await cursor.press('Tab');
    await save(page);
    const saved = await backup(page);
    await page.reload();
    await expect(cursor).toHaveValue('45');
    expect((await backup(page)).scene.project).toEqual(saved.scene.project);
    const audioHash = await page.locator('audio').evaluate(async (audio: HTMLAudioElement) => {
      const bytes = await (await fetch(audio.src)).arrayBuffer();
      return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), byte => byte.toString(16).padStart(2, '0')).join('');
    });
    expect(audioHash).toBe(createHash('sha256').update(source.wave).digest('hex'));
    await numeric(page, '关节 Z 旋转（度）', 40);
    await cursor.fill('90'); await expect(guard).toBeVisible();
    await guard.getByRole('button', { name: '取消', exact: true }).click();
    await expect(cursor).toHaveValue('45');
    await expect(draft(page)).toBeVisible();
    await cursor.fill('90'); await expect(guard).toBeVisible();
    await guard.getByRole('button', { name: '放弃草稿，继续', exact: true }).click();
    await expect(cursor).toHaveValue('90');
    await expect(draft(page)).toBeHidden();
    expect(current(await backup(page))).toEqual(take);
    await numeric(page, '关节 Z 旋转（度）', 75);
    await timeline.getByRole('button', { name: '下一帧', exact: true }).click();
    await expect(guard).toBeVisible();
    await guard.getByRole('button', { name: '写入完整姿态后继续', exact: true }).click();
    await expect(cursor).toHaveValue('91');
    await expect(draft(page)).toBeHidden();
    const updated = current(await backup(page));
    expect(updated.manual!.root.map(key => key.frame)).toEqual([0, 90, 240]);
    const updatedRotation = updated.manual!.rotations.LeftUpperArm![1].rotation;
    expect(new Euler().setFromQuaternion(new Quaternion(...updatedRotation), 'XYZ').z * 180 / Math.PI).toBeCloseTo(75, 1);
    expect(updated.take.poses[updated.take.times.indexOf(3)].joints.LeftUpperArm).toEqual(updatedRotation);
    await page.getByRole('button', { name: '撤销', exact: true }).click();
    expect(current(await backup(page))).toEqual(take);
    await page.locator('.project-title').scrollIntoViewIfNeeded();
    await screenshot(page, info, `timeline-workflow-${width}.png`);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await info.attach('browser-console-and-api', { body: JSON.stringify(report), contentType: 'application/json' });
    expect(report).toEqual({ errors: [], warnings: [], expectedHttpErrors: [], apiRequests: [] });
  });
}
