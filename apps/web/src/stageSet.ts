import * as THREE from 'three';

/** Background and fog share one tone so the far floor dissolves without a horizon line. */
export const STAGE_BACKGROUND = '#19191b';
/** The dance platform covers every legal Root position (±5 m on X and Z) with margin. */
export const STAGE_PLATFORM_RADIUS = 7.6;
const PLATFORM_DEPTH = 0.14;
const KEY_OFFSET = new THREE.Vector3(-2.6, 5.4, 3.4);

export type StageSet = {
  /** Grid lines on the platform; the editor can hide them. */
  grid: THREE.Object3D;
  /** The shadow-casting key light, disposed with the renderer. */
  keyLight: THREE.DirectionalLight;
  /** Keeps lighting and the contact shadow on the visible dancer. */
  follow(hips: THREE.Vector3 | null): void;
};

function radialTexture(stops: [number, string][]): THREE.CanvasTexture {
  const size = 128, canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const context = canvas.getContext('2d')!;
  const gradient = context.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  for (const [offset, color] of stops) gradient.addColorStop(offset, color);
  context.fillStyle = gradient;
  context.fillRect(0, 0, size, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/** Fine 25 cm and 1 m lines that fade with distance from the stage centre. */
function createGrid(): THREE.Mesh {
  const material = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    uniforms: { color: { value: new THREE.Color('#d6d6da') }, radius: { value: STAGE_PLATFORM_RADIUS } },
    vertexShader: /* glsl */`
      varying vec2 vPlane;
      void main() {
        vPlane = position.xy;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */`
      uniform vec3 color;
      uniform float radius;
      varying vec2 vPlane;
      float lines(vec2 coordinate, float spacing) {
        vec2 scaled = coordinate / spacing;
        vec2 width = fwidth(scaled);
        vec2 grid = abs(fract(scaled - 0.5) - 0.5) / max(width, vec2(1e-4));
        return 1.0 - min(min(grid.x, grid.y), 1.0);
      }
      void main() {
        float distanceFromCentre = length(vPlane);
        float fine = lines(vPlane, 0.25) * (1.0 - smoothstep(2.5, 5.5, distanceFromCentre));
        float major = lines(vPlane, 1.0) * (1.0 - smoothstep(radius - 2.2, radius - 0.2, distanceFromCentre));
        float alpha = max(fine * 0.07, major * 0.17);
        if (alpha < 0.002) discard;
        gl_FragColor = vec4(color, alpha);
      }`,
  });
  const grid = new THREE.Mesh(new THREE.CircleGeometry(STAGE_PLATFORM_RADIUS, 96), material);
  grid.rotation.x = -Math.PI / 2;
  grid.position.y = 0.0015;
  grid.renderOrder = 1;
  grid.name = 'StageGrid';
  return grid;
}

/**
 * The studio set: a large circular dance platform over a far-reaching floor,
 * soft three-point lighting with a pool of light on the dancer, and a contact
 * shadow. It is view dressing only and never touches motion data.
 */
export function createStageSet(scene: THREE.Scene): StageSet {
  scene.background = new THREE.Color(STAGE_BACKGROUND);
  scene.fog = new THREE.Fog(STAGE_BACKGROUND, 16, 62);

  scene.add(new THREE.HemisphereLight('#e8ebf2', '#26241f', 0.75));
  const keyLight = new THREE.DirectionalLight('#fff3e6', 2.3);
  keyLight.castShadow = true;
  keyLight.shadow.mapSize.set(2048, 2048);
  Object.assign(keyLight.shadow.camera, { left: -2.4, right: 2.4, top: 2.6, bottom: -2.4, near: 0.5, far: 16 });
  keyLight.shadow.normalBias = 0.02;
  keyLight.shadow.bias = -0.0002;
  keyLight.shadow.radius = 3;
  keyLight.position.copy(KEY_OFFSET);
  scene.add(keyLight, keyLight.target);
  const fill = new THREE.DirectionalLight('#d8e2ff', 0.45);
  fill.position.set(3.5, 2.2, 3);
  scene.add(fill);
  const rim = new THREE.DirectionalLight('#ffffff', 1.7);
  rim.position.set(2.5, 3.5, -4.5);
  scene.add(rim);
  const pool = new THREE.SpotLight('#fff6ea', 3.2, 0, 0.3, 1, 0);
  pool.position.set(0, 7.5, 1.2);
  scene.add(pool, pool.target);

  // The surrounding floor sits below the platform and fades into the fog.
  const floor = new THREE.Mesh(new THREE.CircleGeometry(220, 72), new THREE.MeshStandardMaterial({ color: '#18181a', roughness: 1 }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -PLATFORM_DEPTH;
  floor.receiveShadow = true;
  floor.name = 'StageFloor';
  scene.add(floor);

  const platformMaterial = new THREE.MeshStandardMaterial({ color: '#1e1e21', roughness: 0.82, metalness: 0.02 });
  const platform = new THREE.Mesh(new THREE.CylinderGeometry(STAGE_PLATFORM_RADIUS, STAGE_PLATFORM_RADIUS + 0.06, PLATFORM_DEPTH, 128, 1), [
    new THREE.MeshStandardMaterial({ color: '#141416', roughness: 0.9 }), platformMaterial, platformMaterial,
  ]);
  platform.position.y = -PLATFORM_DEPTH / 2 - 0.004;
  platform.receiveShadow = true;
  platform.name = 'StagePlatform';
  scene.add(platform);

  // A thin lit edge and a centre mark: quiet set dressing that also shows scale.
  const edge = new THREE.Mesh(new THREE.TorusGeometry(STAGE_PLATFORM_RADIUS + 0.035, 0.012, 6, 192), new THREE.MeshBasicMaterial({ color: '#9a9aa0', transparent: true, opacity: 0.35 }));
  edge.rotation.x = Math.PI / 2;
  edge.position.y = -0.004;
  scene.add(edge);
  const ring = new THREE.Mesh(new THREE.RingGeometry(2.48, 2.5, 128), new THREE.MeshBasicMaterial({ color: '#d6d6da', transparent: true, opacity: 0.12, depthWrite: false }));
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.002;
  scene.add(ring);
  const grid = createGrid();
  scene.add(grid);

  const contactTexture = radialTexture([[0, '#000000ff'], [0.35, '#000000a0'], [1, '#00000000']]);
  const contact = new THREE.Mesh(new THREE.PlaneGeometry(1.25, 1.25), new THREE.MeshBasicMaterial({ map: contactTexture, transparent: true, depthWrite: false, opacity: 0.5 }));
  contact.rotation.x = -Math.PI / 2;
  contact.position.y = 0.003;
  contact.renderOrder = 2;
  contact.name = 'ContactShadow';
  scene.add(contact);
  const contactMaterial = contact.material;

  return {
    grid,
    keyLight,
    follow(hips) {
      const x = hips?.x ?? 0, z = hips?.z ?? 0, height = hips?.y ?? 1;
      keyLight.target.position.set(x, 0.9, z);
      keyLight.position.set(x + KEY_OFFSET.x, KEY_OFFSET.y, z + KEY_OFFSET.z);
      pool.target.position.set(x, 0, z);
      pool.position.set(x * 0.6, 7.5, z * 0.6 + 1.2);
      contact.position.set(x, 0.003, z);
      // Fades and widens as the hips leave the floor (jumps, lifts).
      const lift = Math.max(0, height - 0.95);
      contact.scale.setScalar(1 + lift * 0.6);
      contactMaterial.opacity = Math.max(0.12, 0.5 - lift * 0.35);
    },
  };
}
