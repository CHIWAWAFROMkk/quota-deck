import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import chain from '../src/main/claude-statusline-chain.cjs';

function sandbox() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qd-chain-'));
  return { dir, settings: path.join(dir, 'settings.json'), file: path.join(dir, 'chain.json') };
}
const read = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));

test('connect keeps the previous statusline downstream and restores it exactly on disconnect', () => {
  const box = sandbox();
  const previous = { type: 'command', command: 'bash-hud --flag', refreshInterval: 5, padding: 1 };
  fs.writeFileSync(box.settings, JSON.stringify({ theme: 'dark', statusLine: previous }));

  const result = chain.connect({ settingsPath: box.settings, file: box.file, nodePath: process.execPath, bash: 'D:\\Git\\bin\\bash.exe' });
  assert.equal(result.status, 'connected');
  const settings = read(box.settings);
  assert.equal(settings.theme, 'dark');
  assert.equal(settings.statusLine.refreshInterval, 5);
  assert.equal(settings.statusLine.padding, 1);
  const forward = (file) => file.replace(/\\/g, '/');
  assert.equal(settings.statusLine.command, `"${forward(process.execPath)}" "${forward(chain.teePath)}"`);
  assert.deepEqual(chain.readChain(box.file), { version: 1, downstream: 'bash-hud --flag', shell: 'D:\\Git\\bin\\bash.exe', previous });
  assert.equal(fs.readdirSync(box.dir).filter(name => name.includes('.quotadeck-')).length, 1, 'settings backup written');
  assert.equal(chain.connectionState({ settingsPath: box.settings }).connected, true);

  assert.equal(chain.connect({ settingsPath: box.settings, file: box.file }).status, 'already-connected');
  assert.equal(chain.readChain(box.file).downstream, 'bash-hud --flag', 'reconnect never chains QuotaDeck to itself');

  assert.equal(chain.disconnect({ settingsPath: box.settings, file: box.file }).restored, true);
  assert.deepEqual(read(box.settings).statusLine, previous);
  assert.equal(fs.existsSync(box.file), false);
});

test('without a previous statusline, disconnect removes the key it added', () => {
  const box = sandbox();
  fs.writeFileSync(box.settings, JSON.stringify({ env: { A: '1' } }));
  chain.connect({ settingsPath: box.settings, file: box.file, nodePath: process.execPath, bash: null });
  assert.equal(chain.readChain(box.file).downstream, null);
  chain.disconnect({ settingsPath: box.settings, file: box.file });
  assert.deepEqual(read(box.settings), { env: { A: '1' } });
});

test('connect refuses when node is missing, before touching any file', () => {
  const box = sandbox();
  const original = JSON.stringify({ statusLine: { type: 'command', command: 'hud' } });
  fs.writeFileSync(box.settings, original);
  assert.throws(() => chain.connect({ settingsPath: box.settings, file: box.file, nodePath: path.join(box.dir, 'no-node.exe') }), /未找到 Node\.js/);
  assert.equal(fs.readFileSync(box.settings, 'utf8'), original);
  assert.equal(fs.existsSync(box.file), false);
  assert.equal(fs.readdirSync(box.dir).some(name => name.includes('.quotadeck-')), false);
});

test('invalid settings JSON is reported and left untouched', () => {
  const box = sandbox();
  fs.writeFileSync(box.settings, '{ broken');
  assert.throws(() => chain.connect({ settingsPath: box.settings, file: box.file }), /不是有效的 JSON/);
  assert.equal(fs.readFileSync(box.settings, 'utf8'), '{ broken');
  assert.equal(fs.existsSync(box.file), false);
});

test('tee saves sanitized quota and passes identical stdin through the previous statusline', () => {
  const box = sandbox();
  const hud = path.join(box.dir, 'hud.cjs');
  fs.writeFileSync(hud, "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>process.stdout.write('HUD:'+JSON.parse(s).model.id))");
  const snapshot = path.join(box.dir, 'claude-usage.json');
  fs.writeFileSync(box.file, JSON.stringify({ version: 1, downstream: `"${process.execPath}" "${hud}"`, shell: null }));
  const payload = { session_id: 'secret-session', cwd: 'C:\\private\\project', model: { id: 'claude-test', display_name: 'Test' }, rate_limits: { five_hour: { used_percentage: 20, resets_at: Date.now() / 1000 + 3600 } } };
  const run = spawnSync(process.execPath, [chain.teePath], {
    input: JSON.stringify(payload), encoding: 'utf8', timeout: 15000,
    env: { ...process.env, QUOTADECK_CLAUDE_CHAIN: box.file, QUOTADECK_CLAUDE_SNAPSHOT: snapshot },
  });
  assert.equal(run.status, 0, run.stderr);
  assert.equal(run.stdout, 'HUD:claude-test');
  const saved = read(snapshot);
  assert.equal(saved.rate_limits.five_hour.used_percentage, 20);
  assert.equal(JSON.stringify(saved).includes('private'), false, 'raw paths are never persisted');
  assert.equal(JSON.stringify(saved).includes('secret-session'), false);
});

test('tee prints its own line when there was no previous statusline', () => {
  const box = sandbox();
  const run = spawnSync(process.execPath, [chain.teePath], {
    input: JSON.stringify({ model: { id: 'm' }, rate_limits: { seven_day: { used_percentage: 96 } } }), encoding: 'utf8', timeout: 15000,
    env: { ...process.env, QUOTADECK_CLAUDE_CHAIN: box.file, QUOTADECK_CLAUDE_SNAPSHOT: path.join(box.dir, 'usage.json') },
  });
  assert.equal(run.status, 0, run.stderr);
  assert.equal(run.stdout, 'Claude 额度 · 每周 剩 4%');
});

test('bash lookup never returns the WSL launcher', () => {
  const found = chain.findBash();
  if (found) assert.doesNotMatch(found, /\\(System32|WindowsApps)\\/i);
});
