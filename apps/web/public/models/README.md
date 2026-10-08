# Neutral human asset

`neutral-human.glb` is the editor's display mesh. The authoritative animation
contract remains the existing 25-joint `preview-1` rig; display geometry does not
change its joint hierarchy, offsets, FK/IK calculations or stored motion.

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

The conversion aligns each source limb segment to the editor's unchanged
rest positions and lengths. Source spine influences map to the canonical
Hips, Spine and Chest; finger influences merge into their corresponding
hands. Duplicate influences are combined, and each vertex retains at most
four normalized weights. Torso weights are blended along the canonical
spine to keep the body surface continuous when bending and turning.

The neutral display silhouette smooths incidental anatomical protrusions.
Coincident UV-seam vertices are welded before topology reduction so the skin
remains connected. Blender performs offline topology reduction; smooth
normals are recomputed after the final foot and crown calibration. The
output is a self-contained GLB with a matte material, without texture,
animation or runtime Blender/MakeHuman/MPFB tool code. The displayed feet are
calibrated to the built-in standard profile's unchanged sole/contact
envelopes, and the head height is calibrated to the existing rig.

This is a mesh and skin adaptation, not a replacement of the authoritative
25-joint hierarchy or an import of the source model's authoring constraints.
The application's existing joint limits, FK and IK continue to use its
canonical motion contract.

## Derivative verification

The verified derivative is served at `/models/neutral-human.glb`:

| Property | Value |
| --- | --- |
| File size | 776,136 bytes |
| Vertices | 10,704 |
| Triangles | 21,404 |
| Canonical joints | 25 |
| Neutral mesh height | Approximately 1.850 m |
| Embedded textures / animations | None |
| External file dependencies | None |

Derivative SHA-256:

```text
4b5fa085d0a6e403abee4ce022cac8041e5bca8bce130d03f28f245a29fddc9a
```

Three local asset-contract checks passed for canonical joint/parent bindings,
normalized skin weights and normals, nondegenerate geometry and a
self-contained payload. Desktop and mobile rendering were visually inspected,
including an 80-degree shoulder pose. Welding removed cracks observed in the
initial decimation attempt; that earlier artifact is not this final asset.

These checks establish the display asset's local integration. They do not
establish whole-body biomechanical validity or teaching approval; repository
release verification is recorded separately in `docs/VERIFICATION.md`.
