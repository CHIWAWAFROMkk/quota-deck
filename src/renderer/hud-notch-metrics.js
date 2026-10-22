// Notch rules from Agent HUD: glow colour = quota level per vendor, breath = activity,
// wings = the alert that most needs the user. Loaded as window.HudNotchMetrics and by Node tests.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.HudNotchMetrics = api;
})(typeof self !== 'undefined' ? self : this, () => {
  'use strict';
  const NOTCH = Object.freeze({ width: 200, height: 30, wingsWidth: 456, wingsHeight: 38, ear: 8, radius: 12, wingsRadius: 14 });
  const LEVEL_COLORS = { ok: '#3ddc84', warn: '#ffd23f', high: '#ff453a', none: '#9a9aa0' };
  const RANK = { approval: 0, waiting: 1, error: 2, reply: 3 };
  const LABELS = { approval: 'Approve?', waiting: 'Waiting', error: 'Stopped', reply: 'New reply' };

  // One stop per vendor at (i + 0.5) / n, in HUD order.
  function glowStops(items) {
    const list = Array.isArray(items) ? items.filter(item => item && typeof item === 'object') : [];
    const stops = list.map((item, i) => {
      const level = LEVEL_COLORS[item.ring?.level] ? item.ring.level : 'none';
      return { offset: Math.round(((i + 0.5) / list.length) * 1e4) / 1e4, color: LEVEL_COLORS[level], vendor: item.id };
    });
    return { stops, allUnknown: stops.every(stop => stop.color === LEVEL_COLORS.none) };
  }

  const breathPeriod = sessions => (Object.values(sessions?.vendors || {}).some(v => Number(v?.running) > 0) ? 3000 : 7000);

  function pickWing(alerts) {
    const list = (Array.isArray(alerts) ? alerts : []).filter(a => a && typeof a === 'object' && typeof a.vendor === 'string' && Object.hasOwn(RANK, a.kind));
    if (!list.length) return null;
    const best = list.reduce((a, b) => (RANK[b.kind] < RANK[a.kind] || (RANK[b.kind] === RANK[a.kind] && (Number(b.at) || 0) > (Number(a.at) || 0)) ? b : a));
    return { vendor: best.vendor, kind: best.kind, label: LABELS[best.kind], count: list.filter(a => a.vendor === best.vendor).length };
  }

  const pulseColor = kind => (kind === 'reply' ? '#82aaff' : '#e9a16d');

  return { NOTCH, LEVEL_COLORS, glowStops, breathPeriod, pickWing, pulseColor };
});
