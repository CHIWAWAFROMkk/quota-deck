import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';

const root = path.resolve(import.meta.dirname, '..');
const supported = process.platform === 'win32';
function fixture({ version = '44.4.5', machine = 0x8664 } = {}) {
  const base = path.join(root, 'work', 'packaging-tests');
  fs.mkdirSync(base, { recursive: true });
  const dir = fs.mkdtempSync(path.join(base, 'case-'));
  for (const name of ['scripts', 'src/main', 'src/renderer', 'assets', 'docs', 'node_modules/electron/dist', 'work/electron-cache']) {
    fs.mkdirSync(path.join(dir, name), { recursive: true });
  }
  for (const name of ['package-portable.ps1', 'watch-agents.ps1', 'install-shortcuts.ps1', 'verify-package.ps1']) fs.copyFileSync(path.join(root, 'scripts', name), path.join(dir, 'scripts', name));
  fs.copyFileSync(path.join(root, 'docs/PORTABLE-README.md'), path.join(dir, 'docs/PORTABLE-README.md'));
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ version: '1.2.3', devDependencies: { electron: '44.4.5' } }));
  fs.writeFileSync(path.join(dir, 'package-lock.json'), JSON.stringify({ packages: { '': { name: 'quota-deck', version: '1.2.3' }, 'node_modules/electron': { version: '44.4.5' } } }));
  for (const name of ['compact.html', 'compact.css', 'compact.js']) fs.writeFileSync(path.join(dir, 'src/renderer', name), 'fixture');
  for (const name of ['LICENSE', 'README.md']) fs.writeFileSync(path.join(dir, name), 'fixture');
  fs.writeFileSync(path.join(dir, 'src/main/main.cjs'), 'fixture');
  const executable = Buffer.alloc(256);
  executable.writeUInt16LE(0x5a4d, 0);
  executable.writeUInt32LE(128, 0x3c);
  executable.writeUInt32LE(0x4550, 128);
  executable.writeUInt16LE(machine, 132);
  fs.writeFileSync(path.join(dir, 'node_modules/electron/dist/electron.exe'), executable);
  fs.writeFileSync(path.join(dir, 'node_modules/electron/dist/version'), version);
  return dir;
}
function packageFixture(dir, output = 'Product') {
  return spawnSync('pwsh', ['-NoProfile', '-NonInteractive', '-File', path.join(dir, 'scripts/package-portable.ps1'), '-OutputName', output], { encoding: 'utf8', timeout: 30000 });
}

test('packager rejects escaping and Windows reserved output names before writing', { skip: !supported }, () => {
  const dir = fixture();
  for (const name of ['../escape', '..\\escape', 'C:\\escape', 'CON', 'NUL.txt', 'trailing.']) {
    const result = packageFixture(dir, name);
    assert.notEqual(result.status, 0, name);
  }
  assert.equal(fs.existsSync(path.join(dir, 'dist')), false);
});

test('packager prefers matching installed runtime and emits verifiable manifest and license', { skip: !supported }, () => {
  const dir = fixture();
  fs.writeFileSync(path.join(dir, 'work/electron-cache/electron-v44.4.5-win32-x64.zip'), 'invalid cache must not be selected');
  const result = packageFixture(dir);
  assert.equal(result.status, 0, result.stderr);
  const output = path.join(dir, 'dist/Product');
  const manifest = JSON.parse(fs.readFileSync(path.join(output, 'manifest.json'), 'utf8').replace(/^\uFEFF/, ''));
  assert.equal(manifest.appVersion, '1.2.3');
  assert.equal(manifest.electronVersion, '44.4.5');
  assert.equal(manifest.architecture, 'x64');
  assert.ok(manifest.files.some(file => file.path === 'resources/app/LICENSE'));
  assert.ok(manifest.files.some(file => file.path === 'resources/app/README.md'));
  for (const file of ['README.md', 'install-shortcuts.ps1', 'verify-package.ps1']) assert.ok(manifest.files.some(entry => entry.path === file));
  assert.equal(fs.readFileSync(path.join(output, 'install-shortcuts.ps1')).subarray(0, 3).toString('hex'), 'efbbbf');
  for (const file of manifest.files) {
    const contents = fs.readFileSync(path.join(output, file.path));
    assert.equal(contents.length, file.bytes);
    assert.equal(crypto.createHash('sha256').update(contents).digest('hex'), file.sha256);
  }
  assert.notEqual(packageFixture(dir).status, 0, 'existing delivery must not be overwritten');
});

test('packager rejects incorrect installed version/architecture and unrelated cached versions', { skip: !supported }, () => {
  for (const options of [{ version: '40.0.0' }, { machine: 0xAA64 }]) {
    const dir = fixture(options);
    fs.writeFileSync(path.join(dir, 'work/electron-cache/electron-v99.0.0-win32-x64.zip'), 'newer is not matching');
    const result = packageFixture(dir);
    assert.notEqual(result.status, 0);
    assert.equal(fs.existsSync(path.join(dir, 'dist')), false);
  }
});

test('packager rejects lockfile disagreement', { skip: !supported }, () => {
  const dir = fixture();
  fs.writeFileSync(path.join(dir, 'package-lock.json'), JSON.stringify({ packages: { '': { name: 'quota-deck', version: '1.2.3' }, 'node_modules/electron': { version: '40.0.0' } } }));
  assert.notEqual(packageFixture(dir).status, 0);
  assert.equal(fs.existsSync(path.join(dir, 'dist')), false);
});

test('installer rollback restores both shortcuts and current installation after a save failure', { skip: !supported }, () => {
  const dir = fixture();
  for (const folder of ['desktop', 'startup', 'local/QuotaDeck', 'installed']) fs.mkdirSync(path.join(dir, folder), { recursive: true });
  for (const file of ['QuotaDeck.exe', 'watch-agents.ps1']) fs.writeFileSync(path.join(dir, 'installed', file), 'fixture');
  const originals = ['desktop/QuotaDeck.lnk', 'startup/QuotaDeck Agent Watcher.lnk', 'local/QuotaDeck/current-install.json'];
  for (const file of originals) fs.writeFileSync(path.join(dir, file), `original:${file}`);
  const literal = value => `'${value.replaceAll("'", "''")}'`;
  let script = fs.readFileSync(path.join(root, 'scripts/install-shortcuts.ps1'), 'utf8');
  for (const [name, folder] of [['Desktop', 'desktop'], ['Startup', 'startup'], ['LocalApplicationData', 'local'], ['ApplicationData', 'roaming']]) {
    script = script.replaceAll(`[Environment]::GetFolderPath('${name}')`, literal(path.join(dir, folder)));
  }
  script = script.replace('$shell = New-Object -ComObject WScript.Shell', `$shell = [pscustomobject]@{}
    $shell | Add-Member -MemberType ScriptMethod -Name CreateShortcut -Value {
      param($destination)
      $shortcut = [pscustomobject]@{ Destination = $destination; TargetPath = ''; WorkingDirectory = ''; IconLocation = ''; Description = ''; Arguments = '' }
      $shortcut | Add-Member -MemberType ScriptMethod -Name Save -Value {
        Set-Content -LiteralPath $this.Destination -Value 'partially changed' -Encoding utf8
        if ($this.Destination -like '*Agent Watcher.lnk') { throw 'fixture simulated save failure' }
      }
      return $shortcut
    }`);
  const fixtureScript = path.join(dir, 'scripts/fixture-install.ps1');
  fs.writeFileSync(fixtureScript, script);
  const result = spawnSync('pwsh', ['-NoProfile', '-NonInteractive', '-File', fixtureScript, '-InstallDirectory', path.join(dir, 'installed')], { encoding: 'utf8', timeout: 30000 });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /fixture simulated save failure/);
  for (const file of originals) assert.equal(fs.readFileSync(path.join(dir, file), 'utf8'), `original:${file}`);
  const backups = fs.readdirSync(path.join(dir, 'local/QuotaDeck/install-backups'));
  assert.equal(backups.length, 1);
  assert.equal(fs.readdirSync(path.join(dir, 'local/QuotaDeck/install-backups', backups[0])).length, 3);
});

test('installer migrates only whitelisted valid objects, preserves stable settings and rolls migration back on failure', { skip: !supported }, () => {
  for (const scenario of ['migrate', 'preserve', 'rollback']) {
    const dir = fixture();
    for (const folder of ['desktop', 'startup', 'local', 'roaming/QuotaDeck', 'installed', 'old/resources/app/data']) fs.mkdirSync(path.join(dir, folder), { recursive: true });
    fs.writeFileSync(path.join(dir, 'desktop/QuotaDeck.lnk'), 'old shortcut');
    for (const file of ['installed/QuotaDeck.exe', 'installed/watch-agents.ps1', 'old/QuotaDeck.exe']) fs.writeFileSync(path.join(dir, file), 'fixture');
    const source = path.join(dir, 'old/resources/app/data');
    fs.writeFileSync(path.join(source, 'local-paths.json'), '{"fixture":"old"}');
    fs.writeFileSync(path.join(source, 'workbuddy-usage.json'), scenario === 'preserve' ? '[]' : '{"fixture":"usage"}');
    fs.writeFileSync(path.join(source, 'secret.json'), '{"mustNotCopy":true}');
    const stable = path.join(dir, 'roaming/QuotaDeck/local-paths.json');
    if (scenario === 'preserve') fs.writeFileSync(stable, '{"fixture":"stable"}');
    const literal = value => `'${value.replaceAll("'", "''")}'`;
    let script = fs.readFileSync(path.join(root, 'scripts/install-shortcuts.ps1'), 'utf8');
    for (const [name, folder] of [['Desktop', 'desktop'], ['Startup', 'startup'], ['LocalApplicationData', 'local'], ['ApplicationData', 'roaming']]) {
      script = script.replaceAll(`[Environment]::GetFolderPath('${name}')`, literal(path.join(dir, folder)));
    }
    script = script.replace('$shell = New-Object -ComObject WScript.Shell', `$shell = [pscustomobject]@{}
      $shell | Add-Member -MemberType ScriptMethod -Name CreateShortcut -Value {
        param($destination)
        $shortcut = [pscustomobject]@{ Destination = $destination; TargetPath = ${literal(path.join(dir, 'old/QuotaDeck.exe'))}; WorkingDirectory = ''; IconLocation = ''; Description = ''; Arguments = '' }
        $shortcut | Add-Member -MemberType ScriptMethod -Name Save -Value {
          Set-Content -LiteralPath $this.Destination -Value 'new shortcut' -Encoding utf8
          ${scenario === 'rollback' ? "throw 'fixture simulated failure after migration'" : ''}
        }
        return $shortcut
      }`);
    const fixtureScript = path.join(dir, 'scripts/fixture-install.ps1');
    fs.writeFileSync(fixtureScript, script);
    const result = spawnSync('pwsh', ['-NoProfile', '-NonInteractive', '-File', fixtureScript, '-InstallDirectory', path.join(dir, 'installed')], { encoding: 'utf8', timeout: 30000 });
    if (scenario === 'rollback') {
      assert.notEqual(result.status, 0);
      assert.equal(fs.existsSync(stable), false);
      assert.equal(fs.existsSync(path.join(dir, 'roaming/QuotaDeck/workbuddy-usage.json')), false);
      assert.equal(fs.readFileSync(path.join(dir, 'desktop/QuotaDeck.lnk'), 'utf8'), 'old shortcut');
    } else {
      assert.equal(result.status, 0, result.stderr);
      assert.equal(JSON.parse(fs.readFileSync(stable, 'utf8')).fixture, scenario === 'preserve' ? 'stable' : 'old');
      assert.equal(fs.existsSync(path.join(dir, 'roaming/QuotaDeck/workbuddy-usage.json')), scenario === 'migrate');
      assert.equal(fs.existsSync(path.join(dir, 'startup/QuotaDeck Agent Watcher.lnk')), false);
    }
    assert.equal(fs.existsSync(path.join(dir, 'roaming/QuotaDeck/secret.json')), false);
    assert.equal(fs.readFileSync(path.join(source, 'local-paths.json'), 'utf8'), '{"fixture":"old"}');
  }
});

test('installer preserves opt-in startup and backs up all modified targets; watcher follows stable pointer', () => {
  const installer = fs.readFileSync(path.join(root, 'scripts/install-shortcuts.ps1'), 'utf8');
  const watcher = fs.readFileSync(path.join(root, 'scripts/watch-agents.ps1'), 'utf8');
  assert.match(installer, /\$keepStartup = \$EnableStartup -or/);
  assert.match(installer, /\$targets = @\(\$desktopShortcutPath, \$startupShortcutPath, \$currentInstallPath\)/);
  assert.match(installer, /\$backups\[\$target\]/);
  assert.match(installer, /RequiresSignOutForOldWatcher/);
  assert.doesNotMatch(installer, /Stop-Process|taskkill|Remove-Item[^\r\n]*-Recurse/i);
  assert.doesNotMatch(installer, /ExecutionPolicy\s+Bypass/i);
  assert.match(watcher, /current-install\.json/);
  assert.match(watcher, /\$launchPath = \[string\]\$current.executable/);
});

function isolatedInstaller(dir) {
  const literal = value => `'${value.replaceAll("'", "''")}'`;
  let script = fs.readFileSync(path.join(root, 'scripts/install-shortcuts.ps1'), 'utf8');
  for (const [name, folder] of [['Desktop', 'desktop'], ['Startup', 'startup'], ['LocalApplicationData', 'local'], ['ApplicationData', 'roaming']]) {
    fs.mkdirSync(path.join(dir, folder), { recursive: true });
    script = script.replaceAll(`[Environment]::GetFolderPath('${name}')`, literal(path.join(dir, folder)));
  }
  const file = path.join(dir, 'scripts/native-install.ps1');
  fs.writeFileSync(file, script);
  return file;
}

test('native Windows shortcuts support isolated install, upgrade and rollback with complex paths', { skip: !supported }, () => {
  const dir = fixture();
  const script = isolatedInstaller(dir);
  const installations = ["旧版 app's", "新版 app's"];
  for (const name of installations) {
    fs.mkdirSync(path.join(dir, name));
    for (const file of ['QuotaDeck.exe', 'watch-agents.ps1']) fs.writeFileSync(path.join(dir, name, file), 'fixture, never executed');
  }
  const shortcut = path.join(dir, 'desktop/QuotaDeck.lnk');
  const literal = value => `'${value.replaceAll("'", "''")}'`;
  const inspect = path.join(dir, 'scripts/inspect.ps1');
  // PowerShell writes stdout in the system code page (GBK on Chinese Windows); force UTF-8 so Node reads paths intact.
  fs.writeFileSync(inspect, `[Console]::OutputEncoding = [Text.Encoding]::UTF8\n$shell = New-Object -ComObject WScript.Shell\n$s = $shell.CreateShortcut(${literal(shortcut)})\n@{ target=$s.TargetPath; directory=$s.WorkingDirectory } | ConvertTo-Json`);
  const readShortcut = () => {
    const result = spawnSync('pwsh', ['-NoProfile', '-NonInteractive', '-File', inspect], { encoding: 'utf8', timeout: 10000 });
    assert.equal(result.status, 0, result.stderr);
    return JSON.parse(result.stdout);
  };
  for (const name of [installations[0], installations[1], installations[0]]) {
    const install = path.join(dir, name);
    const result = spawnSync('pwsh', ['-NoProfile', '-NonInteractive', '-File', script, '-InstallDirectory', install, '-EnableStartup'], { encoding: 'utf8', timeout: 10000 });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(readShortcut().target, path.join(install, 'QuotaDeck.exe'));
    assert.equal(readShortcut().directory, install);
    const state = JSON.parse(fs.readFileSync(path.join(dir, 'local/QuotaDeck/current-install.json'), 'utf8'));
    assert.equal(state.executable, path.join(install, 'QuotaDeck.exe'));
    assert.ok(fs.statSync(path.join(dir, 'startup/QuotaDeck Agent Watcher.lnk')).size > 0);
  }
  const backups = fs.readdirSync(path.join(dir, 'local/QuotaDeck/install-backups'));
  assert.equal(backups.length, 3);
});

test('installer refuses directories occupying shortcut or state file targets before writing', { skip: !supported }, () => {
  for (const target of ['desktop/QuotaDeck.lnk', 'local/QuotaDeck/current-install.json']) {
    const dir = fixture();
    const script = isolatedInstaller(dir);
    fs.mkdirSync(path.join(dir, 'installed'));
    for (const file of ['QuotaDeck.exe', 'watch-agents.ps1']) fs.writeFileSync(path.join(dir, 'installed', file), 'fixture');
    fs.mkdirSync(path.join(dir, target), { recursive: true });
    const result = spawnSync('pwsh', ['-NoProfile', '-NonInteractive', '-File', script, '-InstallDirectory', path.join(dir, 'installed')], { encoding: 'utf8', timeout: 10000 });
    assert.notEqual(result.status, 0, 'must not report a successful installation into a directory');
    assert.equal(fs.existsSync(path.join(dir, 'local/QuotaDeck/install-backups')), false, 'must reject before changes');
  }
});

test('portable integrity checker runs on Windows PowerShell and rejects tampering and path escape', { skip: !supported }, () => {
  const dir = fixture();
  const result = packageFixture(dir);
  assert.equal(result.status, 0, result.stderr);
  const output = path.join(dir, 'dist/Product');
  const checker = path.join(output, 'verify-package.ps1');
  const powershell = path.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe');
  // Error text is asserted in Chinese, so read it as UTF-8 instead of the console's GBK code page.
  const verify = () => spawnSync(powershell, ['-NoProfile', '-NonInteractive', '-Command', `[Console]::OutputEncoding = [Text.Encoding]::UTF8; & '${checker.replaceAll("'", "''")}'; exit $LASTEXITCODE`], { encoding: 'utf8', timeout: 15000 });
  const clean = verify();
  assert.equal(clean.status, 0, clean.stderr);
  fs.writeFileSync(path.join(output, 'src-unlisted.txt'), 'unexpected fixture');
  assert.notEqual(verify().status, 0, 'unlisted files cannot pass');
  const manifestPath = path.join(output, 'manifest.json');
  const originalManifest = fs.readFileSync(manifestPath, 'utf8');
  const manifest = JSON.parse(originalManifest.replace(/^\uFEFF/, ''));
  manifest.files[0].path = 'missing-fixture-file.txt';
  fs.writeFileSync(manifestPath, JSON.stringify(manifest));
  const missing = verify();
  assert.notEqual(missing.status, 0);
  assert.match(missing.stderr, /缺失/);
  manifest.files[0].path = '../outside.txt';
  fs.writeFileSync(manifestPath, JSON.stringify(manifest));
  const escaped = verify();
  assert.notEqual(escaped.status, 0);
  assert.match(escaped.stderr, /越界/);
  fs.writeFileSync(manifestPath, originalManifest);
  fs.writeFileSync(path.join(output, 'resources/app/src/main/main.cjs'), 'corrupted fixture');
  const corrupted = verify();
  assert.notEqual(corrupted.status, 0);
  assert.match(corrupted.stderr, /校验失败/);
});

test('installer supports Windows PowerShell and defaults to its own package directory', { skip: !supported }, () => {
  const dir = fixture();
  const script = isolatedInstaller(dir);
  fs.writeFileSync(script, '\uFEFF' + fs.readFileSync(script, 'utf8'));
  for (const file of ['QuotaDeck.exe', 'watch-agents.ps1']) fs.writeFileSync(path.join(dir, 'scripts', file), 'fixture, never executed');
  const powershell = path.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe');
  const result = spawnSync(powershell, ['-NoProfile', '-NonInteractive', '-File', script], { encoding: 'utf8', timeout: 15000 });
  assert.equal(result.status, 0, result.stderr);
  const state = JSON.parse(fs.readFileSync(path.join(dir, 'local/QuotaDeck/current-install.json'), 'utf8').replace(/^\uFEFF/, ''));
  assert.equal(state.executable, path.join(dir, 'scripts/QuotaDeck.exe'));
  assert.ok(fs.statSync(path.join(dir, 'desktop/QuotaDeck.lnk')).size > 0);
  assert.equal(fs.existsSync(path.join(dir, 'startup/QuotaDeck Agent Watcher.lnk')), false);
});

test('login watcher reads UTF-8 Chinese installation paths on Windows PowerShell', { skip: !supported }, () => {
  const dir = fixture();
  const install = path.join(dir, "安装位置 app's");
  fs.mkdirSync(install);
  const executable = path.join(install, 'QuotaDeck.exe');
  fs.writeFileSync(executable, 'fixture, never executed');
  fs.mkdirSync(path.join(dir, 'local/QuotaDeck'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'local/QuotaDeck/current-install.json'), JSON.stringify({ schemaVersion: 1, executable }));
  const literal = value => `'${value.replaceAll("'", "''")}'`;
  let script = fs.readFileSync(path.join(root, 'scripts/watch-agents.ps1'), 'utf8');
  script = script.replace("[Environment]::GetFolderPath('LocalApplicationData')", literal(path.join(dir, 'local')));
  script = script.replace('while ($true)', 'for ($fixtureAttempt = 0; $fixtureAttempt -lt 1; $fixtureAttempt++)');
  script = script.replace('@(Get-Process -ErrorAction SilentlyContinue | Select-Object -ExpandProperty ProcessName)', "@('Codex')");
  script = script.replaceAll('Start-Sleep -Seconds $PollSeconds', '');
  const capture = path.join(dir, 'launch.json');
  const mock = `function Start-Process { param($FilePath, $WorkingDirectory, $WindowStyle) @{ executable=$FilePath; directory=$WorkingDirectory; style=$WindowStyle } | ConvertTo-Json | Set-Content -LiteralPath ${literal(capture)} -Encoding UTF8 }\n`;
  script = script.replace("$ErrorActionPreference = 'Stop'", mock + "$ErrorActionPreference = 'Stop'");
  const file = path.join(dir, 'scripts/watcher-fixture.ps1');
  fs.writeFileSync(file, '\uFEFF' + script);
  const powershell = path.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe');
  const result = spawnSync(powershell, ['-NoProfile', '-NonInteractive', '-File', file], { encoding: 'utf8', timeout: 10000 });
  assert.equal(result.status, 0, result.stderr);
  assert.ok(fs.existsSync(capture), result.stdout);
  const launched = JSON.parse(fs.readFileSync(capture, 'utf8').replace(/^\uFEFF/, ''));
  assert.equal(launched.executable, executable);
  assert.equal(launched.directory, install);
  assert.equal(launched.style, 'Hidden');
});
