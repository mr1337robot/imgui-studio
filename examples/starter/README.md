# Starter Component Foundation

`examples/starter` is a small, intentionally editable Dear ImGui project. The same C++20 source is
compiled into the canonical WebAssembly/WebGL2 preview and the Windows DirectX 11 parity host. It
does not have an HTML, CSS, canvas, or JSON-renderer counterpart.

## Responsibility

The starter demonstrates how an agent or developer can assemble a polished portable menu from
custom draw-list components. It owns sample application state, reusable project-owned components,
theme tokens, declared assets, and deterministic scenarios. It does not own the browser process,
renderer backend, project revisions, build records, or export assembly.

## Layout and ownership

- `include/studio_example/components.hpp` is the documented C++ component surface.
- `include/studio_example/theme.hpp` defines the public token shape. Per-widget C++ overrides are
  always allowed.
- `src/studio_managed_theme.cpp` contains the named default token values. It is the sole
  `managedFiles` entry and may be changed by the limited Studio property editor.
- `src/components.cpp` owns visible custom rendering and input registration. Its controls use
  `studio::Interact` plus `ImDrawList`; no visible control delegates to a stock ImGui widget.
- `src/menu.cpp` composes the sample menu and owns only `MenuState` mutation.
- `assets/assets.json` declares licensed project assets. Asset paths and licenses are validated by
  the local service before a snapshot can build.
- `scenarios/` contains deterministic action/capture fixtures.

## Components

The current foundation contains a custom toggle, float and integer sliders, sidebar item, tab,
combo/popup, keybind capture, color swatch picker, card, button, icon button, toast, and modal.
Every interactive control receives a stable semantic ID and is registered through the Studio runtime
so the inspector can target it without guessing screen coordinates. Popup children opt into
intentional overlap because they layer above ordinary rows.

The starter keeps a canonical 58 x 30 pixel toggle geometry for the original browser/native parity
fixture. Other dimensions are ordinary theme or local C++ choices, not protocol constants.

## Theme editing

Start `npm run studio`, then use **MANAGED THEME** in the left panel to alter the starter accent or
animation duration. The editor patches only `src/studio_managed_theme.cpp`, requires the current
revision and preimage digest, and asks for a build before it promotes a replacement preview. For a
more specialized control, copy `DefaultTheme()` into a local `Theme` value and override that call
site directly in C++.

## Assets and portable effects

Asset identifiers are logical, stable, dot-separated names. The service validates manifest schema,
duplicate IDs, asset/attribution existence, UTF-8 SVG safety, raster magic bytes, font signatures,
and bounded input sizes before snapshotting. The checked-in studio mark is a licensed SVG source;
the sample's equivalent vector mark is presently drawn with ordinary `ImDrawList` circles to keep
the core component example dependency-free.

`studio::AddLinearGradient`, `AddLayeredShadow`, and `AddGlow` deliberately emit only ordinary
draw-list commands. They are predictable portable approximations—not blur, bloom, or arbitrary
post-processing—and layer count is bounded to limit per-frame work.

## Build, test, and extend

```powershell
npm run test:cpp
. .\.tools\emsdk\emsdk_env.ps1
.\toolchain\emscripten\build-preview.ps1
npm run test:browser
```

Use `toolchain/run-native.ps1` to inspect the native host manually. Change a component in a small,
bounded edit; retain stable IDs for semantic-equivalent controls; then run both browser and native
checks. The governing contracts are [RUNTIME_API.md](../../RUNTIME_API.md),
[ANIMATION_SPEC.md](../../ANIMATION_SPEC.md), [INSPECTION_PROTOCOL.md](../../INSPECTION_PROTOCOL.md),
and [PROJECT_FORMAT.md](../../PROJECT_FORMAT.md).
