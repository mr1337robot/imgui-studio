# Integration Tests

- `phase2-http.test.ts` starts isolated loopback ports and verifies project discovery/read, bearer
  authentication, hostile-origin rejection, idempotency, revision mutation, and WebSocket events.
- `phase2-build.integration.ts` uses the real pinned Emscripten toolchain to verify initial promotion,
  structured compiler failure, last-known-good retention, stable-cache corruption recovery, warm
  one-file replacement, smoke initialization, and cancellation.
- `scripts/test-phase2-studio.mjs` drives the Monaco UI through a successful edit/build/preview and a
  failed build that must preserve and mark the prior preview stale.

Generated reports and screenshots live under ignored `out/` directories.
