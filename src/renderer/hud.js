(function () {
  'use strict';
  const stripNode = document.querySelector('#strip');
  const cardNode = document.querySelector('#card');
  // Backward compatible: a main process that sends no settings still gets a drawn strip.
  const DEFAULT_SETTINGS = { size: 22, ringWidth: 1.5, showsRings: true, showsNumbers: true, metrics: {} };
  const withDefaults = next => ({ ...DEFAULT_SETTINGS, ...(next || {}), metrics: { ...(next?.metrics || {}) } });
  let layout = null;
  let items = [];
  let tokens = null;
  let sessions = null;
  let settings = null;
  let lastHits = '';
  // Notch and strip are alternatives; the main process says which through layout.mode.
  let notchMode = false;
  let notch = null;

  // Tell the main process where the visible parts are; it turns click-through off only over them.
  function reportHits() {
    // Layout boxes, not getBoundingClientRect: the card is still scaled down while it opens,
    // and clicks on its final area must not fall through to the window below.
    // The notch reports where its resize is heading, so freshly grown wings are clickable at once.
    const rects = [...document.querySelectorAll('.hit')].filter(node => !node.hidden)
      .map(node => (node.id === 'notch' && notch ? (({ left, top, width, height }) => ({ x: left, y: top, width, height }))(notch.rect())
        : { x: node.offsetLeft, y: node.offsetTop, width: node.offsetWidth, height: node.offsetHeight }));
    const key = JSON.stringify(rects);
    if (key === lastHits) return;
    lastHits = key;
    window.hud.hits(rects);
  }
  const scheduleHits = () => requestAnimationFrame(reportHits);

  const strip = window.HudStrip.create({
    root: stripNode,
    pill: document.querySelector('#pill'),
    frame: document.querySelector('#dragframe'),
    isBlocked: () => notchMode || Boolean(layout?.dragging) || card.isOpen(),
    onClick: id => card.toggle(id),
    onDragStart: () => card.close(),
    onStrips: value => window.hud.strips(value),
    onAlertsChanged: () => scheduleHits(),
  });

  const card = window.HudCard.create({
    root: cardNode,
    strip,
    getNotch: () => (notchMode ? notch : null),
    getItem: id => items.find(item => item.id === id),
    getTokens: () => tokens,
    getMetric: id => settings?.metrics?.[id] || 'quota',
    setMetric(id, metric) {
      settings = { ...settings, metrics: { ...settings?.metrics, [id]: metric } };
      card.refresh();
      window.hud.setSettings({ metrics: { [id]: metric } }).catch(() => {});
    },
    settingsView: ({ back }) => window.HudSettings.view({
      settings,
      getSettings: () => settings,
      getItems: () => items,
      back,
      onChange: patch => window.hud.setSettings(patch).catch(() => {}),
      onAction: name => window.hud.action(name),
    }),
    onOpenStats: () => { window.hud.openStats().catch(() => {}); },
    onChange: () => { notch?.hold(card.isOpen()); scheduleHits(); },
    getAlerts: vendor => (Array.isArray(sessions?.alerts) ? sessions.alerts : []).filter(alert => alert && alert.vendor === vendor),
    onDismiss: ids => window.hud.dismiss(ids),
    onReturn: id => window.hud.returnTo(id),
  });

  notch = window.HudNotch.create({
    root: document.querySelector('#notch'),
    onClick: id => card.toggle(id),
    onChange: () => { card.reposition(); scheduleHits(); },
  });

  new ResizeObserver(scheduleHits).observe(stripNode);

  function applyLayout(next) {
    if (!next) return;
    layout = next;
    document.body.classList.remove('edge-left', 'edge-right', 'edge-top', 'edge-bottom');
    document.body.classList.add(`edge-${layout.edge}`);
    document.body.classList.toggle('dragging', layout.dragging);
    if (layout.dragging) { strip.hidePill(true); card.close(); }
    notchMode = notch.place(layout);
    stripNode.hidden = notchMode;
    document.body.classList.toggle('mode-notch', notchMode);
    // A notch layout carries no strip box; the strip keeps its last place until it comes back.
    if (layout.strip) strip.place(layout);
    if (notchMode) strip.hidePill(true); else strip.renderAlerts();
    card.reposition();
    scheduleHits();
  }

  window.hud.onState(next => { items = Array.isArray(next) ? next : []; strip.setItems(items); notch.setItems(items); card.refresh(); scheduleHits(); });
  window.hud.onTokens(next => { tokens = next; card.refresh(); });
  window.hud.onSettings(next => { settings = withDefaults(next); strip.setSettings(settings); notch.setSettings(settings); card.refresh(); scheduleHits(); });
  window.hud.onLayout(applyLayout);
  window.hud.onSessions(next => { sessions = next; strip.setSessions(next); notch.setSessions(next); card.refresh(); scheduleHits(); });
  // A game hides the whole window; nothing stays open behind it, and the glow flashes again afterwards.
  // The main process forgets the clickable areas while gaming, so they are reported again afterwards.
  window.hud.onGaming?.(gaming => {
    if (gaming) { card.close({ keepAlerts: true }); notch.rest(); return; }
    lastHits = '';
    scheduleHits();
    notch.replay();
  });
  document.addEventListener('keydown', event => { if (event.key === 'Escape') card.close(); });
  window.addEventListener('blur', () => card.close());

  // Items go in before settings: the strip only renders once it has settings, and its
  // first measurement should already include every number.
  document.fonts.load('500 13px Inter').catch(() => {}).then(() => window.hud.initial()).then(state => {
    items = Array.isArray(state.items) ? state.items : [];
    tokens = state.tokens;
    settings = withDefaults(state.settings);
    strip.setItems(items);
    notch.setItems(items);
    sessions = state.sessions || null;
    strip.setSessions(sessions);
    notch.setSessions(sessions);
    strip.setSettings(settings);
    notch.setSettings(settings);
    applyLayout(state.layout);
  }).catch(() => {});
})();
