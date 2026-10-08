import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Matrix4, Vector3 } from 'three';

type NativeDescriptor = {
  version: number; source: string; license: string; nativeJointCount: number; vertexCount: number;
  coordinateSystem: string; nativeSourceUnits: string; sourceRootOriginMeters: number[];
  nativeJointNames: string[]; nativeJointParents: number[]; nativePreRotationsXYZW: number[][];
  nativeOffsetsCentimeters: number[][]; nativeRestWorldMeters: number[][]; sourceBindWorld: number[][];
  correctiveAsset: string; correctiveUnits: string;
};
type Node = { name?: string; matrix?: number[]; children?: number[]; mesh?: number; skin?: number };
type Accessor = { bufferView: number; byteOffset?: number; componentType: number; count: number; type: string; normalized?: boolean; sparse?: unknown; min?: number[]; max?: number[] };
type Document = {
  asset: { version: string; copyright?: string }; scene: number; scenes: { nodes: number[] }[];
  nodes: Node[]; skins: { joints: number[]; inverseBindMatrices: number; skeleton?: number }[];
  meshes: { primitives: { attributes: Record<string, number>; indices: number; mode?: number }[] }[];
  accessors: Accessor[]; bufferViews: { buffer: number; byteOffset?: number; byteLength: number; byteStride?: number; extensions?: unknown }[];
  buffers: { byteLength: number; uri?: string }[]; extras: { choreoMHR: NativeDescriptor };
  images?: unknown[]; textures?: unknown[]; animations?: unknown[]; extensionsRequired?: string[];
};
type ArtifactRecord = { name: string; bytes: number; sha256: string };
type Provenance = {
  sourceRelease: string; sourceAssets: ArtifactRecord[]; pymomentumLicense: string;
  output: ArtifactRecord & { vertices: number; triangles: number; joints: number; maxPositiveInfluences: number; discardedWeightMaximum: number; vertexOrder: string };
  descriptor: ArtifactRecord; correctives: ArtifactRecord; licenses: ArtifactRecord[]; metadata: NativeDescriptor;
};

const modelFile = (name: string) => new URL(`../public/models/${name}`, import.meta.url);
const sha256 = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex');

/** Source stream hashes were independently derived from the official native
 * FBX fixture, not from the exporter sidecar. They lock original vertex order,
 * topology and first-four weights; all four omitted native slots are zero. */
const SOURCE_STREAM_SHA256 = {
  POSITION: '4af45d00bc50384e9c19dd6a5dea6dbcd06979c8c15014d5b7e80aec094448b6',
  JOINTS_0: '60435ae18aaf1787dd8d47be6d061272d791ffc8d7873b0024a70b426391f44f',
  WEIGHTS_0: 'b324e6ba0edcb507cf5180fc258135bfa824724db2054fe00c332f3d0b2d80a4',
  indices: '3055db727f6298d2da13fc5a84f5dce0c80991008227ef2f042d01d407561be3',
};

function readAsset() {
  const bytes = readFileSync(modelFile('neutral-mhr-v1.glb'));
  expect(bytes.readUInt32LE(0)).toBe(0x46546c67);
  expect(bytes.readUInt32LE(4)).toBe(2);
  expect(bytes.readUInt32LE(8)).toBe(bytes.length);
  let offset = 12, document: Document | undefined, binary: DataView | undefined;
  while (offset < bytes.length) {
    const length = bytes.readUInt32LE(offset), type = bytes.readUInt32LE(offset + 4);
    expect(length % 4).toBe(0);
    expect(offset + 8 + length).toBeLessThanOrEqual(bytes.length);
    if (type === 0x4e4f534a) {
      expect(document).toBeUndefined(); expect(binary).toBeUndefined();
      document = JSON.parse(bytes.subarray(offset + 8, offset + 8 + length).toString('utf8')) as Document;
    } else if (type === 0x004e4942) {
      expect(document).toBeDefined(); expect(binary).toBeUndefined();
      binary = new DataView(bytes.buffer, bytes.byteOffset + offset + 8, length);
    } else throw new Error('Unsupported shipped MHR GLB chunk.');
    offset += 8 + length;
  }
  expect(offset).toBe(bytes.length); expect(document).toBeDefined(); expect(binary).toBeDefined();
  return { bytes, document: document!, binary: binary! };
}

function accessorData(document: Document, binary: DataView, index: number) {
  const accessor = document.accessors[index], view = document.bufferViews[accessor.bufferView];
  expect(accessor.sparse).toBeUndefined(); expect(accessor.normalized).not.toBe(true);
  expect(view.extensions).toBeUndefined(); expect(view.buffer).toBe(0);
  const sizes: Record<number, number> = { 5123: 2, 5125: 4, 5126: 4 };
  const components: Record<string, number> = { SCALAR: 1, VEC3: 3, VEC4: 4, MAT4: 16 };
  const size = sizes[accessor.componentType], width = components[accessor.type];
  expect(size).toBeDefined(); expect(width).toBeDefined();
  expect(Number.isInteger(accessor.count) && accessor.count > 0).toBe(true);
  expect(view.byteStride).toBeUndefined(); expect(accessor.byteOffset ?? 0).toBe(0);
  const start = view.byteOffset ?? 0;
  expect(view.byteLength).toBe(accessor.count * size * width);
  expect(start + view.byteLength).toBeLessThanOrEqual(binary.byteLength);
  const read = (offset: number) => accessor.componentType === 5126 ? binary.getFloat32(offset, true)
    : accessor.componentType === 5123 ? binary.getUint16(offset, true) : binary.getUint32(offset, true);
  return {
    raw: new Uint8Array(binary.buffer, binary.byteOffset + start, view.byteLength),
    rows: Array.from({ length: accessor.count }, (_, row) => Array.from({ length: width }, (_, column) => read(start + (row * width + column) * size))),
  };
}

function restTransforms(document: Document) {
  const skin = document.skins[0], parents = new Map<number, number>();
  for (const [index, node] of document.nodes.entries()) for (const child of node.children ?? []) {
    expect(Number.isInteger(child) && child >= 0 && child < document.nodes.length).toBe(true);
    expect(parents.has(child)).toBe(false); parents.set(child, index);
  }
  const worlds: Matrix4[] = [];
  for (const nodeIndex of skin.joints) {
    const node = document.nodes[nodeIndex];
    expect(node.matrix).toHaveLength(16); expect(node.matrix!.every(Number.isFinite)).toBe(true);
    const parent = parents.get(nodeIndex), local = new Matrix4().fromArray(node.matrix!);
    expect([local.elements[3], local.elements[7], local.elements[11], local.elements[15]]).toEqual([0, 0, 0, 1]);
    expect(Math.abs(local.determinant() - 1)).toBeLessThan(1e-6);
    if (parent !== undefined) expect(parent).toBeLessThan(nodeIndex);
    worlds[nodeIndex] = parent === undefined ? local : worlds[parent].clone().multiply(local);
  }
  return { parents, worlds };
}

describe('shipped native MHR asset and provenance', () => {
  it('contains bounded self-contained finite geometry on the original native topology', () => {
    const { document, binary, bytes } = readAsset();
    expect(bytes.length).toBeLessThan(1024 * 1024);
    expect(document.asset.version).toBe('2.0'); expect(document.asset.copyright).toMatch(/Apache-2\.0/);
    expect(document.buffers).toHaveLength(1); expect(document.buffers[0].uri).toBeUndefined();
    expect(binary.byteLength - document.buffers[0].byteLength).toBeGreaterThanOrEqual(0);
    expect(binary.byteLength - document.buffers[0].byteLength).toBeLessThan(4);
    expect(document.images ?? []).toEqual([]); expect(document.textures ?? []).toEqual([]);
    expect(document.animations ?? []).toEqual([]); expect(document.extensionsRequired ?? []).toEqual([]);
    expect(JSON.stringify(document)).not.toMatch(/"uri"\s*:|OPENAI_API_KEY|CLOUDFLARE_API_TOKEN|file:\/\/|sediment:\/\//i);
    expect(document.meshes).toHaveLength(1); expect(document.meshes[0].primitives).toHaveLength(1);
    const primitive = document.meshes[0].primitives[0]; expect(primitive.mode ?? 4).toBe(4);
    expect(Object.keys(primitive.attributes).sort()).toEqual(['JOINTS_0', 'NORMAL', 'POSITION', 'WEIGHTS_0']);
    const positions = accessorData(document, binary, primitive.attributes.POSITION).rows;
    const normals = accessorData(document, binary, primitive.attributes.NORMAL).rows;
    const indices = accessorData(document, binary, primitive.indices).rows.flat();
    expect(positions).toHaveLength(4899); expect(normals).toHaveLength(4899); expect(indices).toHaveLength(9794 * 3);
    expect(positions.every(row => row.length === 3 && row.every(Number.isFinite))).toBe(true);
    expect(normals.every(row => row.length === 3 && row.every(Number.isFinite) && Math.abs(Math.hypot(...row) - 1) < 2e-7)).toBe(true);
    expect(indices.every(index => Number.isInteger(index) && index >= 0 && index < positions.length)).toBe(true);
    let degenerateTriangles = 0;
    for (let triangle = 0; triangle < indices.length; triangle += 3) {
      const a = new Vector3().fromArray(positions[indices[triangle]]);
      const b = new Vector3().fromArray(positions[indices[triangle + 1]]).sub(a);
      const c = new Vector3().fromArray(positions[indices[triangle + 2]]).sub(a);
      if (b.cross(c).lengthSq() < 1e-24) degenerateTriangles++;
    }
    expect(degenerateTriangles).toBe(0);
    const accessor = document.accessors[primitive.attributes.POSITION];
    for (let axis = 0; axis < 3; axis++) {
      expect(Math.min(...positions.map(point => point[axis]))).toBe(accessor.min![axis]);
      expect(Math.max(...positions.map(point => point[axis]))).toBe(accessor.max![axis]);
    }
  });

  it('preserves original vertex order, faces and all positive source skin weights bit-for-bit', () => {
    const { document, binary } = readAsset(), primitive = document.meshes[0].primitives[0];
    for (const [name, expected] of Object.entries(SOURCE_STREAM_SHA256)) {
      const accessor = name === 'indices' ? primitive.indices : primitive.attributes[name];
      expect(sha256(accessorData(document, binary, accessor).raw)).toBe(expected);
    }
    const joints = accessorData(document, binary, primitive.attributes.JOINTS_0).rows;
    const weights = accessorData(document, binary, primitive.attributes.WEIGHTS_0).rows;
    expect(joints).toHaveLength(4899); expect(weights).toHaveLength(4899);
    expect(joints.every(row => row.length === 4 && row.every(joint => Number.isInteger(joint) && joint >= 0 && joint < 127))).toBe(true);
    expect(weights.every(row => row.length === 4 && row.every(weight => Number.isFinite(weight) && weight >= 0 && weight <= 1)
      && Math.abs(row.reduce((sum, weight) => sum + weight, 0) - 1) < 2e-6)).toBe(true);
    expect(Math.max(...weights.map(row => row.filter(weight => weight > 0).length))).toBe(4);
  });

  it('retains all 127 native names, parent frames and inverse binds independently of author calibration', () => {
    const { document, binary } = readAsset(), descriptor = document.extras.choreoMHR;
    const sidecar = JSON.parse(readFileSync(modelFile('neutral-mhr-v1.json'), 'utf8')) as NativeDescriptor;
    expect(document.skins).toHaveLength(1); const skin = document.skins[0];
    expect(skin.joints).toEqual(Array.from({ length: 127 }, (_, index) => index)); expect(skin.skeleton).toBe(0);
    expect(new Set(skin.joints.map(index => document.nodes[index].name)).size).toBe(127);
    expect(descriptor.nativeJointCount).toBe(127); expect(descriptor.vertexCount).toBe(4899);
    expect(descriptor.nativeJointNames).toEqual(skin.joints.map(index => document.nodes[index].name));
    expect(sha256(JSON.stringify(descriptor.nativeJointNames))).toBe('672098f8bbe32323d8b8ca878247ad489aa48a5db866769f82ec6134cf400ce7');
    expect(sha256(JSON.stringify(descriptor.nativeJointParents))).toBe('46ebaa1f3e9fc2b026611d597678b4471a3ccae6e593066f6ded381a4afc5225');
    for (const key of ['nativeJointNames', 'nativeJointParents', 'nativePreRotationsXYZW', 'nativeOffsetsCentimeters', 'nativeRestWorldMeters', 'sourceBindWorld'] as const) {
      expect(descriptor[key]).toHaveLength(127); expect(sidecar[key]).toEqual(descriptor[key]);
    }
    expect(descriptor.nativeOffsetsCentimeters.every(row => row.length === 3 && row.every(Number.isFinite))).toBe(true);
    expect(descriptor.nativePreRotationsXYZW.every(row => row.length === 4 && row.every(Number.isFinite) && Math.abs(Math.hypot(...row) - 1) < 2e-7)).toBe(true);
    const { parents, worlds } = restTransforms(document);
    const inverseBinds = accessorData(document, binary, skin.inverseBindMatrices).rows;
    expect(inverseBinds).toHaveLength(127);
    for (const index of skin.joints) {
      expect(parents.get(index) ?? -1).toBe(descriptor.nativeJointParents[index]);
      expect(worlds[index].elements.every((value, component) => Math.abs(value - descriptor.sourceBindWorld[index][component]) < 1e-10)).toBe(true);
      expect(new Vector3().setFromMatrixPosition(worlds[index]).distanceTo(new Vector3().fromArray(descriptor.nativeRestWorldMeters[index]))).toBeLessThan(1e-10);
      expect(inverseBinds[index].every(Number.isFinite)).toBe(true);
      const product = worlds[index].clone().multiply(new Matrix4().fromArray(inverseBinds[index]));
      expect(product.elements.every((value, component) => Math.abs(value - new Matrix4().elements[component]) < 1e-6)).toBe(true);
    }
    const meshNodes = document.nodes.filter(node => node.mesh !== undefined); expect(meshNodes).toHaveLength(1);
    expect(meshNodes[0].skin).toBe(0); expect(meshNodes[0].matrix ?? new Matrix4().elements).toEqual(new Matrix4().elements);
    expect(document.scenes[document.scene].nodes).toEqual([0, 127]);
  });

  it('does not deform any of the original vertices at the native rest pose', () => {
    const { document, binary } = readAsset(), primitive = document.meshes[0].primitives[0];
    const positions = accessorData(document, binary, primitive.attributes.POSITION).rows;
    const joints = accessorData(document, binary, primitive.attributes.JOINTS_0).rows;
    const weights = accessorData(document, binary, primitive.attributes.WEIGHTS_0).rows;
    const { worlds } = restTransforms(document);
    const matrices = accessorData(document, binary, document.skins[0].inverseBindMatrices).rows
      .map((inverse, index) => worlds[index].clone().multiply(new Matrix4().fromArray(inverse)));
    let maximumError = 0;
    for (const [index, position] of positions.entries()) {
      const point = new Vector3().fromArray(position), skinned = new Vector3();
      for (let influence = 0; influence < 4; influence++) skinned.addScaledVector(point.clone().applyMatrix4(matrices[joints[index][influence]]), weights[index][influence]);
      maximumError = Math.max(maximumError, skinned.distanceTo(point));
    }
    expect(maximumError).toBeLessThan(1e-6);
  });

  it('retains exact licenses and the complete bounded native corrective payload', () => {
    const { document } = readAsset(), descriptor = document.extras.choreoMHR;
    expect(descriptor.version).toBe(1); expect(descriptor.source).toMatch(/^MHR\s?v1\.0\.1 LOD3$/);
    expect(descriptor.license).toBe('Apache-2.0'); expect(descriptor.nativeSourceUnits).toBe('centimeters');
    expect(descriptor.coordinateSystem).toBe('right-handed Y-up +Zfront meters');
    expect(descriptor.sourceRootOriginMeters).toEqual([0, 0.9239869689941407, 0]);
    expect(descriptor.correctiveUnits).toBe('native centimeters'); expect(descriptor.correctiveAsset).toBe('neutral-mhr-correctives-v1.bin');
    const license = readFileSync(modelFile('MHR-LICENSE.txt'));
    expect(license.length).toBe(11358); expect(sha256(license)).toBe('cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30');
    expect(license.toString('utf8')).toMatch(/Apache License[\s\S]*Version 2\.0/);
    const momentumLicense = readFileSync(modelFile('MOMENTUM-MIT.txt'));
    expect(momentumLicense.length).toBe(1088); expect(sha256(momentumLicense)).toBe('da6d3703ed11cbe42bd212c725957c98da23cbff1998c05fa4b3d976d1a58e93');
    expect(momentumLicense.toString('utf8')).toMatch(/MIT License[\s\S]*Meta Platforms/);
    const correctives = readFileSync(modelFile(descriptor.correctiveAsset));
    expect(correctives.length).toBe(9587356); expect(correctives.length).toBeLessThan(10 * 1024 * 1024);
    expect(sha256(correctives)).toBe('b09418f280a379c4f4a3fb72f4c8b909a6339a5fd1c7ed5513f3b8a17b947bde');
    expect(correctives.subarray(0, 8).toString('ascii')).toBe('MHRCORR1');
    expect(Array.from({ length: 6 }, (_, index) => correctives.readUInt32LE(8 + index * 4))).toEqual([1, 750, 3000, 4899, 53136, 1532952]);
  });

  it('pins the official source checksums and matches every shipped provenance record to actual bytes', () => {
    const bytes = readFileSync(modelFile('MHR-PROVENANCE.json'));
    expect(bytes.length).toBeLessThan(1024 * 1024);
    const manifest = JSON.parse(bytes.toString('utf8')) as Provenance;
    expect(manifest.sourceRelease).toBe('https://github.com/facebookresearch/MHR/releases/download/v1.0.1/assets.zip');
    expect(manifest.pymomentumLicense).toBe('MIT');
    expect(manifest.sourceAssets).toEqual([
      { name: 'lod3.fbx', bytes: 2181136, sha256: '5d5fe30ba09488e96a06b2fe6306202c4048083df9e1003f1051ad541e06aafa' },
      { name: 'compact_v6_1.model', bytes: 31179, sha256: '9b4e48e6216296c0a8a47e8e1d210b42ca8b194b9f61409adc5d7a3873dcf08e' },
      { name: 'corrective_activation.npz', bytes: 3313540, sha256: '08cce62c1aed80c0ae2a87580c0e7b73b7a1efea56daa0cec25dbed5917e4909' },
      { name: 'corrective_blendshapes_lod3.npz', bytes: 176364298, sha256: '7aae0b02b6b53aa39fa7bfeef954e634d0b928b66189e2b472227573a0447bee' },
      { name: 'LICENSE.txt', bytes: 11358, sha256: 'cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30' },
    ]);
    const artifacts = [manifest.output, manifest.descriptor, manifest.correctives, ...manifest.licenses];
    expect(artifacts.map(record => record.name).sort()).toEqual([
      'MHR-LICENSE.txt', 'MOMENTUM-MIT.txt', 'neutral-mhr-correctives-v1.bin', 'neutral-mhr-v1.glb', 'neutral-mhr-v1.json',
    ].sort());
    for (const record of artifacts) {
      expect(record.sha256).toMatch(/^[a-f0-9]{64}$/);
      const actual = readFileSync(modelFile(record.name));
      expect(actual.length).toBe(record.bytes); expect(sha256(actual)).toBe(record.sha256);
    }
    expect(manifest.output.vertices).toBe(4899); expect(manifest.output.triangles).toBe(9794); expect(manifest.output.joints).toBe(127);
    expect(manifest.output.maxPositiveInfluences).toBe(4); expect(manifest.output.discardedWeightMaximum).toBe(0);
    expect(manifest.output.vertexOrder).toBe('unaltered');
    const { document } = readAsset();
    expect(manifest.metadata).toEqual(document.extras.choreoMHR);
    expect(JSON.parse(readFileSync(modelFile(manifest.descriptor.name), 'utf8'))).toEqual(document.extras.choreoMHR);
    expect(bytes.toString('utf8')).not.toMatch(/OPENAI_API_KEY|CLOUDFLARE_API_TOKEN|file:\/\/|sediment:\/\//i);
  });
});
