# Runtime

`runtime/` supplies the small C++20 contract that project widgets use in both browser and native
hosts. It owns deterministic frame time, persistent animation storage, custom-widget interaction
registration, diagnostics, inspection records, and portable draw helpers. It does not own project
menu state, browser DOM, Win32/DX11/WebGL objects, filesystem paths, build processes, or service
revisions.

## Public entry points

- `include/studio/runtime.hpp`: one-context-per-ImGui-context lifecycle and clock.
- `include/studio/widget.hpp`: stable-ID interaction and passive registration.
- `include/studio/animation.hpp`: deterministic tween/spring state keyed by ImGui ID and property.
- `include/studio/inspection.hpp`: frame-local inspection and diagnostics views.
- `include/studio/draw.hpp`: portable, bounded draw-list helpers.
- `include/studio/studio.hpp`: convenience umbrella include for project component code.

Project code may call this surface only while its host has opened a `BeginFrame`/`EndFrame` pair on
the rendering thread. `ProjectContext` owns all runtime state and invalidates frame views at the
next frame, reset, or destruction. There is no global animation state; the sole current-context
binding is render-thread-local and exists only inside the frame lifecycle.

## Failure, determinism, and extension

Invalid widget geometry becomes an inert interaction plus a bounded diagnostic. Invalid animation
parameters preserve the last finite result. Lifecycle misuse is a programmer error. The runtime
never consults wall-clock time in deterministic mode, and portable effect helpers retain no
backend resources or references.

Build `npm run test:cpp` for the MSVC runtime tests and native capture, or dot-source the Emscripten
environment and run `toolchain/emscripten/build-preview.ps1` for wasm compilation. Read
[RUNTIME_API.md](../RUNTIME_API.md), [ANIMATION_SPEC.md](../ANIMATION_SPEC.md), and
[INSPECTION_PROTOCOL.md](../INSPECTION_PROTOCOL.md) before changing this subtree.
