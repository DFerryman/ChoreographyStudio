import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import { Quaternion, Vector3 } from 'three';
import {
  EDITABLE_JOINT_NAMES, JOINT_NAMES, addFootLock, analyzePose, analyzeStepAssistance,
  bakeKeyframeSequence, captureFootLock, evaluatePose, frameTime, getKeyframeCount,
  isJointRotationWithinLimits, makeKeyframeSequence, rotationFromDegrees, sampleTake,
  setStepAssistance, upsertRootKeyframe, upsertRotationKeyframe,
  type BakedTake, type JointName, type KeyframeSequence,
} from '../packages/core/src';
import type { SceneSnapshot } from '../apps/web/src/sceneProject';
import { clickRevealed } from './helpers';
import {
  backup, current, diagnostics, draft, frame, hiddenButton, jointPosition,
  openFixture, openRealism, ready, save, screenshot,
} from './realismHelpers';
import { selectStageJoint } from './stageInteractions';

const reports = new WeakMap<Page, ReturnType<typeof diagnostics>>();
const candidate = (page: Page) => page.getByLabel('步伐候选', { exact: true });
const adoptedStatus = (page: Page) => page.getByLabel('自动步伐状态', { exact: true });
const stage = (page: Page) => page.getByRole('region', { name: '3D 动画舞台', exact: true });
const legNames = new Set<JointName>([
  'LeftUpperLeg', 'LeftLowerLeg', 'LeftFoot', 'LeftToe', 'LeftHeel',
  'RightUpperLeg', 'RightLowerLeg', 'RightFoot', 'RightToe', 'RightHeel',
]);

test.beforeEach(async ({ page }) => {
  reports.set(page, diagnostics(page));
  // Every generation/API path fails closed. The actual public MHR skin and
  // its metadata/correctives are loaded through their ordinary static URLs.
  await page.route('**/api/**', route => route.abort('blockedbyclient'));
});
test.afterEach(async ({ page }, info) => {
  const report = reports.get(page)!;
  await info.attach('step-assistance-console-and-api', { body: JSON.stringify(report), contentType: 'application/json' });
  expect(report).toEqual({ errors: [], warnings: [], expectedHttpErrors: [], apiRequests: [] });
});

async function loaded(page: Page) {
  await expect(page.getByText('3D 预览暂时不可用', { exact: true }), 'A fallback drawing is not a loaded skinned humanoid').toHaveCount(0);
  await expect(page.locator('.stage3d-selection-announcement'), 'The actual loaded skin must remain interactive').toHaveCount(1);
  await expect(page.getByRole('img', { name: '人体编舞动作预览', exact: true })).toBeVisible();
}

async function movingFixture(page: Page, options: { distance?: number; arrivalFrame?: number; unusualPose?: boolean; locked?: boolean } = {}) {
  return openFixture(page, false, source => {
    source.scene.name = '稀疏位移自动步伐回归';
    source.scene.viewer.camera = { position: [1.3, 1.6, 4.2], target: [.25, 1.0, 0], zoom: 1.1 } as never;
    if (options.unusualPose) source.take.poses[4].joints.LeftLowerLeg = rotationFromDegrees([-100, 0, 0]);
    let manual = makeKeyframeSequence(source.take);
    const end = options.arrivalFrame ?? 120, distance = options.distance ?? .5;
    for (const [keyFrame, x] of [[0, 0], [end, distance], [480, distance]]) {
      manual = upsertRootKeyframe(manual, keyFrame, [x, 1.05, 0]);
    }
    // An independently authored upper-body track must survive leg assistance.
    for (const keyFrame of [0, 120]) manual = upsertRotationKeyframe(manual, 'LeftUpperArm', keyFrame, rotationFromDegrees([0, 0, 25]));
    if (options.locked) manual = addFootLock(manual, captureFootLock(sampleTake(source.take, 0), 'LeftFoot', 0, 120));
    const take = bakeKeyframeSequence(manual);
    Object.assign(source.scene.project.history[0] as SceneSnapshot, { manual, take });
    source.take = take;
  });
}

function authoritativeFields(sequence: KeyframeSequence) {
  const { id: _id, steps: _steps, ...author } = sequence;
  return author;
}

function sameAuthorChannels(assisted: BakedTake, original: BakedTake, endFrame = 120) {
  for (let at = 0; at <= endFrame; at++) {
    const time = frameTime(at, original.durationSeconds), expected = sampleTake(original, time), actual = sampleTake(assisted, time);
    expect([actual.root[0], actual.root[2]], `Root XZ at frame ${at}`).toEqual([expected.root[0], expected.root[2]]);
    expect(actual.root[1]).toBeGreaterThanOrEqual(expected.root[1] - .040000001);
    expect(actual.root[1]).toBeLessThanOrEqual(expected.root[1] + 1e-9);
    for (const joint of JOINT_NAMES.filter(name => !legNames.has(name))) expect(actual.joints[joint], `${joint} at frame ${at}`).toEqual(expected.joints[joint]);
  }
}

type StanceWitness = { frame: number; stance: 'LeftFoot' | 'RightFoot'; swing: 'LeftFoot' | 'RightFoot'; position: [number, number, number] };
/** Independent FK/contact check across five consecutive baked frames. A
 * self-reported low residual alone cannot establish that a foot stays planted. */
function stanceWitnesses(take: BakedTake): StanceWitness[] {
  const witnesses: StanceWitness[] = [];
  for (const side of ['Left', 'Right'] as const) {
    const other = side === 'Left' ? 'Right' : 'Left';
    let found: StanceWitness | undefined;
    for (let at = 6; at < 114 && !found; at++) {
      const poses = [-2, -1, 0, 1, 2].map(offset => sampleTake(take, (at + offset) / 30));
      const positions = poses.map(pose => evaluatePose(pose)[`${side}Foot`].position);
      const feet = poses.map(pose => analyzePose(pose).feet);
      if (!feet.every(foot => foot[side].minimumHeightMeters >= -.003 && foot[side].minimumHeightMeters <= .01 && foot[other].minimumHeightMeters > .01)) continue;
      if (!positions.every(position => new Vector3(...position).distanceTo(new Vector3(...positions[0])) <= .005)) continue;
      found = { frame: at, stance: `${side}Foot`, swing: `${other}Foot`, position: positions[2] };
    }
    expect(found, `${side} must provide a real planted-foot / lifted-other-foot interval`).toBeTruthy();
    witnesses.push(found!);
  }
  return witnesses;
}

async function visibleStance(page: Page, take: BakedTake, witness: StanceWitness) {
  await frame(page, witness.frame); await selectStageJoint(page, witness.stance);
  const visible = await jointPosition(page);
  expect(new Vector3(...visible).distanceTo(new Vector3(...witness.position))).toBeLessThan(.002);
  expect(JSON.parse((await stage(page).getAttribute('data-root-position'))!)).toEqual(sampleTake(take, witness.frame / 30).root);
  expect(JSON.parse((await stage(page).getAttribute('data-local-rotation'))!)).toEqual(sampleTake(take, witness.frame / 30).joints[witness.stance]);
  await loaded(page);
}

async function previewSteps(page: Page) {
  await openRealism(page);
  await page.getByRole('button', { name: '预览步伐', exact: true }).click();
  await expect(candidate(page)).toBeVisible();
}

test('@steps sparse sideways movement previews without writes, adopts one layer and visibly alternates planted and lifted feet', async ({ page }, info) => {
  test.setTimeout(90_000);
  await movingFixture(page); await loaded(page);
  const original = await backup(page), originalSnapshot = current(original), sequence = originalSnapshot.manual!;
  const previewTake = bakeKeyframeSequence(setStepAssistance(sequence));
  const previewWitnesses = stanceWitnesses(previewTake);
  await selectStageJoint(page, previewWitnesses[0].stance);
  await previewSteps(page);
  expect((await backup(page)).scene.project).toEqual(original.scene.project);
  await visibleStance(page, previewTake, previewWitnesses[0]);
  await screenshot(page, info, 'steps-sideways-left-stance-preview.png');
  await candidate(page).getByRole('button', { name: '关闭预览', exact: true }).click();
  await expect(candidate(page)).toHaveCount(0);
  expect((await backup(page)).scene.project).toEqual(original.scene.project);

  await previewSteps(page);
  await candidate(page).getByRole('button', { name: '采用步伐', exact: true }).click();
  await expect(candidate(page)).toHaveCount(0); await expect(adoptedStatus(page)).toBeVisible();
  const adopted = await backup(page), snapshot = current(adopted);
  expect(adopted.scene.project.revision).toBe(original.scene.project.revision + 1);
  expect(adopted.scene.project.history).toHaveLength(original.scene.project.history.length + 1);
  expect(authoritativeFields(snapshot.manual!)).toEqual(authoritativeFields(sequence));
  expect(snapshot.manual!.steps).toEqual({ schema: 'ground-steps-1', startFrame: 0, endFrame: 480 });
  expect(getKeyframeCount(snapshot.manual!)).toBe(getKeyframeCount(sequence));
  expect(snapshot.manual!.root).toHaveLength(3);
  const report = analyzeStepAssistance(snapshot.manual!);
  expect(report.stepCount).toBeGreaterThan(1);
  expect(report.maxStanceResidualMeters).toBeLessThanOrEqual(.005);
  sameAuthorChannels(snapshot.take!, originalSnapshot.take!);
  const witnesses = stanceWitnesses(snapshot.take!);
  await visibleStance(page, snapshot.take!, witnesses[1]);
  await screenshot(page, info, 'steps-sideways-right-stance-adopted.png');
  await page.getByRole('button', { name: '播放', exact: true }).click();
  await expect(page.getByRole('button', { name: '暂停', exact: true })).toBeVisible();
  await expect.poll(async () => Number(await page.getByRole('slider', { name: '关键帧时间线进度', exact: true }).inputValue())).toBeGreaterThan(witnesses[1].frame + 12);
  await screenshot(page, info, 'steps-sideways-playback.png');
  await page.getByRole('button', { name: '暂停', exact: true }).click();
  await expect(page.getByRole('button', { name: '播放', exact: true })).toBeVisible();
  expect((await backup(page)).scene.project).toEqual(adopted.scene.project);

  await page.setViewportSize({ width: 390, height: 844 });
  await clickRevealed(page, hiddenButton(page, '全身取景'));
  await openRealism(page); await adoptedStatus(page).scrollIntoViewIfNeeded();
  await expect(page.getByRole('button', { name: '关闭自动步伐', exact: true })).toBeEnabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await screenshot(page, info, 'steps-adopted-mobile390.png');
  await page.getByRole('button', { name: '关闭自动步伐', exact: true }).click();
  await expect(adoptedStatus(page)).toHaveCount(0);
  const removed = current(await backup(page));
  expect(removed.manual!.steps).toBeUndefined();
  expect(authoritativeFields(removed.manual!)).toEqual(authoritativeFields(sequence));
  expect(removed.take!.poses).toEqual(originalSnapshot.take!.poses);
});

test('@steps an impossible middle author K recomputes the plan without replacing keys, and survives undo, local reopen and a complete scene bundle', async ({ page }, info) => {
  test.setTimeout(120_000);
  await movingFixture(page, { unusualPose: true }); await loaded(page);
  const original = await backup(page), originalManual = current(original).manual!;
  await frame(page, 240); await clickRevealed(page, hiddenButton(page, '复制当前姿态'));
  await frame(page, 0); await previewSteps(page);
  await candidate(page).getByRole('button', { name: '采用步伐', exact: true }).click();
  const adopted = await backup(page), adoptedSnapshot = current(adopted), originalReport = analyzeStepAssistance(adoptedSnapshot.manual!);
  expect(originalReport.stepCount).toBeGreaterThan(0);
  await frame(page, 60); await clickRevealed(page, hiddenButton(page, '粘贴姿态与位置'));
  await expect(draft(page)).toBeVisible();
  await page.getByRole('button', { name: 'K 完整姿态', exact: true }).click();
  await expect(draft(page)).toHaveCount(0);
  const written = await backup(page), snapshot = current(written), manual = snapshot.manual!;
  expect(manual.steps).toEqual(adoptedSnapshot.manual!.steps);
  expect(manual.baseTake).toEqual(originalManual.baseTake);
  expect(manual.footLocks).toEqual(originalManual.footLocks);
  expect(getKeyframeCount(manual)).toBe(getKeyframeCount(originalManual) + EDITABLE_JOINT_NAMES.length + 1);
  expect(manual.root.filter(key => key.frame !== 60)).toEqual(originalManual.root);
  for (const joint of EDITABLE_JOINT_NAMES) expect(manual.rotations[joint]!.filter(key => key.frame !== 60)).toEqual(originalManual.rotations[joint] ?? []);
  const time = frameTime(60, snapshot.take!.durationSeconds), authored = sampleTake(snapshot.take!, time);
  const root = manual.root.find(key => key.frame === 60)!;
  expect(authored.root).toEqual(root.position);
  for (const joint of EDITABLE_JOINT_NAMES) expect(authored.joints[joint]).toEqual(manual.rotations[joint]!.find(key => key.frame === 60)!.rotation);
  expect(isJointRotationWithinLimits('LeftLowerLeg', authored.joints.LeftLowerLeg)).toBe(false);
  expect(Math.abs(new Quaternion(...authored.joints.LeftLowerLeg).dot(new Quaternion(...rotationFromDegrees([-100, 0, 0]))))).toBeCloseTo(1, 12);
  const report = analyzeStepAssistance(manual);
  expect(report).not.toEqual(originalReport);
  expect(report.stepCount).toBeLessThan(originalReport.stepCount);
  expect(report.segments.some(segment => segment.startFrame === 0 && segment.endFrame === 60 && segment.status === 'skipped')).toBe(true);
  expect(report.issues.some(issue => issue.code === 'authored-leg-pose')).toBe(true);
  await openRealism(page); await expect(adoptedStatus(page)).toBeVisible();
  await expect(page.getByLabel('步伐跳过原因', { exact: true })).toBeVisible();
  await selectStageJoint(page, 'LeftLowerLeg');
  expect(JSON.parse((await stage(page).getAttribute('data-local-rotation'))!)).toEqual(authored.joints.LeftLowerLeg);
  await screenshot(page, info, 'steps-middle-author-k-priority.png');

  await page.getByRole('button', { name: '撤销', exact: true }).click();
  expect(current(await backup(page))).toEqual(adoptedSnapshot);
  await page.getByRole('button', { name: '重做', exact: true }).click();
  const redone = await backup(page);
  expect(current(redone)).toEqual(snapshot);
  await save(page); await page.reload(); await ready(page); await loaded(page);
  expect((await backup(page)).scene.project).toEqual(redone.scene.project);

  const download = page.waitForEvent('download');
  await clickRevealed(page, hiddenButton(page, '下载完整场景包'));
  const path = await (await download).path(); expect(path).toBeTruthy();
  const bytes = await readFile(path!);
  await page.getByRole('button', { name: '场景', exact: true }).click();
  await page.getByRole('dialog', { name: '本机场景', exact: true }).getByRole('button', { name: '导入场景备份', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '导入场景备份', exact: true });
  await dialog.getByLabel('选择场景备份文件', { exact: true }).setInputFiles({ name: 'sparse-steps.choreo', mimeType: 'application/octet-stream', buffer: bytes });
  await dialog.getByLabel('导入后的场景名称', { exact: true }).fill('自动步伐作者优先备份副本');
  await dialog.getByRole('button', { name: '作为新场景导入', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator('.project-title h1')).toHaveText('自动步伐作者优先备份副本');
  const imported = await backup(page);
  expect(imported.scene.id).not.toBe(redone.scene.id);
  expect(imported.scene.project).toEqual(redone.scene.project);
  await frame(page, 60); await selectStageJoint(page, 'LeftLowerLeg');
  expect(JSON.parse((await stage(page).getAttribute('data-local-rotation'))!)).toEqual(authored.joints.LeftLowerLeg);
});

test('@steps excessive speed and an existing foot-lock conflict show visible skipped reasons without fake adoption or authority writes', async ({ page }, info) => {
  test.setTimeout(90_000);
  for (const entry of [
    { id: 'speed', options: { distance: 2, arrivalFrame: 10 }, code: 'too-fast', reason: '到达时间不足以完成迈步' },
    { id: 'foot-lock', options: { locked: true }, code: 'explicit-foot-lock', reason: '此段存在手动脚锁' },
  ]) {
    await movingFixture(page, entry.options); await loaded(page);
    const original = await backup(page), originalManual = current(original).manual!;
    await previewSteps(page);
    const panel = candidate(page);
    await expect(panel.getByLabel('步伐跳过原因', { exact: true })).toBeVisible();
    await expect(panel.getByLabel('步伐跳过原因', { exact: true })).toContainText(entry.reason);
    await expect(panel.getByRole('button', { name: '采用步伐', exact: true })).toBeDisabled();
    expect((await backup(page)).scene.project).toEqual(original.scene.project);
    const report = analyzeStepAssistance(setStepAssistance(originalManual));
    expect(report.stepCount).toBe(0); expect(report.issues.length).toBeGreaterThan(0);
    expect(report.issues.some(issue => issue.code === entry.code)).toBe(true);
    expect(report.segments.some(segment => segment.status === 'skipped')).toBe(true);
    await screenshot(page, info, `steps-unsupported-${entry.id}.png`);
    await panel.getByRole('button', { name: '关闭预览', exact: true }).click();
    await expect(panel).toHaveCount(0);
    expect((await backup(page)).scene.project).toEqual(original.scene.project);
  }
});
