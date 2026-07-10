# Contributing to ImGui Studio

## Before changing code

Read `AGENTS.md` and the contracts governing the area you will change. Phase ordering and release
gates are defined in `MVP_IMPLEMENTATION_PLAN.md` and `TEST_PLAN.md`.

Do not begin post-MVP work or create a second rendering/source-of-truth path. Consequential
architecture changes require an ADR.

## Generated and owned files

- JSON Schemas under `schemas/` are canonical, user-reviewed contracts.
- `schemas/generated/*.generated.ts` is generated and committed. Never edit it manually.
- `THIRD_PARTY_DEPENDENCIES.json` is generated from `package-lock.json` and committed.
- `build/`, `out/`, `.tools/`, and project `.studio/` directories are disposable and ignored.
- Project C++ source, themes, scenarios, and approved assets are user-authored and must not be
  wholesale regenerated.

## Development workflow

1. Install the pinned tools from `toolchain/toolchain.json`.
2. Run `npm ci` from a clean checkout. Use `npm install` only when intentionally changing dependencies.
3. Make the smallest phase-appropriate change.
4. Add tests and update the governing contract or subsystem documentation.
5. Run `npm run validate`.
6. When browser tooling changes, also run the WASM foundation instructions in
   `docs/operations/toolchain.md`.

Report the exact commands and results with each change. Do not claim checks that were not run.

## Code quality

- C++ is C++20 and Studio-owned code builds with strict warnings as errors.
- TypeScript uses strict type checking and type-aware ESLint rules.
- Public APIs require useful Doxygen or TSDoc documentation.
- Errors must be structured, safe, contextual, and tested.
- Resource ownership, cleanup, cancellation, and concurrency behavior must be explicit.
- Generated output and formatting must be current before review.

## Pull request checklist

- [ ] The change belongs to the current implementation phase.
- [ ] Public behavior matches its normative documentation.
- [ ] Tests cover success, failure, and relevant boundary conditions.
- [ ] Generated types and dependency inventory are current.
- [ ] Formatting, linting, type checking, CTest, and Vitest pass.
- [ ] Security, deterministic behavior, and browser/native parity were evaluated where relevant.
- [ ] No unrelated user-authored changes were overwritten.
