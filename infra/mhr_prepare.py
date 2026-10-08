#!/usr/bin/env python3
"""Prepare a native MHR LOD3 glTF asset without altering vertex/bone order.

Requires NumPy and the MIT pymomentum-cpu package. Obtain the Apache-2.0
MHR v1.0.1 release assets separately; this script performs no downloads.
The uncalibrated asset is a source reference, not a canonical25 stage avatar.
"""
from __future__ import annotations
import argparse, hashlib, json, struct
from pathlib import Path
import numpy as np

SOURCE_URL = 'https://github.com/facebookresearch/MHR/releases/download/v1.0.1/assets.zip'
EXPECTED_SOURCE = {
    'lod3.fbx': '5d5fe30ba09488e96a06b2fe6306202c4048083df9e1003f1051ad541e06aafa',
    'compact_v6_1.model': '9b4e48e6216296c0a8a47e8e1d210b42ca8b194b9f61409adc5d7a3873dcf08e',
    'corrective_activation.npz': '08cce62c1aed80c0ae2a87580c0e7b73b7a1efea56daa0cec25dbed5917e4909',
    'corrective_blendshapes_lod3.npz': '7aae0b02b6b53aa39fa7bfeef954e634d0b928b66189e2b472227573a0447bee',
    'LICENSE.txt': 'cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30',
}

def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()

def vertex_normals(points: np.ndarray, triangles: np.ndarray) -> np.ndarray:
    face = np.cross(points[triangles[:,1]] - points[triangles[:,0]], points[triangles[:,2]] - points[triangles[:,0]])
    if np.any(np.linalg.norm(face, axis=1) < 1e-12):
        raise ValueError('Degenerate source triangle')
    normals = np.zeros_like(points, dtype=np.float64)
    for corner in range(3): np.add.at(normals, triangles[:,corner], face)
    length = np.linalg.norm(normals, axis=1)
    if np.any(length < 1e-12): raise ValueError('Invalid source vertex normal')
    return (normals / length[:,None]).astype('<f4')

def write_glb(path: Path, *, points: np.ndarray, triangles: np.ndarray,
              names: list[str], parents: np.ndarray, bind_world: np.ndarray,
              indices: np.ndarray, weights: np.ndarray, metadata: dict) -> None:
    if len(names) != 127 or len(set(names)) != 127: raise ValueError('Expected 127 unique MHR joints')
    if len(points) != 4899: raise ValueError('Expected original 4899 vertex order')
    if indices.shape != (len(points),4) or weights.shape != indices.shape:
        raise ValueError('Native influence shape mismatch')
    if np.any(indices >= len(names)) or np.any(weights < 0) or not np.isfinite(weights).all():
        raise ValueError('Invalid native skin data')
    if np.max(np.abs(weights.sum(1)-1)) > 2e-6: raise ValueError('Non-normalized native weights')
    if not np.isfinite(points).all() or not np.isfinite(bind_world).all(): raise ValueError('Non-finite native geometry/bind')
    if any(parent < -1 or parent >= index for index,parent in enumerate(parents)):
        raise ValueError('Source parent order invalid')
    blob = bytearray(); views=[]; accessors=[]
    def add(array, component, kind, target=None, bounds=False):
        while len(blob)%4: blob.append(0)
        a = np.ascontiguousarray(array); start = len(blob); blob.extend(a.tobytes())
        view = {'buffer':0,'byteOffset':start,'byteLength':a.nbytes}
        if target: view['target']=target
        views.append(view); entry={'bufferView':len(views)-1,'componentType':component,'count':len(a),'type':kind}
        if bounds: entry.update(min=a.min(0).tolist(),max=a.max(0).tolist())
        accessors.append(entry); return len(accessors)-1
    pos=add(np.asarray(points,dtype='<f4'),5126,'VEC3',34962,True)
    normal=add(vertex_normals(points,triangles),5126,'VEC3',34962)
    skin=add(np.asarray(indices,dtype='<u2'),5123,'VEC4',34962)
    weight=add(np.asarray(weights,dtype='<f4'),5126,'VEC4',34962)
    tri=add(np.asarray(triangles,dtype='<u4').reshape(-1,1),5125,'SCALAR',34963)
    inverses=np.linalg.inv(bind_world)
    inv=add(np.asarray(inverses.transpose(0,2,1).reshape(-1,16),dtype='<f4'),5126,'MAT4')
    nodes=[]
    for i,name in enumerate(names):
        local=bind_world[i] if parents[i]<0 else inverses[parents[i]]@bind_world[i]
        nodes.append({'name':name,'matrix':local.T.reshape(-1).tolist()})
    for i,parent in enumerate(parents):
        if parent>=0:nodes[int(parent)].setdefault('children',[]).append(i)
    nodes.append({'name':'MHR neutral LOD3 continuous skin','mesh':0,'skin':0})
    doc={'asset':{'version':'2.0','generator':'Choreo Studio MHR127 LOD3 native preparation',
                 'copyright':'MHR source assets licensed Apache-2.0'},
         'scene':0,'scenes':[{'nodes':[i for i,parent in enumerate(parents) if parent<0]+[len(names)]}],
         'nodes':nodes,
         'meshes':[{'name':'MHR neutral native topology','primitives':[{'attributes':{'POSITION':pos,'NORMAL':normal,'JOINTS_0':skin,'WEIGHTS_0':weight},'indices':tri,'material':0}]}],
         'materials':[{'name':'Neutral ivory matte','pbrMetallicRoughness':{'baseColorFactor':[.73,.70,.65,1],'metallicFactor':0,'roughnessFactor':.82}}],
         'skins':[{'name':'MHR-native-127','joints':list(range(len(names))),'inverseBindMatrices':inv,'skeleton':0}],
         'extras':{'choreoMHR':metadata},'bufferViews':views,'accessors':accessors,'buffers':[{'byteLength':len(blob)}]}
    raw=json.dumps(doc,separators=(',',':'),ensure_ascii=True).encode();raw+=b' '*(-len(raw)%4);blob.extend(b'\0'*(-len(blob)%4))
    path.write_bytes(struct.pack('<III',0x46546c67,2,28+len(raw)+len(blob))+struct.pack('<II',len(raw),0x4e4f534a)+raw+struct.pack('<II',len(blob),0x004e4942)+blob)

def write_correctives(assets: Path, output: Path) -> dict:
    activation=np.load(assets/'corrective_activation.npz',allow_pickle=False)
    directions=np.load(assets/'corrective_blendshapes_lod3.npz',allow_pickle=False)['corrective_blendshapes']
    indices=activation['0.sparse_indices']; weights=activation['0.sparse_weight']
    if directions.shape!=(3000,4899,3):raise ValueError('Unexpected corrective dimensions')
    order=np.lexsort((indices[1],indices[0]));rows=indices[0,order];columns=indices[1,order];weights=weights[order]
    offsets=np.r_[0,np.bincount(rows,minlength=3000).cumsum()].astype('<u4')
    component,vertex,axis=np.nonzero(directions);out=vertex*3+axis
    order=np.lexsort((component,out));drows=out[order];dcolumns=component[order]
    dweights=directions[component[order],vertex[order],axis[order]]
    doffsets=np.r_[0,np.bincount(drows,minlength=4899*3).cumsum()].astype('<u4')
    chunks=[b'MHRCORR1'+struct.pack('<6I',1,750,3000,4899,len(weights),len(dweights))]
    sections={}
    for name,array in [('activationOffsets',offsets),('activationColumns',columns.astype('<u2')),('activationWeights',weights.astype('<f4')),('directionOffsets',doffsets),('directionColumns',dcolumns.astype('<u2')),('directionWeights',dweights.astype('<f4'))]:
        sections[name]={'byteOffset':sum(map(len,chunks)),'count':len(array),'dtype':array.dtype.str}
        raw=array.tobytes();chunks.append(raw+b'\0'*(-len(raw)%4))
    path=output/'neutral-mhr-correctives-v1.bin';path.write_bytes(b''.join(chunks))
    if digest(path)!='b09418f280a379c4f4a3fb72f4c8b909a6339a5fd1c7ed5513f3b8a17b947bde':
        raise ValueError('Corrective asset does not reproduce the validated CSR bytes')
    return {'name':path.name,'bytes':path.stat().st_size,'sha256':digest(path),'format':'MHRCORR1 native-centimeter CSR; every nonzero retained','sections':sections}

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--assets',required=True,type=Path,help='MHR v1.0.1 extracted release assets directory')
    parser.add_argument('--output',required=True,type=Path,help='Output directory')
    parser.add_argument('--adapter-contract',type=Path,help='Canonical25 adapter/shape calibration JSON; public neutral-mhr-v1.json can reproduce this blueprint')
    parser.add_argument('--momentum-license',type=Path,help='Exact MIT license from the installed offline converter')
    parser.add_argument('--reference',type=Path,help='Optional exact official skeleton fixture prefix (.npz/.json), skipping FBX loading')
    args=parser.parse_args();args.output.mkdir(parents=True,exist_ok=True)
    sources=[]
    for name,sha in EXPECTED_SOURCE.items():
        path=args.assets/name
        if digest(path)!=sha:raise ValueError('Unexpected source checksum: '+name)
        sources.append({'name':name,'bytes':path.stat().st_size,'sha256':sha})
    if args.reference:
        raw=np.load(args.reference.with_suffix('.npz'));descriptor=json.loads(args.reference.with_suffix('.json').read_text())
        vertices=raw['vertices'];faces=raw['faces'];native_indices=raw['skinIndices'];native_weights=raw['skinWeights']
        names=descriptor['jointNames'];parents=raw['parents'];bind=raw['bindPose'].astype(np.float64);pre=raw['preRotations'];offsets=raw['offsets']
    else:
        try: import pymomentum.geometry as momentum
        except ImportError as error:raise SystemExit('Install pymomentum-cpu; no Torch or remote runtime is required.') from error
        character=momentum.Character.load_fbx(str(args.assets/'lod3.fbx'),str(args.assets/'compact_v6_1.model'),load_blendshapes=True)
        vertices=np.asarray(character.mesh.vertices);faces=np.asarray(character.mesh.faces);native_indices=np.asarray(character.skin_weights.index);native_weights=np.asarray(character.skin_weights.weight)
        names=character.skeleton.joint_names;parents=np.asarray(character.skeleton.joint_parents);bind=np.asarray(character.bind_pose,dtype=np.float64);pre=np.asarray(character.skeleton.pre_rotations);offsets=np.asarray(character.skeleton.offsets)
    # Source storage has eight slots, but all discarded slots are exactly zero.
    # Preserve first four weights bit-for-bit, without pruning or renormalization.
    if native_weights.shape[1]!=8 or np.any(native_weights[:,4:] != 0):raise ValueError('Source now uses >4 influences: update renderer, do not silently truncate')
    origin=bind[names.index('root'),:3,3]/100
    points=vertices.astype(np.float64)/100-origin
    bind_m=bind.copy();bind_m[:,:3,3]=bind_m[:,:3,3]/100-origin
    source_offsets_m=offsets.astype(np.float64)/100
    source_offsets_m[names.index('body_world')]-=origin
    metadata={'version':1,'source':'MHR v1.0.1 LOD3','license':'Apache-2.0','nativeJointCount':127,'vertexCount':4899,'coordinateSystem':'right-handed Y-up +Zfront meters','nativeSourceUnits':'centimeters','sourceRootOriginMeters':origin.tolist(),'calibration':'native source reference; canonical25 adapter pending',
              'nativeJointNames':list(names),'nativeJointParents':parents.tolist(),'nativePreRotationsXYZW':pre.tolist(),'nativeOffsetsCentimeters':offsets.tolist(),'nativeRestWorldMeters':bind_m[:,:3,3].tolist(),'correctiveAsset':'neutral-mhr-correctives-v1.bin','correctiveUnits':'native centimeters','sourcePreRotations':pre.tolist(),'sourceOffsetsMeters':source_offsets_m.tolist(),'sourceBindWorld':bind_m.transpose(0,2,1).reshape(-1,16).tolist(),'jointNames':list(names),'jointParents':parents.tolist()}
    if args.adapter_contract:
        adapter=json.loads(args.adapter_contract.read_text())
        for key in ['primaryJointMapping','neutralWorldRotations','spine0Fraction','spine2Fraction','boneScales','skinBindAdjustments','neutralTargetWorld','geometryCalibration','helpers']:
            if key not in adapter:raise ValueError('Missing adapter contract field: '+key)
            metadata[key]=adapter[key]
        if np.asarray(metadata['skinBindAdjustments']).shape!=(127,16):raise ValueError('Expected127 skin bind adjustments')
        metadata['calibration']='neutral-rig-2'
        metadata['authorJointCount']=25
    output=args.output/'neutral-mhr-v1.glb'
    write_glb(output,points=points,triangles=faces,names=list(names),parents=parents,bind_world=bind_m,indices=native_indices[:,:4],weights=native_weights[:,:4],metadata=metadata)
    (args.output/'neutral-mhr-v1.json').write_text(json.dumps(metadata,separators=(',',':'))+'\n')
    correctives=write_correctives(args.assets,args.output)
    license_path=args.output/'MHR-LICENSE.txt';license_path.write_bytes((args.assets/'LICENSE.txt').read_bytes())
    if args.momentum_license:
        (args.output/'MOMENTUM-MIT.txt').write_bytes(args.momentum_license.read_bytes())
    licenses=[{'name':p.name,'bytes':p.stat().st_size,'sha256':digest(p)} for p in [args.output/'MHR-LICENSE.txt',args.output/'MOMENTUM-MIT.txt'] if p.exists()]
    descriptor=args.output/'neutral-mhr-v1.json'
    receipt={'status':'canonical25 display asset prepared; application/release verification separate' if args.adapter_contract else 'native source asset; canonical25 calibration pending','sourceRelease':SOURCE_URL,'sourceAssets':sources,'pymomentumLicense':'MIT','output':{'name':output.name,'bytes':output.stat().st_size,'sha256':digest(output),'vertices':len(points),'triangles':len(faces),'joints':len(names),'maxPositiveInfluences':int((native_weights>0).sum(1).max()),'discardedWeightMaximum':float(native_weights[:,4:].max()),'vertexOrder':'unaltered','meshHeightMeters':float(np.ptp(points[:,1]))},'correctives':correctives,'descriptor':{'name':descriptor.name,'bytes':descriptor.stat().st_size,'sha256':digest(descriptor)},'licenses':licenses,'metadata':metadata,'aiGenerationOrWorkersAIInferenceCalls':0}
    (args.output/'MHR-PROVENANCE.json').write_text(json.dumps(receipt,indent=2)+'\n')
    print(json.dumps(receipt['output']))
if __name__=='__main__':main()
