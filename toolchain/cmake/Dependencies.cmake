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
endfunction()

