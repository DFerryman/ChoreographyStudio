import type { ArrangementPlan, BakedTake, CountMap, JointName, KeyframeSequence } from '../../../packages/core/src';

/** A committed operation; older snapshots may omit this without being rewritten. */
export type SceneOperation = {
  label: string;
  time?: number;
  tracks?: ('root' | JointName)[];
};

/** Persisted scene content; transient drafts, candidates and clipboards stay in the editor. */
export type SceneSnapshot = {
  title: string;
  countMap: CountMap;
  plan: ArrangementPlan | null;
  take: BakedTake | null;
  manual?: KeyframeSequence;
  /** Placement of the unchanged selected music segment on the scene timeline. */
  audioOffsetSeconds?: number;
  operation?: SceneOperation;
};

export type SceneProject = {
  history: SceneSnapshot[];
  historyIndex: number;
  revision: number;
  audioDuration: number;
  teacherCheckedRevision: number | null;
};
