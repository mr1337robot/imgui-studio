# Tests

The test suite follows `TEST_PLAN.md`. Phase 1 provides strict schema fixtures, the C++20
foundation, a Win32/DirectX 11 capture CTest, a Playwright Chromium interaction/capture lane, and
positive plus deliberately shifted browser/native comparison fixtures.

Run the current complete gate with `npm run validate` from a pinned Windows developer environment.
The WASM lane additionally requires the pinned Emscripten environment and runs with
`npm run test:browser` after `toolchain/emscripten/build-preview.ps1`.
