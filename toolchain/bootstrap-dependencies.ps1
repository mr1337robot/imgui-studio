[CmdletBinding()]
param(
    [string]$InstallRoot = (Join-Path $PSScriptRoot '..\.tools\dependencies')
)

$ErrorActionPreference = 'Stop'
$ExpectedCommit = '5d4126876bc10396d4c6511853ff10964414c776'
$ResolvedInstallRoot = [System.IO.Path]::GetFullPath($InstallRoot)
$RepositoryRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$ToolsRoot = [System.IO.Path]::GetFullPath((Join-Path $RepositoryRoot '.tools'))
$ToolsRootPrefix = $ToolsRoot.TrimEnd([System.IO.Path]::DirectorySeparatorChar) + [System.IO.Path]::DirectorySeparatorChar

if (-not $ResolvedInstallRoot.StartsWith($ToolsRootPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "InstallRoot must remain under $ToolsRoot"
}

$DearImGuiRoot = Join-Path $ResolvedInstallRoot 'dear-imgui'
if (-not (Test-Path -LiteralPath $DearImGuiRoot)) {
    New-Item -ItemType Directory -Path $ResolvedInstallRoot -Force | Out-Null
    git clone https://github.com/ocornut/imgui.git $DearImGuiRoot
}

Push-Location $DearImGuiRoot
try {
    git fetch --tags --force
    git checkout --detach $ExpectedCommit
    $ActualCommit = (git rev-parse HEAD).Trim()
    if ($ActualCommit -ne $ExpectedCommit) {
        throw "Dear ImGui checkout mismatch: expected $ExpectedCommit, received $ActualCommit"
    }
}
finally {
    Pop-Location
}

Write-Host "Dear ImGui 1.92.1 verified at $DearImGuiRoot"
