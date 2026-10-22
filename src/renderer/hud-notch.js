(function () {
  'use strict';
  const { el, logo, ring } = window.HudDom;
  const { NOTCH, LEVEL_COLORS, glowStops, breathPeriod, pickWing, pulseColor } = window.HudNotchMetrics;
  const SHOW_MS = 400;
  const HIDE_MS = 200;
  const PAD = 24;
  const NAMES = { claude: 'Claude', codex: 'Codex' };
  const TONE = { approval: 'approval', waiting: 'waiting', error: 'stopped', reply: 'reply' };
  const FACE = { approval: 'asking', waiting: 'asking', error: 'done', reply: 'done' };

  // The notch from Agent HUD (video 25s): a black block hanging from the top edge with a
  // quota-coloured glow. Alerts grow wings; hovering widens it to show the rings, no numbers.
  function create({ root, onClick, onChange = () => {} }) {
    let items = [];
    let sessions = null;
    let settings = null;
    let centre = null;
    let hovered = false;
    let inside = false;
    // While a card hangs below, the notch keeps its shape so the card does not jump.
    let held = false;
    let showTimer = null;
    let hideTimer = null;
    let seen = null;
    let segIds = '';
    let box = { left: 0, top: 0, width: NOTCH.width, height: NOTCH.height };

    const glow = el('div', { class: 'notch-glow' });
    const flash = el('div', { class: 'notch-flash' });
    const left = el('div', { class: 'wing-l' });
    const right = el('div', { class: 'wing-r' });
    const rings = el('div', { class: 'notch-rings' });
    root.replaceChildren(glow, flash, el('div', { class: 'notch-body' }), el('div', { class: 'notch-wings' }, [left, right]), rings);

    const wing = () => pickWing(sessions?.alerts);
    const view = () => (!centre ? 'none' : hovered ? 'rings' : wing() ? 'wings' : 'collapsed');
    const metrics = () => window.HudMetrics.metrics({ size: settings?.size ?? 22, showsRings: settings?.showsRings !== false, showsNumbers: false, vertical: false });

    function shape(current) {
      if (current === 'wings') return { width: NOTCH.wingsWidth, height: NOTCH.wingsHeight, radius: NOTCH.wingsRadius };
      if (current === 'rings') {
        const m = metrics();
        const row = items.length * m.mark + Math.max(0, items.length - 1) * m.gap;
        return { width: Math.max(NOTCH.width + 2 * PAD, row + 2 * PAD), height: Math.max(NOTCH.height, (settings?.size ?? 22) + 8), radius: NOTCH.wingsRadius };
      }
      return { width: NOTCH.width, height: NOTCH.height, radius: NOTCH.radius };
    }

    function paintGlow() {
      const { stops, allUnknown } = glowStops(items);
      const colors = stops.map(stop => `${stop.color} ${Math.round(stop.offset * 1000) / 10}%`);
      glow.style.background = colors.length > 1 ? `linear-gradient(to right, ${colors.join(', ')})` : (stops[0]?.color || LEVEL_COLORS.none);
      glow.classList.toggle('still', allUnknown);
      root.style.setProperty('--breath', `${breathPeriod(sessions) / 1000}s`);
      // One flash segment per vendor, rebuilt only when the vendors change so a running pulse survives.
      const ids = items.map(item => item.id).join(',');
      if (ids === segIds) return;
      segIds = ids;
      flash.replaceChildren(...items.map((item, i) => {
        const seg = el('span', { class: 'notch-seg', 'data-vendor': item.id });
        seg.style.left = `${(i / items.length) * 100}%`;
        seg.style.width = `${100 / items.length}%`;
        seg.addEventListener('animationend', () => seg.classList.remove('pulse'));
        return seg;
      }));
    }

    function paintWing() {
      const w = wing();
      if (!w) { left.replaceChildren(); right.replaceChildren(); return; }
      const name = items.find(item => item.id === w.vendor)?.name || NAMES[w.vendor] || w.vendor;
      left.replaceChildren(window.HudBots.face(w.vendor, FACE[w.kind], 14), el('span', { class: 'wing-name', text: name }));
      right.replaceChildren(el('span', { class: `alert-text ${TONE[w.kind]}`, text: w.count > 1 ? `${w.label} ×${w.count}` : w.label }));
    }

    function paintRings() {
      if (!settings) return;
      const m = metrics();
      rings.style.gap = `${m.gap}px`;
      rings.replaceChildren(...items.map(item => {
        const phase = sessions?.vendors?.[item.id]?.phase;
        const icon = phase === 'working' || phase === 'asking' || phase === 'done' ? window.HudBots.face(item.id, phase, m.logo) : logo(item.id, 'logo');
        return el('button', { class: 'item', type: 'button', 'data-id': item.id, 'aria-label': `${item.name} ${item.label}` }, [
          el('span', { class: 'mark' }, [settings.showsRings !== false ? ring(item, m.mark, settings.ringWidth) : null, icon]),
        ]);
      }));
    }

    // Size changes animate in CSS; the hit area is reported at once and again when the motion ends.
    function layout() {
      const current = view();
      root.dataset.view = current;
      if (!centre) return;
      const s = shape(current);
      box = { left: Math.round(centre.x - s.width / 2), top: centre.y, width: s.width, height: s.height };
      root.style.left = `${box.left}px`;
      root.style.top = `${box.top}px`;
      root.style.width = `${s.width}px`;
      root.style.height = `${s.height}px`;
      root.style.setProperty('--r', `${s.radius}px`);
      onChange();
    }

    function pulse(vendor, kind) {
      // A hidden notch plays no animation, so its flash would never end; only flash what is on screen.
      const seg = centre ? flash.querySelector(`[data-vendor="${vendor}"]`) : null;
      if (!seg) return;
      seg.style.setProperty('--pulse', pulseColor(kind));
      seg.classList.remove('pulse');
      void seg.offsetWidth;
      seg.classList.add('pulse');
    }

    root.addEventListener('mouseover', () => {
      inside = true;
      if (!centre || held) return;
      clearTimeout(hideTimer);
      if (!hovered && !showTimer) showTimer = setTimeout(() => { showTimer = null; hovered = true; layout(); }, SHOW_MS);
    });
    function scheduleHide() {
      clearTimeout(hideTimer);
      hideTimer = setTimeout(() => { if (!held && !inside) { hovered = false; layout(); } }, HIDE_MS);
    }
    root.addEventListener('mouseleave', () => {
      inside = false;
      clearTimeout(showTimer);
      showTimer = null;
      if (!held) scheduleHide();
    });
    root.addEventListener('click', event => {
      const current = view();
      const id = event.target.closest('.item')?.dataset.id;
      if (current === 'rings' && id) onClick(id);
      else if (current === 'wings') onClick(wing().vendor);
    });
    root.addEventListener('transitionend', event => { if (event.target === root) onChange(); });

    return {
      setItems(next) { items = Array.isArray(next) ? next.filter(item => item && typeof item === 'object' && item.ring) : []; paintGlow(); paintWing(); paintRings(); layout(); },
      setSettings(next) { if (next) { settings = next; paintRings(); layout(); } },
      setSessions(next) {
        sessions = next && typeof next === 'object' ? next : null;
        const alerts = Array.isArray(sessions?.alerts) ? sessions.alerts.filter(a => a && typeof a.id === 'string') : [];
        // The first snapshot only records what is there; later ones flash each new alert's vendor.
        if (seen) for (const alert of alerts) if (!seen.has(alert.id)) pulse(alert.vendor, alert.kind);
        seen = new Set(alerts.map(alert => alert.id));
        paintGlow();
        paintWing();
        paintRings();
        layout();
      },
      // Returns whether the notch is the active style; older main processes send no mode.
      place(next) {
        const active = next?.mode === 'notch' && next.notch && typeof next.notch === 'object';
        root.hidden = !active;
        centre = active ? { x: next.notch.x + next.notch.width / 2, y: next.notch.y } : null;
        if (!active) { clearTimeout(showTimer); clearTimeout(hideTimer); showTimer = null; hovered = false; }
        layout();
        return Boolean(active);
      },
      pulse,
      // Flash every vendor that has alerts once more, e.g. when a game ends.
      replay() {
        const alerts = Array.isArray(sessions?.alerts) ? sessions.alerts : [];
        for (const vendor of new Set(alerts.map(alert => alert?.vendor))) {
          const top = pickWing(alerts.filter(alert => alert?.vendor === vendor));
          if (top) pulse(top.vendor, top.kind);
        }
      },
      hold(on) {
        if (on === held) return;
        held = on;
        clearTimeout(showTimer);
        showTimer = null;
        if (!held) scheduleHide();
      },
      isOpen: () => view() === 'rings',
      // Final box after any running animation: the card hangs below it.
      rect: () => ({ ...box, bottom: box.top + box.height, right: box.left + box.width }),
      markRect(vendor) {
        if (view() === 'rings') return rings.querySelector(`[data-id="${vendor}"] .mark`)?.getBoundingClientRect() || null;
        return centre ? new DOMRect(box.left, box.top, box.width, box.height) : null;
      },
    };
  }

  window.HudNotch = { create };
})();
