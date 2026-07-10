[CmdletBinding()]
param(
    [string]$Output = (Join-Path $PSScriptRoot '..\out\captures\native.png'),
    [string]$Metadata = (Join-Path $PSScriptRoot '..\out\captures\native.metadata.json'),
    [float]$LayoutOffsetXPx = 0
)

$ErrorActionPreference = 'Stop'
$RepositoryRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$OutputPath = [System.IO.Path]::GetFullPath($Output)
$MetadataPath = [System.IO.Path]::GetFullPath($Metadata)
$OutRoot = [System.IO.Path]::GetFullPath((Join-Path $RepositoryRoot 'out'))
$OutRootPrefix = $OutRoot.TrimEnd([System.IO.Path]::DirectorySeparatorChar) + [System.IO.Path]::DirectorySeparatorChar

# Resolve before comparing and require the directory separator in the prefix. Without the separator,
# a sibling such as `output-backup` would incorrectly appear to be inside `out` by string prefix.
foreach ($Path in @($OutputPath, $MetadataPath)) {
    if (-not $Path.StartsWith($OutRootPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "Capture output must remain under $OutRoot"
    }
}

# Build through the checked-in preset so manual captures use the same compiler, flags, and dependency
# graph as CTest and CI. PowerShell passes arguments as an array; no user path is shell-interpolated.
cmake --preset native-msvc
cmake --build --preset native-msvc --target imgui_studio_native_parity
if ($LASTEXITCODE -ne 0) {
    throw 'Native parity build failed.'
}

$Executable = Join-Path $RepositoryRoot 'build\native-msvc\bin\imgui_studio_native_parity.exe'
& $Executable --output $OutputPath --metadata $MetadataPath --layout-offset-x $LayoutOffsetXPx
if ($LASTEXITCODE -ne 0) {
    throw 'Native parity capture failed.'
}
