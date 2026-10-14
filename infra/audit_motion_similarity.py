"""Screen 30 Hz SOMA output against two exported local motion recordings.

Requires a world-joints JSON export made with the project decoder/evaluatePose,
a SOMA skeleton metadata JSON, and an explicitly supplied frozen calibration.
This is a limited similarity experiment, not an originality or style proof.
No model, network, user scene, or product-state mutation is performed.
"""
import hashlib
import gzip

import json
import argparse

from datetime import datetime, timezone

from pathlib import Path

import numpy as np

FPS = 30.0  # Observed readonly export-FPS control; NPZ has no embedded rate.

COMMON = ['Hips', 'Chest', 'Head'] + [side + name for side in ['Left', 'Right']
    for name in ['UpperArm', 'ForeArm', 'Hand', 'UpperLeg', 'LowerLeg', 'Foot', 'Toe']]

SOMA = {name: name for name in COMMON}

for side in ['Left', 'Right']:
    SOMA.update({side + 'UpperArm': side + 'Arm', side + 'UpperLeg': side + 'Leg',
        side + 'LowerLeg': side + 'Shin', side + 'Toe': side + 'ToeBase'})

BONES = [('Hips', 'Chest'), ('Chest', 'Head')]

for side in ['Left', 'Right']:
    BONES += [('Chest', side + 'UpperArm'), (side + 'UpperArm', side + 'ForeArm'),
        (side + 'ForeArm', side + 'Hand'), ('Hips', side + 'UpperLeg'),
        (side + 'UpperLeg', side + 'LowerLeg'), (side + 'LowerLeg', side + 'Foot'),
        (side + 'Foot', side + 'Toe')]

INDEX = {name: i for i, name in enumerate(COMMON)}

GROUPS = {'torso': [0, 1], 'arms': [2, 3, 4, 9, 10, 11],
    'legs': [5, 6, 7, 8, 12, 13, 14, 15]}

def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

def dump(path, value):
    path.write_text(json.dumps(value, indent=2, ensure_ascii=False) + '\n')

def mirror(points):
    swap = [INDEX[('Right' + name[4:]) if name.startswith('Left') else
        ('Left' + name[5:]) if name.startswith('Right') else name] for name in COMMON]
    output = points[:, swap].copy()
    output[..., 0] *= -1
    return output

def features(points):
    """Unit bone directions in per-frame horizontal pelvis coordinates.

    Removing heading every frame makes this screen conservative about a donor
    with a changed Root path/turn. Actual global trajectory is excluded and
    cannot manufacture novelty. Anatomical length differences are removed.
    """
    points = np.asarray(points, dtype=np.float64)
    if points.ndim != 3 or points.shape[1:] != (len(COMMON), 3) or not np.isfinite(points).all():
        raise ValueError('Invalid comparable world joint coordinates')
    across = points[:, INDEX['LeftUpperLeg']] - points[:, INDEX['RightUpperLeg']]
    heading_length = np.linalg.norm(across[:, [0, 2]], axis=1)
    valid = heading_length > 1e-6
    if not valid.all():
        # Near vertical/inverted pelvis has no unique horizontal heading.
        # Hold the last valid heading and disclose these frames in the receipt.
        for i in range(len(across)):
            if not valid[i]:
                across[i, [0, 2]] = across[i - 1, [0, 2]] if i else [1, 0]
    across_xz = across[:, [0, 2]]
    across_xz /= np.linalg.norm(across_xz, axis=1, keepdims=True)
    vectors = np.stack([points[:, INDEX[end]] - points[:, INDEX[start]] for start, end in BONES], axis=1)
    lengths = np.linalg.norm(vectors, axis=2, keepdims=True)
    if np.any(lengths < 1e-8):
        raise ValueError('Degenerate comparable bone')
    vectors /= lengths
    vx, vz = vectors[..., 0].copy(), vectors[..., 2].copy()
    ax, az = across_xz[:, 0, None], across_xz[:, 1, None]
    vectors[..., 0] = ax * vx + az * vz
    vectors[..., 2] = -az * vx + ax * vz
    return vectors, {'headingUndefinedFrames': int((~valid).sum())}

def subsequence_dtw(query, source, source_times):
    """Free source start/end, steps (1,1)/(1,2)/(2,1); no skipped query rows.

    (1,2) averages its two source matches; (2,1) accounts for both query rows.
    Costs therefore always sum to exactly the number of query frames. Steps
    bound temporal slope locally to 0.5..2. Both source recordings are searched
    in full, including across the derived 8-second window boundaries.
    """
    q, s = query.reshape(len(query), -1), source.reshape(len(source), -1)
    sq = np.sum(q * q, axis=1)[:, None] + np.sum(s * s, axis=1)[None, :] - 2 * q @ s.T
    costs = np.maximum(0, sq / len(BONES))
    n, m = costs.shape
    dp = np.full((n, m), np.inf)
    pointers = np.full((n, m), -1, dtype=np.int8)
    dp[0] = costs[0]
    for i in range(1, n):
        alternatives = np.full((3, m), np.inf)
        alternatives[0, 1:] = dp[i - 1, :-1] + costs[i, 1:]
        alternatives[1, 2:] = dp[i - 1, :-2] + (costs[i, 1:-1] + costs[i, 2:]) / 2
        if i >= 2:
            alternatives[2, 1:] = dp[i - 2, :-1] + costs[i - 1, 1:] + costs[i, 1:]
        chosen = alternatives.argmin(axis=0)
        dp[i] = alternatives[chosen, np.arange(m)]
        pointers[i] = chosen
    end = int(np.argmin(dp[-1]))
    i, j = n - 1, end
    path = []
    while i > 0:
        step = int(pointers[i, j])
        if step == 0:
            path.append((i, j)); i, j = i - 1, j - 1
        elif step == 1:
            path.extend([(i, j), (i, j - 1)]); i, j = i - 1, j - 2
        elif step == 2:
            path.extend([(i, j), (i - 1, j)]); i, j = i - 2, j - 1
        else:
            raise ValueError('No valid DTW path')
    path.append((0, j)); path.reverse()
    differences = np.array([query[qi] - source[si] for qi, si in path])
    group = {key: float(np.sqrt(np.mean(np.sum(differences[:, indexes] ** 2, axis=-1))))
        for key, indexes in GROUPS.items()}
    return {'directionRms': float(np.sqrt(dp[-1, end] / n)),
        'sourceStartSeconds': float(source_times[j]), 'sourceEndSeconds': float(source_times[end]),
        'sourceSpanSeconds': float(source_times[end] - source_times[j]),
        'queryFrames': n, 'querySpanSeconds': (n - 1) / FPS,
        'groupDirectionRmsAlongSamePath': group, 'alignmentPath': path}

def source_windows(clip, start, end):
    duration = 37.5 if clip == 'cmu-85-12' else 56.25
    windows = []
    for i, lo in enumerate(range(0, int(duration), 8)):
        hi = duration if duration - lo <= 8.5 else lo + 8
        if end >= lo and start <= hi:
            windows.append({'id': clip + '-' + chr(ord('a') + i), 'recordingStart': lo, 'recordingEnd': hi})
    return windows

def audit(points, recordings, keep_path=False):
    results = []
    query_diagnostics = None
    for flipped in [False, True]:
        query, query_diagnostics = features(mirror(points) if flipped else points)
        for recording in recordings:
            result = subsequence_dtw(query, recording['features'], recording['times'])
            result.update({'sourceId': recording['id'], 'queryMirrored': flipped,
                'overlappingDerivedWindows': source_windows(recording['id'], result['sourceStartSeconds'], result['sourceEndSeconds'])})
            if not keep_path:
                result.pop('alignmentPath')
            results.append(result)
    results.sort(key=lambda item: item['directionRms'])
    return {'closest': results[0], 'allFourSearches': results, 'queryDiagnostics': query_diagnostics}


def verify_alignment_cost(result, query_points, recordings):
    """Recalculate the saved alignment cost without the DTW recurrence."""
    maximum_error = 0.0
    for match in result['allFourSearches']:
        query, _ = features(mirror(query_points) if match['queryMirrored'] else query_points)
        source = next(item['features'] for item in recordings if item['id'] == match['sourceId'])
        pairs = np.array(match['alignmentPath'], dtype=np.int64)
        counts = np.bincount(pairs[:, 0], minlength=len(query))
        if np.any(counts == 0) or np.any(counts > 2):
            raise ValueError('Alignment skipped a query frame or exceeded the temporal-step rule')
        difference = query[pairs[:, 0]] - source[pairs[:, 1]]
        weights = 1.0 / counts[pairs[:, 0]]
        mean_squared_cost = float(np.sum(np.mean(np.sum(difference ** 2, axis=2), axis=1) * weights) / len(query))
        recomputed = float(np.sqrt(mean_squared_cost))
        error = abs(recomputed - match['directionRms'])
        # Dot-product distances lose precision close to an exact zero. Check
        # the accumulated squared cost before the square root in that case.
        if abs(mean_squared_cost - match['directionRms'] ** 2) > 1e-12:
            raise ValueError('Saved alignment cost does not match the reported DTW distance')
        maximum_error = max(maximum_error, error)
    return maximum_error


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--raw', required=True, type=Path)
    parser.add_argument('--expected-raw-sha256', required=True)
    parser.add_argument('--priors-world-joints', required=True, type=Path)
    parser.add_argument('--soma-metadata', required=True, type=Path)
    parser.add_argument('--calibration', required=True, type=Path)
    parser.add_argument('--output-dir', required=True, type=Path)
    parser.add_argument('--fps', type=float, choices=[30.0], default=30.0)
    args = parser.parse_args()
    started = datetime.now(timezone.utc).isoformat()
    repo = Path(__file__).resolve().parents[1]
    expected_sources = {'cmu-85-12': '641cc765dbce56267b4a16a087174e487bdf16842a705e6fdc1cbb99329096bd',
        'cmu-61-08': 'd24951aaeeb9e4335238b07138a5e4dda463e13d9490883e9cd475085b218890'}
    calibration = json.loads(args.calibration.read_text())
    threshold = calibration['thresholdDirectionRms']
    if not isinstance(threshold, (int, float)) or not np.isfinite(threshold) or threshold <= 0:
        raise ValueError('A finite positive frozen threshold is required')
    if args.priors_world_joints.suffix == '.gz':
        with gzip.open(args.priors_world_joints, 'rt', encoding='utf-8') as file:
            prior = json.load(file)
    else:
        prior = json.loads(args.priors_world_joints.read_text())
    recordings = []
    for item in prior['recordings']:
        if expected_sources.get(item['id']) != item['sha256'] or sha(repo / item['path']) != item['sha256']:
            raise ValueError('Export is not bound to the two pinned local recordings')
        points = np.asarray(item['worldJoints'])[:, [prior['jointNames'].index(name) for name in COMMON]]
        times = np.array(item['times'])
        if len(times) != len(points) or not np.isfinite(times).all() or np.any(np.diff(times) <= 0):
            raise ValueError('Invalid source sample time grid')
        vectors, diagnostics = features(points)
        recordings.append({'id': item['id'], 'sha256': item['sha256'], 'times': times,
            'points': points, 'features': vectors, 'diagnostics': diagnostics})
    if sorted(item['id'] for item in recordings) != sorted(expected_sources):
        raise ValueError('Exactly two distinct pinned recordings are required')
    if sha(args.raw) != args.expected_raw_sha256:
        raise ValueError('Pinned model output SHA mismatch')
    metadata = json.loads(args.soma_metadata.read_text())['somaskel77']
    with np.load(args.raw, allow_pickle=False) as archive:
        world = archive['posed_joints'].copy()
    if world.ndim != 3 or world.shape[1:] != (77, 3) or len(world) < 61:
        raise ValueError('At least 61 frames of 30 Hz SOMA77 world positions are required')
    points = world[:, [metadata['jointNames'].index(SOMA[name]) for name in COMMON]]
    whole = audit(points, recordings, keep_path=True)
    maximum_cost_error = verify_alignment_cost(whole, points, recordings)
    window_starts = list(range(0, len(points) - 60, 15))
    if window_starts[-1] != len(points) - 61:
        window_starts.append(len(points) - 61)
    windows = []
    for frame in window_starts:
        cut = points[frame:frame + 61]
        result = audit(cut, recordings, keep_path=True)
        maximum_cost_error = max(maximum_cost_error, verify_alignment_cost(result, cut, recordings))
        windows.append({'queryStartSeconds': frame / FPS, 'queryEndSeconds': (frame + 60) / FPS,
            'screenFlagsHighSimilarity': result['closest']['directionRms'] <= threshold, 'result': result})
    flagged = whole['closest']['directionRms'] <= threshold or any(item['screenFlagsHighSimilarity'] for item in windows)
    receipt = {'schema': 'soma-two-local-priors-similarity-3', 'startedAt': started,
        'finishedAt': datetime.now(timezone.utc).isoformat(), 'rawPath': str(args.raw),
        'rawSha256': args.expected_raw_sha256, 'nativeFrames': len(points), 'fps': FPS,
        'fpsEvidence': 'Caller supplies observed model/export 30 Hz; NPZ does not embed a rate.',
        'nominalFrameCountDurationSeconds': len(points) / FPS, 'observedSampleSpanSeconds': (len(points) - 1) / FPS,
        'endpointPaddedOrRetimed': False, 'thresholdDirectionRms': threshold,
        'calibrationPath': str(args.calibration), 'calibrationSha256': sha(args.calibration),
        'calibrationBlindToInitialRawSample': calibration.get('blindToInitialRawSample'),
        'independentRecordings': 2, 'totalCatalogEntriesIncludingFullRecordings': 14,
        'sourceRecordings': [{'id': item['id'], 'sha256': item['sha256'], 'frames': len(item['times']),
            'featureDiagnostics': item['diagnostics']} for item in recordings],
        'metric': 'RMS distance of 16 unit bone direction vectors in per-frame horizontal pelvis coordinates.',
        'alignment': 'Bounded subsequence DTW, steps (1,1)/(1,2)/(2,1), full recordings searched, mirrored query included.',
        'wholeSample': whole, 'twoSecondWindows': windows, 'screenFlagsHighSimilarity': flagged,
        'savedAlignmentIndependentCostMaximumError': maximum_cost_error,
        'conclusion': ('This prototype flags local similarity; this is a screening ambiguity, not proof of copied output.' if flagged else
            'This prototype found no high-similarity continuous excerpt in these two local recordings at the supplied frozen threshold.'),
        'limitations': ['Only the two pinned local recordings are compared, not all model training data.',
            'Positive controls establish limited transformation sensitivity; independent error-rate validation is unavailable.',
            'Only whole output and two-second windows at half-second strides plus the last window are screened; shorter or intervening reuse is not ruled out.',
            'Position-derived unit directions omit Root travel, bone lengths, palm/finger pose and position-invisible twist.',
            'Per-frame heading is removed; near-vertical pelvis uses the last valid heading and is disclosed.',
            'No style fidelity, global originality, physics quality or licensing conclusion is established.',
            'Native raw motion is scored before retargeting or final feasibility correction.'],
        'actualNetworkRequestsDuringAudit': 0, 'actualModelCallsDuringAudit': 0,
        'scriptSha256': sha(Path(__file__)), 'fkExportSha256': sha(args.priors_world_joints),
        'skeletonMetadataSha256': sha(args.soma_metadata)}
    args.output_dir.mkdir(parents=True, exist_ok=True)
    dump(args.output_dir / 'receipt.json', receipt)
    print(json.dumps({'frames': len(points), 'threshold': threshold,
        'wholeDistance': whole['closest']['directionRms'], 'wholeClosestSource': whole['closest']['sourceId'],
        'wholeClosestSourceInterval': [whole['closest']['sourceStartSeconds'], whole['closest']['sourceEndSeconds']],
        'minimumTwoSecondDistance': min(item['result']['closest']['directionRms'] for item in windows),
        'twoSecondWindows': len(windows), 'screenFlagsHighSimilarity': flagged,
        'savedAlignmentCostMaximumError': maximum_cost_error, 'conclusion': receipt['conclusion']}, ensure_ascii=False))


if __name__ == '__main__':
    main()
