# Phase 4 Completion Record

Phase 4 is complete locally as of July 12, 2026. The canonical service now owns exact preview/frame
identity and exposes visual plus structured evidence through HTTP and a thin MCP-compatible adapter.

## Delivered

- Isolated deterministic Chromium preview instances loaded only from successful smoke-passed builds.
- Clean reset, monotonic render, exact stored-frame inspection, and stable-ID click endpoints.
- Bounded 500-frame retention with explicit stale build/revision/frame rejection.
- Widget type, bounds, hitbox, visibility, interaction, value, animation target/value/settlement,
  state digest, and build/preview/frame provenance.
- Runtime diagnostics for invalid geometry, duplicate stable IDs, disallowed hitbox overlap, and
  out-of-viewport widgets, bounded to 500 per frame; stored widgets also report clipping state.
- Authenticated opaque PNG artifacts and deterministic scenario filmstrips.
- Bounded magic-byte validation and decoding for PNG, JPEG, and WebP references.
- Side-by-side, opacity overlay, absolute difference, and edge difference with scale, translation,
  opacity, crop provenance, input digests, and diagnostic error metrics.
- A thin JSON-RPC stdio adapter mapping PRD tool names to canonical `/api/v1` operations without
  duplicating service business logic.
- A parent-side bounds overlay that cannot alter canonical rendering or input.

## Gate evidence

The real Emscripten/Chromium integration performs build → preview load → clean reset → inspect exact
frame → click `settings.enable` → render at 110,000 µs → fetch authenticated PNG. It imports that PNG
as `target.phase4`, compares it against itself, and verifies zero differing pixels. Three clean API
captures of the checked-in scenario produce one normalized trace SHA-256.

## Verification

```powershell
npm run validate
. .\.tools\emsdk\emsdk_env.ps1
npm run test:phase2
npm run test:studio
npm run test:browser
```

`test:ts` includes adapter authentication/error-envelope coverage. Native C++ tests cover clock,
reset, tween progression, invalid geometry, and overlap diagnostics. Remote GitHub Actions remains
unverified until the branch is pushed.

## Phase 5 boundary

Phase 5 may build the larger component/theme/asset foundation. Export packaging remains Phase 6;
the Phase 4 adapter intentionally does not invent an early export implementation.
