import test from 'node:test';
import assert from 'node:assert/strict';
import m from '../src/renderer/hud-notch-metrics.js';

const item = (id, level) => ({ id, ring: { usedPct: level === 'none' ? null : 50, level } });
const five = levels => ['codex', 'claude', 'antigravity', 'workbuddy', 'deepseek'].map((id, i) => item(id, levels[i]));
const alert = (vendor, kind, at, id = `${vendor}:${kind}:${at}`) => ({ id, vendor, kind, at });

test('notch dimensions match the spec', () => {
  assert.deepEqual(m.NOTCH, { width: 200, height: 30, wingsWidth: 456, wingsHeight: 38, ear: 8, radius: 12, wingsRadius: 14 });
});

test('stops sit at (i+0.5)/n in HUD order with level colours', () => {
  const { stops, allUnknown } = m.glowStops(five(['ok', 'warn', 'high', 'none', 'warn']));
  assert.equal(allUnknown, false);
  assert.deepEqual(stops.map(s => s.vendor), ['codex', 'claude', 'antigravity', 'workbuddy', 'deepseek']);
  assert.deepEqual(stops.map(s => s.offset), [0.1, 0.3, 0.5, 0.7, 0.9]);
  assert.deepEqual(stops.map(s => s.color), ['#3ddc84', '#ffd23f', '#ff453a', '#9a9aa0', '#ffd23f']);
});

test('all unknown means one grey still glow', () => {
  const { stops, allUnknown } = m.glowStops(five(['none', 'none', 'none', 'none', 'none']));
  assert.equal(allUnknown, true);
  assert.ok(stops.every(s => s.color === '#9a9aa0'));
  assert.deepEqual(m.glowStops([]), { stops: [], allUnknown: true });
  assert.deepEqual(m.glowStops(null), { stops: [], allUnknown: true });
});

test('breath is 3 s while any session runs, 7 s otherwise', () => {
  assert.equal(m.breathPeriod({ vendors: { claude: { running: 1 }, codex: { running: 0 } } }), 3000);
  assert.equal(m.breathPeriod({ vendors: { claude: { running: 0 }, codex: { running: 0 } } }), 7000);
  assert.equal(m.breathPeriod(null), 7000);
});

test('wing picks approval, then waiting, error, reply; newest within a kind; counts per vendor', () => {
  assert.equal(m.pickWing([]), null);
  assert.equal(m.pickWing(null), null);
  assert.deepEqual(m.pickWing([alert('claude', 'reply', 1), alert('codex', 'reply', 5)]), { vendor: 'codex', kind: 'reply', label: 'New reply', count: 1 });
  assert.deepEqual(m.pickWing([alert('claude', 'reply', 9), alert('codex', 'error', 1)]), { vendor: 'codex', kind: 'error', label: 'Stopped', count: 1 });
  assert.deepEqual(m.pickWing([alert('claude', 'error', 9), alert('codex', 'waiting', 1)]), { vendor: 'codex', kind: 'waiting', label: 'Waiting', count: 1 });
  assert.deepEqual(m.pickWing([alert('claude', 'waiting', 9), alert('claude', 'reply', 3), alert('codex', 'approval', 1)]), { vendor: 'codex', kind: 'approval', label: 'Approve?', count: 1 });
  assert.deepEqual(m.pickWing([alert('claude', 'reply', 1), alert('claude', 'reply', 2), alert('claude', 'error', 0)]), { vendor: 'claude', kind: 'error', label: 'Stopped', count: 3 });
  assert.equal(m.pickWing([{ vendor: 'claude' }, null, 'x']), null, 'malformed alerts are ignored');
});

test('pulse colours', () => {
  assert.equal(m.pulseColor('reply'), '#82aaff');
  for (const kind of ['waiting', 'approval', 'error']) assert.equal(m.pulseColor(kind), '#e9a16d');
});
