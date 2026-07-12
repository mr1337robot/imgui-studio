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
    .canvasTop = IM_COL32(8, 11, 22, 255),
    .canvasBottom = IM_COL32(19, 10, 38, 255),
    .panel = IM_COL32(18, 22, 38, 248),
    .panelBorder = IM_COL32(84, 75, 132, 145),
    .card = IM_COL32(25, 28, 49, 255),
    .cardHover = IM_COL32(32, 32, 59, 255),
    .cardBorder = IM_COL32(93, 84, 138, 120),
    .textPrimary = IM_COL32(247, 245, 255, 255),
    .textSecondary = IM_COL32(163, 161, 196, 255),
    .accent = IM_COL32(235, 35, 255, 255),
    .accentSecondary = IM_COL32(119, 58, 255, 255),
    .positive = IM_COL32(73, 234, 179, 255),
    .warning = IM_COL32(255, 191, 72, 255),
    .panelRoundingPx = 18.0F,
    .cardRoundingPx = 12.0F,
    .rowHeightPx = 32.0F,
    .spacingPx = 12.0F,
    .animationDurationSeconds = 0.22F,
};

} // namespace

const Theme& DefaultTheme() noexcept {
    return kDefaultTheme;
}

} // namespace studio_example
