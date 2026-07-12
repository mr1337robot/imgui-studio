# ImGui Studio — Export and Native Integration Specification

**Status:** Implementation baseline  
**Version:** 1.0  
**Date:** July 9, 2026  
**Inputs:** `PRD.md`, `TECHNICAL_DESIGN.md`, `MVP_IMPLEMENTATION_PLAN.md`

## 1. Purpose

This document defines how a successfully previewed ImGui Studio project becomes a self-contained native C++ package. Export is a reproducible packaging operation over an immutable successful build, not a copy of the current working directory.

The MVP target is Windows, CMake, C++20, and a portable Dear ImGui renderer integration. The exported menu/widget source is byte-for-byte the project source compiled into the selected WebAssembly preview.

## 2. Required invariants

1. Every export names one successful `buildId`, project revision, toolchain set, and build configuration digest.
2. Exported project sources and asset inputs match the selected build's recorded digests.
3. A later source edit cannot change an existing export or its provenance.
4. The package contains no source file outside the build dependency graph and export allowlists.
5. Portable-tier output has no browser, WebGL, Node.js, Studio service, or iframe dependency.
6. Browser and native targets call the same user-authored menu/widget functions.
7. Generated files are identified and can be replaced without modifying user-owned source.
8. A clean consumer can integrate the package without editing Studio runtime internals.

## 3. Export request and state

Export accepts:

```json
{
  "projectId": "prj_01...",
  "buildId": "bld_01...",
  "format": "directory",
  "outputName": "neon-settings",
  "verifyNativeParity": true,
  "confirmOlderRevision": false
}
```

`format` is `directory` in the MVP. Archive output is the PRD P1 follow-up and is rejected rather
than silently producing a nondeterministic archive. The service resolves all inputs from immutable
build metadata. It compares the active project revision with the selected build revision:

- Equal: proceed.
- Active revision is newer: return a conflict requiring `confirmOlderRevision: true`; a confirmed
  package records a prominent stale-source warning.
- Build is absent, failed, cancelled, smoke-test failed, or artifact digests fail verification: reject with `EXPORT_REQUIRES_SUCCESSFUL_BUILD`.

Export state is `queued`, `resolving`, `packaging`, `verifying`, `succeeded`, `failed`, or `cancelled`. A cancelled or failed export never promotes a partial directory to the requested destination. Packaging occurs in a temporary sibling directory and is atomically renamed after verification.

## 4. Export dependency graph

The service builds an explicit graph from:

- Project translation units and compiler dependency files captured by the selected build.
- Public project headers declared by the project entry target.
- The exact portable Studio runtime modules referenced by linked symbols.
- The pinned Dear ImGui compatibility metadata, but not Dear ImGui source unless the user selects the optional vendored dependency mode.
- Asset declarations and generated registration compiled by the selected build.
- Asset license and attribution files declared in the manifest.
- CMake helpers, integration example, and documentation from the selected Studio release.

The packager must not recursively copy the project root. Each candidate path is canonicalized, checked against its owning root, checked for link/reparse-point escape, classified, and hashed before inclusion.

Allowed project classes:

- Declared `.cpp`, `.cc`, `.cxx`, `.h`, `.hpp`, and `.inl` dependencies.
- Declared font, icon, texture, theme, and license inputs.
- Approved project documentation explicitly included by manifest.

Forbidden classes include Studio caches, compiler outputs, secrets, VCS metadata, arbitrary executables, absolute external paths, undeclared symlink targets, reference images not marked for distribution, and local service logs.

## 5. Package layout

```text
neon-settings/
  include/neon_settings/       public state, events, and render API
  src/                         exact project menu/widget source
  studio_runtime/
    include/studio/            required portable runtime headers
    src/                       required portable runtime implementation
    imgui_adapter/             adapter for the pinned ImGui version
  assets/                      approved original assets and licenses
  generated/
    asset_registry.hpp
    asset_registry.cpp
    font_atlas_config.cpp
    studio_export_config.hpp
  cmake/ImGuiStudioExport.cmake
  examples/native/
    CMakeLists.txt
    main.cpp
    sample_state.cpp
  CMakeLists.txt
  README.md
  LICENSES.md
  studio-export.json
  SHA256SUMS
```

`include/`, `src/`, and approved assets are user-owned inputs. `generated/`, `studio_runtime/`, `cmake/`, the example, and reports are Studio-owned export products. This ownership is stated in `README.md`.

## 6. Public integration contract

The package exposes one stable project namespace derived from a sanitized manifest name:

```cpp
namespace neon_settings {

struct State {
    bool enabled{};
    float intensity{0.75F};
    int selected_page{};
};

struct Events {
    std::function<void()> on_save;
    std::function<void()> on_reset;
};

struct Assets {
    studio::TextureResolver texture_resolver;
};

void Initialize(const Assets& assets);
void Render(State& state, const Events& events = {});
void Shutdown();

} // namespace neon_settings
```

Rules:

- The consumer owns application state and callback lifetime.
- `Initialize` runs after an ImGui context and renderer backend exist; it may be called again after renderer-device loss if documented.
- `Render` runs between the consumer's `ImGui::NewFrame()` and `ImGui::Render()` on the same thread as the ImGui context.
- The package does not call platform/backend `NewFrame`, present, or swap functions.
- `Shutdown` runs before the ImGui context is destroyed.
- Widget code must not depend on the Studio sample-state bridge.
- Public headers must not expose browser-only types or version-sensitive `imgui_internal.h` types.

The generated example demonstrates initialization, per-frame rendering, state mutation, callbacks, device reset, and shutdown.

## 7. CMake contract

The root package defines:

```cmake
add_subdirectory(path/to/neon-settings)
target_link_libraries(my_app PRIVATE neon_settings::menu)
```

`neon_settings::menu`:

- Requires C++20.
- Links only project source and the required portable runtime subset.
- Expects an existing Dear ImGui target provided through `IMGUI_TARGET`, defaulting to `imgui` when present.
- Validates the Dear ImGui version against the exported compatibility range at configure time.
- Does not choose or link the consumer's platform/renderer backend.
- Exposes options `STUDIO_ENABLE_INSPECTION` (default `OFF`) and `STUDIO_STRICT_IMGUI_VERSION` (default `ON`).

The example may fetch or vendor the exact validated Dear ImGui revision for demonstration only; the library target must not silently introduce a second ImGui copy into a consumer process.

## 8. Assets and fonts

Assets use stable logical identifiers, never host paths. `generated/asset_registry.*` maps logical names to embedded bytes or consumer-provided files according to the manifest's export policy.

For the MVP:

- Font bytes, sizes, glyph ranges, merge order, oversampling, rasterizer settings, and atlas flags are exported exactly.
- The consumer calls the generated atlas registration before the backend creates the font texture.
- Texture registration is backend-neutral: the consumer returns `ImTextureID` values through `TextureResolver`.
- Original license/attribution files are preserved and indexed in `LICENSES.md`.
- Missing required assets fail initialization with an actionable diagnostic; no implicit system-font fallback is allowed.
- Asset content digests are recorded in `studio-export.json` and `SHA256SUMS`.

## 9. Rendering tiers and portability report

The MVP exports `portable` projects only. Portable source may use ordinary ImGui draw lists, images, vertex colors, layered translucent shapes, and portable Studio helpers. It must not require modified draw commands, render targets, custom shaders, blur, or bloom.

`studio-export.json` records:

```json
{
  "schemaVersion": 1,
  "project": { "name": "neon-settings", "revision": "42" },
  "buildId": "bld_01...",
  "sourceDigest": "sha256:...",
  "studioRuntimeVersion": "0.1.0",
  "imgui": { "version": "pinned-release", "directInternalUse": [] },
  "toolchainSetId": "toolchain-...",
  "cppStandard": 20,
  "renderingTier": "portable",
  "testedNativeTarget": "windows-msvc-dx11",
  "viewport": { "width": 900, "height": 600, "dpiScale": 1.0 },
  "assets": [],
  "warnings": [],
  "verification": { "status": "passed", "report": "verification/report.json" }
}
```

Direct project includes of `imgui_internal.h`, backend assumptions, compile definitions, nonstandard ImGui flags, missing license metadata, and any known mismatch appear as prominent warnings. An enhanced-tier project is rejected by the MVP exporter with `UNSUPPORTED_RENDERING_TIER`; post-MVP exporters must name exact backend and shader requirements.

## 10. Native parity verification

When verification is enabled, the verifier uses the completed package—not the mutable Studio project—and performs:

1. Extract/copy into a clean temporary consumer directory.
2. Configure with the documented MSVC CMake preset.
3. Build the exported example with the pinned compatible Dear ImGui revision.
4. Load the same assets and sample state used by the selected browser build.
5. Replay approved scenarios at the same viewport, DPI, and deterministic timestamps.
6. Capture canonical RGBA8 images and state traces.
7. Compare widget geometry, font/icon/texture identity, traces, and approved image metrics.

Release acceptance requires no unexplained asset/color/font mismatch and at most two pixels of geometry difference at the benchmark configuration. Anti-aliasing differences may use a documented perceptual tolerance but cannot excuse layout displacement or missing content. Verification artifacts include logs, captures, diffs, environment identity, and a machine-readable report.

## 11. Failure behavior

- Digest mismatch: abort; mark selected build artifacts suspect; do not package working-tree replacements.
- Missing license for an asset marked `licenseRequired`: fail until resolved.
- Unsupported ImGui/internal dependency: fail in strict mode; warning and explicit confirmation only where the compatibility policy permits.
- Native configure/build failure: export may be retained only as `verification.status = failed`; it cannot be presented as verified.
- Parity failure: retain reports and captures; return `EXPORT_VERIFICATION_FAILED`.
- Destination collision: require a new destination or explicit replacement; replacement uses a backup-and-atomic-swap procedure, never in-place mutation.

## 12. Reproducibility and integrity

Files are written in stable path order with normalized metadata for zip output. `SHA256SUMS` covers every payload file except itself. The manifest records the packager version and all input digests. Given identical build artifacts and Studio release inputs, package payload bytes must be identical, excluding an explicitly documented outer archive timestamp if the platform cannot normalize it.

Consumers verify integrity with the packaged checksums. Studio verification always verifies them before building.

## 13. Implementation work

1. Define export graph and report schemas.
2. Persist dependency and content digests in successful build records.
3. Implement canonical-path allowlist traversal and link/reparse-point checks.
4. Implement staging, deterministic packaging, checksums, and atomic promotion.
5. Define the public state/event/assets headers and generated registrations.
6. Create CMake library and clean native consumer fixture.
7. Implement portability scan and report generation.
8. Build exported-package parity runner and reports.
9. Add deterministic directory output plus failure cleanup/recovery tests. Archive output follows
   as the PRD P1 packaging extension.

## 14. Acceptance criteria

- Export of any non-successful or digest-invalid build is rejected.
- Exporting build revision 42 after revision 43 exists produces revision-42 bytes and an explicit stale-source warning.
- Two exports of the same build have identical file inventories and payload digests.
- Traversal, absolute path, symlink/reparse escape, undeclared asset, and cache-file fixtures cannot enter a package.
- A clean checkout of the consumer fixture integrates with `add_subdirectory` and builds using packaged instructions only.
- The consumer changes state and receives callbacks without editing generated or runtime internals.
- Browser and exported-package native geometry differs by no more than two pixels for all required benchmark states.
- Font, icon, texture, theme, and deterministic animation traces have no unexplained mismatch.
- Portable output contains no WebGL, Emscripten, Studio service, or browser runtime dependency.
- All payload files are covered by checksums and the provenance report identifies their selected build.

## 15. Related documents

- Product requirements: `PRD.md`
- Architecture and build identity: `TECHNICAL_DESIGN.md`
- Delivery work packages WP6.1–WP6.3: `MVP_IMPLEMENTATION_PLAN.md`
- Validation matrix: `TEST_PLAN.md`
- Trust boundaries and export allowlists: `SECURITY_MODEL.md`
- Rendering-tier decision: `docs/adr/0005-portable-and-enhanced-rendering-tiers.md`
