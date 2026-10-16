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
  let settings = null;
  let lastHits = '';

  // Tell the main process where the visible parts are; it turns click-through off only over them.
  function reportHits() {
    // Layout boxes, not getBoundingClientRect: the card is still scaled down while it opens,
    // and clicks on its final area must not fall through to the window below.
    const rects = [...document.querySelectorAll('.hit')].filter(node => !node.hidden)
      .map(node => ({ x: node.offsetLeft, y: node.offsetTop, width: node.offsetWidth, height: node.offsetHeight }));
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
    isBlocked: () => Boolean(layout?.dragging) || card.isOpen(),
    onClick: id => card.toggle(id),
    onDragStart: () => card.close(),
    onStrips: value => window.hud.strips(value),
  });

  const card = window.HudCard.create({
    root: cardNode,
    strip,
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
      getItems: () => items,
      back,
      onChange: patch => window.hud.setSettings(patch).catch(() => {}),
      onAction: name => window.hud.action(name),
    }),
    onOpenStats: () => { window.hud.openStats().catch(() => {}); },
    onChange: scheduleHits,
  });

  new ResizeObserver(scheduleHits).observe(stripNode);

  function applyLayout(next) {
    if (!next) return;
    layout = next;
    document.body.classList.remove('edge-left', 'edge-right', 'edge-top', 'edge-bottom');
    document.body.classList.add(`edge-${layout.edge}`);
    document.body.classList.toggle('dragging', layout.dragging);
    if (layout.dragging) { strip.hidePill(true); card.close(); }
    strip.place(layout);
    card.reposition();
    scheduleHits();
  }

  window.hud.onState(next => { items = Array.isArray(next) ? next : []; strip.setItems(items); card.refresh(); scheduleHits(); });
  window.hud.onTokens(next => { tokens = next; card.refresh(); });
  window.hud.onSettings(next => { settings = withDefaults(next); strip.setSettings(settings); card.refresh(); scheduleHits(); });
  window.hud.onLayout(applyLayout);
  document.addEventListener('keydown', event => { if (event.key === 'Escape') card.close(); });
  window.addEventListener('blur', () => card.close());

  // Items go in before settings: the strip only renders once it has settings, and its
  // first measurement should already include every number.
  document.fonts.load('500 13px Inter').catch(() => {}).then(() => window.hud.initial()).then(state => {
    items = Array.isArray(state.items) ? state.items : [];
    tokens = state.tokens;
    settings = withDefaults(state.settings);
    strip.setItems(items);
    strip.setSettings(settings);
    applyLayout(state.layout);
  }).catch(() => {});
})();
