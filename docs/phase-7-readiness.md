# Phase 7 Release Readiness

The Phase 7 implementation includes a fixed benchmark brief, machine-readable requirements,
permitted-tool list, blinded review rubric, ten-run evidence initializer, and fail-closed audit. It
also extends hostile-token, hostile-origin, path-envelope, WebSocket, and isolation-header coverage,
and updates the setup-to-export documentation and known limitations.

Initialize an external evaluation bundle:

```powershell
npm run benchmark:init
```

Give each clean run directory to an independent permitted agent evaluation. Preserve its full tool
trace, canonical capture, filmstrip, inspection/scenario results, verified export report, parity
report, timings, failures, and environment identity. After two blinded reviews per completed run,
audit the bundle:

```powershell
npm run benchmark:audit -- out/benchmark-evaluation/<evaluation-id>
```

The audit fails for missing evidence, human edits, disallowed tools, incomplete controls or motion,
inspection diagnostics, nondeterminism, export/parity failure, insufficient reviewer attribution,
unadjudicated rating disagreement, or missed aggregate targets.

## Release status

The Phase 7 release gate is **not yet passed** until ten genuine independent attempts and blinded
human reviews exist and satisfy the PRD thresholds. Generated pending templates are not evaluation
evidence. This explicit status prevents automated or human contributors from presenting synthetic
scores as release approval.

Before marking the MVP released, also archive the exact toolchain manifest, dependency/license and
vulnerability review, complete quality-gate results, performance distribution from the declared
reference machine, browser/native parity reports, security review sign-off, documentation journey
timing, and the passing benchmark bundle described by `TEST_PLAN.md`.
