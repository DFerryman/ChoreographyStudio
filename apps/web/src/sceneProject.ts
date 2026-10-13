import type { SceneAudioTrack } from './audioTracks';
import type { AIMotionTrack } from '../../../packages/core/src/aiMotionTrack';
import type { ArrangementPlan, BakedTake, CameraTrack, CountMap, JointName, KeyframeSequence } from '../../../packages/core/src';

/** A committed operation; older snapshots may omit this without being rewritten. */
export type SceneOperation = {
  label: string;
  time?: number;
  tracks?: ('root' | JointName | 'camera')[];
};

/** Persisted scene content; transient drafts, candidates and clipboards stay in the editor. */
export type SceneSnapshot = {
  title: string;
  countMap: CountMap;
  plan: ArrangementPlan | null;
  take: BakedTake | null;
  manual?: KeyframeSequence;
  /** Model-authored continuous motion, layered over the unchanged source take. */
  aiMotion?: AIMotionTrack;
  /** Authored camera motion is independent of every dance and audio channel. */
  cameraTrack?: CameraTrack;
  /** Placement of the unchanged selected music segment on the scene timeline. */
  audioOffsetSeconds?: number;
  /** Additional imported audio, each on its own track; clip bytes live on the scene. */
  audioTracks?: SceneAudioTrack[];
  operation?: SceneOperation;
};

export type SceneProject = {
  history: SceneSnapshot[];
  historyIndex: number;
  revision: number;
  audioDuration: number;
  teacherCheckedRevision: number | null;
};
