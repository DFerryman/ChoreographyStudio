import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Matrix4, Quaternion, Vector3 } from 'three';
import { RIG_DEFINITIONS } from '../../../packages/core/src/humanoid';
import { JOINT_NAMES } from '../../../packages/core/src/motion-types';
import { STANDARD_HUMAN_PROFILE } from '../../../packages/core/src/humanProfile';

type Node = { name?: string; translation?: number[]; rotation?: number[]; scale?: number[]; matrix?: number[]; children?: number[]; mesh?: number; skin?: number };
type Accessor = { bufferView: number; byteOffset?: number; componentType: number; count: number; type: string; normalized?: boolean; sparse?: unknown };
type Document = {
  asset: { version: string; copyright?: string };
  nodes: Node[]; skins: { joints: number[]; inverseBindMatrices: number; skeleton?: number }[];
  meshes: { primitives: { attributes: Record<string, number>; indices: number; mode?: number }[] }[];
  accessors: Accessor[];
  bufferViews: { buffer: number; byteOffset?: number; byteLength: number; byteStride?: number; extensions?: unknown }[];
  buffers: { byteLength: number; uri?: string }[];
  images?: unknown[]; textures?: unknown[]; animations?: unknown[]; extensionsRequired?: string[];
};

/** Read the shipped bytes, not an exporter-created metrics sidecar. */
function readAsset(): { document: Document; bytes: Buffer; binary: DataView } {
  const bytes = readFileSync(new URL('../public/models/neutral-human.glb', import.meta.url));
  expect(bytes.readUInt32LE(0)).toBe(0x46546c67);
  expect(bytes.readUInt32LE(4)).toBe(2);
  expect(bytes.readUInt32LE(8)).toBe(bytes.length);
  let offset = 12, document: Document | undefined, binary: DataView | undefined;
  while (offset < bytes.length) {
    const length = bytes.readUInt32LE(offset), type = bytes.readUInt32LE(offset + 4);
    expect(length % 4).toBe(0);
    expect(offset + 8 + length).toBeLessThanOrEqual(bytes.length);
    if (type === 0x4e4f534a) { expect(document).toBeUndefined(); document = JSON.parse(bytes.subarray(offset + 8, offset + 8 + length).toString('utf8')) as Document; }
    else if (type === 0x004e4942) { expect(binary).toBeUndefined(); binary = new DataView(bytes.buffer, bytes.byteOffset + offset + 8, length); }
    else throw new Error('The shipped GLB has an unsupported chunk.');
    offset += 8 + length;
  }
  expect(offset).toBe(bytes.length);
  expect(document).toBeDefined(); expect(binary).toBeDefined();
  return { document: document!, bytes, binary: binary! };
}

function readAccessor(document: Document, binary: DataView, index: number): number[][] {
  const accessor = document.accessors[index], view = document.bufferViews[accessor.bufferView];
  expect(accessor.sparse).toBeUndefined(); expect(view.extensions).toBeUndefined(); expect(view.buffer).toBe(0);
  const sizes: Record<number, number> = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 };
  const components: Record<string, number> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };
  const size = sizes[accessor.componentType], count = components[accessor.type];
  expect(size).toBeDefined(); expect(count).toBeDefined(); expect(accessor.count).toBeGreaterThan(0);
  const stride = view.byteStride ?? size * count, start = (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
  expect(stride).toBeGreaterThanOrEqual(size * count);
  expect((view.byteOffset ?? 0) + view.byteLength).toBeLessThanOrEqual(binary.byteLength);
  expect(start + stride * (accessor.count - 1) + size * count).toBeLessThanOrEqual((view.byteOffset ?? 0) + view.byteLength);
  const read = (offset: number) => {
    let value: number;
    switch (accessor.componentType) {
      case 5120: value = binary.getInt8(offset); break;
      case 5121: value = binary.getUint8(offset); break;
      case 5122: value = binary.getInt16(offset, true); break;
      case 5123: value = binary.getUint16(offset, true); break;
      case 5125: value = binary.getUint32(offset, true); break;
      case 5126: return binary.getFloat32(offset, true);
      default: throw new Error('Unsupported GLB accessor component.');
    }
    if (!accessor.normalized) return value;
    return accessor.componentType === 5120 ? Math.max(-1, value / 127) : accessor.componentType === 5122 ? Math.max(-1, value / 32767) : value / (accessor.componentType === 5121 ? 255 : accessor.componentType === 5123 ? 65535 : 4294967295);
  };
  return Array.from({ length: accessor.count }, (_, item) => Array.from({ length: count }, (_, component) => read(start + item * stride + component * size)));
}

function nodeMatrix(node: Node): Matrix4 {
  return node.matrix ? new Matrix4().fromArray(node.matrix) : new Matrix4().compose(new Vector3(...(node.translation ?? [0, 0, 0])), new Quaternion(...(node.rotation ?? [0, 0, 0, 1])), new Vector3(...(node.scale ?? [1, 1, 1])));
}

describe('shipped neutral human GLB artifact', () => {
  it('is a bounded self-contained GLB with finite, indexed, normalized skinned geometry', () => {
    const { document, binary, bytes } = readAsset();
    expect(bytes.length).toBeLessThan(2 * 1024 * 1024);
    expect(document.asset.version).toBe('2.0');
    expect(document.asset.copyright).toMatch(/CC0/);
    expect(document.buffers).toHaveLength(1);
    expect(document.buffers[0].uri).toBeUndefined();
    expect(document.buffers[0].byteLength).toBeLessThanOrEqual(binary.byteLength);
    expect(binary.byteLength - document.buffers[0].byteLength).toBeLessThan(4);
    expect(document.images ?? []).toEqual([]); expect(document.textures ?? []).toEqual([]);
    expect(document.animations ?? []).toEqual([]); expect(document.extensionsRequired ?? []).toEqual([]);
    expect(JSON.stringify(document)).not.toMatch(/"uri"\s*:|OPENAI_API_KEY|CLOUDFLARE_API_TOKEN|file:\/\/|sediment:\/\//i);
    expect(document.meshes.length).toBeGreaterThan(0);
    let triangles = 0;
    for (const mesh of document.meshes) for (const primitive of mesh.primitives) {
      expect(primitive.mode ?? 4).toBe(4);
      const positions = readAccessor(document, binary, primitive.attributes.POSITION), normals = readAccessor(document, binary, primitive.attributes.NORMAL);
      const joints = readAccessor(document, binary, primitive.attributes.JOINTS_0), weights = readAccessor(document, binary, primitive.attributes.WEIGHTS_0);
      const indices = readAccessor(document, binary, primitive.indices).flat();
      expect(positions.length).toBeGreaterThan(1000);
      expect(normals.length).toBe(positions.length); expect(joints.length).toBe(positions.length); expect(weights.length).toBe(positions.length);
      expect(primitive.attributes.JOINTS_1).toBeUndefined(); expect(primitive.attributes.WEIGHTS_1).toBeUndefined();
      expect(indices.length % 3).toBe(0); triangles += indices.length / 3;
      expect(indices.every(index => Number.isInteger(index) && index >= 0 && index < positions.length)).toBe(true);
      let degenerateTriangles = 0;
      for (let index = 0; index < indices.length; index += 3) {
        const a = positions[indices[index]], b = positions[indices[index + 1]], c = positions[indices[index + 2]];
        const edgeA = new Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]), edgeB = new Vector3(c[0] - a[0], c[1] - a[1], c[2] - a[2]);
        if (edgeA.cross(edgeB).lengthSq() <= 1e-24) degenerateTriangles++;
      }
      expect(degenerateTriangles).toBe(0);
      expect(positions.every(position => position.length === 3 && position.every(Number.isFinite))).toBe(true);
      expect(normals.every(normal => normal.length === 3 && normal.every(Number.isFinite) && Math.abs(Math.hypot(...normal) - 1) < 2e-4)).toBe(true);
      expect(joints.every(influences => influences.length === 4 && influences.every(joint => Number.isInteger(joint) && joint >= 0 && joint < 25))).toBe(true);
      expect(weights.every(influences => influences.length === 4 && influences.every(weight => Number.isFinite(weight) && weight >= 0 && weight <= 1) && Math.abs(influences.reduce((sum, weight) => sum + weight, 0) - 1) < 2e-5)).toBe(true);
    }
    expect(triangles).toBeGreaterThan(10000); expect(triangles).toBeLessThanOrEqual(25000);
  });

  it('matches all canonical joints, local frames and inverse bind matrices without rest deformation', () => {
    const { document, binary } = readAsset();
    expect(document.skins).toHaveLength(1);
    const skin = document.skins[0]; expect(skin.joints).toHaveLength(25); expect(new Set(skin.joints).size).toBe(25);
    expect(skin.joints.map(index => document.nodes[index].name).sort()).toEqual([...JOINT_NAMES].sort());
    const parents = new Map<number, number>();
    document.nodes.forEach((node, index) => node.children?.forEach(child => { expect(parents.has(child)).toBe(false); parents.set(child, index); }));
    const worldMatrix = (index: number): Matrix4 => {
      const parent = parents.get(index), local = nodeMatrix(document.nodes[index]);
      return parent === undefined ? local : worldMatrix(parent).multiply(local);
    };
    const inverseBinds = readAccessor(document, binary, skin.inverseBindMatrices); expect(inverseBinds).toHaveLength(25);
    for (const definition of RIG_DEFINITIONS) {
      const index = skin.joints.find(index => document.nodes[index].name === definition.name)!;
      const node = document.nodes[index], parent = parents.get(index);
      expect(parent === undefined ? null : document.nodes[parent].name).toBe(definition.parent);
      expect(node.translation ?? [0, 0, 0]).toEqual([...definition.offset]);
      expect(node.rotation ?? [0, 0, 0, 1]).toEqual([0, 0, 0, 1]); expect(node.scale ?? [1, 1, 1]).toEqual([1, 1, 1]);
      const inverse = new Matrix4().fromArray(inverseBinds[skin.joints.indexOf(index)]);
      expect(inverse.elements.every(Number.isFinite)).toBe(true);
      const product = worldMatrix(index).multiply(inverse);
      expect(product.elements.every((value, component) => Math.abs(value - new Matrix4().elements[component]) < 1e-6)).toBe(true);
    }
    for (const node of document.nodes.filter(node => node.mesh !== undefined)) {
      expect(node.skin).toBe(0);
      expect(nodeMatrix(node).elements).toEqual(new Matrix4().elements);
    }
  });

  it('keeps the actual mesh height and weighted foot soles aligned with the built-in physical profile', () => {
    const { document, binary } = readAsset();
    const primitive = document.meshes[0].primitives[0], skin = document.skins[0];
    const positions = readAccessor(document, binary, primitive.attributes.POSITION), joints = readAccessor(document, binary, primitive.attributes.JOINTS_0), weights = readAccessor(document, binary, primitive.attributes.WEIGHTS_0);
    const minimumY = Math.min(...positions.map(p => p[1])), maximumY = Math.max(...positions.map(p => p[1]));
    expect(Math.abs(maximumY - minimumY - STANDARD_HUMAN_PROFILE.heightMeters)).toBeLessThan(.002);
    for (const side of ['Left', 'Right'] as const) {
      const definition = RIG_DEFINITIONS.find(joint => joint.name === `${side}Foot`)!;
      const skinIndex = skin.joints.findIndex(index => document.nodes[index].name === definition.name);
      const points = positions.filter((_, index) => joints[index].some((joint, influence) => joint === skinIndex && weights[index][influence] > .2));
      expect(points.length).toBeGreaterThan(100);
      const ankleY = -.05 - .46 - .45, ankleX = side === 'Left' ? .112 : -.112;
      expect(Math.abs(Math.min(...points.map(point => point[1])) - (ankleY - STANDARD_HUMAN_PROFILE.foot.soleOffsetMeters))).toBeLessThan(.001);
      expect(Math.min(...points.map(point => point[0]))).toBeGreaterThan(ankleX - STANDARD_HUMAN_PROFILE.foot.halfWidthMeters - .002);
      expect(Math.max(...points.map(point => point[0]))).toBeLessThan(ankleX + STANDARD_HUMAN_PROFILE.foot.halfWidthMeters + .002);
      expect(Math.abs(Math.min(...points.map(point => point[2])) - STANDARD_HUMAN_PROFILE.foot.heelZ)).toBeLessThan(.002);
      expect(Math.abs(Math.max(...points.map(point => point[2])) - STANDARD_HUMAN_PROFILE.foot.toeZ)).toBeLessThan(.002);
    }
  });
});
