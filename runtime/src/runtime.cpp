#include <algorithm>
#include <array>
#include <cassert>
#include <cmath>
#include <cstring>
#include <imgui_internal.h>
#include <limits>
#include <ranges>
#include <span>
#include <stdexcept>
#include <studio/studio.hpp>
#include <unordered_map>

namespace studio {
namespace {

thread_local ProjectContext* currentContext{};

struct AnimationKey {
    ImGuiID widget{};
    PropertyKey property{};
    bool operator==(const AnimationKey&) const = default;
};
struct AnimationKeyHash {
    std::size_t operator()(const AnimationKey key) const noexcept {
        return (static_cast<std::size_t>(key.widget) << 1U) ^
               static_cast<std::size_t>(key.property);
    }
};
enum class Primitive : std::uint8_t { Unstarted, Tween, Spring };
struct AnimationEntry {
    Primitive primitive{Primitive::Unstarted};
    std::uint8_t dimensions{1};
    std::array<double, 4> value{}, target{}, start{}, velocity{};
    std::int64_t segmentStartUs{};
    double duration{}, delay{};
    Ease ease{Ease::OutCubic};
    SpringOptions spring{};
    bool settled{true};
    bool delayed{};
    std::uint64_t lastFrame{};
    std::int64_t lastTimeUs{};
};

[[nodiscard]] double ApplyEase(const Ease ease, const double u) noexcept {
    constexpr double pi = 3.14159265358979323846264338327950288;
    const double x = std::clamp(u, 0.0, 1.0);
    switch (ease) {
    case Ease::Linear:
        return x;
    case Ease::InQuad:
        return x * x;
    case Ease::OutQuad:
        return 1.0 - (1.0 - x) * (1.0 - x);
    case Ease::InOutQuad:
        return x < .5 ? 2 * x * x : 1 - ((-2 * x + 2) * (-2 * x + 2)) / 2;
    case Ease::InCubic:
        return x * x * x;
    case Ease::OutCubic: {
        const double y = 1 - x;
        return 1 - y * y * y;
    }
    case Ease::InOutCubic: {
        const double y = -2 * x + 2;
        return x < .5 ? 4 * x * x * x : 1 - y * y * y / 2;
    }
    case Ease::InSine:
        return 1 - std::cos(pi * x / 2);
    case Ease::OutSine:
        return std::sin(pi * x / 2);
    case Ease::InOutSine:
        return (1 - std::cos(pi * x)) / 2;
    }
    return x;
}

[[nodiscard]] bool Finite(std::span<const double> values) noexcept {
    return std::ranges::all_of(values, [](double value) { return std::isfinite(value); });
}

void Diagnose(std::string code, std::string stableId, std::string message);

[[nodiscard]] bool ValidTween(const TweenOptions& value) noexcept {
    return std::isfinite(value.duration) && value.duration >= 0 && std::isfinite(value.delay) &&
           value.delay >= 0 &&
           static_cast<unsigned>(value.ease) <= static_cast<unsigned>(Ease::InOutSine);
}
[[nodiscard]] bool ValidSpring(const SpringOptions& value) noexcept {
    return std::isfinite(value.stiffness) && value.stiffness > 0 && std::isfinite(value.damping) &&
           value.damping >= 0 && std::isfinite(value.delay) && value.delay >= 0 &&
           std::isfinite(value.positionEpsilon) && value.positionEpsilon > 0 &&
           std::isfinite(value.velocityEpsilon) && value.velocityEpsilon > 0;
}

void EvaluateTween(AnimationEntry& entry, const std::int64_t nowUs) {
    const double elapsed = static_cast<double>(nowUs - entry.segmentStartUs) / 1'000'000.0;
    entry.delayed = elapsed < entry.delay;
    const double active = elapsed - entry.delay;
    const double u = entry.duration == 0 ? (active >= 0 ? 1.0 : 0.0) : active / entry.duration;
    const double eased = entry.delayed ? 0.0 : ApplyEase(entry.ease, u);
    entry.settled = !entry.delayed && active >= entry.duration;
    for (std::size_t i = 0; i < entry.dimensions; ++i)
        entry.value[i] = entry.settled
                             ? entry.target[i]
                             : entry.start[i] + (entry.target[i] - entry.start[i]) * eased;
}

void EvaluateSpring(AnimationEntry& entry, const std::int64_t nowUs) {
    const double elapsed = static_cast<double>(nowUs - entry.segmentStartUs) / 1'000'000.0;
    entry.delayed = elapsed < entry.spring.delay;
    if (entry.delayed)
        return;
    const double t = elapsed - entry.spring.delay;
    const double w0 = std::sqrt(entry.spring.stiffness);
    const double z = entry.spring.damping / (2 * w0);
    entry.settled = true;
    for (std::size_t i = 0; i < entry.dimensions; ++i) {
        const double y0 = entry.start[i] - entry.target[i], v0 = entry.velocity[i];
        double y{}, velocity{};
        if (z < 1 - 1e-7) {
            const double wd = w0 * std::sqrt(1 - z * z), a = y0, b = (v0 + z * w0 * y0) / wd;
            const double e = std::exp(-z * w0 * t), c = std::cos(wd * t), s = std::sin(wd * t);
            y = e * (a * c + b * s);
            velocity = e * ((-z * w0) * (a * c + b * s) + (-a * wd * s + b * wd * c));
        } else if (z > 1 + 1e-7) {
            const double s = std::sqrt(z * z - 1), r1 = -w0 * (z - s), r2 = -w0 * (z + s);
            const double c1 = (v0 - r2 * y0) / (r1 - r2), c2 = y0 - c1;
            y = c1 * std::exp(r1 * t) + c2 * std::exp(r2 * t);
            velocity = r1 * c1 * std::exp(r1 * t) + r2 * c2 * std::exp(r2 * t);
        } else {
            const double a = y0, b = v0 + w0 * y0, e = std::exp(-w0 * t);
            y = (a + b * t) * e;
            velocity = (b - w0 * (a + b * t)) * e;
        }
        entry.value[i] = entry.target[i] + y;
        entry.velocity[i] = velocity;
        if (std::abs(y) > entry.spring.positionEpsilon ||
            std::abs(velocity) > entry.spring.velocityEpsilon)
            entry.settled = false;
    }
    if (entry.settled)
        for (std::size_t i = 0; i < entry.dimensions; ++i) {
            entry.value[i] = entry.target[i];
            entry.velocity[i] = 0;
        }
}

} // namespace

struct ProjectContext::Impl {
    std::unordered_map<AnimationKey, AnimationEntry, AnimationKeyHash> animations;
    std::vector<InspectedWidget> widgets;
    std::vector<RuntimeDiagnostic> diagnostics;
};

namespace {
void Diagnose(std::string code, std::string stableId, std::string message) {
    if (currentContext != nullptr && currentContext->Internal().diagnostics.size() < 500)
        currentContext->Internal().diagnostics.push_back(
            {std::move(code), std::move(stableId), std::move(message)});
}
AnimationEntry* Find(const ImGuiID widget, const PropertyKey property) {
    if (currentContext == nullptr || property == 0)
        return nullptr;
    auto& values = currentContext->Internal().animations;
    const auto found = values.find({widget, property});
    return found == values.end() ? nullptr : &found->second;
}
AnimationEntry& Get(const ImGuiID widget, const PropertyKey property,
                    const std::span<const double> target) {
    auto& values = CurrentContext().Internal().animations;
    auto [at, inserted] = values.try_emplace({widget, property});
    if (inserted)
        for (std::size_t i = 0; i < target.size(); ++i)
            at->second.value[i] = at->second.target[i] = target[i];
    at->second.dimensions = static_cast<std::uint8_t>(target.size());
    at->second.lastFrame = Time().FrameIndex();
    at->second.lastTimeUs = Time().NowUs();
    return at->second;
}
template <std::size_t N>
std::array<double, N> TweenValue(ImGuiID widget, PropertyKey property,
                                 const std::array<double, N>& target, TweenOptions options) {
    if (property == 0 || !Finite(target) || !ValidTween(options)) {
        Diagnose("INVALID_ANIMATION_PARAMETER", "", "Invalid tween input.");
        return target;
    }
    auto& entry = Get(widget, property, target);
    const bool newlyStarted = entry.primitive == Primitive::Unstarted;
    if (newlyStarted) {
        entry.primitive = Primitive::Tween;
        entry.target = {};
        for (std::size_t i = 0; i < N; ++i)
            entry.target[i] = target[i];
        entry.settled = true;
    }
    if (entry.primitive != Primitive::Tween || entry.dimensions != N) {
        Diagnose("PROPERTY_TYPE_MISMATCH", "", "Animation property changed type.");
        std::array<double, N> out{};
        std::copy_n(entry.value.begin(), N, out.begin());
        return out;
    }
    if (!newlyStarted)
        EvaluateTween(entry, Time().NowUs());
    bool changed = entry.duration != options.duration || entry.delay != options.delay ||
                   entry.ease != options.ease;
    for (std::size_t i = 0; i < N; ++i)
        changed = changed || entry.target[i] != target[i];
    if (changed) {
        entry.start = entry.value;
        for (std::size_t i = 0; i < N; ++i)
            entry.target[i] = target[i];
        entry.segmentStartUs = Time().NowUs();
        entry.duration = options.duration;
        entry.delay = options.delay;
        entry.ease = options.ease;
        EvaluateTween(entry, Time().NowUs());
    }
    std::array<double, N> out{};
    std::copy_n(entry.value.begin(), N, out.begin());
    return out;
}
template <std::size_t N>
std::array<double, N> SpringValue(ImGuiID widget, PropertyKey property,
                                  const std::array<double, N>& target, SpringOptions options) {
    if (property == 0 || !Finite(target) || !ValidSpring(options)) {
        Diagnose("INVALID_ANIMATION_PARAMETER", "", "Invalid spring input.");
        return target;
    }
    auto& entry = Get(widget, property, target);
    const bool newlyStarted = entry.primitive == Primitive::Unstarted;
    if (newlyStarted) {
        entry.primitive = Primitive::Spring;
        for (std::size_t i = 0; i < N; ++i)
            entry.target[i] = target[i];
        entry.spring = options;
        entry.settled = true;
    }
    if (entry.primitive != Primitive::Spring || entry.dimensions != N) {
        Diagnose("PROPERTY_TYPE_MISMATCH", "", "Animation property changed type.");
        std::array<double, N> out{};
        std::copy_n(entry.value.begin(), N, out.begin());
        return out;
    }
    if (!newlyStarted)
        EvaluateSpring(entry, Time().NowUs());
    bool changed = entry.spring.stiffness != options.stiffness ||
                   entry.spring.damping != options.damping || entry.spring.delay != options.delay ||
                   entry.spring.positionEpsilon != options.positionEpsilon ||
                   entry.spring.velocityEpsilon != options.velocityEpsilon;
    for (std::size_t i = 0; i < N; ++i)
        changed = changed || entry.target[i] != target[i];
    if (changed) {
        entry.start = entry.value;
        for (std::size_t i = 0; i < N; ++i)
            entry.target[i] = target[i];
        entry.segmentStartUs = Time().NowUs();
        entry.spring = options;
        EvaluateSpring(entry, Time().NowUs());
    }
    std::array<double, N> out{};
    std::copy_n(entry.value.begin(), N, out.begin());
    return out;
}
} // namespace

RuntimeMode Clock::Mode() const noexcept {
    return mode_;
}
std::int64_t Clock::NowUs() const noexcept {
    return nowUs_;
}
std::int64_t Clock::DeltaUs() const noexcept {
    return deltaUs_;
}
double Clock::NowSeconds() const noexcept {
    return static_cast<double>(nowUs_) / 1'000'000.0;
}
double Clock::DeltaSeconds() const noexcept {
    return static_cast<double>(deltaUs_) / 1'000'000.0;
}
std::uint64_t Clock::FrameIndex() const noexcept {
    return frameIndex_;
}
ProjectContext::ProjectContext(ImGuiContext& imgui, ProjectContextConfig config)
    : imgui_(&imgui), config_(config), impl_(std::make_unique<Impl>()) {
    clock_.mode_ = config.mode;
}
ProjectContext::~ProjectContext() = default;
ImGuiContext& ProjectContext::ImGuiContextRef() noexcept {
    return *imgui_;
}
RuntimeMode ProjectContext::Mode() const noexcept {
    return config_.mode;
}
Clock& ProjectContext::Time() noexcept {
    return clock_;
}
ProjectContext::Impl& ProjectContext::Internal() noexcept {
    return *impl_;
}
void ProjectContext::ResetRuntimeState() {
    clock_ = Clock{};
    clock_.mode_ = config_.mode;
    impl_->animations.clear();
    impl_->widgets.clear();
    impl_->diagnostics.clear();
}
void ProjectContext::CollectGarbage() {
    std::erase_if(impl_->animations, [&](const auto& pair) {
        const auto& a = pair.second;
        return clock_.frameIndex_ - a.lastFrame > config_.hiddenStateRetentionFrames &&
               clock_.nowUs_ - a.lastTimeUs > config_.hiddenStateRetentionUs;
    });
}
void BeginFrame(ProjectContext& context, const FrameParams& params) {
    if (currentContext != nullptr || params.absoluteTimeUs < 0 || params.deltaTimeUs < 0)
        throw std::logic_error("Invalid Studio frame lifecycle/time.");
    if (context.clock_.initialized_ && context.Mode() == RuntimeMode::Deterministic &&
        params.absoluteTimeUs != context.clock_.nowUs_ + params.deltaTimeUs)
        throw std::invalid_argument("INVALID_TIME_SEQUENCE");
    currentContext = &context;
    context.clock_.nowUs_ = params.absoluteTimeUs;
    context.clock_.deltaUs_ = params.deltaTimeUs;
    context.clock_.frameIndex_ = params.frameIndex;
    context.clock_.initialized_ = true;
    context.impl_->widgets.clear();
    context.impl_->diagnostics.clear();
}
void EndFrame(ProjectContext& context) {
    if (currentContext != &context)
        throw std::logic_error("Mismatched Studio frame.");
    currentContext = nullptr;
    context.CollectGarbage();
}
ProjectContext& CurrentContext() {
    if (currentContext == nullptr)
        throw std::logic_error("Studio runtime used outside a frame.");
    return *currentContext;
}
const Clock& Time() {
    return CurrentContext().Time();
}
ImVec2 Rect::Size() const noexcept {
    return {max.x - min.x, max.y - min.y};
}
ImVec2 Rect::Center() const noexcept {
    return {(min.x + max.x) / 2, (min.y + max.y) / 2};
}
bool Rect::IsFinite() const noexcept {
    return std::isfinite(min.x) && std::isfinite(min.y) && std::isfinite(max.x) &&
           std::isfinite(max.y);
}
bool Rect::HasPositiveArea() const noexcept {
    return max.x > min.x && max.y > min.y;
}
Interaction Interact(const WidgetDescriptor& descriptor) {
    Interaction result{};
    result.disabled = (static_cast<unsigned>(descriptor.flags) & 1U) != 0;
    if (!descriptor.bounds.IsFinite() || !descriptor.bounds.HasPositiveArea()) {
        Diagnose("INVALID_GEOMETRY", std::string(descriptor.stableId),
                 "Widget bounds must be finite and positive.");
        return result;
    }
    const ImRect bounds(descriptor.bounds.min, descriptor.bounds.max);
    const ImVec2 size = descriptor.layoutSize;
    ImGui::ItemSize(
        {size.x < 0 ? bounds.GetWidth() : size.x, size.y < 0 ? bounds.GetHeight() : size.y});
    result.registered = ImGui::ItemAdd(bounds, descriptor.imguiId);
    result.clipped = !result.registered;
    result.visible = result.registered;
    if (result.registered && !result.disabled) {
        ImGuiButtonFlags flags = ImGuiButtonFlags_PressedOnClickRelease;
        result.pressed = ImGui::ButtonBehavior(
            ImRect((descriptor.hitbox ? descriptor.hitbox->min : descriptor.bounds.min),
                   (descriptor.hitbox ? descriptor.hitbox->max : descriptor.bounds.max)),
            descriptor.imguiId, &result.hovered, &result.held, flags);
        result.clicked = result.pressed && ImGui::IsMouseReleased(ImGuiMouseButton_Left);
        result.active = ImGui::GetActiveID() == descriptor.imguiId;
        result.focused = ImGui::IsItemFocused();
    }
    auto& widgets = CurrentContext().Internal().widgets;
    if (std::ranges::any_of(widgets,
                            [&](const auto& item) { return item.stableId == descriptor.stableId; }))
        Diagnose("DUPLICATE_STABLE_ID", std::string(descriptor.stableId),
                 "Stable widget identifier is duplicated.");
    widgets.push_back({std::string(descriptor.stableId),
                       std::string(descriptor.semanticType),
                       descriptor.bounds,
                       descriptor.hitbox.value_or(descriptor.bounds),
                       result,
                       false,
                       {}});
    return result;
}
bool RegisterItem(const WidgetDescriptor& descriptor) {
    return Interact(WidgetDescriptor{descriptor.stableId, descriptor.semanticType,
                                     descriptor.imguiId, descriptor.bounds, descriptor.hitbox,
                                     descriptor.layoutSize, ItemFlags::Disabled,
                                     descriptor.parentStableId})
        .registered;
}
float Animate(ImGuiID w, PropertyKey p, float t, TweenOptions o) {
    return static_cast<float>(TweenValue<1>(w, p, {t}, o)[0]);
}
ImVec2 Animate(ImGuiID w, PropertyKey p, ImVec2 t, TweenOptions o) {
    auto v = TweenValue<2>(w, p, {t.x, t.y}, o);
    return {static_cast<float>(v[0]), static_cast<float>(v[1])};
}
ImVec4 Animate(ImGuiID w, PropertyKey p, ImVec4 t, TweenOptions o) {
    auto v = TweenValue<4>(w, p, {t.x, t.y, t.z, t.w}, o);
    return {static_cast<float>(v[0]), static_cast<float>(v[1]), static_cast<float>(v[2]),
            static_cast<float>(v[3])};
}
float Spring(ImGuiID w, PropertyKey p, float t, SpringOptions o) {
    return static_cast<float>(SpringValue<1>(w, p, {t}, o)[0]);
}
ImVec2 Spring(ImGuiID w, PropertyKey p, ImVec2 t, SpringOptions o) {
    auto v = SpringValue<2>(w, p, {t.x, t.y}, o);
    return {static_cast<float>(v[0]), static_cast<float>(v[1])};
}
void SetAnimationInitialValue(ImGuiID w, PropertyKey p, float v) {
    if (Find(w, p) != nullptr) {
        Diagnose("INVALID_ANIMATION_PARAMETER", "", "Initial value already exists.");
        return;
    }
    auto& e = Get(w, p, std::array<double, 1>{v});
    e.value[0] = e.target[0] = v;
    e.primitive = Primitive::Unstarted;
}
bool SetAnimationInitialValueIfAbsent(ImGuiID w, PropertyKey p, float v) {
    if (Find(w, p) != nullptr)
        return false;
    SetAnimationInitialValue(w, p, v);
    return true;
}
void ResetAnimation(ImGuiID w, PropertyKey p) {
    CurrentContext().Internal().animations.erase({w, p});
}
void ResetAnimations(ImGuiID w) {
    std::erase_if(CurrentContext().Internal().animations,
                  [&](const auto& pair) { return pair.first.widget == w; });
}
AnimationStatus GetAnimationStatus(ImGuiID w, PropertyKey p) {
    const auto* e = Find(w, p);
    if (!e)
        return {};
    double magnitude{};
    for (std::size_t i = 0; i < e->dimensions; ++i)
        magnitude += e->velocity[i] * e->velocity[i];
    return {true, e->delayed, e->settled,
            static_cast<double>(Time().NowUs() - e->segmentStartUs) / 1'000'000.0,
            std::sqrt(magnitude)};
}
std::span<const InspectedWidget> InspectedWidgets() {
    return CurrentContext().Internal().widgets;
}
std::span<const RuntimeDiagnostic> RuntimeDiagnostics() {
    return CurrentContext().Internal().diagnostics;
}

} // namespace studio
