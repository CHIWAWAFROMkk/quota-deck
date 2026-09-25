[CmdletBinding()]
param(
    [string]$OutputName = 'QuotaDeck',
    [ValidateSet('x64', 'arm64')][string]$Architecture = 'x64'
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
if ($OutputName -notmatch '^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$' -or $OutputName.EndsWith('.') -or $OutputName -match '^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(\.|$)') {
    throw 'OutputName 必须是单个安全目录名，不允许路径或 Windows 保留名称。'
}
$projectPackage = Get-Content -LiteralPath (Join-Path $projectRoot 'package.json') -Raw | ConvertFrom-Json
$runtimeVersion = [string]$projectPackage.devDependencies.electron
if ($runtimeVersion -notmatch '^\d+\.\d+\.\d+$') { throw 'Electron 必须锁定精确版本。' }
$lock = Get-Content -LiteralPath (Join-Path $projectRoot 'package-lock.json') -Raw | ConvertFrom-Json -AsHashtable
if ($lock.packages.'node_modules/electron'.version -ne $runtimeVersion) { throw 'Electron 锁文件版本与 package.json 不一致。' }
function Test-Runtime([string]$RuntimeRoot) {
    try {
        if ((Get-Content -LiteralPath (Join-Path $RuntimeRoot 'version') -Raw).Trim().TrimStart('v') -ne $runtimeVersion) { return $false }
        $stream = [IO.File]::OpenRead((Join-Path $RuntimeRoot 'electron.exe'))
        try {
            $reader = [IO.BinaryReader]::new($stream)
            if ($reader.ReadUInt16() -ne 0x5A4D) { return $false }
            $stream.Position = 0x3C
            $peOffset = $reader.ReadInt32()
            $stream.Position = $peOffset
            if ($reader.ReadUInt32() -ne 0x4550) { return $false }
            $expectedMachine = if ($Architecture -eq 'x64') { 0x8664 } else { 0xAA64 }
            return $reader.ReadUInt16() -eq $expectedMachine
        } finally { $stream.Dispose() }
    } catch { return $false }
}
$cacheRoot = Join-Path $projectRoot 'work\electron-cache'
$packageRoot = Join-Path $projectRoot (Join-Path 'dist' $OutputName)
$appRoot = Join-Path $packageRoot 'resources\app'
$zip = Get-ChildItem -LiteralPath $cacheRoot -Recurse -File -Filter "electron-v$runtimeVersion-win32-$Architecture.zip" -ErrorAction SilentlyContinue |
    Sort-Object FullName |
    Select-Object -First 1

$installedRuntime = Join-Path $projectRoot 'node_modules\electron\dist'
$installedMatches = Test-Runtime $installedRuntime
if (-not $zip -and -not $installedMatches) {
    throw '未找到 Electron Windows 运行包。请先运行项目依赖安装。'
}
if (Test-Path -LiteralPath $packageRoot) {
    throw "目标已存在，为避免覆盖已停止：$packageRoot"
}

New-Item -ItemType Directory -Path $packageRoot -Force | Out-Null
if ($installedMatches) {
    Get-ChildItem -LiteralPath $installedRuntime | Copy-Item -Destination $packageRoot -Recurse
} else {
    Expand-Archive -LiteralPath $zip.FullName -DestinationPath $packageRoot
}
if (-not (Test-Runtime $packageRoot)) { throw '运行时版本或架构不匹配，打包已中止；保留目录供检查。' }
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
Copy-Item -LiteralPath (Join-Path $projectRoot 'docs') -Destination $appRoot -Recurse
# Windows PowerShell 5.1 needs a BOM to read Chinese messages correctly.
foreach ($helper in @('watch-agents.ps1', 'install-shortcuts.ps1', 'verify-package.ps1')) {
    Get-Content -LiteralPath (Join-Path $PSScriptRoot $helper) -Raw -Encoding utf8 |
        Set-Content -LiteralPath (Join-Path $packageRoot $helper) -Encoding utf8BOM
}
Copy-Item -LiteralPath (Join-Path $projectRoot 'docs\PORTABLE-README.md') -Destination (Join-Path $packageRoot 'README.md')
foreach ($document in @('LICENSE', 'README.md')) {
    Copy-Item -LiteralPath (Join-Path $projectRoot $document) -Destination $appRoot
}
$files = @(Get-ChildItem -LiteralPath $packageRoot -Recurse -File | Sort-Object FullName | ForEach-Object {
    [ordered]@{ path = [IO.Path]::GetRelativePath($packageRoot, $_.FullName).Replace('\', '/'); sha256 = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant(); bytes = $_.Length }
})
[ordered]@{ schemaVersion = 1; appVersion = $projectPackage.version; electronVersion = $runtimeVersion; architecture = $Architecture; files = $files } |
    ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $packageRoot 'manifest.json') -Encoding utf8

Write-Output (Join-Path $packageRoot 'QuotaDeck.exe')
