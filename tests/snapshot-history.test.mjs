import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp } from 'node:fs/promises';
import path from 'node:path';
import snapshots from '../src/main/snapshot.cjs';

async function historyFile() {
  await mkdir('work', { recursive: true });
  const dir = await mkdtemp(path.resolve('work/history-test-'));
  return path.join(dir, 'history.json');
}

test('Codex windows gain burn rates from history without growing pools', async () => {
  snapshots.configureHistory(await historyFile());
  const base = Date.now();
  const reset = new Date(base + 3 * 3600000).toISOString();
  const samples = [[-600000, 80], [-300000, 79], [0, 78]];
  let index = 0;
  const read = snapshots.createProviderReader({ codex: async () => {
    const [offset, remaining] = samples[index++];
    return { id: 'codex', name: 'Codex', status: 'healthy', precision: 'provider-reported', updatedAt: new Date(base + offset).toISOString(), remainingPercent: remaining, windows: [{ label: '主窗口', remainingPercent: remaining, windowDurationMins: 300, resetsAt: reset }], models: [] };
  } });
  let result;
  for (let i = 0; i < samples.length; i++) result = await read('codex');
  assert.equal(result.groups, undefined);
  assert.ok(Math.abs(result.windows[0].burnPerHour - 12) < 1e-6);
  const ui = snapshots.providerToUi(result);
  assert.equal(ui.pools.length, 0);
  assert.ok(Math.abs(ui.gauge.windows[0].burnPerHour - 12) < 1e-6);
});

test('Claude pools are sampled, and stale data shows no rate', async () => {
  snapshots.configureHistory(await historyFile());
  const base = Date.now();
  const reset = new Date(base + 3 * 3600000).toISOString();
  const samples = [[-600000, 0.5], [-300000, 0.49], [0, 0.48]];
  let index = 0;
  const read = snapshots.createProviderReader({ claude: async () => {
    const [offset, fraction] = samples[index++];
    return { id: 'claude', name: 'Claude Code', status: 'healthy', precision: 'provider-reported', updatedAt: new Date(base + offset).toISOString(), remainingPercent: fraction * 100, windows: [{ id: 'five_hour', label: '5 小时', remainingPercent: fraction * 100, resetsAt: reset }], models: [], groups: [{ displayName: 'Claude 订阅共享额度', buckets: [{ bucketId: 'five_hour', label: '5 小时', window: '5h', remainingFraction: fraction, resetTime: reset }] }] };
  } });
  let result;
  for (let i = 0; i < samples.length; i++) result = await read('claude');
  const ui = snapshots.providerToUi(result);
  assert.equal(ui.pools[0].windows[0].samplingSupported, true);
  assert.ok(Math.abs(ui.pools[0].windows[0].burnPerHour - 12) < 1e-6);
  const stale = snapshots.providerToUi({ ...result, status: 'stale', windows: [{ ...result.windows[0], burnPerHour: 12 }] });
  assert.equal(stale.gauge.windows[0].burnPerHour, null);
  assert.equal(stale.pools[0].windows[0].burnPerHour, null);
});
