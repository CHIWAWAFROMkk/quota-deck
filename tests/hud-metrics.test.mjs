import test from 'node:test';
import assert from 'node:assert/strict';
import m from '../src/renderer/hud-metrics.js';

const labels = [40, 40, 22, 40, 50];

test('default metrics match Agent HUD at size 22', () => {
  assert.deepEqual(m.metrics({ size: 22, showsRings: true, showsNumbers: true, vertical: true }), { logo: 12, mark: 22, font: 13, spacing: 5, gap: 10, lead: 5, trail: 10, cross: 7 });
  assert.deepEqual(m.metrics({ size: 22, showsRings: true, showsNumbers: false, vertical: false }), { logo: 12, mark: 22, font: 13, spacing: 5, gap: 7, lead: 5, trail: 5, cross: 4 });
  assert.deepEqual(m.metrics({ size: 22, showsRings: false, showsNumbers: true, vertical: true }), { logo: 15, mark: 15, font: 13, spacing: 5, gap: 10, lead: 10, trail: 10, cross: 7 });
  assert.equal(m.metrics({ size: 16, showsRings: true, showsNumbers: true, vertical: true }).font, 9);
});

test('strip sizes for both orientations', () => {
  assert.deepEqual(stripOf({ vertical: true, showsNumbers: true }), { width: 92, height: 164, radius: 16 });
  assert.deepEqual(stripOf({ vertical: true, showsNumbers: false }), { width: 32, height: 164, radius: 16 });
  assert.deepEqual(stripOf({ vertical: false, showsNumbers: true }), { width: 5 + (22 + 5) * 5 + 192 + 40 + 10, height: 30, radius: 15 });
  assert.deepEqual(stripOf({ vertical: false, showsNumbers: false }), { width: 148, height: 30, radius: 15 });
  assert.deepEqual(m.stripSize({ size: 22, showsRings: true, showsNumbers: true, vertical: true, labelWidths: [] }).height, 32);
  const big = m.stripSize({ size: 40, showsRings: true, showsNumbers: true, vertical: true, labelWidths: labels.map(w => w * 2) });
  assert.deepEqual([big.width, big.height, big.radius], [8 + 40 + 9 + 100 + 18, 10 * 2 + 5 * 40 + 4 * 18, 29]);
});

test('a press is a click only when short and still', () => {
  assert.equal(m.isClick({ dx: 0, dy: 0, ms: 120 }), true);
  assert.equal(m.isClick({ dx: 4, dy: 4, ms: 299 }), true);
  assert.equal(m.isClick({ dx: 5, dy: 5, ms: 100 }), false);
  assert.equal(m.isClick({ dx: 0, dy: 0, ms: 301 }), false);
});

function stripOf({ vertical, showsNumbers }) {
  const { width, height, radius } = m.stripSize({ size: 22, showsRings: true, showsNumbers, vertical, labelWidths: labels });
  return { width, height, radius };
}
