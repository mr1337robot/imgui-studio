#pragma once

#include <functional>
#include <imgui.h>
#include <string_view>

namespace studio_example {

/// Mutable sample application state for the editable Phase 5 component gallery.
///
/// The object is owned by the platform host. It contains no renderer or
/// platform-specific state and is reset identically in browser and native
/// fixtures.
struct MenuState {
    /// Logical value controlled by the toggle.
    bool enabled{true};
    /// Enables the custom layered shadow helper for preview cards.
    bool layeredShadows{true};
    /// Controls whether the custom modal demonstration is visible.
    bool modalOpen{};
    /// Controls the deterministic toast demonstration.
    bool toastVisible{};
    /// Opens the custom dropdown list.
    bool comboOpen{};
    /// Opens the custom color swatch palette.
    bool colorPickerOpen{};
    /// Places the keybind row in keyboard-capture mode.
    bool keybindCapturing{};
    /// Selected sidebar semantic section.
    int navigationIndex{};
    /// Selected custom tab.
    int tabIndex{};
    /// Selected custom dropdown option.
    int qualityIndex{1};
    /// Custom integer slider value.
    int samples{64};
    /// Custom float slider value.
    float intensity{0.72F};
    /// Custom user-selectable accent color.
    ImU32 accentColor{IM_COL32(235, 35, 255, 255)};
    /// Named ImGui key retained by the custom keybind control.
    std::string_view keybind{"F6"};

    /// Test-only horizontal offset in framebuffer pixels for the negative parity fixture.
    float layoutOffsetXPx{0.0F};
};

/// Canonical widget geometry reported by both rendering hosts.
struct WidgetGeometry {
    /// Left edge in Dear ImGui screen coordinates, measured in framebuffer pixels at 1x DPI.
    float xPx{};
    /// Top edge in Dear ImGui screen coordinates, measured in framebuffer pixels at 1x DPI.
    float yPx{};
    /// Interactive width in pixels.
    float widthPx{};
    /// Interactive height in pixels.
    float heightPx{};
};

/// Structured Phase 1 diagnostics captured after each rendered frame.
struct MenuDiagnostics {
    /// Exact interactive rectangle registered for the toggle in this frame.
    WidgetGeometry toggleBounds{};
    /// Logical value after input for this frame has been processed.
    bool toggleEnabled{};
    /// Visual interpolation value after this frame's animation step.
    float toggleProgress{};
    /// True when the runtime tween has reached its exact target.
    bool toggleSettled{};
};

/// Optional consumer callbacks emitted after the shared menu has rendered one complete frame.
///
/// The caller owns each callable and must keep it valid for the synchronous `RenderMenu` call.
/// Callbacks run on the Dear ImGui render thread and must not recursively render the same menu.
struct MenuEvents final {
    /// Receives the exact diagnostics returned by the current render call.
    std::function<void(const MenuDiagnostics&)> onRendered{};
};

/// Restores the starter project to its canonical sample state.
void ResetMenuState(MenuState& state) noexcept;

/// Renders the shared starter menu into the current Dear ImGui frame.
///
/// @param state Host-owned application and animation state.
/// @param events Synchronous, caller-owned callback bindings; empty bindings have no overhead.
/// @return Geometry and state produced by this exact frame.
[[nodiscard]] MenuDiagnostics RenderMenu(MenuState& state, const MenuEvents& events = {});

/// Returns the build-time identity of the shared starter source.
///
/// The digest covers both `menu.cpp` and this public header. Browser and native capture records
/// compare it so geometry cannot pass by accidentally rendering different source revisions.
/// The returned view points at static compiler-generated storage and remains valid for the process.
[[nodiscard]] std::string_view StarterSourceSha256() noexcept;

} // namespace studio_example
