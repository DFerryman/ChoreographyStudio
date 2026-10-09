#!/usr/bin/env python3
"""Independently check the web merge against the original official ZIP.

Does not import quaternius_prepare or the display adapter. It reads source
accessors with struct, checks every source array, and compares all vertices
under several independently evaluated native bone poses. Native stress poses
are skin/asset references, not claims of feasible human choreography.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import struct
import zipfile
from pathlib import Path

import numpy as np


def digest(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()


def read_array(doc: dict, binary: bytes, index: int) -> tuple[np.ndarray, bytes]:
    spec = doc['accessors'][index]
    view = doc['bufferViews'][spec['bufferView']]
    kinds = {5121: ('B', 1), 5123: ('H', 2), 5125: ('I', 4), 5126: ('f', 4)}
    code, size = kinds[spec['componentType']]
    count = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4, 'MAT4': 16}[spec['type']]
    start = view.get('byteOffset', 0) + spec.get('byteOffset', 0)
    step = view.get('byteStride', size * count)
    rows = [binary[start+i*step:start+i*step+size*count] for i in range(spec['count'])]
    return np.asarray([struct.unpack('<' + code*count, row) for row in rows]), b''.join(rows)


def quaternion_product(a: np.ndarray, b: np.ndarray) -> np.ndarray:
    av, aw, bv, bw = a[:3], a[3], b[:3], b[3]
    return np.r_[aw*bv + bw*av + np.cross(av, bv), aw*bw - av.dot(bv)]


def node_matrix(node: dict, delta: np.ndarray | None = None) -> np.ndarray:
    if 'matrix' in node:
        if delta is not None:
            raise ValueError('Reference delta needs a source quaternion frame')
        return np.asarray(node['matrix']).reshape(4, 4).T
    q = np.asarray(node.get('rotation', [0, 0, 0, 1]), dtype=float)
    if delta is not None:
        q = quaternion_product(q, delta)
    v, w = q[:3], q[3]
    cross = np.array([[0, -v[2], v[1]], [v[2], 0, -v[0]], [-v[1], v[0], 0]])
    result = np.eye(4)
    result[:3, :3] = (np.eye(3) + 2*w*cross + 2*(cross @ cross)) @ np.diag(node.get('scale', [1, 1, 1]))
    result[:3, 3] = node.get('translation', [0, 0, 0])
    return result


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source-zip', required=True, type=Path)
    parser.add_argument('--merged-glb', required=True, type=Path)
    parser.add_argument('--rig-json', required=True, type=Path)
    parser.add_argument('--output', required=True, type=Path)
    parser.add_argument('--provenance', type=Path, help='Optionally associate the verified reference with preparation provenance')
    args = parser.parse_args()
    archive_bytes = args.source_zip.read_bytes()
    if digest(archive_bytes) != 'fdbf1804c90dfc1ea03e992bff7da2dfd1a79318e13270a660180f9308455f40':
        raise ValueError('Reference requires the original verified free Standard archive')
    with zipfile.ZipFile(args.source_zip) as archive:
        prefix = 'Universal Base Characters[Standard]/Base Characters/Godot - UE/'
        source_raw = archive.read(prefix + 'Superhero_Male_FullBody.gltf')
        source = json.loads(source_raw)
        source_binary = archive.read(prefix + source['buffers'][0]['uri'])
    glb = args.merged_glb.read_bytes()
    if struct.unpack_from('<III', glb) != (0x46546c67, 2, len(glb)):
        raise ValueError('Invalid merged GLB header')
    json_size, json_kind = struct.unpack_from('<II', glb, 12)
    if json_kind != 0x4e4f534a:
        raise ValueError('Expected JSON chunk first')
    merged = json.loads(glb[20:20+json_size])
    binary_size, binary_kind = struct.unpack_from('<II', glb, 20+json_size)
    if binary_kind != 0x004e4942:
        raise ValueError('Expected BIN chunk')
    merged_binary = glb[28+json_size:28+json_size+binary_size]
    rig = json.loads(args.rig_json.read_bytes())
    skin = source['skins'][0]
    joints = skin['joints']
    if merged['skins'][0]['joints'] != joints or merged['nodes'][:65] != source['nodes'][:65]:
        raise ValueError('Merged asset altered native bone order, hierarchy or TRS')
    inverses, inverse_raw = read_array(source, source_binary, skin['inverseBindMatrices'])
    output_inverses, output_inverse_raw = read_array(merged, merged_binary, merged['skins'][0]['inverseBindMatrices'])
    if inverse_raw != output_inverse_raw:
        raise ValueError('Merged inverse binds differ from official source')
    primitive = merged['meshes'][0]['primitives'][0]
    keys = ['POSITION', 'NORMAL', 'JOINTS_0', 'WEIGHTS_0']
    output_arrays = {key: read_array(merged, merged_binary, primitive['attributes'][key]) for key in keys}
    output_indices, _ = read_array(merged, merged_binary, primitive['indices'])
    segments = []
    source_arrays = {key: [] for key in keys}
    vstart = 0
    istart = 0
    for index, mesh in enumerate(source['meshes']):
        original = mesh['primitives'][0]
        arrays = {key: read_array(source, source_binary, original['attributes'][key]) for key in keys}
        count = len(arrays['POSITION'][0])
        local_indices, local_index_raw = read_array(source, source_binary, original['indices'])
        for key, (array, raw) in arrays.items():
            out_spec = merged['accessors'][primitive['attributes'][key]]
            item_bytes = len(output_arrays[key][1]) // out_spec['count']
            if raw != output_arrays[key][1][vstart*item_bytes:(vstart+count)*item_bytes]:
                raise ValueError('Source array changed for surface ' + str(index) + ': ' + key)
            source_arrays[key].append(array)
        if not np.array_equal(output_indices[istart:istart+len(local_indices), 0]-vstart, local_indices[:, 0]):
            raise ValueError('Source triangle topology changed')
        segments.append({'sourceMeshIndex': index, 'sourceMeshName': mesh['name'], 'vertexStart': vstart,
                         'vertexCount': count, 'indexStart': istart, 'indexCount': len(local_indices),
                         'nativeArraySha256': {key: digest(raw) for key, (_, raw) in arrays.items()},
                         'nativeIndexSha256': digest(local_index_raw), 'allNativeArraysBitExact': True})
        vstart += count
        istart += len(local_indices)
    names = [source['nodes'][i]['name'] for i in joints]
    parent = {child: i for i, node in enumerate(source['nodes']) for child in node.get('children', [])}

    def posed_world(deltas: dict[str, np.ndarray]) -> np.ndarray:
        computed = {}

        def visit(node: int) -> np.ndarray:
            if node not in computed:
                local = node_matrix(source['nodes'][node], deltas.get(source['nodes'][node].get('name')))
                computed[node] = visit(parent[node]) @ local if node in parent else local
            return computed[node]

        return np.asarray([visit(node) for node in joints])

    bind = posed_world({})
    maximum_bind_delta = float(np.abs(bind.transpose(0, 2, 1).reshape(-1, 16)-rig['sourceBindWorld']).max())
    if maximum_bind_delta > 1e-12 or not np.array_equal(inverses, rig['sourceInverseBindWorld']):
        raise ValueError('Source rig sidecar differs from independent source computation')
    inv_matrices = inverses.reshape(-1, 4, 4).transpose(0, 2, 1)
    arrays = {key: np.concatenate(value) for key, value in source_arrays.items()}
    points = np.c_[arrays['POSITION'], np.ones(vstart)]
    joint_indices = arrays['JOINTS_0'].astype(int)
    weights = arrays['WEIGHTS_0']

    def native_skin(worlds: np.ndarray, p: np.ndarray, ji: np.ndarray, sw: np.ndarray) -> np.ndarray:
        matrices = (worlds @ inv_matrices)[ji]
        return (np.einsum('vkij,vj->vki', matrices, p) * sw[:, :, None]).sum(1)[:, :3]

    def around(axis: int, degrees: float) -> np.ndarray:
        q = np.zeros(4)
        q[axis] = math.sin(math.radians(degrees)/2)
        q[3] = math.cos(math.radians(degrees)/2)
        return q

    # Native local deltas deliberately exercise several hierarchy branches.
    # They are not canonical25 angles, medically feasible poses, or a release
    # substitute for real browser draft/K/playback verification.
    poses = {'native-neutral': {}, 'native-upperarm-z150': {'upperarm_l': around(2, 150)},
             'native-upperarm-z170': {'upperarm_l': around(2, 170)},
             'native-arm-z120-elbow-x100': {'upperarm_l': around(2, 120), 'lowerarm_l': around(0, 100)},
             'native-thigh-x55-knee-x110': {'thigh_l': around(0, 55), 'calf_l': around(0, 110)}}
    sample_ids = np.unique(np.r_[np.linspace(0, vstart-1, 40).astype(int), 646, 1202, vstart-1]).tolist()
    original_neutral = native_skin(bind, points, joint_indices, weights)
    output_points = np.c_[output_arrays['POSITION'][0], np.ones(vstart)]
    references = []
    for name, deltas in poses.items():
        world = posed_world(deltas)
        reference = native_skin(world, points, joint_indices, weights)
        actual = native_skin(world, output_points, output_arrays['JOINTS_0'][0].astype(int), output_arrays['WEIGHTS_0'][0])
        error = float(np.linalg.norm(reference-actual, axis=1).max())
        if error > .000002:
            raise ValueError('Merged native skin parity exceeds 2 micrometers')
        references.append({'name': name, 'nativeLocalDeltaQuaternions': {key: q.tolist() for key, q in deltas.items()},
                           'maximumSourceMergedPointErrorMeters': error,
                           'selectedSourceWorldPoints': reference[sample_ids].tolist(),
                           'selectedSourceMotionVectors': (reference-original_neutral)[sample_ids].tolist()})
    result = {'schema': 'quaternius-source-reference-1', 'method': 'Independent struct reader of original official ZIP; native hierarchical matrices and weighted LBS; no runtime adapter imports',
              'sourceZipSha256': digest(archive_bytes), 'sourceGltfSha256': digest(source_raw),
              'sourceBinSha256': digest(source_binary), 'mergedGlbSha256': digest(glb),
              'rigJsonSha256': digest(args.rig_json.read_bytes()), 'nativeJointNames': names,
              'sourceNodeIndices': joints, 'vertexCount': vstart, 'triangleCount': istart//3,
              'nativeInverseBindBytesSha256': digest(inverse_raw), 'surfaces': segments,
              'nativeRigWorldMaximumAbsoluteDifference': maximum_bind_delta,
              'allSourceGeometryAndSkinArraysBitExact': True, 'allSourceTriangleIndicesExactAfterOffset': True,
              'selectedMergedVertexIds': sample_ids, 'nativePoseReferences': references,
              'sourceMergedLbsToleranceMeters': .000002,
              'boundary': 'These native source stress references establish exact asset concatenation, not canonical adapter parity or human feasibility.',
              'aiGenerationOrWorkersAIInferenceCalls': 0}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, indent=2) + '\n')
    if args.provenance:
        provenance = json.loads(args.provenance.read_bytes())
        if provenance['sourceZipSha256'] != digest(archive_bytes) or provenance['output']['sha256'] != digest(glb):
            raise ValueError('Cannot associate reference with a different preparation source')
        provenance['independentSourceReference'] = {
            'name': args.output.name, 'bytes': args.output.stat().st_size,
            'sha256': digest(args.output.read_bytes()), 'nativePoseCount': len(references),
            'allGeometryNormalsWeightsJointSlotsAndInverseBindsBitExact': True,
            'allTriangleIndicesExactAfterSurfaceOffset': True,
            'maximumSourceMergedSkinErrorMeters': max(x['maximumSourceMergedPointErrorMeters'] for x in references),
            'toleranceMeters': .000002,
            'scope': 'native asset merge only; canonical display adapter and actual browser editing separately verified'}
        args.provenance.write_text(json.dumps(provenance, indent=2) + '\n')
    print(json.dumps({'referenceBytes': args.output.stat().st_size, 'referenceSha256': digest(args.output.read_bytes()),
                      'vertexCount': vstart, 'triangleCount': istart//3, 'nativePoseCount': len(references),
                      'maximumSourceMergedSkinErrorMeters': max(x['maximumSourceMergedPointErrorMeters'] for x in references),
                      'everyNativeSourceArrayExact': True}))


if __name__ == '__main__':
    main()
