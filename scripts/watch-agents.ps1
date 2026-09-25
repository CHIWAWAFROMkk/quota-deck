[CmdletBinding()]
param(
    [string]$QuotaDeckPath,
    [ValidateRange(1, 60)][int]$PollSeconds = 3
)

$ErrorActionPreference = 'Stop'
if ([string]::IsNullOrWhiteSpace($QuotaDeckPath)) {
    $QuotaDeckPath = Join-Path $PSScriptRoot 'QuotaDeck.exe'
}
$agentNames = @('Codex', 'Claude', 'Antigravity', 'WorkBuddy', 'CodeBuddy', 'agy')
$wasAgentOpen = $false
$currentInstallPath = Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'QuotaDeck\current-install.json'

while ($true) {
    $runningNames = @(Get-Process -ErrorAction SilentlyContinue | Select-Object -ExpandProperty ProcessName)
    $agentOpen = $false
    foreach ($agentName in $agentNames) {
        if ($runningNames -contains $agentName) {
            $agentOpen = $true
            break
        }
    }

    if ($agentOpen -and -not $wasAgentOpen -and -not ($runningNames -contains 'QuotaDeck')) {
        try {
            $launchPath = $QuotaDeckPath
            if (Test-Path -LiteralPath $currentInstallPath) {
                $current = Get-Content -LiteralPath $currentInstallPath -Raw -Encoding UTF8 | ConvertFrom-Json
                $launchPath = [string]$current.executable
                if ($current.schemaVersion -ne 1 -or -not [IO.Path]::IsPathRooted($launchPath) -or [IO.Path]::GetFileName($launchPath) -ne 'QuotaDeck.exe') { throw '安装记录无效。' }
            }
            if (-not (Test-Path -LiteralPath $launchPath -PathType Leaf)) { throw '当前安装不可用。' }
            Start-Process -FilePath $launchPath -WorkingDirectory (Split-Path -Parent $launchPath) -WindowStyle Hidden
        } catch {
            # Do not revive an older binary when the current installation is invalid.
            Write-Warning 'QuotaDeck 启动失败；请检查当前安装记录。'
            Start-Sleep -Seconds $PollSeconds
            continue
        }
    }

    $wasAgentOpen = $agentOpen
    Start-Sleep -Seconds $PollSeconds
}
