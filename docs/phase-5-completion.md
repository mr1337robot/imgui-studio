# Phase 5 Completion Record

Phase 5 establishes the editable visual foundation used by the starter project. Its purpose is to
give an agent enough real C++/Dear ImGui material to make a coherent menu without starting every
control from `ImGui::Checkbox` or a separately maintained browser UI.

## Delivered

- A project-owned `Theme` with named color, geometry, spacing, and deterministic timing tokens.
  The default values live in one declared managed source file, and the Studio shell exposes a
  narrowly scoped accent/motion editor that patches only that file through the canonical revision
  API.
- Reusable custom-drawn C++ components: toggle, float and integer sliders, sidebar navigation,
  tabs, combo/popup, keybind capture, color swatch picker, card, button, icon button, toast, and
  modal. Their visible rendering is `ImDrawList`; Dear ImGui is used for IDs, layout participation,
  and input behavior only.
- Stable component IDs and semantic types for runtime inspection. Popup children declare their
  intentional layering rather than producing accidental hitbox-overlap diagnostics.
- Deterministic token-driven transitions for toggles, sliders, buttons, toast, and modal. They use
  Studio animation state and integer-microsecond frame time, never widget-local statics or wall
  clock reads.
- Portable `MixColor`, gradient, layered shadow, glow, and text-centering helpers. The helpers emit
  ordinary ImGui draw commands and bound their layer count; enhanced blur/bloom remains excluded.
- Project asset declarations for a licensed SVG studio mark, plus service-side validation of asset
  manifest schema, duplicate logical IDs, path confinement, attribution files, bounded source
  sizes, SVG active/external content, raster magic bytes, and font signatures. Asset validation
  runs at project discovery and immediately before an immutable build snapshot.

## Evidence

The checked-in starter now renders the same custom menu source in its real WebGL2 preview and
native DX11 host. The browser fixture drives the stable toggle target from its structured geometry,
captures an RGBA8 framebuffer, and repeats the deterministic transition three times. Native tests
compile the same project source and capture it through the parity executable.

## Verification

The Phase 5 change was verified with:

```powershell
npm run typecheck
npm run test:ts
npm run test:cpp
. .\.tools\emsdk\emsdk_env.ps1
.\toolchain\emscripten\build-preview.ps1
npm run test:browser
```

The project-service unit suite includes positive and negative asset validation cases for the
licensed SVG and its attribution. The full repository quality command remains the final aggregate
gate before release work.

## Boundary to Phase 6

Phase 5 makes the starter visually rich and editable. Phase 6 remains responsible for export graph
assembly, provenance, clean-consumer packaging, and package-level native integration. It must use a
successful immutable build; it must not recreate the menu or component implementation.
