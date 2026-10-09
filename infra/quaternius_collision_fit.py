#!/usr/bin/env python3
"""Selected Quaternius source adapter for the reusable collision fitter.

All 65-bone / 8,483-vertex assumptions belong here, not in the generic fitter.
The frozen GLB/rig are read only. New avatars can supply retargeted neutral
point/region/frame JSON directly to avatar_collision_fit.py instead.
"""
from __future__ import annotations
import hashlib,json,struct
from pathlib import Path
import numpy as np
from quaternius_prepare import accessor
ROOT=Path(__file__).resolve().parents[1]
GLB=ROOT/'apps/web/public/models/neutral-quaternius-v1.glb'
RIG=ROOT/'apps/web/public/models/neutral-quaternius-v1.json'
REGIONS=[
 ('pelvis','Hips','Spine','trunk','box'),
 ('abdomen','Spine','Chest','trunk','box'),
 ('thorax','Chest','Neck','trunk','box'),
 ('neck','Neck','Head','head','box'),
 ('head','Head','Head','head','box'),
]
for side in ['Left','Right']:
 REGIONS += [
  (side+'-upper-arm',side+'UpperArm',side+'ForeArm','arm','capsule'),
  (side+'-forearm',side+'ForeArm',side+'Hand','arm','box'),
  (side+'-hand',side+'Hand',side+'HandTip','arm','box'),
  (side+'-thigh',side+'UpperLeg',side+'LowerLeg','leg','box'),
  (side+'-shank',side+'LowerLeg',side+'Foot','leg','capsule'),
  (side+'-foot',side+'Foot',side+'Foot','foot','box'),
 ]
def sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def group(name: str) -> str:
    if name in ['root', 'pelvis']:
        return 'pelvis'
    if name == 'spine_01':
        return 'abdomen'
    if name in ['spine_02', 'spine_03', 'clavicle_l', 'clavicle_r']:
        return 'thorax'
    if name == 'neck_01':
        return 'neck'
    if name == 'Head':
        return 'head'
    side = 'Left' if name.endswith('_l') else 'Right'
    for native, region in [('upperarm', 'upper-arm'), ('lowerarm', 'forearm'),
                           ('thigh', 'thigh'), ('calf', 'shank'),
                           ('foot', 'foot'), ('ball', 'foot')]:
        if name.startswith(native):
            return side+'-'+region
    return side+'-hand'


def read_skin():
    glb_bytes, rig_bytes = GLB.read_bytes(), RIG.read_bytes()
    magic, version, length = struct.unpack_from('<III', glb_bytes)
    assert magic == 0x46546C67 and version == 2 and length == len(glb_bytes)
    json_length, json_type = struct.unpack_from('<II', glb_bytes, 12)
    assert json_type == 0x4E4F534A
    doc = json.loads(glb_bytes[20:20+json_length])
    binary_length, binary_type = struct.unpack_from('<II', glb_bytes, 20+json_length)
    assert binary_type == 0x004E4942
    binary = glb_bytes[28+json_length:28+json_length+binary_length]
    rig = json.loads(rig_bytes)
    assert rig['schema'] == 'quaternius-rig-1' and rig['vertexCount'] == 8483
    calibration = rig['runtimeCalibration']
    assert calibration['schema'] == 'quaternius-canonical-display-2'
    assert calibration['canonicalRig'] == 'neutral-rig-2'
    assert len(doc['meshes']) == 1 and len(doc['meshes'][0]['primitives']) == 1
    attr = doc['meshes'][0]['primitives'][0]['attributes']
    positions = accessor(doc, binary, attr['POSITION']).astype(float)
    weights = accessor(doc, binary, attr['WEIGHTS_0']).astype(float)
    joints = accessor(doc, binary, attr['JOINTS_0']).astype(int)
    assert positions.shape == (8483, 3) and joints.shape == weights.shape == (8483, 4)
    assert np.isfinite(positions).all() and np.isfinite(weights).all()
    assert np.abs(weights.sum(1)-1).max() < 2e-5
    frames = np.array(calibration['neutralWorldFrames']).reshape(-1, 4, 4).transpose(0, 2, 1)
    adjustments = np.array(calibration['skinBindAdjustments']).reshape(-1, 4, 4).transpose(0, 2, 1)
    inverse = np.array(rig['sourceInverseBindWorld']).reshape(-1, 4, 4).transpose(0, 2, 1)
    matrices = frames @ adjustments @ inverse
    homogeneous = np.c_[positions, np.ones(len(positions))]
    skin = np.zeros((len(positions), 3))
    # Preserve the published Float32 weights; do not normalize them here.
    for slot in range(4):
        transformed = np.einsum('nij,nj->ni', matrices[joints[:, slot]], homogeneous)
        skin += transformed[:, :3] * weights[:, slot, None]
    region_ids = [region[0] for region in REGIONS]
    native_groups = np.array([region_ids.index(group(name)) for name in rig['nativeJointNames']])
    confidence = np.zeros((len(positions), len(REGIONS)))
    for slot in range(4):
        np.add.at(confidence, (np.arange(len(positions)), native_groups[joints[:, slot]]), weights[:, slot])
    assignments = confidence.argmax(1)
    strength = confidence.max(1)
    pivots = {joint: frames[rig['nativeJointNames'].index(native), :3, 3]
              for native, joint in calibration['primaryJointMapping'].items()}
    return skin, assignments, strength, pivots, sha(glb_bytes), sha(rig_bytes), weights, joints, rig



def current_model_input():
 skin, assignments, strength, pivots, glb_sha, rig_sha, weights, joints, rig = read_skin()
 regions=[]
 for name,proximal,distal,family,shape in REGIONS:
  attachments=list(dict.fromkeys([proximal,distal]))
  if family=='foot':attachments += [proximal[:-4]+'Toe',proximal[:-4]+'Heel']
  parts=1
  regions.append({'id':name,'frame':proximal,'attachmentJoints':attachments,'family':family,'shape':'convex',
    'orientation':'bone','parts':[{'axis':1,'count':parts}],
    'minimumDominantGroupWeight':0})
 pairs=[]
 for at,a in enumerate(regions):
  for b in regions[at+1:]:
   if set(a['attachmentJoints'])&set(b['attachmentJoints']):continue
   if any(x['id']=='thorax'and y['frame'].endswith('UpperArm')or x['id']=='pelvis'and y['frame'].endswith('UpperLeg')or x['id']=='head'and y['id']=='thorax' for x,y in [(a,b),(b,a)]):continue
   pairs.append([a['id'],b['id']])
 return {'auditNonAdjacentPairs':pairs,'schema':'avatar-neutral-collision-input-1','profileId':'quaternius-mixed-collision-1','version':1,
  'canonicalRig':'neutral-rig-2','sourceGlbSha256':glb_sha,'sourceRigSha256':rig_sha,
  'positions':skin.tolist(),'regionAssignments':[REGIONS[i][0] for i in assignments],
  'groupConfidence':strength.tolist(),'regions':regions,
  'frames':{name:{'position':pivot.tolist(),'rotation':[0,0,0,1]}for name,pivot in pivots.items()},
  'footGround':{'halfWidthMeters':.048,'soleOffsetMeters':.082,'heelZ':-.075,'toeZ':.165,'topOffsetMeters':-.004}}


if __name__=='__main__':
 from avatar_collision_fit import main
 main()
