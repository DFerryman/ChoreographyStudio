import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { EDITABLE_JOINT_NAMES, JOINT_NAMES, ROOT_TRANSLATION_LIMITS, sampleTake, type BakedTake, type JointName, type Pose, type Quat, type Vec3 } from '../../../packages/core/src';
import { fitPerspectiveBounds } from './cameraFraming';
import './Stage.css';

export type StageView = 'front' | 'back' | 'left' | 'right' | 'top' | 'free';
export type StageCamera = { position: Vec3; target: Vec3; zoom?: number };
export type StageCameraFocus = { key: number; kind: 'actor' | 'joint'; joint?: JointName };
export type StageTransformTool = 'select' | 'rotate' | 'translate';
export const STAGE_JOINT_LABELS: Record<JointName, string> = {
  Hips: '骨盆', Spine: '腰椎', Chest: '胸椎', Neck: '颈部', Head: '头部',
  LeftShoulder: '左锁骨', LeftUpperArm: '左肩', LeftForeArm: '左肘', LeftHand: '左腕', LeftHandTip: '左指尖',
  RightShoulder: '右锁骨', RightUpperArm: '右肩', RightForeArm: '右肘', RightHand: '右腕', RightHandTip: '右指尖',
  LeftUpperLeg: '左髋', LeftLowerLeg: '左膝', LeftFoot: '左踝', LeftToe: '左脚尖', LeftHeel: '左脚跟',
  RightUpperLeg: '右髋', RightLowerLeg: '右膝', RightFoot: '右踝', RightToe: '右脚尖', RightHeel: '右脚跟',
};
const EDITABLE_JOINT_SET = new Set<JointName>(EDITABLE_JOINT_NAMES);

type StageProps = {
  take: BakedTake | null;
  time: number;
  view: StageView;
  mirror: boolean;
  cameraResetKey?: number;
  cameraState?: StageCamera;
  cameraRestoreKey?: number;
  cameraFocus?: StageCameraFocus;
  selectedJoint?: JointName | null;
  gridVisible?: boolean;
  axesVisible?: boolean;
  poseOverride?: Pose | null;
  editMode?: boolean;
  playing?: boolean;
  transformTool?: StageTransformTool;
  onSelectJoint?: (joint: JointName | null) => void;
  onCameraChange?: (camera: StageCamera) => void;
  onCameraInteraction?: () => void;
  onJointPositionChange?: (position: Vec3 | null) => void;
  onJointRotationChange?: (joint: JointName, rotation: Quat, phase: 'start' | 'change' | 'end') => void;
  onRootPositionChange?: (position: Vec3, phase: 'start' | 'change' | 'end') => void;
};

type PreviewRig = {
  root: THREE.Group;
  joints: Map<JointName, THREE.Group>;
  markers: Map<JointName, THREE.Mesh<THREE.SphereGeometry, THREE.MeshStandardMaterial>>;
  targets: THREE.Mesh[];
  framingMeshes: THREE.Mesh[];
};

type GizmoAxis = { name: 'X' | 'Y' | 'Z'; color: string; x: number; y: number; depth: number };

/** Original preview skeleton: the 25 logical joints retain the preview-1 rest transforms. */
function createPreviewRig(): PreviewRig {
  const root = new THREE.Group();
  const joints = new Map<JointName, THREE.Group>();
  const markers = new Map<JointName, THREE.Mesh<THREE.SphereGeometry, THREE.MeshStandardMaterial>>();
  const targets: THREE.Mesh[] = [];
  const framingMeshes: THREE.Mesh[] = [];
  const sphereGeometry = new THREE.SphereGeometry(1, 16, 12);
  const boneGeometry = new THREE.CylinderGeometry(1, 1, 1, 8);
  const boneMaterial = new THREE.MeshStandardMaterial({ color: '#aeb8d1', roughness: 0.86 });
  const targetMaterial = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false });

  function joint(name: JointName, parent: JointName | null, x = 0, y = 0, z = 0) {
    const group = new THREE.Group();
    group.name = name;
    group.position.set(x, y, z);
    const parentGroup = parent ? joints.get(parent)! : root;
    parentGroup.add(group);
    joints.set(name, group);

    if (parent) {
      const offset = new THREE.Vector3(x, y, z);
      const length = offset.length();
      const bone = new THREE.Mesh(boneGeometry, boneMaterial);
      bone.position.copy(offset).multiplyScalar(0.5);
      bone.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), offset.normalize());
      bone.scale.set(0.014, length, 0.014);
      bone.castShadow = true;
      parentGroup.add(bone);
      framingMeshes.push(bone);
    }

    const material = new THREE.MeshStandardMaterial({
      color: name.startsWith('Left') ? '#aabbff' : '#e8edf7',
      roughness: 0.7,
      emissive: '#293a73',
      emissiveIntensity: 0.13,
    });
    const marker = new THREE.Mesh(sphereGeometry, material);
    marker.scale.setScalar(name === 'Hips' ? 0.05 : name.includes('Tip') || name.endsWith('Toe') || name.endsWith('Heel') ? 0.027 : 0.037);
    marker.castShadow = true;
    group.add(marker);
    markers.set(name, marker);
    framingMeshes.push(marker);
    // Generous invisible targets improve selection without changing visible joint size.
    const target = new THREE.Mesh(sphereGeometry, targetMaterial);
    target.scale.setScalar(name === 'Hips' ? 0.088 : 0.07);
    target.userData.jointName = name;
    group.add(target);
    targets.push(target);
    return group;
  }

  joint('Hips', null);
  joint('Spine', 'Hips', 0, 0.14, 0);
  joint('Chest', 'Spine', 0, 0.2, 0);
  joint('Neck', 'Chest', 0, 0.19, 0);
  const head = joint('Head', 'Neck', 0, 0.08, 0);
  const headOutline = new THREE.Mesh(
    new THREE.SphereGeometry(0.105, 12, 8),
    new THREE.MeshBasicMaterial({ color: '#a9b7d7', wireframe: true, transparent: true, opacity: 0.48 }),
  );
  headOutline.position.y = 0.08;
  headOutline.scale.y = 1.22;
  head.add(headOutline);
  framingMeshes.push(headOutline);
  const direction = new THREE.Mesh(
    new THREE.ConeGeometry(0.022, 0.055, 8),
    new THREE.MeshBasicMaterial({ color: '#7c93ff' }),
  );
  direction.position.set(0, 0.08, 0.142);
  direction.rotation.x = Math.PI / 2;
  head.add(direction);
  framingMeshes.push(direction);

  for (const side of ['Left', 'Right'] as const) {
    const sign = side === 'Left' ? 1 : -1;
    joint(`${side}Shoulder`, 'Chest', sign * 0.205, 0.095, 0);
    joint(`${side}UpperArm`, `${side}Shoulder`, sign * 0.082, -0.03, 0);
    joint(`${side}ForeArm`, `${side}UpperArm`, 0, -0.285, 0);
    joint(`${side}Hand`, `${side}ForeArm`, 0, -0.255, 0);
    joint(`${side}HandTip`, `${side}Hand`, 0, -0.115, 0);
    joint(`${side}UpperLeg`, 'Hips', sign * 0.112, -0.05, 0);
    joint(`${side}LowerLeg`, `${side}UpperLeg`, 0, -0.46, 0);
    joint(`${side}Foot`, `${side}LowerLeg`, 0, -0.45, 0);
    joint(`${side}Toe`, `${side}Foot`, 0, -0.035, 0.15);
    joint(`${side}Heel`, `${side}Foot`, 0, -0.035, -0.065);
  }
  root.position.set(0, 1.05, 0);
  return { root, joints, markers, targets, framingMeshes };
}

function applyPose(rig: PreviewRig, pose: Pose | null, draggingJoint: JointName | null = null, draggingRoot = false) {
  if (!draggingRoot) rig.root.position.set(...(pose?.root ?? [0, 1.05, 0]));
  for (const name of JOINT_NAMES) {
    if (name === draggingJoint) continue;
    const joint = rig.joints.get(name)!;
    const q = pose?.joints[name];
    if (q) joint.quaternion.set(q[0], q[1], q[2], q[3]);
    else joint.quaternion.identity();
  }
}

function createWorldAxes() {
  const group = new THREE.Group();
  const directions = [
    { vector: new THREE.Vector3(1, 0, 0), color: '#f2727c' },
    { vector: new THREE.Vector3(0, 1, 0), color: '#68c69d' },
    { vector: new THREE.Vector3(0, 0, 1), color: '#739bfa' },
  ];
  for (const { vector, color } of directions) {
    const material = new THREE.MeshBasicMaterial({ color });
    const axis = new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.005, 0.94, 6), material);
    axis.position.copy(vector).multiplyScalar(0.47);
    axis.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), vector);
    group.add(axis);
    const tip = new THREE.Mesh(new THREE.ConeGeometry(0.022, 0.06, 8), material);
    tip.position.copy(vector).multiplyScalar(0.97);
    tip.quaternion.copy(axis.quaternion);
    group.add(tip);
  }
  const origin = new THREE.Mesh(new THREE.SphereGeometry(0.019, 12, 8), new THREE.MeshBasicMaterial({ color: '#dbe2f2' }));
  group.add(origin);
  return group;
}

function StageFallback({ error }: { error: string }) {
  return (
    <div className="stage3d-fallback" role="status">
      <svg viewBox="0 0 180 240" aria-hidden="true">
        <g stroke="#aeb8d1" strokeWidth="3" fill="none" strokeLinecap="round">
          <circle cx="90" cy="34" r="17" strokeWidth="1.5" />
          <path d="M90 51 L90 120 M90 72 L58 79 L43 112 L35 139 M90 72 L122 79 L137 112 L145 139 M90 120 L75 130 L70 170 L65 211 M90 120 L105 130 L110 170 L115 211" />
        </g>
        <g fill="#aabbff">{[[90, 55], [90, 72], [90, 93], [90, 120], [58, 79], [43, 112], [35, 139], [122, 79], [137, 112], [145, 139], [75, 130], [70, 170], [65, 211], [105, 130], [110, 170], [115, 211]].map(([cx, cy], i) => <circle key={i} cx={cx} cy={cy} r="4" />)}</g>
      </svg>
      <p>3D 预览暂时不可用</p>
      <span>{error}</span>
    </div>
  );
}

export function Stage(props: StageProps) {
  const { take, time, view, mirror, cameraResetKey, cameraRestoreKey, cameraFocus, selectedJoint, gridVisible, axesVisible, poseOverride, editMode, playing, transformTool = 'rotate' } = props;
  const containerRef = useRef<HTMLDivElement>(null);
  const current = useRef(props);
  const requestDraw = useRef<() => void>(() => {});
  const [error, setError] = useState<string | null>(null);
  const [internalSelection, setInternalSelection] = useState<JointName | null>(null);
  const [hover, setHover] = useState<{ joint: JointName; x: number; y: number } | null>(null);
  const [gizmo, setGizmo] = useState<GizmoAxis[]>([]);
  const [transformAxis, setTransformAxis] = useState<string | null>(null);
  current.current = props;
  const selection = selectedJoint === undefined ? internalSelection : selectedJoint;
  const selectionRef = useRef(selection);
  selectionRef.current = selection;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
    } catch {
      setError('请使用支持 WebGL 的浏览器；仍可查看和编辑八拍组合。');
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1;
    const canvas = renderer.domElement;
    canvas.className = 'stage3d-canvas';
    canvas.setAttribute('role', 'img');
    canvas.setAttribute('aria-label', '原创人偶的编舞动作预览');
    canvas.tabIndex = 0;
    container.appendChild(canvas);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#171b24');
    scene.fog = new THREE.Fog('#171b24', 9, 27);
    const camera = new THREE.PerspectiveCamera(40, 1, 0.05, 80);
    const controls = new OrbitControls(camera, canvas);
    controls.enableDamping = false;
    controls.minDistance = 1.3;
    controls.maxDistance = 18;
    controls.minPolarAngle = 0.015;
    controls.maxPolarAngle = Math.PI - 0.015;
    controls.screenSpacePanning = true;
    controls.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
    controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };
    let cameraKeyboardEnabled = !current.current.editMode;
    if (cameraKeyboardEnabled) controls.listenToKeyEvents(canvas);
    const transform = new TransformControls(camera, canvas);
    transform.setMode('rotate');
    transform.setSpace('local');
    transform.setSize(0.95);
    transform.showE = false;
    transform.showXYZE = false;
    transform.showXY = false;
    transform.showYZ = false;
    transform.showXZ = false;
    Object.assign(transform, {
      minX: ROOT_TRANSLATION_LIMITS.x[0], maxX: ROOT_TRANSLATION_LIMITS.x[1],
      minY: ROOT_TRANSLATION_LIMITS.y[0], maxY: ROOT_TRANSLATION_LIMITS.y[1],
      minZ: ROOT_TRANSLATION_LIMITS.z[0], maxZ: ROOT_TRANSLATION_LIMITS.z[1],
    });
    transform.enabled = false;
    const transformHelper = transform.getHelper();
    scene.add(new THREE.HemisphereLight('#dce5ff', '#111722', 1.5));
    const keyLight = new THREE.DirectionalLight('#f5f5ff', 3);
    keyLight.position.set(-3, 6, 4);
    keyLight.castShadow = true;
    keyLight.shadow.mapSize.set(1024, 1024);
    keyLight.shadow.camera.left = -3;
    keyLight.shadow.camera.right = 3;
    keyLight.shadow.camera.top = 4;
    keyLight.shadow.camera.bottom = -2;
    keyLight.shadow.normalBias = 0.025;
    keyLight.shadow.bias = -0.0003;
    scene.add(keyLight);
    const rim = new THREE.DirectionalLight('#a4b1ff', 2.2);
    rim.position.set(3, 3, -4);
    scene.add(rim);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(100, 100), new THREE.MeshStandardMaterial({ color: '#181e2a', roughness: 1 }));
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -0.004;
    floor.receiveShadow = true;
    scene.add(floor);
    const grid = new THREE.Group();
    for (const [divisions, opacity] of [[40, 0.14], [10, 0.32]]) {
      const lines = new THREE.GridHelper(10, divisions, '#697690', '#697690');
      const materials = Array.isArray(lines.material) ? lines.material : [lines.material];
      for (const material of materials) { material.transparent = true; material.opacity = opacity; }
      grid.add(lines);
    }
    scene.add(grid);
    const axes = createWorldAxes();
    scene.add(axes);
    const mirrorGroup = new THREE.Group();
    const rig = createPreviewRig();
    mirrorGroup.add(rig.root);
    scene.add(mirrorGroup);
    scene.add(transformHelper);
    const localAxes = new THREE.AxesHelper(0.14);
    localAxes.visible = false;
    scene.add(localAxes);

    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    let frame = 0;
    let stopped = false;
    let width = 0;
    let height = 0;
    let initialized = false;
    let applyingCamera = false;
    let manuallyMoved = false;
    let previousView: StageView | undefined;
    let previousReset: number | undefined;
    let previousRestore: number | undefined;
    let previousFocusKey = current.current.cameraFocus?.key;
    let previousTake: BakedTake | null | undefined;
    let previousTime = Number.NaN;
    let previousOverride: Pose | null | undefined;
    let draggingJoint: JointName | null = null;
    let draggingRoot = false;
    let poseNeedsApply = false;
    let hovered: JointName | null = null;
    let cameraSignature = '';
    let jointSignature = '';
    let pointerStart: { id: number; x: number; y: number; dragged: boolean; button: number; gizmo: boolean } | null = null;
    const activePointers = new Set<number>();
    const blockedTransformPointers = new Set<number>();
    let cameraGesture = false;

    function schedule() {
      if (!stopped && !frame) frame = window.requestAnimationFrame(draw);
    }
    requestDraw.current = schedule;

    function fitDistance() {
      const halfHeight = Math.max(1.31, 1.31 / Math.max(camera.aspect, 0.2));
      return halfHeight / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) + 0.3;
    }

    function preset(nextView: StageView) {
      const offsets: Record<Exclude<StageView, 'free'>, Vec3> = {
        front: [0, 0.22, 1], back: [0, 0.22, -1], left: [1, 0.22, 0], right: [-1, 0.22, 0], top: [0, 1, 0.015],
      };
      applyingCamera = true;
      camera.zoom = 1;
      camera.updateProjectionMatrix();
      controls.target.set(0, 0.95, 0);
      camera.position.copy(controls.target).add(new THREE.Vector3(...offsets[nextView === 'free' ? 'front' : nextView]).normalize().multiplyScalar(fitDistance()));
      controls.update();
      applyingCamera = false;
      manuallyMoved = false;
    }

    function restore(state: StageCamera | undefined) {
      if (!state || ![...state.position, ...state.target].every(value => Number.isFinite(value) && Math.abs(value) <= 1000)) return false;
      const offset = new THREE.Vector3(...state.position).sub(new THREE.Vector3(...state.target));
      if (offset.lengthSq() < 0.0001) return false;
      offset.setLength(THREE.MathUtils.clamp(offset.length(), controls.minDistance, controls.maxDistance));
      applyingCamera = true;
      controls.target.set(...state.target);
      camera.position.copy(controls.target).add(offset);
      camera.zoom = Number.isFinite(state.zoom) ? THREE.MathUtils.clamp(state.zoom!, 0.5, 4) : 1;
      camera.updateProjectionMatrix();
      controls.update();
      applyingCamera = false;
      manuallyMoved = true;
      return true;
    }

    function cameraFeedback() {
      const values = [...camera.position.toArray(), ...controls.target.toArray(), camera.zoom];
      const signature = values.map(value => value.toFixed(5)).join(',');
      if (signature === cameraSignature) return;
      cameraSignature = signature;
      current.current.onCameraChange?.({ position: camera.position.toArray() as Vec3, target: controls.target.toArray() as Vec3, zoom: camera.zoom });
      const inverse = camera.quaternion.clone().invert();
      setGizmo([
        { name: 'X', color: '#f2727c', vector: new THREE.Vector3(1, 0, 0) },
        { name: 'Y', color: '#68c69d', vector: new THREE.Vector3(0, 1, 0) },
        { name: 'Z', color: '#739bfa', vector: new THREE.Vector3(0, 0, 1) },
      ].map(({ name, color, vector }) => {
        vector.applyQuaternion(inverse);
        return { name: name as GizmoAxis['name'], color, x: 34 + vector.x * 23, y: 34 - vector.y * 23, depth: vector.z };
      }).sort((a, b) => a.depth - b.depth));
    }

    function selectionFeedback() {
      const selected = selectionRef.current;
      let position: Vec3 | null = null;
      if (selected) {
        const world = rig.joints.get(selected)!.getWorldPosition(new THREE.Vector3());
        // The mirror group is a viewing transform; data-world coordinates remain unchanged.
        if (current.current.mirror) world.x *= -1;
        position = world.toArray() as Vec3;
      }
      const signature = `${selected ?? ''}:${position?.map(value => value.toFixed(5)).join(',') ?? ''}`;
      if (signature !== jointSignature) {
        jointSignature = signature;
        current.current.onJointPositionChange?.(position);
      }
    }

    function activeTool() {
      return current.current.transformTool ?? 'rotate';
    }

    function canEdit() {
      const state = current.current;
      return !!state.editMode && !state.playing && !state.mirror && !cameraGesture && blockedTransformPointers.size === 0;
    }

    function canRotate() {
      const selected = selectionRef.current;
      return canEdit() && activeTool() === 'rotate' && !!selected && EDITABLE_JOINT_SET.has(selected);
    }

    function canTranslate() {
      return canEdit() && activeTool() === 'translate';
    }

    function syncOrbit() {
      controls.enabled = blockedTransformPointers.size === 0 && (!transform.enabled || (!transform.dragging && transform.axis === null));
    }

    function transformFeedback(phase: 'start' | 'change' | 'end') {
      if (draggingRoot && canTranslate()) {
        const position = rig.root.position;
        if (![position.x, position.y, position.z].every(Number.isFinite)) {
          const state = current.current;
          position.set(...((state.poseOverride ?? (state.take ? sampleTake(state.take, state.time) : null))?.root ?? [0, 1.05, 0]));
          return;
        }
        // Native limits constrain the object itself; keep emitted draft data in
        // the same bounds even if another control changes the object mid-drag.
        position.x = THREE.MathUtils.clamp(position.x, ...ROOT_TRANSLATION_LIMITS.x);
        position.y = THREE.MathUtils.clamp(position.y, ...ROOT_TRANSLATION_LIMITS.y);
        position.z = THREE.MathUtils.clamp(position.z, ...ROOT_TRANSLATION_LIMITS.z);
        current.current.onRootPositionChange?.(position.toArray() as Vec3, phase);
      } else if (draggingJoint && canRotate()) {
        const quaternion = rig.joints.get(draggingJoint)!.quaternion;
        if (!quaternion.toArray().every(Number.isFinite) || quaternion.lengthSq() <= Number.EPSILON) return;
        const rotation = quaternion.clone().normalize().toArray() as Quat;
        current.current.onJointRotationChange?.(draggingJoint, rotation, phase);
      }
    }

    function cancelTransform() {
      const canceledPointerId = pointerStart?.id;
      // Capture can be released while the pointer is still held; its eventual
      // pointerup may land outside this canvas. Clear our gesture state now.
      pointerStart = null;
      activePointers.clear();
      cameraGesture = false;
      draggingJoint = null;
      draggingRoot = false;
      poseNeedsApply = true;
      transform.dragging = false;
      transform.detach();
      // TransformControls otherwise retains its gesture pointermove hook when
      // editing is disabled before pointerup. Reconnect its public lifecycle.
      transform.disconnect();
      transform.connect(canvas);
      if (canceledPointerId !== undefined && canvas.hasPointerCapture(canceledPointerId)) canvas.releasePointerCapture(canceledPointerId);
      hovered = null;
      setHover(null);
      setTransformAxis(null);
      canvas.classList.remove('is-transform-hover', 'is-joint-hover', 'is-dragging');
      syncOrbit();
    }

    function desiredTransformObject() {
      if (canTranslate()) return rig.root;
      if (canRotate()) return rig.joints.get(selectionRef.current!)!;
      return undefined;
    }

    function cancelForCameraFocus() {
      const heldPointers = new Set(activePointers);
      if (pointerStart) heldPointers.add(pointerStart.id);
      // The last objectChange already produced the current draft. Ending a
      // camera action must not emit another pose change or commit it.
      cancelTransform();
      controls.disconnect();
      controls.connect(canvas);
      controls.listenToKeyEvents(canvas);
      for (const id of heldPointers) {
        blockedTransformPointers.add(id);
        if (canvas.hasPointerCapture(id)) canvas.releasePointerCapture(id);
      }
      // Retain an existing second-touch isolation group until every touch ends.
      syncOrbit();
    }

    function focusCamera(request: StageCameraFocus) {
      const bounds = new THREE.Box3();
      if (request.kind === 'joint') {
        const joint = request.joint ? rig.joints.get(request.joint) : undefined;
        if (!joint) return;
        const center = joint.getWorldPosition(new THREE.Vector3());
        bounds.setFromCenterAndSize(center, new THREE.Vector3(0.6, 0.6, 0.6));
      } else {
        // Explicit actor meshes exclude the ground, world axes, invisible pick
        // targets, TransformControls and local axes attached under the rig.
        for (const mesh of rig.framingMeshes) {
          if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
          if (mesh.geometry.boundingBox) bounds.union(mesh.geometry.boundingBox.clone().applyMatrix4(mesh.matrixWorld));
        }
      }
      const fit = fitPerspectiveBounds({
        bounds, position: camera.position, target: controls.target, up: camera.up,
        aspect: camera.aspect, fov: camera.fov, near: camera.near,
        minDistance: request.kind === 'joint' ? 1.5 : controls.minDistance,
        maxDistance: controls.maxDistance, padding: request.kind === 'joint' ? 1.05 : 1.18,
      });
      if (!fit) return;
      applyingCamera = true;
      camera.zoom = 1;
      camera.updateProjectionMatrix();
      controls.target.copy(fit.target);
      camera.position.copy(fit.position);
      controls.update();
      applyingCamera = false;
      manuallyMoved = true;
      current.current.onCameraInteraction?.();
      // Even a repeated framing at the same position publishes concrete state.
      cameraSignature = '';
    }

    function draw() {
      const state = current.current;
      if (cameraKeyboardEnabled === !!state.editMode) {
        cameraKeyboardEnabled = !state.editMode;
        if (cameraKeyboardEnabled) controls.listenToKeyEvents(canvas);
        else controls.stopListenToKeyEvents();
      }
      frame = 0;
      if (stopped || width <= 0 || height <= 0) return;
      const restoreChanged = state.cameraRestoreKey !== previousRestore;
      const wasInitialized = initialized;
      const focusChanged = state.cameraFocus?.key !== previousFocusKey;
      previousFocusKey = state.cameraFocus?.key;
      const focusRequest = wasInitialized && !restoreChanged && state.take && focusChanged ? state.cameraFocus : undefined;
      const cameraViewChanged = state.view !== previousView || state.cameraResetKey !== previousReset;
      // A scene switch can clear the consumer's state even when its camera and
      // selected joint match the previous scene. Publish fresh scene feedback.
      if (!initialized || restoreChanged) {
        cameraSignature = '';
        jointSignature = '';
      }
      if (!initialized) {
        if (!restore(state.cameraState)) preset(state.view);
      } else if (restoreChanged) {
        if (!restore(state.cameraState)) preset(state.view);
      } else if ((state.view !== previousView && state.view !== 'free') || state.cameraResetKey !== previousReset) {
        preset(state.view);
      }
      initialized = true;
      previousView = state.view;
      previousReset = state.cameraResetKey;
      previousRestore = state.cameraRestoreKey;
      const attachedObject = desiredTransformObject();
      const editable = !!attachedObject;
      const cancelDrag = transform.dragging && (
        transform.object !== attachedObject || restoreChanged || cameraViewChanged ||
        state.take !== previousTake || state.time !== previousTime ||
        (state.poseOverride == null && previousOverride != null)
      );
      if (focusRequest) cancelForCameraFocus();
      else if (cancelDrag) cancelTransform();
      const tool = activeTool();
      const mode = tool === 'translate' ? 'translate' : 'rotate';
      const space = tool === 'translate' ? 'world' : 'local';
      if (transform.mode !== mode) transform.setMode(mode);
      if (transform.space !== space) transform.setSpace(space);
      transform.enabled = editable;
      if (attachedObject) {
        if (transform.object !== attachedObject) transform.attach(attachedObject);
        if (localAxes.parent !== attachedObject) attachedObject.add(localAxes);
      } else if (transform.object) transform.detach();
      localAxes.visible = editable;
      syncOrbit();
      mirrorGroup.scale.x = state.mirror ? -1 : 1;
      grid.visible = state.gridVisible !== false;
      axes.visible = state.axesVisible !== false;
      const override = state.playing ? null : state.poseOverride;
      if (state.take !== previousTake || state.time !== previousTime || override !== previousOverride || poseNeedsApply) {
        applyPose(rig, override ?? (state.take ? sampleTake(state.take, state.time) : null), transform.dragging ? draggingJoint : null, transform.dragging && draggingRoot);
        previousTake = state.take;
        previousTime = state.time;
        previousOverride = override;
        poseNeedsApply = false;
      }
      for (const [name, marker] of rig.markers) {
        const selected = name === selectionRef.current;
        const over = name === hovered;
        marker.material.color.set(selected ? '#7292ff' : over ? '#f0f4ff' : name.startsWith('Left') ? '#aabbff' : '#e8edf7');
        marker.material.emissiveIntensity = selected ? 0.85 : over ? 0.5 : 0.13;
        const radius = name === 'Hips' ? 0.05 : name.includes('Tip') || name.endsWith('Toe') || name.endsWith('Heel') ? 0.027 : 0.037;
        marker.scale.setScalar(radius * (selected ? 1.38 : over ? 1.18 : 1));
      }
      scene.updateMatrixWorld(true);
      if (focusRequest) focusCamera(focusRequest);
      renderer.render(scene, camera);
      cameraFeedback();
      selectionFeedback();
    }

    function resize() {
      const oldAspect = camera.aspect;
      width = container!.clientWidth;
      height = container!.clientHeight;
      if (width <= 0 || height <= 0) return;
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      if (initialized && !manuallyMoved && Math.abs(oldAspect - camera.aspect) > 0.001) preset(current.current.view);
      schedule();
    }

    function pick(event: PointerEvent): JointName | null {
      const bounds = canvas.getBoundingClientRect();
      pointer.set(((event.clientX - bounds.left) / bounds.width) * 2 - 1, -((event.clientY - bounds.top) / bounds.height) * 2 + 1);
      scene.updateMatrixWorld(true);
      camera.updateMatrixWorld(true);
      raycaster.setFromCamera(pointer, camera);
      const hits = raycaster.intersectObjects(rig.targets, false);
      let best: { name: JointName; distance: number; depth: number } | null = null;
      // Overlapping hit targets choose the nearest visible joint center on screen.
      for (const hit of hits) {
        const center = hit.object.getWorldPosition(new THREE.Vector3()).project(camera);
        const distance = (center.x - pointer.x) ** 2 + (center.y - pointer.y) ** 2;
        if (!best || distance < best.distance - 0.000001 || (Math.abs(distance - best.distance) < 0.000001 && hit.distance < best.depth)) {
          best = { name: hit.object.userData.jointName as JointName, distance, depth: hit.distance };
        }
      }
      return best?.name ?? null;
    }

    function clearHover() {
      hovered = null;
      setHover(null);
      canvas.classList.remove('is-joint-hover');
      schedule();
    }

    function onPointerPrepare(event: PointerEvent) {
      if (blockedTransformPointers.size > 0) {
        blockedTransformPointers.add(event.pointerId);
        event.preventDefault();
        event.stopImmediatePropagation();
        return;
      }
      if (transform.dragging && pointerStart?.id !== event.pointerId) {
        // A second touch must not feed the native control's pointerMove/up,
        // which do not distinguish pointer IDs. Retain the last valid draft,
        // then block this whole touch group until all fingers are released.
        const gesturePointers = [...activePointers, event.pointerId];
        transformFeedback('end');
        cancelTransform();
        for (const id of gesturePointers) blockedTransformPointers.add(id);
        transform.enabled = false;
        syncOrbit();
        event.preventDefault();
        event.stopImmediatePropagation();
        schedule();
        return;
      }
      if (cameraGesture) return;
      if (!transform.enabled || transform.dragging) return;
      if (event.button !== 0) {
        transform.axis = null;
        syncOrbit();
        return;
      }
      const bounds = canvas.getBoundingClientRect();
      // Resolve touch presses before OrbitControls sees pointerdown. Mouse
      // hover already performs this lookup, but touch has no hover phase.
      transform.pointerHover({
        x: ((event.clientX - bounds.left) / bounds.width) * 2 - 1,
        y: -((event.clientY - bounds.top) / bounds.height) * 2 + 1,
        button: event.button,
      } as PointerEvent);
      syncOrbit();
    }

    function onBlockedPointerMove(event: PointerEvent) {
      if (blockedTransformPointers.size === 0) return;
      event.preventDefault();
      event.stopImmediatePropagation();
    }

    function onBlockedPointerEnd(event: PointerEvent) {
      if (!blockedTransformPointers.delete(event.pointerId)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (blockedTransformPointers.size === 0) {
        syncOrbit();
        schedule();
      }
    }

    function onPointerDown(event: PointerEvent) {
      activePointers.add(event.pointerId);
      if (activePointers.size > 1) {
        if (pointerStart) pointerStart.dragged = true;
        return;
      }
      pointerStart = { id: event.pointerId, x: event.clientX, y: event.clientY, dragged: false, button: event.button, gizmo: transform.enabled && (transform.dragging || transform.axis !== null) };
      if (!pointerStart.gizmo) {
        // Camera gestures own all their touches. Hide/disable transform
        // picking until the gesture ends, including a second camera finger.
        cameraGesture = true;
        transform.enabled = false;
        transform.axis = null;
        transform.disconnect();
        transform.connect(canvas);
        syncOrbit();
      }
      canvas.classList.add('is-dragging');
      canvas.focus({ preventScroll: true });
      clearHover();
    }

    function onPointerMove(event: PointerEvent) {
      if (pointerStart) {
        if (Math.hypot(event.clientX - pointerStart.x, event.clientY - pointerStart.y) > 5) pointerStart.dragged = true;
        return;
      }
      if (event.pointerType === 'touch') return;
      if (transform.enabled && (transform.dragging || transform.axis !== null)) {
        clearHover();
        return;
      }
      const joint = pick(event);
      hovered = joint;
      const bounds = canvas.getBoundingClientRect();
      setHover(joint ? { joint, x: Math.min(event.clientX - bounds.left + 13, Math.max(8, width - 116)), y: Math.max(8, event.clientY - bounds.top - 34) } : null);
      canvas.classList.toggle('is-joint-hover', joint !== null);
      schedule();
    }

    function onPointerUp(event: PointerEvent) {
      activePointers.delete(event.pointerId);
      if (activePointers.size === 0) {
        cameraGesture = false;
        schedule();
      }
      if (pointerStart?.id !== event.pointerId) return;
      const start = pointerStart;
      pointerStart = null;
      canvas.classList.remove('is-dragging');
      if (!start.dragged && !start.gizmo && !transform.dragging && start.button === 0 && activePointers.size === 0) {
        const joint = pick(event);
        setInternalSelection(joint);
        selectionRef.current = joint;
        current.current.onSelectJoint?.(joint);
        schedule();
      }
    }

    function onPointerCancel(event: PointerEvent) {
      activePointers.delete(event.pointerId);
      if (activePointers.size === 0) cameraGesture = false;
      pointerStart = null;
      canvas.classList.remove('is-dragging');
      if (transform.dragging) {
        transformFeedback('end');
        cancelTransform();
      }
      clearHover();
    }

    function onPointerLeave() {
      clearHover();
      if (!transform.dragging) transform.axis = null;
      syncOrbit();
    }

    function onLostPointerCapture(event: PointerEvent) {
      if (transform.dragging && pointerStart?.id === event.pointerId) onPointerCancel(event);
    }

    function onTransformChange() {
      syncOrbit();
      setTransformAxis(transform.enabled ? transform.axis : null);
      canvas.classList.toggle('is-transform-hover', transform.enabled && transform.axis !== null);
      schedule();
    }

    function onTransformStart() {
      if (!transform.object || transform.object !== desiredTransformObject()) return;
      draggingRoot = canTranslate() && transform.object === rig.root;
      draggingJoint = draggingRoot ? null : transform.object.name as JointName;
      transformFeedback('start');
      clearHover();
    }

    function onTransformObjectChange() {
      if (!transform.dragging) return;
      transformFeedback('change');
      schedule();
    }

    function onTransformEnd() {
      transformFeedback('end');
      draggingJoint = null;
      draggingRoot = false;
      schedule();
    }

    function onControlsChange() {
      if (initialized && !applyingCamera) {
        manuallyMoved = true;
        current.current.onCameraInteraction?.();
      }
      schedule();
    }

    function onContextLost(event: Event) {
      event.preventDefault();
      stopped = true;
      window.cancelAnimationFrame(frame);
      setError('浏览器暂停了 3D 显示，请刷新页面恢复预览。');
    }

    controls.addEventListener('change', onControlsChange);
    transform.addEventListener('change', onTransformChange);
    transform.addEventListener('mouseDown', onTransformStart);
    transform.addEventListener('objectChange', onTransformObjectChange);
    transform.addEventListener('mouseUp', onTransformEnd);
    canvas.addEventListener('pointerdown', onPointerPrepare, true);
    canvas.addEventListener('pointermove', onBlockedPointerMove, true);
    document.addEventListener('pointerup', onBlockedPointerEnd, true);
    document.addEventListener('pointercancel', onBlockedPointerEnd, true);
    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('pointercancel', onPointerCancel);
    canvas.addEventListener('lostpointercapture', onLostPointerCapture);
    canvas.addEventListener('pointerleave', onPointerLeave);
    canvas.addEventListener('webglcontextlost', onContextLost);
    const observer = new ResizeObserver(resize);
    observer.observe(container);
    resize();

    return () => {
      stopped = true;
      requestDraw.current = () => {};
      window.cancelAnimationFrame(frame);
      observer.disconnect();
      controls.removeEventListener('change', onControlsChange);
      controls.dispose();
      transform.removeEventListener('change', onTransformChange);
      transform.removeEventListener('mouseDown', onTransformStart);
      transform.removeEventListener('objectChange', onTransformObjectChange);
      transform.removeEventListener('mouseUp', onTransformEnd);
      scene.remove(transformHelper);
      transform.dispose();
      canvas.removeEventListener('pointerdown', onPointerPrepare, true);
      canvas.removeEventListener('pointermove', onBlockedPointerMove, true);
      document.removeEventListener('pointerup', onBlockedPointerEnd, true);
      document.removeEventListener('pointercancel', onBlockedPointerEnd, true);
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('pointercancel', onPointerCancel);
      canvas.removeEventListener('lostpointercapture', onLostPointerCapture);
      canvas.removeEventListener('pointerleave', onPointerLeave);
      canvas.removeEventListener('webglcontextlost', onContextLost);
      const geometries = new Set<THREE.BufferGeometry>();
      const materials = new Set<THREE.Material>();
      scene.traverse(object => {
        const drawable = object as THREE.Mesh;
        if (drawable.geometry) geometries.add(drawable.geometry);
        if (drawable.material) for (const material of Array.isArray(drawable.material) ? drawable.material : [drawable.material]) materials.add(material);
      });
      for (const geometry of geometries) geometry.dispose();
      for (const material of materials) material.dispose();
      keyLight.shadow.map?.dispose();
      renderer.dispose();
      canvas.remove();
    };
  }, []);

  useEffect(() => {
    requestDraw.current();
  }, [take, time, view, mirror, cameraResetKey, cameraRestoreKey, cameraFocus, selection, gridVisible, axesVisible, poseOverride, editMode, playing, transformTool]);

  return (
    <div className="stage3d" ref={containerRef} tabIndex={editMode ? 0 : undefined} role="region" aria-label="3D 动画舞台" aria-keyshortcuts={editMode ? 'ArrowLeft ArrowRight Space K Delete Control+Z Meta+Z Control+Shift+Z Meta+Shift+Z Control+Y' : undefined} onPointerDown={event => { if (editMode && event.target instanceof HTMLCanvasElement) containerRef.current?.focus({ preventScroll: true }); }}>
      {error ? <StageFallback error={error} /> : <>
        {axesVisible !== false && <div className="stage3d-gizmo" aria-label="世界坐标方向">
          <svg viewBox="0 0 68 68" aria-hidden="true">
            {gizmo.map(axis => <g key={axis.name} opacity={axis.depth < -0.1 ? 0.58 : 1}>
              <line x1="34" y1="34" x2={axis.x} y2={axis.y} stroke={axis.color} strokeWidth="1.7" />
              <circle cx={axis.x} cy={axis.y} r="7.5" fill={axis.color} />
              <text x={axis.x} y={axis.y + 3.2} textAnchor="middle">{axis.name}</text>
            </g>)}
            <circle cx="34" cy="34" r="2.3" fill="#c7d0e2" />
          </svg>
        </div>}
        {hover && <div className="stage3d-joint-tooltip" style={{ left: hover.x, top: hover.y }} aria-hidden="true">{STAGE_JOINT_LABELS[hover.joint]}<span>点击选择</span></div>}
        {editMode && <div className="stage3d-edit-indicator" aria-label={transformTool === 'translate' ? 'Root 世界位移' : transformTool === 'rotate' ? '关节局部旋转' : '关节选择'}>
          {playing ? '播放期间不可编辑' : mirror ? '关闭镜像后编辑' : transformTool === 'select' ? '选择关节 · 用旋转或移动摆姿' : transformTool === 'translate' ? <>整体位移草稿<span>{transformAxis ? `${transformAxis}轴` : '拖动世界坐标箭头'}</span></> : !selection ? '选择关节后旋转' : !EDITABLE_JOINT_SET.has(selection) ? '末端关节仅查看' : <>局部旋转草稿<span>{transformAxis ? `${transformAxis}轴` : '拖动彩色环'}</span></>}
        </div>}
        <span className="stage3d-selection-announcement" aria-live="polite">{selection ? `已选中${STAGE_JOINT_LABELS[selection]}` : '未选中关节'}</span>
      </>}
    </div>
  );
}
