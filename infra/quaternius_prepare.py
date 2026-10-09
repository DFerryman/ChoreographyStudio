#!/usr/bin/env python3
"""Merge the licensed Quaternius male's three native surfaces for web display.

Offline, deterministic preparation; requires NumPy. Source vertex positions,
normals, joint slots, floating point weights and inverse binds remain exact.
Only concatenation/index offsets and a plain presentation material change.
The canonical25 display calibration is deliberately a separate adapter.
"""
from __future__ import annotations

import argparse
import copy
import hashlib
import json
import struct
from pathlib import Path

import numpy as np

EXPECTED = {
    'Superhero_Male_FullBody.gltf': 'e7fcea214ecf8855afbf910b50de6f9c7d1decfb71ca28bad8a4481452dafeb4',
    'Superhero_Male_FullBody.bin': '459003f9745853ae562a85506a2b94dd56515c1f37728f9fa3d2ce1a3e4cd92f',
    'License_Standard.txt': '0f4beaf0fe360a7732e58bbe3dbf60a2422367fbea60cb9ea4add968f383268e',
    'CC0-1.0.txt': 'a2010f343487d3f7618affe54f789f5487602331c0a8d03f49e9a7c547cf0499',
}
ZIP_SHA = 'fdbf1804c90dfc1ea03e992bff7da2dfd1a79318e13270a660180f9308455f40'
COMPONENTS = {5121: '<u1', 5123: '<u2', 5125: '<u4', 5126: '<f4'}
WIDTHS = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4, 'MAT4': 16}


def sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def accessor(doc: dict, binary: bytes, index: int) -> np.ndarray:
    entry = doc['accessors'][index]
    if 'sparse' in entry:
        raise ValueError('Sparse source accessors require an explicit new review')
    view = doc['bufferViews'][entry['bufferView']]
    dtype = np.dtype(COMPONENTS[entry['componentType']])
    width = WIDTHS[entry['type']]
    offset = view.get('byteOffset', 0) + entry.get('byteOffset', 0)
    stride = view.get('byteStride', dtype.itemsize * width)
    return np.ndarray((entry['count'], width), dtype=dtype, buffer=binary,
                      offset=offset, strides=(stride, dtype.itemsize)).copy()


def local_matrix(node: dict) -> np.ndarray:
    if 'matrix' in node:
        return np.asarray(node['matrix'], dtype=np.float64).reshape(4, 4).T
    x, y, z, w = node.get('rotation', [0, 0, 0, 1])
    # Match glTF/Three compose exactly, retaining published quaternion values.
    m = np.eye(4)
    m[:3, :3] = [[1-2*y*y-2*z*z, 2*x*y-2*z*w, 2*x*z+2*y*w],
                 [2*x*y+2*z*w, 1-2*x*x-2*z*z, 2*y*z-2*x*w],
                 [2*x*z-2*y*w, 2*y*z+2*x*w, 1-2*x*x-2*y*y]]
    m[:3, :3] *= np.asarray(node.get('scale', [1, 1, 1]))[None, :]
    m[:3, 3] = node.get('translation', [0, 0, 0])
    return m


def main() -> None:
    cli = argparse.ArgumentParser(description=__doc__)
    cli.add_argument('--source-gltf', required=True, type=Path)
    cli.add_argument('--source-zip', required=True, type=Path)
    cli.add_argument('--source-license', required=True, type=Path)
    cli.add_argument('--cc0-legalcode', required=True, type=Path)
    cli.add_argument('--output', required=True, type=Path)
    args = cli.parse_args()
    source = json.loads(args.source_gltf.read_bytes())
    binary_path = args.source_gltf.parent / source['buffers'][0]['uri']
    binary = binary_path.read_bytes()
    for path in [args.source_gltf, binary_path, args.source_license, args.cc0_legalcode]:
        if sha(path.read_bytes()) != EXPECTED[path.name]:
            raise ValueError('Unexpected source checksum: ' + path.name)
    if args.source_zip.stat().st_size != 128968391 or sha(args.source_zip.read_bytes()) != ZIP_SHA:
        raise ValueError('Unexpected official free Standard archive')
    args.output.mkdir(parents=True, exist_ok=True)
    if len(source['skins']) != 1 or len(source['meshes']) != 3:
        raise ValueError('Expected one native skeleton and the three published surfaces')
    skin = source['skins'][0]
    native_nodes = skin['joints']
    if len(native_nodes) != 65 or len(set(native_nodes)) != 65:
        raise ValueError('Expected 65 unique published skin joints')
    node_to_skin = {node: i for i, node in enumerate(native_nodes)}
    parents_by_node = {child: i for i, node in enumerate(source['nodes'])
                       for child in node.get('children', [])}
    names = [source['nodes'][i]['name'] for i in native_nodes]
    parents = [node_to_skin.get(parents_by_node.get(i), -1) for i in native_nodes]
    worlds: dict[int, np.ndarray] = {}

    def world(index: int) -> np.ndarray:
        if index not in worlds:
            matrix = local_matrix(source['nodes'][index])
            worlds[index] = world(parents_by_node[index]) @ matrix if index in parents_by_node else matrix
        return worlds[index]

    topological: list[int] = []

    def visit(index: int) -> None:
        if index in topological:
            return
        if parents[index] >= 0:
            visit(parents[index])
        topological.append(index)

    for index in range(65):
        visit(index)
    bind = np.asarray([world(i) for i in native_nodes])
    inverse_bind = accessor(source, binary, skin['inverseBindMatrices'])
    inverse_matrices = inverse_bind.astype(np.float64).reshape(-1, 4, 4).transpose(0, 2, 1)
    bind_residual = float(np.abs(bind @ inverse_matrices - np.eye(4)).max())
    if bind_residual > 1e-5:
        raise ValueError('Published source frames and inverse binds disagree')
    all_arrays: dict[str, list[np.ndarray]] = {key: [] for key in ['POSITION', 'NORMAL', 'JOINTS_0', 'WEIGHTS_0']}
    triangles: list[np.ndarray] = []
    surfaces = []
    vertex_start = 0
    index_start = 0
    for mesh_index, mesh in enumerate(source['meshes']):
        if len(mesh['primitives']) != 1:
            raise ValueError('Unexpected source primitive layout')
        primitive = mesh['primitives'][0]
        if primitive.get('mode', 4) != 4:
            raise ValueError('Expected original triangular source topology')
        arrays = {key: accessor(source, binary, primitive['attributes'][key]) for key in all_arrays}
        indices = accessor(source, binary, primitive['indices']).reshape(-1)
        count = len(arrays['POSITION'])
        if count <= 0 or any(len(a) != count for a in arrays.values()) or len(indices) % 3:
            raise ValueError('Invalid published surface layout')
        if int(indices.max()) >= count or int(arrays['JOINTS_0'].max()) >= 65:
            raise ValueError('Invalid source skin or triangle indices')
        weights = arrays['WEIGHTS_0']
        if not all(np.isfinite(a).all() for a in arrays.values()) or np.any(weights < 0) or np.any(weights > 1):
            raise ValueError('Invalid source arrays')
        if float(np.abs(weights.sum(1) - 1).max()) > 2e-5:
            raise ValueError('Do not silently normalize a changed source')
        surfaces.append({'sourceMeshIndex': mesh_index, 'sourceMeshName': mesh['name'],
                         'vertexStart': vertex_start, 'vertexCount': count,
                         'indexStart': index_start, 'indexCount': len(indices),
                         'nativeArraySha256': {key: sha(a.tobytes()) for key, a in arrays.items()},
                         'nativeIndexSha256': sha(indices.tobytes()),
                         'sourceTriangleComponentType': source['accessors'][primitive['indices']]['componentType']})
        for key, array in arrays.items():
            all_arrays[key].append(array)
        triangles.append((indices.astype(np.uint32) + vertex_start).astype('<u2'))
        vertex_start += count
        index_start += len(indices)
    merged = {key: np.concatenate(value) for key, value in all_arrays.items()}
    indices = np.concatenate(triangles).reshape(-1, 1)
    if vertex_start != 8483 or index_start != 42954:
        raise ValueError('Unexpected source character topology')
    minimum = merged['POSITION'].min(0).astype(float)
    maximum = merged['POSITION'].max(0).astype(float)
    description = {'version': 1, 'schema': 'quaternius-rig-1',
                   'source': 'Quaternius Universal Base Characters Standard / Superhero_Male_FullBody',
                   'license': 'CC0-1.0', 'nativeJointCount': 65, 'vertexCount': vertex_start,
                   'triangleCount': index_start // 3, 'coordinateSystem': '+Y up, +Z front, meters',
                   'nativeJointNames': names, 'nativeJointParents': parents,
                   'topoOrder': topological, 'sourceNodeIndices': native_nodes,
                   'sourceLocalTranslation': [source['nodes'][i].get('translation', [0, 0, 0]) for i in native_nodes],
                   'sourceLocalRotation': [source['nodes'][i].get('rotation', [0, 0, 0, 1]) for i in native_nodes],
                   'sourceLocalScale': [source['nodes'][i].get('scale', [1, 1, 1]) for i in native_nodes],
                   'sourceBindWorld': bind.transpose(0, 2, 1).reshape(-1, 16).tolist(),
                   'sourceInverseBindWorld': inverse_bind.astype(float).tolist(),
                   'sourceBounds': {'min': minimum.tolist(), 'max': maximum.tolist()},
                   'sourceHeightMeters': float(maximum[1] - minimum[1]),
                   'surfaces': surfaces,
                   'geometryTransform': 'none; native source coordinates and inverse binds unchanged',
                   'authorRig': 'canonical25 unchanged; native display calibration is performed by the adapter'}
    descriptor = args.output / 'neutral-quaternius-v1.json'
    descriptor.write_text(json.dumps(description, separators=(',', ':')) + '\n')
    blob = bytearray()
    views = []
    accessors = []

    def add(array: np.ndarray, component: int, kind: str, target: int | None = None, bounds: bool = False) -> int:
        while len(blob) % 4:
            blob.append(0)
        raw = np.ascontiguousarray(array)
        view = {'buffer': 0, 'byteOffset': len(blob), 'byteLength': raw.nbytes}
        if target is not None:
            view['target'] = target
        views.append(view)
        blob.extend(raw.tobytes())
        entry = {'bufferView': len(views)-1, 'componentType': component, 'count': len(raw), 'type': kind}
        if bounds:
            entry.update(min=raw.min(0).tolist(), max=raw.max(0).tolist())
        accessors.append(entry)
        return len(accessors)-1

    attributes = {key: add(array, 5121 if key == 'JOINTS_0' else 5126,
                           'VEC3' if key in ['POSITION', 'NORMAL'] else 'VEC4', 34962, key == 'POSITION')
                  for key, array in merged.items()}
    index_accessor = add(indices, 5123, 'SCALAR', 34963)
    bind_accessor = add(inverse_bind, 5126, 'MAT4')
    # Keep original source node indices, TRS and child order for all 65 bones.
    nodes = copy.deepcopy(source['nodes'][:65])
    if any('mesh' in node for node in nodes):
        raise ValueError('Expected the original first 65 nodes to be bones')
    nodes += [{'name': 'NeutralHuman', 'mesh': 0, 'skin': 0},
              {'name': 'Armature', 'children': [64, 65]}]
    original_armature = source['nodes'][68]
    if {key: value for key, value in original_armature.items() if key not in ['name', 'children']}:
        raise ValueError('Nonidentity source Armature requires explicit preservation')
    output_doc = {'asset': {'version': '2.0', 'generator': 'Choreo Studio native Quaternius surface concatenation v1',
                            'copyright': 'Quaternius / CC0 1.0 Universal'},
                  'scene': 0, 'scenes': [{'name': 'Scene', 'nodes': [66]}], 'nodes': nodes,
                  'meshes': [{'name': 'Quaternius Superhero Male original three surfaces',
                              'primitives': [{'attributes': attributes, 'indices': index_accessor, 'material': 0}]}],
                  'skins': [{'name': 'Armature', 'joints': native_nodes, 'inverseBindMatrices': bind_accessor}],
                  'materials': [{'name': 'Neutral matte display', 'pbrMetallicRoughness': {
                      'baseColorFactor': [.73, .70, .65, 1], 'metallicFactor': 0, 'roughnessFactor': .84}}],
                  'bufferViews': views, 'accessors': accessors, 'buffers': [{'byteLength': len(blob)}],
                  'extras': {'quaterniusSource': {'sourceGltfSha256': EXPECTED[args.source_gltf.name],
                                                'rawNativeBindAndWeights': True, 'nativeJointCount': 65}}}
    raw_json = json.dumps(output_doc, separators=(',', ':')).encode()
    raw_json += b' ' * (-len(raw_json) % 4)
    blob.extend(b'\0' * (-len(blob) % 4))
    output = args.output / 'neutral-quaternius-v1.glb'
    output.write_bytes(struct.pack('<III', 0x46546c67, 2, 28+len(raw_json)+len(blob))
                       + struct.pack('<II', len(raw_json), 0x4e4f534a) + raw_json
                       + struct.pack('<II', len(blob), 0x004e4942) + blob)
    source_license = args.output / 'QUATERNIUS-SOURCE-LICENSE.txt'
    source_license.write_bytes(args.source_license.read_bytes())
    legalcode = args.output / 'CC0-1.0.txt'
    legalcode.write_bytes(args.cc0_legalcode.read_bytes())
    provenance = {'schema': 'quaternius-provenance-1', 'status': 'native assets prepared; adapter/runtime verification separate',
                  'sourcePage': 'https://quaternius.com/packs/universalbasecharacters.html',
                  'downloadPage': 'https://quaternius.itch.io/universal-base-characters',
                  'sourcePackage': 'Universal Base Characters[Standard].zip', 'uploadId': 15861669,
                  'archivedOn': '2026-10-09', 'sourceZipBytes': 128968391, 'sourceZipSha256': ZIP_SHA,
                  'sourceFiles': [{'name': path.name, 'bytes': path.stat().st_size, 'sha256': sha(path.read_bytes())}
                                  for path in [args.source_gltf, binary_path, args.source_license]],
                  'license': 'CC0-1.0', 'licenseCanonicalUrl': 'https://creativecommons.org/publicdomain/zero/1.0/',
                  'fullLegalcodeTextSource': 'https://raw.githubusercontent.com/spdx/license-list-data/main/text/CC0-1.0.txt',
                  'output': {'name': output.name, 'bytes': output.stat().st_size, 'sha256': sha(output.read_bytes()),
                             'vertices': vertex_start, 'triangles': index_start//3, 'joints': 65,
                             'sourceSurfaces': 3, 'mergedSkinnedMeshes': 1,
                             'maximumPositiveInfluences': int((merged['WEIGHTS_0'] > 0).sum(1).max()),
                             'originalWeightSlotsRetained': 4, 'nativeHeightMeters': description['sourceHeightMeters']},
                  'descriptor': {'name': descriptor.name, 'bytes': descriptor.stat().st_size, 'sha256': sha(descriptor.read_bytes())},
                  'licenses': [{'name': path.name, 'bytes': path.stat().st_size, 'sha256': sha(path.read_bytes())}
                               for path in [source_license, legalcode]],
                  'preparation': ['Concatenate original eyebrow, eye and body vertices in published mesh order.',
                                  'Offset original triangles by surface vertex start; do not weld or remesh.',
                                  'Retain original normals, 65-joint skin ordering, source hierarchy/TRS, inverse binds and all four weight slots.',
                                  'No reweighting, influence pruning, weight normalization or geometry deformation.',
                                  'Use one matte material; omit unused original UV/color/texture presentation attributes.',
                                  'Display adapter handles uniform height/pose calibration without changing author data.'],
                  'nativeFrameInverseBindMaximumResidual': bind_residual,
                  'aiGenerationOrWorkersAIInferenceCalls': 0, 'paidPurchases': 0}
    (args.output / 'QUATERNIUS-PROVENANCE.json').write_text(json.dumps(provenance, indent=2) + '\n')
    print(json.dumps(provenance['output']))


if __name__ == '__main__':
    main()
