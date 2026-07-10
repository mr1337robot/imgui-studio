# ImGui Studio — Test and Release Validation Plan

**Status:** Implementation baseline  
**Version:** 1.0  
**Date:** July 9, 2026  
**Inputs:** `PRD.md`, `TECHNICAL_DESIGN.md`, `MVP_IMPLEMENTATION_PLAN.md`

## 1. Purpose

This plan defines how ImGui Studio proves correctness, deterministic behavior, browser/native parity, security, performance, export integrity, and agent usefulness. A phase is complete only when its automated checks and stated manual gates pass on a clean supported environment.

## 2. Quality gates

| Gate | Required evidence | Blocks |
|---|---|---|
| G0 Reproducible foundation | pinned toolchain identity, schema fixtures, clean CI setup | all implementation phases |
| G1 Rendering spine | identical custom source builds in WASM and Windows; canonical captures; parity report | interaction/runtime expansion |
| G2 Edit/build loop | revision-safe writes, incremental caching, failed-build preview retention | agent mutation workflows |
| G3 Determinism | clock, reset, input, animation traces, repeated filmstrips | benchmark and export claims |
| G4 Inspection/agent loop | stable targeting, diagnostics, reference comparison, full API workflow | autonomous evaluations |
| G5 Component/assets | all editable components and asset parity fixtures | reference benchmark |
| G6 Export | clean consumer build, provenance, package parity | MVP release |
| G7 Release | security review, performance targets, ten-run benchmark, documentation journey | release |

## 3. Supported test environments

The release manifest pins exact versions. The MVP validation matrix includes:

- Current supported desktop Chromium on Windows.
- Node.js LTS and package manager from the toolchain manifest.
- Pinned Emscripten SDK.
- CMake and MSVC through the checked-in Windows preset.
- Pinned Dear ImGui source for browser and native fixtures.
- Win32 + DirectX 11 native parity host.
- A reference development machine profile used for latency and 60-fps targets.

CI runners must report CPU, memory, OS build, GPU/rendering mode, browser, compiler, Emscripten, Dear ImGui, and Studio revision with artifacts. Visual baselines are not shared across materially different environment profiles unless a comparison study approves it.

## 4. Test layers and ownership

### 4.1 Static and schema checks

- TypeScript type checking, linting, formatting, dependency/license checks.
- C++ compilation with warnings-as-errors for Studio-owned code, formatting, and static analysis.
- JSON Schema validation for manifests, scenarios, build records, inspection, references, API errors, export reports, and capture metadata.
- Contract compatibility tests between generated TypeScript types and JSON fixtures.

### 4.2 Unit tests

**Runtime/C++:** deterministic clock; tween/easing; spring integration; animation key isolation; reset/seek; persistent-state lifetime; item adapter; clipping/disabled/overlap; inspection serialization; asset identifiers; portable effects geometry.

**Service/TypeScript:** path confinement; revision conflicts; atomic writes; build state machine; cache keys; diagnostic parsing/redaction; protocol envelopes; artifact retention; export graph and allowlists; cancellation.

**Web/TypeScript:** stale-preview state, timeline controls, overlay transforms, accessible statuses, event deduplication, reconnect reconciliation.

### 4.3 Component tests

Each editable widget has an isolated gallery fixture covering applicable states: idle, hover, held, pressed, active/on, inactive/off, disabled, focused, open/closed, value minimum/midpoint/maximum, target reversal, and settled animation. Its visible control must be custom drawn rather than an unmodified stock widget.

### 4.4 Integration tests

- Patch source → revision advance → cached build → smoke init → preview replacement.
- Compiler failure → structured diagnostics → previous successful preview retained and marked stale.
- Preview crash → new isolated instance → Studio UI remains usable.
- Scenario → stable target resolution → input schedule → state trace → screenshot/filmstrip.
- Asset import → font atlas/texture registration → browser capture → native export capture.
- Reference transform → overlay/difference artifacts → persistence and provenance.
- Selected successful build → deterministic export → clean consumer build → parity verification.

### 4.5 End-to-end and agent evaluation

Playwright drives human-facing journeys. A transport-level agent harness uses only documented `/api/v1` or MCP adapter operations and cannot access project files directly. It must read, patch, build, render, act, inspect, capture, compare, reset, and export.

## 5. Canonical fixtures

| Fixture | Purpose |
|---|---|
| `custom-toggle` | first custom `ImDrawList` widget and browser/native geometry |
| `animated-controls` | toggle, slider, text entry, target reversal, filmstrip determinism |
| `widget-gallery` | all required component states and inspection registration |
| `asset-matrix` | multiple font weights, icon merge, SVG raster, PNG/JPEG/WebP textures |
| `invalid-runtime` | non-finite geometry, invalid draw command, ID collision, overlap, clipping |
| `path-attacks` | traversal, absolute paths, symlinks/junctions/reparse points, races |
| `build-failures` | syntax error, link error, cancellation, crash, corrupt cache |
| `portable-effects` | gradient, layered shadow, multi-shape glow without renderer extension |
| `native-consumer` | package-only clean integration and state/event contract |
| `neon-benchmark` | complete 900×600 release reference task |

Fixtures contain project-provided fonts and assets, fixed viewport/DPI/sample state, deterministic scenarios, expected traces, and licensing metadata. They never use system fonts, wall clock, live network resources, or ambient pointer state.

## 6. Determinism tests

Every deterministic run starts from a full reset of sample application state, input queues, focus/active IDs, animation storage, runtime diagnostics, clock, random seed if exposed, and framebuffer. Protocol time is integer microseconds.

Required cases:

- Equal reset + time sequence + inputs produces byte-identical serialized state and animation traces across three runs.
- Input events sharing a timestamp execute in stable declared sequence order.
- Paused frames use zero delta and do not advance animations.
- Seeking backward restores from a deterministic reset/checkpoint and replay; negative delta is never sent to animation code.
- Frame stepping advances by the configured exact interval.
- Playback speed affects presentation scheduling, not deterministic timestamp values.
- Tween zero duration, huge delta, delayed start, interruption, and target reversal have defined expected values.
- Springs cover under/critical/over damping, huge delta handling, target reversal, and settling thresholds.
- Hidden widgets retain or expire state according to the runtime lifecycle rule, never because of wall time.
- Browser and native fixed-time animation values match within the explicitly defined numeric epsilon.

Filmstrip acceptance: three clean runs have identical trace digests and matching images under the approved image metric. Any image variance with equal traces is classified as renderer nondeterminism and investigated; it is not silently rebased.

## 7. Visual and parity validation

### 7.1 Capture contract

Canonical captures are framebuffer RGBA8, without browser chrome or CSS scaling, and record build ID, revision, runtime version, viewport pixels, DPI scale, color-space metadata, deterministic timestamp, scenario, state digest, asset/font config digest, and environment profile.

### 7.2 Comparison hierarchy

1. Structured geometry: widget bounds, hitboxes, baselines, clipping, visibility.
2. State/animation traces: exact or numeric-epsilon comparison.
3. Asset identity: font, glyph ranges, icons, textures, theme/config digests.
4. Pixel diagnostics: changed-pixel count, absolute difference, edge difference.
5. Perceptual metric: approved threshold for rasterizer/anti-aliasing noise.
6. Human review for intentional baseline changes and benchmark polish.

Browser/native release geometry tolerance is at most two pixels at the benchmark configuration. A perceptual score cannot override missing elements, clipped text, incorrect state, displaced layout, or asset mismatch.

### 7.3 Baseline policy

- Baselines live with environment and provenance metadata.
- A failing baseline is never updated automatically.
- Intended changes require a before/after/diff artifact and reviewer approval.
- Baseline approval must state whether the change is visual intent, environment migration, or corrected nondeterminism.
- The old baseline remains recoverable in version control.

## 8. Build, cache, and revision tests

- A valid expected-revision patch changes exactly the requested file atomically and advances revision once.
- A stale patch leaves every file and revision unchanged.
- Header dependency changes rebuild all and only affected translation units.
- One widget `.cpp` edit does not rebuild Dear ImGui, Studio runtime, backend, unrelated project units, or asset bundle.
- Compiler flag, toolchain, target, dependency, source, or asset changes invalidate the correct cache keys.
- A corrupted cache object is detected, evicted, and rebuilt once.
- Concurrent build requests obey per-project queue/supersession rules.
- Cancellation ends in one terminal record and cannot promote artifacts.
- Compile, link, artifact validation, and smoke initialization must all pass before `lastSuccessfulBuild` changes.
- Every result and screenshot rejects a mismatched build/revision/preview identity.

## 9. Protocol and API contract tests

- Unknown versions, message types, fields where forbidden, malformed envelopes, oversized messages, stale preview IDs, and wrong origins are rejected.
- Each request has exactly one terminal success/error response; progress events may duplicate without changing terminal state.
- Reconnect uses HTTP resource state as authoritative and tolerates missed/duplicate WebSocket events.
- Compiler/runtime operation failure uses structured operation state rather than accidental HTTP 500.
- Mutation and artifact requests require the per-launch token.
- Agent actions against missing, clipped, disabled, or non-interactable targets stop at the correct step with the documented code.
- Cancellation IDs cannot cancel operations from another project/session.

## 10. Export tests

The complete requirements are in `EXPORT_AND_INTEGRATION.md`. Minimum release cases:

- Failed, cancelled, smoke-failed, unknown, and digest-invalid builds cannot export.
- Export of an older selected successful build is byte-consistent with that build and explicitly warns when source is newer.
- Same-build exports have identical inventories and payload digests.
- Only dependency-graph and allowlisted files enter the package.
- Zip extraction and directory output produce equal payloads.
- Packaged checksums detect modification.
- Clean `native-consumer` configures and builds using packaged instructions only.
- State and callbacks integrate without changes to generated/runtime internals.
- Package-based native parity meets geometry and asset criteria.

## 11. Security testing

Security cases are detailed in `SECURITY_MODEL.md` and are mandatory in G7. They include:

- Traversal in URL encoding, mixed separators, case variants, reserved names, and Unicode normalization.
- Symlink, junction, mount/reparse-point, and time-of-check/time-of-use path replacement attempts.
- Command/argument injection through paths, manifests, compiler flags, diagnostics, and asset names.
- Cross-site requests to localhost, missing/wrong/stale tokens, hostile origins, WebSocket misuse.
- Iframe sandbox and CSP escape attempts; preview DOM/storage/network access attempts.
- Asset parser bombs, huge decoded dimensions, excessive glyph ranges, malformed SVG/fonts/images.
- Build/capture CPU, memory, process, output, and timeout exhaustion.
- Export inclusion of external files, secrets, logs, caches, and undeclared references.
- Log/token/source redaction and telemetry opt-in.

No unresolved critical security finding is permitted at release.

## 12. Reliability and recovery tests

- Kill preview during init, realtime render, deterministic capture, and screenshot readback.
- Kill build worker during compile/link and restart the service with partial artifacts present.
- Cancel captures/builds/exports at every state transition.
- Corrupt cache index/object, build metadata, and temporary export.
- Fill disk during atomic file write and export staging.
- Restart service after a canonical mutation but before client acknowledgement.
- Disconnect/reconnect browser during build and capture.

Expected outcome: canonical project data and prior successful artifacts remain intact; operations reconcile to one terminal state; temporary outputs are deleted or quarantined; recovery instructions are actionable.

## 13. Performance validation

On the published reference machine, measure at least 30 warm samples after five warmups and report median, p95, max, and confidence notes.

| Metric | MVP target |
|---|---|
| No-op preview restart to interactive | ≤ 1 second |
| Warm one-file edit to running preview | median ≤ 3 seconds; p95 ≤ 6 seconds |
| Benchmark preview interaction | sustained 60 fps |
| 1-second 12-fps deterministic capture | ≤ 5 seconds after preview load |
| Studio responsiveness | no main-thread task > 100 ms caused by build/capture orchestration |

Measure cache hit rate, compile/link/init/readback/capture phases, WASM size, memory high-water mark, and dropped frames. At least 90% of one-file warm builds must meet the p95 target for release. Environment noise or cold setup is reported separately, not removed without explanation.

## 14. Accessibility and documentation tests

- Studio shell keyboard navigation covers editor, build, preview, timeline, inspector, comparison, assets, and export.
- Labels/statuses are exposed to accessibility tools; color is not the sole status signal.
- Compiler/runtime errors are visible without developer tools.
- A developer familiar with Dear ImGui completes setup → starter edit → preview → scenario capture → export → native integration in 15 minutes using release documentation only.
- Documentation examples are compiled or contract-tested in CI where practical.

## 15. Agent benchmark

Run ten independent attempts from a clean standard starter using the fixed written brief, reference image, allowed tools, and resource budget. Do not seed a completed reference-specific project or permit human source edits.

Each attempt records:

- Agent/tool/model configuration and full permitted tool trace.
- Time to first successful preview and accepted export.
- Patch/build/visual-iteration counts and cache behavior.
- Compiler/runtime failures and unresolved diagnostics.
- Scenario success and three-repeat determinism results.
- Export/native parity result.
- Final screenshots, filmstrips, comparison artifacts, and portability report.

Technical scoring requires all requested controls, custom primary rendering, stable identifiers, no clipping/invalid overlap/duplicate-ID warnings, working animations/interactions, and successful verified export.

Blinded human reviewers score 1–5 independently for visual hierarchy, consistency, custom appearance, typography/asset quality, animation polish, and overall perceived quality. Reviewers receive the reference and canonical capture/filmstrip, not run identity. Disagreements greater than one point require adjudication.

Release targets:

- At least 8 of 10 attempts complete without human source edits.
- At least 8 completed attempts receive 4/5 or higher overall visual quality.
- At least 95% of scripted interaction runs are deterministic across three repeats.
- All release fixtures meet the two-pixel geometry tolerance.

Failures are classified as product/tooling, runtime, agent design, environment, or test-harness failure before deciding whether to rerun. A rerun is allowed only for a documented harness/environment fault.

## 16. CI lanes

| Lane | Trigger | Contents |
|---|---|---|
| Fast | every change | schemas, formatting, TypeScript/C++ unit tests, contract fixtures |
| Browser | every PR affecting preview/web/runtime | Emscripten build, Playwright protocol/render/inspection fixtures |
| Windows native | every PR affecting C++/assets/export | MSVC build, component captures, package consumer |
| Visual parity | merge queue/nightly | browser/native canonical capture comparisons |
| Security negative | nightly and security-sensitive PRs | paths, protocol, assets, auth, export, resource limits |
| Performance | nightly/release candidate | reference-machine latency/frame/capture suite |
| Agent benchmark | release candidate or intentional evaluation | ten-run benchmark and human review bundle |

Flaky tests are quarantined only with an owner, issue, expiry, and non-flaky release substitute. Determinism, path confinement, authentication, export provenance, and package parity tests may not be quarantined for release.

## 17. Defect severity and release rules

- **Critical:** code execution beyond intended local build scope, root escape, token bypass, export secret inclusion, destructive canonical data loss. Zero open.
- **High:** wrong build exported, nondeterministic required scenarios, broken parity, preview isolation failure, unrecoverable build/project corruption. Zero open.
- **Medium:** component state failure, misleading diagnostics, material performance miss, inaccessible primary journey. Requires explicit release disposition.
- **Low:** cosmetic or low-impact issue with documented workaround. May ship if outside acceptance gates.

Any release blocker in `MVP_IMPLEMENTATION_PLAN.md` overrides ordinary severity disposition.

## 18. Release evidence bundle

The release candidate archives:

- Toolchain/version and environment manifests.
- CI results and schema contract version inventory.
- Performance distributions.
- Browser/native parity reports and approved visual baselines.
- Security test results and review sign-off.
- Clean consumer export verification report.
- Ten-run benchmark traces, captures, scores, and failure classification.
- Documentation journey result and known limitations.

## 19. Acceptance criteria

- Every quality gate has automated evidence and a named reviewer for manual evidence.
- The same project source and asset configuration are proven in browser and native targets.
- Required deterministic traces repeat three times and browser/native values match within specified epsilon.
- No fixture relies on wall clock, installed system fonts, ambient input, or live network data.
- Performance targets and release metrics in the PRD pass on the declared environment.
- Export provenance, clean consumer build, and package parity pass.
- Security mandatory cases pass with no critical open finding.
- Ten-run agent benchmark and human-quality targets pass.

## 20. Related documents

- Requirements and release targets: `PRD.md`
- Architecture and testability boundaries: `TECHNICAL_DESIGN.md`
- Phase gates: `MVP_IMPLEMENTATION_PLAN.md`
- Export verification: `EXPORT_AND_INTEGRATION.md`
- Threat model: `SECURITY_MODEL.md`
- Deterministic clock decision: `docs/adr/0004-deterministic-animation-clock.md`
