# ImGui Studio

ImGui Studio is a local-first, AI-native development environment for creating polished,
animated Dear ImGui menus in real C++.

The canonical preview compiles the project's C++ and Dear ImGui to WebAssembly. The same
project menu and widget source is compiled into the Windows native parity fixture and included
in native exports. HTML or JSON widget recreations are not the source of truth.

## Status

Phase 0 establishes the reproducible repository, pinned toolchain, quality gates, and v1 schema
contracts. The rendering preview and custom widget vertical slice begin in Phase 1.

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
.\toolchain\emscripten\configure.ps1
```

Fetch and verify the pinned Dear ImGui source for development:

```powershell
.\toolchain\bootstrap-dependencies.ps1
```

## Common commands

| Command                    | Purpose                                                  |
| -------------------------- | -------------------------------------------------------- |
| `npm ci`                   | Reproduce the pinned npm dependency graph                |
| `npm run validate`         | Run the complete native Phase 0 quality gate             |
| `npm run test:ts`          | Run TypeScript/schema contract tests                     |
| `npm run test:cpp`         | Configure, build, and run the native C++ foundation test |
| `npm run schemas:generate` | Regenerate TypeScript types from canonical JSON Schemas  |
| `npm run schemas:check`    | Fail if generated schema types are stale                 |
| `npm run licenses:check`   | Fail if npm dependency license inventory is stale        |
| `npm run format:cpp:check` | Validate C++ with the pinned clang-format                |
| `npm run format`           | Apply repository formatting                              |
| `npm run clean`            | Remove repository-local build output                     |

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
