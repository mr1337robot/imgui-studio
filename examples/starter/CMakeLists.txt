set(
    IMGUI_STUDIO_STARTER_SOURCE_DIR
    "${CMAKE_CURRENT_SOURCE_DIR}"
    CACHE PATH
    "Immutable starter project snapshot compiled by the local service"
)

file(GLOB_RECURSE starter_source_files CONFIGURE_DEPENDS
    "${IMGUI_STUDIO_STARTER_SOURCE_DIR}/src/*.cpp"
    "${IMGUI_STUDIO_STARTER_SOURCE_DIR}/include/*.hpp"
)
list(SORT starter_source_files)

add_library(imgui_studio_starter STATIC ${starter_source_files})
add_library(ImGuiStudio::Starter ALIAS imgui_studio_starter)

# Hash both public and private shared source at configure time. Embedding the combined digest in each
# platform executable lets capture comparison prove that browser and native rendered identical code.
set(starter_hash_input "")
foreach(starter_source_file IN LISTS starter_source_files)
    file(SHA256 "${starter_source_file}" starter_file_sha256)
    file(RELATIVE_PATH starter_relative_path "${IMGUI_STUDIO_STARTER_SOURCE_DIR}" "${starter_source_file}")
    string(APPEND starter_hash_input "${starter_relative_path}:${starter_file_sha256}\n")
endforeach()
string(SHA256 starter_source_sha256 "${starter_hash_input}")

target_compile_features(imgui_studio_starter PUBLIC cxx_std_20)
target_compile_definitions(
    imgui_studio_starter
    PRIVATE STUDIO_STARTER_SOURCE_SHA256="${starter_source_sha256}"
)
target_include_directories(
    imgui_studio_starter
    PUBLIC "${IMGUI_STUDIO_STARTER_SOURCE_DIR}/include"
)
target_link_libraries(imgui_studio_starter PUBLIC DearImGui::Core ImGuiStudio::RuntimeContract)
studio_enable_strict_warnings(imgui_studio_starter)
