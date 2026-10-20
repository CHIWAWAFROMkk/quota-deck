import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import hooks from '../src/main/approval-hook-install.cjs';

function sandbox() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qd-approval-hooks-'));
  const claudeDir = path.join(dir, 'claude');
  const codexDir = path.join(dir, 'codex');
  fs.mkdirSync(claudeDir, { recursive: true });
  fs.mkdirSync(codexDir, { recursive: true });
  return { dir, claudeDir, codexDir, settings: path.join(claudeDir, 'settings.json'), codex: path.join(codexDir, 'hooks.json') };
}

const read = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const backups = (dir) => fs.readdirSync(dir).filter(name => /\.quotadeck-\d{8}T\d{6}\.bak$/.test(name));

const claudeBefore = () => ({
  theme: 'dark',
  env: { A: '1' },
  hooks: {
    PreToolUse: [{ matcher: '*', hooks: [{ type: 'command', command: 'guard.cjs' }] }],
    PermissionRequest: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'other-hook', timeout: 30 }] }],
  },
});
const codexBefore = () => ({
  version: 1,
  hooks: { PermissionRequest: [{ matcher: '*', hooks: [{ type: 'command', command: 'codex-hook' }] }] },
});

test('connect writes our hook into both files, keeping other entries and settings', () => {
  const box = sandbox();
  const claude = claudeBefore();
  const codex = codexBefore();
  fs.writeFileSync(box.settings, JSON.stringify(claude));
  fs.writeFileSync(box.codex, JSON.stringify(codex));

  const result = hooks.connect({ settingsPath: box.settings, codexPath: box.codex, nodePath: process.execPath });
  assert.deepEqual(result, { status: 'connected', claude: true, codex: true });
  assert.deepEqual(hooks.connectionState({ settingsPath: box.settings, codexPath: box.codex }), { claude: true, codex: true, codexAvailable: true });

  const afterClaude = read(box.settings);
  assert.equal(afterClaude.theme, 'dark');
  assert.deepEqual(afterClaude.env, { A: '1' });
  assert.deepEqual(afterClaude.hooks.PreToolUse, claude.hooks.PreToolUse);
  const groups = afterClaude.hooks.PermissionRequest;
  assert.equal(groups.length, 2);
  assert.deepEqual(groups[0], claude.hooks.PermissionRequest[0]);
  assert.equal(groups[1].matcher, '*');
  assert.deepEqual(groups[1].hooks, [{ type: 'command', command: process.execPath, args: [hooks.HOOK_SCRIPT, '--vendor', 'claude'], timeout: 120 }]);
  assert.equal(hooks.isOurs(groups[1].hooks[0]), true);

  const afterCodex = read(box.codex);
  assert.equal(afterCodex.version, 1);
  assert.deepEqual(afterCodex.hooks.PermissionRequest[0], codex.hooks.PermissionRequest[0]);
  const codexOurs = afterCodex.hooks.PermissionRequest.at(-1).hooks[0];
  assert.deepEqual(codexOurs.args, [hooks.HOOK_SCRIPT, '--vendor', 'codex']);
  assert.equal(codexOurs.timeout, 120);

  assert.equal(backups(box.claudeDir).length, 1);
  assert.equal(backups(box.codexDir).length, 1);
  assert.deepEqual(read(path.join(box.claudeDir, backups(box.claudeDir)[0])), claude);
  assert.deepEqual(read(path.join(box.codexDir, backups(box.codexDir)[0])), codex);
});

test('reconnect reports already-connected and never duplicates entries', () => {
  const box = sandbox();
  fs.writeFileSync(box.settings, JSON.stringify(claudeBefore()));
  fs.writeFileSync(box.codex, JSON.stringify(codexBefore()));
  hooks.connect({ settingsPath: box.settings, codexPath: box.codex, nodePath: process.execPath });

  const again = hooks.connect({ settingsPath: box.settings, codexPath: box.codex, nodePath: process.execPath });
  assert.deepEqual(again, { status: 'already-connected', claude: true, codex: true });
  assert.equal(read(box.settings).hooks.PermissionRequest.length, 2);
  assert.equal(read(box.codex).hooks.PermissionRequest.length, 2);
  assert.equal(backups(box.claudeDir).length, 1, 'no extra backup when nothing changed');
  assert.equal(backups(box.codexDir).length, 1);
});

test('disconnect removes only our entries and restores both files', () => {
  const box = sandbox();
  const claude = claudeBefore();
  const codex = codexBefore();
  fs.writeFileSync(box.settings, JSON.stringify(claude));
  fs.writeFileSync(box.codex, JSON.stringify(codex));
  hooks.connect({ settingsPath: box.settings, codexPath: box.codex, nodePath: process.execPath });

  assert.deepEqual(hooks.disconnect({ settingsPath: box.settings, codexPath: box.codex }), { status: 'disconnected' });
  assert.deepEqual(read(box.settings), claude);
  assert.deepEqual(read(box.codex), codex);
  assert.deepEqual(hooks.connectionState({ settingsPath: box.settings, codexPath: box.codex }), { claude: false, codex: false, codexAvailable: true });
});

test('disconnect drops the PermissionRequest and hooks keys it emptied', () => {
  const box = sandbox();
  fs.writeFileSync(box.settings, JSON.stringify({ theme: 'dark' }));
  fs.writeFileSync(box.codex, JSON.stringify({ version: 1 }));
  hooks.connect({ settingsPath: box.settings, codexPath: box.codex, nodePath: process.execPath });
  assert.equal(read(box.settings).hooks.PermissionRequest.length, 1);

  hooks.disconnect({ settingsPath: box.settings, codexPath: box.codex });
  assert.deepEqual(read(box.settings), { theme: 'dark' });
  assert.deepEqual(read(box.codex), { version: 1 });
});

test('connect skips codex when its directory is absent', () => {
  const box = sandbox();
  fs.writeFileSync(box.settings, JSON.stringify({ theme: 'dark' }));
  const codexPath = path.join(box.dir, 'missing-dir', 'hooks.json');

  const result = hooks.connect({ settingsPath: box.settings, codexPath, nodePath: process.execPath });
  assert.deepEqual(result, { status: 'connected', claude: true, codex: false });
  assert.equal(fs.existsSync(codexPath), false);
  assert.deepEqual(hooks.connectionState({ settingsPath: box.settings, codexPath }), { claude: true, codex: false, codexAvailable: false });
  assert.equal(read(box.settings).hooks.PermissionRequest.length, 1);
});

test('broken settings JSON throws before any file is touched', () => {
  const box = sandbox();
  fs.writeFileSync(box.settings, '{ broken');
  fs.writeFileSync(box.codex, JSON.stringify(codexBefore()));

  assert.throws(
    () => hooks.connect({ settingsPath: box.settings, codexPath: box.codex, nodePath: process.execPath }),
    /不是有效的 JSON/,
  );
  assert.equal(fs.readFileSync(box.settings, 'utf8'), '{ broken');
  assert.deepEqual(read(box.codex), codexBefore());
  assert.equal(backups(box.claudeDir).length, 0);
  assert.equal(backups(box.codexDir).length, 0);
});

test('connect refuses a missing node before touching files', () => {
  const box = sandbox();
  fs.writeFileSync(box.settings, JSON.stringify(claudeBefore()));
  fs.writeFileSync(box.codex, JSON.stringify(codexBefore()));

  assert.throws(
    () => hooks.connect({ settingsPath: box.settings, codexPath: box.codex, nodePath: path.join(box.dir, 'no-node.exe') }),
    /未找到 Node\.js/,
  );
  assert.deepEqual(read(box.settings), claudeBefore());
  assert.deepEqual(read(box.codex), codexBefore());
  assert.equal(backups(box.claudeDir).length, 0);
  assert.equal(backups(box.codexDir).length, 0);
});

test('paths honour environment overrides and isOurs recognises our command', () => {
  const saved = {
    settings: process.env.QUOTADECK_CLAUDE_SETTINGS,
    config: process.env.CLAUDE_CONFIG_DIR,
    codex: process.env.QUOTADECK_CODEX_HOOKS,
  };
  const restore = (key, value) => { if (value === undefined) delete process.env[key]; else process.env[key] = value; };
  try {
    process.env.QUOTADECK_CLAUDE_SETTINGS = path.join('C:', 'custom', 'settings.json');
    process.env.CLAUDE_CONFIG_DIR = path.join('C:', 'cfg');
    process.env.QUOTADECK_CODEX_HOOKS = path.join('C:', 'custom-hooks.json');
    assert.equal(hooks.claudeSettingsPath(), process.env.QUOTADECK_CLAUDE_SETTINGS);
    assert.equal(hooks.codexHooksPath(), process.env.QUOTADECK_CODEX_HOOKS);

    delete process.env.QUOTADECK_CLAUDE_SETTINGS;
    assert.equal(hooks.claudeSettingsPath(), path.join(process.env.CLAUDE_CONFIG_DIR, 'settings.json'));
  } finally {
    restore('QUOTADECK_CLAUDE_SETTINGS', saved.settings);
    restore('CLAUDE_CONFIG_DIR', saved.config);
    restore('QUOTADECK_CODEX_HOOKS', saved.codex);
  }

  assert.equal(path.basename(hooks.HOOK_SCRIPT), 'approval-hook.cjs');
  assert.equal(hooks.isOurs({ type: 'command', command: 'C:/x/approval-hook.cjs' }), true);
  assert.equal(hooks.isOurs({ type: 'command', command: process.execPath, args: ['x/approval-hook.cjs', '--vendor', 'claude'] }), true);
  assert.equal(hooks.isOurs({ type: 'command', command: 'other-hook' }), false);
  assert.equal(hooks.isOurs(null), false);
});
