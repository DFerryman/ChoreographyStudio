# Evaluation-only motion evidence

The two raw NPZs are outputs of two explicit text-to-motion trials on the [official NVIDIA Kimodo Space](https://huggingface.co/spaces/nvidia/Kimodo). No gallery/example motion was loaded. The recorded model label is Kimodo-SOMA-RP-v1; the running service's actual code and weight hash have not been independently established. [SOMA model license](https://huggingface.co/nvidia/Kimodo-SOMA-RP-v1/blob/main/LICENSE) and [official implementation](https://github.com/nv-tlabs/kimodo) are separate sources. These samples have not passed the requested Chinese-classical dance quality or the application's trajectory acceptance gate and are not product motion assets.

SOMA rest skeleton metadata was numerically extracted from the official Kimodo skeleton assets, without executing their pickle representation. Its source URLs and asset hashes are retained in the JSON. The local similarity-source world joints are deterministic FK exports of the two already pinned, licensed CMU Street/Salsa derivatives distributed with this repository; their clip hashes and attribution remain in [MOTION_PRIORS.md](../../MOTION_PRIORS.md) and [the original motion-prior notice](../../../apps/web/public/motion-priors/NOTICE.txt). They are reference evidence for identifying reused excerpts, not new creations.

Videos and contact sheets render original generated joint positions with no retargeting or correction. Numerical SO(3) projection is diagnostic only. The archive includes failed results and non-blind supplemental calibration; no global originality, dance-style, or complete dynamics claim follows from the local similarity results.

No user-uploaded scene or audio is present. Nothing in this directory is loaded by the application or deployed as a motion catalog.
