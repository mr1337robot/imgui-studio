# Animation Guide

Animation state belongs to the runtime context, not project model fields or widget-local statics:

```cpp
const float active = studio::Animate(
    id, studio::Key("active"), enabled ? 1.0F : 0.0F,
    {.duration = 0.22, .ease = studio::Ease::OutCubic});
```

The host supplies signed integer microseconds. A clean reset clears clock history and animation
entries. The first call starts at its target; use `SetAnimationInitialValueIfAbsent` for entrance
motion. Tween reversal starts from current output, while springs retain position and velocity.
`ANIMATION_SPEC.md` remains the normative contract for equations and edge cases.
