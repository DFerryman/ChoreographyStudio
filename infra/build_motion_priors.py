"""Build motion-only CMU derivatives from the two already published, pinned packs.

This offline command does not download anything. Input packs stay outside Git;
no scene metadata, author tracks, history, or audio is copied into the product.
"""
import argparse
import bisect
import hashlib
import json
import math
from pathlib import Path
import struct

JOINTS = ['Hips', 'Spine', 'Chest', 'Neck', 'Head',
          'LeftShoulder', 'LeftUpperArm', 'LeftForeArm', 'LeftHand', 'LeftHandTip',
          'RightShoulder', 'RightUpperArm', 'RightForeArm', 'RightHand', 'RightHandTip',
          'LeftUpperLeg', 'LeftLowerLeg', 'LeftFoot', 'LeftToe', 'LeftHeel',
          'RightUpperLeg', 'RightLowerLeg', 'RightFoot', 'RightToe', 'RightHeel']
SOURCES = [
    ('cmu-85-12', 'complex-street-dance.choreo', 'e5f3d969c550fa6d401706b08cbe8beafb80a9346e1029e4d2c7a10a906afad5'),
    ('cmu-61-08', 'salsa-dance.choreo', '9d8022c073eb79210f8d6b1d9b661e2db05ee62541ca9fa1027551379100e34d'),
]
MAGIC = b'CHOREO-PRIOR-1\n\x00'


def multiply(a, b):
    x, y, z, w = a
    u, v, s, t = b
    return [w*u+x*t+y*s-z*v, w*v-x*s+y*t+z*u,
            w*s+x*v-y*u+z*t, w*t-x*u-y*v-z*s]


def normalize(q):
    length = math.sqrt(sum(x*x for x in q))
    if not math.isfinite(length) or length < 1e-12:
        raise ValueError('Invalid source quaternion')
    return [x/length for x in q]


def slerp(a, b, amount):
    a, b = normalize(a), normalize(b)
    dot = sum(x*y for x, y in zip(a, b))
    if dot < 0:
        b, dot = [-x for x in b], -dot
    dot = max(-1, min(1, dot))
    if dot > .9995:
        return normalize([x+(y-x)*amount for x, y in zip(a, b)])
    angle = math.acos(dot)
    ca, cb = math.sin((1-amount)*angle)/math.sin(angle), math.sin(amount*angle)/math.sin(angle)
    return normalize([ca*x+cb*y for x, y in zip(a, b)])


def sample(take, time):
    index = bisect.bisect_left(take['times'], time)
    if index == 0:
        return take['poses'][0]
    if index == len(take['times']):
        return take['poses'][-1]
    if take['times'][index] == time:
        return take['poses'][index]
    previous, current = take['poses'][index-1:index+1]
    amount = (time-take['times'][index-1])/(take['times'][index]-take['times'][index-1])
    return {'root': [x+(y-x)*amount for x, y in zip(previous['root'], current['root'])],
            'joints': {joint: slerp(previous['joints'][joint], current['joints'][joint], amount) for joint in JOINTS}}


def canonicalize(pose):
    joints = {joint: normalize(pose['joints'][joint]) for joint in JOINTS}
    # The published retargeter uses fixed +/-30deg elbow carrying frames.
    # Redistribute that Y-axis rotation to the humerus. The elbow offset lies
    # on -Y, so its position and every forearm/wrist/hand world transform stay
    # unchanged, while elbow flexion now uses the canonical -X hinge frame.
    error, hand_error, foot_error = 0, 0, 0
    for side, degrees in [('Left', 30), ('Right', -30)]:
        angle = degrees*math.pi/180/2
        turn = [0, math.sin(angle), 0, math.cos(angle)]
        inverse = [0, -math.sin(angle), 0, math.cos(angle)]
        upper, forearm = side+'UpperArm', side+'ForeArm'
        before = multiply(joints[upper], joints[forearm])
        joints[upper] = normalize(multiply(joints[upper], turn))
        joints[forearm] = normalize(multiply(inverse, joints[forearm]))
        after = multiply(joints[upper], joints[forearm])
        error = max(error, max(abs(x-y) for x, y in zip(before, after)))
        # BVH palm pronation was also assigned to the wrist rather than the
        # forearm. Move only axial Y into the forearm's +/-110deg envelope.
        # The hand offset is along -Y, so its world position/orientation and
        # every hand-tip transform are preserved. A residual stays at the
        # wrist if removing it all would exceed the forearm's bound.
        hand = side+'Hand'
        before_hand = multiply(joints[forearm], joints[hand])
        principal = lambda angle: (angle+math.pi) % (2*math.pi)-math.pi
        forearm_twist = principal(2*math.atan2(joints[forearm][1], joints[forearm][3]))
        wrist_twist = principal(2*math.atan2(joints[hand][1], joints[hand][3]))
        total = principal(forearm_twist+wrist_twist)
        assigned = min(110*math.pi/180, max(-110*math.pi/180, total))
        transferred = assigned-forearm_twist
        turn = [0, math.sin(transferred/2), 0, math.cos(transferred/2)]
        inverse = [0, -turn[1], 0, turn[3]]
        joints[forearm] = normalize(multiply(joints[forearm], turn))
        joints[hand] = normalize(multiply(inverse, joints[hand]))
        after_hand = multiply(joints[forearm], joints[hand])
        hand_error = max(hand_error, max(abs(x-y) for x, y in zip(before_hand, after_hand)))
        # Extra ankle longitudinal-Y motion belongs partly to tibial rotation.
        # Smoothly transfer it before the +/-30deg ankle boundary, constrained
        # by the existing +/-25deg tibial envelope. The down-Y ankle offset
        # makes this an exact paired world-foot/toe/heel transform preservation.
        lower, foot = side+'LowerLeg', side+'Foot'
        before_foot = multiply(joints[lower], joints[foot])
        tibial = principal(2*math.atan2(joints[lower][1], joints[lower][3]))
        ankle = principal(2*math.atan2(joints[foot][1], joints[foot][3]))
        band = 5*math.pi/180
        excess = abs(ankle)-30*math.pi/180
        transfer = math.tanh(ankle/band)*.5*(excess+math.sqrt(excess*excess+band*band))
        transfer = min(25*math.pi/180-tibial, max(-25*math.pi/180-tibial, transfer))
        turn = [0, math.sin(transfer/2), 0, math.cos(transfer/2)]
        inverse = [0, -turn[1], 0, turn[3]]
        joints[lower] = normalize(multiply(joints[lower], turn))
        joints[foot] = normalize(multiply(inverse, joints[foot]))
        after_foot = multiply(joints[lower], joints[foot])
        foot_error = max(foot_error, max(abs(x-y) for x, y in zip(before_foot, after_foot)))
    return {'root': pose['root'][:], 'joints': joints}, error, hand_error, foot_error


def endpoint_facts(output):
    """Planning facts from exact stored Float32 endpoint poses, not raw Take.

    Whole-clip facts do not describe an arbitrary source subinterval. Facing
    is unavailable for inverted hips or a near-vertical forward projection.
    This is receipt-only metadata; it does not change motion asset bytes.
    """
    header_size = struct.unpack_from('<I', output, 16)[0]
    records = [struct.unpack_from('<d103f', output, 20+header_size),
               struct.unpack_from('<d103f', output, len(output)-420)]
    tags = []
    for label, record in zip(['start', 'end'], records):
        root, q = record[1:4], normalize(record[4:8])
        x, y, z, w = q
        facing_x, facing_z = 2*(x*z+w*y), 1-2*(x*x+y*y)
        up = 1-2*(x*x+z*z)
        facing = 'unknown' if up <= .2 or facing_x*facing_x+facing_z*facing_z < 1e-8 else str(round(math.atan2(facing_x, facing_z)*180/math.pi, 6))
        tags.extend([f'wholeClip.{label}RootXZ={json.dumps([root[0], root[2]], separators=(",", ":"))}',
                     f'wholeClip.{label}RootY={root[1]}', f'wholeClip.{label}FacingYawDeg={facing}'])
    if len(tags) != 6 or any(len(tag) > 80 for tag in tags):
        raise ValueError('Endpoint facts exceed the bounded planner tags')
    return tags


def build(source_dir, output_dir):
    output_dir.mkdir(parents=True, exist_ok=True)
    receipt = []
    for clip_id, filename, source_hash in SOURCES:
        raw = (source_dir/filename).read_bytes()
        if hashlib.sha256(raw).hexdigest() != source_hash:
            raise ValueError(f'{filename}: public source hash mismatch; private/modified scenes are not accepted')
        if raw[:16] != b'CHOREO-BUNDLE-1\n':
            raise ValueError('Unknown public source codec')
        header_size = struct.unpack_from('<I', raw, 16)[0]
        header = json.loads(raw[20:20+header_size])
        project = header['scene']['project']
        take = project['history'][project['historyIndex']]['take']
        windows = [(clip_id, 0, take['durationSeconds'])]
        for index, start in enumerate(range(0, math.floor(take['durationSeconds']), 8)):
            end = take['durationSeconds'] if take['durationSeconds']-start <= 8.5 else start+8
            windows.append((clip_id+'-'+chr(ord('a')+index), start, end))
        for output_id, source_start, source_end in windows:
            duration = source_end-source_start
            times = [frame/30 for frame in range(math.ceil(duration*30))] + [duration]
            samples, maximum_error, maximum_hand_error, maximum_foot_error = [], 0, 0, 0
            for time in times:
                pose, error, hand_error, foot_error = canonicalize(sample(take, source_start+time))
                maximum_error = max(maximum_error, error)
                maximum_hand_error = max(maximum_hand_error, hand_error)
                maximum_foot_error = max(maximum_foot_error, foot_error)
                samples.append((time, pose))
            metadata = {'schema': 'human-motion-prior-1', 'id': output_id,
                    'skeletonId': 'neutral-rig-2', 'durationSeconds': duration,
                    'sampleCount': len(samples), 'sampleRateHz': 30,
                    'sourceBundleHash': source_hash,
                    'sourceUrl': 'https://choreo-scene-packs.danuberiverferryman.workers.dev/'+filename,
                    'processing': 'Published retargeted effective take; exact 30Hz + final time; float32 poses; fixed +/-30deg forearm carrying-frame redistribution into humeral axial twist; wrist longitudinal-Y pronation reassigned to forearm within +/-110deg, preserving hand world transforms; smooth ankle-Y excess redistributed into tibial Y within +/-25deg toward ankle +/-30deg, preserving foot/toe/heel world transforms. Residual beyond the tibial budget remains for the physical gate, not certified anatomy.',
                    'maxPrequantizationForearmWorldQuaternionError': maximum_error,
                    'maxPrequantizationHandWorldQuaternionError': maximum_hand_error,
                    'maxPrequantizationFootWorldQuaternionError': maximum_foot_error,
                    'license': 'CMU mocap: copying/modification/redistribution and commercial product inclusion permitted; direct data resale prohibited, including converted data.',
                    'attribution': 'Data obtained from mocap.cs.cmu.edu; database funded by NSF EIA-0196217.'}
            if output_id != clip_id:
                metadata['sourceRangeSeconds'] = [source_start, source_end]
            encoded = json.dumps(metadata, separators=(',', ':'), ensure_ascii=True).encode()
            output = bytearray(MAGIC + struct.pack('<I', len(encoded)) + encoded)
            for time, pose in samples:
                values = pose['root'] + [value for joint in JOINTS for value in pose['joints'][joint]]
                if not all(math.isfinite(value) for value in values):
                    raise ValueError('Non-finite motion source')
                output.extend(struct.pack('<d103f', time, *values))
            destination = output_dir/(output_id+'.motion')
            temporary = destination.with_suffix('.motion.tmp')
            temporary.write_bytes(output)
            temporary.replace(destination)
            low = min(pose['root'][1] for _, pose in samples)
            high = max(pose['root'][1] for _, pose in samples)
            min_up = min(1-2*(pose['joints']['Hips'][0]**2+pose['joints']['Hips'][2]**2) for _, pose in samples)
            receipt.append({'id': output_id, 'bytes': len(output), 'sha256': hashlib.sha256(output).hexdigest(),
                            'durationSeconds': duration, 'samples': len(samples), 'sourceRangeSeconds': [source_start, source_end],
                            'capturedRootHeightRangeMeters': [low, high], 'minimumHipsUpDot': min_up,
                            'endpointFacts': endpoint_facts(output),
                            'maxPrequantizationForearmWorldQuaternionError': maximum_error,
                            'maxPrequantizationHandWorldQuaternionError': maximum_hand_error,
                            'maxPrequantizationFootWorldQuaternionError': maximum_foot_error})
    print(json.dumps(receipt, indent=2))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source-dir', type=Path, required=True)
    parser.add_argument('--output-dir', type=Path, default=Path('apps/web/public/motion-priors'))
    options = parser.parse_args()
    build(options.source_dir, options.output_dir)
