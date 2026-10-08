# Third-party software notices

Choreo Studio's original application code and original procedural mannequin
fallback are covered by the repository [MIT license](LICENSE). The neutral
human display asset has the separate CC0 permission described below. No UE
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

The optional AI route references the model hosted by Cloudflare Workers AI; its
weights are not downloaded or redistributed by this project. Model availability,
usage terms and licensing remain those of the provider and the selected model.
