import { Bone, BufferGeometry, Matrix4, MeshBasicMaterial, Quaternion, Skeleton, SkinnedMesh, Vector3 } from 'three';
import { CCDIKSolver, type IK } from 'three/addons/animation/CCDIKSolver.js';
import { constrainJointRotation, getJointRotationLimits } from './jointConstraints';
import { clonePose, evaluatePose, RIG_DEFINITIONS } from './humanoid';
import { JOINT_NAMES, type JointName, type Pose, type Quat, type Vec3 } from './motion-types';

export const IK_EFFECTORS = ['LeftHand', 'RightHand', 'LeftFoot', 'RightFoot'] as const;
export type IKEffector = typeof IK_EFFECTORS[number];
export type IKOptions = { pole?: Vec3; preserveEndRotation?: Quat };
export type IKResult = { pose: Pose; residual: number; reached: boolean; changedJoints: JointName[] };
const tolerance = 0.005;
const radians = Math.PI / 180;
type Adapter = { mesh: SkinnedMesh; bones: Map<JointName, Bone>; target: Bone; solver: CCDIKSolver; upper: JointName; lower: JointName };
const adapters = new Map<IKEffector, Adapter>();

function validVector(value: Vec3): boolean { return Array.isArray(value) && value.length === 3 && value.every(Number.isFinite); }
function sameRotation(a: Quat, b: Quat): boolean { return Math.abs(a.reduce((sum, value, axis) => sum + value * b[axis], 0)) > 1 - 1e-10; }

/** Installed MIT Three.js CCDIKSolver, adapted to our original unskinned rig. */
function adapter(effector: IKEffector): Adapter {
  const cached = adapters.get(effector);
  if (cached) return cached;
  const mesh = new SkinnedMesh(new BufferGeometry(), new MeshBasicMaterial());
  const bones = new Map<JointName, Bone>();
  for (const { name, parent, offset } of RIG_DEFINITIONS) {
    const bone = new Bone(); bone.name = name; bone.position.set(...offset);
    (parent ? bones.get(parent)! : mesh).add(bone); bones.set(name, bone);
  }
  const target = new Bone(); mesh.add(target);
  mesh.skeleton = new Skeleton([...RIG_DEFINITIONS.map(({ name }) => bones.get(name)!), target]);
  const side = effector.startsWith('Left') ? 'Left' : 'Right';
  const leg = effector.endsWith('Foot');
  const upper = `${side}${leg ? 'UpperLeg' : 'UpperArm'}` as JointName;
  const lower = `${side}${leg ? 'LowerLeg' : 'ForeArm'}` as JointName;
  const links = [lower, upper].map(name => {
    const limits = getJointRotationLimits(name);
    return { index: RIG_DEFINITIONS.findIndex(item => item.name === name),
      rotationMin: new Vector3(...limits.map(range => range[0] * radians) as Vec3),
      rotationMax: new Vector3(...limits.map(range => range[1] * radians) as Vec3),
      ...(name === lower ? { limitation: new Vector3(1, 0, 0) } : {}),
    };
  });
  const ik: IK = { target: RIG_DEFINITIONS.length, effector: RIG_DEFINITIONS.findIndex(item => item.name === effector), links, iteration: 1, maxAngle: 0.25 };
  const result = { mesh, bones, target, upper, lower, solver: new CCDIKSolver(mesh, [ik]) };
  adapters.set(effector, result);
  return result;
}

/**
 * Pole-aware geometric initialization avoids CCD's straight-chain singularity.
 * The actual iterative solver is Three.js CCD, with our compound constraints
 * projected after each iteration. No bone offsets or non-chain joints change.
 */
function seedChain(pose: Pose, rig: Adapter, effector: IKEffector, target: Vec3, pole?: Vec3): void {
  const world = evaluatePose(pose);
  const parent = RIG_DEFINITIONS.find(item => item.name === rig.upper)!.parent!;
  const parentRotation = new Quaternion(...world[parent].rotation);
  const origin = new Vector3(...world[rig.upper].position);
  const direction = new Vector3(...target).sub(origin);
  const a = RIG_DEFINITIONS.find(item => item.name === rig.lower)!.offset[1] * -1;
  const b = RIG_DEFINITIONS.find(item => item.name === effector)!.offset[1] * -1;
  const distance = Math.max(Math.abs(a - b) + 1e-6, Math.min(a + b - 1e-6, direction.length()));
  if (direction.lengthSq() < 1e-12) direction.set(0, -1, 0).applyQuaternion(parentRotation);
  direction.normalize();
  const leg = effector.endsWith('Foot');
  const bend = pole ? new Vector3(...pole).sub(origin) : new Vector3(0, 0, leg ? 1 : -1).applyQuaternion(parentRotation);
  bend.addScaledVector(direction, -bend.dot(direction));
  if (bend.lengthSq() < 1e-10) {
    bend.set(1, 0, 0).applyQuaternion(parentRotation).addScaledVector(direction, -new Vector3(1, 0, 0).applyQuaternion(parentRotation).dot(direction));
  }
  bend.normalize();
  const cosine = Math.max(-1, Math.min(1, (a * a + distance * distance - b * b) / (2 * a * distance)));
  const first = direction.clone().multiplyScalar(cosine).addScaledVector(bend, Math.sqrt(Math.max(0, 1 - cosine * cosine)));
  const second = direction.clone().multiplyScalar(distance).addScaledVector(first, -a).normalize();
  const x = new Vector3().crossVectors(first, second).normalize().multiplyScalar(leg ? 1 : -1);
  const y = first.clone().negate();
  const z = new Vector3().crossVectors(x, y).normalize();
  const rotation = new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(x, y, z)).premultiply(parentRotation.clone().invert()).normalize();
  rig.bones.get(rig.upper)!.quaternion.fromArray(constrainJointRotation(rig.upper, rotation.toArray() as Quat));
  const bendAngle = Math.acos(Math.max(-1, Math.min(1, first.dot(second)))) * (leg ? 1 : -1);
  const lowerRotation = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), bendAngle);
  rig.bones.get(rig.lower)!.quaternion.fromArray(constrainJointRotation(rig.lower, lowerRotation.toArray() as Quat));
}

export function solveLimbIK(pose: Pose, effector: IKEffector, target: Vec3, options: IKOptions = {}): IKResult {
  if (!IK_EFFECTORS.includes(effector) || !validVector(target) || (options.pole && !validVector(options.pole))) throw new Error('IK 末端、目标或弯曲方向无效。');
  if (options.preserveEndRotation && (!Array.isArray(options.preserveEndRotation) || options.preserveEndRotation.length !== 4 || options.preserveEndRotation.some(value => !Number.isFinite(value)) || Math.hypot(...options.preserveEndRotation) < 1e-12)) throw new Error('IK 末端方向必须是有效四元数。');
  const originalWorld = evaluatePose(pose), result = clonePose(pose), rig = adapter(effector);
  rig.mesh.position.set(...pose.root);
  for (const name of JOINT_NAMES) rig.bones.get(name)!.quaternion.set(...pose.joints[name]).normalize();
  rig.target.position.set(...target).sub(rig.mesh.position);
  if (new Vector3(...originalWorld[effector].position).distanceTo(new Vector3(...target)) > 1e-7 || options.pole) seedChain(pose, rig, effector, target, options.pole);
  for (const name of [rig.upper, rig.lower]) rig.bones.get(name)!.quaternion.fromArray(constrainJointRotation(name, rig.bones.get(name)!.quaternion.toArray() as Quat));
  rig.mesh.updateMatrixWorld(true);
  let best = Number.POSITIVE_INFINITY;
  let bestRotations: Quat[] = [rig.upper, rig.lower].map(name => rig.bones.get(name)!.quaternion.toArray() as Quat);
  for (let iteration = 0; iteration < 24; iteration++) {
    const distance = rig.bones.get(effector)!.getWorldPosition(new Vector3()).distanceTo(new Vector3(...target));
    if (distance < best) { best = distance; bestRotations = [rig.upper, rig.lower].map(name => rig.bones.get(name)!.quaternion.toArray() as Quat); }
    if (distance < 0.0002) break;
    rig.solver.update();
    for (const name of [rig.upper, rig.lower]) rig.bones.get(name)!.quaternion.fromArray(constrainJointRotation(name, rig.bones.get(name)!.quaternion.toArray() as Quat));
    rig.mesh.updateMatrixWorld(true);
  }
  [rig.upper, rig.lower].forEach((name, index) => { result.joints[name] = bestRotations[index]; });
  if (options.preserveEndRotation) {
    const world = evaluatePose(result);
    const parentInverse = new Quaternion(...world[rig.lower].rotation).invert();
    result.joints[effector] = constrainJointRotation(effector, new Quaternion(...options.preserveEndRotation).normalize().premultiply(parentInverse).toArray() as Quat);
  }
  const residual = new Vector3(...evaluatePose(result)[effector].position).distanceTo(new Vector3(...target));
  return { pose: result, residual, reached: residual <= tolerance,
    changedJoints: [rig.upper, rig.lower, effector].filter(name => !sameRotation(pose.joints[name], result.joints[name])),
  };
}
