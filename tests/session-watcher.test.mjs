import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import watcherModule from '../src/main/session-watcher.cjs';
import trackerModule from '../src/main/session-tracker.cjs';

const sessionId = '11111111-2222-3333-4444-555555555555';
const c = (at, type, fields = {}) => JSON.stringify({ sessionId, timestamp: new Date(at).toISOString(), entrypoint: 'claude-vscode', cwd: 'C:\\synthetic', type, ...fields }) + '\n';
const end = (at, text = 'Synthetic reply') => c(at, 'assistant', { message: { stop_reason: 'end_turn', content: [{ type: 'text', text }] } });
const x = (at, type, payload) => JSON.stringify({ timestamp: new Date(at).toISOString(), type, payload }) + '\n';
async function setup(options = {}) {
  await fs.mkdir('work', { recursive: true });
  const root = await fs.mkdtemp(path.resolve('work/session-watcher-'));
  let now = Date.now();
  const tracker = trackerModule.createSessionTracker({ startedAt: now });
  const changes = [];
  const claudeRoot = path.join(root, 'claude');
  const codexRoot = path.join(root, 'codex');
  const watcher = watcherModule.createSessionWatcher({ tracker, onChange: snapshot => changes.push(snapshot), claudeRoot, codexRoot, clock: () => now, ...options });
  async function write(file, content, modified = now) {
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, content, 'utf8');
    await fs.utimes(file, new Date(modified), new Date(modified));
  }
  async function append(file, content) {
    await fs.appendFile(file, content, 'utf8');
    await fs.utimes(file, new Date(now), new Date(now));
  }
  return { watcher, tracker, changes, claudeRoot, codexRoot, write, append, now: () => now, advance: ms => { now += ms; }, file: path.join(claudeRoot, 'project', 'session.jsonl') };
}

test('a new claude turn-end is reported via onChange', async () => {
  const s = await setup();
  await s.write(s.file, c(s.now(), 'user', { message: { content: 'Build' } }));
  await s.watcher.rescan();
  await s.watcher.tick();
  assert.equal(s.changes.at(-1).vendors.claude.phase, 'working');
  s.advance(1000);
  await s.append(s.file, end(s.now()));
  await s.watcher.tick();
  assert.equal(s.changes.at(-1).alerts[0].text, 'Synthetic reply');
  const count = s.changes.length;
  await s.watcher.tick();
  assert.equal(s.changes.length, count, 'unchanged snapshots are not pushed');
});

test('a turn-end split across two reads alerts exactly once', async () => {
  const s = await setup();
  const row = Buffer.from(end(s.now(), '完成了'));
  const split = row.indexOf(Buffer.from('完')) + 1;
  await s.write(s.file, row.subarray(0, split));
  await s.watcher.rescan();
  await s.watcher.tick();
  assert.deepEqual(s.changes.at(-1).alerts, []);
  await s.append(s.file, row.subarray(split));
  await s.watcher.tick();
  await s.watcher.tick();
  assert.equal(s.changes.filter(v => v.alerts.length).length, 1);
  assert.equal(s.changes.at(-1).alerts[0].text, '完成了', 'UTF-8 can straddle reads too');
});

test('codex files under year/month/day are found and parsed', async () => {
  const s = await setup();
  await s.write(path.join(s.codexRoot, '2026', '10', '16', 'rollout.jsonl'),
    x(s.now(), 'session_meta', { id: sessionId, originator: 'Codex Desktop', thread_source: 'user' }) +
    x(s.now(), 'event_msg', { type: 'task_started' }) +
    x(s.now(), 'turn_context', { model: 'gpt-6' }) +
    x(s.now() + 500, 'event_msg', { type: 'task_complete', last_agent_message: 'Done', duration_ms: 500 }));
  await s.watcher.rescan();
  await s.watcher.tick();
  assert.equal(s.changes.at(-1).alerts[0].vendor, 'codex');
  assert.equal(s.changes.at(-1).alerts[0].model, 'GPT-6');
});

test('a long codex file still yields its title and model from the head', async () => {
  for (const options of [{}, { headBytes: 1024 }]) {
    const s = await setup({ tailBytes: 600, ...options });
    const file = path.join(s.codexRoot, '2026', '10', '16', 'long.jsonl');
    const content = x(s.now() - 10000, 'session_meta', { id: sessionId, originator: 'Codex Desktop', thread_source: 'user' }) +
      x(s.now() - 9000, 'turn_context', { model: 'gpt-6' }) +
      x(s.now() - 8000, 'response_item', { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'First synthetic request' }] }) +
      x(s.now() - 7000, 'event_msg', { type: 'task_complete', last_agent_message: 'Old reply' }) +
      x(s.now() - 1000, 'response_item', { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'x'.repeat(70000) }] }) +
      x(s.now() + 500, 'event_msg', { type: 'task_complete', last_agent_message: 'Latest reply' });
    assert.ok(Buffer.byteLength(content) > 65536 + 600);
    await s.write(file, content);
    await s.watcher.rescan();
    await s.watcher.tick();
    await s.watcher.tick();
    const { alerts, vendors } = s.changes.at(-1);
    assert.equal(alerts.length, 1);
    assert.equal(alerts[0].title, 'First synthetic request');
    assert.equal(alerts[0].model, 'GPT-6');
    assert.equal(alerts[0].text, 'Latest reply');
    assert.equal(vendors.codex.running, 0);
  }
});

test('head and tail overlap ingests each record once for both vendors', async () => {
  for (const vendor of ['claude', 'codex']) {
    for (const wholeFile of [false, true]) {
      const at = Date.now();
      const prefix = vendor === 'codex' ? x(at, 'session_meta', { id: sessionId, originator: 'Codex Desktop', thread_source: 'user' }) +
        x(at, 'turn_context', { model: 'gpt-6' }) : '';
      const prompt = vendor === 'codex' ? x(at, 'response_item', { type: 'message', role: 'user', content: [{ type: 'input_text', text: '完成合成任务' }] }) :
        c(at, 'user', { message: { content: '完成合成任务' } });
      const reply = vendor === 'codex' ? x(at + 500, 'event_msg', { type: 'task_complete', last_agent_message: 'Done' }) : end(at + 500, 'Done');
      const content = Buffer.from(prefix + prompt + '{}\n'.repeat(100) + reply);
      const split = content.indexOf(Buffer.from('完')) + 1;
      const s = await setup({ headBytes: wholeFile ? content.length + 100 : split, tailBytes: content.length - split + 20 });
      const ingested = [];
      const ingest = s.tracker.ingest;
      s.tracker.ingest = (source, event) => { ingested.push(event); ingest(source, event); };
      const file = vendor === 'codex' ? path.join(s.codexRoot, '2026', '10', '16', 'overlap.jsonl') : s.file;
      await s.write(file, content);
      await s.watcher.rescan();
      await s.watcher.tick();
      assert.equal(ingested.filter(e => e.kind === 'prompt').length, 1);
      assert.equal(ingested.filter(e => e.kind === 'turn-end').length, 1);
      assert.equal(s.changes.at(-1).alerts.length, 1);
      assert.equal(s.changes.at(-1).alerts[0].title, '完成合成任务');
    }
  }
});

test('older head events enrich the title without replacing newer tracker state', async () => {
  const s = await setup({ headBytes: 1024, tailBytes: 600 });
  const ingest = (kind, at, fields = {}) => s.tracker.ingest('codex', { kind, at, sessionId, ...fields });
  ingest('meta', s.now(), { source: 'codex-desktop' });
  ingest('prompt', s.now() + 300);
  ingest('model', s.now() + 300, { model: 'gpt-6' });
  ingest('tool-call', s.now() + 400, { callId: 'current-tool', label: 'Current tool' });
  await s.write(path.join(s.codexRoot, '2026', '10', '16', 'older.jsonl'),
    x(s.now() - 10000, 'session_meta', { id: sessionId, originator: 'Codex Desktop', thread_source: 'user' }) +
    x(s.now() + 100, 'turn_context', { model: 'older-synthetic-model' }) +
    x(s.now() + 100, 'response_item', { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Original synthetic request' }] }) +
    x(s.now() + 200, 'event_msg', { type: 'task_complete', last_agent_message: 'Older reply after startup' }) +
    '{}\n'.repeat(1000));
  await s.watcher.rescan();
  await s.watcher.tick();
  assert.deepEqual(s.changes.at(-1).alerts, [], 'an older turn-end after startup must not alert');
  assert.equal(s.changes.at(-1).vendors.codex.running, 1);
  s.advance(30400);
  await s.watcher.tick();
  const [waiting] = s.changes.at(-1).alerts;
  assert.equal(waiting.kind, 'waiting');
  assert.equal(waiting.title, 'Original synthetic request');
  assert.equal(waiting.model, 'GPT-6', 'an older model must not replace the current model');
  assert.equal(waiting.tool, 'Current tool', 'an older prompt must not clear current tools');
});

test('files older than the active window are ignored', async () => {
  let opens = 0;
  const s = await setup({ fileSystem: { ...fs, open: async (...args) => { opens++; return fs.open(...args); } } });
  await s.write(s.file, end(s.now()), s.now() - 1800001);
  await s.watcher.rescan();
  await s.watcher.tick();
  assert.equal(opens, 0);
  assert.deepEqual(s.changes.at(-1).alerts, []);
});

test('a truncated file is reread without duplicate alerts', async () => {
  const s = await setup();
  const reply = end(s.now());
  await s.write(s.file, '{}\n'.repeat(100) + reply + '{"unfinished":');
  await s.watcher.rescan();
  await s.watcher.tick();
  assert.equal(s.changes.at(-1).alerts.length, 1);
  s.tracker.dismiss(s.changes.at(-1).alerts.map(a => a.id));
  await s.watcher.tick();
  const pushes = s.changes.length;
  await s.write(s.file, reply);
  await s.watcher.tick();
  assert.equal(s.changes.length, pushes, 'rewriting cannot resurrect a dismissed reply');
  s.advance(1000);
  await s.append(s.file, end(s.now(), 'Next'));
  await s.watcher.tick();
  assert.equal(s.changes.at(-1).alerts[0].text, 'Next');
});

test('missing roots are not an error', async () => {
  const s = await setup();
  await s.watcher.rescan();
  await s.watcher.tick();
  assert.deepEqual(s.changes.at(-1), { vendors: { claude: { phase: 'idle', running: 0 }, codex: { phase: 'idle', running: 0 } }, alerts: [] });
});

test('stop clears timers', async t => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  let scans = 0;
  const s = await setup({ fileSystem: { ...fs, readdir: async (...args) => { scans++; return fs.readdir(...args); } } });
  try {
    await s.watcher.start();
    s.watcher.stop();
    const count = scans;
    t.mock.timers.tick(120000);
    await Promise.resolve();
    assert.equal(scans, count);
  } finally { s.watcher.stop(); t.mock.timers.reset(); }
});

test('tail reads discard the first partial line and retain Codex file metadata', async () => {
  const s = await setup({ tailBytes: 600 });
  const file = path.join(s.codexRoot, '2026', '10', '16', 'tail.jsonl');
  await s.write(file, x(s.now() - 10000, 'session_meta', { id: sessionId, originator: 'Codex Desktop', thread_source: 'user' }) +
    x(s.now() - 1000, 'response_item', { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'x'.repeat(3000) }] }) +
    x(s.now(), 'event_msg', { type: 'task_complete', last_agent_message: 'Tail reply' }));
  await s.watcher.rescan();
  await s.watcher.tick();
  assert.equal(s.changes.at(-1).alerts[0].text, 'Tail reply');
  assert.equal(s.changes.at(-1).alerts[0].returnable, true);
});

test('a valid JSON suffix in a discarded tail fragment never becomes an event', async () => {
  const s = await setup({ tailBytes: 300 });
  const suffix = end(s.now());
  await s.write(s.file, 'invalid prefix'.repeat(100) + suffix.padStart(300, ' '));
  await s.watcher.rescan();
  await s.watcher.tick();
  assert.deepEqual(s.changes.at(-1).alerts, []);
  s.advance(1);
  await s.append(s.file, end(s.now(), 'Valid next line'));
  await s.watcher.tick();
  assert.equal(s.changes.at(-1).alerts[0].text, 'Valid next line');
});

test('a temporary file read error retries without losing a partial line', async () => {
  let fail = false, closes = 0;
  const s = await setup({ fileSystem: { ...fs, open: async (...args) => {
    const handle = await fs.open(...args);
    return { read: async (...readArgs) => { if (fail) { fail = false; throw new Error('synthetic read failure'); } return handle.read(...readArgs); }, close: async () => { closes++; await handle.close(); } };
  } } });
  const reply = end(s.now());
  await s.write(s.file, reply.slice(0, 100));
  await s.watcher.rescan();
  await s.watcher.tick();
  await s.append(s.file, reply.slice(100));
  fail = true;
  await s.watcher.tick();
  assert.deepEqual(s.changes.at(-1).alerts, []);
  await s.watcher.tick();
  assert.equal(s.changes.at(-1).alerts.length, 1);
  assert.equal(closes, 3, 'read handles close on failure too');
});

test('concurrent ticks share one read', async () => {
  let release, opened = 0;
  const gate = new Promise(resolve => { release = resolve; });
  const s = await setup({ fileSystem: { ...fs, open: async (...args) => { opened++; await gate; return fs.open(...args); } } });
  await s.write(s.file, end(s.now()));
  await s.watcher.rescan();
  const first = s.watcher.tick();
  const second = s.watcher.tick();
  release();
  await Promise.all([first, second]);
  assert.equal(opened, 1);
  assert.equal(s.changes.at(-1).alerts.length, 1);
});

test('expired files stop being polled until the next rescan', async () => {
  let stats = 0;
  const s = await setup({ fileSystem: { ...fs, stat: async (...args) => { stats++; return fs.stat(...args); } } });
  await s.write(s.file, c(s.now(), 'user', { message: { content: 'Work' } }));
  await s.watcher.rescan();
  await s.watcher.tick();
  s.advance(1800001);
  await s.watcher.tick();
  const count = stats;
  await s.watcher.tick();
  assert.equal(stats, count);
  assert.equal(s.changes.at(-1).vendors.claude.phase, 'idle');
  await s.append(s.file, end(s.now()));
  await s.watcher.rescan();
  await s.watcher.tick();
  assert.equal(s.changes.at(-1).alerts.length, 1);
});

test('stop during startup prevents timers from being installed later', async t => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  let release, scans = 0;
  const gate = new Promise(resolve => { release = resolve; });
  const s = await setup({ fileSystem: { ...fs, readdir: async (...args) => { scans++; await gate; return fs.readdir(...args); } } });
  try {
    const starting = s.watcher.start();
    s.watcher.stop();
    release();
    await starting;
    const count = scans;
    t.mock.timers.tick(120000);
    await Promise.resolve();
    assert.equal(scans, count);
    assert.equal(s.changes.length, 0);
  } finally { release(); s.watcher.stop(); t.mock.timers.reset(); }
});

test('new session files are found within 5 seconds by default', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval', 'setTimeout'] });
  let scans = 0;
  const watcher = watcherModule.createSessionWatcher({
    tracker: { ingest() {}, snapshot: () => ({ vendors: {}, alerts: [] }) },
    onChange() {},
    claudeRoot: path.resolve('work/does-not-exist-claude'),
    codexRoot: path.resolve('work/does-not-exist-codex'),
    fileSystem: { ...fs, readdir: async (...args) => { scans++; return fs.readdir(...args); } },
  });
  try {
    await watcher.start();
    const afterStart = scans;
    t.mock.timers.tick(5000);
    for (let i = 0; i < 20 && scans === afterStart; i++) await new Promise(resolve => setImmediate(resolve));
    assert.ok(scans > afterStart, 'a rescan ran within 5 s');
  } finally {
    watcher.stop();
  }
});
