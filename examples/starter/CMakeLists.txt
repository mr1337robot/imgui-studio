add_library(
    imgui_studio_starter
    STATIC
        src/menu.cpp
)
add_library(ImGuiStudio::Starter ALIAS imgui_studio_starter)

# Hash both public and private shared source at configure time. Embedding the combined digest in each
# platform executable lets capture comparison prove that browser and native rendered identical code.
file(SHA256 "${CMAKE_CURRENT_SOURCE_DIR}/src/menu.cpp" starter_implementation_sha256)
file(SHA256 "${CMAKE_CURRENT_SOURCE_DIR}/include/studio_example/menu.hpp" starter_header_sha256)
string(
    SHA256
    starter_source_sha256
    "${starter_implementation_sha256}:${starter_header_sha256}"
)

target_compile_features(imgui_studio_starter PUBLIC cxx_std_20)
target_compile_definitions(
    imgui_studio_starter
    PRIVATE STUDIO_STARTER_SOURCE_SHA256="${starter_source_sha256}"
)
target_include_directories(imgui_studio_starter PUBLIC "${CMAKE_CURRENT_SOURCE_DIR}/include")
target_link_libraries(imgui_studio_starter PUBLIC DearImGui::Core ImGuiStudio::RuntimeContract)
studio_enable_strict_warnings(imgui_studio_starter)
