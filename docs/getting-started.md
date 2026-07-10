# Getting Started

This guide covers the Phase 0 foundation. A visual ImGui preview is introduced in Phase 1 and is
not yet part of the repository.

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
.\toolchain\emscripten\configure.ps1
```

The bootstrap is confined to `.tools/emsdk`, checks out the pinned emsdk commit, and activates
Emscripten 4.0.10. Loading `emsdk_env.ps1` affects only the current shell.

## 4. Explore the contracts

Start with `PRD.md`, `TECHNICAL_DESIGN.md`, and `MVP_IMPLEMENTATION_PLAN.md`. The executable v1
schemas live under `schemas/`; valid and invalid examples live under `tests/fixtures/schemas/`.
