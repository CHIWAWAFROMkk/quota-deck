import test from 'node:test';
import assert from 'node:assert/strict';
import view from '../src/main/hud-view.cjs';
import snapshots from '../src/main/snapshot.cjs';
import oauth from '../src/main/claude-oauth.cjs';

// Local Tuesday 13 October 2026, 08:00 — the same clock the tests' expected texts use.
const now = new Date(2026, 9, 13, 8, 0).getTime();
const at = minutes => new Date(now + minutes * 60000).toISOString();
const saturday = new Date(2026, 9, 17, 18, 27).toISOString();
const item = (ui, id) => view.buildHudItems(ui, now).find(entry => entry.id === id);
const codexRaw = remaining => ({ id: 'codex', name: 'Codex', status: 'healthy', precision: 'provider-reported', planType: 'pro', updatedAt: new Date(now).toISOString(), remainingPercent: remaining, windows: [{ label: '主窗口', remainingPercent: remaining, windowDurationMins: 300, resetsAt: at(72) }, { label: '周窗口', remainingPercent: 88, windowDurationMins: 10080, resetsAt: saturday }], models: [] });
const codex = remaining => snapshots.providerToUi(codexRaw(remaining));
function claude(usage, burns = []) {
  const raw = oauth.parseUsage(usage, 'max_20x', now);
  raw.groups[0].buckets.forEach((bucket, i) => { bucket.burnPerHour = burns[i] ?? null; });
  return snapshots.providerToUi(raw);
}
const wallet = (currency, amount) => snapshots.providerToUi({ id: 'deepseek', name: 'DeepSeek', status: 'healthy', precision: 'provider-reported', updatedAt: new Date(now).toISOString(), balances: [{ currency, total_balance: amount }], models: [] });

test('always five items in the video order, placeholders while nothing is read', () => {
  const items = view.buildHudItems({ providers: [] }, now);
  assert.deepEqual(items.map(entry => entry.id), ['codex', 'claude', 'antigravity', 'workbuddy', 'deepseek']);
  assert.deepEqual(items[0].ring, { usedPct: null, level: 'none', dashed: false });
  assert.equal(items[0].label, '–');
  assert.equal(items[0].state, 'loading');
  assert.deepEqual(items[0].pill, [{ name: '', value: 'Codex', level: 'none' }]);
});

test('ring shows the most used window, coloured by thresholds, with English rows', () => {
  const cases = [[31, 69, 'ok'], [30, 70, 'warn'], [11, 89, 'warn'], [10, 90, 'high'], [0, 100, 'high']];
  for (const [remaining, used, level] of cases) {
    const entry = item({ providers: [codex(remaining)] }, 'codex');
    assert.deepEqual(entry.ring, { usedPct: used, level, dashed: false }, `remaining ${remaining}`);
    assert.equal(entry.label, `${used}%`);
  }
  const entry = item({ providers: [codex(31)] }, 'codex');
  assert.deepEqual(entry.pill, [{ name: '5h', value: '69%', level: 'ok' }, { name: 'Weekly', value: '12%', level: 'ok' }]);
  assert.deepEqual(entry.card.rows.map(row => row.name), ['5h limit', 'Weekly limit']);
  assert.equal(entry.card.plan, 'Pro');
  assert.equal(entry.card.account, 'Current account');
  assert.equal(entry.card.tokens, true);
  assert.equal(entry.state, 'live');
});

test('Claude rows read like the video', () => {
  const entry = item({ providers: [claude({ five_hour: { utilization: 12, resets_at: at(72) }, seven_day: { utilization: 79, resets_at: saturday }, seven_day_opus: { utilization: 60, resets_at: saturday } })] }, 'claude');
  assert.equal(entry.name, 'Claude');
  assert.deepEqual(entry.card.rows.map(row => [row.name, row.usedPct, row.level, row.reset]), [
    ['Current session', 12, 'ok', '1h 12m'],
    ['Weekly', 79, 'warn', 'Sat 18:27'],
    ['Weekly limit · Opus', 60, 'ok', 'Sat 18:27'],
  ]);
  assert.deepEqual(entry.pill.map(p => `${p.name} ${p.value}`), ['5h 12%', 'Weekly 79%', 'Opus 60%']);
  assert.deepEqual(entry.ring, { usedPct: 79, level: 'warn', dashed: false });
  assert.equal(entry.card.plan, 'Max x20');
});

test('reset and burn text cover past, missing and exhausted windows', () => {
  assert.equal(view.resetText(at(72), now), '1h 12m');
  assert.equal(view.resetText(at(242), now), '4h 02m');
  assert.equal(view.resetText(at(51), now), '51m');
  assert.equal(view.resetText(at(0.5), now), '<1m');
  assert.equal(view.resetText(saturday, now), 'Sat 18:27');
  assert.equal(view.resetText(null, now), '—');
  assert.equal(view.resetText('bad', now), '—');
  assert.equal(view.resetText(at(-1), now), 'Pending update');

  const rates = item({ providers: [claude({ five_hour: { utilization: 12, resets_at: at(72) }, seven_day: { utilization: 79, resets_at: saturday }, seven_day_opus: { utilization: 60, resets_at: saturday } }, [6.3, 1.4, null])] }, 'claude');
  assert.deepEqual(rates.card.rows.map(row => [row.burn.value, row.burn.level, row.burn.detail]), [
    ['6.3%/h', 'ok', '20% by reset'],
    ['1.4%/h', 'warn', '23:00'],
    ['—', 'none', 'Insufficient data'],
  ]);
  assert.ok(Math.abs(rates.card.rows[0].burn.projectedPct - 19.56) < 0.01);

  const edges = item({ providers: [claude({ five_hour: { utilization: 100, resets_at: at(30) }, seven_day: { utilization: 10, resets_at: null } }, [5, 0])] }, 'claude');
  assert.deepEqual(edges.card.rows.map(row => row.burn.detail), ['Exhausted', 'No usage']);
  assert.equal(edges.card.rows[1].reset, '—');

  const stale = item({ providers: [{ ...codex(50), status: 'stale', updatedAt: new Date(now - 2 * 3600000).toISOString(), gauge: { ...codex(50).gauge, provenance: 'stale' } }] }, 'codex');
  assert.deepEqual(stale.card.rows.map(row => row.burn.detail), ['No estimate', 'No estimate']);
});

test('stale, failed and unconfigured providers are never drawn as 0%', () => {
  const stale = item({ providers: [{ ...codex(50), status: 'stale', updatedAt: new Date(now - 2 * 3600000).toISOString(), gauge: { ...codex(50).gauge, provenance: 'stale' } }] }, 'codex');
  assert.equal(stale.ring.dashed, true);
  assert.equal(stale.state, 'stale');
  assert.equal(stale.card.account, 'Last read 2h ago');
  assert.equal(stale.card.note, 'Showing the last reading.');

  const broken = item({ providers: [snapshots.providerToUi({ id: 'antigravity', name: 'Antigravity', status: 'error', models: [] })] }, 'antigravity');
  assert.deepEqual(broken.ring, { usedPct: null, level: 'none', dashed: false });
  assert.equal(broken.label, '–');
  assert.deepEqual(broken.pill, [{ name: '', value: 'Error', level: 'none' }]);
  assert.equal(broken.card.note, 'Could not read usage. Check sign-in or network.');
  assert.deepEqual(broken.card.rows, []);

  const missing = item({ providers: [snapshots.providerToUi({ id: 'deepseek', name: 'DeepSeek', status: 'disconnected', models: [] })] }, 'deepseek');
  assert.deepEqual(missing.pill, [{ name: '', value: 'Not connected', level: 'none' }]);
  assert.equal(missing.card.note, 'Set DEEPSEEK_API_KEY to read your balance.');
  assert.equal(missing.card.tokens, false);
});

test('balances use their own warning levels', () => {
  const low = item({ providers: [wallet('CNY', '8.85')] }, 'deepseek');
  assert.equal(low.label, '¥8.85');
  assert.deepEqual(low.ring, { usedPct: null, level: 'warn', dashed: false });
  assert.deepEqual(low.pill, [{ name: 'Balance', value: '¥8.85', level: 'warn' }]);
  assert.deepEqual(low.card.balance, { text: '¥8.85', level: 'warn' });
  assert.equal(item({ providers: [wallet('CNY', '20')] }, 'deepseek').ring.level, 'ok');
  assert.equal(item({ providers: [wallet('CNY', '0')] }, 'deepseek').ring.level, 'high');
  assert.equal(item({ providers: [wallet('USD', '1.5')] }, 'deepseek').label, '$1.50');
  assert.equal(item({ providers: [wallet('USD', '1.5')] }, 'deepseek').ring.level, 'warn');
});

test('balances that cannot be parsed stay unknown', () => {
  const odd = item({ providers: [wallet('EUR', '3')] }, 'deepseek');
  assert.equal(odd.label, '–');
  assert.deepEqual(odd.ring, { usedPct: null, level: 'none', dashed: false });
  assert.equal(odd.card.balance, null);
});

test('token data gets per-hour and per-day texts', () => {
  const buckets = new Array(96).fill(0);
  buckets.fill(300_000, 92);
  buckets[0] = 30_200_000;
  const tokens = view.buildHudTokens({ claude: { status: 'ok', buckets, total: 31_400_000, startAt: 0, partial: false, models: [], stacks: [] }, codex: { status: 'unsupported', buckets: new Array(96).fill(0), total: 0, startAt: 0, partial: false, models: [], stacks: [] } });
  assert.equal(tokens.claude.perHour, '1.2M/h');
  assert.equal(tokens.claude.perDay, '31M / day');
  assert.equal(tokens.claude.totalText, '31M tok');
  assert.equal(tokens.codex.perHour, '0/h');
  assert.deepEqual([950, 1234, 123456, 9_960_000, 2_500_000_000].map(view.compact), ['950', '1.2K', '123K', '10M', '2.5B']);
});
