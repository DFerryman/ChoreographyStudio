import { writeFile } from 'node:fs/promises';
import { buildAIMotionRequest } from '../../../apps/web/src/aiMotionContext';
import { checkAIMotionSourceBoundaries } from '../../../apps/web/src/motionSourcePreflight';
import { CANONICAL_MOTION_FEASIBILITY_PROFILE, getMotionMinimumFloorHeight, isFunctionalJointWithinLimits,
  measureFunctionalJoint } from '../../../packages/core/src/motionFeasibility';
import { getCapsuleCollisions } from '../../../packages/core/src/capsuleCollision';
import { JOINT_NAMES } from '../../../packages/core/src/motion-types';
import { AI_MOTION_MODEL } from '../../../packages/core/src/aiMotion';
import { DIRECTORY, TARGET, json, ownedSnapshot, prohibitNetwork, save, sha } from './common';

const network = prohibitNetwork();
const snapshot = ownedSnapshot();
const sourceText = json(snapshot);
await writeFile(`${DIRECTORY}/owned-source-snapshot.json`, sourceText, { flag: 'wx' });
const common = '请直接创造一段新的3D骨骼动作素材，目标是绝对场景时间4至9.5秒（5.5秒）。' +
  '使用12–24个严格位于区间内部、递增的关键姿态，以实际Root位置和局部Euler旋转表达动作阶段；两端和外部由程序锁定。' +
  '不要引用动作ID、现成catalog、录制片段、Street/Salsa模板，也不要用静止数据配舞蹈summary。' +
  '按本次舞种创造准备、主动作、收势和全身协调，遵守只读骨架、固定肢长及边界；不能声称程序已验证可行或听到了音乐。';
const experiments = [
  { id: 'chinese-classical', prompt: common +
    '创作中国古典舞短句：云手的环绕双臂、躯干拧倾与呼吸感、轻巧侧步，动作彼此连贯；保持中国古典舞意图，不用其他舞种代替。' },
  { id: 'hip-hop', prompt: common +
    '创作hip-hop短句：groove身体律动、locking清晰顿停与手臂节奏、原地footwork；在准备、律动、锁定与收势间协调躯干和脚步，不引用现有动捕。' },
  { id: 'ballet', prompt: common +
    '创作ballet短句：port de bras手臂流线、plié屈膝与relevé提踵的协调，轻盈清晰并回到原边界。使用当前普通脚掌骨架，禁止足尖pointe站立、改骨长或伪造脚部新自由度。' },
];
const summary: Record<string, unknown> = { scope: 'owned-source preparation only; no model or network calls',
  model: AI_MOTION_MODEL, endpoint: '/api/motion/generate', protocol: 'ai-motion-1', usesCatalog: false,
  sourceFileSHA256: sha(sourceText), sourceTakeSHA256: sha(JSON.stringify(snapshot.take)),
  target: TARGET, audioFileRead: false, userSceneRead: false, requests: [] };
try {
  for (const experiment of experiments) {
    const request = await buildAIMotionRequest({ prompt: experiment.prompt,
      sceneId: 'owned-text-motion-experiment-32-20261014', baseRevision: 1, snapshot,
      range: TARGET, audioBlob: null, audioName: '无音乐文件', audioDurationSeconds: 0, audioClips: [] });
    await checkAIMotionSourceBoundaries(request);
    const profile = CANONICAL_MOTION_FEASIBILITY_PROFILE;
    const boundaries = Object.entries(request.context.boundaries).map(([side, boundary]) => ({
      side, time: boundary.time,
      jointViolations: JOINT_NAMES.filter(joint => !isFunctionalJointWithinLimits(joint, boundary.pose.joints[joint], profile)),
      jointMeasurements: Object.fromEntries(JOINT_NAMES.map(joint => [joint, measureFunctionalJoint(joint, boundary.pose.joints[joint], profile)])),
      collisions: getCapsuleCollisions(boundary.pose, profile.bodyProfile),
      minimumFloorHeightMeters: getMotionMinimumFloorHeight(boundary.pose, profile.bodyProfile),
      support: boundary.support, supportConfidence: boundary.supportConfidence,
    }));
    const body = json(request);
    const filename = `${experiment.id}.request.json`;
    await writeFile(`${DIRECTORY}/${filename}`, body, { flag: 'wx' });
    (summary.requests as unknown[]).push({ id: experiment.id, filename, requestSHA256: sha(body),
      bytes: Buffer.byteLength(body), requestId: request.context.requestId, sourceHash: request.context.sourceHash,
      boundaryPreflight: 'passed', boundaries, audio: request.context.audio });
  }
  summary.status = 'prepared';
} catch (error) {
  summary.status = 'failed'; summary.error = error instanceof Error ? error.message : String(error);
  process.exitCode = 1;
} finally {
  summary.networkAttempts = network.attempts;
  summary.sourceFileUnchanged = sha(json(snapshot)) === summary.sourceFileSHA256;
  await save('preparation-receipt.json', summary);
  console.log(JSON.stringify({ status: summary.status, model: summary.model, target: TARGET,
    sourceFileSHA256: summary.sourceFileSHA256, sourceTakeSHA256: summary.sourceTakeSHA256,
    requests: (summary.requests as { id: string; filename: string; requestSHA256: string; sourceHash: string; bytes: number }[])
      .map(({ id, filename, requestSHA256, sourceHash, bytes }) => ({ id, filename, requestSHA256, sourceHash, bytes })),
    networkAttempts: network.attempts, error: summary.error }));
}
