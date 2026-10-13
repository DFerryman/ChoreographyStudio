import * as THREE from 'three';

/** Background and fog share one tone so the far floor dissolves without a horizon line. */
export const STAGE_BACKGROUND = '#19191b';
/** The stage disc covers every legal Root position (±5 m on X and Z) with margin. */
export const STAGE_PLATFORM_RADIUS = 7.6;
const KEY_OFFSET = new THREE.Vector3(-2.6, 5.4, 3.4);

export type StageSet = {
  /** Toggling its visibility shows or hides the stage grid. */
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

/**
 * One floor surface paints the stage disc, its 25 cm / 1 m grid (fading with
 * distance), a 2.5 m circle, a soft pool of light around the dancer and the
 * darker surround. A single opaque pass keeps playback as cheap as a plain floor.
 */
function floorMaterial(gridOpacity: { value: number }, dancer: { value: THREE.Vector2 }): THREE.MeshLambertMaterial {
  const material = new THREE.MeshLambertMaterial({ color: '#3a3a3c' });
  const radius = STAGE_PLATFORM_RADIUS.toFixed(2);
  material.onBeforeCompile = shader => {
    shader.uniforms.gridOpacity = gridOpacity;
    shader.uniforms.dancer = dancer;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vStagePlane;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvStagePlane = (modelMatrix * vec4(transformed, 1.0)).xz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
varying vec2 vStagePlane;
uniform float gridOpacity;
uniform vec2 dancer;
float stageLines(vec2 coordinate, float spacing) {
  vec2 scaled = coordinate / spacing;
  vec2 grid = abs(fract(scaled - 0.5) - 0.5) / max(fwidth(scaled), vec2(1e-4));
  return 1.0 - min(min(grid.x, grid.y), 1.0);
}`)
      .replace('#include <opaque_fragment>', `float stageDistance = length(vStagePlane);
float stageFine = stageLines(vStagePlane, 0.25) * (1.0 - smoothstep(2.5, 5.5, stageDistance));
float stageMajor = stageLines(vStagePlane, 1.0) * (1.0 - smoothstep(${radius} - 2.2, ${radius} - 0.2, stageDistance));
float stageRing = 1.0 - smoothstep(0.0, 1.5 * fwidth(stageDistance), abs(stageDistance - 2.5));
outgoingLight = mix(outgoingLight, vec3(0.62), gridOpacity * max(max(stageFine * 0.05, stageMajor * 0.11), stageRing * 0.09));
outgoingLight += vec3(0.035, 0.032, 0.028) * (1.0 - smoothstep(0.0, 2.4, length(vStagePlane - dancer)));
outgoingLight *= mix(1.0, 0.7, smoothstep(${radius}, ${radius} + 0.06, stageDistance));
#include <opaque_fragment>`);
  };
  return material;
}

/**
 * The studio set: a large circular stage on a far-reaching floor,
 * key, rim and sky lighting with a soft pool of light on the dancer, and a contact
 * shadow. It is view dressing only and never touches motion data.
 */
export function createStageSet(scene: THREE.Scene): StageSet {
  scene.background = new THREE.Color(STAGE_BACKGROUND);
  scene.fog = new THREE.Fog(STAGE_BACKGROUND, 16, 62);

  scene.add(new THREE.HemisphereLight('#ebecef', '#26241f', 0.95));
  const keyLight = new THREE.DirectionalLight('#fff3e6', 2.3);
  keyLight.castShadow = true;
  keyLight.shadow.mapSize.set(1024, 1024);
  Object.assign(keyLight.shadow.camera, { left: -2.4, right: 2.4, top: 2.6, bottom: -2.4, near: 0.5, far: 16 });
  keyLight.shadow.normalBias = 0.02;
  keyLight.shadow.bias = -0.0002;
  keyLight.position.copy(KEY_OFFSET);
  scene.add(keyLight, keyLight.target);
  const rim = new THREE.DirectionalLight('#ffffff', 1.7);
  rim.position.set(2.5, 3.5, -4.5);
  scene.add(rim);

  // A far-reaching floor that fades into the fog, with the stage painted on it.
  const gridOpacity = { value: 1 }, dancer = { value: new THREE.Vector2() };
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(240, 240), floorMaterial(gridOpacity, dancer));
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -0.004;
  floor.receiveShadow = true;
  floor.name = 'StageFloor';
  scene.add(floor);

  // A thin lit edge: quiet set dressing that also shows the stage's extent.
  const edge = new THREE.Mesh(new THREE.TorusGeometry(STAGE_PLATFORM_RADIUS + 0.035, 0.012, 6, 192), new THREE.MeshBasicMaterial({ color: '#9a9aa0', transparent: true, opacity: 0.35 }));
  edge.rotation.x = Math.PI / 2;
  edge.position.y = -0.002;
  scene.add(edge);
  const contactTexture = radialTexture([[0, '#000000ff'], [0.35, '#000000a0'], [1, '#00000000']]);
  const contact = new THREE.Mesh(new THREE.PlaneGeometry(1.25, 1.25), new THREE.MeshBasicMaterial({ map: contactTexture, transparent: true, depthWrite: false, opacity: 0.5 }));
  contact.rotation.x = -Math.PI / 2;
  contact.position.y = 0.003;
  contact.renderOrder = 2;
  contact.name = 'ContactShadow';
  scene.add(contact);
  const contactMaterial = contact.material;

  const grid = new THREE.Object3D();
  grid.name = 'StageGrid';
  return {
    grid,
    keyLight,
    follow(hips) {
      const x = hips?.x ?? 0, z = hips?.z ?? 0, height = hips?.y ?? 1;
      keyLight.target.position.set(x, 0.9, z);
      keyLight.position.set(x + KEY_OFFSET.x, KEY_OFFSET.y, z + KEY_OFFSET.z);
      gridOpacity.value = grid.visible ? 1 : 0;
      dancer.value.set(x, z);
      contact.position.set(x, 0.003, z);
      // Fades and widens as the hips leave the floor (jumps, lifts).
      const lift = Math.max(0, height - 0.95);
      contact.scale.setScalar(1 + lift * 0.6);
      contactMaterial.opacity = Math.max(0.12, 0.5 - lift * 0.35);
    },
  };
}
