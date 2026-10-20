(function () {
  'use strict';
  const { el, icon, logo } = window.HudDom;
  const METRICS = [['quota', 'percent', 'Quota'], ['burn', 'flame', 'Burn rate'], ['tokens', 'number', 'Tokens per hour']];
  const EDGES = ['left', 'right', 'top', 'bottom'];
  const GAP = 6;
  const MARGIN = 4;
  const CLOSE_MS = 100;

  function create({ root, strip, getItem, getTokens, getMetric, setMetric, settingsView = null, onOpenStats, onChange, getAlerts = () => [], onDismiss = () => {}, onReturn = async () => ({}) }) {
    let openId = null;
    let view = 'detail';
    let closeTimer = null;
    let settingsUpdate = null;
    // While the pointer is on the card a data push waits, so a tooltip being read is not torn down.
    let hovering = false;
    let pendingRender = false;
    // Reply/error alerts on screen when the card opened; closing the card marks exactly these as seen.
    let openedAlertIds = new Set();

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

    const pad = n => String(n).padStart(2, '0');
    const clockOf = at => { const d = new Date(at); return Number.isFinite(d.getTime()) ? `${pad(d.getHours())}:${pad(d.getMinutes())}` : ''; };
    function durationOf(ms) {
      if (!Number.isFinite(ms) || ms < 0) return '';
      const minutes = Math.round(ms / 60000);
      if (minutes < 1) return '<1m';
      return minutes < 60 ? `${minutes}m` : `${Math.floor(minutes / 60)}h ${pad(minutes % 60)}m`;
    }
    // Elapsed waiting time rounds down, like the capsule (90 s reads 1m).
    const sinceOf = at => durationOf(Math.floor(Math.max(0, Date.now() - at) / 60000) * 60000) || '<1m';
    const alertsOf = id => (getAlerts(id) || []).filter(a => a && typeof a === 'object' && typeof a.id === 'string');
    // Approvals first, then waiting, then newest first.
    const rank = kind => kind === 'approval' ? 0 : kind === 'waiting' ? 1 : 2;
    const ordered = list => [...list].sort((a, b) => (rank(a.kind) - rank(b.kind)) || ((Number(b.at) || 0) - (Number(a.at) || 0)));

    function decision(id, act) {
      return el('button', { class: `alert-${act}`, type: 'button', 'data-act': `approve-${act}`, 'data-id': id }, [el('span', { text: act === 'allow' ? 'Allow once' : 'Deny' })]);
    }

    function alertBlock(alert, item) {
      const vendor = alert.vendor || item.id;
      const approval = alert.kind === 'approval';
      const waiting = alert.kind === 'waiting';
      const pending = approval || waiting;
      const error = alert.kind === 'error';
      const label = approval ? 'Approve?' : waiting ? 'Waiting' : error ? 'Stopped' : 'New reply';
      const head = el('header', { class: 'alert-head' }, [
        el('span', { class: 'head-logo' }, [window.HudBots.face(vendor, pending ? 'asking' : 'done', 14)]),
        el('div', { class: 'alert-who' }, [el('h2', { text: item.name }), alert.model ? el('span', { class: 'alert-model', text: String(alert.model) }) : null]),
        el('span', { class: `alert-chip ${alert.kind}` }, [pending ? null : icon('chat'), el('span', { text: label })]),
        pending ? null : el('button', { class: 'alert-x', type: 'button', 'data-act': 'dismiss', 'data-id': alert.id, 'aria-label': 'Dismiss', title: 'Dismiss' }, [icon('close')]),
      ]);
      const when = pending ? `Waiting ${sinceOf(Number(alert.at) || Date.now())}` : clockOf(Number(alert.at));
      const took = pending ? '' : durationOf(Number(alert.durationMs));
      return el('section', { class: `alert-block ${alert.kind || 'reply'}`, 'data-id': alert.id }, [
        head,
        el('h3', { class: 'alert-title', text: alert.title || item.name }),
        waiting ? el('p', { class: 'alert-status', text: 'Waiting for you' }) : error ? el('p', { class: 'alert-status', text: 'Stopped with an error' }) : null,
        // What is being approved reads like the Waiting card's tool line: "Bash: <command>", monospace.
        approval && (alert.tool || alert.text) ? (() => { const what = [alert.tool, alert.text].filter(Boolean).map(String).join(': '); return el('p', { class: 'alert-tool', text: what, title: what }); })() : null,
        waiting && alert.tool ? el('p', { class: 'alert-tool', text: String(alert.tool) }) : null,
        !pending && alert.text ? el('p', { class: 'alert-summary', text: String(alert.text) }) : null,
        // Video layout: time and duration on one line, then the two actions.
        el('div', { class: 'alert-meta' }, [el('span', { class: 'alert-time', text: when }), el('span', { class: 'alert-duration', text: took })]),
        approval
          ? el('footer', { class: 'alert-foot approval' }, [decision(alert.id, 'deny'), decision(alert.id, 'allow')])
          : el('footer', { class: 'alert-foot' }, [
            el('button', { class: 'alert-link', type: 'button', 'data-act': 'usage' }, [icon('chart'), el('span', { text: 'View token usage' })]),
            alert.returnable === true ? el('button', { class: 'alert-return', type: 'button', 'data-act': 'return', 'data-id': alert.id }, [icon('arrow'), el('span', { text: 'Return to session' })]) : null,
          ]),
      ]);
    }

    function alertsView(item) {
      return ordered(alertsOf(item.id)).map(alert => alertBlock(alert, item));
    }

    function render(animate = false) {
      const item = openId ? getItem(openId) : null;
      if (!item) { close(); return; }
      if (view === 'alerts' && !alertsOf(openId).length) view = 'detail';
      const content = view === 'settings' && settingsView ? settingsView({ back: () => { view = 'detail'; render(); } })
        : view === 'alerts' ? alertsView(item) : detail(item);
      settingsUpdate = view === 'settings' && typeof content.update === 'function' ? content.update : null;
      root.replaceChildren(el('div', { class: 'card-body' }, content));
      position(animate);
      for (const name of root.querySelectorAll('.row .name[data-short]')) if (name.scrollWidth > name.clientWidth) name.textContent = name.dataset.short;
      onChange();
    }

    function open(id) {
      clearTimeout(closeTimer);
      // Switching straight to another vendor counts as having seen what this card showed.
      if (openId && openId !== id && openedAlertIds.size) onDismiss([...openedAlertIds]);
      const animate = !openId;
      openId = id;
      const alerts = alertsOf(id);
      view = alerts.length ? 'alerts' : 'detail';
      openedAlertIds = new Set(alerts.filter(a => a.kind === 'reply' || a.kind === 'error').map(a => a.id));
      pendingRender = false;
      root.hidden = false;
      root.classList.remove('closing');
      render(animate);
      window.hud.card(true);
    }

    function close() {
      if (!openId) return;
      if (openedAlertIds.size) onDismiss([...openedAlertIds]);
      openedAlertIds = new Set();
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
      const target = event.target.closest('[data-act]');
      if (act === 'usage') { view = 'detail'; render(); }
      if (act === 'dismiss' && target?.dataset.id) {
        openedAlertIds.delete(target.dataset.id);
        onDismiss([target.dataset.id]);
        target.closest('.alert-block')?.remove();
        if (!root.querySelector('.alert-block')) close(); else { position(false); onChange(); }
      }
      if ((act === 'approve-allow' || act === 'approve-deny') && target?.dataset.id) {
        const id = target.dataset.id;
        const block = target.closest('.alert-block');
        const buttons = block ? [...block.querySelectorAll('button')].filter(button => button.dataset.act === 'approve-allow' || button.dataset.act === 'approve-deny') : [target];
        for (const button of buttons) button.disabled = true;
        // Buttons re-enable only if the request is lost; a successful decision removes the card.
        let request;
        try { request = window.hud.approve(id, act === 'approve-allow' ? 'allow' : 'deny'); }
        catch { for (const button of buttons) button.disabled = false; return; }
        Promise.resolve(request).catch(() => {}).finally(() => {
          for (const button of buttons) button.disabled = false;
        });
      }
      if (act === 'return' && target?.dataset.id) {
        const id = target.dataset.id;
        openedAlertIds.delete(id);
        Promise.resolve(onReturn(id)).then(result => { if (result?.status === 'opened') close(); }, () => {});
      }
    });
    root.addEventListener('transitionend', onChange);
    root.addEventListener('mouseover', () => { hovering = true; });
    root.addEventListener('mouseleave', () => {
      hovering = false;
      if (pendingRender && openId && (view === 'detail' || view === 'alerts')) render();
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
