# Browser acceptance

The v20 `capsule-collision.spec.ts` suite covers the current convex body proxies: swept stage rotation, floor stopping and repeated blocked gestures, exact saved/undo values, preserved imported/numeric author poses, real GLB loading, and desktop/390px cancellation. The filename remains stable while shapes are chosen by the generated avatar profile. The reusable offline fitter and its six model-change tests also run in CI; `avatar:fit -- --check` rejects stale generated output.

The v19 editor records changed channels automatically at exact source times. `point-editing.spec.ts` replaces the explicit whole-pose K/draft/clipboard UI workflow and covers source-point selection, stage synchronization, local-only changes, IK, undo/redo and lossless compact export. The private uploaded dance is never committed; its browser case runs only when its fixture is available.

Current acceptance also retains `backup`, `shortcuts`, `scene`, `preview`, `music`, `quaternius-runtime` and timeline zoom regressions. Core sparse-key, author-priority, constraints, IK, contacts, stepping and skin mathematics remain tested by Vitest.

Files named `*.v18-legacy.ts` preserve the previous browser assertions unchanged as historical evidence. They require removed snapshot buttons, explicit pose drafts, clipboard/transfer forms or their old inspector selectors, and are intentionally outside Playwright discovery. They are not counted as current passing tests. Mixed persistence/camera/audio/keyboard scenarios have been migrated to the automatic editor instead of silently bypassing their assertions.
