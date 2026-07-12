# Custom Widget Guide

The Phase 5 starter in `examples/starter` is the end-to-end custom widget foundation. Its controls
use Studio interaction registration for deterministic ImGui behavior and emit every visible pixel
through `ImDrawList`. The starter includes a toggle, float/int sliders, navigation, tabs, combo,
keybind, color popup, card, button, icon button, toast, and modal.

Start a component with a semantic stable ID, a `studio::Rect`, and `studio::Interact`. Mutate only
project-owned state after `pressed`, then animate draw properties through `studio::Animate` or
`studio::Spring`. The component source must own its visible geometry; a stock Dear ImGui widget may
not be the final visible rendering. Use the named `Theme` tokens for the common visual language and
pass local overrides in C++ where the design needs a deliberate exception.

Build the real browser target with `toolchain/emscripten/build-preview.ps1`, then run
`npm run test:browser`. Build and capture the same source through Win32/DirectX 11 with
`toolchain/capture-native.ps1`. The public runtime contract is defined in `RUNTIME_API.md`; the
full deterministic animation APIs and stable runtime property storage are available through the
current runtime context.

No HTML, JSON widget renderer, or separately maintained browser implementation may replace the
shared C++ source used by browser and native targets.
