import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { JOINT_NAMES, sampleTake, type BakedTake, type JointName, type Pose, type Vec3 } from '../../../packages/core/src';
import './Stage.css';

export type StageView = 'front' | 'back' | 'left' | 'right' | 'top' | 'free';
export type StageCamera = { position: Vec3; target: Vec3; zoom?: number };
export const STAGE_JOINT_LABELS: Record<JointName, string> = {
  Hips: '骨盆', Spine: '腰椎', Chest: '胸椎', Neck: '颈部', Head: '头部',
  LeftShoulder: '左锁骨', LeftUpperArm: '左肩', LeftForeArm: '左肘', LeftHand: '左腕', LeftHandTip: '左指尖',
  RightShoulder: '右锁骨', RightUpperArm: '右肩', RightForeArm: '右肘', RightHand: '右腕', RightHandTip: '右指尖',
  LeftUpperLeg: '左髋', LeftLowerLeg: '左膝', LeftFoot: '左踝', LeftToe: '左脚尖', LeftHeel: '左脚跟',
  RightUpperLeg: '右髋', RightLowerLeg: '右膝', RightFoot: '右踝', RightToe: '右脚尖', RightHeel: '右脚跟',
};

type StageProps = {
  take: BakedTake | null;
  time: number;
  view: StageView;
  mirror: boolean;
  cameraResetKey?: number;
  cameraState?: StageCamera;
  cameraRestoreKey?: number;
  selectedJoint?: JointName | null;
  gridVisible?: boolean;
  axesVisible?: boolean;
  onSelectJoint?: (joint: JointName | null) => void;
  onCameraChange?: (camera: StageCamera) => void;
  onCameraInteraction?: () => void;
  onJointPositionChange?: (position: Vec3 | null) => void;
};

type PreviewRig = {
  root: THREE.Group;
  joints: Map<JointName, THREE.Group>;
  markers: Map<JointName, THREE.Mesh<THREE.SphereGeometry, THREE.MeshStandardMaterial>>;
  targets: THREE.Mesh[];
};

type GizmoAxis = { name: 'X' | 'Y' | 'Z'; color: string; x: number; y: number; depth: number };

/** Original preview skeleton: the 25 logical joints retain the preview-1 rest transforms. */
function createPreviewRig(): PreviewRig {
  const root = new THREE.Group();
  const joints = new Map<JointName, THREE.Group>();
  const markers = new Map<JointName, THREE.Mesh<THREE.SphereGeometry, THREE.MeshStandardMaterial>>();
  const targets: THREE.Mesh[] = [];
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
  const direction = new THREE.Mesh(
    new THREE.ConeGeometry(0.022, 0.055, 8),
    new THREE.MeshBasicMaterial({ color: '#7c93ff' }),
  );
  direction.position.set(0, 0.08, 0.142);
  direction.rotation.x = Math.PI / 2;
  head.add(direction);

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
  return { root, joints, markers, targets };
}

function applyPose(rig: PreviewRig, pose: Pose | null) {
  rig.root.position.set(...(pose?.root ?? [0, 1.05, 0]));
  for (const name of JOINT_NAMES) {
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
  const { take, time, view, mirror, cameraResetKey, cameraRestoreKey, selectedJoint, gridVisible, axesVisible } = props;
  const containerRef = useRef<HTMLDivElement>(null);
  const current = useRef(props);
  const requestDraw = useRef<() => void>(() => {});
  const [error, setError] = useState<string | null>(null);
  const [internalSelection, setInternalSelection] = useState<JointName | null>(null);
  const [hover, setHover] = useState<{ joint: JointName; x: number; y: number } | null>(null);
  const [gizmo, setGizmo] = useState<GizmoAxis[]>([]);
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
    controls.listenToKeyEvents(canvas);
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
    let previousTake: BakedTake | null | undefined;
    let previousTime = Number.NaN;
    let hovered: JointName | null = null;
    let cameraSignature = '';
    let jointSignature = '';
    let pointerStart: { id: number; x: number; y: number; dragged: boolean; button: number } | null = null;
    const activePointers = new Set<number>();

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

    function draw() {
      frame = 0;
      if (stopped || width <= 0 || height <= 0) return;
      const state = current.current;
      const restoreChanged = state.cameraRestoreKey !== previousRestore;
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
      mirrorGroup.scale.x = state.mirror ? -1 : 1;
      grid.visible = state.gridVisible !== false;
      axes.visible = state.axesVisible !== false;
      if (state.take !== previousTake || state.time !== previousTime) {
        applyPose(rig, state.take ? sampleTake(state.take, state.time) : null);
        previousTake = state.take;
        previousTime = state.time;
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

    function onPointerDown(event: PointerEvent) {
      activePointers.add(event.pointerId);
      if (activePointers.size > 1) {
        if (pointerStart) pointerStart.dragged = true;
        return;
      }
      pointerStart = { id: event.pointerId, x: event.clientX, y: event.clientY, dragged: false, button: event.button };
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
      const joint = pick(event);
      hovered = joint;
      const bounds = canvas.getBoundingClientRect();
      setHover(joint ? { joint, x: Math.min(event.clientX - bounds.left + 13, Math.max(8, width - 116)), y: Math.max(8, event.clientY - bounds.top - 34) } : null);
      canvas.classList.toggle('is-joint-hover', joint !== null);
      schedule();
    }

    function onPointerUp(event: PointerEvent) {
      activePointers.delete(event.pointerId);
      if (pointerStart?.id !== event.pointerId) return;
      const start = pointerStart;
      pointerStart = null;
      canvas.classList.remove('is-dragging');
      if (!start.dragged && start.button === 0 && activePointers.size === 0) {
        const joint = pick(event);
        setInternalSelection(joint);
        selectionRef.current = joint;
        current.current.onSelectJoint?.(joint);
        schedule();
      }
    }

    function onPointerCancel(event: PointerEvent) {
      activePointers.delete(event.pointerId);
      pointerStart = null;
      canvas.classList.remove('is-dragging');
      clearHover();
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
    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('pointercancel', onPointerCancel);
    canvas.addEventListener('pointerleave', clearHover);
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
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('pointercancel', onPointerCancel);
      canvas.removeEventListener('pointerleave', clearHover);
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
  }, [take, time, view, mirror, cameraResetKey, cameraRestoreKey, selection, gridVisible, axesVisible]);

  return (
    <div className="stage3d" ref={containerRef}>
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
        <span className="stage3d-selection-announcement" aria-live="polite">{selection ? `已选中${STAGE_JOINT_LABELS[selection]}` : '未选中关节'}</span>
      </>}
    </div>
  );
}
