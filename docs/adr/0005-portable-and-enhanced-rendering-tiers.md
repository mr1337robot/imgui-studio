# ADR 0005: Separate Portable and Enhanced Rendering Tiers

**Status:** Accepted  
**Date:** July 9, 2026  
**Decision owners:** Product and rendering architecture  
**Related:** `PRD.md`, `EXPORT_AND_INTEGRATION.md`, `docs/adr/0003-webgl2-browser-backend.md`

## Context

Distinctive ImGui menus can achieve substantial polish with standard draw-list geometry, textures, typography, gradients, layered shadows/glow, and animation. Higher-quality background blur, Gaussian bloom, render-to-texture composition, and custom shaders require renderer changes and bind a project to specific backends.

If these capabilities are mixed silently, users may preview a design that cannot integrate with their existing ImGui backend. If advanced effects are prohibited entirely, the architecture blocks future fidelity goals.

## Decision

Every project declares exactly one rendering tier:

- **Portable:** ordinary Dear ImGui draw lists and backend-neutral Studio helpers only. No modified draw commands, custom render passes, custom shaders, or backend-specific project calls. This is the only tier implemented and exportable in MVP.
- **Enhanced:** a versioned Studio renderer extension may add render targets, blur, bloom, custom shaders, and higher-quality shadows. Enhanced is a post-MVP capability and must declare exact browser/native backend requirements.

Tier is stored in the project manifest, embedded in build identity, displayed in Studio, and recorded prominently in export/provenance reports. A project cannot silently upgrade tiers because a helper is used. Build/link validation detects incompatible symbols/features and fails with a targeted diagnostic.

Portable approximations—layered translucent shapes, multi-shape glow, vertex gradients, images, and animation—remain available and editable.

## Consequences

### Positive

- MVP exports integrate with ordinary compatible ImGui renderer backends.
- Portability cost is visible before a user adopts a nonstandard effect.
- Advanced effects have a clear future home without contaminating portable contracts.
- Parity and performance can be qualified separately by tier/backend.

### Negative

- The MVP cannot exactly reproduce photographic blur/bloom in some references.
- Portable glow/shadows may require many draw primitives and have visual/performance limits.
- Future enhanced projects need backend-specific packages, effect APIs, and larger parity matrices.
- Moving an enhanced design back to portable may require visual redesign rather than an automatic conversion.

## Alternatives considered

- **Portable-only forever:** rejected because it prevents important future design fidelity.
- **Ship enhanced effects in MVP:** rejected because renderer extension work would delay proof of the core author/preview/inspect/export loop.
- **Allow backend calls ad hoc:** rejected because dependencies would be hidden and exports unreliable.
- **Bake all effects into textures:** useful for static decoration but inadequate for dynamic background blur, bloom, and animated composition.

## Portable contract

Portable project code may use standard ImGui draw commands, paths, clipping, text, images, per-vertex color, alpha/position/size/color animation, and documented helpers that emit ordinary draw-list commands. Asset lookup returns compatible `ImTextureID`; project code does not own renderer resource types.

Portable code must not depend on WebGL, DirectX, renderer callbacks, render targets, shader identifiers, or extra draw-command semantics. Direct backend-specific includes are reported and fail strict portable export.

## Enhanced contract prerequisites

Before enhanced ships, approve a follow-up ADR specifying:

- First browser and native backend implementations.
- Effect graph/draw-command extension API and fallback behavior.
- Resource lifetime, context/device-loss behavior, shader packaging, and security limits.
- Backend/version compatibility matrix.
- Capture semantics, parity thresholds, performance budgets, and export integration.

## Acceptance criteria

- Every manifest/build/preview/export has an explicit tier and tier changes invalidate relevant caches.
- All MVP component and portable-effect fixtures render using unmodified WebGL2 and DirectX 11 ImGui renderer backends.
- Static/source/link validation rejects backend-specific or enhanced symbols from strict portable export.
- The portability report lists direct `imgui_internal.h` and backend-specific use separately from rendering tier.
- Studio never labels an enhanced design portable or hides enhanced integration requirements.
- The MVP exporter returns `UNSUPPORTED_RENDERING_TIER` for enhanced projects.
- Portable benchmark output meets functional/quality gates without claiming exact blur/bloom reproduction.
