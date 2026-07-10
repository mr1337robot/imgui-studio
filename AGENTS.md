# AGENTS.md

## Purpose

This repository contains ImGui Studio, a local-first, AI-native development environment for authoring polished, animated Dear ImGui menus in real C++.

Agents working in this repository must preserve the defining product promise:

> Project menu and widget source is compiled into the real Dear ImGui WebAssembly preview and the same source is exported for native C++ integration.

This file applies to the entire repository. A more deeply nested `AGENTS.md` may add directory-specific instructions, but it must not weaken the product, security, determinism, parity, or testing requirements defined here.

## Current repository state

The repository is currently in the specification and architecture phase. The root documentation is the implementation baseline. Do not treat example paths, APIs, schemas, or acceptance criteria as aspirational prose; they are contracts unless explicitly marked post-MVP or deferred.

Before implementing a feature, confirm that its required parent directories and build foundations exist. Do not fabricate successful build or test results when the corresponding implementation or toolchain does not exist yet.

## Required reading

Read the documents relevant to the task before making changes. For foundational or cross-cutting work, read them in this order:

1. `PRD.md` — product scope, users, requirements, and definition of done.
2. `TECHNICAL_DESIGN.md` — processes, boundaries, technology choices, lifecycle, and data flow.
3. `MVP_IMPLEMENTATION_PLAN.md` — dependency order, work packages, phase gates, and release blockers.
4. The contract document governing the area being changed.
5. Relevant records in `docs/adr/`.

Area-specific contracts:

| Area | Required documents |
|---|---|
| C++ runtime or custom widgets | `RUNTIME_API.md`, `ANIMATION_SPEC.md`, `INSPECTION_PROTOCOL.md` |
| Deterministic time, replay, or capture | `ANIMATION_SPEC.md`, `PROJECT_FORMAT.md`, `AGENT_TOOL_API.md` |
| Agent tools or local HTTP/MCP API | `AGENT_TOOL_API.md`, `PROJECT_FORMAT.md`, `INSPECTION_PROTOCOL.md`, `SECURITY_MODEL.md` |
| Project files, manifests, assets, or scenarios | `PROJECT_FORMAT.md`, `SECURITY_MODEL.md` |
| Inspection or diagnostics | `INSPECTION_PROTOCOL.md`, `RUNTIME_API.md`, `TEST_PLAN.md` |
| Browser preview or build pipeline | `TECHNICAL_DESIGN.md`, `SECURITY_MODEL.md`, ADRs 0001 and 0003 |
| Native export or integration | `EXPORT_AND_INTEGRATION.md`, `TEST_PLAN.md`, ADRs 0002 and 0005 |
| Security-sensitive work | `SECURITY_MODEL.md`, `AGENT_TOOL_API.md`, `PROJECT_FORMAT.md` |
| Tests, fixtures, benchmarks, or release work | `TEST_PLAN.md`, `MVP_IMPLEMENTATION_PLAN.md` |

Do not partially read a selected contract and then infer the rest. Public API and protocol details are intentionally spread across the relevant documents and cross-links.

## Contract precedence

When documents appear inconsistent, use this precedence:

1. Accepted ADR for the specific decision.
2. `PRD.md` for product scope and user-visible requirements.
3. `TECHNICAL_DESIGN.md` for system architecture.
4. Area-specific contract documents for exact API, schema, lifecycle, and error behavior.
5. `MVP_IMPLEMENTATION_PLAN.md` and `TEST_PLAN.md` for work order and verification.

Do not silently choose one side of a real contradiction. Identify the conflict, determine whether it changes an accepted decision, and update all affected documents in the same change. Add or supersede an ADR when changing a consequential architectural decision.

## Non-negotiable MVP decisions

All implementation work must preserve these decisions:

- The canonical browser preview runs real Dear ImGui compiled from C++ to WebAssembly.
- C++20 is the project authoring and export language for the MVP.
- Browser preview and native export compile the same project menu and widget source.
- The initial browser renderer is WebGL2 through the pinned Emscripten/OpenGL3 path.
- The MVP is local-first, single-user, and Windows-native for parity and export fixtures.
- Dear ImGui, Emscripten, Studio runtime, schemas, and protocols are explicitly versioned.
- Custom widgets and `ImDrawList` rendering are primary capabilities, not edge cases.
- Selected internal Dear ImGui behavior is isolated behind a versioned adapter where practical.
- Direct `imgui_internal.h` use is allowed but must be detected and reported as a portability concern.
- Deterministic animation time uses signed 64-bit integer microseconds at protocol boundaries.
- Deterministic captures start from a clean reset and use stable input ordering.
- Screenshots are paired with structured widget, geometry, interaction, animation, and diagnostic data.
- Stable Studio widget identifiers are distinct from incidental pointers or screen coordinates.
- Exports are produced from an immutable successful, smoke-passed build revision.
- A failed build never replaces the last successful preview.
- The portable rendering tier is the only tier shipped in the MVP.
- Enhanced blur, bloom, and custom render passes are post-MVP and must not leak into portable projects.
- Browser/native geometry tolerance is at most two pixels at the fixed benchmark configuration.
- Reference similarity metrics are diagnostic and never the sole design-quality gate.
- Drag-and-drop layout authoring, hosted compilation, WebGPU, collaboration, and a marketplace are not MVP work.

Do not replace the real C++ preview with HTML/CSS, a canvas imitation, a JSON widget renderer, screenshots of a native process, or separately maintained browser widget implementations.

## Implementation order

Follow the dependency order in `MVP_IMPLEMENTATION_PLAN.md`. The first vertical slice is mandatory:

1. Pin the toolchain and Dear ImGui version.
2. Implement one custom animated draw-list toggle in shared project source.
3. Compile and render it through WebAssembly/WebGL2.
4. Compile and render the identical source in the Windows native parity fixture.
5. Add canonical framebuffer capture and geometry comparison.
6. Add the local revision-safe edit/build/preview loop.
7. Add deterministic interaction, animation state, inspection, and filmstrip capture.

Do not start a broad component library, polished editor shell, enhanced effects renderer, or generalized plugin system before the shared-source browser/native vertical slice passes its phase gate.

## Repository layout

Use the structure defined in `TECHNICAL_DESIGN.md`:

```text
apps/
  studio-web/
  studio-service/
  agent-adapter/
runtime/
  include/studio/
  src/
  imgui-adapters/
  browser/
  native/
components/
  widgets/
  effects/
  layout/
schemas/
toolchain/
examples/
tests/
docs/adr/
```

Do not create alternate top-level architectures without updating `TECHNICAL_DESIGN.md` and recording the decision when appropriate.

Keep generated artifacts out of hand-authored source directories. Build output, caches, screenshots, filmstrips, comparison artifacts, and generated schema bindings must live in documented ignored directories. Export generation is the only workflow that intentionally assembles generated and authored files into a deliverable tree.

## Source ownership

Classify files as one of:

- **User-authored:** project menu, widget, theme, state, scenario, and approved asset files. Preserve formatting and unrelated changes.
- **Studio-managed:** narrowly scoped generated configuration or metadata explicitly declared by `PROJECT_FORMAT.md`. Do not invite manual edits without a managed update path.
- **Build-generated:** objects, WASM/loader output, native binaries, atlases, rasterized icons, captures, and reports. Never treat these as canonical source.
- **Export-assembled:** copies of immutable build inputs, the required runtime subset, generated registration, and integration documentation.

Do not regenerate or rewrite an entire user-authored C++ file to change a small section. Apply bounded edits and preserve readable code.

## Senior engineering quality bar

All production code in this repository must read as if it will be maintained for years by engineers who did not write it. Optimize for correctness, clarity, diagnosability, and safe change rather than cleverness or short-term line count.

### Design before implementation

Before writing a non-trivial subsystem or cross-module feature:

1. Identify the owner module and its single responsibility.
2. Define inputs, outputs, lifecycle, failure modes, concurrency model, and resource ownership.
3. Confirm which existing public contract governs it.
4. Identify trust boundaries and untrusted inputs.
5. Decide how it will be tested and observed in production-like runs.
6. Record consequential or difficult-to-reverse choices in an ADR.

Do not introduce abstractions only because they might be useful later. Introduce them when they create a clear boundary, remove demonstrated duplication, enforce an invariant, or make testing materially safer.

### Module boundaries

- Give every module one documented responsibility and an explicit public surface.
- Keep implementation details private. Do not expose internal storage, backend types, compiler-process details, or transport details through unrelated APIs.
- Depend toward stable domain contracts. UI code must not own build, filesystem, revision, or export rules.
- Separate pure domain logic from filesystem, process, clock, graphics, network, and browser side effects.
- Pass dependencies explicitly where doing so improves testability and ownership clarity.
- Avoid global mutable state and hidden service locators.
- Avoid circular dependencies. If two modules require each other's internals, redesign the boundary.
- Keep platform-specific code at the edges behind narrow interfaces.
- Keep files cohesive. Split files when they contain multiple responsibilities, not merely because they exceed an arbitrary line count.
- Prefer composition over deep inheritance hierarchies.

### Readability

- Use domain-specific names that reveal intent. Avoid vague names such as `data`, `manager`, `helper`, `util`, `thing`, or `handleStuff` unless the domain meaning is genuinely clear.
- Keep functions focused on one level of abstraction.
- Prefer early validation and clear control flow over deeply nested branches.
- Make invariants explicit through types, constructors, validation, assertions, and documentation.
- Replace unexplained literals with named constants or configuration carrying units.
- Include units in names when ambiguity is possible, such as `timeUs`, `widthPx`, and `sizeBytes`.
- Avoid boolean parameters whose call sites are unclear; use enums or option structures.
- Avoid premature generic programming and macros that hide control flow or ownership.
- Remove dead code, commented-out implementations, obsolete compatibility paths, and unused abstractions.
- Do not suppress warnings broadly. Fix the cause or narrowly document why a suppression is safe.

### API design

- Make invalid states difficult to represent.
- Keep public APIs minimal and cohesive.
- Distinguish identifiers, paths, timestamps, durations, revisions, and byte sizes with clear types where practical.
- Document ownership, lifetime, thread affinity, mutation, nullability, ordering, determinism, and error behavior.
- Prefer explicit options structures for operations expected to grow.
- Preserve backward compatibility within a declared protocol/schema major version.
- Do not expose an API until at least one real caller and its tests demonstrate the shape.
- Avoid returning references, pointers, iterators, or views whose lifetime is ambiguous.
- Do not use exceptions, error codes, nullable values, and sentinel values inconsistently for the same class of failure.
- Validate at system boundaries once, then pass validated domain types internally.

### Ownership and resource management

- Use RAII for C++ resources, including ImGui contexts, graphics resources, files, processes, temporary directories, and synchronization primitives.
- Express exclusive ownership with values or `std::unique_ptr`; use shared ownership only when the lifetime is genuinely shared and documented.
- Avoid owning raw pointers. Non-owning pointers and references must have obvious, bounded lifetimes.
- Ensure cleanup occurs on success, error, cancellation, timeout, preview crash, and service shutdown.
- Make resource limits and eviction behavior explicit.
- Do not retain references into containers or runtime state across operations that may invalidate them.
- In TypeScript, always clean up event listeners, subprocesses, streams, timers, object URLs, WebSockets, and preview instances.

### Concurrency and cancellation

- Document which code is single-threaded, thread-affine, serialized, or safe for concurrent use.
- Prefer message passing and immutable operation records over shared mutable state.
- Protect shared state at the owning boundary rather than scattering locks throughout the codebase.
- Never hold locks while invoking user code, waiting on a process, performing network I/O, or emitting callbacks.
- Design long-running work for cancellation from the beginning.
- Cancellation must be idempotent and must lead to a terminal state.
- Avoid detached background work whose lifetime is not owned by a service or operation object.
- Tests must cover races involving revision changes, build supersession, cancellation, preview replacement, and service shutdown.

### Performance and scalability

- Meet the measured budgets in the PRD and test plan; do not trade correctness for unmeasured optimization.
- Establish a baseline before optimizing and include evidence for performance-sensitive changes.
- Avoid unbounded collections, logs, diagnostic streams, caches, capture frames, and artifact retention.
- Use streaming or pagination for potentially large results.
- Keep frame-loop code allocation-aware and avoid unnecessary per-frame hashing, string construction, or filesystem access.
- Keep expensive image comparison, compilation, and capture work off the Studio UI thread.
- Document cache keys, invalidation, size limits, eviction, and corruption recovery.
- Add regression measurements for changes to build latency, preview startup, frame time, capture time, or memory use.

## Error handling and resilience

Failures are part of each API's design. Do not add a happy-path implementation and defer error behavior.

### Error taxonomy

Classify failures consistently:

- **Validation:** malformed input, unsupported version, invalid state transition, or violated precondition.
- **Conflict:** stale revision, stale digest, replaced preview, or concurrent operation conflict.
- **Not found:** requested project, file, build, frame, widget, reference, or artifact does not exist in the caller's authority.
- **Resource limit:** timeout, memory, size, count, log, capture, or retention limit exceeded.
- **Dependency/toolchain:** compiler unavailable, asset decoder failure, linker failure, or incompatible version.
- **Cancellation:** explicitly requested termination that reaches a known terminal state.
- **Internal invariant:** a defect or impossible state that requires diagnostic evidence and safe containment.

Use the stable error codes and envelopes defined in the governing contracts. Human-readable messages may change; control flow must never depend on message text.

### Error propagation

- Add context at subsystem boundaries without discarding the original cause.
- Preserve stable machine-readable error code, operation identity, and safe structured details.
- Never expose secrets, bearer tokens, unrelated source, raw asset bytes, or absolute host paths.
- Do not catch an error merely to log and continue in an invalid state.
- Do not return success with a hidden partial failure unless the API explicitly defines partial results.
- Atomic operations either complete fully or leave canonical state unchanged.
- Retriable errors must state whether retry is safe and whether a new revision or identity is required.
- Translate low-level errors once at the owning boundary; avoid repeated lossy wrapping.

### Recovery behavior

- Preserve the last known-good preview when a build, smoke test, or preview replacement fails.
- Write canonical project files atomically.
- Keep successful build artifacts immutable and independently recoverable from mutable working state.
- Clean partial temporary output after failure or cancellation.
- Recover from corrupt cache entries by evicting only the affected entry and rebuilding.
- Bound retries and use backoff where an external transient operation exists.
- Never retry compiler errors, validation errors, or revision conflicts automatically without changed input.
- Test failure injection at filesystem, process, preview, asset, and export boundaries.

### Assertions and invariants

- Use assertions for programmer errors and internal invariants, not expected user input failures.
- Return structured errors for malformed projects, agent requests, assets, scenarios, and ordinary toolchain failure.
- Studio preview assertions must produce actionable diagnostics and a recoverable preview failure when possible.
- An assertion must not be the only documentation of a precondition.

## Logging and observability

- Emit structured logs with stable event names and fields.
- Include request ID, project ID, project revision, build ID, preview ID, frame/capture/export ID, operation phase, duration, and outcome when relevant.
- Use consistent severity: debug for development detail, info for lifecycle milestones, warning for degraded but safe behavior, and error for failed operations.
- Log once at the boundary that owns the failure. Avoid duplicate error logs at every propagation layer.
- Never log secrets, tokens, full source files, raw user assets, arbitrary environment variables, or sensitive paths.
- Bound and redact compiler, linker, decoder, runtime, and subprocess output.
- Make important state transitions observable: revision committed, build promoted, preview swapped, reset completed, capture finalized, export verified, and recovery performed.
- Add metrics for latency, cache behavior, resource consumption, failure category, determinism, and parity where specified by `TECHNICAL_DESIGN.md` and `TEST_PLAN.md`.
- Ensure logs and metrics do not affect deterministic runtime behavior.

## Dependency discipline

- Prefer the standard library and existing approved dependencies before adding another package.
- Every new dependency requires a concrete use case, license review, maintenance assessment, security review, size/cost assessment, and explanation of why a small internal implementation is not safer.
- Pin direct dependency versions through the repository's chosen lock/version mechanism.
- Do not use floating branches, unpinned downloads, or network-fetched runtime assets in reproducible builds.
- Keep dependency access behind a narrow adapter when replacement or platform differences are plausible.
- Remove dependencies that are no longer used.
- Record toolchain and shipped dependency versions in build and export provenance.
- Do not modify vendored third-party source except through clearly documented patches kept separate from first-party code.

## Code review standard

Before declaring implementation complete, review the change as a senior maintainer would:

- Is the responsibility in the correct module?
- Is there a simpler design with fewer states or dependencies?
- Are ownership and lifetime unambiguous?
- Are names and units clear at call sites?
- Are all inputs validated at the right boundary?
- Are errors actionable, structured, safe, and tested?
- Are cancellation, cleanup, retries, and partial failure correct?
- Are concurrent state transitions safe?
- Are collections, logs, caches, and artifacts bounded?
- Does the change preserve deterministic replay and browser/native parity?
- Are security boundaries maintained?
- Are public contracts minimal and documented?
- Do tests cover behavior rather than implementation details?
- Can another engineer understand why the design exists without reconstructing it from commit history?

If the answer to any relevant question is no, the change is not complete.

## C++ requirements

- Target C++20 for runtime, starter components, parity fixtures, and exported project interfaces.
- Keep project menu/widget source free of browser-specific and native-backend-specific types.
- Avoid global animation state and widget-local `static` animation variables.
- Key runtime widget properties by project context, `ImGuiID`, and stable property key as specified in `RUNTIME_API.md`.
- Use the Studio clock for animation. Project animation code must not read wall-clock time directly.
- Make reset behavior explicit and deterministic.
- Use project-provided fonts and assets in parity fixtures; do not depend on installed system fonts.
- Prefer the public Studio interaction adapter over direct internal calls when it provides the required behavior.
- Keep direct internal Dear ImGui use visible and detectable.
- Inspection instrumentation must not change layout, geometry, input behavior, or animation results.
- Portable effects must emit ordinary Dear ImGui draw-list commands and work with unmodified MVP render backends.
- Do not add a visible stock Dear ImGui widget as the final implementation of a required custom component.

Public runtime changes require:

- Updates to `RUNTIME_API.md` and, when applicable, `ANIMATION_SPEC.md` or `INSPECTION_PROTOCOL.md`.
- Browser and MSVC compilation coverage.
- Lifecycle, reset, invalid-input, and browser/native behavior tests.
- A compatibility or versioning decision if an existing contract changes.

## TypeScript and service requirements

- Treat the local service as canonical for projects, revisions, builds, artifacts, and exports.
- Treat the web application as a client, not an authority.
- Use strict TypeScript and runtime schema validation at trust boundaries.
- Use camelCase JSON and the versioned `/api/v1` contracts.
- Represent unsigned 64-bit project revisions as decimal strings in JSON.
- Represent deterministic time as integer microseconds; do not use JSON floating-point seconds for canonical timing.
- Use opaque identifiers without parsing semantic information from them.
- Require expected revision and preimage digest for source mutations.
- Apply multi-file mutations atomically or not at all.
- Include project/build/preview/frame identity on stateful responses as defined by `AGENT_TOOL_API.md`.
- Never silently retarget a command from a stale preview or frame to the newest one.
- Return structured errors and diagnostics. Do not make agents parse human console prose for control flow.
- Keep the MCP adapter thin; business logic belongs behind the canonical local service contracts.

## Project and protocol compatibility

- Validate all manifests, scenarios, reference metadata, inspection payloads, and API inputs against versioned schemas.
- Reject unsupported major versions explicitly.
- Preserve unknown data only where the governing schema explicitly allows it.
- Use `/` in project-relative protocol paths on every host platform.
- Never expose host absolute paths in API errors, diagnostics, artifacts, or exports.
- Maintain the PRD-to-canonical agent tool mapping documented in `AGENT_TOOL_API.md`.
- Keep normalized deterministic traces free of opaque runtime IDs and wall-clock timestamps.

Any schema change must include:

- Updated normative documentation.
- Valid and invalid fixtures.
- Compatibility classification.
- Migration logic if existing persisted projects are affected.
- Tests covering rejection of unsupported or malformed data.

## Build and preview rules

- Invoke compilers and tools with executable plus argument arrays, never shell-interpolated user input.
- Use a sanitized child-process environment and project-scoped working directory.
- Cache stable Dear ImGui, backend, and Studio runtime objects separately from project objects.
- Include compiler identity, flags, source, and transitive dependency digests in cache keys.
- Treat build records and successful artifacts as immutable.
- Promote a build only after compilation, linking, artifact validation, and preview smoke initialization succeed.
- Start a new preview instance for a successful build; do not mutate the running WASM module in place for the MVP.
- Preserve the previous preview until the replacement reaches `ready`.
- Capture the underlying RGBA8 framebuffer, independent of CSS display scaling or browser chrome.
- Attach project revision, build ID, preview ID, viewport, DPI, clock, and state provenance to captures.

Do not implement dynamic WASM linking or speculative hot reload before measured cached-build performance shows that the documented latency targets cannot be met.

## Determinism rules

Deterministic behavior is a release requirement, not a best-effort feature.

- A clean reset restores sample application state, runtime state, input queues, focus/navigation/active state, popups, diagnostics, animation storage, clock, and frame index in the documented order.
- Deterministic execution never reads wall-clock time.
- Input at the same timestamp is applied in stable scenario sequence order.
- Backward seek resets and replays; it does not integrate animation backward.
- Captures use the exact frame cadence defined in `ANIMATION_SPEC.md` and `PROJECT_FORMAT.md`.
- Three equivalent clean captures must produce byte-identical normalized state traces.
- Random behavior must be absent or use an explicit recorded seed.
- Tests must cover target reversals, large deltas, zero duration, hidden widgets, invalid parameters, reset, seek, and settling.

## Inspection requirements

- Custom widgets must register stable Studio identifiers, semantic type, bounds, and relevant state.
- Identifier registration order and serialization order must follow `INSPECTION_PROTOCOL.md`.
- Targeting uses an exact stored frame; do not silently use geometry from another frame.
- Detect duplicate identifiers, disallowed hitbox overlap, clipping, invalid/non-finite geometry, invalid draw commands, and recoverable stack imbalance.
- Bound and deduplicate diagnostics to prevent unbounded frame output.
- Keep inspection values safe and intentional; do not expose arbitrary application memory or secrets.
- Compile-time or runtime removal of inspection must not change visible geometry or interaction.

## Security requirements

Read `SECURITY_MODEL.md` before changing filesystem, process, preview, asset, artifact, WebSocket, import, or export behavior.

At minimum:

- Bind the service to localhost by default.
- Require an unpredictable per-launch token for mutations and artifact access.
- Validate `Host`, origin, and WebSocket authorization according to the security model.
- Resolve and confine paths on every access, including symlink, junction, and reparse-point cases.
- Reject paths outside the active project even when they normalize back through another alias.
- Sandbox the preview with restrictive CSP and no arbitrary DOM, network, origin-storage, or filesystem access.
- Bound request bodies, patch size, asset count, file size, decoded dimensions, memory, build time, logs, diagnostics, captures, and artifact retention.
- Decode untrusted assets under limits.
- Exclude secrets, `.studio` state, external paths, and undeclared files from exports.
- Never put tokens in URLs, logs, errors, exports, or event payloads.

Do not weaken a security boundary merely because the MVP is local. A malicious website may still attempt to reach a localhost service.

## Testing requirements

Use `TEST_PLAN.md` as the normative verification source.

Every implementation change must include tests proportional to its risk:

- C++ unit tests for runtime state, animation, adapters, inspection, and asset helpers.
- TypeScript unit tests for schema validation, revisions, paths, API errors, build state, and export selection.
- Integration tests for edit/build/load/render/inspect/capture/export flows.
- Browser tests for preview lifecycle, isolation, deterministic input, and framebuffer capture.
- Native parity tests for shared project source, fonts, assets, geometry, and fixed animation timestamps.
- Negative tests for malformed data, stale identities, traversal, cancellation, crashes, cache corruption, and resource limits.
- Visual regression tests with exact environment and artifact provenance.

When reporting completion, state exactly which commands ran and whether they passed. If a required test cannot run because the implementation or toolchain is not present, say so and identify the unverified acceptance criteria.

Do not update a visual baseline merely to make a test pass. Review the diff, explain why the change is intended, and preserve the comparison artifact.

## Documentation requirements

Documentation is part of the contract.

- Update the governing document in the same change as behavior or public API changes.
- Keep examples compilable or schema-valid.
- Keep terminology consistent: project revision, build ID, preview instance ID, frame ID, deterministic time, portable tier, and enhanced tier.
- Use exact units and coordinate spaces.
- Cross-link rather than duplicating divergent definitions.
- Add an ADR for consequential, difficult-to-reverse changes.
- Do not rewrite an accepted ADR to hide a changed decision; supersede it and link both records.
- Do not leave `TODO`, `TBD`, placeholder contracts, or unresolved contradictory defaults in implementation-ready documents.

### Documentation architecture

Maintain documentation at these levels as implementation begins:

```text
README.md                         project overview and quickest successful path
CONTRIBUTING.md                   development workflow and contribution standards
docs/
  getting-started.md              local setup and first preview/export journey
  development.md                  build, test, debug, and troubleshooting commands
  architecture.md                 maintained system map linking the normative design
  adr/                            immutable architectural decisions
  operations/
    local-service.md              startup, shutdown, logs, recovery, and limits
    toolchain.md                  pinned toolchain setup and cache recovery
  guides/
    custom-widget.md              end-to-end widget authoring tutorial
    animation.md                  practical deterministic animation usage
    integration.md                native consumer integration walkthrough
```

The existing root contract documents remain normative. The documents above are operational and explanatory entry points that link to those contracts rather than copying them verbatim.

Each significant source subtree must have a concise `README.md` when it first becomes non-trivial. At minimum, document:

- Its responsibility and explicit non-responsibilities.
- Public entry points.
- Dependency direction and important collaborators.
- Lifecycle and ownership.
- Threading or process model.
- Failure and recovery behavior.
- Configuration and versioning.
- How to build, test, debug, and extend it.
- Links to governing contracts and ADRs.

Expected subsystem documentation includes `apps/studio-web/README.md`, `apps/studio-service/README.md`, `runtime/README.md`, `schemas/README.md`, `toolchain/README.md`, `examples/README.md`, and `tests/README.md` once those directories contain implementation.

### Code documentation

- Treat code comments as part of the product. Production code must be approachable to a motivated
  beginner while remaining technically useful to an experienced engineer reviewing invariants,
  tradeoffs, and failure behavior.
- Begin each non-trivial implementation file with a concise module comment when its role, execution
  environment, or relationship to another process is not obvious from the filename. Explain where
  the file sits in the system and what it deliberately does not own.
- Document every public C++ type, function, enum, option structure, callback, and non-obvious constant with Doxygen-compatible comments.
- Document every exported TypeScript type, function, class, service interface, schema entry point, and React component contract with TSDoc where the name and type alone are insufficient.
- Public documentation must explain purpose, parameters, return value, ownership, lifetime, units, thread affinity, mutation, errors, determinism, and invalidation where relevant.
- Document protocol and schema fields in their machine-readable schema descriptions as well as the normative Markdown contract.
- Add file or module comments only when they explain responsibility, invariants, or architecture; do not add ceremonial headers.
- Inline comments should explain why a decision or algorithm is necessary, not restate the code.
- Explain unfamiliar framework and platform patterns at their first important use. Examples include
  Dear ImGui's immediate-mode lifecycle and ID rules, draw-list coordinate spaces, Emscripten
  JavaScript bridges, browser transferable objects, Win32 message dispatch, COM ownership, DX11
  staging textures and row pitch, and subprocess cancellation. Do not assume prior experience with
  the repository's least familiar technology.
- Use short section comments to make long functions scannable when they cross meaningful phases
  such as validate, acquire, render, capture, commit, and clean up. A section comment must explain
  the phase's invariant or purpose, not merely repeat the next function call.
- For every non-obvious algorithm, document the input domain, units, coordinate system, numerical
  bounds, and reason it was chosen. Include a compact derivation or authoritative reference for
  animation response curves, color transforms, image metrics, hashing, and geometry normalization.
- At trust boundaries, explain what is untrusted, what validation or confinement is performed, and
  why a rejected value cannot be used safely. Keep the comment beside the enforcing code.
- At resource and lifetime boundaries, explain who owns the resource, which operation releases it,
  and how cleanup remains correct on early return, cancellation, and failure when this is not
  obvious from RAII alone.
- Examples and tests should include comments that teach the behavior under test, especially when a
  fixture represents a security regression, deterministic invariant, platform quirk, or deliberate
  failure. Tests should not be densely narrated line by line.
- Document unusual math, animation equations, hashing, image comparison, cache invalidation, and security-sensitive normalization with references or derivations.
- Place comments next to the invariant they protect and keep them updated in the same change.
- Prefer clearer code over comments that compensate for confusing code.
- Do not narrate obvious assignments, loops, or control flow.

Before declaring a code change complete, perform a documentation pass and ask:

- Can an engineer new to Dear ImGui, WebAssembly, DX11, or the local service understand the control
  flow without external archaeology?
- Are public contracts and the non-obvious private invariants documented where they are enforced?
- Are units, ownership, thread/process affinity, coordinate spaces, and error behavior clear?
- Do comments explain why the code has this shape and remain accurate after the change?

If a relevant answer is no, the implementation is not complete.

Example public C++ documentation:

```cpp
/// Advances or retargets a deterministic scalar tween for one widget property.
///
/// @param widget Stable Dear ImGui ID in the current project context.
/// @param property Non-zero Studio property key.
/// @param target Desired terminal value.
/// @param duration Tween duration in seconds; zero snaps to `target`.
/// @param easing Easing curve evaluated according to ANIMATION_SPEC.md.
/// @return The value at the current Studio clock time.
///
/// Must be called between BeginFrame() and EndFrame() on the render thread.
/// Reports InvalidPropertyKey or PropertyTypeMismatch through the current frame
/// diagnostics. ResetRuntimeState() invalidates all stored tween state.
[[nodiscard]] float Animate(
    ImGuiID widget,
    PropertyKey property,
    float target,
    float duration,
    Ease easing);
```

### Documentation quality

- Write for a competent engineer who is new to this repository.
- Lead with purpose and the shortest successful workflow.
- Include prerequisites, exact commands, expected outcomes, and common failure recovery in operational guides.
- Use diagrams only when they make ownership, data flow, lifecycle, or state transitions clearer.
- Mark generated documentation and point to its source of truth.
- Check relative links, code fences, headings, schema examples, and referenced paths in CI.
- Run documentation examples as tests where practical.
- Treat stale or contradictory documentation as a defect.
- Remove obsolete documentation when behavior is removed; do not accumulate historical instructions outside ADRs and release notes.

### Required documentation in a feature change

A feature is not documented merely because its implementation has comments. Depending on scope, update all applicable layers:

- Public API documentation.
- Governing contract or schema.
- Subsystem `README.md`.
- User/developer workflow guide.
- Configuration reference.
- Error and troubleshooting guidance.
- ADR for an architectural decision.
- Example or fixture demonstrating intended use.
- Release note or migration guidance for compatibility-impacting changes.

Documentation-only claims must be verified against the actual implementation and command output before merging.

## Change workflow

For every task:

1. Read the governing contracts and relevant ADRs.
2. Inspect the existing implementation and current uncommitted changes.
3. Identify the smallest phase-appropriate change that satisfies the request.
4. State any assumption that would affect architecture, compatibility, security, or scope.
5. Modify only owned/in-scope files and preserve unrelated user changes.
6. Add or update tests before declaring completion.
7. Run the narrowest relevant tests, then broader integration/parity checks when risk warrants them.
8. Update contracts and ADRs when behavior changes.
9. Report outcome, files changed, verification performed, and remaining limitations.

Prefer completing an end-to-end thin slice over creating many disconnected abstractions.

## Parallel-agent coordination

When multiple agents work concurrently:

- Assign non-overlapping file or module ownership before edits begin.
- Share interface decisions early; do not independently invent competing schemas or APIs.
- One agent owns each public contract change.
- Agents must not overwrite, revert, reformat, or delete another agent's in-progress work.
- Integrate through agreed contracts and run cross-module tests after all dependent work lands.
- The coordinating agent performs the final consistency review across source, schemas, docs, and tests.

## Scope control

Avoid attractive but premature work. In particular, do not add these to the MVP unless the PRD and implementation plan are deliberately revised:

- HTML/CSS preview substitutes.
- A JSON layout DSL as the primary authoring format.
- Enhanced shaders, blur, or bloom.
- WebGPU.
- Hosted compilation.
- Accounts or collaboration.
- Drag-and-drop layout editing.
- A plugin or component marketplace.
- Arbitrary existing-project import.
- Multiple native platforms or Dear ImGui versions.

If a requested feature belongs to post-MVP scope, explain the conflict and either keep the change behind a non-MVP experimental boundary or update the product decision with explicit authorization.

## Definition of a complete change

A change is complete only when:

- It satisfies the relevant documented acceptance criteria.
- It preserves canonical shared C++ source across browser and native targets.
- It preserves deterministic behavior where applicable.
- It does not weaken path, process, preview, artifact, or export security.
- Public API/schema behavior and documentation agree.
- Public APIs and non-obvious invariants have useful code documentation.
- The relevant subsystem README and developer/user guides reflect the new behavior.
- Error paths, cleanup, cancellation, and diagnostic context are implemented and tested.
- Ownership, concurrency, resource limits, and dependency impact are explicit.
- Relevant automated tests pass.
- Browser/native parity is checked when rendering, layout, fonts, assets, timing, or drawing changes.
- Build and artifact provenance remain traceable to an immutable project revision.
- Known limitations are stated plainly.
