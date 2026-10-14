import test from 'node:test';
import assert from 'node:assert/strict';
import geometry from '../src/main/hud-geometry.cjs';

const { STRIP, layoutHud, normalizeHudSettings, pickDisplay, snapToEdge } = geometry;
const wa = { x: 0, y: 0, width: 1920, height: 1040 };

test('layout docks the strip 3px from each edge, inside the window', () => {
  assert.deepEqual(layoutHud({ workArea: wa, edge: 'right', offset: 0.3 }), { window: { x: 1440, y: 104, width: 480, height: 480 }, strip: { x: 443, y: 161 }, edge: 'right' });
  assert.deepEqual(layoutHud({ workArea: wa, edge: 'left', offset: 0 }), { window: { x: 0, y: 0, width: 480, height: 480 }, strip: { x: 3, y: 0 }, edge: 'left' });
  assert.deepEqual(layoutHud({ workArea: wa, edge: 'top', offset: 1 }), { window: { x: 1440, y: 0, width: 480, height: 480 }, strip: { x: 322, y: 3 }, edge: 'top' });
  assert.deepEqual(layoutHud({ workArea: wa, edge: 'bottom', offset: 0.5 }).strip, { x: 240 - STRIP.long / 2, y: 443 });
});

test('the strip never leaves the window or the work area', () => {
  const second = { x: -1280, y: 0, width: 1280, height: 1024 };
  for (const area of [wa, second, { x: 0, y: 0, width: 400, height: 300 }]) {
    for (const edge of geometry.EDGES) {
      for (const offset of [0, 0.25, 0.5, 1]) {
        const { window, strip } = layoutHud({ workArea: area, edge, offset });
        const vertical = edge === 'left' || edge === 'right';
        const w = vertical ? STRIP.short : STRIP.long;
        const h = vertical ? STRIP.long : STRIP.short;
        assert.ok(strip.x >= 0 && strip.y >= 0 && strip.x + w <= window.width && strip.y + h <= window.height, `${edge} ${offset}`);
        assert.ok(window.x >= area.x && window.y >= area.y && window.x + window.width <= area.x + area.width && window.y + window.height <= area.y + area.height);
      }
    }
  }
});

test('snap picks the nearest edge and the position along it', () => {
  assert.deepEqual(snapToEdge({ workArea: wa, point: { x: 1900, y: 79 + 0.5 * (1040 - 158) } }), { edge: 'right', offset: 0.5 });
  assert.deepEqual(snapToEdge({ workArea: wa, point: { x: 400, y: 10 } }).edge, 'top');
  assert.deepEqual(snapToEdge({ workArea: wa, point: { x: 2, y: 1030 } }), { edge: 'left', offset: 1 });
  assert.deepEqual(snapToEdge({ workArea: wa, point: { x: -500, y: -500 } }), { edge: 'left', offset: 0 });
});

test('settings are validated and fall back to defaults', () => {
  assert.deepEqual(normalizeHudSettings(null), geometry.DEFAULT_SETTINGS);
  assert.deepEqual(normalizeHudSettings([1]), geometry.DEFAULT_SETTINGS);
  assert.deepEqual(normalizeHudSettings({ displayId: 1.5, edge: 'middle', offset: 5, visible: 'yes' }), { displayId: null, edge: 'right', offset: 1, visible: true });
  assert.deepEqual(normalizeHudSettings({ displayId: 7, edge: 'top', offset: 0.2, visible: false }), { displayId: 7, edge: 'top', offset: 0.2, visible: false });
});

test('a removed display falls back to the primary one', () => {
  const primary = { id: 1, workArea: wa };
  const other = { id: 2, workArea: wa };
  assert.equal(pickDisplay([primary, other], primary, 2), other);
  assert.equal(pickDisplay([primary], primary, 2), primary);
  assert.equal(pickDisplay([primary], primary, null), primary);
});

test('hit rectangles from the renderer are validated', () => {
  assert.deepEqual(geometry.normalizeHits('nope'), []);
  assert.deepEqual(geometry.normalizeHits([{ x: 1, y: 2, width: 3, height: 4, extra: 1 }, { x: NaN, y: 0, width: 1, height: 1 }, { x: 0, y: 0, width: 0, height: 5 }, null]), [{ x: 1, y: 2, width: 3, height: 4 }]);
  assert.equal(geometry.normalizeHits(Array.from({ length: 10 }, () => ({ x: 0, y: 0, width: 1, height: 1 }))).length, 4);
});

test('the pointer is over a hit area only inside its rectangle plus a small margin', () => {
  const bounds = { x: 1440, y: 104, width: 480, height: 480 };
  const hits = [{ x: 443, y: 161, width: 34, height: 158 }];
  assert.equal(geometry.pointerOverHits({ cursor: { x: 1440 + 450, y: 104 + 200 }, bounds, hits }), true);
  assert.equal(geometry.pointerOverHits({ cursor: { x: 1440 + 442, y: 104 + 200 }, bounds, hits }), true);
  assert.equal(geometry.pointerOverHits({ cursor: { x: 1440 + 100, y: 104 + 100 }, bounds, hits }), false);
  assert.equal(geometry.pointerOverHits({ cursor: { x: 1440 + 450, y: 104 + 200 }, bounds, hits: [] }), false);
});
