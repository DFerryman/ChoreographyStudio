import type { JointName, Vec3 } from './motion-types';

export interface HumanSegment {
  readonly id: string;
  readonly proximal: JointName;
  readonly distal: JointName;
  readonly proximalOffset: readonly [number, number, number];
  readonly distalOffset: readonly [number, number, number];
  readonly massFraction: number;
  /** Fraction from the proximal point to the distal point. */
  readonly centerFraction: number;
  readonly radiusMeters: number;
  readonly family: 'trunk' | 'head' | 'arm' | 'leg' | 'foot';
}

const segment = (id: string, proximal: JointName, distal: JointName, massFraction: number, centerFraction: number, radiusMeters: number, family: HumanSegment['family'], proximalOffset: Vec3 = [0, 0, 0], distalOffset: Vec3 = [0, 0, 0]): HumanSegment => Object.freeze({
  id, proximal, distal, massFraction, centerFraction, radiusMeters, family,
  proximalOffset: Object.freeze(proximalOffset), distalOffset: Object.freeze(distalOffset),
});

/**
 * An editor default, not a measurement of a particular person. De Leva's
 * segment-mass/CM/inertia methodology informs the distribution; these rounded,
 * symmetric fractions and geometry are calibrated to our original 25-joint rig.
 * https://pubmed.ncbi.nlm.nih.gov/8872282/ (1996, DOI 10.1016/0021-9290(95)00178-6).
 * Inertia is evaluated from the proxy cylinders/foot boxes and the parallel-axis
 * theorem, rather than presenting these approximations as clinical tables.
 */
const segments: HumanSegment[] = [
  segment('pelvis', 'Hips', 'Spine', .14, .50, .10, 'trunk', [0, -.09, 0], [0, -.02, 0]),
  segment('abdomen', 'Spine', 'Chest', .12, .50, .11, 'trunk'),
  segment('thorax', 'Chest', 'Neck', .17, .50, .13, 'trunk'),
  segment('head-neck', 'Head', 'Head', .07, .62, .065, 'head', [0, -.01, 0], [0, .13, 0]),
];
for (const side of ['Left', 'Right'] as const) {
  segments.push(
    segment(`${side}-upper-arm`, `${side}UpperArm`, `${side}ForeArm`, .027, .44, .038, 'arm'),
    segment(`${side}-forearm`, `${side}ForeArm`, `${side}Hand`, .017, .43, .030, 'arm'),
    segment(`${side}-hand`, `${side}Hand`, `${side}HandTip`, .006, .50, .032, 'arm'),
    segment(`${side}-thigh`, `${side}UpperLeg`, `${side}LowerLeg`, .14, .43, .067, 'leg'),
    segment(`${side}-shank`, `${side}LowerLeg`, `${side}Foot`, .045, .44, .047, 'leg'),
    segment(`${side}-foot`, `${side}Foot`, `${side}Foot`, .015, .50, .039, 'foot', [0, -.043, -.075], [0, -.043, .165]),
  );
}

/** No user-entered mass, friction, inertia or motor configuration is needed. */
export const STANDARD_HUMAN_PROFILE = Object.freeze({
  id: 'neutral-adult-v2' as const,
  version: 2 as const,
  label: '标准中性成人',
  heightMeters: 1.85,
  massKg: 70,
  gravityMps2: 9.81,
  segments: Object.freeze(segments),
  foot: Object.freeze({
    center: Object.freeze([0, -.043, .045]) as readonly [number, number, number],
    halfExtents: Object.freeze([.048, .039, .12]) as readonly [number, number, number],
    halfWidthMeters: .048,
    soleOffsetMeters: .082,
    heelZ: -.075,
    toeZ: .165,
  }),
  ground: Object.freeze({ friction: .75, restitution: .02, contactToleranceMeters: .025, penetrationToleranceMeters: .003 }),
  drive: Object.freeze({
    positionGainPerSecondSquared: 45,
    velocityGainPerSecond: 12,
    maxHorizontalForceNewtons: 700,
    maxUprightTorqueNewtonMeters: 110,
    angularPositionGainPerSecondSquared: 65,
    angularVelocityGainPerSecond: 16,
    maxTakeoffSpeedMps: 6,
  }),
  simulation: Object.freeze({ fixedStepSeconds: 1 / 120, outputFps: 30, maxDurationSeconds: 60, maxSamples: 6001, maxSteps: 7201 }),
});
