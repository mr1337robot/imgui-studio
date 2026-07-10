#pragma once

#include <cstdint>
#include <imgui.h>
#include <memory>

namespace studio {

class ProjectContext;
struct FrameParams;

/// Selects whether the host supplies realtime or explicitly scheduled frame time.
enum class RuntimeMode : std::uint8_t { Realtime, Deterministic };

/// Read-only clock values for the frame currently being rendered.
class Clock final {
  public:
    [[nodiscard]] RuntimeMode Mode() const noexcept;
    [[nodiscard]] std::int64_t NowUs() const noexcept;
    [[nodiscard]] std::int64_t DeltaUs() const noexcept;
    [[nodiscard]] double NowSeconds() const noexcept;
    [[nodiscard]] double DeltaSeconds() const noexcept;
    [[nodiscard]] std::uint64_t FrameIndex() const noexcept;

  private:
    friend class ProjectContext;
    friend void BeginFrame(ProjectContext&, const struct FrameParams&);
    RuntimeMode mode_{RuntimeMode::Realtime};
    std::int64_t nowUs_{};
    std::int64_t deltaUs_{};
    std::uint64_t frameIndex_{};
    bool initialized_{};
};

/// Runtime limits and feature switches owned by one ImGui preview instance.
struct ProjectContextConfig {
    RuntimeMode mode{RuntimeMode::Realtime};
    std::uint32_t hiddenStateRetentionFrames{600};
    std::int64_t hiddenStateRetentionUs{10'000'000};
    bool inspectionEnabled{true};
    bool diagnosticsEnabled{true};
};

/// Owns all deterministic widget, animation, and inspection state for one ImGui context.
class ProjectContext final {
  public:
    explicit ProjectContext(ImGuiContext& imgui, ProjectContextConfig config = {});
    ~ProjectContext();
    ProjectContext(const ProjectContext&) = delete;
    ProjectContext& operator=(const ProjectContext&) = delete;

    [[nodiscard]] ImGuiContext& ImGuiContextRef() noexcept;
    [[nodiscard]] RuntimeMode Mode() const noexcept;
    [[nodiscard]] Clock& Time() noexcept;
    /// Clears clock, animations, widget registrations, diagnostics, and pending runtime state.
    void ResetRuntimeState();
    /// Removes state that exceeded both configured hidden-widget retention thresholds.
    void CollectGarbage();

    struct Impl;
    [[nodiscard]] Impl& Internal() noexcept;

  private:
    friend void BeginFrame(ProjectContext&, const FrameParams&);
    ImGuiContext* imgui_{};
    ProjectContextConfig config_{};
    Clock clock_{};
    std::unique_ptr<Impl> impl_;
};

/// Canonical integer-microsecond inputs attached to one render frame.
struct FrameParams {
    std::uint64_t frameIndex{};
    std::int64_t absoluteTimeUs{};
    std::int64_t deltaTimeUs{};
    ImVec2 viewportPixels{};
    float dpiScale{1.0F};
};

/// Opens a runtime frame and validates deterministic time without consulting a wall clock.
void BeginFrame(ProjectContext& context, const FrameParams& params);
/// Finalizes inspection and removes the render-thread current-context binding.
void EndFrame(ProjectContext& context);
/// Returns the render-thread context between BeginFrame and EndFrame.
[[nodiscard]] ProjectContext& CurrentContext();
/// Returns the current frame's read-only clock.
[[nodiscard]] const Clock& Time();

} // namespace studio
