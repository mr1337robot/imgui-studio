# Phase 3 Completion Record

Phase 3 is complete locally as of July 10, 2026. The starter's custom draw-list toggle uses the
same deterministic C++ runtime in WebAssembly and the Windows native fixture.

## Delivered

- A render-thread-owned `ProjectContext`, integer-microsecond clock, monotonic deterministic time
  validation, clean reset, and bounded hidden-state collection.
- Animation identity scoped by runtime context, ImGui ID, and stable FNV-1a property key.
- Scalar/vector/color tweens with the specified easings, delay, settlement, reversal, and finite
  invalid-input behavior.
- Scalar/vector closed-form springs for underdamped, critical, and overdamped regimes.
- A pinned Dear ImGui interaction adapter with clipping, disabled, hover, held, press, and duplicate
  stable-identifier behavior.
- Stable target `settings.enable` and animation/status data in browser frame records.
- Restart, play, pause, 16,667 µs step, speed, and reset/replay seek controls in Studio.
- A schema-valid scenario and canonical 0/110,000/220,000 µs transition filmstrip.

## Determinism evidence

`npm run test:browser` clean-resets, targets the toggle from reported geometry, clicks it, and
renders the transition three times at identical timestamps. The normalized traces are
byte-identical: progress is 1,000,000 at 0 µs, 125,000 at 110,000 µs, and zero/settled at 220,000
µs. PNG frames and the trace are written under ignored `out/browser-test/`.

## Verification

```powershell
npm run test:cpp
. .\.tools\emsdk\emsdk_env.ps1
.\toolchain\emscripten\build-preview.ps1
npm run test:browser
npm run validate
```

The checked-in CI workflow repeats native and WebAssembly gates after push; the remote run remains
the only external verification boundary.

## Phase 4 boundary

Full stored-frame inspection queries, overlays, expanded frame diagnostics, reference comparison,
and the complete agent HTTP surface remain Phase 4 work.
