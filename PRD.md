# ImGui Studio — Product Requirements Document

**Status:** Ready for implementation  
**Version:** 1.0  
**Date:** July 9, 2026  
**Working title:** ImGui Studio  

## 1. Executive summary

ImGui Studio is an AI-native development environment for designing polished, animated Dear ImGui menus. It gives AI agents the same rapid visual iteration loop they have when building websites while preserving exact compatibility with native C++ projects.

Agents author real C++ menu and widget implementations, compile them to WebAssembly, interact with the resulting Dear ImGui interface in a browser, inspect screenshots and deterministic animation captures, and iteratively improve the design. The source previewed in the browser is the same source exported to the user's native project.

The product is not a visual form builder, an HTML approximation of ImGui, or a generator that maps a layout schema to stock calls such as `ImGui::Checkbox()`. It is a focused C++ visual workshop that supports custom widget geometry, interaction, animation, fonts, icons, textures, and optional renderer-level effects.

The initial release will prove that an AI agent can reproduce a high-quality reference menu and export it into a native Dear ImGui example with close browser/native visual parity.

## 2. Problem statement

AI agents are effective at designing websites because they can repeatedly edit code, render it in a browser, capture the result, interact with it, and use visual feedback to correct their work. Most C++ Dear ImGui workflows do not provide this loop.

As a result, agents commonly:

- Use stock Dear ImGui widgets with only superficial style changes.
- Fail to develop a coherent visual system across the menu.
- Cannot reliably inspect spacing, clipping, alignment, or widget states.
- Cannot observe animations over time.
- Generate custom drawing code without validating the result.
- Produce browser mockups that do not match the exported native menu.
- Depend on users to compile, run, screenshot, and report problems after every change.

High-quality ImGui interfaces require more than changing `ImGuiStyle`. They often use custom item registration, hit testing, drawing through `ImDrawList`, persistent animation state, custom fonts and icons, textures, and sometimes renderer-level effects. The product must expose those capabilities rather than hide them behind stock-widget abstractions.

## 3. Product vision

> An AI-native ImGui workshop where agents can write custom C++ widgets, run them through real Dear ImGui in the browser, inspect interactions and animations frame by frame, and export the exact source that was previewed.

ImGui Studio should make the following loop fast and dependable:

1. Receive a written brief and optional reference images.
2. Author or modify C++ menu and widget source.
3. Compile the project to WebAssembly.
4. Render it using real Dear ImGui.
5. Interact with the menu or replay scripted interactions.
6. Inspect screenshots, filmstrips, geometry, and diagnostics.
7. Refine the implementation.
8. Export the same source and assets to a native C++ project.

## 4. Goals

### 4.1 Primary goals

- Enable AI agents to autonomously create visually distinctive Dear ImGui menus rather than decorated stock widgets.
- Provide browser-based execution of real C++ Dear ImGui code through WebAssembly.
- Make animation behavior deterministic, observable, and testable.
- Support custom widgets built with `ImDrawList`, public ImGui APIs, and a versioned adapter for selected internal APIs.
- Keep browser preview and native output visually equivalent.
- Support reference-driven design through overlays and visual comparison.
- Export readable C++ source, assets, build instructions, and an integration contract.
- Allow humans to observe, inspect, and manually adjust an agent's work.

### 4.2 Secondary goals

- Establish a reusable library of polished but fully editable widget examples.
- Provide structured geometry and interaction data in addition to screenshots.
- Detect common ImGui problems such as ID collisions, clipping, invalid draw commands, and unstable animation state.
- Make it possible to test multiple resolutions, DPI scales, and application states.

### 4.3 Non-goals for v1

- A general-purpose C++ IDE.
- A Figma replacement or comprehensive drag-and-drop editor.
- Automatic import and faithful conversion of arbitrary existing ImGui codebases.
- Support for every Dear ImGui backend, extension, or third-party widget library.
- Collaborative cloud editing, accounts, billing, or a public component marketplace.
- Mobile or touch-first menu design.
- Arbitrary native code execution in a hosted multi-tenant service.
- Guaranteed pixel identity across different operating systems, GPU drivers, or font rasterizers.
- Production-ready docking, node editors, data plots, or multi-viewport workflows.

## 5. Target users

### 5.1 Primary user: C++ developer using Dear ImGui

The developer already has or expects to have a Dear ImGui-enabled application. They want a more polished interface but do not want to manually iterate on every visual and animation detail.

Needs:

- Source code that is easy to integrate.
- Control over dependencies and rendering requirements.
- Confidence that previewed behavior matches native behavior.
- Ability to connect widgets to application state and callbacks.
- Clear distinction between portable and renderer-specific effects.

### 5.2 Primary operator: AI coding agent

The agent creates and modifies source, triggers builds, inspects output, performs interactions, and iterates toward the requested design.

Needs:

- Small, deterministic tools with structured results.
- Fast incremental builds.
- Screenshots and animation filmstrips.
- Exact widget geometry and diagnostic feedback.
- Reference-image comparison.
- Direct access to C++ implementation files.

### 5.3 Secondary user: UI designer or technical artist

The designer supplies references, reviews iterations, adjusts tokens and assets, and exports a project for engineering integration.

Needs:

- Live preview and timeline controls.
- Reference overlays.
- Theme and asset controls.
- Understandable project structure without deep ImGui knowledge.

## 6. Product principles

### 6.1 Preview the real result

The preview must execute Dear ImGui compiled from C++ to WebAssembly. HTML or CSS recreations are not acceptable as the canonical preview.

### 6.2 Exact source, not lossy generation

The C++ widget and menu source used in the browser preview must be included in the export. The product must not maintain separate browser and native implementations.

### 6.3 Custom widgets are first-class

Stock widgets may be used, but the product must assume that polished interfaces will register their own items, handle input, maintain animation state, and draw custom geometry.

### 6.4 Time is inspectable

Animations must use a deterministic Studio clock during preview and testing. The same animation implementation must use frame delta time in native integration.

### 6.5 Structured feedback complements vision

Screenshots communicate appearance. Widget bounds, state, clipping, interaction, and diagnostic data make correction precise. Both are required.

### 6.6 Portability is explicit

Every project and effect must declare whether it uses only portable ImGui drawing or requires the enhanced Studio renderer.

### 6.7 Starting points remain editable

Bundled widgets are readable C++ examples rather than sealed controls. Agents may copy, fork, or completely replace them.

## 7. Core user journeys

### 7.1 Create a menu from a written brief

1. The user creates a project and selects a viewport size and Dear ImGui version.
2. The user describes the menu, visual direction, controls, and desired interactions.
3. The agent creates menu, theme, widget, and state files.
4. The agent builds and renders the first version.
5. The agent inspects the screenshot and widget tree.
6. The agent performs scripted interactions and captures animation filmstrips.
7. The agent iterates until visual and functional checks pass.
8. The user reviews the result and exports the native package.

### 7.2 Reproduce a reference image

1. The user imports one or more reference images.
2. The user specifies the target menu viewport and whether decorative background treatment is part of the deliverable.
3. The agent samples typography, color, spacing, hierarchy, and component patterns from the reference.
4. The agent builds the layout and custom widgets.
5. The preview and reference are compared side by side, overlaid, and viewed as an image difference.
6. The agent uses comparison output and geometric inspection to correct the design.
7. The agent validates interactive and animated states that are not visible in the reference.
8. The user exports the native project.

### 7.3 Modify a widget implementation

1. The user or agent opens an editable widget such as `animated_toggle.cpp`.
2. The implementation changes geometry, interaction, colors, or animation.
3. Only affected source is recompiled before the WASM preview is relinked.
4. The widget is rendered in isolated states and inside the full menu.
5. Hover, pressed, active, disabled, and transition states are captured.
6. The updated source becomes part of the project export.

### 7.4 Integrate the export into a native application

1. The developer exports the project as a directory or archive.
2. The export contains C++ source, headers, assets, generated asset registration, runtime helpers, and a CMake example.
3. The developer implements or connects the generated state and event contract.
4. The developer calls a documented render function from the existing ImGui frame.
5. A native parity example confirms the expected result.

## 8. Functional requirements

Priority definitions:

- **P0:** Required for the MVP to ship.
- **P1:** Required shortly after the MVP or if capacity permits.
- **P2:** Future capability; architecture should not preclude it.

### 8.1 Project management

- **P0:** Create, open, rename, duplicate, and delete local projects.
- **P0:** Store projects as ordinary directories that can be version controlled.
- **P0:** Pin the Studio project format, Dear ImGui version, component library version, Emscripten version, and rendering tier.
- **P0:** Autosave text changes locally while retaining explicit build and export actions.
- **P0:** Include a starter project with a menu, editable widgets, theme, assets, and test scenarios.
- **P1:** Import an existing Studio project archive.
- **P1:** Display a source-control diff for agent changes.

Example project manifest:

```json
{
  "formatVersion": 1,
  "name": "neon-settings",
  "imguiVersion": "1.92.x",
  "emscriptenVersion": "pinned-by-release",
  "studioRuntimeVersion": "0.1.0",
  "renderingTier": "portable",
  "viewport": {
    "width": 900,
    "height": 600,
    "dpiScale": 1.0
  }
}
```

### 8.2 Source editing

- **P0:** Provide a browser editor for `.cpp`, `.hpp`, manifest, theme, and scenario files.
- **P0:** Support syntax highlighting, search, diagnostics, and file navigation.
- **P0:** Allow agents to read and patch source files through a tool API.
- **P0:** Preserve readable user-authored C++ without regenerating unrelated files.
- **P0:** Show compilation errors with file, line, column, message, and relevant excerpt.
- **P1:** Provide completion and symbol navigation through a C++ language server.
- **P1:** Offer side-by-side revision diffs and one-action reversion of an individual agent patch.

### 8.3 Browser compilation and preview

- **P0:** Compile project C++ to WebAssembly using a pinned Emscripten toolchain.
- **P0:** Execute real Dear ImGui in an isolated browser preview canvas.
- **P0:** Cache Dear ImGui, backend, Studio runtime, and unchanged translation-unit objects.
- **P0:** Reload the preview after a successful build without reloading the entire Studio application.
- **P0:** Retain the previous successful preview when a new build fails.
- **P0:** Display build duration, warnings, binary size, and current revision identifier.
- **P0:** Use WebGL2/OpenGL3 as the initial browser rendering path.
- **P1:** Support build cancellation.
- **P1:** Add finer-grained hot reload if measured build latency makes it necessary.

### 8.4 Custom widget authoring

- **P0:** Permit ordinary Dear ImGui public API calls.
- **P0:** Permit `ImDrawList` geometry, paths, images, gradients, and text.
- **P0:** Provide a Studio interaction wrapper for item registration, button behavior, and structured inspection.
- **P0:** Provide a versioned adapter around the minimum selected `imgui_internal.h` functionality.
- **P0:** Support widget-local persistent state keyed by `ImGuiID` and property identifier.
- **P0:** Support hover, held, pressed, clicked, active, focused, disabled, and navigation states.
- **P0:** Allow raw access to the pinned Dear ImGui version for advanced authors.
- **P0:** Bundle editable examples for toggles, sliders, navigation, combos, keybinds, cards, and notifications.
- **P1:** Provide an isolated widget gallery for testing every state.

The internal API adapter must contain version-sensitive calls in a small runtime module. Project widgets should prefer stable Studio wrappers when possible:

```cpp
studio::Interaction interaction = studio::Interact(id, bounds);
studio::RegisterItem(id, bounds);
```

Direct use of `imgui_internal.h` remains possible but must produce a portability warning in the project report.

### 8.5 Animation runtime

- **P0:** Store animation state by `(ImGuiID, property key)` rather than requiring global static variables.
- **P0:** Provide duration/easing interpolation for floats, vectors, and colors.
- **P0:** Provide a damped spring animation for floats and vectors.
- **P0:** Support delay and simple sequential animation composition.
- **P0:** Allow all Studio animation state to be reset deterministically.
- **P0:** Use a deterministic Studio clock for preview, capture, and tests.
- **P0:** Use frame delta time when running natively outside Studio.
- **P0:** Provide play, pause, restart, frame-step, playback-speed, and time-scrub controls.
- **P0:** Capture a deterministic filmstrip for a specified scenario, duration, and frame rate.
- **P0:** Report current animation properties and whether they have settled.
- **P1:** Export captured animation as a short video or animated image.
- **P1:** Provide animation curves and property values in a timeline inspector.

Required animation API shape:

```cpp
float active = studio::Animate(
    id, "active", enabled ? 1.0f : 0.0f,
    0.22f, studio::Ease::OutCubic);

float hover = studio::Spring(
    id, "hover", interaction.hovered ? 1.0f : 0.0f,
    240.0f, 22.0f);
```

### 8.6 Interaction automation

- **P0:** Simulate pointer movement, mouse down/up, click, drag, scroll, keyboard input, and text input.
- **P0:** Target actions by stable Studio widget identifier in addition to raw coordinates.
- **P0:** Define reusable scenarios in a human-readable project file.
- **P0:** Replay scenarios against a clean state and deterministic clock.
- **P0:** Stop a scenario and report the failing step if a target is missing or not interactable.
- **P1:** Record manual interactions into a reusable scenario.

Example scenario:

```json
{
  "name": "toggle-and-open-combo",
  "steps": [
    { "at": 0.10, "action": "move", "target": "settings.enable" },
    { "at": 0.25, "action": "click", "target": "settings.enable" },
    { "at": 0.70, "action": "click", "target": "settings.mode" }
  ],
  "capture": {
    "start": 0.0,
    "end": 1.2,
    "fps": 12
  }
}
```

### 8.7 Visual and structured inspection

- **P0:** Capture the full preview or a selected region as an image.
- **P0:** Return a structured widget tree for the current frame.
- **P0:** Report widget identifier, type label, bounds, clipping state, visibility, interaction state, and associated animation properties.
- **P0:** Detect duplicate Studio identifiers and likely ImGui ID collisions.
- **P0:** Detect non-finite coordinates, invalid draw commands, out-of-viewport content, and unbalanced Begin/End operations where recoverable.
- **P0:** Identify overlapping widget hitboxes when neither widget explicitly allows overlap.
- **P0:** Allow a selected widget's bounds, baseline, padding, and hitbox to be overlaid on the preview.
- **P1:** Report basic text/background contrast estimates.
- **P1:** Report inconsistent repeated spacing and alignment measurements.

Example inspection response:

```json
{
  "id": "settings.enable",
  "type": "animated_toggle",
  "bounds": [681, 241, 749, 269],
  "visible": true,
  "clipped": false,
  "state": {
    "hovered": false,
    "held": false,
    "active": true
  },
  "animations": {
    "active": 0.82,
    "hover": 0.0
  },
  "warnings": []
}
```

### 8.8 Reference images and comparison

- **P0:** Import PNG, JPEG, and WebP reference images.
- **P0:** Show reference and preview side by side.
- **P0:** Overlay the reference with adjustable opacity and alignment.
- **P0:** Provide absolute difference and edge-difference views.
- **P0:** Support reference translation, scale, and crop without modifying the source file.
- **P0:** Provide point color sampling and ruler measurements.
- **P0:** Keep comparison images available to agent tools.
- **P1:** Produce a perceptual similarity score for guidance, never as the sole quality gate.
- **P1:** Allow annotations that identify which reference regions are menu UI versus decorative presentation or post-processing.

### 8.9 Fonts, icons, and assets

- **P0:** Import `.ttf` and `.otf` fonts, PNG/JPEG/WebP textures, and SVG icons.
- **P0:** Configure font size, oversampling, glyph ranges, and multiple font weights.
- **P0:** Merge an icon font or rasterized icon set into the font/texture asset pipeline.
- **P0:** Build the same font atlas inputs for browser and native exports.
- **P0:** Assign stable generated identifiers to textures and fonts.
- **P0:** Show missing-glyph, failed-decode, oversized-texture, and unavailable-asset errors.
- **P0:** Include licenses and attribution files supplied with imported assets in the export.
- **P1:** Preview individual glyphs, icons, atlas pages, and font metrics.
- **P1:** Support configurable SVG rasterization sizes.

### 8.10 Theme and design tokens

- **P0:** Provide a project-level C++ theme structure for colors, typography, spacing, sizes, rounding, strokes, shadows, and animation timings.
- **P0:** Allow widgets to override project tokens.
- **P0:** Make theme values editable as source and through a basic properties panel.
- **P0:** Ensure property-panel edits modify only a generated or explicitly managed theme file.
- **P1:** Support named theme variants such as dark, light, and high contrast.

The theme system must not prevent direct custom drawing. It is a consistency mechanism, not a CSS-like layout engine.

### 8.11 Rendering tiers

Every project must declare one rendering tier.

#### Portable tier — P0

The portable tier may use:

- Standard Dear ImGui draw lists.
- Rectangles, circles, paths, strokes, and filled geometry.
- Vertex color gradients.
- Textures and images.
- Layered translucent geometry.
- Approximate shadows and glow using repeated shapes.
- Alpha, position, size, and color animation.

Portable exports must work with a documented minimum Dear ImGui version and ordinary compatible renderer backends after the developer provides texture registration.

#### Enhanced tier — P1

The enhanced tier may use a bundled renderer extension for:

- Gaussian blur.
- Background blur.
- Bloom.
- Render-to-texture passes.
- Custom shaders.
- Higher-quality shadows and glow.

Enhanced projects must declare their backend requirements prominently in the Studio UI and export report. The first supported native enhanced backend will be selected during post-MVP implementation based on the reference application; enhanced effects are not required for MVP launch.

### 8.12 State and event binding

- **P0:** Keep design-time sample state separate from production application state.
- **P0:** Define a readable C++ state structure used by the rendered menu.
- **P0:** Define event callbacks for actions that should be handled by the host application.
- **P0:** Allow scenarios to load named sample states.
- **P0:** Export a documented render entry point accepting state and events.
- **P0:** Avoid embedding user application logic in Studio runtime code.

Example integration contract:

```cpp
struct SettingsMenuState {
    bool enabled = false;
    float intensity = 0.75f;
    int selected_section = 0;
};

struct SettingsMenuEvents {
    std::function<void()> on_save;
    std::function<void()> on_reset;
};

void RenderSettingsMenu(
    SettingsMenuState& state,
    const SettingsMenuEvents& events);
```

### 8.13 Export

- **P0:** Export the exact menu and widget C++ source compiled in the successful preview revision.
- **P0:** Include required Studio runtime source or headers under a clear license and namespace.
- **P0:** Include fonts, textures, icons, generated asset registration, and supplied attribution files.
- **P0:** Include a manifest containing exact dependency and toolchain versions.
- **P0:** Include a minimal native example and CMake integration example.
- **P0:** Include state/event integration documentation.
- **P0:** Include a portability report listing internal ImGui usage, rendering tier, required features, asset requirements, and warnings.
- **P0:** Prevent export of an unbuilt revision without an explicit warning and confirmation.
- **P1:** Export as both a directory and archive.
- **P1:** Generate integration variants for selected common backends without changing widget source.

## 9. Agent tool API

The agent interface may initially be local HTTP with a thin MCP-compatible adapter. Tool behavior and data contracts are more important than the transport.

### 9.1 Required tools

#### `project_get`

Returns manifest, file tree, active revision, last successful build revision, and current preview status.

#### `source_read`

Reads a UTF-8 project file with optional line range.

#### `source_patch`

Applies a bounded patch to a project file. Returns changed lines, new revision, and validation errors. Arbitrary filesystem paths outside the project are rejected.

#### `build_preview`

Builds the active revision. Returns structured diagnostics, timing, binary size, and preview revision.

#### `render_frame`

Resets or advances the deterministic clock, renders one frame, and optionally returns a screenshot.

#### `perform_action`

Performs an interaction against a stable widget identifier or coordinates and reports the resulting target state.

#### `capture_animation`

Runs a scenario using a deterministic clock and returns a filmstrip, frame timestamps, widget-state trace, and warnings.

#### `inspect_widgets`

Returns the complete or filtered structured widget tree for the current frame.

#### `compare_reference`

Compares the current preview with a selected reference using configured transform, crop, and comparison mode.

#### `reset_preview`

Resets sample application state, input, animation storage, and deterministic time.

#### `export_project`

Exports the last successful preview revision and returns its portability report and output location.

### 9.2 Tool requirements

- Every mutating response must include a monotonically increasing project revision.
- Rendering and inspection responses must include the preview revision used.
- Builds and captures must be cancellable by the host application.
- Tools must return structured errors rather than only console logs.
- Screenshots and filmstrips must be accessible without embedding unbounded image data in text responses.
- The API must reject stale patches when their expected base revision no longer matches.
- Tool operations must be deterministic when given the same project revision, state, scenario, viewport, and clock inputs.

## 10. Studio user interface

The MVP desktop browser layout will contain:

```text
+----------------------+------------------------------------------+
| Project files        | Real Dear ImGui WASM preview            |
|                      |                                          |
| menu.cpp             |                                          |
| theme.hpp            |                                          |
| widgets/             |                                          |
| assets/              |                                          |
+----------------------+------------------------------------------+
| Source editor        | Inspector / reference / animation        |
| and build output     | Play Pause Step Restart Speed Timeline   |
+----------------------+------------------------------------------+
```

### 10.1 Required panels

- Project and file tree.
- C++ source editor.
- Build output and structured diagnostics.
- Live ImGui preview.
- Widget tree and properties inspector.
- Animation controls and filmstrip.
- Reference image and comparison controls.
- Asset browser.
- Export and portability report.

### 10.2 Human editing scope

The MVP will support direct source editing and limited property editing for theme values and preview configuration. It will not include freeform drag-and-drop layout construction.

## 11. Technical architecture

### 11.1 High-level components

```text
Studio web application
  |-- source editor
  |-- preview canvas
  |-- animation/reference/inspection UI
  |-- agent tool client
  |
Local Studio service
  |-- project and revision manager
  |-- build coordinator and cache
  |-- agent tool API
  |-- export packager
  |
Emscripten build worker
  |-- pinned compiler
  |-- cached Dear ImGui and Studio runtime objects
  |-- project translation units
  |
WASM preview runtime
  |-- Dear ImGui
  |-- WebGL2 renderer backend
  |-- Studio widget/animation/inspection runtime
  |-- deterministic input and clock
  |
Native export
  |-- exact project widget/menu source
  |-- Studio runtime subset
  |-- assets and registration
  |-- CMake and example integration
```

### 11.2 Suggested repository structure

```text
apps/
  studio-web/
  studio-service/
runtime/
  include/studio/
  src/
  imgui-adapters/
  browser/
  native/
components/
  widgets/
  effects/
  layout/
toolchain/
  emscripten/
schemas/
  project/
  scenarios/
  inspection/
examples/
  starter/
  native-parity/
tests/
  unit/
  visual/
  integration/
```

### 11.3 Dear ImGui integration

- Pin a specific tested Dear ImGui release for each Studio release.
- Compile Dear ImGui and browser backend objects independently from project sources.
- Use the same Dear ImGui sources for WASM preview and native parity fixtures.
- Keep internal API access behind a version-specific adapter where practical.
- Track direct project inclusion of `imgui_internal.h` in the portability report.

### 11.4 Preview isolation

- Run the WASM preview in a sandboxed iframe or equivalent isolated browser context.
- Communicate through a narrow message protocol for frames, input, diagnostics, and inspection data.
- Recreate the preview context after crashes or unrecoverable ImGui assertions.
- Do not allow preview code direct access to the Studio application's origin storage or DOM.

### 11.5 Build approach

The MVP will compile complete preview modules while caching stable and unchanged objects. It will not attempt dynamic C++ module loading inside WebAssembly.

Build sequence:

1. Validate manifest and asset declarations.
2. Compile only changed project translation units.
3. Reuse cached Dear ImGui, backend, runtime, and unchanged project objects.
4. Link the WASM module.
5. Start it in an isolated preview.
6. Run a smoke frame and report initialization failures.

This approach prioritizes correctness and implementation simplicity. More advanced hot reload will only be pursued after measuring real project build times.

## 12. Bundled editable component foundation

The starter project must include polished, documented, source-editable examples:

- Animated toggle/checkbox.
- Integer and float slider.
- Sidebar navigation item with active indicator.
- Tab control and transition.
- Combo/dropdown.
- Keybind capture.
- Color picker trigger and popup.
- Section card and settings row layout.
- Button and icon button.
- Toast notification.
- Modal transition.

Supporting effects and layout helpers:

- Layered portable shadow.
- Multi-shape portable glow.
- Vertex-color gradient helpers.
- Text and icon alignment helpers.
- Horizontal and vertical layout measurement.
- Stable widget ID and inspection macros/helpers.

Each component must:

- Be ordinary readable C++.
- Use the project theme where appropriate.
- Expose all meaningful visual states.
- Include a small isolated example.
- Include at least one deterministic interaction scenario.
- Avoid hidden code generation.

## 13. MVP scope

### 13.1 Included

- Local single-user Studio application.
- One pinned Dear ImGui and Emscripten combination.
- WebGL2 browser preview.
- Portable rendering tier.
- Real C++ source editing and incremental cached builds.
- Custom draw-list widget authoring.
- Versioned interaction/internal adapter.
- Deterministic animation runtime and controls.
- Scripted interaction and filmstrip capture.
- Widget tree and geometry inspection.
- Reference side-by-side, overlay, and difference views.
- Fonts, icons, textures, and asset export.
- Editable starter widget library.
- Exact-source native export with CMake example.
- A native parity test application.

### 13.2 Excluded

- Enhanced blur/bloom renderer implementation.
- Cloud-hosted arbitrary C++ compilation.
- Accounts, teams, collaboration, and marketplace.
- Drag-and-drop layout editing.
- Arbitrary existing-project import.
- Docking and multi-viewport authoring.
- Multiple browser rendering backends.
- Multiple Dear ImGui versions within one Studio release.
- Automatic production application binding or business-logic generation.

## 14. MVP reference benchmark

The MVP release benchmark is an autonomous reference-reproduction task based on a polished neon-style settings menu.

### 14.1 Required menu content

- Fixed 900 x 600 preview.
- Branded top header with logo and icon action.
- Sidebar with at least two groups and nested navigation.
- Two primary content columns or panels.
- Multiple animated toggles.
- Animated integer and float sliders.
- Keybind control.
- Combo/dropdown.
- Color picker.
- Button.
- Custom font and icon set.
- Dark layered panels with a neon accent system.
- Opening, hover, selection, toggle, slider, and dropdown animation states.

### 14.2 Benchmark procedure

1. Start from the standard Studio starter rather than a completed reference-specific project.
2. Give the agent a written brief and reference image through supported inputs.
3. Allow only Studio source, build, render, interaction, inspection, comparison, and export tools.
4. Require the agent to build, visually inspect, interact, and revise its work multiple times.
5. Run all defined interaction scenarios without errors.
6. Export and build the native parity example.
7. Capture browser and native output at the same viewport, DPI, sample state, font atlas inputs, and deterministic time.
8. Review visual quality, functional correctness, animation stability, and integration quality.

### 14.3 Benchmark acceptance criteria

- All required controls are custom-drawn or intentionally composed from custom-drawn foundations.
- No required control is merely an unmodified stock Dear ImGui widget.
- No visible clipping, accidental overlap, duplicate identifier, or invalid draw warning remains.
- Every required interaction is targetable by stable widget identifier.
- Animation filmstrips are deterministic across three consecutive clean runs.
- Browser and native captures have the same layout geometry within 2 pixels at the benchmark configuration.
- Browser and native captures have no unexplained font, icon, texture, or color mismatch.
- The native example configures and renders the exported menu using documented steps.
- A human reviewer rates the result at least 4 out of 5 for visual hierarchy, consistency, custom appearance, and perceived polish.
- A human reviewer can distinguish it immediately from the default Dear ImGui theme and stock widget set.

The visual similarity score against a reference is diagnostic only. The reference may contain photographic bloom, perspective, or presentation effects that are not part of the menu itself.

## 15. Non-functional requirements

### 15.1 Performance

- A no-op preview restart should be interactive within 1 second on the reference development machine.
- A one-file widget edit should reach a running preview in 3 seconds at the median and 6 seconds at the 95th percentile after caches are warm.
- Preview interaction should maintain 60 frames per second for the benchmark menu on the reference development machine.
- A 1-second, 12-fps deterministic capture should complete within 5 seconds after the preview is loaded.
- The Studio UI must remain responsive during builds and captures.

### 15.2 Reliability

- A failed build must not replace the last successful preview.
- The preview must recover from a crashed WASM module without restarting the Studio application.
- Project writes must be atomic at the individual-file level.
- Export must identify the exact successfully built project revision.
- Deterministic scenarios must produce identical state traces for identical inputs.

### 15.3 Portability

- The MVP Studio application targets current desktop Chromium-based browsers.
- The native parity fixture must support Windows in the MVP.
- Project widget code should remain backend-agnostic unless the manifest declares enhanced rendering.
- Platform and backend assumptions must appear in the portability report.

### 15.4 Usability

- A developer familiar with Dear ImGui should be able to run the starter, change a widget, preview it, and export it within 15 minutes using documentation alone.
- Compilation and runtime errors must be visible without opening browser developer tools.
- The currently previewed revision and whether it matches source must always be visible.
- Enhanced or non-portable behavior must never be enabled silently.

### 15.5 Accessibility of Studio itself

- Studio controls outside the ImGui preview must support keyboard navigation.
- Text editor, build diagnostics, and inspector must expose accessible labels.
- Color must not be the sole indicator of build, preview, or portability state.

## 16. Security and safety

The MVP is local-first because it compiles user-authored C++.

- Build processes must run with a project-scoped working directory.
- Agent source tools must reject paths outside the active project.
- The WASM preview must run in a browser sandbox without unrestricted DOM, network, or filesystem access.
- Imported assets must be decoded with size and format limits.
- Build output must sanitize paths before display or API return.
- Export must not include files outside the project and approved runtime dependencies.
- The Studio service must bind to localhost by default and require an unpredictable session token for mutation endpoints.
- Hosted multi-tenant compilation is explicitly deferred until strong operating-system-level sandboxing is designed and audited.

## 17. Telemetry and success metrics

The local MVP will collect metrics only when explicitly enabled. Development builds may record local diagnostic metrics.

### 17.1 Product success metrics

- Median time from brief to first successful preview.
- Median time from first preview to accepted export.
- Number of agent visual iterations per completed menu.
- Percentage of builds that reuse cached stable objects.
- Browser/native parity failure rate.
- Scenario determinism failure rate.
- Percentage of exported menus integrated into the parity example without manual source modification.
- Human visual-quality rating across benchmark runs.

### 17.2 MVP release targets

- At least 8 of 10 benchmark runs complete without human source edits.
- At least 8 of 10 completed runs receive a visual-quality rating of 4 out of 5 or higher.
- At least 95% of scripted interaction runs are deterministic across three repeats.
- At least 90% of one-file warm builds complete within the 95th-percentile latency target.
- All release fixtures meet the browser/native geometry tolerance.

## 18. Testing strategy

### 18.1 Unit tests

- Animation interpolation and spring integration.
- Deterministic clock behavior.
- Animation key isolation and lifecycle.
- Project manifest validation and migration.
- Scenario parsing and scheduling.
- Asset identifier generation.
- Path confinement and revision conflict handling.
- Inspection serialization.

### 18.2 Integration tests

- Modify source, build, load, render, inspect, and export.
- Failed build retains prior preview.
- Preview crash recovery.
- Font and texture import through native export.
- Scenario action targeting by stable identifier.
- Clean-state capture repeatability.
- Portable project build in native parity fixture.

### 18.3 Visual regression tests

- Capture isolated widget states at fixed viewport, DPI, time, and sample state.
- Capture complete starter and benchmark menus.
- Compare browser and native results.
- Require explicit baseline approval for intended changes.
- Use numeric image comparison as a regression signal, with human review for anti-aliasing and rasterizer differences.

### 18.4 Agent evaluation

- Run fixed briefs covering modern dark, light professional, compact tool, and reference-reproduction designs.
- Measure build failures, number of iterations, unresolved inspection warnings, scenario success, and human visual rating.
- Retain full tool traces for failed evaluations when permitted.

## 19. Delivery milestones

### Milestone 1 — Real preview foundation

Deliverables:

- Repository and build system.
- Pinned Dear ImGui and Emscripten toolchain.
- WebGL2 WASM preview in the Studio shell.
- Local project service and basic source editor.
- Cached build pipeline with structured diagnostics.
- Native parity fixture rendering the same basic custom widget.

Exit criteria:

- A custom draw-list checkbox builds and renders in browser and native examples.
- A source edit reaches the preview through the intended build workflow.

### Milestone 2 — Custom widget and animation loop

Deliverables:

- Interaction and internal API adapter.
- Persistent widget-state storage.
- Tween, easing, and spring animation runtime.
- Deterministic clock and preview controls.
- Stable widget identifiers and structured inspection.
- Pointer and keyboard automation.
- Filmstrip capture.

Exit criteria:

- An animated toggle and slider can be exercised and captured deterministically.
- Three clean repetitions produce identical state traces.

### Milestone 3 — Visual design workflow

Deliverables:

- Reference import, overlay, side-by-side, difference, and measurement tools.
- Font, icon, texture, and asset pipeline.
- Theme source and basic property editor.
- Full editable starter component set.
- Widget gallery and visual regression fixtures.

Exit criteria:

- An agent can construct a cohesive custom menu using only supported tools.
- All starter components expose and pass required state scenarios.

### Milestone 4 — Export and benchmark

Deliverables:

- Exact-source export package.
- Generated asset registration.
- State and event integration example.
- CMake and Windows native parity example.
- Portability report.
- Automated benchmark harness and evaluation rubric.

Exit criteria:

- The reference benchmark satisfies all Section 14 acceptance criteria.
- MVP release targets in Section 17.2 are met.

### Post-MVP — Enhanced rendering

Candidate deliverables:

- First supported enhanced native backend.
- Render-to-texture effect API.
- Blur, bloom, and higher-quality shadow primitives.
- Enhanced browser/native parity tests.
- Video export and advanced animation timeline.

## 20. Key risks and mitigations

### 20.1 Build latency breaks the iteration loop

**Risk:** Rebuilding and relinking WebAssembly after every change is too slow for productive agent iteration.

**Mitigation:** Cache Dear ImGui, runtime, backend, assets, and unchanged project object files; use precompiled headers; measure latency before designing a more complex hot-reload system; keep the starter divided into small translation units.

### 20.2 Browser and native output drift

**Risk:** Font rasterization, DPI behavior, backend differences, or separate assets cause mismatched output.

**Mitigation:** Use identical Dear ImGui source, style, font inputs, textures, viewport, DPI, and project source; provide a native parity fixture; record all versions; add fixed visual regression captures.

### 20.3 Internal ImGui APIs change

**Risk:** Custom widgets rely on unstable `imgui_internal.h` functions.

**Mitigation:** Pin Dear ImGui; isolate common internal calls in versioned adapters; report direct internal use; upgrade versions intentionally with parity and regression testing.

### 20.4 Agent produces visually mediocre output despite tools

**Risk:** Tool access alone does not ensure strong design decisions.

**Mitigation:** Ship high-quality editable foundations; provide reference comparison and structured measurements; require iterative evaluation; maintain design briefs and benchmark examples; expose theme consistency without limiting custom drawing.

### 20.5 Enhanced effects reduce portability

**Risk:** Blur, bloom, and custom shaders bind an export to a rendering backend.

**Mitigation:** Separate portable and enhanced tiers; make dependencies visible before use; keep portable approximations available; generate a clear export report.

### 20.6 Screenshot similarity rewards presentation effects over usable UI

**Risk:** An agent chases bloom, noise, perspective, or background artwork instead of legibility and interaction quality.

**Mitigation:** Allow reference regions to be annotated; evaluate interaction, hierarchy, geometry, and animation separately; never use a single similarity score as the release gate.

### 20.7 Custom C++ execution creates security exposure

**Risk:** Arbitrary source compilation or preview code accesses unintended resources.

**Mitigation:** Remain local-first; constrain project paths; sandbox WASM preview; limit asset decoding; defer hosted compilation until a separately designed isolation model exists.

## 21. Product decisions

The following decisions are final for the MVP:

- The canonical preview uses real Dear ImGui compiled to WebAssembly.
- Agents author real C++ rather than a JSON layout DSL.
- Browser preview and native export use the same menu and widget source.
- WebGL2/OpenGL3 is the initial browser rendering path.
- The MVP is local-first and single-user.
- The MVP uses one pinned Dear ImGui and Emscripten combination.
- Custom `ImDrawList` rendering is a core capability.
- Selected internal functionality is supported through a versioned adapter.
- Raw internal access is allowed but reported as a portability concern.
- Animation is deterministic and first-class.
- Filmstrips and structured state traces are required agent outputs.
- Reference comparison is included in the MVP.
- Fonts, icons, and textures are included in the MVP.
- The portable rendering tier is included in the MVP.
- Enhanced blur and bloom are post-MVP.
- The initial export target and parity fixture are Windows native C++ with CMake.
- Drag-and-drop layout editing is excluded from the MVP.
- Runtime JSON menu interpretation is not the primary export model.
- Visual similarity is a diagnostic, not the sole definition of quality.

## 22. Definition of done

The MVP is complete when:

1. A user can create or open a local Studio project.
2. An agent can read and patch its C++ source through supported tools.
3. The project compiles to WebAssembly and runs real Dear ImGui in the browser.
4. The agent can implement custom interactive widgets using draw-list primitives and supported interaction APIs.
5. The agent can use deterministic tween and spring animations.
6. The agent can perform scripted interactions and inspect animation filmstrips.
7. The agent can inspect widget geometry, state, clipping, identifiers, and diagnostics.
8. The agent can compare the preview against an imported reference image.
9. Fonts, icons, and textures render and export correctly.
10. The exact successful preview source can be exported with its assets, runtime subset, build instructions, and integration contract.
11. The native parity fixture builds and stays within the defined geometry tolerance.
12. The reference benchmark and MVP release targets pass.

