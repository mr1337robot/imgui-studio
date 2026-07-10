# Browser Runtime Host

The Phase 1 browser host compiles Dear ImGui, its GLFW/OpenGL3 backend, and the shared starter menu
to WebAssembly/WebGL2. It runs on a dedicated loopback origin inside a sandboxed iframe, emits a
versioned ready/frame handshake, accepts bounded capture requests, and returns PNG bytes from the
underlying 900 x 600 canvas.

Project menu/widget source remains backend-neutral and does not include this directory.
