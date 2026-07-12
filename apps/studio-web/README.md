# Studio Web Application

The client provides a project tree, local Monaco C++ editor, revision/status controls,
structured compiler diagnostics, cache timing, and the real WASM preview. The local service remains
authoritative for every file, revision, build, artifact, and preview identity.

The editor generates bounded unified diffs from the current preimage digest. Save advances revision;
Build first saves modified text, then polls the immutable build record. A successful smoke-passed
build loads a new iframe and preview instance. A compiler failure leaves the prior iframe untouched
and marks it stale.

The limited **MANAGED THEME** panel recognizes the starter's accent and animation-duration tokens.
It patches only the declared `src/studio_managed_theme.cpp` through the same revision/preimage flow;
it is intentionally not a general C++ parser or a second source authority.

Monaco is pinned and served locally, with no CDN or runtime network dependency. Preview artifacts run
on the separate authenticated `127.0.0.1:4174` origin.

Phase 4 adds deterministic timeline controls and a non-canonical inspection overlay for the stable
`settings.enable` bounds. The overlay sits in the parent UI, consumes no preview input, and never
changes canonical framebuffer pixels.

Run the application with `npm run studio` after loading Emscripten. Run its browser journey with
`npm run test:studio`.

**Export native** selects the current successful preview build, requests explicit confirmation when
working source is newer, and shows the project-relative verified package directory. Packaging and
MSVC parity verification remain service-owned; the browser never copies files or invokes CMake.
