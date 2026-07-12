# Agent Adapter

This process is a thin MCP-compatible JSON-RPC stdio mapping over the canonical `/api/v1` service.
It owns protocol framing only. It does not read project files, launch builds or browsers, retain
preview state, or implement comparison policy.

The trusted launcher supplies `IMGUI_STUDIO_TOKEN` and optionally `IMGUI_STUDIO_URL`; tokens are
never command-line arguments or URLs. Start it with `npm run agent-adapter`. Supported compatibility
tools map the PRD names (`project_get`, `source_read`, `source_patch`, `build_preview`,
`render_frame`, `perform_action`, `capture_animation`, `inspect_widgets`, `compare_reference`, and
`reset_preview`) directly to their canonical HTTP counterparts.

Transport and service errors remain machine-readable JSON-RPC error data. Stopping stdin terminates
the adapter; the service continues to own operation cancellation and resource cleanup.

The agent adapter will be a thin MCP-compatible mapping over the canonical local HTTP service. It
must not duplicate project, build, preview, inspection, or export business logic.

Implementation begins in Phase 4. See the alias mapping and exact contracts in
`AGENT_TOOL_API.md`.
