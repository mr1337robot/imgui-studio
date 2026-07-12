# ImGui Studio — Agent Tool API

**Status:** v1 implementation contract  
**Version:** 1.0  
**Date:** July 9, 2026  
**Related:** `PRD.md`, `TECHNICAL_DESIGN.md`, `MVP_IMPLEMENTATION_PLAN.md`, `PROJECT_FORMAT.md`, `INSPECTION_PROTOCOL.md`

## 1. Purpose

This document defines the transport-neutral tools an AI agent uses for the complete ImGui Studio loop: discover, read, patch, build, load, reset, render, act, inspect, capture, compare, and export. The canonical implementation is HTTP JSON under `/api/v1`; an MCP adapter MUST remain a thin name/schema mapping over these operations.

The PRD's capability names map to the canonical v1 tools as follows. This table is normative for adapters and prevents two competing tool vocabularies:

| PRD capability | Canonical v1 tool |
|---|---|
| `project_get` | `project.get` |
| `source_read` | `source.read` |
| `source_patch` | `source.patch` |
| `build_preview` | `build.start`, followed by `preview.load` after success |
| `render_frame` | `preview.render` |
| `perform_action` | `preview.act` |
| `capture_animation` | `capture.start` |
| `inspect_widgets` | `inspect.frame` |
| `compare_reference` | `compare.create` |
| `reset_preview` | `preview.reset` |
| `export_project` | `export.start` |

An MCP adapter MAY expose the PRD underscore aliases for compatibility, but it MUST translate them to these canonical contracts without changing behavior or maintaining separate business logic.

## 2. Contract conventions

- JSON uses UTF-8 and camelCase. Unknown request fields are rejected.
- IDs are opaque strings and MUST NOT be parsed.
- UTC operation timestamps are ISO 8601. Preview/deterministic time is integer microseconds.
- Unsigned 64-bit revisions are decimal strings.
- Relative paths follow `PROJECT_FORMAT.md` and use `/`.
- Mutations require `Authorization: Bearer <per-launch-token>` and an `Idempotency-Key` UUID. Artifact reads require the token as well.
- Each HTTP request accepts `X-Request-Id`; the service generates one if absent.
- Clients SHOULD set `Accept: application/json`. Binary artifacts are fetched through authenticated artifact URLs returned in JSON.
- Successful creation returns `202` for long-running operations and `200`/`201` otherwise. Schema/concurrency/security errors use appropriate 4xx. Unexpected service faults use 500.

## 3. Canonical identity

Results concerning rendered or built state carry as much of this envelope as exists:

```json
{
  "identity": {
    "projectId": "prj_opaque",
    "currentProjectRevision": "43",
    "projectRevision": "42",
    "buildId": "bld_opaque",
    "previewInstanceId": "prv_opaque",
    "frameId": "frm_opaque",
    "stale": true
  }
}
```

- `currentProjectRevision`: mutable service head when the response was produced.
- `projectRevision`: immutable revision captured by the build/result.
- `buildId`: one immutable build attempt; only `succeeded` + smoke-passed builds load/export.
- `previewInstanceId`: one isolated runtime loaded from exactly one successful build.
- `frameId`: one completed render within that instance.
- `stale`: `currentProjectRevision != projectRevision`.

Clients MUST provide the expected identity on commands that could otherwise act on a replaced preview. A mismatch returns `PREVIEW_IDENTITY_MISMATCH`; the service never silently retargets.

## 4. Common error envelope

```json
{
  "error": {
    "code": "REVISION_CONFLICT",
    "message": "The project changed after this patch was prepared.",
    "retryable": true,
    "requestId": "req_opaque",
    "details": {
      "expectedRevision": "41",
      "currentRevision": "42"
    }
  }
}
```

Messages are human-readable but not stable. Agents branch on `code`. `details` is code-specific and never contains host absolute paths, tokens, source outside requested excerpts, or raw asset bytes.

Core codes:

| Code | Retryable | Meaning |
|---|---:|---|
| `INVALID_REQUEST` | no | schema/semantic failure |
| `UNSUPPORTED_VERSION` | no | API/project/protocol version unsupported |
| `UNAUTHORIZED` | no | token missing/invalid |
| `PROJECT_NOT_FOUND` | no | unknown/unavailable project |
| `PROJECT_INVALID` | no | project format validation failed |
| `PATH_OUTSIDE_PROJECT` | no | path confinement rejected |
| `FILE_NOT_FOUND` | no | requested canonical file absent |
| `REVISION_CONFLICT` | yes | expected revision is stale |
| `BUILD_ALREADY_RUNNING` | yes | concurrency policy rejected request |
| `BUILD_FAILED` | no | requested dependent operation needs a successful build |
| `BUILD_NOT_FOUND` | no | build unknown/expired |
| `PREVIEW_NOT_READY` | yes | preview is not ready |
| `PREVIEW_IDENTITY_MISMATCH` | yes | command names stale/replaced preview/build/revision |
| `PREVIEW_REVISION_MISMATCH` | no | strict freshness requested for stale build |
| `FRAME_NOT_FOUND` | no | frame absent/evicted |
| `TARGET_NOT_FOUND` | no | stable widget absent in exact frame |
| `TARGET_NOT_INTERACTABLE` | no | target exists but cannot receive action |
| `SCENARIO_INVALID` | no | scenario failed validation |
| `INSPECTION_FAILED` | yes | snapshot/query serialization failed |
| `CAPTURE_FAILED` | yes | deterministic capture failed |
| `REFERENCE_NOT_FOUND` | no | unknown reference ID |
| `ASSET_INVALID` | no | import/decode/limits failed |
| `EXPORT_REQUIRES_SUCCESSFUL_BUILD` | no | build not exportable |
| `OPERATION_NOT_FOUND` | no | async operation absent/expired |
| `OPERATION_CANCELLED` | no | terminal cancellation |
| `LIMIT_EXCEEDED` | no | configured resource/result cap exceeded |
| `INTERNAL_ERROR` | yes | unexpected service fault |

Compiler failures and runtime diagnostics are terminal operation records, not HTTP 500 errors.

## 5. Project and file tools

### 5.1 `projects.list`

`GET /api/v1/projects`

Returns confined discovered projects with `projectId`, `name`, `projectKey`, `currentRevision`, `valid`, and validation summary. It never returns arbitrary workspace contents.

### 5.2 `project.get`

`GET /api/v1/projects/{projectId}`

Returns validated manifest, current revision, file index, toolchain identity, active operations, `lastSuccessfulBuildId`, and current preview identities. File index entries contain relative path, byte size, SHA-256, media kind, and managed/user ownership.

### 5.3 `source.read`

`POST /api/v1/projects/{projectId}/files:read`

```json
{
  "paths": ["src/widgets/toggle.cpp", "include/menu.hpp"],
  "expectedRevision": "42",
  "includeContent": true,
  "maxBytesPerFile": 262144
}
```

Returns one ordered entry per path with `content`, `sha256`, `sizeBytes`, `mediaType`, and `revision`. `expectedRevision` is optional for read-only exploration; when supplied, mismatch fails the entire request. Binary assets return metadata only. Partial success is not permitted.

### 5.4 `source.patch`

`POST /api/v1/projects/{projectId}/files:patch`

```json
{
  "expectedRevision": "42",
  "patches": [
    {
      "path": "src/widgets/toggle.cpp",
      "expectedSha256": "sha256-before",
      "unifiedDiff": "@@ -20,1 +20,1 @@\n-old\n+new\n"
    }
  ],
  "reason": "Increase active toggle contrast"
}
```

All patches apply atomically or none do. Paths and preimage digests are mandatory. A patch may create a file only with `expectedSha256: null` and a diff from `/dev/null`; deletion requires `delete: true` plus preimage digest. The service validates UTF-8, path rules, managed-file policy, patch context, project schemas, and resulting project structure before commit.

Success returns `previousRevision`, `revision`, normalized `changedPaths`, and postimage digests. One request advances revision exactly once. No-op patch sets are rejected as `INVALID_REQUEST`.

### 5.5 `asset.import` and `reference.import`

`POST /api/v1/projects/{projectId}/assets:import` and `references:import` use bounded multipart upload plus a JSON declaration, `expectedRevision`, destination project-relative path, and idempotency key. The service verifies magic bytes, decodes under limits, copies atomically, updates the relevant manifest atomically, and advances revision once. URLs and external paths are forbidden.

## 6. Build tools

### 6.1 `build.start`

`POST /api/v1/projects/{projectId}/builds`

```json
{
  "expectedRevision": "43",
  "configuration": "preview-debug",
  "supersedeQueued": true
}
```

The service snapshots the resolved project inputs before returning:

```json
{
  "operationId": "op_opaque",
  "build": {
    "buildId": "bld_opaque",
    "projectId": "prj_opaque",
    "projectRevision": "43",
    "status": "queued",
    "configuration": "preview-debug"
  }
}
```

Statuses are `queued`, `running`, `succeeded`, `failed`, and `cancelled`. A succeeded build includes toolchain/configuration/source/asset digests, phase durations, cache outcomes, warnings, WASM artifact digests, and smoke result. A failed build includes structured diagnostics:

```json
{
  "severity": "error",
  "code": "C2065",
  "message": "identifier not found",
  "relativePath": "src/menu.cpp",
  "line": 84,
  "column": 9,
  "endLine": 84,
  "endColumn": 16,
  "excerpt": "bounded source excerpt",
  "buildId": "bld_opaque"
}
```

Failed/cancelled builds never replace `lastSuccessfulBuild` and never promote artifacts.

### 6.2 `build.get`

`GET /api/v1/projects/{projectId}/builds/{buildId}` returns the authoritative immutable/terminal record or current in-progress state. Raw logs are bounded, sanitized, and requested separately.

## 7. Preview tools

### 7.1 `preview.load`

`POST /api/v1/projects/{projectId}/previews`

```json
{
  "buildId": "bld_opaque",
  "mode": "deterministic",
  "strictCurrentRevision": false,
  "viewport": { "widthPx": 900, "heightPx": 600, "dpiScaleMilli": 1000 }
}
```

Only a successful, smoke-passed build may load. The response is an operation. Once ready, it returns identity, runtime protocol version, framebuffer/color-space configuration, and initial `frameId`. `strictCurrentRevision: true` rejects stale builds. Loading a new preview never mutates an existing preview.

### 7.2 `preview.reset`

`POST /api/v1/previews/{previewInstanceId}:reset`

```json
{
  "expected": { "buildId": "bld_opaque", "projectRevision": "43" },
  "resetKind": "clean",
  "timeUs": 0
}
```

Clean reset clears project sample state through its bridge, Studio animation storage, pending input, pointer/buttons/keys/text queue, ImGui focus/navigation/active state, popups, and clock. It renders a new frame at `timeUs` and returns its identity and state digest.

### 7.3 `preview.render`

`POST /api/v1/previews/{previewInstanceId}/frames`

```json
{
  "expected": { "buildId": "bld_opaque", "projectRevision": "43" },
  "timeUs": 250000,
  "capturePixels": true,
  "includeInspection": true,
  "overlay": null
}
```

In deterministic mode, `timeUs` is absolute and MUST be non-decreasing except after reset/seek. Frame execution order is defined in `TECHNICAL_DESIGN.md`. Success returns a new `frameId`, `frameIndex`, `timeUs`, computed `deltaUs`, state digest, inspection summary, runtime diagnostics, and optional PNG artifact descriptor.

A deterministic render is idempotent only after a clean reset and identical command sequence; repeating a command against already-advanced state intentionally creates another frame. Use capture for replayable batches.

### 7.4 `preview.act`

`POST /api/v1/previews/{previewInstanceId}/actions`

```json
{
  "expected": { "buildId": "bld_opaque", "projectRevision": "43", "frameId": "frm_before" },
  "atUs": 250000,
  "sequence": 1,
  "action": "click",
  "target": { "widgetId": "settings.enable" },
  "button": "left",
  "renderAfter": true,
  "capturePixels": true
}
```

Actions and targeting follow `PROJECT_FORMAT.md`. Widget targeting resolves only against the named `frameId`; target geometry is not silently taken from a newer frame. `renderAfter` returns the new frame identity. Failed target resolution consumes no input and advances no clock.

## 8. Inspection and capture tools

### 8.1 `inspect.frame`

`POST /api/v1/previews/{previewInstanceId}/inspection:query`

```json
{
  "expected": { "buildId": "bld_opaque", "projectRevision": "43", "frameId": "frm_opaque" },
  "filter": {
    "widgetIds": ["settings.enable"],
    "includeValues": true,
    "includeAnimations": true,
    "includeDiagnostics": true,
    "allowMissing": false
  }
}
```

Returns the stored snapshot/projection defined by `INSPECTION_PROTOCOL.md` without rendering or advancing time.

### 8.2 `capture.start`

`POST /api/v1/previews/{previewInstanceId}/captures`

```json
{
  "expected": { "buildId": "bld_opaque", "projectRevision": "43" },
  "scenario": { "path": "scenarios/settings.toggle-and-slide.scenario.json" },
  "includeFrames": true,
  "includeInspection": true,
  "includeNormalizedTrace": true
}
```

Exactly one of `scenario.path` or inline `scenario.document` is required. Capture obtains exclusive deterministic control of its preview, performs a clean reset, validates/schedules all steps, renders defined timestamps, and stops on first failure. Manual/realtime input cannot enter the capture.

Terminal success includes:

```json
{
  "captureId": "cap_opaque",
  "status": "succeeded",
  "identity": {
    "projectId": "prj_opaque",
    "projectRevision": "43",
    "buildId": "bld_opaque",
    "previewInstanceId": "prv_opaque"
  },
  "scenarioId": "settings.toggle-and-slide",
  "viewport": { "widthPx": 900, "heightPx": 600, "dpiScaleMilli": 1000 },
  "startUs": 0,
  "endUs": 1200000,
  "fps": 12,
  "frames": [
    { "frameId": "frm_opaque", "frameIndex": 0, "timeUs": 0, "imageArtifact": { "artifactId": "art_opaque", "sha256": "...", "mediaType": "image/png", "widthPx": 900, "heightPx": 600 } }
  ],
  "normalizedTraceSha256": "...",
  "diagnostics": []
}
```

Three captures from clean previews with identical inputs MUST have equal normalized trace bytes. Opaque IDs and wall-clock operation timestamps are excluded from the normalized trace.

## 9. Reference comparison tools

### 9.1 `compare.create`

`POST /api/v1/projects/{projectId}/comparisons`

```json
{
  "captureArtifactId": "art_preview_png",
  "referenceId": "target.desktop",
  "mode": "edgeDifference",
  "transform": {
    "translateMicroPx": [0, 0],
    "scaleMillionths": 1000000,
    "cropPx": null,
    "opacityMillionths": 500000
  }
}
```

Modes are `sideBySide`, `alphaOverlay`, `absoluteDifference`, and `edgeDifference`. The capture artifact MUST originate from this project/build and retain provenance. Results include derived authenticated image artifacts, exact transform, input digests, color-space handling, dimensions, and diagnostic numeric metrics. Metrics never imply automatic design approval.

## 10. Export tools

### 10.1 `export.start`

`POST /api/v1/projects/{projectId}/exports`

```json
{
  "buildId": "bld_opaque",
  "format": "directory",
  "outputName": "neon-settings",
  "verifyNativeParity": true,
  "confirmOlderRevision": true
}
```

The build must be successful, smoke-passed, artifact-digest-valid, and owned by the project. Export
always packages its immutable captured revision—not current working files. If the current revision
is newer, `confirmOlderRevision` MUST be true. `outputName` matches the project-key grammar. The MVP
implements deterministic directory packages; archive output remains the PRD P1 follow-up.

The terminal record includes export ID, source identity, package artifact/directory, file list with SHA-256, portability report, licenses, C++/toolchain/ImGui/runtime versions, rendering tier, direct `imgui_internal.h` findings, viewport/DPI parity configuration, and warnings. Packaging uses the allowlisted build graph and approved runtime subset; `.studio`, secrets, external paths, and undeclared files are excluded.

`GET /api/v1/projects/{projectId}/exports/{exportId}` returns the authoritative export record. A
verified record reports `verification.status = "passed"`, the maximum geometry difference in
pixels, and the project-relative verification report path.

## 11. Operations, events, and cancellation

`GET /api/v1/operations/{operationId}` returns authoritative operation state: `queued`, `running`, `succeeded`, `failed`, or `cancelled`, plus kind, progress millionths, phase, result/error, and identity.

`POST /api/v1/operations/{operationId}:cancel` is best effort and idempotent. It returns the current state; every accepted cancellation eventually reaches a terminal state. Cancelled builds/captures/exports do not promote partial artifacts.

WebSocket `/api/v1/events` emits sequence-numbered hints for revision, build, preview, capture, comparison, and export changes. Events may be duplicated or missed across reconnect. Clients resume with `afterSequence` when retained and always confirm terminal state through HTTP.

## 12. Concurrency and idempotency

- One canonical mutation and one running build are allowed per project.
- One deterministic capture controls a preview at a time.
- Realtime manual viewing and deterministic capture use separate preview instances.
- Revision checks protect canonical writes; identity checks protect preview commands.
- Repeating a mutation with the same idempotency key and identical body returns the original result. Reuse with a different body returns `INVALID_REQUEST`.
- A newer queued build may supersede an older queued build only when explicitly requested; running builds are cancelled separately.
- Export from immutable artifacts may proceed while later edits occur.

## 13. Security constraints

- The service binds to localhost by default and validates `Host`/origin according to its launch configuration.
- Mutation and artifact endpoints require the unpredictable per-launch token. Tokens never appear in URLs, logs, errors, exports, or WebSocket payloads.
- All paths are service-resolved and confined on every access, including symlink/reparse checks and import/export.
- Compiler processes use argument arrays, a sanitized environment, project-scoped working directory, bounded logs, and configured time/memory/output limits.
- Preview runs in a sandboxed iframe with restrictive CSP and no arbitrary DOM, network, origin storage, or filesystem access.
- Requests, patches, uploads, JSON depth, result sizes, screenshots, captures, and diagnostics are bounded.
- Artifact descriptors expose opaque authenticated IDs, not host filesystem locations.
- API responses redact absolute host paths and never return unrelated source or asset bytes.

## 14. Required end-to-end sequence

An agent that wants to edit a widget MUST:

1. `project.get` and retain current revision.
2. `source.read` requested files and retain SHA-256 preimages.
3. `source.patch` atomically with expected revision and digests.
4. `build.start`, then poll/subcribe until terminal.
5. On success, `preview.load` in deterministic mode.
6. `preview.reset` to time zero.
7. `preview.render` and `inspect.frame`.
8. `preview.act` or `capture.start` for states/animation.
9. `compare.create` when a reference is present.
10. Iterate from step 1 using the new revision.
11. `export.start` from the selected successful build.

A failed build leaves the previous successful preview usable but explicitly stale.

## 15. Required tests

- Generated HTTP and MCP schemas accept/reject the same fixtures.
- Every mutation rejects missing token, missing idempotency key, stale revision, stale digest, traversal, symlink escape, malformed UTF-8, and oversized input without partial writes.
- Two simultaneous valid patches yield exactly one success and one revision conflict.
- Failed/cancelled builds never change `lastSuccessfulBuild`; successful smoke-passed builds do.
- Preview commands reject replaced preview/build/frame identities and never silently retarget.
- Reset plus identical action/frame sequence yields identical normalized inspection trace three times.
- Missing, clipped, disabled, overlapped/modal-occluded, and valid widget targets yield exact expected action results.
- Capture failure reports scenario step/sequence and retains no promoted partial result.
- Duplicate WebSocket events do not cause duplicate mutations or incorrect terminal state.
- Export after later edits contains exactly selected build inputs and requires stale acknowledgement.
- Artifact endpoints cannot reveal filesystem paths or serve artifacts outside the caller's project/session authority.
- Service restart, preview crash, cache corruption, cancellation, and client reconnect preserve canonical data and immutable successful artifacts.

## 16. Acceptance criteria

The v1 API is accepted when:

1. An automated agent can complete read → atomic patch → build → load → reset → render → act → inspect → capture → compare → export using only documented tools.
2. Every visual or structured result is unambiguously attributable to revision/build/preview/frame identity.
3. Stale source, build, preview, frame, and patch attempts fail explicitly rather than acting on newer state.
4. Three clean deterministic captures have identical normalized traces.
5. Compiler/runtime failures are structured and leave the last successful preview/artifacts intact.
6. No API operation can escape the project root, interpolate a shell command, expose a token/host path, or export undeclared content.
7. The MCP adapter contains no independent project/build/preview business logic and passes the same contract suite as HTTP.
