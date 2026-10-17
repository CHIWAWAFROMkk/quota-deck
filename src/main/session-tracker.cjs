const { modelName } = require('./model-names.cjs');

const capped = (value, max) => typeof value === 'string' ? value.slice(0, max) : '';
const notifiable = s => s.vendor === 'claude' ? ['claude-vscode', 'cli'].includes(s.source) : s.source === 'codex-desktop';
const returnable = s => ['claude-vscode', 'codex-desktop'].includes(s.source);
const title = s => s.customTitle || s.aiTitle || s.firstPrompt || '';
const kinds = new Set(['meta', 'prompt', 'title', 'model', 'tool-call', 'tool-result', 'turn-end', 'interrupt']);

function createSessionTracker({ startedAt, waitingAfterMs = 30000, abandonAfterMs = 1800000 }) {
  const sessions = new Map();
  const alerts = new Map();

  function ingest(vendor, event) {
    if (!['claude', 'codex'].includes(vendor) || !event || !kinds.has(event.kind) || typeof event.sessionId !== 'string' || !event.sessionId || !Number.isFinite(event.at)) return;
    const key = `${vendor}:${event.sessionId}`;
    if (!sessions.has(key)) sessions.set(key, {
      vendor, sessionId: event.sessionId, source: '', sourceAt: -Infinity,
      firstPrompt: '', aiTitle: '', customTitle: '', aiTitleAt: -Infinity, customTitleAt: -Infinity,
      model: null, modelAt: -Infinity, active: false, promptAt: null,
      lastActivity: -Infinity, transitionAt: -Infinity, endedAt: -Infinity, tools: new Map(),
    });
    const s = sessions.get(key);
    const { kind, at } = event;
    s.lastActivity = Math.max(s.lastActivity, at);
    if (kind === 'meta') {
      if (event.source && at >= s.sourceAt) { s.source = event.source; s.sourceAt = at; }
      return;
    }
    if (kind === 'title') {
      const field = event.custom ? 'customTitle' : 'aiTitle';
      if (at >= s[`${field}At`]) { s[field] = capped(event.title, 60); s[`${field}At`] = at; }
      return;
    }
    if (kind === 'model') {
      if (typeof event.model === 'string' && at >= s.modelAt) { s.model = event.model; s.modelAt = at; }
      return;
    }
    if (kind === 'prompt') {
      if (!s.firstPrompt && event.text) s.firstPrompt = capped(event.text.split(/\r?\n/, 1)[0], 60);
      // A Codex task_started/user pair uses the same timestamp to fill in its
      // title without clearing tools or changing the duration's starting point.
      if (s.promptAt === at || at < s.transitionAt) return;
      s.promptAt = at;
      s.transitionAt = at;
      s.active = true;
      s.tools.clear();
      for (const [id, alert] of alerts) if (alert.vendor === vendor && alert.sessionId === s.sessionId) alerts.delete(id);
      return;
    }
    if (at < s.transitionAt) return;
    if (kind === 'tool-call') {
      if (typeof event.callId !== 'string' || at <= s.endedAt) return;
      // A tail read can start mid-turn, after the prompt has left the tail.
      s.active = true;
      if (!s.tools.has(event.callId)) s.tools.set(event.callId, { at, label: capped(event.label, 80) });
    } else if (kind === 'tool-result') {
      s.tools.delete(event.callId);
    } else if (kind === 'turn-end' && event.messageId && event.messageId === s.endMessageId) {
      // A later line of the same message (e.g. text after thinking) fills in the reply, never a second alert.
      const alert = alerts.get(s.endAlertId);
      if (alert && !alert.text && event.text) alert.text = capped(event.text, 2048);
      s.endedAt = Math.max(s.endedAt, at);
      s.transitionAt = Math.max(s.transitionAt, at);
    } else if (kind === 'interrupt' || kind === 'turn-end') {
      s.endMessageId = kind === 'turn-end' ? event.messageId || null : null;
      s.endAlertId = null;
      s.active = false;
      s.tools.clear();
      s.transitionAt = at;
      const duplicate = at <= s.endedAt;
      s.endedAt = Math.max(s.endedAt, at);
      if (kind === 'interrupt' || duplicate || at < startedAt || !notifiable(s)) return;
      const id = `${key}:${at}`;
      s.endAlertId = id;
      const durationMs = Number.isFinite(event.durationMs) && event.durationMs >= 0 ? event.durationMs
        : s.promptAt === null ? null : Math.max(0, at - s.promptAt);
      alerts.set(id, {
        id, vendor, kind: event.error ? 'error' : 'reply', sessionId: s.sessionId,
        title: title(s), model: modelName(event.model || s.model), text: capped(event.text, 2048),
        tool: null, at, durationMs, returnable: returnable(s),
      });
    }
  }

  function snapshot(now) {
    const vendors = { claude: { phase: 'idle', running: 0 }, codex: { phase: 'idle', running: 0 } };
    const current = [...alerts.values()].map(alert => ({ ...alert, title: title(sessions.get(`${alert.vendor}:${alert.sessionId}`)) }));
    for (const s of sessions.values()) {
      if (!s.active || now - s.lastActivity >= abandonAfterMs) continue;
      vendors[s.vendor].running++;
      if (!notifiable(s)) continue;
      let oldest = null;
      for (const [callId, call] of s.tools) if (!oldest || call.at < oldest.at) oldest = { callId, ...call };
      if (oldest && now - oldest.at >= waitingAfterMs) current.push({
        id: `${s.vendor}:${s.sessionId}:wait:${oldest.callId}`, vendor: s.vendor, kind: 'waiting',
        sessionId: s.sessionId, title: title(s), model: modelName(s.model), text: '', tool: oldest.label,
        at: oldest.at, durationMs: null, returnable: returnable(s),
      });
    }
    current.sort((a, b) => b.at - a.at);
    for (const [vendor, state] of Object.entries(vendors)) {
      state.phase = current.some(a => a.vendor === vendor && a.kind === 'waiting') ? 'asking'
        : current.some(a => a.vendor === vendor) ? 'done' : state.running > 0 ? 'working' : 'idle';
    }
    return { vendors, alerts: current };
  }

  function dismiss(ids) {
    if (Array.isArray(ids)) for (const id of ids) alerts.delete(id);
  }

  return { ingest, snapshot, dismiss };
}

module.exports = { createSessionTracker };
