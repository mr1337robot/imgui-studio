# Starter Component Foundation

`examples/starter` is a small, intentionally editable Dear ImGui project. Its default composition
is a close reconstruction of the compact Thariluneon-style reference menu: a five-part header,
breadcrumb, paired settings panels, dense custom rows, vector icons, compact animated toggles, and
a gold-on-near-black visual system. The same C++20 source is compiled into the canonical
WebAssembly/WebGL2 preview and the Windows DirectX 11 parity host. It does not have an HTML, CSS,
canvas, or JSON-renderer counterpart.

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

`RenderMenu` accepts optional `MenuEvents`. Its `onRendered` callback runs synchronously on the
Dear ImGui render thread after the menu has registered the frame's diagnostics. Consumers must not
retain references beyond the callback or recursively render the menu. The native export wraps this
surface as `Initialize`, `Reset`, `Render`, and `Shutdown`, while leaving ownership of the ImGui
context, backend, frame loop, and `MenuState` with the consuming application.

## Theme editing

Start `npm run studio`, then use **MANAGED THEME** in the left panel to alter the starter accent or
animation duration. The editor patches only `src/studio_managed_theme.cpp`, requires the current
revision and preimage digest, and asks for a build before it promotes a replacement preview. For a
more specialized control, copy `DefaultTheme()` into a local `Theme` value and override that call
site directly in C++.

## Assets and portable effects

Asset identifiers are logical, stable, dot-separated names. The service validates manifest schema,
duplicate IDs, asset/attribution existence, UTF-8 SVG safety, raster magic bytes, font signatures,
and bounded input sizes before snapshotting. The pinned `assets/fonts/Inter-Medium.ttf` and
`assets/fonts/Inter-SemiBold.ttf` instances provide deterministic authored weights to both rendering
hosts. Each host loads 14 px body and 16 px emphasis roles before backend font-atlas upload;
exported consumers must perform the same setup before their first frame. The small target, gear,
and chevron icons are purpose-built
vector draw-list geometry, so they remain crisp and require no platform icon font. The checked-in
studio mark remains a licensed SVG source for asset-pipeline examples.

`studio::AddLinearGradient`, `AddLayeredShadow`, and `AddGlow` deliberately emit only ordinary
draw-list commands. They are predictable portable approximations—not blur, bloom, or arbitrary
post-processing—and layer count is bounded to limit per-frame work.

## Build, test, and extend

```powershell
npm run test:cpp
. .\.tools\emsdk\emsdk_env.ps1
.\toolchain\emscripten\build-preview.ps1
npm run test:browser
npm run test:phase2
```

Use `toolchain/run-native.ps1` to inspect the native host manually. Change a component in a small,
bounded edit; retain stable IDs for semantic-equivalent controls; then run both browser and native
checks. The governing contracts are [RUNTIME_API.md](../../RUNTIME_API.md),
[ANIMATION_SPEC.md](../../ANIMATION_SPEC.md), [INSPECTION_PROTOCOL.md](../../INSPECTION_PROTOCOL.md),
and [PROJECT_FORMAT.md](../../PROJECT_FORMAT.md). Native packaging and the consumer contract are
defined by [EXPORT_AND_INTEGRATION.md](../../EXPORT_AND_INTEGRATION.md).
