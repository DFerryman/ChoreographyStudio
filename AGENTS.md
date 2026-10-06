# Working in Choreo Studio

Read `README.md`, `docs/ROADMAP.md`, and `docs/IMPLEMENTATION_STATUS.md` before changing scope.

## Current stage

S0 is an interactive, original synthetic preview. `preview-1` is a separate contract, not the original 2.1.0 machine contract. Do not call template output model generation, mark it as teacher approved, or treat the procedural rig as a licensed production Avatar. Do not add IK, free timeline editing, multiplayer, or additional dance packs to the first product scope.

The original engineering ZIP is not in this public repository. When it becomes available in an authorized private workspace, read its root instructions, run its verification, and document migration before integrating its generated contracts. Do not copy private source documents, contracts, uploaded audio or unlicensed motion files into the public repository.

## Invariants

- CountMap is the confirmed source of timing. Whole eight-count phrases, 16–60 seconds, stable 4/4; the preview resource envelope is 30–240 BPM and 2–60 phrases.
- Replay samples by explicit time, with linear translation and quaternion SLERP. Preserve the exact final sample and non-uniform intervals.
- Adopt a replacement's authoritative BakedTake directly. Re-baking its plan would discard preserved boundary samples. Outside the selected phrase, poses and interpolation must stay unchanged.
- Audio time drives playback. Views and teaching slow playback do not modify the arrangement.
- A candidate binds the project revision; expired candidates may be viewed but cannot be adopted. A work change clears its preview review record.
- Save reports success only after IndexedDB commits, including the original audio. Never claim server storage or cross-device sync.
- Public preview API does not accept audio/project writes. Do not add secret-bearing browser code.

## Verification and deployment

Run `npm run check`, `npm run typecheck:worker`, and relevant `npm run test:e2e` checks. Browser tests use a local original WAV and procedural rig; they do not validate dance quality, device frame-rate or measured audio-output latency.

Use `wrangler.jsonc` and generate Worker types with Wrangler. Cloudflare serves Web and lightweight APIs; real Python motion processing and FFmpeg need a separately verified execution environment. Check build output and online health/browser flow when publishing an authorized stage. Record the exact result in `docs/VERIFICATION.md` and `docs/DEPLOYMENT.md`; distinguish tests, deployment, teaching validation and remote GitHub publication.

Keep credentials outside the repository, retain the original MIT license, and preserve clear synthetic provenance and stage boundaries in UI and documentation.
