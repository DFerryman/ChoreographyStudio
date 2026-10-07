# Working in Choreo Studio

Read `README.md`, `docs/ROADMAP.md`, and `docs/IMPLEMENTATION_STATUS.md` before changing scope.

## Current stage

S0 and P1 are delivered original synthetic previews. Version 8 is the latest verified deployment: scene-local Pose copy/paste becomes a draft until explicit write K, alongside rotation/whole-Root tools, track status, scoped deletion and filtered key navigation. Local affected checks, the bounded online flow and actual source CI passed; source and verification documents are committed/pushed and the corresponding runtime synchronized to Cloudflare. Read `docs/MANUAL_KEYFRAMES.md` for the agreed editing contract and `docs/VERIFICATION.md` / `docs/DEPLOYMENT.md` for actual release evidence. `preview-1` remains separate from the original 2.1.0 machine contract. Do not call template or manual output model generation, mark it as teacher approved, or treat the procedural rig as a licensed production Avatar. Do not add IK, bone-length editing, unrestricted music/timeline duration changes, cloud saving, multiplayer, or additional dance packs to this scope.

Version 9 is in development: explicit whole-body framing and selected-joint focus help recover a moved rig and inspect joints while editing. This scope is not yet validated or published; keep version 8 as the latest verified release until actual checks and publication are recorded.

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
- Version 8 copy/paste uses a deep-cloned, scene-local memory clipboard from the current original editor pose, including a draft when present; show its source frame and original/draft provenance. Copy alone must not dirty the scene or change authoritative motion, revision or history. Rotation-only paste replaces the 19 editable rotations and keeps target Root and six read-only terminal rotations; the second paste option also copies Root, clamped to existing bounds. Both create a draft and require explicit K; partial-track K must retain remaining draft changes.
- Before replacing a target draft, keep the write/discard/cancel guard and capture paste kind, payload and target scene, CountMap and frame before it opens; recheck that target before applying it. Clipboard data must not alias later edits or change while a guarded paste is pending. Do not read/write the OS clipboard, call an API, persist the clipboard or extend scene schemas. Clear it on scene application, reload and confirmed music/CountMap changes; ordinary key edits, undo/redo and templates in the same scene may retain it. Copy/paste is unavailable during playback, mirror or candidate/teaching viewing; it cannot copy a candidate or adopt one implicitly.
- Expose explicit rotate/whole-Root world-translate actions after selection; clamp Root to numeric bounds and preserve bones. Edit actions pause at actual audio time, unmirror and return to the original without adopting candidates. Same-frame select/rotate/translate changes retain drafts without commits; optional viewer.transformTool restores old manual/arrange scenes as rotate/select without rebaking.
- Store sparse per-joint rotation tracks and a Root position track with an immutable `Snapshot.manual.baseTake`. Unwritten endpoints use base poses at 0 and exact duration; explicit endpoint keys override them. Use shortest-path SLERP and Root linear interpolation between neighboring anchors; editing a track affects that interval, not only the current frame or phrase.
- Preserve base explicit times, phrase boundaries and the exact final sample; add key times without regenerating from plan. Unedited tracks use base motion. Deleting all keys preserves original poses/times while issuing a new animation version. Validate finite values, legal joints, integer frames, nonzero quaternions, the 4096 total-track-key limit and the 6001 explicit-sample input/output limit; reject excess resources.
- Show whether the selected joint and Root have explicit keys at the current frame, with separate current-joint, Root-only and all-track-at-this-frame delete actions. Capture delete kind, joint and frame before resolving a draft; do not let later selection or seeking change the target. Deleting a missing explicit key is a no-op with no animation version, revision or history entry. Read-only terminals cannot have editable rotation keys.
- Editor previous/next K uses the strictly earlier/later explicit frame across all tracks. Timeline all/current-joint/Root filters show only that scope's explicit keys, counts and strictly neighboring key navigation; implicit base endpoints are never key markers. No selection, read-only terminals and empty tracks need accurate empty/disabled states. Filters are transient view state: they must not change authoritative motion, revision or history, or extend the saved scene contract. Seeking through either navigation path keeps the existing unwritten-draft guard.
- Every committed motion change produces a new take/animation ID, revision and shared scene history entry; stale candidates cannot overwrite it. Preserve manual tracks, base, authoritative take, undo history and original audio in scene transactions. Old scenes without manual data restore their exact take without re-baking.
- Starting from a neutral stance and clearing keys must be undoable. Template adoption consumes the authoritative candidate, explicitly warns that current motion is flattened into the next base and clears old editable tracks; undo restores the prior manual sequence. Never retain old tracks and apply them again to a new base.
- Mirror is for viewing. Local manipulation must use unmirrored data; camera movement cannot write transforms. P1 math/editing/baking/saving stays in the browser, with no business API, D1 writes or automatic cloud save.

## Camera framing and focus · version 9 scope

- Offer explicit whole-body framing and selected-joint focus. Calculate from the currently visible posed rig, including a Pose draft, mirrored viewing, candidate preview and teaching view; do not silently return to the original or discard a draft. Read-only terminal joints remain valid focus targets. Disable whole-body framing without a take and joint focus without a take or selected joint, with accurate explanations.
- Keep the current viewing orientation. Whole-body framing fits the visible skeleton bounds to the actual viewport aspect ratio with a margin; joint focus centers the selected visible joint at a useful inspection distance. Respect camera near/far and existing navigation bounds. Do not implement automatic follow, camera animation or motion transforms as part of this scope.
- Focus changes only camera view state. Preserve selection, playback time/state, audio, draft, authoritative take/manual tracks, revision/history, candidate and teacher-review state. Camera movement may mark the local scene view as unsaved and is saved through the existing `viewer.camera`; do not add schema fields or store focus commands.
- Execute each request once from a snapshot of the visible pose. Seeking, ordinary pose updates and viewport resizing must not replay an old focus request; scene application clears pending requests and restores that scene's saved camera. Safely cancel an active rotation/Root handle drag before changing the camera, preserve its latest formed draft and keep an interrupted touch group isolated until all touches release; safely return gesture ownership to camera navigation.
- Keep geometry/math and verification in the browser/local environment, with no business API, database writes or online polling. Record actual related local tests, bounded online verification, GitHub push and matching Cloudflare deployment before calling this stage delivered.

## Verification and deployment

Run `npm run check`, `npm run typecheck:worker`, and relevant `npm run test:e2e` checks. Browser tests use a local original WAV and procedural rig; they do not validate dance quality, device frame-rate or measured audio-output latency.

Use `wrangler.jsonc` and generate Worker types with Wrangler. Cloudflare serves Web and lightweight APIs; real Python motion processing and FFmpeg need a separately verified execution environment. Check build output and online health/browser flow when publishing an authorized stage. Record the exact result in `docs/VERIFICATION.md` and `docs/DEPLOYMENT.md`; distinguish tests, deployment, teaching validation and remote GitHub publication.

Keep credentials outside the repository, retain the original MIT license, and preserve clear synthetic provenance and stage boundaries in UI and documentation.

## Required delivery

The user requires every completed modification to be committed and pushed to `DFerryman/ChoreographyStudio`, with the corresponding application synchronized to the authorized Cloudflare preview `choreo-studio-preview`. This is a standing delivery requirement: finish repository publication and Cloudflare deployment before handing off a change; a local edit or successful build alone is not delivery.

Verify the remote commit, active Cloudflare version/deployment and matching runtime assets, then record the actual outcome and preview link. Commit and push the verification documentation too. Keep private documents, user audio, credentials and generated artifacts out of the public repository. Reuse valid checks when runtime files are unchanged, and keep online verification bounded by the request/database budget below.

## Request and database write budget

The user requires low request frequency and explicit control of database rows written. S0/P1 keep music, scenes and manual edits in the browser and must not introduce D1 writes for playback, keyframes, health checks, polling or telemetry.

- Perform necessary verification in one bounded pass per meaningful change. Do not run recurring production test loops, load tests or repeated write-producing probes. Reuse validated evidence when the relevant source and assets are unchanged.
- Protect API calls with server-side rate limits; missing or failed protection must reject the protected request. Static assets and local editor operations must not consume database writes.
- Cloudflare's native rate limiter is location-scoped and eventually consistent; IP-based callers sharing an egress address share the allowance. It is not an account-wide billing cap. Rejected requests and inline asset delivery can still count as Worker requests. Switch business protection to account identity when authenticated services are added.
- Before enabling server write endpoints, implement business idempotency, batching/coalescing and an explicit daily write budget. Reject writes when the budget is exhausted; polling and automatic retries must never trigger additional writes.
- Keep the S2 PostgreSQL default. If D1 is introduced later, document its rows-written budget and measure actual usage before enabling traffic. Do not present a proposed budget as an implemented provider hard quota.
- Record only safeguards that are actually configured and verified. S0 API frequency protection does not mean production write quotas, tenant isolation or the full S2 service are complete.
