(function () {
  'use strict';
  const { el, icon } = window.HudDom;
  const RESULTS = { opened: 'Opened', connected: 'Connected', disconnected: 'Disconnected' };
  // ipcRenderer.invoke prefixes errors with "Error invoking remote method '…': Error: ".
  const plainError = error => String(error?.message || 'Failed').replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '');

  // Built once per visit; inputs change the strip live without rebuilding this page.
  function view({ settings, items, back, onChange, onAction }) {
    const status = el('p', { class: 'set-status', 'aria-live': 'polite' });
    const row = (key, label, control) => el('div', { class: 'set-row', 'data-row': key }, [el('span', { text: label }), control]);
    let ringRow = null;

    function toggle(key) {
      const input = el('input', { type: 'checkbox', class: 'switch', role: 'switch', 'data-key': key, 'aria-label': key });
      input.checked = Boolean(settings[key]);
      input.addEventListener('change', () => {
        onChange({ [key]: input.checked });
        if (key === 'showsRings' && ringRow) ringRow.hidden = !input.checked;
      });
      return input;
    }

    function slider(key, min, max, step) {
      const input = el('input', { type: 'range', class: 'slider', 'data-key': key, min, max, step, 'aria-label': key });
      input.value = String(settings[key]);
      const shown = el('span', { class: 'set-value', text: String(settings[key]) });
      input.addEventListener('input', () => { shown.textContent = input.value; onChange({ [key]: Number(input.value) }); });
      return el('span', { class: 'set-slider' }, [input, shown]);
    }

    function action(name, label) {
      const button = el('button', { class: 'btn', type: 'button', text: label });
      button.addEventListener('click', () => {
        button.disabled = true;
        status.textContent = '';
        Promise.resolve(onAction(name))
          .then(result => { status.textContent = RESULTS[result?.status] || 'Done'; }, error => { status.textContent = plainError(error); })
          .finally(() => { button.disabled = false; });
      });
      return button;
    }

    const reset = el('button', { class: 'btn', type: 'button', text: 'Reset' });
    reset.addEventListener('click', () => onChange({ resetPosition: true }));
    const backButton = el('button', { class: 'back', type: 'button', 'data-act': 'back', 'aria-label': 'Back', title: 'Back' }, [icon('back')]);
    backButton.addEventListener('click', back);
    ringRow = row('ringWidth', 'Ring thickness', slider('ringWidth', 1, 4, 0.5));
    ringRow.hidden = !settings.showsRings;

    const claude = items.find(item => item.id === 'claude');
    const claudeNote = claude?.setup === 'claude-disconnect' ? 'statusLine connected'
      : claude?.state === 'live' || claude?.state === 'stale' ? 'Official usage API' : 'Not connected';

    return [
      el('section', { class: 'sec' }, [el('header', { class: 'head' }, [backButton, el('h2', { text: 'Settings' })])]),
      el('section', { class: 'sec set' }, [
        el('h3', { text: 'Display' }),
        row('size', 'Size', slider('size', 16, 40, 1)),
        row('showsRings', 'Show rings', toggle('showsRings')),
        ringRow,
        row('showsNumbers', 'Show numbers', toggle('showsNumbers')),
        row('position', 'Position', reset),
      ]),
      el('section', { class: 'sec set' }, [
        el('h3', { text: 'Connections' }),
        row('claude', 'Claude', el('span', { class: 'set-actions' }, [
          el('span', { class: 'set-note', text: claudeNote }),
          claude?.setup === 'claude-connect' ? action('claude-connect', 'Connect') : null,
          claude?.setup === 'claude-disconnect' ? action('claude-disconnect', 'Disconnect') : null,
          action('claude-help', 'Setup guide'),
        ])),
        row('workbuddy', 'WorkBuddy', action('open-workbuddy', 'Sign in')),
        row('deepseek', 'DeepSeek', el('span', { class: 'set-note', text: 'Set DEEPSEEK_API_KEY to read balance' })),
        status,
      ]),
    ];
  }

  window.HudSettings = { view };
})();
