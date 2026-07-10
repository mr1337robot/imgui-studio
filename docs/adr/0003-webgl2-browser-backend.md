# ADR 0003: Use WebGL2 as the MVP Browser Rendering Backend

**Status:** Accepted  
**Date:** July 9, 2026  
**Decision owners:** Rendering/toolchain architecture  
**Related:** `TECHNICAL_DESIGN.md`, `TEST_PLAN.md`, `docs/adr/0005-portable-and-enhanced-rendering-tiers.md`

## Context

The MVP needs a dependable browser path for Dear ImGui draw data, textures, font atlases, custom draw-list widgets, deterministic framebuffer readback, and current desktop Chromium. The team must prove the edit/render/inspect/export loop before investing in a newer renderer or custom effects pipeline.

Emscripten provides a mature path from the OpenGL-style Dear ImGui renderer ecosystem to WebGL2. WebGPU offers future capabilities but would add backend implementation and compatibility risk without being required by the portable MVP.

## Decision

Use Emscripten's browser platform integration and the Dear ImGui OpenGL3 renderer configured for WebGL2 as the sole MVP browser backend. Canonical captures read RGBA8 pixels from the underlying framebuffer at the configured viewport size and DPI, independent of CSS display scaling.

WebGL2 is a host detail. Portable project source receives backend-neutral texture handles and emits ordinary Dear ImGui draw data. It must not include WebGL headers or call WebGL APIs.

## Consequences

### Positive

- Lowest-risk path to real ImGui in supported browsers.
- Reuses known draw-data and texture semantics.
- Supports portable custom widgets, fonts, images, gradients, layered glow/shadow approximations, and deterministic readback.
- Keeps focus on agent iteration rather than renderer research.

### Negative

- WebGL2 cannot directly provide the desired high-quality blur/bloom pipeline without renderer extensions.
- Context loss, readback stalls, premultiplied alpha, color space, and texture upload behavior require explicit tests.
- Native parity uses DirectX 11, so anti-aliasing/rasterization differences need measured tolerances.
- WebGPU adoption later will require another backend and parity qualification.

## Alternatives considered

- **WebGPU now:** rejected for MVP because portable drawing does not require it and it expands backend/tooling risk.
- **Canvas 2D translation:** rejected because it would not execute the canonical ImGui renderer path.
- **Software rasterization in WASM:** rejected for likely performance cost and divergence from ordinary native backends.
- **WebGL1:** rejected due to narrower capabilities and no benefit for the current supported browser target.

## Implementation constraints

- Pin Emscripten, Dear ImGui, GL settings, context attributes, and shader version per Studio release.
- Record framebuffer dimensions, DPI, color-space/alpha assumptions, backend identity, and environment in captures.
- Handle context loss as a preview crash/reinitialization event without replacing the last successful build identity.
- Avoid synchronous readback during ordinary realtime frames; perform it only for requested captures.
- Use identical project-provided font/asset inputs in WebGL2 and native hosts.
- Enhanced effects remain outside the MVP portable backend.

## Acceptance criteria

- Current supported desktop Chromium initializes the preview and renders all portable component fixtures.
- Textures, merged icons, fonts, gradients, clipping, and custom draw-list geometry capture correctly.
- Canonical capture dimensions exactly equal configured framebuffer pixels and ignore CSS scaling.
- A lost/failed context is isolated and recoverable without restarting Studio.
- The benchmark menu sustains 60 fps on the reference machine.
- Browser/native fixed-configuration geometry remains within two pixels; differences include diagnostic artifacts and environment provenance.

