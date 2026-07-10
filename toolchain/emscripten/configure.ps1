[CmdletBinding()]
param(
    [string]$BuildDirectory = (Join-Path $PSScriptRoot '..\..\build\wasm-foundation')
)

$ErrorActionPreference = 'Stop'

if (-not (Get-Command emcmake -ErrorAction SilentlyContinue)) {
    throw 'emcmake is unavailable. Run toolchain/bootstrap-emscripten.ps1 and load emsdk_env.ps1.'
}

$RepositoryRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$ResolvedBuildDirectory = [System.IO.Path]::GetFullPath($BuildDirectory)
$BuildRoot = [System.IO.Path]::GetFullPath((Join-Path $RepositoryRoot 'build'))
$BuildRootPrefix = $BuildRoot.TrimEnd([System.IO.Path]::DirectorySeparatorChar) + [System.IO.Path]::DirectorySeparatorChar

if (-not $ResolvedBuildDirectory.StartsWith($BuildRootPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "BuildDirectory must remain under $BuildRoot"
}

if (-not (Get-Command nmake.exe -ErrorAction SilentlyContinue)) {
    throw 'nmake.exe is unavailable. Run from a Visual Studio 2022 developer PowerShell.'
}

& emcmake cmake -S $RepositoryRoot -B $ResolvedBuildDirectory -G 'NMake Makefiles' -DIMGUI_STUDIO_BUILD_TESTS=ON
if ($LASTEXITCODE -ne 0) {
    throw 'Emscripten CMake configuration failed.'
}

cmake --build $ResolvedBuildDirectory
if ($LASTEXITCODE -ne 0) {
    throw 'Emscripten foundation build failed.'
}

ctest --test-dir $ResolvedBuildDirectory --output-on-failure
if ($LASTEXITCODE -ne 0) {
    throw 'Emscripten foundation tests failed.'
}
