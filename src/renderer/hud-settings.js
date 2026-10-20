(function () {
  'use strict';
  const { el, icon } = window.HudDom;
  const RESULTS = { opened: 'Opened', connected: 'Connected', disconnected: 'Disconnected' };
  // ipcRenderer.invoke prefixes errors with "Error invoking remote method '…': Error: ".
  const plainError = error => String(error?.message || 'Failed').replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '');

  // Built once per visit; inputs change the strip live without rebuilding this page.
  function view({ settings, getSettings = () => settings, getItems, back, onChange, onAction }) {
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

    // The Claude row follows each state push (e.g. after Connect) without rebuilding the sliders.
    const claudeBox = el('span', { class: 'set-actions' });
    function renderClaude() {
      const claude = getItems().find(item => item.id === 'claude');
      const note = claude?.setup === 'claude-disconnect' ? 'statusLine connected'
        : claude?.state === 'live' || claude?.state === 'stale' ? 'Official usage API' : 'Not connected';
      claudeBox.replaceChildren(...[
        el('span', { class: 'set-note', text: note }),
        claude?.setup === 'claude-connect' ? action('claude-connect', 'Connect') : null,
        claude?.setup === 'claude-disconnect' ? action('claude-disconnect', 'Disconnect') : null,
        action('claude-help', 'Setup guide'),
      ].filter(Boolean));
    }
    renderClaude();

    // Approval hooks can be installed for Claude and, when present, Codex. Missing state
    // from an older main process reads as not connected instead of breaking the page.
    const approvalBox = el('span', { class: 'set-actions' });
    function renderApprovals() {
      const source = getSettings()?.approvals;
      const approvals = source && typeof source === 'object' && !Array.isArray(source) ? source : {};
      const connected = approvals.claude === true || approvals.codex === true;
      approvalBox.replaceChildren(...[
        el('span', { class: 'set-note', text: connected ? 'Connected' : 'Not connected' }),
        // Trust is needed once the Codex hook is installed: Codex ignores untrusted hooks until /hooks.
        approvals.codex === true ? el('span', { class: 'set-note', text: 'Codex: run /hooks once to trust' }) : null,
        action(connected ? 'approval-disconnect' : 'approval-connect', connected ? 'Disconnect' : 'Connect'),
      ].filter(Boolean));
    }
    renderApprovals();

    const nodes = [
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
        row('claude', 'Claude', claudeBox),
        row('approvals', 'Approvals', approvalBox),
        row('workbuddy', 'WorkBuddy', action('open-workbuddy', 'Sign in')),
        row('deepseek', 'DeepSeek', el('span', { class: 'set-note', text: 'Set DEEPSEEK_API_KEY to read balance' })),
        status,
      ]),
    ];
    nodes.update = () => { renderClaude(); renderApprovals(); };
    return nodes;
  }

  window.HudSettings = { view };
})();
