cmake_minimum_required(VERSION 4.0)

project(
    ImGuiStudio
    VERSION 0.1.0
    DESCRIPTION "AI-native visual development environment for Dear ImGui"
    LANGUAGES CXX
)

option(IMGUI_STUDIO_BUILD_TESTS "Build ImGui Studio foundation tests" ON)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)
set(CMAKE_EXPORT_COMPILE_COMMANDS ON)

list(APPEND CMAKE_MODULE_PATH "${CMAKE_CURRENT_SOURCE_DIR}/toolchain/cmake")
include(StudioWarnings)

add_subdirectory(runtime)

if(IMGUI_STUDIO_BUILD_TESTS)
    include(CTest)
    enable_testing()
    add_subdirectory(tests)
endif()

