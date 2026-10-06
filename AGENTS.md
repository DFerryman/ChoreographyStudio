# Working in Choreo Studio

Read `README.md`, `docs/ROADMAP.md`, and `docs/IMPLEMENTATION_STATUS.md` before changing scope.

## Current stage

S0 is an interactive, original synthetic preview. `preview-1` is a separate contract, not the original 2.1.0 machine contract. Do not call template output model generation, mark it as teacher approved, or treat the procedural rig as a licensed production Avatar. The user has authorized viewport and local scene foundations: a readable selectable skeleton, free orbit/pan/zoom, side/top/reset views, and multiple saved local scenes including audio, playback session, camera and view settings with migration of existing local data. These foundations do not include writing keyframes. Do not add IK, unrestricted timeline editing, multiplayer, or additional dance packs to the first product scope.

Use a right-handed scene: Y up, +Z front, meters, and the XZ ground plane. Keep imported motion, the rig, camera presets, grids and axis indicators consistent with this convention. Camera navigation and skeleton selection must not alter the authoritative motion. Full manual keyframe editing is a confirmed product requirement for later P1 delivery; define its editable bones, transform constraints, frame data, interpolation and playback/export relationship before implementing it. Never present node selection as a completed keyframe editor.

The original engineering ZIP is not in this public repository. When it becomes available in an authorized private workspace, read its root instructions, run its verification, and document migration before integrating its generated contracts. Do not copy private source documents, contracts, uploaded audio or unlicensed motion files into the public repository.

## Invariants

- CountMap is the confirmed source of timing. Whole eight-count phrases, 16–60 seconds, stable 4/4; the preview resource envelope is 30–240 BPM and 2–60 phrases.
- Replay samples by explicit time, with linear translation and quaternion SLERP. Preserve the exact final sample and non-uniform intervals.
- Adopt a replacement's authoritative BakedTake directly. Re-baking its plan would discard preserved boundary samples. Outside the selected phrase, poses and interpolation must stay unchanged.
- Audio time drives playback. Views and teaching slow playback do not modify the arrangement.
- Bone picking reports unmirrored data coordinates. Preserve parent-relative joint rotations and the original 25-joint motion evaluator; camera navigation, skeleton display and mirror effects must not be baked into the authoritative take.
- A candidate binds the project revision; expired candidates may be viewed but cannot be adopted. A work change clears its preview review record.
- Save reports success only after IndexedDB commits, including the original audio. Never claim server storage or cross-device sync.
- Public preview API does not accept audio/project writes. Do not add secret-bearing browser code.

## Verification and deployment

Run `npm run check`, `npm run typecheck:worker`, and relevant `npm run test:e2e` checks. Browser tests use a local original WAV and procedural rig; they do not validate dance quality, device frame-rate or measured audio-output latency.

Use `wrangler.jsonc` and generate Worker types with Wrangler. Cloudflare serves Web and lightweight APIs; real Python motion processing and FFmpeg need a separately verified execution environment. Check build output and online health/browser flow when publishing an authorized stage. Record the exact result in `docs/VERIFICATION.md` and `docs/DEPLOYMENT.md`; distinguish tests, deployment, teaching validation and remote GitHub publication.

Keep credentials outside the repository, retain the original MIT license, and preserve clear synthetic provenance and stage boundaries in UI and documentation.

## Request and database write budget

The user requires low request frequency and explicit control of database rows written. S0 keeps music/projects in the browser and must not introduce D1 writes for playback, health checks, polling or telemetry.

- Perform necessary verification in one bounded pass per meaningful change. Do not run recurring production test loops, load tests or repeated write-producing probes. Reuse validated evidence when the relevant source and assets are unchanged.
- Protect API calls with server-side rate limits; missing or failed protection must reject the protected request. Static assets and local editor operations must not consume database writes.
- Cloudflare's native rate limiter is location-scoped and eventually consistent; IP-based callers sharing an egress address share the allowance. It is not an account-wide billing cap. Rejected requests and inline asset delivery can still count as Worker requests. Switch business protection to account identity when authenticated services are added.
- Before enabling server write endpoints, implement business idempotency, batching/coalescing and an explicit daily write budget. Reject writes when the budget is exhausted; polling and automatic retries must never trigger additional writes.
- Keep the S2 PostgreSQL default. If D1 is introduced later, document its rows-written budget and measure actual usage before enabling traffic. Do not present a proposed budget as an implemented provider hard quota.
- Record only safeguards that are actually configured and verified. S0 API frequency protection does not mean production write quotas, tenant isolation or the full S2 service are complete.
