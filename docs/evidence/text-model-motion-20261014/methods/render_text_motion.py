#!/usr/bin/env python3
"""Render saved canonical25 FK samples only; never infer, solve, or interpolate."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--style', required=True)
parser.add_argument('--audit-dir', type=Path, required=True)
parser.add_argument('--request', type=Path, required=True)
parser.add_argument('--output-dir', type=Path, required=True)
parser.add_argument('--reuse-videos', action='store_true', help='Regenerate only sheet and metrics; validate existing video timing')
args = parser.parse_args()
args.output_dir.mkdir(parents=True, exist_ok=True)
os.environ['MPLCONFIGDIR'] = str(args.output_dir / '.mplconfig')
os.environ['XDG_CACHE_HOME'] = str(args.output_dir / '.cache')
import numpy as np
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib.lines import Line2D

FPS = 30
inputs = {
    'request': args.request,
    'receipt': args.audit_dir / 'audit-receipt.json',
    'raw': args.audit_dir / 'raw-pose-views.json',
    'actual': args.audit_dir / 'last-actual-pose-views.json',
}
correction_record = args.audit_dir / 'last-actual-correction-differences.json'
if correction_record.exists():
    inputs['denserCorrectionRecord'] = correction_record
def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()
before_hashes = {key: sha(path) for key, path in inputs.items()}
data = {key: json.loads(path.read_text()) for key, path in inputs.items()}
receipt = data['receipt']
skeleton = data['request']['context']['skeleton']
names = [j['name'] for j in skeleton['joints']]
if len(names) != 25 or len(set(names)) != 25:
    raise ValueError('Expected provided canonical25 skeleton with unique names')
indices = {name: i for i, name in enumerate(names)}
edges = [(indices[j['parent']], indices[j['name']]) for j in skeleton['joints'] if j['parent'] is not None]
target = data['request']['context']['target']
start = float(target['startSeconds'])
end = float(target['endSeconds'])
if receipt['target'] != target:
    raise ValueError('Saved receipt target differs from the request target')
interval_frames = round((end - start) * FPS)
if not np.isclose(interval_frames / FPS, end - start, atol=1e-12):
    raise ValueError('Target duration is not an integer number of 30 Hz frames')
times = np.asarray([start + i / FPS for i in range(interval_frames + 1)])
sampled = {}
for key in ('raw', 'actual'):
    views = data[key]
    if views.get('coordinateSystem') != 'right-handed-y-up-z-forward' or views.get('units') != 'meters':
        raise ValueError(f'{key}: unexpected FK coordinates')
    frames = views['frames']
    table = {float(frame['time']): frame for frame in frames}
    if len(table) != len(frames):
        raise ValueError(f'{key}: duplicate sample times')
    selected = []
    for time in times:
        # Every selected time must already exist. No visual interpolation is used.
        frame = table.get(float(time))
        if frame is None:
            matches = [frame for t, frame in table.items() if abs(t - time) < 1e-12]
            if len(matches) != 1:
                raise ValueError(f'{key}: exact sampler-grid sample missing at {time}')
            frame = matches[0]
        selected.append(frame)
    positions = np.asarray([[frame['fk'][name]['position'] for name in names] for frame in selected], dtype=float)
    roots = np.asarray([frame['pose']['root'] for frame in selected], dtype=float)
    rotations = np.asarray([[frame['pose']['joints'][name] for name in names] for frame in selected], dtype=float)
    if positions.shape != (interval_frames + 1, 25, 3) or rotations.shape != (interval_frames + 1, 25, 4):
        raise ValueError(f'{key}: inconsistent canonical25 sample shape')
    if not all(np.isfinite(a).all() for a in (positions, roots, rotations)):
        raise ValueError(f'{key}: nonfinite sample')
    sampled[key] = {'positions': positions, 'root': roots, 'rotations': rotations, 'sourceFrameCount': len(frames)}

all_positions = np.concatenate([sampled[k]['positions'] for k in ('raw', 'actual')])
minimum = all_positions.min(axis=(0, 1))
maximum = all_positions.max(axis=(0, 1))
minimum[1] = min(minimum[1], 0)
pad = np.array([0.12, 0.1, 0.12])
minimum -= pad
maximum += pad
left_color, right_color, trunk_color = '#1976D2', '#E07820', '#444444'
colors = [left_color if name.startswith('Left') else right_color if name.startswith('Right') else trunk_color for name in names]
legend = [Line2D([0], [0], color=color, lw=2, label=label) for color, label in ((left_color, 'Left'), (right_color, 'Right'), (trunk_color, 'Trunk'))]
requested_label = {'chinese-classical': 'Chinese classical', 'hip-hop': 'Hip-hop', 'ballet': 'Ballet'}.get(args.style, args.style)
raw_label = f"RAW draft | engineering {receipt['rawEngineeringStatus']}"
actual_label = 'ACTUAL candidate | engineering accepted' if receipt.get('acceptedByEngineeringGate') else f"ACTUAL rejected intermediate | {receipt.get('solverEngineeringStatus', 'unknown')}"
labels = {'raw': raw_label, 'actual': actual_label}

def setup_axis(ax, plane, title):
    horizontal = 0 if plane == 'front' else 2
    ax.set_xlim(minimum[horizontal], maximum[horizontal])
    ax.set_ylim(minimum[1], maximum[1])
    ax.set_aspect('equal', adjustable='box')
    ax.set_xlabel('+X (m)' if plane == 'front' else '+Z (m)', fontsize=8)
    ax.set_ylabel('+Y (m)', fontsize=8)
    ax.set_title(title, fontsize=9)
    ax.grid(alpha=.16)
    ax.axhline(0, color='#777777', lw=.7, ls=':')
    ax.tick_params(labelsize=7)
    for spine in ('top', 'right'):
        ax.spines[spine].set_visible(False)
    return horizontal

def plot_pose(ax, positions, horizontal):
    lines = []
    for parent, child in edges:
        line, = ax.plot(positions[[parent, child], horizontal], positions[[parent, child], 1], color=colors[child], lw=1.8, solid_capstyle='round')
        lines.append(line)
    points = ax.scatter(positions[:, horizontal], positions[:, 1], c=colors, s=9, zorder=3)
    return lines, points

def probe(path):
    output = subprocess.check_output(['ffprobe', '-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height,r_frame_rate,nb_frames,duration', '-show_entries', 'format=duration', '-of', 'json', str(path)])
    result = json.loads(output)
    stream = result['streams'][0]
    if int(stream['nb_frames']) != interval_frames or stream['r_frame_rate'] != '30/1' or abs(float(result['format']['duration']) - (end - start)) > .001:
        raise ValueError(f'Wrong encoded timing: {result}')
    return result

artifacts = {}
for key in ('raw', 'actual'):
    video = args.output_dir / f'{key}-front-side.mp4'
    if args.reuse_videos:
        artifacts[key] = {'file': str(video), 'sha256': sha(video), 'encoding': probe(video)}
        continue
    positions = sampled[key]['positions']
    fig, axes = plt.subplots(1, 2, figsize=(10, 5.5), dpi=80)
    fig.subplots_adjust(left=.07, right=.98, bottom=.13, top=.80, wspace=.24)
    artists = []
    for ax, plane in zip(axes, ('front', 'side')):
        horizontal = setup_axis(ax, plane, 'Front XY' if plane == 'front' else 'Side ZY')
        artists.append((horizontal, *plot_pose(ax, positions[0], horizontal)))
    fig.suptitle(f'Requested: {requested_label} | Canonical25 FK\n{labels[key]} | style and naturalness unassessed', fontsize=10, y=.975)
    fig.legend(handles=legend, loc='upper center', bbox_to_anchor=(.5, .87), ncol=3, frameon=False, fontsize=9)
    timestamp = fig.text(.5, .02, '', ha='center', fontsize=9)
    fig.text(.5, .075, 'Joint centers / fixed markers; contacts unknown. Dotted line is Y=0 reference only.', ha='center', fontsize=7)
    fig.canvas.draw()
    width, height = fig.canvas.get_width_height()
    command = ['ffmpeg', '-y', '-loglevel', 'error', '-f', 'rawvideo', '-vcodec', 'rawvideo', '-pix_fmt', 'rgba', '-s', f'{width}x{height}', '-r', str(FPS), '-i', '-', '-an', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p', '-threads', '1', '-movflags', '+faststart', str(video)]
    process = subprocess.Popen(command, stdin=subprocess.PIPE)
    try:
        # Half-open interval creates exactly duration*fps frames. Endpoint remains
        # available in the contact sheet and metrics, but is not an extra video frame.
        for i in range(interval_frames):
            for horizontal, lines, points in artists:
                for line, (parent, child) in zip(lines, edges):
                    line.set_data(positions[i, [parent, child], horizontal], positions[i, [parent, child], 1])
                points.set_offsets(positions[i][:, [horizontal, 1]])
            timestamp.set_text(f'Scene {times[i]:.3f}s | Local {times[i] - start:.3f}s | saved exact 30 Hz sampler, no interpolation')
            fig.canvas.draw()
            process.stdin.write(fig.canvas.buffer_rgba())
    finally:
        process.stdin.close()
        returncode = process.wait()
        plt.close(fig)
    if returncode:
        raise RuntimeError(f'ffmpeg failed for {key}: {returncode}')
    artifacts[key] = {'file': str(video), 'sha256': sha(video), 'encoding': probe(video)}

comparison = args.output_dir / 'raw-vs-actual.mp4'
if not args.reuse_videos:
    subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-i', str(args.output_dir / 'raw-front-side.mp4'), '-i', str(args.output_dir / 'actual-front-side.mp4'), '-filter_complex', '[0:v][1:v]hstack=inputs=2[v]', '-map', '[v]', '-an', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p', '-threads', '1', '-filter_complex_threads', '1', '-movflags', '+faststart', str(comparison)], check=True)
artifacts['comparison'] = {'file': str(comparison), 'sha256': sha(comparison), 'encoding': probe(comparison)}

sheet_indices = np.rint(np.linspace(0, interval_frames, 6)).astype(int)
fig, axes = plt.subplots(4, len(sheet_indices), figsize=(18, 12), dpi=100)
fig.subplots_adjust(left=.045, right=.99, bottom=.075, top=.84, hspace=.48, wspace=.36)
for row, (key, plane) in enumerate((('raw', 'front'), ('actual', 'front'), ('raw', 'side'), ('actual', 'side'))):
    for col, frame_index in enumerate(sheet_indices):
        ax = axes[row, col]
        horizontal = setup_axis(ax, plane, f"{key.upper()} {plane} | {times[frame_index]-start:.2f}s\nscene {times[frame_index]:.2f}s")
        plot_pose(ax, sampled[key]['positions'][frame_index], horizontal)
fig.suptitle(f'Requested: {requested_label} | RAW vs ACTUAL, canonical25 FK in meters\n{raw_label}; {actual_label}\nStyle / naturalness unassessed; exact saved sampler samples, including the 5.5s endpoint', fontsize=12, y=.975)
fig.legend(handles=legend, loc='upper center', bbox_to_anchor=(.5, .905), ncol=3, frameon=False, fontsize=10)
fig.text(.5, .025, 'Scene 4–9.5s / local 0–5.5s. Foot joint centers and toe/heel fixed markers are not sole geometry. Contacts unknown. Y=0 is a coordinate reference.', ha='center', fontsize=9)
sheet = args.output_dir / 'raw-vs-actual-contact-sheet.png'
fig.savefig(sheet, dpi=100)
plt.close(fig)
artifacts['contactSheet'] = {'file': str(sheet), 'sha256': sha(sheet), 'localTimes': (times[sheet_indices] - start).tolist(), 'sceneTimes': times[sheet_indices].tolist()}

def trajectory_metrics(values, root):
    differences = np.diff(values, axis=0)
    speeds = np.linalg.norm(differences * FPS, axis=1)
    accelerations = np.linalg.norm(np.diff(values, n=2, axis=0) * FPS**2, axis=1)
    relative = values - root
    return {'coordinateMinMeters': values.min(axis=0).tolist(), 'coordinateMaxMeters': values.max(axis=0).tolist(), 'coordinateRangeMeters': np.ptp(values, axis=0).tolist(), 'startMeters': values[0].tolist(), 'endMeters': values[-1].tolist(), 'netDisplacementMeters': (values[-1] - values[0]).tolist(), 'sampledPathLengthMeters': float(np.linalg.norm(differences, axis=1).sum()), 'sampledHorizontalPathLengthMeters': float(np.linalg.norm(differences[:, [0, 2]], axis=1).sum()), 'max30HzDifferenceSpeedMetersPerSecond': float(speeds.max()), 'max30HzSecondDifferenceAccelerationMetersPerSecondSquared': float(accelerations.max()), 'relativeToRootMinMeters': relative.min(axis=0).tolist(), 'relativeToRootMaxMeters': relative.max(axis=0).tolist()}

metrics = {}
markers = ('LeftHand', 'RightHand', 'LeftFoot', 'RightFoot', 'LeftToe', 'RightToe', 'LeftHeel', 'RightHeel')
for key in ('raw', 'actual'):
    root = sampled[key]['root']
    metrics[key] = {'sourceFrameCountIncludingExtraKnots': sampled[key]['sourceFrameCount'], 'Root': trajectory_metrics(root, root)}
    for name in markers:
        metrics[key][name] = trajectory_metrics(sampled[key]['positions'][:, indices[name]], root)
delta = sampled['actual']['positions'] - sampled['raw']['positions']
root_delta = sampled['actual']['root'] - sampled['raw']['root']
dot = np.abs(np.sum(sampled['raw']['rotations'] * sampled['actual']['rotations'], axis=-1))
joint_angle_delta = 2 * np.arccos(np.clip(dot, 0, 1))
changes = {'RootMaxChangeMeters': float(np.linalg.norm(root_delta, axis=1).max()), 'RootCoordinateMinChangeMeters': root_delta.min(axis=0).tolist(), 'RootCoordinateMaxChangeMeters': root_delta.max(axis=0).tolist(), 'allFKJointsMaxPositionChangeMeters': float(np.linalg.norm(delta, axis=-1).max()), 'allLocalJointsMaxAngleChangeRadians': float(joint_angle_delta.max()), 'markerMaxPositionChangeMeters': {name: float(np.linalg.norm(delta[:, indices[name]], axis=1).max()) for name in markers}}
changes['scope'] = f'{interval_frames + 1} endpoint-inclusive exact 30 Hz saved samples only'
after_hashes = {key: sha(path) for key, path in inputs.items()}
if before_hashes != after_hashes:
    raise RuntimeError('Input changed during rendering')
summary = {'scope': 'local rendering of already saved actual canonical25 FK samples; no model calls, solving, inference, or interpolation', 'styleRequested': args.style, 'styleEvaluation': receipt.get('styleEvaluation'), 'trustedExpectedIdentityFromAuditReceipt': receipt.get('trustedExpectedIdentity'), 'identityEvidenceFromAuditReceipt': receipt.get('identityEvidence'), 'coordinateSystem': data['actual']['coordinateSystem'], 'units': 'meters', 'sourceAuditStatus': receipt['status'], 'rawEngineeringStatus': receipt['rawEngineeringStatus'], 'actualAcceptedByEngineeringGate': receipt.get('acceptedByEngineeringGate'), 'finalTotalViolationsFromAudit': receipt.get('finalTotalViolations'), 'actualViewsSource': str(inputs['actual']), 'videoTiming': {'fps': FPS, 'frameCount': interval_frames, 'durationSeconds': end - start, 'sceneStartSeconds': start, 'sceneEndExclusiveSeconds': end, 'localStartSeconds': 0, 'localEndExclusiveSeconds': end - start, 'numericEndpointInclusiveSamples': interval_frames + 1}, 'inputFiles': {key: {'file': str(path), 'sha256': before_hashes[key]} for key, path in inputs.items()}, 'inputFilesUnchanged': before_hashes == after_hashes, 'markerMeaning': {'Hands': 'LeftHand/RightHand are canonical wrist joint centers, not hand-tip markers', 'Feet': 'Foot joint centers / fixed toe and heel markers, not rendered sole geometry', 'contacts': 'unknown, not inferred from marker paths'}, 'limitations': ['Style and naturalness not assessed by engineering acceptance or these pictures.', 'Numeric path, speed and acceleration use only the saved 30 Hz samples; these are diagnostics, not the adaptive gate or continuous dynamics proof.', 'Foot-marker travel alone cannot establish foot sliding without contact information.', 'Canonical25 FK projections show no mesh, skin collision, center of mass, or sole geometry.'], 'trajectoryMetrics': metrics, 'actualMinusRaw': changes, 'artifacts': artifacts, 'generationCallsDuringRendering': 0, 'networkRequestsDuringRendering': 0}
summary_file = args.output_dir / 'visualization-summary.json'
if 'denserCorrectionRecord' in data:
    denser = data['denserCorrectionRecord']
    summary['denserCorrectionDiagnosticFromExistingAudit'] = {'scope': denser['scope'], 'sampleCount': len(denser['differences']), 'maxRootDisplacementMeters': denser['maxRootDisplacementMeters'], 'maxJointRotationRadians': denser['maxJointRotationRadians'], 'note': 'Copied existing denser audit diagnostics, not recomputed from the 30 Hz visualization; neither is a continuous maximum proof.'}
summary_file.write_text(json.dumps(summary, indent=2) + '\n')
print(json.dumps({'style': args.style, 'status': receipt['status'], 'rawStatus': receipt['rawEngineeringStatus'], 'duration': end - start, 'videoFrames': interval_frames, 'exactSamples': interval_frames + 1, 'RootMaxChangeMillimeters': changes['RootMaxChangeMeters'] * 1000, 'summary': str(summary_file), 'artifacts': {key: value['file'] for key, value in artifacts.items()}, 'inputsUnchanged': before_hashes == after_hashes}, indent=2), flush=True)
