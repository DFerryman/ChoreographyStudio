#!/usr/bin/env python3
"""Declare fixed Quaternius display calibration without altering source data.

The source GLB/weights/inverse binds remain raw. This separate runtime field
aligns display pivots to neutral-rig-2 and records fixed presentation matrices.
It computes from published source frames and a frozen author-rig contract,
never by recording the runtime controller's output. Requires NumPy.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
from pathlib import Path

import numpy as np

CANONICAL_SOURCE_SHA256 = '9f01217d4fa6168effc7561d8c96509bb7be763a8082e43717d2f78088806883'


def normalize(q: np.ndarray) -> np.ndarray:
    return q / np.linalg.norm(q)


def multiply(a: np.ndarray, b: np.ndarray) -> np.ndarray:
    return np.r_[a[3]*b[:3] + b[3]*a[:3] + np.cross(a[:3], b[:3]), a[3]*b[3] - a[:3].dot(b[:3])]


def inverse(q: np.ndarray) -> np.ndarray:
    return np.r_[-q[:3], q[3]]


def rotate(q: np.ndarray, v: np.ndarray) -> np.ndarray:
    return multiply(multiply(q, np.r_[v, 0]), inverse(q))[:3]


def from_rotation(m: np.ndarray) -> np.ndarray:
    trace = np.trace(m)
    if trace > 0:
        s = .5 / math.sqrt(trace + 1)
        q = np.array([(m[2,1]-m[1,2])*s, (m[0,2]-m[2,0])*s, (m[1,0]-m[0,1])*s, .25/s])
    elif m[0,0] > m[1,1] and m[0,0] > m[2,2]:
        s = 2*math.sqrt(1+m[0,0]-m[1,1]-m[2,2])
        q = np.array([.25*s, (m[0,1]+m[1,0])/s, (m[0,2]+m[2,0])/s, (m[2,1]-m[1,2])/s])
    elif m[1,1] > m[2,2]:
        s = 2*math.sqrt(1+m[1,1]-m[0,0]-m[2,2])
        q = np.array([(m[0,1]+m[1,0])/s, .25*s, (m[1,2]+m[2,1])/s, (m[0,2]-m[2,0])/s])
    else:
        s = 2*math.sqrt(1+m[2,2]-m[0,0]-m[1,1])
        q = np.array([(m[0,2]+m[2,0])/s, (m[1,2]+m[2,1])/s, .25*s, (m[1,0]-m[0,1])/s])
    return normalize(q)


def compose(position: np.ndarray, q: np.ndarray, scale: np.ndarray) -> np.ndarray:
    v, w = q[:3], q[3]
    cross = np.array([[0, -v[2], v[1]], [v[2], 0, -v[0]], [-v[1], v[0], 0]])
    result = np.eye(4)
    result[:3,:3] = (np.eye(3) + 2*w*cross + 2*cross@cross) * scale[None,:]
    result[:3,3] = position
    return result


def declare(description: dict) -> dict:
    names = description['nativeJointNames']
    parents = description['nativeJointParents']
    source = np.array(description['sourceBindWorld']).reshape(-1,4,4).transpose(0,2,1)
    raw_positions = source[:,:3,3]
    raw_scales = np.linalg.norm(source[:,:3,:3], axis=1)
    raw_rotations = np.array([from_rotation(frame[:3,:3]/scale[None,:]) for frame,scale in zip(source,raw_scales)])
    uniform = 1.85 / description['sourceHeightMeters']
    rotations = raw_rotations.copy()
    scales = raw_scales * uniform
    mapping = {'pelvis':'Hips','spine_01':'Spine','spine_03':'Chest','neck_01':'Neck','Head':'Head'}
    definitions = [('Hips',None,[0,0,0]), ('Spine','Hips',[0,.14,0]),
                   ('Chest','Spine',[0,.2,0]), ('Neck','Chest',[0,.19,0]), ('Head','Neck',[0,.08,0])]
    for suffix,side,sign in [('l','Left',1),('r','Right',-1)]:
        for native,author in [('clavicle','Shoulder'),('upperarm','UpperArm'),('lowerarm','ForeArm'),('hand','Hand'),
                             ('thigh','UpperLeg'),('calf','LowerLeg'),('foot','Foot'),('ball','Toe')]:
            mapping[native+'_'+suffix] = side+author
        definitions.extend([(side+'Shoulder','Chest',[sign*.1,.095,0]),
                            (side+'UpperArm',side+'Shoulder',[sign*.11,-.03,0]),
                            (side+'ForeArm',side+'UpperArm',[0,-.285,0]),
                            (side+'Hand',side+'ForeArm',[0,-.255,0]),
                            (side+'HandTip',side+'Hand',[0,-.115,0]),
                            (side+'UpperLeg','Hips',[sign*.112,-.05,0]),
                            (side+'LowerLeg',side+'UpperLeg',[0,-.46,0]),
                            (side+'Foot',side+'LowerLeg',[0,-.45,0]),
                            (side+'Toe',side+'Foot',[0,-.035,.15]),
                            (side+'Heel',side+'Foot',[0,-.035,-.065])])
        for start,end,length in [('upperarm','lowerarm',.285),('lowerarm','hand',.255),('thigh','calf',.46),('calf','foot',.45)]:
            at,child = names.index(start+'_'+suffix),names.index(end+'_'+suffix)
            displacement = raw_positions[child] - raw_positions[at]
            direction = displacement / np.linalg.norm(displacement)
            down = np.array([0.,-1.,0.])
            swing = normalize(np.r_[np.cross(direction,down),1+np.dot(direction,down)])
            rotations[at] = normalize(multiply(swing,raw_rotations[at]))
            scales[at,1] = raw_scales[at,1] * length / np.linalg.norm(displacement)
        hand,forearm = names.index('hand_'+suffix),names.index('lowerarm_'+suffix)
        rotations[hand] = normalize(multiply(multiply(rotations[forearm],inverse(raw_rotations[forearm])),raw_rotations[hand]))
    rest = {}
    for name,parent,offset in definitions:
        rest[name] = np.array(offset,dtype=float) + (rest[parent] if parent else 0)
    spine2,spine3 = names.index('spine_02'),names.index('spine_03')
    fraction = np.linalg.norm(description['sourceLocalTranslation'][spine2]) / (
        np.linalg.norm(description['sourceLocalTranslation'][spine2])+np.linalg.norm(description['sourceLocalTranslation'][spine3]))
    positions = np.zeros((65,3))
    frames = np.zeros((65,4,4))
    for at in description['topoOrder']:
        name,parent = names[at],parents[at]
        if name in mapping:
            positions[at] = rest[mapping[name]]
        elif name == 'spine_02':
            positions[at] = rest['Spine']*(1-fraction) + rest['Chest']*fraction
        elif parent < 0:
            positions[at] = 0
        else:
            rotations[at] = normalize(multiply(rotations[parent],normalize(np.array(description['sourceLocalRotation'][at]))))
            offset = rotate(inverse(raw_rotations[parent]),raw_positions[at]-raw_positions[parent])
            offset *= scales[parent]/raw_scales[parent]
            positions[at] = positions[parent]+rotate(rotations[parent],offset)
            scales[at] = raw_scales[at]*uniform
        frames[at] = compose(positions[at],rotations[at],scales[at])
    adjustments = np.repeat(np.eye(4)[None,:,:],65,axis=0)
    original_inverse = np.array(description['sourceInverseBindWorld']).reshape(-1,4,4).transpose(0,2,1)

    def scale_around(origin: np.ndarray,factor: float) -> np.ndarray:
        affine = np.diag([1.,factor,1.,1.])
        affine[:3,3] = origin-affine[:3,:3]@origin
        return affine

    feet_factors = []
    for suffix in ['l','r']:
        foot,ball,leaf = [names.index(part+'_'+suffix) for part in ['foot','ball','ball_leaf']]
        factor = .082 / ((raw_positions[foot,1]-description['sourceBounds']['min'][1])*uniform)
        feet_factors.append(float(factor))
        adjustments[foot] = np.linalg.inv(frames[foot]) @ scale_around(positions[foot],factor) @ frames[foot]
        neutral_foot_skin = frames[foot] @ adjustments[foot] @ original_inverse[foot]
        for at in [ball,leaf]:
            adjustments[at] = np.linalg.inv(frames[at]) @ neutral_foot_skin @ source[at]
    # Preserve one coherent source torso, shoulder, neck and head silhouette.
    # Their physical control frames stay canonical; only the effective skin
    # bind changes. The source floor and top become stage 0 and 1.85 metres
    # at the unchanged neutral author root Y=1.05. No extra head fit occurs.
    body_similarity = np.diag([uniform,uniform,uniform,1.])
    body_similarity[1,3] = -1.05-description['sourceBounds']['min'][1]*uniform
    arm_depth = (raw_positions[names.index('upperarm_l'),2]+raw_positions[names.index('upperarm_r'),2])/2
    body_similarity[2,3] = -arm_depth*uniform
    body_names = ['root','pelvis','spine_01','spine_02','spine_03',
                  'clavicle_l','clavicle_r','neck_01','Head']
    for name in body_names:
        at = names.index(name)
        adjustments[at] = np.linalg.inv(frames[at]) @ body_similarity @ source[at]
    return {'schema':'quaternius-canonical-display-2','canonicalRig':'neutral-rig-2',
            'canonicalRigSourceSha256':CANONICAL_SOURCE_SHA256,
            'neutralAuthorRootY':1.05,'armDownDegrees':0,'footSurfaceDepthMeters':.082,'targetHeadTopWorldMeters':1.85,
            'sourceUniformScale':float(uniform),'spine2Fraction':float(fraction),'primaryJointMapping':mapping,
            'neutralWorldRotations':rotations.tolist(),'boneScales':scales.tolist(),
            'neutralWorldFrames':frames.transpose(0,2,1).reshape(-1,16).tolist(),
            'skinBindAdjustments':adjustments.transpose(0,2,1).reshape(-1,16).tolist(),
            'footVerticalFactors':feet_factors,'headVerticalFactor':1.,
            'sourceBodySimilarity':body_similarity.T.reshape(16).tolist(),
            'sourceBodyJointNames':body_names,'bodySimilarityAnchor':'source-sole-to-stage-ground',
            'bodyDepthAnchor':'mean-source-upperarm-to-canonical-upperarm',
            'headFitOriginSourceBone':None,
            'calibrationScope':'Fixed canonical physical frames with one source-floor-normalized torso/clavicle/neck/head similarity skin bind, unchanged canonical limb fit and 82mm foot calibration; raw source arrays, weights, TRS and inverse binds remain independently preserved.',
            'inverseBindUse':'Clone runtime inverse binds and premultiply declared fixed adjustments; never overwrite raw GLB inverse binds.'}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--rig-json',required=True,type=Path)
    parser.add_argument('--canonical-humanoid',required=True,type=Path)
    parser.add_argument('--output',required=True,type=Path,help='Standalone calibration declaration JSON')
    parser.add_argument('--embed',action='store_true',help='After review, add only the runtimeCalibration sidecar field')
    parser.add_argument('--provenance',type=Path)
    args = parser.parse_args()
    if hashlib.sha256(args.canonical_humanoid.read_bytes()).hexdigest() != CANONICAL_SOURCE_SHA256:
        raise ValueError('Author rig changed; review and version this fixed display contract')
    description = json.loads(args.rig_json.read_bytes())
    calibration = declare(description)
    args.output.parent.mkdir(parents=True,exist_ok=True)
    args.output.write_text(json.dumps(calibration,indent=2)+'\n')
    if args.embed:
        raw_description = {key:value for key,value in description.items() if key != 'runtimeCalibration'}
        description['runtimeCalibration'] = calibration
        if {key:value for key,value in description.items() if key != 'runtimeCalibration'} != raw_description:
            raise ValueError('Raw source metadata must remain unchanged')
        args.rig_json.write_text(json.dumps(description,separators=(',',':'))+'\n')
        if args.provenance:
            provenance = json.loads(args.provenance.read_bytes())
            provenance['descriptor'] = {'name':args.rig_json.name,'bytes':args.rig_json.stat().st_size,
                                         'sha256':hashlib.sha256(args.rig_json.read_bytes()).hexdigest()}
            provenance['runtimeCalibration'] = {'schema':calibration['schema'],'canonicalRig':'neutral-rig-2',
                'sourceRigUnchanged':True,'displayMappedJoints':21,'armDownDegrees':0,'footSurfaceDepthMeters':.082,
                'targetHeadTopWorldMeters':1.85,'neutralAuthorRootY':1.05,
                'method':'Offline independent NumPy reconstruction from raw source world frames and the fixed canonical author offsets, not runtime output capture',
                'rawSourceGltfAndGlbInverseBindsUnchanged':True,
                'shapeAdjustments':'One coherent source-floor-normalized torso/clavicle/neck/head similarity bind; no head stretch or compression; fixed foot/ball/leaf 82mm affine corrections on runtime clones only',
                'sourceBodyJointNames':calibration['sourceBodyJointNames'],
                'bodySimilarityAnchor':calibration['bodySimilarityAnchor'],
                'bodyDepthAnchor':calibration['bodyDepthAnchor'],
                'scope':'Display calibration declared; actual editing, author-priority and contact verification remain separate.'}
            args.provenance.write_text(json.dumps(provenance,indent=2)+'\n')
    print(json.dumps({'schema':calibration['schema'],'declarationBytes':args.output.stat().st_size,
                      'declarationSha256':hashlib.sha256(args.output.read_bytes()).hexdigest(),
                      'spine2Fraction':calibration['spine2Fraction'],'footVerticalFactors':calibration['footVerticalFactors'],
                      'headVerticalFactor':calibration['headVerticalFactor'],'embedded':args.embed}))


if __name__ == '__main__':
    main()
