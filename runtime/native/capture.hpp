#pragma once

#include <d3d11.h>
#include <filesystem>
#include <string>

namespace studio::native {

/// Result of reading and encoding one DX11 render target.
struct CaptureResult {
    /// True only when the complete PNG has been committed to disk.
    bool succeeded{};

    /// Safe, human-readable failure context; empty on success.
    std::string error{};
};

/// Copies an RGBA8 DX11 texture to CPU memory and writes a PNG through WIC.
///
/// @param device Device that owns `source`.
/// @param context Immediate context used for the staging copy.
/// @param source Render target texture in `DXGI_FORMAT_B8G8R8A8_UNORM` format.
/// @param outputPath Destination PNG. Its parent directory is created.
/// @return Success or a safe diagnostic message. COM must be initialized on the calling thread.
/// The function performs synchronous GPU readback and file I/O and is therefore not frame-loop
/// safe. It does not retain any argument after returning.
[[nodiscard]] CaptureResult CaptureTextureToPng(ID3D11Device& device, ID3D11DeviceContext& context,
                                                ID3D11Texture2D& source,
                                                const std::filesystem::path& outputPath);

} // namespace studio::native
