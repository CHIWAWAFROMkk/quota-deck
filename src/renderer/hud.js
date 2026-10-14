(function () {
  'use strict';

  const SVG = 'http://www.w3.org/2000/svg';
  const QUARTER = 15 * 60000;
  const STRIP = { long: 158, short: 34 }; // hud-geometry.cjs
  const R = 10.25;

  let items = [];
  let tokens = null;
  let layout = { edge: 'right', strip: { x: 0, y: 0 }, size: { width: 480, height: 480 }, dragging: false };
  let openId = null;
  let showRate = false;
  let press = null;
  let inside = false;
  let pillTimer = null;
  let pillHide = null;
  let stripHide = null;

  const strip = document.querySelector('#strip');
  const pill = document.querySelector('#pill');
  const card = document.querySelector('#card');
  const pad = n => String(n).padStart(2, '0');
  const hm = d => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const fmt = n => Math.round(n).toLocaleString('en-US');

  function el(tag, attrs = {}, children = []) {
    const node = tag.startsWith('svg:') ? document.createElementNS(SVG, tag.slice(4)) : document.createElement(tag);
    for (const [key, value] of Object.entries(attrs)) {
      if (value === null || value === undefined || value === false) continue;
      if (key === 'text') node.textContent = value;
      else node.setAttribute(key, value === true ? '' : String(value));
    }
    for (const child of [].concat(children)) if (child) node.append(child);
    return node;
  }

  function ring(item) {
    const used = item.ring.usedPct;
    return el('svg:svg', { class: `ring ${item.ring.level}${item.ring.dashed ? ' dashed' : ''}`, viewBox: '0 0 22 22', 'aria-hidden': 'true' }, [
      el('svg:circle', { class: 'track', cx: 11, cy: 11, r: R }),
      used === null ? null : el('svg:circle', { class: 'value', cx: 11, cy: 11, r: R, pathLength: 100, 'stroke-dasharray': `${Math.max(used, 1.5)} 100`, transform: 'rotate(-90 11 11)' }),
    ]);
  }

  const logo = (item, className) => el('img', { class: className, src: `../../assets/logos/${item.logo}`, alt: '', draggable: 'false' });

  function renderStrip() {
    strip.replaceChildren(...items.map(item => el('button', {
      class: `item${item.ring.dashed ? ' stale' : ''}`, type: 'button', 'data-id': item.id,
      'aria-label': `${item.name} ${item.label}`, 'aria-pressed': String(openId === item.id),
    }, [el('span', { class: 'mark' }, [ring(item), logo(item, 'logo')]), el('span', { class: `num ${item.ring.level}`, text: item.label })])));
  }

  function applyLayout(next) {
    if (!next) return;
    layout = next;
    document.body.className = `edge-${layout.edge}${layout.dragging ? ' dragging' : ''}`;
    const s = strip.style;
    s.left = s.right = s.top = s.bottom = '';
    const { x, y } = layout.strip;
    const { width, height } = layout.size;
    if (layout.edge === 'left') { s.left = `${x}px`; s.top = `${y}px`; }
    if (layout.edge === 'right') { s.right = `${width - x - STRIP.short}px`; s.top = `${y}px`; }
    if (layout.edge === 'top') { s.top = `${y}px`; s.left = `${x + STRIP.long / 2}px`; }
    if (layout.edge === 'bottom') { s.bottom = `${height - y - STRIP.short}px`; s.left = `${x + STRIP.long / 2}px`; }
    if (!layout.dragging) { hidePill(); closeCard(); }
  }

  // Put a floating node beside an anchor, on the side of the strip that faces into the screen.
  function place(node, anchor, gap) {
    const a = anchor.getBoundingClientRect();
    const s = strip.getBoundingClientRect();
    const n = node.getBoundingClientRect();
    const { width, height } = layout.size;
    const clampX = v => Math.max(4, Math.min(width - n.width - 4, v));
    const clampY = v => Math.max(4, Math.min(height - n.height - 4, v));
    let x; let y;
    if (layout.edge === 'left') { x = s.right + gap; y = clampY(a.top + a.height / 2 - n.height / 2); }
    else if (layout.edge === 'right') { x = s.left - gap - n.width; y = clampY(a.top + a.height / 2 - n.height / 2); }
    else if (layout.edge === 'top') { y = s.bottom + gap; x = clampX(a.left + a.width / 2 - n.width / 2); }
    else { y = s.top - gap - n.height; x = clampX(a.left + a.width / 2 - n.width / 2); }
    node.style.left = `${Math.round(x)}px`;
    node.style.top = `${Math.round(y)}px`;
  }

  const button = id => strip.querySelector(`[data-id="${id}"]`);

  function showPill(id) {
    const item = items.find(entry => entry.id === id);
    if (!item || openId || layout.dragging) return;
    pill.replaceChildren(...item.pill.map(seg => el('span', { class: `seg ${seg.level}` }, [seg.name ? el('b', { text: seg.name }) : null, el('span', { text: seg.text })])));
    pill.hidden = false;
    place(pill, button(id), 6);
  }

  function hidePill() {
    clearTimeout(pillTimer);
    clearTimeout(pillHide);
    pill.hidden = true;
  }

  const refreshIcon = () => el('svg:svg', { viewBox: '0 0 16 16', 'aria-hidden': 'true' }, [
    el('svg:path', { d: 'M13.2 8a5.2 5.2 0 1 1-1.5-3.7' }), el('svg:path', { d: 'M13.2 2.6v2.9h-2.9' }),
  ]);

  function bar(row) {
    const track = el('span', { class: `bar${row.usedPct === null ? ' unknown' : ''}` });
    if (row.usedPct !== null) {
      const fill = el('i', { class: row.level });
      fill.style.width = `${Math.max(row.usedPct, 2)}%`;
      track.append(fill);
    }
    return track;
  }

  function tokenSection(id) {
    const series = tokens?.[id];
    if (series?.status === 'unsupported') return null;
    const box = el('section', { class: 'tokens' });
    if (!series) { box.append(el('p', { class: 'muted', text: 'Token 读取中…' })); return box; }
    if (series.status !== 'ok') { box.append(el('p', { class: 'muted', text: 'Token 读取失败' })); return box; }
    const max = Math.max(1, ...series.buckets);
    const W = 312; const H = 44; const step = W / series.buckets.length;
    const chart = el('svg:svg', { class: 'chart', viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: 'none', role: 'img', 'aria-label': `过去 24 小时共 ${fmt(series.total)} tokens` },
      series.buckets.map((n, i) => {
        if (n <= 0) return null;
        const h = Math.max(1, (n / max) * H);
        return el('svg:rect', { x: (i * step + 0.4).toFixed(2), width: (step - 0.8).toFixed(2), y: (H - h).toFixed(2), height: h.toFixed(2), rx: 0.8 });
      }));
    const tip = el('p', { class: 'tip', text: series.partial ? '部分文件本轮未读完' : '悬停柱子查看时段' });
    chart.addEventListener('mousemove', event => {
      const r = chart.getBoundingClientRect();
      const i = Math.max(0, Math.min(series.buckets.length - 1, Math.floor(((event.clientX - r.left) / r.width) * series.buckets.length)));
      const start = new Date(series.startAt + i * QUARTER);
      const end = new Date(start.getTime() + QUARTER);
      tip.textContent = `${start.getMonth() + 1}/${start.getDate()} ${hm(start)}–${hm(end)} · ${fmt(series.buckets[i])} tokens`;
    });
    box.append(el('div', { class: 'tokens-head' }, [el('h3', { text: 'Tokens · 24 小时' }), el('span', { text: fmt(series.total) })]), chart, tip);
    return box;
  }

  function renderCard() {
    const item = items.find(entry => entry.id === openId);
    if (!item) { closeCard(); return; }
    const c = item.card;
    const parts = [
      el('header', { class: 'card-head' }, [
        logo(item, 'card-logo'),
        el('div', { class: 'who' }, [el('h2', { text: item.name }), el('p', { text: c.plan })]),
        el('button', { class: 'icon', type: 'button', 'data-act': 'refresh', 'aria-label': '刷新', title: '刷新' }, [refreshIcon()]),
      ]),
      c.note ? el('p', { class: `note${c.stale ? ' stale' : ''}`, text: c.note }) : null,
      c.balance ? el('p', { class: 'balance', text: c.balance }) : null,
      c.rows.length ? el('div', { class: 'rows' }, c.rows.map(row => el('button', { class: 'row', type: 'button', 'data-act': 'rate', title: '点击切换 已用 / 消耗速率' }, [
        el('span', { class: 'row-label', text: row.label }),
        bar(row),
        el('span', { class: `row-value ${showRate ? 'none' : row.level}`, text: showRate ? row.burn : row.usedPct === null ? '–' : `${row.usedPct}%` }),
        el('span', { class: 'row-reset', text: row.reset }),
      ]))) : null,
      c.tokens ? tokenSection(item.id) : null,
      el('footer', { class: 'card-foot' }, [el('span', { text: c.freshness }), el('button', { class: 'link', type: 'button', 'data-act': 'panel', text: '完整面板' })]),
    ];
    card.replaceChildren(...parts.filter(Boolean));
    place(card, button(item.id), 8);
  }

  function openCard(id) {
    hidePill();
    openId = id;
    showRate = false;
    card.hidden = false;
    strip.classList.add('open');
    renderCard();
    renderStrip();
    window.hud.card(true);
  }

  function closeCard() {
    if (!openId) return;
    openId = null;
    showRate = false;
    card.hidden = true;
    renderStrip();
    window.hud.card(false);
  }

  function setItems(next) {
    items = Array.isArray(next) ? next : [];
    renderStrip();
    if (openId) renderCard();
  }

  strip.addEventListener('mouseenter', () => { clearTimeout(stripHide); strip.classList.add('open'); });
  strip.addEventListener('mouseleave', () => {
    stripHide = setTimeout(() => { if (!openId) strip.classList.remove('open'); }, 250);
    clearTimeout(pillTimer);
    pillHide = setTimeout(hidePill, 200);
  });
  strip.addEventListener('mouseover', event => {
    const target = event.target.closest('.item');
    if (!target || press?.dragging || openId) return;
    clearTimeout(pillHide);
    clearTimeout(pillTimer);
    if (!pill.hidden) showPill(target.dataset.id);
    else pillTimer = setTimeout(() => showPill(target.dataset.id), 150);
  });

  // Press, then more than 4px of movement, is a drag; otherwise it is a click.
  strip.addEventListener('pointerdown', event => {
    if (event.button !== 0) return;
    press = { x: event.screenX, y: event.screenY, id: event.target.closest('.item')?.dataset.id || null, dragging: false };
    try { strip.setPointerCapture(event.pointerId); } catch { /* synthetic events have no capture */ }
  });
  strip.addEventListener('pointermove', event => {
    if (!press || press.dragging) return;
    if (Math.hypot(event.screenX - press.x, event.screenY - press.y) > 4) {
      press.dragging = true;
      hidePill();
      closeCard();
      window.hud.drag('start');
    }
  });
  strip.addEventListener('pointerup', event => {
    if (!press) return;
    const done = press;
    press = null;
    try { strip.releasePointerCapture(event.pointerId); } catch { /* not captured */ }
    if (done.dragging) window.hud.drag('end');
    else if (done.id) { if (openId === done.id) closeCard(); else openCard(done.id); }
  });
  strip.addEventListener('pointercancel', () => {
    if (press?.dragging) window.hud.drag('end');
    press = null;
  });

  card.addEventListener('click', event => {
    const action = event.target.closest('[data-act]');
    if (!action) return;
    if (action.dataset.act === 'rate') { showRate = !showRate; renderCard(); }
    if (action.dataset.act === 'panel') { window.hud.openPanel().catch(() => {}); closeCard(); }
    if (action.dataset.act === 'refresh') {
      action.disabled = true;
      window.hud.refresh().catch(() => {}).finally(() => { action.disabled = false; });
    }
  });

  document.addEventListener('keydown', event => { if (event.key === 'Escape') closeCard(); });
  window.addEventListener('blur', closeCard);

  // The window ignores the mouse except over visible parts; forwarded moves tell us when to stop ignoring.
  document.addEventListener('mousemove', event => {
    const now = Boolean(press) || Boolean(event.target.closest?.('.hit'));
    if (now !== inside) { inside = now; window.hud.pointer(now); }
  });
  document.documentElement.addEventListener('mouseleave', () => {
    if (inside && !press) { inside = false; window.hud.pointer(false); }
  });

  window.hud.onState(setItems);
  window.hud.onTokens(next => { tokens = next; if (openId) renderCard(); });
  window.hud.onLayout(applyLayout);
  window.hud.initial().then(state => {
    applyLayout(state.layout);
    tokens = state.tokens;
    setItems(state.items);
  }).catch(() => {});
})();
