/** Test-only helpers for the dance pipeline. Never import from the app or Worker. */
import { AI_MOTION_PROTOCOL, type AIMotionRequest } from './aiMotion';
import { estimateAIMotionBoundary, type AIMotionPoseSampler } from './aiMotionTrack';
import { RIG_CALIBRATION_VERSION, RIG_DEFINITIONS } from './humanoid';
import { JOINT_NAMES, type Pose, type Quat, type Vec3 } from './motion-types';

export function neutralDancePose(): Pose {
  const pose: Pose = { root: [0, 1.05, 0], joints: Object.fromEntries(JOINT_NAMES.map(joint => [joint, [0, 0, 0, 1]])) as Pose['joints'] };
  const half = 15 * Math.PI / 360;
  pose.joints.LeftUpperArm = [0, 0, Math.sin(half), Math.cos(half)];
  pose.joints.RightUpperArm = [0, 0, -Math.sin(half), Math.cos(half)];
  return pose;
}
export function makeDanceRequest(options: { sampler?: AIMotionPoseSampler; mode?: 'full' | 'interval'; start?: number; end?: number; bpm?: number; duration?: number; prompt?: string } = {}): { request: AIMotionRequest; sampler: AIMotionPoseSampler } {
  const bpm = options.bpm ?? 120, countSeconds = 60 / bpm;
  const octets = Math.max(2, Math.ceil((options.duration ?? 16) / (8 * countSeconds) - 1e-9), Math.ceil(16 / (8 * countSeconds) - 1e-9));
  const duration = octets * 8 * countSeconds;
  const sampler = options.sampler ?? (() => neutralDancePose());
  const mode = options.mode ?? 'full';
  const startSeconds = mode === 'full' ? 0 : options.start ?? 4, endSeconds = mode === 'full' ? duration : options.end ?? 8;
  const start = estimateAIMotionBoundary(sampler, startSeconds, 'before', duration), end = estimateAIMotionBoundary(sampler, endSeconds, 'after', duration);
  const request: AIMotionRequest = { protocol: AI_MOTION_PROTOCOL, prompt: options.prompt ?? '来一段流行舞', context: {
    requestId: `request-${Math.random().toString(36).slice(2)}`, sceneId: 'scene-dance', baseRevision: 1, sourceHash: 'a'.repeat(64),
    target: { mode, startSeconds, endSeconds },
    skeleton: { id: RIG_CALIBRATION_VERSION, coordinateSystem: 'right-handed-y-up-z-forward', rotationConvention: 'local-euler-xyz-degrees',
      joints: RIG_DEFINITIONS.map(joint => ({ name: joint.name, parent: joint.parent, offset: [...joint.offset] as Vec3, restRotation: [0, 0, 0, 1] as Quat })) },
    timing: { id: 'countmap-dance', version: 1, bpm, musicBeatsPerDanceCount: 1, firstCountSourceSeconds: 0, sourceOffsetSeconds: 0,
      durationSeconds: duration, octetCount: octets, countTimesSeconds: Array.from({ length: octets * 8 + 1 }, (_, index) => index * countSeconds), confirmed: true },
    initialPose: start.pose, ending: 'hold',
    before: mode === 'interval' ? [{ time: Math.max(0, startSeconds - .5), pose: sampler(Math.max(0, startSeconds - .5)) }] : [],
    after: mode === 'interval' ? [{ time: Math.min(duration, endSeconds + .5), pose: sampler(Math.min(duration, endSeconds + .5)) }] : [], boundaries: { start, end },
    audio: [{ id: 'primary', name: 'music.wav', hash: 'b'.repeat(64), durationSeconds: duration, offsetSeconds: 0, sourceOffsetSeconds: 0,
      muted: false, availability: 'available', coverage: { startSeconds: 0, endSeconds: duration } }],
    audioUnderstanding: false,
  } };
  return { request, sampler };
}
