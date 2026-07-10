#include <cmath>
#include <cstdlib>
#include <imgui.h>
#include <studio/animation.hpp>
#include <studio/runtime.hpp>
#include <studio/version.hpp>

int main() {
    static_assert(__cplusplus >= 202002L, "ImGui Studio requires C++20 or newer");

    if (studio::kRuntimeVersion != "0.1.0") {
        return 11;
    }

    IMGUI_CHECKVERSION();
    ImGuiContext* imgui = ImGui::CreateContext();
    studio::ProjectContext runtime(*imgui, {.mode = studio::RuntimeMode::Deterministic});

    // A first call without an explicit initial value starts settled at its target.
    studio::BeginFrame(runtime, {.frameIndex = 0, .absoluteTimeUs = 0, .deltaTimeUs = 0});
    constexpr ImGuiID widget = 42;
    constexpr studio::PropertyKey active = studio::Key("active");
    if (active == 0 || studio::Key("") != 0 || studio::Animate(widget, active, 0.0F) != 0.0F) {
        return 12;
    }
    studio::ResetAnimation(widget, active);
    studio::SetAnimationInitialValue(widget, active, 0.0F);
    if (studio::Animate(widget, active, 1.0F, {.duration = 1.0, .ease = studio::Ease::Linear}) !=
        0.0F) {
        return 13;
    }
    studio::EndFrame(runtime);

    // Integer-microsecond time produces an exact linear midpoint independently of host scheduling.
    studio::BeginFrame(runtime,
                       {.frameIndex = 1, .absoluteTimeUs = 500'000, .deltaTimeUs = 500'000});
    const float midpoint =
        studio::Animate(widget, active, 1.0F, {.duration = 1.0, .ease = studio::Ease::Linear});
    if (std::abs(midpoint - 0.5F) > 1e-6F || studio::GetAnimationStatus(widget, active).settled) {
        return 14;
    }
    studio::EndFrame(runtime);

    // Reset must erase both clock history and animation storage so time zero can be replayed.
    runtime.ResetRuntimeState();
    studio::BeginFrame(runtime, {.frameIndex = 0, .absoluteTimeUs = 0, .deltaTimeUs = 0});
    if (studio::GetAnimationStatus(widget, active).exists) {
        return 15;
    }
    studio::EndFrame(runtime);
    ImGui::DestroyContext(imgui);

    return EXIT_SUCCESS;
}
