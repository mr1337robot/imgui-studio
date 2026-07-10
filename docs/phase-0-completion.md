# Phase 0 Completion Evidence

**Status:** Implementation complete  
**Completed:** July 10, 2026  
**Gate:** G0 reproducible foundation

## Delivered

- Repository structure from `TECHNICAL_DESIGN.md`, with documented ownership boundaries.
- Strict TypeScript 6, ESLint, Prettier, C++20, CMake, CTest, clang-format, and clang-tidy configuration.
- Exact native and browser toolchain version set in `toolchain/toolchain.json`.
- Repository-local, path-confined bootstrap and immutable Git pins for Dear ImGui and Emscripten.
- CMake presets and one shared C++20 foundation target compiled by MSVC and Emscripten.
- Seven versioned v1 product schemas and generated TypeScript contract modules.
- Seven valid and seven invalid schema fixtures with strict Ajv 2020 tests.
- Reproducible npm lockfile, automated dependency-license inventory, and third-party notices.
- Windows native and Ubuntu Emscripten CI lanes with pinned GitHub Action commits.
- Root, contributor, development, architecture, toolchain, and subsystem documentation.

## Verified environment

| Tool              | Verified version                                    |
| ----------------- | --------------------------------------------------- |
| Node.js           | 24.12.0                                             |
| npm               | 11.6.2                                              |
| CMake             | 4.3.2                                               |
| Git               | 2.53.0                                              |
| MSVC              | 19.44.35223                                         |
| clang-format      | 19.1.5                                              |
| Emscripten        | 4.0.10                                              |
| Dear ImGui source | 1.92.1 / `5d4126876bc10396d4c6511853ff10964414c776` |
| emsdk source      | `62a853cd3b3134398ce85cde8bb5cbb2ef0194cb`          |

## Local verification results

The following checks completed successfully on the verified Windows environment:

```powershell
npm ci
npm run validate
.\toolchain\bootstrap-dependencies.ps1
. .\.tools\emsdk\emsdk_env.ps1
node .\scripts\verify-toolchain.mjs --profile wasm
.\toolchain\emscripten\configure.ps1
```

Observed results:

- Clean npm installation: 144 packages installed, 145 audited, zero reported vulnerabilities.
- Native toolchain identity: all required versions matched.
- Generated schema modules: current for seven canonical schemas.
- Dependency license inventory: current for 175 lockfile packages.
- Prettier, clang-format, strict TypeScript, and type-aware ESLint: passed.
- Vitest: 16 tests passed.
- Native CTest: one of one foundation tests passed.
- Emscripten CTest: one of one foundation tests passed.
- Dear ImGui and emsdk checkout identities matched their immutable pins.
- Repository-local `.tools/` and `build/` artifacts remained ignored.

## CI evidence boundary

`.github/workflows/ci.yml` reproduces the native gate on Windows and the Emscripten foundation on
Ubuntu. The workflow is implementation-complete but cannot execute until these uncommitted changes
are pushed to GitHub. Its first successful remote run is the required independent-environment
confirmation and should be linked here when available.

## Phase 1 entry condition

Phase 1 may begin from the shared CMake target and pinned dependency/toolchain foundation. The
first production feature remains one custom animated draw-list toggle compiled from identical C++
source into browser and Windows native hosts.
