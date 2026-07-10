# Native Runtime Host

The Phase 1 native host creates a fixed 900 x 600 Win32/DX11 render target, calls the shared starter
menu source, reads the final DX11 texture through a staging resource, and encodes canonical RGBA
output with Windows Imaging Component. It writes matching JSON geometry metadata for parity checks.

The host is intentionally separate from the shared menu library; no Win32 or DX11 type crosses
into project source.

Run `toolchain/run-native.ps1` for a visible, interactive window that remains open until closed.
Mouse input and animation use the normal Win32 frame clock in this mode. Running the executable
without `--interactive` retains the hidden, fixed-step capture-and-exit behavior required by CI.
