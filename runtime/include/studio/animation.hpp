#pragma once

#include <cstdint>
#include <imgui.h>
#include <string_view>
#include <studio/runtime.hpp>

namespace studio {

using PropertyKey = std::uint64_t;

/// Hashes a stable UTF-8 property name with 64-bit FNV-1a; zero is reserved for invalid input.
[[nodiscard]] constexpr PropertyKey Key(const std::string_view text) noexcept {
    if (text.empty())
        return 0;
    PropertyKey value = 14695981039346656037ULL;
    for (const char character : text) {
        const auto byte = static_cast<unsigned char>(character);
        value ^= byte;
        value *= 1099511628211ULL;
    }
    return value == 0 ? 1 : value;
}

enum class Ease : std::uint8_t {
    Linear,
    InQuad,
    OutQuad,
    InOutQuad,
    InCubic,
    OutCubic,
    InOutCubic,
    InSine,
    OutSine,
    InOutSine
};

struct TweenOptions {
    double duration{0.20};
    double delay{};
    Ease ease{Ease::OutCubic};
};
struct SpringOptions {
    double stiffness{240.0};
    double damping{22.0};
    double delay{};
    double positionEpsilon{1e-4};
    double velocityEpsilon{1e-3};
};
struct AnimationStatus {
    bool exists{};
    bool delayed{};
    bool settled{};
    double elapsedSeconds{};
    double velocityMagnitude{};
};

[[nodiscard]] float Animate(ImGuiID widget, PropertyKey property, float target,
                            TweenOptions options = {});
[[nodiscard]] ImVec2 Animate(ImGuiID widget, PropertyKey property, ImVec2 target,
                             TweenOptions options = {});
[[nodiscard]] ImVec4 Animate(ImGuiID widget, PropertyKey property, ImVec4 target,
                             TweenOptions options = {});
[[nodiscard]] float Spring(ImGuiID widget, PropertyKey property, float target,
                           SpringOptions options = {});
[[nodiscard]] ImVec2 Spring(ImGuiID widget, PropertyKey property, ImVec2 target,
                            SpringOptions options = {});
void SetAnimationInitialValue(ImGuiID widget, PropertyKey property, float value);
[[nodiscard]] bool SetAnimationInitialValueIfAbsent(ImGuiID widget, PropertyKey property,
                                                    float value);
void ResetAnimation(ImGuiID widget, PropertyKey property);
void ResetAnimations(ImGuiID widget);
[[nodiscard]] AnimationStatus GetAnimationStatus(ImGuiID widget, PropertyKey property);

} // namespace studio
