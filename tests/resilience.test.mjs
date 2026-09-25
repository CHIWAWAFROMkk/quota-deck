import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import path from 'node:path';
import snapshot from '../src/main/snapshot.cjs';
import ag from '../src/main/antigravity-client.cjs';
import { createHistory } from '../src/main/quota-history.cjs';

test('failed refresh preserves timestamp and models, then recovers', async () => {
  let fail = false;
  const read = snapshot.createProviderReader({ demo: async () => {
    if (fail) throw new Error('secret diagnostic must not escape');
    return { id: 'demo', status: 'healthy', updatedAt: '2026-09-15T00:00:00Z', models: [{ name: 'A' }] };
  } });
  const first = await read('demo');
  fail = true;
  const stale = await read('demo');
  assert.equal(stale.updatedAt, first.updatedAt);
  assert.equal(stale.models.length, 1);
  assert.equal(stale.status, 'stale');
  assert.doesNotMatch(JSON.stringify(stale), /secret diagnostic/);
  assert.match(snapshot.toUiSnapshot({ updatedAt: first.updatedAt, providers: [stale] }).globalStatus, /检查/);
  fail = false;
  assert.equal((await read('demo')).status, 'healthy');
});

test('simultaneous refreshes share a provider request', async () => {
  let calls = 0;
  const read = snapshot.createProviderReader({ demo: async () => { calls++; return { status: 'healthy' }; } });
  await Promise.all([read('demo'), read('demo')]);
  assert.equal(calls, 1);
});

test('local model directory preserves selectable IDs, excludes internal-only configs and deduplicates IDs', () => {
  const models = ag.parseLocalModelDirectory({
    agentModelSorts: [{ groups: [{ modelIds: ['gemini-test', 'unknown-id', 'gemini-test'] }] }],
    models: { 'gemini-test': { displayName: 'Gemini test' }, 'internal': { displayName: 'Not selectable' } },
  });
  assert.deepEqual(models, [{ id: 'gemini-test', name: 'Gemini test' }, { id: 'unknown-id', name: 'unknown-id' }]);
  assert.throws(() => ag.parseLocalModelDirectory({ models: {} }));
});

test('local directory succeeds without launching CLI; failed local query falls back', async () => {
  let cliCalls = 0;
  const cli = async () => { cliCalls++; return [{ id: 'fallback', name: 'Fallback' }]; };
  const request = async () => ({ agentModelSorts: [{ groups: [{ modelIds: ['local'] }] }], models: { local: { displayName: 'Local' } } });
  assert.equal((await ag.readModelDirectory(1234, 'test', '', request, cli)).models[0].id, 'local');
  assert.equal(cliCalls, 0);
  assert.equal((await ag.readModelDirectory(1234, 'test', '', async () => { throw new Error('offline'); }, cli)).models[0].id, 'fallback');
  assert.equal(cliCalls, 1);
});

test('unknown model and invalid fractions do not inherit quota', () => {
  const normalized = ag.normalizeAntigravitySnapshot({ groups: [{ displayName: 'Gemini Models', buckets: [
    { bucketId: 'session', remaining: { remainingFraction: .7 } },
    { bucketId: 'weekly', remainingFraction: null },
    { bucketId: 'other', remainingFraction: 2 },
  ] }] }, [{ id: 'new-family', name: 'New model' }, { id: 'gemini-pro', name: 'Gemini' }]);
  const ui = snapshot.providerToUi(normalized);
  assert.equal(ui.models[0].percent, null);
  assert.equal(ui.models[0].pool, '额度归属待确认');
  assert.equal(ui.pools[0].windows[0].remainingPercent, 70);
  assert.equal(ui.pools[0].windows[1].remainingPercent, null);
  assert.equal(ui.pools[0].windows[2].label, '未知窗口');
});

test('legacy fallback keeps missing fractions unknown and does not invent weekly quota', () => {
  const value = ag.normalizeLegacySnapshot({ userStatus: { cascadeModelConfigData: { clientModelConfigs: [
    { label: 'Example', quotaInfo: { remainingFraction: .5 } },
    { label: 'Unknown', quotaInfo: { resetTime: '2026-09-16T00:00:00Z' } },
  ] } } });
  assert.equal(value.models.length, 2);
  assert.equal(value.models[1].remainingPercent, null);
  assert.equal(value.groups.length, 0);
  assert.match(value.quotaNote, /周额度未知/);
  assert.throws(() => ag.normalizeLegacySnapshot({}));
});

test('history survives reopen and breaks on top-up, reset and long gaps', async () => {
  const dir = await mkdtemp(path.resolve('work/history-test-'));
  const file = path.join(dir, 'history.json');
  let history = createHistory(file);
  const start = Date.parse('2026-09-15T00:00:00Z');
  const sample = async (minutes, value, reset = '2026-09-16T00:00:00Z') => {
    const data = { id: 'antigravity', historyScope: 'test-account', groups: [{ displayName: 'test', buckets: [{ bucketId: 'weekly', resetTime: reset, remainingFraction: value }] }] };
    await history.record(data, start + minutes * 60000);
    return data.groups[0].buckets[0];
  };
  assert.equal((await sample(0, .8)).burnPerHour, null);
  await sample(3, .77);
  history = createHistory(file);
  const rate = await sample(6, .74);
  assert.ok(Math.abs(rate.burnPerHour - 60) < 1e-8);
  assert.ok(rate.estimatedHoursLeft > 1);
  assert.equal((await sample(7, .9)).burnPerHour, null);
  assert.equal((await sample(8, .89, '2026-09-17T00:00:00Z')).burnPerHour, null);
  assert.equal((await sample(30, .7)).burnPerHour, null);
});
