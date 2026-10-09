#!/usr/bin/env python3
"""Generic replacement-avatar and coordinate-frame checks (Python 3.11+)."""
import copy,itertools,json,subprocess,sys,tempfile,unittest
from pathlib import Path
import numpy as np
from scipy.spatial import ConvexHull
from avatar_collision_fit import fit_model,quaternion_matrix,typescript


def fixture(count=9):
    corners=np.array(list(itertools.product([-.04,.07],[-.13,.18],[-.03,.06])))
    rng=np.random.default_rng(1735)
    extra=rng.uniform(corners.min(0),corners.max(0),size=(count-8,3))
    positions=np.r_[corners,extra]
    return {'schema':'avatar-neutral-collision-input-1','profileId':'synthetic-replacement-1','version':1,
            'canonicalRig':'neutral-rig-2','positions':positions.tolist(),
            'regionAssignments':['body']*count,
            'regions':[{'id':'body','frame':'Hips','attachmentJoints':['Hips'],'family':'trunk','shape':'convex'}],
            'frames':{'Hips':{'position':[0,0,0],'rotation':[0,0,0,1]}}}


class GenericAvatarFit(unittest.TestCase):
    def test_different_vertex_counts_scale_and_asymmetry_recompute_geometry(self):
        first=fixture(9)
        second=fixture(37)
        points=np.array(second['positions'])*[2,.7,1.6]+[.025,-.06,.09]
        second['positions']=points.tolist()
        a,ar=fit_model(first);b,br=fit_model(second)
        self.assertEqual((ar['vertexCount'],br['vertexCount']),(9,37))
        self.assertNotEqual(ar['sourceGeometrySha256'],br['sourceGeometrySha256'])
        self.assertNotEqual(a[0]['vertices'],b[0]['vertices'])
        self.assertNotEqual(a[0]['bboxCenterOffset'],b[0]['bboxCenterOffset'])
        np.testing.assert_allclose(np.array(b[0]['vertices']).min(0),points.min(0),atol=1e-9)
        np.testing.assert_allclose(np.array(b[0]['vertices']).max(0),points.max(0),atol=1e-9)
        self.assertEqual(br['neutralSurfaceUnion']['coveredVertices'],37)
        self.assertNotEqual(typescript(first,a,ar),typescript(second,b,br))
        ulp=copy.deepcopy(first)
        ulp['positions']=np.nextafter(np.asarray(first['positions']),np.inf).tolist()
        ua,ur=fit_model(ulp)
        self.assertEqual(ar['sourceGeometrySha256'],ur['sourceGeometrySha256'])
        self.assertEqual(a,ua)

    def test_rotated_and_translated_canonical_frame_returns_same_local_hull(self):
        plain=fixture(23)
        moved=copy.deepcopy(plain)
        q=np.array([0,0,np.sqrt(.5),np.sqrt(.5)])
        translation=np.array([4.3,-2.7,.91])
        moved['frames']['Hips']={'position':translation.tolist(),'rotation':q.tolist()}
        moved['positions']=(np.array(plain['positions'])@quaternion_matrix(q).T+translation).tolist()
        a,ar=fit_model(plain);b,br=fit_model(moved)
        # Sorting all coordinates may change order for numerically tied corners;
        # compare each local vertex with its nearest independent counterpart.
        pa,pb=np.array(a[0]['vertices']),np.array(b[0]['vertices'])
        self.assertLess(np.linalg.norm(pa[:,None]-pb[None,:],axis=2).min(1).max(),2e-9)
        np.testing.assert_allclose(a[0]['bboxCenterOffset'],b[0]['bboxCenterOffset'],atol=1e-9)
        self.assertEqual(br['neutralSurfaceUnion']['coveredVertices'],23)
        self.assertNotEqual(ar['sourceGeometrySha256'],br['sourceGeometrySha256'])
        ulp=copy.deepcopy(moved)
        ulp['positions']=np.nextafter(np.asarray(moved['positions']),np.inf).tolist()
        ulp['frames']['Hips']['rotation']=np.nextafter(np.asarray(q),np.inf).tolist()
        uc,ur=fit_model(ulp)
        self.assertEqual(br['sourceGeometrySha256'],ur['sourceGeometrySha256'])
        self.assertEqual(b,uc)

    def test_convex_faces_are_outward_and_bounds_enclose_every_point(self):
        payload=fixture(41);colliders,report=fit_model(payload);shape=colliders[0]
        points=np.asarray(payload['positions']);vertices=np.asarray(shape['vertices']);mean=vertices.mean(0)
        for a,b,c in np.asarray(shape['indices']).reshape(-1,3):
            normal=np.cross(vertices[b]-vertices[a],vertices[c]-vertices[a])
            self.assertGreater(np.dot(normal,vertices[a]-mean),0)
            self.assertLessEqual(((vertices-vertices[a])@normal).max(),1e-10)
        halfspaces=ConvexHull(vertices).equations
        self.assertLessEqual((points@halfspaces[:,:3].T+halfspaces[:,3]).max(),1e-8)
        bounds=np.asarray(shape['bboxHalfExtents'])
        center=np.asarray(shape['bboxCenterOffset'])
        self.assertTrue((np.abs(vertices-center)<=bounds).all())
        self.assertEqual(report['convexCount'],1)

    def test_box_and_capsule_remain_geometry_driven_options(self):
        for primitive in ['box','capsule']:
            first=fixture(19);first['regions'][0]['shape']=primitive
            second=copy.deepcopy(first);second['positions']=(np.asarray(first['positions'])*1.5).tolist()
            a,_=fit_model(first);b,_=fit_model(second)
            self.assertEqual(a[0]['shape'],primitive)
            if primitive=='box':
                self.assertTrue(np.all(np.asarray(b[0]['halfExtents'])>np.asarray(a[0]['halfExtents'])))
            else:
                self.assertGreater(b[0]['radiusMeters'],a[0]['radiusMeters'])

    def test_cli_accepts_replacement_geometry_and_checks_custom_outputs(self):
        with tempfile.TemporaryDirectory(prefix='avatar-fit-test-') as directory:
            root=Path(directory);input_path=root/'new-avatar.json';output=root/'profile.ts';report=root/'report.json'
            payload=fixture(29);payload['profileId']='different-avatar-29'
            input_path.write_text(json.dumps(payload))
            command=[sys.executable,str(Path(__file__).with_name('avatar_collision_fit.py')),
                     '--input',str(input_path),'--output',str(output),'--report',str(report)]
            generated=subprocess.run(command,text=True,capture_output=True,check=True)
            self.assertEqual(json.loads(generated.stdout)['colliderCount'],1)
            self.assertEqual(json.loads(report.read_text())['vertexCount'],29)
            self.assertIn('different-avatar-29',output.read_text())
            subprocess.run(command+['--check'],text=True,capture_output=True,check=True)

    def test_rejects_nonfinite_geometry_and_missing_regions(self):
        bad=fixture();bad['positions'][0][0]=float('nan')
        with self.assertRaises(ValueError):fit_model(bad)
        bad=fixture();bad['regionAssignments'][0]='unknown'
        with self.assertRaises(ValueError):fit_model(bad)


if __name__=='__main__':
    unittest.main()
