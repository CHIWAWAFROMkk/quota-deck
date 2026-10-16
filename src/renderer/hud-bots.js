(function () {
  'use strict';
  const { el } = window.HudDom;
  const COLORS = { claude: '#D97757', codex: '#10A37F' };

  // A small robot head in the vendor's colour. working: eyes scan; asking: hops like a knock; done: smiles.
  function face(vendor, phase, size) {
    const color = COLORS[vendor] || '#9a9aa0';
    const eyes = phase === 'done'
      ? [
        el('svg:path', { d: 'M6.8 13.2q1.7-2.2 3.4 0', class: 'line' }),
        el('svg:path', { d: 'M13.8 13.2q1.7-2.2 3.4 0', class: 'line' }),
        el('svg:path', { d: 'M9 16.4q3 2.4 6 0', class: 'line' }),
      ]
      : [
        el('svg:g', { class: 'eyes' }, [
          el('svg:ellipse', { cx: 8.6, cy: 12.6, rx: 1.6, ry: 2.2 }),
          el('svg:ellipse', { cx: 15.4, cy: 12.6, rx: 1.6, ry: 2.2 }),
        ]),
        phase === 'asking' ? el('svg:circle', { cx: 12, cy: 17.4, r: 1.1 }) : null,
      ];
    const svg = el('svg:svg', { class: `bot ${phase}`, viewBox: '0 0 24 24', 'aria-hidden': 'true' }, [
      el('svg:g', { class: 'body' }, [
        el('svg:line', { x1: 12, y1: 5.5, x2: 12, y2: 2.6, class: 'antenna' }),
        el('svg:circle', { cx: 12, cy: 2.2, r: 1.4, class: 'tip' }),
        el('svg:rect', { x: 2.5, y: 5.5, width: 19, height: 15.5, rx: 6, class: 'head' }),
        ...eyes,
      ]),
    ]);
    svg.style.setProperty('--bot', color);
    if (Number.isFinite(size)) { svg.style.width = `${size + 3}px`; svg.style.height = `${size + 3}px`; }
    return svg;
  }

  window.HudBots = { face, COLORS };
})();
