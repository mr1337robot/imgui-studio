add_executable(foundation_cpp_test unit/cpp/foundation_test.cpp)
target_link_libraries(foundation_cpp_test PRIVATE ImGuiStudio::RuntimeContract)
studio_enable_strict_warnings(foundation_cpp_test)

if(EMSCRIPTEN)
    # The repository is an npm ES-module package, while Emscripten's default
    # Node test harness is CommonJS. Use an explicit suffix so Node selects the
    # correct module system without weakening the repository-wide JS policy.
    set_target_properties(foundation_cpp_test PROPERTIES SUFFIX ".cjs")
elseif(MSVC)
    # Keep the foundation independent from any user-wide vcpkg MSBuild
    # integration, which is outside the pinned Phase 0 dependency graph.
    set_target_properties(
        foundation_cpp_test
        PROPERTIES
            VS_GLOBAL_VcpkgEnabled false
            VS_GLOBAL_VcpkgAppLocalDeps false
    )
endif()

add_test(NAME foundation.cpp COMMAND foundation_cpp_test)
