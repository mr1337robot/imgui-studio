# ImGui Studio — Project Format

**Status:** v1 implementation contract  
**Version:** 1.0  
**Date:** July 9, 2026  
**Related:** `PRD.md`, `TECHNICAL_DESIGN.md`, `MVP_IMPLEMENTATION_PLAN.md`, `AGENT_TOOL_API.md`, `INSPECTION_PROTOCOL.md`

## 1. Purpose

This document defines the portable, version-controlled ImGui Studio project format. A project is an ordinary directory whose canonical root contains `studio.project.json`. User-authored C++ is the design source of truth; the format does not introduce a layout DSL.

The v1 format supports one pinned toolchain, portable rendering, deterministic scenarios, project-owned assets, references, and exact-source export.

## 2. Normative language and encoding

`MUST`, `MUST NOT`, `SHOULD`, and `MAY` are normative. JSON files MUST be UTF-8 without a byte-order mark, use camelCase keys, and reject duplicate object keys. Unknown keys are rejected unless a schema explicitly permits them.

All project paths:

- are relative to the canonical project root;
- use `/` separators, even on Windows;
- MUST NOT be empty, absolute, contain `.` or `..` segments, a drive prefix, NUL, or encoded separators;
- are compared after Unicode NFC normalization and platform-appropriate case handling;
- MUST resolve, after following existing symlinks/reparse points, inside the project root.

The service, not the client, performs final canonical-path confinement.

## 3. Required layout

```text
project-root/
  studio.project.json            required manifest
  CMakeLists.txt                  required shared project target
  include/                        public/project headers
  src/                            project bridge, menus, widgets, theme
  assets/
    assets.json                   required asset declarations, may be empty
    fonts/
    textures/
    icons/
    licenses/
  scenarios/                      deterministic *.scenario.json files
  references/
    references.json               reference metadata, may be empty
    images/
  README.md                       project notes/integration intent
```

Optional directories are `tests/` and `docs/`. Studio-generated build products MUST NOT be written here. `.studio/` is reserved for local, disposable state and MUST be ignored by version control:

```text
.studio/
  cache/
  builds/
  captures/
  exports/
  locks/
```

Deleting `.studio/` MUST NOT destroy canonical project content.

## 4. Ownership

| Path | Owner | Mutation rule |
|---|---|---|
| `studio.project.json` | user/Studio | schema-validated, revision-checked |
| `src/**`, `include/**`, `CMakeLists.txt` | user/agent | never wholesale-regenerated |
| `assets/**`, `references/**`, `scenarios/**` | user/agent/Studio import | manifest-validated, revision-checked |
| `src/studio_managed_theme.*` | Studio only when declared in `managedFiles` | property editor may replace atomically |
| `.studio/**` | Studio | disposable; never exported as source |
| exported `generated/**` | exporter | created only in export output |

Studio MUST preserve unrelated user changes. An agent patch may touch only explicitly listed paths.

## 5. Project manifest

`studio.project.json` v1:

```json
{
  "schemaVersion": 1,
  "name": "neon-settings",
  "projectKey": "neon-settings",
  "renderingTier": "portable",
  "language": { "cppStandard": 20 },
  "toolchain": {
    "versionSet": "studio-0.1.0-win-x64",
    "imguiVersion": "1.92.1",
    "emscriptenVersion": "4.0.10",
    "studioRuntimeVersion": "0.1.0"
  },
  "entryPoint": {
    "initialize": "project::Initialize",
    "resetSampleState": "project::ResetSampleState",
    "render": "project::Render",
    "shutdown": "project::Shutdown"
  },
  "sources": ["src/**/*.cpp"],
  "includeDirectories": ["include", "src"],
  "defines": [],
  "viewport": {
    "widthPx": 900,
    "heightPx": 600,
    "dpiScaleMilli": 1000,
    "clearColorRgba8": [9, 11, 18, 255]
  },
  "assetsManifest": "assets/assets.json",
  "referencesManifest": "references/references.json",
  "scenarioGlobs": ["scenarios/*.scenario.json"],
  "managedFiles": ["src/studio_managed_theme.cpp"],
  "export": {
    "publicHeaders": ["include/**/*.hpp"],
    "sourceGlobs": ["src/**/*.cpp", "src/**/*.hpp"],
    "licenseGlobs": ["assets/licenses/**", "LICENSE*"]
  }
}
```

### 5.1 Manifest rules

- `schemaVersion` MUST equal `1`.
- `name` is 1–80 Unicode characters; `projectKey` matches `^[a-z][a-z0-9-]{0,62}$` and is stable across renames.
- `renderingTier` MUST be `portable` in the MVP. `enhanced` is reserved and rejected as unsupported.
- Version strings MUST exactly match the installed release version set; ranges and `latest` are forbidden.
- `widthPx` and `heightPx` are integers in `[64, 8192]`; total pixels are subject to service limits.
- `dpiScaleMilli` is an integer in `[500, 4000]`; `1000` means 1.0.
- Glob expansion is deterministic: normalized paths, lexicographic byte order, no symlink escape.
- Source inputs MUST resolve to regular files. A duplicate expansion is de-duplicated, preserving first declaration order.
- Compiler/linker flags are intentionally absent in v1. Arbitrary flags require an ADR and schema revision.

## 6. Project bridge

Both browser and native targets compile the same project sources and call:

```cpp
namespace project {
void Initialize(studio::ProjectContext&);
void ResetSampleState(studio::ProjectContext&);
void Render(studio::ProjectContext&);
void Shutdown(studio::ProjectContext&);
}
```

The bridge MUST be backend-agnostic. Browser-only or Win32/DX11 types MUST NOT enter user widget/menu source. `ResetSampleState` MUST reset all project sample state; Studio separately resets ImGui, input, focus, clock, and animation storage.

## 7. Asset manifest

`assets/assets.json`:

```json
{
  "schemaVersion": 1,
  "assets": [
    {
      "id": "brand.logo",
      "kind": "texture",
      "source": "assets/textures/logo.webp",
      "colorSpace": "srgb",
      "licenseFiles": ["assets/licenses/brand.txt"]
    },
    {
      "id": "font.ui.regular",
      "kind": "font",
      "source": "assets/fonts/Inter-Regular.ttf",
      "sizeMilliPx": 16000,
      "glyphRanges": ["latin-basic"],
      "oversampleH": 2,
      "oversampleV": 2,
      "mergeInto": null,
      "licenseFiles": ["assets/licenses/inter.txt"]
    },
    {
      "id": "icon.settings",
      "kind": "svgIcon",
      "source": "assets/icons/settings.svg",
      "rasterSizesPx": [16, 24, 32],
      "licenseFiles": []
    }
  ]
}
```

Asset IDs match `^[a-z][a-z0-9]*(\.[a-z][a-z0-9-]*)+$`, are unique, and are the stable C++ lookup identity. Array order is significant for font merge order. Font floating values are stored as integer milli-pixels. Supported raster inputs are PNG, JPEG, and WebP; SVG is decoded/rasterized by the pinned pipeline. The service enforces configured encoded-size, decoded-dimension, asset-count, and total-memory limits.

Generated atlases and rasterized icons are build artifacts keyed by the manifest and source-byte digests. They MUST NOT become canonical project files.

## 8. Reference manifest

`references/references.json`:

```json
{
  "schemaVersion": 1,
  "references": [
    {
      "id": "target.desktop",
      "source": "references/images/target.png",
      "transform": {
        "translateMicroPx": [0, 0],
        "scaleMillionths": 1000000,
        "cropPx": null,
        "opacityMillionths": 500000
      },
      "annotations": [
        { "kind": "excludePresentationEffect", "rectPx": [0, 0, 900, 80], "note": "thumbnail bloom" }
      ]
    }
  ]
}
```

Transforms are non-destructive and integer-valued. `cropPx` is `[x, y, width, height]`. Annotation kinds in v1 are `menuRegion`, `excludePresentationEffect`, and `note`. Import copies bytes into `references/images/`; references to external files or URLs are forbidden.

## 9. Scenario format

A `*.scenario.json` file contains one deterministic scenario:

```json
{
  "schemaVersion": 1,
  "id": "settings.toggle-and-slide",
  "name": "Toggle and slide",
  "reset": "clean",
  "viewport": { "widthPx": 900, "heightPx": 600, "dpiScaleMilli": 1000 },
  "steps": [
    { "sequence": 0, "atUs": 100000, "action": "move", "target": { "widgetId": "settings.enable" } },
    { "sequence": 1, "atUs": 250000, "action": "click", "target": { "widgetId": "settings.enable" }, "button": "left" },
    { "sequence": 2, "atUs": 700000, "action": "drag", "target": { "widgetId": "settings.intensity" }, "toNormalized": [750000, 500000], "durationUs": 200000 }
  ],
  "capture": { "startUs": 0, "endUs": 1200000, "fps": 12, "includeInspection": true }
}
```

Rules:

- Scenario IDs use the asset-ID grammar and are unique across expanded scenario globs.
- `reset` MUST be `clean` for captures and tests.
- `atUs` is a non-negative safe JSON integer. Steps are ordered by `(atUs, sequence)`; `sequence` values are unique.
- Actions are `move`, `pointerDown`, `pointerUp`, `click`, `drag`, `scroll`, `keyDown`, `keyUp`, and `textInput`.
- Targets contain exactly one of `widgetId` or `pointMicroPx`. Widget targeting uses the current frame's registered hitbox center unless action-specific coordinates are supplied.
- `toNormalized` is millionths within the target hitbox. Raw positions use integer micro-pixels.
- A click expands deterministically to move, down, and up using runtime-defined zero-delay sub-sequences. A drag samples at the capture/frame cadence plus exact endpoints.
- Key values use stable USB HID names; text is Unicode scalar text, not synthetic key events.
- `fps` is an integer `[1, 120]`. Frame timestamps are `startUs + floor(i * 1000000 / fps)` while not exceeding `endUs`; `endUs` is additionally captured if absent from that sequence.
- The first failure stops execution and reports step index, sequence, and identity.

## 10. Revision and content identity

The on-disk format does not store runtime IDs. When opened, the service assigns an opaque `projectId` and maintains a monotonic unsigned 64-bit `revision`, serialized to JSON as a decimal string. Every successful atomic canonical mutation increments revision exactly once, even if it changes multiple files. Failed or no-op mutations do not increment it.

A revision record includes normalized changed paths and SHA-256 digests. Builds capture a complete resolved input manifest. `buildId` identifies an immutable build attempt; only a `succeeded` build with a passing smoke frame can create a preview or export. `previewInstanceId` identifies one runtime process/module loaded from one successful build. `frameId` identifies one rendered frame within that preview.

The canonical identity tuple is defined in `AGENT_TOOL_API.md`. A preview is stale when its `projectRevision` differs from the current project revision; staleness does not invalidate inspection of that preview but MUST be explicit.

## 11. Validation and migration

Opening proceeds in this order:

1. Canonicalize and confine the project root.
2. Decode and schema-validate the manifest.
3. Verify the exact toolchain version set.
4. Resolve and confine all declared paths/globs.
5. Validate asset, reference, and scenario manifests.
6. Check ID uniqueness and CMake/bridge presence.
7. Compute digests and open revision tracking.

Validation failure does not mutate the project. Errors include a normalized relative path and JSON Pointer where applicable.

v1 performs no implicit migration. A future migration MUST create a backup or new directory, emit a change report, preserve user source byte-for-byte unless explicitly transformed, and require confirmation before replacing canonical files.

## 12. Security constraints

- Project data MUST NOT name external paths, URLs, command lines, environment variables, executable hooks, or arbitrary compiler flags.
- Source compilation is local and uses a sanitized environment and argument-array process invocation.
- Symlink/reparse-point escape is rejected on every read, write, import, glob expansion, and export—not only at project open.
- Imports copy allowed bytes into canonical project paths after type and size validation.
- Secrets, bearer tokens, host absolute paths, `.studio/`, and unrelated workspace files MUST NOT enter build metadata or exports.
- Export inputs are an allowlisted graph captured from an immutable successful build.

## 13. Required tests

- Valid starter and empty manifests round-trip through schema-generated types.
- Duplicate keys, unknown fields, malformed UTF-8, unsupported versions, duplicate IDs, invalid integer ranges, and ambiguous globs fail at exact fields.
- Windows drive, UNC, absolute, traversal, alternate separator, case-collision, symlink, junction, and time-of-check/time-of-use escape fixtures fail safely.
- A multi-file mutation advances revision once; stale and no-op mutations preserve files and revision.
- Asset output and scenario scheduling are byte/state deterministic on two clean machines using the pinned version set.
- Glob expansion order is stable.
- Deleting `.studio/` and reopening reconstructs disposable state without changing canonical bytes.
- Export contains exactly the selected build input graph and approved runtime files.

## 14. Acceptance criteria

The v1 format is accepted when:

1. A clean starter validates and compiles unchanged for browser and Windows native targets.
2. All canonical files can be version controlled; all generated state is isolated.
3. Every project mutation, build, preview, capture, inspection, and export is attributable to the identity model.
4. Identical clean scenario runs use identical timestamps, ordered inputs, asset bytes, and state traces.
5. No declared/imported path can escape the project root.
6. The exact source/assets represented by a successful build can be exported after later working-tree edits.

