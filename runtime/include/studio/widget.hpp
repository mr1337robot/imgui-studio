#pragma once

#include <cstdint>
#include <imgui.h>
#include <optional>
#include <string_view>

namespace studio {

struct Rect {
    ImVec2 min{};
    ImVec2 max{};
    [[nodiscard]] ImVec2 Size() const noexcept;
    [[nodiscard]] ImVec2 Center() const noexcept;
    [[nodiscard]] bool IsFinite() const noexcept;
    [[nodiscard]] bool HasPositiveArea() const noexcept;
};
enum class ItemFlags : std::uint32_t {
    None = 0,
    Disabled = 1,
    AllowOverlap = 2,
    NoNavigation = 4,
    NoFocusOnClick = 8
};
struct WidgetDescriptor {
    std::string_view stableId;
    std::string_view semanticType;
    ImGuiID imguiId{};
    Rect bounds{};
    std::optional<Rect> hitbox{};
    ImVec2 layoutSize{-1, -1};
    ItemFlags flags{ItemFlags::None};
    std::string_view parentStableId{};
};
struct Interaction {
    bool registered{}, visible{}, clipped{}, hovered{}, held{}, pressed{}, clicked{}, active{},
        focused{}, navFocused{}, navActivated{}, disabled{};
};
[[nodiscard]] Interaction Interact(const WidgetDescriptor& descriptor);
[[nodiscard]] bool RegisterItem(const WidgetDescriptor& descriptor);

} // namespace studio
