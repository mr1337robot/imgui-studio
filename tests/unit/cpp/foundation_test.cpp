#include <cmath>
#include <cstdlib>
#include <imgui.h>
#include <studio/animation.hpp>
#include <studio/inspection.hpp>
#include <studio/runtime.hpp>
#include <studio/version.hpp>
#include <studio/widget.hpp>

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

    // Recoverable inspection defects remain bounded diagnostics and do not poison draw geometry.
    ImGuiIO& io = ImGui::GetIO();
    io.DisplaySize = {320.0F, 200.0F};
    io.DeltaTime = 1.0F / 60.0F;
    unsigned char* fontPixels = nullptr;
    int fontWidth = 0;
    int fontHeight = 0;
    io.Fonts->GetTexDataAsRGBA32(&fontPixels, &fontWidth, &fontHeight);
    ImGui::NewFrame();
    ImGui::Begin("diagnostic-fixture");
    studio::BeginFrame(runtime, {.frameIndex = 1,
                                 .absoluteTimeUs = 0,
                                 .deltaTimeUs = 0,
                                 .viewportPixels = io.DisplaySize,
                                 .dpiScale = 1.0F});
    static_cast<void>(studio::Interact({.stableId = "invalid.geometry",
                                        .semanticType = "fixture",
                                        .imguiId = ImGui::GetID("invalid"),
                                        .bounds = {{10.0F, 10.0F}, {5.0F, 20.0F}}}));
    const studio::Rect overlappingBounds{{20.0F, 20.0F}, {80.0F, 50.0F}};
    static_cast<void>(studio::Interact({.stableId = "fixture.first",
                                        .semanticType = "fixture",
                                        .imguiId = ImGui::GetID("first"),
                                        .bounds = overlappingBounds}));
    static_cast<void>(studio::Interact({.stableId = "fixture.second",
                                        .semanticType = "fixture",
                                        .imguiId = ImGui::GetID("second"),
                                        .bounds = overlappingBounds}));
    bool invalidGeometryFound = false;
    bool overlapFound = false;
    for (const auto& diagnostic : studio::RuntimeDiagnostics()) {
        invalidGeometryFound |= diagnostic.code == "INVALID_GEOMETRY";
        overlapFound |= diagnostic.code == "HITBOX_OVERLAP";
    }
    if (!invalidGeometryFound || !overlapFound) {
        return 16;
    }
    studio::EndFrame(runtime);
    ImGui::End();
    ImGui::Render();
    ImGui::DestroyContext(imgui);

    return EXIT_SUCCESS;
}
