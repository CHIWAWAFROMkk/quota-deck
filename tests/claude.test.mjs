import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import claude from '../src/main/claude-client.cjs';
import bridge from '../src/main/claude-statusline-bridge.cjs';
import snapshots from '../src/main/snapshot.cjs';

const now = Date.parse('2026-09-25T00:00:00Z');
const payload = { session_id: 'private-session', workspace: '/private/path', token: 'not-for-storage', model: { id: 'claude-observed', display_name: 'Observed' }, rate_limits: { five_hour: { used_percentage: 5, resets_at: now / 1000 + 3600 }, seven_day: { used_percentage: 100, resets_at: now / 1000 + 86400 } } };

test('Claude stores a minimal whitelist, never raw paths, credentials or session ID', () => {
  const clean = claude.sanitizeClaudePayload(payload, now);
  assert.doesNotMatch(JSON.stringify(clean), /private-session|private.path|not-for-storage|workspace/);
  assert.equal(clean.sessionKey.length, 64);
  const result = claude.normalizeClaudeSnapshot(clean, now);
  assert.equal(result.remainingPercent, 0);
  assert.equal(result.status, 'critical');
  assert.equal(result.models.length, 1);
});

test('Claude missing, expired, old and malformed windows are not invented', () => {
  const clean = claude.sanitizeClaudePayload({ model: { id: 'only-observed' } }, now);
  assert.equal(claude.normalizeClaudeSnapshot(clean, now).remainingPercent, null);
  const full = claude.sanitizeClaudePayload(payload, now);
  assert.equal(claude.normalizeClaudeSnapshot(full, now + 300001).status, 'stale');
  assert.equal(claude.normalizeClaudeSnapshot(full, now + 2 * 86400000).remainingPercent, null);
  assert.equal(claude.sanitizeClaudePayload({ rate_limits: { five_hour: { used_percentage: '10' } } }, now).rate_limits.five_hour, undefined);
  assert.throws(() => claude.normalizeClaudeSnapshot({}));
});

test('Claude bridge writes and connector reads a sanitized snapshot', async () => {
  await mkdir('work', { recursive: true });
  const dir = await mkdtemp(path.resolve('work/claude-test-'));
  const file = path.join(dir, 'snapshot.json');
  await bridge.capture(Readable.from([JSON.stringify(payload)]), file);
  const stored = JSON.parse(await readFile(file, 'utf8'));
  assert.equal(stored.schemaVersion, 1);
  assert.doesNotMatch(JSON.stringify(stored), /private-session|not-for-storage/);
  const result = await claude.readClaudeSnapshot({ snapshotPath: file });
  assert.equal(result.models[0].name, 'Observed');
  const missing = await claude.readClaudeSnapshot({ snapshotPath: path.join(dir, 'missing.json') });
  assert.equal(missing.status, 'unsupported');
});

test('provider initial setup guidance survives, and partial model failure retains cached directory', async () => {
  const read = snapshots.createProviderReader({ claude: async () => ({ status: 'unsupported', note: 'setup guidance' }) });
  assert.equal((await read('claude')).note, 'setup guidance');
  let fail = false;
  const readModels = snapshots.createProviderReader({ demo: async () => ({ id: 'demo', status: 'healthy', updatedAt: new Date(now).toISOString(), note: '', modelDirectoryStatus: fail ? 'error' : 'ready', models: fail ? [] : [{ id: 'a', name: 'A', remainingPercent: 90 }] }) });
  await readModels('demo');
  fail = true;
  const cached = await readModels('demo');
  assert.equal(cached.models.length, 1);
  assert.equal(cached.models[0].remainingPercent, null);
  assert.equal(cached.models[0].pool, 'unknown');
});

test('read errors are not presented as exhausted quota', () => {
  const ui = snapshots.providerToUi({ id: 'demo', name: 'Demo', status: 'error', models: [] });
  assert.equal(ui.statusText, '异常');
  assert.equal(ui.quotaHero, '读取失败');
  assert.equal(snapshots.relativeReset('invalid'), '重置时间未知');
});
