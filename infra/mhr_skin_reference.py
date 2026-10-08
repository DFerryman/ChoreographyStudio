"""Independent oracle: official original MHR FBX+model, original 8-slot weights,
original native offsets/bind, and NumPy/SciPy evaluation of upstream NPZ PSD.
Controller contributes only pose-input rotations; it never supplies reference
posed points, weights, inverse binds, sparse matrices, or corrective outputs.
"""
from pathlib import Path
import json,hashlib,numpy as np
from scipy.spatial.transform import Rotation
from scipy.sparse import coo_matrix
import argparse
parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('--source-dir',type=Path,required=True,help='Official MHR v1.0.1 lod3.fbx, compact model, original two NPZ assets and LICENSE.txt')
parser.add_argument('--descriptor',type=Path,required=True,help='Validated native model calibration JSON')
parser.add_argument('--native-input',type=Path,required=True,help='Frozen native parameter XYZW fixture; its expected points are never read as reference')
parser.add_argument('--author-definition-source',type=Path,required=True,help='neutral-rig-2 humanoid.ts, checked against its frozen SHA')
parser.add_argument('--output',type=Path,required=True)
args=parser.parse_args(); AS=args.source_dir
import pymomentum.geometry as g
desc=json.loads(args.descriptor.read_text());seed=json.loads(args.native_input.read_text())
if hashlib.sha256(args.author_definition_source.read_bytes()).hexdigest()!=seed['canonicalCalibration']['authorDefinitionSourceSha256']:raise ValueError('The frozen author rest contract changed; do not silently rebaseline reference data.')
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
for name,record in seed['sources'].items():
 if sha(AS/name)!=record['sha256']:raise ValueError('Official source checksum mismatch: '+name)
c=g.Character.load_fbx(str(AS/'lod3.fbx'),str(AS/'compact_v6_1.model'),load_blendshapes=True);n=127;parents=c.skeleton.joint_parents;pre=Rotation.from_quat(c.skeleton.pre_rotations).as_matrix();origin=np.array(desc['sourceRootOriginMeters'])
activation=np.load(AS/'corrective_activation.npz');a_row,a_col=activation['0.sparse_indices'];A=coo_matrix((activation['0.sparse_weight'],(a_row,a_col)),shape=(3000,750)).tocsr()
directions=np.load(AS/'corrective_blendshapes_lod3.npz')['corrective_blendshapes'];b_row,b_vertex,b_axis=np.nonzero(directions);B=coo_matrix((directions[b_row,b_vertex,b_axis],(b_vertex*3+b_axis,b_row)),shape=(4899*3,3000)).tocsr();del directions
ids=[1186,1225,1231,1235,1257,1264,1302,1727,1728,1729,1730,1731,1744,1745]
sourcefiles=['lod3.fbx','compact_v6_1.model','corrective_activation.npz','corrective_blendshapes_lod3.npz','LICENSE.txt']
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
out={k:v for k,v in seed.items() if k not in ['poses','runtimeSourceSha256']};out['poses']={}
# Frozen author-rest contract. These offsets are independently transcribed
# from neutral-rig-2 and its file hash is retained in the receipt. We do not
# invoke evaluatePose, MHRRig, Three.js skinning, or copy runtime final points.
author_defs=[('Hips',None,[0,0,0]),('Spine','Hips',[0,.14,0]),('Chest','Spine',[0,.2,0]),('Neck','Chest',[0,.19,0]),('Head','Neck',[0,.08,0])]
for side,sign in [('Left',1),('Right',-1)]:
 for joint,parent,offset in [('Shoulder','Chest',[sign*.1,.095,0]),('UpperArm',side+'Shoulder',[sign*.11,-.03,0]),('ForeArm',side+'UpperArm',[0,-.285,0]),('Hand',side+'ForeArm',[0,-.255,0]),('HandTip',side+'Hand',[0,-.115,0]),('UpperLeg','Hips',[sign*.112,-.05,0]),('LowerLeg',side+'UpperLeg',[0,-.46,0]),('Foot',side+'LowerLeg',[0,-.45,0]),('Toe',side+'Foot',[0,-.035,.15]),('Heel',side+'Foot',[0,-.035,-.065])]: author_defs.append((side+joint,parent,offset))
def author_fk(degrees):
 R={};T={}
 for name,parent,offset in author_defs:
  # SciPy uppercase XYZ is intrinsic, matching the editor's EulerXYZ input;
  # the native MHR PARAM uses lowercase extrinsic xyz, a separate frame.
  local=Rotation.from_euler('XYZ',degrees.get(name,[0,0,0]),degrees=True).as_matrix()
  R[name]=(R[parent] if parent else np.eye(3))@local
  T[name]=(T[parent]+R[parent]@offset) if parent else np.array(offset,float)
 return R,T
source_bind=c.bind_pose.astype(float).copy();source_bind[:,:3,3]=source_bind[:,:3,3]/100-origin
source_inverse=np.linalg.inv(source_bind);source_rot=source_bind[:,:3,:3];source_pos=source_bind[:,:3,3];neutral_rot=Rotation.from_quat(desc['neutralWorldRotations']).as_matrix()
fixed_C=np.array(desc['skinBindAdjustments']).reshape(127,4,4).transpose(0,2,1);fixed_scales=np.array(desc['boneScales']);mapping=desc['primaryJointMapping'];index={name:i for i,name in enumerate(c.skeleton.joint_names)}
def calibrated_native_skin(native_state,author_degrees,corrective):
 ar,at=author_fk(author_degrees);r=Rotation.from_quat(native_state[:,3:7]).as_matrix();t=[]
 for i,name in enumerate(c.skeleton.joint_names):
  parent=parents[i]
  if name=='body_world':point=source_pos[i]
  elif name in mapping:point=at[mapping[name]]
  elif name in ['c_spine0','c_spine2']:
   lower,upper,fraction=('Hips','Spine',desc['spine0Fraction']) if name=='c_spine0' else ('Spine','Chest',desc['spine2Fraction']);point=at[lower]*(1-fraction)+at[upper]*fraction
  elif name.endswith('_proc') and '_twist' in name:
   stem,suffix=name.rsplit('_twist',1);k=int(suffix[0])
   if stem.endswith(('uparm','upleg')):end=stem.replace('uparm','lowarm').replace('upleg','lowleg');lower,upper,fraction=mapping[stem],mapping[end],k/4
   elif stem.endswith(('lowarm','lowleg')):end=stem.replace('lowarm','wrist').replace('lowleg','foot');lower,upper,fraction=mapping[stem],mapping[end],k/5
   else:lower,upper,fraction='Neck','Head',k/2
   point=at[lower]*(1-fraction)+at[upper]*fraction
  elif name.endswith('wrist_twist'):point=at['LeftHand' if name.startswith('l_') else 'RightHand']
  elif name.split('_',1)[-1] in ['talocrural','subtalar','transversetarsal']:
   side='Left' if name.startswith('l_') else 'Right';foot=index[name[0]+'_foot'];point=at[side+'Foot']+ar[side+'Foot']@neutral_rot[foot]@source_rot[foot].T@(source_pos[i]-source_pos[foot])
  else:point=t[parent]+r[parent]@source_rot[parent].T@(source_pos[i]-source_pos[parent])
  t.append(point)
 target=np.tile(np.eye(4),(127,1,1));target[:,:3,:3]=r*fixed_scales[:,None,:];target[:,:3,3]=t
 skin=target@fixed_C@source_inverse
 rest=c.mesh.vertices.astype(float)/100-origin+corrective.astype(float)/100;homogeneous=np.column_stack([rest,np.ones(len(rest))]);result=np.zeros((len(rest),3))
 for slot in range(8):
  influence=c.skin_weights.index[:,slot];weight=c.skin_weights.weight[:,slot];result+=np.einsum('vij,vj->vi',skin[influence,:3,:],homogeneous)*weight[:,None]
 return result,target
out['canonicalCalibration']['descriptorSha256']=sha(args.descriptor)
for label,deg in [('neutral',0),('raised150',150),('raised170',170)]:
 P=seed['poses'][label];pr=np.array(P['nativeParameterQuaternionsXYZW'],float)
 if pr.shape!=(127,4) or not np.isfinite(pr).all() or np.max(np.abs(np.linalg.norm(pr,axis=1)-1))>1e-5:raise ValueError('Invalid native pose input quaternions')
 params=np.zeros((127,7),np.float32);params[:,3:6]=Rotation.from_quat(pr).as_euler('xyz')
 # PSD is recomputed from original source assets, never copied from controller.
 parameterR=Rotation.from_euler('xyz',params[2:,3:6]).as_matrix();features=np.concatenate([parameterR[:,:,0],parameterR[:,:,1]],axis=1);features[:,0]-=1;features[:,4]-=1
 corrective=(B@np.maximum(A@features.ravel(),0)).reshape(4899,3).astype(np.float32)
 nativeState=g.joint_parameters_to_skeleton_state(c,params.ravel());points=c.skin_points(nativeState,c.mesh.vertices+corrective)/100-origin
 author_degrees={} if deg==0 else {'LeftUpperArm':[0,0,deg]};calibrated,target=calibrated_native_skin(nativeState,author_degrees,corrective)
 out['poses'][label]={'authorRotationsDegrees':author_degrees,'nativeParameterQuaternionsXYZW':pr.tolist(),'officialSourceChestPointsMeters':points[ids].tolist(),'officialCalibratedChestPointsMeters':calibrated[ids].tolist()}
for label in ['raised150','raised170']:
 p=out['poses'][label];src=np.array(p['officialSourceChestPointsMeters']);src0=np.array(out['poses']['neutral']['officialSourceChestPointsMeters']);cal=np.array(p['officialCalibratedChestPointsMeters']);cal0=np.array(out['poses']['neutral']['officialCalibratedChestPointsMeters']);motion=np.linalg.norm(src-src0,axis=1);at=int((len(ids)-1)*.95)
 p['officialSourceChestMotionP95Meters']=float(np.sort(motion)[at]);p['officialCalibratedChestMotionVectorsMeters']=(cal-cal0).tolist();p['formerAbsolute25mmGatePassed']=bool(np.sort(np.linalg.norm(cal-cal0,axis=1))[at]<.025)
out['historicalFirstRuntime']={'formalTestsPassed':4,'formalTestsTotal':5,'170ShoulderCollapsedFaces':3,'shoulderFaces':72,'collapsedShoulderFraction':3/72,'150ChestMotionP95Meters':.021487118250470706,'170ChestMotionP95Meters':.023073497363785046,'sourceHelperDriver':'compact Euler.rx coupled directly across canonical axis schema','reasonForRevisedMethod':'After axial retarget, official original native skin plus independently calculated upstream PSD itself gives natural same-vertex 170 chest motion above the former unvalidated 25 mm line. Preserve source deformation and validate source parity instead of suppressing the muscle response.'}
args.output.write_text(json.dumps(out,indent=2)+'\n');print(str(args.output))
