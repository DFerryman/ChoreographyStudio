import { deepStrictEqual } from 'node:assert/strict';
import { expect, test, type Page } from '@playwright/test';
import { bakeKeyframeSequence, JOINT_NAMES, makeKeyframeSequence, rotationFromDegrees, upsertRotationKeyframe } from '../packages/core/src';
import { closeDisclosures } from './helpers';
import { backup, current, diagnostics, openFixture, screenshot } from './realismHelpers';

const timeline = (page: Page) => page.getByRole('region', { name: '手动关键帧时间线', exact: true });
const row = (page: Page, id: string) => timeline(page).locator(`.kf-lane[data-track-id="${id}"]`);
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

for (const width of [1440, 390]) {
  test(`@timelinesamples ${width}px limb source motion remains visible and exactly selectable without authored keys`, async ({ page }, info) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width, height: width === 1440 ? 1000 : 844 });
    const source = await openFixture(page, false, source => {
      source.take.times = [0, .70391, .70612, ...Array.from({ length: 451 }, (_, index) => 1 + index / 30)];
      source.take.poses = source.take.times.map(time => ({
        root: [time / 80, 1.05, 0],
        joints: Object.fromEntries(JOINT_NAMES.map((joint, index) => [joint,
          rotationFromDegrees([0, index * time / 120,
            joint === 'LeftUpperArm' ? 20 : joint === 'RightUpperArm' ? -20 : index * time / 240]),
        ])) as typeof source.take.poses[number]['joints'],
      }));
      let manual = makeKeyframeSequence(source.take);
      manual = upsertRotationKeyframe(manual, 'Spine', 30, rotationFromDegrees([0, 3, 0]));
      manual = upsertRotationKeyframe(manual, 'Spine', 60, rotationFromDegrees([0, 6, 0]));
      source.take = bakeKeyframeSequence(manual);
      Object.assign(source.scene.project.history[0], { manual, take: source.take });
    });
    await closeDisclosures(page);
    const initial = await backup(page), snapshot = current(initial);
    const sourceTimes = snapshot.manual!.baseTake.times;
    const sampleCount = new Set([...source.take.times, ...sourceTimes]).size;
    expect(sampleCount).toBeGreaterThan(sourceTimes.length);

    // Collapsed arms and legs must visibly describe their complete source data,
    // even though this scene has authored diamonds only on the body track.
    for (const id of ['root', 'body', 'left-arm', 'right-arm', 'left-leg', 'right-leg']) {
      const track = row(page, id).locator('.kf-lane-track');
      await expect(track).toHaveAttribute('data-source-count', String(sourceTimes.length));
      await expect(track).toHaveAttribute('data-sample-count', String(sampleCount));
      await expect(row(page, id).locator('.kf-sample-count')).toHaveText(String(sampleCount));
      await expect(row(page, id).locator('.kf-sample-count')).toBeVisible();
      if (id !== 'body') {
        await expect(track).toHaveAttribute('data-authored-count', '0');
        await expect(track.locator('.kf-lane-key')).toHaveCount(0);
      }
      const marks = await track.evaluate(element => {
        const source = element.querySelector<SVGPathElement>('.kf-source-dots')!;
        const calculated = element.querySelector<SVGPathElement>('.kf-evaluated-dots')!;
        return {
          sourceCount: source.getAttribute('d')!.split('M').length - 1,
          calculatedCount: calculated.getAttribute('d')!.split('M').length - 1,
          sourceWidth: Number.parseFloat(getComputedStyle(source).strokeWidth),
          sourceBottom: source.getBBox().y + source.getBBox().height,
          calculatedTop: calculated.getBBox().y,
          distinctColors: getComputedStyle(source).stroke !== getComputedStyle(calculated).stroke,
        };
      });
      expect(marks.sourceCount).toBe(sourceTimes.length);
      expect(marks.calculatedCount).toBe(sampleCount - sourceTimes.length);
      expect(marks.sourceWidth).toBeGreaterThanOrEqual(3);
      expect(marks.sourceBottom).toBeLessThan(marks.calculatedTop);
      expect(marks.distinctColors).toBe(true);
    }

    await screenshot(page, info, `timeline-dense-groups-${width}.png`);
    await row(page, 'left-arm').locator('.kf-group-toggle').click();
    await row(page, 'LeftUpperArm').getByRole('button', { name: '选择左肩轨道', exact: true }).click();
    await timeline(page).getByRole('button', { name: '逐帧查看时间线', exact: true }).click();
    const track = row(page, 'LeftUpperArm').locator('.kf-lane-track');
    await track.press('Home');
    await track.press('ArrowRight');
    await expect(row(page, 'LeftUpperArm').locator('[data-selected-point="true"]')).toHaveAttribute('data-time', String(.70391));
    await track.press('ArrowRight');
    const selected = row(page, 'LeftUpperArm').locator('[data-selected-point="true"]');
    await expect(selected).toHaveAttribute('data-time', String(.70612));
    await expect(selected).toBeInViewport();
    // A visible point hit uses the exact source instant even when the two
    // neighboring timestamps occupy the same canonical 30 fps frame.
    const rail = (await track.boundingBox())!;
    await page.mouse.click(rail.x + .70391 / 16 * rail.width, rail.y + rail.height / 2);
    await expect(selected).toHaveAttribute('data-time', String(.70391));
    await track.press('ArrowRight');
    await expect(selected).toHaveAttribute('data-time', String(.70612));
    await track.press('Enter');
    const inspector = timeline(page).locator('.kf-point-popover');
    await inspector.locator('.kf-source-values summary').first().click();
    await expect(inspector.locator('.kf-source-values code').first()).toHaveText(snapshot.manual!.baseTake.poses[2].joints.LeftUpperArm.map(String).join(' · '));
    await closeDisclosures(page);
    deepStrictEqual((await backup(page)).scene.project, initial.scene.project, 'Selecting visible source samples must preserve all exact channels and history');
    await closeDisclosures(page);
    await screenshot(page, info, `timeline-samples-${width}.png`);
  });
}
