# Starter Project

The canonical Phase 1 starter is a backend-neutral C++ library compiled unchanged into the
Emscripten/WebGL2 preview and Windows/DX11 parity host. It renders a complete dark settings card
with one custom animated toggle built from `InvisibleButton` interaction and `ImDrawList` geometry.

`MenuState` owns all application and animation state. Platform hosts supply frame delta and receive
the same `MenuDiagnostics` geometry for parity comparison.
