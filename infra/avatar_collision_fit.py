#!/usr/bin/env python3
"""Reusable offline collision-proxy fitting for retargeted avatar geometry.

Python 3.11+ with NumPy and SciPy. Default input is the selected Quaternius adapter:
  python infra/avatar_collision_fit.py
  python infra/avatar_collision_fit.py --check

For a different model supply avatar-neutral-collision-input-1 JSON with displayed
neutral positions, anatomical region labels, region configuration and canonical
joint frames. No vertex-count, model name, height, skin joint count, source hash
or symmetry is assumed. --output and --report choose generated destinations.
Primitive fit orientation, axial partitions and confidence thresholds are explicit
model input, not hidden hand-tuned radii copied from the previous avatar.
"""
from __future__ import annotations
import argparse,copy,hashlib,json
from pathlib import Path
import numpy as np
import math
from scipy.spatial import ConvexHull,cKDTree
from scipy.optimize import linprog
ROOT=Path(__file__).resolve().parents[1]
FIT_MARGIN=.0005
QUANTILE=.005
CAPSULE_RADIUS_QUANTILE=.95
GEOMETRY_DECIMALS=9


def quantized_points(values):
    points=np.round(np.asarray(values,dtype=float),GEOMETRY_DECIMALS)
    # Normalize negative zero as well as insignificant arithmetic tails.
    points[points==0]=0
    return points


def canonicalize_geometry(payload):
    value=copy.deepcopy(payload)
    value['positions']=quantized_points(value['positions']).tolist()
    for frame in value['frames'].values():
        frame['position']=quantized_points(frame['position']).tolist()
        q=quantized_points(frame['rotation']).tolist()
        if len(q)!=4 or not all(math.isfinite(component)for component in q):
            raise ValueError('Expected a finite XYZW rotation')
        # Explicit scalar operation order avoids a BLAS-dependent reduction.
        length=math.sqrt(sum(component*component for component in q))
        if length<1e-12 or abs(length-1)>1e-5:
            raise ValueError('Expected a unit XYZW rotation')
        sign=1 if q[max(range(4),key=lambda at:abs(q[at]))]>=0 else -1
        frame['rotation']=[sign*component/length if component else 0.0 for component in q]
    return value


def geometry_digest(payload):
    def decimal_values(values):
        return [format(float(value)if value else 0.0,'.9f')for value in values]
    canonical={'quantizationDecimals':GEOMETRY_DECIMALS,
               'positions':[decimal_values(point)for point in payload['positions']],
               'labels':payload['regionAssignments'],
               'frames':{name:{'position':decimal_values(frame['position']),
                               'rotation':decimal_values(frame['rotation'])}
                         for name,frame in payload['frames'].items()}}
    return hashlib.sha256(json.dumps(canonical,sort_keys=True,separators=(',',':')).encode()).hexdigest()

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
    return np.asarray(q)/np.linalg.norm(q)



def quaternion_matrix(q):
 x,y,z,w=q
 return np.array([[1-2*y*y-2*z*z,2*x*y-2*z*w,2*x*z+2*y*w],
                  [2*x*y+2*z*w,1-2*x*x-2*z*z,2*y*z-2*x*w],
                  [2*x*z-2*y*w,2*y*z+2*x*w,1-2*x*x-2*y*y]])

def pca(points):
    mean = points.mean(0)
    values, rotation = np.linalg.eigh(np.cov(points.T))
    rotation = rotation[:, np.argsort(values)[::-1]]
    # Resolve eigenvector signs so repeated generation has an unambiguous frame.
    for axis in range(2):
        principal = int(np.abs(rotation[:, axis]).argmax())
        if rotation[principal, axis] < 0:
            rotation[:, axis] *= -1
    rotation[:, 2] = np.cross(rotation[:, 0], rotation[:, 1])
    return mean, rotation, (points-mean) @ rotation


def rounded(values):
    return [float(round(float(value),GEOMETRY_DECIMALS)) if value else 0.0 for value in values]


def box_fit(points, pivot, orientation):
    if orientation == "pca":
        mean, rotation, local = pca(points)
    else:
        mean = points.mean(0)
        rotation = np.eye(3)
        local = points-mean
    lower = np.quantile(local, QUANTILE, axis=0)
    upper = np.quantile(local, 1-QUANTILE, axis=0)
    center = mean + rotation @ ((lower+upper)/2)
    return {'centerOffset': rounded(center-pivot),
            'halfExtents': rounded((upper-lower)/2+FIT_MARGIN),
            'localRotation': rounded(matrix_quaternion(rotation))}


def capsule_fit(points, pivot):
    mean, rotation, local = pca(points)
    lower = np.quantile(local, QUANTILE, axis=0)
    upper = np.quantile(local, 1-QUANTILE, axis=0)
    radial_center = (lower[1:]+upper[1:])/2
    radial = np.linalg.norm(local[:, 1:]-radial_center, axis=1)
    radius = float(np.quantile(radial, CAPSULE_RADIUS_QUANTILE)+FIT_MARGIN)
    inside = radial <= radius
    slack = np.sqrt(np.maximum(0, radius**2-radial[inside]**2))
    start = float(np.min(local[inside, 0]+slack))
    end = float(np.max(local[inside, 0]-slack))
    if start > end:
        start = end = (start+end)/2
    a = mean + rotation @ np.r_[start, radial_center]
    b = mean + rotation @ np.r_[end, radial_center]
    return {'proximalOffset': rounded(a-pivot), 'distalOffset': rounded(b-pivot),
            'radiusMeters': float(round(radius, 9))}


def coverage(points, collider, pivots):
    pivot = pivots[collider['proximal']]
    if collider['shape'] == 'box':
        # Quaternion-to-matrix, independent of the app's collision evaluator.
        x, y, z, w = collider['localRotation']
        r = np.array([[1-2*y*y-2*z*z, 2*x*y-2*z*w, 2*x*z+2*y*w],
                      [2*x*y+2*z*w, 1-2*x*x-2*z*z, 2*y*z-2*x*w],
                      [2*x*z-2*y*w, 2*y*z+2*x*w, 1-2*x*x-2*y*y]])
        local = (points-pivot-collider['centerOffset']) @ r
        outside = np.maximum(np.abs(local)-collider['halfExtents'], 0)
        distances = np.linalg.norm(outside, axis=1)
    else:
        a = pivot+collider['proximalOffset']
        b = pivot+collider['distalOffset']
        delta = b-a
        length_squared = np.dot(delta, delta)
        t = np.clip((points-a) @ delta / length_squared, 0, 1) if length_squared > 1e-15 else np.zeros(len(points))
        distances = np.maximum(np.linalg.norm(points-a-t[:, None]*delta, axis=1)-collider['radiusMeters'], 0)
    return distances



def convex_fit(points, pivot):
    hull=ConvexHull(points)
    vertices=np.array(sorted([rounded(point-pivot) for point in points[hull.vertices]]))
    lower,upper=vertices.min(0),vertices.max(0)
    rounded_hull=ConvexHull(vertices)
    triangles=[]
    for face,plane in zip(rounded_hull.simplices,rounded_hull.equations):
        a,b,c=map(int,face)
        if np.dot(np.cross(vertices[b]-vertices[a],vertices[c]-vertices[a]),plane[:3])<0:
            b,c=c,b
        triangle=[a,b,c]
        at=triangle.index(min(triangle))
        triangles.append(triangle[at:]+triangle[:at])
    indices=[value for triangle in sorted(triangles)for value in triangle]
    return {'vertices':vertices.tolist(), 'indices':indices, 'bboxCenterOffset':rounded((lower+upper)/2),
            'bboxHalfExtents':rounded((upper-lower)/2+FIT_MARGIN), 'bboxRotation':[0,0,0,1]}

def distance_to_collider(points, collider, frames):
    frame = frames[collider['proximal']]
    local = (points-np.asarray(frame['position'])) @ quaternion_matrix(frame['rotation'])
    if collider['shape']=='convex':
        hull=ConvexHull(np.asarray(collider['vertices']))
        return np.maximum(np.max(local @ hull.equations[:,:3].T + hull.equations[:,3],axis=1),0)
    return coverage(local, collider, {collider['proximal']: np.zeros(3)})


def fit_model(payload):
    if payload.get('schema') != 'avatar-neutral-collision-input-1':
        raise ValueError('Expected avatar-neutral-collision-input-1')
    payload=canonicalize_geometry(payload)
    positions = np.asarray(payload['positions'], dtype=float)
    labels = np.asarray(payload['regionAssignments'])
    confidence = np.asarray(payload.get('groupConfidence', np.ones(len(positions))), dtype=float)
    if positions.ndim != 2 or positions.shape[1] != 3 or not 4 <= len(positions) <= 1000000 or not np.isfinite(positions).all():
        raise ValueError('Neutral positions must be 4..1,000,000 finite XYZ points')
    if labels.shape != (len(positions),) or confidence.shape != (len(positions),) or not np.isfinite(confidence).all() or np.any((confidence < 0) | (confidence > 1.00002)):
        raise ValueError('Invalid region labels or confidence')
    frames, regions = payload['frames'], payload['regions']
    if len({r['id'] for r in regions}) != len(regions) or set(labels)-{r['id'] for r in regions}:
        raise ValueError('Every assigned anatomical region needs one unique definition')
    for frame in frames.values():
        p, q = np.asarray(frame['position']), np.asarray(frame['rotation'])
        if p.shape != (3,) or q.shape != (4,) or not np.isfinite(p).all() or not np.isfinite(q).all() or abs(np.linalg.norm(q)-1) > 1e-5:
            raise ValueError('Expected finite canonical frames and unit XYZW rotations')
    colliders, summaries = [], []
    for region in regions:
        name, joint = region['id'], region['frame']
        if joint not in frames or region['family'] not in ['trunk','head','arm','leg','foot'] or region['shape'] not in ['box','capsule','convex']:
            raise ValueError('Invalid collision region: '+name)
        points = positions[labels == name]
        threshold = float(region.get('minimumDominantGroupWeight', 0))
        fit_points = positions[(labels == name) & (confidence >= threshold)]
        if len(fit_points) < 4:
            raise ValueError('Need at least four fit vertices for '+name)
        frame = frames[joint]
        fit_local = quantized_points((fit_points-np.asarray(frame['position'])) @ quaternion_matrix(frame['rotation']))
        partition_rules = region.get('parts', [{'axis':1,'count':1}])
        if isinstance(partition_rules, dict):
            partition_rules = [partition_rules]
        selected_parts = [fit_local]
        for partitions in partition_rules:
            axis, count = int(partitions['axis']), int(partitions['count'])
            if axis not in [0,1,2] or count < 1 or count > 16:
                raise ValueError('Invalid deterministic axial partition')
            lo, hi = fit_local[:,axis].min(), fit_local[:,axis].max()
            divided = []
            for subset in selected_parts:
                bins = np.minimum(count-1,np.floor((subset[:,axis]-lo)/(hi-lo)*count).astype(int)) if hi>lo else np.zeros(len(subset),dtype=int)
                divided += [subset[bins == part] for part in range(count) if np.count_nonzero(bins==part)]
            selected_parts = divided
        count = len(selected_parts)
        region_colliders = []
        for part, selected in enumerate(selected_parts):
            if len(selected) < 4:
                raise ValueError('Partition has fewer than four vertices: '+name+'/'+str(part))
            collider = {'shape':region['shape'], 'id':name if part == 0 else name+'-'+str(part),
                        'anatomicalRegion':name, 'proximal':joint, 'distal':joint,
                        'attachmentJoints':region['attachmentJoints'], 'family':region['family']}
            collider.update(box_fit(selected, np.zeros(3), region.get('orientation','bone'))
                            if region['shape']=='box' else capsule_fit(selected,np.zeros(3)) if region['shape']=='capsule' else convex_fit(selected,np.zeros(3)))
            region_colliders.append(collider)
        colliders += region_colliders
        distances = np.min(np.array([distance_to_collider(points,c,frames) for c in region_colliders]), axis=0)
        summaries.append({'id':name,'shape':region['shape'],'parts':count,'orientation':region.get('orientation','bone'),
                          'assignedVertices':len(points),'stableFitVertices':len(fit_points),
                          'minimumDominantGroupWeight':threshold,
                          'coveredAssignedVertices':int(np.count_nonzero(distances <= 1e-8)),
                          'coverageFraction':float(round(np.mean(distances <= 1e-8),6)),
                          'hullVertices':sum(len(c['vertices'])for c in region_colliders if c['shape']=='convex'),
                          'hullTriangles':sum(len(ConvexHull(c['vertices']).simplices)for c in region_colliders if c['shape']=='convex'),
                          'maximumOutsideMeters':float(round(distances.max(),9)),
                          'p95OutsideMeters':float(round(np.quantile(distances,.95),9))})
    union = np.min(np.array([distance_to_collider(positions,c,frames) for c in colliders]),axis=0)
    geometry_hash = geometry_digest(payload)
    report = {'schema':'avatar-collision-fit-report-1','profileId':payload['profileId'],'version':payload['version'],
              'algorithmVersion':'local-convex-and-primitive-fit-2','canonicalRig':payload['canonicalRig'],
              'sourceGeometrySha256':geometry_hash,
              'glbSha256':payload.get('sourceGlbSha256'),'rigSha256':payload.get('sourceRigSha256'),
              'vertexCount':len(positions),'colliderCount':len(colliders),
              'capsuleCount':sum(c['shape']=='capsule' for c in colliders),
              'boxCount':sum(c['shape']=='box' for c in colliders),
              'convexCount':sum(c['shape']=='convex' for c in colliders),
              'convexVertices':sum(len(c['vertices']) for c in colliders if c['shape']=='convex'),
              'convexTriangles':sum(len(ConvexHull(c['vertices']).simplices)for c in colliders if c['shape']=='convex'),
              'offlineDependencies':{'numpy':np.__version__, 'scipy':__import__('scipy').__version__},
              'fit':{'geometryQuantizationDecimals':GEOMETRY_DECIMALS,'rotationNormalization':'Quantize components, normalize with ordered scalar arithmetic, and canonicalize quaternion sign.',
                     'boxAxisTrimQuantile':QUANTILE,'capsuleRadialQuantile':CAPSULE_RADIUS_QUANTILE,'marginMeters':FIT_MARGIN},
              'neutralSurfaceUnion':{'coveredVertices':int(np.count_nonzero(union<=1e-8)),
                                     'coverageFraction':float(round(np.mean(union<=1e-8),6)),
                                     'maximumOutsideMeters':float(round(union.max(),9))},
              'regions':summaries,
              'limitations':['Coverage counts neutral displayed vertices, not triangle interiors or every pose.',
                             'Rigid proxies approximate blended skin and nonconvex finger/face silhouettes.',
                             'Primitive options can trim fit outliers; the default full convex profile includes every region point.',
                             'Stored poses, author keys, source assets, mass and inertia are unchanged.']}
    return colliders,report



def audit_neutral_regions(payload):
    payload=canonicalize_geometry(payload)
    positions=np.asarray(payload['positions']);labels=np.asarray(payload['regionAssignments'])
    region_ids={region['id'] for region in payload['regions']}
    clouds={name:positions[labels==name]for name in region_ids}
    hulls={name:ConvexHull(points)for name,points in clouds.items()}
    pairs=payload.get('auditNonAdjacentPairs',[])
    overlaps=[];clearance=[]
    for a,b in pairs:
        ha,hb=hulls[a],hulls[b]
        equations=np.r_[ha.equations,hb.equations]
        result=linprog(np.zeros(3),A_ub=equations[:,:3],b_ub=-equations[:,3],bounds=[(None,None)]*3,method='highs')
        pa,pb=clouds[a],clouds[b]
        av=(pa@hb.equations[:,:3].T+hb.equations[:,3]).max(1)
        bv=(pb@ha.equations[:,:3].T+ha.equations[:,3]).max(1)
        entry={'regions':[a,b],'sourceConvexIntersection':bool(result.success),
               'minimumSampledVertexGapMeters':float(round(cKDTree(pb).query(pa)[0].min(),9)),
               'verticesInsideOtherHull':[int(np.count_nonzero(av<-1e-8)),int(np.count_nonzero(bv<-1e-8))],
               'maximumInsidePlaneDepthMeters':[float(round(max(0,-av.min()),9)),float(round(max(0,-bv.min()),9))]}
        if result.success:overlaps.append(entry)
        elif 'forearm' in a or 'forearm' in b or (a.endswith('thigh')and b.endswith('thigh')):
            clearance.append(entry)
    return {'method':'Independent SciPy half-space feasibility against full source neutral-region convex hulls after the same 9-decimal coordinate quantization; containment uses 10nm tolerance and vertex gaps are sampled, not mesh triangle distances.',
            'testedNonAdjacentPairs':len(pairs),'overlaps':overlaps,'selectedClearPairs':clearance}

def typescript(payload, colliders, report):
    definitions='\n'.join('  '+json.dumps(c,separators=(',',':'))+',' for c in colliders)
    metadata={k:payload[k] for k in ['profileId','version','canonicalRig']}
    metadata['id']=metadata.pop('profileId')
    for key in ['sourceGlbSha256','sourceRigSha256','footGround']:
        if key in payload:metadata[key]=payload[key]
    metadata['sourceGeometrySha256']=report['sourceGeometrySha256']
    metadata['algorithmVersion']=report['algorithmVersion']
    metadata['geometryQuantizationDecimals']=GEOMETRY_DECIMALS
    metadata['neutralVertexCoverage']=report['neutralSurfaceUnion']['coverageFraction']
    metadata_text='\n'.join('  '+key+': '+('Object.freeze('+json.dumps(value,separators=(',',':'))+')' if key=='footGround' else json.dumps(value))+','for key,value in metadata.items())
    return '''// Generated by infra/avatar_collision_fit.py; do not hand-edit.
// Source adapters and regenerated geometry support replacement avatars.
import type { JointName } from './motion-types';
type Vector = readonly [number,number,number];
type Rotation = readonly [number,number,number,number];
type Common = {
  readonly id: string; readonly anatomicalRegion: string;
  readonly proximal: JointName; readonly distal: JointName;
  readonly attachmentJoints: readonly JointName[];
  readonly family: 'trunk'|'head'|'arm'|'leg'|'foot';
};
export type AvatarCollisionDefinition = Common & (
  { readonly shape:'capsule'; readonly proximalOffset:Vector; readonly distalOffset:Vector; readonly radiusMeters:number }
  | { readonly shape:'box'; readonly centerOffset:Vector; readonly halfExtents:Vector; readonly localRotation:Rotation }
  | { readonly shape:'convex'; readonly vertices:readonly Vector[]; readonly indices:readonly number[]; readonly bboxCenterOffset:Vector; readonly bboxHalfExtents:Vector; readonly bboxRotation:Rotation }
);
const definitions: AvatarCollisionDefinition[] = [
'''+definitions+'''
];
const colliders = Object.freeze(definitions.map(definition => Object.freeze({ ...definition,
  attachmentJoints:Object.freeze([...definition.attachmentJoints]),
  ...(definition.shape==='capsule'
    ? { proximalOffset:Object.freeze([...definition.proximalOffset]) as Vector, distalOffset:Object.freeze([...definition.distalOffset]) as Vector }
    : definition.shape==='box' ? { centerOffset:Object.freeze([...definition.centerOffset]) as Vector, halfExtents:Object.freeze([...definition.halfExtents]) as Vector, localRotation:Object.freeze([...definition.localRotation]) as Rotation }
    : { vertices:Object.freeze(definition.vertices.map(point=>Object.freeze([...point]) as Vector)), indices:Object.freeze([...definition.indices]), bboxCenterOffset:Object.freeze([...definition.bboxCenterOffset]) as Vector, bboxHalfExtents:Object.freeze([...definition.bboxHalfExtents]) as Vector, bboxRotation:Object.freeze([...definition.bboxRotation]) as Rotation }),
})));
export const AVATAR_COLLISION_PROFILE = Object.freeze({
'''+metadata_text+'''
  colliders,
});
/** Compatibility name: the profile supports convex hulls, boxes and capsules. */
export const AVATAR_CAPSULE_PROFILE = AVATAR_COLLISION_PROFILE;
'''


def main():
    cli=argparse.ArgumentParser(description=__doc__)
    cli.add_argument('--input',type=Path,help='Retargeted neutral geometry/frame/region JSON; defaults to the selected-avatar adapter.')
    cli.add_argument('--output',type=Path,default=ROOT/'packages/core/src/avatarCapsules.generated.ts')
    cli.add_argument('--report',type=Path,default=ROOT/'infra/quaternius-collision-fit-report.json')
    cli.add_argument('--check',action='store_true',help='Check generated files without writing')
    args=cli.parse_args()
    if args.input:
        payload=json.loads(args.input.read_text())
    else:
        from quaternius_collision_fit import current_model_input
        payload=current_model_input()
    colliders,report=fit_model(payload)
    if payload.get('auditNonAdjacentPairs'):
        report['independentNeutralSourceAudit']=audit_neutral_regions(payload)
    outputs=[(args.output,typescript(payload,colliders,report)),(args.report,json.dumps(report,indent=2)+'\n')]
    for path,expected in outputs:
        if args.check:
            if not path.exists() or path.read_text()!=expected:
                raise SystemExit('Stale collision fit: '+str(path))
        else:
            path.parent.mkdir(parents=True,exist_ok=True)
            path.write_text(expected)
    print(json.dumps({'checked':args.check,'colliderCount':report['colliderCount'],'neutralSurfaceUnion':report['neutralSurfaceUnion']},separators=(',',':')))


if __name__=='__main__':
    main()
