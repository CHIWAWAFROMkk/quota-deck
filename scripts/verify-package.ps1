[CmdletBinding()]
param([string]$PackageDirectory)

$ErrorActionPreference = 'Stop'
if ([string]::IsNullOrWhiteSpace($PackageDirectory)) { $PackageDirectory = $PSScriptRoot }
$packageRoot = (Resolve-Path -LiteralPath $PackageDirectory).Path
$prefix = $packageRoot.TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
$manifestPath = Join-Path $packageRoot 'manifest.json'
if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) { throw '文件清单缺失。' }
if ((Get-Item -LiteralPath $manifestPath).Length -gt 4194304) { throw '文件清单过大。' }
$manifest = Get-Content -LiteralPath $manifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
if ($manifest.schemaVersion -ne 1 -or -not $manifest.files -or $manifest.files.Count -gt 10000) { throw '文件清单格式不支持。' }
$seen = @{}
function Get-PackageHash([string]$File) {
    $algorithm = [Security.Cryptography.SHA256]::Create()
    $stream = [IO.File]::OpenRead($File)
    try { return [BitConverter]::ToString($algorithm.ComputeHash($stream)).Replace('-', '').ToLowerInvariant() }
    finally { $stream.Dispose(); $algorithm.Dispose() }
}
foreach ($entry in $manifest.files) {
    if ($entry.path -isnot [string] -or [string]::IsNullOrWhiteSpace($entry.path) -or [IO.Path]::IsPathRooted($entry.path) -or $entry.sha256 -notmatch '^[0-9a-fA-F]{64}$') { throw '清单包含无效条目。' }
    $file = [IO.Path]::GetFullPath((Join-Path $packageRoot $entry.path))
    if (-not $file.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase) -or $seen.ContainsKey($file)) { throw '清单路径越界或重复。' }
    $seen[$file] = $true
    if (-not (Test-Path -LiteralPath $file -PathType Leaf)) { throw "文件缺失：$($entry.path)" }
    $cursor = $file
    while ($cursor.Length -ge $packageRoot.Length) {
        if ((Get-Item -LiteralPath $cursor -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw '包内不能使用重解析链接。' }
        if ($cursor -eq $packageRoot) { break }
        $cursor = Split-Path -Parent $cursor
    }
    $item = Get-Item -LiteralPath $file
    if ($item.Length -ne $entry.bytes -or (Get-PackageHash $file) -ne $entry.sha256) { throw "文件校验失败：$($entry.path)" }
}
$extra = @(Get-ChildItem -LiteralPath $packageRoot -Recurse -File -Force | Where-Object { $_.FullName -ne $manifestPath -and -not $seen.ContainsKey($_.FullName) })
if ($extra.Count -gt 0) { throw '包内存在未列入清单的文件，请使用干净副本。' }
[pscustomobject]@{ Status = 'Verified'; Version = $manifest.appVersion; Files = $seen.Count; Note = '完整性通过；此检查不证明发布者身份。' }
