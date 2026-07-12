# Release Benchmarks

`neon-reference` is the fixed MVP benchmark contract. Initialize an empty ten-run evidence bundle
with `npm run benchmark:init`, place permitted agent traces and artifacts into each run directory,
complete blinded reviews, then run `npm run benchmark:audit -- <bundle-directory>`.

The audit is deliberately fail-closed. Missing runs, evidence, reviewer rationales, adjudication,
or release thresholds produce a non-zero exit. Generated bundles belong under ignored `out/` and
must never be copied into source as if they were completed evidence.
