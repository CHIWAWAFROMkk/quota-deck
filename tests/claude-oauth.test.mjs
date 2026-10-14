import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import oauth from '../src/main/claude-oauth.cjs';

const now = Date.parse('2026-10-13T08:00:00Z');
const TOKEN = 'sk-ant-oat-secret-token';
const good = { claudeAiOauth: { accessToken: TOKEN, subscriptionType: 'max' } };
const body = {
  five_hour: { utilization: 12.4, resets_at: '2026-10-13T10:00:00Z' },
  seven_day: { utilization: 79, resets_at: '2026-10-15T03:54:00Z' },
  seven_day_opus: { utilization: 130, resets_at: 'not a date' },
  seven_day_sonnet: null,
  extra_usage: { utilization: 99, is_enabled: true },
};
const reply = (status, json) => async () => ({ status, ok: status >= 200 && status < 300, json: async () => json });

async function credentials(content) {
  await mkdir('work', { recursive: true });
  const dir = await mkdtemp(path.resolve('work/oauth-test-'));
  const file = path.join(dir, '.credentials.json');
  if (content !== undefined) await writeFile(file, typeof content === 'string' ? content : JSON.stringify(content));
  return file;
}

test('parseUsage keeps only quota windows, clamps and orders them', () => {
  const s = oauth.parseUsage(body, 'max', now);
  assert.deepEqual(s.windows.map(w => w.id), ['five_hour', 'seven_day', 'seven_day_opus']);
  assert.deepEqual(s.windows.map(w => w.label), ['5 小时', '每周', '每周 · Opus']);
  assert.equal(s.windows[0].remainingPercent, 87.6);
  assert.equal(s.windows[2].remainingPercent, 0);
  assert.equal(s.windows[2].resetsAt, null);
  assert.equal(s.remainingPercent, 0);
  assert.equal(s.status, 'critical');
  assert.equal(s.source, oauth.OAUTH_SOURCE);
  assert.equal(s.planType, 'max');
  assert.deepEqual(s.groups[0].buckets.map(b => b.bucketId), ['five_hour', 'seven_day', 'seven_day_opus']);
  assert.ok(Math.abs(s.groups[0].buckets[0].remainingFraction - 0.876) < 1e-9);
});

test('parseUsage rejects payloads without a five hour window', () => {
  assert.equal(oauth.parseUsage({ seven_day: { utilization: 1 } }, '', now), null);
  assert.equal(oauth.parseUsage([], '', now), null);
  assert.equal(oauth.parseUsage(null, '', now), null);
  assert.equal(oauth.parseUsage({ five_hour: { utilization: '12' } }, '', now), null);
});

test('reader sends the token only in the Authorization header and never returns it', async () => {
  const file = await credentials(good);
  let seen;
  const read = oauth.createClaudeOAuthReader({ credentialsPath: file, now: () => now, fetchImpl: async (url, init) => { seen = { url, init }; return reply(200, body)(); } });
  const result = await read();
  assert.equal(result.ok, true);
  assert.equal(seen.url, oauth.USAGE_URL);
  assert.equal(seen.init.headers.Authorization, `Bearer ${TOKEN}`);
  assert.equal(seen.init.headers['anthropic-beta'], 'oauth-2025-04-20');
  assert.ok(seen.init.signal);
  assert.doesNotMatch(JSON.stringify(result), /secret-token/);
});

test('reader maps failures to reasons without leaking the token', async () => {
  const file = await credentials(good);
  const cases = [
    [reply(401, {}), 'expired'],
    [reply(403, {}), 'expired'],
    [reply(500, {}), 'network'],
    [async () => { throw new Error(`boom ${TOKEN}`); }, 'network'],
    [reply(200, { nope: 1 }), 'bad-response'],
    [async () => ({ status: 200, ok: true, json: async () => { throw new SyntaxError('x'); } }), 'bad-response'],
  ];
  for (const [fetchImpl, reason] of cases) {
    const result = await oauth.createClaudeOAuthReader({ credentialsPath: file, now: () => now, fetchImpl })();
    assert.deepEqual(result, { ok: false, reason });
  }
  assert.deepEqual(await oauth.createClaudeOAuthReader({ credentialsPath: await credentials(), fetchImpl: reply(200, body) })(), { ok: false, reason: 'no-credentials' });
  assert.deepEqual(await oauth.createClaudeOAuthReader({ credentialsPath: await credentials('{broken'), fetchImpl: reply(200, body) })(), { ok: false, reason: 'no-credentials' });
  assert.deepEqual(await oauth.createClaudeOAuthReader({ credentialsPath: await credentials({ claudeAiOauth: { accessToken: '' } }), fetchImpl: reply(200, body) })(), { ok: false, reason: 'no-credentials' });
});

test('429 backs off, doubling, and a success resets the backoff', async () => {
  const file = await credentials(good);
  let t = now;
  let calls = 0;
  let status = 429;
  const read = oauth.createClaudeOAuthReader({ credentialsPath: file, now: () => t, fetchImpl: async () => { calls++; return reply(status, body)(); } });
  assert.equal((await read()).reason, 'rate-limited'); // waits 2 min
  t += 60_000; assert.equal((await read()).reason, 'rate-limited'); assert.equal(calls, 1);
  t += 61_000; await read(); assert.equal(calls, 2); // now waits 4 min
  t += 239_000; await read(); assert.equal(calls, 2);
  t += 2_000; status = 200; assert.equal((await read()).ok, true); assert.equal(calls, 3);
  status = 429; t += 300_001; await read(); t += 121_000; await read(); assert.equal(calls, 5);
});

test('credentials saved with a UTF-8 BOM are still read', async () => {
  const file = await credentials('﻿' + JSON.stringify(good));
  const result = await oauth.createClaudeOAuthReader({ credentialsPath: file, now: () => now, fetchImpl: reply(200, body) })();
  assert.equal(result.ok, true);
});

test('a good reading is reused for five minutes and kept for when the API fails', async () => {
  const file = await credentials(good);
  let t = now;
  let calls = 0;
  let status = 200;
  const read = oauth.createClaudeOAuthReader({ credentialsPath: file, now: () => t, fetchImpl: async () => { calls++; return reply(status, body)(); } });
  const first = await read();
  assert.equal(first.ok, true);
  t += 4 * 60_000;
  const cached = await read();
  assert.equal(calls, 1);
  assert.equal(cached.snapshot.updatedAt, first.snapshot.updatedAt);
  t += 2 * 60_000;
  status = 429;
  const limited = await read();
  assert.equal(calls, 2);
  assert.equal(limited.ok, false);
  assert.equal(limited.reason, 'rate-limited');
  assert.equal(limited.last.updatedAt, first.snapshot.updatedAt);
  assert.doesNotMatch(JSON.stringify(limited), /secret-token/);
});
