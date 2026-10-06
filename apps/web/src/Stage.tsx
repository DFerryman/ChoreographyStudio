import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { JOINT_NAMES, sampleTake, type BakedTake, type Pose } from '../../../packages/core/src';
import './Stage.css';

type StageProps = {
  take: BakedTake | null;
  time: number;
  view: 'front' | 'back';
  mirror: boolean;
};

type PreviewRig = {
  root: THREE.Group;
  joints: Map<string, THREE.Group>;
};

/** An original, deliberately simple preview rig. This is not a production Avatar. */
function createPreviewRig(): PreviewRig {
  const root = new THREE.Group();
  const joints = new Map<string, THREE.Group>();
  const skin = new THREE.MeshStandardMaterial({ color: '#cfa18b', roughness: 0.76 });
  const mint = new THREE.MeshStandardMaterial({ color: '#93bca6', roughness: 0.9 });
  const mintTrim = new THREE.MeshStandardMaterial({ color: '#789e8b', roughness: 0.86 });
  const cream = new THREE.MeshStandardMaterial({ color: '#ece7d6', roughness: 0.95 });
  const sole = new THREE.MeshStandardMaterial({ color: '#bac8ba', roughness: 0.9 });
  const dark = new THREE.MeshStandardMaterial({ color: '#514943', roughness: 0.9 });

  function joint(name: string, parent: string | null, x = 0, y = 0, z = 0) {
    const group = new THREE.Group();
    group.name = name;
    group.position.set(x, y, z);
    (parent ? joints.get(parent)! : root).add(group);
    joints.set(name, group);
    return group;
  }

  function ellipsoid(
    parent: THREE.Group,
    material: THREE.Material,
    scale: [number, number, number],
    position: [number, number, number] = [0, 0, 0],
  ) {
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 14), material);
    mesh.scale.set(...scale);
    mesh.position.set(...position);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  }

  function limb(parent: THREE.Group, length: number, radius: number, material: THREE.Material) {
    const mesh = new THREE.Mesh(
      new THREE.CapsuleGeometry(radius, Math.max(0.001, length - radius * 2), 6, 12),
      material,
    );
    mesh.position.y = -length / 2;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    parent.add(mesh);
  }

  const hips = joint('Hips', null);
  const spine = joint('Spine', 'Hips', 0, 0.14, 0);
  const chest = joint('Chest', 'Spine', 0, 0.2, 0);
  const neck = joint('Neck', 'Chest', 0, 0.19, 0);
  const head = joint('Head', 'Neck', 0, 0.08, 0);

  ellipsoid(hips, cream, [0.205, 0.145, 0.122], [0, -0.02, 0]);
  ellipsoid(spine, mint, [0.18, 0.185, 0.105], [0, 0.045, 0]);
  ellipsoid(chest, mint, [0.235, 0.185, 0.13], [0, 0.025, 0]);
  ellipsoid(neck, skin, [0.056, 0.075, 0.055], [0, 0.012, 0]);
  ellipsoid(head, skin, [0.115, 0.14, 0.108], [0, 0.092, 0]);
  // A modest nose and paired eyes make front/back teaching views unambiguous.
  ellipsoid(head, skin, [0.024, 0.025, 0.034], [0, 0.091, 0.102]);
  ellipsoid(head, dark, [0.007, 0.009, 0.004], [-0.038, 0.121, 0.1]);
  ellipsoid(head, dark, [0.007, 0.009, 0.004], [0.038, 0.121, 0.1]);
  ellipsoid(chest, cream, [0.023, 0.023, 0.004], [0, 0.062, 0.129]);

  for (const side of ['Left', 'Right'] as const) {
    const sign = side === 'Left' ? 1 : -1;
    const shoulder = joint(`${side}Shoulder`, 'Chest', sign * 0.205, 0.095, 0);
    const upperArm = joint(`${side}UpperArm`, `${side}Shoulder`, sign * 0.082, -0.03, 0);
    const foreArm = joint(`${side}ForeArm`, `${side}UpperArm`, 0, -0.285, 0);
    const hand = joint(`${side}Hand`, `${side}ForeArm`, 0, -0.255, 0);
    const handTip = joint(`${side}HandTip`, `${side}Hand`, 0, -0.115, 0);
    ellipsoid(shoulder, mint, [0.072, 0.072, 0.073], [sign * 0.026, -0.005, 0]);
    limb(upperArm, 0.285, 0.052, skin);
    ellipsoid(upperArm, mintTrim, [0.056, 0.036, 0.056], [0, -0.027, 0]);
    limb(foreArm, 0.255, 0.041, skin);
    ellipsoid(foreArm, skin, [0.047, 0.047, 0.047]);
    ellipsoid(hand, skin, [0.041, 0.063, 0.024], [0, -0.052, 0]);
    ellipsoid(handTip, skin, [0.034, 0.027, 0.024], [0, 0.004, 0]);
    ellipsoid(hand, skin, [0.019, 0.035, 0.019], [-sign * 0.035, -0.024, 0.007]);

    const upperLeg = joint(`${side}UpperLeg`, 'Hips', sign * 0.112, -0.05, 0);
    const lowerLeg = joint(`${side}LowerLeg`, `${side}UpperLeg`, 0, -0.46, 0);
    const foot = joint(`${side}Foot`, `${side}LowerLeg`, 0, -0.45, 0);
    const toe = joint(`${side}Toe`, `${side}Foot`, 0, -0.035, 0.15);
    const heel = joint(`${side}Heel`, `${side}Foot`, 0, -0.035, -0.065);
    limb(upperLeg, 0.46, 0.075, skin);
    limb(upperLeg, 0.21, 0.086, cream);
    limb(lowerLeg, 0.45, 0.052, skin);
    ellipsoid(lowerLeg, skin, [0.064, 0.064, 0.064]);
    ellipsoid(foot, cream, [0.073, 0.068, 0.14], [0, -0.025, 0.044]);
    ellipsoid(foot, sole, [0.075, 0.023, 0.145], [0, -0.066, 0.045]);
    ellipsoid(toe, cream, [0.065, 0.037, 0.047], [0, -0.018, -0.002]);
    ellipsoid(heel, cream, [0.059, 0.041, 0.037], [0, -0.012, -0.005]);
  }
  root.position.set(0, 1.05, 0);
  return { root, joints };
}

function applyPose(rig: PreviewRig, pose: Pose | null) {
  rig.root.position.set(...(pose?.root ?? [0, 1.05, 0]));
  for (const name of JOINT_NAMES) {
    const joint = rig.joints.get(name);
    if (!joint) continue;
    const q = pose?.joints[name];
    if (q) joint.quaternion.set(q[0], q[1], q[2], q[3]);
    else joint.quaternion.identity();
  }
}

function circleLine(radius: number, color: string, opacity: number) {
  const points = Array.from({ length: 97 }, (_, index) => {
    const angle = (index / 96) * Math.PI * 2;
    return new THREE.Vector3(Math.sin(angle) * radius, 0.012, Math.cos(angle) * radius);
  });
  return new THREE.Line(
    new THREE.BufferGeometry().setFromPoints(points),
    new THREE.LineBasicMaterial({ color, transparent: true, opacity }),
  );
}

function StageFallback({ error }: { error: string }) {
  return (
    <div className="stage3d-fallback" role="status">
      <svg viewBox="0 0 180 240" aria-hidden="true">
        <ellipse cx="90" cy="215" rx="58" ry="13" fill="#d4dbce" />
        <circle cx="90" cy="40" r="18" fill="#cfa18b" />
        <path d="M72 72 Q90 60 108 72 L112 132 Q90 141 68 132 Z" fill="#93bca6" />
        <path d="M73 80 L49 111 L32 89 M107 80 L131 111 L148 89" fill="none" stroke="#cfa18b" strokeWidth="13" strokeLinecap="round" />
        <path d="M78 139 L72 174 L65 207 M102 139 L108 174 L115 207" fill="none" stroke="#cfa18b" strokeWidth="15" strokeLinecap="round" />
        <path d="M77 132 L74 155 M103 132 L106 155" stroke="#ece7d6" strokeWidth="20" strokeLinecap="round" />
        <path d="M64 209 L75 209 M115 209 L126 209" stroke="#ece7d6" strokeWidth="14" strokeLinecap="round" />
      </svg>
      <p>3D 预览暂时不可用</p>
      <span>{error}</span>
    </div>
  );
}

export function Stage({ take, time, view, mirror }: StageProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const current = useRef({ take, time, view, mirror });
  const [error, setError] = useState<string | null>(null);
  current.current = { take, time, view, mirror };

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
    renderer.toneMappingExposure = 1.2;
    renderer.domElement.className = 'stage3d-canvas';
    renderer.domElement.setAttribute('role', 'img');
    renderer.domElement.setAttribute('aria-label', '原创人偶的编舞动作预览');
    container.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#e9ece5');
    scene.fog = new THREE.Fog('#e9ece5', 8, 18);
    const camera = new THREE.OrthographicCamera(-2, 2, 2, -2, 0.1, 40);
    const hemisphere = new THREE.HemisphereLight('#fffdf1', '#a7b7a4', 2.5);
    scene.add(hemisphere);
    const keyLight = new THREE.DirectionalLight('#fff4de', 3.1);
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
    const fill = new THREE.DirectionalLight('#d6e8dd', 1.2);
    fill.position.set(3, 3, -4);
    scene.add(fill);

    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(50, 50),
      new THREE.MeshStandardMaterial({ color: '#e5e8df', roughness: 1 }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    scene.add(floor);
    const platform = new THREE.Mesh(
      new THREE.CircleGeometry(1.6, 80),
      new THREE.MeshStandardMaterial({ color: '#eff0e7', roughness: 1 }),
    );
    platform.rotation.x = -Math.PI / 2;
    platform.position.y = 0.006;
    platform.receiveShadow = true;
    scene.add(platform);
    for (const radius of [0.55, 1.08, 1.58]) scene.add(circleLine(radius, '#a9b5a6', radius === 1.58 ? 0.5 : 0.23));
    const grid = new THREE.GridHelper(3.15, 10, '#aeb9a9', '#bac3b4');
    grid.position.y = 0.009;
    const gridMaterials = Array.isArray(grid.material) ? grid.material : [grid.material];
    for (const material of gridMaterials) {
      material.transparent = true;
      material.opacity = 0.16;
    }
    scene.add(grid);
    const mirrorGroup = new THREE.Group();
    const rig = createPreviewRig();
    mirrorGroup.add(rig.root);
    scene.add(mirrorGroup);

    let frame = 0;
    let stopped = false;
    let width = 0;
    let height = 0;
    let previousView: StageProps['view'] | null = null;
    let previousMirror: boolean | undefined;
    let previousTake: BakedTake | null | undefined;
    let previousTime = Number.NaN;
    let needsRender = true;

    function resize() {
      width = container!.clientWidth;
      height = container!.clientHeight;
      if (width <= 0 || height <= 0) return;
      renderer.setSize(width, height, false);
      // Preserve enough horizontal room for arms on narrow mobile screens.
      const aspect = width / height;
      const halfHeight = Math.max(1.42, 1.38 / aspect);
      camera.left = -halfHeight * aspect;
      camera.right = halfHeight * aspect;
      camera.top = halfHeight;
      camera.bottom = -halfHeight;
      camera.updateProjectionMatrix();
      needsRender = true;
    }

    function draw() {
      if (stopped) return;
      const state = current.current;
      if (state.view !== previousView) {
        camera.position.set(0, 2.15, state.view === 'front' ? 6 : -6);
        camera.lookAt(0, 0.93, 0);
        previousView = state.view;
        needsRender = true;
      }
      if (state.mirror !== previousMirror) {
        mirrorGroup.scale.x = state.mirror ? -1 : 1;
        previousMirror = state.mirror;
        needsRender = true;
      }
      if (state.take !== previousTake || state.time !== previousTime) {
        applyPose(rig, state.take ? sampleTake(state.take, state.time) : null);
        previousTake = state.take;
        previousTime = state.time;
        needsRender = true;
      }
      if (needsRender && width > 0 && height > 0) {
        renderer.render(scene, camera);
        needsRender = false;
      }
      frame = window.requestAnimationFrame(draw);
    }

    const onContextLost = (event: Event) => {
      event.preventDefault();
      stopped = true;
      window.cancelAnimationFrame(frame);
      setError('浏览器暂停了 3D 显示，请刷新页面恢复预览。');
    };
    renderer.domElement.addEventListener('webglcontextlost', onContextLost);
    const observer = new ResizeObserver(resize);
    observer.observe(container);
    resize();
    draw();

    return () => {
      stopped = true;
      window.cancelAnimationFrame(frame);
      observer.disconnect();
      renderer.domElement.removeEventListener('webglcontextlost', onContextLost);
      const geometries = new Set<THREE.BufferGeometry>();
      const materials = new Set<THREE.Material>();
      scene.traverse((object) => {
        const drawable = object as THREE.Mesh;
        if (drawable.geometry) geometries.add(drawable.geometry);
        if (drawable.material) {
          const list = Array.isArray(drawable.material) ? drawable.material : [drawable.material];
          for (const material of list) materials.add(material);
        }
      });
      for (const geometry of geometries) geometry.dispose();
      for (const material of materials) material.dispose();
      keyLight.shadow.map?.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, []);

  return (
    <div className="stage3d" ref={containerRef}>
      {error && <StageFallback error={error} />}
    </div>
  );
}
