import { createHash } from 'node:crypto';
import { deepStrictEqual } from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import {
  JOINT_NAMES, evaluatePose, rotationFromDegrees, sampleTake,
  type BakedTake, type JointName, type MotionPointTrack,
} from '../packages/core/src';
import { clickRevealed, closeDisclosures, reveal } from './helpers';
import {
  backup, current, diagnostics, hiddenButton, openFixture, projection,
  ready, save, screenshot, type Backup,
} from './realismHelpers';
import { editStageValue, expectStageSelection, stageValue } from './stageInteractions';

// The supplied dance and its music remain private. CI runs portable scenes and
// skips only the actual uploaded-file case unless a private fixture is supplied.
const privateFixture = process.env.CHOREO_POINT_FIXTURE
  ?? '/workspace/attachments/05b3c541-0243-48be-a3a9-2c7d16eb73b1/complex-street-dance.choreo';
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
const lane = (page: Page, id: string) => timeline(page).locator(`.kf-lane[data-track-id="${id}"]`);
const point = (page: Page, id: string, time: number) => lane(page, id).locator(`[data-selected-point="true"][data-time="${time}"][data-point="${id}"]`);
const seconds = (page: Page) => timeline(page).getByRole('spinbutton', { name: '当前时间（秒）', exact: true, includeHidden: true });
const importDialog = (page: Page) => page.getByRole('dialog', { name: '导入场景备份', exact: true });
const importConfirm = (page: Page) => importDialog(page).getByRole('button', { name: '作为新场景导入', exact: true });

async function atTime(page: Page, time: number) {
  await closeDisclosures(page);
  await reveal(page, seconds(page));
  await seconds(page).fill(String(time));
  await seconds(page).press('Tab');
  expect(Number(await seconds(page).inputValue())).toBe(time);
  await closeDisclosures(page, '.kf-point-inspector');
}

async function assertMinimalAutomaticEditor(page: Page) {
  await expect(page.getByRole('button', { name: /^K (完整姿态|当前关节|位移)$/, includeHidden: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^(添加|更新)关键帧$/, includeHidden: true })).toHaveCount(0);
  await expect(page.getByRole('spinbutton', { name: /^(关节|Root) [XYZ]/, includeHidden: true })).toHaveCount(0);
  await expect(page.getByRole('dialog', { name: '写入这份姿态草稿？', exact: true })).toHaveCount(0);
}

async function portableScene(page: Page) {
  return openFixture(page, false, source => {
    // Two distinct source instants occupy the same 30 fps frame. Selecting or
    // updating one must preserve the other instead of silently frame-snapping.
    source.take.times = [0, .70391, .70612, 2.50391, 4, 8, 12, 16];
    source.take.poses = source.take.times.map(time => ({
      root: [time / 80, 1.05 + time / 500, time ? -time / 150 : 0],
      joints: Object.fromEntries(JOINT_NAMES.map((joint, index) => [joint,
        rotationFromDegrees([0, joint === 'LeftForeArm' ? 0 : index / 120 * time, joint === 'LeftForeArm' ? 0 : index / 240 * time]),
      ])) as BakedTake['poses'][number]['joints'],
    }));
  });
}

async function pickOnStage(page: Page, joint: JointName, take: BakedTake, time: number) {
  // This assertion deliberately uses an actual visible body hit. Keyboard
  // fallback would not verify the user's stage-selection synchronization.
  const original = await backup(page);
  const view = await projection(page, original);
  const target = view.point(evaluatePose(sampleTake(take, time))[joint].position);
  const canvasBox = (await view.canvas.boundingBox())!;
  expect(target.x).toBeGreaterThan(canvasBox.x);
  expect(target.x).toBeLessThan(canvasBox.x + canvasBox.width);
  expect(target.y).toBeGreaterThan(canvasBox.y);
  expect(target.y).toBeLessThan(canvasBox.y + canvasBox.height);
  await page.mouse.click(target.x, target.y);
  await expectStageSelection(page, joint);
  const selected = point(page, joint, time);
  await expect(selected).toHaveClass(/selected/);
  await expect(selected).toBeInViewport();
  return selected;
}

function assertOnlyChangedChannels(actual: BakedTake, original: BakedTake, at: number, changed: MotionPointTrack[]) {
  expect(actual.times).toEqual([...new Set([...original.times, at])].sort((a, b) => a - b));
  let differences = 0;
  original.times.forEach((time, index) => {
    const before = original.poses[index], after = actual.poses[actual.times.indexOf(time)];
    if (time !== at || !changed.includes('root')) deepStrictEqual(after.root, before.root, `Root source sample ${index} at ${time}`);
    else if (JSON.stringify(after.root) !== JSON.stringify(before.root)) differences++;
    for (const joint of JOINT_NAMES) {
      if (time !== at || !changed.includes(joint)) deepStrictEqual(after.joints[joint], before.joints[joint], `${joint} source sample ${index} at ${time}`);
      else if (JSON.stringify(after.joints[joint]) !== JSON.stringify(before.joints[joint])) differences++;
    }
  });
  if (!original.times.includes(at)) {
    const before = sampleTake(original, at), after = actual.poses[actual.times.indexOf(at)];
    if (!changed.includes('root')) deepStrictEqual(after.root, before.root, `Root inserted sample at ${at}`);
    else if (JSON.stringify(after.root) !== JSON.stringify(before.root)) differences++;
    for (const joint of JOINT_NAMES) {
      if (!changed.includes(joint)) deepStrictEqual(after.joints[joint], before.joints[joint], `${joint} inserted sample at ${at}`);
      else if (JSON.stringify(after.joints[joint]) !== JSON.stringify(before.joints[joint])) differences++;
    }
  }
  expect(differences, 'The gesture must make a real change at the selected source instant').toBeGreaterThan(0);
}

async function assertUndoRedo(page: Page, before: Backup, after: Backup, time: number) {
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  const undone = await backup(page);
  deepStrictEqual(current(undone), current(before), 'Undo must restore the entire exact snapshot');
  expect(undone.scene.viewer.time).toBe(time);
  expect(Number(await seconds(page).inputValue())).toBe(time);
  await page.getByRole('button', { name: '重做', exact: true }).click();
  const redone = await backup(page);
  deepStrictEqual(current(redone), current(after), 'Redo must restore the entire exact snapshot');
  expect(redone.scene.viewer.time).toBe(time);
}

async function inspectAllTracks(page: Page, sampleCount: number) {
  for (const group of ['body', 'left-arm', 'right-arm', 'left-leg', 'right-leg']) {
    const toggle = lane(page, group).locator('.kf-group-toggle');
    if (await toggle.getAttribute('aria-expanded') !== 'true') await toggle.click();
  }
  for (const track of ['root', ...JOINT_NAMES]) {
    await expect(lane(page, track)).toHaveCount(1);
    await expect(lane(page, track).locator('.kf-lane-track')).toHaveAttribute('data-sample-count', String(sampleCount));
  }
}

async function audioHash(page: Page) {
  return page.locator('audio').evaluate(async (audio: HTMLAudioElement) => {
    const bytes = await (await fetch(audio.src)).arrayBuffer();
    return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), byte => byte.toString(16).padStart(2, '0')).join('');
  });
}

async function downloadBundle(page: Page) {
  const pending = page.waitForEvent('download');
  await clickRevealed(page, hiddenButton(page, '下载完整场景包'));
  const download = await pending, path = await download.path();
  expect(download.suggestedFilename()).toMatch(/\.choreo$/);
  expect(path).toBeTruthy();
  await closeDisclosures(page);
  return readFile(path!);
}

async function nativeImport(page: Page, bytes: Buffer, name: string) {
  await page.getByRole('button', { name: '场景', exact: true }).click();
  await page.getByRole('dialog', { name: '本机场景', exact: true }).getByRole('button', { name: '导入场景备份', exact: true }).click();
  await importDialog(page).getByLabel('选择场景备份文件', { exact: true }).setInputFiles({ name, mimeType: 'application/octet-stream', buffer: bytes });
  await expect(importConfirm(page)).toBeEnabled();
  await importConfirm(page).click();
  await expect(importDialog(page)).toHaveCount(0);
  await ready(page);
}

test('@points exact source selection follows a stage body hit and one rotation gesture records only that joint', async ({ page }, info) => {
  test.setTimeout(120_000);
  const source = await portableScene(page), time = .70391;
  const initial = await backup(page);
  await atTime(page, time);
  await assertMinimalAutomaticEditor(page);
  expect((await backup(page)).scene.project).toEqual(initial.scene.project);
  await pickOnStage(page, 'LeftForeArm', source.take, time);
  const channelTime = lane(page, 'LeftForeArm').getByRole('slider');
  await channelTime.focus(); await channelTime.press('ArrowRight');
  expect(Number(await seconds(page).inputValue())).toBe(.70612);
  await channelTime.press('ArrowLeft');
  expect(Number(await seconds(page).inputValue())).toBe(time);
  expect((await backup(page)).scene.project).toEqual(initial.scene.project);
  const old = await stageValue(page, '关节 X 旋转（度）');
  await editStageValue(page, '关节 X 旋转（度）', old - 25);
  expect(await stageValue(page, '关节 X 旋转（度）')).toBeCloseTo(old - 25, 1);
  const after = await backup(page), snapshot = current(after);
  await assertMinimalAutomaticEditor(page);
  expect(after.scene.project.history).toHaveLength(initial.scene.project.history.length + 1);
  expect(snapshot.operation?.time).toBe(time);
  expect(snapshot.operation?.tracks).toEqual(['LeftForeArm']);
  expect(snapshot.manual!.baseTake).toEqual(source.take);
  expect(snapshot.manual!.root).toEqual([]);
  expect(snapshot.manual!.rotations).toEqual({});
  expect(snapshot.manual!.pointEdits).toHaveLength(1);
  expect(Object.keys(snapshot.manual!.pointEdits![0].joints!)).toEqual(['LeftForeArm']);
  assertOnlyChangedChannels(snapshot.take!, source.take, time, ['LeftForeArm']);
  await assertUndoRedo(page, initial, after, time);
  // Adding one channel at a new exact instant must be equally local. None of
  // the eight pre-existing source points may be resampled or replaced.
  const insertedTime = 3.017123;
  await atTime(page, insertedTime);
  const beforeInsertion = await backup(page);
  const insertionAngle = await stageValue(page, '关节 X 旋转（度）') - 15;
  await editStageValue(page, '关节 X 旋转（度）', insertionAngle);
  expect(await stageValue(page, '关节 X 旋转（度）')).toBeCloseTo(insertionAngle, 1);
  const inserted = await backup(page), insertedSnapshot = current(inserted);
  expect(inserted.scene.project.history).toHaveLength(after.scene.project.history.length + 1);
  expect(insertedSnapshot.manual!.pointEdits!.map(edit => edit.time)).toEqual([time, insertedTime]);
  expect(insertedSnapshot.operation?.tracks).toEqual(['LeftForeArm']);
  expect(insertedSnapshot.operation?.time).toBe(insertedTime);
  assertOnlyChangedChannels(insertedSnapshot.take!, snapshot.take!, insertedTime, ['LeftForeArm']);
  await assertUndoRedo(page, beforeInsertion, inserted, insertedTime);
  // Terminal channels are stored scene data as well. A source-row inspector
  // lets the teacher change one without introducing another body snapshot.
  const terminalTime = .70612;
  await atTime(page, terminalTime);
  await lane(page, 'LeftHandTip').getByRole('button', { name: '选择左指尖轨道', exact: true }).click();
  const beforeTerminal = await backup(page);
  await point(page, 'LeftHandTip', terminalTime).dblclick();
  const terminalX = page.getByRole('spinbutton', { name: '左指尖四元数X', exact: true });
  await terminalX.fill('0.02'); await terminalX.press('Tab');
  const terminal = await backup(page), terminalSnapshot = current(terminal);
  expect(terminal.scene.project.history).toHaveLength(inserted.scene.project.history.length + 1);
  expect(terminalSnapshot.operation?.tracks).toEqual(['LeftHandTip']);
  expect(terminalSnapshot.operation?.time).toBe(terminalTime);
  assertOnlyChangedChannels(terminalSnapshot.take!, insertedSnapshot.take!, terminalTime, ['LeftHandTip']);
  await assertUndoRedo(page, beforeTerminal, terminal, terminalTime);
  await closeDisclosures(page);
  await inspectAllTracks(page, source.take.times.length + 1);
  await closeDisclosures(page);
  await screenshot(page, info, 'point-edit-desktop.png');
});

test('@points 390px local Root editing and compact full-scene import retain the exact source, audio and operation history', async ({ page }, info) => {
  test.setTimeout(150_000);
  await page.setViewportSize({ width: 390, height: 844 });
  const source = await portableScene(page), time = 2.50391;
  await atTime(page, time);
  const initial = await backup(page);
  await editStageValue(page, 'Root X 位移（米）', sampleTake(source.take, time).root[0] + .08);
  const after = await backup(page), snapshot = current(after);
  expect(after.scene.project.history).toHaveLength(initial.scene.project.history.length + 1);
  expect(snapshot.operation?.tracks).toEqual(['root']);
  expect(snapshot.operation?.time).toBe(time);
  expect(snapshot.manual!.pointEdits![0].root![0]).toBeCloseTo(sampleTake(source.take, time).root[0] + .08, 5);
  expect(snapshot.manual!.pointEdits![0].joints).toBeUndefined();
  assertOnlyChangedChannels(snapshot.take!, source.take, time, ['root']);
  await assertUndoRedo(page, initial, after, time);
  await save(page);
  const beforeExport = await backup(page), bytes = await downloadBundle(page);
  // Check the public envelope independently. The import assertion below checks
  // reconstruction; this check establishes byte-exact original audio retention.
  const magic = Buffer.from('CHOREO-BUNDLE-1\n');
  expect(bytes.subarray(0, magic.length)).toEqual(magic);
  const headerLength = bytes.readUInt32LE(magic.length);
  const header = JSON.parse(bytes.subarray(magic.length + 4, magic.length + 4 + headerLength).toString());
  expect(header.format).toBe('choreo-scene-bundle-2');
  expect(header.scene.schema).toBe('compact-scene-1');
  const deltas = header.scene.takes.filter((take: { kind: string }) => take.kind === 'delta');
  expect(deltas).toHaveLength(1);
  expect(deltas[0].changes).toEqual([{ index: source.take.times.indexOf(time), root: snapshot.manual!.pointEdits![0].root }]);
  const audio = bytes.subarray(magic.length + 4 + headerLength);
  expect(audio).toEqual(source.wave);
  expect(header.audio.sha256).toBe(createHash('sha256').update(source.wave).digest('hex'));
  await nativeImport(page, bytes, 'point-edited-portable.choreo');
  const imported = await backup(page);
  expect(imported.scene.id).not.toBe(beforeExport.scene.id);
  expect(imported.scene.project).toEqual({ ...beforeExport.scene.project, teacherCheckedRevision: null });
  expect(imported.scene.viewer).toEqual(beforeExport.scene.viewer);
  expect(await audioHash(page)).toBe(header.audio.sha256);
  await page.reload(); await ready(page);
  expect((await backup(page)).scene.project).toEqual(imported.scene.project);
  await assertMinimalAutomaticEditor(page);
  const canvas = (await page.getByRole('img', { name: '人体编舞动作预览', exact: true }).boundingBox())!;
  expect(canvas.width).toBeGreaterThanOrEqual(390 * .95);
  expect(canvas.height).toBeGreaterThanOrEqual(844 * .75);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await closeDisclosures(page);
  await screenshot(page, info, 'point-edit-mobile.png');
});

test('@points a real IK gesture atomically records every changed chain rotation and preserves other source channels', async ({ page }, info) => {
  test.setTimeout(120_000);
  const source = await portableScene(page), time = 2.50391;
  await atTime(page, time);
  await pickOnStage(page, 'LeftFoot', source.take, time);
  const initial = await backup(page);
  await page.getByRole('button', { name: '手脚 IK', exact: true }).click();
  const indicator = page.getByLabel('IK 手脚目标', { exact: true });
  const originalFoot = evaluatePose(sampleTake(source.take, time)).LeftFoot.position;
  const view = await projection(page, initial);
  const start = view.point([originalFoot[0], originalFoot[1] + .16, originalFoot[2]]);
  const end = view.point([originalFoot[0], originalFoot[1] + .29, originalFoot[2]]);
  await page.mouse.move(start.x, start.y);
  await expect(indicator).toContainText('Y轴');
  await page.mouse.down(); await page.mouse.move(end.x, end.y, { steps: 9 }); await page.mouse.up();
  const after = await backup(page), snapshot = current(after);
  expect(after.scene.project.history).toHaveLength(initial.scene.project.history.length + 1);
  expect(snapshot.manual!.pointEdits).toHaveLength(1);
  const edit = snapshot.manual!.pointEdits![0], changed = Object.keys(edit.joints!) as JointName[];
  expect(changed).toEqual(expect.arrayContaining(['LeftUpperLeg', 'LeftLowerLeg']));
  expect(changed.every(joint => ['LeftUpperLeg', 'LeftLowerLeg', 'LeftFoot'].includes(joint))).toBe(true);
  expect(edit.time).toBe(time);
  expect(edit.root).toBeUndefined();
  expect(snapshot.operation?.tracks).toEqual(changed);
  assertOnlyChangedChannels(snapshot.take!, source.take, time, changed);
  const editedFoot = evaluatePose(sampleTake(snapshot.take!, time)).LeftFoot.position;
  expect(editedFoot[1]).toBeGreaterThan(originalFoot[1] + .06);
  await assertUndoRedo(page, initial, after, time);
  const record = page.locator('details.operation-history');
  await record.locator(':scope > summary').click();
  await expect(record).toContainText(snapshot.operation!.label);
  await screenshot(page, info, 'point-edit-ik-history.png');
});

test('@points uploaded private 37.5s dance exposes Root and all 25 channels; exact-time edit preserves every unrelated original sample', async ({ page }, info) => {
  test.skip(!existsSync(privateFixture), 'Private uploaded scene is supplied locally or through CHOREO_POINT_FIXTURE; never commit it.');
  test.setTimeout(300_000);
  const bytes = await readFile(privateFixture);
  const magic = Buffer.from('CHOREO-BUNDLE-1\n');
  expect(bytes.subarray(0, magic.length)).toEqual(magic);
  const sourceHeaderLength = bytes.readUInt32LE(magic.length);
  const sourceHeader = JSON.parse(bytes.subarray(magic.length + 4, magic.length + 4 + sourceHeaderLength).toString());
  const sourceProject = sourceHeader.scene.project as Backup['scene']['project'];
  const originalSnapshot = sourceProject.history[sourceProject.historyIndex], take = originalSnapshot.take!;
  expect(take.durationSeconds).toBe(37.5);
  expect(take.times).toHaveLength(5040);
  await page.goto('/'); await ready(page); await save(page);
  await nativeImport(page, bytes, 'private-supplied-dance.choreo');
  const imported = await backup(page);
  deepStrictEqual(current(imported), originalSnapshot, 'Import must preserve the entire supplied snapshot');
  await inspectAllTracks(page, 5040);
  const time = take.times[100];
  expect(time * 30).not.toBe(Math.round(time * 30));
  await atTime(page, time);
  await closeDisclosures(page);
  await page.getByRole('button', { name: '全身取景', exact: true }).click();
  // Native row selection preserves the exact double-precision source time.
  await lane(page, 'Head').getByRole('button', { name: '选择头部轨道', exact: true }).click();
  await expect(point(page, 'Head', time)).toBeVisible();
  await expectStageSelection(page, 'Head');
  expect(Number(await seconds(page).inputValue())).toBe(time);
  const initial = await backup(page), original = current(initial);
  const yaw = await stageValue(page, '关节 Y 旋转（度）');
  await editStageValue(page, '关节 Y 旋转（度）', yaw + (yaw < 60 ? 5 : -5));
  const after = await backup(page), changed = current(after);
  expect(after.scene.project.history).toHaveLength(initial.scene.project.history.length + 1);
  deepStrictEqual(changed.manual!.baseTake, original.manual!.baseTake, 'Imported baseTake must remain exact');
  deepStrictEqual(changed.manual!.pointBaseTake, take, 'Frozen point authority must equal the imported effective take exactly');
  deepStrictEqual(changed.manual!.root, original.manual!.root, 'Imported sparse Root keys must remain exact');
  deepStrictEqual(changed.manual!.rotations, original.manual!.rotations, 'Imported sparse joint keys must remain exact');
  expect(changed.operation?.time).toBe(time);
  expect(changed.operation?.tracks).toEqual(['Head']);
  assertOnlyChangedChannels(changed.take!, take, time, ['Head']);
  for (const [track, label, values] of [
    ['Head', '头部', take.poses[take.times.indexOf(time)].joints.Head],
    ['root', '整体位移', take.poses[take.times.indexOf(time)].root],
  ] as const) {
    await expect(lane(page, track).locator('.kf-lane-track')).toHaveAttribute('data-point-base-count', '5040');
    await lane(page, track).getByRole('button', { name: `选择${label}轨道`, exact: true }).click();
    const originalValue = timeline(page).locator('.kf-point-base-values code');
    await reveal(page, originalValue);
    await expect(originalValue).toBeVisible();
    await expect(originalValue).toHaveText(values.map(String).join(' · '));
    await closeDisclosures(page);
  }
  await lane(page, 'Head').getByRole('button', { name: '选择头部轨道', exact: true }).click();
  await page.getByRole('button', { name: '旋转工具', exact: true }).click();
  await assertUndoRedo(page, initial, after, time);
  const stage = page.getByRole('region', { name: '3D 动画舞台', exact: true });
  await stage.focus(); await stage.press('Delete');
  const removed = current(await backup(page));
  expect(removed.take!.times).toEqual(take.times);
  deepStrictEqual(removed.take!.poses, take.poses, 'Delete must restore every original Root and joint component');
  expect(removed.operation?.tracks).toEqual(['Head']);
  expect(removed.operation?.time).toBe(time);
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  deepStrictEqual(current(await backup(page)), changed, 'Undo Delete must restore the entire edited snapshot');
  // The real input's flat two-snapshot history exceeds the old 32 MiB header
  // cap. Compact export must make this actual edited scene portable again.
  await save(page);
  const beforeExport = await backup(page), editedBytes = await downloadBundle(page);
  const editedHeaderLength = editedBytes.readUInt32LE(magic.length);
  expect(editedHeaderLength).toBeLessThanOrEqual(32 * 1024 * 1024);
  const editedHeader = JSON.parse(editedBytes.subarray(magic.length + 4, magic.length + 4 + editedHeaderLength).toString());
  expect(editedHeader.format).toBe('choreo-scene-bundle-2');
  deepStrictEqual(editedBytes.subarray(magic.length + 4 + editedHeaderLength), bytes.subarray(magic.length + 4 + sourceHeaderLength), 'Real music payload must remain byte identical');
  await nativeImport(page, editedBytes, 'private-edited-dance.choreo');
  const restored = await backup(page);
  deepStrictEqual(restored.scene.project, beforeExport.scene.project, 'Real full-scene round trip must preserve all motion and operation history');
  deepStrictEqual(restored.scene.viewer, beforeExport.scene.viewer, 'Real full-scene round trip must preserve the exact viewer state');
  expect(await audioHash(page)).toBe(sourceHeader.audio.sha256);
  await assertMinimalAutomaticEditor(page);
  await closeDisclosures(page);
  const noticeClose = page.getByRole('button', { name: '关闭提示', exact: true });
  if (await noticeClose.isVisible()) await noticeClose.click();
  await screenshot(page, info, 'point-edit-private-dance.png');
});
