# Phase 1 Completion Record

Phase 1 is complete locally as of July 10, 2026. The implementation passes the browser/native
rendering-spine gate with the same custom widget source compiled into both targets.

## Delivered vertical slice

- `examples/starter` provides a backend-neutral C++20 menu with one custom animated toggle. The
  visible control uses `InvisibleButton` for interaction and `ImDrawList` for all rendering; it
  does not call `ImGui::Checkbox`.
- `runtime/browser` compiles Dear ImGui, GLFW/OpenGL3, and the starter target through Emscripten
  4.0.10 to WebAssembly/WebGL2. The preview runs on a dedicated loopback origin inside the Studio
  shell's sandboxed iframe.
- `runtime/native` renders the identical starter target through Win32/DirectX 11 and captures the
  final texture through a staging resource and Windows Imaging Component.
- Both capture records include the SHA-256 identity derived from the shared starter implementation
  and public header, fixed viewport/framebuffer provenance, and structured toggle geometry.
- `scripts/compare-captures.mjs` writes a versioned JSON report and PNG difference. Source identity,
  framebuffer dimensions, and the two-pixel geometry tolerance are gates. Pixel difference and
  weighted-YIQ perceptual similarity are diagnostic.
- The Studio shell, preview protocol, Chromium test, capture schemas, valid/invalid fixtures, and
  positive/negative parity lanes are integrated into CI.

## Verified gate evidence

The canonical browser and native captures were both 900 x 600. Their shared-source SHA-256 was
`40295d4a756cfc0b6d3f6dab393e5ccfaf5cd95e9fed0d2d56daff760a28f3e0`.

| Measurement                      |           Result |       Gate |
| -------------------------------- | ---------------: | ---------: |
| Toggle x difference              |             0 px |    <= 2 px |
| Toggle y difference              |             0 px |    <= 2 px |
| Toggle width difference          |             0 px |    <= 2 px |
| Toggle height difference         |             0 px |    <= 2 px |
| Canonical changed pixels         | 20,626 / 540,000 | Diagnostic |
| Canonical changed-pixel ratio    |         0.038196 | Diagnostic |
| Mean absolute channel difference |         0.016307 | Diagnostic |
| Weighted-YIQ similarity          |         0.999917 | Diagnostic |

The deliberately shifted native fixture moved the toggle by 8 px. The comparison report rejected
it against the two-pixel limit while confirming that it still used the identical shared source.

## Commands executed

The following commands completed successfully on the pinned Windows toolchain:

```powershell
npm run schemas:generate
npm run test:ts
npm run format:cpp:check
. .\.tools\emsdk\emsdk_env.ps1
.\toolchain\emscripten\build-preview.ps1
npm run test:cpp
npm run test:browser
.\toolchain\capture-native.ps1
npm run compare:captures
node scripts/compare-captures.mjs --native-image out/captures/native-shifted.png `
  --native-metadata out/captures/native-shifted.metadata.json `
  --report out/comparison/phase1-shifted.report.json `
  --difference out/comparison/phase1-shifted.difference.png --expect-failure
```

The final repository-wide `npm run validate` result is recorded in the implementation handoff.
Generated captures and comparison artifacts remain in ignored `out/` directories.

## External boundary

The GitHub Actions workflow contains separate native, WASM browser, and cross-job parity gates.
It cannot be reported as passing until this change is pushed and the first remote workflow run
completes. This does not weaken the local Phase 1 acceptance result.

## Phase 2 entry condition

Phase 2 may build the revision-safe local project service and edit/build loop on this rendering
spine. It must preserve immutable successful artifacts, the last known-good preview, source
identity, loopback security, and the shared-source browser/native contract.
