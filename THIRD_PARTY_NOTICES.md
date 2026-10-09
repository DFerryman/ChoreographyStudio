# Third-party software notices

## v17 · 用户选定的 Quaternius 默认人物（已上线，准确源码CI通过）

默认人物为用户明确选择的 **06 Quaternius Superhero Male 力量型**，来源官方Universal Base Characters标准免费包，CC0；无付费购买、不将其它候选一起发布。源65骨／几何／TRS／inverse bind／四权重保持原始值，运行时独立克隆inverse binds做display-2统一body G及固定肢段／脚底校准，原始GLB权重在实际Loader中恢复bitexact。来源、完整许可、六资产SHA及独立可复现检查见[人物资产](apps/web/public/models/README.md)；其21099B/SHA14a040b5正文已冻结，不写发布结果。

选型01–03 MPFB为CC0；04–05 MB-Lab生成三维资产AGPL-3.0、二维截图例外不等于三维资产可无条件上线（05最终名“写实柔和”）；06–07 Quaternius标准免费包CC0；08 Mannequiny为CC-BY-4.0需署名。实际编辑／蒙皮本地验收已完成，准确源码CI／运行发布已实际核验，最后文档关联与Notion按最终回执完成；来源许可不替代真实舞蹈动作、教师或设备门槛。原MHR及此前声明全文保留为历史。

运行源码[ee376928](https://github.com/DFerryman/ChoreographyStudio/commit/ee376928f200e87e4eb48bbfec00fa60741fd12a)／tree `89c828c7b2770fd416a04c87dfe0fc04872dd7f2`已推送main；其准确[CI37871363910](https://github.com/DFerryman/ChoreographyStudio/actions/runs/37871363910)／job113629975482／attempt1／main push于2026-10-09T02:10:06Z实际success：421／421基础（22文件）＋94／94浏览器（23文件），94逐例通过、失败／未通过0，未手动重跑。Cloudflare v17 `18dd4982-503a-4dfc-936c-6cffa7157b46`／100%，首次deployment `22f6f251-3b75-4495-800a-c8a3792e449a`；一次HTTP25和唯一公网8首轮通过，7份实际API／error／warning／expectedHTTP诊断0。root再亲审同轮23图中的6实际公网图，合本地13图接受形体／蒙皮。最后纯Markdown提交将通过同版部署注释关联最终main／tree与metadata，再同步五份Notion；不再上传运行资产或重测公网，真实Workers AI／付费／D1／新图片上传0。

## v16 flat-ground step assistance · deployed and exact-source CI verified

The procedural step planner is original application code and uses the existing
fixed rig, built-in human profile and constrained Three.js IK path. It adds no
third-party motion capture, measured gait or paid model calls. MHR geometry,
bind/weight data, raw/gzip corrective bytes and retained licenses are unchanged.
The model README's earlier transport wording is corrected to describe browser-
decoded versus explicit gzip bodies without claiming a proven upload size
limit. Existing source and license records below remain intact.

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

## Meta MHR full-body display pipeline · v15

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

The v15 display pipeline preserves native display bones and published learned
sparse-ReLU pose correctives for local skin computation. The primary editor
continues to use its canonical 25-joint author/FK/IK contract; the 127 internal
display bones do not add author controls. Calibration, actual-loaded skin and full-body guidance have passed their
documented local scope, and the corresponding runtime has passed bounded online checks;
exact latest-source CI passed380 foundation and89 browser cases; final document
main is recorded through a same-version deployment annotation.
Stress-pose verification is not a claim of ordinary human feasibility. These licenses
do not establish biological accuracy, safety, motion-content permission or
teacher acceptance. Local published-model pose correction is actual
computation; the no-usage constraint concerns Workers AI inference and paid
choreography-generation requests, both of which remain unused in tests.

The optional AI route references the model hosted by Cloudflare Workers AI; its
weights are not downloaded or redistributed by this project. Model availability,
usage terms and licensing remain those of the provider and the selected model.

## Final v15 transport observation

The published model README contains an earlier transport description. The final decoder accepts either browser-decoded MHRCORR1 or an explicit gzip body and validates exact raw size/SHA/caps/Abort after inspecting eight bytes. The earlier401/500 responses did not establish a size cause or hard upload limit. Standard native upload succeeded with the deterministic6,244,575-byte gzip representation; this sequence is evidence of success, not proof of the earlier failure cause. Published model assets and their hashes remain unchanged.
