// Strip geometry from Agent HUD's SimpleMeter: every length derives from the ring size.
// Loaded as a plain script in the HUD page (window.HudMetrics) and required by the Node tests.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.HudMetrics = api;
})(typeof self !== 'undefined' ? self : this, () => {
  'use strict';
  const CLICK_SLOP = 6;
  const HOLD_MS = 300;
  const EMPTY_RUN = 32;

  function metrics({ size = 22, showsRings = true, showsNumbers = true, vertical = true } = {}) {
    const logo = Math.round(size * (showsRings ? 0.55 : 0.68));
    const tight = Math.max(3, Math.round(size * 0.18));
    const loose = Math.round(size * 0.45);
    const lead = showsRings ? tight + 1 : loose;
    return {
      logo,
      mark: showsRings ? size : logo,
      font: Math.max(9, Math.round(size * 0.59)),
      spacing: Math.round(size * 0.23),
      gap: Math.round(size * (showsNumbers || vertical ? 0.45 : 0.32)),
      lead,
      trail: showsNumbers ? loose : lead,
      cross: vertical ? tight + 3 : tight,
    };
  }

  // Vertical: numbers share one right-aligned column; horizontal: each number sits after its mark.
  function stripSize({ size = 22, showsRings = true, showsNumbers = true, vertical = true, labelWidths = [] } = {}) {
    const m = metrics({ size, showsRings, showsNumbers, vertical });
    const n = labelWidths.length;
    const labels = labelWidths.map(w => (showsNumbers ? Math.ceil(w) : 0));
    let width;
    let height;
    if (vertical) {
      width = m.lead + m.mark + (showsNumbers && n ? m.spacing + Math.max(...labels) : 0) + m.trail;
      height = n ? m.cross * 2 + n * m.mark + (n - 1) * m.gap : EMPTY_RUN;
    } else {
      width = n ? m.lead + labels.reduce((sum, w) => sum + m.mark + (showsNumbers ? m.spacing + w : 0), 0) + (n - 1) * m.gap + m.trail : EMPTY_RUN;
      height = m.cross * 2 + m.mark;
    }
    return { width, height, radius: Math.min(Math.round(size * 0.73), Math.min(width, height) / 2), metrics: m };
  }

  const isClick = ({ dx, dy, ms }) => Math.hypot(dx, dy) <= CLICK_SLOP && ms <= HOLD_MS;

  return { CLICK_SLOP, HOLD_MS, metrics, stripSize, isClick };
});
