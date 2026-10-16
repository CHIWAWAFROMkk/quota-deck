import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import codex from '../src/main/codex-client.cjs';

const at = Date.parse('2026-10-15T07:35:20.223Z');
const primary = { used_percent: 63, window_minutes: 300, resets_at: 1792062813 };
const secondary = { used_percent: 75, window_minutes: 10080, resets_at: 1792649613 };
const fallbackResult = {
  at,
  planType: 'plus',
  primary: { usedPercent: 63, windowDurationMins: 300, resetsAt: 1792062813 },
  secondary: { usedPercent: 75, windowDurationMins: 10080, resetsAt: 1792649613 },
};

async function roots() {
  await fs.mkdir('work', { recursive: true });
  const dir = await fs.mkdtemp(path.resolve('work/codex-limits-test-'));
  const root = path.join(dir, 'sessions');
  await fs.mkdir(root);
  return { root };
}

async function writeLog(root, relative, lines, mtime = at) {
  const file = path.join(root, relative);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, lines.join('\n') + '\n', 'utf8');
  await fs.utimes(file, new Date(mtime), new Date(mtime));
  return file;
}

function event(limits = {}, timestamp = at) {
  return JSON.stringify({
    timestamp: new Date(timestamp).toISOString(),
    type: 'event_msg',
    payload: { type: 'token_count', rate_limits: { limit_id: 'codex', plan_type: 'plus', primary, secondary, ...limits } },
  });
}

async function readLimits(options) {
  const { readLatestCodexLimits } = await import('../src/main/codex-rollout-limits.cjs');
  return readLatestCodexLimits(options);
}

function failingClient(error) {
  return { closed: false, async start() { throw error; }, close() { this.closed = true; } };
}

test('rollout limits use descending dates, file mtime, and the last matching line', async () => {
  const { root } = await roots();
  const old = event({ primary: { ...primary, used_percent: 1 } }, at - 1000);
  await writeLog(root, '2025/12/31/rollout-old-year.jsonl', [old], at + 10000);
  await writeLog(root, '2026/09/30/rollout-old-month.jsonl', [old], at + 10000);
  await writeLog(root, '2026/10/14/rollout-old-day.jsonl', [old], at + 10000);
  await writeLog(root, '2026/10/15/rollout-z.jsonl', [old], at - 1000);
  const latest = await writeLog(root, '2026/10/15/rollout-a.jsonl', [old, event()], at);
  await writeLog(root, '2026/10/15/ignore.txt', [old], at + 10000);
  const opened = [];
  const fileSystem = { ...fs, async open(file, flags) { opened.push(file); return fs.open(file, flags); } };
  assert.deepEqual(await readLimits({ root, fileSystem }), fallbackResult);
  assert.deepEqual(opened, [latest], 'stop as soon as a matching file is found');
});

test('rollout limits skip another model and explicit null limit ids', async () => {
  const { root } = await roots();
  await writeLog(root, '2026/10/15/rollout.jsonl', [event(), event({ limit_id: 'other-model' }), event({ limit_id: null })]);
  assert.deepEqual(await readLimits({ root }), fallbackResult);
});

test('rollout limits accept missing limit id, plan type, and secondary window', async () => {
  const { root } = await roots();
  await writeLog(root, '2026/10/15/rollout.jsonl', [event({ limit_id: undefined, plan_type: undefined, secondary: undefined })]);
  assert.deepEqual(await readLimits({ root }), { ...fallbackResult, planType: null, secondary: null });
});

const invalidLines = [
  '{broken', 'null', '[]',
  event({ primary: undefined }),
  event({ primary: { ...primary, used_percent: '63' } }),
  event({ primary: { ...primary, used_percent: null } }),
  event().replace('"used_percent":63', '"used_percent":1e400'),
  event().replace('"type":"event_msg"', '"type":"response_item"'),
  event().replace('"type":"token_count"', '"type":"other"'),
  event().replace(new Date(at).toISOString(), 'invalid-timestamp'),
  JSON.stringify({ type: 'event_msg', payload: { type: 'token_count', rate_limits: null } }),
  JSON.stringify({ type: 'event_msg', payload: { type: 'token_count', rate_limits: [] } }),
];

test('rollout limits skip broken JSON, unrelated events, and invalid primary windows', async () => {
  const { root } = await roots();
  await writeLog(root, '2026/10/15/rollout.jsonl', [event(), ...invalidLines]);
  assert.deepEqual(await readLimits({ root }), fallbackResult);
});

test('rollout limits return null when all lines are invalid', async () => {
  const { root } = await roots();
  await writeLog(root, '2026/10/15/rollout.jsonl', invalidLines);
  assert.equal(await readLimits({ root }), null);
});

test('rollout limits return null for a missing root', async () => {
  const { root } = await roots();
  assert.equal(await readLimits({ root: path.join(root, 'missing') }), null);
});

test('rollout limits read only the tail and close the read-only file handle', async () => {
  const { root } = await roots();
  const file = await writeLog(root, '2026/10/15/rollout.jsonl', ['x'.repeat(2000), event({ secondary: undefined })]);
  const reads = [];
  let closed = false;
  const fileSystem = { ...fs, async open(filePath, flags) {
    assert.equal(flags, 'r');
    const handle = await fs.open(filePath, flags);
    return {
      stat: () => handle.stat(),
      read: async (buffer, offset, length, position) => {
        reads.push({ length, position });
        return handle.read(buffer, offset, length, position);
      },
      close: async () => { closed = true; await handle.close(); },
    };
  } };
  assert.deepEqual(await readLimits({ root, fileSystem, tailBytes: 300 }), { ...fallbackResult, secondary: null });
  assert.deepEqual(reads, [{ length: 300, position: (await fs.stat(file)).size - 300 }]);
  assert.equal(closed, true);
});

test('rollout limits discard the first tail line even if its suffix is valid JSON', async () => {
  const { root } = await roots();
  const line = event({ secondary: undefined });
  await writeLog(root, '2026/10/15/rollout.jsonl', ['prefix'.repeat(200) + line]);
  assert.equal(await readLimits({ root, tailBytes: Buffer.byteLength(line) + 1 }), null);
});

test('rollout limits enforce maxFiles across days and continue past invalid files', async () => {
  const { root } = await roots();
  await writeLog(root, '2026/10/15/rollout-new.jsonl', ['{broken'], at);
  await writeLog(root, '2026/10/15/rollout-old.jsonl', ['{broken'], at - 1000);
  await writeLog(root, '2026/10/14/rollout.jsonl', [event()]);
  const opened = [];
  const fileSystem = { ...fs, async open(file, flags) { opened.push(file); return fs.open(file, flags); } };
  assert.equal(await readLimits({ root, fileSystem, maxFiles: 2 }), null);
  assert.equal(opened.length, 2);
  assert.deepEqual(await readLimits({ root }), fallbackResult);
});

test('Codex snapshot falls back on startup timeout and preserves the log timestamp', async () => {
  const client = failingClient(new Error('workspace routing discovery timed out'));
  const result = await codex.readCodexSnapshot(client, { fallback: async () => fallbackResult });
  assert.deepEqual(result, {
    id: 'codex', name: 'Codex', status: 'stale', remainingPercent: 25,
    source: '本机日志', precision: 'local-log', updatedAt: new Date(at).toISOString(), planType: 'plus',
    windows: [
      { label: '主窗口', remainingPercent: 37, ...fallbackResult.primary, resetsAt: new Date(primary.resets_at * 1000).toISOString() },
      { label: '周窗口', remainingPercent: 25, ...fallbackResult.secondary, resetsAt: new Date(secondary.resets_at * 1000).toISOString() },
    ],
    models: [], note: 'Codex 本机服务未响应，显示 Codex 日志里最近一次记录的额度。',
  });
  assert.equal(client.closed, true);
});

test('Codex snapshot fallback supports a primary window alone', async () => {
  const client = failingClient(new Error('startup failed'));
  const result = await codex.readCodexSnapshot(client, { fallback: async () => ({ ...fallbackResult, secondary: null }) });
  assert.equal(result.remainingPercent, 37);
  assert.equal(result.windows.length, 1);
  assert.equal(client.closed, true);
});

test('Codex snapshot rethrows the original timeout when fallback returns null', async () => {
  const error = new Error('workspace routing discovery timed out');
  const client = failingClient(error);
  let called = false;
  await assert.rejects(codex.readCodexSnapshot(client, { fallback: async () => { called = true; return null; } }), actual => actual === error);
  assert.equal(called, true);
  assert.equal(client.closed, true);
});

test('Codex snapshot rethrows the original error when fallback throws', async () => {
  const error = new Error('workspace routing discovery timed out');
  const client = failingClient(error);
  let called = false;
  await assert.rejects(codex.readCodexSnapshot(client, { fallback: async () => { called = true; throw new Error('log read failed'); } }), actual => actual === error);
  assert.equal(called, true);
  assert.equal(client.closed, true);
});

test('Codex snapshot also falls back on RPC errors and missing login', async () => {
  for (const failRpc of [true, false]) {
    const client = {
      closed: false, async start() {}, close() { this.closed = true; },
      async request(method) {
        if (failRpc) throw new Error('RPC failed');
        return method === 'account/read' ? { account: null } : { data: [] };
      },
    };
    const result = await codex.readCodexSnapshot(client, { fallback: async () => fallbackResult });
    assert.equal(result.status, 'stale');
    assert.equal(result.precision, 'local-log');
    assert.equal(client.closed, true);
  }
});

test('successful Codex snapshots retain every existing field and do not call fallback', async () => {
  const credits = { hasCredits: false, unlimited: false, balance: '0' };
  const client = {
    closed: false, async start() {}, close() { this.closed = true; },
    async request(method) {
      if (method === 'account/read') return { account: { type: 'chatgpt' } };
      if (method === 'account/rateLimits/read') return { rateLimits: { ...fallbackResult, credits } };
      return { data: [{ id: 'm', model: 'm', displayName: 'Model' }] };
    },
  };
  let fallbackCalled = false;
  const startedAt = Date.now();
  const result = await codex.readCodexSnapshot(client, { fallback: async () => { fallbackCalled = true; return fallbackResult; } });
  const windows = [
    { label: '主窗口', remainingPercent: 37, ...fallbackResult.primary, resetsAt: new Date(primary.resets_at * 1000).toISOString() },
    { label: '周窗口', remainingPercent: 25, ...fallbackResult.secondary, resetsAt: new Date(secondary.resets_at * 1000).toISOString() },
  ];
  assert.ok(Date.parse(result.updatedAt) >= startedAt && Date.parse(result.updatedAt) <= Date.now());
  assert.deepEqual(result, {
    id: 'codex', name: 'Codex', status: 'low', remainingPercent: 25,
    source: '本机读取', precision: 'provider-reported', updatedAt: result.updatedAt,
    planType: 'plus', credits, windows,
    models: [{ id: 'm', name: 'Model', model: 'm', pool: 'shared', poolLabel: 'Codex 共享额度', windows, source: '本机读取' }],
    note: '未显示独立额度的模型共用 Codex 账户额度，不进行虚假拆分。',
  });
  assert.equal(fallbackCalled, false);
  assert.equal(client.closed, true);
});
