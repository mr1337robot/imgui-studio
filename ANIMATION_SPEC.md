# ImGui Studio — Animation Specification

**Status:** Implementation contract

**Version:** 1.0

**Date:** July 9, 2026

**Depends on:** `PRD.md`, `TECHNICAL_DESIGN.md`, `RUNTIME_API.md`

## 1. Purpose

This document normatively defines time, animation state, interpolation, spring behavior, sequencing, reset, timeline controls, deterministic replay, and capture for the MVP. It is the source of truth for WP3.1, WP3.3, and WP3.5.

The keywords **MUST**, **MUST NOT**, **SHOULD**, and **MAY** are requirements terms.

## 2. Design goals

- The same custom widget source animates in the browser preview and native application.
- Agent captures are reproducible from a clean reset.
- Animation state is local to a runtime context and widget/property identity.
- Target changes and rapid reversal remain visually continuous.
- Hidden widgets do not unexpectedly lose short-lived transitions.
- Timeline controls have explicit semantics even when application targets depend on prior input.
- Invalid values fail visibly and safely rather than contaminating draw data with NaNs.

## 3. Time representation

### 3.1 Canonical units

Protocol and host time is a signed 64-bit integer count of microseconds. Valid deterministic time is `0 <= timeUs <= INT64_MAX`. Runtime math converts delta to binary64 seconds:

```text
dt = deltaTimeUs / 1,000,000.0
```

The runtime stores clock time in microseconds and animation positions/velocities internally as binary64. Public float/`ImVec` output is rounded once on return.

Frame index is an unsigned 64-bit counter starting at zero after reset and incrementing after each completed frame. It is metadata and must not be used as elapsed time.

### 3.2 Clock modes

There are two exclusive modes.

**Realtime**

- The host obtains frame delta from its platform loop or `ImGuiIO::DeltaTime`.
- The host clamps a negative delta to zero and reports a diagnostic.
- The host quantizes delta to the nearest microsecond, ties to even.
- Pause submits `deltaTimeUs = 0` while frames may continue rendering.
- Playback speed is a host concern: it multiplies raw delta before quantization.

**Deterministic**

- Time changes only through explicit render/replay commands.
- The host supplies both absolute and delta microseconds.
- Wall-clock APIs MUST NOT influence project sample state, runtime state, scenarios, or capture.
- `absoluteTimeUs` MUST equal the prior completed time plus `deltaTimeUs`, except on the first frame after reset where both are zero.
- A mismatch is rejected as `INVALID_TIME_SEQUENCE`; the frame is not executed.

Captures, tests, reference comparisons at named times, and agent evaluations MUST use deterministic mode.

### 3.3 Large delta

Tween evaluation is based on absolute elapsed duration and safely accepts any non-negative delta.

Spring evaluation uses the closed-form state transition in Section 7 and therefore does not require fixed substeps. A host MAY cap realtime delta for UX, but deterministic capture MUST NOT silently cap it. The actual submitted delta is recorded in frame metadata.

## 4. Runtime animation identity and lifecycle

An animation entry is keyed by:

```text
(ProjectContext instance, ImGuiID widget, PropertyKey property)
```

It stores:

- Primitive and value type.
- Current output.
- Current target.
- Start state and start time for tweens/sequences.
- Current velocity for springs.
- Delay state.
- Last-access frame and time.
- Settled state.
- Debug property name when enabled.

Two properties with the same name on different ImGui IDs never share state. Two contexts never share state. Changing the primitive or value type for an existing key without `ResetAnimation` is invalid and reports `PropertyTypeMismatch`.

The first animation call initializes output to its target and reports settled. Authors who want an entrance animation MUST install an initial value after runtime reset and before the property's first animation evaluation. Because the final `ImGuiID` commonly exists only inside the widget's render-time ID stack, widget code normally calls `SetAnimationInitialValueIfAbsent` immediately before the primitive. Project `Initialize` must not attempt to guess an ID that depends on a later ImGui stack.

Animation entries use the same retention and explicit erasure policy as runtime widget state in `RUNTIME_API.md`. An entry not called while its widget is hidden does not advance itself; when called again it evaluates using the full elapsed Studio time since its previous call. Authors who want a paused hidden animation must explicitly retain a visibility target or reset it; hidden status alone has no implicit time semantics.

## 5. Common target-change rules

Values and targets MUST be finite. Options MUST satisfy their primitive's constraints. On invalid input:

1. Report `InvalidAnimationParameter` or `NonFiniteAnimationValue`.
2. Do not mutate the stored animation entry.
3. Return the last finite output, or the finite target when no entry exists.
4. Mark the diagnostic frame as containing an animation error.

Target equality is exact component-wise equality after conversion to binary64. A target change occurs at the current frame time before evaluation.

For a tween target change:

- Evaluate the old tween at current time.
- Use that output as the new start value.
- Set the new target and start the new delay/duration at current time.
- Do not preserve an implied velocity.

For a spring target change:

- Preserve current position and velocity.
- Replace the target at current time.
- Apply the new delay if options specify one; during delay, position and velocity are held.

Changing duration/ease/spring parameters while the target remains equal also starts a new segment from the current state. This rule makes live theme edits deterministic.

## 6. Tween specification

### 6.1 State and evaluation

`Animate` supports scalar, `ImVec2`, and `ImVec4`. Components share timing and easing.

Options:

- `duration >= 0` seconds.
- `delay >= 0` seconds.
- A valid `Ease` enum.

Let `elapsed = now - segmentStart` in seconds.

```text
if elapsed < delay:
    output = start
else if duration == 0:
    output = target
else:
    u = clamp((elapsed - delay) / duration, 0, 1)
    output = start + (target - start) * Ease(u)
```

The tween is delayed when `elapsed < delay`. It is settled when `elapsed >= delay + duration`; on settlement output is assigned exactly to target to avoid residual error. Zero-duration with delay holds the start during delay and snaps on its first frame at or after the delay boundary. Zero duration and zero delay snaps in the current call.

Colors represented by `ImVec4` interpolate component-wise in their supplied numeric space, including alpha. The runtime does not assume sRGB or premultiplied alpha.

### 6.2 Normative easing formulas

For `u` clamped to `[0, 1]`:

```text
Linear:       u
InQuad:       u²
OutQuad:      1 - (1-u)²
InOutQuad:    u < .5 ? 2u² : 1 - (-2u+2)²/2
InCubic:      u³
OutCubic:     1 - (1-u)³
InOutCubic:   u < .5 ? 4u³ : 1 - (-2u+2)³/2
InSine:       1 - cos((πu)/2)
OutSine:      sin((πu)/2)
InOutSine:    (1 - cos(πu))/2
```

The implementation defines `π` as the binary64 constant `3.14159265358979323846264338327950288`. Polynomial forms MUST use the written operation ordering in parity builds with floating-point contraction disabled. Sine easings may differ slightly by target library but all public outputs must satisfy the parity tolerance in Section 14.

## 7. Spring specification

### 7.1 Model

`Spring` supports scalar and `ImVec2`, evaluated independently per component. The model is a unit-mass damped harmonic oscillator toward a target held constant during each segment:

```text
x'' + c*x' + k*(x - target) = 0
```

where `k = stiffness > 0`, `c = damping >= 0`, and mass is exactly `1.0`.

Options must satisfy:

- `stiffness > 0`.
- `damping >= 0`.
- `delay >= 0`.
- `positionEpsilon > 0`.
- `velocityEpsilon > 0`.

### 7.2 Closed-form evaluation

At the start of a segment, define displacement `y0 = x0 - target`, initial velocity `v0`, elapsed active time `t`, natural frequency `w0 = sqrt(k)`, and damping ratio `z = c / (2*w0)`.

During delay, `x = x0` and `v = v0` are held.

For underdamping (`z < 1 - 1e-7`):

```text
wd = w0 * sqrt(1 - z²)
A = y0
B = (v0 + z*w0*y0) / wd
e = exp(-z*w0*t)
y = e * (A*cos(wd*t) + B*sin(wd*t))
v = e * ((-z*w0)*(A*cos(wd*t) + B*sin(wd*t))
         + (-A*wd*sin(wd*t) + B*wd*cos(wd*t)))
```

For critical damping (`abs(z - 1) <= 1e-7`):

```text
A = y0
B = v0 + w0*y0
e = exp(-w0*t)
y = (A + B*t) * e
v = (B - w0*(A + B*t)) * e
```

For overdamping (`z > 1 + 1e-7`):

```text
s = sqrt(z² - 1)
r1 = -w0*(z - s)
r2 = -w0*(z + s)
C1 = (v0 - r2*y0) / (r1 - r2)
C2 = y0 - C1
y = C1*exp(r1*t) + C2*exp(r2*t)
v = r1*C1*exp(r1*t) + r2*C2*exp(r2*t)
```

Then `x = target + y`. To avoid unstable classification near the boundary, ratios within the critical band use the critical formula.

Each call stores the evaluated position and velocity as the next segment's boundary state. Implementations MAY cache terms, but output must be equivalent to evaluating from the stored segment boundary and elapsed active time; they MUST NOT use variable-step Euler integration.

### 7.3 Settlement

A spring component is settled when both:

```text
abs(x - target) <= positionEpsilon
abs(v) <= velocityEpsilon
```

A vector spring is settled only when every component satisfies both conditions. On the first settled evaluation, output is assigned exactly to target and velocity exactly to zero. It remains settled until target or options change.

An undamped spring (`damping == 0`) will generally never settle unless initialized exactly at target with zero velocity. This is valid and must not be forcibly truncated.

## 8. Delay and sequence semantics

Delay is part of the current segment. Changing a target or options restarts delay.

The v1 `Sequence` primitive is a one-shot scalar sequence. The steps span:

```text
[delayBefore, duration] repeated in declaration order
```

At each step, the prior step's target is the start value. During `delayBefore`, output holds that start. During duration it applies the step easing. A zero-duration step snaps at its active boundary. After the final step, output holds the final target and reports settled.

The sequence definition identity is a deterministic digest of every step's binary fields plus `initialValue`. If this digest changes:

- With `restartWhenStepsChange == true`, restart at current time from `initialValue`.
- Otherwise, report `InvalidAnimationParameter` and keep evaluating the existing definition.

Sequence callbacks, mutation of application state, nesting, loops, ping-pong, and infinite animations are excluded from v1. Such behavior remains ordinary project C++ driven by clock/state.

## 9. Reset and initialization

### 9.1 Full preview reset order

A clean reset MUST execute in this order before rendering time zero:

1. Stop realtime/manual input delivery and clear scheduled/pending input.
2. Clear ImGui active, hovered, focused, navigation, popup, drag/drop, and text-input state through the pinned host reset adapter.
3. Call `project::ResetSampleState(context)`.
4. Call `context.ResetRuntimeState()` to clear widget/animation/inspection history and reset clock/frame index.
5. Apply the named sample-state override, if the scenario declares one.
6. Queue scenario events scheduled at time zero in stable source order.
7. Render canonical frame zero with `absoluteTimeUs = 0`, `deltaTimeUs = 0`.

The project reset callback runs before runtime clearing so it cannot accidentally retain valid runtime handles across the reset. It MUST NOT call frame-only animation APIs.

### 9.2 Property reset

`ResetAnimation(widget, property)` erases exactly one animation entry. `ResetAnimations(widget)` erases all animation entries for the ImGui ID. On the next call, first-call initialization rules apply.

`SetAnimationInitialValue` creates an unstarted entry with the declared value and type. It is valid only before the first `Animate`/`Spring`/`Sequence` evaluation for that key after reset. A later call reports `InvalidAnimationParameter` and makes no change. `SetAnimationInitialValueIfAbsent` creates the same entry only when none exists, returns whether it created the entry, and otherwise leaves a type-compatible entry unchanged; a type mismatch is still diagnostic. Both forms are frame-context APIs and require a valid `CurrentContext()`.

## 10. Play, pause, step, speed, and restart

These controls are host operations, not project C++ APIs.

- **Play:** schedule future frames in the selected mode.
- **Pause:** continue optional render/inspection frames with zero delta and unchanged absolute time.
- **Step:** while paused, advance exactly one configured step interval. Default preview step is `16,667 us`; capture uses its timestamp schedule instead.
- **Speed:** realtime only; multiply raw delta by a finite value in `[0, 16]` before quantization. Speed zero is equivalent to pause.
- **Restart:** perform the full reset sequence and render frame zero.

Changing playback speed does not alter already elapsed animation time. Deterministic scenario replay ignores the interactive speed control.

## 11. Seek and timeline scrubbing

Arbitrary backward mutation of the runtime clock is forbidden. Animation targets may depend on earlier user input or application state, so setting a timestamp without replay would not reconstruct the correct state.

A seek to time `T` is therefore defined as:

1. Full preview reset.
2. Replay all scenario events with `at <= T` in stable order.
3. Render the deterministic schedule from time zero through `T`.
4. Return the frame at exactly `T`.

The replay schedule MUST include:

- Time zero.
- Every event timestamp.
- Every requested capture timestamp up to `T`.
- `T` itself.

Duplicate timestamps are coalesced into one frame after all events at that timestamp are applied. Events at equal timestamps execute by source order. The host MAY insert additional fixed diagnostic steps, but doing so changes the delta sequence and must be recorded; canonical capture does not insert unspecified steps.

Scrubbing without a scenario replays the empty scenario from the named sample state. Seeking before zero or beyond configured scenario limits fails before reset. Forward interactive play may advance monotonically without reset; a backward seek always reset-replays.

## 12. Scenario input and animation ordering

At each deterministic timestamp:

1. Set time/delta.
2. Apply all input events scheduled at that timestamp in source order to ImGui input queues.
3. Begin the ImGui frame.
4. Project widgets observe interaction and mutate sample/application state.
5. Animation calls observe the resulting targets and evaluate at that same timestamp.
6. Inspection captures output and status.
7. Draw data and optional pixels are produced.

A click is represented by explicit pointer move/down/up events according to the scenario executor contract. If a high-level `click` expands into several events, the expanded timestamps and ordering become capture provenance. Multiple application mutations caused by one event remain project behavior.

## 13. Filmstrip capture

### 13.1 Timestamp generation

Capture input declares integer `startUs`, `endUs`, and integer `fps`.

Constraints:

- `0 <= startUs <= endUs`.
- `fps` is in the project-format range `[1, 120]`.
- Frame count and duration are within configured resource limits.

Frame `n` occurs at:

```text
startUs + floor(n * 1,000,000 / fps)
```

Cadence timestamps greater than `endUs` are omitted. Duplicate integer timestamps are removed. The final `endUs` is always included when it is absent from the cadence.

Example: 12 fps from 0 through 1 second yields `0, 83333, 166666, 250000, ...`, and includes `1000000` as the final cadence timestamp.

### 13.2 Capture execution

Every canonical capture:

1. Creates or exclusively controls a deterministic preview instance.
2. Performs the full reset sequence.
3. Replays the union of event and capture timestamps in increasing order.
4. Reads back pixels only at capture timestamps.
5. Records clock, input, widget trace, animation trace, diagnostics, build/revision, viewport, DPI, asset configuration, and runtime version.
6. Stops at the first scenario error or cancellation and returns a terminal partial-capture record; partial output is never labeled successful.

Three clean captures with identical provenance MUST yield identical application/interaction/animation traces. Image hashes may use approved tolerance metadata for backend rasterization, but a trace mismatch is always a deterministic failure.

## 14. Browser/native numerical contract

Parity builds MUST:

- Use IEEE-754 binary64 internally and binary32 public output.
- Disable fast-math and floating-point contraction.
- Use the same easing and spring source implementation.
- Use the same integer microsecond timestamps and event ordering.
- Avoid platform wall clocks, random seeds, and installed fonts.

At every fixture sample:

- Scalar/vector/color output component difference MUST be `<= 1e-5`.
- Spring velocity magnitude difference MUST be `<= 1e-5`.
- Target, delayed, and settled flags MUST match exactly.
- Application values and interaction events MUST match exactly.

If platform `sin`, `cos`, `exp`, or `sqrt` prevents this tolerance, the runtime must adopt a shared deterministic approximation or stricter toolchain implementation before release; the tolerance must not be silently widened.

Determinism means identical traces for an identical environment and input schedule, not guaranteed pixel identity across arbitrary operating systems or GPUs.

## 15. Edge cases

| Case | Required behavior |
|---|---|
| First call, no initial value | Output target immediately; settled |
| Explicit initial value | Animate from initial value on first primitive call |
| Zero tween duration | Snap after delay boundary |
| Zero delta frame | No elapsed progress; target/option changes still create a segment |
| Very large tween delta | Evaluate at absolute elapsed time and settle exactly |
| Very large spring delta | Closed-form evaluate; settle if thresholds pass |
| Target reverses mid-flight | Tween restarts from current output; spring preserves velocity |
| Widget hidden temporarily | Entry retained; elapsed time applies when called again |
| Widget permanently removed | Explicit erase or deterministic retention collection |
| Property type/primitive changes | Diagnostic; retain last finite compatible state |
| NaN/infinite target/options | Diagnostic; do not mutate state |
| Negative duration/delay/damping | Diagnostic; do not mutate state |
| Zero/negative stiffness or epsilon | Diagnostic; do not mutate state |
| Undamped spring | Valid; may remain unsettled indefinitely |
| Backward time | Reject frame; use reset-and-replay seek |
| Duplicate timestamp | Coalesce frame; apply events in source order |
| Animation called twice in one frame | First call evaluates; identical later calls return same value; conflicting target/options report diagnostic |
| Context reset | All animation entries and clock history cleared |
| Preview replacement | New context starts with no runtime animation state |

## 16. Inspection and trace schema requirements

Every inspected animation property reports the protocol fields defined by `INSPECTION_PROTOCOL.md`, including at least:

```json
{
  "kind": "float",
  "valueMillionths": 820000,
  "targetMillionths": 1000000,
  "velocityMillionthsPerSecond": null,
  "settled": false
}
```

The containing map key is the animation property name. Spring traces include velocity; vector/color values use the protocol's corresponding encoded kinds. Trace order is stable by widget registration order and then UTF-8 property-name byte order, with numeric property key as a final tie-breaker in debug collision cases. The protocol stores time as integer microseconds. Primitive, delay, and elapsed status may be added by a backward-compatible inspection schema revision, but are not required by v1 serialization. Full serialization details belong to `INSPECTION_PROTOCOL.md`.

## 17. Required tests

### 17.1 Clock tests

- Reset produces time zero, delta zero, and frame index zero.
- Monotonic sequences are accepted; negative or inconsistent sequences are rejected without state mutation.
- Pause frames retain absolute time and use zero delta.
- Realtime quantization and speed multiplication follow ties-to-even rules.
- Deterministic execution does not call a wall-clock provider (verified with a failing fake provider).

### 17.2 Tween table tests

For every easing and supported value type:

- Exact start, midpoint, and end values.
- Delay boundaries one microsecond before/at/after.
- Zero duration with and without delay.
- Oversized delta settles exactly at target.
- Target reversal is continuous at the reversal timestamp.
- Option change with equal target starts a new segment.
- Color alpha and all components interpolate independently.

### 17.3 Spring tests

- Underdamped, critical-band, and overdamped formulas against high-precision fixtures.
- Zero damping and near-critical classification.
- Scalar and vector component equivalence.
- Target reversal preserves position and velocity.
- Delay holds both position and velocity.
- Large elapsed time remains finite and settles when appropriate.
- Settlement assigns exact target/zero velocity.
- Invalid stiffness, damping, epsilon, delay, and non-finite input preserve prior state.

### 17.4 Lifecycle and sequence tests

- First-call initialization and explicit initial values.
- State isolation by context, widget ID, property key, primitive, and type.
- Temporary hiding inside/outside retention policy.
- Empty, one-step, zero-duration, and multi-step sequences.
- Sequence definition change in restart and reject modes.
- Double call in one frame with identical and conflicting parameters.
- Property reset, widget reset, full context reset, and preview replacement.

### 17.5 Replay and capture tests

- Backward seek performs reset/replay and matches a fresh run to the same time.
- Equal-time events preserve source order.
- 12-fps timestamp fixture matches the normative floor-generated timestamps and final-end rule.
- Event timestamps between capture frames affect the next capture correctly.
- Cancellation returns partial terminal metadata and never successful status.
- Three clean browser captures have identical traces.
- Browser and native fixed-time fixtures meet all Section 14 tolerances.

## 18. Acceptance criteria

The animation subsystem is accepted when:

1. Realtime and deterministic clocks implement Section 3 exactly.
2. Tween output matches every normative easing/delay/duration fixture.
3. Springs use the specified closed-form model and pass all damping-regime fixtures.
4. First-call, target reversal, option change, hiding, invalid input, and settlement behavior matches this document.
5. Restart, pause, step, speed, forward play, and reset-and-replay seek are exposed by the host with the specified behavior.
6. Canonical filmstrips use integer-microsecond provenance and reproducible timestamp generation.
7. Three clean deterministic scenario runs produce identical interaction, application, and animation traces.
8. Browser/native fixtures meet the `1e-5` trace tolerance with exact status/event agreement.
9. Invalid time or animation input cannot inject NaN/Infinity into draw data.
10. Runtime API examples and starter components use these semantics without undocumented timing code.

## 19. Cross-document ownership

- Public C++ declarations and object lifetimes: `RUNTIME_API.md`.
- Preview frame order, context boundaries, and protocol time storage: `TECHNICAL_DESIGN.md`.
- Product animation requirements and performance targets: `PRD.md`.
- Runtime work packages and gates: `MVP_IMPLEMENTATION_PLAN.md`.
- Scenario/tool request and response schemas: `AGENT_TOOL_API.md`.
- Animation trace serialization: `INSPECTION_PROTOCOL.md`.
- Browser/native visual validation: `TEST_PLAN.md`.
