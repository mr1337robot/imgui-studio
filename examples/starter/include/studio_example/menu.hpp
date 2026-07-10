#pragma once

#include <string_view>

namespace studio_example {

/// Mutable sample application and animation state for the Phase 1 menu.
///
/// The object is owned by the platform host. It contains no renderer or
/// platform-specific state and is reset identically in browser and native
/// fixtures.
struct MenuState {
    /// Logical value controlled by the toggle.
    bool enabled{true};

    /// Current visual interpolation in [0, 1], independent of `enabled` while animating.
    float toggleProgress{1.0F};

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
};

/// Restores the starter project to its canonical sample state.
void ResetMenuState(MenuState& state) noexcept;

/// Renders the shared starter menu into the current Dear ImGui frame.
///
/// @param state Host-owned application and animation state.
/// @param deltaSeconds Non-negative frame delta in seconds.
/// @return Geometry and state produced by this exact frame.
[[nodiscard]] MenuDiagnostics RenderMenu(MenuState& state, float deltaSeconds);

/// Returns the build-time identity of the shared starter source.
///
/// The digest covers both `menu.cpp` and this public header. Browser and native capture records
/// compare it so geometry cannot pass by accidentally rendering different source revisions.
/// The returned view points at static compiler-generated storage and remains valid for the process.
[[nodiscard]] std::string_view StarterSourceSha256() noexcept;

} // namespace studio_example
