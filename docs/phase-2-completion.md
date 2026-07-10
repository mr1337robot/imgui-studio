# Phase 2 Completion Record

Phase 2 is complete locally as of July 10, 2026. A one-file C++ edit now travels through canonical
revision, immutable snapshot, incremental Emscripten compilation, artifact validation, real Chromium
smoke initialization, and isolated preview replacement.

## Delivered vertical slice

- Bounded discovery opens `studio.project.json` projects beneath configured workspace roots without
  following directory links.
- The starter is a valid Studio project with explicit toolchain, source, viewport, asset, and
  reference manifests.
- The local TypeScript service binds two loopback origins, generates a 256-bit launch token, checks
  Host and Origin, requires bearer authentication plus mutation idempotency keys, and emits
  sequence-numbered WebSocket hints.
- Source reads validate fatal UTF-8 and return digests. Exact-context unified diffs require revision
  and SHA-256 preimages. Multi-file writes stage, promote, or roll back as one serialized transaction
  and advance revision once.
- Project paths reject absolute, drive, UNC/alternate separator, traversal, empty segment, and linked
  escapes. Canonical and disposable files remain separate.
- Builds snapshot canonical inputs before returning, execute a trusted PowerShell/CMake wrapper with
  argument arrays and an allowlisted environment, bound output/time, parse project-relative compiler
  diagnostics, and support process-tree cancellation.
- A stable CMake input path preserves Dear ImGui/backend objects across revisions. Stable objects have
  a digest manifest; corruption evicts the affected object. Asset input identity has an independent
  cached bundle descriptor and unchanged assets are reused.
- Successful preview HTML/loader/WASM files are copied into immutable per-build directories and
  digested. Chromium must initialize the exact artifact and render a WebGL2 frame before promotion.
- The Monaco client shows canonical files, saves revision-safe patches, builds, displays diagnostics
  and phase/cache timing, swaps only ready previews, and visibly marks a retained preview stale after
  a compiler failure.

## Gate evidence

The real toolchain integration performed four build attempts:

1. Cold successful build and Chromium smoke promotion.
2. Intentional `src/menu.cpp` syntax failure after corrupting a stable cache object.
3. Repaired one-file warm build and new preview instance promotion.
4. Cancellation reaching a terminal record without replacing the successful build.

The failure returned `src/menu.cpp:27:38`, code `COMPILER`, and `expected expression`. It preserved
the first build and preview while revision 1 remained editable. The repaired build promoted revision
2 under a different preview instance. Browser-visible logs contained no repository or user-profile
absolute path.

Measured on the local reference environment:

| Build                        | Compile/link worker |  Compile |     Link |  Smoke | Outcome       |
| ---------------------------- | ------------------: | -------: | -------: | -----: | ------------- |
| Cold initial                 |           10,332 ms | 5,063 ms | 3,188 ms | 339 ms | Succeeded     |
| Corrupt-cache + syntax error |            2,503 ms | 1,267 ms |        — |      — | Failed safely |
| Repaired warm one-file       |            4,680 ms | 1,613 ms | 1,978 ms | 337 ms | Succeeded     |

These are individual development-machine measurements, not the 30-sample release performance study.
The warm result is inside the release p95 target of six seconds but does not yet prove the median
three-second target. Further link/startup optimization remains release-level performance work, not a
Phase 2 correctness blocker.

## Verification

The following completed successfully:

```powershell
npm run test:ts
npm run typecheck
npm run lint
. .\.tools\emsdk\emsdk_env.ps1
npm run test:phase2
npm run test:studio
.\toolchain\emscripten\build-preview.ps1
npm run test:browser
```

`test:ts` covers 37 unit/HTTP cases, including simultaneous revision
conflicts, stale preimages, traversal, absolute/mixed paths, symlink escape, malformed UTF-8,
authentication, hostile origin, idempotent replay, and authenticated WebSocket revision events.

Generated evidence remains under ignored `out/phase2-integration/` and
`out/phase2-studio-test/` directories.

## External boundary

The checked-in GitHub Actions workflow runs Phase 2 on Windows with the pinned Emscripten, MSVC,
Node, Monaco, and Chromium versions. It cannot be reported as remotely passing until pushed and run.

## Phase 3 entry condition

Phase 3 may add the deterministic clock, reset lifecycle, widget property storage, action adapter,
scenario input, and filmstrip capture. It must preserve revision/build/preview identity, immutable
artifact promotion, last-known-good retention, and authenticated loopback boundaries established here.
