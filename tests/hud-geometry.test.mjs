import test from 'node:test';
import assert from 'node:assert/strict';
import geometry from '../src/main/hud-geometry.cjs';

const { DEFAULT_STRIPS, layoutHud, normalizeHudSettings, normalizeStrips, pickDisplay, snapToEdge } = geometry;
const wa = { x: 0, y: 0, width: 1920, height: 1040 };
const big = { vertical: { width: 160, height: 420 }, horizontal: { width: 700, height: 60 } };

test('layout docks the reported strip 3px from each edge, inside a 640×600 window', () => {
  assert.deepEqual(layoutHud({ workArea: wa, edge: 'right', offset: 0.3 }), { window: { x: 1280, y: 45, width: 640, height: 600 }, strip: { x: 545, y: 218, width: 92, height: 164 }, edge: 'right' });
  assert.deepEqual(layoutHud({ workArea: wa, edge: 'left', offset: 0 }).strip, { x: 3, y: 0, width: 92, height: 164 });
  assert.deepEqual(layoutHud({ workArea: wa, edge: 'top', offset: 1, strips: { ...DEFAULT_STRIPS, horizontal: { width: 390, height: 30 } } }), { window: { x: 1280, y: 0, width: 640, height: 600 }, strip: { x: 250, y: 3, width: 390, height: 30 }, edge: 'top' });
  const bottom = layoutHud({ workArea: wa, edge: 'bottom', offset: 0.5, strips: big });
  assert.equal(bottom.window.width, 716, 'a long horizontal strip widens the window');
  assert.equal(bottom.strip.y + bottom.strip.height, bottom.window.height - 3);
});

test('large strips stay inside the window and the work area', () => {
  const second = { x: -1280, y: 0, width: 1280, height: 1024 };
  const cases = [[wa, big], [second, big], [wa, DEFAULT_STRIPS], [{ x: 0, y: 0, width: 400, height: 300 }, DEFAULT_STRIPS]];
  for (const [area, strips] of cases) {
    for (const edge of geometry.EDGES) {
      for (const offset of [0, 0.25, 0.5, 1]) {
        const { window, strip } = layoutHud({ workArea: area, edge, offset, strips });
        const label = `${JSON.stringify(area)} ${edge} ${offset}`;
        assert.ok(strip.x >= 0 && strip.y >= 0 && strip.x + strip.width <= window.width && strip.y + strip.height <= window.height, label);
        assert.ok(window.x >= area.x && window.y >= area.y && window.x + window.width <= area.x + area.width && window.y + window.height <= area.y + area.height, label);
        const gap = { left: strip.x, right: window.width - strip.x - strip.width, top: strip.y, bottom: window.height - strip.y - strip.height }[edge];
        const flush = { left: window.x - area.x, right: area.x + area.width - window.x - window.width, top: window.y - area.y, bottom: area.y + area.height - window.y - window.height }[edge];
        assert.equal(gap + flush, 3, `${label} stays 3px off the edge`);
      }
    }
  }
});

test('snap follows the pointer to the nearest edge and keeps the grabbed point under it', () => {
  assert.deepEqual(snapToEdge({ workArea: wa, cursor: { x: 1910, y: 300 }, grabAlong: 82 }), { edge: 'right', offset: (300 - 82) / (1040 - 164) });
  const top = snapToEdge({ workArea: wa, cursor: { x: 900, y: 5 }, grabAlong: 37, strips: DEFAULT_STRIPS });
  assert.equal(top.edge, 'top');
  assert.ok(Math.abs(top.offset - (900 - 37) / (1920 - DEFAULT_STRIPS.horizontal.width)) < 1e-9);
  assert.deepEqual(snapToEdge({ workArea: wa, cursor: { x: 0, y: 0 }, grabAlong: 0, current: 'top' }).edge, 'top', 'a tie keeps the current edge');
  assert.deepEqual(snapToEdge({ workArea: wa, cursor: { x: 0, y: 0 }, grabAlong: 0 }).edge, 'left');
  assert.deepEqual(snapToEdge({ workArea: wa, cursor: { x: -500, y: 2000 }, grabAlong: 9999 }), { edge: 'left', offset: 1 });
  assert.deepEqual(snapToEdge({ workArea: wa, cursor: { x: 2, y: 10 }, grabAlong: 500 }), { edge: 'left', offset: 0 });
});

test('settings are validated and fall back to defaults', () => {
  assert.deepEqual(normalizeHudSettings(null), { ...geometry.DEFAULT_SETTINGS, metrics: {} });
  assert.deepEqual(normalizeHudSettings([1]), { ...geometry.DEFAULT_SETTINGS, metrics: {} });
  assert.deepEqual(normalizeHudSettings({ displayId: 7, edge: 'top', offset: 0.2, visible: false, size: 30, ringWidth: 2.3, showsRings: false, showsNumbers: false, metrics: { claude: 'burn', codex: 'tokens' } }),
    { displayId: 7, edge: 'top', offset: 0.2, visible: false, style: 'strip', games: geometry.DEFAULT_GAMES, size: 30, ringWidth: 2.5, showsRings: false, showsNumbers: false, metrics: { codex: 'tokens', claude: 'burn' } });
});

test('settings with junk values fall back to defaults', () => {
  const junk = normalizeHudSettings({ displayId: 1.5, edge: 'middle', offset: 5, visible: 'yes', size: 'big', ringWidth: 9, showsRings: 'no', showsNumbers: 1, metrics: { codex: 'x', claude: 'tokens', __proto__: { deepseek: 'burn' }, evil: 'burn' } });
  assert.deepEqual(junk, { displayId: null, edge: 'right', offset: 1, visible: true, style: 'strip', games: geometry.DEFAULT_GAMES, size: 22, ringWidth: 1.5, showsRings: true, showsNumbers: true, metrics: { claude: 'tokens' } });
  assert.equal(normalizeHudSettings({ size: 16.5 }).size, 22);
  assert.equal(normalizeHudSettings({ size: 41 }).size, 22);
  assert.deepEqual(normalizeHudSettings({ metrics: ['burn'] }).metrics, {});
});

test('strip sizes from the renderer are validated', () => {
  assert.deepEqual(normalizeStrips({ vertical: { width: 91.2, height: 164 }, horizontal: { width: 382, height: 30 } }), { vertical: { width: 92, height: 164 }, horizontal: { width: 382, height: 30 } });
  for (const bad of [null, 'x', { vertical: { width: 92, height: 164 } }, { vertical: { width: 0, height: 164 }, horizontal: { width: 382, height: 30 } }, { vertical: { width: 92, height: 5000 }, horizontal: { width: 382, height: 30 } }, { vertical: { width: '92', height: 164 }, horizontal: { width: 382, height: 30 } }]) {
    assert.equal(normalizeStrips(bad), null, JSON.stringify(bad));
  }
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
  const bounds = { x: 1280, y: 45, width: 640, height: 600 };
  const hits = [{ x: 545, y: 218, width: 92, height: 164 }];
  assert.equal(geometry.pointerOverHits({ cursor: { x: 1280 + 550, y: 45 + 250 }, bounds, hits }), true);
  assert.equal(geometry.pointerOverHits({ cursor: { x: 1280 + 544, y: 45 + 250 }, bounds, hits }), true);
  assert.equal(geometry.pointerOverHits({ cursor: { x: 1280 + 100, y: 45 + 100 }, bounds, hits }), false);
  assert.equal(geometry.pointerOverHits({ cursor: { x: 1280 + 550, y: 45 + 250 }, bounds, hits: [] }), false);
});

test('isValidSetting accepts exactly what normalizeHudSettings keeps', () => {
  const valid = [['size', 16], ['size', 40], ['ringWidth', 1], ['ringWidth', 2.3], ['ringWidth', 4], ['showsRings', false], ['showsNumbers', true], ['metrics', { claude: 'burn' }]];
  const invalid = [['size', 15], ['size', 41], ['size', 22.5], ['size', 'abc'], ['ringWidth', 0.5], ['ringWidth', 9], ['ringWidth', NaN], ['showsRings', 'yes'], ['showsNumbers', 1], ['metrics', ['burn']], ['metrics', null], ['edge', 'top']];
  for (const [key, value] of valid) assert.equal(geometry.isValidSetting(key, value), true, `${key}=${JSON.stringify(value)}`);
  for (const [key, value] of invalid) assert.equal(geometry.isValidSetting(key, value), false, `${key}=${JSON.stringify(value)}`);
});

test('notch layout sits at the top centre of the work area', () => {
  assert.deepEqual(geometry.layoutNotch({ workArea: wa }), {
    window: { x: 640, y: 0, width: 640, height: 600 },
    notch: { x: 220, y: 0, width: 200, height: 30 }, edge: 'top', mode: 'notch',
  });
  assert.deepEqual(geometry.layoutNotch({ workArea: { x: -1280, y: 40, width: 1280, height: 1024 } }).window,
    { x: -960, y: 40, width: 640, height: 600 });
  const small = geometry.layoutNotch({ workArea: { x: 100, y: -200, width: 400, height: 300 } });
  assert.deepEqual(small.window, { x: 100, y: -200, width: 400, height: 300 });
  assert.deepEqual(small.notch, { x: 100, y: 0, width: 200, height: 30 });
});

test('style is validated', () => {
  for (const style of ['strip', 'notch']) assert.equal(normalizeHudSettings({ style }).style, style);
  for (const style of [null, '', 'NOTCH', {}, 1]) assert.equal(normalizeHudSettings({ style }).style, 'strip');
});

test('games list is validated and kept across saves', () => {
  const defaults = ['cs2.exe', 'tlou-ii.exe', 'tlou-ii-l.exe', 'javaw.exe'];
  assert.deepEqual(geometry.DEFAULT_GAMES, defaults);
  for (const games of [undefined, null, {}, 'cs2.exe']) assert.deepEqual(normalizeHudSettings({ games }).games, defaults);
  const normalized = normalizeHudSettings({ games: ['CS2.EXE', 'bad', 'x.exe', 'x.exe', null, 3, '../evil.exe', 'a'.repeat(61) + '.exe'] });
  assert.deepEqual(normalized.games, ['cs2.exe', 'x.exe']);
  assert.deepEqual(normalizeHudSettings(JSON.parse(JSON.stringify(normalized))).games, ['cs2.exe', 'x.exe']);
  assert.deepEqual(normalizeHudSettings({ games: [] }).games, []);
  // Any legal file name counts, Chinese and '+' included; path separators and reserved characters do not.
  assert.deepEqual(normalizeHudSettings({ games: ['原神.exe', 'Notepad++.exe', 'a\\b.exe', 'a:b.exe', 'a*b.exe', 'a\nb.exe', '.exe'] }).games, ['原神.exe', 'notepad++.exe']);
  assert.equal(normalizeHudSettings({ games: Array.from({ length: 45 }, (_, i) => `game${i}.exe`) }).games.length, 40);
});

test('isValidSetting accepts only strip or notch for style', () => {
  for (const value of ['strip', 'notch']) assert.equal(geometry.isValidSetting('style', value), true);
  for (const value of [null, '', 'NOTCH', 1, {}]) assert.equal(geometry.isValidSetting('style', value), false);
  assert.equal(geometry.isValidSetting('games', ['x.exe']), false);
});
