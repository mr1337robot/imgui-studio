# Studio Web Application

The Phase 2 client provides a project tree, local Monaco C++ editor, revision/status controls,
structured compiler diagnostics, cache timing, and the real WASM preview. The local service remains
authoritative for every file, revision, build, artifact, and preview identity.

The editor generates bounded unified diffs from the current preimage digest. Save advances revision;
Build first saves modified text, then polls the immutable build record. A successful smoke-passed
build loads a new iframe and preview instance. A compiler failure leaves the prior iframe untouched
and marks it stale.

Monaco is pinned and served locally, with no CDN or runtime network dependency. Preview artifacts run
on the separate authenticated `127.0.0.1:4174` origin.

Run the application with `npm run studio` after loading Emscripten. Run its browser journey with
`npm run test:studio`.
