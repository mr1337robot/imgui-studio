[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$BuildDirectory,
    [Parameter(Mandatory = $true)]
    [string]$StarterSourceDirectory
)

$ErrorActionPreference = 'Stop'
$RepositoryRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$ResolvedBuildDirectory = [System.IO.Path]::GetFullPath($BuildDirectory)
$ResolvedStarterSourceDirectory = [System.IO.Path]::GetFullPath($StarterSourceDirectory)
$BuildRoot = [System.IO.Path]::GetFullPath((Join-Path $RepositoryRoot 'build'))
$BuildRootPrefix = $BuildRoot.TrimEnd([System.IO.Path]::DirectorySeparatorChar) + [System.IO.Path]::DirectorySeparatorChar
$RepositoryRootPrefix = $RepositoryRoot.TrimEnd([System.IO.Path]::DirectorySeparatorChar) + [System.IO.Path]::DirectorySeparatorChar

# Both paths are service-selected, but confinement here prevents a future caller from turning this
# low-level wrapper into an arbitrary CMake build primitive.
if (-not $ResolvedBuildDirectory.StartsWith($BuildRootPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "BuildDirectory must remain under $BuildRoot"
}
if (-not $ResolvedStarterSourceDirectory.StartsWith($RepositoryRootPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "StarterSourceDirectory must remain under $RepositoryRoot"
}
if (-not (Get-Command emcmake -ErrorAction SilentlyContinue)) {
    throw 'emcmake is unavailable. Load the pinned emsdk environment before starting Studio.'
}
if (-not (Get-Command nmake.exe -ErrorAction SilentlyContinue)) {
    throw 'nmake.exe is unavailable. Start Studio from a Visual Studio developer PowerShell.'
}

# The project input directory is stable across revisions. Configure only once; subsequent edits let
# CMake dependency tracking rebuild the changed project translation unit and relink the preview while
# preserving Dear ImGui/backend objects.
$CachePath = Join-Path $ResolvedBuildDirectory 'CMakeCache.txt'
if (-not (Test-Path -LiteralPath $CachePath)) {
    $ConfigureTimer = [System.Diagnostics.Stopwatch]::StartNew()
    & emcmake cmake -S $RepositoryRoot -B $ResolvedBuildDirectory -G 'NMake Makefiles' -DIMGUI_STUDIO_BUILD_TESTS=OFF "-DIMGUI_STUDIO_STARTER_SOURCE_DIR=$ResolvedStarterSourceDirectory"
    $ConfigureTimer.Stop()
    Write-Output "[STUDIO_PHASE] configureMs=$($ConfigureTimer.Elapsed.TotalMilliseconds)"
    if ($LASTEXITCODE -ne 0) {
        throw 'Emscripten service CMake configuration failed.'
    }
}

$CompileTimer = [System.Diagnostics.Stopwatch]::StartNew()
cmake --build $ResolvedBuildDirectory --target imgui_studio_starter
$CompileTimer.Stop()
Write-Output "[STUDIO_PHASE] compileMs=$($CompileTimer.Elapsed.TotalMilliseconds)"
if ($LASTEXITCODE -ne 0) {
    throw 'Emscripten project compilation failed.'
}

$LinkTimer = [System.Diagnostics.Stopwatch]::StartNew()
cmake --build $ResolvedBuildDirectory --target imgui_studio_browser_preview
$LinkTimer.Stop()
Write-Output "[STUDIO_PHASE] linkMs=$($LinkTimer.Elapsed.TotalMilliseconds)"
if ($LASTEXITCODE -ne 0) {
    throw 'Emscripten preview link failed.'
}
