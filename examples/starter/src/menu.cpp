#include <algorithm>
#include <cmath>
#include <imgui.h>
#include <studio_example/menu.hpp>

namespace studio_example {
namespace {

// The starter deliberately owns its complete palette and pixel geometry. Depending on a backend
// theme or an installed font would make the browser/native comparison host-dependent.
constexpr ImU32 kCanvasTop = IM_COL32(8, 11, 22, 255);
constexpr ImU32 kCanvasBottom = IM_COL32(15, 10, 30, 255);
constexpr ImU32 kPanel = IM_COL32(18, 22, 38, 246);
constexpr ImU32 kPanelBorder = IM_COL32(70, 64, 106, 145);
constexpr ImU32 kCard = IM_COL32(24, 28, 48, 255);
constexpr ImU32 kCardBorder = IM_COL32(83, 76, 121, 120);
constexpr ImU32 kTextPrimary = IM_COL32(245, 244, 255, 255);
constexpr ImU32 kTextSecondary = IM_COL32(157, 158, 188, 255);
constexpr ImU32 kAccentPink = IM_COL32(235, 35, 255, 255);
constexpr ImU32 kAccentPurple = IM_COL32(119, 58, 255, 255);

constexpr float kPanelWidthPx = 620.0F;
constexpr float kPanelHeightPx = 340.0F;
constexpr float kPanelRoundingPx = 18.0F;
constexpr float kToggleWidthPx = 58.0F;
constexpr float kToggleHeightPx = 30.0F;
constexpr float kAnimationResponse = 13.0F;

[[nodiscard]] ImU32 LerpColor(ImU32 from, ImU32 to, float amount) {
    // ImGui packs colors into an integer for draw commands. Convert to normalized float channels
    // before interpolation so each RGBA component is blended independently.
    const ImVec4 fromColor = ImGui::ColorConvertU32ToFloat4(from);
    const ImVec4 toColor = ImGui::ColorConvertU32ToFloat4(to);
    const ImVec4 blended{fromColor.x + ((toColor.x - fromColor.x) * amount),
                         fromColor.y + ((toColor.y - fromColor.y) * amount),
                         fromColor.z + ((toColor.z - fromColor.z) * amount),
                         fromColor.w + ((toColor.w - fromColor.w) * amount)};
    return ImGui::ColorConvertFloat4ToU32(blended);
}

void DrawGlowRect(ImDrawList& drawList, const ImVec2 minimum, const ImVec2 maximum,
                  const ImU32 color, const float rounding) {
    // Portable Dear ImGui has no blur pass. Several increasingly transparent rectangles create a
    // cheap glow using ordinary draw-list primitives, so the effect is identical on WebGL2/DX11.
    for (int layer = 4; layer >= 1; --layer) {
        const float expansion = static_cast<float>(layer) * 3.0F;
        ImVec4 glow = ImGui::ColorConvertU32ToFloat4(color);
        glow.w = 0.025F * static_cast<float>(5 - layer);
        drawList.AddRectFilled({minimum.x - expansion, minimum.y - expansion},
                               {maximum.x + expansion, maximum.y + expansion},
                               ImGui::ColorConvertFloat4ToU32(glow), rounding + expansion);
    }
}

[[nodiscard]] WidgetGeometry RenderAnimatedToggle(MenuState& state, const ImVec2 position,
                                                  const float deltaSeconds) {
    // InvisibleButton participates in ImGui's normal ID, hover, focus, and click systems while
    // leaving every visible pixel to this custom widget. The hidden "##" prefix gives the item a
    // stable ID without rendering a label.
    ImGui::SetCursorScreenPos(position);
    const bool clicked =
        ImGui::InvisibleButton("##studio-enabled-toggle", {kToggleWidthPx, kToggleHeightPx});
    if (clicked) {
        state.enabled = !state.enabled;
    }

    const float target = state.enabled ? 1.0F : 0.0F;
    // Frame-rate-independent exponential smoothing:
    //   response = 1 - e^(-speed * dt)
    // Moving `progress` by this fraction of the remaining distance produces the same shape at
    // different frame rates. Clamp dt to 100 ms so a debugger pause cannot jump through the whole
    // transition or feed an unstable value into exp(). Phase 3 replaces host delta time with the
    // deterministic Studio clock while retaining project-owned state.
    const float safeDelta = std::clamp(deltaSeconds, 0.0F, 0.1F);
    const float response = 1.0F - std::exp(-kAnimationResponse * safeDelta);
    state.toggleProgress =
        std::clamp(state.toggleProgress + ((target - state.toggleProgress) * response), 0.0F, 1.0F);

    const bool hovered = ImGui::IsItemHovered();
    ImDrawList& drawList = *ImGui::GetWindowDrawList();
    const ImVec2 maximum{position.x + kToggleWidthPx, position.y + kToggleHeightPx};
    const ImU32 background =
        LerpColor(IM_COL32(55, 58, 81, 255), kAccentPurple, state.toggleProgress);

    if (hovered || state.toggleProgress > 0.02F) {
        DrawGlowRect(drawList, position, maximum,
                     LerpColor(kAccentPurple, kAccentPink, state.toggleProgress),
                     kToggleHeightPx * 0.5F);
    }

    drawList.AddRectFilled(position, maximum, background, kToggleHeightPx * 0.5F);
    drawList.AddRect(position, maximum, IM_COL32(255, 255, 255, hovered ? 80 : 35),
                     kToggleHeightPx * 0.5F, 0, 1.0F);

    // The thumb center travels between equal 15 px insets. Using one progress value for position,
    // track color, and glow keeps all visual channels synchronized during target reversal.
    constexpr float knobRadius = 11.0F;
    const float knobMinimumX = position.x + 15.0F;
    const float knobX =
        knobMinimumX + (((maximum.x - 15.0F) - knobMinimumX) * state.toggleProgress);
    drawList.AddCircleFilled({knobX, position.y + (kToggleHeightPx * 0.5F)}, knobRadius + 2.0F,
                             IM_COL32(15, 12, 28, 90));
    drawList.AddCircleFilled({knobX, position.y + (kToggleHeightPx * 0.5F)}, knobRadius,
                             IM_COL32(250, 247, 255, 255));

    return {position.x, position.y, kToggleWidthPx, kToggleHeightPx};
}

void DrawNavigation(ImDrawList& drawList, const ImVec2 panelPosition) {
    // Draw-list positions are absolute screen coordinates. Deriving every child from panelPosition
    // lets the negative parity fixture shift the entire design without changing local geometry.
    const ImVec2 navigationMinimum{panelPosition.x + 22.0F, panelPosition.y + 88.0F};
    const ImVec2 navigationMaximum{panelPosition.x + 180.0F, panelPosition.y + 314.0F};
    drawList.AddRectFilled(navigationMinimum, navigationMaximum, IM_COL32(13, 17, 31, 190), 12.0F);
    drawList.AddRectFilled({navigationMinimum.x + 10.0F, navigationMinimum.y + 12.0F},
                           {navigationMaximum.x - 10.0F, navigationMinimum.y + 52.0F},
                           IM_COL32(74, 36, 126, 180), 9.0F);
    drawList.AddRectFilled({navigationMinimum.x + 10.0F, navigationMinimum.y + 18.0F},
                           {navigationMinimum.x + 13.0F, navigationMinimum.y + 46.0F}, kAccentPink,
                           2.0F);
    drawList.AddText({navigationMinimum.x + 25.0F, navigationMinimum.y + 23.0F}, kTextPrimary,
                     "General");
    drawList.AddText({navigationMinimum.x + 25.0F, navigationMinimum.y + 77.0F}, kTextSecondary,
                     "Appearance");
    drawList.AddText({navigationMinimum.x + 25.0F, navigationMinimum.y + 119.0F}, kTextSecondary,
                     "Automation");
    drawList.AddText({navigationMinimum.x + 25.0F, navigationMinimum.y + 161.0F}, kTextSecondary,
                     "About");
}

} // namespace

void ResetMenuState(MenuState& state) noexcept {
    // Value initialization is the single canonical reset path used by both platform hosts.
    state = MenuState{};
}

MenuDiagnostics RenderMenu(MenuState& state, const float deltaSeconds) {
    // This transparent, decoration-free ImGui window exists only to establish an input/layout
    // scope. The menu itself is drawn into its ImDrawList rather than assembled from stock widgets.
    ImGuiIO& io = ImGui::GetIO();
    ImGui::SetNextWindowPos({0.0F, 0.0F});
    ImGui::SetNextWindowSize(io.DisplaySize);
    ImGui::PushStyleVar(ImGuiStyleVar_WindowPadding, {0.0F, 0.0F});
    ImGui::PushStyleVar(ImGuiStyleVar_WindowBorderSize, 0.0F);
    ImGui::PushStyleColor(ImGuiCol_WindowBg, IM_COL32(0, 0, 0, 0));
    ImGui::Begin("##studio-starter-canvas", nullptr,
                 ImGuiWindowFlags_NoDecoration | ImGuiWindowFlags_NoMove |
                     ImGuiWindowFlags_NoSavedSettings | ImGuiWindowFlags_NoBringToFrontOnFocus);

    ImDrawList& drawList = *ImGui::GetWindowDrawList();

    // Paint from back to front: canvas, outer panel, navigation, content card, then interaction.
    // Keeping this order explicit is important because ImDrawList uses painter's-order compositing.
    drawList.AddRectFilledMultiColor({0.0F, 0.0F}, io.DisplaySize, kCanvasTop, kCanvasTop,
                                     kCanvasBottom, kCanvasBottom);

    const ImVec2 panelPosition{((io.DisplaySize.x - kPanelWidthPx) * 0.5F) + state.layoutOffsetXPx,
                               (io.DisplaySize.y - kPanelHeightPx) * 0.5F};
    const ImVec2 panelMaximum{panelPosition.x + kPanelWidthPx, panelPosition.y + kPanelHeightPx};
    DrawGlowRect(drawList, panelPosition, panelMaximum, kAccentPurple, kPanelRoundingPx);
    drawList.AddRectFilled(panelPosition, panelMaximum, kPanel, kPanelRoundingPx);
    drawList.AddRect(panelPosition, panelMaximum, kPanelBorder, kPanelRoundingPx, 0, 1.0F);

    drawList.AddText({panelPosition.x + 26.0F, panelPosition.y + 24.0F}, kAccentPink,
                     "IMGUI STUDIO");
    drawList.AddText({panelPosition.x + 450.0F, panelPosition.y + 24.0F}, kTextSecondary,
                     "PHASE 1  /  LIVE");
    drawList.AddLine({panelPosition.x + 22.0F, panelPosition.y + 66.0F},
                     {panelMaximum.x - 22.0F, panelPosition.y + 66.0F}, kPanelBorder, 1.0F);

    DrawNavigation(drawList, panelPosition);

    const ImVec2 cardMinimum{panelPosition.x + 198.0F, panelPosition.y + 88.0F};
    const ImVec2 cardMaximum{panelMaximum.x - 22.0F, panelMaximum.y - 26.0F};
    drawList.AddRectFilled(cardMinimum, cardMaximum, kCard, 12.0F);
    drawList.AddRect(cardMinimum, cardMaximum, kCardBorder, 12.0F, 0, 1.0F);
    drawList.AddText({cardMinimum.x + 24.0F, cardMinimum.y + 22.0F}, kTextPrimary,
                     "Interface preview");
    drawList.AddText({cardMinimum.x + 24.0F, cardMinimum.y + 48.0F}, kTextSecondary,
                     "One source. Browser and native.");

    drawList.AddText({cardMinimum.x + 24.0F, cardMinimum.y + 108.0F}, kTextPrimary,
                     "Enable animated controls");
    drawList.AddText({cardMinimum.x + 24.0F, cardMinimum.y + 132.0F}, kTextSecondary,
                     "Click the custom toggle to inspect its transition.");
    const ImVec2 togglePosition{cardMaximum.x - kToggleWidthPx - 24.0F, cardMinimum.y + 106.0F};
    const WidgetGeometry toggleBounds = RenderAnimatedToggle(state, togglePosition, deltaSeconds);

    const float statusY = cardMaximum.y - 55.0F;
    drawList.AddCircleFilled({cardMinimum.x + 29.0F, statusY + 6.0F}, 5.0F,
                             state.enabled ? kAccentPink : kTextSecondary);
    drawList.AddText({cardMinimum.x + 43.0F, statusY - 1.0F}, kTextSecondary,
                     state.enabled ? "Runtime connected" : "Runtime paused");

    // Dear ImGui style stacks are process-global within the current context. Every push above must
    // be balanced in the same frame or later windows would inherit this canvas's transparent style.
    ImGui::End();
    ImGui::PopStyleColor();
    ImGui::PopStyleVar(2);

    return {toggleBounds, state.enabled, state.toggleProgress};
}

std::string_view StarterSourceSha256() noexcept {
    return STUDIO_STARTER_SOURCE_SHA256;
}

} // namespace studio_example
