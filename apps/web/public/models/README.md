# Neutral human asset

`neutral-human-v2.glb` is the current editor's display mesh. The authoritative animation
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

The verified current derivative is served at `/models/neutral-human-v2.glb`:

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
The current application requests only the versioned v2 path and validates its
rest calibration before binding. Both files are self-contained CC0 derivatives;
preserve the old asset's historical verification separately from this new one.

These checks establish the display asset's local integration. They do not
establish whole-body biomechanical validity or teaching approval; repository
release verification is recorded separately in `docs/VERIFICATION.md`.
