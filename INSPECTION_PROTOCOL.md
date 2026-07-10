# ImGui Studio — Inspection Protocol

**Status:** v1 implementation contract  
**Version:** 1.0  
**Date:** July 9, 2026  
**Related:** `PRD.md`, `TECHNICAL_DESIGN.md`, `PROJECT_FORMAT.md`, `AGENT_TOOL_API.md`

## 1. Purpose

This protocol turns one rendered Dear ImGui frame into structured, attributable evidence for agents, tests, and Studio UI. It describes semantic widgets, geometry, interaction, animation values, draw/runtime diagnostics, overlays, and deterministic serialization.

Inspection supplements screenshots; it does not infer design intent from pixels. Custom widgets register themselves explicitly through the Studio runtime.

## 2. Invariants

1. Inspection MUST NOT alter ImGui layout, IDs, focus, input, draw commands, animation values, or framebuffer pixels unless a separately requested debug overlay is rendered into a non-canonical diagnostic capture.
2. Every result identifies the exact project revision, successful build, preview instance, frame, deterministic time, viewport, and DPI.
3. Coordinates are framebuffer pixel coordinates before Studio CSS scaling.
4. Stable semantic widget IDs, not `ImGuiID`, are the public automation identity.
5. Results are deterministic for identical build, reset state, input schedule, and frame-time sequence.
6. Diagnostic volume is bounded and truncation is explicit.

## 3. Identity envelope

Every inspection snapshot includes:

```json
{
  "schemaVersion": 1,
  "identity": {
    "projectId": "prj_opaque",
    "projectRevision": "42",
    "buildId": "bld_opaque",
    "previewInstanceId": "prv_opaque",
    "frameId": "frm_opaque",
    "frameIndex": 18,
    "timeUs": 250000,
    "mode": "deterministic",
    "stale": false
  }
}
```

`projectRevision` is a decimal string. `frameIndex` is monotonic within one preview and starts at zero after initialization/reset. `frameId` is never reused. `stale` reports whether the service's current project revision differs; it is metadata, not a claim that the frame is invalid.

## 4. Coordinate and numeric model

- Origin is the top-left of the canonical framebuffer; +x is right and +y is down.
- Rectangles are `[x, y, width, height]` and half-open on right/bottom.
- Protocol geometry uses integer micro-pixels (`1 px = 1,000,000 micro-pixels`) so subpixel C++ values serialize deterministically.
- Convenience `*Px` fields, where present, are derived integer pixel values and MUST NOT be used for parity math.
- Colors are `[r,g,b,a]` integers in `[0,255]`, identified as `srgb` or `linear` by the containing field.
- Non-finite runtime values never appear as JSON numbers; they create an `error` diagnostic and the affected field is `null`.
- Widget order follows registration order. Child order is stable registration order, not lexical order.

## 5. Runtime registration contract

A custom widget SHOULD bracket its interaction/drawing with an inspection scope:

```cpp
auto scope = studio::InspectWidget({
    .stableId = "settings.enable",
    .type = "animated_toggle",
    .bounds = bounds,
    .hitbox = hitbox,
    .flags = studio::InspectFlags::AutomationTarget
});
scope.SetInteraction(interaction);
scope.SetBool("value", enabled);
scope.SetAnimation("active", active, activeSettled);
```

Stable IDs:

- match `^[a-z][a-z0-9]*(\.[a-z][a-z0-9-]*)+$`;
- are globally unique within a frame;
- remain stable across source edits that do not semantically replace the widget;
- MUST NOT contain labels, translated display text, list indices that can reorder, pointers, or random values;
- SHOULD follow feature/container/control hierarchy.

`imguiId` is recorded as an unsigned hexadecimal diagnostic string and MUST NOT be used across builds or sessions. A widget may identify a semantic parent; missing parents produce a warning and attach the node to the root. Cycles are rejected.

## 6. Snapshot schema

```json
{
  "schemaVersion": 1,
  "identity": {
    "projectId": "prj_opaque",
    "projectRevision": "42",
    "buildId": "bld_opaque",
    "previewInstanceId": "prv_opaque",
    "frameId": "frm_opaque",
    "frameIndex": 18,
    "timeUs": 250000,
    "mode": "deterministic",
    "stale": false
  },
  "viewport": {
    "widthPx": 900,
    "heightPx": 600,
    "dpiScaleMilli": 1000,
    "framebufferScaleMillionths": [1000000, 1000000]
  },
  "roots": ["menu.root"],
  "widgets": [],
  "frame": {
    "drawLists": 6,
    "drawCommands": 84,
    "vertices": 3290,
    "indices": 5016,
    "diagnostics": [],
    "diagnosticsTruncated": false
  }
}
```

Widgets are a flat array for easy lookup; hierarchy is represented by `parentId` and ordered `childIds`. `roots` contains IDs in draw/registration order.

## 7. Widget record

```json
{
  "id": "settings.enable",
  "type": "animated_toggle",
  "label": "Enable",
  "parentId": "settings.panel.general",
  "childIds": [],
  "imguiId": "0x8f21c932",
  "registrationIndex": 14,
  "geometry": {
    "boundsMicroPx": [681000000, 241000000, 68000000, 28000000],
    "hitboxMicroPx": [672000000, 236000000, 86000000, 38000000],
    "clipRectMicroPx": [660000000, 210000000, 210000000, 280000000],
    "contentRectMicroPx": null,
    "baselineYMicroPx": 260000000,
    "paddingMicroPx": [9000000, 5000000, 9000000, 5000000]
  },
  "visibility": {
    "submitted": true,
    "visible": true,
    "clipped": false,
    "partiallyClipped": false,
    "offViewport": false,
    "alphaMillionths": 1000000
  },
  "interaction": {
    "automationTarget": true,
    "interactable": true,
    "disabled": false,
    "hovered": false,
    "held": false,
    "pressedThisFrame": false,
    "clickedThisFrame": false,
    "active": true,
    "focused": false,
    "navFocused": false,
    "allowsOverlap": false
  },
  "values": {
    "value": { "kind": "bool", "value": true }
  },
  "animations": {
    "active": {
      "kind": "float",
      "valueMillionths": 820000,
      "targetMillionths": 1000000,
      "velocityMillionthsPerSecond": null,
      "settled": false
    }
  },
  "diagnosticIds": []
}
```

### 7.1 Visibility meanings

- `submitted`: registration occurred this frame.
- `visible`: bounds intersect both clip rect and viewport and effective alpha is non-zero.
- `clipped`: no visible area remains after clip.
- `partiallyClipped`: visible area is smaller than bounds.
- `offViewport`: bounds do not intersect the viewport, regardless of window clipping.

Hidden widgets that were not submitted are absent from a frame snapshot. Animation storage may retain them, but inspection does not synthesize nodes.

### 7.2 Values and animation

Value kinds are `bool`, `int`, `float`, `string`, `colorRgba8`, `vec2`, and `enum`. Strings are capped and control characters escaped. Values likely to contain secrets MUST NOT be registered.

Continuous scalar/vector values use millionths when protocol precision matters. Animation fields include current value, target, optional velocity, and `settled`. An animation is settled only according to the runtime animation specification; inspection does not compute a separate threshold.

## 8. Diagnostics

```json
{
  "id": "diag_opaque",
  "code": "HITBOX_OVERLAP",
  "severity": "warning",
  "message": "Two automation hitboxes overlap without an overlap allowance.",
  "widgetIds": ["settings.enable", "settings.mode"],
  "location": { "relativePath": "src/menu.cpp", "line": 84, "column": 5 },
  "geometryMicroPx": [670000000, 235000000, 20000000, 10000000],
  "occurrences": 1,
  "firstFrameIndex": 18,
  "details": {}
}
```

Severities are `info`, `warning`, `error`, and `fatal`. Required v1 codes:

| Code | Default severity | Meaning |
|---|---|---|
| `DUPLICATE_STABLE_ID` | error | semantic ID registered more than once |
| `LIKELY_IMGUI_ID_COLLISION` | warning | distinct semantic widgets share an `ImGuiID` |
| `INVALID_GEOMETRY` | error | NaN, infinity, negative extent, or overflow |
| `INVALID_DRAW_COMMAND` | error | malformed draw command/index/texture state |
| `HITBOX_OVERLAP` | warning | interactable hitboxes overlap without allowance |
| `OUT_OF_VIEWPORT` | warning | submitted widget is fully outside viewport |
| `PARTIALLY_CLIPPED` | info | widget is clipped and may be unintended |
| `BEGIN_END_IMBALANCE` | error | recoverable ImGui scope imbalance |
| `MISSING_PARENT` | warning | semantic parent was not registered |
| `SEMANTIC_TREE_CYCLE` | error | invalid parent relation |
| `INVALID_ANIMATION_VALUE` | error | non-finite/invalid animation value |
| `MISSING_ASSET` | error | registered/drawn logical asset unavailable |
| `DIAGNOSTICS_TRUNCATED` | warning | frame diagnostic cap reached |

Exact likely-ID-collision detection is best effort because intentional sharing exists. Duplicate stable IDs are never permitted. Default frame cap is 500 unique diagnostics and 50 occurrences per diagnostic; exceeding it emits one truncation diagnostic.

## 9. Overlap analysis

Overlap is tested between non-empty interactable hitboxes after clipping. It is not reported when:

- either widget explicitly sets `allowsOverlap`;
- one is a semantic ancestor acting as a container and is not an automation target;
- the intersection area is zero;
- runtime policy identifies an intentional popup/modal layering relationship.

The diagnostic reports intersection geometry and both registration indices. Analysis order is deterministic by registration index.

## 10. Query and filtering

The service may return a complete snapshot or a filtered projection. Filters include:

- exact `widgetIds`;
- `idPrefix` on segment boundaries;
- `types`;
- `includeValues`, `includeAnimations`, `includeDiagnostics`;
- `maxDepth` from selected roots.

Filtering MUST NOT rerender or alter the original snapshot. Requested IDs absent in that exact frame produce `TARGET_NOT_FOUND`, not an empty successful query, unless `allowMissing` is true.

## 11. Debug overlays

Supported overlays are `bounds`, `hitbox`, `clipRect`, `baseline`, `padding`, and `widgetId`. An overlay request names exact widget IDs and styles. Overlay capture creates a new diagnostic frame/capture with its own `frameId` and `overlayOfFrameId`.

Canonical captures, parity captures, reference comparisons, and image hashes MUST default to overlays disabled. Overlay rendering MUST NOT feed input or advance time.

## 12. Deterministic traces

A capture may include per-frame widget traces. Trace samples contain `timeUs`, `frameId`, selected values/animation properties, and diagnostics. Trace ordering is `(timeUs, frameIndex, widget registrationIndex, property name byte order)`.

For repeatability comparisons:

- IDs, geometry micro-pixels, interaction booleans, registered values, animation values, and diagnostic codes are normative;
- opaque `frameId`, preview ID, request ID, timestamps from wall-clock operation records, and diagnostic opaque IDs are excluded;
- screenshot hashes are recorded but platform-approved image metrics may account for rasterizer differences;
- deterministic mode MUST NOT read wall-clock time or live canvas input.

## 13. Failure behavior

- A recoverable widget/frame diagnostic returns a successful inspection snapshot containing diagnostics.
- If the preview is not ready, identity mismatches, or the frame no longer exists, the tool returns a service error defined in `AGENT_TOOL_API.md`.
- A fatal runtime assertion marks the preview `crashed`; the last completed snapshot remains readable and is labeled terminal.
- Inspection serialization failure returns `INSPECTION_FAILED` and MUST NOT crash the Studio service.
- A target that exists but is clipped, disabled, occluded by a modal, or lacks an automation hitbox yields `TARGET_NOT_INTERACTABLE` for actions.

## 14. Security and privacy

- Inspection never exposes raw pointers, memory contents, backend handles, absolute host paths, source contents, session tokens, or asset bytes.
- `imguiId` is diagnostic only; pointer-derived IDs SHOULD be flagged and are not stable targets.
- Registered strings and details are length-bounded and escaped before UI/log rendering.
- File locations are normalized project-relative paths.
- Inspection payload and capture memory have configurable hard limits; oversized results require filtered queries.
- Preview messages are accepted only from the expected sandboxed instance, origin, protocol version, and request ID.

## 15. Required tests

- Schema fixtures cover every value kind, optional field, diagnostic, and rejection case.
- Registration does not change geometry, input result, draw command bytes, or canonical screenshot with inspection enabled versus compiled no-op instrumentation.
- Duplicate stable ID, likely ImGui collision, invalid geometry, clipped content, disallowed overlap, missing asset, and Begin/End fixtures emit expected bounded diagnostics.
- Coordinate conversion at fractional DPI and negative window positions is deterministic.
- Flat array and parent/child relationships remain stable across three clean runs.
- Hidden, disabled, popup, modal, navigation-focus, and allowed-overlap fixtures report correct state.
- Overlay capture does not advance clock, consume input, or mutate project state.
- Filtered results equal the corresponding projection of the stored full snapshot.
- Trace normalization yields byte-identical output across three clean deterministic runs.
- Malicious labels/details cannot inject markup, paths, or unbounded payloads.

## 16. Acceptance criteria

The protocol is accepted when:

1. An agent can target the fixture toggle without screen-coordinate guessing.
2. The same frame can be tied unambiguously to its revision, build, preview, viewport, DPI, and deterministic time.
3. Bounds, hitbox, clipping, state, values, and animation traces are sufficient to diagnose benchmark alignment and interaction failures.
4. Required invalid fixtures yield expected diagnostics without taking down Studio when recovery is possible.
5. Inspection has no observable effect on a canonical render or interaction.
6. Three clean scenario captures produce identical normalized inspection traces.

