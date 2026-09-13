[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [string]$InstallDirectory
)

$ErrorActionPreference = 'Stop'
$resolvedInstall = (Resolve-Path -LiteralPath $InstallDirectory).Path
$quotaDeckExe = Join-Path $resolvedInstall 'QuotaDeck.exe'
$watcherScript = Join-Path $resolvedInstall 'watch-agents.ps1'
if (-not (Test-Path -LiteralPath $quotaDeckExe -PathType Leaf)) {
    throw "未找到软件主程序：$quotaDeckExe"
}
if (-not (Test-Path -LiteralPath $watcherScript -PathType Leaf)) {
    throw "未找到 Agent 监听器：$watcherScript"
}

$shell = New-Object -ComObject WScript.Shell
$desktop = [Environment]::GetFolderPath('Desktop')
$startup = [Environment]::GetFolderPath('Startup')

$desktopShortcutPath = Join-Path $desktop 'QuotaDeck.lnk'
$desktopShortcut = $shell.CreateShortcut($desktopShortcutPath)
$desktopShortcut.TargetPath = $quotaDeckExe
$desktopShortcut.WorkingDirectory = $resolvedInstall
$desktopShortcut.IconLocation = "$quotaDeckExe,0"
$desktopShortcut.Description = 'QuotaDeck AI 额度显示器'
$desktopShortcut.Save()

$stablePowerShell = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
$pwshPath = if (Test-Path -LiteralPath $stablePowerShell) {
    $stablePowerShell
} else {
    (Get-Command pwsh -ErrorAction Stop).Source
}
$startupShortcutPath = Join-Path $startup 'QuotaDeck Agent Watcher.lnk'
$startupShortcut = $shell.CreateShortcut($startupShortcutPath)
$startupShortcut.TargetPath = $pwshPath
$startupShortcut.Arguments = "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$watcherScript`""
$startupShortcut.WorkingDirectory = $resolvedInstall
$startupShortcut.IconLocation = "$quotaDeckExe,0"
$startupShortcut.Description = '检测到 AI Agent 时启动 QuotaDeck'
$startupShortcut.Save()

[pscustomobject]@{
    DesktopShortcut = $desktopShortcutPath
    StartupShortcut = $startupShortcutPath
    Executable = $quotaDeckExe
}
