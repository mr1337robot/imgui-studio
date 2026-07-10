[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$RepositoryRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$BuildDirectory = Join-Path $RepositoryRoot 'build\wasm-preview'

# configure.ps1 owns the Emscripten toolchain selection and performs the actual build. Keeping this
# wrapper small gives developers one command while preserving a single configuration implementation.
& (Join-Path $PSScriptRoot 'configure.ps1') -BuildDirectory $BuildDirectory

# A successful compiler exit is insufficient if the expected browser entry point was not produced.
# Verify the promoted artifact explicitly before advertising a usable preview.
$PreviewHtml = Join-Path $BuildDirectory 'preview\preview.html'
if (-not (Test-Path -LiteralPath $PreviewHtml)) {
    throw "Preview build did not produce $PreviewHtml"
}
Write-Host "Browser preview built at $PreviewHtml"
