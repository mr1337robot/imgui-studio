# ImGui Studio — Security Model

**Status:** Implementation baseline  
**Version:** 1.0  
**Date:** July 9, 2026  
**Scope:** Local-first MVP

## 1. Purpose and security posture

ImGui Studio intentionally compiles user-authored C++ on the user's machine. The MVP is therefore a local developer tool, not a safe service for executing untrusted third-party code. Its security goals are to prevent accidental or agent-driven scope escape, protect local project and service state, isolate the browser preview, and make exports contain only intended inputs.

The MVP does **not** claim that the native Emscripten compiler process can safely compile malicious C++ in a multi-tenant setting. Users must treat opened Studio projects like code they would build locally. Hosted compilation is deferred until a separately audited operating-system isolation design exists.

## 2. Assets and trust levels

Protected assets:

- Files outside configured workspace/project roots.
- Other projects inside a workspace.
- Canonical project source, manifests, and asset metadata.
- Successful build artifacts, provenance, and export contents.
- Per-launch session token and local API operations.
- Parent Studio DOM, origin storage, cookies, and UI state.
- Local network and internet services reachable from browser or build processes.
- Host secrets in environment variables, command history, logs, and paths.
- Availability of Studio, build workers, browser, disk, and memory.

Trust levels:

| Actor/input | Trust |
|---|---|
| Studio release binaries/runtime templates | trusted after release integrity checks |
| Active user and explicitly configured workspace roots | trusted authority |
| Agent requests | authenticated but untrusted input; project-scoped only |
| Project C++ | locally authorized code, potentially buggy; not assumed safe for parent/browser |
| Imported images/fonts/SVG/manifests/scenarios | untrusted data |
| Preview WASM | untrusted relative to parent Studio and host |
| Compiler/linker output and diagnostics | untrusted text |
| Export destination/consumer app | outside Studio after explicit user choice |

## 3. Trust boundaries

```text
Browser top-level Studio origin
  | authenticated HTTP/WebSocket
  v
Local Studio service ----> canonical project filesystem
  | child process                 |
  v                               v
Build worker                artifact/export staging
  |
  v
Sandboxed preview origin/iframe (WASM + packaged assets)
```

The service is the sole authority for project writes, build promotion, artifact access, and exports. The web UI is not an authority merely because it runs on localhost. The preview is isolated from both the top-level origin and filesystem.

## 4. Threat scenarios

### 4.1 Project filesystem escape

An agent or manifest uses `..`, absolute paths, symlinks, junctions, reparse points, Unicode/case ambiguity, or a race to read/write/package files outside the active project.

### 4.2 Local API cross-site abuse

A malicious website reaches a localhost service, guesses endpoints, abuses permissive CORS/WebSockets, or reuses a leaked token to mutate/build/export a project.

### 4.3 Build command injection or secret exposure

User-controlled filenames/flags are interpolated into a shell, or the compiler inherits credentials, proxy settings, cloud tokens, PATH entries, or unrelated environment variables. Diagnostics leak absolute paths or secrets.

### 4.4 Preview escape

Buggy or hostile WASM accesses the parent DOM/storage, navigates the iframe, opens popups, performs network requests, sends forged protocol messages, or exhausts browser resources.

### 4.5 Malicious asset and schema input

Compressed images expand enormously; malformed SVG/font/image exploits a decoder; huge glyph ranges consume memory; recursive/oversized JSON or protocol messages exhaust CPU/memory.

### 4.6 Artifact/export confusion

A failed or stale build is presented as current, mutable files replace verified inputs, external/cache/secret files enter an export, or a destination is partially overwritten.

### 4.7 Denial of service and destructive failure

Infinite compile/render loops, process spawning, huge logs, disk exhaustion, preview crashes, or cancellation races corrupt canonical data or make the service unrecoverable.

## 5. Security requirements

### 5.1 Service listener and authentication

- Bind to loopback interfaces only by default; reject non-loopback startup binding in MVP configuration.
- Generate at least 128 bits of cryptographically random session-token entropy per service launch.
- Deliver the token through the trusted launch/bootstrap channel, never a URL query string.
- Require `Authorization: Bearer` for all mutations, builds, preview artifacts, captures, imported assets, exports, and WebSocket upgrade.
- Use constant-time token comparison where supported; reject missing, invalid, expired, and previous-launch tokens.
- Set narrow CORS to the exact Studio origin; never use wildcard origin with credentials.
- Validate `Origin` on HTTP mutation requests and WebSocket upgrades. Non-browser agent clients authenticate with the token and a documented client header.
- Do not expose directory listings or unauthenticated artifact URLs.
- Rate-limit authentication failures and expensive operations per session/project.

The token protects against opportunistic local cross-site access; it is not a substitute for OS user isolation against another process running as the same user.

### 5.2 Project discovery and path confinement

For every file operation:

1. Accept a project-relative logical path only; reject absolute, drive-relative, UNC, device, empty-segment, and NUL-containing paths.
2. Normalize separators and reject traversal segments before filesystem access.
3. Resolve the active project root once to an absolute canonical identity under an allowed workspace root.
4. Open/resolve the target and verify its final filesystem identity remains beneath that root using platform-aware, case-insensitive Windows comparison.
5. Reject symlinks, junctions, mount points, and other reparse points for mutation/export unless a future explicit policy safely resolves them.
6. Revalidate parent/target identity at write/rename time to limit time-of-check/time-of-use replacement.
7. Use handles and no-follow/reparse-aware operations where the platform permits.

Project IDs are opaque server mappings, not paths supplied by clients. Error responses expose logical relative paths only.

### 5.3 Canonical mutations

- Require `expectedRevision`; stale mutations fail before writing.
- Validate UTF-8 and bounded request/patch sizes.
- Write a new file in the same verified directory, flush as required, then atomically replace the target.
- Preserve the old file when validation, write, flush, or rename fails.
- Apply one mutation at a time per project and advance revision exactly once after successful promotion.
- Never allow agent tools to edit Studio runtime/toolchain files outside the active project.
- Destructive project deletion requires an explicit human UI action and is not part of the agent mutation API in MVP.

### 5.4 Build worker

- Invoke executables directly with argument arrays; never construct a shell command from project input.
- Executable paths and base compiler/linker flags come from the pinned release/toolchain, not project text.
- Allowlist project-configurable defines/include paths/options; reject linker response files, arbitrary post-build commands, plugins, and toolchain overrides in MVP.
- Set a project-scoped working directory and explicit temporary/build directories.
- Start from a minimal allowlisted environment. Exclude credentials, cloud tokens, SSH agents, user profile secrets, proxy credentials, and unrelated variables.
- Use absolute trusted toolchain paths and a controlled `PATH`.
- Bound process count, build concurrency, CPU time, wall time, memory where OS support exists, output bytes, artifact size, and disk usage.
- Kill the process tree on timeout/cancellation/service shutdown.
- Parse diagnostics as text data; escape them in HTML and redact canonical host/workspace paths and token-like values.
- Do not promote an artifact until compile, link, digest validation, and preview smoke initialization succeed.

Because compilation is native, authorized project C++ may influence compilation resource usage and compiler attack surface. Only open/build code from trusted sources in MVP.

### 5.5 Preview isolation

- Serve preview content from a distinct opaque or dedicated origin, not the Studio top-level origin.
- Use an iframe sandbox with only the minimum capability needed to execute scripts; do not grant same-origin with the parent, forms, top navigation, popups, downloads, pointer lock, or filesystem access.
- Apply a restrictive CSP. Default deny; permit only packaged script/WASM/image/font data required by the preview. Block `connect-src`, external navigation, frames, objects, workers, and form actions unless a reviewed implementation requires a narrower exception.
- Do not provide cookies, local/session storage authority, service workers, or parent DOM references.
- Use exact `postMessage` target/source validation, protocol version, preview instance ID, request ID, message type schema, and payload size limit.
- Ignore messages not originating from the expected Window object even if origin text matches.
- Preview assets enter only through the immutable built bundle or explicit bounded in-memory channel.
- Recreate the preview after crash/assertion/resource-limit breach. Never reuse its compromised state.
- Add browser-level tests proving `fetch`/WebSocket/navigation/storage/parent access are unavailable according to policy.

WASM is a browser isolation boundary, not proof that project logic is correct. The preview still needs frame-time, memory, draw-command, and message limits.

### 5.6 Asset and structured-input handling

- Allowlist manifest/scenario/reference/API schema versions and reject unknown required semantics.
- Bound JSON bytes, nesting depth, array lengths, string lengths, event counts, capture duration/fps, viewport dimensions, and protocol message rate.
- Check uploaded file bytes by content, not extension alone.
- Enforce per-file compressed size, decoded pixel dimensions, total decoded bytes, asset count, font bytes, glyph range/count, SVG complexity, and total project asset budget.
- Decode untrusted assets out of the service main process where practical; use maintained libraries and fail closed on parser errors.
- Disable SVG scripts, external resources, entities, animation, embedded foreign objects, and remote fonts/images; rasterize through a restricted pipeline.
- Generate asset identifiers from validated logical names/content; never use names as executable code or unescaped paths.
- Preserve supplied licenses as data and escape their display.

Exact numeric limits live in the release security configuration and are contract-tested. Raising them requires review.

### 5.7 Build artifacts and preview identity

- Successful build records are immutable and content-addressed/digested.
- Every artifact request is authenticated and checked against project/build ownership.
- Preview commands include project, build, revision, preview-instance, and protocol identity; mismatches fail closed.
- Cache entries are treated as untrusted until key and content digest verify.
- Failed/cancelled builds and smoke-failed artifacts cannot become `lastSuccessfulBuild`.

### 5.8 Export

- Export only from an explicitly selected immutable successful build.
- Construct an export graph; never recursively copy a project or build directory.
- Canonicalize and confine every source/asset/runtime input and reject links/reparse escapes.
- Exclude reference images unless marked distributable, caches, logs, VCS data, environment files, secrets, binaries, temporary data, and unrelated workspace content.
- Stage into a bounded temporary sibling directory; generate checksums; verify package inventory; atomically promote.
- Never follow archive paths on extraction; package entries use normalized relative paths and cannot collide by Windows case rules.
- Warn and require confirmation when exporting an older successful build than active source.
- Record all inputs, digests, versions, licenses, internal API usage, and rendering tier in `studio-export.json`.

See `EXPORT_AND_INTEGRATION.md` for the complete package contract.

### 5.9 Logs, diagnostics, telemetry, and privacy

- Structured logs include opaque IDs, operation, duration, outcome, and bounded diagnostic metadata.
- Never log session tokens, authorization headers, source contents, patches, asset bytes, full environment, or arbitrary compiler command lines containing user data.
- Redact absolute workspace/user-profile paths in client/API output.
- Escape all untrusted log/diagnostic content before UI rendering; do not use raw HTML.
- Rotate and bound local logs. Provide a clear delete action.
- Telemetry is off by default and leaves the machine only after explicit opt-in. Opt-in payloads exclude source, images, prompts, filenames, and asset contents unless separately and clearly authorized.

### 5.10 Dependencies and release integrity

- Pin toolchain and package dependency versions; verify download hashes/signatures where available.
- Generate a dependency inventory/SBOM and preserve licenses.
- Scan dependencies and release artifacts for known vulnerabilities and secrets.
- Changes to compiler, asset decoders, preview sandbox/CSP, authentication, path logic, or archive library require security-sensitive review.
- Release manifests identify exact binaries and source revisions used.

## 6. Resource limits and availability

The service enforces configurable ceilings for:

- One active build and one deterministic capture per project.
- Queue length and supersession behavior.
- Build/capture/export wall time.
- Child process count and output bytes.
- Project, cache, artifact, export, and temporary-disk budgets.
- Preview WASM memory, framebuffer dimensions, frame duration, draw vertices/indices/commands, inspection entries, and diagnostics per frame.
- Scenario steps, timestamp span, fps, and filmstrip frame count.

On breach, terminate the scoped operation, return a stable error, retain the prior successful preview/artifacts, and clean or quarantine partial data. Resource-limit errors must not crash the service.

## 7. Secure failure and recovery behavior

- Deny on validation/auth/path uncertainty.
- Do not reveal whether external paths exist.
- Preserve prior canonical files and `lastSuccessfulBuild` on failure.
- On service restart, reconcile operation journals: immutable completed artifacts remain; incomplete staging is removed or quarantined.
- Token changes every launch, invalidating stale clients.
- Preview crash affects only its iframe/instance.
- Build worker cancellation kills descendants and cannot promote output.
- Export destination replacement is atomic with recoverable backup semantics.

## 8. Explicit non-goals and residual risk

- Protection from malicious code intentionally opened and compiled by the same OS user.
- Protection from another process with the same user's privileges reading local memory or token bootstrap data.
- Safe cloud/multi-tenant native compilation.
- Supporting arbitrary project build scripts, compiler plugins, post-build commands, or network dependency fetching.
- Guaranteeing that exported C++ is safe for the consumer application.

The UI and documentation must state: **Opening and building a Studio project executes a local C++ toolchain; review projects from untrusted sources before building.**

## 9. Verification matrix

| Control | Mandatory evidence |
|---|---|
| Loopback/auth/CORS | hostile-origin browser tests; wrong/missing/stale token tests |
| Path confinement | traversal, case, Unicode, symlink/junction/reparse and race fixtures |
| Atomic revision writes | fault injection at validate/write/flush/rename/ack stages |
| Build invocation | argument-injection fixtures; environment snapshot allowlist; process-tree cancellation |
| Preview isolation | CSP/sandbox tests for DOM, storage, network, navigation, message forgery |
| Asset handling | malformed corpus, decompression/dimension/glyph/SVG complexity limits |
| Artifact identity | digest corruption, stale identity, cross-project request tests |
| Export | external/secret/cache inclusion attacks; archive collision/traversal; checksum validation |
| Redaction/privacy | token/path/source/log and opt-in telemetry tests |
| Recovery | crash/cancel/disk-full/corrupt-cache/partial-export tests |

Fuzz schema, protocol, path, asset metadata, and archive entry handling. Parser crashes, hangs, and uncontrolled allocation are release-blocking until understood and fixed or the format is disabled.

## 10. Security acceptance criteria

- The service is unreachable from non-loopback interfaces under default configuration.
- No mutation, artifact, capture, or export succeeds without the current per-launch token.
- Hostile web origins cannot use the authenticated API or WebSocket channel.
- All tested traversal, symlink/junction/reparse, case, Unicode, and race escapes fail without external file disclosure or mutation.
- No project-controlled text is executed through a shell command.
- Build workers receive only the documented environment allowlist and are terminated with descendants on cancellation/timeout.
- Preview code cannot access parent DOM/storage, arbitrary network, filesystem, navigation, or undocumented protocol operations.
- Malformed/oversized assets and structured inputs fail within resource ceilings.
- Failed/cancelled/smoke-failed artifacts cannot replace the prior successful build.
- Export inventory is allowlisted, checksummed, provenance-bound, and contains no seeded secret/external fixture.
- Logs and telemetry tests reveal no token, source, asset bytes, full host path, or secret environment value.
- No unresolved critical security issue remains at MVP release.

## 11. Future hosted-build prerequisite

Before any hosted or multi-tenant offering, create a separate design covering hardware/VM or hardened container isolation, unprivileged ephemeral workers, read-only toolchain images, no host mounts, network denial, syscall policy, resource quotas, artifact scanning, tenant identity, abuse controls, compiler supply chain, incident response, and independent security audit. The local MVP controls in this document are insufficient for that use case.

## 12. Related documents

- Product security requirements: `PRD.md`
- Architectural enforcement points: `TECHNICAL_DESIGN.md`
- Reliability/security work package WP7.3: `MVP_IMPLEMENTATION_PLAN.md`
- Export allowlist and provenance: `EXPORT_AND_INTEGRATION.md`
- Required negative tests: `TEST_PLAN.md`
