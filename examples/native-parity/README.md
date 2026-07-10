# Windows Native Parity Fixture

The Win32 plus DirectX 11 parity host lives under `runtime/native/` and links
`ImGuiStudio::Starter`, the same target used by the WASM preview. Run
`toolchain/capture-native.ps1` to produce the canonical PNG and versioned metadata under
`out/captures/`, then run `npm run compare:captures`.

The capture records a SHA-256 identity derived from the starter implementation and public header.
The parity gate rejects different source identities, mismatched framebuffer dimensions, and toggle
geometry differences greater than two pixels.
