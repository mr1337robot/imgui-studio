# Local Service Operations

## Start and stop

Use a Visual Studio developer PowerShell with the pinned Emscripten environment:

```powershell
. .\.tools\emsdk\emsdk_env.ps1
npm run studio
```

Open `http://127.0.0.1:4173`. Stop with `Ctrl+C`. The service owns the Studio/API/WebSocket listener
on port 4173 and authenticated preview artifacts on port 4174; startup fails rather than binding a
non-loopback or occupied listener.

The terminal prints the per-launch token once for agent clients. The browser receives it only in the
nonce-protected Studio bootstrap document. Tokens change on every restart and never belong in URLs.

## Project state and recovery

The default workspace is `examples/`. Disposable state is stored under the active project's
`.studio/` directory:

- `service-state.json` — revision history, last successful build, and preview identity.
- `builds/<buildId>/snapshot/` — immutable canonical inputs captured for that build.
- `builds/<buildId>/artifacts/` — smoke-passed preview HTML, loader, and WASM.
- `builds/<buildId>/build.json` — terminal status, diagnostics, timings, cache outcomes, and digests.

Deleting `.studio/` resets disposable history without deleting canonical source. On restart,
successful terminal records are loaded only when artifact digests still match. Partial/corrupt records
are not promoted. Stable compiler objects live under ignored `build/service/`; a digest mismatch
evicts the affected object and CMake rebuilds it.

## Logs and diagnostics

Build records expose bounded structured diagnostics through `build.get`. Authenticated raw logs are
available at `/api/v1/projects/{projectId}/builds/{buildId}/log`. Logs redact repository, profile,
toolchain-install, temporary, and system paths and never contain bearer tokens or environment dumps.

## Limits

Phase 2 permits one active project and one build at a time. Source reads are bounded per file;
requests, patches, file counts, discovery depth, raw logs, diagnostics, build duration, and
idempotency inputs have explicit ceilings. Cancellation kills the owned compiler process tree and
cannot promote partial artifacts.

## Troubleshooting

- **`emcmake` unavailable:** dot-source `.tools/emsdk/emsdk_env.ps1` before `npm run studio`.
- **`nmake.exe` unavailable:** start from a Visual Studio x64 developer PowerShell.
- **Port already in use:** stop the prior `npm run studio` or legacy renderer-test server.
- **Preview remains stale:** fix the displayed compiler diagnostic and build again. The old preview is
  retained intentionally.
- **Suspected cache corruption:** build again; the stable-object manifest evicts mismatched objects.
  `npm run clean` is the broader recovery option.

See `SECURITY_MODEL.md` and `AGENT_TOOL_API.md` for normative behavior.
