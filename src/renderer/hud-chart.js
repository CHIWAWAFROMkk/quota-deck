(function () {
  'use strict';
  const { el, fmtInt, hm, logo, periodText } = window.HudDom;
  const QUARTER = 15 * 60000;
  const PALETTE = ['#c084fc', '#60a5fa', '#2dd4bf', '#fb923c', '#f472b6', '#a3e635'];
  const OTHER = '#6e6e73';
  let charts = 0;
  const colorOf = (model, index) => (model?.id === 'other' ? OTHER : PALETTE[index % PALETTE.length]);

  // 96 quarter-hour bars stacked by model from the bottom; hover shows that quarter's breakdown.
  function render(input, { height = 40, source = null, axis = false } = {}) {
    // Backward compatible: a ledger without per-model stacks draws one colour per bar.
    const buckets = Array.isArray(input.buckets) ? input.buckets : [];
    const split = Array.isArray(input.stacks) && input.stacks.length === buckets.length && Array.isArray(input.models);
    const series = { ...input, buckets, models: split ? input.models : [{ id: 'all', name: 'All models' }], stacks: split ? input.stacks : buckets.map(n => [n]), total: Number.isFinite(input.total) ? input.total : buckets.reduce((a, b) => a + b, 0) };
    const id = `chart${++charts}`;
    const n = series.buckets.length;
    const max = Math.max(1, ...series.buckets);
    const box = el('div', { class: `chart${axis ? ' with-axis' : ''}` });
    const svg = el('svg:svg', { class: 'bars', role: 'img', 'aria-label': `${fmtInt(series.total)} tokens in the last 24 hours` });
    const tip = el('div', { class: 'chart-tip', hidden: true });
    box.append(svg, tip);
    if (axis) {
      box.append(el('div', { class: 'axis' }, [0, 24, 48, 72, 96].map(i => {
        const label = el('span', { text: hm(new Date(series.startAt + i * QUARTER)) });
        label.style.left = `${(i / n) * 100}%`;
        return label;
      })));
    }
    let width = 0;
    let columns = [];
    let band = null;
    let cursor = null;

    function draw() {
      width = box.clientWidth;
      if (!width) return;
      svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
      svg.setAttribute('height', height);
      const step = width / n;
      const gap = Math.min(2, step * 0.2);
      const defs = el('svg:defs');
      columns = series.buckets.map((total, i) => {
        const group = el('svg:g', { class: 'col' });
        const h = Math.min(height, (total / max) * height);
        if (h <= 0) return group;
        const x = i * step + gap / 2;
        const w = Math.max(0.5, step - gap);
        // Round the top of each stack: clip it to a rounded rect taller than the bar.
        defs.append(el('svg:clipPath', { id: `${id}-${i}` }, [el('svg:rect', { x, y: height - h, width: w, height: h + 2, rx: 2 })]));
        group.setAttribute('clip-path', `url(#${id}-${i})`);
        let y = height;
        (series.stacks[i] || []).forEach((count, m) => {
          if (count <= 0) return;
          const part = (count / total) * h;
          y -= part;
          group.append(el('svg:rect', { x, y, width: w, height: part, fill: colorOf(series.models[m], m) }));
        });
        return group;
      });
      band = el('svg:rect', { class: 'band', x: -step, y: 0, width: step, height });
      cursor = el('svg:line', { class: 'cursor', x1: -10, x2: -10, y1: 0, y2: height });
      svg.replaceChildren(defs, band, ...columns, el('svg:line', { class: 'baseline', x1: 0, x2: width, y1: height - 0.5, y2: height - 0.5 }), cursor);
      highlight(null);
    }

    function highlight(i) {
      box.classList.toggle('hovering', i !== null);
      columns.forEach((column, k) => column.classList.toggle('on', k === i));
      if (i === null) {
        tip.hidden = true;
        band?.setAttribute('x', -width);
        cursor?.setAttribute('x1', -10);
        cursor?.setAttribute('x2', -10);
        return;
      }
      const step = width / n;
      const centre = (i + 0.5) * step;
      band.setAttribute('x', i * step);
      cursor.setAttribute('x1', centre);
      cursor.setAttribute('x2', centre);
      const start = new Date(series.startAt + i * QUARTER);
      const rows = series.models.map((model, m) => ({ model, m, count: series.stacks[i]?.[m] || 0 })).filter(row => row.count > 0);
      tip.replaceChildren(
        el('div', { class: 'tip-period', text: periodText(start, new Date(start.getTime() + QUARTER)) }),
        el('div', { class: 'tip-total', text: `${fmtInt(series.buckets[i])} tokens` }),
        ...rows.map(row => {
          const dot = el('i', { class: 'tip-dot' });
          dot.style.background = colorOf(row.model, row.m);
          return el('div', { class: 'tip-row' }, [dot, source ? logo(source, 'tip-logo') : null, el('span', { class: 'tip-name', text: row.model.name }), el('span', { class: 'tip-count', text: fmtInt(row.count) })]);
        }),
      );
      tip.hidden = false;
      const tw = Math.min(280, width);
      tip.style.width = `${tw}px`;
      tip.style.left = `${Math.round(centre < width / 2 ? centre + 12 : centre - 12 - tw)}px`;
    }

    svg.addEventListener('mousemove', event => {
      const r = svg.getBoundingClientRect();
      highlight(Math.max(0, Math.min(n - 1, Math.floor(((event.clientX - r.left) / r.width) * n))));
    });
    svg.addEventListener('mouseleave', () => highlight(null));
    new ResizeObserver(draw).observe(box);
    return box;
  }

  window.HudChart = { render, colorOf, PALETTE };
})();
