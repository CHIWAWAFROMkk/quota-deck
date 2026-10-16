(function () {
  'use strict';
  const { el, fmtInt, logo } = window.HudDom;
  const NAMES = { claude: 'Claude', codex: 'Codex' };
  const root = document.querySelector('#sources');

  function table(series) {
    return el('table', { class: 'models' }, [
      el('thead', {}, [el('tr', {}, [el('th', { text: 'Model' }), el('th', { text: 'Tokens' }), el('th', { text: 'Share' })])]),
      el('tbody', {}, series.models.map((model, m) => {
        const dot = el('i', { class: 'dot' });
        dot.style.background = window.HudChart.colorOf(model, m);
        return el('tr', {}, [
          el('td', {}, [dot, el('span', { text: model.name })]),
          el('td', { text: fmtInt(model.total) }),
          el('td', { text: `${((model.total / series.total) * 100).toFixed(1)}%` }),
        ]);
      })),
    ]);
  }

  function render(tokens) {
    // null: the main process has not finished its first ledger read yet.
    if (tokens == null) { root.replaceChildren(el('p', { class: 'empty', text: 'Reading…' })); return; }
    const sources = ['claude', 'codex'].map(id => [id, tokens?.[id]]).filter(([, series]) => series?.status === 'ok' && series.total > 0);
    if (!sources.length) { root.replaceChildren(el('p', { class: 'empty', text: 'No token data in the last 24h' })); return; }
    root.replaceChildren(...sources.map(([id, series]) => el('section', { class: 'source' }, [
      el('header', { class: 'source-head' }, [logo(id, 'source-logo'), el('h2', { text: NAMES[id] }), el('span', { class: 'source-total', text: `${fmtInt(series.total)} tokens${series.partial ? ' · partial' : ''}` })]),
      Array.isArray(series.buckets) && series.buckets.length && Number.isFinite(series.startAt) ? window.HudChart.render(series, { height: 120, source: id, axis: true }) : null,
      Array.isArray(series.models) && series.models.length ? table(series) : null,
    ])));
  }

  window.stats.onTokens(render);
  window.stats.initial().then(render).catch(() => render({}));
})();
