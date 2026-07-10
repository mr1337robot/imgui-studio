#include <GLFW/glfw3.h>
#include <backends/imgui_impl_glfw.h>
#include <backends/imgui_impl_opengl3.h>
#include <cstdlib>
#include <emscripten.h>
#include <emscripten/html5.h>
#include <imgui.h>
#include <iostream>
#include <studio_example/menu.hpp>

// This executable is the browser platform edge. It owns GLFW, WebGL, the ImGui context, and the
// JavaScript message bridge; the linked starter menu knows nothing about any of those facilities.
namespace {

constexpr int kViewportWidthPx = 900;
constexpr int kViewportHeightPx = 600;

struct Application {
    // GLFW owns the browser canvas/WebGL context. Emscripten keeps this aggregate alive after main
    // returns and passes it back to RenderFrame on the browser's animation loop.
    GLFWwindow* window{};
    studio_example::MenuState menuState{};
    bool readySent{};
};

// EM_JS creates small JavaScript functions callable from C++. Keeping protocol serialization at
// this edge prevents browser types and postMessage details from leaking into shared project code.
// clang-format off
EM_JS(void, PostReady, (), {
    const identity = window.__studioIdentity;
    window.parent.postMessage(
        {
            protocolVersion: 1,
            type: 'studio.preview.ready',
            ...identity,
            renderer: 'webgl2',
            viewport: { widthPx: 900, heightPx: 600, dpiScaleMilli: 1000 },
        },
        window.__studioParentOrigin,
    );
});

EM_JS(void, PostFrame,
      (const char* sourceSha256, int enabled, float progress, float xPx, float yPx, float widthPx, float heightPx), {
          const identity = window.__studioIdentity;
          const frame = {
              protocolVersion: 1,
              type: 'studio.preview.frame',
              ...identity,
              renderer: 'webgl2',
              viewport: { widthPx: 900, heightPx: 600, dpiScaleMilli: 1000 },
              framebuffer: { format: 'rgba8', colorSpace: 'srgb' },
              sourceSha256: UTF8ToString(sourceSha256),
              toggle: {
                  xPx,
                  yPx,
                  widthPx,
                  heightPx,
                  enabled: Boolean(enabled),
                  progress,
              },
          };
          window.__studioLastFrame = frame;
          window.parent.postMessage(frame, window.__studioParentOrigin);
      });

EM_JS(void, CaptureIfRequested, (), {
    const request = window.__studioCaptureRequest;
    if (!request) {
        return;
    }
    window.__studioCaptureRequest = null;

    // Capture the actual WebGL framebuffer before glfwSwapBuffers. canvas.toBlob() can observe a
    // cleared drawing buffer when preserveDrawingBuffer is false, so readPixels is the canonical
    // source rather than the browser's presentation surface.
    const width = 900;
    const height = 600;
    const source = new Uint8Array(width * height * 4);
    GLctx.readPixels(0, 0, width, height, GLctx.RGBA, GLctx.UNSIGNED_BYTE, source);
    const flipped = new Uint8ClampedArray(source.length);
    const rowBytes = width * 4;
    // OpenGL's origin is bottom-left; PNG/canvas rows begin at top-left. Reverse complete rows,
    // never individual pixels, to preserve RGBA channel ordering.
    for (let sourceY = 0; sourceY < height; sourceY += 1) {
        const targetY = height - sourceY - 1;
        flipped.set(
            source.subarray(sourceY * rowBytes, (sourceY + 1) * rowBytes),
            targetY * rowBytes,
        );
    }

    const captureCanvas = document.createElement('canvas');
    captureCanvas.width = width;
    captureCanvas.height = height;
    const context = captureCanvas.getContext('2d');
    context.putImageData(new ImageData(flipped, width, height), 0, 0);
    captureCanvas.toBlob(function(blob) {
        if (!blob) {
            window.parent.postMessage(
                {
                    protocolVersion: 1,
                    type: 'studio.capture.failed',
                    requestId: request.requestId,
                },
                window.__studioParentOrigin,
            );
            return;
        }
        blob.arrayBuffer().then(function(bytes) {
            // The transfer list moves ownership of the ArrayBuffer to the parent without copying
            // a multi-megabyte capture through the structured-clone algorithm.
            window.parent.postMessage(
                {
                    protocolVersion: 1,
                    type: 'studio.capture.completed',
                    requestId: request.requestId,
                    frame: window.__studioLastFrame,
                    bytes: bytes,
                },
                window.__studioParentOrigin,
                [bytes],
            );
        });
    }, 'image/png');
});
// clang-format on

void RenderFrame(void* userData) {
    // Dear ImGui is immediate-mode: each frame rebuilds input, layout, and draw commands from the
    // current application state. Only MenuState persists; no widget object tree is retained.
    auto& application = *static_cast<Application*>(userData);
    glfwPollEvents();

    ImGui_ImplOpenGL3_NewFrame();
    ImGui_ImplGlfw_NewFrame();
    ImGuiIO& io = ImGui::GetIO();
    io.DisplaySize = {static_cast<float>(kViewportWidthPx), static_cast<float>(kViewportHeightPx)};
    ImGui::NewFrame();
    const studio_example::MenuDiagnostics diagnostics =
        studio_example::RenderMenu(application.menuState, io.DeltaTime);
    ImGui::Render();

    glViewport(0, 0, kViewportWidthPx, kViewportHeightPx);
    glClearColor(0.0F, 0.0F, 0.0F, 1.0F);
    glClear(GL_COLOR_BUFFER_BIT);
    ImGui_ImplOpenGL3_RenderDrawData(ImGui::GetDrawData());
    PostFrame(studio_example::StarterSourceSha256().data(), diagnostics.toggleEnabled ? 1 : 0,
              diagnostics.toggleProgress, diagnostics.toggleBounds.xPx,
              diagnostics.toggleBounds.yPx, diagnostics.toggleBounds.widthPx,
              diagnostics.toggleBounds.heightPx);
    // Capture after ImGui has submitted its draw data but before swap/presentation can invalidate
    // the back buffer. Metadata posted immediately above describes this exact rendered frame.
    CaptureIfRequested();
    glfwSwapBuffers(application.window);
    if (!application.readySent) {
        application.readySent = true;
        PostReady();
    }
}

} // namespace

int main() {
    // Emscripten implements GLFW on top of the HTML canvas and WebGL. Request OpenGL ES 3 because
    // Emscripten maps it to the MVP's required WebGL2 context.
    if (glfwInit() == GLFW_FALSE) {
        std::cerr << "Unable to initialize GLFW.\n";
        return EXIT_FAILURE;
    }

    glfwWindowHint(GLFW_CONTEXT_VERSION_MAJOR, 3);
    glfwWindowHint(GLFW_CONTEXT_VERSION_MINOR, 0);
    glfwWindowHint(GLFW_CLIENT_API, GLFW_OPENGL_ES_API);
    glfwWindowHint(GLFW_RESIZABLE, GLFW_FALSE);
    GLFWwindow* window = glfwCreateWindow(kViewportWidthPx, kViewportHeightPx,
                                          "ImGui Studio Phase 1", nullptr, nullptr);
    if (window == nullptr) {
        glfwTerminate();
        return EXIT_FAILURE;
    }

    glfwMakeContextCurrent(window);

    IMGUI_CHECKVERSION();
    ImGui::CreateContext();
    ImGuiIO& io = ImGui::GetIO();
    // Disable ImGui's default filesystem-backed settings and log files. Browser preview state must
    // be resettable and must not depend on origin storage or a virtual filesystem.
    io.IniFilename = nullptr;
    io.LogFilename = nullptr;
    ImGui::StyleColorsDark();
    if (!ImGui_ImplGlfw_InitForOpenGL(window, true) || !ImGui_ImplOpenGL3_Init("#version 300 es")) {
        ImGui::DestroyContext();
        glfwDestroyWindow(window);
        glfwTerminate();
        return EXIT_FAILURE;
    }

    // emscripten_set_main_loop_arg does not return while simulating the browser event loop. Static
    // storage therefore makes the callback's user-data lifetime explicit and process-long.
    static Application application;
    application.window = window;
    studio_example::ResetMenuState(application.menuState);
    emscripten_set_main_loop_arg(RenderFrame, &application, 0, true);
    return EXIT_SUCCESS;
}
