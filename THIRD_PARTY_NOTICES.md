# Third-party software notices

Choreo Studio's original application code and original procedural mannequin
fallback are covered by the repository [MIT license](LICENSE). The historical
neutral human display asset has the separate CC0 permission described below;
the MHR full-body display candidate has its own Apache-2.0 asset license. No UE
official mannequin, third-party motion capture or music is included.

The browser application also distributes these libraries. Their licenses apply
to their respective software, including bundled JavaScript and WebAssembly.

| Software | Version | Use | License / retained text |
| --- | --- | --- | --- |
| [Three.js](https://github.com/mrdoob/three.js) | 0.186.1 | Rendering, quaternion/vector math and the upstream `CCDIKSolver` adapted to the original rig | MIT; [exact installed notice](apps/web/public/third-party-licenses/three-mit.txt), served at `/third-party-licenses/three-mit.txt` |
| [Rapier JS compatibility bindings](https://github.com/dimforge/rapier.js) | 0.21.0 | Lazily loaded dynamic-body gravity/contact assistance | Apache-2.0; [exact installed license](apps/web/public/third-party-licenses/rapier-apache-2.0.txt), served at `/third-party-licenses/rapier-apache-2.0.txt` |

These two retained files are copied verbatim from the respective installed
packages. The Rapier package provides an Apache license file and no separate
NOTICE file. Its upstream engine is [Rapier](https://github.com/dimforge/rapier).
Neither software license establishes permission for unrelated human models,
motion content or music.

## Neutral human display mesh

`apps/web/public/models/neutral-human.glb` is derived from **Human base mesh
with editable 53-bone rig**, published by Innerscene from MakeHuman/MPFB core
assets. The publisher explicitly dedicates the derivative to CC0 and states:
"Free to use, modify and redistribute for any purpose, including commercially".
[Source and permission](https://www.innerscene.com/tools/library/3d-parts/human-base-mesh-with-editable-53-bone-rig-8e7c8ab1).

The upstream MakeHuman/MPFB project separately states that all core assets are
shared under CC0. The source code licenses of those tools are GPL/AGPL;
neither tool's source code is included here.
[Upstream asset license](https://static.makehumancommunity.org/about/license.html).

The original GLB was retrieved on 2026-10-08 and contains 4,994,640 bytes.
Its SHA-256 is
`7135e03b6259e970458deff3e0458610914d7c35164cae12611101361e4a5749`.
Conversion adapts its anatomical skin to the editor's existing 25-joint
animation contract and optimizes browser geometry; the source's 53-joint
bind pose is not substituted for authoritative stored motion.

Full CC0 legal text is retained in
[models/CC0.txt](apps/web/public/models/CC0.txt), served at `/models/CC0.txt`.
[Asset provenance and derivative verification](apps/web/public/models/README.md)
records the precise source, transformation and final asset measurements.
This is generic display geometry, not an Unreal production character,
motion-capture material or teacher-reviewed biomechanical reference.

## Meta MHR full-body display candidate · v15 preparation

[Meta MHR](https://github.com/facebookresearch/MHR) v1.0.1 publishes the source
LOD3 mesh, native 127-joint hierarchy and skin weights, the compact skeletal
model and learned pose-corrective data used by this candidate. Assets were
retrieved from the [official v1.0.1 release](https://github.com/facebookresearch/MHR/releases/tag/v1.0.1).
The actual release `assets/LICENSE.txt` is Apache-2.0, 11,358 bytes, SHA-256
`cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30`;
the downloaded source entries were checked against the ZIP CRC. Retained
copy is [MHR-LICENSE.txt](apps/web/public/models/MHR-LICENSE.txt).

[Momentum](https://github.com/facebookincubator/momentum), including the
official `pymomentum-cpu` 0.1.114.post0 reference used for offline asset preparation
and comparison, is MIT licensed. Its exact 1,088-byte installed license is
retained in [MOMENTUM-MIT.txt](apps/web/public/models/MOMENTUM-MIT.txt),
SHA-256 `da6d3703ed11cbe42bd212c725957c98da23cbff1998c05fa4b3d976d1a58e93`.
The dependency is not bundled into the browser or Worker. The official MHR
release asset directory contains `LICENSE.txt` and no separate `NOTICE`.
The asset preparation record identifies the exact source inputs,
conversion and resulting files; application-specific author adaptation is
separate from the upstream implementation.

The v15 candidate preserves native display bones and published learned
sparse-ReLU pose correctives for local skin computation. The primary editor
continues to use its canonical 25-joint author/FK/IK contract; the 127 internal
display bones do not add author controls. Calibration and skin verification have passed their documented local scope;
remote source CI and release verification are still pending. These licenses
do not establish biological accuracy, safety, motion-content permission or
teacher acceptance. Local published-model pose correction is actual
computation; the no-usage constraint concerns Workers AI inference and paid
choreography-generation requests, both of which remain unused in tests.

The optional AI route references the model hosted by Cloudflare Workers AI; its
weights are not downloaded or redistributed by this project. Model availability,
usage terms and licensing remain those of the provider and the selected model.
