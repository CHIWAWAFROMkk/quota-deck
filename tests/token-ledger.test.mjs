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
const claudeLine = (id, at, usage) => JSON.stringify({ type: 'assistant', timestamp: new Date(at).toISOString(), message: { id, usage } });
const codexLine = (at, total) => JSON.stringify({ timestamp: new Date(at).toISOString(), type: 'event_msg', payload: { type: 'token_count', info: { total_token_usage: { total_tokens: total } } } });

test('windowStart aligns to local quarter hours and covers 96 buckets', () => {
  const now = new Date(2026, 9, 13, 10, 7, 30).getTime();
  assert.equal(ledger.windowStart(now), new Date(2026, 9, 13, 10, 0).getTime() - 95 * QUARTER);
});

test('line parsers ignore anything that is not a usage record', () => {
  assert.equal(ledger.parseClaudeLine('{broken'), null);
  assert.equal(ledger.parseClaudeLine(JSON.stringify({ type: 'user', timestamp: '2026-10-13T00:00:00Z', message: { id: 'x', usage: {} } })), null);
  assert.deepEqual(ledger.parseClaudeLine(claudeLine('m', 0, { input_tokens: 2, output_tokens: 3, cache_creation_input_tokens: 5, cache_read_input_tokens: 7, output_tokens_details: { thinking_tokens: 99 } })), { id: 'm', at: 0, tokens: 17 });
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
