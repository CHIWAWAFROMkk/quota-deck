import test from 'node:test';
import assert from 'node:assert/strict';
import view from '../src/main/hud-view.cjs';
import snapshots from '../src/main/snapshot.cjs';
import oauth from '../src/main/claude-oauth.cjs';

const now = Date.parse('2026-10-13T08:00:00Z');
const soon = new Date(now + 2 * 3600000).toISOString();
const later = new Date(now + 3 * 86400000).toISOString();
const codex = remaining => snapshots.providerToUi({ id: 'codex', name: 'Codex', status: 'healthy', precision: 'provider-reported', updatedAt: new Date(now).toISOString(), remainingPercent: remaining, windows: [{ label: '主窗口', remainingPercent: remaining, windowDurationMins: 300, resetsAt: soon }, { label: '周窗口', remainingPercent: 88, windowDurationMins: 10080, resetsAt: later }], models: [] });
const item = (ui, id) => view.buildHudItems(ui, now).find(entry => entry.id === id);

test('always five items in a fixed order, placeholders for missing providers', () => {
  const items = view.buildHudItems({ providers: [] }, now);
  assert.deepEqual(items.map(entry => entry.id), view.HUD_ORDER);
  assert.deepEqual(items[0].ring, { usedPct: null, level: 'none', dashed: false });
  assert.equal(items[0].label, '–');
  assert.equal(items[0].logo, 'codex.svg');
});

test('ring shows the most used window, coloured by thresholds', () => {
  const cases = [[31, 69, 'ok'], [30, 70, 'warn'], [11, 89, 'warn'], [10, 90, 'high'], [0, 100, 'high']];
  for (const [remaining, used, level] of cases) {
    const entry = item({ providers: [codex(remaining)] }, 'codex');
    assert.deepEqual(entry.ring, { usedPct: used, level, dashed: false }, `remaining ${remaining}`);
    assert.equal(entry.label, `${used}%`);
  }
  const entry = item({ providers: [codex(31)] }, 'codex');
  assert.deepEqual(entry.pill, [{ name: '5h', text: '69%', level: 'ok' }, { name: '周', text: '12%', level: 'ok' }]);
  assert.equal(entry.card.rows[0].label, '5 小时');
  assert.equal(entry.card.rows[0].burn, '采样中');
  assert.equal(entry.card.tokens, true);
});

test('Claude rows come from its pool with short labels', () => {
  const raw = oauth.parseUsage({ five_hour: { utilization: 12, resets_at: soon }, seven_day: { utilization: 79, resets_at: later }, seven_day_opus: { utilization: 60, resets_at: later } }, 'max', now);
  const entry = item({ providers: [snapshots.providerToUi(raw)] }, 'claude');
  assert.deepEqual(entry.pill.map(p => `${p.name} ${p.text}`), ['5h 12%', '周 79%', 'Opus 60%']);
  assert.deepEqual(entry.ring, { usedPct: 79, level: 'warn', dashed: false });
  assert.equal(entry.card.plan, 'Claude Max · 官方用量接口');
});

test('stale, unknown and balance providers are never drawn as 0%', () => {
  const stale = item({ providers: [{ ...codex(50), status: 'stale', gauge: { ...codex(50).gauge, provenance: 'stale' } }] }, 'codex');
  assert.equal(stale.ring.dashed, true);
  assert.equal(stale.card.stale, true);
  assert.match(stale.card.note, /旧数据/);

  const broken = item({ providers: [snapshots.providerToUi({ id: 'antigravity', name: 'Antigravity', status: 'error', models: [] })] }, 'antigravity');
  assert.deepEqual(broken.ring, { usedPct: null, level: 'none', dashed: false });
  assert.equal(broken.label, '–');
  assert.deepEqual(broken.pill, [{ name: '', text: '异常', level: 'none' }]);

  const wallet = item({ providers: [snapshots.providerToUi({ id: 'deepseek', name: 'DeepSeek', status: 'healthy', precision: 'provider-reported', updatedAt: new Date(now).toISOString(), balances: [{ currency: 'CNY', total_balance: '8.85' }], models: [] })] }, 'deepseek');
  assert.equal(wallet.label, '¥8.85');
  assert.equal(wallet.ring.usedPct, null);
  assert.equal(wallet.card.balance, '¥8.85');
  assert.equal(wallet.card.tokens, false);
});

test('reset text is a time today, a weekday later, and honest when unknown', () => {
  const local = new Date(now + 2 * 3600000);
  const hm = `${String(local.getHours()).padStart(2, '0')}:${String(local.getMinutes()).padStart(2, '0')}`;
  assert.equal(view.resetText(soon, now), `${hm} 重置`);
  assert.match(view.resetText(later, now), /^周[日一二三四五六] \d\d:\d\d 重置$/);
  assert.equal(view.resetText(null, now), '重置时间未知');
  assert.equal(view.resetText('bad', now), '重置时间未知');
  assert.equal(view.resetText(new Date(now - 1).toISOString(), now), '待重置');
});
