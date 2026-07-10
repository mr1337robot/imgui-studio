[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$RepositoryRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))

# Reuse the checked-in preset so the interactive preview and deterministic capture fixture compile
# with identical dependencies and flags. The executable remains in the terminal's foreground until
# its Win32 window closes, making Ctrl+C and build/runtime failures visible to the developer.
cmake --preset native-msvc
cmake --build --preset native-msvc --target imgui_studio_native_parity
if ($LASTEXITCODE -ne 0) {
    throw 'Native interactive preview build failed.'
}

$Executable = Join-Path $RepositoryRoot 'build\native-msvc\bin\imgui_studio_native_parity.exe'
& $Executable --interactive
if ($LASTEXITCODE -ne 0) {
    throw 'Native interactive preview failed.'
}
