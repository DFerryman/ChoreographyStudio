/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 * Licensed under the Apache License, Version 2.0.
 * https://www.apache.org/licenses/LICENSE-2.0
 * Adaptation of facebookresearch/MHR mhr.py, io.py and utils.py.
 *
 * Browser evaluation of Meta MHR's published pose
 * correctives, not a choreography generator. Mirrors mhr.py/io.py/utils.py:
 * native parameter rotation 6D -> sparse linear -> ReLU -> sparse directions.
 * No network, WebGPU, hidden inference service, or mutable animation channels.
 */
export const MHR_CORRECTIVES_ASSET_URL = '/models/neutral-mhr-correctives-v1.bin';
export const MHR_CORRECTIVES_MAX_BYTES = 25 * 1024 * 1024;

/** Input is 127 native MHR parameter-delta XYZW quaternions, not bone bind frames. */
export function featuresFromParameterQuaternions(quaternions: ArrayLike<number>, target: Float32Array = new Float32Array(750)): Float32Array {
  if (quaternions.length !== 127 * 4 || target.length !== 750) throw new Error('MHR requires 127 native parameter quaternions and 750 features.');
  for (let joint = 2; joint < 127; joint++) {
    const qi = joint * 4, fi = (joint - 2) * 6;
    let x = quaternions[qi], y = quaternions[qi + 1], z = quaternions[qi + 2], w = quaternions[qi + 3];
    if (![x, y, z, w].every(Number.isFinite)) throw new Error('MHR parameter quaternion must be finite.');
    const norm = Math.hypot(x, y, z, w);
    if (!Number.isFinite(norm) || norm < 1e-12) throw new Error('MHR parameter quaternion must be nonzero.');
    x /= norm; y /= norm; z /= norm; w /= norm;
    // The first two columns of native Rz*Ry*Rx, minus identity. This directly
    // encodes the same rotation and avoids an Euler branch/gimbal conversion.
    target[fi] = -2 * (y * y + z * z);
    target[fi + 1] = 2 * (x * y + z * w);
    target[fi + 2] = 2 * (x * z - y * w);
    target[fi + 3] = 2 * (x * y - z * w);
    target[fi + 4] = -2 * (x * x + z * z);
    target[fi + 5] = 2 * (y * z + x * w);
  }
  return target;
}

export class MHRPoseCorrectives {
  readonly vertexCount = 4899;
  readonly outputLength = 4899 * 3;
  private readonly activationOffsets: Uint32Array;
  private readonly activationColumns: Uint16Array;
  private readonly activationWeights: Float32Array;
  private readonly directionOffsets: Uint32Array;
  private readonly directionColumns: Uint16Array;
  private readonly directionWeights: Float32Array;
  private readonly hidden = new Float32Array(3000);
  private readonly features = new Float32Array(750);

  constructor(buffer: ArrayBuffer) {
    if (!(buffer instanceof ArrayBuffer) || buffer.byteLength < 32 || buffer.byteLength > MHR_CORRECTIVES_MAX_BYTES) throw new Error('Invalid MHR correctives payload.');
    const bytes = new Uint8Array(buffer), view = new DataView(buffer);
    if (String.fromCharCode(...bytes.subarray(0, 8)) !== 'MHRCORR1') throw new Error('Invalid MHR correctives signature.');
    const dims = Array.from({ length: 6 }, (_, i) => view.getUint32(8 + i * 4, true));
    const [version, features, hidden, vertices, activationNonzero, directionNonzero] = dims;
    if (version !== 1 || features !== 750 || hidden !== 3000 || vertices !== 4899 || activationNonzero !== 53136 || directionNonzero !== 1532952) throw new Error('Unsupported MHR correctives dimensions.');
    let offset = 32;
    const section = <T extends Uint32Array | Uint16Array | Float32Array>(
      Constructor: { new(buffer: ArrayBuffer, byteOffset: number, length: number): T; BYTES_PER_ELEMENT: number }, count: number,
    ): T => {
      const byteLength = count * Constructor.BYTES_PER_ELEMENT;
      if (!Number.isSafeInteger(byteLength) || offset + byteLength > buffer.byteLength) throw new Error('Truncated MHR correctives payload.');
      const result = new Constructor(buffer, offset, count);
      offset += byteLength; offset += (4 - offset % 4) % 4;
      return result;
    };
    this.activationOffsets = section(Uint32Array, hidden + 1);
    this.activationColumns = section(Uint16Array, activationNonzero);
    this.activationWeights = section(Float32Array, activationNonzero);
    this.directionOffsets = section(Uint32Array, vertices * 3 + 1);
    this.directionColumns = section(Uint16Array, directionNonzero);
    this.directionWeights = section(Float32Array, directionNonzero);
    if (offset !== buffer.byteLength) throw new Error('Unexpected MHR correctives trailing payload.');
    const validate = (offsets: Uint32Array, columns: Uint16Array, weights: Float32Array, inputCount: number) => {
      if (offsets[0] !== 0 || offsets[offsets.length - 1] !== columns.length) throw new Error('Invalid MHR sparse row bounds.');
      for (let row = 1; row < offsets.length; row++) if (offsets[row] < offsets[row - 1] || offsets[row] > columns.length) throw new Error('Invalid MHR sparse row order.');
      for (let i = 0; i < columns.length; i++) if (columns[i] >= inputCount || !Number.isFinite(weights[i])) throw new Error('Invalid MHR sparse values.');
    };
    validate(this.activationOffsets, this.activationColumns, this.activationWeights, features);
    validate(this.directionOffsets, this.directionColumns, this.directionWeights, hidden);

  }

  /** Return native centimetre offsets in original MHR vertex order, before LBS. */
  evaluate(features: ArrayLike<number>, output: Float32Array = new Float32Array(this.outputLength)): Float32Array {
    if (features.length !== 750 || output.length !== this.outputLength) throw new Error('Invalid MHR feature/output dimensions.');
    for (let i = 0; i < features.length; i++) if (!Number.isFinite(features[i]) || Math.abs(features[i]) > 2.000002) throw new Error('MHR rotation features must be finite rotation entries.');
    const ao = this.activationOffsets, ac = this.activationColumns, aw = this.activationWeights, hidden = this.hidden;
    for (let row = 0; row < hidden.length; row++) {
      let value = 0;
      for (let i = ao[row]; i < ao[row + 1]; i++) value += aw[i] * features[ac[i]];
      if (!Number.isFinite(value) || value > 3.4028234663852886e38) throw new Error('MHR corrective activation overflow.');
      hidden[row] = Math.max(0, value);
    }
    const directions = this.directionOffsets, dc = this.directionColumns, dw = this.directionWeights;
    for (let row = 0; row < output.length; row++) {
      let value = 0;
      for (let i = directions[row]; i < directions[row + 1]; i++) value += dw[i] * hidden[dc[i]];
      if (!Number.isFinite(value) || Math.abs(value) > 3.4028234663852886e38) throw new Error('MHR corrective output overflow.');
      output[row] = value;
    }
    return output;
  }

  evaluateQuaternions(quaternions: ArrayLike<number>, output?: Float32Array): Float32Array {
    featuresFromParameterQuaternions(quaternions, this.features);
    return this.evaluate(this.features, output);
  }
}
