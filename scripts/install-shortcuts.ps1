[CmdletBinding()]
param(
    [string]$InstallDirectory,
    [switch]$EnableStartup
)

$ErrorActionPreference = 'Stop'
if ([string]::IsNullOrWhiteSpace($InstallDirectory)) { $InstallDirectory = $PSScriptRoot }
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
# WScript.Shell passes shortcut paths through the ANSI code page, so a folder name outside it
# (Chinese on an English system) fails with "Value does not fall within the expected range".
# The same CreateShortcut/Save shape is kept, backed by the Unicode IShellLinkW interface.
# <unicode-shortcut>
$unicodeShortcutSource = @'
using System;
using System.Runtime.InteropServices;
using System.Runtime.InteropServices.ComTypes;
using System.Text;
namespace QuotaDeck {
  [ComImport, Guid("00021401-0000-0000-C000-000000000046")] class ShellLinkObject {}
  [ComImport, InterfaceType(ComInterfaceType.InterfaceIsIUnknown), Guid("000214F9-0000-0000-C000-000000000046")]
  interface IShellLinkW {
    void GetPath([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder file, int size, IntPtr data, uint flags);
    void GetIDList(out IntPtr list);
    void SetIDList(IntPtr list);
    void GetDescription([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder name, int size);
    void SetDescription([MarshalAs(UnmanagedType.LPWStr)] string name);
    void GetWorkingDirectory([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder dir, int size);
    void SetWorkingDirectory([MarshalAs(UnmanagedType.LPWStr)] string dir);
    void GetArguments([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder args, int size);
    void SetArguments([MarshalAs(UnmanagedType.LPWStr)] string args);
    void GetHotkey(out short key);
    void SetHotkey(short key);
    void GetShowCmd(out int cmd);
    void SetShowCmd(int cmd);
    void GetIconLocation([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder path, int size, out int index);
    void SetIconLocation([MarshalAs(UnmanagedType.LPWStr)] string path, int index);
    void SetRelativePath([MarshalAs(UnmanagedType.LPWStr)] string path, uint reserved);
    void Resolve(IntPtr window, uint flags);
    void SetPath([MarshalAs(UnmanagedType.LPWStr)] string file);
  }
  public class Shortcut {
    public string Destination = "", TargetPath = "", Arguments = "", WorkingDirectory = "", IconLocation = "", Description = "";
    public static Shortcut Open(string destination) {
      var shortcut = new Shortcut { Destination = destination };
      if (!System.IO.File.Exists(destination)) return shortcut;
      var link = (IShellLinkW)new ShellLinkObject();
      ((IPersistFile)link).Load(destination, 0);
      var text = new StringBuilder(32768);
      link.GetPath(text, text.Capacity, IntPtr.Zero, 0); shortcut.TargetPath = text.ToString();
      text.Clear(); link.GetArguments(text, text.Capacity); shortcut.Arguments = text.ToString();
      text.Clear(); link.GetWorkingDirectory(text, text.Capacity); shortcut.WorkingDirectory = text.ToString();
      text.Clear(); link.GetDescription(text, text.Capacity); shortcut.Description = text.ToString();
      int icon; text.Clear(); link.GetIconLocation(text, text.Capacity, out icon);
      shortcut.IconLocation = text.Length > 0 ? text + "," + icon : "";
      return shortcut;
    }
    public void Save() {
      var link = (IShellLinkW)new ShellLinkObject();
      link.SetPath(TargetPath);
      link.SetArguments(Arguments ?? "");
      link.SetWorkingDirectory(WorkingDirectory ?? "");
      link.SetDescription(Description ?? "");
      if (!String.IsNullOrEmpty(IconLocation)) {
        int comma = IconLocation.LastIndexOf(','), index;
        if (comma > 0 && Int32.TryParse(IconLocation.Substring(comma + 1), out index)) link.SetIconLocation(IconLocation.Substring(0, comma), index);
        else link.SetIconLocation(IconLocation, 0);
      }
      ((IPersistFile)link).Save(Destination, true);
    }
  }
}
'@
# </unicode-shortcut>
if ($shell -is [__ComObject]) {
    if (-not ('QuotaDeck.Shortcut' -as [type])) { Add-Type -TypeDefinition $unicodeShortcutSource -Language CSharp }
    $shell = [pscustomobject]@{}
    $shell | Add-Member -MemberType ScriptMethod -Name CreateShortcut -Value { param($destination) [QuotaDeck.Shortcut]::Open($destination) }
}
$desktop = [Environment]::GetFolderPath('Desktop')
$startup = [Environment]::GetFolderPath('Startup')

$desktopShortcutPath = Join-Path $desktop 'QuotaDeck.lnk'
$startupShortcutPath = Join-Path $startup 'QuotaDeck Agent Watcher.lnk'
$stateRoot = Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'QuotaDeck'
$currentInstallPath = Join-Path $stateRoot 'current-install.json'
foreach ($target in @($desktopShortcutPath, $startupShortcutPath, $currentInstallPath)) {
    if (Test-Path -LiteralPath $target) {
        $targetItem = Get-Item -LiteralPath $target -Force
        if ($targetItem.PSIsContainer -or ($targetItem.Attributes -band [IO.FileAttributes]::ReparsePoint)) {
            throw "安装目标必须是普通文件，未进行修改：$target"
        }
    }
}
$settingsRoot = Join-Path ([Environment]::GetFolderPath('ApplicationData')) 'QuotaDeck'
$migrationSources = @()
$migrationNotes = [Collections.Generic.List[string]]::new()
if (Test-Path -LiteralPath $desktopShortcutPath -PathType Leaf) {
    try {
        $oldExecutable = [string]$shell.CreateShortcut($desktopShortcutPath).TargetPath
        if (-not [IO.Path]::IsPathRooted($oldExecutable) -or [IO.Path]::GetFileName($oldExecutable) -ne 'QuotaDeck.exe' -or -not (Test-Path -LiteralPath $oldExecutable -PathType Leaf)) {
            throw '旧快捷方式目标不明确。'
        }
        $oldDataRoot = Join-Path (Split-Path -Parent $oldExecutable) 'resources\app\data'
        foreach ($name in @('local-paths.json', 'workbuddy-usage.json')) {
            $destination = Join-Path $settingsRoot $name
            if (Test-Path -LiteralPath $destination) { $migrationNotes.Add("$name 已有稳定配置，保持不变。"); continue }
            $source = Join-Path $oldDataRoot $name
            if (-not (Test-Path -LiteralPath $source -PathType Leaf)) { continue }
            $item = Get-Item -LiteralPath $source
            $maxBytes = if ($name -eq 'local-paths.json') { 65536 } else { 1048576 }
            if ($item.Length -gt $maxBytes -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)) { $migrationNotes.Add("$name 超出安全迁移范围，未复制。"); continue }
            try {
                $bytes = [IO.File]::ReadAllBytes($source)
                if ($bytes.Length -gt $maxBytes) { throw '文件过大。' }
                $jsonText = [Text.Encoding]::UTF8.GetString($bytes).TrimStart([char]0xFEFF).Trim()
                if (-not $jsonText.StartsWith('{')) { throw '需要 JSON 对象。' }
                $parsed = $jsonText | ConvertFrom-Json
                if ($null -eq $parsed -or $parsed -isnot [pscustomobject]) { throw '需要 JSON 对象。' }
                $migrationSources += [pscustomobject]@{ Name = $name; Destination = $destination; Bytes = $bytes }
            } catch { $migrationNotes.Add("$name 不是有效 JSON 对象，未复制。"); }
        }
    } catch { $migrationNotes.Add('旧快捷方式来源不明确，未扫描其他位置；如有旧配置请手动导入。') }
}
$keepStartup = $EnableStartup -or (Test-Path -LiteralPath $startupShortcutPath)
New-Item -ItemType Directory -Path $stateRoot -Force | Out-Null
$backupRoot = Join-Path $stateRoot ('install-backups\' + [DateTime]::UtcNow.ToString('yyyyMMdd-HHmmss-fffffff'))
New-Item -ItemType Directory -Path $backupRoot -Force | Out-Null
$targets = @($desktopShortcutPath, $startupShortcutPath, $currentInstallPath)
$backups = @{}
foreach ($target in $targets) {
    if (Test-Path -LiteralPath $target -PathType Leaf) {
        $backup = Join-Path $backupRoot ([IO.Path]::GetFileName($target))
        Copy-Item -LiteralPath $target -Destination $backup
        $backups[$target] = $backup
    }
}
$changedTargets = [Collections.Generic.List[string]]::new()
try {
foreach ($migration in $migrationSources) {
    New-Item -ItemType Directory -Path $settingsRoot -Force | Out-Null
    # CreateNew prevents overwriting settings created since the earlier existence check.
    $stream = [IO.File]::Open($migration.Destination, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write)
    $changedTargets.Add($migration.Destination)
    try { $stream.Write($migration.Bytes, 0, $migration.Bytes.Length) } finally { $stream.Dispose() }
    $migrationNotes.Add("$($migration.Name) 已迁移；源文件保留。")
}
$changedTargets.Add($desktopShortcutPath)
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
if ($keepStartup) {
$changedTargets.Add($startupShortcutPath)
$startupShortcut = $shell.CreateShortcut($startupShortcutPath)
$startupShortcut.TargetPath = $pwshPath
$startupShortcut.Arguments = "-NoProfile -WindowStyle Hidden -File `"$watcherScript`""
$startupShortcut.WorkingDirectory = $resolvedInstall
$startupShortcut.IconLocation = "$quotaDeckExe,0"
$startupShortcut.Description = '检测到 AI Agent 时启动 QuotaDeck'
$startupShortcut.Save()
}
$changedTargets.Add($currentInstallPath)
$temporaryState = Join-Path $stateRoot ([Guid]::NewGuid().ToString() + '.tmp')
[ordered]@{ schemaVersion = 1; executable = $quotaDeckExe; installedAt = [DateTime]::UtcNow.ToString('o') } |
    ConvertTo-Json | Set-Content -LiteralPath $temporaryState -Encoding utf8
Move-Item -LiteralPath $temporaryState -Destination $currentInstallPath -Force
} catch {
    foreach ($target in $changedTargets) {
        if ($backups.ContainsKey($target)) { Copy-Item -LiteralPath $backups[$target] -Destination $target -Force }
        elseif (Test-Path -LiteralPath $target -PathType Leaf) { Remove-Item -LiteralPath $target }
    }
    throw
}

[pscustomobject]@{
    DesktopShortcut = $desktopShortcutPath
    StartupShortcut = if ($keepStartup) { $startupShortcutPath } else { $null }
    Executable = $quotaDeckExe
    BackupDirectory = $backupRoot
    CurrentInstall = $currentInstallPath
    ConfigurationMigration = @($migrationNotes)
    RequiresSignOutForOldWatcher = $keepStartup
    Notice = if ($keepStartup) { '旧版监听器可能仍在运行。请退出登录后重新登录以完成迁移；安装器不会终止其他 PowerShell 进程。' } else { '未启用开机监听；需要时使用 -EnableStartup。' }
}
