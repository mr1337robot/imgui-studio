# Tests

The test suite follows `TEST_PLAN.md`. Phase 2 adds revision/patch/path/authentication unit and HTTP
tests, a real Emscripten cache/build/smoke/replacement/cancellation gate, and a Playwright Monaco
edit/build/compiler-failure/stale-preview journey.

Run the current complete gate with `npm run validate` from a pinned Windows developer environment.
The WASM lane additionally requires the pinned Emscripten environment and runs with
`npm run test:browser` after `toolchain/emscripten/build-preview.ps1`.
Run `npm run test:phase2` and `npm run test:studio` from the same Emscripten-enabled developer shell.
The real-toolchain journey continues through Phase 4 preview load, exact-frame inspection,
stable-ID action, canonical framebuffer capture, reference comparison, and three-repeat trace
verification. `test:ts` also covers adapter authentication and structured error propagation.
