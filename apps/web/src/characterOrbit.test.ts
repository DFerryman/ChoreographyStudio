import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { orbitAboutPivot } from './characterOrbit';

function frontCamera() {
  const camera = new THREE.PerspectiveCamera(40, 1, .05, 80);
  const target = new THREE.Vector3(.4, 1.2, 0);
  camera.position.set(.4, 1.2, 5);
  camera.lookAt(target);
  return { camera, target };
}

describe('character orbit', () => {
  it('keeps the distance to the character pivot and rotates the target with it', () => {
    const { camera, target } = frontCamera();
    const pivot = new THREE.Vector3(0, .95, 0);
    const distance = camera.position.distanceTo(pivot), targetDistance = target.distanceTo(pivot);
    orbitAboutPivot(camera, target, pivot, .7, .3);
    expect(camera.position.distanceTo(pivot)).toBeCloseTo(distance, 12);
    expect(target.distanceTo(pivot)).toBeCloseTo(targetDistance, 12);
    // The view still looks along camera -> target.
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
    expect(forward.angleTo(target.clone().sub(camera.position))).toBeLessThan(1e-6);
  });

  it('passes over the pole continuously without roll or a singular up', () => {
    const { camera, target } = frontCamera();
    const pivot = target.clone();
    let previous = camera.quaternion.clone();
    // Twenty small pitch steps of 9 degrees: 180 degrees, straight over the top.
    for (let step = 0; step < 20; step++) {
      orbitAboutPivot(camera, target, pivot, 0, Math.PI / 20);
      expect(camera.quaternion.angleTo(previous)).toBeCloseTo(Math.PI / 20, 9);
      previous = camera.quaternion.clone();
      const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
      expect(Math.abs(right.y)).toBeLessThan(1e-9);
      expect(camera.up.length()).toBeCloseTo(1, 12);
    }
    // Now behind and upside down: re-running OrbitControls' lookAt keeps the same view.
    expect(camera.position.z).toBeLessThan(target.z);
    const before = camera.quaternion.clone();
    camera.lookAt(target);
    expect(camera.quaternion.angleTo(before)).toBeLessThan(1e-7);
  });

  it('turns horizontally about world up around the pivot', () => {
    const { camera, target } = frontCamera();
    const pivot = new THREE.Vector3(0, .95, 0);
    const height = camera.position.y;
    orbitAboutPivot(camera, target, pivot, Math.PI / 2, 0);
    expect(camera.position.y).toBeCloseTo(height, 12);
    expect(camera.position.x).toBeLessThan(-4.9);
  });
});
