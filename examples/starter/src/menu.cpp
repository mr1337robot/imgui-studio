/**
 * Editable Phase 5 starter menu. It composes the project-owned theme and custom component source
 * into a real Dear ImGui draw-list menu; no visible control delegates to a stock ImGui widget.
 */
#include <array>
#include <imgui.h>
#include <studio/studio.hpp>
#include <studio_example/components.hpp>
#include <studio_example/menu.hpp>

namespace studio_example {
namespace {

constexpr float kPanelWidthPx = 760.0F;
constexpr float kPanelHeightPx = 480.0F;
constexpr float kSidebarWidthPx = 170.0F;
constexpr float kCardWidthPx = 250.0F;

void DrawBrandMark(ImDrawList& drawList, const ImVec2 position, const Theme& theme) {
    // This small vector mark is intentionally project-owned draw-list geometry rather than an
    // installed system icon. It remains crisp and identical on the two portable MVP backends.
    drawList.AddCircleFilled(position, 13.0F, theme.accentSecondary);
    drawList.AddCircleFilled({position.x - 3.0F, position.y - 3.0F}, 6.0F, theme.accent);
    drawList.AddCircleFilled({position.x + 5.0F, position.y + 5.0F}, 3.0F, theme.textPrimary);
}

void DrawSidebar(ImDrawList& drawList, MenuState& state, const studio::Rect sidebar,
                 const Theme& theme) {
    drawList.AddRectFilled(sidebar.min, sidebar.max, IM_COL32(11, 14, 28, 205), 13.0F);
    const std::array<std::string_view, 4> labels{"General", "Appearance", "Automation", "About"};
    const std::array<std::string_view, 4> stableIds{"navigation.general", "navigation.appearance",
                                                    "navigation.automation", "navigation.about"};
    for (std::size_t index = 0; index < labels.size(); ++index) {
        const ImVec2 position{sidebar.min.x + 8.0F,
                              sidebar.min.y + 14.0F + static_cast<float>(index) * 42.0F};
        if (components::NavigationItem(stableIds[index], labels[index],
                                       state.navigationIndex == static_cast<int>(index), position,
                                       {sidebar.Size().x - 16.0F, 34.0F}, theme)) {
            state.navigationIndex = static_cast<int>(index);
        }
    }
    drawList.AddText({sidebar.min.x + 16.0F, sidebar.max.y - 42.0F}, theme.textSecondary,
                     "PORTABLE TIER");
    drawList.AddCircleFilled({sidebar.min.x + 20.0F, sidebar.max.y - 21.0F}, 4.0F, theme.positive);
    drawList.AddText({sidebar.min.x + 31.0F, sidebar.max.y - 27.0F}, theme.textPrimary,
                     "WebGL2 + DX11");
}

void DrawPrimaryCard(ImDrawList& drawList, MenuState& state, const studio::Rect bounds,
                     const Theme& theme, MenuDiagnostics& diagnostics) {
    const studio::Rect content = components::Card(drawList, bounds, theme, state.enabled);
    drawList.AddText(content.min, theme.textPrimary, "Render controls");
    drawList.AddText({content.min.x, content.min.y + 22.0F}, theme.textSecondary,
                     "Custom toggles and animated sliders");
    const ImVec2 togglePosition{content.min.x, content.min.y + 60.0F};
    constexpr components::ToggleStyle kCanonicalToggleStyle{{58.0F, 30.0F}, 11.0F};
    static_cast<void>(components::Toggle("settings.enable", "Enable neon controls", state.enabled,
                                         togglePosition, theme, kCanonicalToggleStyle));
    diagnostics.toggleBounds = {togglePosition.x, togglePosition.y, 58.0F, 30.0F};
    diagnostics.toggleEnabled = state.enabled;
    diagnostics.toggleProgress = studio::Animate(
        ImGui::GetID("settings.enable"), studio::Key("active"), state.enabled ? 1.0F : 0.0F,
        {.duration = theme.animationDurationSeconds, .ease = studio::Ease::OutCubic});
    diagnostics.toggleSettled =
        studio::GetAnimationStatus(ImGui::GetID("settings.enable"), studio::Key("active")).settled;

    static_cast<void>(components::Toggle("settings.shadows", "Layered portable shadows",
                                         state.layeredShadows,
                                         {content.min.x, content.min.y + 96.0F}, theme));
    static_cast<void>(
        components::SliderFloat("settings.intensity", "Accent intensity", state.intensity,
                                {content.min.x, content.min.y + 145.0F}, content.Size().x - 8.0F,
                                {.minimum = 0.0F, .maximum = 1.0F, .precision = 2}, theme));
    static_cast<void>(components::SliderInt("settings.samples", "Glow samples", state.samples,
                                            {content.min.x, content.min.y + 198.0F},
                                            content.Size().x - 8.0F, 8, 128, theme));
    if (components::Button("actions.toast", "Show toast", {content.min.x, content.max.y - 40.0F},
                           {106.0F, 30.0F}, false, theme)) {
        state.toastVisible = !state.toastVisible;
    }
    if (components::Button("actions.modal", "Open modal",
                           {content.min.x + 116.0F, content.max.y - 40.0F}, {110.0F, 30.0F}, true,
                           theme)) {
        state.modalOpen = true;
    }
}

void DrawSecondaryCard(ImDrawList& drawList, MenuState& state, const studio::Rect bounds,
                       const Theme& theme) {
    const studio::Rect content = components::Card(drawList, bounds, theme);
    drawList.AddText(content.min, theme.textPrimary, "Input & style");
    if (components::Tab("tabs.behavior", "Behavior", state.tabIndex == 1,
                        {content.min.x + 110.0F, content.min.y + 28.0F}, {90.0F, 28.0F}, theme)) {
        state.tabIndex = 1;
    }
    if (components::Tab("tabs.appearance", "Appearance", state.tabIndex == 0,
                        {content.min.x, content.min.y + 28.0F}, {104.0F, 28.0F}, theme)) {
        state.tabIndex = 0;
    }
    const std::array<std::string_view, 3> qualities{"Low", "Balanced", "Ultra"};
    static_cast<void>(components::Combo(
        "settings.quality", "Quality preset", state.qualityIndex, state.comboOpen, qualities,
        {content.min.x, content.min.y + 82.0F}, content.Size().x - 6.0F, theme));
    static_cast<void>(components::Keybind(
        "settings.keybind", "Menu key", state.keybind, state.keybindCapturing,
        {content.min.x, content.min.y + 142.0F}, content.Size().x - 6.0F, theme));
    static_cast<void>(components::ColorPicker(
        "settings.accent", "Accent color", state.accentColor, state.colorPickerOpen,
        {content.min.x, content.min.y + 202.0F}, content.Size().x - 6.0F, theme));
    static_cast<void>(components::IconButton(
        "actions.settings", "*", {content.max.x - 32.0F, content.max.y - 38.0F}, 30.0F, theme));
    drawList.AddText({content.min.x, content.max.y - 30.0F}, theme.textSecondary,
                     "All controls are draw-list rendered.");
}

} // namespace

void ResetMenuState(MenuState& state) noexcept {
    state = MenuState{};
}

MenuDiagnostics RenderMenu(MenuState& state, const MenuEvents& events) {
    ImGuiIO& io = ImGui::GetIO();
    const Theme theme = DefaultTheme();
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
    const ImVec2 panelPosition{((io.DisplaySize.x - kPanelWidthPx) * 0.5F) + state.layoutOffsetXPx,
                               (io.DisplaySize.y - kPanelHeightPx) * 0.5F};
    const studio::Rect panel{panelPosition,
                             {panelPosition.x + kPanelWidthPx, panelPosition.y + kPanelHeightPx}};
    if (state.layeredShadows)
        studio::AddLayeredShadow(drawList, panel, theme.accentSecondary, 30.0F, {0.0F, 10.0F},
                                 theme.panelRoundingPx, 10);
    drawList.AddRectFilled(panel.min, panel.max, theme.panel, theme.panelRoundingPx);
    drawList.AddRect(panel.min, panel.max, theme.panelBorder, theme.panelRoundingPx);

    DrawBrandMark(drawList, {panel.min.x + 34.0F, panel.min.y + 34.0F}, theme);
    drawList.AddText({panel.min.x + 57.0F, panel.min.y + 24.0F}, theme.textPrimary, "IMGUI STUDIO");
    drawList.AddText({panel.min.x + 57.0F, panel.min.y + 44.0F}, theme.textSecondary,
                     "Editable portable component foundation");
    static_cast<void>(components::IconButton(
        "actions.help", "?", {panel.max.x - 50.0F, panel.min.y + 18.0F}, 28.0F, theme));
    drawList.AddLine({panel.min.x + 20.0F, panel.min.y + 76.0F},
                     {panel.max.x - 20.0F, panel.min.y + 76.0F}, theme.panelBorder, 1.0F);

    const studio::Rect sidebar{{panel.min.x + 20.0F, panel.min.y + 94.0F},
                               {panel.min.x + 20.0F + kSidebarWidthPx, panel.max.y - 22.0F}};
    DrawSidebar(drawList, state, sidebar, theme);
    MenuDiagnostics diagnostics{};
    const studio::Rect leftCard{{sidebar.max.x + 18.0F, panel.min.y + 94.0F},
                                {sidebar.max.x + 18.0F + kCardWidthPx, panel.max.y - 22.0F}};
    const studio::Rect rightCard{{leftCard.max.x + 16.0F, panel.min.y + 94.0F},
                                 {panel.max.x - 20.0F, panel.max.y - 22.0F}};
    DrawPrimaryCard(drawList, state, leftCard, theme, diagnostics);
    DrawSecondaryCard(drawList, state, rightCard, theme);
    components::Toast("toast.saved", "Theme state updated", state.toastVisible,
                      {panel.max.x - 230.0F, panel.min.y + 86.0F}, 210.0F, theme);
    static_cast<void>(components::Modal(
        "modal.preview", "Portable preview settings", state.modalOpen,
        {{panel.min.x + 240.0F, panel.min.y + 142.0F}, {panel.max.x - 70.0F, panel.max.y - 105.0F}},
        theme));

    ImGui::End();
    ImGui::PopStyleColor();
    ImGui::PopStyleVar(2);
    // Integration callbacks are synchronous and occur only after all draw commands and
    // diagnostics for this menu frame are complete. The browser/native Studio hosts pass the
    // default empty binding, while exported consumers may connect application observability.
    if (events.onRendered)
        events.onRendered(diagnostics);
    return diagnostics;
}

std::string_view StarterSourceSha256() noexcept {
    return STUDIO_STARTER_SOURCE_SHA256;
}

} // namespace studio_example
