add_library(imgui_studio_runtime_contract STATIC src/runtime.cpp)
add_library(ImGuiStudio::RuntimeContract ALIAS imgui_studio_runtime_contract)

target_compile_features(imgui_studio_runtime_contract PUBLIC cxx_std_20)
target_include_directories(
    imgui_studio_runtime_contract
    PUBLIC
        "$<BUILD_INTERFACE:${CMAKE_CURRENT_SOURCE_DIR}/include>"
)
target_link_libraries(imgui_studio_runtime_contract PUBLIC DearImGui::Core)
studio_enable_strict_warnings(imgui_studio_runtime_contract)
