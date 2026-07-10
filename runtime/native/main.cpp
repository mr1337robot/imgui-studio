#include "capture.hpp"

#include <backends/imgui_impl_dx11.h>
#include <backends/imgui_impl_win32.h>
#include <cstdlib>
#include <d3d11.h>
#include <filesystem>
#include <fstream>
#include <imgui.h>
#include <iostream>
#include <optional>
#include <string>
#include <string_view>
#include <studio_example/menu.hpp>
#include <windows.h>
#include <wrl/client.h>

extern IMGUI_IMPL_API LRESULT ImGui_ImplWin32_WndProcHandler(HWND window, UINT message,
                                                             WPARAM wideParameter,
                                                             LPARAM longParameter);

// This executable is a deterministic capture fixture, not the future native consumer API. It owns
// every Win32/DX11 resource and links the same backend-neutral starter target as the WASM host.
namespace {

using Microsoft::WRL::ComPtr;

constexpr UINT kViewportWidthPx = 900;
constexpr UINT kViewportHeightPx = 600;
constexpr int kDeterministicCaptureFrameCount = 3;

struct CommandLine {
    std::filesystem::path output{"out/captures/native.png"};
    std::filesystem::path metadata{"out/captures/native.metadata.json"};
    float layoutOffsetXPx{};
    bool interactive{};
};

struct Graphics {
    // ComPtr provides RAII for COM interface references: each field calls Release automatically
    // when Graphics is destroyed, including returns from failed initialization paths.
    ComPtr<ID3D11Device> device;
    ComPtr<ID3D11DeviceContext> context;
    ComPtr<IDXGISwapChain> swapChain;
    ComPtr<ID3D11RenderTargetView> renderTarget;
};

[[nodiscard]] LRESULT CALLBACK WindowProcedure(HWND window, UINT message, WPARAM wideParameter,
                                               LPARAM longParameter) {
    // ImGui receives input messages first so it can update mouse, keyboard, and focus state. Any
    // message it does not consume continues through the fixture's small Win32 lifecycle handler.
    if (ImGui_ImplWin32_WndProcHandler(window, message, wideParameter, longParameter) != 0) {
        return 1;
    }
    if (message == WM_CLOSE || message == WM_DESTROY) {
        PostQuitMessage(0);
        return 0;
    }
    return DefWindowProcW(window, message, wideParameter, longParameter);
}

[[nodiscard]] std::optional<CommandLine> ParseCommandLine(int argumentCount, char** arguments) {
    // This strict parser intentionally rejects unknown or incomplete options. Test infrastructure
    // should fail loudly instead of silently writing an artifact to an unintended location.
    CommandLine parsed;
    for (int index = 1; index < argumentCount; ++index) {
        const std::string_view argument{arguments[index]};
        const auto requireValue = [&]() -> const char* {
            if ((index + 1) >= argumentCount) {
                return nullptr;
            }
            ++index;
            return arguments[index];
        };
        if (argument == "--output") {
            const char* value = requireValue();
            if (value == nullptr) {
                return std::nullopt;
            }
            parsed.output = value;
        } else if (argument == "--metadata") {
            const char* value = requireValue();
            if (value == nullptr) {
                return std::nullopt;
            }
            parsed.metadata = value;
        } else if (argument == "--layout-offset-x") {
            const char* value = requireValue();
            if (value == nullptr) {
                return std::nullopt;
            }
            try {
                parsed.layoutOffsetXPx = std::stof(value);
            } catch (...) {
                return std::nullopt;
            }
        } else if (argument == "--interactive") {
            parsed.interactive = true;
        } else {
            return std::nullopt;
        }
    }
    return parsed;
}

[[nodiscard]] std::optional<Graphics> CreateGraphics(HWND window) {
    // BGRA8 is supported directly by Windows Imaging Component, avoiding a channel-swizzle copy
    // during capture. The fixed size and 1x sample count match the browser parity configuration.
    DXGI_SWAP_CHAIN_DESC description{};
    description.BufferCount = 2;
    description.BufferDesc.Width = kViewportWidthPx;
    description.BufferDesc.Height = kViewportHeightPx;
    description.BufferDesc.Format = DXGI_FORMAT_B8G8R8A8_UNORM;
    description.BufferUsage = DXGI_USAGE_RENDER_TARGET_OUTPUT;
    description.OutputWindow = window;
    description.SampleDesc.Count = 1;
    description.Windowed = TRUE;
    description.SwapEffect = DXGI_SWAP_EFFECT_DISCARD;

    constexpr D3D_FEATURE_LEVEL requestedLevels[]{D3D_FEATURE_LEVEL_11_0, D3D_FEATURE_LEVEL_10_0};
    D3D_FEATURE_LEVEL actualLevel{};
    Graphics graphics;
    HRESULT result = D3D11CreateDeviceAndSwapChain(
        nullptr, D3D_DRIVER_TYPE_HARDWARE, nullptr, 0, requestedLevels,
        static_cast<UINT>(std::size(requestedLevels)), D3D11_SDK_VERSION, &description,
        &graphics.swapChain, &graphics.device, &actualLevel, &graphics.context);
    if (FAILED(result)) {
        // WARP is Microsoft's software rasterizer. It keeps CI and headless machines testable when
        // no hardware adapter is available while exercising the same DX11 backend and draw data.
        result = D3D11CreateDeviceAndSwapChain(
            nullptr, D3D_DRIVER_TYPE_WARP, nullptr, 0, requestedLevels,
            static_cast<UINT>(std::size(requestedLevels)), D3D11_SDK_VERSION, &description,
            &graphics.swapChain, &graphics.device, &actualLevel, &graphics.context);
    }
    if (FAILED(result)) {
        return std::nullopt;
    }

    ComPtr<ID3D11Texture2D> backBuffer;
    result = graphics.swapChain->GetBuffer(0, IID_PPV_ARGS(&backBuffer));
    if (SUCCEEDED(result)) {
        result = graphics.device->CreateRenderTargetView(backBuffer.Get(), nullptr,
                                                         &graphics.renderTarget);
    }
    if (FAILED(result)) {
        return std::nullopt;
    }
    return graphics;
}

[[nodiscard]] bool WriteMetadata(const std::filesystem::path& path,
                                 const studio_example::MenuDiagnostics& diagnostics,
                                 const float offsetXPx) {
    // The PNG alone cannot prove parity. This sidecar records coordinate-space geometry and the
    // shared-source digest used by the machine-readable comparison gate.
    std::error_code error;
    if (const auto parent = path.parent_path(); !parent.empty()) {
        std::filesystem::create_directories(parent, error);
    }
    if (error) {
        return false;
    }

    std::ofstream stream(path, std::ios::binary | std::ios::trunc);
    if (!stream) {
        return false;
    }
    const auto& bounds = diagnostics.toggleBounds;
    stream << "{\n"
           << "  \"schemaVersion\": 1,\n"
           << "  \"renderer\": \"directx11\",\n"
           << "  \"viewport\": {\"widthPx\": 900, \"heightPx\": 600, \"dpiScaleMilli\": 1000},\n"
           << "  \"framebuffer\": {\"format\": \"rgba8\", \"colorSpace\": \"srgb\"},\n"
           << "  \"sourceSha256\": \"" << studio_example::StarterSourceSha256() << "\",\n"
           << "  \"layoutOffsetXPx\": " << offsetXPx << ",\n"
           << "  \"toggle\": {\"xPx\": " << bounds.xPx << ", \"yPx\": " << bounds.yPx
           << ", \"widthPx\": " << bounds.widthPx << ", \"heightPx\": " << bounds.heightPx
           << ", \"enabled\": " << (diagnostics.toggleEnabled ? "true" : "false")
           << ", \"progress\": " << diagnostics.toggleProgress << "}\n"
           << "}\n";
    return stream.good();
}

} // namespace

int main(int argumentCount, char** arguments) {
    const auto commandLine = ParseCommandLine(argumentCount, arguments);
    if (!commandLine) {
        std::cerr << "Usage: imgui_studio_native_parity [--output path] [--metadata path] "
                     "[--layout-offset-x pixels] [--interactive]\n";
        return EXIT_FAILURE;
    }

    // Make Win32 coordinates physical pixels. DPI virtualization would otherwise scale the client
    // area and make a nominal 900 x 600 viewport differ from the browser framebuffer.
    SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);

    // WIC's PNG encoder is a COM component. This thread owns initialization and balances it with
    // CoUninitialize after all WIC and DX11 resources have been released.
    const HRESULT comResult = CoInitializeEx(nullptr, COINIT_MULTITHREADED);
    if (FAILED(comResult)) {
        std::cerr << "Unable to initialize COM.\n";
        return EXIT_FAILURE;
    }

    const HINSTANCE instance = GetModuleHandleW(nullptr);
    constexpr wchar_t windowClassName[] = L"ImGuiStudioPhase1Parity";
    WNDCLASSEXW windowClass{sizeof(windowClass),
                            CS_CLASSDC,
                            WindowProcedure,
                            0,
                            0,
                            instance,
                            nullptr,
                            nullptr,
                            nullptr,
                            nullptr,
                            windowClassName,
                            nullptr};
    if (RegisterClassExW(&windowClass) == 0) {
        CoUninitialize();
        return EXIT_FAILURE;
    }

    // Create a window whose *client area* is exactly the canonical framebuffer size. Window chrome
    // is added outside this rectangle and never appears in the captured render target.
    RECT windowRectangle{0, 0, static_cast<LONG>(kViewportWidthPx),
                         static_cast<LONG>(kViewportHeightPx)};
    AdjustWindowRect(&windowRectangle, WS_OVERLAPPEDWINDOW, FALSE);
    HWND window = CreateWindowW(
        windowClassName, L"ImGui Studio Phase 1", WS_OVERLAPPEDWINDOW, CW_USEDEFAULT, CW_USEDEFAULT,
        windowRectangle.right - windowRectangle.left, windowRectangle.bottom - windowRectangle.top,
        nullptr, nullptr, instance, nullptr);
    if (window == nullptr) {
        UnregisterClassW(windowClassName, instance);
        CoUninitialize();
        return EXIT_FAILURE;
    }

    auto graphics = CreateGraphics(window);
    if (!graphics) {
        DestroyWindow(window);
        UnregisterClassW(windowClassName, instance);
        CoUninitialize();
        return EXIT_FAILURE;
    }

    // Platform and renderer backends translate Win32 input and ImDrawData respectively; the shared
    // menu remains unaware of both. Disable ImGui file persistence for repeatable clean captures.
    IMGUI_CHECKVERSION();
    ImGui::CreateContext();
    ImGuiIO& io = ImGui::GetIO();
    io.IniFilename = nullptr;
    io.LogFilename = nullptr;
    ImGui::StyleColorsDark();
    ImGui_ImplWin32_Init(window);
    ImGui_ImplDX11_Init(graphics->device.Get(), graphics->context.Get());

    studio_example::MenuState menuState;
    studio_example::ResetMenuState(menuState);
    menuState.layoutOffsetXPx = commandLine->layoutOffsetXPx;
    studio_example::MenuDiagnostics diagnostics;

    if (commandLine->interactive) {
        // Capture mode intentionally keeps the window hidden. Interactive mode makes the same
        // render target visible and gives it focus so the existing Win32 backend receives input.
        ShowWindow(window, SW_SHOWDEFAULT);
        UpdateWindow(window);
    }

    bool running = true;
    bool presentationSucceeded = true;
    int renderedFrames = 0;
    // Interactive mode runs until WM_QUIT. Capture mode renders a small, deterministic number of
    // hidden frames so the font atlas is uploaded before reading the final back buffer.
    while (running &&
           (commandLine->interactive || renderedFrames < kDeterministicCaptureFrameCount)) {
        MSG message{};
        while (PeekMessageW(&message, nullptr, 0, 0, PM_REMOVE) != 0) {
            if (message.message == WM_QUIT) {
                running = false;
                break;
            }
            TranslateMessage(&message);
            DispatchMessageW(&message);
        }
        if (!running) {
            break;
        }

        ImGui_ImplDX11_NewFrame();
        ImGui_ImplWin32_NewFrame();
        io.DisplaySize = {static_cast<float>(kViewportWidthPx),
                          static_cast<float>(kViewportHeightPx)};
        if (!commandLine->interactive) {
            // The interactive backend measures real elapsed time. Canonical capture must instead
            // use a fixed 60 Hz step so machine scheduling cannot alter animation state.
            io.DeltaTime = 1.0F / 60.0F;
        }
        ImGui::NewFrame();
        diagnostics = studio_example::RenderMenu(menuState, io.DeltaTime);
        ImGui::Render();

        constexpr float clearColor[4]{0.0F, 0.0F, 0.0F, 1.0F};
        graphics->context->OMSetRenderTargets(1, graphics->renderTarget.GetAddressOf(), nullptr);
        graphics->context->ClearRenderTargetView(graphics->renderTarget.Get(), clearColor);
        ImGui_ImplDX11_RenderDrawData(ImGui::GetDrawData());

        if (commandLine->interactive) {
            // Present with a one-frame vertical-sync interval. Capture mode never presents because
            // it reads the render target directly and should finish as quickly as possible in CI.
            const HRESULT presentResult = graphics->swapChain->Present(1, 0);
            if (FAILED(presentResult)) {
                std::cerr << "DX11 presentation failed.\n";
                presentationSucceeded = false;
                running = false;
            }
        }
        ++renderedFrames;
    }

    studio::native::CaptureResult captureResult{true, {}};
    bool metadataWritten = true;
    if (!commandLine->interactive) {
        // Read the final back buffer before backend shutdown. CaptureTextureToPng performs the
        // GPU-to-CPU staging copy; metadata comes from the same final RenderMenu call.
        ComPtr<ID3D11Texture2D> backBuffer;
        const HRESULT bufferResult = graphics->swapChain->GetBuffer(0, IID_PPV_ARGS(&backBuffer));
        captureResult =
            SUCCEEDED(bufferResult)
                ? studio::native::CaptureTextureToPng(*graphics->device.Get(),
                                                      *graphics->context.Get(), *backBuffer.Get(),
                                                      commandLine->output)
                : studio::native::CaptureResult{false, "Unable to access the DX11 back buffer."};
        metadataWritten =
            WriteMetadata(commandLine->metadata, diagnostics, commandLine->layoutOffsetXPx);
    }

    // Tear down in reverse ownership order: ImGui backends/context, COM graphics objects, window
    // class, then the thread's COM apartment.
    ImGui_ImplDX11_Shutdown();
    ImGui_ImplWin32_Shutdown();
    ImGui::DestroyContext();
    graphics.reset();
    DestroyWindow(window);
    UnregisterClassW(windowClassName, instance);
    CoUninitialize();

    if (!presentationSucceeded) {
        return EXIT_FAILURE;
    }
    if (!captureResult.succeeded || !metadataWritten) {
        std::cerr << (captureResult.succeeded ? "Unable to write metadata." : captureResult.error)
                  << '\n';
        return EXIT_FAILURE;
    }
    if (commandLine->interactive) {
        std::cout << "Interactive native preview closed.\n";
        return EXIT_SUCCESS;
    }
    std::cout << "Native capture: " << commandLine->output.string() << '\n';
    std::cout << "Native metadata: " << commandLine->metadata.string() << '\n';
    return EXIT_SUCCESS;
}
