#pragma once

#include <span>
#include <string_view>
#include <studio_example/theme.hpp>

namespace studio_example::components {

/// Custom-drawn toggle dimensions and optional local visual overrides.
///
/// `size` is measured in Dear ImGui screen pixels. The caller owns the value and may use a local
/// override without changing the shared `Theme`; both browser and native hosts compile this type.
struct ToggleStyle final {
    ImVec2 size{52.0F, 26.0F};
    float knobRadius{9.0F};
};

/// Custom-drawn slider value range and formatting options.
///
/// The range must be finite and strictly increasing. An invalid range renders an inert zero-fill
/// control and is intentionally not silently repaired because a bad project token needs to remain
/// diagnosable.
struct SliderOptions final {
    float minimum{};
    float maximum{1.0F};
    int precision{1};
};

/// Draws and interacts with a themed custom toggle; returns true only for a press this frame.
///
/// @param stableId Project-wide inspection and automation identity. It must remain stable across
/// semantic-preserving edits.
/// @param value Application-owned state mutated only after a Studio interaction press.
/// @return `true` exactly when the value was toggled in the current render frame.
[[nodiscard]] bool Toggle(std::string_view stableId, std::string_view label, bool& value,
                          ImVec2 position, const Theme& theme, ToggleStyle style = {});
/// Draws and interacts with a themed custom float slider without a visible stock ImGui slider.
/// @return `true` when pointer dragging changed `value` in the current frame.
[[nodiscard]] bool SliderFloat(std::string_view stableId, std::string_view label, float& value,
                               ImVec2 position, float widthPx, SliderOptions options,
                               const Theme& theme);
/// Draws and interacts with a themed custom integer slider without a visible stock ImGui slider.
/// @return `true` when pointer dragging changed the rounded integer value in the current frame.
[[nodiscard]] bool SliderInt(std::string_view stableId, std::string_view label, int& value,
                             ImVec2 position, float widthPx, int minimum, int maximum,
                             const Theme& theme);
/// Draws a selectable sidebar row and returns true when it becomes active.
[[nodiscard]] bool NavigationItem(std::string_view stableId, std::string_view label, bool active,
                                  ImVec2 position, ImVec2 size, const Theme& theme);
/// Draws a custom tab segment and returns true when selected.
[[nodiscard]] bool Tab(std::string_view stableId, std::string_view label, bool active,
                       ImVec2 position, ImVec2 size, const Theme& theme);
/// Draws a custom dropdown and its popup list; options are immutable labels owned by the caller.
/// The options span is consumed synchronously and is never retained beyond this function call.
[[nodiscard]] bool Combo(std::string_view stableId, std::string_view label, int& selected,
                         bool& open, std::span<const std::string_view> options, ImVec2 position,
                         float widthPx, const Theme& theme);
/// Draws a custom keybind capture row and records the first named ImGui key pressed while active.
/// `keyName` must reference application-owned storage whose lifetime outlives this frame.
[[nodiscard]] bool Keybind(std::string_view stableId, std::string_view label,
                           std::string_view& keyName, bool& capturing, ImVec2 position,
                           float widthPx, const Theme& theme);
/// Draws a color trigger and an in-place custom swatch palette popup.
[[nodiscard]] bool ColorPicker(std::string_view stableId, std::string_view label, ImU32& color,
                               bool& open, ImVec2 position, float widthPx, const Theme& theme);
/// Draws a custom primary/secondary button and returns true on press.
[[nodiscard]] bool Button(std::string_view stableId, std::string_view label, ImVec2 position,
                          ImVec2 size, bool primary, const Theme& theme);
/// Draws a compact custom icon action button using a portable glyph supplied by the caller.
[[nodiscard]] bool IconButton(std::string_view stableId, std::string_view glyph, ImVec2 position,
                              float sizePx, const Theme& theme);
/// Draws a card surface with a portable shadow and returns its content rectangle.
/// The caller retains ownership of the draw list and uses the returned inset for child placement.
[[nodiscard]] studio::Rect Card(ImDrawList& drawList, studio::Rect bounds, const Theme& theme,
                                bool highlighted = false);
/// Draws a non-interactive toast with deterministic entrance/exit animation driven by `visible`.
/// Its animation uses the Studio frame clock, never host wall-clock time.
void Toast(std::string_view stableId, std::string_view message, bool visible, ImVec2 position,
           float widthPx, const Theme& theme);
/// Draws a custom modal shell and custom close button when open.
[[nodiscard]] bool Modal(std::string_view stableId, std::string_view title, bool& open,
                         studio::Rect bounds, const Theme& theme);

} // namespace studio_example::components
