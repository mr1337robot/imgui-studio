add_executable(
    imgui_studio_native_parity
    main.cpp
    capture.cpp
)

target_compile_features(imgui_studio_native_parity PRIVATE cxx_std_20)
# Keep Windows headers small and prevent min/max macros from breaking standard-library calls.
target_compile_definitions(imgui_studio_native_parity PRIVATE NOMINMAX WIN32_LEAN_AND_MEAN)
target_include_directories(imgui_studio_native_parity PRIVATE "${CMAKE_CURRENT_SOURCE_DIR}")
target_link_libraries(
    imgui_studio_native_parity
    PRIVATE
        DearImGui::NativeBackend
        ImGuiStudio::Starter
        d3d11
        dxgi
        ole32
        windowscodecs
)
studio_enable_strict_warnings(imgui_studio_native_parity)
set_target_properties(
    imgui_studio_native_parity
    PROPERTIES
        RUNTIME_OUTPUT_DIRECTORY "${CMAKE_BINARY_DIR}/bin"
        RUNTIME_OUTPUT_DIRECTORY_DEBUG "${CMAKE_BINARY_DIR}/bin"
        VS_GLOBAL_VcpkgEnabled false
        VS_GLOBAL_VcpkgAppLocalDeps false
)

# Runtime assets live beside the fixture executable instead of depending on the process working
# directory. This is also representative of the export package's explicit asset deployment model.
add_custom_command(
    TARGET imgui_studio_native_parity
    POST_BUILD
    COMMAND ${CMAKE_COMMAND} -E make_directory
            "$<TARGET_FILE_DIR:imgui_studio_native_parity>/assets/fonts"
    COMMAND ${CMAKE_COMMAND} -E copy_if_different
            "${IMGUI_STUDIO_STARTER_SOURCE_DIR}/assets/fonts/Inter-Medium.ttf"
            "$<TARGET_FILE_DIR:imgui_studio_native_parity>/assets/fonts/Inter-Medium.ttf"
    COMMAND ${CMAKE_COMMAND} -E copy_if_different
            "${IMGUI_STUDIO_STARTER_SOURCE_DIR}/assets/fonts/Inter-SemiBold.ttf"
            "$<TARGET_FILE_DIR:imgui_studio_native_parity>/assets/fonts/Inter-SemiBold.ttf"
    COMMENT "Copying the starter's pinned Inter font weights"
)

if(IMGUI_STUDIO_BUILD_TESTS)
    # This smoke test verifies more than process startup: success requires a complete PNG and
    # metadata sidecar from a real DX11 render target.
    add_test(
        NAME phase1.native.capture
        COMMAND
            imgui_studio_native_parity
            --output "${CMAKE_BINARY_DIR}/test-artifacts/native.png"
            --metadata "${CMAKE_BINARY_DIR}/test-artifacts/native.metadata.json"
    )
endif()
