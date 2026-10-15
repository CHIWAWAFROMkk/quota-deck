(function () {
  'use strict';
  const stripNode = document.querySelector('#strip');
  // Backward compatible: a main process that sends no settings still gets a drawn strip.
  const DEFAULT_SETTINGS = { size: 22, ringWidth: 1.5, showsRings: true, showsNumbers: true, metrics: {} };
  const withDefaults = next => ({ ...DEFAULT_SETTINGS, ...(next || {}), metrics: { ...(next?.metrics || {}) } });
  let layout = null;
  let lastHits = '';

  const strip = window.HudStrip.create({
    root: stripNode,
    pill: document.querySelector('#pill'),
    frame: document.querySelector('#dragframe'),
    isBlocked: () => Boolean(layout?.dragging),
    onClick: () => {},
    onDragStart: () => {},
    onStrips: value => window.hud.strips(value),
  });

  // Tell the main process where the visible parts are; it turns click-through off only over them.
  function reportHits() {
    const rects = [...document.querySelectorAll('.hit')].filter(node => !node.hidden).map(node => node.getBoundingClientRect())
      .map(r => ({ x: Math.floor(r.left), y: Math.floor(r.top), width: Math.ceil(r.width), height: Math.ceil(r.height) }));
    const key = JSON.stringify(rects);
    if (key === lastHits) return;
    lastHits = key;
    window.hud.hits(rects);
  }
  const scheduleHits = () => requestAnimationFrame(reportHits);
  new ResizeObserver(scheduleHits).observe(stripNode);

  function applyLayout(next) {
    if (!next) return;
    layout = next;
    document.body.classList.remove('edge-left', 'edge-right', 'edge-top', 'edge-bottom');
    document.body.classList.add(`edge-${layout.edge}`);
    document.body.classList.toggle('dragging', layout.dragging);
    if (layout.dragging) strip.hidePill(true);
    strip.place(layout);
    scheduleHits();
  }

  window.hud.onState(next => { strip.setItems(next); scheduleHits(); });
  window.hud.onSettings(next => { strip.setSettings(withDefaults(next)); scheduleHits(); });
  window.hud.onLayout(applyLayout);
  // Numbers are measured with Inter, so wait for it before the first measurement.
  // Items go in before settings: the strip only renders once it has settings, and its
  // first measurement should already include every number.
  document.fonts.load('500 13px Inter').catch(() => {}).then(() => window.hud.initial()).then(state => {
    strip.setItems(state.items);
    strip.setSettings(withDefaults(state.settings));
    applyLayout(state.layout);
  }).catch(() => {});
})();
