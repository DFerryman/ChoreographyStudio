# Working in Choreo Studio

Read `README.md`, `docs/ROADMAP.md`, and `docs/IMPLEMENTATION_STATUS.md` before changing scope.

## Current stage

S0 and P1 are delivered original synthetic previews. P1 manual keyframe and bone editing is deployed as version 5; local checks, the single full online pass and source CI passed. Read `docs/MANUAL_KEYFRAMES.md` for the agreed editing contract. `preview-1` remains separate from the original 2.1.0 machine contract. Do not call template or manual output model generation, mark it as teacher approved, or treat the procedural rig as a licensed production Avatar. Do not add IK, bone-length editing, unrestricted music/timeline duration changes, cloud saving, multiplayer, or additional dance packs to this scope.

Use a right-handed scene: Y up, +Z front, meters, and the XZ ground plane. Keep motion, the rig, camera presets, grids and axis indicators consistent with this convention. Camera navigation and skeleton selection must not alter authoritative motion. P1 changes authoritative motion through explicit write/delete K, neutral-base or template commits; do not present a Pose draft or node selection as a saved keyframe.

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

## P1 manual keyframes

- The confirmed CountMap fixes the entire scene duration. Keys use integer frames at 30 fps; the last frame is `ceil(duration * 30)` at the exact duration, including a short final interval.
- Edit 19 joints with parent-local absolute normalized XYZW quaternions and a separate Root XYZ position in meters; six terminal joints remain read-only. Intrinsic XYZ Euler degrees are an input representation, not the persisted rotation contract. Preserve bone lengths, hierarchy and static offsets.
- Numeric controls and local rotation handles preview a full Pose draft. Require explicit single-track or full-pose write K. Resolve unwritten drafts before seeking, playing, mode/scene switching, history actions, template generation or saving. Do not save a draft as authoritative animation.
- Expose explicit rotate/whole-Root world-translate actions after selection; clamp Root to numeric bounds and preserve bones. Edit actions pause at actual audio time, unmirror and return to the original without adopting candidates. Same-frame select/rotate/translate changes retain drafts without commits; optional viewer.transformTool restores old manual/arrange scenes as rotate/select without rebaking.
- Store sparse per-joint rotation tracks and a Root position track with an immutable `Snapshot.manual.baseTake`. Unwritten endpoints use base poses at 0 and exact duration; explicit endpoint keys override them. Use shortest-path SLERP and Root linear interpolation between neighboring anchors; editing a track affects that interval, not only the current frame or phrase.
- Preserve base explicit times, phrase boundaries and the exact final sample; add key times without regenerating from plan. Unedited tracks use base motion. Deleting all keys preserves original poses/times while issuing a new animation version. Validate finite values, legal joints, integer frames, nonzero quaternions, the 4096 total-track-key limit and the 6001 explicit-sample input/output limit; reject excess resources.
- The current UI delete action removes every explicit track key at the current frame. Single-track deletion exists only in the core API; do not describe it as an available UI control.
- Every committed motion change produces a new take/animation ID, revision and shared scene history entry; stale candidates cannot overwrite it. Preserve manual tracks, base, authoritative take, undo history and original audio in scene transactions. Old scenes without manual data restore their exact take without re-baking.
- Starting from a neutral stance and clearing keys must be undoable. Template adoption consumes the authoritative candidate, explicitly warns that current motion is flattened into the next base and clears old editable tracks; undo restores the prior manual sequence. Never retain old tracks and apply them again to a new base.
- Mirror is for viewing. Local manipulation must use unmirrored data; camera movement cannot write transforms. P1 math/editing/baking/saving stays in the browser, with no business API, D1 writes or automatic cloud save.

## Verification and deployment

Run `npm run check`, `npm run typecheck:worker`, and relevant `npm run test:e2e` checks. Browser tests use a local original WAV and procedural rig; they do not validate dance quality, device frame-rate or measured audio-output latency.

Use `wrangler.jsonc` and generate Worker types with Wrangler. Cloudflare serves Web and lightweight APIs; real Python motion processing and FFmpeg need a separately verified execution environment. Check build output and online health/browser flow when publishing an authorized stage. Record the exact result in `docs/VERIFICATION.md` and `docs/DEPLOYMENT.md`; distinguish tests, deployment, teaching validation and remote GitHub publication.

Keep credentials outside the repository, retain the original MIT license, and preserve clear synthetic provenance and stage boundaries in UI and documentation.

## Request and database write budget

The user requires low request frequency and explicit control of database rows written. S0/P1 keep music, scenes and manual edits in the browser and must not introduce D1 writes for playback, keyframes, health checks, polling or telemetry.

- Perform necessary verification in one bounded pass per meaningful change. Do not run recurring production test loops, load tests or repeated write-producing probes. Reuse validated evidence when the relevant source and assets are unchanged.
- Protect API calls with server-side rate limits; missing or failed protection must reject the protected request. Static assets and local editor operations must not consume database writes.
- Cloudflare's native rate limiter is location-scoped and eventually consistent; IP-based callers sharing an egress address share the allowance. It is not an account-wide billing cap. Rejected requests and inline asset delivery can still count as Worker requests. Switch business protection to account identity when authenticated services are added.
- Before enabling server write endpoints, implement business idempotency, batching/coalescing and an explicit daily write budget. Reject writes when the budget is exhausted; polling and automatic retries must never trigger additional writes.
- Keep the S2 PostgreSQL default. If D1 is introduced later, document its rows-written budget and measure actual usage before enabling traffic. Do not present a proposed budget as an implemented provider hard quota.
- Record only safeguards that are actually configured and verified. S0 API frequency protection does not mean production write quotas, tenant isolation or the full S2 service are complete.
