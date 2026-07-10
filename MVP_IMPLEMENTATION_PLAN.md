# ImGui Studio — MVP Implementation Plan

**Status:** Ready to execute  
**Version:** 1.0  
**Date:** July 9, 2026  
**Inputs:** `PRD.md`, `TECHNICAL_DESIGN.md`  

## 1. Objective

Deliver the local-first ImGui Studio MVP and prove that an AI agent can create, animate, inspect, validate, and export a polished custom Dear ImGui menu through a real browser-rendered C++ workflow.

The plan is gate-driven. Each work package ends in observable behavior. Work does not advance merely because source exists; the stated tests and demonstrations must pass.

## 2. Delivery strategy

Build a thin vertical slice before expanding the component library or editor:

```text
custom checkbox C++
  -> cached Emscripten build
  -> isolated WASM preview
  -> deterministic click
  -> animation filmstrip + inspection
  -> same source in native fixture
  -> parity capture
```

After that loop is reliable, add reference comparison, assets, additional components, agent ergonomics, and final export packaging.

## 3. Workstream ownership model

The implementation may run in parallel across these workstreams after foundation contracts are frozen:

- **Studio:** React UI, editor, preview host, comparison, timeline.
- **Service:** projects, revisions, API, build coordination, artifacts, export.
- **Runtime:** C++ interaction, animation, inspection, assets, drawing helpers.
- **Toolchain:** Emscripten, CMake, caching, native parity, CI.
- **Quality:** schemas, tests, fixtures, visual baselines, agent benchmark.

Changes to shared protocol or public runtime contracts require a short ADR or an update to an existing one before dependent work merges.

## 4. Phase 0 — Repository and reproducibility

**Implementation status:** Complete as of July 10, 2026. Local gate evidence is recorded in
`docs/phase-0-completion.md`; the first pushed CI run will provide the independent clean-run link.

### WP0.1 Repository skeleton

Tasks:

- Create the directory structure defined in `TECHNICAL_DESIGN.md`.
- Configure formatting, linting, TypeScript checking, C++ formatting, and CMake presets.
- Add root build/test commands.
- Add contribution instructions describing generated and user-owned files.

Acceptance:

- A clean checkout can run TypeScript and empty C++ test suites with one documented command each.
- CI performs the same commands.

### WP0.2 Pin the toolchain

Tasks:

- Select and record exact Node.js, package manager, Emscripten, CMake, MSVC, Dear ImGui, and test dependency versions.
- Add setup verification that fails with actionable version diagnostics.
- Vendor or fetch Dear ImGui reproducibly according to its license.
- Record dependency licenses.

Acceptance:

- Two clean Windows environments produce the same toolchain identity and can build a minimal WASM and native program.

### WP0.3 Define v1 schemas

Tasks:

- Implement JSON Schemas for project manifest, scenarios, inspection output, build records, reference metadata, and common API errors.
- Generate TypeScript types where appropriate.
- Add valid and invalid fixtures.

Acceptance:

- All fixtures validate or fail with the expected field-level errors.
- Every schema includes an explicit version.

**Phase 0 gate:** Reproducible empty system foundation builds and validates in CI.

## 5. Phase 1 — Browser/native rendering spine

**Status: complete.** The gate evidence, commands, and remaining external CI boundary are recorded
in [`docs/phase-1-completion.md`](docs/phase-1-completion.md).

### WP1.1 Shared custom widget fixture

Tasks:

- Create a fixture project with one custom toggle drawn through `ImDrawList` and interacted with through the initial adapter.
- Keep project menu/widget code independent of browser and native backend types.
- Add fixed sample state and viewport.

Acceptance:

- The fixture contains no stock `ImGui::Checkbox` call.
- Its render entry point compiles for both targets.

### WP1.2 Browser preview host

Tasks:

- Compile Dear ImGui, Studio runtime stub, browser bootstrap, and fixture through Emscripten.
- Render through WebGL2.
- Create an isolated iframe host in the Studio UI.
- Implement preview protocol handshake and lifecycle states.
- Capture an RGBA8 framebuffer image without browser chrome or CSS scaling.

Acceptance:

- The custom toggle is visible and manually clickable in the browser.
- The capture dimensions exactly match the configured framebuffer.
- A malformed protocol message is rejected without crashing the preview.

### WP1.3 Windows native parity host

Tasks:

- Create a CMake Windows fixture with Win32 + DirectX 11.
- Compile the identical fixture widget/menu source.
- Add command-line fixed viewport and screenshot capture.
- Ensure fonts and test assets are project-provided, not system-dependent.

Acceptance:

- The native fixture renders and captures on a clean Windows environment.
- Browser and native geometry is within two pixels after documented configuration.

### WP1.4 Initial visual comparison harness

Tasks:

- Store capture metadata.
- Implement pixel and perceptual comparison reports.
- Produce human-readable diff artifacts.

Acceptance:

- A deliberately moved widget fails the geometry/parity fixture.
- The original fixture passes the approved tolerance.

**Phase 1 gate:** The same custom C++ widget renders and captures in browser and native targets with acceptable parity.

## 6. Phase 2 — Local service and edit/build loop

**Status: complete.** Evidence, measurements, and remaining release-level performance work are
recorded in [`docs/phase-2-completion.md`](docs/phase-2-completion.md).

### WP2.1 Project service

Tasks:

- Discover projects under configured workspace roots.
- Resolve and confine project paths.
- Read files and apply atomic revision-checked patches.
- Maintain monotonic project revision records.
- Add per-launch mutation token and localhost-only binding.

Acceptance:

- Valid patches advance revision exactly once.
- Stale patches fail without modifying files.
- Traversal, symlink escape, absolute external paths, and malformed UTF-8 tests fail safely.

### WP2.2 Build coordinator

Tasks:

- Model queued, running, succeeded, failed, and cancelled builds.
- Invoke compiler tools with argument arrays and sanitized environment.
- Parse compiler diagnostics into structured records.
- Retain bounded raw logs.
- Persist immutable successful build metadata.

Acceptance:

- Syntax errors return precise structured diagnostics.
- A failed build does not change `lastSuccessfulBuild`.
- Cancellation produces a terminal build record and no promoted artifact.

### WP2.3 Incremental cache

Tasks:

- Prebuild stable Dear ImGui, backend, and runtime objects.
- Track compiler dependency files.
- Cache project objects by content and configuration digest.
- Rebuild asset bundle only when inputs change.
- Measure compile and link phases separately.

Acceptance:

- Editing one widget translation unit does not recompile Dear ImGui or unrelated project units.
- A corrupted cache entry is evicted and rebuilt automatically.
- Warm one-file build latency is measured in CI/performance fixtures.

### WP2.4 Studio editor and build experience

Tasks:

- Add project tree and Monaco editor.
- Connect reads and revision-checked patches.
- Add build action, status, diagnostics, logs, and stale-preview indicator.
- Swap to a newly successful preview only after its smoke initialization passes.

Acceptance:

- A developer can edit the toggle, build, and see the new preview without manually refreshing Studio.
- Introducing a compiler error leaves the last working preview visible and marks it stale.

**Phase 2 gate:** A one-file source change travels through revision, cached build, smoke test, and preview replacement reliably.

## 7. Phase 3 — Deterministic interaction and animation

### WP3.1 Clock and reset model

Tasks:

- Implement realtime and deterministic clock modes.
- Define absolute time and delta behavior.
- Reset sample application state, input queues, focus, animation storage, and clock.
- Expose play, pause, restart, frame step, speed, and seek controls.

Acceptance:

- Reset followed by the same time sequence produces identical clock values and application state.
- Deterministic execution never reads wall-clock time.

### WP3.2 Widget state and interaction adapter

Tasks:

- Implement item registration and button interaction wrappers.
- Store widget properties by ImGui ID, property key, and scoped context.
- Handle hover, held, press, click, active, disabled, clipping, and allowed overlap.
- Add lifecycle cleanup without deleting temporarily hidden but valid animation state prematurely.

Acceptance:

- Two widgets with equal property names do not share state.
- Disabled and clipped widgets cannot be activated incorrectly.
- Duplicate stable identifiers are reported.

### WP3.3 Animation primitives

Tasks:

- Implement float/vector/color tweening with required easings.
- Implement damped spring behavior with defined integration and settling rules.
- Implement delay and simple sequences.
- Add property trace and settled-state reporting.

Acceptance:

- Unit tests cover zero duration, large delta, target reversal, hidden widget, reset, seek, and invalid parameter behavior.
- Browser and native fixtures produce matching animation values at fixed timestamps.

### WP3.4 Input automation

Tasks:

- Parse and schedule scenario steps.
- Target stable widget identifiers or coordinates.
- Support move, down/up, click, drag, scroll, key, and text input.
- Return precise target and interaction errors.

Acceptance:

- A scenario toggles the fixture, drags a slider, and enters text in stable order.
- Missing or non-interactable targets stop with the documented error and step index.

### WP3.5 Filmstrip capture

Tasks:

- Run scenarios from a clean deterministic state.
- Capture frames at requested timestamps/fps.
- Return image artifacts, timestamps, widget traces, and diagnostics.
- Add progress and cancellation.

Acceptance:

- Three repeated clean captures produce identical state traces and approved image hashes/metrics.
- Filmstrip metadata identifies build, revision, scenario, viewport, DPI, and time range.

**Phase 3 gate:** An agent can click an animated custom toggle and inspect a deterministic transition filmstrip.

## 8. Phase 4 — Inspection and visual authoring

### WP4.1 Widget inspection

Tasks:

- Register stable semantic widget identifiers and types.
- Return tree, bounds, visibility, clipping, interaction, and animation properties.
- Add selection overlays for bounds, hitboxes, baselines, and padding.
- Detect duplicate identifiers and disallowed hitbox overlaps.

Acceptance:

- The fixture can be targeted and diagnosed without screen-coordinate guessing.
- Inspection does not change geometry or interaction results.

### WP4.2 Frame diagnostics

Tasks:

- Report non-finite geometry, invalid draw commands, out-of-viewport content, and recoverable Begin/End imbalance.
- Bound diagnostic volume and deduplicate repeated frame warnings.
- Attach diagnostics to build/preview/frame identity.

Acceptance:

- Each intentionally invalid fixture yields the expected diagnostic without taking down Studio when recovery is possible.

### WP4.3 Reference workflow

Tasks:

- Import bounded PNG, JPEG, and WebP references.
- Implement side-by-side, opacity overlay, absolute difference, and edge difference.
- Add scale, translation, crop, ruler, and point color sample controls.
- Expose comparison artifacts and metadata through agent tools.

Acceptance:

- A reference can be aligned non-destructively to a fixed preview and compared consistently after reload.
- Comparison reports identify all transforms and source capture provenance.

### WP4.4 Agent API and adapter

Tasks:

- Implement required `/api/v1` tool contracts.
- Add revision/build/preview identity to all results.
- Build a thin MCP-compatible adapter without duplicating business logic.
- Add cancellation and structured error handling.

Acceptance:

- An automated agent test can read, patch, build, render, act, inspect, capture, compare, reset, and export using only documented tools.

**Phase 4 gate:** Agent tools provide both visual and precise structured feedback for a reference-driven widget edit.

## 9. Phase 5 — Assets, theme, and component foundation

### WP5.1 Asset pipeline

Tasks:

- Validate and import fonts, raster textures, and SVG icons.
- Generate stable logical asset identifiers.
- Build deterministic font atlas inputs and icon outputs.
- Upload textures in browser and native hosts.
- Preserve supplied licenses/attributions.

Acceptance:

- The same project-provided font, logo, and icons appear in browser and native captures without unexplained mismatch.
- Oversized, malformed, and missing assets fail with actionable diagnostics.

### WP5.2 Theme system

Tasks:

- Define readable C++ tokens for typography, color, spacing, geometry, strokes, effects, and animation timings.
- Add a limited properties editor that modifies only the managed theme file.
- Allow per-widget overrides in ordinary C++.

Acceptance:

- A theme edit updates multiple starter widgets consistently.
- Direct custom drawing remains possible without going through theme abstractions.

### WP5.3 Editable widgets

Implement:

- Toggle/checkbox.
- Integer and float slider.
- Sidebar navigation and tab.
- Combo/dropdown.
- Keybind capture.
- Color picker trigger/popup.
- Card/settings row.
- Button/icon button.
- Toast and modal transition.

Each requires:

- Readable C++ source.
- Theme integration.
- Stable inspection registration.
- Hover, active, disabled, and relevant open/closed states.
- Isolated gallery example.
- Deterministic scenario.

Acceptance:

- All component scenarios pass in browser and native parity fixtures.
- No component requires a stock widget for its primary visible rendering.

### WP5.4 Portable effects helpers

Tasks:

- Add layered shadow, multi-shape glow, gradient, and text/icon alignment helpers.
- Document cost and visual limitations.
- Ensure helpers emit ordinary ImGui draw-list commands.

Acceptance:

- Portable effects render through the unmodified MVP browser and native backends.

**Phase 5 gate:** The starter contains enough editable visual material for an agent to create a cohesive custom menu without rebuilding every primitive.

## 10. Phase 6 — Export and integration

### WP6.1 Export graph

Tasks:

- Resolve exact source, runtime subset, generated assets, and documentation from a successful build.
- Reject or explicitly confirm export when active source is newer than the chosen successful build.
- Package only allowlisted project/runtime files.
- Record content digests and provenance.

Acceptance:

- Export contents correspond exactly to the selected build revision.
- Files outside project/runtime allowlists cannot enter the package.

### WP6.2 Native integration package

Tasks:

- Export public headers, source, runtime subset, assets, generated registrations, CMake targets, and example.
- Document state/event contract and render call.
- Generate portability report covering versions, C++ standard, internal API use, assets, and rendering tier.

Acceptance:

- A clean consumer fixture builds the export following only packaged instructions.
- The consumer can connect sample state and callbacks without editing generated/runtime internals.

### WP6.3 Export parity verification

Tasks:

- Build the package rather than the mutable Studio project in a clean native fixture.
- Replay approved states/scenarios and capture output.
- Compare it with the selected browser build.

Acceptance:

- Exported-package parity meets the two-pixel geometry tolerance.
- Export report contains no unexplained dependencies.

**Phase 6 gate:** A successful preview revision becomes a self-contained native integration package with verified parity.

## 11. Phase 7 — Reference benchmark and release hardening

### WP7.1 Benchmark harness

Tasks:

- Encode the PRD reference benchmark brief, inputs, required controls, scenarios, and rubric.
- Record all agent tool traces and outputs for permitted evaluation runs.
- Automate technical scoring and prepare human review artifacts.

Acceptance:

- Benchmark can be run from a clean starter and produces a complete evaluation bundle.

### WP7.2 Ten-run agent evaluation

Tasks:

- Run ten independent reference-reproduction attempts.
- Measure completion, build failures, iteration count, diagnostics, determinism, parity, and duration.
- Conduct blinded human review using the PRD rubric.
- Classify failures as product, tool, runtime, or agent-design failures.

Acceptance:

- At least eight runs complete without human source edits.
- At least eight completed runs receive four out of five or higher visual-quality rating.
- PRD determinism, warm-build, and parity targets pass.

### WP7.3 Reliability and security hardening

Tasks:

- Fuzz/negative-test schemas, paths, protocol envelopes, assets, and scenario input.
- Test preview crashes, build cancellation, service restart, corrupted caches, and partial exports.
- Verify CSP, token checks, path confinement, and log redaction.
- Complete dependency license and vulnerability review.

Acceptance:

- No unresolved critical security issue.
- All recovery paths leave canonical project data and successful artifacts intact.

### WP7.4 Documentation and release package

Tasks:

- Validate setup, starter tutorial, runtime API, agent API, project format, animation, inspection, export, testing, and security documents against the release build.
- Add known limitations and troubleshooting.
- Publish exact toolchain/version manifest.

Acceptance:

- A developer unfamiliar with the codebase completes the starter edit-preview-export journey within 15 minutes using documentation only.

**Phase 7 gate:** All PRD definition-of-done items and release metrics pass.

## 12. Critical dependency order

```text
pinned toolchain
  -> shared browser/native fixture
  -> preview protocol
  -> project revisions + cached build
  -> deterministic clock
  -> interaction + animation
  -> inspection + scenarios + capture
  -> agent API
  -> assets + component foundation
  -> export
  -> benchmark
```

Reference comparison UI can proceed alongside runtime inspection after canonical screenshot capture exists. Asset pipeline work can begin after browser/native hosts establish a common texture and font registration boundary.

## 13. Work explicitly deferred

Do not schedule these before the MVP release gates pass:

- Gaussian blur, bloom, or custom post-processing backend.
- WebGPU.
- macOS/Linux parity targets.
- Hosted or multi-tenant compilation.
- Drag-and-drop layout editor.
- Collaborative projects.
- Component marketplace.
- Import of arbitrary existing applications.
- Dynamic WASM linking solely for speculative performance.

## 14. Release blockers

Any of these blocks MVP release:

- Browser preview does not use real project C++ and Dear ImGui.
- Browser/native project widget source differs.
- Deterministic scenario traces vary across clean repeats.
- Export cannot be tied to a successful immutable build.
- Reference benchmark misses required completion or quality targets.
- Warm edit/build latency misses the PRD target without a documented remediation decision.
- A critical path-confinement, preview-isolation, or local-API authentication flaw remains.
- Required assets or font atlas inputs differ between browser and native output.
- A required component is only an unmodified visible stock widget.
- Portability requirements are hidden or incomplete.

## 15. Initial issue breakdown

The first implementation sprint should create issues in this order:

1. Pin toolchain and Dear ImGui version set.
2. Create shared CMake targets and fixture project.
3. Implement one custom draw-list toggle.
4. Build fixture to WebAssembly/WebGL2.
5. Add isolated preview iframe and handshake.
6. Add canonical RGBA browser capture.
7. Build identical fixture in Windows native host.
8. Add fixed native RGBA capture.
9. Add browser/native comparison report.
10. Establish initial parity baseline.
11. Add local project discovery and manifest validation.
12. Add revision-checked source reads and patches.
13. Add structured Emscripten build operation.
14. Cache stable objects and unchanged project units.
15. Replace preview only after successful smoke initialization.

Completing these issues proves the riskiest premise before significant editor or component work begins.

## 16. Progress reporting

Each work package reports:

- Owner and status.
- Linked requirements and contracts.
- Demonstrable output.
- Automated tests added.
- Performance measurements when relevant.
- Known limitations.
- Changes to public contracts or ADRs.

Milestone completion is recorded only after its phase gate passes on a clean environment.

## 17. MVP completion checklist

- [ ] Toolchain and dependencies are pinned and reproducible.
- [ ] Real Dear ImGui C++ renders through WASM/WebGL2.
- [ ] Identical project widget source builds natively on Windows.
- [ ] Project mutations are path-confined, atomic, and revision-safe.
- [ ] Warm builds reuse stable and unchanged objects.
- [ ] Failed builds retain the last successful preview.
- [ ] Preview protocol and iframe isolation are enforced.
- [ ] Deterministic clock, reset, interaction, and capture work.
- [ ] Tween and spring animations match browser/native fixtures.
- [ ] Widget and frame inspection provide required structured data.
- [ ] Agent tools cover the full edit-to-export loop.
- [ ] Reference overlay and difference workflows work.
- [ ] Fonts, icons, textures, and licenses export correctly.
- [ ] Required editable starter components and scenarios pass.
- [ ] Portable effects require no renderer modification.
- [ ] Export is tied to an immutable successful build.
- [ ] Clean consumer fixture builds the exported package.
- [ ] Browser/native parity meets tolerance.
- [ ] Security and recovery tests pass.
- [ ] Ten-run benchmark meets completion and quality targets.
- [ ] All product documentation matches released behavior.
