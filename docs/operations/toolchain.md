# Toolchain Operations

## Source of truth

`toolchain/toolchain.json` records the release version set. `toolchain/toolchain.schema.json`
validates its structure. `scripts/verify-toolchain.mjs` compares executable versions with the
manifest and fails with remediation instructions.

## Native profile

Run from a Visual Studio developer PowerShell:

```powershell
node .\scripts\verify-toolchain.mjs --profile native
npm run test:cpp
```

The native profile is Windows x64, Visual Studio 2022, MSVC, CMake, and C++20.

## WASM profile

Install Emscripten in the repository-local ignored tools directory:

```powershell
.\toolchain\bootstrap-emscripten.ps1
. .\.tools\emsdk\emsdk_env.ps1
node .\scripts\verify-toolchain.mjs --profile wasm
.\toolchain\emscripten\configure.ps1
```

The script refuses an installation root outside `.tools`, checks out the immutable emsdk commit,
and installs the exact release. On Windows, the foundation build uses the NMake generator and must
run from a Visual Studio 2022 developer PowerShell. Delete `.tools/emsdk` manually if a completely
fresh installation is required; it contains no canonical project data.

## Dear ImGui

```powershell
.\toolchain\bootstrap-dependencies.ps1
```

The script checks out the commit corresponding to Dear ImGui 1.92.1 under
`.tools/dependencies/dear-imgui`. CMake's Phase 1 dependency module uses the same immutable commit.

## Updating a version set

Do not edit a single version in isolation. A toolchain update requires:

1. A compatibility assessment and ADR when the change is consequential.
2. Updates to the manifest, schema fixtures, CI, documentation, and dependency notices.
3. Native and WASM clean builds.
4. Browser/native parity qualification once the rendering spine exists.
5. A new `versionSet` identifier when build compatibility changes.
