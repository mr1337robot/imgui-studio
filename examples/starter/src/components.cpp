/**
 * Portable custom-drawn component foundation used by the editable starter. The functions in this
 * file intentionally use Dear ImGui only for input/ID/layout participation; visible controls are
 * all emitted through ImDrawList so the same source renders on the WebGL2 and DX11 fixtures.
 */
#include <algorithm>
#include <array>
#include <cmath>
#include <cstdio>
#include <imgui.h>
#include <string>
#include <studio/studio.hpp>
#include <studio_example/components.hpp>

namespace studio_example {
namespace {

[[nodiscard]] ImGuiID ItemId(const std::string_view stableId) {
    return ImGui::GetID(stableId.data(), stableId.data() + stableId.size());
}

[[nodiscard]] studio::Rect Bounds(const ImVec2 position, const ImVec2 size) {
    return {position, {position.x + size.x, position.y + size.y}};
}

[[nodiscard]] studio::Interaction
InteractAt(const std::string_view stableId, const std::string_view type, const ImVec2 position,
           const ImVec2 size, const studio::ItemFlags flags = studio::ItemFlags::None) {
    ImGui::SetCursorScreenPos(position);
    return studio::Interact({.stableId = stableId,
                             .semanticType = type,
                             .imguiId = ItemId(stableId),
                             .bounds = Bounds(position, size),
                             .hitbox = Bounds(position, size),
                             .layoutSize = size,
                             .flags = flags});
}

void DrawLabel(ImDrawList& drawList, ImVec2 position, std::string_view label, const Theme& theme);
[[nodiscard]] float NormalizedPointerX(studio::Rect bounds);
void DrawValueText(ImDrawList& drawList, studio::Rect bounds, std::string_view value,
                   const Theme& theme);

/**
 * Draws the value-to-track portion shared by the public numeric sliders. The wrapper functions
 * choose the semantic type before this helper registers the item, so inspection can distinguish
 * an integer from a float even though their geometry is intentionally similar.
 */
[[nodiscard]] bool Slider(const std::string_view stableId, const std::string_view semanticType,
                          const std::string_view label, float& value, const ImVec2 position,
                          const float widthPx, const components::SliderOptions options,
                          const Theme& theme) {
    const ImVec2 size{widthPx, theme.rowHeightPx};
    const studio::Interaction interaction = InteractAt(stableId, semanticType, position, size);
    const studio::Rect bounds = Bounds(position, size);
    const studio::Rect track{{bounds.min.x, bounds.max.y - 7.0F},
                             {bounds.max.x, bounds.max.y - 3.0F}};
    bool changed = false;
    if (interaction.held && options.maximum > options.minimum) {
        const float normalized = NormalizedPointerX(track);
        const float next = options.minimum + ((options.maximum - options.minimum) * normalized);
        changed = std::abs(next - value) > 0.0001F;
        value = next;
    }
    const float normalized =
        options.maximum <= options.minimum
            ? 0.0F
            : std::clamp((value - options.minimum) / (options.maximum - options.minimum), 0.0F,
                         1.0F);
    const float animated = studio::Animate(ItemId(stableId), studio::Key("fill"), normalized,
                                           {.duration = 0.14, .ease = studio::Ease::OutCubic});
    ImDrawList& drawList = *ImGui::GetWindowDrawList();
    DrawLabel(drawList, bounds.min, label, theme);
    char formatted[32]{};
    std::snprintf(formatted, sizeof(formatted), "%.*f", std::clamp(options.precision, 0, 4), value);
    DrawValueText(drawList, bounds, formatted, theme);
    drawList.AddRectFilled(track.min, track.max, IM_COL32(10, 12, 25, 220), 3.0F);
    drawList.AddRectFilled(track.min, {track.min.x + track.Size().x * animated, track.max.y},
                           theme.accent, 3.0F);
    drawList.AddCircleFilled({track.min.x + track.Size().x * animated, track.Center().y}, 5.0F,
                             theme.textPrimary);
    return changed;
}

void DrawLabel(ImDrawList& drawList, const ImVec2 position, const std::string_view label,
               const Theme& theme) {
    drawList.AddText(position, theme.textPrimary, label.data(), label.data() + label.size());
}

[[nodiscard]] float NormalizedPointerX(const studio::Rect bounds) {
    const float width = std::max(1.0F, bounds.Size().x);
    return std::clamp((ImGui::GetIO().MousePos.x - bounds.min.x) / width, 0.0F, 1.0F);
}

[[nodiscard]] ImU32 WithAlpha(const ImU32 color, const float alpha) {
    ImVec4 value = ImGui::ColorConvertU32ToFloat4(color);
    value.w *= std::clamp(alpha, 0.0F, 1.0F);
    return ImGui::ColorConvertFloat4ToU32(value);
}

void DrawValueText(ImDrawList& drawList, const studio::Rect bounds, const std::string_view value,
                   const Theme& theme) {
    const ImVec2 textSize = ImGui::CalcTextSize(value.data(), value.data() + value.size());
    drawList.AddText({bounds.max.x - textSize.x, bounds.min.y}, theme.textSecondary, value.data(),
                     value.data() + value.size());
}

} // namespace

namespace components {

bool Toggle(const std::string_view stableId, const std::string_view label, bool& value,
            const ImVec2 position, const Theme& theme, const ToggleStyle style) {
    const ImGuiID id = ItemId(stableId);
    const studio::Interaction interaction = InteractAt(stableId, "toggle", position, style.size);
    if (interaction.pressed)
        value = !value;
    const float active = studio::Animate(
        id, studio::Key("active"), value ? 1.0F : 0.0F,
        {.duration = theme.animationDurationSeconds, .ease = studio::Ease::OutCubic});
    const float hover = studio::Spring(id, studio::Key("hover"), interaction.hovered ? 1.0F : 0.0F,
                                       {.stiffness = 280.0, .damping = 24.0});
    ImDrawList& drawList = *ImGui::GetWindowDrawList();
    const studio::Rect bounds = Bounds(position, style.size);
    if (hover > 0.02F || active > 0.02F)
        studio::AddGlow(drawList, bounds,
                        studio::MixColor(theme.accentSecondary, theme.accent, active),
                        10.0F + (hover * 5.0F), style.size.y * 0.5F, 5);
    drawList.AddRectFilled(
        bounds.min, bounds.max,
        studio::MixColor(IM_COL32(57, 59, 85, 255), theme.accentSecondary, active),
        style.size.y * 0.5F);
    drawList.AddRect(bounds.min, bounds.max,
                     WithAlpha(IM_COL32(255, 255, 255, 255), 0.14F + hover * 0.25F),
                     style.size.y * 0.5F);
    const float centerX = bounds.min.x + style.knobRadius + 4.0F +
                          ((style.size.x - ((style.knobRadius + 4.0F) * 2.0F)) * active);
    const float radius = style.knobRadius + hover * 1.5F;
    drawList.AddCircleFilled({centerX, bounds.Center().y}, radius + 2.0F, IM_COL32(8, 9, 18, 100));
    drawList.AddCircleFilled({centerX, bounds.Center().y}, radius, theme.textPrimary);
    DrawLabel(drawList, {bounds.max.x + 10.0F, bounds.min.y + 4.0F}, label, theme);
    return interaction.pressed;
}

bool SliderFloat(const std::string_view stableId, const std::string_view label, float& value,
                 const ImVec2 position, const float widthPx, const SliderOptions options,
                 const Theme& theme) {
    return Slider(stableId, "slider_float", label, value, position, widthPx, options, theme);
}

bool SliderInt(const std::string_view stableId, const std::string_view label, int& value,
               const ImVec2 position, const float widthPx, const int minimum, const int maximum,
               const Theme& theme) {
    float visual = static_cast<float>(value);
    const bool changed = Slider(stableId, "slider_int", label, visual, position, widthPx,
                                {.minimum = static_cast<float>(minimum),
                                 .maximum = static_cast<float>(maximum),
                                 .precision = 0},
                                theme);
    const int next = std::clamp(static_cast<int>(std::lround(visual)), minimum, maximum);
    const bool integerChanged = next != value;
    value = next;
    return changed || integerChanged;
}

bool NavigationItem(const std::string_view stableId, const std::string_view label,
                    const bool active, const ImVec2 position, const ImVec2 size,
                    const Theme& theme) {
    const studio::Interaction interaction =
        InteractAt(stableId, "sidebar_navigation", position, size);
    const float emphasis = studio::Animate(ItemId(stableId), studio::Key("selection"),
                                           (active || interaction.hovered) ? 1.0F : 0.0F,
                                           {.duration = 0.16, .ease = studio::Ease::OutCubic});
    ImDrawList& drawList = *ImGui::GetWindowDrawList();
    const studio::Rect bounds = Bounds(position, size);
    drawList.AddRectFilled(bounds.min, bounds.max,
                           WithAlpha(theme.accentSecondary, emphasis * 0.28F), 8.0F);
    if (emphasis > 0.02F)
        drawList.AddRectFilled(bounds.min, {bounds.min.x + 3.0F, bounds.max.y}, theme.accent, 2.0F);
    drawList.AddText({bounds.min.x + 14.0F, bounds.min.y + 8.0F},
                     active ? theme.textPrimary : theme.textSecondary, label.data(),
                     label.data() + label.size());
    return interaction.pressed;
}

bool Tab(const std::string_view stableId, const std::string_view label, const bool active,
         const ImVec2 position, const ImVec2 size, const Theme& theme) {
    const studio::Interaction interaction = InteractAt(stableId, "tab", position, size);
    const float selected =
        studio::Animate(ItemId(stableId), studio::Key("selection"), active ? 1.0F : 0.0F,
                        {.duration = 0.18, .ease = studio::Ease::OutCubic});
    ImDrawList& drawList = *ImGui::GetWindowDrawList();
    const studio::Rect bounds = Bounds(position, size);
    drawList.AddText(studio::CenterTextX(bounds, label),
                     studio::MixColor(theme.textSecondary, theme.textPrimary, selected),
                     label.data(), label.data() + label.size());
    drawList.AddRectFilled({bounds.min.x + 8.0F, bounds.max.y - 2.0F},
                           {bounds.max.x - 8.0F, bounds.max.y}, WithAlpha(theme.accent, selected),
                           1.0F);
    return interaction.pressed;
}

bool Combo(const std::string_view stableId, const std::string_view label, int& selected, bool& open,
           const std::span<const std::string_view> options, const ImVec2 position,
           const float widthPx, const Theme& theme) {
    const studio::Rect trigger = Bounds(position, {widthPx, theme.rowHeightPx});
    const studio::Interaction interaction = InteractAt(stableId, "combo", position, trigger.Size());
    if (interaction.pressed)
        open = !open;
    ImDrawList& drawList = *ImGui::GetWindowDrawList();
    DrawLabel(drawList, {trigger.min.x, trigger.min.y - 18.0F}, label, theme);
    drawList.AddRectFilled(trigger.min, trigger.max, theme.card, 7.0F);
    drawList.AddRect(trigger.min, trigger.max, theme.cardBorder, 7.0F);
    const int safeIndex =
        std::clamp(selected, 0, std::max(0, static_cast<int>(options.size()) - 1));
    if (!options.empty())
        drawList.AddText({trigger.min.x + 10.0F, trigger.min.y + 8.0F}, theme.textPrimary,
                         options[static_cast<std::size_t>(safeIndex)].data());
    drawList.AddText({trigger.max.x - 18.0F, trigger.min.y + 8.0F}, theme.accent, open ? "^" : "v");
    bool changed = false;
    if (open) {
        const float popupHeight = static_cast<float>(options.size()) * theme.rowHeightPx + 8.0F;
        const studio::Rect popup{{trigger.min.x, trigger.max.y + 5.0F},
                                 {trigger.max.x, trigger.max.y + 5.0F + popupHeight}};
        studio::AddLayeredShadow(drawList, popup, IM_COL32(0, 0, 0, 255), 10.0F, {0.0F, 3.0F}, 8.0F,
                                 5);
        drawList.AddRectFilled(popup.min, popup.max, IM_COL32(17, 19, 36, 255), 8.0F);
        for (std::size_t index = 0; index < options.size(); ++index) {
            const ImVec2 itemPosition{popup.min.x + 4.0F,
                                      popup.min.y + 4.0F +
                                          static_cast<float>(index) * theme.rowHeightPx};
            const std::string optionId = std::string(stableId) + ".option-" + std::to_string(index);
            const studio::Interaction item =
                InteractAt(optionId, "combo_option", itemPosition,
                           {widthPx - 8.0F, theme.rowHeightPx}, studio::ItemFlags::AllowOverlap);
            if (item.hovered)
                drawList.AddRectFilled(
                    itemPosition,
                    {itemPosition.x + widthPx - 8.0F, itemPosition.y + theme.rowHeightPx},
                    WithAlpha(theme.accentSecondary, 0.35F), 6.0F);
            drawList.AddText({itemPosition.x + 8.0F, itemPosition.y + 8.0F}, theme.textPrimary,
                             options[index].data());
            if (item.pressed) {
                selected = static_cast<int>(index);
                open = false;
                changed = true;
            }
        }
    }
    return changed;
}

bool Keybind(const std::string_view stableId, const std::string_view label,
             std::string_view& keyName, bool& capturing, const ImVec2 position, const float widthPx,
             const Theme& theme) {
    const studio::Rect bounds = Bounds(position, {widthPx, theme.rowHeightPx});
    const studio::Interaction interaction =
        InteractAt(stableId, "keybind", position, bounds.Size());
    if (interaction.pressed)
        capturing = !capturing;
    if (capturing) {
        for (ImGuiKey key = ImGuiKey_NamedKey_BEGIN; key < ImGuiKey_NamedKey_END;
             key = static_cast<ImGuiKey>(key + 1)) {
            if (ImGui::IsKeyPressed(key, false)) {
                keyName = ImGui::GetKeyName(key);
                capturing = false;
                break;
            }
        }
    }
    ImDrawList& drawList = *ImGui::GetWindowDrawList();
    DrawLabel(drawList, {bounds.min.x, bounds.min.y - 18.0F}, label, theme);
    drawList.AddRectFilled(bounds.min, bounds.max,
                           capturing ? WithAlpha(theme.accentSecondary, 0.5F) : theme.card, 7.0F);
    drawList.AddRect(bounds.min, bounds.max, capturing ? theme.accent : theme.cardBorder, 7.0F);
    const std::string_view display = capturing ? "Press any key" : keyName;
    drawList.AddText({bounds.min.x + 10.0F, bounds.min.y + 8.0F}, theme.textPrimary, display.data(),
                     display.data() + display.size());
    return interaction.pressed;
}

bool ColorPicker(const std::string_view stableId, const std::string_view label, ImU32& color,
                 bool& open, const ImVec2 position, const float widthPx, const Theme& theme) {
    const studio::Rect bounds = Bounds(position, {widthPx, theme.rowHeightPx});
    const studio::Interaction interaction =
        InteractAt(stableId, "color_picker", position, bounds.Size());
    if (interaction.pressed)
        open = !open;
    ImDrawList& drawList = *ImGui::GetWindowDrawList();
    DrawLabel(drawList, {bounds.min.x, bounds.min.y - 18.0F}, label, theme);
    drawList.AddRectFilled(bounds.min, bounds.max, theme.card, 7.0F);
    drawList.AddRect(bounds.min, bounds.max, theme.cardBorder, 7.0F);
    drawList.AddRectFilled({bounds.max.x - 31.0F, bounds.min.y + 5.0F},
                           {bounds.max.x - 6.0F, bounds.max.y - 5.0F}, color, 5.0F);
    bool changed = false;
    if (open) {
        constexpr std::array<ImU32, 6> swatches{
            IM_COL32(235, 35, 255, 255), IM_COL32(119, 58, 255, 255), IM_COL32(73, 234, 179, 255),
            IM_COL32(65, 180, 255, 255), IM_COL32(255, 191, 72, 255), IM_COL32(255, 95, 118, 255)};
        const studio::Rect popup{{bounds.min.x, bounds.max.y + 5.0F},
                                 {bounds.max.x, bounds.max.y + 49.0F}};
        drawList.AddRectFilled(popup.min, popup.max, IM_COL32(17, 19, 36, 255), 8.0F);
        for (std::size_t index = 0; index < swatches.size(); ++index) {
            const ImVec2 swatch{popup.min.x + 8.0F + static_cast<float>(index) * 30.0F,
                                popup.min.y + 8.0F};
            const std::string swatchId = std::string(stableId) + ".swatch-" + std::to_string(index);
            const studio::Interaction item = InteractAt(
                swatchId, "color_swatch", swatch, {24.0F, 24.0F}, studio::ItemFlags::AllowOverlap);
            drawList.AddRectFilled(swatch, {swatch.x + 24.0F, swatch.y + 24.0F}, swatches[index],
                                   5.0F);
            if (item.pressed) {
                color = swatches[index];
                open = false;
                changed = true;
            }
        }
    }
    return changed;
}

bool Button(const std::string_view stableId, const std::string_view label, const ImVec2 position,
            const ImVec2 size, const bool primary, const Theme& theme) {
    const studio::Interaction interaction = InteractAt(stableId, "button", position, size);
    const float emphasis =
        studio::Spring(ItemId(stableId), studio::Key("hover"), interaction.hovered ? 1.0F : 0.0F,
                       {.stiffness = 300.0, .damping = 24.0});
    const studio::Rect bounds = Bounds(position, size);
    ImDrawList& drawList = *ImGui::GetWindowDrawList();
    const ImU32 base = primary ? theme.accentSecondary : theme.card;
    drawList.AddRectFilled(
        bounds.min, bounds.max,
        studio::MixColor(base, primary ? theme.accent : theme.cardHover, emphasis), 8.0F);
    drawList.AddRect(bounds.min, bounds.max,
                     primary ? WithAlpha(theme.accent, 0.7F) : theme.cardBorder, 8.0F);
    drawList.AddText(studio::CenterTextX(bounds, label), theme.textPrimary, label.data(),
                     label.data() + label.size());
    return interaction.pressed;
}

bool IconButton(const std::string_view stableId, const std::string_view glyph,
                const ImVec2 position, const float sizePx, const Theme& theme) {
    const studio::Interaction interaction =
        InteractAt(stableId, "icon_button", position, {sizePx, sizePx});
    const float emphasis =
        studio::Spring(ItemId(stableId), studio::Key("hover"), interaction.hovered ? 1.0F : 0.0F,
                       {.stiffness = 300.0, .damping = 24.0});
    const studio::Rect bounds = Bounds(position, {sizePx, sizePx});
    ImDrawList& drawList = *ImGui::GetWindowDrawList();
    drawList.AddRectFilled(bounds.min, bounds.max,
                           studio::MixColor(theme.card, theme.cardHover, emphasis), 8.0F);
    drawList.AddRect(bounds.min, bounds.max, theme.cardBorder, 8.0F);
    drawList.AddText(studio::CenterTextX(bounds, glyph), theme.textPrimary, glyph.data(),
                     glyph.data() + glyph.size());
    return interaction.pressed;
}

studio::Rect Card(ImDrawList& drawList, const studio::Rect bounds, const Theme& theme,
                  const bool highlighted) {
    studio::AddLayeredShadow(drawList, bounds, IM_COL32(0, 0, 0, 255), 15.0F, {0.0F, 5.0F},
                             theme.cardRoundingPx, 7);
    drawList.AddRectFilled(bounds.min, bounds.max, highlighted ? theme.cardHover : theme.card,
                           theme.cardRoundingPx);
    drawList.AddRect(bounds.min, bounds.max,
                     highlighted ? WithAlpha(theme.accent, 0.55F) : theme.cardBorder,
                     theme.cardRoundingPx);
    return {{bounds.min.x + theme.spacingPx, bounds.min.y + theme.spacingPx},
            {bounds.max.x - theme.spacingPx, bounds.max.y - theme.spacingPx}};
}

void Toast(const std::string_view stableId, const std::string_view message, const bool visible,
           const ImVec2 position, const float widthPx, const Theme& theme) {
    const float progress =
        studio::Animate(ItemId(stableId), studio::Key("visibility"), visible ? 1.0F : 0.0F,
                        {.duration = 0.20, .ease = studio::Ease::OutCubic});
    if (progress <= 0.001F)
        return;
    const studio::Rect bounds{
        {position.x + ((1.0F - progress) * 18.0F), position.y},
        {position.x + widthPx + ((1.0F - progress) * 18.0F), position.y + 38.0F}};
    ImDrawList& drawList = *ImGui::GetWindowDrawList();
    drawList.AddRectFilled(bounds.min, bounds.max, WithAlpha(IM_COL32(18, 24, 42, 255), progress),
                           8.0F);
    drawList.AddRect(bounds.min, bounds.max, WithAlpha(theme.positive, progress), 8.0F);
    drawList.AddCircleFilled({bounds.min.x + 14.0F, bounds.Center().y}, 4.0F, theme.positive);
    drawList.AddText({bounds.min.x + 25.0F, bounds.min.y + 11.0F},
                     WithAlpha(theme.textPrimary, progress), message.data(),
                     message.data() + message.size());
}

bool Modal(const std::string_view stableId, const std::string_view title, bool& open,
           const studio::Rect bounds, const Theme& theme) {
    const float visibility =
        studio::Animate(ItemId(stableId), studio::Key("visibility"), open ? 1.0F : 0.0F,
                        {.duration = 0.18, .ease = studio::Ease::OutCubic});
    if (visibility <= 0.001F)
        return false;
    ImDrawList& drawList = *ImGui::GetWindowDrawList();
    const ImVec2 display = ImGui::GetIO().DisplaySize;
    drawList.AddRectFilled({0.0F, 0.0F}, display,
                           IM_COL32(3, 4, 12, static_cast<int>(150.0F * visibility)));
    const float inset = (1.0F - visibility) * 12.0F;
    const studio::Rect animated{{bounds.min.x + inset, bounds.min.y + inset},
                                {bounds.max.x - inset, bounds.max.y - inset}};
    static_cast<void>(Card(drawList, animated, theme, true));
    drawList.AddText({animated.min.x + 18.0F, animated.min.y + 18.0F}, theme.textPrimary,
                     title.data(), title.data() + title.size());
    drawList.AddText({animated.min.x + 18.0F, animated.min.y + 48.0F}, theme.textSecondary,
                     "Portable custom modal - no backend effect pass required.");
    if (IconButton(std::string(stableId) + ".close", "x",
                   {animated.max.x - 42.0F, animated.min.y + 12.0F}, 28.0F, theme)) {
        open = false;
        return true;
    }
    return false;
}

} // namespace components
} // namespace studio_example
