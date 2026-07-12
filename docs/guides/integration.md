# Native Integration Guide

Export only after the intended revision has built and reached **Preview ready**. Select **Export
native** in Studio, or call `export_project` with that exact build ID. The MVP produces a directory
package under `.studio/exports/<exportId>/<outputName>` and verifies it before promotion.

The consumer must already provide a compatible Dear ImGui target. Give its CMake target name to the
package and add the package directory:

```cmake
set(IMGUI_TARGET imgui CACHE STRING "" FORCE)
add_subdirectory(path/to/exported-menu)
target_link_libraries(my_application PRIVATE imgui_studio_starter::menu)
```

The generated public `integration.hpp` exposes `State`, `Events`, `Initialize`, `Reset`, `Render`,
and `Shutdown`. The application owns the Dear ImGui context, renderer backend, frame loop, state
lifetime, and texture bindings. Call `Render` only between `ImGui::NewFrame()` and `ImGui::Render()`
on the ImGui thread. Event callbacks are synchronous and references passed to them must not escape.

Use the package's `examples/native` fixture as the executable reference. It is configured and built
from a clean directory during export, then rendered at the fixed deterministic benchmark time. Read
`studio-export.json`, `verification/report.json`, and `SHA256SUMS` before integration; together they
identify the exact build revision, toolchain, runtime, assets, licenses, portability warnings, and
parity result.

If CMake cannot find Dear ImGui, set `IMGUI_TARGET` to an existing target. If strict compilation
fails, confirm the consumer uses the version recorded in `studio-export.json`. Never copy current
working source over the package: rebuild and export a new immutable revision instead.

[EXPORT_AND_INTEGRATION.md](../../EXPORT_AND_INTEGRATION.md) is the normative contract.
