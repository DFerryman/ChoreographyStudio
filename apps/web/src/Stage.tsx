import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { EDITABLE_JOINT_NAMES, JOINT_NAMES, RIG_DEFINITIONS, ROOT_TRANSLATION_LIMITS, sampleTake, type BakedTake, type JointName, type Pose, type Quat, type SampledCameraPose, type Vec3 } from '../../../packages/core/src';
import { fitPerspectiveBounds } from './cameraFraming';
import { constrainJointRotation, getBodyCollisions } from '../../../packages/core/src';
import { disposeHumanoid, loadHumanoid, updateHumanoid } from './Humanoid';
import { getPoseGuidance } from './poseGuidance';
import './Stage.css';

export type StageView = 'front' | 'back' | 'left' | 'right' | 'top' | 'free';
export type StageCamera = { position: Vec3; target: Vec3; zoom?: number };
export type StageCameraFocus = { key: number; kind: 'actor' | 'joint'; joint?: JointName };
export type StageTransformTool = 'select' | 'rotate' | 'translate' | 'ik';
export type StageIKEffector = 'LeftHand' | 'RightHand' | 'LeftFoot' | 'RightFoot';

/** IK terminal selections manipulate their limb end; rotation edits remain local. */
export function getIKEffector(joint: JointName | null | undefined): StageIKEffector | null {
  if (!joint) return null;
  for (const side of ['Left', 'Right'] as const) {
    if (joint === `${side}ForeArm` || joint === `${side}Hand` || joint === `${side}HandTip`) return `${side}Hand`;
    if (joint === `${side}LowerLeg` || joint === `${side}Foot` || joint === `${side}Toe` || joint === `${side}Heel`) return `${side}Foot`;
  }
  return null;
}
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
  /** Exact authored/derived track view; null leaves ordinary navigation in control. */
  cameraTrackState?: SampledCameraPose | null;
  cameraTrackEditing?: boolean;
  cameraEditRevision?: number;
  cameraCancelKey?: number;
  cameraRestoreKey?: number;
  /** One-shot author/history restoration, without legacy navigation clamping. */
  cameraRestoreExact?: SampledCameraPose | null;
  cameraFocus?: StageCameraFocus;
  /** Transient screen space reserved by a floating timeline; never saved with the camera. */
  bottomOverlayInset?: number;
  selectedJoint?: JointName | null;
  gridVisible?: boolean;
  axesVisible?: boolean;
  poseOverride?: Pose | null;
  editMode?: boolean;
  playing?: boolean;
  transformTool?: StageTransformTool;
  ikTarget?: Vec3 | null;
  collisionFeedback?: string | null;
  onSelectJoint?: (joint: JointName | null) => void;
  onCameraChange?: (camera: StageCamera) => void;
  onCameraInteraction?: () => void;
  onCameraGesture?: (camera: StageCamera, phase: 'start' | 'change' | 'end' | 'cancel') => void;
  onJointPositionChange?: (position: Vec3 | null) => void;
  onJointRotationChange?: (joint: JointName, rotation: Quat, phase: 'start' | 'change' | 'end') => Pose | void;
  onRootPositionChange?: (position: Vec3, phase: 'start' | 'change' | 'end') => Pose | void;
  onIKTargetChange?: (effector: StageIKEffector, target: Vec3, phase: 'start' | 'change' | 'end') => Pose | void;
  /** Roll back the active gesture on Escape, pointer cancellation or focus loss. */
  onTransformCancel?: () => void;
};

type PreviewRig = {
  root: THREE.Group;
  joints: Map<JointName, THREE.Bone>;
  markers: Map<JointName, THREE.Mesh<THREE.SphereGeometry, THREE.MeshStandardMaterial>>;
  targets: THREE.Mesh[];
  framingMeshes: THREE.Mesh[];
  humanSkeleton: THREE.Skeleton | null;
  humanSurface: THREE.SkinnedMesh | null;
};

type GizmoAxis = { name: 'X' | 'Y' | 'Z'; color: string; x: number; y: number; depth: number };

/** Canonical authoring bones retain the exact FK/IK and manipulation contract. */
function createPreviewRig(): PreviewRig {
  const root = new THREE.Group();
  const joints = new Map<JointName, THREE.Bone>();
  const markers = new Map<JointName, THREE.Mesh<THREE.SphereGeometry, THREE.MeshStandardMaterial>>();
  const targets: THREE.Mesh[] = [];
  const framingMeshes: THREE.Mesh[] = [];
  const sphereGeometry = new THREE.SphereGeometry(1, 20, 14);
  const targetMaterial = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false });
  for (const { name, parent, offset } of RIG_DEFINITIONS) {
    const bone = new THREE.Bone();
    bone.name = name;
    bone.position.set(...offset);
    (parent ? joints.get(parent)! : root).add(bone);
    joints.set(name, bone);
    const marker = new THREE.Mesh(sphereGeometry, new THREE.MeshStandardMaterial({
      color: '#a4b7c8', roughness: .8, emissive: '#6285a4',
      emissiveIntensity: .12, depthTest: false, depthWrite: false,
    }));
    marker.scale.setScalar(name === 'Hips' ? .013 : name.includes('Tip') || name.endsWith('Toe') || name.endsWith('Heel') ? .006 : .008);
    marker.renderOrder = 20;
    bone.add(marker); markers.set(name, marker); framingMeshes.push(marker);
    const target = new THREE.Mesh(sphereGeometry, targetMaterial);
    target.scale.setScalar(name === 'Hips' ? .088 : .07);
    target.userData.jointName = name;
    bone.add(target); targets.push(target);
  }
  root.position.set(0, 1.05, 0);
  return { root, joints, markers, targets, framingMeshes, humanSkeleton: null, humanSurface: null };
}

/** Clicking the skin selects the part it actually follows, not an empty-space
 * approximation. Fingertips and sole regions lead to their editable wrist or
 * ankle; the small explicit nodes allow terminal channel editing as well. */
function surfaceJoint(hit: THREE.Intersection): JointName | null {
  if (!hit.face || !hit.barycoord) return null;
  const surface = hit.object;
  if (!(surface instanceof THREE.SkinnedMesh)) return null;
  const indices = surface.geometry.getAttribute('skinIndex');
  const weights = surface.geometry.getAttribute('skinWeight');
  if (!indices || !weights) return null;
  const scores = new Map<JointName, number>();
  const vertices = [hit.face.a, hit.face.b, hit.face.c];
  const shares = hit.barycoord.toArray();
  for (let corner = 0; corner < 3; corner++) {
    for (let influence = 0; influence < 4; influence++) {
      const bone = surface.skeleton.bones[indices.getComponent(vertices[corner], influence)];
      let name = (bone?.userData.editorJoint ?? bone?.name) as JointName | undefined;
      if (!name || !JOINT_NAMES.includes(name)) continue;
      if (name.endsWith('HandTip')) name = name.replace('HandTip', 'Hand') as JointName;
      else if (name.endsWith('Toe') || name.endsWith('Heel')) name = name.replace(/(?:Toe|Heel)$/, 'Foot') as JointName;
      scores.set(name, (scores.get(name) ?? 0) + shares[corner] * weights.getComponent(vertices[corner], influence));
    }
  }
  let selected: JointName | null = null;
  let greatest = 0;
  for (const [name, score] of scores) if (score > greatest) { selected = name; greatest = score; }
  return selected;
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
  const { take, time, view, mirror, cameraResetKey, cameraRestoreKey, cameraRestoreExact, cameraFocus, cameraTrackState, cameraTrackEditing, cameraEditRevision, cameraCancelKey, bottomOverlayInset, selectedJoint, gridVisible, axesVisible, poseOverride, editMode, playing, transformTool = 'rotate', ikTarget } = props;
  const containerRef = useRef<HTMLDivElement>(null);
  const current = useRef(props);
  const requestDraw = useRef<() => void>(() => {});
  const [error, setError] = useState<string | null>(null);
  const [internalSelection, setInternalSelection] = useState<JointName | null>(null);
  const [hover, setHover] = useState<{ joint: JointName; x: number; y: number } | null>(null);
  const [gizmo, setGizmo] = useState<GizmoAxis[]>([]);
  const [transformAxis, setTransformAxis] = useState<string | null>(null);
  const [ikResidual, setIKResidual] = useState<number | null>(null);
  const [humanLoaded, setHumanLoaded] = useState(false);
  current.current = props;
  const selection = selectedJoint === undefined ? internalSelection : selectedJoint;
  const selectionRef = useRef(selection);
  selectionRef.current = selection;
  const feedbackPose = useMemo(() => !playing && poseOverride ? poseOverride : take ? sampleTake(take, time) : null, [playing, poseOverride, take, time]);
  const poseGuidance = useMemo(() => getPoseGuidance(feedbackPose), [feedbackPose]);
  const capsuleCollisions = useMemo(() => humanLoaded && feedbackPose ? getBodyCollisions(feedbackPose) : null, [feedbackPose, humanLoaded]);
  const hasCapsuleCollisions = !!capsuleCollisions && (capsuleCollisions.selfCollisions.length > 0 || capsuleCollisions.floorPenetrations.length > 0);
  const guidanceWarning = <>
    {props.collisionFeedback && <span className="stage3d-author-warning" role="status" aria-label="身体碰撞编辑保护">{props.collisionFeedback}</span>}
    {hasCapsuleCollisions && <span className="stage3d-author-warning" role="status" aria-label="身体碰撞提示" title="身体近似碰撞体存在重叠，已有动作保持原值，可调整相关部位检查接触。">身体接触需检查 {capsuleCollisions!.selfCollisions.length} · 穿地 {capsuleCollisions!.floorPenetrations.length}</span>}
    {poseGuidance.outsideSuggestedRange.length > 0 && <span className="stage3d-author-warning" role="status" aria-label="全身关节建议范围" title={poseGuidance.outsideSuggestedRange.map(joint => STAGE_JOINT_LABELS[joint]).join('、')}>超出标准人体建议 · {poseGuidance.outsideSuggestedRange.length} 处 · 保留老师姿态</span>}
    {poseGuidance.shoulderCoupling.length > 0 && <span className="stage3d-author-warning" role="status" aria-label="肩部配合提示" title="大幅举臂请配合肩部，关键帧按老师原姿态保留。">举臂需检查肩部配合</span>}
  </>;

  function selectJoint(joint: JointName | null) {
    setInternalSelection(joint);
    selectionRef.current = joint;
    current.current.onSelectJoint?.(joint);
    requestDraw.current();
  }

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
    canvas.setAttribute('aria-label', '人体编舞动作预览');
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
    let cameraKeyboardEnabled = !current.current.editMode || !!current.current.cameraTrackEditing;
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
    scene.add(new THREE.HemisphereLight('#edf2f7', '#1b2026', 1.5));
    const keyLight = new THREE.DirectionalLight('#fff7ec', 3);
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
    const rim = new THREE.DirectionalLight('#c9d9e6', 1.4);
    rim.position.set(3, 3, -4);
    scene.add(rim);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(100, 100), new THREE.MeshStandardMaterial({ color: '#1c232c', roughness: 1 }));
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
    // The goal lives in unmirrored world space. Translating it asks the editor
    // for an IK draft rather than moving a bone or the authoritative root.
    const ikGoal = new THREE.Object3D();
    ikGoal.name = 'IKGoal';
    const ikMarker = new THREE.Mesh(
      new THREE.SphereGeometry(0.019, 16, 12),
      new THREE.MeshBasicMaterial({ color: '#77d5de', depthTest: false, depthWrite: false }),
    );
    ikMarker.renderOrder = 24;
    ikGoal.add(ikMarker);
    ikGoal.visible = false;
    scene.add(ikGoal);
    const ikLineGeometry = new THREE.BufferGeometry();
    ikLineGeometry.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(6), 3));
    const ikLine = new THREE.Line(ikLineGeometry, new THREE.LineBasicMaterial({
      color: '#e9bc80', transparent: true, opacity: 0.8, depthTest: false, depthWrite: false,
    }));
    ikLine.renderOrder = 23;
    ikLine.visible = false;
    scene.add(ikLine);

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
    let previousCameraCancel = current.current.cameraCancelKey;
    let previousFocusKey = current.current.cameraFocus?.key;
    let previousTake: BakedTake | null | undefined;
    let previousTime = Number.NaN;
    let previousOverride: Pose | null | undefined;
    let draggingJoint: JointName | null = null;
    let draggingRoot = false;
    let draggingIK: StageIKEffector | null = null;
    let transformGesture: { kind: 'joint'; joint: JointName; value: Quat } |
      { kind: 'root'; value: Vec3 } | { kind: 'ik'; effector: StageIKEffector; value: Vec3 } | null = null;
    let previousIKEffector: StageIKEffector | null = null;
    let residualSignature = '';
    let poseNeedsApply = false;
    let hovered: JointName | null = null;
    let cameraSignature = '';
    let projectionSignature = '';
    let jointSignature = '';
    let pointerStart: { id: number; x: number; y: number; dragged: boolean; button: number; gizmo: boolean } | null = null;
    const activePointers = new Set<number>();
    const blockedTransformPointers = new Set<number>();
    let cameraGesture = false;
    let trackCameraSignature: string | null = null;
    let wheelEventInProgress = false;
    let cameraEndTimer: number | undefined;
    let authoredCameraGesture: {
      kind: 'pointer' | 'wheel' | 'keyboard'; before: StageCamera; up: Vec3; value: StageCamera;
      take: BakedTake | null; time: number; revision?: number; tool?: StageTransformTool;
    } | null = null;
    const humanLoad = new AbortController();

    function schedule() {
      if (!stopped && !frame) frame = window.requestAnimationFrame(draw);
    }
    requestDraw.current = schedule;
    void loadHumanoid(rig.joints, humanLoad.signal).then(mesh => {
      if (stopped) {
        disposeHumanoid(mesh);
        mesh.geometry.dispose();
        for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) material.dispose();
        mesh.skeleton.dispose();
        return;
      }
      rig.root.add(mesh); rig.framingMeshes.push(mesh); rig.humanSkeleton = mesh.skeleton; rig.humanSurface = mesh;
      setHumanLoaded(true); schedule();
    }).catch(error => {
      if (!stopped && !humanLoad.signal.aborted) setError(error instanceof Error ? error.message : '人体模型暂时无法载入。');
    });

    function fitDistance() {
      const halfHeight = Math.max(1.31, 1.31 / Math.max(camera.aspect, 0.2));
      return halfHeight / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) + 0.3;
    }

    function overlayInset() {
      const inset = current.current.bottomOverlayInset ?? 0;
      return Number.isFinite(inset) ? THREE.MathUtils.clamp(inset, 0, Math.max(0, height - 1)) : 0;
    }

    function applyProjectionOffset() {
      if (width <= 0 || height <= 0) return;
      // TransformControls keeps its pointer-down plane in the current camera
      // projection. A newly visible draft note must not move that projection
      // underneath the active drag; mouseup schedules the latest inset.
      if (transform.dragging) return;
      const offsetY = overlayInset() / 2;
      const signature = `${width},${height},${offsetY}`;
      if (signature === projectionSignature) return;
      projectionSignature = signature;
      // Positive view-offset Y moves projected objects upward by that many
      // CSS pixels, preserving full canvas dimensions and the camera's scale.
      if (offsetY > 0) camera.setViewOffset(width, height, 0, offsetY, width, height);
      else camera.clearViewOffset();
      camera.updateProjectionMatrix();
      container!.dataset.cameraOffsetY = String(offsetY);
    }

    function preset(nextView: StageView) {
      const offsets: Record<Exclude<StageView, 'free'>, Vec3> = {
        front: [0, 0.22, 1], back: [0, 0.22, -1], left: [1, 0.22, 0], right: [-1, 0.22, 0], top: [0, 1, 0.015],
      };
      applyingCamera = true;
      camera.up.set(0, 1, 0);
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
      camera.up.set(0, 1, 0);
      controls.target.set(...state.target);
      camera.position.copy(controls.target).add(offset);
      camera.zoom = Number.isFinite(state.zoom) ? THREE.MathUtils.clamp(state.zoom!, 0.5, 4) : 1;
      camera.updateProjectionMatrix();
      controls.update();
      applyingCamera = false;
      manuallyMoved = true;
      return true;
    }

    function readCamera(): StageCamera {
      return { position: camera.position.toArray() as Vec3, target: controls.target.toArray() as Vec3, zoom: camera.zoom };
    }

    function sameCamera(a: StageCamera, b: StageCamera) {
      return a.position.every((value, axis) => value === b.position[axis]) &&
        a.target.every((value, axis) => value === b.target[axis]) && (a.zoom ?? 1) === (b.zoom ?? 1);
    }

    function applyTrackCamera(state: SampledCameraPose) {
      // Sampling already validates the authored data. In particular, a derived
      // orbit may exceed legacy navigation bounds: never clamp or round it.
      applyingCamera = true;
      camera.position.set(...state.position);
      controls.target.set(...state.target);
      camera.zoom = state.zoom ?? 1;
      camera.up.set(...(state.up ?? [0, 1, 0]));
      camera.updateProjectionMatrix();
      camera.lookAt(controls.target);
      camera.updateMatrixWorld(true);
      applyingCamera = false;
      manuallyMoved = true;
    }

    function beginCameraGesture(kind: 'pointer' | 'wheel' | 'keyboard') {
      const state = current.current;
      if (!initialized || applyingCamera || !state.cameraTrackEditing || state.playing || !state.onCameraGesture) return;
      if (authoredCameraGesture?.kind !== kind) finishCameraGesture();
      if (authoredCameraGesture) return;
      const before = readCamera();
      authoredCameraGesture = { kind, before, value: before, up: camera.up.toArray() as Vec3,
        take: state.take, time: state.time, revision: state.cameraEditRevision, tool: state.transformTool };
      state.onCameraGesture(before, 'start');
    }

    function finishCameraGesture(cancel = false, stopNative = false) {
      clearCameraEnd();
      const gesture = authoredCameraGesture;
      // Clear before callbacks or capture release: native end can describe the
      // same gesture, and a React update can invalidate its scene/time binding.
      authoredCameraGesture = null;
      if (!gesture) return;
      if (stopNative) {
        const captured = new Set(activePointers);
        if (pointerStart) captured.add(pointerStart.id);
        controls.disconnect();
        controls.connect(canvas);
        if (cameraKeyboardEnabled) controls.listenToKeyEvents(canvas);
        activePointers.clear(); pointerStart = null; cameraGesture = false;
        for (const id of captured) if (canvas.hasPointerCapture(id)) canvas.releasePointerCapture(id);
        canvas.classList.remove('is-dragging');
      }
      if (cancel) applyTrackCamera({ ...gesture.before, up: gesture.up });
      current.current.onCameraGesture?.(cancel || sameCamera(gesture.before, gesture.value) ? gesture.before : gesture.value,
        cancel || sameCamera(gesture.before, gesture.value) ? 'cancel' : 'end');
      schedule();
    }

    function clearCameraEnd() {
      if (cameraEndTimer !== undefined) window.clearTimeout(cameraEndTimer);
      cameraEndTimer = undefined;
    }

    function deferCameraEnd() {
      clearCameraEnd();
      // Keep a continuous zoom burst together while native input is queued.
      // Save, seek and tool changes still finish immediately through their guards.
      cameraEndTimer = window.setTimeout(() => finishCameraGesture(), 500);
    }

    function cameraFeedback() {
      const values = [...camera.position.toArray(), ...controls.target.toArray(), camera.zoom];
      // Inspect the actual renderer values even below the legacy display
      // throttle; this is also the exact seek/playback browser contract.
      container!.dataset.cameraPosition = JSON.stringify(camera.position.toArray());
      container!.dataset.cameraTarget = JSON.stringify(controls.target.toArray());
      container!.dataset.cameraZoom = JSON.stringify(camera.zoom);
      container!.dataset.cameraUp = JSON.stringify(camera.up.toArray());
      const signature = [...values, ...camera.up.toArray()].map(value => value.toFixed(5)).join(',');
      if (signature === cameraSignature) return;
      cameraSignature = signature;
      if (!current.current.cameraTrackState && !authoredCameraGesture) current.current.onCameraChange?.(readCamera());
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
      return !!rig.humanSurface && !!state.editMode && !state.playing && !state.mirror && !cameraGesture && blockedTransformPointers.size === 0;
    }

    function canRotate() {
      const selected = selectionRef.current;
      return canEdit() && activeTool() === 'rotate' && !!selected;
    }

    function canTranslate() {
      return canEdit() && activeTool() === 'translate';
    }

    function canIK() {
      return canEdit() && activeTool() === 'ik' && !!current.current.take &&
        !!current.current.onIKTargetChange && getIKEffector(selectionRef.current) !== null;
    }

    function syncOrbit() {
      controls.enabled = blockedTransformPointers.size === 0 && (!transform.enabled || (!transform.dragging && transform.axis === null));
    }

    function publishTransform(gesture: NonNullable<typeof transformGesture>, phase: 'start' | 'change' | 'end') {
      const accepted = gesture.kind === 'ik' ? current.current.onIKTargetChange?.(gesture.effector, [...gesture.value] as Vec3, phase)
        : gesture.kind === 'root' ? current.current.onRootPositionChange?.([...gesture.value] as Vec3, phase)
          : current.current.onJointRotationChange?.(gesture.joint, [...gesture.value] as Quat, phase);
      // Native controls move a bone before React renders. Put the accepted
      // collision-safe pose back synchronously, including linked IK changes.
      if (phase === 'change' && accepted) applyPose(rig, accepted);
    }

    function finishTransform(rollback = false) {
      const gesture = transformGesture;
      // Native mouseUp, pointer capture release and our document fallback can
      // all describe the same end. Clear ownership before invoking the editor.
      transformGesture = null;
      if (!gesture) return;
      if (rollback && current.current.onTransformCancel) current.current.onTransformCancel();
      else publishTransform(gesture, 'end');
    }

    function transformFeedback(phase: 'start' | 'change') {
      let next: typeof transformGesture = null;
      if (draggingIK && canIK()) {
        const position = ikGoal.position;
        if (!position.toArray().every(Number.isFinite)) return;
        if (phase === 'change') position.clampScalar(-20, 20);
        next = { kind: 'ik', effector: draggingIK, value: position.toArray() as Vec3 };
      } else if (draggingRoot && canTranslate()) {
        const position = rig.root.position;
        if (![position.x, position.y, position.z].every(Number.isFinite)) {
          const state = current.current;
          position.set(...((state.poseOverride ?? (state.take ? sampleTake(state.take, state.time) : null))?.root ?? [0, 1.05, 0]));
          return;
        }
        // Native limits constrain the object itself; keep emitted draft data in
        // the same bounds even if another control changes the object mid-drag.
        if (phase === 'change') {
          position.x = THREE.MathUtils.clamp(position.x, ...ROOT_TRANSLATION_LIMITS.x);
          position.y = THREE.MathUtils.clamp(position.y, ...ROOT_TRANSLATION_LIMITS.y);
          position.z = THREE.MathUtils.clamp(position.z, ...ROOT_TRANSLATION_LIMITS.z);
        }
        next = { kind: 'root', value: position.toArray() as Vec3 };
      } else if (draggingJoint && canRotate()) {
        const quaternion = rig.joints.get(draggingJoint)!.quaternion;
        if (!quaternion.toArray().every(Number.isFinite) || quaternion.lengthSq() <= Number.EPSILON) return;
        // Pressing a handle must not repair an imported author pose. Apply the
        // normal human guidance only after movement; terminal channels have no
        // anatomical envelope and retain a normalized local rotation.
        const rotation = phase === 'start' ? quaternion.toArray() as Quat :
          EDITABLE_JOINT_SET.has(draggingJoint) ? constrainJointRotation(draggingJoint, quaternion.toArray() as Quat) :
            quaternion.clone().normalize().toArray() as Quat;
        if (phase === 'change') quaternion.set(...rotation);
        next = { kind: 'joint', joint: draggingJoint, value: rotation };
      }
      if (!next) return;
      transformGesture = next;
      publishTransform(next, phase);
    }

    function cancelTransform(rollback = false) {
      const canceledPointerId = pointerStart?.id;
      finishTransform(rollback);
      // Capture can be released while the pointer is still held; its eventual
      // pointerup may land outside this canvas. Clear our gesture state now.
      pointerStart = null;
      activePointers.clear();
      cameraGesture = false;
      draggingJoint = null;
      draggingRoot = false;
      draggingIK = null;
      poseNeedsApply = true;
      transform.dragging = false;
      applyProjectionOffset();
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
      if (canIK()) return ikGoal;
      if (canTranslate()) return rig.root;
      if (canRotate()) return rig.joints.get(selectionRef.current!)!;
      return undefined;
    }

    function cancelForCameraFocus() {
      finishCameraGesture(false, true);
      const heldPointers = new Set(activePointers);
      if (pointerStart) heldPointers.add(pointerStart.id);
      // Finish the last valid edit before framing so its channel is committed
      // once even when the native pointerup can no longer reach the canvas.
      cancelTransform();
      controls.disconnect();
      controls.connect(canvas);
      if (cameraKeyboardEnabled) controls.listenToKeyEvents(canvas);
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
          if (mesh instanceof THREE.SkinnedMesh) {
            mesh.computeBoundingBox();
            if (mesh.boundingBox) bounds.union(mesh.boundingBox.clone().applyMatrix4(mesh.matrixWorld));
            continue;
          }
          if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
          if (mesh.geometry.boundingBox) bounds.union(mesh.geometry.boundingBox.clone().applyMatrix4(mesh.matrixWorld));
        }
      }
      const safeHeight = Math.max(1, height - overlayInset());
      const safeFov = THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * safeHeight / Math.max(1, height)));
      const fit = fitPerspectiveBounds({
        bounds, position: camera.position, target: controls.target, up: camera.up,
        aspect: width / safeHeight, fov: safeFov, near: camera.near,
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
      const nextKeyboardEnabled = !state.editMode || !!state.cameraTrackEditing;
      if (cameraKeyboardEnabled !== nextKeyboardEnabled) {
        cameraKeyboardEnabled = nextKeyboardEnabled;
        if (cameraKeyboardEnabled) controls.listenToKeyEvents(canvas);
        else controls.stopListenToKeyEvents();
      }
      frame = 0;
      if (stopped || width <= 0 || height <= 0) return;
      applyProjectionOffset();
      const restoreChanged = state.cameraRestoreKey !== previousRestore;
      const wasInitialized = initialized;
      const focusChanged = state.cameraFocus?.key !== previousFocusKey;
      previousFocusKey = state.cameraFocus?.key;
      const focusRequest = wasInitialized && !restoreChanged && state.take && focusChanged ? state.cameraFocus : undefined;
      const cameraViewChanged = state.view !== previousView || state.cameraResetKey !== previousReset;
      if (state.cameraCancelKey !== previousCameraCancel) finishCameraGesture(true, true);
      previousCameraCancel = state.cameraCancelKey;
      if (authoredCameraGesture && (!state.cameraTrackEditing || state.playing || restoreChanged || cameraViewChanged || focusRequest ||
        state.take !== authoredCameraGesture.take || state.time !== authoredCameraGesture.time ||
        state.cameraEditRevision !== authoredCameraGesture.revision ||
        state.transformTool !== authoredCameraGesture.tool)) {
        finishCameraGesture(false, true);
      }
      // A scene switch can clear the consumer's state even when its camera and
      // selected joint match the previous scene. Publish fresh scene feedback.
      if (!initialized || restoreChanged) {
        cameraSignature = '';
        jointSignature = '';
      }
      if (!initialized) {
        if (state.cameraRestoreExact) applyTrackCamera(state.cameraRestoreExact);
        else if (!restore(state.cameraState)) preset(state.view);
      } else if (restoreChanged) {
        if (state.cameraRestoreExact) applyTrackCamera(state.cameraRestoreExact);
        else if (!restore(state.cameraState)) preset(state.view);
      } else if ((state.view !== previousView && state.view !== 'free') || state.cameraResetKey !== previousReset) {
        preset(state.view);
      }
      const nextTrackSignature = state.cameraTrackState ? JSON.stringify([
        state.cameraTrackState.position, state.cameraTrackState.target, state.cameraTrackState.zoom ?? 1,
        state.cameraTrackState.up ?? [0, 1, 0],
      ]) : null;
      if (state.cameraTrackState && !authoredCameraGesture &&
        (nextTrackSignature !== trackCameraSignature || restoreChanged || cameraViewChanged || !wasInitialized)) {
        applyTrackCamera(state.cameraTrackState);
        trackCameraSignature = nextTrackSignature;
      } else if (!state.cameraTrackState) trackCameraSignature = null;
      initialized = true;
      previousView = state.view;
      previousReset = state.cameraResetKey;
      previousRestore = state.cameraRestoreKey;
      const effector = getIKEffector(selectionRef.current);
      const attachedObject = desiredTransformObject();
      const editable = !!attachedObject;
      const cancelDrag = transform.dragging && (
        transform.object !== attachedObject || restoreChanged || cameraViewChanged ||
        state.take !== previousTake || state.time !== previousTime ||
        (draggingIK !== null && effector !== previousIKEffector) ||
        (state.poseOverride == null && previousOverride != null)
      );
      if (focusRequest) cancelForCameraFocus();
      else if (cancelDrag) cancelTransform();
      const tool = activeTool();
      const worldTranslation = tool === 'translate' || tool === 'ik';
      const mode = worldTranslation ? 'translate' : 'rotate';
      const space = worldTranslation ? 'world' : 'local';
      if (transform.mode !== mode) transform.setMode(mode);
      if (transform.space !== space) transform.setSpace(space);
      // Root bounds are authoring limits. An IK goal can legitimately be below
      // ground or out of reach, where the solver must show its residual.
      Object.assign(transform, tool === 'ik' ? {
        minX: -20, maxX: 20, minY: -20, maxY: 20, minZ: -20, maxZ: 20,
      } : {
        minX: ROOT_TRANSLATION_LIMITS.x[0], maxX: ROOT_TRANSLATION_LIMITS.x[1],
        minY: ROOT_TRANSLATION_LIMITS.y[0], maxY: ROOT_TRANSLATION_LIMITS.y[1],
        minZ: ROOT_TRANSLATION_LIMITS.z[0], maxZ: ROOT_TRANSLATION_LIMITS.z[1],
      });
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
        marker.visible = !!state.editMode && !state.playing && (selected || over);
        marker.material.color.set(selected ? '#85b6db' : over ? '#eef6ff' : '#a4b7c8');
        marker.material.emissiveIntensity = selected ? 0.75 : over ? 0.45 : 0.16;
        const radius = name === 'Hips' ? .013 : name.includes('Tip') || name.endsWith('Toe') || name.endsWith('Heel') ? .006 : .008;
        marker.scale.setScalar(radius * (selected ? 1.38 : over ? 1.18 : 1));
      }
      updateHumanoid(rig.humanSurface);
      scene.updateMatrixWorld(true);
      ikGoal.visible = canIK();
      ikLine.visible = false;
      let residual: number | null = null;
      if (ikGoal.visible && effector) {
        const actual = rig.joints.get(effector)!.getWorldPosition(new THREE.Vector3());
        const requestedTarget = state.ikTarget;
        if (!transform.dragging || !draggingIK) {
          if (requestedTarget && requestedTarget.every(Number.isFinite) && requestedTarget.every(value => Math.abs(value) <= 20)) {
            ikGoal.position.set(...requestedTarget);
          } else ikGoal.position.copy(actual);
        }
        residual = actual.distanceTo(ikGoal.position);
        ikMarker.material.color.set(residual > 0.015 ? '#e9bc80' : '#77d5de');
        const positions = ikLineGeometry.getAttribute('position') as THREE.BufferAttribute;
        positions.setXYZ(0, actual.x, actual.y, actual.z);
        positions.setXYZ(1, ikGoal.position.x, ikGoal.position.y, ikGoal.position.z);
        positions.needsUpdate = true;
        ikLineGeometry.computeBoundingSphere();
        ikLine.visible = residual > 0.004;
        ikGoal.updateMatrixWorld(true);
      }
      previousIKEffector = effector;
      const nextResidualSignature = residual === null ? '' : residual.toFixed(3);
      if (nextResidualSignature !== residualSignature) {
        residualSignature = nextResidualSignature;
        setIKResidual(residual);
      }
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
      applyProjectionOffset();
      if (initialized && !current.current.cameraTrackState && !manuallyMoved && Math.abs(oldAspect - camera.aspect) > 0.001) preset(current.current.view);
      schedule();
    }

    function pick(event: PointerEvent, includeSurface = false): JointName | null {
      const bounds = canvas.getBoundingClientRect();
      pointer.set(((event.clientX - bounds.left) / bounds.width) * 2 - 1, -((event.clientY - bounds.top) / bounds.height) * 2 + 1);
      updateHumanoid(rig.humanSurface);
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
      if (best) return best.name;
      // Skin raycasting evaluates posed vertices. Keep it to deliberate
      // clicks instead of repeating a full triangle pass on every hover.
      if (includeSurface && rig.humanSurface) {
        // A previous framing/raycast may have cached bounds from another
        // pose. Refresh them here so a raised arm remains selectable.
        rig.humanSurface.computeBoundingBox();
        rig.humanSurface.boundingSphere ??= new THREE.Sphere();
        rig.humanSurface.boundingBox?.getBoundingSphere(rig.humanSurface.boundingSphere);
        const hit = raycaster.intersectObject(rig.humanSurface, false)[0];
        if (hit) return surfaceJoint(hit);
      }
      return null;
    }

    function clearHover() {
      hovered = null;
      setHover(null);
      canvas.classList.remove('is-joint-hover');
      schedule();
    }

    function onPointerPrepare(event: PointerEvent) {
      // Disabled wheel input may have no native end. A new pointer is always a
      // pointer gesture, even if a previous wheel left its capture marker set.
      wheelEventInProgress = false;
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
      if (current.current.cameraTrackEditing) { clearHover(); return; }
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
      if (!current.current.cameraTrackEditing && !start.dragged && !start.gizmo && !transform.dragging && start.button === 0 && activePointers.size === 0) {
        selectJoint(pick(event, true));
      }
    }

    function onPointerCancel(event: PointerEvent) {
      finishCameraGesture(true, true);
      activePointers.delete(event.pointerId);
      if (activePointers.size === 0) cameraGesture = false;
      pointerStart = null;
      canvas.classList.remove('is-dragging');
      if (transform.dragging || transformGesture) cancelTransform(true);
      clearHover();
    }

    function onDocumentPointerEnd(event: PointerEvent) {
      if (authoredCameraGesture && event.type === 'pointercancel') finishCameraGesture(true, true);
      if (!transformGesture || pointerStart?.id !== event.pointerId) return;
      if (event.type === 'pointercancel') onPointerCancel(event);
      else {
        // Capture runs before TransformControls releases pointer capture. The
        // following native mouseUp is harmless because ownership is cleared.
        finishTransform();
        if (event.target !== canvas) cancelTransform();
      }
      schedule();
    }

    function onGestureKeyDown(event: KeyboardEvent) {
      if (event.isComposing) return;
      if (event.key !== 'Escape') {
        if (cameraKeyboardEnabled && current.current.cameraTrackEditing && controls.enabled &&
          !event.altKey && ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.code) && event.target === canvas) {
          beginCameraGesture('keyboard');
        }
        return;
      }
      if (!transformGesture && !authoredCameraGesture) return;
      event.preventDefault();
      finishCameraGesture(true, true);
      if (transformGesture) cancelTransform(true);
      schedule();
    }

    function onGestureKeyUp(event: KeyboardEvent) {
      if (authoredCameraGesture?.kind === 'keyboard' && ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.code)) finishCameraGesture();
    }

    function onWindowBlur() {
      if (!transformGesture && !authoredCameraGesture) return;
      finishCameraGesture(true, true);
      if (transformGesture) cancelTransform(true);
      schedule();
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
      draggingIK = canIK() && transform.object === ikGoal ? getIKEffector(selectionRef.current) : null;
      draggingRoot = canTranslate() && transform.object === rig.root;
      draggingJoint = draggingRoot || draggingIK ? null : transform.object.name as JointName;
      transformFeedback('start');
      clearHover();
    }

    function onTransformObjectChange() {
      if (!transform.dragging) return;
      if (transform.object !== desiredTransformObject() || current.current.take !== previousTake || current.current.time !== previousTime) {
        cancelTransform();
        schedule();
        return;
      }
      transformFeedback('change');
      schedule();
    }

    function onTransformEnd() {
      finishTransform();
      draggingJoint = null;
      draggingRoot = false;
      draggingIK = null;
      poseNeedsApply = true;
      schedule();
    }

    function onControlsChange() {
      if (initialized && !applyingCamera) {
        manuallyMoved = true;
        if (authoredCameraGesture) {
          const value = readCamera();
          if (!sameCamera(value, authoredCameraGesture.value)) {
            authoredCameraGesture.value = value;
            current.current.onCameraGesture?.(value, 'change');
          }
        } else current.current.onCameraInteraction?.();
      }
      schedule();
    }

    function onControlsStart() {
      beginCameraGesture(wheelEventInProgress ? 'wheel' : 'pointer');
    }

    function onControlsEnd() {
      if (authoredCameraGesture?.kind === 'wheel') deferCameraEnd();
      else finishCameraGesture();
      // Clear inside the native start/end lifecycle. Reconnecting OrbitControls
      // reorders DOM bubble listeners, so a separate bubble clearer is unsafe.
      wheelEventInProgress = false;
    }

    function onWheelPrepare() {
      if (authoredCameraGesture?.kind === 'wheel') clearCameraEnd();
      wheelEventInProgress = true;
    }

    function onContextLost(event: Event) {
      event.preventDefault();
      finishCameraGesture(true, true);
      cancelTransform(true);
      stopped = true;
      humanLoad.abort();
      window.cancelAnimationFrame(frame);
      setError('浏览器暂停了 3D 显示，请刷新页面恢复预览。');
    }

    controls.addEventListener('change', onControlsChange);
    controls.addEventListener('start', onControlsStart);
    controls.addEventListener('end', onControlsEnd);
    canvas.addEventListener('wheel', onWheelPrepare, { capture: true, passive: true });
    transform.addEventListener('change', onTransformChange);
    transform.addEventListener('mouseDown', onTransformStart);
    transform.addEventListener('objectChange', onTransformObjectChange);
    transform.addEventListener('mouseUp', onTransformEnd);
    canvas.addEventListener('pointerdown', onPointerPrepare, true);
    canvas.addEventListener('pointermove', onBlockedPointerMove, true);
    document.addEventListener('pointerup', onBlockedPointerEnd, true);
    document.addEventListener('pointercancel', onBlockedPointerEnd, true);
    document.addEventListener('pointerup', onDocumentPointerEnd, true);
    document.addEventListener('pointercancel', onDocumentPointerEnd, true);
    document.addEventListener('keydown', onGestureKeyDown, true);
    document.addEventListener('keyup', onGestureKeyUp, true);
    window.addEventListener('blur', onWindowBlur);
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
      finishCameraGesture(true);
      requestDraw.current = () => {};
      window.cancelAnimationFrame(frame);
      observer.disconnect();
      controls.removeEventListener('change', onControlsChange);
      controls.removeEventListener('start', onControlsStart);
      controls.removeEventListener('end', onControlsEnd);
      canvas.removeEventListener('wheel', onWheelPrepare, true);
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
      document.removeEventListener('pointerup', onDocumentPointerEnd, true);
      document.removeEventListener('pointercancel', onDocumentPointerEnd, true);
      document.removeEventListener('keydown', onGestureKeyDown, true);
      document.removeEventListener('keyup', onGestureKeyUp, true);
      window.removeEventListener('blur', onWindowBlur);
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
      disposeHumanoid(rig.humanSurface);
      rig.humanSkeleton?.dispose();
      keyLight.shadow.map?.dispose();
      renderer.dispose();
      canvas.remove();
    };
  }, []);

  useEffect(() => {
    requestDraw.current();
  }, [take, time, view, mirror, cameraResetKey, cameraRestoreKey, cameraRestoreExact, cameraFocus, cameraTrackState, cameraTrackEditing, cameraEditRevision, cameraCancelKey, bottomOverlayInset, selection, gridVisible, axesVisible, poseOverride, editMode, playing, transformTool, ikTarget]);

  return (
    <div className="stage3d" ref={containerRef} data-camera-offset-y="0" tabIndex={editMode ? 0 : undefined} role="region" aria-label="3D 动画舞台" data-selected-joint={selection ?? ''} data-local-rotation={selection && feedbackPose ? JSON.stringify(feedbackPose.joints[selection]) : undefined} data-root-position={feedbackPose ? JSON.stringify(feedbackPose.root) : undefined} aria-keyshortcuts={editMode ? 'ArrowLeft ArrowRight Space Delete Control+Z Meta+Z Control+Shift+Z Meta+Shift+Z Control+Y Alt+ArrowUp Alt+ArrowDown' : undefined} onPointerDown={event => { if (editMode && event.target instanceof HTMLCanvasElement) containerRef.current?.focus({ preventScroll: true }); }} onKeyDown={event => {
      if (!editMode || event.nativeEvent.isComposing || !event.altKey || event.ctrlKey || event.metaKey || !['ArrowUp', 'ArrowDown'].includes(event.key)
        || (event.target !== containerRef.current && !(event.target instanceof HTMLCanvasElement))) return;
      event.preventDefault();
      if (event.repeat) return;
      const direction = event.key === 'ArrowDown' ? 1 : -1;
      const index = selectionRef.current ? JOINT_NAMES.indexOf(selectionRef.current) : direction > 0 ? -1 : 0;
      selectJoint(JOINT_NAMES[(index + direction + JOINT_NAMES.length) % JOINT_NAMES.length]);
    }}>
      {error ? <StageFallback error={error} /> : <>
        {!humanLoaded && <span className="stage3d-model-loading" role="status">人物模型载入中…</span>}
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
        {editMode && <div className={`stage3d-edit-indicator${transformTool === 'ik' ? ' is-ik' : ''}`} aria-label={transformTool === 'translate' ? 'Root 世界位移' : transformTool === 'ik' ? 'IK 手脚目标' : transformTool === 'rotate' ? '关节局部旋转' : '关节选择'}>
          {(selection || transformTool === 'translate') && <output className="stage3d-selected-part" aria-label="选中姿态状态" data-selected-joint={selection ?? ''} data-local-rotation={selection && feedbackPose ? JSON.stringify(feedbackPose.joints[selection]) : undefined} data-root-position={feedbackPose ? JSON.stringify(feedbackPose.root) : undefined}>{transformTool === 'translate' ? '角色' : STAGE_JOINT_LABELS[selection!]} · {!playing && poseOverride ? '编辑中' : '已记录'}</output>}
          {playing ? '播放期间不可编辑' : mirror ? '关闭镜像后编辑' : transformTool === 'select' ? '点身体部位选择' : transformTool === 'translate' ? <>整体移动<span>{transformAxis ? `${transformAxis}轴` : '拖箭头调整位置'}</span></> : transformTool === 'ik' ? !getIKEffector(selection) ? '点手或脚，再拖箭头摆姿' : <>手脚协调<span>{transformAxis ? `${transformAxis}轴` : '拖箭头摆姿'}</span>{ikResidual !== null && ikResidual > 0.015 && <span className="stage3d-ik-residual" role="status">目标差 {(ikResidual * 100).toFixed(1)} cm</span>}</> : !selection ? '点身体部位，再拖彩色环摆姿' : <>旋转<span>{transformAxis ? `${transformAxis}轴` : '拖彩色环摆姿'}</span></>}
          {guidanceWarning}
        </div>}
        {!editMode && cameraTrackEditing && <div className="stage3d-edit-indicator" aria-label="相机轨道编辑">{playing ? '相机轨道 · 播放中' : '相机 · 拖动画面，松手记录'}{guidanceWarning}</div>}
        {!editMode && !cameraTrackEditing && (hasCapsuleCollisions || props.collisionFeedback || poseGuidance.outsideSuggestedRange.length > 0 || poseGuidance.shoulderCoupling.length > 0) && <div className="stage3d-edit-indicator" aria-label="姿态建议提示">{guidanceWarning}</div>}
        <span className="stage3d-selection-announcement" aria-live="polite">{selection ? `已选中${STAGE_JOINT_LABELS[selection]}` : '未选中关节'}</span>
      </>}
    </div>
  );
}
