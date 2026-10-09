import { describe, expect, it } from 'vitest';
import { getBodyCollisions } from './capsuleCollision';
import { getReadyRapierBackend, initializeBodyCollisionBackend, isBodyCollisionBackendReady, loadRapierBackend } from './rapierBackend';
import { JOINT_NAMES, type Pose } from './motion-types';

describe('shared geometric backend initialization', () => {
  it('fails closed before convex contacts are ready and shares one concurrent initialization', async () => {
    const pose: Pose = { root: [0, 1.05, 0], joints: Object.fromEntries(JOINT_NAMES.map(joint => [joint, [0, 0, 0, 1]])) as Pose['joints'] };
    expect(isBodyCollisionBackendReady()).toBe(false);
    expect(() => getBodyCollisions(pose)).toThrow(/尚未就绪/);
    const first = loadRapierBackend(), second = loadRapierBackend();
    expect(first).toBe(second);
    await Promise.all([first, second, initializeBodyCollisionBackend()]);
    expect(isBodyCollisionBackendReady()).toBe(true);
    expect(getReadyRapierBackend().version()).toBe('0.21.0');
    expect(loadRapierBackend()).toBe(first);
    expect(getBodyCollisions(pose).selfCollisions).toHaveLength(2);
  });
});
