import test from 'node:test';
import assert from 'node:assert/strict';
import { appendFile, mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import path from 'node:path';
import ledger from '../src/main/token-ledger.cjs';

const { QUARTER, BUCKETS } = ledger;

async function roots() {
  await mkdir('work', { recursive: true });
  const dir = await mkdtemp(path.resolve('work/ledger-test-'));
  const claudeRoot = path.join(dir, 'projects');
  const codexRoot = path.join(dir, 'sessions');
  await mkdir(path.join(claudeRoot, 'proj', 'session', 'subagents'), { recursive: true });
  await mkdir(path.join(codexRoot, '2026', '10', '13'), { recursive: true });
  return { claudeRoot, codexRoot };
}
const claudeLine = (id, at, usage, model) => JSON.stringify({ type: 'assistant', timestamp: new Date(at).toISOString(), message: { id, usage, ...(model ? { model } : {}) } });
const contextLine = (at, model) => JSON.stringify({ timestamp: new Date(at).toISOString(), type: 'turn_context', payload: { model } });
const codexLine = (at, total) => JSON.stringify({ timestamp: new Date(at).toISOString(), type: 'event_msg', payload: { type: 'token_count', info: { total_token_usage: { total_tokens: total } } } });

test('windowStart aligns to local quarter hours and covers 96 buckets', () => {
  const now = new Date(2026, 9, 13, 10, 7, 30).getTime();
  assert.equal(ledger.windowStart(now), new Date(2026, 9, 13, 10, 0).getTime() - 95 * QUARTER);
});

test('line parsers ignore anything that is not a usage record', () => {
  assert.equal(ledger.parseClaudeLine('{broken'), null);
  assert.equal(ledger.parseClaudeLine(JSON.stringify({ type: 'user', timestamp: '2026-10-13T00:00:00Z', message: { id: 'x', usage: {} } })), null);
  assert.deepEqual(ledger.parseClaudeLine(claudeLine('m', 0, { input_tokens: 2, output_tokens: 3, cache_creation_input_tokens: 5, cache_read_input_tokens: 7, output_tokens_details: { thinking_tokens: 99 } })), { id: 'm', at: 0, tokens: 17, model: 'unknown' });
  assert.equal(ledger.parseCodexContext(contextLine(0, 'gpt-6.1-sol')), 'gpt-6.1-sol');
  assert.equal(ledger.parseCodexContext(codexLine(0, 1)), null);
  assert.equal(ledger.parseCodexContext('{"type":"turn_context","payload":{"model":""}}'), null);
  assert.equal(ledger.parseCodexLine(JSON.stringify({ timestamp: '2026-10-13T00:00:00Z', type: 'event_msg', payload: { type: 'token_count', info: null } })), null);
  assert.deepEqual(ledger.parseCodexLine(codexLine(0, 42)), { at: 0, total: 42 });
});

test('claude dedupes message ids across lines and files', async () => {
  const { claudeRoot, codexRoot } = await roots();
  const now = Date.now();
  await writeFile(path.join(claudeRoot, 'proj', 'a.jsonl'), [
    claudeLine('m1', now - 60000, { input_tokens: 1, output_tokens: 1 }),
    claudeLine('m1', now - 60000, { input_tokens: 1, output_tokens: 9 }),
    '{not json',
    JSON.stringify({ type: 'user', timestamp: new Date(now).toISOString() }),
    claudeLine('old', now - 2 * 86400000, { input_tokens: 1000 }),
  ].join('\n') + '\n');
  await writeFile(path.join(claudeRoot, 'proj', 'resumed.jsonl'), claudeLine('m1', now - 60000, { input_tokens: 1, output_tokens: 9 }) + '\n' + claudeLine('m2', now - 30000, { input_tokens: 5 }) + '\n');
  await writeFile(path.join(claudeRoot, 'proj', 'session', 'subagents', 'agent.jsonl'), claudeLine('m3', now - 10000, { output_tokens: 4 }) + '\n');
  const result = await ledger.createTokenLedger({ claudeRoot, codexRoot }).read(now);
  assert.equal(result.claude.status, 'ok');
  assert.equal(result.claude.total, 10 + 5 + 4);
  assert.equal(result.claude.buckets.length, BUCKETS);
  assert.equal(result.claude.buckets.reduce((a, b) => a + b, 0), 19);
});

test('partial trailing line is read once it is complete', async () => {
  const { claudeRoot, codexRoot } = await roots();
  const now = Date.now();
  const file = path.join(claudeRoot, 'proj', 'live.jsonl');
  const line = claudeLine('m1', now - 1000, { output_tokens: 8 });
  await writeFile(file, claudeLine('m0', now - 2000, { output_tokens: 1 }) + '\n' + line.slice(0, 20));
  const reader = ledger.createTokenLedger({ claudeRoot, codexRoot });
  assert.equal((await reader.read(now)).claude.total, 1);
  await appendFile(file, line.slice(20) + '\n');
  assert.equal((await reader.read(now)).claude.total, 9);
  assert.equal((await reader.read(now)).claude.total, 9);
});

test('a rewritten (shorter) file is reread without double counting', async () => {
  const { claudeRoot, codexRoot } = await roots();
  const now = Date.now();
  const file = path.join(claudeRoot, 'proj', 'x.jsonl');
  await writeFile(file, claudeLine('a', now - 1000, { output_tokens: 100 }) + '\n' + claudeLine('b', now - 1000, { output_tokens: 100 }) + '\n');
  const reader = ledger.createTokenLedger({ claudeRoot, codexRoot });
  assert.equal((await reader.read(now)).claude.total, 200);
  await writeFile(file, claudeLine('c', now - 500, { output_tokens: 3 }) + '\n');
  assert.equal((await reader.read(now)).claude.total, 3);
});

test('codex counts positive deltas and treats rollback as a new segment', async () => {
  const { claudeRoot, codexRoot } = await roots();
  const now = Date.now();
  await writeFile(path.join(codexRoot, '2026', '10', '13', 'rollout-a.jsonl'), [
    codexLine(now - 50000, 100),
    codexLine(now - 40000, 100),
    codexLine(now - 30000, 250),
    codexLine(now - 20000, 40),
    JSON.stringify({ type: 'response_item', payload: {} }),
  ].join('\n') + '\n');
  const result = await ledger.createTokenLedger({ claudeRoot, codexRoot }).read(now);
  assert.equal(result.codex.status, 'ok');
  assert.equal(result.codex.total, 100 + 150 + 40);
});

test('events land in the right quarter hour, and missing roots are unsupported', async () => {
  const { claudeRoot } = await roots();
  const missing = path.join(claudeRoot, '..', 'no-such-dir');
  // File mtimes are real "now", so use the real clock and place events relative to it.
  const real = Date.now();
  const realStart = ledger.windowStart(real);
  await writeFile(path.join(claudeRoot, 'proj', 'q.jsonl'), [
    claudeLine('first', realStart, { output_tokens: 1 }),
    claudeLine('last', realStart + 95 * QUARTER, { output_tokens: 2 }),
    claudeLine('before', realStart - 1, { output_tokens: 50 }),
  ].join('\n') + '\n');
  const result = await ledger.createTokenLedger({ claudeRoot, codexRoot: missing }).read(real);
  assert.equal(result.claude.buckets[0], 1);
  assert.equal(result.claude.buckets[95], 2);
  assert.equal(result.claude.total, 3);
  assert.equal(result.claude.startAt, realStart);
  assert.equal(result.codex.status, 'unsupported');
  assert.equal(result.codex.total, 0);
});

// --- Codex review regressions (2026-10-13) ---
import fsp from 'node:fs/promises';
import { spawnSync } from 'node:child_process';

function wrapFs(clock, { readCost = 0, readdirCost = () => 0, statCost = () => 0, failOpen = () => false } = {}) {
  return {
    readdir: async (...args) => { clock.now += readdirCost(); return fsp.readdir(...args); },
    stat: async (...args) => { clock.now += statCost(); return fsp.stat(...args); },
    open: async (...args) => {
      if (failOpen()) throw Object.assign(new Error('busy'), { code: 'EBUSY' });
      const handle = await fsp.open(...args);
      return { read: async (...rest) => { const result = await handle.read(...rest); clock.now += readCost; return result; }, close: () => handle.close() };
    },
  };
}

test('the fullest usage of a message wins, whatever the file order', async () => {
  for (const [first, second] of [[1, 9], [9, 1]]) {
    const { claudeRoot, codexRoot } = await roots();
    const now = Date.now();
    await writeFile(path.join(claudeRoot, 'proj', 'a.jsonl'), claudeLine('m1', now - 1000, { output_tokens: first }) + '\n');
    await writeFile(path.join(claudeRoot, 'proj', 'z.jsonl'), claudeLine('m1', now - 1000, { output_tokens: second }) + '\n');
    assert.equal((await ledger.createTokenLedger({ claudeRoot, codexRoot }).read(now)).claude.total, 9, `${first} then ${second}`);
  }
});

test('a truncation is noticed even when the old file ended in a partial line', async () => {
  const { claudeRoot, codexRoot } = await roots();
  const now = Date.now();
  const file = path.join(claudeRoot, 'proj', 'cut.jsonl');
  const first = claudeLine('a', now - 1000, { output_tokens: 100 }) + '\n';
  await writeFile(file, first + 'x'.repeat(1000));
  const reader = ledger.createTokenLedger({ claudeRoot, codexRoot });
  assert.equal((await reader.read(now)).claude.total, 100);
  const replacement = claudeLine('c', now - 500, { output_tokens: 3 }) + '\n';
  await writeFile(file, replacement + ' '.repeat(Math.max(0, first.length - replacement.length + 50)) + '\n');
  assert.equal((await reader.read(now)).claude.total, 3);
});

test('the time budget also stops inside a file and resumes without double counting', async () => {
  const { claudeRoot, codexRoot } = await roots();
  const now = Date.now();
  await writeFile(path.join(claudeRoot, 'proj', 'big.jsonl'), Array.from({ length: 12 }, (_, i) => claudeLine(`m${i}`, now - 1000, { output_tokens: 1 })).join('\n') + '\n');
  const clock = { now: 0 };
  const reader = ledger.createTokenLedger({ claudeRoot, codexRoot, chunkSize: 256, budgetMs: 2000, clock: () => clock.now, fileSystem: wrapFs(clock, { readCost: 1500 }) });
  const first = await reader.read(now);
  assert.equal(first.claude.partial, true);
  assert.ok(first.claude.total > 0 && first.claude.total < 12, `first round counted ${first.claude.total}`);
  let result = first;
  for (let i = 0; i < 30 && result.claude.partial; i++) result = await reader.read(now);
  assert.equal(result.claude.partial, false);
  assert.equal(result.claude.total, 12);
});

test('an interrupted directory scan keeps what earlier rounds counted', async () => {
  const { claudeRoot, codexRoot } = await roots();
  const now = Date.now();
  await writeFile(path.join(claudeRoot, 'proj', 'a.jsonl'), claudeLine('m1', now - 1000, { output_tokens: 5 }) + '\n');
  const clock = { now: 0 };
  let slow = false;
  let slowScans = 0;
  const reader = ledger.createTokenLedger({ claudeRoot, codexRoot, clock: () => clock.now, fileSystem: wrapFs(clock, { readdirCost: () => (slow ? (slowScans++, 1500) : 0) }) });
  assert.equal((await reader.read(now)).claude.total, 5);
  slow = true;
  const second = await reader.read(now);
  assert.equal(second.claude.partial, true);
  assert.equal(second.claude.total, 5);
  assert.ok(slowScans <= 2, `scan kept going past the deadline: ${slowScans} directory reads`);
});

test('a temporary read error keeps the counts from earlier rounds', async () => {
  const { claudeRoot, codexRoot } = await roots();
  const now = Date.now();
  const file = path.join(claudeRoot, 'proj', 'a.jsonl');
  await writeFile(file, claudeLine('m1', now - 1000, { output_tokens: 5 }) + '\n');
  let fail = false;
  const reader = ledger.createTokenLedger({ claudeRoot, codexRoot, fileSystem: wrapFs({ now: 0 }, { failOpen: () => fail }) });
  assert.equal((await reader.read(now)).claude.total, 5);
  await appendFile(file, claudeLine('m2', now - 500, { output_tokens: 2 }) + '\n');
  fail = true;
  const failed = await reader.read(now);
  assert.equal(failed.claude.total, 5);
  assert.equal(failed.claude.partial, true);
  fail = false;
  assert.equal((await reader.read(now)).claude.total, 7);
});

test('quarter alignment survives the repeated hour when clocks fall back', () => {
  const script = `const l = require(${JSON.stringify(path.resolve('src/main/token-ledger.cjs'))});
const now = Date.parse('2026-11-01T09:07:30Z');
process.stdout.write(JSON.stringify({ start: l.windowStart(now), offset: new Date(now).getTimezoneOffset() }));`;
  const run = spawnSync(process.execPath, ['-e', script], { env: { ...process.env, TZ: 'America/Los_Angeles' }, encoding: 'utf8' });
  const result = JSON.parse(run.stdout);
  assert.equal(result.offset, 480, 'TZ must take effect for this check to mean anything');
  assert.equal(result.start, Date.parse('2026-11-01T09:00:00Z') - 95 * QUARTER);
});

test('the directory scan checks the deadline before every stat and still makes progress', async () => {
  const { claudeRoot, codexRoot } = await roots();
  const now = Date.now();
  for (let i = 0; i < 8; i++) await writeFile(path.join(claudeRoot, 'proj', `f${i}.jsonl`), claudeLine(`m${i}`, now - 1000, { output_tokens: 1 }) + '\n');
  const clock = { now: 0 };
  let stats = 0;
  const reader = ledger.createTokenLedger({ claudeRoot, codexRoot, budgetMs: 2000, clock: () => clock.now, fileSystem: wrapFs(clock, { statCost: () => (stats++, 1000) }) });
  const first = await reader.read(now);
  assert.ok(stats <= 3, `stat kept going past the deadline: ${stats}`);
  assert.equal(first.claude.partial, true);
  assert.ok(first.claude.total >= 1, 'each round parses at least one file');
});

test('a file truncated after a budget-interrupted read is reread', async () => {
  const { claudeRoot, codexRoot } = await roots();
  const now = Date.now();
  const file = path.join(claudeRoot, 'proj', 'big.jsonl');
  await writeFile(file, Array.from({ length: 40 }, (_, i) => claudeLine(`m${i}`, now - 1000, { output_tokens: 20 })).join('\n') + '\n');
  const clock = { now: 0 };
  const reader = ledger.createTokenLedger({ claudeRoot, codexRoot, chunkSize: 256, budgetMs: 2000, clock: () => clock.now, fileSystem: wrapFs(clock, { readCost: 1500 }) });
  const first = await reader.read(now);
  assert.equal(first.claude.partial, true);
  assert.ok(first.claude.total > 0);
  await writeFile(file, claudeLine('c', now - 500, { output_tokens: 3 }) + '\n');
  let result = await reader.read(now);
  for (let i = 0; i < 5 && result.claude.partial; i++) result = await reader.read(now);
  assert.equal(result.claude.partial, false);
  assert.equal(result.claude.total, 3);
});

test('a slow scan resumes where it stopped, so every file is counted once within a few rounds', async () => {
  const { claudeRoot, codexRoot } = await roots();
  const now = Date.now();
  for (let i = 0; i < 8; i++) await writeFile(path.join(claudeRoot, 'proj', `f${i}.jsonl`), claudeLine(`m${i}`, now - 1000, { output_tokens: 1 }) + '\n');
  const clock = { now: 0 };
  const reader = ledger.createTokenLedger({ claudeRoot, codexRoot, budgetMs: 2000, clock: () => clock.now, fileSystem: wrapFs(clock, { statCost: () => 1000 }) });
  const totals = [];
  for (let round = 0; round < 10; round++) {
    const result = await reader.read(now);
    totals.push(result.claude.total);
    assert.ok(result.claude.total <= 8, `round ${round + 1} double counted: ${totals.join(' → ')}`);
  }
  assert.equal(totals.at(-1), 8, `never reached all eight files: ${totals.join(' → ')}`);
});

const sum = arr => arr.reduce((a, b) => a + b, 0);

test('claude tokens are split by model into stacked buckets', async () => {
  const { claudeRoot, codexRoot } = await roots();
  const now = Date.now();
  await writeFile(path.join(claudeRoot, 'proj', 'session', 'a.jsonl'), [
    claudeLine('m1', now - 60000, { input_tokens: 100 }, 'claude-opus-5-5'),
    claudeLine('m2', now - 50000, { input_tokens: 30 }, 'claude-fable-5-1'),
    claudeLine('m3', now - 40000, { input_tokens: 50 }, 'claude-opus-5-5'),
  ].join('\n') + '\n');
  const series = (await ledger.createTokenLedger({ claudeRoot, codexRoot }).read(now)).claude;
  assert.deepEqual(series.models, [{ id: 'claude-opus-5-5', name: 'Opus 5.5', total: 150 }, { id: 'claude-fable-5-1', name: 'Fable 5.1', total: 30 }]);
  assert.equal(series.stacks.length, BUCKETS);
  assert.deepEqual([0, 1].map(m => sum(series.stacks.map(column => column[m]))), [150, 30]);
  assert.equal(series.total, 180);
  for (let i = 0; i < BUCKETS; i++) assert.equal(sum(series.stacks[i]), series.buckets[i], `bucket ${i}`);
});

test('codex remembers the turn model across reads of a growing file', async () => {
  const { claudeRoot, codexRoot } = await roots();
  const now = Date.now();
  const file = path.join(codexRoot, '2026', '10', '13', 'rollout-m.jsonl');
  await writeFile(file, [codexLine(now - 90000, 10), contextLine(now - 80000, 'gpt-6.1-sol'), codexLine(now - 70000, 40)].join('\n') + '\n');
  const reader = ledger.createTokenLedger({ claudeRoot, codexRoot });
  let series = (await reader.read(now)).codex;
  assert.deepEqual(series.models.map(m => [m.id, m.total]), [['gpt-6.1-sol', 30], ['unknown', 10]]);
  await appendFile(file, codexLine(now - 1000, 100) + '\n');
  series = (await reader.read(now)).codex;
  assert.deepEqual(series.models.map(m => [m.id, m.name, m.total]), [['gpt-6.1-sol', 'GPT-6.1 Sol', 90], ['unknown', 'Unknown', 10]]);
});

test('more than six models fold into Other and totals still add up', async () => {
  const { claudeRoot, codexRoot } = await roots();
  const now = Date.now();
  const lines = [];
  for (let i = 0; i < 8; i++) lines.push(claudeLine(`m${i}`, now - 60000, { input_tokens: 100 - i }, `claude-opus-${i + 1}`));
  await writeFile(path.join(claudeRoot, 'proj', 'session', 'many.jsonl'), lines.join('\n') + '\n');
  const series = (await ledger.createTokenLedger({ claudeRoot, codexRoot }).read(now)).claude;
  assert.equal(series.models.length, 7);
  assert.deepEqual(series.models.at(-1), { id: 'other', name: 'Other', total: 94 + 93 });
  assert.equal(sum(series.models.map(m => m.total)), series.total);
  assert.equal(sum(series.stacks.flat()), series.total);
});
