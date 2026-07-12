#pragma once

#include <imgui.h>
#include <string_view>
#include <studio/widget.hpp>

namespace studio {

/// Interpolates packed ImGui RGBA colors component-wise in ImGui's numeric color space.
///
/// @param from Starting packed color.
/// @param to Ending packed color.
/// @param amount Interpolation amount; values outside [0, 1] are clamped.
/// @return The blended packed color. This function is pure and thread-safe.
[[nodiscard]] ImU32 MixColor(ImU32 from, ImU32 to, float amount) noexcept;

/// Emits a rounded four-corner gradient using ordinary draw-list vertices.
///
/// The caller owns `drawList`; this helper retains no references and emits no backend-specific
/// commands. Invalid rectangles produce no commands.
void AddLinearGradient(ImDrawList& drawList, Rect bounds, ImU32 topLeft, ImU32 topRight,
                       ImU32 bottomRight, ImU32 bottomLeft, float rounding = 0.0F);

/// Approximates a portable soft shadow with bounded translucent draw-list layers.
///
/// This is not Gaussian blur. `layers` is clamped to [1, 16] to keep frame cost predictable.
void AddLayeredShadow(ImDrawList& drawList, Rect bounds, ImU32 color, float radius, ImVec2 offset,
                      float rounding, int layers = 8);

/// Approximates a neon glow with bounded expanding transparent rounded rectangles.
///
/// Like `AddLayeredShadow`, this remains portable across the pinned WebGL2 and DX11 backends.
void AddGlow(ImDrawList& drawList, Rect bounds, ImU32 color, float radius, float rounding,
             int layers = 6);

/// Returns a screen-space position that centers a text string inside a rectangle horizontally.
///
/// The current ImGui font is queried at call time; no font pointer is retained.
[[nodiscard]] ImVec2 CenterTextX(Rect bounds, std::string_view text) noexcept;

} // namespace studio
