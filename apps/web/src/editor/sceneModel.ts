import { JOINT_NAMES, makeCountMap, makeKeyframeSequence, type BakedTake, type CountMap, type Pose } from '../../../../packages/core/src';
import { demoAudio } from '../demoAudio';
import { createScene, defaultSceneViewer, type SceneDocument, type SceneViewer } from '../scene';
import type { SceneProject, SceneSnapshot } from '../sceneProject';

export const DEMO_AUDIO_NAME = '八拍节奏示例.wav';
export const FIRST_SCENE_NAME = '我的第一段八拍';
export const UNTITLED_SCENE_NAME = '未命名场景';

export const initialCountMap = () => makeCountMap({ bpm: 120, musicBeatsPerDanceCount: 1, firstCountSourceSeconds: 0, startOctet: 0, octetCount: 8, audioDurationSeconds: 40 });

// New scenes start with a relaxed 15-degree arm clearance. The old vertical
// arm rest intersects the fitted hand/thigh proxies; saved takes are never
// migrated or repaired here. This is a fresh-scene seed, not playback correction.
const neutralPose = (): Pose => {
  const pose: Pose = { root: [0, 1.05, 0], joints: Object.fromEntries(JOINT_NAMES.map(joint => [joint, [0, 0, 0, 1]])) as Pose['joints'] };
  const halfAngle = 15 * Math.PI / 360;
  pose.joints.LeftUpperArm = [0, 0, Math.sin(halfAngle), Math.cos(halfAngle)];
  pose.joints.RightUpperArm = [0, 0, -Math.sin(halfAngle), Math.cos(halfAngle)];
  return pose;
};

/** Empty manual scenes have a valid neutral animation before the first gesture. */
export function neutralSnapshot(countMap: CountMap, title: string, planId?: string): SceneSnapshot {
  const take: BakedTake = {
    id: `take-${crypto.randomUUID()}`, schemaVersion: 'preview-1', planId: planId ?? `manual-${crypto.randomUUID()}`,
    countMapId: countMap.id, durationSeconds: countMap.durationSeconds, times: [0, countMap.durationSeconds],
    poses: [neutralPose(), neutralPose()], provenance: 'synthetic-demo',
  };
  return { title, countMap, plan: null, take, manual: makeKeyframeSequence(take, { pointInterpolation: 'hold-last-key-1' }) };
}

export function initialSession(title = FIRST_SCENE_NAME): SceneProject {
  const countMap = initialCountMap();
  return { history: [neutralSnapshot(countMap, title)], historyIndex: 0, revision: 1, audioDuration: 40, teacherCheckedRevision: null };
}

/** Viewer defaults for scenes created in the browser; the editor is always manual. */
export const manualViewer = (): SceneViewer => ({ ...defaultSceneViewer(), editorMode: 'keyframes' });

/** A fresh, independent scene with the original demo rhythm. */
export function blankSceneDocument(name = UNTITLED_SCENE_NAME): SceneDocument<SceneProject> {
  return createScene({ name, project: initialSession(name), audio: demoAudio(), audioName: DEMO_AUDIO_NAME, viewer: manualViewer() });
}
