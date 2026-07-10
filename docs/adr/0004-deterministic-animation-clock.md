# ADR 0004: Make Deterministic Time a First-Class Runtime Mode

**Status:** Accepted  
**Date:** July 9, 2026  
**Decision owners:** Runtime and test architecture  
**Related:** `PRD.md`, `TECHNICAL_DESIGN.md`, `TEST_PLAN.md`

## Context

Agents must evaluate animation over time, target interactions reliably, compare revisions, and reproduce browser/native states. Wall-clock-driven animation and ambient input make filmstrips flaky and seeking ambiguous. Storing ad hoc `static float` values in widgets also prevents a complete reset and structured property traces.

Realtime animation is still required for human preview and native integration, so the runtime needs two explicit time sources without two widget implementations.

## Decision

The Studio runtime exposes mutually exclusive `realtime` and `deterministic` clock modes through one clock API.

- In `realtime`, the host provides non-negative frame delta and absolute presentation time.
- In `deterministic`, protocol time is integer microseconds and advances only through explicit commands/scenario timestamps. Input is scheduled in stable sequence order.
- Captures, parity tests, and agent evaluations always use deterministic mode.
- Animation state is keyed by scoped context, `ImGuiID`, and property key and can be fully reset.
- A clean reset restores sample state, input queues, focus/active state, animation storage, diagnostics, clock, and any declared deterministic seed.

Backward seek is defined as reset to a known initial/checkpoint state followed by deterministic replay to the target time. Animation functions never receive a negative delta. Paused frames use zero delta. Native parity hosts implement the same deterministic protocol; consumer applications normally use realtime delta.

## Consequences

### Positive

- Filmstrips, traces, scenario results, and visual comparisons are repeatable.
- Agents can step and inspect transitions at exact timestamps.
- Browser/native animation values can be compared independently from frame scheduling speed.
- Central state enables reset, inspection, lifecycle management, and collision detection.

### Negative

- Reset and seek require every relevant application/runtime state source to participate.
- Replay can become expensive for long timelines; bounded scenarios/checkpoints may be needed.
- Springs and large deltas require a precisely specified integration and clamping/substep policy.
- Project code that reads wall time or owns unrelated static state can violate determinism and must be diagnosed/documented.

## Alternatives considered

- **Record realtime frames:** rejected because timing jitter makes results incomparable.
- **Mock only `ImGuiIO::DeltaTime`:** insufficient because input order, absolute time, application state, and animation storage also need reset/control.
- **Capture video and rely on vision:** useful presentation output, but not deterministic enough for regression or exact property inspection.
- **Separate test-only widget implementation:** rejected because it would diverge from preview/export code.

## Required semantics

- Protocol storage uses signed 64-bit microseconds, rejects negative absolute time, overflow, and non-monotonic frame execution except through explicit seek.
- Events at equal time execute by declared stable sequence index before the frame.
- Tween and spring parameter validation fails predictably; no NaN/Inf may enter draw data.
- Settling thresholds and integration behavior are versioned runtime contract details.
- Switching modes clears pending input; entering deterministic mode requires explicit reset or selected state/time.
- Capture metadata records timestamp, delta sequence, scenario, reset/state digest, build, revision, viewport, and DPI.

## Acceptance criteria

- Three clean executions of a required scenario produce identical serialized state/animation traces.
- Pause, frame step, restart, speed control, and backward seek pass defined fixture expectations.
- Equal-timestamp input order is stable.
- Unit tests cover zero duration, large delta, target reversal, hidden widget lifecycle, reset, seek, and invalid parameters.
- Browser and native animation properties match within the documented numeric epsilon at fixed timestamps.
- Deterministic execution tests detect any runtime wall-clock read in the controlled path.
- A 1-second, 12-fps filmstrip completes within the PRD performance target after preview load.

