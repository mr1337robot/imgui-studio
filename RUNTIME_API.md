# ImGui Studio — Runtime API

**Status:** Implementation contract

**Version:** 1.0

**Date:** July 9, 2026

**Depends on:** `PRD.md`, `TECHNICAL_DESIGN.md`, `ANIMATION_SPEC.md`

## 1. Purpose

This document defines the public C++20 runtime used by project widgets in both the WebAssembly preview and native exports. It is the contract for WP3.1–WP3.3 and the runtime portions of WP4.1 and WP5.

The API exists to make custom widgets observable, deterministic, and portable without preventing direct Dear ImGui or `ImDrawList` use. It is not a replacement UI framework and does not generate visible stock widgets.

## 2. Compatibility and versioning

The public headers live under `runtime/include/studio/` and use namespace `studio`.

```cpp
#include <studio/runtime.hpp>      // context and frame lifecycle
#include <studio/widget.hpp>       // item registration and interaction
#include <studio/state.hpp>        // persistent widget-local state
#include <studio/animation.hpp>    // tween, spring, sequence, clock
#include <studio/inspection.hpp>   // semantic inspection metadata
#include <studio/assets.hpp>       // logical font and texture handles
#include <studio/draw.hpp>         // optional portable draw helpers
```

The runtime follows semantic versioning:

- Major: source or behavioral incompatibility in the public API.
- Minor: backward-compatible functions, fields, diagnostics, or enum values.
- Patch: bug fixes that do not intentionally alter specified output.

Every build records `STUDIO_RUNTIME_VERSION`, the exact Dear ImGui version, and the adapter version. A project may test compatibility at compile time:

```cpp
static_assert(STUDIO_RUNTIME_VERSION_MAJOR == 1);
```

Serialized inspection and protocol schemas are independently versioned. C++ ABI stability is not promised across runtime releases; project source and the selected runtime subset are compiled together. Public structs must not cross a DLL boundary in the MVP.

## 3. Architectural invariants

1. Project widget/menu source is identical for browser and native builds.
2. Runtime APIs contain no browser, Win32, DirectX, or OpenGL types.
3. A `ProjectContext` belongs to one Dear ImGui context and one preview/native instance.
4. All runtime calls occur on the thread rendering that ImGui context.
5. Inspection may be disabled, but disabling it cannot change layout, input, animation, or drawing.
6. Deterministic mode never reads wall-clock time.
7. Invalid project input produces an inert result and a diagnostic where recovery is safe; programmer lifecycle violations assert in debug builds.

## 4. Core types

```cpp
namespace studio {

using PropertyKey = std::uint64_t;

constexpr PropertyKey Key(std::string_view text) noexcept;

struct Rect {
    ImVec2 min;
    ImVec2 max;

    [[nodiscard]] ImVec2 Size() const noexcept;
    [[nodiscard]] ImVec2 Center() const noexcept;
    [[nodiscard]] bool IsFinite() const noexcept;
    [[nodiscard]] bool HasPositiveArea() const noexcept;
};

enum class RuntimeMode : std::uint8_t {
    Realtime,
    Deterministic,
};

enum class Severity : std::uint8_t { Info, Warning, Error, Fatal };

enum class DiagnosticCode : std::uint16_t {
    InvalidLifecycle,
    InvalidBounds,
    DuplicateStableId,
    ImGuiIdCollision,
    InvalidPropertyKey,
    PropertyTypeMismatch,
    InvalidAnimationParameter,
    NonFiniteAnimationValue,
    MissingAsset,
    UnsupportedAssetType,
    UnbalancedWidgetScope,
};

struct Diagnostic {
    Severity severity;
    DiagnosticCode code;
    std::string_view stableId;
    std::string_view message;
};

} // namespace studio
```

For non-empty input, `Key()` applies FNV-1a to the UTF-8 bytes with 64-bit unsigned wraparound, offset basis `14695981039346656037`, and prime `1099511628211`. If the final value is zero, it returns one because zero is reserved as invalid. Empty input returns zero and is rejected by state/animation APIs with `InvalidPropertyKey`. The result is stable across targets and processes. A debug build stores the original property string and reports two different strings that hash to the same value. Public code must use `Key("literal")` or a non-empty project-owned stable string; pointer addresses are never valid keys.

`Rect` uses framebuffer-independent ImGui screen coordinates, matching `ImGui::GetCursorScreenPos()`. It is converted to the pinned adapter's rectangle internally so project headers need not expose `ImRect`.

## 5. Context ownership and lifecycle

### 5.1 Project context

```cpp
namespace studio {

struct ProjectContextConfig {
    RuntimeMode mode = RuntimeMode::Realtime;
    std::uint32_t hiddenStateRetentionFrames = 600;
    double hiddenStateRetentionSeconds = 10.0;
    bool inspectionEnabled = true;
    bool diagnosticsEnabled = true;
};

class ProjectContext final {
public:
    explicit ProjectContext(ImGuiContext& imgui, ProjectContextConfig config = {});
    ~ProjectContext();

    ProjectContext(const ProjectContext&) = delete;
    ProjectContext& operator=(const ProjectContext&) = delete;

    [[nodiscard]] ImGuiContext& ImGuiContextRef() noexcept;
    [[nodiscard]] RuntimeMode Mode() const noexcept;
    [[nodiscard]] Clock& Time() noexcept;
    [[nodiscard]] AssetRegistry& Assets() noexcept;
    [[nodiscard]] InspectionContext& Inspection() noexcept;

    void ResetRuntimeState();
    void CollectGarbage();
};

struct FrameParams {
    std::uint64_t frameIndex;
    std::int64_t absoluteTimeUs;
    std::int64_t deltaTimeUs;
    ImVec2 viewportPixels;
    float dpiScale;
};

void BeginFrame(ProjectContext& context, const FrameParams& params);
void EndFrame(ProjectContext& context);

[[nodiscard]] ProjectContext& CurrentContext();

} // namespace studio
```

The host constructs one context after creating its `ImGuiContext`, then calls project `Initialize`. Per frame it sets the corresponding ImGui context, prepares `ImGuiIO`, calls `BeginFrame`, executes project rendering, calls `EndFrame`, and only then renders draw data. `CurrentContext()` is valid only between `BeginFrame` and `EndFrame` on the rendering thread.

`BeginFrame` validates time according to `ANIMATION_SPEC.md`, opens the inspection frame, and installs the current context. `EndFrame` closes outstanding diagnostic/inspection bookkeeping and uninstalls it. Nested frames, mismatched contexts, or cross-thread calls are lifecycle errors.

The host owns `ProjectContext`. References and handles returned by it become invalid at destruction. `ResetRuntimeState()` clears widget state, animation state, inspection history, pending runtime input state, and the Studio clock; it does not reset project sample/application state. The host reset sequence is specified in `ANIMATION_SPEC.md`.

### 5.2 Canonical project bridge

Studio projects expose:

```cpp
namespace project {
void Initialize(studio::ProjectContext& context);
void ResetSampleState(studio::ProjectContext& context);
void Render(studio::ProjectContext& context);
void Shutdown(studio::ProjectContext& context);
}
```

`Initialize` and `Shutdown` run exactly once per preview instance. `ResetSampleState` must restore every project-owned design-time variable to its named sample-state defaults and must not retain pointers into runtime storage. Native consumers may call the user-facing menu function directly instead of this Studio bridge.

## 6. Widget registration and interaction

### 6.1 Registration model

Every inspectable custom widget has two identities:

- `imguiId`: the interaction identity produced by the normal ImGui ID stack.
- `stableId`: a project-wide semantic UTF-8 identifier used by automation and inspection, such as `settings.enable`.

Stable IDs must be non-empty, remain unchanged across frames, and be unique among widgets registered in a frame. They are not used to calculate the ImGui ID. Dynamic repeated rows must include a stable application key rather than a row index that changes after sorting.

```cpp
namespace studio {

enum class ItemFlags : std::uint32_t {
    None            = 0,
    Disabled        = 1u << 0,
    AllowOverlap    = 1u << 1,
    NoNavigation    = 1u << 2,
    NoFocusOnClick  = 1u << 3,
};

constexpr ItemFlags operator|(ItemFlags, ItemFlags) noexcept;
constexpr bool HasFlag(ItemFlags, ItemFlags) noexcept;

struct WidgetDescriptor {
    std::string_view stableId;
    std::string_view semanticType;
    ImGuiID imguiId;
    Rect bounds;
    std::optional<Rect> hitbox = std::nullopt; // interaction bounds; defaults to bounds
    ImVec2 layoutSize{-1.0f, -1.0f}; // negative components use bounds.Size()
    ItemFlags flags = ItemFlags::None;
    std::string_view parentStableId = {};
};

struct Interaction {
    bool registered = false;    // passed clipping/item-add checks
    bool visible = false;
    bool clipped = false;
    bool hovered = false;
    bool held = false;
    bool pressed = false;       // ImGui activation on this frame
    bool clicked = false;       // pointer click completed on this item this frame
    bool active = false;
    bool focused = false;
    bool navFocused = false;
    bool navActivated = false;
    bool disabled = false;
};

[[nodiscard]] Interaction Interact(const WidgetDescriptor& descriptor);
[[nodiscard]] bool RegisterItem(const WidgetDescriptor& descriptor);

} // namespace studio
```

`Interact` performs layout sizing, item addition, supported button behavior, and inspection registration exactly once. `RegisterItem` performs layout/item/inspection registration without button behavior for passive content. Code must not call both for the same item in a frame. Each negative `layoutSize` component is replaced by the corresponding `bounds.Size()` component; zero is a deliberate zero-size layout component. Item layout uses `bounds`; button behavior and overlap analysis use `hitbox.value_or(bounds)`. Both rectangles must be finite with positive area for an interactive item.

The adapter follows the pinned Dear ImGui behavior for mouse and navigation activation. `pressed` is the behavioral activation event and may originate from pointer or navigation; widget code is responsible for mutating its application value. `clicked` is the completed pointer-click observation for inspection, while `navActivated` indicates navigation-origin activation. `active` mirrors the item's current ImGui active-ID state; `focused` and `navFocused` report keyboard/focus and navigation focus according to the pinned adapter. Disabled or clipped items return `pressed == false`, `clicked == false`, and `held == false`.

Invalid or non-finite bounds cause `InvalidBounds`, do not call internal ImGui item functions, and return an inert result. A duplicate `stableId` reports an error-severity `DuplicateStableId`; both items still render for diagnosis, but automation by that stable ID fails as ambiguous and the frame cannot pass validation. Reuse of an `imguiId` for incompatible registered bounds/type in the same frame reports a likely `ImGuiIdCollision`.

### 6.2 Inspection scope and metadata

Additional metadata is attached explicitly:

```cpp
namespace studio {

enum class InspectFlags : std::uint32_t {
    None             = 0,
    AutomationTarget = 1u << 0,
    AllowsOverlap    = 1u << 1,
};

struct InspectionDescriptor {
    std::string_view stableId;
    std::string_view type;
    Rect bounds;
    std::optional<Rect> hitbox = std::nullopt;
    InspectFlags flags = InspectFlags::None;
    std::string_view parentStableId = {};
    std::string_view label = {};
    ImGuiID imguiId = 0;
};

class WidgetScope final {
public:
    ~WidgetScope();
    WidgetScope(const WidgetScope&) = delete;
    WidgetScope& operator=(const WidgetScope&) = delete;
    WidgetScope(WidgetScope&& other) noexcept;
    WidgetScope& operator=(WidgetScope&&) = delete;

    void SetInteraction(const Interaction& interaction);
    void SetBool(std::string_view name, bool value);
    void SetAnimation(std::string_view name, float value, bool settled);
    void Baseline(float screenY);
    void ContentBounds(Rect bounds);
    void Padding(ImVec2 minimum, ImVec2 maximum);
    void State(std::string_view name, bool value);
    void Value(std::string_view name, double value);
    void Text(std::string_view name, std::string_view value);
    void Warning(std::string_view message);

private:
    friend WidgetScope InspectWidget(const InspectionDescriptor& descriptor);
    explicit WidgetScope(const InspectionDescriptor& descriptor);
};

[[nodiscard]] WidgetScope InspectWidget(const InspectionDescriptor& descriptor);

} // namespace studio
```

`WidgetScope` is optional for interaction but required when child inspection hierarchy or extra metadata is desired. `InspectWidget` may be called immediately before or after `Interact`; matching `stableId`, geometry, type, and ImGui ID fields are merged into one inspection node, not registered twice. A mismatch reports a diagnostic. Registration order is the order of the first call for that node. Its destructor closes the semantic scope. Inspection-disabled builds inline these operations to no-ops while keeping scope placement harmless.

Stable IDs must match `^[a-z][a-z0-9]*(\.[a-z][a-z0-9-]*)+$`, be globally unique within a frame, and remain stable across edits that do not semantically replace a widget. They must not contain translated labels, pointers, random values, or reorderable list indices. A semantic parent uses the same grammar.

Metadata strings are copied into frame-owned storage and need only remain valid for the call. Per-widget metadata is bounded by host configuration; excess entries produce a diagnostic and are omitted.

### 6.3 Complete custom toggle example

```cpp
bool AnimatedToggle(
    const char* label,
    std::string_view stableId,
    bool* value,
    const ToggleStyle& style)
{
    ImGui::PushID(label);
    const ImGuiID id = ImGui::GetID("##toggle");
    const ImVec2 pos = ImGui::GetCursorScreenPos();
    const studio::Rect bounds{
        pos,
        {pos.x + style.size.x, pos.y + style.size.y},
    };

    const studio::WidgetDescriptor descriptor{
        .stableId = stableId,
        .semanticType = "animated_toggle",
        .imguiId = id,
        .bounds = bounds,
        .layoutSize = style.size,
    };

    const studio::Interaction interaction = studio::Interact(descriptor);
    if (interaction.pressed)
        *value = !*value;

    const float active = studio::Animate(
        id, studio::Key("active"), *value ? 1.0f : 0.0f,
        {.duration = 0.22, .ease = studio::Ease::OutCubic});
    const float hover = studio::Spring(
        id, studio::Key("hover"), interaction.hovered ? 1.0f : 0.0f,
        {.stiffness = 240.0, .damping = 22.0});

    ImDrawList* draw = ImGui::GetWindowDrawList();
    const ImU32 track = studio::MixColor(style.off, style.on, active);
    draw->AddRectFilled(bounds.min, bounds.max, track, style.rounding);

    const float radius = style.knobRadius + hover * style.hoverGrow;
    const float x = ImLerp(bounds.min.x + style.knobRadius,
                           bounds.max.x - style.knobRadius, active);
    draw->AddCircleFilled({x, bounds.Center().y}, radius, style.knob);

    auto inspect = studio::InspectWidget({
        .stableId = stableId,
        .type = "animated_toggle",
        .bounds = bounds,
        .hitbox = bounds,
        .flags = studio::InspectFlags::AutomationTarget,
        .imguiId = id,
    });
    inspect.SetInteraction(interaction);
    inspect.SetBool("value", *value);
    inspect.SetAnimation(
        "active", active,
        studio::GetAnimationStatus(id, studio::Key("active")).settled);

    ImGui::PopID();
    return interaction.pressed;
}
```

Visible rendering is entirely project-authored. Studio supplies interaction, time/state, and observability only.

## 7. Persistent widget-local state

Custom widgets sometimes need state beyond an application value or animation. Runtime state is keyed by `(ProjectContext instance, ImGuiID, PropertyKey)`.

```cpp
namespace studio {

template <class T>
class StateRef final {
public:
    [[nodiscard]] T& Get() noexcept;
    [[nodiscard]] T* operator->() noexcept;
    [[nodiscard]] T& operator*() noexcept;
};

template <class T>
[[nodiscard]] StateRef<T> WidgetState(
    ImGuiID widget,
    PropertyKey property,
    const T& initialValue = T{});

void EraseWidgetState(ImGuiID widget, PropertyKey property);
void EraseAllWidgetState(ImGuiID widget);

} // namespace studio
```

Supported `T` in v1 is a trivially copyable, trivially destructible type of at most 64 bytes with alignment no greater than `alignof(std::max_align_t)`. The implementation assigns a stable type tag per `T`. Requesting the same key with a different type reports `PropertyTypeMismatch`, returns a frame-owned inert fallback initialized from `initialValue`, and does not reinterpret stored bytes. Mutations to that fallback are discarded at `EndFrame`.

`StateRef` remains valid until its entry is erased, the runtime is reset, or the context is destroyed. It must not be stored in application state or across those operations. Runtime state is not serialized and must not hold owning pointers or backend resources.

Every access marks the entry live for the current frame. Garbage collection removes entries not accessed for both configured retention thresholds: in realtime, frames and elapsed Studio time; in deterministic operation, frames and deterministic time. Temporary clipping or conditional hiding therefore does not immediately reset a transition. `Erase*` is required when a semantic entity is permanently deleted and its ImGui ID may be reused.

## 8. Animation API

Detailed equations, timing, reset, seek, and invalid-parameter behavior are normative in `ANIMATION_SPEC.md`.

```cpp
namespace studio {

enum class Ease : std::uint8_t {
    Linear,
    InQuad, OutQuad, InOutQuad,
    InCubic, OutCubic, InOutCubic,
    InSine, OutSine, InOutSine,
};

struct TweenOptions {
    double duration = 0.20;     // seconds
    double delay = 0.0;         // seconds
    Ease ease = Ease::OutCubic;
};

struct SpringOptions {
    double stiffness = 240.0;   // N/m with unit mass
    double damping = 22.0;      // N*s/m with unit mass
    double delay = 0.0;         // seconds
    double positionEpsilon = 1e-4;
    double velocityEpsilon = 1e-3;
};

[[nodiscard]] float Animate(ImGuiID, PropertyKey, float target,
                            TweenOptions = {});
[[nodiscard]] ImVec2 Animate(ImGuiID, PropertyKey, ImVec2 target,
                             TweenOptions = {});
[[nodiscard]] ImVec4 Animate(ImGuiID, PropertyKey, ImVec4 target,
                             TweenOptions = {});

[[nodiscard]] float Spring(ImGuiID, PropertyKey, float target,
                           SpringOptions = {});
[[nodiscard]] ImVec2 Spring(ImGuiID, PropertyKey, ImVec2 target,
                            SpringOptions = {});

void SetAnimationInitialValue(ImGuiID, PropertyKey, float value);
void SetAnimationInitialValue(ImGuiID, PropertyKey, ImVec2 value);
void SetAnimationInitialValue(ImGuiID, PropertyKey, ImVec4 value);
[[nodiscard]] bool SetAnimationInitialValueIfAbsent(
    ImGuiID, PropertyKey, float value);
[[nodiscard]] bool SetAnimationInitialValueIfAbsent(
    ImGuiID, PropertyKey, ImVec2 value);
[[nodiscard]] bool SetAnimationInitialValueIfAbsent(
    ImGuiID, PropertyKey, ImVec4 value);
void ResetAnimation(ImGuiID, PropertyKey);
void ResetAnimations(ImGuiID);

struct AnimationStatus {
    bool exists;
    bool delayed;
    bool settled;
    double elapsedSeconds;
    double velocityMagnitude;
};

[[nodiscard]] AnimationStatus GetAnimationStatus(ImGuiID, PropertyKey);

} // namespace studio
```

The first call initializes output to `target` unless an initial value was installed earlier in the same runtime context. This prevents an unwanted startup transition by default. Because an `ImGuiID` commonly exists only while rendering under its final ImGui ID stack, entrance animations normally call `SetAnimationInitialValueIfAbsent` immediately before the primitive in widget code. `SetAnimationInitialValue` is the strict form and diagnoses an existing entry; the `IfAbsent` form returns `true` only when it creates the entry and otherwise leaves a compatible entry unchanged. When a target changes, a tween starts from its current output and a spring preserves its current position and velocity. A property key may not switch value type or animation primitive without reset; doing so reports a type mismatch and returns the prior compatible value.

Compatibility overloads required by the PRD are provided:

```cpp
float Animate(ImGuiID id, std::string_view key, float target,
              float durationSeconds, Ease ease);
float Spring(ImGuiID id, std::string_view key, float target,
             float stiffness, float damping);
```

String overloads hash through `Key` and are convenient for project code; `PropertyKey` overloads avoid repeated debug-string processing in hot paths.

### 8.1 Delay and simple sequence composition

```cpp
namespace studio {

struct SequenceStep {
    double duration;
    double delayBefore = 0.0;
    Ease ease = Ease::OutCubic;
    float target;
};

[[nodiscard]] float Sequence(
    ImGuiID widget,
    PropertyKey property,
    std::span<const SequenceStep> steps,
    float initialValue,
    bool restartWhenStepsChange = true);

} // namespace studio
```

The v1 sequence is a one-shot float timeline. It starts when first called, evaluates steps in order, holds the last target, and is reset with `ResetAnimation`. Empty sequences return `initialValue` and are settled. Looping, callbacks, and arbitrary animation graphs are intentionally excluded from v1.

## 9. Clock API

```cpp
namespace studio {

class Clock final {
public:
    [[nodiscard]] RuntimeMode Mode() const noexcept;
    [[nodiscard]] std::int64_t NowUs() const noexcept;
    [[nodiscard]] std::int64_t DeltaUs() const noexcept;
    [[nodiscard]] double NowSeconds() const noexcept;
    [[nodiscard]] double DeltaSeconds() const noexcept;
    [[nodiscard]] std::uint64_t FrameIndex() const noexcept;
    [[nodiscard]] bool Paused() const noexcept;
};

[[nodiscard]] const Clock& Time();

} // namespace studio
```

Project code reads but never mutates the clock. The host owns play, pause, speed, step, reset, and replay. Protocol times are signed integer microseconds; invalid negative times are rejected before `BeginFrame`. Realtime host delta is quantized to microseconds before it enters the runtime.

## 10. Asset API

```cpp
namespace studio {

struct TextureHandle {
    ImTextureID id{};
    ImVec2 pixelSize{};
    bool valid = false;
};

struct FontHandle {
    ImFont* font = nullptr;
    float configuredPixelSize = 0.0f;
    bool valid = false;
};

class AssetRegistry final {
public:
    [[nodiscard]] TextureHandle Texture(std::string_view logicalId) const;
    [[nodiscard]] FontHandle Font(std::string_view logicalId) const;
    [[nodiscard]] bool Contains(std::string_view logicalId) const;
};

} // namespace studio
```

Logical IDs come from generated asset metadata and are identical across targets. Missing assets return invalid handles and emit one deduplicated `MissingAsset` diagnostic per asset per frame. Project widgets must handle invalid assets without dereferencing null pointers. Handles are owned by the host and valid until preview shutdown or an explicit host-side asset reload; the MVP replaces the preview instance rather than hot-reloading handles in place.

## 11. Portable drawing helpers

Helpers produce ordinary `ImDrawList` commands and are optional:

```cpp
namespace studio {

[[nodiscard]] ImU32 MixColor(ImU32 a, ImU32 b, float t) noexcept;

void AddLinearGradient(ImDrawList&, Rect, ImU32 topLeft, ImU32 topRight,
                       ImU32 bottomRight, ImU32 bottomLeft,
                       float rounding = 0.0f);
void AddLayeredShadow(ImDrawList&, Rect, ImU32 color, float blurRadius,
                      ImVec2 offset, float rounding, int layers = 8);
void AddGlow(ImDrawList&, Rect, ImU32 color, float radius,
             float rounding, int layers = 6);

[[nodiscard]] ImVec2 CenterTextX(Rect, std::string_view text) noexcept;

} // namespace studio
```

These are portable approximations, not renderer blur/bloom. Invalid or non-positive geometry and
radii produce no draw commands. Shadow and glow layer counts are clamped to `[1, 16]` so their
frame cost remains bounded. `AddLinearGradient` uses Dear ImGui's four-corner vertex gradient;
rounded callers may layer their own border/fill because the underlying primitive has no rounded
gradient mode. `CenterTextX` queries the current ImGui font and returns a horizontal center
position; it retains no font pointer. Color interpolation is component-wise in the numeric ImGui
color space; it does not silently perform gamma conversion.

## 12. Error and diagnostic behavior

The public runtime does not throw exceptions. Export builds may compile with exceptions disabled.

- Recoverable invalid inputs return an inert/invalid result and append a bounded diagnostic.
- Invalid enum values and non-finite animation parameters are recoverable in release and assertions in debug.
- Lifecycle misuse, such as nested `BeginFrame`, asserts in debug and marks the preview frame fatal in Studio builds.
- Allocation failure is fatal to the preview instance.
- Diagnostics are deduplicated by `(frame, code, stableId/property)` and capped by host configuration.
- No diagnostic message may contain host absolute paths, asset bytes, or application secrets.

Runtime diagnostics attach to project/build/preview/frame identity at the protocol boundary. They do not use service HTTP error codes; a frame can render successfully while carrying warnings.

## 13. Threading, allocation, and performance

- Runtime calls are render-thread only in v1.
- Contexts do not share mutable state.
- Project callbacks must not retain `string_view`, `span`, `WidgetScope`, `StateRef`, or inspection pointers beyond their documented lifetime.
- `Interact`, animation lookup, and state lookup should perform no allocation after a property has been seen once.
- Per-frame inspection allocation uses frame arenas and is released after serialization/capture.
- State/animation maps reserve capacity from project configuration and may grow deterministically; iteration order is never exposed as semantic ordering.
- Runtime code must compile for wasm32 and MSVC C++20 without target-specific project defines beyond the generated configuration header.

## 14. Browser/native determinism contract

Given the same:

- project source and runtime/ImGui versions;
- initial sample state and reset order;
- font/asset inputs;
- viewport and DPI;
- ordered input events;
- absolute and delta microsecond sequence;
- compiler floating-point contract;

the browser and native runtime must produce matching application state and animation traces. Exact floating-point bit identity is not required; scalar animation values must differ by at most `1e-5`, and settled flags and interaction events must match exactly. Layout geometry must satisfy the PRD two-pixel parity tolerance.

Builds used for parity disable fast-math, floating-point contraction, and target-specific approximate transcendental intrinsics. Easing implementations use the formulas in `ANIMATION_SPEC.md`, not platform library convenience functions when those could differ materially.

## 15. Required tests

### 15.1 Unit tests

- `Rect` finite/area validation and adapter conversion.
- Stable property hashing and debug collision reporting.
- Context begin/end/reset and invalid lifecycle behavior.
- State isolation by context, ImGui ID, property, and type.
- State retention, explicit erasure, and deterministic collection.
- Interaction for visible, clipped, disabled, hovered, held, pressed, navigation, and overlap cases.
- Duplicate stable IDs and likely ImGui ID collision diagnostics.
- Asset success/missing behavior.
- Inspection-disabled geometry and interaction equivalence.
- Every animation case listed in `ANIMATION_SPEC.md`.

### 15.2 Integration and parity fixtures

- One custom toggle using no visible stock checkbox implementation.
- Two same-named widgets under different ImGui ID scopes do not share state.
- Scripted mouse and navigation activation mutate the intended value once.
- Hiding a widget within retention does not lose its transition state.
- Reset restores sample state and runtime state independently in the specified order.
- Browser and native runs at fixed timestamps match traces within tolerance.
- Release export compiles with inspection disabled and preserves screenshot geometry.

## 16. Acceptance criteria

This API is implementation-ready and accepted when:

1. All public declarations above exist under `runtime/include/studio/` and compile on wasm32/Emscripten and Windows/MSVC C++20.
2. The custom toggle example can be implemented without `ImGui::Checkbox` and is targetable by stable ID.
3. Disabled and clipped items cannot activate; duplicate IDs are diagnosed.
4. Widget state and animation properties are isolated and survive temporary hiding according to policy.
5. Tween, spring, delay, sequence, reset, and status APIs satisfy `ANIMATION_SPEC.md` tests.
6. Inspection can be compiled out without changing layout, events, animation traces, or draw-command geometry.
7. Three clean deterministic runs produce identical event/state traces.
8. Browser/native animation values satisfy the `1e-5` tolerance at all fixture timestamps.
9. Exported project code needs no browser-specific branch and uses only the documented runtime subset.

## 17. Cross-document ownership

- Product scope and release criteria: `PRD.md`.
- Processes, preview frame order, build identity, and module boundaries: `TECHNICAL_DESIGN.md`.
- Work packages and phase gates: `MVP_IMPLEMENTATION_PLAN.md`.
- Normative animation math, clock, reset, replay, and capture: `ANIMATION_SPEC.md`.
- Service/agent transport contracts: `AGENT_TOOL_API.md`.
- Widget tree serialization and diagnostic schema: `INSPECTION_PROTOCOL.md`.
- Native packaging and consumer integration: `EXPORT_AND_INTEGRATION.md`.
