(function () {
  'use strict';
  const { el, logo } = window.HudDom;
  const { CLICK_SLOP, HOLD_MS, isClick, metrics: metricsFor, stripSize } = window.HudMetrics;
  const SHOW_MS = 400;
  const HIDE_MS = 200;
  const FADE_MS = 400;
  const MARGIN = 4;

  function create({ root, pill, frame, isBlocked, onClick, onDragStart, onStrips }) {
    let items = [];
    let settings = null;
    let edge = 'right';
    let sizes = null;
    let pillId = null;
    let showTimer = null;
    let hideTimer = null;
    let fadeTimer = null;
    let press = null;
    let lastReport = '';
    const ctx = document.createElement('canvas').getContext('2d');
    const vertical = () => edge === 'left' || edge === 'right';
    const current = () => (vertical() ? sizes.vertical : sizes.horizontal);

    function ring(item, size, width) {
      const c = size / 2;
      const r = (size - width) / 2;
      const used = item.ring.usedPct;
      return el('svg:svg', { class: `ring ${item.ring.level}${item.ring.dashed ? ' dashed' : ''}`, viewBox: `0 0 ${size} ${size}`, 'aria-hidden': 'true' }, [
        el('svg:circle', { class: 'track', cx: c, cy: c, r }),
        used > 0 ? el('svg:circle', { class: 'value', cx: c, cy: c, r, pathLength: 100, 'stroke-dasharray': `${Math.min(used, 100)} 100`, transform: `rotate(-90 ${c} ${c})` }) : null,
      ]);
    }

    // Number widths are measured once per render and drive both orientations' sizes,
    // which the main process needs to place the window and to snap while dragging.
    function measure() {
      const font = metricsFor({ size: settings.size }).font;
      ctx.font = `500 ${font}px Inter`;
      const widths = items.map(item => Math.ceil(ctx.measureText(item.label).width));
      const base = { size: settings.size, showsRings: settings.showsRings, showsNumbers: settings.showsNumbers, labelWidths: widths };
      sizes = { vertical: stripSize({ ...base, vertical: true }), horizontal: stripSize({ ...base, vertical: false }), widths };
      const report = { vertical: { width: sizes.vertical.width, height: sizes.vertical.height }, horizontal: { width: sizes.horizontal.width, height: sizes.horizontal.height } };
      const key = JSON.stringify(report);
      if (key !== lastReport) { lastReport = key; onStrips(report); }
    }

    function render() {
      if (!settings) return;
      measure();
      const size = current();
      const m = size.metrics;
      const vars = { mark: m.mark, logo: m.logo, num: m.font, spacing: m.spacing, gap: m.gap, lead: m.lead, trail: m.trail, cross: m.cross, radius: size.radius, ring: settings.ringWidth };
      for (const [key, value] of Object.entries(vars)) document.documentElement.style.setProperty(`--${key}`, `${value}px`);
      root.style.width = `${size.width}px`;
      root.style.height = `${size.height}px`;
      root.replaceChildren(...items.map((item, i) => {
        const num = settings.showsNumbers ? el('span', { class: `num ${item.ring.level}`, text: item.label }) : null;
        if (num && !vertical()) num.style.width = `${sizes.widths[i]}px`;
        return el('button', { class: 'item', type: 'button', 'data-id': item.id, 'aria-label': `${item.name} ${item.label}` }, [
          el('span', { class: 'mark' }, [settings.showsRings ? ring(item, m.mark, settings.ringWidth) : null, logo(item.id, 'logo')]),
          num,
        ]);
      }));
      if (vertical()) for (const node of root.querySelectorAll('.item')) node.style.width = '100%';
      placeFrame();
      if (pillId) showPill(pillId);
    }

    function placeFrame() {
      const w = root.offsetWidth;
      const h = root.offsetHeight;
      const r = sizes ? current().radius + 2 : 18;
      frame.style.left = `${root.offsetLeft - 2.625}px`;
      frame.style.top = `${root.offsetTop - 2.625}px`;
      frame.setAttribute('width', w + 5.25);
      frame.setAttribute('height', h + 5.25);
      const rect = frame.firstElementChild;
      for (const [key, value] of Object.entries({ x: 0.625, y: 0.625, width: w + 4, height: h + 4, rx: r, ry: r })) rect.setAttribute(key, value);
    }

    function place(layout) {
      const turned = layout.edge !== edge;
      edge = layout.edge;
      root.style.left = `${layout.strip.x}px`;
      root.style.top = `${layout.strip.y}px`;
      if (turned) render(); else placeFrame();
      if (pillId && !turned) showPill(pillId);
    }

    function markRect(id) {
      return root.querySelector(`[data-id="${id}"] .mark`)?.getBoundingClientRect() || null;
    }

    function showPill(id) {
      const item = items.find(entry => entry.id === id);
      const mark = markRect(id);
      if (!item || !mark || isBlocked()) { hidePill(); return; }
      clearTimeout(fadeTimer);
      const following = pillId !== null && !pill.hidden;
      pillId = id;
      pill.replaceChildren(...item.pill.map(pair => el('span', { class: `pair ${pair.level}` }, [pair.name ? el('span', { class: 'k', text: pair.name }) : null, el('span', { class: 'v', text: pair.value ?? pair.text ?? '—' })])));
      const s = { left: root.offsetLeft, top: root.offsetTop, width: root.offsetWidth, height: root.offsetHeight };
      const tuck = vertical() ? Math.round(s.width / 2) : 0;
      pill.classList.remove('edge-left', 'edge-right', 'edge-top', 'edge-bottom');
      pill.classList.add(`edge-${edge}`);
      pill.classList.toggle('follow', following);
      pill.style.setProperty('--tuck', `${tuck}px`);
      pill.hidden = false;
      const w = pill.offsetWidth;
      const h = pill.offsetHeight;
      const cx = mark.left + mark.width / 2;
      const cy = mark.top + mark.height / 2;
      const maxX = document.documentElement.clientWidth - w - MARGIN;
      const maxY = document.documentElement.clientHeight - h - MARGIN;
      const clamp = (v, high) => Math.max(MARGIN, Math.min(high, v));
      let x;
      let y;
      if (edge === 'left') { x = s.left + s.width - tuck; y = clamp(cy - h / 2, maxY); }
      else if (edge === 'right') { x = s.left + tuck - w; y = clamp(cy - h / 2, maxY); }
      else if (edge === 'top') { y = s.top + s.height; x = clamp(cx - w / 2, maxX); }
      else { y = s.top - h; x = clamp(cx - w / 2, maxX); }
      pill.style.left = `${Math.round(x)}px`;
      pill.style.top = `${Math.round(y)}px`;
      requestAnimationFrame(() => { if (pillId === id) pill.classList.add('shown'); });
    }

    function hidePill(now = false) {
      clearTimeout(showTimer);
      clearTimeout(hideTimer);
      clearTimeout(fadeTimer);
      pillId = null;
      pill.classList.remove('shown', 'follow');
      if (now) pill.hidden = true;
      else fadeTimer = setTimeout(() => { if (!pillId) pill.hidden = true; }, FADE_MS);
    }

    root.addEventListener('mouseover', event => {
      const target = event.target.closest('.item');
      if (!target || press?.dragging || isBlocked()) return;
      clearTimeout(hideTimer);
      clearTimeout(showTimer);
      if (pillId) showPill(target.dataset.id);
      else showTimer = setTimeout(() => showPill(target.dataset.id), SHOW_MS);
    });
    root.addEventListener('mouseleave', () => {
      clearTimeout(showTimer);
      hideTimer = setTimeout(() => hidePill(), HIDE_MS);
    });

    // Held for 0.3s or moved 6px: a drag. Released sooner and closer: a click.
    function startDrag() {
      if (!press || press.dragging) return;
      press.dragging = true;
      clearTimeout(press.hold);
      hidePill(true);
      onDragStart();
      window.hud.drag('start');
    }
    // A drag must always end: a lost capture or a press that arrives while one is still open closes it.
    function endPress() {
      if (!press) return;
      clearTimeout(press.hold);
      if (press.dragging) window.hud.drag('end');
      press = null;
    }
    root.addEventListener('pointerdown', event => {
      if (event.button !== 0) return;
      endPress();
      press = { x: event.screenX, y: event.screenY, at: performance.now(), id: event.target.closest('.item')?.dataset.id || null, dragging: false, hold: setTimeout(startDrag, HOLD_MS) };
      try { root.setPointerCapture(event.pointerId); } catch { /* synthetic events have no capture */ }
    });
    root.addEventListener('pointermove', event => {
      if (press && !press.dragging && Math.hypot(event.screenX - press.x, event.screenY - press.y) > CLICK_SLOP) startDrag();
    });
    root.addEventListener('pointerup', event => {
      if (!press) return;
      const done = press;
      press = null;
      clearTimeout(done.hold);
      try { root.releasePointerCapture(event.pointerId); } catch { /* not captured */ }
      if (done.dragging) window.hud.drag('end');
      else if (done.id && isClick({ dx: event.screenX - done.x, dy: event.screenY - done.y, ms: performance.now() - done.at })) onClick(done.id);
    });
    root.addEventListener('pointercancel', endPress);
    root.addEventListener('lostpointercapture', () => { if (press?.dragging) endPress(); });

    return {
      setItems(next) { items = Array.isArray(next) ? next : []; render(); },
      setSettings(next) { if (next) { settings = next; render(); } },
      place,
      hidePill,
      markRect,
    };
  }

  window.HudStrip = { create };
})();
