import { JOINT_NAMES, type JointName } from '../../../packages/core/src';

export type SceneVector3 = [number, number, number];
export type SceneView = 'front' | 'back' | 'left' | 'right' | 'top' | 'free';
export type SceneCamera = { position: SceneVector3; target: SceneVector3; zoom?: number };

/** Playback and editor view state; camera motion never changes the choreography. */
export type SceneViewer = {
  camera: SceneCamera | null;
  view: SceneView;
  mirror: boolean;
  rate: number;
  loop: boolean;
  countSound: boolean;
  selectedSlot: number;
  selectedJoint: JointName | null;
  time: number;
  gridVisible?: boolean;
  axesVisible?: boolean;
  rigMode?: 'skeleton' | 'body';
  /** Optional so existing choreo-scene-1 saves reopen without rebaking motion. */
  editorMode?: 'arrange' | 'keyframes';
  /** Optional editor view setting; selecting a tool never changes animation data. */
  transformTool?: 'select' | 'rotate' | 'translate';
};

export type SceneCoordinateSystem = {
  handedness: 'right';
  upAxis: '+Y';
  forwardAxis: '+Z';
  units: 'm';
  floorPlane: 'XZ';
  origin: SceneVector3;
};

export type SceneActor = {
  id: 'actor-1';
  rigId: 'synthetic-skeleton-1';
  provenance: 'synthetic-demo';
  joints: JointName[];
};

/** One locally saved scene owns its choreography, original music and editor view. */
export type SceneDocument<TProject, TViewer = SceneViewer> = {
  schema: 'choreo-scene-1';
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  coordinateSystem: SceneCoordinateSystem;
  actor: SceneActor;
  project: TProject;
  audio: Blob | null;
  audioName: string;
  viewer: TViewer;
};

/** The library lists this small record without reading any audio blobs. */
export type SceneMetadata = Pick<SceneDocument<unknown>, 'schema' | 'id' | 'name' | 'createdAt' | 'updatedAt' | 'audioName'>;

export function defaultSceneViewer(): SceneViewer {
  return {
    camera: null, view: 'front', mirror: false, rate: 1, loop: false,
    countSound: false, selectedSlot: 0, selectedJoint: null, time: 0,
    gridVisible: true, axesVisible: true, rigMode: 'skeleton', editorMode: 'arrange', transformTool: 'select',
  };
}

export function createScene<TProject, TViewer = SceneViewer>(input: {
  name: string;
  project: TProject;
  audio: Blob | null;
  audioName: string;
  viewer?: TViewer;
}): SceneDocument<TProject, TViewer> {
  const timestamp = new Date().toISOString();
  return {
    schema: 'choreo-scene-1', id: crypto.randomUUID(),
    name: input.name.trim() || '未命名场景', createdAt: timestamp, updatedAt: timestamp,
    coordinateSystem: { handedness: 'right', upAxis: '+Y', forwardAxis: '+Z', units: 'm', floorPlane: 'XZ', origin: [0, 0, 0] },
    actor: { id: 'actor-1', rigId: 'synthetic-skeleton-1', provenance: 'synthetic-demo', joints: [...JOINT_NAMES] },
    project: input.project, audio: input.audio, audioName: input.audioName,
    viewer: input.viewer ?? defaultSceneViewer() as TViewer,
  };
}

export function sceneMetadata(scene: SceneDocument<unknown, unknown>): SceneMetadata {
  const { schema, id, name, createdAt, updatedAt, audioName } = scene;
  return { schema, id, name, createdAt, updatedAt, audioName };
}
