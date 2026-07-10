[CmdletBinding()]
param(
    [string]$BuildDirectory = (Join-Path $PSScriptRoot '..\..\build\wasm-foundation'),
    [string]$StarterSourceDirectory = (Join-Path $PSScriptRoot '..\..\examples\starter')
)

$ErrorActionPreference = 'Stop'

if (-not (Get-Command emcmake -ErrorAction SilentlyContinue)) {
    throw 'emcmake is unavailable. Run toolchain/bootstrap-emscripten.ps1 and load emsdk_env.ps1.'
}

$RepositoryRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$ResolvedBuildDirectory = [System.IO.Path]::GetFullPath($BuildDirectory)
$ResolvedStarterSourceDirectory = [System.IO.Path]::GetFullPath($StarterSourceDirectory)
$BuildRoot = [System.IO.Path]::GetFullPath((Join-Path $RepositoryRoot 'build'))
$BuildRootPrefix = $BuildRoot.TrimEnd([System.IO.Path]::DirectorySeparatorChar) + [System.IO.Path]::DirectorySeparatorChar

if (-not $ResolvedBuildDirectory.StartsWith($BuildRootPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "BuildDirectory must remain under $BuildRoot"
}

$RepositoryRootPrefix = $RepositoryRoot.TrimEnd([System.IO.Path]::DirectorySeparatorChar) + [System.IO.Path]::DirectorySeparatorChar
if (-not $ResolvedStarterSourceDirectory.StartsWith($RepositoryRootPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "StarterSourceDirectory must remain under $RepositoryRoot"
}

if (-not (Get-Command nmake.exe -ErrorAction SilentlyContinue)) {
    throw 'nmake.exe is unavailable. Run from a Visual Studio 2022 developer PowerShell.'
}

& emcmake cmake -S $RepositoryRoot -B $ResolvedBuildDirectory -G 'NMake Makefiles' -DIMGUI_STUDIO_BUILD_TESTS=ON "-DIMGUI_STUDIO_STARTER_SOURCE_DIR=$ResolvedStarterSourceDirectory"
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
