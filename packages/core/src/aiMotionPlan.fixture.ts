/** Test-only planning fixtures; never import into an application or Worker. */
import { AI_MOTION_MODEL } from './aiMotion';
import { makeAIMotionFixture } from './aiMotion.fixture';
import { AI_MOTION_PLAN_PROTOCOL, makeAIMotionPlanRequest, motionPlanSources,
  type AIMotionPlanRequest, type AIMotionPlanOutput, type AIMotionPlanResult } from './aiMotionPlan';

export function makeAIMotionPlanFixture(mode: 'full' | 'interval' = 'full'): AIMotionPlanRequest {
  return makeAIMotionPlanRequest(makeAIMotionFixture(mode), { version: 'cmu-neutral-rig-2-1', clips: [
    { id: 'cmu-85-12', sourceHash: 'ec65ea32c1dd47276b151c69488f3034832aa06970a46d83981a00eaacbe39ac',
      label: '街舞', tags: ['转身', '地板动作'], durationSeconds: 37.5, skeletonId: 'neutral-rig-2' },
    { id: 'cmu-61-08', sourceHash: 'cb68bd9c600719fb2e43b9e1d8da4add6db0ea821681669f4b78385ebc5f5588',
      label: '萨尔萨', tags: ['站立舞步', '手势'], durationSeconds: 56.25, skeletonId: 'neutral-rig-2' },
  ] });
}
export function makeAIMotionPlanOutputFixture(request = makeAIMotionPlanFixture()): AIMotionPlanOutput {
  const { target } = request.motion.context;
  return { summary: '从真人动捕舞步组合新的动作安排。', intentMatch: 'supported', limitations: [], segments: [
    { clipId: 'cmu-61-08', startSeconds: target.startSeconds, endSeconds: target.endSeconds,
      sourceStartSeconds: 0, sourceEndSeconds: target.endSeconds - target.startSeconds,
      yawDegrees: 0, travelXZ: [0, 0], transitionSeconds: 0.3, contactHint: 'unknown' },
  ] };
}
export function makeAIMotionPlanResultFixture(request = makeAIMotionPlanFixture(), output = makeAIMotionPlanOutputFixture(request)): AIMotionPlanResult {
  const { requestId, sourceHash, target } = request.motion.context;
  return { ...output, protocol: AI_MOTION_PLAN_PROTOCOL, provider: 'cloudflare-workers-ai', model: AI_MOTION_MODEL,
    requestId, sourceHash, target: { ...target }, catalogVersion: request.catalog.version,
    sources: motionPlanSources(output, request.catalog) };
}
