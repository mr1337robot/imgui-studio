add_executable(imgui_studio_browser_preview main.cpp)

target_compile_features(imgui_studio_browser_preview PRIVATE cxx_std_20)
target_link_libraries(
    imgui_studio_browser_preview
    PRIVATE
        DearImGui::BrowserBackend
        ImGuiStudio::Starter
)
studio_enable_strict_warnings(imgui_studio_browser_preview)
# Emscripten's driver injects a host-specific unused option; keep the suppression target-local so
# first-party warning policy remains strict everywhere else.
target_compile_options(imgui_studio_browser_preview PRIVATE -Wno-unused-command-line-argument)

# Force WebGL2 instead of allowing Emscripten to fall back to WebGL1. Memory growth accommodates the
# encoded capture buffer, and NO_EXIT_RUNTIME keeps callbacks valid after C++ main returns.
target_link_options(
    imgui_studio_browser_preview
    PRIVATE
        "SHELL:-sUSE_GLFW=3"
        "SHELL:-sMIN_WEBGL_VERSION=2"
        "SHELL:-sMAX_WEBGL_VERSION=2"
        "SHELL:-sFULL_ES3=1"
        "SHELL:-sALLOW_MEMORY_GROWTH=1"
        "SHELL:-sASSERTIONS=1"
        "SHELL:-sNO_EXIT_RUNTIME=1"
        # Embed the exact authored font weights at stable virtual paths. The native fixture copies
        # these same bytes beside its executable, so both targets build equivalent atlases.
        "SHELL:--preload-file \"${IMGUI_STUDIO_STARTER_SOURCE_DIR}/assets/fonts/Inter-Medium.ttf\"@/assets/fonts/Inter-Medium.ttf"
        "SHELL:--preload-file \"${IMGUI_STUDIO_STARTER_SOURCE_DIR}/assets/fonts/Inter-SemiBold.ttf\"@/assets/fonts/Inter-SemiBold.ttf"
        "SHELL:--shell-file ${CMAKE_CURRENT_SOURCE_DIR}/shell.html"
)

set_target_properties(
    imgui_studio_browser_preview
    PROPERTIES
        OUTPUT_NAME "preview"
        SUFFIX ".html"
        RUNTIME_OUTPUT_DIRECTORY "${CMAKE_BINARY_DIR}/preview"
)
