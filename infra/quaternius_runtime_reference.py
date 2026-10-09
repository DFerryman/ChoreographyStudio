"""Independent Quaternius canonical-display skin reference generator.

Requires Python 3.9+ and NumPy. From the repository root, provide the official
Superhero_Male_FullBody.gltf with its original adjacent .bin and run:

    python infra/quaternius_runtime_reference.py \
        --source path/to/Superhero_Male_FullBody.gltf \
        --calibration infra/quaternius-runtime-reference-input.json \
        --output work/quaternius-native-skin-reference.json

Reads released glTF/BIN arrays directly; never imports TypeScript, the app
loader, its controller, or a runtime-produced point cloud. Calibration is an
explicit reviewed input; all source neutral frames, display adjustment matrices
and LBS points are independently computed here. No network or AI calls occur.

The revised v17 fixture covers 15 authored poses, 1,563 selected vertices from
8,483 source vertices, and 21 canonical pivots at a 2 micrometre point tolerance.
The separate quaternius_source_reference.py proves all source vertices remain
exact through surface merging. The display-2 revision keeps one coherent source
torso/neck/head shape instead of independently shifting those skin regions to
canonical pivots. This declaration is not an acceptance-test result.
"""
from pathlib import Path
import argparse, hashlib, json, math
import numpy as np

DTYPES = {5120: '<i1', 5121: '<u1', 5122: '<i2', 5123: '<u2', 5125: '<u4', 5126: '<f4'}
COMPONENTS = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4, 'MAT4': 16}


def sha(data):
    return hashlib.sha256(data).hexdigest()


def unit(q):
    return np.asarray(q, dtype=np.float64) / np.linalg.norm(q)


def product(q, r):
    v, w = np.asarray(q[:3]), q[3]
    u, z = np.asarray(r[:3]), r[3]
    return np.r_[w * u + z * v + np.cross(v, u), w * z - np.dot(v, u)]


def inverse(q):
    return np.r_[-np.asarray(q[:3]), q[3]] / np.dot(q, q)


def rotate(q, v):
    return product(product(q, np.r_[v, 0]), inverse(q))[:3]


def quaternion_matrix(q):
    x, y, z, w = q
    return np.array([[1 - 2*y*y - 2*z*z, 2*x*y - 2*z*w, 2*x*z + 2*y*w],
                     [2*x*y + 2*z*w, 1 - 2*x*x - 2*z*z, 2*y*z - 2*x*w],
                     [2*x*z - 2*y*w, 2*y*z + 2*x*w, 1 - 2*x*x - 2*y*y]])


def matrix_quaternion(m):
    # Standard trace/largest-diagonal conversion, independent of Three.js.
    trace = np.trace(m)
    if trace > 0:
        s = math.sqrt(trace + 1) * 2
        q = [(m[2, 1] - m[1, 2]) / s, (m[0, 2] - m[2, 0]) / s,
             (m[1, 0] - m[0, 1]) / s, .25 * s]
    else:
        i = int(np.argmax(np.diag(m)))
        if i == 0:
            s = math.sqrt(1 + m[0, 0] - m[1, 1] - m[2, 2]) * 2
            q = [.25*s, (m[0, 1]+m[1, 0])/s, (m[0, 2]+m[2, 0])/s, (m[2, 1]-m[1, 2])/s]
        elif i == 1:
            s = math.sqrt(1 + m[1, 1] - m[0, 0] - m[2, 2]) * 2
            q = [(m[0, 1]+m[1, 0])/s, .25*s, (m[1, 2]+m[2, 1])/s, (m[0, 2]-m[2, 0])/s]
        else:
            s = math.sqrt(1 + m[2, 2] - m[0, 0] - m[1, 1]) * 2
            q = [(m[0, 2]+m[2, 0])/s, (m[1, 2]+m[2, 1])/s, .25*s, (m[1, 0]-m[0, 1])/s]
    return unit(q)


def compose(t, q, scale):
    m = np.eye(4)
    m[:3, :3] = quaternion_matrix(q) * scale
    m[:3, 3] = t
    return m


def xyz_quaternion(degrees):
    x, y, z = np.radians(degrees) / 2
    cx, cy, cz, sx, sy, sz = math.cos(x), math.cos(y), math.cos(z), math.sin(x), math.sin(y), math.sin(z)
    return np.array([sx*cy*cz+cx*sy*sz, cx*sy*cz-sx*cy*sz, cx*cy*sz+sx*sy*cz, cx*cy*cz-sx*sy*sz])


def slerp(q, r, t):
    q, r = unit(q), unit(r)
    cosine = float(np.dot(q, r))
    if cosine < 0:
        r, cosine = -r, -cosine
    if cosine >= 1:
        return q
    if 1 - cosine*cosine <= np.finfo(float).eps:
        return unit(q*(1-t) + r*t)
    angle = math.acos(min(1, cosine))
    return q*math.sin((1-t)*angle)/math.sin(angle) + r*math.sin(t*angle)/math.sin(angle)


class Source:
    def __init__(self, path):
        self.path = Path(path)
        self.document = json.loads(self.path.read_text())
        self.buffers = [(self.path.parent / b['uri']).read_bytes() for b in self.document['buffers']]

    def accessor(self, index):
        a = self.document['accessors'][index]
        view = self.document['bufferViews'][a['bufferView']]
        dtype = np.dtype(DTYPES[a['componentType']])
        components = COMPONENTS[a['type']]
        return np.ndarray((a['count'], components), dtype, buffer=self.buffers[view['buffer']],
                          offset=view.get('byteOffset', 0)+a.get('byteOffset', 0),
                          strides=(view.get('byteStride', dtype.itemsize*components), dtype.itemsize)).copy()

    def arrays(self):
        arrays = {k: [] for k in ['POSITION', 'NORMAL', 'JOINTS_0', 'WEIGHTS_0']}
        indices, count = [], 0
        for mesh in self.document['meshes']:
            for primitive in mesh['primitives']:
                for key in arrays:
                    arrays[key].append(self.accessor(primitive['attributes'][key]))
                indices.append(self.accessor(primitive['indices']).reshape(-1).astype(np.uint32)+count)
                count += len(arrays['POSITION'][-1])
        return {k: np.concatenate(v) for k, v in arrays.items()} | {'indices': np.concatenate(indices)}

    def bones(self):
        nodes, skin = self.document['nodes'], self.document['skins'][0]
        ids = skin['joints']
        by_node = {node: at for at, node in enumerate(ids)}
        all_parents = {child: parent for parent, node in enumerate(nodes) for child in node.get('children', [])}
        parents = [by_node.get(all_parents.get(node), -1) for node in ids]
        names = [nodes[node]['name'] for node in ids]
        t = np.array([nodes[node].get('translation', [0, 0, 0]) for node in ids])
        q = np.array([nodes[node].get('rotation', [0, 0, 0, 1]) for node in ids], dtype=np.float64)
        scales = np.array([nodes[node].get('scale', [1, 1, 1]) for node in ids])
        order, waiting = [], set(range(len(ids)))
        while waiting:
            ready = sorted(i for i in waiting if parents[i] < 0 or parents[i] in order)
            assert ready, 'Source hierarchy contains a cycle'
            order.extend(ready)
            waiting.difference_update(ready)
        world = np.tile(np.eye(4), (len(ids), 1, 1))
        for at in order:
            local = compose(t[at], q[at], scales[at])
            world[at] = local if parents[at] < 0 else world[parents[at]] @ local
        ibp = self.accessor(skin['inverseBindMatrices']).reshape(-1, 4, 4).transpose(0, 2, 1)
        return names, parents, order, t, q, scales, world, ibp


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', required=True, help='Official glTF path; its original .bin must remain adjacent.')
    parser.add_argument('--calibration', required=True, help='Reviewed JSON input, or an existing reference containing calibration.')
    parser.add_argument('--output', required=True, help='Reference JSON destination; create its parent directory first.')
    args = parser.parse_args()
    source = Source(args.source)
    calibration = json.loads(Path(args.calibration).read_text())
    if calibration.get('schema') == 'quaternius-native-skin-reference-1':
        calibration = calibration['calibration']
    names, parents, order, translations, local_rotations, local_scales, bind, inverses = source.bones()
    arrays = source.arrays()
    positions, weights = arrays['POSITION'], arrays['WEIGHTS_0']
    skin_indices = arrays['JOINTS_0'].astype(int)
    ids = {name: at for at, name in enumerate(names)}
    source_positions = bind[:, :3, 3]
    source_scales = np.linalg.norm(bind[:, :3, :3], axis=1)
    source_rotations = np.array([matrix_quaternion(m[:3, :3] / source_scales[at]) for at, m in enumerate(bind)])
    neutral_rotations = source_rotations.copy()
    scale = calibration['heightMeters'] / calibration['sourceHeightMeters']
    neutral_scales = source_scales * scale
    for suffix in ['l', 'r']:
        for start_name, end_name, target_length in [('upperarm','lowerarm',.285), ('lowerarm','hand',.255), ('thigh','calf',.46), ('calf','foot',.45)]:
            at, child = ids[start_name+'_'+suffix], ids[end_name+'_'+suffix]
            displacement = source_positions[child] - source_positions[at]
            direction = unit(displacement)
            target = np.array([0., -1., 0.])
            delta = unit(np.r_[np.cross(direction, target), 1+np.dot(direction, target)])
            neutral_rotations[at] = unit(product(delta, source_rotations[at]))
            neutral_scales[at, 1] = source_scales[at, 1] * target_length / np.linalg.norm(displacement)
        hand, forearm = ids['hand_'+suffix], ids['lowerarm_'+suffix]
        neutral_rotations[hand] = unit(product(product(neutral_rotations[forearm], inverse(source_rotations[forearm])), source_rotations[hand]))
    mapping = calibration['primaryJointMapping']
    fraction = np.linalg.norm(translations[ids['spine_02']])/(np.linalg.norm(translations[ids['spine_02']])+np.linalg.norm(translations[ids['spine_03']]))
    author_rest_positions = {}
    for name, parent, offset in calibration['canonicalDefinitions']:
        author_rest_positions[name] = np.asarray(offset) + (author_rest_positions[parent] if parent else 0)
    neutral_positions = np.zeros((len(names), 3))
    neutral = np.tile(np.eye(4), (len(names), 1, 1))
    for at in order:
        name, parent = names[at], parents[at]
        if name in mapping:
            neutral_positions[at] = author_rest_positions[mapping[name]]
        elif name == 'spine_02':
            neutral_positions[at] = author_rest_positions['Spine']*(1-fraction) + author_rest_positions['Chest']*fraction
        elif parent < 0:
            neutral_positions[at] = [0.,0.,0.]
        else:
            neutral_rotations[at] = unit(product(neutral_rotations[parent], unit(local_rotations[at])))
            offset = rotate(inverse(source_rotations[parent]), source_positions[at]-source_positions[parent])
            offset *= neutral_scales[parent] / source_scales[parent]
            neutral_positions[at] = neutral_positions[parent] + rotate(neutral_rotations[parent], offset)
            neutral_scales[at] = source_scales[at] * scale
        neutral[at] = compose(neutral_positions[at], neutral_rotations[at], neutral_scales[at])
    adjustments = np.tile(np.eye(4), (len(names), 1, 1))
    def scale_around(point, factor):
        result = np.eye(4)
        result[1,1] = factor
        result[1,3] = point[1] * (1-factor)
        return result
    foot_factors = []
    for suffix in ['l', 'r']:
        foot, ball, leaf = ids['foot_'+suffix], ids['ball_'+suffix], ids['ball_leaf_'+suffix]
        factor = calibration['sourceSoleOffsetMeters']/((source_positions[foot,1]-calibration['sourceBoundsMin'][1])*scale)
        foot_factors.append(float(factor))
        adjustments[foot] = np.linalg.inv(neutral[foot]) @ scale_around(neutral_positions[foot], factor) @ neutral[foot]
        foot_skin = neutral[foot] @ adjustments[foot] @ inverses[foot]
        for at in [ball, leaf]:
            adjustments[at] = np.linalg.inv(neutral[at]) @ foot_skin @ bind[at]
    # One coherent body similarity preserves the released torso/clavicle/neck/
    # head shape. Y uses the source sole, Z aligns source and canonical arm
    # depths; the physical canonical frames, limb fit and foot82 stay unchanged.
    body_similarity = np.diag([scale, scale, scale, 1.])
    body_similarity[1,3] = -calibration['sourceRootOffsetMeters']-calibration['sourceBoundsMin'][1]*scale
    body_similarity[2,3] = -scale*(source_positions[ids['upperarm_l'],2]+source_positions[ids['upperarm_r'],2])/2
    body_names = ['root', 'pelvis', 'spine_01', 'spine_02', 'spine_03', 'clavicle_l', 'clavicle_r', 'neck_01', 'Head']
    for name in body_names:
        at = ids[name]
        adjustments[at] = np.linalg.inv(neutral[at]) @ body_similarity @ bind[at]
    head_factor = 1.
    neutral_scales = np.linalg.norm(neutral[:, :3, :3], axis=1)
    neutral_rotations = np.array([matrix_quaternion(m[:3,:3] / neutral_scales[at]) for at,m in enumerate(neutral)])
    offsets = np.array([neutral_positions[at] if parents[at] < 0 else rotate(inverse(neutral_rotations[parents[at]]),neutral_positions[at]-neutral_positions[parents[at]]) for at in range(len(names))])
    neutral_local_rotations = np.array([neutral_rotations[at] if parents[at] < 0 else product(inverse(neutral_rotations[parents[at]]),neutral_rotations[at]) for at in range(len(names))])
    homogeneous = np.c_[positions, np.ones(len(positions))]
    # Stratify by every original vertex, and retain all weighted shoulder/
    # chest/foot vertices to make coverage independent of a flattering view.
    selected = set(np.linspace(0, len(positions)-1, 256).astype(int))
    selected.update(np.flatnonzero((weights*((skin_indices == ids['upperarm_l']) | (skin_indices == ids['upperarm_r']) |
                                             (skin_indices == ids['spine_03']) | (skin_indices == ids['foot_l']) |
                                             (skin_indices == ids['foot_r']))).sum(axis=1) > .25).tolist())
    vertex_ids = [int(vertex) for vertex in sorted(selected)]
    result = {'schema': 'quaternius-native-skin-reference-1', 'generation': 'offline NumPy LBS from released official glTF/BIN; no production TypeScript/loader/runtime point capture',
              'sourceGltfSHA256': sha(source.path.read_bytes()), 'sourceBinSHA256': sha(source.buffers[0]),
              'calibration': calibration | {'computedFootVerticalFactors': foot_factors, 'computedHeadVerticalFactor': float(head_factor), 'computedSpine2Fraction': float(fraction), 'computedSourceBodySimilarity': body_similarity.T.reshape(16).tolist()}, 'canonicalDefinitions': calibration['canonicalDefinitions'],
              'nativeBoneNames': names, 'vertexCount': len(positions), 'triangleCount': len(arrays['indices'])//3,
              'geometryHashes': {key: sha(array.astype('<u4' if key in ['skinIndex', 'index'] else '<f4').tobytes()) for key, array in
                                 [('position', positions), ('normal', arrays['NORMAL']), ('skinIndex', arrays['JOINTS_0']), ('skinWeight', weights), ('index', arrays['indices'])]},
              'acceptance': {'sourcePointMaximumErrorMeters': .000002}, 'vertexIds': vertex_ids, 'poses': []}
    for entry in calibration['poses']:
        author_world, author_positions = {}, {}
        for name, parent, author_offset in calibration['canonicalDefinitions']:
            local = xyz_quaternion(entry['rotations'].get(name, [0, 0, 0]))
            author_world[name] = local if parent is None else product(author_world[parent], local)
            author_positions[name] = np.asarray(author_offset) if parent is None else author_positions[parent] + rotate(author_world[parent],np.asarray(author_offset))
        world_positions = np.zeros((len(names), 3))
        world_rotations = np.tile([0., 0., 0., 1.], (len(names), 1))
        frames = np.tile(np.eye(4), (len(names), 1, 1))
        for at in order:
            name, parent = names[at], parents[at]
            if parent < 0:
                world_positions[at] = offsets[at]
                world_rotations[at] = product(author_world['Hips'], neutral_rotations[at])
            elif name in mapping:
                world_positions[at] = author_positions[mapping[name]]
                world_rotations[at] = product(author_world[mapping[name]], neutral_rotations[at])
            elif name == 'spine_02':
                world_positions[at] = author_positions['Spine']*(1-fraction) + author_positions['Chest']*fraction
                world_rotations[at] = product(slerp(author_world['Spine'], author_world['Chest'], fraction), neutral_rotations[at])
            else:
                world_positions[at] = world_positions[parent] + rotate(world_rotations[parent],offsets[at])
                world_rotations[at] = product(world_rotations[parent],neutral_local_rotations[at])
            frames[at] = compose(world_positions[at], world_rotations[at], neutral_scales[at])
        transforms = frames @ adjustments @ inverses
        points = sum(weights[:, influence, None] * np.einsum('nij,nj->ni', transforms[skin_indices[:, influence]], homogeneous)[:, :3]
                     for influence in range(4)) + np.asarray(entry['root'])
        result['poses'].append(entry | {'pointsMeters': points[vertex_ids].tolist(), 'primaryPointsMeters': {native: (author_positions[author]+np.asarray(entry['root'])).tolist() for native,author in mapping.items()}})
    Path(args.output).write_text(json.dumps(result, separators=(',', ':'))+'\n')
    print(json.dumps({'output': args.output, 'bytes': Path(args.output).stat().st_size, 'vertices': len(positions), 'selectedVertices': len(vertex_ids), 'poses': len(result['poses']), 'sha256': sha(Path(args.output).read_bytes())}))


if __name__ == '__main__':
    main()
