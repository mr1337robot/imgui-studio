# Studio Web Application

The Phase 1 Studio shell owns preview presentation state and capture controls. It embeds the real
WASM preview from a dedicated loopback origin in a sandboxed iframe and validates the v1
ready/frame/capture message flow. It is never authoritative for project files, revisions, builds,
artifacts, or exports.

Run it with `npm run preview:serve` after building the browser target. Source editing, inspection,
and animation controls arrive in later phases. See `TECHNICAL_DESIGN.md` section 6.1.
