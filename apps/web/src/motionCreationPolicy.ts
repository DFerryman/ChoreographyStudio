/** Operation intent and actual product capability are separate. Existing
 * recordings may be arranged explicitly; they cannot satisfy creation. */
export type MotionCreationMode = 'create' | 'arrange-existing';
export const DEFAULT_MOTION_CREATION_MODE: MotionCreationMode = 'create';

export const MOTION_CREATION_UNAVAILABLE_MESSAGE =
  '当前尚未接入创造新动作素材的模型。现有街舞和 Salsa 真人动捕仅能用于编排，不能代替创作。原动作未改变。';

const supportedStyles = Object.freeze(['street', 'salsa'] as const);
/** This describes the existing integration, not a proposed motion model. */
export const CURRENT_MOTION_CREATION_CAPABILITY = Object.freeze({
  provider: 'existing-priors' as const,
  sourceKind: 'human-motion-capture' as const,
  supportedStyles,
  description: '现有来源为街舞和 Salsa 真人动捕。编排会选取和组合已有素材，不是创造新动作素材。',
});

/** Canonical style IDs must be provided explicitly by the caller. Unknown
 * styles remain unresolved; no prompt keyword or model claim grants coverage. */
export type MotionStyleRequirement =
  | { kind: 'unspecified' }
  | { kind: 'required'; styles: readonly string[] }
  | { kind: 'unresolved' };

export type MotionCreationPolicyDecision = {
  mode: MotionCreationMode;
  provider: typeof CURRENT_MOTION_CREATION_CAPABILITY.provider;
  sourceKind: typeof CURRENT_MOTION_CREATION_CAPABILITY.sourceKind;
  supportedStyles: typeof supportedStyles;
} & (
  | { allowed: true; code: 'EXISTING_ARRANGEMENT_ONLY'; message: string }
  | { allowed: false; code: 'CREATION_UNAVAILABLE' | 'STYLE_UNRESOLVED' | 'STYLE_NOT_COVERED'; message: string }
);

export function evaluateMotionCreationPolicy(input: {
  mode?: MotionCreationMode;
  styleRequirement?: MotionStyleRequirement;
} = {}): MotionCreationPolicyDecision {
  // Invalid modes also fail as creation; only this exact explicit operation
  // can authorize material selection. Never fall back after a creation denial.
  const mode = input.mode === 'arrange-existing' ? input.mode : DEFAULT_MOTION_CREATION_MODE;
  const capability = { mode, provider: CURRENT_MOTION_CREATION_CAPABILITY.provider,
    sourceKind: CURRENT_MOTION_CREATION_CAPABILITY.sourceKind, supportedStyles };
  if (mode === 'create') return { ...capability, allowed: false, code: 'CREATION_UNAVAILABLE',
    message: MOTION_CREATION_UNAVAILABLE_MESSAGE };
  const requirement = input.styleRequirement ?? { kind: 'unspecified' };
  if (requirement.kind === 'unresolved' || requirement.kind !== 'unspecified' &&
    (requirement.kind !== 'required' || !Array.isArray(requirement.styles) || !requirement.styles.length)) {
    return { ...capability, allowed: false, code: 'STYLE_UNRESOLVED',
      message: '尚不能确定所需舞种是否有对应素材，不能用现有片段替代。原动作未改变。' };
  }
  if (requirement.kind === 'required' && requirement.styles.some(style =>
    !supportedStyles.some(supported => supported === style))) {
    return { ...capability, allowed: false, code: 'STYLE_NOT_COVERED',
      message: '现有真人动捕仅覆盖街舞和 Salsa，不能用它们替代所需舞种。原动作未改变。' };
  }
  return { ...capability, allowed: true, code: 'EXISTING_ARRANGEMENT_ONLY',
    message: CURRENT_MOTION_CREATION_CAPABILITY.description };
}
