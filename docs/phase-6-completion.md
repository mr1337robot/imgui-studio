# Phase 6 Completion: Native Export and Integration

Phase 6 completes the first immutable native export path. A successful, smoke-passed browser build
can be selected explicitly and assembled into a standalone CMake directory package. The exporter
does not read mutable working files: it verifies the selected build's recorded source, asset, and
preview artifact digests, resolves the manifest allowlist, and copies only that graph plus the
approved Studio runtime subset.

## Delivered behavior

- `POST /api/v1/projects/{projectId}/exports` creates a deterministic directory package from an
  exact successful build ID. An older revision requires explicit confirmation. Failed builds,
  modified build snapshots, unsupported rendering tiers, and malformed requests are rejected with
  stable errors.
- Packages contain project headers and sources, declared assets and license files, the portable
  runtime subset, generated asset/provenance files, checksums, a documented integration wrapper,
  and clean consumer/native verification fixtures. `.studio`, references, undeclared files, linked
  paths, and host paths are excluded.
- The generated CMake target attaches to the consumer's existing Dear ImGui target and requires
  C++20. The consumer owns the ImGui context, renderer backend, frame lifecycle, state, and callback
  lifetime.
- Verified exports configure and build in a clean temporary directory, run the consumer contract,
  render the packaged Windows/DX11 fixture at deterministic time, capture the corresponding real
  C++/WASM frame, and enforce the fixed benchmark's maximum two-pixel geometry tolerance.
- Export payloads carry source/toolchain/runtime provenance, portability findings, license data,
  verification metadata, and SHA-256 checksums. Repeating an export from the same build produces
  the same ordered payload digests. Successful records survive service restart only if their full
  inventory still validates.
- The Studio toolbar exposes **Export native** once a successful preview exists, and the agent
  adapter exposes the same canonical service operation as `export_project`.

The MVP deliberately ships directory packages only. Deterministic archive output remains the P1
follow-up identified in the PRD and is not represented as completed work.

## Verification

The Phase 6 integration gate is `npm run test:phase2`. In addition to the earlier revision, cache,
preview, inspection, and deterministic-capture checks, it exercises:

- rejection of failed and digest-invalid builds;
- stale-build confirmation and immutable revision provenance;
- allowlist exclusion of a real undeclared secret fixture;
- a clean external package configure/build and consumer callback run;
- real packaged-native versus browser/WASM capture comparison;
- the two-pixel geometry gate; and
- identical ordered payload hashes across two exports of one build.

The generated evidence lives under `out/phase2-integration/` and is build output, not canonical
source. The normative contracts remain [EXPORT_AND_INTEGRATION.md](../EXPORT_AND_INTEGRATION.md),
[AGENT_TOOL_API.md](../AGENT_TOOL_API.md), and [TEST_PLAN.md](../TEST_PLAN.md).

## Known boundary

The first package generator targets the repository's starter project contract and Windows MSVC/DX11
parity fixture. General project-template generation, archive packaging, additional native backends,
and release hardening remain later work; none may fork the browser and native project source.
