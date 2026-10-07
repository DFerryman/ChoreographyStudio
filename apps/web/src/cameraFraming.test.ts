import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { fitPerspectiveBounds } from './cameraFraming';

const defaults = {
  position: new THREE.Vector3(0, 1, 6), target: new THREE.Vector3(0, 1, 0), up: new THREE.Vector3(0, 1, 0),
  aspect: 1.5, fov: 40, near: 0.05, minDistance: 1.3, maxDistance: 18,
};

describe('perspective camera framing', () => {
  it.each([
    ['front', [0, 0.22, 1]], ['back', [0, 0.22, -1]], ['side', [1, 0.22, 0]],
    ['top', [0, 1, 0.015]], ['diagonal', [-0.8, 0.5, 1]],
  ] as const)('fits every corner of a translated, expanded pose from %s, including narrow viewports', (_name, direction) => {
    const bounds = new THREE.Box3(new THREE.Vector3(2.4, 0.15, -2.5), new THREE.Vector3(4.2, 2.8, -1.1));
    const original = bounds.clone();
    for (const aspect of [0.32, 0.8, 2.4]) {
      const position = defaults.target.clone().add(new THREE.Vector3(...direction).multiplyScalar(5));
      const fit = fitPerspectiveBounds({ ...defaults, position, bounds, aspect });
      expect(fit).not.toBeNull();
      if (!fit) throw new Error('camera fit unavailable');
      expect(fit.target.x).toBeCloseTo(3.3, 12);
      expect(fit.target.y).toBeCloseTo(1.475, 12);
      expect(fit.target.z).toBeCloseTo(-1.8, 12);
      expect(fit.distance).toBeGreaterThanOrEqual(1.3);
      expect(fit.distance).toBeLessThanOrEqual(18);
      expect(fit.position.clone().sub(fit.target).normalize().dot(new THREE.Vector3(...direction).normalize())).toBeCloseTo(1, 12);
      const camera = new THREE.PerspectiveCamera(defaults.fov, aspect, defaults.near, 80);
      camera.position.copy(fit.position);
      camera.lookAt(fit.target);
      camera.updateMatrixWorld(true);
      for (const x of [bounds.min.x, bounds.max.x]) for (const y of [bounds.min.y, bounds.max.y]) for (const z of [bounds.min.z, bounds.max.z]) {
        const projected = new THREE.Vector3(x, y, z).project(camera);
        expect(Math.abs(projected.x)).toBeLessThanOrEqual(1 / 1.18 + 1e-9);
        expect(Math.abs(projected.y)).toBeLessThanOrEqual(1 / 1.18 + 1e-9);
        expect(projected.z).toBeGreaterThan(-1);
        expect(projected.z).toBeLessThan(1);
      }
    }
    expect(bounds.equals(original)).toBe(true);
  });

  it('respects close-distance and near-plane limits for small and deep bounds', () => {
    const point = new THREE.Box3(new THREE.Vector3(4, 2, -3), new THREE.Vector3(4, 2, -3));
    const close = fitPerspectiveBounds({ ...defaults, bounds: point, minDistance: 1.5 });
    expect(close?.distance).toBe(1.5);
    expect(close?.target.toArray()).toEqual([4, 2, -3]);
    const bounds = new THREE.Box3(new THREE.Vector3(-0.1, -0.1, -2), new THREE.Vector3(0.1, 0.1, 2));
    const deep = fitPerspectiveBounds({ ...defaults, bounds, near: 4 });
    expect(deep?.distance).toBeGreaterThan(6);
    expect(deep!.distance - 2).toBeGreaterThan(4);
  });

  it('keeps the existing navigation cap and handles coincident or exactly vertical directions', () => {
    const huge = new THREE.Box3(new THREE.Vector3(-50, -50, -50), new THREE.Vector3(50, 50, 50));
    expect(fitPerspectiveBounds({ ...defaults, bounds: huge })?.distance).toBe(18);
    const bounds = new THREE.Box3(new THREE.Vector3(-0.3, -0.3, -0.3), new THREE.Vector3(0.3, 0.3, 0.3));
    for (const position of [defaults.target.clone(), defaults.target.clone().add(new THREE.Vector3(0, 5, 0))]) {
      const fit = fitPerspectiveBounds({ ...defaults, position, bounds });
      expect(fit?.position.toArray().every(Number.isFinite)).toBe(true);
      expect(fit?.target.toArray().every(Number.isFinite)).toBe(true);
      expect(fit?.distance).toBeGreaterThanOrEqual(1.3);
    }
  });

  it('rejects empty, nonfinite or invalid projection inputs', () => {
    const bounds = new THREE.Box3(new THREE.Vector3(-1, -1, -1), new THREE.Vector3(1, 1, 1));
    expect(fitPerspectiveBounds({ ...defaults, bounds: new THREE.Box3() })).toBeNull();
    expect(fitPerspectiveBounds({ ...defaults, bounds: new THREE.Box3(new THREE.Vector3(Number.NaN, 0, 0), new THREE.Vector3(1, 1, 1)) })).toBeNull();
    expect(fitPerspectiveBounds({ ...defaults, bounds, position: new THREE.Vector3(1e308, 0, 0) })).toBeNull();
    for (const invalid of [{ aspect: 0 }, { aspect: Number.NaN }, { fov: 180 }, { near: -1 }, { maxDistance: 0 }, { padding: 0.8 }]) {
      expect(fitPerspectiveBounds({ ...defaults, bounds, ...invalid })).toBeNull();
    }
  });
});
