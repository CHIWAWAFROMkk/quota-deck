(function () {
  'use strict';
  const { el, icon, logo } = window.HudDom;
  const METRICS = [['quota', 'percent', 'Quota'], ['burn', 'flame', 'Burn rate'], ['tokens', 'number', 'Tokens per hour']];
  const EDGES = ['left', 'right', 'top', 'bottom'];
  const GAP = 6;
  const MARGIN = 4;
  const CLOSE_MS = 100;

  function create({ root, strip, getItem, getTokens, getMetric, setMetric, settingsView = null, onOpenStats, onChange }) {
    let openId = null;
    let view = 'detail';
    let closeTimer = null;
    let settingsUpdate = null;
    // While the pointer is on the card a data push waits, so a tooltip being read is not torn down.
    let hovering = false;
    let pendingRender = false;

    const edgeNow = () => EDGES.find(edge => document.body.classList.contains(`edge-${edge}`)) || 'right';
    // A ledger needs its quarter-hour buckets and start time to be drawn; older ones only have a total.
    const drawable = s => s?.status === 'ok' && s.total > 0 && Array.isArray(s.buckets) && s.buckets.length > 0 && Number.isFinite(s.startAt);
    const tokenMeta = s => (!s ? 'Reading…' : s.status === 'unsupported' ? 'No local logs' : s.status !== 'ok' ? 'Read failed' : s.partial ? '24h · partial' : `24h · ${s.totalText ?? `${window.HudDom.fmtInt(s.total || 0)} tok`}`);
    // Backward compatible: older rows carry `label` and a burn string instead of an object.
    const burnOf = row => (row.burn && typeof row.burn === 'object' ? row.burn : { value: typeof row.burn === 'string' ? row.burn : '—', level: 'none', detail: '', projectedPct: null });

    // Used share in the row's level colour; in burn mode a faint segment shows the projection to reset.
    function track(row, projected) {
      const bar = el('span', { class: `track ${row.level}` });
      if (row.usedPct === null) return bar;
      if (Number.isFinite(projected) && projected > row.usedPct) {
        const ghost = el('i', { class: 'ghost' });
        ghost.style.width = `${Math.min(100, projected)}%`;
        bar.append(ghost);
      }
      const fill = el('i', { class: 'fill' });
      fill.style.width = `${Math.max(0, Math.min(100, row.usedPct))}%`;
      bar.append(fill);
      return bar;
    }

    function rowNode(row, metric, tokens) {
      let value;
      let detail;
      let level;
      let projected = null;
      if (metric === 'burn') ({ value, detail, level, projectedPct: projected } = burnOf(row));
      else if (metric === 'tokens') {
        const ok = tokens?.status === 'ok';
        value = ok ? tokens.perHour ?? '—' : '—';
        detail = ok ? tokens.perDay ?? '—' : '—';
        level = ok ? 'ok' : 'none';
      } else {
        value = row.usedPct === null ? '—' : `${row.usedPct}%`;
        detail = row.reset;
        level = row.level;
      }
      return el('div', { class: `row ${level}` }, [
        el('i', { class: 'dot' }),
        el('span', { class: 'name', text: row.name ?? row.label ?? '', title: row.name ?? row.label ?? '', 'data-short': row.short ?? null }),
        track(row, projected),
        el('span', { class: 'value', text: value }),
        el('span', { class: `detail${metric === 'burn' && level === 'warn' ? ' tinted' : ''}`, text: detail }),
      ]);
    }

    function detail(item) {
      const metric = getMetric(item.id);
      const tokens = getTokens()?.[item.id];
      const c = item.card;
      // Backward compatible: older items carry the balance as a plain string.
      const balance = typeof c.balance === 'string' ? { text: c.balance, level: 'none' } : c.balance && typeof c.balance === 'object' ? { text: c.balance.text ?? '—', level: c.balance.level || 'none' } : null;
      const head = el('section', { class: 'sec' }, [
        el('header', { class: 'head' }, [
          el('span', { class: 'head-logo' }, [logo(item.id, 'card-logo')]),
          el('h2', { text: item.name }),
          el('div', { class: 'picker', role: 'radiogroup', 'aria-label': 'Metric' }, METRICS.map(([id, glyph, label]) => el('button', {
            type: 'button', class: `pick${metric === id ? ' on' : ''}`, 'data-metric': id, role: 'radio', 'aria-checked': String(metric === id), 'aria-label': label, title: label,
          }, [icon(glyph)]))),
        ]),
        el('div', { class: 'account' }, [el('span', { class: 'plan', text: c.plan || '' }), el('span', { class: 'status', text: c.account || '' })]),
        c.note ? el('p', { class: 'note', text: c.note }) : null,
        balance ? el('div', { class: `row ${balance.level}` }, [el('i', { class: 'dot' }), el('span', { class: 'name', text: 'Balance' }), el('span'), el('span', { class: 'value', text: balance.text }), el('span', { class: 'detail' })]) : null,
        ...(c.rows || []).map(row => rowNode(row, metric, tokens)),
      ]);
      const tokenSection = c.tokens ? el('section', { class: 'sec tokens' }, [
        el('div', { class: 'sec-head' }, [el('h3', { text: 'Tokens' }), el('span', { class: 'sec-meta', text: tokenMeta(tokens) })]),
        drawable(tokens) ? window.HudChart.render(tokens, { source: item.id }) : null,
      ]) : null;
      const foot = el('footer', { class: 'sec foot' }, [
        el('button', { class: 'foot-btn', type: 'button', 'data-act': 'settings', 'aria-label': 'Settings', title: 'Settings' }, [icon('gear')]),
        el('button', { class: 'foot-btn', type: 'button', 'data-act': 'stats', 'aria-label': 'Usage statistics', title: 'Usage statistics' }, [icon('chart')]),
      ]);
      return [head, tokenSection, foot];
    }

    // Beside the strip on its inner side, 6px away, centred on the clicked mark and kept on screen.
    function position(animate) {
      const mark = strip.markRect(openId);
      if (!mark) return;
      const s = document.querySelector('#strip').getBoundingClientRect();
      const edge = edgeNow();
      // Cap the height to the room on the strip's inner side; the card scrolls instead of being clipped.
      const H = document.documentElement.clientHeight;
      const room = edge === 'top' ? H - s.bottom - GAP - MARGIN : edge === 'bottom' ? s.top - GAP - MARGIN : H - 2 * MARGIN;
      root.style.maxHeight = `${Math.max(120, Math.floor(room))}px`;
      const w = root.offsetWidth;
      const h = root.offsetHeight;
      const clampX = v => Math.max(MARGIN, Math.min(document.documentElement.clientWidth - w - MARGIN, v));
      const clampY = v => Math.max(MARGIN, Math.min(document.documentElement.clientHeight - h - MARGIN, v));
      let x;
      let y;
      if (edge === 'left') { x = s.right + GAP; y = clampY(mark.top + mark.height / 2 - h / 2); }
      else if (edge === 'right') { x = s.left - GAP - w; y = clampY(mark.top + mark.height / 2 - h / 2); }
      else if (edge === 'top') { y = s.bottom + GAP; x = clampX(mark.left + mark.width / 2 - w / 2); }
      else { y = s.top - GAP - h; x = clampX(mark.left + mark.width / 2 - w / 2); }
      root.style.left = `${Math.round(x)}px`;
      root.style.top = `${Math.round(y)}px`;
      root.dataset.edge = edge;
      if (animate) {
        root.style.transformOrigin = `${Math.round(mark.left + mark.width / 2 - x)}px ${Math.round(mark.top + mark.height / 2 - y)}px`;
        root.classList.remove('shown');
        void root.offsetWidth;
        root.classList.add('shown');
      }
    }

    function render(animate = false) {
      const item = openId ? getItem(openId) : null;
      if (!item) { close(); return; }
      const content = view === 'settings' && settingsView ? settingsView({ back: () => { view = 'detail'; render(); } }) : detail(item);
      settingsUpdate = view === 'settings' && typeof content.update === 'function' ? content.update : null;
      root.replaceChildren(el('div', { class: 'card-body' }, content));
      position(animate);
      for (const name of root.querySelectorAll('.row .name[data-short]')) if (name.scrollWidth > name.clientWidth) name.textContent = name.dataset.short;
      onChange();
    }

    function open(id) {
      clearTimeout(closeTimer);
      const animate = !openId;
      openId = id;
      view = 'detail';
      pendingRender = false;
      root.hidden = false;
      root.classList.remove('closing');
      render(animate);
      window.hud.card(true);
    }

    function close() {
      if (!openId) return;
      openId = null;
      view = 'detail';
      root.classList.remove('shown');
      root.classList.add('closing');
      clearTimeout(closeTimer);
      closeTimer = setTimeout(() => {
        if (openId) return;
        root.hidden = true;
        root.classList.remove('closing');
        root.replaceChildren();
        onChange();
      }, CLOSE_MS);
      window.hud.card(false);
      onChange();
    }

    root.addEventListener('click', event => {
      const pick = event.target.closest('[data-metric]');
      if (pick && openId) { setMetric(openId, pick.dataset.metric); return; }
      const act = event.target.closest('[data-act]')?.dataset.act;
      if (act === 'settings' && settingsView) { view = 'settings'; render(); }
      if (act === 'stats') onOpenStats();
    });
    root.addEventListener('transitionend', onChange);
    root.addEventListener('mouseover', () => { hovering = true; });
    root.addEventListener('mouseleave', () => {
      hovering = false;
      if (pendingRender && openId && view === 'detail') render();
      pendingRender = false;
    });
    new ResizeObserver(onChange).observe(root);

    return {
      open,
      close,
      toggle(id) { if (openId === id) close(); else open(id); },
      isOpen: () => openId !== null,
      // The settings page keeps its inputs while values change, so it is only moved, not rebuilt.
      refresh() {
        if (!openId) return;
        if (view === 'settings') { settingsUpdate?.(); position(false); return; }
        if (hovering) { pendingRender = true; return; }
        render();
      },
      reposition() { if (openId) position(false); },
    };
  }

  window.HudCard = { create };
})();
