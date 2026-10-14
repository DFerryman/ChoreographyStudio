# Local similarity audit, 2026-10-14

This is a numerical screen against **two** pinned local recordings. The full Street and Salsa recordings cover the catalog's 12 derived windows and two full entries; those 14 entries are not 14 independent captures. This does not certify originality, Chinese dance style, licensing, naturalness, or physics, and does not compare all training data.

The source files were decoded and evaluated through the product's actual `decodeMotionPrior` and `evaluatePose`, with the complete pinned SHA checked. Raw SOMA77 world positions are compared before any retarget or feasibility correction. Sixteen shared bone directions are normalized, pelvis-relative horizontal heading is removed, and free-start/end subsequence DTW searches the complete recordings using (1,1), (1,2), and (2,1) time steps. A second comparison mirrors the query and swaps left/right joint names. Root travel, anatomy, finger/palm orientation and position-invisible twist are excluded and cannot create a novelty claim.

Initial synthetic calibration had 36 known-copy controls: two source excerpts; exact, overall yaw/translation, 0.75 tempo, 1.5 tempo, mirror and 3 mm joint noise variants; whole/first-two-second/last-two-second windows. All 36 were detected and all closest source identities were correct. The initial threshold was `0.05297699627250428`, using the fixed rule `1.25 * maximum positive-control distance + 1e-8`.

After the first raw output had already been observed, eight important additional controls were added from actual accepted prior-based candidates: Street interval 4–9.5 s and Salsa full 0–16 s, each including whole/entry/interior/exit windows. They include actual retarget, arm/leg conditioning, contact/Root adjustment, solver and fixed seams; Salsa includes stable ending. All eight were detected and source identities were correct. The same margin rule produces **`0.43256752988859576`**, maximum control distance `0.3460540159108766`. This supplementary calibration is **not blind** to the first output. Its reason, original threshold and original receipt hashes are retained in `calibration-adapted-v2.json`; earlier files are preserved.

| Raw output | Whole closest recording interval | Whole direction RMS | Minimum 2 s RMS | High similarity flag |
| --- | --- | ---: | ---: | --- |
| Trial 1: 120 frames | Street 2.9–6.2 s | 0.5563928608 | 0.4878698538 | No |
| Trial 2: 180 frames | Street 0–3 s | 0.5697216450 | 0.5065671187 | No |

These dimensionless distances are RMS differences of unit direction vectors, not metres or an original-content confidence score. The smallest window distances are only about 12.8% and 17.1% above the final threshold. There is no independent false-positive/false-negative validation. Only complete samples plus 2-second windows at half-second strides and the final window are screened. Shorter/intervening reuse and arbitrary adaptations remain unexcluded.

Observed readonly export FPS is 30. NPZ does not embed FPS. The outputs' last actual sample times are `119/30` and `179/30`; no endpoint was padded or retimed to 4 or 6 seconds. The public script independently recalculates all saved path costs; maximum raw-output discrepancy is at floating point scale.

## Reproduce

Run from the repository root; NumPy, installed project Node dependencies and the named local input artifacts are required. These commands do not invoke any model or network service.

```sh
node_modules/.bin/esbuild work/model-evaluation-20261014/novelty/export-priors.ts --bundle --platform=node --format=esm --packages=external --outfile=work/model-evaluation-20261014/novelty/export-priors.mjs
node work/model-evaluation-20261014/novelty/export-priors.mjs
OPENBLAS_NUM_THREADS=1 python infra/audit_motion_similarity.py --raw work/model-evaluation-20261014/trial-02/kimodo-chinese-classical-raw.npz --expected-raw-sha256 84c4b29492e51dde15a1896ef454f7d1941ec0e5ed859efabef1735ad749507c --priors-world-joints work/model-evaluation-20261014/novelty/priors-world-joints.json --soma-metadata work/kimodo-runtime-research-20261014/soma-skeleton-metadata.json --calibration work/model-evaluation-20261014/novelty/calibration-adapted-v2.json --output-dir work/model-evaluation-20261014/novelty/reproduced-trial-02
```

To reproduce the original synthetic and adapted calibrations, run `audit_similarity.py`, then compile/run `export-adapted-controls.ts`, then `audit_adapted_controls.py`. Use separate output copies if retaining these existing receipt timestamps and hashes. Neither calibration script performs provider requests. The final public CLI loads the supplied calibration and does not adjust its threshold based on the new sample.

The supported conclusion is: **this prototype did not find a high-similarity continuous excerpt from either local recording in these outputs at this calibration**. A human dance-quality review and an executable, licensed product generation backend remain separate requirements.
