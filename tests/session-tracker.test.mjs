import test from 'node:test';
import assert from 'node:assert/strict';
import trackerModule from '../src/main/session-tracker.cjs';

const { createSessionTracker } = trackerModule;
const t = 100000;
const event = (kind, at = t, extra = {}) => ({ kind, at, sessionId: 'session', ...extra });
function setup(vendor = 'claude', source = 'claude-vscode', options = {}) {
  const tracker = createSessionTracker({ startedAt: t, ...options });
  const ingest = (kind, at = t, extra = {}) => tracker.ingest(vendor, event(kind, at, extra));
  ingest('meta', t - 100, { source, cwd: 'C:\\synthetic' });
  ingest('prompt', t, { text: 'First line\nSecond line' });
  return { tracker, ingest };
}

test('a finished turn becomes one reply alert with title, model and duration', () => {
  const { tracker, ingest } = setup();
  ingest('model', t, { model: 'claude-opus-4-1' });
  ingest('turn-end', t + 3000, { text: 'Done', error: false, durationMs: null, model: null });
  ingest('turn-end', t + 3000, { text: 'Done', error: false });
  assert.deepEqual(tracker.snapshot(t + 3000), {
    vendors: { claude: { phase: 'done', running: 0 }, codex: { phase: 'idle', running: 0 } },
    alerts: [{ id: 'claude:session:103000', vendor: 'claude', kind: 'reply', sessionId: 'session', title: 'First line', model: 'Opus 4.1', text: 'Done', tool: null, at: t + 3000, durationMs: 3000, returnable: true }],
  });
});

test('turns that ended before start never alert', () => {
  const tracker = createSessionTracker({ startedAt: t });
  tracker.ingest('claude', event('meta', t - 10000, { source: 'cli' }));
  tracker.ingest('claude', event('prompt', t - 9000, { text: 'Old' }));
  assert.equal(tracker.snapshot(t).vendors.claude.phase, 'working');
  tracker.ingest('claude', event('turn-end', t - 1, { text: 'Past' }));
  assert.equal(tracker.snapshot(t).alerts.length, 0);
  assert.equal(tracker.snapshot(t).vendors.claude.phase, 'idle');
  tracker.ingest('claude', event('prompt', t));
  tracker.ingest('claude', event('turn-end', t));
  assert.equal(tracker.snapshot(t).alerts.length, 1, 'the start boundary is inclusive');
});

test('only notifiable sources alert; others still count as running', () => {
  for (const [vendor, source] of [['codex', 'codex-exec'], ['codex', 'subagent'], ['codex', 'codex-other'], ['claude', 'sdk-ts']]) {
    const { tracker, ingest } = setup(vendor, source);
    ingest('tool-call', t, { callId: 'a', label: 'exec' });
    assert.deepEqual(tracker.snapshot(t + 30000).vendors[vendor], { phase: 'working', running: 1 });
    assert.deepEqual(tracker.snapshot(t + 30000).alerts, []);
    ingest('turn-end', t + 40000, { text: 'Done' });
    assert.deepEqual(tracker.snapshot(t + 40000).vendors[vendor], { phase: 'idle', running: 0 });
    assert.deepEqual(tracker.snapshot(t + 40000).alerts, []);
  }
});

test('returnable only for claude-vscode and codex-desktop', () => {
  for (const [vendor, source, returnable] of [['claude', 'claude-vscode', true], ['claude', 'cli', false], ['codex', 'codex-desktop', true]]) {
    const { tracker, ingest } = setup(vendor, source);
    ingest('turn-end', t + 1, { durationMs: 77 });
    assert.equal(tracker.snapshot(t + 1).alerts[0].returnable, returnable);
    assert.equal(tracker.snapshot(t + 1).alerts[0].durationMs, 77);
  }
});

test('error turns become error alerts', () => {
  const { tracker, ingest } = setup();
  ingest('turn-end', t + 1, { error: true, text: 'Synthetic error', model: 'claude-sonnet-4-5' });
  const [alert] = tracker.snapshot(t + 1).alerts;
  assert.equal(alert.kind, 'error');
  assert.equal(alert.text, 'Synthetic error');
  assert.equal(alert.model, 'Sonnet 4.5');
  assert.equal(tracker.snapshot(t + 1).vendors.claude.phase, 'done');
});

test('a waiting tool appears after 30 s and wins the phase', () => {
  const { tracker, ingest } = setup();
  ingest('turn-end', t + 1);
  ingest('meta', t, { sessionId: 'other', source: 'cli' });
  ingest('prompt', t + 10, { sessionId: 'other', text: 'Other task' });
  ingest('tool-call', t + 20, { sessionId: 'other', callId: 'a', label: 'Bash: npm test' });
  ingest('tool-call', t + 30, { sessionId: 'other', callId: 'b', label: 'Read: file' });
  assert.equal(tracker.snapshot(t + 20 + 29999).vendors.claude.phase, 'done');
  const snapshot = tracker.snapshot(t + 20 + 30000);
  assert.deepEqual(snapshot.vendors.claude, { phase: 'asking', running: 1 });
  assert.deepEqual(snapshot.alerts.map(a => a.id), ['claude:other:wait:a', 'claude:session:100001']);
  assert.equal(snapshot.alerts[0].tool, 'Bash: npm test');
  assert.equal(snapshot.alerts[0].at, t + 20);
});

test('a waiting tool that finishes clears the waiting alert', () => {
  const { tracker, ingest } = setup();
  ingest('tool-call', t, { callId: 'a', label: 'Bash: npm test' });
  assert.equal(tracker.snapshot(t + 30000).alerts[0].kind, 'waiting');
  ingest('tool-result', t + 30001, { callId: 'a' });
  assert.deepEqual(tracker.snapshot(t + 30001).alerts, []);
  assert.equal(tracker.snapshot(t + 30001).vendors.claude.phase, 'working');
  ingest('turn-end', t + 31000);
  assert.equal(tracker.snapshot(t + 31000).alerts[0].kind, 'reply');
});

test('a new prompt clears that session\'s replies', () => {
  const { tracker, ingest } = setup();
  ingest('turn-end', t + 1);
  ingest('prompt', t + 2, { text: 'Next' });
  assert.deepEqual(tracker.snapshot(t + 2).alerts, []);
  assert.equal(tracker.snapshot(t + 2).vendors.claude.phase, 'working');
});

test('dismissing only removes the alerts that were shown', () => {
  const { tracker, ingest } = setup();
  ingest('turn-end', t + 1);
  ingest('meta', t, { sessionId: 'second', source: 'claude-vscode' });
  ingest('turn-end', t + 2, { sessionId: 'second' });
  const shown = tracker.snapshot(t + 2).alerts.map(a => a.id);
  ingest('meta', t, { sessionId: 'third', source: 'cli' });
  ingest('turn-end', t + 3, { sessionId: 'third' });
  tracker.dismiss([shown[0], 'unknown']);
  assert.deepEqual(tracker.snapshot(t + 3).alerts.map(a => a.id), ['claude:third:100003', 'claude:session:100001']);
  tracker.dismiss([shown[1]]);
  ingest('prompt', t + 4);
  ingest('tool-call', t + 4, { callId: 'a', label: 'exec' });
  const waiting = tracker.snapshot(t + 30004).alerts.find(a => a.kind === 'waiting');
  tracker.dismiss([waiting.id]);
  assert.ok(tracker.snapshot(t + 30004).alerts.some(a => a.id === waiting.id));
});

test('sessions idle for 30 minutes stop counting as running', () => {
  const { tracker, ingest } = setup();
  assert.equal(tracker.snapshot(t + 1799999).vendors.claude.running, 1);
  assert.equal(tracker.snapshot(t + 1800000).vendors.claude.phase, 'idle');
  ingest('tool-call', t + 1800001, { callId: 'a', label: 'exec' });
  assert.equal(tracker.snapshot(t + 1800001).vendors.claude.phase, 'working');
});

test('custom title wins over ai title and first prompt; titles are capped at 60', () => {
  const { tracker, ingest } = setup();
  ingest('title', t + 1, { title: 'AI', custom: false });
  ingest('turn-end', t + 2);
  assert.equal(tracker.snapshot(t + 2).alerts[0].title, 'AI');
  ingest('title', t + 3, { title: 'x'.repeat(80), custom: true });
  ingest('title', t + 4, { title: 'New AI', custom: false });
  assert.equal(tracker.snapshot(t + 4).alerts[0].title, 'x'.repeat(60));
});

test('interrupt, a new prompt and a turn end all clear waiting tools', () => {
  for (const kind of ['interrupt', 'prompt', 'turn-end']) {
    const { tracker, ingest } = setup();
    ingest('tool-call', t, { callId: 'a', label: 'exec' });
    assert.equal(tracker.snapshot(t + 30000).alerts.length, 1);
    ingest(kind, t + 30001);
    assert.ok(tracker.snapshot(t + 60000).alerts.every(a => a.kind !== 'waiting'));
    if (kind === 'interrupt') assert.equal(tracker.snapshot(t + 60000).vendors.claude.phase, 'idle');
  }
});

test('paired Codex prompts enrich the title without resetting tool state or duration', () => {
  const { tracker, ingest } = setup('codex', 'codex-desktop');
  // A new empty start, then a text-bearing prompt at the same normalized timestamp.
  ingest('prompt', t + 10, { text: '' });
  ingest('tool-call', t + 20, { callId: 'a', label: 'exec' });
  ingest('prompt', t + 10, { text: 'Late title' });
  assert.equal(tracker.snapshot(t + 30020).alerts[0].kind, 'waiting');
  ingest('turn-end', t + 31010, { durationMs: null });
  assert.equal(tracker.snapshot(t + 31010).alerts[0].durationMs, 31000);
  assert.equal(tracker.snapshot(t + 31010).alerts[0].title, 'First line', 'first nonempty prompt wins');
});

test('rereading a file does not resurrect dismissed replies or old running state', () => {
  const { tracker, ingest } = setup();
  ingest('turn-end', t + 10);
  tracker.dismiss(['claude:session:100010']);
  ingest('prompt', t, { text: 'First line' });
  ingest('tool-call', t + 1, { callId: 'a', label: 'exec' });
  ingest('turn-end', t + 10);
  assert.deepEqual(tracker.snapshot(t + 30010).alerts, []);
  assert.equal(tracker.snapshot(t + 30010).vendors.claude.phase, 'idle');
});

test('snapshot callers cannot mutate stored replies and limits are configurable', () => {
  const { tracker, ingest } = setup('claude', 'cli', { waitingAfterMs: 10, abandonAfterMs: 100 });
  ingest('tool-call', t, { callId: 'a', label: 'x'.repeat(100) });
  assert.equal(tracker.snapshot(t + 10).alerts[0].tool.length, 80);
  assert.equal(tracker.snapshot(t + 100).vendors.claude.phase, 'idle');
  ingest('turn-end', t + 101, { text: 'x'.repeat(3000) });
  const snapshot = tracker.snapshot(t + 101);
  assert.equal(snapshot.alerts[0].text.length, 2048);
  snapshot.alerts[0].text = 'changed';
  assert.equal(tracker.snapshot(t + 101).alerts[0].text.length, 2048);
});
