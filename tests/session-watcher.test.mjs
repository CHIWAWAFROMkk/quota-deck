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
