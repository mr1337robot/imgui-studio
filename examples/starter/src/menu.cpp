/**
 * Reference-faithful compact settings menu.
 *
 * This module deliberately does not compose stock ImGui controls. Dear ImGui supplies the frame,
 * ID stack, clipping, and input routing; every visible surface is authored below with ImDrawList.
 * Keeping interaction rectangles separate from the smaller painted controls preserves generous,
 * accessible hit targets without changing the dense geometry of the supplied reference.
 */
#include <algorithm>
#include <array>
#include <cfloat>
#include <cmath>
#include <cstdio>
#include <imgui.h>
#include <string>
#include <string_view>
#include <studio/studio.hpp>
#include <studio_example/menu.hpp>
#include <studio_example/theme.hpp>

namespace studio_example {
namespace {

constexpr float kPanelWidthPx = 860.0F;
constexpr float kPanelHeightPx = 536.0F;
constexpr float kHeaderHeightPx = 70.0F;
constexpr float kBreadcrumbHeightPx = 56.0F;
constexpr float kBodyTextPx = 14.0F;
constexpr float kSmallTextPx = 13.0F;
constexpr float kBrandTextPx = 20.0F;
constexpr float kPi = 3.14159265358979323846F;

struct ToggleResult final {
    studio::Rect hitbox{};
    float active{};
    bool settled{};
};

[[nodiscard]] ImGuiID ItemId(const std::string_view stableId) {
    return ImGui::GetID(stableId.data(), stableId.data() + stableId.size());
}

[[nodiscard]] ImU32 WithAlpha(const ImU32 color, const float alpha) {
    ImVec4 value = ImGui::ColorConvertU32ToFloat4(color);
    value.w *= std::clamp(alpha, 0.0F, 1.0F);
    return ImGui::ColorConvertFloat4ToU32(value);
}

[[nodiscard]] ImFont* BodyFont() {
    ImGuiIO& io = ImGui::GetIO();
    return io.FontDefault != nullptr ? io.FontDefault : ImGui::GetFont();
}

[[nodiscard]] ImFont* BrandFont() {
    ImGuiIO& io = ImGui::GetIO();
    return io.Fonts->Fonts.Size > 1 ? io.Fonts->Fonts[1] : BodyFont();
}

[[nodiscard]] ImFont* EmphasisFont() {
    // The second atlas entry is the project-provided semibold instance. It is loaded at 16 px but
    // Dear ImGui can render it at smaller sizes without creating a second, divergent font asset.
    return BrandFont();
}

void DrawText(ImDrawList& drawList, const ImVec2 position, const ImU32 color,
              const std::string_view text, const float sizePx = kBodyTextPx,
              ImFont* font = nullptr) {
    ImFont* selectedFont = font != nullptr ? font : BodyFont();
    drawList.AddText(selectedFont, sizePx, position, color, text.data(), text.data() + text.size());
}

[[nodiscard]] ImVec2 MeasureText(const std::string_view text, const float sizePx,
                                 ImFont* font = nullptr) {
    ImFont* selectedFont = font != nullptr ? font : BodyFont();
    return selectedFont->CalcTextSizeA(sizePx, FLT_MAX, 0.0F, text.data(),
                                       text.data() + text.size());
}

[[nodiscard]] studio::Interaction
InteractAt(const std::string_view stableId, const std::string_view semanticType,
           const studio::Rect bounds, const studio::ItemFlags flags = studio::ItemFlags::None) {
    ImGui::SetCursorScreenPos(bounds.min);
    return studio::Interact({.stableId = stableId,
                             .semanticType = semanticType,
                             .imguiId = ItemId(stableId),
                             .bounds = bounds,
                             .hitbox = bounds,
                             .layoutSize = bounds.Size(),
                             .flags = flags});
}

void DrawChevron(ImDrawList& drawList, const ImVec2 center, const ImU32 color,
                 const bool pointsUp = false) {
    const float direction = pointsUp ? -1.0F : 1.0F;
    const std::array<ImVec2, 3> points{{{center.x - 3.5F, center.y - direction * 1.5F},
                                        {center.x + 3.5F, center.y - direction * 1.5F},
                                        {center.x, center.y + direction * 2.5F}}};
    drawList.AddConvexPolyFilled(points.data(), static_cast<int>(points.size()), color);
}

void DrawTargetIcon(ImDrawList& drawList, const ImVec2 center, const ImU32 color,
                    const float radiusPx = 7.0F) {
    drawList.AddCircle(center, radiusPx, WithAlpha(color, 0.72F), 20, 1.4F);
    drawList.AddCircleFilled(center, 2.2F, color, 12);
    drawList.AddLine({center.x - radiusPx - 2.0F, center.y}, {center.x - radiusPx + 1.0F, center.y},
                     color, 1.2F);
    drawList.AddLine({center.x + radiusPx - 1.0F, center.y}, {center.x + radiusPx + 2.0F, center.y},
                     color, 1.2F);
}

void DrawGearIcon(ImDrawList& drawList, const ImVec2 center, const ImU32 color,
                  const float radiusPx = 5.0F) {
    // A filled sixteen-point outline produces eight recognizable teeth. The previous circle plus
    // crosshair approximation looked like an aiming reticle at this size, which changed the
    // control's meaning and was visibly unlike the supplied reference.
    std::array<ImVec2, 16> outline{};
    for (std::size_t index = 0; index < outline.size(); ++index) {
        const float angle = -kPi * 0.5F + static_cast<float>(index) * (kPi / 8.0F);
        const float pointRadius = (index % 2U == 0U) ? radiusPx : radiusPx * 0.70F;
        outline[index] = {center.x + std::cos(angle) * pointRadius,
                          center.y + std::sin(angle) * pointRadius};
    }
    drawList.AddConvexPolyFilled(outline.data(), static_cast<int>(outline.size()), color);
    drawList.AddCircleFilled(center, radiusPx * 0.28F, IM_COL32(20, 19, 24, 255), 10);
}

[[nodiscard]] ToggleResult DrawCompactToggle(ImDrawList& drawList, const std::string_view stableId,
                                             bool& value, const studio::Rect hitbox,
                                             const Theme& theme, const bool disabled = false,
                                             const ImVec2 visualSize = {28.0F, 14.0F}) {
    const studio::Interaction interaction =
        InteractAt(stableId, "compact_toggle", hitbox,
                   disabled ? studio::ItemFlags::Disabled : studio::ItemFlags::None);
    if (interaction.pressed)
        value = !value;

    const ImGuiID id = ItemId(stableId);
    const float active = studio::Animate(
        id, studio::Key("active"), value ? 1.0F : 0.0F,
        {.duration = theme.animationDurationSeconds, .ease = studio::Ease::OutCubic});
    const float hover =
        studio::Spring(id, studio::Key("hover"), interaction.hovered && !disabled ? 1.0F : 0.0F,
                       {.stiffness = 320.0, .damping = 27.0});

    const studio::Rect visual{
        {hitbox.max.x - visualSize.x, hitbox.Center().y - visualSize.y * 0.5F},
        {hitbox.max.x, hitbox.Center().y + visualSize.y * 0.5F}};
    const float enabledAlpha = disabled ? 0.52F : 1.0F;
    const ImU32 offTrack = IM_COL32(37, 36, 50, 255);
    const ImU32 onTrack = IM_COL32(61, 55, 31, 255);
    drawList.AddRectFilled(visual.min, visual.max,
                           WithAlpha(studio::MixColor(offTrack, onTrack, active), enabledAlpha),
                           visualSize.y * 0.5F);
    drawList.AddRect(
        visual.min, visual.max,
        WithAlpha(studio::MixColor(IM_COL32(58, 56, 75, 255), IM_COL32(101, 90, 48, 255), active),
                  enabledAlpha * (0.72F + hover * 0.18F)),
        visualSize.y * 0.5F, 0, 1.0F);

    const float knobRadius = visualSize.y * 0.25F;
    const float knobInsetPx = std::max(2.5F, knobRadius * 0.72F);
    const float knobStartX = visual.min.x + knobInsetPx + knobRadius;
    const float knobEndX = visual.max.x - knobInsetPx - knobRadius;
    const float knobX = knobStartX + (knobEndX - knobStartX) * active;
    if (active > 0.02F) {
        // The reference has a localized lamp-like bloom around the gold dot, not a glowing pill.
        drawList.AddCircleFilled({knobX, visual.Center().y}, knobRadius + 3.0F,
                                 WithAlpha(theme.accent, enabledAlpha * active * 0.07F), 16);
        drawList.AddCircleFilled({knobX, visual.Center().y}, knobRadius + 1.5F,
                                 WithAlpha(theme.accent, enabledAlpha * active * 0.14F), 16);
    }
    drawList.AddCircleFilled(
        {knobX, visual.Center().y}, knobRadius,
        WithAlpha(studio::MixColor(IM_COL32(74, 72, 94, 255), theme.accent, active), enabledAlpha));

    return {.hitbox = hitbox,
            .active = active,
            .settled = studio::GetAnimationStatus(id, studio::Key("active")).settled};
}

void DrawTopNavigation(ImDrawList& drawList, MenuState& state, const studio::Rect header,
                       const Theme& theme) {
    constexpr float kBrandWidthPx = 288.0F;
    constexpr float kRightInsetPx = 28.0F;
    constexpr std::array<float, 5> kTabWidthsPx{117.0F, 104.0F, 96.0F, 107.0F, 120.0F};
    drawList.AddRectFilled(header.min, header.max, IM_COL32(18, 17, 21, 255), theme.panelRoundingPx,
                           ImDrawFlags_RoundCornersTop);
    drawList.AddRectFilled(header.min, {header.min.x + kBrandWidthPx, header.max.y},
                           IM_COL32(20, 19, 24, 255), theme.panelRoundingPx,
                           ImDrawFlags_RoundCornersTopLeft);
    DrawText(drawList, {header.min.x + 27.0F, header.min.y + 33.0F}, theme.textPrimary,
             "Thariluneon.cc", kBrandTextPx, BrandFont());

    constexpr std::array<std::string_view, 5> labels{"General", "Visuals", "Misc", "World",
                                                     "Settings"};
    constexpr std::array<std::string_view, 5> stableIds{"navigation.general", "navigation.visuals",
                                                        "navigation.misc", "navigation.world",
                                                        "navigation.settings"};
    constexpr std::array<float, 5> kLabelOffsetsPx{17.0F, 17.0F, 23.0F, 21.0F, 18.0F};
    constexpr std::array<float, 5> kChevronOffsetsPx{93.0F, 87.0F, 76.0F, 83.0F, 95.0F};
    constexpr float kNavigationTextPx = 16.5F;
    float tabLeft = header.min.x + kBrandWidthPx;
    for (std::size_t index = 0; index < labels.size(); ++index) {
        const float tabRight =
            std::min(tabLeft + kTabWidthsPx[index], header.max.x - kRightInsetPx);
        const studio::Rect tab{{tabLeft, header.min.y}, {tabRight, header.max.y}};
        tabLeft = tabRight;
        const studio::Interaction interaction = InteractAt(stableIds[index], "top_navigation", tab);
        if (interaction.pressed)
            state.navigationIndex = static_cast<int>(index);
        const bool selected = state.navigationIndex == static_cast<int>(index);
        const float emphasis = studio::Animate(ItemId(stableIds[index]), studio::Key("selection"),
                                               selected || interaction.hovered ? 1.0F : 0.0F,
                                               {.duration = 0.14, .ease = studio::Ease::OutCubic});
        if (emphasis > 0.01F)
            drawList.AddRectFilled(tab.min, tab.max,
                                   WithAlpha(IM_COL32(25, 24, 30, 255), emphasis * 0.86F));
        DrawText(drawList, {tab.min.x + kLabelOffsetsPx[index], header.min.y + 33.0F},
                 studio::MixColor(theme.textSecondary, theme.textPrimary,
                                  selected ? 1.0F : emphasis * 0.65F),
                 labels[index], kNavigationTextPx, EmphasisFont());
        DrawChevron(drawList, {tab.min.x + kChevronOffsetsPx[index], header.min.y + 42.0F},
                    selected ? theme.accent : theme.textSecondary);
    }
    drawList.AddLine({header.min.x, header.max.y - 1.0F}, {header.max.x, header.max.y - 1.0F},
                     theme.panelBorder);
}

void DrawBreadcrumb(ImDrawList& drawList, const studio::Rect bounds, const Theme& theme) {
    drawList.AddRectFilled(bounds.min, bounds.max, IM_COL32(20, 19, 24, 255));
    DrawTargetIcon(drawList, {bounds.min.x + 34.0F, bounds.Center().y}, theme.accent, 6.0F);
    DrawText(drawList, {bounds.min.x + 61.0F, bounds.min.y + 20.0F}, theme.textPrimary, "General",
             kBodyTextPx);
    drawList.AddCircleFilled({bounds.min.x + 134.0F, bounds.Center().y}, 2.1F, theme.accent);
    DrawText(drawList, {bounds.min.x + 153.0F, bounds.min.y + 20.0F}, theme.accent, "Aimbot",
             kBodyTextPx);
    DrawGearIcon(drawList, {bounds.min.x + 804.0F, bounds.Center().y}, theme.textSecondary, 5.0F);
    drawList.AddLine({bounds.min.x, bounds.max.y - 1.0F}, {bounds.max.x, bounds.max.y - 1.0F},
                     theme.panelBorder);
}

void DrawSectionHeader(ImDrawList& drawList, const studio::Rect bounds, const char* label,
                       const Theme& theme, const float labelInsetPx, const float chevronInsetPx) {
    DrawText(drawList, {bounds.min.x + labelInsetPx, bounds.min.y + 14.0F}, theme.textSecondary,
             label, kSmallTextPx);
    DrawChevron(drawList, {bounds.max.x - chevronInsetPx, bounds.min.y + 20.0F},
                theme.textSecondary);
    drawList.AddLine({bounds.min.x + 10.0F, bounds.max.y - 1.0F},
                     {bounds.max.x - 10.0F, bounds.max.y - 1.0F},
                     WithAlpha(theme.cardBorder, 0.9F));
}

[[nodiscard]] ToggleResult
DrawToggleRow(ImDrawList& drawList, const std::string_view stableId, const std::string_view label,
              const std::string_view description, bool& value, const studio::Rect row,
              const Theme& theme, const bool disabled = false, const bool showGear = false,
              const bool canonical = false, const float gearInsetPx = 51.0F,
              const float toggleRightInsetPx = 12.0F) {
    const float contentAlpha = disabled ? 0.70F : (value ? 1.0F : 0.88F);
    const float canonicalOffsetYPx = canonical ? 4.0F : 0.0F;
    DrawText(
        drawList,
        {row.min.x + 12.0F, row.min.y + (description.empty() ? 15.0F : 10.0F) + canonicalOffsetYPx},
        WithAlpha(value ? theme.textPrimary : theme.textSecondary, contentAlpha), label,
        kSmallTextPx, value && !disabled ? EmphasisFont() : BodyFont());
    if (!description.empty())
        DrawText(drawList, {row.min.x + 12.0F, row.min.y + 32.0F + (canonical ? 3.0F : 0.0F)},
                 WithAlpha(theme.textSecondary, contentAlpha * 0.86F), description, 11.5F);
    if (showGear)
        DrawGearIcon(drawList, {row.max.x - gearInsetPx, row.Center().y},
                     WithAlpha(theme.textSecondary, contentAlpha), 4.0F);

    const ImVec2 hitboxSize = canonical ? ImVec2{58.0F, 30.0F} : ImVec2{42.0F, 28.0F};
    const studio::Rect hitbox{
        {row.max.x - toggleRightInsetPx - hitboxSize.x, row.Center().y - hitboxSize.y * 0.5F},
        {row.max.x - toggleRightInsetPx, row.Center().y + hitboxSize.y * 0.5F}};
    const ToggleResult result =
        DrawCompactToggle(drawList, stableId, value, hitbox, theme, disabled,
                          canonical ? ImVec2{30.0F, 16.0F} : ImVec2{28.0F, 13.0F});
    drawList.AddLine({row.min.x + 10.0F, row.max.y - 1.0F}, {row.max.x - 10.0F, row.max.y - 1.0F},
                     WithAlpha(theme.cardBorder, 0.72F));
    return result;
}

void DrawSliderRow(ImDrawList& drawList, const std::string_view stableId,
                   const std::string_view label, int& value, const studio::Rect row,
                   const Theme& theme) {
    const studio::Interaction interaction = InteractAt(stableId, "compact_slider_int", row);
    const studio::Rect track{{row.min.x + 12.0F, row.min.y + 35.0F},
                             {row.max.x - 12.0F, row.min.y + 39.0F}};
    if (interaction.held) {
        const float normalized = std::clamp(
            (ImGui::GetIO().MousePos.x - track.min.x) / std::max(1.0F, track.Size().x), 0.0F, 1.0F);
        value = 50 + static_cast<int>(std::lround(normalized * 100.0F));
    }
    const float target = std::clamp((static_cast<float>(value) - 50.0F) / 100.0F, 0.0F, 1.0F);
    const float fill = studio::Animate(ItemId(stableId), studio::Key("fill"), target,
                                       {.duration = 0.14, .ease = studio::Ease::OutCubic});
    DrawText(drawList, {row.min.x + 12.0F, row.min.y + 13.0F}, theme.textSecondary, label,
             kSmallTextPx);
    DrawGearIcon(drawList, {row.max.x - 51.0F, row.min.y + 20.0F}, theme.textSecondary, 4.0F);
    char valueText[12]{};
    std::snprintf(valueText, sizeof(valueText), "%d", value);
    const ImVec2 valueSize = MeasureText(valueText, kSmallTextPx);
    DrawText(drawList, {row.max.x - 12.0F - valueSize.x, row.min.y + 13.0F}, theme.textPrimary,
             valueText, kSmallTextPx);
    drawList.AddRectFilled(track.min, track.max, IM_COL32(29, 28, 35, 255), 2.0F);
    drawList.AddRectFilled(track.min, {track.min.x + track.Size().x * fill, track.max.y},
                           theme.accent, 2.0F);
    drawList.AddCircleFilled({track.min.x + track.Size().x * fill, track.Center().y}, 4.2F,
                             IM_COL32(228, 226, 220, 255));
}

void DrawComboRow(ImDrawList& drawList, MenuState& state, const studio::Rect row,
                  const Theme& theme) {
    constexpr std::string_view kStableId = "aim.accuracy-step";
    const studio::Rect trigger{{row.min.x + 12.0F, row.min.y + 33.0F},
                               {row.max.x - 19.0F, row.max.y - 6.0F}};
    const studio::Interaction interaction = InteractAt(kStableId, "compact_combo", trigger);
    if (interaction.pressed)
        state.comboOpen = !state.comboOpen;
    DrawText(drawList, {row.min.x + 12.0F, row.min.y + 7.0F}, theme.textSecondary,
             "Accuracy boost step", kSmallTextPx);
    DrawGearIcon(drawList, {row.min.x + 153.0F, row.min.y + 14.0F}, theme.textSecondary, 4.0F);
    drawList.AddRectFilled(trigger.min, trigger.max,
                           interaction.hovered ? theme.cardHover : IM_COL32(20, 19, 24, 255), 3.0F);
    drawList.AddRect(trigger.min, trigger.max, theme.cardBorder, 3.0F);
    constexpr std::array<std::string_view, 4> steps{"Step 1", "Step 2", "Step 3", "Adaptive"};
    const int index = std::clamp(state.qualityIndex, 0, static_cast<int>(steps.size()) - 1);
    DrawText(drawList, {trigger.min.x + 10.0F, trigger.min.y + 7.0F}, theme.textPrimary,
             steps[static_cast<std::size_t>(index)], kSmallTextPx);
    DrawChevron(drawList, {trigger.max.x - 12.0F, trigger.Center().y},
                state.comboOpen ? theme.accent : theme.textSecondary, state.comboOpen);

    const float openProgress =
        studio::Animate(ItemId(kStableId), studio::Key("open"), state.comboOpen ? 1.0F : 0.0F,
                        {.duration = 0.14, .ease = studio::Ease::OutCubic});
    if (openProgress > 0.01F) {
        const float popupHeight = 26.0F * static_cast<float>(steps.size()) * openProgress;
        const studio::Rect popup{{trigger.min.x, trigger.max.y + 4.0F},
                                 {trigger.max.x, trigger.max.y + 4.0F + popupHeight}};
        drawList.AddRectFilled(popup.min, popup.max, IM_COL32(17, 16, 21, 255), 3.0F);
        drawList.AddRect(popup.min, popup.max, theme.cardBorder, 3.0F);
        drawList.PushClipRect(popup.min, popup.max, true);
        for (std::size_t option = 0; option < steps.size(); ++option) {
            const studio::Rect optionBounds{
                {popup.min.x + 3.0F, popup.min.y + 3.0F + 26.0F * option},
                {popup.max.x - 3.0F, popup.min.y + 3.0F + 26.0F * (option + 1)}};
            const std::string optionId = "aim.accuracy-step.option-" + std::to_string(option);
            const studio::Interaction optionInteraction =
                InteractAt(optionId, "combo_option", optionBounds, studio::ItemFlags::AllowOverlap);
            if (optionInteraction.hovered)
                drawList.AddRectFilled(optionBounds.min, optionBounds.max,
                                       WithAlpha(theme.accentSecondary, 0.35F), 2.0F);
            DrawText(drawList, {optionBounds.min.x + 7.0F, optionBounds.min.y + 6.0F},
                     option == static_cast<std::size_t>(index) ? theme.accent : theme.textPrimary,
                     steps[option], kSmallTextPx);
            if (optionInteraction.pressed) {
                state.qualityIndex = static_cast<int>(option);
                state.comboOpen = false;
            }
        }
        drawList.PopClipRect();
    }
}

void DrawLeftPanel(ImDrawList& drawList, MenuState& state, const studio::Rect bounds,
                   const Theme& theme, MenuDiagnostics& diagnostics) {
    drawList.AddRectFilled(bounds.min, bounds.max, theme.card, theme.cardRoundingPx);
    drawList.AddRect(bounds.min, bounds.max, theme.cardBorder, theme.cardRoundingPx);
    const studio::Rect title{bounds.min, {bounds.max.x, bounds.min.y + 43.0F}};
    DrawSectionHeader(drawList, title, "Aimbot", theme, 4.0F, 7.0F);
    drawList.PushClipRect(bounds.min, bounds.max, true);

    float y = title.max.y;
    const ToggleResult canonical =
        DrawToggleRow(drawList, "settings.enable", "Enable aimbot",
                      "Enables pointing at the player and shoots at the player", state.enabled,
                      {{bounds.min.x, y}, {bounds.max.x, y + 56.0F}}, theme, false, true, true);
    diagnostics.toggleBounds = {canonical.hitbox.min.x, canonical.hitbox.min.y,
                                canonical.hitbox.Size().x, canonical.hitbox.Size().y};
    diagnostics.toggleEnabled = state.enabled;
    diagnostics.toggleProgress = canonical.active;
    diagnostics.toggleSettled = canonical.settled;
    y += 56.0F;
    static_cast<void>(DrawToggleRow(drawList, "aim.automatic-fire", "Automatic fire", "",
                                    state.automaticFire,
                                    {{bounds.min.x, y}, {bounds.max.x, y + 39.0F}}, theme));
    y += 39.0F;
    static_cast<void>(DrawToggleRow(drawList, "aim.silent", "Silent aim", "", state.silentAim,
                                    {{bounds.min.x, y}, {bounds.max.x, y + 39.0F}}, theme, true));
    y += 39.0F;
    static_cast<void>(
        DrawToggleRow(drawList, "aim.step", "Reduce aimbot step", "", state.layeredShadows,
                      {{bounds.min.x, y}, {bounds.max.x, y + 39.0F}}, theme, false, true));
    y += 39.0F;
    static_cast<void>(DrawToggleRow(drawList, "aim.override-awp", "Override AWP", "",
                                    state.overrideAwp,
                                    {{bounds.min.x, y}, {bounds.max.x, y + 39.0F}}, theme, true));
    y += 39.0F;
    DrawSliderRow(drawList, "aim.hitbox-scale", "Stomach hitbox scale", state.samples,
                  {{bounds.min.x, y}, {bounds.max.x, y + 56.0F}}, theme);
    y += 56.0F;
    static_cast<void>(DrawToggleRow(drawList, "aim.penetration", "Automatic penetration",
                                    "Automatic calculation and execution of shots penetrati...",
                                    state.automaticPenetration,
                                    {{bounds.min.x, y}, {bounds.max.x, y + 58.0F}}, theme, false));
    y += 58.0F;
    // The reference intentionally lets the next row peek into the bottom crop, communicating that
    // the pane scrolls. Drawing the real row content under the clip reproduces that cue without a
    // hard-coded decorative fragment.
    DrawText(drawList, {bounds.min.x + 12.0F, y + 15.0F}, theme.textSecondary,
             "Minimum hitbox damage", kSmallTextPx);
    DrawGearIcon(drawList, {bounds.max.x - 51.0F, y + 21.0F}, theme.textSecondary, 4.0F);
    DrawText(drawList, {bounds.max.x - 39.0F, y + 15.0F}, theme.textPrimary, "50.0", kSmallTextPx,
             EmphasisFont());
    drawList.PopClipRect();
}

void DrawRightPanel(ImDrawList& drawList, MenuState& state, const studio::Rect bounds,
                    const Theme& theme) {
    drawList.AddRectFilled(bounds.min, bounds.max, theme.card, theme.cardRoundingPx);
    drawList.AddRect(bounds.min, bounds.max, theme.cardBorder, theme.cardRoundingPx);
    const studio::Rect title{bounds.min, {bounds.max.x, bounds.min.y + 43.0F}};
    DrawSectionHeader(drawList, title, "Settings", theme, 7.0F, 19.0F);
    drawList.PushClipRect(bounds.min, bounds.max, true);

    float y = title.max.y;
    static_cast<void>(DrawToggleRow(
        drawList, "aim.remove-spread", "Remove spread", "", state.removeSpread,
        {{bounds.min.x, y}, {bounds.max.x, y + 41.0F}}, theme, false, true, false, 65.0F, 19.0F));
    y += 41.0F;
    static_cast<void>(DrawToggleRow(
        drawList, "aim.remove-recoil", "Remove recoil", "", state.removeRecoil,
        {{bounds.min.x, y}, {bounds.max.x, y + 41.0F}}, theme, true, true, false, 65.0F, 19.0F));
    y += 41.0F;
    DrawComboRow(drawList, state, {{bounds.min.x, y}, {bounds.max.x, y + 75.0F}}, theme);
    y += 75.0F;
    static_cast<void>(DrawToggleRow(drawList, "aim.quick-peek", "Quick peek assist",
                                    "Helps players perform rapid peeks around corners",
                                    state.quickPeek, {{bounds.min.x, y}, {bounds.max.x, y + 66.0F}},
                                    theme, false, true, false, 65.0F, 19.0F));
    y += 66.0F;
    DrawText(drawList, {bounds.min.x + 12.0F, y + 12.0F}, theme.textSecondary, "Player",
             kSmallTextPx);
    DrawChevron(drawList, {bounds.max.x - 15.0F, y + 18.0F}, theme.textSecondary);
    drawList.AddLine({bounds.min.x + 10.0F, y + 35.0F}, {bounds.max.x - 10.0F, y + 35.0F},
                     WithAlpha(theme.cardBorder, 0.8F));
    y += 36.0F;
    static_cast<void>(DrawToggleRow(
        drawList, "aim.force-body", "Force body aimbot", "", state.forceBodyAim,
        {{bounds.min.x, y}, {bounds.max.x, y + 42.0F}}, theme, false, true, false, 65.0F, 19.0F));
    y += 42.0F;
    static_cast<void>(DrawToggleRow(
        drawList, "aim.duck-peek", "Duck peek assist", "", state.duckPeekAssist,
        {{bounds.min.x, y}, {bounds.max.x, y + 42.0F}}, theme, true, false, false, 51.0F, 19.0F));
    drawList.PopClipRect();
}

} // namespace

void ResetMenuState(MenuState& state) noexcept {
    state = MenuState{};
}

MenuDiagnostics RenderMenu(MenuState& state, const MenuEvents& events) {
    ImGuiIO& io = ImGui::GetIO();
    const Theme& theme = DefaultTheme();
    ImGui::SetNextWindowPos({0.0F, 0.0F});
    ImGui::SetNextWindowSize(io.DisplaySize);
    ImGui::PushStyleVar(ImGuiStyleVar_WindowPadding, {0.0F, 0.0F});
    ImGui::PushStyleVar(ImGuiStyleVar_WindowBorderSize, 0.0F);
    ImGui::PushStyleColor(ImGuiCol_WindowBg, IM_COL32(0, 0, 0, 0));
    ImGui::Begin("##studio-starter-canvas", nullptr,
                 ImGuiWindowFlags_NoDecoration | ImGuiWindowFlags_NoMove |
                     ImGuiWindowFlags_NoSavedSettings | ImGuiWindowFlags_NoBringToFrontOnFocus);

    ImDrawList& drawList = *ImGui::GetWindowDrawList();
    studio::AddLinearGradient(drawList, {{0.0F, 0.0F}, io.DisplaySize}, theme.canvasTop,
                              theme.canvasTop, theme.canvasBottom, theme.canvasBottom);

    // A short deterministic entrance translation gives the entire menu a composed reveal while
    // preserving exact final geometry for captures and native parity.
    const ImGuiID rootId = ImGui::GetID("menu.reference-root");
    static_cast<void>(
        studio::SetAnimationInitialValueIfAbsent(rootId, studio::Key("entrance"), 0.0F));
    const float entrance = studio::Animate(rootId, studio::Key("entrance"), 1.0F,
                                           {.duration = 0.30, .ease = studio::Ease::OutCubic});
    const ImVec2 panelPosition{((io.DisplaySize.x - kPanelWidthPx) * 0.5F) + state.layoutOffsetXPx,
                               ((io.DisplaySize.y - kPanelHeightPx) * 0.5F) +
                                   (1.0F - entrance) * 9.0F};
    const studio::Rect panel{panelPosition,
                             {panelPosition.x + kPanelWidthPx, panelPosition.y + kPanelHeightPx}};
    studio::AddLayeredShadow(drawList, panel, IM_COL32(0, 0, 0, 255), 18.0F, {0.0F, 6.0F},
                             theme.panelRoundingPx, 6);
    drawList.AddRectFilled(panel.min, panel.max, theme.panel, theme.panelRoundingPx);
    drawList.AddRect(panel.min, panel.max, theme.panelBorder, theme.panelRoundingPx);

    const studio::Rect header{panel.min, {panel.max.x, panel.min.y + kHeaderHeightPx}};
    DrawTopNavigation(drawList, state, header, theme);
    const studio::Rect breadcrumb{{panel.min.x, header.max.y},
                                  {panel.max.x, header.max.y + kBreadcrumbHeightPx}};
    DrawBreadcrumb(drawList, breadcrumb, theme);

    // These horizontal measurements come from the supplied 620 x 395 reference mapped onto the
    // canonical 900 x 600 framebuffer. A deliberately wide trailing gutter is part of the source
    // composition; distributing that space into equal columns made the first remake look generic.
    constexpr float kContentInsetPx = 23.0F;
    constexpr float kColumnGapPx = 14.0F;
    constexpr float kLeftColumnWidthPx = 379.0F;
    constexpr float kRightColumnWidthPx = 390.0F;
    const float contentTop = breadcrumb.max.y + 8.0F;
    const float contentBottom = panel.max.y - 2.0F;
    const studio::Rect left{{panel.min.x + kContentInsetPx, contentTop},
                            {panel.min.x + kContentInsetPx + kLeftColumnWidthPx, contentBottom}};
    const studio::Rect right{{left.max.x + kColumnGapPx, contentTop},
                             {left.max.x + kColumnGapPx + kRightColumnWidthPx, contentBottom}};

    MenuDiagnostics diagnostics{};
    DrawLeftPanel(drawList, state, left, theme, diagnostics);
    DrawRightPanel(drawList, state, right, theme);

    const float scrollbarX = panel.max.x - 53.0F;
    drawList.AddRectFilled({scrollbarX, contentTop + 3.0F},
                           {scrollbarX + 6.0F, contentBottom - 3.0F}, IM_COL32(27, 26, 32, 255),
                           2.0F);
    drawList.AddRectFilled({scrollbarX, contentTop + 12.0F},
                           {scrollbarX + 6.0F, contentTop + 322.0F}, theme.accent, 2.0F);

    ImGui::End();
    ImGui::PopStyleColor();
    ImGui::PopStyleVar(2);
    if (events.onRendered)
        events.onRendered(diagnostics);
    return diagnostics;
}

std::string_view StarterSourceSha256() noexcept {
    return STUDIO_STARTER_SOURCE_SHA256;
}

} // namespace studio_example
