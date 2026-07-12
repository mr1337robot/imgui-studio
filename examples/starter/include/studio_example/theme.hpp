#pragma once

#include <imgui.h>

namespace studio_example {

/// Editable visual tokens for the starter's portable component foundation.
///
/// This header is deliberately project-owned source. Studio may expose a limited token editor for
/// these named values, while component calls may still pass local overrides when a design needs it.
struct Theme final {
    /// Framebuffer color at the top of the starter canvas.
    ImU32 canvasTop{};
    /// Framebuffer color at the bottom of the starter canvas.
    ImU32 canvasBottom{};
    /// Main menu panel fill and outline tokens.
    ImU32 panel{};
    ImU32 panelBorder{};
    /// Reusable card-state fills and outline tokens.
    ImU32 card{};
    ImU32 cardHover{};
    ImU32 cardBorder{};
    /// Typography colors used by primary and supporting labels.
    ImU32 textPrimary{};
    ImU32 textSecondary{};
    /// Brand accent colors. Per-widget C++ overrides remain allowed.
    ImU32 accent{};
    ImU32 accentSecondary{};
    /// Semantic success and warning colors.
    ImU32 positive{};
    ImU32 warning{};
    /// Geometry tokens measured in Dear ImGui screen pixels.
    float panelRoundingPx{};
    float cardRoundingPx{};
    float rowHeightPx{};
    float spacingPx{};
    /// Tween duration in seconds, evaluated from Studio's deterministic clock.
    float animationDurationSeconds{};
};

/// Returns the starter's named default tokens. The value is immutable; callers may copy/override
/// it.
[[nodiscard]] const Theme& DefaultTheme() noexcept;

} // namespace studio_example
