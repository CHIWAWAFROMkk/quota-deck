import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { Readable, PassThrough } from 'node:stream';
import http from 'node:http';
import https from 'node:https';
import claude from '../src/main/claude-client.cjs';
import bridge from '../src/main/claude-statusline-bridge.cjs';
import deepseek from '../src/main/deepseek-client.cjs';
import workbuddy from '../src/main/workbuddy-client.cjs';
import antigravity from '../src/main/antigravity-client.cjs';
import { createHistory } from '../src/main/quota-history.cjs';

const now = Date.parse('2026-09-25T00:00:00Z');

test('Antigravity loopback transport never enters the global HTTPS proxy agent', async () => {
  const server = http.createServer((_req, response) => response.end('local fixture'));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const original = https.globalAgent.addRequest;
  let proxyCalls = 0;
  https.globalAgent.addRequest = () => { proxyCalls++; throw new Error('global proxy must not receive local traffic'); };
  try {
    // Deliberately use an HTTP fixture for a TLS request. A TLS protocol error
    // proves the direct local socket was reached without a certificate fixture.
    await assert.rejects(antigravity.requestLocal(server.address().port, '/'), error => ['EPROTO', 'ECONNRESET'].includes(error.code));
    assert.equal(proxyCalls, 0);
  } finally {
    https.globalAgent.addRequest = original;
    await new Promise(resolve => server.close(resolve));
  }
});

test('missing Antigravity local service gives an actionable disconnected state', async () => {
  await mkdir('work', { recursive: true });
  const folder = await mkdtemp(path.resolve('work/ag-missing-'));
  const result = await antigravity.readAntigravitySnapshot({ logPath: path.join(folder, 'missing.log') });
  assert.equal(result.status, 'disconnected');
  assert.match(result.note, /打开 Antigravity/);
  assert.deepEqual(result.models, []);
});

test('Antigravity preserves a successful model directory when both quota interfaces fail', async () => {
  let quotaCalls = 0;
  const result = await antigravity.readAntigravitySnapshot({
    readConnection: async () => ({ port: 1234, token: 'fixture-only' }),
    readQuota: async () => { quotaCalls++; throw new Error('fixture provider unavailable'); },
    readModels: async () => ({ models: [{ id: 'gemini-fixture', name: 'Fixture model' }], source: 'fixture directory' }),
  });
  assert.equal(quotaCalls, 2);
  assert.equal(result.status, 'error');
  assert.equal(result.remainingPercent, null);
  assert.equal(result.models.length, 1);
  assert.equal(result.models[0].pool, 'unknown');
  assert.equal(result.modelDirectoryStatus, 'ready');
  assert.match(result.note, /已连接本机服务/);
  assert.doesNotMatch(JSON.stringify(result), /fixture-only/);
});

test('Claude malformed snapshot fields never become a model or current observation', () => {
  for (const input of [null, [], 'text', true]) assert.throws(() => claude.sanitizeClaudePayload(input, now));
  const input = claude.sanitizeClaudePayload({ model: { id: 'observed' }, rate_limits: { five_hour: { used_percentage: 15 } } }, now);
  const old = claude.normalizeClaudeSnapshot(input, now + 300001);
  assert.equal(old.status, 'stale');
  assert.match(old.quotaNote, /历史/);
  assert.match(old.models[0].source, /历史/);
  input.model.id = { malicious: 'not-a-string' };
  input.receivedAt = '2100-01-01T00:00:00Z';
  const future = claude.normalizeClaudeSnapshot(input, now);
  assert.equal(future.models.length, 0);
  assert.equal(future.updatedAt, null);
  assert.equal(future.status, 'stale');
});

test('Claude bridge rejects oversized and stalled input while preserving the last snapshot', async () => {
  await mkdir('work', { recursive: true });
  const dir = await mkdtemp(path.resolve('work/bridge-contract-'));
  const file = path.join(dir, 'snapshot.json');
  await bridge.capture(Readable.from(['{"model":{"id":"first"}}']), file);
  const before = await readFile(file, 'utf8');
  await assert.rejects(bridge.capture(Readable.from(['null']), file));
  await assert.rejects(bridge.capture(Readable.from(['x'.repeat(1048577)]), file), /exceeds limit/);
  await assert.rejects(bridge.capture(new PassThrough(), file, { timeoutMs: 20 }), /timed out/);
  assert.equal(await readFile(file, 'utf8'), before);
});

test('DeepSeek isolates directory errors and does not convert missing balance into zero or healthy', async () => {
  const result = await deepseek.readDeepSeekSnapshot({ apiKey: 'test-only', request: async route => {
    if (route === '/models') throw new Error('unavailable');
    return { is_available: true, balance_infos: [{ currency: 'CNY', total_balance: '12.00', secret: 'drop-me' }] };
  } });
  assert.equal(result.status, 'healthy');
  assert.equal(result.balances[0].total_balance, '12.00');
  assert.equal(result.modelDirectoryStatus, 'error');
  assert.doesNotMatch(JSON.stringify(result), /drop-me/);
  const malformed = await deepseek.readDeepSeekSnapshot({ apiKey: 'test-only', request: async route => route === '/models'
    ? { data: [null, {}, { id: false }, { id: 'valid' }, { id: 'valid' }] }
    : { is_available: 'true', balance_infos: [null, { currency: 'CNY', total_balance: true }] } });
  assert.equal(malformed.status, 'stale');
  assert.equal(malformed.balances.length, 0);
  assert.equal(malformed.models.length, 1);
});

test('DeepSeek bounded transport rejects oversized responses without network requests', async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response('unused', { headers: { 'content-length': '1048577' } });
    await assert.rejects(deepseek.deepSeekRequest('/models', 'test-only'), /大小限制/);
    globalThis.fetch = async () => new Response('x'.repeat(1048577));
    await assert.rejects(deepseek.deepSeekRequest('/models', 'test-only'), /大小限制/);
    globalThis.fetch = async () => new Response('{"data":[]}');
    assert.deepEqual(await deepseek.deepSeekRequest('/models', 'test-only'), { data: [] });
  } finally { globalThis.fetch = original; }
});

test('WorkBuddy rejects coerced booleans/arrays and skips malformed model rows', () => {
  assert.throws(() => workbuddy.normalizeWorkBuddySnapshot(null));
  const result = workbuddy.normalizeWorkBuddySnapshot({ remainingCredits: true, totalCredits: [100], usedCredits: -1,
    capturedAt: 'invalid', models: [null, {}, { name: 'A', rateMultiplier: true }, { name: 'B', rateMultiplier: '0x' }] });
  assert.equal(result.remainingCredits, null);
  assert.equal(result.totalCredits, null);
  assert.equal(result.remainingPercent, null);
  assert.equal(result.updatedAt, null);
  assert.equal(result.models.length, 2);
  assert.equal(result.models[0].consumeMultiplier, null);
  assert.equal(result.models[1].consumeMultiplier, 0);
});

test('Antigravity malformed nested arrays cannot crash or invent a directory', async () => {
  assert.throws(() => antigravity.parseLocalModelDirectory({ agentModelSorts: {}, models: {} }), /目录/);
  assert.throws(() => antigravity.parseLocalModelDirectory({ agentModelSorts: [null, { groups: [null] }], models: {} }), /目录/);
  const result = antigravity.normalizeAntigravitySnapshot({ groups: [null, {}, { displayName: 'Gemini Models', buckets: [null, {},
    { bucketId: 'weekly', remainingFraction: '0.5', resetTime: 'bad' }] }] }, [null, {}, { id: 'gemini-test', name: 'Test' }]);
  assert.equal(result.models.length, 1);
  assert.equal(result.remainingPercent, null);
  assert.equal(result.groups[0].buckets[0].resetTime, null);
  const expired = antigravity.normalizeAntigravitySnapshot({ groups: [{ displayName: 'Gemini Models', buckets: [
    { bucketId: 'weekly', remainingFraction: .8, resetTime: '2026-09-24T00:00:00Z' },
  ] }] }, [{ id: 'gemini-test' }], new Date(now).toISOString());
  assert.equal(expired.remainingPercent, null);
  await assert.rejects(antigravity.requestLocal(999999, '/'), /端口无效/);
});

test('history never turns old observations into consumption samples and breaks after malformed counters', async () => {
  await mkdir('work', { recursive: true });
  const dir = await mkdtemp(path.resolve('work/history-contract-'));
  const history = createHistory(path.join(dir, 'history.json'));
  const sample = async (minute, value, status = 'healthy') => {
    const bucket = { bucketId: 'weekly', resetTime: '2026-09-26T00:00:00Z', remainingFraction: value };
    await history.record({ id: 'test', historyScope: 'test-scope', status, groups: [{ displayName: 'test', buckets: [bucket] }] }, now + minute * 60000);
    return bucket;
  };
  await sample(0, .9);
  await sample(3, .8);
  assert.equal((await sample(6, .7, 'stale')).burnPerHour, null);
  await sample(7, null);
  assert.equal((await sample(8, .6)).burnPerHour, null);
  await history.record({ id: 'test', groups: [null, { buckets: [null] }] }, now);
  await assert.rejects(history.record(null, now), /object/);
});

function historyStorage(file, failures = []) {
  const files = new Map([[file, '[]']]);
  const writes = [];
  const renames = [];
  const waits = [];
  const fileSystem = {
    stat: async key => {
      if (!files.has(key)) throw Object.assign(new Error('missing'), { code: 'ENOENT' });
      return { size: Buffer.byteLength(files.get(key)) };
    },
    readFile: async key => files.get(key),
    mkdir: async () => {},
    writeFile: async (key, value) => { writes.push(key); files.set(key, value); },
    rename: async (from, to) => {
      renames.push([from, to]);
      const code = failures.shift();
      if (code) throw Object.assign(new Error(code), { code });
      files.set(to, files.get(from));
      files.delete(from);
    },
  };
  return { files, writes, renames, waits, options: { fileSystem, sleep: async ms => { waits.push(ms); } } };
}

function historySample(scope) {
  return { id: 'test', historyScope: scope, groups: [{ displayName: 'pool', buckets: [
    { bucketId: 'weekly', resetTime: '2026-09-26T00:00:00Z', remainingFraction: .8 },
  ] }] };
}

test('history atomically retries only transient Windows rename failures with a short fixed bound', async () => {
  const file = path.resolve('work/history-injected-retry.json');
  const storage = historyStorage(file, ['EPERM', 'EBUSY']);
  await createHistory(file, storage.options).record(historySample('a'), now);
  assert.deepEqual(storage.waits, [20, 40]);
  assert.equal(storage.renames.length, 3);
  assert.equal(JSON.parse(storage.files.get(file)).length, 1);
  assert.equal(storage.writes.length, 1);
  assert.notEqual(storage.writes[0], `${file}.tmp`);

  const blocked = historyStorage(file, ['EPERM', 'EPERM', 'EPERM', 'EPERM', 'EPERM']);
  await assert.rejects(createHistory(file, blocked.options).record(historySample('a'), now), { code: 'EPERM' });
  assert.deepEqual(blocked.waits, [20, 40, 80]);
  assert.equal(blocked.renames.length, 4);
  assert.equal(blocked.files.get(file), '[]');
  assert.ok(blocked.files.has(blocked.writes[0]));

  const permanent = historyStorage(file, ['EIO']);
  await assert.rejects(createHistory(file, permanent.options).record(historySample('a'), now), { code: 'EIO' });
  assert.equal(permanent.renames.length, 1);
  assert.deepEqual(permanent.waits, []);
});

test('same-path history instances serialize reload-and-save and never share a temporary name', async () => {
  const file = path.resolve('work/history-injected-concurrent.json');
  const storage = historyStorage(file);
  const a = createHistory(file, storage.options);
  const b = createHistory(file, storage.options);
  await Promise.all([a.record(historySample('account-a'), now), b.record(historySample('account-b'), now)]);
  const rows = JSON.parse(storage.files.get(file));
  assert.equal(rows.length, 2);
  assert.notEqual(rows[0].key, rows[1].key);
  assert.equal(new Set(storage.writes).size, 2);
});
