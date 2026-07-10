# Getting Started

This guide reaches the Phase 1 real Dear ImGui browser preview and Windows native parity capture.

## 1. Install the native toolchain

Install the exact versions recorded in `toolchain/toolchain.json`, then open a Visual Studio 2022
developer PowerShell so `cl.exe` is available.

```powershell
npm ci
npm run verify:toolchain
```

The verifier prints every detected and expected version with an actionable remediation for a
mismatch.

## 2. Run the native foundation

```powershell
npm run validate
```

This validates generated schema types, dependency licenses, formatting, linting, TypeScript,
schema fixtures, and the C++20 CTest foundation.

## 3. Install browser tooling

```powershell
.\toolchain\bootstrap-emscripten.ps1
. .\.tools\emsdk\emsdk_env.ps1
node .\scripts\verify-toolchain.mjs --profile wasm
.\toolchain\emscripten\build-preview.ps1
```

The bootstrap is confined to `.tools/emsdk`, checks out the pinned emsdk commit, and activates
Emscripten 4.0.10. Loading `emsdk_env.ps1` affects only the current shell.

## 4. Run the browser preview

In the Emscripten-enabled shell, start the two loopback origins:

```powershell
npm run preview:serve
```

Open `http://127.0.0.1:4173`, or run `npm run test:browser` in a second shell to automate the
Chromium interaction, animation, isolation, and capture checks. The browser capture is written to
`out/captures/browser.png`.

## 5. Capture and compare Windows parity

Open the live native preview for manual interaction:

```powershell
.\toolchain\run-native.ps1
```

Close its window when finished. This interactive mode presents continuously and does not overwrite
canonical captures. To exercise the deterministic capture-and-exit path instead, run:

```powershell
.\toolchain\capture-native.ps1
npm run compare:captures
```

The report and PNG difference are written under `out/comparison/`. The gate requires equal
900 x 600 dimensions, identical shared-source hashes, and at most two pixels of geometry
difference. Pixel and perceptual similarity values are diagnostic.

## 6. Explore the contracts

Start with `PRD.md`, `TECHNICAL_DESIGN.md`, and `MVP_IMPLEMENTATION_PLAN.md`. The executable v1
schemas live under `schemas/`; valid and invalid examples live under `tests/fixtures/schemas/`.
