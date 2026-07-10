#include <cstdlib>
#include <studio/version.hpp>

int main() {
    static_assert(__cplusplus >= 202002L, "ImGui Studio requires C++20 or newer");

    if (studio::kRuntimeVersion != "0.1.0") {
        return EXIT_FAILURE;
    }

    return EXIT_SUCCESS;
}
