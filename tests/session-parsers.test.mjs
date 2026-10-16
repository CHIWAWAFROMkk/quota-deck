import test from 'node:test';
import assert from 'node:assert/strict';
import parsers from '../src/main/session-parsers.cjs';

const { parseClaudeLine, createCodexFileParser } = parsers;
const at = Date.parse('2026-10-16T12:00:00Z');
const sessionId = '11111111-2222-3333-4444-555555555555';
const claude = (row, time = at) => JSON.stringify({ sessionId, timestamp: new Date(time).toISOString(), entrypoint: 'claude-vscode', cwd: 'C:\\synthetic', ...row });
const codex = (type, payload, time = at) => JSON.stringify({ type, timestamp: new Date(time).toISOString(), payload });
const bodyEvents = events => events.filter(e => e.kind !== 'meta');
const parseC = row => bodyEvents(parseClaudeLine(claude(row)));
function codexParser() {
  const parser = createCodexFileParser();
  parser.parse(codex('session_meta', { id: sessionId, cwd: 'C:\\synthetic', originator: 'Codex Desktop', thread_source: 'user' }));
  return parser;
}

test('claude prompt, tool call, tool result and end of turn', () => {
  assert.deepEqual(parseClaudeLine(claude({ type: 'user', message: { content: 'Build it' } })), [
    { kind: 'meta', at, sessionId, source: 'claude-vscode', cwd: 'C:\\synthetic' },
    { kind: 'prompt', at, sessionId, text: 'Build it' },
  ]);
  assert.deepEqual(parseC({ type: 'assistant', message: { stop_reason: 'tool_use', content: [
    { type: 'tool_use', id: 'a', name: 'Bash', input: { command: 'npm run build' } },
    { type: 'tool_use', id: 'b', name: 'Read', input: { file_path: 'file.cjs' } },
    { type: 'tool_use', id: 'c', name: 'Grep', input: { pattern: 'needle' } },
  ] } }), [
    { kind: 'tool-call', at, sessionId, callId: 'a', label: 'Bash: npm run build' },
    { kind: 'tool-call', at, sessionId, callId: 'b', label: 'Read: file.cjs' },
    { kind: 'tool-call', at, sessionId, callId: 'c', label: 'Grep: needle' },
  ]);
  assert.deepEqual(parseC({ type: 'user', message: { content: [{ type: 'text', text: 'not a prompt' }, { type: 'tool_result', tool_use_id: 'a' }, { type: 'tool_result', tool_use_id: 'b' }] } }), [
    { kind: 'tool-result', at, sessionId, callId: 'a' }, { kind: 'tool-result', at, sessionId, callId: 'b' },
  ]);
  for (const stop_reason of ['end_turn', 'stop_sequence']) {
    assert.deepEqual(parseC({ type: 'assistant', message: { stop_reason, model: 'claude-opus-4-1', content: [{ type: 'text', text: 'Done' }, { type: 'thinking', thinking: 'hidden' }, { type: 'text', text: ' now' }] } }), [
      { kind: 'turn-end', at, sessionId, text: 'Done now', error: false, durationMs: null, model: 'claude-opus-4-1' },
    ]);
  }
  assert.deepEqual(parseC({ type: 'user', message: { content: '[Request interrupted by user]' } }), [{ kind: 'interrupt', at, sessionId }]);
});

test('claude sidechain, meta and command lines are ignored', () => {
  for (const extra of [{ isSidechain: true }, { isMeta: true }]) {
    assert.deepEqual(parseClaudeLine(claude({ type: 'user', message: { content: 'hello' }, ...extra })), []);
  }
  for (const text of ['<command-name>/help', '<local-command-stdout>ok']) {
    assert.deepEqual(parseClaudeLine(claude({ type: 'user', message: { content: [{ type: 'text', text }] } })), []);
  }
  assert.deepEqual(parseC({ type: 'assistant', message: { stop_reason: null, content: [{ type: 'text', text: 'still writing' }] } }), []);
});

test('claude api error ends the turn with error', () => {
  assert.deepEqual(parseC({ type: 'assistant', isApiErrorMessage: true, message: { content: [{ type: 'text', text: 'Synthetic error' }] } }), [
    { kind: 'turn-end', at, sessionId, text: 'Synthetic error', error: true, durationMs: null, model: null },
  ]);
});

test('claude titles', () => {
  assert.deepEqual(parseC({ type: 'ai-title', aiTitle: 'Automatic' }), [{ kind: 'title', at, sessionId, title: 'Automatic', custom: false }]);
  assert.deepEqual(parseC({ type: 'custom-title', customTitle: 'Chosen' }), [{ kind: 'title', at, sessionId, title: 'Chosen', custom: true }]);
});

test('codex meta sources', () => {
  for (const [originator, thread_source, source] of [
    ['Codex Desktop', 'user', 'codex-desktop'], ['codex_exec', 'user', 'codex-exec'],
    ['Codex Desktop', 'subagent', 'subagent'], ['other', 'user', 'codex-other'],
    ['Codex Desktop', undefined, 'codex-other'],
  ]) {
    assert.deepEqual(createCodexFileParser().parse(codex('session_meta', { id: sessionId, cwd: 'C:\\synthetic', originator, thread_source })), [
      { kind: 'meta', at, sessionId, source, cwd: 'C:\\synthetic' },
    ]);
  }
});

test('codex turn lifecycle with tool calls', () => {
  const parser = codexParser();
  assert.deepEqual(parser.parse(codex('event_msg', { type: 'task_started' })), [{ kind: 'prompt', at, sessionId, text: '' }]);
  assert.deepEqual(parser.parse(codex('turn_context', { model: 'gpt-6' })), [{ kind: 'model', at, sessionId, model: 'gpt-6' }]);
  for (const type of ['function_call', 'custom_tool_call']) {
    const args = type === 'function_call' ? { arguments: JSON.stringify({ cmd: 'npm test' }) } : { input: JSON.stringify({ command: 'npm test' }) };
    assert.deepEqual(parser.parse(codex('response_item', { type, call_id: 'call', name: 'exec', ...args })), [{ kind: 'tool-call', at, sessionId, callId: 'call', label: 'exec: npm test' }]);
    assert.deepEqual(parser.parse(codex('response_item', { type: `${type}_output`, call_id: 'call', output: 'synthetic result' })), [{ kind: 'tool-result', at, sessionId, callId: 'call' }]);
  }
  assert.deepEqual(parser.parse(codex('event_msg', { type: 'task_complete', last_agent_message: 'Finished', duration_ms: 8000 }, at + 8000)), [
    { kind: 'turn-end', at: at + 8000, sessionId, text: 'Finished', error: false, durationMs: 8000, model: 'gpt-6' },
  ]);
  assert.deepEqual(parser.parse(codex('event_msg', { type: 'turn_aborted' })), [{ kind: 'interrupt', at, sessionId }]);
  assert.deepEqual(parser.parse(codex('event_msg', { type: 'task_complete', error: 'failed' })), [{ kind: 'turn-end', at, sessionId, text: 'failed', error: true, durationMs: null, model: 'gpt-6' }]);
});

test('codex error turns carry the error message as text', () => {
  const parser = codexParser();
  const long = 'e'.repeat(3000);
  for (const [last_agent_message, error, expected] of [
    [null, { message: 'Synthetic object error', codex_error_info: 'synthetic' }, 'Synthetic object error'],
    [undefined, { message: 'Synthetic missing reply' }, 'Synthetic missing reply'],
    ['', { message: 'Synthetic empty reply' }, 'Synthetic empty reply'],
    [null, 'Synthetic string error', 'Synthetic string error'],
    ['', 'Synthetic string error', 'Synthetic string error'],
    [null, { message: long }, long.slice(0, 2048)],
    [null, long, long.slice(0, 2048)],
    ['Agent reply', { message: 'Synthetic error' }, 'Agent reply'],
    ['Agent reply', 'Synthetic error', 'Agent reply'],
    [null, { message: 123 }, ''],
    [null, true, ''],
    [null, [{ message: 'Not an error object' }], ''],
  ]) {
    assert.deepEqual(parser.parse(codex('event_msg', { type: 'task_complete', last_agent_message, error })), [
      { kind: 'turn-end', at, sessionId, text: expected, error: true, durationMs: null, model: null },
    ]);
  }
});

test('codex user text skips environment context', () => {
  const parser = codexParser();
  parser.parse(codex('event_msg', { type: 'task_started' }));
  assert.deepEqual(parser.parse(codex('response_item', { type: 'message', role: 'user', content: [
    { type: 'input_text', text: '<environment_context>synthetic</environment_context>' },
    { type: 'input_text', text: 'Make a widget' }, { type: 'input_text', text: 'Extra' },
  ] }, at + 5000)), [{ kind: 'prompt', at, sessionId, text: 'Make a widget' }], 'same at enriches the started prompt without restarting it');
});

test('codex prompt pairing works in either order and never spans completed turns', () => {
  const parser = codexParser();
  const user = { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Widget' }] };
  assert.equal(parser.parse(codex('response_item', user))[0].at, at);
  assert.deepEqual(parser.parse(codex('event_msg', { type: 'task_started' }, at + 100)), []);
  parser.parse(codex('event_msg', { type: 'task_complete' }, at + 200));
  assert.equal(parser.parse(codex('event_msg', { type: 'task_started' }, at + 300))[0].at, at + 300);
  assert.equal(parser.parse(codex('response_item', user, at + 6000))[0].at, at + 6000);
});

test('bad lines yield no events', () => {
  const parser = codexParser();
  for (const line of ['{', '', 'null', '[]', '42', JSON.stringify({ type: 'unknown' }), claude({ type: 'unknown' }), codex('event_msg', null)]) {
    assert.deepEqual(parseClaudeLine(line), []);
    assert.deepEqual(parser.parse(line), []);
  }
  assert.deepEqual(createCodexFileParser().parse(codex('event_msg', { type: 'task_complete' })), [], 'a file cannot borrow another parser\'s session');
});

test('long texts are capped', () => {
  const long = 'x'.repeat(5000);
  assert.equal(parseC({ type: 'assistant', message: { stop_reason: 'end_turn', content: [{ type: 'text', text: long }] } })[0].text.length, 2048);
  assert.equal(parseC({ type: 'assistant', message: { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 'a', name: 'Bash', input: { command: long } }] } })[0].label.length, 80);
  assert.equal(parseC({ type: 'ai-title', aiTitle: long })[0].title.length, 60);
  assert.equal(parseC({ type: 'custom-title', customTitle: long })[0].title.length, 60);
  const parser = codexParser();
  assert.equal(parser.parse(codex('event_msg', { type: 'task_complete', last_agent_message: long }))[0].text.length, 2048);
  assert.equal(parser.parse(codex('response_item', { type: 'function_call', call_id: 'a', name: 'exec', arguments: JSON.stringify({ cmd: long }) }))[0].label.length, 80);
});
