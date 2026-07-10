# Architecture Map

`TECHNICAL_DESIGN.md` is the normative system design. This file is the maintained entry point for
engineers navigating the implementation.

```text
Studio web client
  -> authenticated local service
     -> canonical project and immutable revisions
     -> Emscripten build worker
        -> isolated Dear ImGui WASM preview
     -> export assembler

Shared project C++ and Studio runtime
  -> browser host (WebGL2)
  -> Windows parity host (DirectX 11)
```

Phase 0 implements the repository, toolchain, and schema foundations only. Module-specific
responsibilities are documented in each subtree README as implementation begins.

## Normative decisions

- `docs/adr/0001-real-imgui-wasm-preview.md`
- `docs/adr/0002-cpp-as-authoring-format.md`
- `docs/adr/0003-webgl2-browser-backend.md`
- `docs/adr/0004-deterministic-animation-clock.md`
- `docs/adr/0005-portable-and-enhanced-rendering-tiers.md`
