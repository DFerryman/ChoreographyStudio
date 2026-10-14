import { describe, expect, it } from 'vitest';
import { CURRENT_MOTION_CREATION_CAPABILITY, DEFAULT_MOTION_CREATION_MODE,
  MOTION_CREATION_UNAVAILABLE_MESSAGE, evaluateMotionCreationPolicy,
  type MotionCreationMode, type MotionStyleRequirement } from './motionCreationPolicy';

describe('motion creation capability and explicit existing-material arrangement', () => {
  it('defaults to creation and rejects before any existing-material fallback', () => {
    expect(DEFAULT_MOTION_CREATION_MODE).toBe('create');
    expect(evaluateMotionCreationPolicy()).toMatchObject({ mode: 'create', allowed: false,
      code: 'CREATION_UNAVAILABLE', provider: 'existing-priors', message: MOTION_CREATION_UNAVAILABLE_MESSAGE });
    expect(MOTION_CREATION_UNAVAILABLE_MESSAGE).toContain('尚未接入创造新动作素材的模型');
    expect(MOTION_CREATION_UNAVAILABLE_MESSAGE).toContain('不能代替创作');
  });

  it.each<MotionStyleRequirement>([
    { kind: 'unspecified' }, { kind: 'required', styles: ['street'] },
    { kind: 'required', styles: ['chinese-classical'] }, { kind: 'unresolved' },
  ])('cannot turn creation into material selection for style requirement %j', styleRequirement => {
    expect(evaluateMotionCreationPolicy({ mode: 'create', styleRequirement })).toMatchObject({
      allowed: false, mode: 'create', code: 'CREATION_UNAVAILABLE', message: MOTION_CREATION_UNAVAILABLE_MESSAGE,
    });
  });

  it('allows only explicit arrangement and discloses the actual source kind and style coverage', () => {
    expect(evaluateMotionCreationPolicy({ mode: 'arrange-existing' })).toEqual({ allowed: true,
      mode: 'arrange-existing', code: 'EXISTING_ARRANGEMENT_ONLY', provider: 'existing-priors',
      sourceKind: 'human-motion-capture', supportedStyles: ['street', 'salsa'],
      message: CURRENT_MOTION_CREATION_CAPABILITY.description });
    expect(CURRENT_MOTION_CREATION_CAPABILITY.description).toContain('选取和组合已有素材');
    expect(CURRENT_MOTION_CREATION_CAPABILITY.description).toContain('不是创造新动作素材');
  });

  it.each([{ styles: ['street'] }, { styles: ['salsa'] }, { styles: ['street', 'salsa'] }])(
    'allows the declared supported styles %j in arrangement', ({ styles }) => {
      const requirement: MotionStyleRequirement = { kind: 'required', styles };
      const original = structuredClone(requirement);
      expect(evaluateMotionCreationPolicy({ mode: 'arrange-existing', styleRequirement: requirement }).allowed).toBe(true);
      expect(requirement).toEqual(original);
    });

  it.each([{ styles: ['chinese-classical'] }, { styles: ['中国舞'] }, { styles: ['unfamiliar-dance'] },
    { styles: ['Street'] }, { styles: ['street', 'chinese-classical'] }])(
    'does not classify the undeclared styles %j as supported or substitute the covered portion', ({ styles }) => {
      expect(evaluateMotionCreationPolicy({ mode: 'arrange-existing', styleRequirement: { kind: 'required', styles } }))
        .toMatchObject({ allowed: false, code: 'STYLE_NOT_COVERED', mode: 'arrange-existing' });
    });

  it.each<MotionStyleRequirement>([{ kind: 'unresolved' }, { kind: 'required', styles: [] }])(
    'does not silently treat unresolved or empty declared requirements %j as unspecified', styleRequirement => {
      expect(evaluateMotionCreationPolicy({ mode: 'arrange-existing', styleRequirement }))
        .toMatchObject({ allowed: false, code: 'STYLE_UNRESOLVED' });
    });

  it('does not let an unrecognized runtime mode authorize arrangement', () => {
    expect(evaluateMotionCreationPolicy({ mode: 'generate' as MotionCreationMode }))
      .toMatchObject({ allowed: false, mode: 'create', code: 'CREATION_UNAVAILABLE' });
  });

  it('keeps the published capability and its style list immutable', () => {
    const decision = evaluateMotionCreationPolicy({ mode: 'arrange-existing' });
    expect(Object.isFrozen(CURRENT_MOTION_CREATION_CAPABILITY)).toBe(true);
    expect(Object.isFrozen(decision.supportedStyles)).toBe(true);
  });
});
