# ImGui Studio — Technical Design

**Status:** Implementation baseline  
**Version:** 1.0  
**Date:** July 9, 2026  
**Requirements source:** `PRD.md`  

## 1. Purpose

This document defines the MVP architecture for ImGui Studio. It converts the product requirements into concrete processes, modules, interfaces, data flows, technology choices, failure behavior, and delivery constraints.

The first system objective is one complete loop:

> Edit a custom animated C++ widget, compile it to WebAssembly, render real Dear ImGui in a browser, interact with it deterministically, inspect and capture it, then compile the same widget source in a Windows native parity application.

Anything not necessary for that loop is subordinate to it.

## 2. Architectural constraints

The MVP must preserve these invariants:

1. The browser preview runs real Dear ImGui compiled from C++.
2. Project menu and widget source is identical in browser and native builds.
3. User source is C++, not an intermediate layout language.
4. Project builds occur locally.
5. Preview execution is isolated from the Studio web application.
6. Animation captures use a deterministic clock and deterministic input schedule.
7. Every rendered result is attributable to an immutable project revision and build.
8. The last successful preview remains available after a failed build.
9. Portable projects do not require modifications to a normal ImGui renderer backend.
10. Version-sensitive ImGui internals are concentrated in an adapter where practical.

## 3. MVP technology choices

| Concern | MVP choice | Reason |
|---|---|---|
| Studio UI | React + TypeScript + Vite | Mature editor ecosystem and fast local development |
| Source editor | Monaco Editor | C++ editing, diagnostics, diffs, and extensibility |
| Local service | TypeScript on Node.js LTS | Shares protocol types with the web client and supports local process orchestration |
| API transport | HTTP JSON plus WebSocket events | Simple agent integration; streaming build/preview state |
| Agent adapter | Thin MCP-compatible adapter over HTTP API | Keeps product contracts independent of one agent transport |
| Schema validation | JSON Schema plus generated TypeScript types | Machine-readable contracts and runtime validation |
| Browser compiler | Pinned Emscripten SDK | Supported path from C++/OpenGL-style ImGui code to WASM/WebGL |
| Browser renderer | GLFW/Emscripten platform integration plus OpenGL3/WebGL2 renderer | Lowest-risk initial browser backend |
| Native parity target | Windows, CMake, Win32 + DirectX 11 example | Common ImGui integration target and straightforward CI fixture |
| Native compiler | MSVC through a CMake preset | Matches initial Windows target |
| Test runner | Vitest for TypeScript; CTest for C++; Playwright for Studio integration | Covers service, runtime, and browser workflows |
| Image comparison | Deterministic RGBA captures plus perceptual and pixel metrics | Supports strict parity and diagnostic reference comparison |

Exact dependency versions are release configuration, not hard-coded in this design. A Studio release must publish and enforce one validated version set.

## 4. System context

```text
Human or AI agent
       |
       v
Studio Web UI <---- HTTP/WebSocket ----> Local Studio Service
       |                                      |
       | sandboxed iframe                     | process + filesystem boundary
       v                                      v
WASM Preview Runtime                    Emscripten Build Worker
       |                                      |
       +---------- build artifacts <----------+
                                              |
                                              v
                                      Native Export/Parity Build
```

The browser never invokes compilers directly. The local service owns projects, revisions, builds, artifact storage, and exports. The preview iframe owns only the execution of a built WASM artifact and communication through a restricted message protocol.

## 5. Repository layout

```text
apps/
  studio-web/                 React Studio application
  studio-service/             local project/build/API service
  agent-adapter/              optional MCP-compatible transport adapter
runtime/
  include/studio/             public portable C++ runtime API
  src/                        runtime implementation shared by targets
  imgui-adapters/             version-specific internal ImGui adapters
  browser/                    Emscripten platform/render/bootstrap code
  native/                     native host helpers and parity fixture support
components/
  widgets/                    editable starter widget implementations
  effects/                    portable drawing helpers
  layout/                     editable layout helpers
schemas/
  project/                    manifest and reference metadata schemas
  scenarios/                  input/capture scenario schemas
  inspection/                 widget and frame inspection schemas
  api/                        local service and agent tool contracts
toolchain/
  cmake/                      shared targets and presets
  emscripten/                 pinned setup and browser build files
examples/
  starter/                    new-project template
  native-parity/              Windows parity host
tests/
  unit/
  integration/
  visual/
  fixtures/
docs/
  adr/
```

Generated files must live under ignored build or cache directories, never beside hand-authored project source unless an explicit export operation creates them.

## 6. Process model

### 6.1 Studio web application

Responsibilities:

- Display files and source editor.
- Submit revision-checked patches.
- Display structured compiler diagnostics.
- Host the sandboxed preview iframe.
- Relay preview input and inspection commands.
- Display reference comparison, timeline, filmstrip, widget tree, assets, and export report.
- Maintain presentation state, not canonical project state.

The web application may cache query results but must treat the local service as authoritative for project files, revisions, build status, and artifacts.

### 6.2 Local Studio service

Responsibilities:

- Discover and validate Studio projects.
- Confine file access to an active project root.
- Apply atomic, revision-checked file mutations.
- Schedule, cancel, and observe builds.
- Store immutable build records and artifacts.
- Serve preview artifacts with restrictive headers.
- Package exports from a successful build revision.
- Expose the versioned HTTP API and WebSocket event stream.
- Authenticate mutations using a per-launch session token.

Only one service process owns a project write lock in the MVP. Concurrent readers are allowed. Conflicting mutation requests fail with a revision conflict.

### 6.3 Build worker

The build worker is a child process invoked with explicit arguments, a project-scoped working directory, a sanitized environment, and bounded output capture.

Responsibilities:

- Validate manifest and asset declarations.
- Produce a dependency graph.
- Reuse stable/runtime and unchanged project object files.
- Compile changed translation units.
- Link the WASM module and JavaScript loader.
- Emit structured diagnostics and build metadata.
- Run an initialization smoke frame.

The service must not build shell command strings from user-controlled paths. It invokes executables with argument arrays.

### 6.4 WASM preview runtime

Responsibilities:

- Initialize Dear ImGui, font atlas, textures, Studio runtime, and WebGL2 renderer.
- Accept deterministic clock, application state, viewport, and input commands.
- Execute project render source.
- Return frames, screenshots, widget inspection, animation traces, and runtime diagnostics.
- Detect and report fatal assertions or initialization failures.

It must not access arbitrary local files or the parent DOM. Required assets are packaged into the preview artifact or provided through an explicit in-memory asset channel.

### 6.5 Native parity host

The native parity application is a small Windows executable that:

- Initializes the pinned Dear ImGui source and selected native backend.
- Loads the same generated font atlas inputs and assets.
- Calls the same project render entry point.
- Supports fixed viewport, DPI, sample state, deterministic time, and scripted input.
- Captures RGBA output for browser/native comparison.

It is both an export example and a test fixture.

## 7. Canonical project and revision model

### 7.1 Project identity

A project is a directory containing a Studio manifest at its root. The local service resolves the directory once, verifies it is within an allowed workspace root, and assigns an opaque runtime project ID.

### 7.2 Revisions

The service maintains a monotonically increasing 64-bit project revision. A revision advances after every successful canonical mutation, including source changes and asset metadata changes.

Each mutation includes `expectedRevision`. If it differs from the current revision, the service returns `REVISION_CONFLICT` without writing.

A revision record contains:

- Revision number.
- Timestamp.
- Changed relative paths.
- Content digests after the change.
- Initiator identifier when available.

The revision number is for concurrency and traceability. File content digests are used for build caching.

### 7.3 Builds

A build record is immutable and contains:

- Build ID.
- Project revision.
- Toolchain/version-set ID.
- Build configuration digest.
- Source and asset digests.
- Start/end timestamps and status.
- Structured diagnostics.
- Artifact paths and digests.
- Smoke-test outcome.

`lastSuccessfulBuild` changes only after compilation, linking, artifact validation, and smoke initialization all succeed.

### 7.4 Preview identity

Every preview message and result includes:

- Project ID.
- Build ID.
- Project revision.
- Preview instance ID.
- Runtime protocol version.

The UI must visibly mark the preview stale when the active project revision is newer than its build revision.

## 8. Build system design

### 8.1 Target graph

```text
imgui-core objects             stable per Studio version
browser backend objects       stable per Studio version
studio-runtime objects        stable per Studio version/configuration
asset bundle/font atlas       keyed by asset configuration digest
project translation units     keyed by compiler flags + dependency digest
             \                /
              WASM link artifact
```

Native parity uses the same `imgui-core`, `studio-runtime`, asset configuration, and project sources, compiled for the native target.

### 8.2 Dependency tracking

Compiler-generated dependency files determine which translation units must be rebuilt after header changes. Cache keys include:

- Compiler identity and version.
- Target triple.
- Effective compiler flags and defines.
- Source content.
- Transitive included-file content digests.
- Pinned ImGui and Studio runtime identities.

The MVP uses a project-local build directory and a shared read-only cache for stable Studio objects. Cache corruption results in eviction and one clean rebuild.

### 8.3 Build configurations

The MVP supports:

- `preview-debug`: assertions and inspection enabled; optimized enough for interactive use.
- `native-parity`: inspection and deterministic capture enabled.
- `export-release`: configuration information for the consumer; not necessarily prebuilt binaries.

Project source is compiled with C++20 for the MVP. This must be documented in the manifest and export report.

### 8.4 Diagnostics

Compiler output is parsed into:

```text
severity, code, message, relativePath, line, column,
endLine, endColumn, excerpt, buildId
```

Unparsed output remains available as bounded raw logs. Absolute host paths are removed from API responses.

### 8.5 Performance strategy

The design targets a median warm one-file build below three seconds. Initial optimizations are:

- Prebuild stable Dear ImGui, backend, and Studio runtime objects.
- Use small project translation units.
- Avoid regenerating assets unless asset inputs change.
- Link with settings optimized for preview startup rather than minimum binary size.
- Keep one initialized build worker/toolchain environment available while Studio is running.

Dynamic WASM linking and in-process C++ hot reload are explicitly deferred until measurement proves them necessary.

## 9. Preview runtime design

### 9.1 Lifecycle

Preview states:

```text
unloaded -> loading -> initializing -> ready
                           |            |
                           v            v
                         failed       crashed
```

On a new successful build, Studio creates a new preview instance rather than mutating the running module. Once it reaches `ready`, the UI swaps it into view and disposes the prior instance.

### 9.2 Parent/iframe protocol

The parent and preview communicate with `postMessage` using an exact target origin and protocol envelope:

```json
{
  "protocolVersion": 1,
  "previewInstanceId": "opaque-id",
  "requestId": "opaque-id",
  "type": "render.frame",
  "payload": {}
}
```

Every request has one terminal success or error response. Long operations may also emit progress events. Unknown protocol versions and message types are rejected.

### 9.3 Frame modes

The runtime supports two exclusive modes:

- `realtime`: clock derives from frame delta and input may come from the canvas.
- `deterministic`: time advances only through explicit commands and input comes from scheduled commands.

Captures and agent evaluations always use deterministic mode. Switching modes resets pending input; switching to deterministic mode also requires explicit reset or time selection.

### 9.4 Frame execution order

For a deterministic frame:

1. Apply requested reset if present.
2. Set viewport and DPI.
3. Set absolute Studio time and compute non-negative delta according to animation specification.
4. Apply all scheduled input at that timestamp in stable sequence order.
5. Begin platform/backend frame.
6. Begin Dear ImGui frame.
7. Begin Studio inspection frame.
8. Call project render entry point.
9. Finalize inspection and runtime diagnostics.
10. Render Dear ImGui draw data.
11. Optionally read back RGBA pixels.
12. Return state trace and frame metadata.

### 9.5 Project entry point

Each project exposes a small stable bridge compiled into both targets:

```cpp
namespace project {
void Initialize(studio::ProjectContext& context);
void ResetSampleState(studio::ProjectContext& context);
void Render(studio::ProjectContext& context);
void Shutdown(studio::ProjectContext& context);
}
```

The starter supplies this bridge and calls a normal, user-editable menu function. Export documentation shows how to invoke that menu function without the Studio host.

### 9.6 Screenshot readback

Canonical screenshots are RGBA8 images with:

- Exact pixel width and height.
- Explicit color-space metadata.
- No browser UI or CSS scaling.
- Build, revision, viewport, DPI, time, state, and scenario metadata.

The preview canvas may be visually scaled in Studio, but capture always reads the underlying framebuffer dimensions.

## 10. Runtime module boundaries

### 10.1 Public portable runtime

`runtime/include/studio/` provides:

- Widget interaction registration.
- Persistent widget property storage.
- Deterministic animation functions.
- Inspection registration.
- Asset lookup handles.
- Portable draw helpers.
- Clock and project context access.

This source is available to exported projects and avoids browser-specific types.

### 10.2 ImGui adapter

The adapter may wrap selected internal operations including item sizing, item addition, button behavior, and rectangular geometry. There is one adapter directory per supported Dear ImGui version set.

The adapter has tests for:

- Item registration and clipping.
- Hover/held/pressed behavior.
- keyboard/navigation activation where supported.
- Disabled state.
- Overlap policy.

Direct project use of `imgui_internal.h` is not blocked. A source scan reports it in export portability metadata.

### 10.3 Inspection instrumentation

Inspection is explicit for custom Studio widgets. A widget registers a stable Studio identifier and semantic type around the same bounds it registers with ImGui. Runtime instrumentation also records frame-level diagnostics.

Inspection code compiles to no-ops or can be removed in consumer release builds. It must not change widget geometry or interaction behavior.

### 10.4 Asset runtime

Asset declarations produce stable logical names and generated C++ registration metadata. Runtime lookup returns typed handles rather than backend-native texture implementation details.

Browser and native hosts implement texture upload. Project drawing uses the compatible `ImTextureID` supplied by the runtime.

Font atlas inputs are deterministic configuration, including font bytes, sizes, glyph ranges, merge order, rasterizer settings, and atlas flags.

## 11. Reference comparison design

Reference images remain outside the WASM module. The Studio UI/service comparison pipeline operates on:

- Canonical preview capture.
- Original reference asset.
- Non-destructive transform metadata: scale, translation, crop, and opacity.
- Optional region annotations.

Comparison modes:

- Side by side.
- Alpha overlay.
- Absolute RGB/RGBA difference.
- Edge difference.

The API returns derived image artifacts and numeric diagnostics. Numeric similarity never automatically approves a design.

## 12. Export design

Export takes an explicit successful build ID. It never packages unverified working-tree contents silently.

The package includes:

```text
include/                       project public headers
src/                           exact menu/widget source
studio_runtime/                required portable runtime subset
assets/                        original approved assets and licenses
generated/                     asset registration and pinned config
examples/native/               minimal integration host
cmake/                         targets/helpers
CMakeLists.txt
README.md
studio-export.json             provenance and portability report
```

The report records:

- Source project revision and build ID.
- Dear ImGui and Studio runtime versions.
- Required C++ version.
- Rendering tier.
- Internal ImGui usage.
- Fonts, textures, icons, and licenses.
- Expected viewport/DPI used for parity.
- Known warnings.

## 13. API and event model

The HTTP API is versioned under `/api/v1`. JSON payloads use camelCase. Identifiers are opaque strings. Timestamps use UTC ISO 8601; deterministic animation times use integer microseconds in protocol storage to avoid JSON floating-point ambiguity.

WebSocket events include:

- Project revision changed.
- Build queued, started, diagnostic, completed, failed, or cancelled.
- Preview loading, ready, crashed, or disposed.
- Capture progress and completion.
- Export completion.

Clients must tolerate duplicate progress events and use terminal resource state from HTTP as authoritative after reconnecting.

## 14. Error model

All service errors use:

```json
{
  "error": {
    "code": "REVISION_CONFLICT",
    "message": "The project changed after this patch was prepared.",
    "retryable": true,
    "details": {},
    "requestId": "opaque-id"
  }
}
```

Core codes include:

- `INVALID_REQUEST`
- `UNSUPPORTED_VERSION`
- `PROJECT_NOT_FOUND`
- `PATH_OUTSIDE_PROJECT`
- `REVISION_CONFLICT`
- `BUILD_ALREADY_RUNNING`
- `BUILD_FAILED`
- `PREVIEW_NOT_READY`
- `PREVIEW_REVISION_MISMATCH`
- `TARGET_NOT_FOUND`
- `TARGET_NOT_INTERACTABLE`
- `CAPTURE_FAILED`
- `ASSET_INVALID`
- `EXPORT_REQUIRES_SUCCESSFUL_BUILD`
- `OPERATION_CANCELLED`
- `INTERNAL_ERROR`

Compiler errors and runtime diagnostics are successful transport responses with failed operation state, not generic HTTP 500 errors.

## 15. Concurrency and cancellation

- One canonical mutation is applied at a time per project.
- One build may execute at a time per project; a newer requested build may supersede a queued older build.
- One deterministic capture may control a preview instance at a time.
- Realtime manual preview and deterministic capture use separate preview instances when both must remain available.
- Build and capture operations expose cancellation IDs.
- Cancellation is best effort but always ends in a terminal state.
- Export reads immutable build artifacts and may run alongside later source edits.

## 16. Security boundaries

Security requirements are detailed in `SECURITY_MODEL.md`. Architectural enforcement points are:

- Localhost-only service listener by default.
- Per-launch bearer/session token for mutations and artifact access.
- Canonical path resolution and project-root confinement.
- No shell interpolation for compiler invocation.
- Sanitized child-process environment and bounded resources.
- Sandboxed iframe with minimal permissions and restrictive CSP.
- No arbitrary network access from preview code.
- Asset count, file size, decoded dimension, and total-memory limits.
- Export allowlist based on project manifest and runtime dependency graph.

## 17. Observability

Local structured logs contain request ID, project ID, revision, build ID, preview ID, operation, duration, and outcome. Logs must not contain source content, session tokens, or asset bytes.

Development metrics include:

- Cache hit rate by object class.
- Compile and link duration.
- Preview initialization duration.
- Frame and readback duration.
- Capture duration.
- Runtime diagnostic counts.
- Browser/native comparison metrics.

Telemetry leaves the machine only after explicit opt-in.

## 18. Testing architecture

The architecture must support:

- Pure C++ tests for clock, animation, state storage, adapters, and inspection.
- Pure TypeScript tests for projects, revisions, schemas, paths, builds, and API errors.
- Browser integration tests that load a fixture preview and issue deterministic commands.
- Visual fixtures with exact build and environment provenance.
- Native parity captures through a command-line test mode.
- End-to-end tests from source patch to export.

Test fixtures must not depend on wall-clock time, pointer position, installed system fonts, or network resources.

## 19. Implementation sequence

1. Establish repository, pinned dependencies, schemas, and fixture project.
2. Render a hard-coded custom widget in browser and native hosts.
3. Add the local project/revision service and cached source build.
4. Introduce preview protocol and reliable lifecycle replacement.
5. Add interaction adapter, deterministic clock, state storage, and animation.
6. Add stable identifiers, widget inspection, scripted interaction, and capture.
7. Add fonts, textures, icons, themes, and starter components.
8. Add reference comparison.
9. Add export, provenance report, and automated parity workflow.
10. Run and refine the reference benchmark.

Detailed work packages and gates are in `MVP_IMPLEMENTATION_PLAN.md`.

## 20. Architecture acceptance criteria

The architecture is validated when:

- One custom widget source file is compiled unchanged into WASM and Windows native targets.
- A warm edit-build-preview cycle meets the PRD latency target on the reference machine.
- Failed compilation leaves the previous preview operational.
- Every preview screenshot is traceable to a project revision and build ID.
- A scripted click produces the same widget and animation state trace across three reset runs.
- Browser and native fixture geometry differs by no more than two pixels at the fixed test configuration.
- The preview cannot read a test file outside its packaged assets or communicate with the parent outside the defined protocol.
- An export can be reconstructed from its manifest without access to Studio's mutable working state.

## 21. Deferred decisions

These choices do not block the MVP vertical slice and must be resolved only before their corresponding post-MVP work:

- Enhanced native renderer backend and shader API.
- Hosted build isolation technology.
- Multi-platform native parity beyond Windows.
- WebGPU browser backend.
- Collaborative editing and project synchronization.
- Dynamic WASM linking or alternative hot reload.
- Component marketplace packaging and trust model.

