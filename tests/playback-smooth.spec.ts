import { expect, test } from '@playwright/test';
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
    expect(independentFrames.length, 'Stage must advance between coarse React/Timeline updates').toBeGreaterThan(0);
    let largestAngle = 0;
    for (let index = 1; index < frames.length; index++) {
      const previous = frames[index - 1], frame = frames[index];
      if (frame.time <= previous.time) continue;
      const angle = new Quaternion(...previous.pose.joints.LeftUpperArm).angleTo(new Quaternion(...frame.pose.joints.LeftUpperArm));
      largestAngle = Math.max(largestAngle, angle);
      expect(angle).toBeLessThanOrEqual((frame.time - previous.time) / 3 * Math.PI / 180 + 1e-6);
    }
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
