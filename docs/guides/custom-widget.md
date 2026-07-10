# Custom Widget Guide

The Phase 1 starter in `examples/starter` is the first tested end-to-end custom widget example.
Its toggle uses an `InvisibleButton` for Dear ImGui interaction and emits its visible track, glow,
and thumb through `ImDrawList`. Project-owned state carries animation progress; no widget-local
static animation state is used.

Build the real browser target with `toolchain/emscripten/build-preview.ps1`, then run
`npm run test:browser`. Build and capture the same source through Win32/DirectX 11 with
`toolchain/capture-native.ps1`. The public runtime contract is defined in `RUNTIME_API.md`; the
full deterministic animation APIs and stable runtime property storage arrive in Phase 3.

No HTML, JSON widget renderer, or separately maintained browser implementation may replace the
shared C++ source used by browser and native targets.
