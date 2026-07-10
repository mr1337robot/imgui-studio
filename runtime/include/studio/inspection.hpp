#pragma once

#include <span>
#include <string>
#include <studio/animation.hpp>
#include <studio/widget.hpp>
#include <vector>

namespace studio {

struct InspectedAnimation {
    std::string name;
    float value{};
    float target{};
    bool settled{};
};
struct InspectedWidget {
    std::string stableId;
    std::string semanticType;
    Rect bounds{};
    Rect hitbox{};
    Interaction interaction{};
    bool boolValue{};
    std::vector<InspectedAnimation> animations;
};
struct RuntimeDiagnostic {
    std::string code;
    std::string stableId;
    std::string message;
};
/// Immutable view valid until the next BeginFrame or context reset.
[[nodiscard]] std::span<const InspectedWidget> InspectedWidgets();
[[nodiscard]] std::span<const RuntimeDiagnostic> RuntimeDiagnostics();

} // namespace studio
