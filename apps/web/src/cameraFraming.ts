import * as THREE from 'three';

type PerspectiveBoundsOptions = {
  bounds: THREE.Box3;
  position: THREE.Vector3;
  target: THREE.Vector3;
  up: THREE.Vector3;
  aspect: number;
  fov: number;
  near: number;
  minDistance: number;
  maxDistance: number;
  padding?: number;
};

/** Fit world-space corners in the current perspective direction, without mutating inputs. */
export function fitPerspectiveBounds(options: PerspectiveBoundsOptions): {
  position: THREE.Vector3;
  target: THREE.Vector3;
  distance: number;
} | null {
  const { bounds, position, target, up, aspect, fov, near, minDistance, maxDistance, padding = 1.18 } = options;
  const values = [...bounds.min.toArray(), ...bounds.max.toArray(), ...position.toArray(), ...target.toArray(), ...up.toArray(), aspect, fov, near, minDistance, maxDistance, padding];
  if (!values.every(Number.isFinite) || bounds.isEmpty() || aspect <= 0 || fov <= 0 || fov >= 180 || near < 0 || minDistance <= 0 || maxDistance < minDistance || padding < 1) return null;

  const center = bounds.getCenter(new THREE.Vector3());
  const direction = position.clone().sub(target);
  if (![...center.toArray(), direction.lengthSq(), up.lengthSq()].every(Number.isFinite)) return null;
  if (direction.lengthSq() < 1e-12) direction.set(0, 0, 1);
  direction.normalize();
  const safeUp = up.lengthSq() < 1e-12 ? new THREE.Vector3(0, 1, 0) : up.clone().normalize();
  // Match camera.lookAt(), including its stable fallback for a vertical view.
  const orientation = new THREE.Matrix4().lookAt(direction, new THREE.Vector3(), safeUp);
  const right = new THREE.Vector3();
  const vertical = new THREE.Vector3();
  const back = new THREE.Vector3();
  orientation.extractBasis(right, vertical, back);
  const tanVertical = Math.tan(THREE.MathUtils.degToRad(fov / 2));
  const tanHorizontal = tanVertical * aspect;
  let distance = minDistance;
  for (const x of [bounds.min.x, bounds.max.x]) {
    for (const y of [bounds.min.y, bounds.max.y]) {
      for (const z of [bounds.min.z, bounds.max.z]) {
        const offset = new THREE.Vector3(x, y, z).sub(center);
        const depth = offset.dot(back);
        distance = Math.max(distance,
          depth + padding * Math.abs(offset.dot(right)) / tanHorizontal,
          depth + padding * Math.abs(offset.dot(vertical)) / tanVertical,
          depth + near + Math.max(0.01, near * 0.1),
        );
      }
    }
  }
  distance = THREE.MathUtils.clamp(distance, minDistance, maxDistance);
  const fittedPosition = center.clone().addScaledVector(back, distance);
  if (![...fittedPosition.toArray(), distance].every(Number.isFinite)) return null;
  return { position: fittedPosition, target: center, distance };
}
