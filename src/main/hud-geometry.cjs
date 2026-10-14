const MARGIN = 3;
const WINDOW_SIZE = 480;
// Five 22px rings, 8px gaps, 8px end padding and 6px side padding. Must match hud.css.
const STRIP = { long: 158, short: 34 };
const EDGES = ['left', 'right', 'top', 'bottom'];
const DEFAULT_SETTINGS = Object.freeze({ displayId: null, edge: 'right', offset: 0.3, visible: true });

const clamp = (value, low, high) => Math.min(high, Math.max(low, value));
const isVertical = edge => edge === 'left' || edge === 'right';

function normalizeHudSettings(raw) {
  const r = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  return {
    displayId: Number.isSafeInteger(r.displayId) ? r.displayId : null,
    edge: EDGES.includes(r.edge) ? r.edge : DEFAULT_SETTINGS.edge,
    offset: Number.isFinite(r.offset) ? clamp(r.offset, 0, 1) : DEFAULT_SETTINGS.offset,
    visible: typeof r.visible === 'boolean' ? r.visible : DEFAULT_SETTINGS.visible,
  };
}

/** Window rectangle in screen coordinates, and the collapsed strip's top-left inside it. */
function layoutHud({ workArea: wa, edge, offset }) {
  const width = Math.min(WINDOW_SIZE, wa.width);
  const height = Math.min(WINDOW_SIZE, wa.height);
  const along = clamp(Number.isFinite(offset) ? offset : DEFAULT_SETTINGS.offset, 0, 1);
  let sx; let sy; let wx; let wy;
  if (isVertical(edge)) {
    sy = Math.round(wa.y + along * Math.max(0, wa.height - STRIP.long));
    sx = edge === 'left' ? wa.x + MARGIN : wa.x + wa.width - MARGIN - STRIP.short;
    wx = edge === 'left' ? wa.x : wa.x + wa.width - width;
    wy = Math.round(clamp(sy + STRIP.long / 2 - height / 2, wa.y, wa.y + wa.height - height));
  } else {
    sx = Math.round(wa.x + along * Math.max(0, wa.width - STRIP.long));
    sy = edge === 'top' ? wa.y + MARGIN : wa.y + wa.height - MARGIN - STRIP.short;
    wy = edge === 'top' ? wa.y : wa.y + wa.height - height;
    wx = Math.round(clamp(sx + STRIP.long / 2 - width / 2, wa.x, wa.x + wa.width - width));
  }
  return { window: { x: wx, y: wy, width, height }, strip: { x: sx - wx, y: sy - wy }, edge };
}

/** Nearest edge to the strip's centre, and the strip's position along that edge (0–1). */
function snapToEdge({ workArea: wa, point }) {
  const px = clamp(point.x, wa.x, wa.x + wa.width);
  const py = clamp(point.y, wa.y, wa.y + wa.height);
  const distance = { left: px - wa.x, right: wa.x + wa.width - px, top: py - wa.y, bottom: wa.y + wa.height - py };
  const edge = EDGES.reduce((best, candidate) => (distance[candidate] < distance[best] ? candidate : best), EDGES[0]);
  const along = isVertical(edge)
    ? (py - wa.y - STRIP.long / 2) / Math.max(1, wa.height - STRIP.long)
    : (px - wa.x - STRIP.long / 2) / Math.max(1, wa.width - STRIP.long);
  return { edge, offset: clamp(along, 0, 1) };
}

/** The saved display if it is still connected, otherwise the primary one. */
function pickDisplay(displays, primary, displayId) {
  return displays.find(display => display.id === displayId) || primary;
}

module.exports = { DEFAULT_SETTINGS, EDGES, MARGIN, STRIP, WINDOW_SIZE, layoutHud, normalizeHudSettings, pickDisplay, snapToEdge };
