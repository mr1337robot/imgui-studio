#include "capture.hpp"

#include <cstdint>
#include <filesystem>
#include <format>
#include <limits>
#include <system_error>
#include <wincodec.h>
#include <wrl/client.h>

namespace studio::native {
namespace {

using Microsoft::WRL::ComPtr;

[[nodiscard]] CaptureResult Failure(const std::string& operation, const HRESULT result) {
    return {false, std::format("{} failed with HRESULT 0x{:08X}", operation,
                               static_cast<std::uint32_t>(result))};
}

} // namespace

CaptureResult CaptureTextureToPng(ID3D11Device& device, ID3D11DeviceContext& context,
                                  ID3D11Texture2D& source,
                                  const std::filesystem::path& outputPath) {
    D3D11_TEXTURE2D_DESC sourceDescription{};
    source.GetDesc(&sourceDescription);
    if (sourceDescription.Format != DXGI_FORMAT_B8G8R8A8_UNORM) {
        return {false, "Capture requires DXGI_FORMAT_B8G8R8A8_UNORM."};
    }

    // Render targets normally live in GPU-only memory and cannot be mapped by the CPU. A staging
    // texture has no render bindings and grants read access specifically for this transfer.
    D3D11_TEXTURE2D_DESC stagingDescription = sourceDescription;
    stagingDescription.BindFlags = 0;
    stagingDescription.CPUAccessFlags = D3D11_CPU_ACCESS_READ;
    stagingDescription.MiscFlags = 0;
    stagingDescription.Usage = D3D11_USAGE_STAGING;

    ComPtr<ID3D11Texture2D> staging;
    HRESULT result = device.CreateTexture2D(&stagingDescription, nullptr, &staging);
    if (FAILED(result)) {
        return Failure("CreateTexture2D(staging)", result);
    }

    // CopyResource is queued on the immediate context. Map synchronizes with that queue before it
    // returns a CPU pointer, so mapped bytes describe the completed render without a manual fence.
    context.CopyResource(staging.Get(), &source);
    D3D11_MAPPED_SUBRESOURCE mapped{};
    result = context.Map(staging.Get(), 0, D3D11_MAP_READ, 0, &mapped);
    if (FAILED(result)) {
        return Failure("Map(staging)", result);
    }

    // The mapped resource must be released on every path after Map succeeds. Keep this cleanup next
    // to the acquisition so early encoder/directory failures cannot leave the context mapped.
    const auto unmap = [&context, &staging]() { context.Unmap(staging.Get(), 0); };

    std::error_code directoryError;
    if (const auto parent = outputPath.parent_path(); !parent.empty()) {
        std::filesystem::create_directories(parent, directoryError);
    }
    if (directoryError) {
        unmap();
        return {false,
                std::format("Unable to create capture directory: {}", directoryError.message())};
    }

    // Windows Imaging Component accepts BGRA scanlines directly and owns PNG compression. COM
    // interfaces are held in ComPtr so partial encoder construction remains leak-free.
    ComPtr<IWICImagingFactory> factory;
    result = CoCreateInstance(CLSID_WICImagingFactory, nullptr, CLSCTX_INPROC_SERVER,
                              IID_PPV_ARGS(&factory));
    if (FAILED(result)) {
        unmap();
        return Failure("CoCreateInstance(WIC)", result);
    }

    ComPtr<IWICStream> stream;
    result = factory->CreateStream(&stream);
    if (SUCCEEDED(result)) {
        result = stream->InitializeFromFilename(outputPath.c_str(), GENERIC_WRITE);
    }
    if (FAILED(result)) {
        unmap();
        return Failure("InitializeFromFilename", result);
    }

    ComPtr<IWICBitmapEncoder> encoder;
    result = factory->CreateEncoder(GUID_ContainerFormatPng, nullptr, &encoder);
    if (SUCCEEDED(result)) {
        result = encoder->Initialize(stream.Get(), WICBitmapEncoderNoCache);
    }
    if (FAILED(result)) {
        unmap();
        return Failure("Initialize PNG encoder", result);
    }

    ComPtr<IWICBitmapFrameEncode> frame;
    ComPtr<IPropertyBag2> properties;
    result = encoder->CreateNewFrame(&frame, &properties);
    if (SUCCEEDED(result)) {
        result = frame->Initialize(properties.Get());
    }
    if (SUCCEEDED(result)) {
        result = frame->SetSize(sourceDescription.Width, sourceDescription.Height);
    }
    WICPixelFormatGUID pixelFormat = GUID_WICPixelFormat32bppBGRA;
    if (SUCCEEDED(result)) {
        result = frame->SetPixelFormat(&pixelFormat);
    }
    if (FAILED(result) || pixelFormat != GUID_WICPixelFormat32bppBGRA) {
        unmap();
        return Failure("Initialize PNG frame", FAILED(result) ? result : E_FAIL);
    }

    // RowPitch may include driver-added padding and is not necessarily width * 4. Passing the
    // reported pitch preserves row boundaries. Check the narrowing conversion required by WIC's
    // 32-bit byte-count API before writing.
    const std::uint64_t bufferSize =
        static_cast<std::uint64_t>(mapped.RowPitch) * sourceDescription.Height;
    if (bufferSize > (std::numeric_limits<UINT>::max)()) {
        unmap();
        return {false, "Capture buffer exceeds WIC's 32-bit size limit."};
    }

    // Commit the frame before the encoder: the first finalizes image data and the second finalizes
    // the PNG container. Success is reported only after both operations complete.
    result = frame->WritePixels(sourceDescription.Height, mapped.RowPitch,
                                static_cast<UINT>(bufferSize), static_cast<BYTE*>(mapped.pData));
    if (SUCCEEDED(result)) {
        result = frame->Commit();
    }
    if (SUCCEEDED(result)) {
        result = encoder->Commit();
    }
    unmap();

    if (FAILED(result)) {
        return Failure("Write PNG", result);
    }
    return {true, {}};
}

} // namespace studio::native
