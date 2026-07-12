# ImGui Studio

ImGui Studio is a local-first, AI-native development environment for creating polished,
animated Dear ImGui menus in real C++.

The canonical preview compiles the project's C++ and Dear ImGui to WebAssembly. The same
project menu and widget source is compiled into the Windows native parity fixture and included
in native exports. HTML or JSON widget recreations are not the source of truth.

## Status

Phase 5 is complete. The repository includes the authenticated local project service, Monaco C++
editor, atomic revision-safe patches, incremental/cancellable Emscripten builds, structured compiler
diagnostics, immutable artifacts, smoke-gated preview replacement, and last-known-good preview
retention. The shared C++ runtime adds deterministic microsecond time, resettable tween/spring
state, stable custom-widget interaction, timeline controls, and repeatable filmstrip traces. The
starter now includes a managed theme, validated licensed assets, portable visual effects, and a
custom component set for a cohesive polished menu. See
[docs/phase-5-completion.md](docs/phase-5-completion.md) for evidence.

## Prerequisites

- Windows x64
- Node.js 24.12.0
- npm 11.6.2
- CMake 4.3.2
- Visual Studio 2022 with MSVC 19.44.35223 and the Desktop C++ workload
- Git 2.45.0 or newer

Emscripten 4.0.10 is required for the browser foundation and can be installed locally with the
checked-in bootstrap script.

## Quick start

```powershell
npm ci
npm run verify:toolchain
npm run validate
```

Install and verify browser tooling:

```powershell
.\toolchain\bootstrap-emscripten.ps1
. .\.tools\emsdk\emsdk_env.ps1
node .\scripts\verify-toolchain.mjs --profile wasm
.\toolchain\emscripten\build-preview.ps1
npm run test:browser
npm run studio
```

Fetch and verify the pinned Dear ImGui source for development:

```powershell
.\toolchain\bootstrap-dependencies.ps1
```

## Common commands

| Command                      | Purpose                                                  |
| ---------------------------- | -------------------------------------------------------- |
| `npm ci`                     | Reproduce the pinned npm dependency graph                |
| `npm run validate`           | Run the complete native quality gate                     |
| `npm run test:ts`            | Run TypeScript/schema contract tests                     |
| `npm run test:cpp`           | Build and test the C++ foundation and native parity host |
| `npm run test:browser`       | Exercise and capture the real WASM preview in Chromium   |
| `npm run compare:captures`   | Compare browser/native captures and write a PNG diff     |
| `npm run preview:serve`      | Serve the shell and preview on separate loopback origins |
| `npm run studio`             | Start the authenticated Phase 2 editor and local service |
| `npm run test:phase2`        | Run the revision/build/cache/preview service gate        |
| `npm run test:studio`        | Run the Monaco edit/build/stale-preview browser journey  |
| `.\toolchain\run-native.ps1` | Open the persistent interactive Win32/DX11 preview       |
| `npm run schemas:generate`   | Regenerate TypeScript types from canonical JSON Schemas  |
| `npm run schemas:check`      | Fail if generated schema types are stale                 |
| `npm run licenses:check`     | Fail if npm dependency license inventory is stale        |
| `npm run format:cpp:check`   | Validate C++ with the pinned clang-format                |
| `npm run format`             | Apply repository formatting                              |
| `npm run clean`              | Remove repository-local build output                     |

## Documentation

- Product requirements: [PRD.md](PRD.md)
- System architecture: [TECHNICAL_DESIGN.md](TECHNICAL_DESIGN.md)
- Delivery plan: [MVP_IMPLEMENTATION_PLAN.md](MVP_IMPLEMENTATION_PLAN.md)
- Development workflow: [docs/development.md](docs/development.md)
- Toolchain setup: [docs/operations/toolchain.md](docs/operations/toolchain.md)
- Contribution standard: [CONTRIBUTING.md](CONTRIBUTING.md)
- Agent instructions: [AGENTS.md](AGENTS.md)

## Security warning

Opening and building a Studio project executes a local C++ toolchain. Review projects from
untrusted sources before building. The MVP is not a sandbox for malicious native source code.

## Licensing

The first-party project license has not yet been selected. No permission to redistribute
first-party source is granted by this repository at this stage. Third-party dependency licenses
are recorded in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) and
`THIRD_PARTY_DEPENDENCIES.json`.
