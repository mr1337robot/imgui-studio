/**
 * Studio-managed starter theme token values.
 *
 * This is the sole file the future limited properties editor may replace. Keeping token values
 * separate from the public Theme shape and component algorithms protects user-authored widgets
 * from broad rewrites while making one theme edit affect every standard starter component.
 */
#include <studio_example/theme.hpp>

namespace studio_example {
namespace {

const Theme kDefaultTheme{
    .canvasTop = IM_COL32(2, 3, 3, 255),
    .canvasBottom = IM_COL32(3, 3, 4, 255),
    .panel = IM_COL32(20, 19, 24, 255),
    .panelBorder = IM_COL32(31, 30, 37, 255),
    .card = IM_COL32(21, 20, 25, 255),
    .cardHover = IM_COL32(25, 24, 30, 255),
    .cardBorder = IM_COL32(35, 34, 42, 205),
    .textPrimary = IM_COL32(207, 205, 211, 255),
    .textSecondary = IM_COL32(99, 96, 112, 255),
    .accent = IM_COL32(202, 181, 96, 255),
    .accentSecondary = IM_COL32(116, 99, 45, 255),
    .positive = IM_COL32(197, 177, 96, 255),
    .warning = IM_COL32(220, 196, 107, 255),
    .panelRoundingPx = 12.0F,
    .cardRoundingPx = 3.0F,
    .rowHeightPx = 28.0F,
    .spacingPx = 10.0F,
    .animationDurationSeconds = 0.16F,
};

} // namespace

const Theme& DefaultTheme() noexcept {
    return kDefaultTheme;
}

} // namespace studio_example
