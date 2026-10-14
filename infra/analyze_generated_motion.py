#!/usr/bin/env python3
"""Audit and preview a saved native skeleton motion without inference or repair.

Usage (numpy, scipy, matplotlib and ffmpeg must already be installed):
  python infra/analyze_generated_motion.py --input motion.npz \
    --skeleton-json soma-skeleton-metadata.json --fps 30 --output-dir audit \
    --trial-json trial.json

The NPZ must contain posed_joints, global_rot_mats, local_rot_mats and
root_positions, with optional foot_contacts. Skeleton JSON may be one record
or a bundle keyed by somaskel30/somaskel77. Each record supplies jointNames,
parents and neutralJointsMeters. Legacy unversioned records are identified as
such; supplied model names, URLs and weight hashes are not independently
verified by this offline command.

All numerical checks use the original arrays. SO(3) projection is a diagnostic,
never a saved correction. These results do not certify dance style, originality,
the application's rendered sole/collision hull, or its continuous motion gate.
"""
import argparse
import hashlib
import json
import math
import os
from pathlib import Path

import numpy as np
from scipy.spatial.transform import Rotation


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def summary(values):
    values = np.asarray(values, dtype=float).ravel()
    if not len(values):
        return None
    return {'mean': float(values.mean()), 'p50': float(np.quantile(values, .5)),
            'p95': float(np.quantile(values, .95)), 'max': float(values.max())}


def load_skeleton(path, joint_count):
    document = json.loads(path.read_text())
    if not isinstance(document, dict):
        raise ValueError('Skeleton JSON must be an object.')
    key = f'somaskel{joint_count}'
    record = document if 'jointNames' in document else document.get(key)
    if not isinstance(record, dict):
        raise ValueError(f'No skeleton record matches the {joint_count}-joint input.')
    names, parents = record.get('jointNames'), record.get('parents')
    if (not isinstance(names, list) or len(names) != joint_count
            or any(not isinstance(name, str) or not name for name in names)
            or len(set(names)) != joint_count):
        raise ValueError('Skeleton joint names must be unique strings matching the input count.')
    if not isinstance(parents, list) or len(parents) != joint_count:
        raise ValueError('Skeleton parents must match the input joint count.')
    root_indices = []
    for joint, parent in enumerate(parents):
        if parent is None:
            root_indices.append(joint)
        elif isinstance(parent, bool) or not isinstance(parent, int) or not 0 <= parent < joint:
            raise ValueError('Each parent must precede its child; cycles and foreign indices are invalid.')
    if root_indices != [0]:
        raise ValueError('The native format requires exactly one root, at index 0.')
    rest = np.asarray(record.get('neutralJointsMeters'), dtype=float)
    if rest.shape != (joint_count, 3) or not np.isfinite(rest).all():
        raise ValueError('Skeleton rest positions must be finite [jointCount, 3] meter values.')
    if not np.allclose(rest[0], 0, atol=1e-12, rtol=0):
        raise ValueError('Skeleton rest positions must be relative to the root.')
    declared_count = record.get('jointCount', joint_count)
    if declared_count != joint_count:
        raise ValueError('Declared skeleton jointCount differs from the input.')
    declared_id = record.get('id', record.get('skeletonId', key))
    if declared_id in ['somaskel30', 'somaskel77'] and declared_id != key:
        raise ValueError('Declared SOMA skeleton version differs from the input joint count.')
    declared_coords = record.get('coordinateSystem')
    if declared_coords is not None and declared_coords != 'right-handed-y-up-z-forward':
        raise ValueError('This preview requires right-handed Y-up, Z-forward coordinates.')
    return record, names, parents, rest, declared_id


def load_motion(path):
    required = ['posed_joints', 'global_rot_mats', 'local_rot_mats', 'root_positions']
    with np.load(path, allow_pickle=False) as archive:
        if any(key not in archive.files for key in required):
            raise ValueError('NPZ is missing a required native motion array.')
        raw = {key: archive[key] for key in archive.files}
    pos = raw['posed_joints']
    if pos.ndim != 3 or pos.shape[2] != 3 or pos.shape[0] < 3 or pos.shape[1] < 2:
        raise ValueError('posed_joints must be [frames >= 3, joints >= 2, 3].')
    frames, joints, _ = pos.shape
    for key, value in raw.items():
        if not (np.issubdtype(value.dtype, np.number) or value.dtype == bool):
            raise ValueError(f'{key} must contain numeric or boolean values; object arrays are forbidden.')
        if np.issubdtype(value.dtype, np.complexfloating) or not np.isfinite(value).all():
            raise ValueError(f'{key} contains complex or non-finite values.')
    for key in required:
        if not np.issubdtype(raw[key].dtype, np.floating):
            raise ValueError(f'{key} must contain floating-point values.')
    for key in ['global_rot_mats', 'local_rot_mats']:
        if raw[key].shape != (frames, joints, 3, 3):
            raise ValueError(f'{key} must be [frames, joints, 3, 3].')
    if raw['root_positions'].shape != (frames, 3):
        raise ValueError('root_positions must be [frames, 3].')
    if 'foot_contacts' in raw:
        contacts = raw['foot_contacts']
        if contacts.ndim != 2 or contacts.shape[0] != frames or not np.isin(contacts, [0, 1]).all():
            raise ValueError('foot_contacts must be frame-aligned binary labels.')
    return raw, frames, joints


def nearest_so3(matrices):
    u, _, vt = np.linalg.svd(matrices)
    adjust = np.ones(matrices.shape[:-2] + (3,))
    adjust[..., -1] = np.linalg.det(u @ vt)
    return (u * adjust[..., None, :]) @ vt


def fk(local, roots, parents, rest):
    world = np.empty_like(local)
    points = np.empty(local.shape[:2] + (3,))
    for joint, parent in enumerate(parents):
        if parent is None:
            world[:, joint], points[:, joint] = local[:, joint], roots
        else:
            world[:, joint] = world[:, parent] @ local[:, joint]
            points[:, joint] = points[:, parent] + np.einsum(
                'tab,b->ta', world[:, parent], rest[joint] - rest[parent])
    return world, points


def consecutive_runs(mask):
    spans, start = [], None
    for index, active in enumerate(np.append(mask, False)):
        if active and start is None:
            start = index
        elif not active and start is not None:
            spans.append((start, index - 1))
            start = None
    return spans


def trial_metadata(path):
    if path is None:
        return None
    document = json.loads(path.read_text())
    if not isinstance(document, dict):
        raise ValueError('Trial JSON must be an object.')
    # Keep receipt snapshots in their original file; copying them into an audit
    # would obscure the numerical evidence and duplicate the browser record.
    declared = {key: value for key, value in document.items() if key not in ['events', 'ws']}
    fills = [{key: value for key, value in event.items() if key != 'snapshot'}
             for event in document.get('events', [])
             if isinstance(event, dict) and event.get('op') == 'fill']
    return {'file': str(path), 'sha256': digest(path), 'declared': declared,
            'textInputEvents': fills,
            'verificationStatus': 'Supplied receipt metadata; model and weight identity not independently verified.'}


def analyze(raw, frames, names, parents, rest, fps):
    pos = raw['posed_joints'].astype(float)
    glob = raw['global_rot_mats'].astype(float)
    local = raw['local_rot_mats'].astype(float)
    roots = raw['root_positions'].astype(float)
    fk_glob, fk_pos = fk(local, roots, parents, rest)
    projected_glob = nearest_so3(glob)
    projected_local = np.empty_like(local)
    direct_errors, lengths, rest_lengths, rotation_errors = [], [], [], []
    for joint, parent in enumerate(parents):
        if parent is None:
            projected_local[:, joint] = projected_glob[:, joint]
            continue
        projected_local[:, joint] = projected_glob[:, parent].transpose(0, 2, 1) @ projected_glob[:, joint]
        expected = pos[:, parent] + np.einsum('tab,b->ta', glob[:, parent], rest[joint] - rest[parent])
        direct_errors.append(np.linalg.norm(expected - pos[:, joint], axis=-1))
        rotation_errors.append(np.abs(glob[:, parent] @ local[:, joint] - glob[:, joint]).max(axis=(-1, -2)))
        lengths.append(np.linalg.norm(pos[:, joint] - pos[:, parent], axis=-1))
        rest_lengths.append(np.linalg.norm(rest[joint] - rest[parent]))
    _, projected_fk = fk(projected_local, roots, parents, rest)
    lengths, rest_lengths = np.array(lengths), np.array(rest_lengths)
    result = {
        'sampling': {'fpsProvidedByCaller': fps, 'frames': frames, 'jointCount': len(names),
                     'durationSecondsFramesDividedByFps': frames / fps, 'lastSampleTimeSeconds': (frames - 1) / fps},
        'rawArrays': {key: {'shape': list(value.shape), 'dtype': str(value.dtype), 'finite': True} for key, value in raw.items()},
        'fkConsistency': {
            'rawGlobalParentOffsetPositionErrorMeters': summary(direct_errors),
            'rawLocalChainedPositionErrorMeters': summary(np.linalg.norm(fk_pos - pos, axis=-1)),
            'rawLocalChainedGlobalRotationMaxComponentError': float(np.abs(fk_glob - glob).max()),
            'rawAdjacentParentLocalGlobalRotationMaxComponentError': summary(rotation_errors),
            'rootArrayEqualsRootJointPositionMaxAbsoluteErrorMeters': float(np.abs(pos[:, 0] - roots).max()),
            'nearestSo3GlobalThenRecomputedLocalChainedPositionErrorMeters': summary(np.linalg.norm(projected_fk - pos, axis=-1)),
            'nearestSo3GlobalMaxComponentChange': float(np.abs(projected_glob - glob).max()),
            'projectionPurpose': 'Diagnostic only; raw arrays are unchanged and no corrected candidate is saved.'
        },
        'rawRotationValidity': {},
        'boneLength': {
            'maxAbsoluteDeviationFromRestMeters': float(np.abs(lengths - rest_lengths[:, None]).max()),
            'maxPerBoneTemporalRangeMeters': float(np.ptp(lengths, axis=1).max()),
            'deviationFromRestMeters': summary(np.abs(lengths - rest_lengths[:, None])),
        },
        'rootTrajectory': {
            'axisRangeMeters': np.ptp(roots, axis=0).tolist(),
            'axisMinMeters': roots.min(axis=0).tolist(), 'axisMaxMeters': roots.max(axis=0).tolist(),
            'planarPathLengthMeters': float(np.linalg.norm(np.diff(roots[:, [0, 2]], axis=0), axis=1).sum()),
            'planarStartToEndDistanceMeters': float(np.linalg.norm((roots[-1] - roots[0])[[0, 2]])),
            'speedMetersPerSecond': summary(np.linalg.norm(np.diff(roots, axis=0) * fps, axis=1)),
            'accelerationMetersPerSecondSquared': summary(np.linalg.norm(np.diff(roots, n=2, axis=0) * fps**2, axis=1)),
        },
        'jointTrajectories': {}, 'contactRuns': {}, 'promptRelatedObservationsOnly': {},
        'limits': [
            'Offline native-array diagnostics do not certify dance style, reliability, success rate, or training-data originality.',
            'Joint centers and predicted contact labels do not encode the target rendered sole/body hull; floor and self-collision remain unverified.',
            'Finite differences do not inspect an application Hermite curve, joins, locked endpoints, or continuous derivatives.',
            'Contact labels are model predictions, not forces. Active movement uses consecutive true labels.',
            'SO(3) projection is diagnostic normalization only; no repair or accepted result is produced.',
            'Model name, weights/version, coordinate metadata and supplied FPS require separate provenance verification.',
        ],
    }
    for label, mats in [('local', local), ('global', glob)]:
        errors = np.linalg.norm(mats.transpose(0, 1, 3, 2) @ mats - np.eye(3), axis=(-1, -2))
        determinants = np.linalg.det(mats)
        singulars = np.linalg.svd(mats, compute_uv=False)
        peak = np.unravel_index(np.argmax(errors), errors.shape)
        result['rawRotationValidity'][label] = {
            'orthogonalityFrobeniusError': summary(errors),
            'determinantMin': float(determinants.min()), 'determinantMax': float(determinants.max()),
            'singularValueMin': float(singulars.min()), 'singularValueMax': float(singulars.max()),
            'nonPositiveDeterminantCount': int(np.sum(determinants <= 0)),
            'peakOrthogonalityJoint': names[peak[1]], 'peakOrthogonalityTimeSeconds': peak[0] / fps,
        }
    watched = [names[0], 'Chest', 'Head', 'LeftHand', 'RightHand', 'LeftFoot', 'RightFoot', 'LeftToeBase', 'RightToeBase']
    for name in dict.fromkeys(watched):
        if name not in names:
            continue
        joint = names.index(name)
        point = pos[:, joint]
        angular = Rotation.from_matrix(projected_glob[1:, joint] @ projected_glob[:-1, joint].transpose(0, 2, 1)).as_rotvec() * fps
        result['jointTrajectories'][name] = {
            'axisRangeMeters': np.ptp(point, axis=0).tolist(),
            'axisMinMeters': point.min(axis=0).tolist(), 'axisMaxMeters': point.max(axis=0).tolist(),
            'positionSpeedMetersPerSecond': summary(np.linalg.norm(np.diff(point, axis=0) * fps, axis=1)),
            'positionAccelerationMetersPerSecondSquared': summary(np.linalg.norm(np.diff(point, n=2, axis=0) * fps**2, axis=1)),
            'globalAngularSpeedRadiansPerSecondAfterDiagnosticSo3Projection': summary(np.linalg.norm(angular, axis=1)),
            'globalAngularAccelerationRadiansPerSecondSquaredAfterDiagnosticSo3Projection': summary(np.linalg.norm(np.diff(angular, axis=0) * fps, axis=1)),
        }
    if all(name in names for name in ['LeftHand', 'RightHand']):
        heights = pos[:, [names.index('LeftHand'), names.index('RightHand')], 1]
        correlation = float(np.corrcoef(heights.T)[0, 1]) if np.all(heights.std(axis=0) > 0) else None
        result['promptRelatedObservationsOnly'] = {
            'leftRightHandHeightCorrelation': correlation,
            'firstLastHandPositionsMeters': {name: {'first': pos[0, names.index(name)].tolist(), 'last': pos[-1, names.index(name)].tolist()} for name in ['LeftHand', 'RightHand']},
            'interpretationLimit': 'Descriptive evidence only; no dance style classifier or calibrated intent pass/fail criterion.'
        }
    return result, pos


def analyze_contacts(result, raw, names, fps, record):
    if 'foot_contacts' not in raw:
        return
    contact = raw['foot_contacts'].astype(bool)
    pos = raw['posed_joints'].astype(float)
    feet = record.get('contactJointNames')
    if feet is None:
        feet = (['LeftFoot', 'LeftToeBase', 'LeftToeEnd', 'RightFoot', 'RightToeBase', 'RightToeEnd']
                if contact.shape[1] == 6 and len(names) == 77 else
                ['LeftFoot', 'LeftToeBase', 'RightFoot', 'RightToeBase']
                if contact.shape[1] == 4 and len(names) == 30 else None)
    if not isinstance(feet, list) or len(feet) != contact.shape[1] or any(name not in names for name in feet):
        raise ValueError('Contact channels need matching contactJointNames or the SOMA30/77 convention.')
    for column, name in enumerate(feet):
        point = pos[:, names.index(name)]
        active_steps = contact[1:, column] & contact[:-1, column]
        planar_steps = np.linalg.norm(np.diff(point[:, [0, 2]], axis=0), axis=1)
        runs = []
        for start, end in consecutive_runs(contact[:, column]):
            part = point[start:end + 1]
            runs.append({
                'startFrame': start, 'endFrame': end, 'sampleDurationSeconds': (end - start) / fps,
                'planarExcursionFromRunStartMeters': float(np.linalg.norm(part[:, [0, 2]] - part[0, [0, 2]], axis=1).max()),
                'planarTotalPathMeters': float(np.linalg.norm(np.diff(part[:, [0, 2]], axis=0), axis=1).sum()),
                'jointCenterHeightRangeMeters': float(np.ptp(part, axis=0)[1]),
            })
        result['contactRuns'][name] = {
            'labelActiveFraction': float(contact[:, column].mean()),
            'planarActiveSpeedMetersPerSecond': summary(planar_steps[active_steps] * fps),
            'planarActiveCumulativePathMeters': float(planar_steps[active_steps].sum()), 'runs': runs,
        }


def render_previews(pos, names, parents, fps, output, skip_video):
    os.environ.setdefault('MPLCONFIGDIR', str(output / '.matplotlib-cache'))
    os.environ.setdefault('XDG_CACHE_HOME', str(output / '.plotting-cache'))
    import matplotlib
    matplotlib.use('Agg')
    import matplotlib.pyplot as plt
    from matplotlib.animation import FuncAnimation, FFMpegWriter

    def color(name):
        return '#1976b3' if name.startswith('Left') else '#d16920' if name.startswith('Right') else '#454545'

    def setup(ax, view):
        axis = 0 if view == 'front' else 2
        low, high = float(pos[..., axis].min()), float(pos[..., axis].max())
        width = max(high - low, 1.4)
        center = (high + low) / 2
        ax.set_xlim(center - width * .6, center + width * .6)
        ax.set_ylim(min(float(pos[..., 1].min()) - .12, -.12), float(pos[..., 1].max()) + .18)
        ax.set_aspect('equal')
        ax.axhline(0, color='#aaaaaa', lw=1)
        ax.grid(alpha=.15)
        ax.set_xlabel('+X (m)' if view == 'front' else '+Z (m)')
        ax.set_ylabel('+Y (m)')

    bones = [(joint, parent) for joint, parent in enumerate(parents) if parent is not None]
    samples = np.linspace(0, len(pos) - 1, min(6, len(pos))).round().astype(int)
    fig, axes = plt.subplots(2, len(samples), figsize=(16, 6.8), squeeze=False)
    for row, view in enumerate(['front', 'side']):
        axis = 0 if view == 'front' else 2
        for column, frame in enumerate(samples):
            ax = axes[row, column]
            setup(ax, view)
            for joint, parent in bones:
                ax.plot(pos[frame, [parent, joint], axis], pos[frame, [parent, joint], 1], color=color(names[joint]), lw=1.5)
            ax.set_title(f'{view}: {frame / fps:.2f}s', fontsize=10)
    fig.suptitle('Native generated skeleton — original positions\nBlue = left, orange = right; no retargeting, repair, or style certification', fontsize=11)
    fig.tight_layout(rect=(0, 0, 1, .94))
    fig.savefig(output / 'motion-contact-sheet.png', dpi=125)
    plt.close(fig)
    if skip_video:
        return
    fig, axes = plt.subplots(1, 2, figsize=(10, 5.3))
    line_sets = []
    for ax, view in zip(axes, ['front', 'side']):
        setup(ax, view)
        line_sets.append([ax.plot([], [], color=color(names[joint]), lw=1.5)[0] for joint, _ in bones])
    title = fig.suptitle('Native generated skeleton — original positions')

    def update(frame):
        for view, ax, lines in zip(['front', 'side'], axes, line_sets):
            axis = 0 if view == 'front' else 2
            for line, (joint, parent) in zip(lines, bones):
                line.set_data(pos[frame, [parent, joint], axis], pos[frame, [parent, joint], 1])
            ax.set_title(f'{view} — {frame / fps:.2f}s')
        title.set_text(f'Original native positions — frame {frame}/{len(pos) - 1} — {fps:g} fps')
        return [line for lines in line_sets for line in lines]

    fig.tight_layout(rect=(0, 0, 1, .94))
    animation = FuncAnimation(fig, update, frames=len(pos), interval=1000 / fps)
    animation.save(output / 'motion-front-side.mp4', writer=FFMpegWriter(
        fps=fps, codec='libx264', extra_args=['-pix_fmt', 'yuv420p']), dpi=80)
    plt.close(fig)


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--input', required=True, type=Path, help='Existing native motion NPZ; never changed.')
    parser.add_argument('--skeleton-json', required=True, type=Path)
    parser.add_argument('--fps', required=True, type=float, help='Externally verified native sample rate; NPZ does not supply it.')
    parser.add_argument('--output-dir', required=True, type=Path)
    parser.add_argument('--trial-json', type=Path, help='Optional receipt; model identity remains unverified by this command.')
    parser.add_argument('--skip-video', action='store_true', help='Write numeric JSON and a contact sheet only.')
    args = parser.parse_args()
    try:
        if not math.isfinite(args.fps) or not 0 < args.fps <= 1000:
            raise ValueError('--fps must be a finite positive rate no greater than 1000.')
        input_path, skeleton_path = args.input.resolve(), args.skeleton_json.resolve()
        trial_path = args.trial_json.resolve() if args.trial_json else None
        output = args.output_dir.resolve()
        raw_hash, skeleton_hash = digest(input_path), digest(skeleton_path)
        trial = trial_metadata(trial_path)
        raw, frames, joints = load_motion(input_path)
        record, names, parents, rest, skeleton_id = load_skeleton(skeleton_path, joints)
        artifacts = ['motion-analysis.json', 'motion-contact-sheet.png']
        if not args.skip_video:
            artifacts.append('motion-front-side.mp4')
        protected = {input_path, skeleton_path} | ({trial_path} if trial_path else set())
        if any((output / name).resolve() in protected for name in artifacts):
            raise ValueError('Output artifacts may not replace input, skeleton, or trial metadata.')
        result, positions = analyze(raw, frames, names, parents, rest, args.fps)
        analyze_contacts(result, raw, names, args.fps, record)
        result.update({
            'schemaVersion': 'generated-motion-audit-1', 'inputFile': str(input_path), 'inputSha256': raw_hash,
            'skeletonMetadata': {'file': str(skeleton_path), 'sha256': skeleton_hash, 'id': skeleton_id,
                                 'metadataVersion': record.get('schemaVersion', 'legacy-unversioned'),
                                 'jointCount': joints, 'declaredSource': record.get('source'),
                                 'declaredAssetSha256': record.get('assetSha256'),
                                 'verificationStatus': 'Supplied rest metadata checked against arrays by FK; service model/weight identity not independently verified.'},
            'trialMetadata': trial,
        })
        output.mkdir(parents=True, exist_ok=True)
        render_previews(positions, names, parents, args.fps, output, args.skip_video)
        if digest(input_path) != raw_hash or digest(skeleton_path) != skeleton_hash:
            raise ValueError('Input or skeleton changed during the audit; do not use these results.')
        if trial_path and digest(trial_path) != trial['sha256']:
            raise ValueError('Trial metadata changed during the audit; do not use these results.')
        result['inputsUnchanged'] = True
        (output / 'motion-analysis.json').write_text(json.dumps(result, indent=2, allow_nan=False) + '\n')
        print(json.dumps({'outputDir': str(output), 'artifacts': artifacts, 'frames': frames,
                          'jointCount': joints, 'inputSha256': raw_hash, 'inputsUnchanged': True}))
    except (OSError, ValueError, KeyError, TypeError) as error:
        parser.error(str(error))


if __name__ == '__main__':
    main()
