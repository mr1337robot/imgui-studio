include(FetchContent)

# Dear ImGui v1.92.1. The immutable commit is also recorded in
# toolchain/toolchain.json and THIRD_PARTY_NOTICES.md.
FetchContent_Declare(
    dear_imgui
    GIT_REPOSITORY https://github.com/ocornut/imgui.git
    GIT_TAG 5d4126876bc10396d4c6511853ff10964414c776
    GIT_SHALLOW FALSE
    GIT_PROGRESS TRUE
)

function(studio_fetch_dear_imgui)
    FetchContent_MakeAvailable(dear_imgui)
    set(dear_imgui_SOURCE_DIR "${dear_imgui_SOURCE_DIR}" PARENT_SCOPE)
endfunction()

function(studio_configure_dear_imgui)
    if(TARGET DearImGui::Core)
        return()
    endif()

    set(local_imgui_source "${CMAKE_CURRENT_SOURCE_DIR}/.tools/dependencies/dear-imgui")
    if(EXISTS "${local_imgui_source}/imgui.cpp")
        set(FETCHCONTENT_SOURCE_DIR_DEAR_IMGUI "${local_imgui_source}")
    endif()

    studio_fetch_dear_imgui()

    add_library(
        dear_imgui_core
        STATIC
            "${dear_imgui_SOURCE_DIR}/imgui.cpp"
            "${dear_imgui_SOURCE_DIR}/imgui_demo.cpp"
            "${dear_imgui_SOURCE_DIR}/imgui_draw.cpp"
            "${dear_imgui_SOURCE_DIR}/imgui_tables.cpp"
            "${dear_imgui_SOURCE_DIR}/imgui_widgets.cpp"
    )
    add_library(DearImGui::Core ALIAS dear_imgui_core)
    target_include_directories(dear_imgui_core PUBLIC "${dear_imgui_SOURCE_DIR}")
    target_compile_features(dear_imgui_core PUBLIC cxx_std_20)

    if(EMSCRIPTEN)
        add_library(
            dear_imgui_browser_backend
            STATIC
                "${dear_imgui_SOURCE_DIR}/backends/imgui_impl_glfw.cpp"
                "${dear_imgui_SOURCE_DIR}/backends/imgui_impl_opengl3.cpp"
        )
        add_library(DearImGui::BrowserBackend ALIAS dear_imgui_browser_backend)
        target_include_directories(
            dear_imgui_browser_backend
            PUBLIC
                "${dear_imgui_SOURCE_DIR}"
                "${dear_imgui_SOURCE_DIR}/backends"
        )
        target_compile_definitions(dear_imgui_browser_backend PUBLIC IMGUI_IMPL_OPENGL_ES3)
        target_compile_options(dear_imgui_browser_backend PUBLIC "SHELL:-sUSE_GLFW=3")
        target_link_options(dear_imgui_browser_backend PUBLIC "SHELL:-sUSE_GLFW=3")
        target_link_libraries(dear_imgui_browser_backend PUBLIC DearImGui::Core)
    elseif(WIN32)
        add_library(
            dear_imgui_native_backend
            STATIC
                "${dear_imgui_SOURCE_DIR}/backends/imgui_impl_dx11.cpp"
                "${dear_imgui_SOURCE_DIR}/backends/imgui_impl_win32.cpp"
        )
        add_library(DearImGui::NativeBackend ALIAS dear_imgui_native_backend)
        target_include_directories(
            dear_imgui_native_backend
            PUBLIC
                "${dear_imgui_SOURCE_DIR}"
                "${dear_imgui_SOURCE_DIR}/backends"
        )
        target_link_libraries(dear_imgui_native_backend PUBLIC DearImGui::Core d3d11 dxgi)
    endif()
endfunction()
