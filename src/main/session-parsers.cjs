// Log contents stay in memory. These parsers never log or persist their input.
const text = (value, limit = 2048) => typeof value === 'string' ? value.slice(0, limit) : '';
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
function json(line) {
  try { const value = JSON.parse(line); return object(value) ? value : null; }
  catch { return null; }
}
const timestamp = value => typeof value === 'number' ? value : typeof value === 'string' ? Date.parse(value) : NaN;
const blocks = content => Array.isArray(content) ? content.filter(object) : [];
const messageText = content => typeof content === 'string' ? text(content) : text(blocks(content).filter(b => b.type === 'text').map(b => text(b.text)).join(''));
function toolLabel(name, input, keys) {
  const detail = keys.map(key => input?.[key]).find(value => typeof value === 'string');
  return text(`${text(name, 80)}${detail === undefined ? '' : `: ${text(detail, 80)}`}`, 80);
}

function parseClaudeLine(line) {
  const row = json(line);
  if (!row || row.isSidechain === true || row.isMeta === true) return [];
  const at = timestamp(row.timestamp);
  if (typeof row.sessionId !== 'string' || !row.sessionId || !Number.isFinite(at)) return [];
  const base = { at, sessionId: row.sessionId };
  const event = (kind, fields = {}) => ({ kind, ...base, ...fields });
  const message = object(row.message) ? row.message : {};
  let events = [];
  if (row.type === 'user') {
    const results = blocks(message.content).filter(b => b.type === 'tool_result' && typeof b.tool_use_id === 'string');
    if (results.length) events = results.map(b => event('tool-result', { callId: b.tool_use_id }));
    else {
      const value = messageText(message.content);
      if (!value || /^<(?:command-|local-command-)/.test(value)) return [];
      events = [value.startsWith('[Request interrupted') ? event('interrupt') : event('prompt', { text: value })];
    }
  } else if (row.type === 'assistant') {
    if (row.isApiErrorMessage === true || ['end_turn', 'stop_sequence'].includes(message.stop_reason)) {
      events = [event('turn-end', { text: messageText(message.content), error: row.isApiErrorMessage === true, durationMs: null, model: typeof message.model === 'string' ? message.model : null })];
    } else if (message.stop_reason === 'tool_use') {
      events = blocks(message.content).filter(b => b.type === 'tool_use' && typeof b.id === 'string').map(b => event('tool-call', { callId: b.id, label: toolLabel(b.name, b.input, ['command', 'file_path', 'pattern']) }));
    }
  } else if (row.type === 'ai-title' || row.type === 'custom-title') {
    const custom = row.type === 'custom-title';
    events = [event('title', { title: text(custom ? row.customTitle : row.aiTitle, 60), custom })];
  } else return [];
  return [event('meta', { source: text(row.entrypoint, 80), cwd: typeof row.cwd === 'string' ? row.cwd : '' }), ...events];
}

function createCodexFileParser() {
  let sessionId = null;
  let model = null;
  let prompt = null;
  return { parse(line) {
    const row = json(line);
    if (!row || !object(row.payload)) return [];
    const p = row.payload;
    const at = timestamp(row.timestamp);
    if (!Number.isFinite(at)) return [];
    if (row.type === 'session_meta') {
      if (typeof p.id !== 'string' || !p.id) return [];
      sessionId = p.id;
      model = null;
      prompt = null;
      const source = p.originator === 'Codex Desktop' && p.thread_source === 'user' ? 'codex-desktop'
        : p.originator === 'codex_exec' ? 'codex-exec'
          : p.thread_source === 'subagent' ? 'subagent' : 'codex-other';
      return [{ kind: 'meta', at, sessionId, source, cwd: typeof p.cwd === 'string' ? p.cwd : '' }];
    }
    if (!sessionId) return [];
    const event = (kind, fields = {}) => ({ kind, at, sessionId, ...fields });
    // The streamed start must be visible immediately. The matching user message
    // enriches the SAME prompt timestamp; the tracker must not restart that turn.
    function start(origin, value) {
      if (prompt && prompt.origin !== origin && !prompt.paired && Math.abs(at - prompt.at) <= 5000) {
        prompt.paired = true;
        return origin === 'user' ? [event('prompt', { at: prompt.at, text: value })] : [];
      }
      prompt = { at, origin, paired: false };
      return [event('prompt', { text: value })];
    }
    if (row.type === 'turn_context') {
      if (typeof p.model !== 'string') return [];
      model = p.model;
      return [event('model', { model })];
    }
    if (row.type === 'event_msg') {
      if (p.type === 'task_started') return start('started', '');
      if (p.type === 'task_complete') {
        prompt = null;
        const reply = text(p.last_agent_message) || text(object(p.error) ? p.error.message : p.error);
        return [event('turn-end', { text: reply, error: Boolean(p.error), durationMs: Number.isFinite(p.duration_ms) && p.duration_ms >= 0 ? p.duration_ms : null, model })];
      }
      if (p.type === 'turn_aborted') { prompt = null; return [event('interrupt')]; }
    }
    if (row.type === 'response_item') {
      if (p.type === 'message' && p.role === 'user') {
        const value = blocks(p.content).find(b => typeof b.text === 'string' && b.text.trim() && !b.text.trimStart().startsWith('<'))?.text;
        return value ? start('user', text(value)) : [];
      }
      if (['function_call', 'custom_tool_call'].includes(p.type) && typeof p.call_id === 'string') {
        const raw = p.arguments ?? p.input;
        const input = typeof raw === 'string' ? json(raw) : raw;
        return [event('tool-call', { callId: p.call_id, label: toolLabel(p.name, input, ['cmd', 'command']) })];
      }
      if (['function_call_output', 'custom_tool_call_output'].includes(p.type) && typeof p.call_id === 'string') return [event('tool-result', { callId: p.call_id })];
    }
    return [];
  } };
}

module.exports = { parseClaudeLine, createCodexFileParser };
