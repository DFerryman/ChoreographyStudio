# Neutral human display assets

## v15 MHR native rig and corrective skin

The v15 candidate uses Meta's **Momentum Human Rig (MHR)**, release **v1.0.1**,
LOD3. Saved choreography keeps the unchanged canonical 25-joint `neutral-rig-2`
author contract. The internal display rig retains all **127 native joints**,
including anatomical and twist helpers, and pose-dependent corrective skin.
The canonical adapter matches the author control transforms and existing foot
anchors. Application/release acceptance is recorded separately in the repository
verification and deployment documents; source conversion alone is not delivery.

- [MHR upstream](https://github.com/facebookresearch/MHR)
- [Pinned v1.0.1 release](https://github.com/facebookresearch/MHR/releases/tag/v1.0.1)
- [Source assets archive](https://github.com/facebookresearch/MHR/releases/download/v1.0.1/assets.zip)
- [Exact Apache-2.0 assets license](MHR-LICENSE.txt)
- [Momentum upstream](https://github.com/facebookincubator/momentum)
- [Exact MIT license for the offline converter](MOMENTUM-MIT.txt)
- [Source and derivative checksum manifest](MHR-PROVENANCE.json)

The archive contains `assets/LICENSE.txt` and no `NOTICE` file. Its retained
Apache license is 11,358 bytes, SHA-256
`cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30`.
The offline `pymomentum-cpu` 0.1.114.post0 distribution's MIT license is 1,088
bytes, SHA-256 `da6d3703ed11cbe42bd212c725957c98da23cbff1998c05fa4b3d976d1a58e93`.
Neither the Python runtime nor Torch is bundled with the browser.

Private twist helpers retain the source driver relationships and coefficients,
adapted to neutral-relative axial swing/twist for the canonical control axes.
Directly reusing native Euler X mixed high arm elevation into countertwist and
compressed the back of the shoulder. The adapter preserves its neutral shape,
smooths private guidance between 120 and 180 degrees and fades the ambiguous
perpendicular half-turn projection. Author rotations remain exact, and evaluation
depends only on the current pose. This adapter is not claimed to reproduce every
upstream compact-model Euler control sequence.

The self-contained source GLB is `/models/neutral-mhr-v1.glb`, with its matching
metadata also in `/models/neutral-mhr-v1.json`. Native geometry and skin retain
4,899 vertices and 9,794 triangles in their original order. The official skin
stores eight slots, but only the first four contain positive weights; every
remaining slot is exactly zero. The browser's four weights are preserved
bit-for-bit, with no pruning or renormalization. Native bind axes, pre-rotations,
hierarchy and all 127 joint names remain intact. Centimeters are converted to
meters, and the native root's rest position is subtracted from geometry and world
bind transforms together. Normals are recomputed on the original topology.
There is no bone collapsing, topology reduction, external texture or animation.

The GLB preserves source geometry and original source inverse bind matrices.
Its raw source mesh height is approximately 1.7254 meters. Runtime applies the
canonical adapter's fixed longitudinal segment scales and `skinBindAdjustments`
for the foot envelope and head crown. These adjustments multiply the original
skin inverse bind once, leaving control bone positions and rotations unchanged;
base geometry and decoded corrective displacement receive the same affine.
The descriptor records the neutral calibration calculation targeting a 1.85-meter
body and unchanged foot-local bounds X ±0.048, Y [-0.082, 0.034], and
Z [-0.075, 0.165] meters. Actual runtime profile checks measured approximately 1.850000 meters and the
expected foot-local sole, width, heel and toe bounds. The raw source GLB positions
are not claimed to be the calibrated stage's standing dimensions.

`neutral-mhr-correctives-v1.bin` retains the upstream learned mapping in a
lossless sparse CSR payload: 750 features, 3,000 ReLU activations, 4,899 vertices,
53,136 activation coefficients and 1,532,952 corrective coefficients. Dimensions,
row offsets, column bounds and finite values are checked before evaluation. The
binary is 9,587,356 bytes, SHA-256
`b09418f280a379c4f4a3fb72f4c8b909a6339a5fd1c7ed5513f3b8a17b947bde`.
Output is in native centimeters and is added before skinning at 0.01 meters per
centimeter. This is actual local learned deformation math, distinct from Workers
AI or choreography generation; it consumes no paid model API request.

The native GLB conversion was checked against the official eight-slot skin plus
correctives at neutral, 90°, 150° and 170° poses, with maximum position error
below 0.55 micrometer. This confirms conversion and source skin parity. It does
not replace calibrated edit/K/playback views, whole-body checks, release testing
or teacher approval. v14/older meshes and licenses below remain unchanged for
historical evidence and already-open clients.

### Reproduce the asset bundle

Obtain the pinned release assets, then install NumPy and the offline MIT
`pymomentum-cpu` converter. The converter's geometry module works without Torch.
Run from the repository root, using the shipped descriptor as the fixed avatar
calibration blueprint:

```sh
python infra/mhr_prepare.py --assets /path/to/extracted/assets \
  --adapter-contract apps/web/public/models/neutral-mhr-v1.json \
  --momentum-license apps/web/public/models/MOMENTUM-MIT.txt \
  --output /path/to/prepared-models
```

The script verifies all five source checksums, preserves native vertex/bone order
and four exact weights, exports native binds and metadata, and rebuilds the CSR
corrective payload without thresholding. It performs no download or model API
call. Derived sizes and checksums are recorded in `MHR-PROVENANCE.json`; its
metadata matches the GLB extras and sidecar. A local reproduction of all six
bundle files was byte-identical. Calibrated pose acceptance remains independent.

## Historical v14 CC0 neutral mesh

`neutral-human-v2.glb` is the retained v14 display mesh. The authoritative animation
contract remains the 25-joint `preview-1` rig. Version 14 uses one fixed
`neutral-rig-2` calibration for this mesh, the stage, FK, IK and physical
diagnostics. The joint names, hierarchy, local rotation channels and recorded
Root/times are unchanged; this is not an independently animated display rig.

## Source and permission

The source is **Human base mesh with editable 53-bone rig**, published by
Innerscene. Its asset page identifies it as an original derivative of
MakeHuman/MPFB CC0 body, rig and skin assets and explicitly dedicates the
result to **CC0 1.0 Universal**, allowing use, modification and redistribution,
including commercial use.

- [Original asset and CC0 dedication](https://www.innerscene.com/tools/library/3d-parts/human-base-mesh-with-editable-53-bone-rig-8e7c8ab1)
- [Original GLB download](https://www.innerscene.com/api/library/human-base-mesh-with-editable-53-bone-rig-8e7c8ab1/download)
- [MakeHuman/MPFB upstream asset licensing](https://static.makehumancommunity.org/about/license.html)
- [MakeHuman exported-model permission](https://static.makehumancommunity.org/makehuman/faq/can_i_sell_models_created_with_makehuman.html)
- [CC0 1.0 Universal terms](https://creativecommons.org/publicdomain/zero/1.0/)
- [Retained complete CC0 legal code](CC0.txt), served at `/models/CC0.txt`

Retrieved on 2026-10-08. The original download is 4,994,640 bytes; SHA-256:

```text
7135e03b6259e970458deff3e0458610914d7c35164cae12611101361e4a5749
```

The original GLB contains one gray mesh, a 53-bone weighted skeleton and no
animation or external textures. Its anatomical skin is adapted offline to
this project's canonical 25-joint display rig and optimized for browser
delivery. Its source bind rotations are not applied to saved choreography.

The CC0 asset license is separate from the upstream tools' GPL/AGPL source-code
licenses. No MakeHuman or MPFB program code is included in the application.
This asset is not an Unreal Engine mannequin, a motion-capture source or a
teacher-approved biomechanical reference.

## Offline adaptation

The conversion aligns each source limb segment to the editor's fixed
rest positions and lengths. Source spine influences map to the canonical
Hips, Spine and Chest; finger influences merge into their corresponding
hands. Duplicate influences are combined, and each vertex retains at most
four normalized weights. Torso weights are blended along the canonical
spine to keep the body surface continuous when bending and turning.

The earlier calibration placed upper-arm pivots at X = ±0.287 m, much wider
than the source adult. `neutral-rig-2` places Shoulder local X at ±0.100 m
and UpperArm local X at ±0.110 m, giving upper-arm rest pivots at ±0.210 m.
Every other rest offset is unchanged. This removes the large lateral
shoulder stretch rather than concealing it with separate visual bones.
The head and forearm volumes are adapted with the narrower body proportions.
Clavicle and armpit surfaces are smoothed offline; shoulder weights are
regularized along connected mesh edges, avoiding weight leakage between
nearby arm and torso surfaces. There are still only 25 bones and at most
four normalized influences per vertex, without helper bones or morph targets.

The neutral display silhouette smooths incidental anatomical protrusions.
Coincident UV-seam vertices are welded before topology reduction so the skin
remains connected. Blender performs offline topology reduction; smooth
normals are recomputed after the final foot and crown calibration. The
output is a self-contained GLB with a matte material, without texture,
animation or runtime Blender/MakeHuman/MPFB tool code. The displayed feet are
calibrated to the built-in standard profile's unchanged sole/contact
envelopes, and the head height is calibrated to the existing rig.

Old scenes retain their exact stored quaternions, Root positions, sample
times, explicit keys and histories. Their derived arm positions change with
the fixed avatar calibration; this is an intentional avatar upgrade, not a
promise of identical old hand trajectories. The unchanged lower-body offsets
preserve leg and foot world transforms and saved foot-contact anchors. No
bone-length editor is introduced. Existing joint limits and FK/IK use the
same new calibration as the skin; source authoring constraints are not imported.

## Derivative verification

The verified v14 derivative is served at `/models/neutral-human-v2.glb`:

| Property | Value |
| --- | --- |
| File size | 853,172 bytes |
| Vertices | 11,774 |
| Triangles | 23,544 |
| Canonical joints | 25 |
| Fixed calibration | `neutral-rig-2` |
| Neutral mesh height | Approximately 1.850 m |
| Embedded textures / animations | None |
| External file dependencies | None |

Derivative SHA-256:

```text
f7be9db402be188a2dd6f02d242eba83d6f84cd37ee2b3612447620580bb35cd
```

Three local asset-contract checks passed for canonical joint/parent bindings,
normalized skin weights and normals, nondegenerate geometry and a
self-contained payload. Eight offline CPU-skinned poses remained finite and
nondegenerate, with unchanged legacy lower-body world matrices. Actual local
browser views were inspected at neutral, 80/120-degree raised arm, bent
elbow/knee and crouch poses, plus a 390 px mobile view. These show the improved
proportions and continuous shoulder/armpit surface. Ordinary linear skinning
still has underarm creasing at high arm angles; these representative checks
do not establish perfect volume preservation for every creative pose.

The v12/v13 derivative remains served unchanged at `/models/neutral-human.glb`:
776,136 bytes, SHA-256
`4b5fa085d0a6e403abee4ce022cac8041e5bca8bce130d03f28f245a29fddc9a`.
Keeping this older path prevents an already-open v13 application from fetching
the new skin against its older rig when a delayed model request completes.
The v14 application requests only the versioned v2 path and validates its
rest calibration before binding. Both files are self-contained CC0 derivatives;
preserve the old asset's historical verification separately from this new one.

These checks establish the display asset's local integration. They do not
establish whole-body biomechanical validity or teaching approval; repository
release verification is recorded separately in `docs/VERIFICATION.md`.
