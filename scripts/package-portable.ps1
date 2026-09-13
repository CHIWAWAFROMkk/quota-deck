[CmdletBinding()]
param(
    [string]$OutputName = 'QuotaDeck'
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$cacheRoot = Join-Path $projectRoot 'work\electron-cache'
$packageRoot = Join-Path $projectRoot (Join-Path 'dist' $OutputName)
$appRoot = Join-Path $packageRoot 'resources\app'
$zip = Get-ChildItem -LiteralPath $cacheRoot -Recurse -File -Filter 'electron-*-win32-x64.zip' -ErrorAction SilentlyContinue |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 1

$installedRuntime = Join-Path $projectRoot 'node_modules\electron\dist'
if (-not $zip -and -not (Test-Path -LiteralPath (Join-Path $installedRuntime 'electron.exe'))) {
    throw '未找到 Electron Windows 运行包。请先运行项目依赖安装。'
}
if (Test-Path -LiteralPath $packageRoot) {
    throw "目标已存在，为避免覆盖已停止：$packageRoot"
}

New-Item -ItemType Directory -Path $packageRoot -Force | Out-Null
if ($zip) {
    Expand-Archive -LiteralPath $zip.FullName -DestinationPath $packageRoot
} else {
    Get-ChildItem -LiteralPath $installedRuntime | Copy-Item -Destination $packageRoot -Recurse
}
Rename-Item -LiteralPath (Join-Path $packageRoot 'electron.exe') -NewName 'QuotaDeck.exe'
New-Item -ItemType Directory -Path $appRoot -Force | Out-Null

$sourceRoot = Join-Path $appRoot 'src'
$rendererRoot = Join-Path $sourceRoot 'renderer'
New-Item -ItemType Directory -Path $sourceRoot -Force | Out-Null
Copy-Item -LiteralPath (Join-Path $projectRoot 'src\main') -Destination $sourceRoot -Recurse
New-Item -ItemType Directory -Path $rendererRoot -Force | Out-Null
foreach ($rendererFile in @('compact.html', 'compact.css', 'compact.js')) {
    Copy-Item -LiteralPath (Join-Path $projectRoot (Join-Path 'src\renderer' $rendererFile)) -Destination $rendererRoot
}
Copy-Item -LiteralPath (Join-Path $projectRoot 'assets') -Destination $appRoot -Recurse
Copy-Item -LiteralPath (Join-Path $projectRoot 'package.json') -Destination $appRoot
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'watch-agents.ps1') -Destination $packageRoot

Write-Output (Join-Path $packageRoot 'QuotaDeck.exe')
