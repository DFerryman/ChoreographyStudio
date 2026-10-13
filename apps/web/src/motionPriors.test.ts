import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { loadMotionPriorClips } from './motionPriors';
import { MOTION_PRIOR_CATALOG } from '../../../packages/core/src/motionPriors';

function asset(id: string): Uint8Array<ArrayBuffer> {
  return new Uint8Array(readFileSync(new URL(`../public/motion-priors/${id}.motion`, import.meta.url)));
}

describe('explicit local human-motion reference loading', () => {
  it('loads only selected same-origin motion bytes, verifies identity, and reuses immutable decoded data', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => new Response(asset('cmu-61-08-a')));
    const first = await loadMotionPriorClips(['cmu-61-08-a', 'cmu-61-08-a'], { fetcher });
    expect(fetcher).toHaveBeenCalledTimes(1);
    const entry = MOTION_PRIOR_CATALOG.clips.find(clip => clip.id === 'cmu-61-08-a')!;
    expect(fetcher.mock.calls[0]).toEqual([`/motion-priors/cmu-61-08-a.motion?v=${entry.sourceHash}`, {
      signal: undefined, credentials: 'same-origin', redirect: 'error',
    }]);
    const source = first.get('cmu-61-08-a')!;
    expect(source.durationSeconds).toBe(8); expect(source.poses).toHaveLength(241);
    expect(Object.isFrozen(source)).toBe(true); expect(Object.isFrozen(source.poses[0].joints.LeftForeArm)).toBe(true);
    const again = await loadMotionPriorClips(['cmu-61-08-a'], { fetcher });
    expect(again.get('cmu-61-08-a')).toBe(source); expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('rejects altered bytes before decoding, then permits a later explicit attempt', async () => {
    const changed = asset('cmu-61-08-b'); changed[changed.length - 1] ^= 1;
    const fetcher = vi.fn<typeof fetch>(async () => new Response(changed));
    await expect(loadMotionPriorClips(['cmu-61-08-b'], { fetcher })).rejects.toThrow(/版本不匹配/);
    fetcher.mockImplementation(async () => new Response(asset('cmu-61-08-b')));
    expect((await loadMotionPriorClips(['cmu-61-08-b'], { fetcher })).get('cmu-61-08-b')!.poses.length).toBe(241);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('rejects unknown IDs, over-sized streaming bodies, HTTP failures and cancellation without automatic retries', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => new Response(null, { status: 404 }));
    await expect(loadMotionPriorClips(['../../private-scene'], { fetcher })).rejects.toThrow(/未知/);
    expect(fetcher).not.toHaveBeenCalled();
    await expect(loadMotionPriorClips(['cmu-61-08-c'], { fetcher })).rejects.toThrow(/404/);
    expect(fetcher).toHaveBeenCalledTimes(1);
    fetcher.mockImplementation(async () => new Response(new Uint8Array(1024 * 1024 + 1)));
    await expect(loadMotionPriorClips(['cmu-61-08-c'], { fetcher })).rejects.toThrow(/大小/);
    expect(fetcher).toHaveBeenCalledTimes(2);
    const controller = new AbortController(); controller.abort();
    await expect(loadMotionPriorClips(['cmu-61-08-c'], { fetcher, signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('cancels a pending body read even when an underlying source never finishes cancellation', async () => {
    const cancel = vi.fn(() => new Promise<void>(() => undefined));
    const fetcher = vi.fn<typeof fetch>(async () => new Response(new ReadableStream<Uint8Array>({
      pull: () => new Promise<void>(() => undefined), cancel,
    })));
    const controller = new AbortController();
    const pending = loadMotionPriorClips(['cmu-61-08-d'], { fetcher, signal: controller.signal });
    await Promise.resolve(); await Promise.resolve();
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(fetcher).toHaveBeenCalledTimes(1); expect(cancel).toHaveBeenCalledTimes(1);
  });
});
