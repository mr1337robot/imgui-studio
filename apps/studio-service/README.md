# Studio Local Service

The service is the canonical authority for projects, revisions, builds, isolated preview instances,
stored frames, captures, references, comparisons, artifacts, and last-known-good identity. The
browser is a client; it never writes project files or invokes CMake directly.

## Public entry point

Run from a Visual Studio developer PowerShell with the pinned Emscripten environment loaded:

```powershell
. .\.tools\emsdk\emsdk_env.ps1
npm run studio
```

The service binds `127.0.0.1:4173` for Studio/API/WebSocket traffic and `127.0.0.1:4174` for the
authenticated preview origin. It discovers the starter under `examples/` by default.

## Module responsibilities

- `project-discovery.ts` performs bounded traversal without following directory links.
- `project-service.ts` owns manifest validation, indexing, revisions, immutable snapshots, and
  atomic multi-file transactions.
- `asset-manifest-validator.ts` validates declared logical asset IDs, attribution, bounded source
  bytes, SVG safety, raster/font signatures, and path confinement before immutable snapshotting.
- `filesystem.ts` owns protocol paths, UTF-8 decoding, confinement, and atomic state writes.
- `unified-diff.ts` applies exact-context patches without fuzzy retargeting.
- `build-coordinator.ts` owns build state, cancellation, sanitized processes, bounded logs,
  diagnostics, cache integrity, artifacts, smoke testing, and preview promotion.
- `preview-coordinator.ts` owns Chromium instances, deterministic time, exact-frame targeting,
  stored inspection snapshots, capture artifacts, retention, and teardown.
- `comparison-service.ts` validates bounded PNG/JPEG/WebP references and produces transformed
  side-by-side, overlay, absolute-difference, and edge-difference artifacts.
- `export-service.ts` resolves immutable successful-build inputs, assembles allowlisted packages,
  writes provenance/checksums, builds the clean native consumer, and verifies browser/native parity.
- `http-server.ts` owns authentication, idempotency, Host/origin checks, API envelopes, WebSocket
  hints, Studio delivery, and the authenticated preview origin.

Business logic remains below HTTP; `apps/agent-adapter` is only a protocol mapping over it.

## Lifecycle and recovery

Canonical mutations are serialized, staged beside their targets, and either promoted completely or
rolled back. Revisions and terminal build records live under ignored `.studio/`. Successful artifacts
are immutable and digest-checked after restart. Incomplete or corrupt records are never successful.

One build runs per project. Cancellation terminates its process tree. Promotion occurs only after
compile, link, artifact validation, and a real Chromium initialization smoke frame. Until then, the
previous preview remains authoritative. Asset validation runs immediately before snapshot creation,
so an invalid asset graph fails without replacing the last known-good preview.

## Security and limits

Each launch generates a 256-bit token. Mutations require bearer authentication and a UUID v4
idempotency key. Browser mutations also require the exact Studio origin; agent clients send
`X-Studio-Client: agent-v1`. Preview artifacts use an HttpOnly same-site cookie issued only after
authenticated authorization.

Paths reject traversal, absolute/alternate forms, and links on every access. Compiler invocation
uses argument arrays and an allowlisted environment. Requests, patches, files, logs, diagnostics,
discovery, assets, and builds are bounded.

Opening and building a project executes a local C++ toolchain. Review untrusted projects first.

## Verification

```powershell
npm run test:ts
. .\.tools\emsdk\emsdk_env.ps1
npm run test:phase2
npm run test:studio
```

See `AGENT_TOOL_API.md`, `PROJECT_FORMAT.md`, `SECURITY_MODEL.md`, and `TEST_PLAN.md` for contracts.
