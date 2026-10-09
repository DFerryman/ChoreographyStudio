# Neutral human display assets

## v17 user-selected Quaternius default avatar

The user compared eight actual three-view candidate cards, then explicitly chose
candidate 06, **Quaternius Superhero Male**, as the only default avatar. Root
reviewed all 24 actual rendered candidate views; candidate 05 is named 写实柔和.
No avatar-switching UI is added. Static selection pictures are appearance
comparison, while actual application editing/playback and release acceptance
are recorded separately in [verification](../../../../docs/VERIFICATION.md)
and [deployment](../../../../docs/DEPLOYMENT.md).

The selected official **Universal Base Characters Standard** free pack is
[CC0](CC0-1.0.txt), not the paid Source pack. Its actual filename is
`Superhero_Male_FullBody`; Standard does not include the paid Regular/Teen
families. The [official source](https://quaternius.com/packs/universalbasecharacters.html)
and [download page](https://quaternius.itch.io/universal-base-characters),
[exact package license](QUATERNIUS-SOURCE-LICENSE.txt),
[provenance](QUATERNIUS-PROVENANCE.json) and
[independent native source reference](quaternius-source-reference-v1.json)
are preserved. CC0 legal text was obtained from the official SPDX license list
mirror; the Creative Commons page remains its canonical license URL. The
source audit preserves the Creative Commons fetch failure without bypassing it.

The downloaded ZIP is 128968391 bytes, SHA-256
`fdbf1804c90dfc1ea03e992bff7da2dfd1a79318e13270a660180f9308455f40`;
official itch.io upload identifier 15861669. Source glTF is 30989 bytes,
SHA-256 `e7fcea214ecf8855afbf910b50de6f9c7d1decfb71ca28bad8a4481452dafeb4`,
and its binary is 720076 bytes,
SHA-256 `459003f9745853ae562a85506a2b94dd56515c1f37728f9fa3d2ce1a3e4cd92f`.

- `neutral-quaternius-v1.glb`: 480376 bytes, SHA-256
  `6570b23a63a0a5b87ad3fa5f8d7a24536c8e7fc3ceb03d28893cb48966cc6527`.
- `neutral-quaternius-v1.json`: 79998 bytes, SHA-256
  `882e122c2d497ea7c23ce073eefe3ddc3d09b6992f814a586b5b9ca658b7e68b`.
- `QUATERNIUS-SOURCE-LICENSE.txt`: 806 bytes, SHA-256
  `0f4beaf0fe360a7732e58bbe3dbf60a2422367fbea60cb9ea4add968f383268e`.
- `CC0-1.0.txt`: 7048 bytes, SHA-256
  `a2010f343487d3f7618affe54f789f5487602331c0a8d03f49e9a7c547cf0499`.
- `QUATERNIUS-PROVENANCE.json`: 4536 bytes, SHA-256
  `e285e633f90581f70101902f26fefdd4fc48cc26129c3303d9d9ab47d929ccc0`.
- `quaternius-source-reference-v1.json`: 46186 bytes, SHA-256
  `4f11106922e5899aa35d2efab9b63e16b257f8c81ee0a643863b94e8bc6c2394`.

The source has three mesh pieces, 8483 vertices, 14318 triangles, **65 native
bones and four skin-weight slots**. Offline preparation concatenates source
pieces into one SkinnedMesh, retaining positions, normals, joint slots,
original weights, hierarchy/TRS and inverse bind matrices; indices change only
by each piece's vertex offset. Native geometry is not welded, remeshed or
reweighted. An independent source-ZIP check finds all raw data bit-exact and
five native LBS poses match at all 8483 vertices with maximum 0m error
(2 micrometers tolerance). This verifies the native merge, not runtime editing.

The application captures original GLB skin-weight accessor values before
GLTFLoader's automatic normalization, then restores those exact four-slot
Float32 values to the loaded mesh. It does not substitute normalized weights,
prune influences or regenerate weights. Raw source data and the loaded runtime
weights are checked separately. The default avatar loads its GLB and descriptor;
MHR corrective data below belong to the historical avatar.

### Fixed canonical display with one coherent source body bind

The descriptor retains raw source fields and adds an offline independent NumPy
`quaternius-canonical-display-2` declaration. Runtime source/canonical math
independently recomputes and validates that declaration. Raw native 65-bone TRS,
inverse binds, geometry and weights stay exact in the source asset.

All 21 mapped physical frames remain at existing canonical FK positions, with
author world rotation applied over fixed neutral source orientation; canonical
controls, authored motion/Root/times/history, limits, IK and foot-lock intent
retain their contracts. Limb lengths and pivots are fixed calibrated values,
not a claim of completely native FK or unchanged skeleton proportions.
`spine_02` uses the fixed source-derived Spine/Chest blend fraction
0.4440797710948548; original fingers/helpers follow their calibrated parents.

Runtime skin bindings use independent clones of the raw inverse-bind array and
matrices. Body root, pelvis, three spine bones, both clavicles, neck and the
**complete head share one source-rest similarity transform G**: uniform scale
1.0167145770612094, actor-local Y translation -1.0403313802775447 and Z translation
+0.06649314313096474. G aligns the native source sole to stage ground and the
mean source upper-arm depth to the canonical upper-arm depth; it is not tuned
from the failed platform's appearance. Body skin uses G times the raw source
rest frames, preserving coherent torso/neck/head rest form across those bones.
Head stretch/compression is removed; head factor is 1. Limb calibration and the
fixed 82mm Foot/ball/leaf world-up plantar-depth corrections remain separate.
Raw GLB inverse binds are never overwritten or shared runtime clones modified.

Neutral arms use down 0 degrees rather than the selection picture's 20-degree
pose; the user selected the body form. Selection display height 1.8m only aids
comparison. The production profile is 1.85m, while world head-top height above
the stage and the mesh maxY-minY surface span must be recorded separately.
Mixed calf/foot skin weights mean visible sole and canonical proxy need actual
contact review; 82mm is a fixed calibration target, not an all-vertices guarantee.

The earlier display-1 body/neck/head calibration passed numerical checks but
was rejected in actual arm150/170 images for a horizontal chest/shoulder
platform and overwide neck. Its descriptor, figures and receipts remain rejected
history. The display-2 candidate's neutral/150/coordinated130+20 three renders
were visually reviewed before formal application QA; isolated candidate images
do not replace actual handle editing, K, interpolation/playback or final tests.
Source and runtime numerical/visual scopes remain separate. No real Workers AI,
paid generation or asset purchase is needed. Complete MHR and earlier source,
license and release descriptions below remain historical.

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

### Corrective asset transport

The browser downloads `neutral-mhr-correctives-v1.bin.gz`, a standard gzip
wrapper of the unchanged CSR binary. Its wire size is 6,244,575 bytes, SHA-256
`51b3557f469f9a22daec511302bb11a53ae778d1d8533d8d3b7ea3390df4d82b`.
Decompression restores all 9,587,356 original bytes and the original SHA-256
above; bone data, weights, geometry, GLB extras and the sidecar remain unchanged.
The deterministic wrapper uses compression level 9, an empty filename,
timestamp zero and OS byte 255. `MHR-PROVENANCE.json` records the wrapper in the
outer `correctivesWire` entry, separately from native model metadata.

The verified Cloudflare release serves explicit gzip bytes without a
`Content-Encoding: gzip` header. A development server may instead add that
header, in which case Fetch decodes the body before the application sees it.
The loader inspects the first eight body bytes: it accepts the already-decoded
`MHRCORR1` payload, or uses `DecompressionStream('gzip')` for a gzip archive.
Both paths enforce bounded lengths, cancellation and the exact original SHA-256
before parsing the same payload, with one fetch and no model API fallback.

Earlier upload attempts returned 401 or 500; those responses did not establish
a size-related cause or a provider hard limit. Standard native upload succeeded
with this deterministic, smaller gzip representation. The result establishes
successful delivery, without asserting the cause of the earlier failures.

The public assets root contains `.assetsignore` with the single exact rule
`/models/neutral-mhr-correctives-v1.bin`. Wrangler follows
[gitignore rules](https://developers.cloudflare.com/workers/static-assets/binding/#ignoring-assets),
so the original binary remains available locally and in CI but is omitted from
Cloudflare upload; the `.bin.gz` wrapper is included. Vite copies this ignore
file to the built assets root. No model API call is required for compression,
decompression or local learned corrective evaluation.

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
  --output /path/to/prepared-public/models \
  --assets-ignore-output /path/to/prepared-public/.assetsignore
```

The script verifies all five source checksums, preserves native vertex/bone order
and four exact weights, exports native binds and metadata, and rebuilds the CSR
corrective payload without thresholding. It performs no download or model API
call. Derived sizes and checksums are recorded in `MHR-PROVENANCE.json`; its
metadata matches the GLB extras and sidecar. It also produces the deterministic
gzip wrapper and optionally writes `.assetsignore` at the specified assets-root
path. A local reproduction of all seven model bundle files and the assets-root
ignore file was byte-identical; full gzip decoding also matched the original
binary byte-for-byte. Calibrated pose acceptance remains independent.

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
