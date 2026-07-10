add_library(imgui_studio_runtime_contract INTERFACE)
add_library(ImGuiStudio::RuntimeContract ALIAS imgui_studio_runtime_contract)

target_compile_features(imgui_studio_runtime_contract INTERFACE cxx_std_20)
target_include_directories(
    imgui_studio_runtime_contract
    INTERFACE
        "$<BUILD_INTERFACE:${CMAKE_CURRENT_SOURCE_DIR}/include>"
)

