import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { makeCountMap, sampleTake } from '../../../packages/core/src/index';
import { rotationFromDegrees } from '../../../packages/core/src/keyframes';
import { clonePose } from '../../../packages/core/src/humanoid';
import { JOINT_NAMES, type BakedTake, type Pose } from '../../../packages/core/src/motion-types';
import type { SceneSnapshot } from '../../../apps/web/src/sceneProject';

export const DIRECTORY = fileURLToPath(new URL('.', import.meta.url));
export const TARGET = { start: 4, end: 9.5 } as const;
export const sha = (bytes: string | Uint8Array) => createHash('sha256').update(bytes).digest('hex');
export const json = (value: unknown) => JSON.stringify(value, null, 2) + '\n';
export async function save(name: string, value: unknown): Promise<void> {
  await writeFile(`${DIRECTORY}/${name}`, json(value), { flag: 'wx' });
}
export async function readJSON<T>(name: string): Promise<T> {
  return JSON.parse(await readFile(`${DIRECTORY}/${name}`, 'utf8')) as T;
}
export function ownedSnapshot(): SceneSnapshot {
  // This is a local static source fixture, not model motion or human capture.
  const countMap = makeCountMap({ bpm: 120, musicBeatsPerDanceCount: 1,
    firstCountSourceSeconds: 0, octetCount: 8, audioDurationSeconds: 32 });
  countMap.id = 'owned-text-motion-countmap-32-120bpm-20261014';
  const pose: Pose = { root: [0, 1.05, 0],
    joints: Object.fromEntries(JOINT_NAMES.map(joint => [joint, [0, 0, 0, 1]])) as Pose['joints'] };
  pose.joints.LeftUpperArm = rotationFromDegrees([0, 0, 15]);
  pose.joints.RightUpperArm = rotationFromDegrees([0, 0, -15]);
  const take: BakedTake = { id: 'owned-static-relaxed-arms-source-20261014', schemaVersion: 'preview-1',
    planId: 'owned-static-source-no-arrangement', countMapId: countMap.id, durationSeconds: 32,
    times: [0, 32], poses: [clonePose(pose), clonePose(pose)], provenance: 'synthetic-demo' };
  return { title: '自有32秒静止实验原稿，无音乐文件', countMap, plan: null, take, audioOffsetSeconds: 0 };
}
export const sourceSampler = (snapshot: SceneSnapshot) => (time: number) => sampleTake(snapshot.take!, time);

/** Enforce that these preparation/audit scripts make no HTTP request. */
export function prohibitNetwork(): { attempts: number } {
  const counter = { attempts: 0 };
  globalThis.fetch = async () => { counter.attempts++; throw new Error('Offline experiment: network is prohibited.'); };
  return counter;
}
