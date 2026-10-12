import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const WORLD_UP = new THREE.Vector3(0, 1, 0);
const yawRotation = new THREE.Quaternion();
const pitchRotation = new THREE.Quaternion();
const rotation = new THREE.Quaternion();
const right = new THREE.Vector3();
const offset = new THREE.Vector3();

/**
 * Turntable orbit with quaternions: yaw about world up, pitch about the
 * camera's own right axis, both around `pivot`. Position, target, orientation
 * and up rotate together, so the view passes over the poles without the
 * spherical (Euler) singularity and without roll creeping in.
 */
export function orbitAboutPivot(camera: THREE.Camera, target: THREE.Vector3, pivot: THREE.Vector3, yaw: number, pitch: number): void {
  if (!Number.isFinite(yaw) || !Number.isFinite(pitch) || (yaw === 0 && pitch === 0)) return;
  camera.updateMatrixWorld();
  right.set(1, 0, 0).applyQuaternion(camera.quaternion).normalize();
  // Upside down (past a pole), a horizontal drag still turns the stage the way it looks.
  const upright = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion).y >= 0;
  yawRotation.setFromAxisAngle(WORLD_UP, upright ? -yaw : yaw);
  pitchRotation.setFromAxisAngle(right, -pitch);
  rotation.multiplyQuaternions(yawRotation, pitchRotation);
  camera.position.sub(pivot).applyQuaternion(rotation).add(pivot);
  offset.copy(target).sub(pivot).applyQuaternion(rotation);
  target.copy(pivot).add(offset);
  camera.quaternion.premultiply(rotation).normalize();
  // The true (orthonormal) up keeps OrbitControls' lookAt identical to this orientation.
  camera.up.set(0, 1, 0).applyQuaternion(camera.quaternion).normalize();
  camera.updateMatrixWorld();
}

/**
 * OrbitControls whose rotation always orbits the character. Pan, dolly,
 * touch, keyboard and the start/change/end lifecycle are unchanged; only the
 * spherical rotate step is replaced by `orbitAboutPivot`.
 */
export class CharacterOrbitControls extends OrbitControls {
  /** Current character centre in world space; falls back to the target. */
  pivot: () => THREE.Vector3 | null = () => null;

  constructor(camera: THREE.PerspectiveCamera, element: HTMLElement) {
    super(camera, element);
    // No polar clamp: quaternion rotation has no pole to protect.
    this.minPolarAngle = 0;
    this.maxPolarAngle = Math.PI;
  }

  /** OrbitControls hook: a horizontal rotate step (theta). */
  _rotateLeft(angle: number) {
    orbitAboutPivot(this.object, this.target, this.pivot() ?? this.target.clone(), angle, 0);
  }

  /** OrbitControls hook: a vertical rotate step (phi). */
  _rotateUp(angle: number) {
    orbitAboutPivot(this.object, this.target, this.pivot() ?? this.target.clone(), 0, angle);
  }
}
