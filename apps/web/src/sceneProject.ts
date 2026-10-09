import type { ArrangementPlan, BakedTake, CountMap, KeyframeSequence } from '../../../packages/core/src';

/** Persisted scene content; transient drafts, candidates and clipboards stay in the editor. */
export type SceneSnapshot = {
  title: string;
  countMap: CountMap;
  plan: ArrangementPlan | null;
  take: BakedTake | null;
  manual?: KeyframeSequence;
  /** Placement of the unchanged selected music segment on the scene timeline. */
  audioOffsetSeconds?: number;
};

export type SceneProject = {
  history: SceneSnapshot[];
  historyIndex: number;
  revision: number;
  audioDuration: number;
  teacherCheckedRevision: number | null;
};
