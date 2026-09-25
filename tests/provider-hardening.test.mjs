import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { mkdtemp, mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import codex from '../src/main/codex-client.cjs';
import { createHistory } from '../src/main/quota-history.cjs';

function clientFor(limits) {
  return { start: async () => {}, close() {}, request: async (method) => {
    if (method === 'account/read') return { account: { type: 'chatgpt' } };
    if (method === 'account/rateLimits/read') return limits;
    return { data: [{ id: 'm', model: 'm', displayName: 'Model' }] };
  } };
}

test('Codex summary uses the most constrained window and safely handles absent buckets', async () => {
  const value = await codex.readCodexSnapshot(clientFor({ rateLimitsByLimitId: { codex: {
    primary: { usedPercent: 5 }, secondary: { usedPercent: 99, resetsAt: 1e30 },
  } } }));
  assert.equal(value.remainingPercent, 1);
  assert.equal(value.status, 'critical');
  assert.equal(value.windows[1].resetsAt, null);
  const unknown = await codex.readCodexSnapshot(clientFor({ rateLimitsByLimitId: { empty: null } }));
  assert.equal(unknown.remainingPercent, null);
  assert.equal(unknown.status, 'stale');
  assert.equal(unknown.models.length, 1);
  assert.deepEqual(unknown.models[0].windows, []);
});

test('Codex model pagination deduplicates models and rejects cursor cycles', async () => {
  const cursors = [];
  const result = await codex.readModelPages({ request: async (_, params) => {
    cursors.push(params.cursor);
    return params.cursor ? { data: [{ id: 'a' }, { id: 'b' }] }
      : { data: [{ id: 'a' }], nextCursor: 'second' };
  } });
  assert.deepEqual(cursors, [undefined, 'second']);
  assert.deepEqual(result.data.map(x => x.id), ['a', 'b']);
  await assert.rejects(codex.readModelPages({ request: async () => ({ data: [], nextCursor: 'loop' }) }), /分页异常/);
});

test('Codex startup errors reject pending RPC without uncaught process errors', async () => {
  const child = new EventEmitter();
  child.stdin = new PassThrough();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.kill = () => {};
  const client = new codex.CodexRpcClient({ binary: () => 'unused', spawnProcess: () => {
    queueMicrotask(() => child.emit('error', new Error('sensitive path')));
    return child;
  } });
  await assert.rejects(client.start(), /无法启动/);
  assert.equal(client.pending.size, 0);
  await assert.rejects(client.request('model/list'), /无法启动/);
});

test('history isolates unknown accounts, persists explicit scopes, and rejects invalid counters', async () => {
  await mkdir(path.resolve('work'), { recursive: true });
  const dir = await mkdtemp(path.resolve('work/provider-history-'));
  const file = path.join(dir, 'history.json');
  const start = Date.parse('2026-09-25T00:00:00Z');
  let history = createHistory(file);
  const sample = async (minute, value, scope, resetTime = '2026-09-26T00:00:00Z') => {
    const bucket = { bucketId: 'weekly', remainingFraction: value, resetTime };
    await history.record({ id: 'test', historyScope: scope, groups: [{ displayName: 'group', buckets: [bucket] }] }, start + minute * 60000);
    return bucket;
  };
  await sample(0, .9);
  await sample(3, .8);
  history = createHistory(file);
  assert.equal((await sample(6, .7)).burnPerHour, null);
  await sample(10, .9, 'account-a');
  await sample(13, .8, 'account-a');
  history = createHistory(file);
  assert.ok((await sample(16, .7, 'account-a')).burnPerHour > 0);
  assert.equal((await sample(17, .6, 'account-b')).burnPerHour, null);
  for (const value of [null, undefined, NaN, Infinity, -.1, 1.1, '0.5']) {
    assert.equal((await sample(18, value, 'account-a')).burnPerHour, null);
  }
  assert.equal((await sample(18, .6, 'account-a', 'bad-date')).burnPerHour, null);
  assert.equal((await sample(18, .6, 'account-a', '2026-09-24T00:00:00Z')).burnPerHour, null);
  assert.doesNotMatch(await readFile(file, 'utf8'), /account-a|account-b/);
});
