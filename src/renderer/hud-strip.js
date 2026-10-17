(function () {
  'use strict';
  const { el, icon: glyph, logo } = window.HudDom;
  const { CLICK_SLOP, HOLD_MS, isClick, metrics: metricsFor, stripSize } = window.HudMetrics;
  const SHOW_MS = 400;
  const HIDE_MS = 200;
  const FADE_MS = 400;
  const MARGIN = 4;

  function create({ root, pill, frame, isBlocked, onClick, onDragStart, onStrips, onAlertsChanged = () => {} }) {
    let items = [];
    let settings = null;
    let sessions = null;
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
    // While a vendor has a session running, waiting or just finished, its logo becomes a bot face.
    function icon(id, size) {
      const phase = sessions?.vendors?.[id]?.phase;
      return phase === 'working' || phase === 'asking' || phase === 'done' ? window.HudBots.face(id, phase, size) : logo(id, 'logo');
    }

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
          el('span', { class: 'mark' }, [settings.showsRings ? ring(item, m.mark, settings.ringWidth) : null, icon(item.id, m.logo)]),
          num,
        ]);
      }));
      if (vertical()) for (const node of root.querySelectorAll('.item')) node.style.width = '100%';
      placeFrame();
      if (pillId) showPill(pillId);
      else renderAlerts();
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
      else renderAlerts();
    }

    function markRect(id) {
      return root.querySelector(`[data-id="${id}"] .mark`)?.getBoundingClientRect() || null;
    }

    // Beside a mark on the strip's inner side, half tucked under a vertical strip; shared by both capsules.
    function placeBeside(node, id) {
      const mark = markRect(id);
      if (!mark) return false;
      const s = { left: root.offsetLeft, top: root.offsetTop, width: root.offsetWidth, height: root.offsetHeight };
      const tuck = vertical() ? Math.round(s.width / 2) : 0;
      node.classList.remove('edge-left', 'edge-right', 'edge-top', 'edge-bottom');
      node.classList.add(`edge-${edge}`);
      node.style.setProperty('--tuck', `${tuck}px`);
      node.hidden = false;
      const w = node.offsetWidth;
      const h = node.offsetHeight;
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
      node.style.left = `${Math.round(x)}px`;
      node.style.top = `${Math.round(y)}px`;
      return true;
    }

    function showPill(id) {
      const item = items.find(entry => entry.id === id);
      if (!item || !markRect(id) || isBlocked()) { hidePill(); return; }
      clearTimeout(fadeTimer);
      const following = pillId !== null && !pill.hidden;
      pillId = id;
      pill.replaceChildren(...item.pill.map(pair => el('span', { class: `pair ${pair.level}` }, [pair.name ? el('span', { class: 'k', text: pair.name }) : null, el('span', { class: 'v', text: pair.value ?? pair.text ?? '—' })])));
      pill.classList.toggle('follow', following);
      placeBeside(pill, id);
      renderAlerts();
      requestAnimationFrame(() => { if (pillId === id) pill.classList.add('shown'); });
    }

    // One persistent capsule per vendor with alerts: Waiting first, then Stopped, then New reply.
    const VENDORS = { claude: 'Claude', codex: 'Codex' };
    const alertPills = new Map();
    function since(at) {
      const seconds = Math.max(0, Math.round((Date.now() - at) / 1000));
      return seconds < 60 ? `${seconds}s` : `${Math.round(seconds / 60)}m`;
    }
    function alertContent(vendor, list) {
      const waiting = list.find(a => a.kind === 'waiting');
      const errors = list.filter(a => a.kind === 'error');
      const replies = list.filter(a => a.kind === 'reply');
      let tail;
      if (waiting) tail = el('span', { class: 'alert-text waiting', text: `Waiting · ${since(Number(waiting.at) || Date.now())}` });
      else if (errors.length) tail = el('span', { class: 'alert-text stopped', text: 'Stopped' });
      else tail = el('span', { class: 'alert-text reply' }, [glyph('chat'), el('span', { text: replies.length > 1 ? `${replies.length} new replies` : 'New reply' })]);
      return [logo(vendor, 'alert-logo'), el('span', { class: 'alert-name', text: VENDORS[vendor] }), tail];
    }
    function renderAlerts() {
      const all = Array.isArray(sessions?.alerts) ? sessions.alerts.filter(a => a && typeof a === 'object') : [];
      const placed = [];
      for (const vendor of Object.keys(VENDORS)) {
        const list = all.filter(a => a.vendor === vendor);
        let node = alertPills.get(vendor);
        const blocked = !settings || isBlocked() || pillId !== null || !markRect(vendor);
        if (!list.length || blocked) { if (node) { node.hidden = true; node.classList.remove('shown'); } continue; }
        if (!node) {
          node = el('div', { class: 'pill alert-pill hit', 'data-vendor': vendor, role: 'button', 'aria-label': `${VENDORS[vendor]} alerts` });
          node.addEventListener('click', () => onClick(vendor));
          document.body.append(node);
          alertPills.set(vendor, node);
        }
        node.replaceChildren(...alertContent(vendor, list));
        placeBeside(node, vendor);
        // Docked top or bottom, neighbouring marks are close, so a capsule that would cover an
        // earlier one steps one row further away from the strip.
        const box = () => ({ x: node.offsetLeft, y: node.offsetTop, w: node.offsetWidth, h: node.offsetHeight });
        const hits = r => placed.some(o => r.x < o.x + o.w && o.x < r.x + r.w && r.y < o.y + o.h && o.y < r.y + r.h);
        if (!vertical()) {
          for (let step = 0; step < 4 && hits(box()); step++) {
            const r = box();
            node.style.top = `${r.y + (edge === 'top' ? r.h + 4 : -(r.h + 4))}px`;
          }
        }
        placed.push(box());
        node.classList.add('shown');
      }
      onAlertsChanged();
    }
    setInterval(() => { if (sessions?.alerts?.some(a => a?.kind === 'waiting')) renderAlerts(); }, 15000);

    function hidePill(now = false) {
      clearTimeout(showTimer);
      clearTimeout(hideTimer);
      clearTimeout(fadeTimer);
      pillId = null;
      pill.classList.remove('shown', 'follow');
      if (now) pill.hidden = true;
      else fadeTimer = setTimeout(() => { if (!pillId) pill.hidden = true; }, FADE_MS);
      renderAlerts();
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
      setSessions(next) { sessions = next && typeof next === 'object' ? next : null; render(); renderAlerts(); },
      renderAlerts,
      place,
      hidePill,
      markRect,
    };
  }

  window.HudStrip = { create };
})();
