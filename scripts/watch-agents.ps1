[CmdletBinding()]
param(
    [string]$QuotaDeckPath,
    [int]$PollSeconds = 3
)

$ErrorActionPreference = 'Stop'
if ([string]::IsNullOrWhiteSpace($QuotaDeckPath)) {
    $QuotaDeckPath = Join-Path $PSScriptRoot 'QuotaDeck.exe'
}
$agentNames = @('Codex', 'Antigravity', 'WorkBuddy', 'CodeBuddy', 'agy')
$wasAgentOpen = $false

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
        Start-Process -FilePath $QuotaDeckPath -WindowStyle Hidden
    }

    $wasAgentOpen = $agentOpen
    Start-Sleep -Seconds $PollSeconds
}
