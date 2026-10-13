/** Test-only protocol fixtures. Never import this file from the application or Worker. */
import { AI_MOTION_MODEL, AI_MOTION_PROTOCOL, type AIMotionBoundary, type AIMotionRequest, type AIMotionResult } from './aiMotion';
import { RIG_CALIBRATION_VERSION, RIG_DEFINITIONS } from './humanoid';
import { JOINT_NAMES, type Pose, type Quat, type Vec3 } from './motion-types';

function fixturePose(): Pose {
  return { root: [0, 1.05, 0], joints: Object.fromEntries(JOINT_NAMES.map(name => [name, [0, 0, 0, 1]])) as Pose['joints'] };
}
function fixtureBoundary(time: number): AIMotionBoundary {
  return { time, pose: fixturePose(), linearVelocity: [0, 0, 0],
    angularVelocity: Object.fromEntries(JOINT_NAMES.map(name => [name, [0, 0, 0]])) as AIMotionBoundary['angularVelocity'],
    support: 'unknown', supportConfidence: 0 };
}
export function makeAIMotionFixture(mode: 'full' | 'interval' = 'full'): AIMotionRequest {
  const startSeconds = mode === 'full' ? 0 : 4, endSeconds = mode === 'full' ? 32 : 8;
  return { protocol: AI_MOTION_PROTOCOL, prompt: '转身后抬起左臂，再轻柔收势。', context: {
    requestId: 'request-fixture', sceneId: 'scene-fixture', baseRevision: 3, sourceHash: 'a'.repeat(64),
    target: { mode, startSeconds, endSeconds },
    skeleton: { id: RIG_CALIBRATION_VERSION, coordinateSystem: 'right-handed-y-up-z-forward', rotationConvention: 'local-euler-xyz-degrees',
      joints: RIG_DEFINITIONS.map(joint => ({ name: joint.name, parent: joint.parent, offset: [...joint.offset] as Vec3, restRotation: [0, 0, 0, 1] as Quat })) },
    timing: { id: 'countmap-fixture', version: 1, bpm: 120, musicBeatsPerDanceCount: 1, firstCountSourceSeconds: 0, sourceOffsetSeconds: 0,
      durationSeconds: 32, octetCount: 8, countTimesSeconds: Array.from({ length: 65 }, (_, index) => index * 0.5), confirmed: true },
    initialPose: fixturePose(), ending: 'hold',
    before: mode === 'full' ? [] : [{ time: 3, pose: fixturePose() }],
    after: mode === 'full' ? [] : [{ time: 9, pose: fixturePose() }],
    boundaries: { start: fixtureBoundary(startSeconds), end: fixtureBoundary(endSeconds) },
    audio: [{ id: 'primary', name: 'fixture-music.wav', hash: 'b'.repeat(64), durationSeconds: 64, offsetSeconds: 0, sourceOffsetSeconds: 0,
      muted: false, availability: 'available', coverage: { startSeconds: 0, endSeconds: 32 } }],
    audioUnderstanding: false,
  } };
}
export function makeAIMotionResultFixture(request: AIMotionRequest): AIMotionResult {
  const { target, requestId, sourceHash } = request.context;
  return { protocol: AI_MOTION_PROTOCOL, provider: 'cloudflare-workers-ai', model: AI_MOTION_MODEL, requestId, sourceHash, target: { ...target },
    summary: '左臂舒展后平稳收势。', keyframes: target.mode === 'interval'
      ? [{ time: (target.startSeconds + target.endSeconds) / 2, root: [0.3, 1.1, 0], rotations: { LeftUpperArm: [0, 0, 70] } }]
      : [
        { time: (target.startSeconds + target.endSeconds) / 2, root: [0.2, 1.1, 0], rotations: { LeftUpperArm: [0, 0, 45] } },
        { time: target.endSeconds, root: [0.4, 1.05, 0], rotations: { LeftForeArm: [30, 0, 0] } },
      ] };
}
