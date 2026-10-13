/** Only these local planning categories may leave the server. Error messages,
 * provider output and user context never supply public error copy. */
export type AIMotionPlanReasonCode = 'PLAN_FORMAT_INVALID' | 'PLAN_SOURCE_RANGE' | 'PLAN_COVERAGE' |
  'PLAN_SPEED' | 'PLAN_TRANSITION' | 'PLAN_INTENT_CONTRACT';

export const AI_MOTION_PLAN_REASON_MESSAGES: Readonly<Record<AIMotionPlanReasonCode, string>> = Object.freeze({
  PLAN_FORMAT_INVALID: 'AI 返回了无法使用的动作规划，原动作未改变，请稍后手动重试。',
  PLAN_SOURCE_RANGE: 'AI 选择的动作片段超出可用范围，原动作未改变，请调整描述或选区。',
  PLAN_COVERAGE: 'AI 的动作安排没有完整覆盖所选时段，原动作未改变，请调整描述或选区。',
  PLAN_SPEED: 'AI 安排的动作速度不适合当前时段，原动作未改变，请调整描述或选区。',
  PLAN_TRANSITION: 'AI 安排的动作衔接时间不合适，原动作未改变，请调整描述或选区。',
  PLAN_INTENT_CONTRACT: 'AI 未清楚说明这段描述能实现哪些动作，原动作未改变，请调整描述。',
});

export class AIMotionPlanValidationError extends Error {
  readonly reasonCode: AIMotionPlanReasonCode;

  constructor(reasonCode: AIMotionPlanReasonCode, message = 'AI 动作规划数据无效。') {
    super(message);
    this.name = 'AIMotionPlanValidationError';
    this.reasonCode = reasonCode;
  }
}

/** A similarly named foreign error or arbitrary reason text cannot be exposed.
 * Read a data descriptor so a hostile accessor cannot execute in this path. */
export function getSafeAIMotionPlanReason(error: unknown): AIMotionPlanReasonCode {
  if (error instanceof AIMotionPlanValidationError) {
    const property = Object.getOwnPropertyDescriptor(error, 'reasonCode');
    const reason = property && Object.hasOwn(property, 'value') ? property.value : undefined;
    if (typeof reason === 'string' && Object.hasOwn(AI_MOTION_PLAN_REASON_MESSAGES, reason)) return reason as AIMotionPlanReasonCode;
  }
  return 'PLAN_FORMAT_INVALID';
}
