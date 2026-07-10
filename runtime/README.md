# Studio C++ Runtime

The runtime supplies backend-neutral interaction, animation, inspection, asset, clock, and
portable drawing APIs shared by browser and native targets.

Phase 3 implements the C++20 runtime used by both hosts. It owns the integer-microsecond clock,
resettable animation storage, custom-widget interaction adapter, stable inspection records,
diagnostics, and hidden-state collection. Platform event loops stay in `browser/` and `native/`.

Include `studio/studio.hpp`. A host owns one `ProjectContext` per `ImGuiContext`, brackets project
rendering with `BeginFrame`/`EndFrame`, and destroys it before the ImGui context. Calls are
render-thread-only. Run `npm run test:cpp`; with Emscripten active, also run
`toolchain/emscripten/build-preview.ps1` and `npm run test:browser`.
