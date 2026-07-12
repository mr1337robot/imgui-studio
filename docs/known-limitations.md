# MVP Known Limitations

- The supported host is Windows x64 with the exact MSVC and Chromium/Emscripten version set in
  `toolchain/toolchain.json`. macOS, Linux, WebGPU, docking, and multi-viewport authoring are outside
  the MVP.
- Export produces deterministic directory packages. ZIP/archive output is a P1 follow-up.
- The first export generator targets the checked-in starter project contract and Windows DX11
  parity fixture. Arbitrary existing applications and generalized project templates are not
  supported.
- Portable effects use ordinary Dear ImGui draw-list primitives. Blur, bloom, custom render passes,
  and photographic presentation effects are intentionally excluded.
- Opening and building a Studio project executes a local C++ toolchain. The MVP does not sandbox
  malicious native source; review untrusted projects before building.
- The service is local-first, single-user, and owns one active project/build pipeline. Hosted builds,
  collaboration, accounts, and marketplace distribution are deferred.
- Reference similarity is diagnostic. Human visual review remains required for the release
  benchmark and cannot be replaced by a pixel score.
