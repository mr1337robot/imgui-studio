[CmdletBinding()]
param(
    [string]$InstallRoot = (Join-Path $PSScriptRoot '..\.tools\emsdk')
)

$ErrorActionPreference = 'Stop'
$ExpectedCommit = '62a853cd3b3134398ce85cde8bb5cbb2ef0194cb'
$ExpectedVersion = '4.0.10'
$ResolvedInstallRoot = [System.IO.Path]::GetFullPath($InstallRoot)
$RepositoryRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$ToolsRoot = [System.IO.Path]::GetFullPath((Join-Path $RepositoryRoot '.tools'))
$ToolsRootPrefix = $ToolsRoot.TrimEnd([System.IO.Path]::DirectorySeparatorChar) + [System.IO.Path]::DirectorySeparatorChar

if (-not $ResolvedInstallRoot.StartsWith($ToolsRootPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "InstallRoot must remain under $ToolsRoot"
}

if (-not (Test-Path -LiteralPath $ResolvedInstallRoot)) {
    New-Item -ItemType Directory -Path (Split-Path $ResolvedInstallRoot) -Force | Out-Null
    git clone https://github.com/emscripten-core/emsdk.git $ResolvedInstallRoot
}

Push-Location $ResolvedInstallRoot
try {
    git fetch --tags --force
    git checkout --detach $ExpectedCommit
    $ActualCommit = (git rev-parse HEAD).Trim()
    if ($ActualCommit -ne $ExpectedCommit) {
        throw "emsdk checkout mismatch: expected $ExpectedCommit, received $ActualCommit"
    }

    & .\emsdk.ps1 install $ExpectedVersion
    & .\emsdk.ps1 activate $ExpectedVersion
    if ($LASTEXITCODE -ne 0) {
        throw "Failed to install or activate Emscripten $ExpectedVersion"
    }
}
finally {
    Pop-Location
}

Write-Host "Emscripten $ExpectedVersion installed at $ResolvedInstallRoot"
Write-Host "Load it in the current shell with: . '$ResolvedInstallRoot\emsdk_env.ps1'"
