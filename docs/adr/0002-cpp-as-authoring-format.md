# ADR 0002: Use C++ as the Authoring and Export Format

**Status:** Accepted  
**Date:** July 9, 2026  
**Decision owners:** Product and runtime architecture  
**Related:** `PRD.md`, `TECHNICAL_DESIGN.md`, `EXPORT_AND_INTEGRATION.md`

## Context

Polished ImGui menus commonly replace the visible behavior of stock controls with custom item registration, hit testing, `ImDrawList` geometry, assets, typography, and time-based animation. A finite declarative widget schema would either prevent these designs or grow into a second programming language. Generating C++ from a designer representation also risks overwriting user work and makes exact preview/export equivalence difficult.

Users already integrate C++, and agents are capable of patching C++ when compiler, visual, and structured feedback are available.

## Decision

User-authored C++ is the primary project source, preview input, and native export format. Agents and humans edit ordinary `.cpp`/`.hpp` files. The exact project translation units compiled into the selected browser build are packaged in the export.

Studio provides optional portable runtime APIs for interaction, animation, inspection, assets, layout, and effects. These are helpers, not a closed widget model. Direct Dear ImGui public API and `ImDrawList` use are allowed. Selected internal operations are exposed through a pinned, versioned adapter; direct `imgui_internal.h` use remains possible but is reported as a portability warning.

Generated code is limited to explicit managed boundaries such as asset registration, font-atlas configuration, export configuration, and starter scaffolding. Studio must not regenerate unrelated user C++.

## Consequences

### Positive

- Agents can implement unique widget geometry and interaction without schema escape hatches.
- Previewed and exported implementations are the same source.
- Output is readable, reviewable, version-controllable, and directly integrable by C++ developers.
- Bundled component examples remain forkable rather than sealed.

### Negative

- Builds are slower than interpreting a layout document.
- Arbitrary C++ increases compiler complexity and local security risk.
- Source analysis cannot perfectly infer portability or dependencies; build dependency records and conservative scans are required.
- Studio cannot guarantee safe automatic refactoring of arbitrary user code.

## Alternatives considered

- **JSON/YAML UI DSL:** rejected as the primary model because custom rendering, animation, and behavior would exceed it.
- **Visual node/drag-and-drop graph:** rejected for MVP scope and because it still needs an escape language for advanced widgets.
- **Generate C++ from HTML/CSS/Figma:** rejected due to lossy semantics and separate source of truth.
- **Runtime JSON interpretation in native apps:** useful for some tools but rejected as the primary export because users want normal C++ and exact authored behavior.

## Ownership rules

- User-owned: public project headers, menu/widget sources, theme source, approved asset inputs.
- Studio-managed: generated asset/font/config files, runtime subset, CMake helpers, example, provenance reports.
- Property-panel edits may modify only a file explicitly marked Studio-managed.
- Export reports all generated files and direct internal ImGui use.

## Acceptance criteria

- An agent can replace widget geometry/animation by patching C++ and observe it in the next successful preview.
- The exported project menu/widget source hashes match the selected WASM build dependency record.
- A consumer can bind state and events without editing Studio runtime/generated internals.
- No required benchmark control is merely an unmodified visible stock widget.
- Studio never rewrites an unrelated user-owned translation unit during theme/property or export operations.
- Direct internal API use produces a portability report entry.

