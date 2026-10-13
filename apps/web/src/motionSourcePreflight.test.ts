import { describe, expect, it } from 'vitest';
import { makeAIMotionFixture } from '../../../packages/core/src/aiMotion.fixture';
import { rotationFromDegrees } from '../../../packages/core/src/keyframes';
import { checkAIMotionSourceBoundaries } from './motionSourcePreflight';

function healthy(mode: 'full' | 'interval' = 'full') {
  const request = makeAIMotionFixture(mode);
  for (const pose of [request.context.initialPose, request.context.boundaries.start.pose, request.context.boundaries.end.pose]) {
    pose.joints.LeftUpperArm = rotationFromDegrees([0, 0, 15]);
    pose.joints.RightUpperArm = rotationFromDegrees([0, 0, -15]);
  }
  return request;
}
describe('immutable source preflight before AI cost', () => {
  it('checks new relaxed rest without mutating source, while rejecting old overlapping rest', async () => {
    const request = healthy(), before = JSON.stringify(request);
    await expect(checkAIMotionSourceBoundaries(request)).resolves.toBeUndefined();
    expect(JSON.stringify(request)).toBe(before);
    await expect(checkAIMotionSourceBoundaries(makeAIMotionFixture())).rejects.toThrow('固定端点');
  });
  it('locks both interval endpoints, but full generation replaces the old ending', async () => {
    const interval = healthy('interval');
    interval.context.boundaries.end.pose.joints.LeftForeArm = rotationFromDegrees([90, 0, 0]);
    await expect(checkAIMotionSourceBoundaries(interval)).rejects.toThrow('固定端点');
    const full = healthy(); full.context.boundaries.end.pose.joints.LeftForeArm = rotationFromDegrees([90, 0, 0]);
    await expect(checkAIMotionSourceBoundaries(full)).resolves.toBeUndefined();
  });
  it('releases cancelled work before loading or inspecting source', async () => {
    const controller = new AbortController(); controller.abort();
    await expect(checkAIMotionSourceBoundaries(healthy(), controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
  });
});
