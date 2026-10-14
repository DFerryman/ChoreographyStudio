/** Licensed human capture is a motion prior, never a physical approval. No audio,
 * scene files, provider calls or playback-time projections belong in this module. */
import { Quaternion, Vector3 } from 'three';
import { JOINT_NAMES, type JointName, type Pose, type Quat, type Vec3 } from './motion-types';
import { clonePose, evaluatePose, RIG_CALIBRATION_VERSION } from './humanoid';
import { AVATAR_COLLISION_PROFILE } from './avatarCapsules.generated';
import { estimateAIMotionBoundary, type AIMotionPoseSampler } from './aiMotionTrack';
import { validateAIMotionPlanResult, type AIMotionPlanCatalog, type AIMotionPlanClip,
  type AIMotionPlanRequest, type AIMotionPlanResult, type AIMotionPlanSegment } from './aiMotionPlan';
import type { AIMotionBoundary } from './aiMotion';

export const MOTION_PRIOR_CATALOG: AIMotionPlanCatalog = {
  version: 'cmu-neutral-rig-2-1',
  clips: [
    { id: 'cmu-85-12', sourceHash: '641cc765dbce56267b4a16a087174e487bdf16842a705e6fdc1cbb99329096bd',
      label: 'CMU 85_12 真人街舞连续动捕', durationSeconds: 37.5, skeletonId: RIG_CALIBRATION_VERSION,
      tags: ['真人动捕', '街舞', '连续转身与步法', '0–8秒主要站立转身', '18–34秒低位、倒置与地板技巧', '包含复杂支撑变化'] },
    { id: 'cmu-61-08', sourceHash: 'd24951aaeeb9e4335238b07138a5e4dda463e13d9490883e9cd475085b218890',
      label: 'CMU 61_08 真人单人 Salsa 连续动捕', durationSeconds: 56.25, skeletonId: RIG_CALIBRATION_VERSION,
      tags: ['真人动捕', 'Salsa', '全段主要站立', '左右步法与重心交换', '连续转身', '自然手势', '不含原演出音乐'] },
    {"id": "cmu-85-12-a", "sourceHash": "5dd54ad058b217383cfb641efbc111892d46acb91ec0278225064cb007012a1f", "label": "街舞：站立步法、转向与前倾", "durationSeconds": 8, "skeletonId": "neutral-rig-2", "tags": ["街舞", "真人连续动捕", "主要站立与步法", "转向幅度约133度", "短暂前倾和屈膝", "源区间0–8秒"]},
    {"id": "cmu-85-12-b", "sourceHash": "d34b54d3b06b40ef13e3dba6b7cdf7e4099314cdf99faf252d732c8d12c4f197", "label": "街舞：转身与较低重心变化", "durationSeconds": 8, "skeletonId": "neutral-rig-2", "tags": ["街舞", "真人连续动捕", "连续转向", "转向幅度约394度", "低重心变化", "源区间8–16秒"]},
    {"id": "cmu-85-12-c", "sourceHash": "e1161ebb675272977e3c7a273f1c4bbb34196b66529d0411aaac7798295bb803", "label": "街舞：站立转入低位与倒置", "durationSeconds": 8, "skeletonId": "neutral-rig-2", "tags": ["街舞", "真人连续动捕", "站立与低位转换", "倒置动作", "支撑需要检测", "源区间16–24秒"]},
    {"id": "cmu-85-12-d", "sourceHash": "56518fc87dd59caa67f9db7a5871bb712a355d5e97e17273d952b9880d9d75b5", "label": "街舞：倒置旋转与低位地板动作", "durationSeconds": 8, "skeletonId": "neutral-rig-2", "tags": ["街舞", "真人连续动捕", "倒置旋转", "地板动作", "复杂支撑变化", "源区间24–32秒"]},
    {"id": "cmu-85-12-e", "sourceHash": "123301c1652b4b04173e01dbf4b51b02a79b1f361e23a6df9cd935055991faca", "label": "街舞：低位转向后恢复站立", "durationSeconds": 5.5, "skeletonId": "neutral-rig-2", "tags": ["街舞", "真人连续动捕", "低位转向", "地板动作后站立", "末段收势", "源区间32–37.5秒"]},
    {"id": "cmu-61-08-a", "sourceHash": "5665a40c918cd65558fbd2ae76800bed75d9acdc392f4f8fc66f458d83fa5a46", "label": "Salsa：站立步法与转向", "durationSeconds": 8, "skeletonId": "neutral-rig-2", "tags": ["Salsa", "真人连续动捕", "站立左右步法", "转向幅度约239度", "重心交换", "源区间0–8秒"]},
    {"id": "cmu-61-08-b", "sourceHash": "9bb120046d205e4b09e45d7502789d5ff72d932146cb4c9b897b43902a4f1b5f", "label": "Salsa：连续较大转身与步法", "durationSeconds": 8, "skeletonId": "neutral-rig-2", "tags": ["Salsa", "真人连续动捕", "站立左右步法", "转向幅度约587度", "连续转身", "源区间8–16秒"]},
    {"id": "cmu-61-08-c", "sourceHash": "ea0213e8f0df41d563c2da540adea603a41df36634a2bed22b0e44c166fb8df3", "label": "Salsa：多次转身与连续步法", "durationSeconds": 8, "skeletonId": "neutral-rig-2", "tags": ["Salsa", "真人连续动捕", "站立连续步法", "转向幅度约684度", "连续多次转身", "源区间16–24秒"]},
    {"id": "cmu-61-08-d", "sourceHash": "3cf10466eae1f5d28ea619a43e465405dc1e5168e72da6306e446512b67fe93d", "label": "Salsa：持续转身与重心交换", "durationSeconds": 8, "skeletonId": "neutral-rig-2", "tags": ["Salsa", "真人连续动捕", "站立步法", "转向幅度约542度", "重心交换", "源区间24–32秒"]},
    {"id": "cmu-61-08-e", "sourceHash": "83a13b0cdf935a61f8b0349f70b3c317f3c0437e3221e3266569d1d8f7fe3b97", "label": "Salsa：站立转身与左右步法", "durationSeconds": 8, "skeletonId": "neutral-rig-2", "tags": ["Salsa", "真人连续动捕", "站立左右步法", "转向幅度约538度", "自然手势", "源区间32–40秒"]},
    {"id": "cmu-61-08-f", "sourceHash": "7484916e087f3944dd8365caeae0c3f7c8667f12f84b4368bdd094955b4f103b", "label": "Salsa：连续步法与转向变化", "durationSeconds": 8, "skeletonId": "neutral-rig-2", "tags": ["Salsa", "真人连续动捕", "站立连续步法", "转向幅度约406度", "自然手势", "源区间40–48秒"]},
    {"id": "cmu-61-08-g", "sourceHash": "65a191b8558ba5448a93b474b8d29db7085e113c963a3acdc9643a3d5fe60935", "label": "Salsa：末段连续步法与转向", "durationSeconds": 8.25, "skeletonId": "neutral-rig-2", "tags": ["Salsa", "真人连续动捕", "末段站立步法", "转向幅度约349度", "自然收势", "源区间48–56.25秒"]},
  ],
};

/** Exact stored endpoint facts apply only to the entire clip, not a chosen
 * subinterval. Facing is unavailable when the hips are inverted/vertical. */
const MOTION_PRIOR_ENDPOINT_FACTS: Record<string, string[]> = {
  "cmu-85-12": [
    "wholeClip.startRootXZ=[0.25948601961135864,-1.2319024801254272]",
    "wholeClip.startRootY=1.0149033069610596",
    "wholeClip.startFacingYawDeg=0.0",
    "wholeClip.endRootXZ=[0.23909203708171844,-0.2755797803401947]",
    "wholeClip.endRootY=0.9818628430366516",
    "wholeClip.endFacingYawDeg=-21.699344"
  ],
  "cmu-85-12-a": [
    "wholeClip.startRootXZ=[0.25948601961135864,-1.2319024801254272]",
    "wholeClip.startRootY=1.0149033069610596",
    "wholeClip.startFacingYawDeg=0.0",
    "wholeClip.endRootXZ=[0.05785238370299339,-0.8085108399391174]",
    "wholeClip.endRootY=0.9405612945556641",
    "wholeClip.endFacingYawDeg=-48.906918"
  ],
  "cmu-85-12-b": [
    "wholeClip.startRootXZ=[0.05785238370299339,-0.8085108399391174]",
    "wholeClip.startRootY=0.9405612945556641",
    "wholeClip.startFacingYawDeg=-48.906918",
    "wholeClip.endRootXZ=[0.24856321513652802,0.03958738595247269]",
    "wholeClip.endRootY=1.0272223949432373",
    "wholeClip.endFacingYawDeg=-126.130396"
  ],
  "cmu-85-12-c": [
    "wholeClip.startRootXZ=[0.24856321513652802,0.03958738595247269]",
    "wholeClip.startRootY=1.0272223949432373",
    "wholeClip.startFacingYawDeg=-126.130396",
    "wholeClip.endRootXZ=[-0.46359822154045105,-0.4596647322177887]",
    "wholeClip.endRootY=0.7354497313499451",
    "wholeClip.endFacingYawDeg=-10.464752"
  ],
  "cmu-85-12-d": [
    "wholeClip.startRootXZ=[-0.46359822154045105,-0.4596647322177887]",
    "wholeClip.startRootY=0.7354497313499451",
    "wholeClip.startFacingYawDeg=-10.464752",
    "wholeClip.endRootXZ=[0.40297630429267883,1.0036619901657104]",
    "wholeClip.endRootY=0.5816551446914673",
    "wholeClip.endFacingYawDeg=-41.338723"
  ],
  "cmu-85-12-e": [
    "wholeClip.startRootXZ=[0.40297630429267883,1.0036619901657104]",
    "wholeClip.startRootY=0.5816551446914673",
    "wholeClip.startFacingYawDeg=-41.338723",
    "wholeClip.endRootXZ=[0.23909203708171844,-0.2755797803401947]",
    "wholeClip.endRootY=0.9818628430366516",
    "wholeClip.endFacingYawDeg=-21.699344"
  ],
  "cmu-61-08": [
    "wholeClip.startRootXZ=[0.03228454664349556,-1.42569100856781]",
    "wholeClip.startRootY=1.05720055103302",
    "wholeClip.startFacingYawDeg=0.0",
    "wholeClip.endRootXZ=[-0.2687946856021881,-0.8929206132888794]",
    "wholeClip.endRootY=1.044177770614624",
    "wholeClip.endFacingYawDeg=137.961016"
  ],
  "cmu-61-08-a": [
    "wholeClip.startRootXZ=[0.03228454664349556,-1.42569100856781]",
    "wholeClip.startRootY=1.05720055103302",
    "wholeClip.startFacingYawDeg=0.0",
    "wholeClip.endRootXZ=[0.1999012529850006,1.3899147510528564]",
    "wholeClip.endRootY=1.0367058515548706",
    "wholeClip.endFacingYawDeg=-169.884549"
  ],
  "cmu-61-08-b": [
    "wholeClip.startRootXZ=[0.1999012529850006,1.3899147510528564]",
    "wholeClip.startRootY=1.0367058515548706",
    "wholeClip.startFacingYawDeg=-169.884549",
    "wholeClip.endRootXZ=[-0.25799325108528137,-0.49933451414108276]",
    "wholeClip.endRootY=1.0377373695373535",
    "wholeClip.endFacingYawDeg=11.413724"
  ],
  "cmu-61-08-c": [
    "wholeClip.startRootXZ=[-0.25799325108528137,-0.49933451414108276]",
    "wholeClip.startRootY=1.0377373695373535",
    "wholeClip.startFacingYawDeg=11.413724",
    "wholeClip.endRootXZ=[0.2699580192565918,-0.08653272688388824]",
    "wholeClip.endRootY=1.0339255332946777",
    "wholeClip.endFacingYawDeg=-124.761569"
  ],
  "cmu-61-08-d": [
    "wholeClip.startRootXZ=[0.2699580192565918,-0.08653272688388824]",
    "wholeClip.startRootY=1.0339255332946777",
    "wholeClip.startFacingYawDeg=-124.761569",
    "wholeClip.endRootXZ=[0.06033237650990486,-0.5279868245124817]",
    "wholeClip.endRootY=1.0601518154144287",
    "wholeClip.endFacingYawDeg=-49.798149"
  ],
  "cmu-61-08-e": [
    "wholeClip.startRootXZ=[0.06033237650990486,-0.5279868245124817]",
    "wholeClip.startRootY=1.0601518154144287",
    "wholeClip.startFacingYawDeg=-49.798149",
    "wholeClip.endRootXZ=[-0.4054306149482727,0.8612998723983765]",
    "wholeClip.endRootY=1.029170036315918",
    "wholeClip.endFacingYawDeg=-175.443867"
  ],
  "cmu-61-08-f": [
    "wholeClip.startRootXZ=[-0.4054306149482727,0.8612998723983765]",
    "wholeClip.startRootY=1.029170036315918",
    "wholeClip.startFacingYawDeg=-175.443867",
    "wholeClip.endRootXZ=[0.08930303156375885,0.34538593888282776]",
    "wholeClip.endRootY=1.030979037284851",
    "wholeClip.endFacingYawDeg=-35.524303"
  ],
  "cmu-61-08-g": [
    "wholeClip.startRootXZ=[0.08930303156375885,0.34538593888282776]",
    "wholeClip.startRootY=1.030979037284851",
    "wholeClip.startFacingYawDeg=-35.524303",
    "wholeClip.endRootXZ=[-0.2687946856021881,-0.8929206132888794]",
    "wholeClip.endRootY=1.044177770614624",
    "wholeClip.endFacingYawDeg=137.961016"
  ]
};
for (const clip of MOTION_PRIOR_CATALOG.clips) clip.tags.push(...MOTION_PRIOR_ENDPOINT_FACTS[clip.id]);
for (const clip of MOTION_PRIOR_CATALOG.clips) { Object.freeze(clip.tags); Object.freeze(clip); }
Object.freeze(MOTION_PRIOR_CATALOG.clips); Object.freeze(MOTION_PRIOR_CATALOG);
export const MOTION_PRIOR_MAX_BYTES = 1024 * 1024;
export const MOTION_PRIOR_MAX_SAMPLES = 1801;
const MAGIC = 'CHOREO-PRIOR-1\n\0';
const RECORD_BYTES = 8 + (3 + JOINT_NAMES.length * 4) * 4;
const fail = (message = '真人动作参考数据无效。'): never => { throw new Error(message); };

export interface MotionPriorClip {
  id: string;
  sourceHash: string;
  skeletonId: typeof RIG_CALIBRATION_VERSION;
  durationSeconds: number;
  times: number[];
  poses: Pose[];
}
export interface MotionPriorCompositionOrigin {
  kind: 'human-motion-prior';
  catalogVersion: string;
  sources: { clipId: string; sourceHash: string }[];
  segments: AIMotionPlanSegment[];
  adaptations?: string[];
  endingAdaptation?: { kind: 'stable-hold'; seconds: number };
  adaptationMetrics?: { maxHandDisplacementMeters: number; rmsHandDisplacementMeters: number;
    maxSoleOrientationChangeRadians?: number; maxSoleSmoothingRadians?: number; maxFootMarkerDisplacementMeters?: number;
    maxFootDisplacementMeters?: number; rmsFootDisplacementMeters?: number; maxKneeDisplacementMeters?: number };
}
export interface MotionPriorComposition {
  /** Full mode includes its final sample; interval samples exclude both ends. */
  samples: { time: number; pose: Pose }[];
  origin: MotionPriorCompositionOrigin;
  endingAdaptation?: { kind: 'stable-hold'; seconds: number };
  adaptation: { version: string; bodyProfileId: string; samples: number; maxHandDisplacementMeters: number; rmsHandDisplacementMeters: number;
    maxIKTargetErrorMeters: number; rmsIKTargetErrorMeters: number;
    maxFootDisplacementMeters: number; rmsFootDisplacementMeters: number; maxKneeDisplacementMeters: number;
    maxSoleOrientationChangeRadians: number };
}

export const MOTION_PRIOR_ARM_ADAPTATION_VERSION = 'quaternius-arm-target-1';
export const MOTION_PRIOR_ARM_TRAJECTORY_VERSION = 'arm-so3-trajectory-1';
export const MOTION_PRIOR_STANCE_ADAPTATION_VERSION = 'quaternius-cmu61-stance-1';
export const MOTION_PRIOR_SHIN_TRAJECTORY_VERSION = 'shin-axial-trajectory-1';
export const MOTION_PRIOR_KNEE_TRAJECTORY_VERSION = 'knee-flex-trajectory-1';
export const MOTION_PRIOR_NECK_TRAJECTORY_VERSION = 'neck-so3-trajectory-1';
export const MOTION_PRIOR_HEAD_TRAJECTORY_VERSION = 'head-so3-trajectory-1';
export const MOTION_PRIOR_SPINE_TRAJECTORY_VERSION = 'spine-so3-trajectory-1';
export const MOTION_PRIOR_UPPER_LEG_TRAJECTORY_VERSION = 'upperleg-so3-trajectory-1';
export const MOTION_PRIOR_HOLD_ADAPTATION_VERSION = 'full-hold-settle-1';
interface ArmFitMetrics { maximum: number; squared: number; count: number }
const ARM_JOINTS = JOINT_NAMES.filter(joint => /UpperArm|ForeArm|Hand$/.test(joint));
function rotationVector(rotation: Quaternion): Vector3 {
  if (rotation.w < 0) { rotation.x *= -1; rotation.y *= -1; rotation.z *= -1; rotation.w *= -1; }
  const sine = Math.hypot(rotation.x, rotation.y, rotation.z), angle = 2 * Math.atan2(sine, rotation.w);
  return sine < 1e-12 ? new Vector3() : new Vector3(rotation.x, rotation.y, rotation.z).multiplyScalar(angle / sine);
}
/** Symmetric SO(3) filtering conditions only newly generated trajectories.
 * Arms use 75ms and body/thighs 50ms to retain capture timing while controlling
 * retarget/IK noise and actual Hermite curvature. Thigh filtering applies to
 * every donor; it does not impose Salsa stance on other motion. Frozen ends and
 * their velocities stay exact through a C2 fade of the correction. */
function* conditionJointTrajectory(samples: MotionPriorComposition['samples'], start: AIMotionBoundary,
  end: AIMotionBoundary, mode: 'full' | 'interval', conditionUpperLegs = false, selection: 'all' | 'body' | 'arms' = 'all'): Generator<void, void, void> {
  const original = samples.map(sample => ({ time: sample.time, pose: clonePose(sample.pose) }));
  const width = .075, radius = 3 * width, fade = Math.min(.5, (end.time - start.time) / 4);
  const fullEnd: AIMotionBoundary = { ...end, pose: original.at(-1)!.pose,
    angularVelocity: Object.fromEntries(JOINT_NAMES.map(joint => [joint, [0, 0, 0]])) as AIMotionBoundary['angularVelocity'] };
  const after = mode === 'full' ? fullEnd : end;
  for (const [index, sample] of original.entries()) {
    const amount = smooth((sample.time - start.time) / fade) * smooth((end.time - sample.time) / fade);
    const joints = [...(selection === 'body' ? [] : ARM_JOINTS),
      ...(selection === 'arms' ? [] : ['Neck', 'Head', 'Spine'] as const),
      ...(conditionUpperLegs && selection !== 'arms' ? ['LeftUpperLeg', 'RightUpperLeg'] as const : [])];
    if (amount > 0) for (const joint of joints) {
      const localWidth = ARM_JOINTS.includes(joint) ? width : .05;
      const jointWidth = localWidth, jointRadius = ARM_JOINTS.includes(joint) ? radius : 3 * jointWidth;
      let mean = new Quaternion(...sample.pose.joints[joint]);
      // Two intrinsic means avoid Euler branches and are deterministic. Virtual
      // boundary samples carry frozen endpoint velocities instead of clamping.
      const neighbors: { weight: number; rotation: Quaternion }[] = [];
      for (let offset = -Math.ceil(jointRadius * 30); offset <= Math.ceil(jointRadius * 30); offset++) {
        const time = sample.time + offset / 30, weight = Math.exp(-.5 * ((offset / 30) / jointWidth) ** 2);
        const neighbor = original[index + offset];
        const pose = time <= start.time ? extrapolate(start, time) : time >= end.time ? extrapolate(after, time) : neighbor?.pose;
        if (pose) neighbors.push({ weight, rotation: new Quaternion(...pose.joints[joint]) });
      }
      const total = neighbors.reduce((sum, neighbor) => sum + neighbor.weight, 0);
      for (let iteration = 0; iteration < 2; iteration++) {
        const delta = new Vector3(), inverse = mean.clone().invert();
        for (const neighbor of neighbors) delta.addScaledVector(rotationVector(inverse.clone().multiply(neighbor.rotation)), neighbor.weight / total);
        const angle = delta.length(); if (angle < 1e-12) break;
        mean.multiply(new Quaternion().setFromAxisAngle(delta.multiplyScalar(1 / angle), angle)).normalize();
      }
      samples[index].pose.joints[joint] = new Quaternion(...sample.pose.joints[joint]).slerp(mean, amount).normalize().toArray() as Quat;
    }
    if (conditionUpperLegs && selection !== 'arms' && amount > 0) {
      const before = evaluatePose(sample.pose), after = evaluatePose(samples[index].pose);
      for (const side of ['Left', 'Right'] as const) {
        const lower = `${side}LowerLeg` as const, foot = `${side}Foot` as const;
        const compensated = new Quaternion(...after[lower].rotation).invert().multiply(new Quaternion(...before[foot].rotation));
        samples[index].pose.joints[foot] = boundedFootRotation(compensated.toArray() as Quat);
      }
    }
    if (index % 16 === 15) yield;
  }
}
type Bounds = { min: Vector3; max: Vector3 };
function bounds(points: readonly (readonly number[])[], rotation: Quaternion, offset: Vector3): Bounds {
  const min = new Vector3(Infinity, Infinity, Infinity), max = new Vector3(-Infinity, -Infinity, -Infinity), point = new Vector3();
  for (const p of points) { point.set(p[0], p[1], p[2]).applyQuaternion(rotation).add(offset); min.min(point); max.max(point); }
  return { min, max };
}
function bandWeight(coordinate: number, minimum: number, maximum: number, band: number): number {
  const centre = (minimum + maximum) / 2, half = (maximum - minimum) / 2;
  return 1 - smooth((Math.abs(coordinate - centre) - Math.max(0, half - band)) / (2 * band));
}
/** C2 positive-part smoothing: avoids a hard contact-onset kink in the target. */
function positive(amount: number, band: number): number {
  if (amount <= 0) return 0;
  if (amount >= band) return amount;
  const u = amount / band; return band * u ** 3 * (6 + u * (-8 + 3 * u));
}
const principal = (angle: number) => ((angle + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;
const union = (a: number, b: number) => (a ** 8 + b ** 8) ** (1 / 8);
function boundedAngle(angle: number, minimum: number, maximum: number, band = 2 * Math.PI / 180): number {
  return angle >= 0 ? maximum - positive(maximum - angle, band) : minimum + positive(angle - minimum, band);
}
function boundedSwingTwist(rotation: Quat, maximumSwing: number, minimumTwist: number, maximumTwist: number): Quat {
  const q = new Quaternion(...rotation), twistAngle = principal(2 * Math.atan2(q.y, q.w));
  const twist = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), twistAngle), swing = q.clone().multiply(twist.clone().invert());
  const direction = new Vector3(0, -1, 0).applyQuaternion(swing), swingAngle = Math.acos(Math.max(-1, Math.min(1, -direction.y)));
  const bounded = maximumSwing - positive(maximumSwing - swingAngle, 2 * Math.PI / 180);
  return new Quaternion().slerp(swing, swingAngle > 1e-12 ? bounded / swingAngle : 1)
    .multiply(new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), boundedAngle(twistAngle, minimumTwist, maximumTwist))).normalize().toArray() as Quat;
}
function boundedFootRotation(rotation: Quat): Quat {
  const q = new Quaternion(...rotation), d = new Vector3(0, -1, 0).applyQuaternion(q), rad = Math.PI / 180;
  const flexion = Math.atan2(d.z, -d.y), lateral = Math.atan2(d.x, Math.hypot(d.y, d.z)), twist = principal(2 * Math.atan2(q.y, q.w));
  const f = boundedAngle(flexion, -60 * rad, 40 * rad), l = boundedAngle(lateral, -30 * rad, 30 * rad), t = boundedAngle(twist, -30 * rad, 30 * rad);
  if (f === flexion && l === lateral && t === twist && Math.acos(Math.max(-1, Math.min(1, -d.y))) <= 63 * rad) return [...rotation];
  const target = new Vector3(Math.sin(l), -Math.cos(f) * Math.cos(l), Math.sin(f) * Math.cos(l));
  const fitted = new Quaternion().setFromUnitVectors(new Vector3(0, -1, 0), target).multiply(new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), t));
  return boundedSwingTwist(fitted.toArray() as Quat, 65 * rad, -30 * rad, 30 * rad);
}
/** Measured CMU61 donor-to-Quaternius stance calibration. Independent actual
 * skin and convex-proxy sweeps found proximal-thigh intersections: a half axial
 * hip twist with 5deg outward stance clears the reference with modest knee
 * motion. The source knee hinge and Root are retained; ankle position is an
 * explicit soft goal. No collision pair or anatomical envelope is changed.
 * This calibration is applied only to the measured standing Salsa donor. */
export function adaptMotionPriorStance(input: Pose): Pose {
  const result = clonePose(input), originalWorld = evaluatePose(input), y = new Vector3(0, 1, 0), z = new Vector3(0, 0, 1), rad = Math.PI / 180;
  for (const side of ['Left', 'Right'] as const) {
    const upper = `${side}UpperLeg` as const, lower = `${side}LowerLeg` as const, foot = `${side}Foot` as const;
    const q = new Quaternion(...input.joints[upper]), twist = principal(2 * Math.atan2(q.y, q.w));
    result.joints[upper] = new Quaternion().setFromAxisAngle(z, (side === 'Left' ? 1 : -1) * 5.5 * rad)
      .multiply(q).multiply(new Quaternion().setFromAxisAngle(y, -.5 * twist)).normalize().toArray() as Quat;
  }
  const fittedWorld = evaluatePose(result);
  for (const side of ['Left', 'Right'] as const) {
    const lower = `${side}LowerLeg` as const, foot = `${side}Foot` as const;
    let qFoot = new Quaternion(...fittedWorld[lower].rotation).invert().multiply(new Quaternion(...originalWorld[foot].rotation));
    const qLower = new Quaternion(...result.joints[lower]), shin = principal(2 * Math.atan2(qLower.y, qLower.w)), ankle = principal(2 * Math.atan2(qFoot.y, qFoot.w));
    const requested = shin + ankle - boundedAngle(ankle, -30 * rad, 30 * rad);
    const transfer = boundedAngle(requested, -25 * rad, 25 * rad) - shin;
    const turn = new Quaternion().setFromAxisAngle(y, transfer);
    result.joints[lower] = qLower.multiply(turn).normalize().toArray() as Quat;
    qFoot = turn.invert().multiply(qFoot).normalize();
    // The paired shin rotation preserves ankle and complete world sole. When
    // tibial capacity is exhausted, the sole orientation becomes a soft goal;
    // bounded residual retargeting remains inside the unchanged foot envelope.
    result.joints[foot] = boundedFootRotation(qFoot.toArray() as Quat);
  }
  return result;
}
/** Filter knee flexion for every donor, with measured Salsa shin twist handled
 * separately. Pairing the inverse lower-leg correction at the foot retains the
 * world sole direction until the unchanged foot envelope needs a soft goal.
 * A C2 fade preserves the frozen endpoint poses and velocities. */
function* conditionLowerLegTrajectory(samples: MotionPriorComposition['samples'], start: AIMotionBoundary,
  end: AIMotionBoundary, conditionShinTwist: boolean): Generator<void, void, void> {
  const original = samples.map(sample => ({ time: sample.time, pose: clonePose(sample.pose) }));
  const width = .075, radius = Math.ceil(3 * width * 30), fade = Math.min(.5, (end.time - start.time) / 4), y = new Vector3(0, 1, 0), x = new Vector3(1, 0, 0);
  const twist = (pose: Pose, joint: JointName) => { const q = pose.joints[joint]; return principal(2 * Math.atan2(q[1], q[3])); };
  const flexion = (pose: Pose, joint: JointName) => { const direction = new Vector3(0, -1, 0).applyQuaternion(new Quaternion(...pose.joints[joint])); return Math.atan2(direction.z, -direction.y); };
  for (const [index, sample] of original.entries()) {
    const amount = smooth((sample.time - start.time) / fade) * smooth((end.time - sample.time) / fade);
    for (const side of ['Left', 'Right'] as const) {
      const lower = `${side}LowerLeg` as const, foot = `${side}Foot` as const, reference = twist(sample.pose, lower);
      let average = 0, total = 0, averageFlexion = 0, totalFlexion = 0;
      for (let offset = -radius; offset <= radius; offset++) {
        const neighbor = original[Math.max(0, Math.min(original.length - 1, index + offset))];
        const weight = Math.exp(-.5 * ((offset / 30) / width) ** 2);
        if (conditionShinTwist) { average += (reference + principal(twist(neighbor.pose, lower) - reference)) * weight; total += weight; }
        if (Math.abs(offset) <= Math.ceil(3 * .05 * 30)) {
          const flexWeight = Math.exp(-.5 * ((offset / 30) / .05) ** 2);
          averageFlexion += flexion(neighbor.pose, lower) * flexWeight; totalFlexion += flexWeight;
        }
      }
      const sourceLower = new Quaternion(...sample.pose.joints[lower]);
      const deltaFlexion = (averageFlexion / totalFlexion - flexion(sample.pose, lower)) * amount;
      // A parent-X increment changes only flexion; source lateral bend is
      // retained, including inside a bridge to immutable interval anchors.
      const fittedLower = new Quaternion().setFromAxisAngle(x, -deltaFlexion).multiply(sourceLower);
      if (conditionShinTwist) {
        const fittedTwist = principal(2 * Math.atan2(fittedLower.y, fittedLower.w));
        const targetTwist = reference + (average / total - reference) * amount;
        fittedLower.multiply(new Quaternion().setFromAxisAngle(y, principal(targetTwist - fittedTwist)));
      }
      fittedLower.normalize();
      samples[index].pose.joints[lower] = fittedLower.toArray() as Quat;
      const pairedFoot = fittedLower.clone().invert().multiply(sourceLower).multiply(new Quaternion(...sample.pose.joints[foot])).normalize().toArray() as Quat;
      samples[index].pose.joints[foot] = boundedFootRotation(pairedFoot);
    }
    if (index % 16 === 15) yield;
  }
}
function solveFour(matrix: number[][], input: number[]): number[] {
  const rows = matrix.map((row, i) => [...row, input[i]]);
  for (let column = 0; column < 4; column++) {
    let pivot = column;
    for (let row = column + 1; row < 4; row++) if (Math.abs(rows[row][column]) > Math.abs(rows[pivot][column])) pivot = row;
    [rows[pivot], rows[column]] = [rows[column], rows[pivot]];
    const divisor = rows[column][column];
    if (!Number.isFinite(divisor) || Math.abs(divisor) < 1e-12) return [0, 0, 0, 0];
    for (let entry = column; entry <= 4; entry++) rows[column][entry] /= divisor;
    for (let row = 0; row < 4; row++) if (row !== column) {
      const amount = rows[row][column];
      for (let entry = column; entry <= 4; entry++) rows[row][entry] -= rows[column][entry] * amount;
    }
  }
  return rows.map(row => row[4]);
}
/** Source-seeded damped local increments avoid choosing a new absolute pole or
 * humeral roll frame at every sample. Four DOF: upper XYZ plus elbow hinge X. */
function fitArm(input: Pose, source: Pose, side: 'Left' | 'Right', target: Vector3, elbowTarget: Vector3, middleTarget: Vector3, damping: number): Pose {
  const result = clonePose(input), upper = `${side}UpperArm` as JointName, lower = `${side}ForeArm` as JointName, hand = `${side}Hand` as JointName;
  const axes = [new Vector3(1, 0, 0), new Vector3(0, 1, 0), new Vector3(0, 0, 1)];
  for (let iteration = 0; iteration < 12; iteration++) {
    const world = evaluatePose(result), shoulder = new Vector3(...world[upper].position), elbow = new Vector3(...world[lower].position), wrist = new Vector3(...world[hand].position);
    const rotation = new Quaternion(...world[upper].rotation), directions = axes.map(axis => axis.clone().applyQuaternion(rotation));
    const wristLever = wrist.clone().sub(shoulder), elbowLever = elbow.clone().sub(shoulder);
    const wristColumns = directions.map(axis => axis.clone().cross(wristLever));
    wristColumns.push(directions[0].clone().cross(wrist.clone().sub(elbow)));
    const elbowColumns = [...directions.map(axis => axis.clone().cross(elbowLever)), new Vector3()];
    const middleColumns = wristColumns.map((column, index) => column.clone().add(elbowColumns[index]).multiplyScalar(.5));
    const error = [...target.clone().sub(wrist).toArray(), ...elbowTarget.clone().sub(elbow).toArray(),
      ...middleTarget.clone().sub(wrist.clone().add(elbow).multiplyScalar(.5)).toArray()];
    const jacobian = Array.from({ length: 9 }, (_, row) => Array.from({ length: 4 }, (_, column) =>
      (row < 3 ? wristColumns[column] : row < 6 ? elbowColumns[column] : middleColumns[column]).getComponent(row % 3)));
    const objectiveWeight = (row: number) => row < 3 ? 4 : row < 6 ? .25 : 4;
    const normal = Array.from({ length: 4 }, (_, i) => Array.from({ length: 4 }, (_, j) =>
      jacobian.reduce((sum, row, k) => sum + row[i] * row[j] * objectiveWeight(k), i === j ? 2 * damping ** 2 : 0)));
    const rhs = Array.from({ length: 4 }, (_, column) => jacobian.reduce((sum, row, k) => sum + row[column] * error[k] * objectiveWeight(k), 0));
    const towardSource = new Quaternion(...result.joints[upper]).invert().multiply(new Quaternion(...source.joints[upper]));
    if (towardSource.w < 0) { towardSource.x *= -1; towardSource.y *= -1; towardSource.z *= -1; towardSource.w *= -1; }
    const sine = Math.hypot(towardSource.x, towardSource.y, towardSource.z), angleToSource = 2 * Math.atan2(sine, towardSource.w);
    const sourceIncrement = sine < 1e-10 ? [0, 0, 0] : [towardSource.x, towardSource.y, towardSource.z].map(value => value * angleToSource / sine);
    for (let axis = 0; axis < 3; axis++) rhs[axis] += damping ** 2 * sourceIncrement[axis];
    const sourceDown = new Vector3(0, -1, 0).applyQuaternion(new Quaternion(...source.joints[lower]));
    const currentDown = new Vector3(0, -1, 0).applyQuaternion(new Quaternion(...result.joints[lower]));
    rhs[3] += damping ** 2 * (Math.atan2(currentDown.z, -currentDown.y) - Math.atan2(sourceDown.z, -sourceDown.y));
    const delta = solveFour(normal, rhs), amount = Math.hypot(...delta);
    const scale = amount > .15 ? .15 / amount : 1;
    const increment = new Vector3(delta[0] * scale, delta[1] * scale, delta[2] * scale), angle = increment.length();
    if (angle > 1e-12) result.joints[upper] = new Quaternion(...result.joints[upper])
      .multiply(new Quaternion().setFromAxisAngle(increment.multiplyScalar(1 / angle), angle)).normalize().toArray() as Quat;
    const qLower = new Quaternion().setFromAxisAngle(axes[0], delta[3] * scale)
      .multiply(new Quaternion(...result.joints[lower])).normalize();
    const down = new Vector3(0, -1, 0).applyQuaternion(qLower);
    const flexion = Math.atan2(down.z, -down.y), bendBand = 5 * Math.PI / 180;
    // Stay on the capture's flexed-elbow branch. A smooth extension bound
    // avoids switching to an equally reachable hyperextended IK solution.
    const maximumFlexion = 155 * Math.PI / 180;
    const boundedFlexion = maximumFlexion - positive(maximumFlexion - positive(flexion, bendBand), bendBand);
    const pronation = principal(2 * Math.atan2(qLower.y, qLower.w));
    result.joints[lower] = new Quaternion().setFromAxisAngle(axes[0], -boundedFlexion)
      .multiply(new Quaternion().setFromAxisAngle(axes[1], pronation)).normalize().toArray() as Quat;
  }
  return result;
}
/**
 * Donor hand paths can pass through a wider target body even with valid human
 * angles. Fit continuous wrist targets to the pinned avatar's actual torso and
 * hand extents, then solve its fixed-length arms geometrically. This changes
 * new generated gestures, not source captures. The physical gate remains final.
 */
export function adaptMotionPriorArmTargets(input: Pose, seed?: { source: Pose; fitted: Pose }, metrics?: ArmFitMetrics): Pose {
  const result = clonePose(input), world = evaluatePose(input), chest = world.Chest;
  for (const hand of ['LeftHand', 'RightHand'] as const) {
    const q = new Quaternion(...input.joints[hand]), direction = new Vector3(0, -1, 0).applyQuaternion(q), rad = Math.PI / 180;
    // A conservative half-degree generation margin prevents an intrinsic
    // Hermite/mean interpolation from overshooting the unchanged hard bounds.
    const flexion = boundedAngle(Math.atan2(direction.z, -direction.y), -79.5 * rad, 84.5 * rad);
    const lateral = boundedAngle(Math.atan2(direction.x, Math.hypot(direction.y, direction.z)), -39.5 * rad, 39.5 * rad);
    const target = new Vector3(Math.sin(lateral), -Math.cos(flexion) * Math.cos(lateral), Math.sin(flexion) * Math.cos(lateral));
    const twist = boundedAngle(principal(2 * Math.atan2(q.y, q.w)), -14.5 * rad, 14.5 * rad);
    const fitted = new Quaternion().setFromUnitVectors(new Vector3(0, -1, 0), target)
      .multiply(new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), twist));
    result.joints[hand] = boundedSwingTwist(fitted.toArray() as Quat, 84.5 * rad, -14.5 * rad, 14.5 * rad);
  }
  if (seed) for (const side of ['Left', 'Right'] as const) {
    const upper = `${side}UpperArm` as JointName, lower = `${side}ForeArm` as JointName;
    const correction = new Quaternion(...seed.source.joints[upper]).invert().multiply(new Quaternion(...seed.fitted.joints[upper]));
    result.joints[upper] = new Quaternion(...input.joints[upper]).multiply(correction).normalize().toArray() as Quat;
    const measure = (pose: Pose) => {
      const q = new Quaternion(...pose.joints[lower]), direction = new Vector3(0, -1, 0).applyQuaternion(q);
      return { flexion: Math.atan2(direction.z, -direction.y), pronation: principal(2 * Math.atan2(q.y, q.w)) };
    };
    const source = measure(seed.source), fitted = measure(seed.fitted), current = measure(input);
    const flexion = current.flexion + fitted.flexion - source.flexion;
    const pronation = current.pronation + principal(fitted.pronation - source.pronation);
    result.joints[lower] = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), -flexion)
      .multiply(new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), pronation)).normalize().toArray() as Quat;
  }
  const chestRotation = new Quaternion(...chest.rotation), chestInverse = chestRotation.clone().invert(), chestPosition = new Vector3(...chest.position);
  const trunk = AVATAR_COLLISION_PROFILE.colliders.filter(collider => ['pelvis', 'abdomen', 'thorax', 'head', 'Left-thigh', 'Right-thigh'].includes(collider.id));
  const bodyBounds = trunk.map(collider => {
    if (collider.shape !== 'convex') return fail('人物动作适配需要已校准的身体几何。');
    const frame = world[collider.proximal], rotation = chestInverse.clone().multiply(new Quaternion(...frame.rotation));
    return bounds(collider.vertices, rotation, new Vector3(...frame.position).sub(chestPosition).applyQuaternion(chestInverse));
  });
  for (const side of ['Left', 'Right'] as const) for (let pass = 0; pass < 3; pass++) {
    const upper = `${side}UpperArm` as JointName, lower = `${side}ForeArm` as JointName, hand = `${side}Hand` as JointName;
    const handCollider = AVATAR_COLLISION_PROFILE.colliders.find(collider => collider.id === `${side}-hand`)!;
    const forearmCollider = AVATAR_COLLISION_PROFILE.colliders.find(collider => collider.id === `${side}-forearm`)!;
    if (handCollider.shape !== 'convex' || forearmCollider.shape !== 'convex') return fail('人物动作适配需要已校准的手臂几何。');
    const originalHand = new Vector3(...world[hand].position);
    // Local capture wrist articulation follows the fitted upper/lower arm.
    // Its resulting world palm orientation, rather than the donor's, controls
    // the target avatar's actual palm bounds. Bounded outer passes converge
    // that coupled geometry without inflating the body's collision profile.
    const fittedWorld = evaluatePose(result), handRotation = new Quaternion(...fittedWorld[hand].rotation);
    const handPosition = originalHand.clone().sub(chestPosition).applyQuaternion(chestInverse);
    const handBounds = bounds(handCollider.vertices, chestInverse.clone().multiply(handRotation), handPosition);
    const handCentre = handBounds.min.clone().add(handBounds.max).multiplyScalar(.5);
    const handHalf = handBounds.max.clone().sub(handBounds.min).multiplyScalar(.5);
    const band = forearmCollider.bboxHalfExtents[2] / 2;
    const elbowLocal = new Vector3(...world[lower].position).sub(chestPosition).applyQuaternion(chestInverse);
    const middleLocal = elbowLocal.clone().add(handPosition).multiplyScalar(.5);
    let lateralDisplacement = 0, forwardDisplacement = 0, elbowLateral = 0, elbowForward = 0, middleLateral = 0, middleForward = 0;
    const headCollider = trunk.find(collider => collider.id === 'head');
    if (headCollider?.shape === 'convex') {
      // A palm can round an AABB corner back into the head when its arm curve
      // is filtered. The measured head's bounding sphere and the actual palm's
      // reach form a conservative continuous trajectory target; final collision
      // tests still use the unchanged original convex bodies, not this sphere.
      const headFrame = world[headCollider.proximal], headRotation = new Quaternion(...headFrame.rotation);
      const centre = new Vector3(...headCollider.bboxCenterOffset).applyQuaternion(headRotation).add(new Vector3(...headFrame.position))
        .sub(chestPosition).applyQuaternion(chestInverse);
      const headRadius = Math.max(...headCollider.vertices.map(vertex => new Vector3(...vertex).distanceTo(new Vector3(...headCollider.bboxCenterOffset))));
      const palmRadius = Math.max(...handCollider.vertices.map(vertex => Math.hypot(...vertex)));
      const clearance = headRadius + palmRadius + .003 + band;
      const vertical = handPosition.y - centre.y, lateral = handPosition.x - centre.x;
      const heightWeight = bandWeight(handPosition.y, centre.y - clearance, centre.y + clearance, band);
      const sideWeight = bandWeight(handPosition.x, centre.x - clearance, centre.x + clearance, band);
      const requiredFront = Math.sqrt(Math.max(0, clearance ** 2 - vertical ** 2 - lateral ** 2));
      const move = positive(centre.z + requiredFront - handPosition.z, band) * heightWeight * sideWeight;
      forwardDisplacement = union(forwardDisplacement, move);
    }
    for (const body of bodyBounds) {
      const weight = bandWeight(handCentre.x, body.min.x - handHalf.x, body.max.x + handHalf.x, band)
        * bandWeight(handCentre.y, body.min.y - handHalf.y, body.max.y + handHalf.y, band)
        * bandWeight(handCentre.z, body.min.z - handHalf.z, body.max.z + handHalf.z, band);
      // The 3mm existing tolerance plus a geometry-derived smooth-onset band
      // keeps the target outside the body without changing collision limits.
      const neededZ = positive(body.max.z + .003 + band - handBounds.min.z, band);
      const neededX = positive((side === 'Left' ? body.max.x - handBounds.min.x : handBounds.max.x - body.min.x) + .003 + band, band);
      // Favor the closer lateral or front surface continuously. A resting
      // hand near the hips needs a small lateral clearance, not an exaggerated
      // reach forward. Equal-cost surfaces blend without an axis switch.
      const preference = 1 / (1 + Math.exp(Math.max(-40, Math.min(40, (neededX - neededZ) / band))));
      const rayX = Math.max(1e-6, preference), rayZ = Math.max(1e-6, 1 - preference), rayLength = Math.hypot(rayX, rayZ);
      const unitX = rayX / rayLength, unitZ = rayZ / rayLength;
      const tx = neededX / unitX, tz = neededZ / unitZ;
      // Smooth minimum from above: at least one geometric surface is cleared.
      const travel = (tx + tz - Math.sqrt((tx - tz) ** 2 + band ** 2) + band) / 2 * weight;
      lateralDisplacement = union(lateralDisplacement, unitX * travel);
      forwardDisplacement = union(forwardDisplacement, unitZ * travel);
      const forearmRadius = forearmCollider.bboxHalfExtents[0];
      const elbowWeight = bandWeight(elbowLocal.x, body.min.x - forearmRadius, body.max.x + forearmRadius, band)
        * bandWeight(elbowLocal.y, body.min.y - forearmRadius, body.max.y + forearmRadius, band)
        * bandWeight(elbowLocal.z, body.min.z - forearmRadius, body.max.z + forearmRadius, band);
      const ex = positive((side === 'Left' ? body.max.x - elbowLocal.x : elbowLocal.x - body.min.x) + forearmRadius + .003 + band, band);
      const ez = positive(body.max.z + forearmRadius + .003 + band - elbowLocal.z, band);
      const shoulderLocal = new Vector3(...world[upper].position).sub(chestPosition).applyQuaternion(chestInverse);
      const adduction = positive((side === 'Left' ? 1 : -1) * (shoulderLocal.x - elbowLocal.x), band);
      const ep = 1 / (1 + Math.exp(Math.max(-40, Math.min(40, (ex + adduction - ez) / band))));
      const el = Math.hypot(Math.max(1e-6, ep), Math.max(1e-6, 1 - ep)), ux = Math.max(1e-6, ep) / el, uz = Math.max(1e-6, 1 - ep) / el;
      const etx = ex / ux, etz = ez / uz;
      const distance = (etx + etz - Math.sqrt((etx - etz) ** 2 + band ** 2) + band) / 2 * elbowWeight;
      elbowLateral = union(elbowLateral, ux * distance); elbowForward = union(elbowForward, uz * distance);
      // The forearm cannot choose an outside elbow and wrist on different
      // sides of an obstacle while its connecting shaft cuts through it.
      // An explicit midpoint target fits the actual forearm radius too.
      const middleWeight = bandWeight(middleLocal.x, body.min.x - forearmRadius, body.max.x + forearmRadius, band)
        * bandWeight(middleLocal.y, body.min.y - forearmRadius, body.max.y + forearmRadius, band)
        * bandWeight(middleLocal.z, body.min.z - forearmRadius, body.max.z + forearmRadius, band);
      const mx = positive((side === 'Left' ? body.max.x - middleLocal.x : middleLocal.x - body.min.x) + forearmRadius + .003 + band, band);
      const mz = positive(body.max.z + forearmRadius + .003 + band - middleLocal.z, band);
      const preferenceMid = 1 / (1 + Math.exp(Math.max(-40, Math.min(40, (mx - mz) / band))));
      const normMid = Math.hypot(Math.max(1e-6, preferenceMid), Math.max(1e-6, 1 - preferenceMid));
      const midX = Math.max(1e-6, preferenceMid) / normMid, midZ = Math.max(1e-6, 1 - preferenceMid) / normMid;
      const a = mx / midX, b = mz / midZ;
      const move = (a + b - Math.sqrt((a - b) ** 2 + band ** 2) + band) / 2 * middleWeight;
      middleLateral = union(middleLateral, midX * move); middleForward = union(middleForward, midZ * move);
    }
    const worldHandBounds = bounds(handCollider.vertices, handRotation, originalHand);
    // Preserve potential floor-hand contacts instead of pulling a supporting
    // hand sideways. This is a hypothesis; support is verified by the gate.
    const floorWeight = smooth((worldHandBounds.min.y - .025) / handHalf.y);
    lateralDisplacement *= floorWeight; forwardDisplacement *= floorWeight;
    elbowLateral *= floorWeight; elbowForward *= floorWeight;
    middleLateral *= floorWeight; middleForward *= floorWeight;
    // The midpoint is kinematically tied to its endpoints. Increase the wrist
    // target continuously when the shaft clearance requires more translation
    // than independently clear endpoints would provide.
    lateralDisplacement += positive(2 * middleLateral - elbowLateral - lateralDisplacement, band);
    forwardDisplacement += positive(2 * middleForward - elbowForward - forwardDisplacement, band);
    const displacement = Math.hypot(lateralDisplacement, forwardDisplacement);
    if (!seed && pass === 0 && displacement < 1e-8 && Math.hypot(elbowLateral, elbowForward) < 1e-8) break;
    const target = originalHand.clone().add(new Vector3((side === 'Left' ? 1 : -1) * lateralDisplacement, 0, forwardDisplacement).applyQuaternion(chestRotation));
    const elbowTarget = new Vector3(...world[lower].position).add(new Vector3((side === 'Left' ? 1 : -1) * elbowLateral, 0, elbowForward).applyQuaternion(chestRotation));
    const middleTarget = new Vector3(...world[lower].position).add(originalHand).multiplyScalar(.5)
      .add(new Vector3((side === 'Left' ? 1 : -1) * middleLateral, 0, middleForward).applyQuaternion(chestRotation));
    const fitted = fitArm(result, input, side, target, elbowTarget, middleTarget, band);
    result.joints[upper] = fitted.joints[upper]; result.joints[lower] = fitted.joints[lower];
    if (metrics && pass === 2) {
      const fittedHand = evaluatePose(result)[hand].position, error = target.distanceTo(new Vector3(...fittedHand));
      metrics.maximum = Math.max(metrics.maximum, error); metrics.squared += error * error; metrics.count++;
    }
    // Keep the capture's wrist articulation throughout. Compensating an arm
    // fit with world-palm rotation created an unnecessary fast wrist curve;
    // a normal local wrist can follow the adapted arm naturally instead.
  }
  return result;
}

/** The loader must verify the complete asset SHA before calling this decoder. */
export function decodeMotionPrior(bytes: ArrayBuffer, expected: AIMotionPlanClip): MotionPriorClip {
  if (!(bytes instanceof ArrayBuffer) || bytes.byteLength < 20 || bytes.byteLength > MOTION_PRIOR_MAX_BYTES) return fail('真人动作参考大小超出限制。');
  const view = new DataView(bytes), decoder = new TextDecoder('utf-8', { fatal: true });
  if (decoder.decode(new Uint8Array(bytes, 0, 16)) !== MAGIC) return fail('未知的真人动作参考格式。');
  const headerLength = view.getUint32(16, true);
  if (headerLength < 2 || headerLength > 4096 || 20 + headerLength >= bytes.byteLength) return fail();
  let metadata: Record<string, unknown>;
  try { metadata = JSON.parse(decoder.decode(new Uint8Array(bytes, 20, headerLength))); } catch { return fail(); }
  const count = metadata.sampleCount;
  if (metadata.schema !== 'human-motion-prior-1' || metadata.id !== expected.id || metadata.skeletonId !== RIG_CALIBRATION_VERSION ||
    expected.skeletonId !== RIG_CALIBRATION_VERSION || metadata.durationSeconds !== expected.durationSeconds ||
    metadata.sampleRateHz !== 30 || !Number.isInteger(count) || typeof count !== 'number' || count < 2 || count > MOTION_PRIOR_MAX_SAMPLES ||
    bytes.byteLength !== 20 + headerLength + count * RECORD_BYTES || !/^[a-f0-9]{64}$/.test(expected.sourceHash)) return fail('真人动作参考与编舞目录不匹配。');
  const times: number[] = [], poses: Pose[] = [];
  let offset = 20 + headerLength, previous = -Infinity;
  const component = (maximum: number): number => {
    const value = view.getFloat32(offset, true); offset += 4;
    if (!Number.isFinite(value) || Math.abs(value) > maximum) return fail('真人动作参考含无效坐标或旋转。');
    return value;
  };
  for (let sample = 0; sample < count; sample++) {
    const time = view.getFloat64(offset, true); offset += 8;
    if (!Number.isFinite(time) || time <= previous || time < 0 || time > expected.durationSeconds) return fail('真人动作参考时间无效。');
    previous = time; times.push(time);
    const root: Vec3 = [component(100), component(100), component(100)], joints = {} as Record<JointName, Quat>;
    for (const joint of JOINT_NAMES) {
      const q: Quat = [component(1.001), component(1.001), component(1.001), component(1.001)], norm = Math.hypot(...q);
      if (Math.abs(norm - 1) > 1e-4) return fail('真人动作参考必须包含单位旋转。');
      // Float32 quantization is normalized once, never during ordinary playback.
      joints[joint] = q.map(value => value / norm) as Quat;
    }
    poses.push({ root, joints });
  }
  if (times[0] !== 0 || times.at(-1) !== expected.durationSeconds) return fail('真人动作参考需要完整的起止时间。');
  return { id: expected.id, sourceHash: expected.sourceHash, skeletonId: RIG_CALIBRATION_VERSION,
    durationSeconds: expected.durationSeconds, times, poses };
}

function blendPose(a: Pose, b: Pose, amount: number): Pose {
  if (amount === 0) return clonePose(a);
  if (amount === 1) return clonePose(b);
  return { root: a.root.map((value, axis) => value + (b.root[axis] - value) * amount) as Vec3,
    joints: Object.fromEntries(JOINT_NAMES.map(joint => [joint,
      new Quaternion(...a.joints[joint]).slerp(new Quaternion(...b.joints[joint]), amount).normalize().toArray() as Quat])) as Pose['joints'] };
}
/** Source quaternions follow their shortest arc; no angle data is invented. */
export function sampleMotionPrior(clip: MotionPriorClip, time: number): Pose {
  if (!Number.isFinite(time)) return fail('真人动作采样时间必须是有限数值。');
  if (time <= 0) return clonePose(clip.poses[0]);
  if (time >= clip.durationSeconds) return clonePose(clip.poses.at(-1)!);
  let low = 0, high = clip.times.length - 1;
  while (low < high) { const middle = Math.floor((low + high) / 2); if (clip.times[middle] < time) low = middle + 1; else high = middle; }
  if (clip.times[low] === time) return clonePose(clip.poses[low]);
  return blendPose(clip.poses[low - 1], clip.poses[low], (time - clip.times[low - 1]) / (clip.times[low] - clip.times[low - 1]));
}
const clamp01 = (amount: number) => Math.max(0, Math.min(1, amount));
const smooth = (amount: number) => { const u = clamp01(amount); return u * u * u * (10 + u * (-15 + 6 * u)); };
interface PreparedSegment {
  plan: AIMotionPlanSegment; clip: MotionPriorClip; origin: Vec3; anchor: [number, number]; ending: AIMotionBoundary;
  previous?: { time: number; source: Pose; fitted: Pose };
  fitMetrics?: ArmFitMetrics;
}
function sourcePose(segment: PreparedSegment, time: number, adapt = true): Pose {
  const { plan, clip } = segment, duration = plan.endSeconds - plan.startSeconds;
  const sourceTime = plan.sourceStartSeconds + (time - plan.startSeconds) * (plan.sourceEndSeconds - plan.sourceStartSeconds) / duration;
  // A transition may continue the outgoing derivative, but cannot silently
  // read motion beyond the model's selected source interval. Its frozen end
  // pose and incoming velocity supply the bounded continuation instead.
  const reference = sourceTime > plan.sourceEndSeconds ? extrapolate(segment.ending, sourceTime) : sampleMotionPrior(clip, sourceTime);
  const seed = adapt && segment.previous && sourceTime > segment.previous.time ? segment.previous : undefined;
  const stance = adapt && clip.id.startsWith('cmu-61-08') ? adaptMotionPriorStance(reference) : reference;
  const pose = adapt ? adaptMotionPriorArmTargets(stance, seed, segment.fitMetrics) : reference;
  if (adapt) segment.previous = { time: sourceTime, source: clonePose(reference), fitted: clonePose(pose) };
  const angle = plan.yawDegrees * Math.PI / 180;
  const cosine = Math.cos(angle), sine = Math.sin(angle), x = pose.root[0] - segment.origin[0], z = pose.root[2] - segment.origin[2];
  const travel = smooth((time - plan.startSeconds) / duration);
  pose.root = [segment.anchor[0] + cosine * x + sine * z + plan.travelXZ[0] * travel,
    pose.root[1], segment.anchor[1] - sine * x + cosine * z + plan.travelXZ[1] * travel];
  if (angle !== 0) pose.joints.Hips = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), angle)
    .multiply(new Quaternion(...pose.joints.Hips)).normalize().toArray() as Quat;
  return pose;
}
function extrapolate(boundary: AIMotionBoundary, time: number): Pose {
  const pose = clonePose(boundary.pose), dt = time - boundary.time;
  pose.root = pose.root.map((value, axis) => value + boundary.linearVelocity[axis] * dt) as Vec3;
  for (const joint of JOINT_NAMES) {
    const velocity = new Vector3(...boundary.angularVelocity[joint]), speed = velocity.length();
    if (speed > 1e-12) pose.joints[joint] = new Quaternion(...pose.joints[joint])
      .multiply(new Quaternion().setFromAxisAngle(velocity.multiplyScalar(1 / speed), speed * dt)).normalize().toArray() as Quat;
  }
  return pose;
}

/**
 * AI selects real source intervals. This deterministic compiler retimes, rotates,
 * aligns and blends them offline, without changing source data. The returned
 * trajectory still requires whole-curve anatomy/contact/collision acceptance.
 */
function* composeMotionPriorPlanSteps(request: AIMotionPlanRequest, inputResult: AIMotionPlanResult,
  clips: ReadonlyMap<string, MotionPriorClip>, baseSampler: AIMotionPoseSampler): Generator<void, MotionPriorComposition, void> {
  const result = validateAIMotionPlanResult(inputResult, request), { target, timing } = request.motion.context;
  if (result.intentMatch === 'unsupported' || !result.segments.length) return fail('当前真人动作参考无法满足描述，请修改动作要求。');
  const start = estimateAIMotionBoundary(baseSampler, target.startSeconds, 'before', timing.durationSeconds);
  const end = estimateAIMotionBoundary(baseSampler, target.endSeconds, 'after', timing.durationSeconds);
  const prepared: PreparedSegment[] = [];
  const fitMetrics: ArmFitMetrics = { maximum: 0, squared: 0, count: 0 };
  let anchor: [number, number] = [start.pose.root[0], start.pose.root[2]];
  for (const plan of result.segments) {
    const clip = clips.get(plan.clipId), expected = request.catalog.clips.find(entry => entry.id === plan.clipId)!;
    if (!clip || clip.sourceHash !== expected.sourceHash || clip.id !== expected.id || clip.skeletonId !== expected.skeletonId || clip.durationSeconds !== expected.durationSeconds ||
      clip.times.length !== clip.poses.length || clip.times.length < 2 || clip.times.length > MOTION_PRIOR_MAX_SAMPLES) return fail('真人动作参考已变化，请重新生成。');
    const segment: PreparedSegment = { plan, clip, origin: sampleMotionPrior(clip, plan.sourceStartSeconds).root, anchor,
      ending: estimateAIMotionBoundary(time => sampleMotionPrior(clip, time), plan.sourceEndSeconds, 'before', clip.durationSeconds), fitMetrics };
    prepared.push(segment);
    const final = sourcePose(segment, plan.endSeconds, false).root; anchor = [final[0], final[2]];
  }
  const span = target.endSeconds - target.startSeconds, seam = Math.min(1, span / 4);
  const composedPose = (time: number, adapt: boolean): Pose => {
    let index = prepared.findIndex(segment => time < segment.plan.endSeconds);
    if (index < 0) index = prepared.length - 1;
    const segment = prepared[index]; let pose = sourcePose(segment, time, adapt);
    if (index > 0 && segment.plan.transitionSeconds > 0 && time < segment.plan.startSeconds + segment.plan.transitionSeconds) {
      // Continue the outgoing source during the overlap; never freeze a moving
      // limb at the seam. The blend is entirely inside the incoming interval.
      pose = blendPose(sourcePose(prepared[index - 1], time, adapt), pose,
        smooth((time - segment.plan.startSeconds) / segment.plan.transitionSeconds));
    }
    return pose;
  };
  const poseAt = (time: number, adapt = true): Pose => {
    let motionTime = time;
    if (target.mode === 'full' && time > target.endSeconds - seam) {
      const u = clamp01((time - (target.endSeconds - seam)) / seam);
      // End position is unchanged, with first and second timing derivatives0.
      motionTime = target.endSeconds - seam + seam * (u + 4 * u ** 3 - 7 * u ** 4 + 3 * u ** 5);
    }
    let pose = composedPose(motionTime, adapt);
    if (time < target.startSeconds + seam) pose = blendPose(extrapolate(start, time), pose, smooth((time - target.startSeconds) / seam));
    if (target.mode === 'interval' && time > target.endSeconds - seam) pose = blendPose(pose, extrapolate(end, time), smooth((time - (target.endSeconds - seam)) / seam));
    return pose;
  };
  const samples: MotionPriorComposition['samples'] = [];
  const gridEpsilon = Number.EPSILON * 16 * Math.max(1, Math.abs(target.startSeconds), Math.abs(target.endSeconds));
  for (let frame = 1; frame < Math.ceil(span * 30); frame++) {
    const time = target.startSeconds + frame / 30;
    // Keep the exact frozen endpoint, never a numerically adjacent grid knot
    // whose tiny interval would manufacture unbounded derivative estimates.
    if (time < target.endSeconds - gridEpsilon) samples.push({ time, pose: poseAt(time) });
    if (frame % 16 === 0) yield;
  }
  if (target.mode === 'full') samples.push({ time: target.endSeconds, pose: poseAt(target.endSeconds) });
  // Extremely short valid selections still need one interior knot; the solver
  // decides whether their frozen endpoints can admit a feasible trajectory.
  if (!samples.length) { const time = target.startSeconds + span / 2; samples.push({ time, pose: poseAt(time) }); }
  const hasStanceCalibration = result.sources.some(source => source.clipId.startsWith('cmu-61-08'));
  yield* conditionLowerLegTrajectory(samples, start, end, hasStanceCalibration);
  // All source families need coherent thighs on the actual Hermite curve.
  // Donor-specific stance/shin calibration remains separate from this filter.
  yield* conditionJointTrajectory(samples, start, end, target.mode, true, 'body');
  // Re-evaluate actual filtered Head/Spine/thigh geometry. Before conditioning,
  // a donor-frame head target cannot anticipate the resulting palm/head fit.
  // This bounded pass is source seeded in the already coherent candidate.
  let previousFit: { source: Pose; fitted: Pose } | undefined;
  for (const [index, sample] of samples.entries()) {
    const source = clonePose(sample.pose), fitted = adaptMotionPriorArmTargets(source, previousFit, fitMetrics);
    const fade = Math.min(.5, span / 4), amount = smooth((sample.time - target.startSeconds) / fade)
      * (target.mode === 'interval' ? smooth((target.endSeconds - sample.time) / fade) : 1);
    sample.pose = blendPose(source, fitted, amount); previousFit = { source, fitted: clonePose(sample.pose) };
    if (index % 16 === 15) yield;
  }
  yield* conditionJointTrajectory(samples, start, end, target.mode, false, 'arms');
  let endingAdaptation: MotionPriorComposition['endingAdaptation'];
  if (target.mode === 'full') {
    const seconds = Math.min(1.5, span / 4), final = samples.at(-1)!.pose;
    const forward = new Vector3(0, 0, 1).applyQuaternion(new Quaternion(...final.joints.Hips)), yaw = Math.atan2(forward.x, forward.z);
    const neutral = clonePose(final);
    neutral.root[1] = 1.055;
    for (const joint of JOINT_NAMES) neutral.joints[joint] = [0, 0, 0, 1];
    neutral.joints.Hips = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), yaw).toArray() as Quat;
    neutral.joints.LeftUpperArm = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), 15 * Math.PI / 180).toArray() as Quat;
    neutral.joints.RightUpperArm = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), -15 * Math.PI / 180).toArray() as Quat;
    for (const sample of samples) if (sample.time > target.endSeconds - seconds) {
      const anchor = clonePose(neutral); anchor.root[0] = sample.pose.root[0]; anchor.root[2] = sample.pose.root[2];
      sample.pose = blendPose(sample.pose, anchor, smooth((sample.time - (target.endSeconds - seconds)) / seconds));
    }
    endingAdaptation = { kind: 'stable-hold', seconds };
  }
  let maximum = 0, squared = 0, maximumFoot = 0, squaredFoot = 0, maximumKnee = 0, maximumSole = 0;
  for (const [index, sample] of samples.entries()) {
    const fitted = evaluatePose(sample.pose), original = evaluatePose(poseAt(sample.time, false));
    for (const hand of ['LeftHand', 'RightHand'] as const) {
      const distance = new Vector3(...fitted[hand].position).distanceTo(new Vector3(...original[hand].position));
      maximum = Math.max(maximum, distance); squared += distance * distance;
    }
    for (const side of ['Left', 'Right'] as const) {
      const foot = `${side}Foot` as const, knee = `${side}LowerLeg` as const;
      const distance = new Vector3(...fitted[foot].position).distanceTo(new Vector3(...original[foot].position));
      maximumFoot = Math.max(maximumFoot, distance); squaredFoot += distance * distance;
      maximumKnee = Math.max(maximumKnee, new Vector3(...fitted[knee].position).distanceTo(new Vector3(...original[knee].position)));
      maximumSole = Math.max(maximumSole, new Quaternion(...fitted[foot].rotation).angleTo(new Quaternion(...original[foot].rotation)));
    }
    if (index % 32 === 31) yield;
  }
  return { samples, ...(endingAdaptation ? { endingAdaptation } : {}), origin: { kind: 'human-motion-prior', catalogVersion: result.catalogVersion,
    ...(endingAdaptation ? { endingAdaptation: { ...endingAdaptation } } : {}),
    sources: result.sources.map(source => ({ ...source })), segments: result.segments.map(segment => ({ ...segment, travelXZ: [...segment.travelXZ] })),
    adaptations: [MOTION_PRIOR_ARM_ADAPTATION_VERSION, MOTION_PRIOR_ARM_TRAJECTORY_VERSION, MOTION_PRIOR_NECK_TRAJECTORY_VERSION, MOTION_PRIOR_HEAD_TRAJECTORY_VERSION, MOTION_PRIOR_SPINE_TRAJECTORY_VERSION, MOTION_PRIOR_UPPER_LEG_TRAJECTORY_VERSION, MOTION_PRIOR_KNEE_TRAJECTORY_VERSION,
      ...(hasStanceCalibration ? [MOTION_PRIOR_STANCE_ADAPTATION_VERSION, MOTION_PRIOR_SHIN_TRAJECTORY_VERSION] : []),
      ...(endingAdaptation ? [MOTION_PRIOR_HOLD_ADAPTATION_VERSION] : [])],
    adaptationMetrics: { maxHandDisplacementMeters: maximum, rmsHandDisplacementMeters: Math.sqrt(squared / (samples.length * 2)),
      maxFootDisplacementMeters: maximumFoot, rmsFootDisplacementMeters: Math.sqrt(squaredFoot / (samples.length * 2)), maxKneeDisplacementMeters: maximumKnee,
      maxSoleOrientationChangeRadians: maximumSole } },
    adaptation: { version: MOTION_PRIOR_ARM_ADAPTATION_VERSION, bodyProfileId: AVATAR_COLLISION_PROFILE.id, samples: samples.length,
      maxHandDisplacementMeters: maximum, rmsHandDisplacementMeters: Math.sqrt(squared / (samples.length * 2)),
      maxIKTargetErrorMeters: fitMetrics.maximum, rmsIKTargetErrorMeters: Math.sqrt(fitMetrics.squared / Math.max(1, fitMetrics.count)),
      maxFootDisplacementMeters: maximumFoot, rmsFootDisplacementMeters: Math.sqrt(squaredFoot / (samples.length * 2)), maxKneeDisplacementMeters: maximumKnee,
      maxSoleOrientationChangeRadians: maximumSole } };
}

/** Synchronous core entry point for deterministic tests and offline tools. */
export function composeMotionPriorPlan(request: AIMotionPlanRequest, result: AIMotionPlanResult,
  clips: ReadonlyMap<string, MotionPriorClip>, baseSampler: AIMotionPoseSampler): MotionPriorComposition {
  const steps = composeMotionPriorPlanSteps(request, result, clips, baseSampler);
  let step = steps.next(); while (!step.done) step = steps.next(); return step.value;
}

/** Browser generation yields between bounded batches so cancellation and the
 * operation deadline remain effective during retargeting and fidelity checks. */
export async function composeMotionPriorPlanAsync(request: AIMotionPlanRequest, result: AIMotionPlanResult,
  clips: ReadonlyMap<string, MotionPriorClip>, baseSampler: AIMotionPoseSampler,
  options: { signal?: AbortSignal } = {}): Promise<MotionPriorComposition> {
  const check = () => { if (options.signal?.aborted) throw new DOMException('生成已取消。', 'AbortError'); };
  const steps = composeMotionPriorPlanSteps(request, result, clips, baseSampler);
  try {
    while (true) {
      check(); const step = steps.next(); check(); if (step.done) return step.value;
      await new Promise<void>(resolve => setTimeout(resolve, 0));
    }
  } finally { steps.return(undefined as never); }
}
