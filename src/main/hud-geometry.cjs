const MARGIN = 3;
// Big enough for the strip at size 40 plus a 6px gap and the 440px card.
const WINDOW = Object.freeze({ width: 640, height: 600 });
const EDGES = ['left', 'right', 'top', 'bottom'];
const PROVIDERS = ['codex', 'claude', 'antigravity', 'workbuddy', 'deepseek'];
const METRICS = ['quota', 'burn', 'tokens'];
// Size 22 with numbers and five items; used until the renderer reports what it measured.
const DEFAULT_STRIPS = Object.freeze({ vertical: Object.freeze({ width: 92, height: 164 }), horizontal: Object.freeze({ width: 390, height: 30 }) });
const DEFAULT_GAMES = Object.freeze(['cs2.exe', 'tlou-ii.exe', 'tlou-ii-l.exe', 'javaw.exe']);
const DEFAULT_SETTINGS = Object.freeze({ displayId: null, edge: 'right', offset: 0.3, visible: true, style: 'strip', games: DEFAULT_GAMES, size: 22, ringWidth: 1.5, showsRings: true, showsNumbers: true, metrics: Object.freeze({}) });

const clamp = (value, low, high) => Math.min(high, Math.max(low, value));
const isVertical = edge => edge === 'left' || edge === 'right';
const isPlainObject = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

function normalizeHudSettings(raw) {
  const r = isPlainObject(raw) ? raw : {};
  const metrics = {};
  if (isPlainObject(r.metrics)) for (const id of PROVIDERS) if (Object.hasOwn(r.metrics, id) && METRICS.includes(r.metrics[id])) metrics[id] = r.metrics[id];
  return {
    displayId: Number.isSafeInteger(r.displayId) ? r.displayId : null,
    edge: EDGES.includes(r.edge) ? r.edge : DEFAULT_SETTINGS.edge,
    offset: Number.isFinite(r.offset) ? clamp(r.offset, 0, 1) : DEFAULT_SETTINGS.offset,
    visible: typeof r.visible === 'boolean' ? r.visible : DEFAULT_SETTINGS.visible,
    style: isValidSetting('style', r.style) ? r.style : DEFAULT_SETTINGS.style,
    games: Array.isArray(r.games)
      ? [...new Set(r.games.filter(v => typeof v === 'string' && /^[^\\/:*?"<>|\x00-\x1f]{1,60}\.exe$/i.test(v)).map(v => v.toLowerCase()))].slice(0, 40)
      : [...DEFAULT_GAMES],
    size: Number.isInteger(r.size) && r.size >= 16 && r.size <= 40 ? r.size : DEFAULT_SETTINGS.size,
    ringWidth: Number.isFinite(r.ringWidth) && r.ringWidth >= 1 && r.ringWidth <= 4 ? Math.round(r.ringWidth * 2) / 2 : DEFAULT_SETTINGS.ringWidth,
    showsRings: typeof r.showsRings === 'boolean' ? r.showsRings : DEFAULT_SETTINGS.showsRings,
    showsNumbers: typeof r.showsNumbers === 'boolean' ? r.showsNumbers : DEFAULT_SETTINGS.showsNumbers,
    metrics,
  };
}

/** Whether a single display setting from the page is acceptable; same rules as normalizeHudSettings. */
function isValidSetting(key, value) {
  if (key === 'style') return value === 'strip' || value === 'notch';
  if (key === 'size') return Number.isInteger(value) && value >= 16 && value <= 40;
  if (key === 'ringWidth') return Number.isFinite(value) && value >= 1 && value <= 4;
  if (key === 'showsRings' || key === 'showsNumbers') return typeof value === 'boolean';
  if (key === 'metrics') return isPlainObject(value);
  return false;
}

/** Strip sizes the renderer measured for both orientations, or null when either is unusable. */
function normalizeStrips(raw) {
  const one = s => (isPlainObject(s) && [s.width, s.height].every(v => typeof v === 'number' && Number.isFinite(v) && v >= 8 && v <= 1200)
    ? { width: Math.ceil(s.width), height: Math.ceil(s.height) } : null);
  if (!isPlainObject(raw)) return null;
  const vertical = one(raw.vertical);
  const horizontal = one(raw.horizontal);
  return vertical && horizontal ? { vertical, horizontal } : null;
}

/** Window rectangle in screen coordinates, and the strip's rectangle inside it. */
function layoutHud({ workArea: wa, edge, offset, strips = DEFAULT_STRIPS }) {
  const vertical = isVertical(edge);
  const strip = vertical ? strips.vertical : strips.horizontal;
  const width = Math.min(wa.width, Math.max(WINDOW.width, vertical ? 0 : strip.width + 16));
  const height = Math.min(wa.height, Math.max(WINDOW.height, vertical ? strip.height + 16 : 0));
  const along = clamp(Number.isFinite(offset) ? offset : DEFAULT_SETTINGS.offset, 0, 1);
  let sx; let sy; let wx; let wy;
  if (vertical) {
    sy = Math.round(wa.y + along * Math.max(0, wa.height - strip.height));
    sx = edge === 'left' ? wa.x + MARGIN : wa.x + wa.width - MARGIN - strip.width;
    wx = edge === 'left' ? wa.x : wa.x + wa.width - width;
    wy = Math.round(clamp(sy + strip.height / 2 - height / 2, wa.y, wa.y + wa.height - height));
  } else {
    sx = Math.round(wa.x + along * Math.max(0, wa.width - strip.width));
    sy = edge === 'top' ? wa.y + MARGIN : wa.y + wa.height - MARGIN - strip.height;
    wy = edge === 'top' ? wa.y : wa.y + wa.height - height;
    wx = Math.round(clamp(sx + strip.width / 2 - width / 2, wa.x, wa.x + wa.width - width));
  }
  return { window: { x: wx, y: wy, width, height }, strip: { x: sx - wx, y: sy - wy, width: strip.width, height: strip.height }, edge };
}

/** Fixed top-centre capsule, independent of the saved strip position. */
function layoutNotch({ workArea: wa }) {
  const width = Math.min(wa.width, WINDOW.width);
  const height = Math.min(wa.height, WINDOW.height);
  return {
    window: { x: Math.round(wa.x + (wa.width - width) / 2), y: wa.y, width, height },
    notch: { x: (width - 200) / 2, y: 0, width: 200, height: 30 },
    edge: 'top', mode: 'notch',
  };
}

/**
 * Edge nearest the pointer (a tie keeps `current`) and the position along it that keeps
 * the grabbed point — `grabAlong` px from the strip's start — under the pointer.
 */
function snapToEdge({ workArea: wa, cursor, grabAlong = 0, strips = DEFAULT_STRIPS, current = null }) {
  const px = clamp(cursor.x, wa.x, wa.x + wa.width);
  const py = clamp(cursor.y, wa.y, wa.y + wa.height);
  const distance = { left: px - wa.x, right: wa.x + wa.width - px, top: py - wa.y, bottom: wa.y + wa.height - py };
  let edge = EDGES.reduce((best, candidate) => (distance[candidate] < distance[best] ? candidate : best), EDGES[0]);
  if (EDGES.includes(current) && distance[current] === distance[edge]) edge = current;
  const vertical = isVertical(edge);
  const strip = vertical ? strips.vertical : strips.horizontal;
  const long = vertical ? strip.height : strip.width;
  const start = (vertical ? py - wa.y : px - wa.x) - clamp(grabAlong, 0, long);
  const room = (vertical ? wa.height : wa.width) - long;
  return { edge, offset: room > 0 ? clamp(start / room, 0, 1) : 0 };
}

/** Hit rectangles (window-relative px) reported by the renderer, validated; at most four. */
function normalizeHits(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, 4)
    .filter(r => r && typeof r === 'object' && ['x', 'y', 'width', 'height'].every(key => Number.isFinite(r[key])) && r.width > 0 && r.height > 0 && r.width <= 4096 && r.height <= 4096)
    .map(r => ({ x: r.x, y: r.y, width: r.width, height: r.height }));
}

/** Whether a screen point lies over a hit rectangle of the window at `bounds`, give or take `margin`. */
function pointerOverHits({ cursor, bounds, hits, margin = 2 }) {
  const x = cursor.x - bounds.x;
  const y = cursor.y - bounds.y;
  return hits.some(r => x >= r.x - margin && x <= r.x + r.width + margin && y >= r.y - margin && y <= r.y + r.height + margin);
}

/** The saved display if it is still connected, otherwise the primary one. */
function pickDisplay(displays, primary, displayId) {
  return displays.find(display => display.id === displayId) || primary;
}

module.exports = { DEFAULT_GAMES, DEFAULT_SETTINGS, DEFAULT_STRIPS, EDGES, MARGIN, WINDOW, isValidSetting, layoutHud, layoutNotch, normalizeHits, normalizeHudSettings, normalizeStrips, pickDisplay, pointerOverHits, snapToEdge };
