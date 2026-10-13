import { expect, test } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { Quaternion } from 'three';
import { JOINT_NAMES, rotationFromDegrees, sampleCameraTrack, sampleTake, type CameraTrack, type Pose } from '../packages/core/src';
import type { SceneSnapshot } from '../apps/web/src/sceneProject';
import type { SceneViewer } from '../apps/web/src/scene';
import { backup, current, diagnostics, openFixture } from './realismHelpers';
import { seekSeconds } from './helpers';

for (const width of [1440, 390]) {
  test(`@playback-smooth ${width}px presents original contact-rich motion at the live clock without changing the scene`, async ({ page }, info) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width, height: 1000 });
    const report = diagnostics(page);
    const cameraTrack: CameraTrack = {
      schema: 'camera-track-1', baseCamera: { position: [0, 1.3, 4], target: [0, .7, 0] },
      keys: [
        { time: 0, camera: { position: [0, 1.3, 4], target: [0, .7, 0] } },
        { time: 16, camera: { position: [1, 1.6, 4], target: [.5, .8, 0] } },
      ],
    };
    const source = await openFixture(page, false, fixture => {
      fixture.take.poses.forEach((pose, index) => {
        const time = fixture.take.times[index];
        // An authored floor overlap, arm/body contact and out-of-envelope Head
        // expose accidental projection or clamping instead of original playback.
        pose.root = [time / 30, .42 + time / 100, 0];
        pose.joints.LeftUpperArm = rotationFromDegrees([0, 0, -75 + time / 3]);
        pose.joints.Head = rotationFromDegrees([0, 175, 0]);
      });
      (fixture.scene.project.history[0] as SceneSnapshot).cameraTrack = cameraTrack;
      (fixture.scene.viewer as SceneViewer).camera = cameraTrack.baseCamera;
    });
    const before = await backup(page), canvas = page.getByRole('img', { name: '人体编舞动作预览' });
    await expect(canvas).toHaveAttribute('data-motion-presentation', 'author');
    for (const time of [.7, 2.500123, .25]) {
      await seekSeconds(page, time);
      await expect(canvas).toHaveAttribute('data-render-time', String(time));
      const pose = JSON.parse((await canvas.getAttribute('data-render-pose'))!) as Pose;
      expect(pose).toEqual(sampleTake(source.take, time));
    }
    await seekSeconds(page, 0);
    await page.getByRole('button', { name: '播放', exact: true }).click();
    const frames = await canvas.evaluate(async element => {
      const records: { time: number; transport: number; pose: Pose; camera: {position:number[];target:number[];zoom:number} }[] = [];
      for (let index = 0; index < 90; index++) {
        await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
        const stage = element.closest<HTMLElement>('.stage3d')!;
        records.push({ time: Number(element.getAttribute('data-render-time')),
          transport: Number(document.querySelector<HTMLInputElement>('input[aria-label="时间线进度"]')!.value),
          pose: JSON.parse(element.getAttribute('data-render-pose')!),
          camera: { position: JSON.parse(stage.dataset.cameraPosition!), target: JSON.parse(stage.dataset.cameraTarget!), zoom: Number(stage.dataset.cameraZoom) },
        });
      }
      return records;
    });
    await page.getByRole('button', { name: '暂停', exact: true }).click();
    for (const frame of frames) {
      const expected = sampleTake(source.take, frame.time), camera = sampleCameraTrack(cameraTrack, frame.time, source.take.durationSeconds);
      expect(frame.pose.root).toEqual(expected.root);
      for (const joint of JOINT_NAMES) expect(frame.pose.joints[joint]).toEqual(expected.joints[joint]);
      // Camera orientation is a derived floating-point quaternion path; the
      // independent sampler can differ by a final ULP from the cached sampler.
      // Authored scene/track tuples remain strictly equal below.
      frame.camera.position.forEach((value, axis) => expect(value).toBeCloseTo(camera.position[axis], 12));
      frame.camera.target.forEach((value, axis) => expect(value).toBeCloseTo(camera.target[axis], 12));
      expect(frame.camera.zoom).toBe(camera.zoom ?? 1);
    }
    const independentFrames = frames.slice(1).filter((frame, index) => frame.time !== frames[index].time && frame.transport === frames[index].transport);
    // Slow software rendering may refresh below the UI cadence. Record the
    // observed cadence, and verify clock independence with fixed props below.
    expect(new Set(frames.map(frame => frame.time)).size, 'Rendered playback must advance').toBeGreaterThan(1);
    let largestAngle = 0;
    for (let index = 1; index < frames.length; index++) {
      const previous = frames[index - 1], frame = frames[index];
      if (frame.time <= previous.time) continue;
      const angle = new Quaternion(...previous.pose.joints.LeftUpperArm).angleTo(new Quaternion(...frame.pose.joints.LeftUpperArm));
      largestAngle = Math.max(largestAngle, angle);
      expect(angle).toBeLessThanOrEqual((frame.time - previous.time) / 3 * Math.PI / 180 + 1e-6);
    }
    // Pause intentionally snaps to the existing 30 fps Timeline frame. Wait
    // for that final UI/renderer commit before checking that playback stopped.
    // Native range.value serializes recurring frame seconds with fewer digits
    // than JavaScript String; compare the clocks, not their final printed ULP.
    await expect.poll(async () => Math.abs(Number(await canvas.getAttribute('data-render-time')) - Number(await page.getByRole('slider', { name: '时间线进度', exact: true }).inputValue()))).toBeLessThan(1e-10);
    const paused = Number(await canvas.getAttribute('data-render-time'));
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    expect(Number(await canvas.getAttribute('data-render-time'))).toBe(paused);
    const after = await backup(page);
    expect(after.scene.project).toEqual(before.scene.project);
    expect(current(after).take).toEqual(source.take);
    expect(after.scene.audioName).toBe(before.scene.audioName);
    await info.attach('playback-sampling', { body: JSON.stringify({ frames:frames.length, independentFrames:independentFrames.length, largestAngle, unchangedProject:true, diagnostics:report }), contentType:'application/json' });
    for (const value of Object.values(report)) expect(value).toEqual([]);
  });
}

test('@playback-smooth Stage advances its live clock while React time stays fixed', async ({ page }) => {
  test.skip(!!process.env.CHOREO_BASE_URL, 'Component clock fixture is local-only, outside production assets.');
  const report = diagnostics(page);
  await page.goto(`/@fs${fileURLToPath(new URL('./fixtures/stage-clock.html', import.meta.url))}`);
  const canvas = page.getByRole('img', { name: '人体编舞动作预览' });
  await expect(canvas).toHaveAttribute('data-motion-presentation', 'author');
  await expect.poll(async () => Number(await canvas.getAttribute('data-render-time'))).toBeGreaterThan(.1);
  const firstTime = Number(await canvas.getAttribute('data-render-time'));
  const first = await canvas.getAttribute('data-render-pose');
  await expect.poll(async () => Number(await canvas.getAttribute('data-render-time'))).toBeGreaterThan(firstTime + .1);
  expect(await canvas.getAttribute('data-render-pose')).not.toBe(first);
  await expect(page.locator('#stage-clock-fixture')).toHaveAttribute('data-input-time', '0');
  const takeAfter = await page.evaluate(() => JSON.stringify((window as unknown as { stageClockFixture: { take: unknown } }).stageClockFixture.take));
  expect(takeAfter).toBe(await page.locator('#stage-clock-fixture').getAttribute('data-input-take'));
  for (const value of Object.values(report)) expect(value).toEqual([]);
});
