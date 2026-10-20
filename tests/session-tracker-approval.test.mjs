import test from 'node:test';
import assert from 'node:assert/strict';
import trackerModule from '../src/main/session-tracker.cjs';

const { createSessionTracker } = trackerModule;
const t = 100000;
const approval = (extra = {}) => ({
  id: 'req-1', vendor: 'claude', sessionId: 'session', cwd: 'C:\\work\\proj',
  tool: 'Bash', summary: 'npm test', at: t + 500, ...extra,
});

test('approvals become approval alerts with the matching session title', () => {
  const tracker = createSessionTracker({ startedAt: t });
  tracker.ingest('claude', { kind: 'meta', at: t, sessionId: 'session', source: 'claude-vscode' });
  tracker.ingest('claude', { kind: 'prompt', at: t + 1, sessionId: 'session', text: 'Fix the login flow' });
  tracker.setApprovals([approval()]);
  const snapshot = tracker.snapshot(t + 600);
  assert.deepEqual(snapshot.alerts, [{
    id: 'approval:req-1', vendor: 'claude', kind: 'approval', sessionId: 'session',
    title: 'Fix the login flow', model: null, text: 'npm test', tool: 'Bash', at: t + 500,
    durationMs: null, returnable: false,
  }]);
  assert.deepEqual(snapshot.vendors.claude, { phase: 'asking', running: 1 });
});

test('approval titles fall back to the cwd directory name when the session is unknown or has no title', () => {
  const tracker = createSessionTracker({ startedAt: t });
  tracker.ingest('claude', { kind: 'meta', at: t, sessionId: 'session', source: 'claude-vscode' });
  tracker.ingest('claude', { kind: 'prompt', at: t + 1, sessionId: 'session', text: 'Claude task' });
  tracker.ingest('codex', { kind: 'meta', at: t, sessionId: 'untitled', source: 'codex-desktop' });
  tracker.setApprovals([
    approval({ at: t + 500 }),
    // Same sessionId as the claude session must not borrow its title across vendors.
    approval({ id: 'req-2', vendor: 'codex', at: t + 400 }),
    approval({ id: 'req-3', vendor: 'codex', sessionId: 'untitled', cwd: '/home/me/posix-app', at: t + 300 }),
    approval({ id: 'req-4', vendor: 'claude', sessionId: 'missing', cwd: 'C:\\work\\my-app\\', at: t + 200 }),
  ]);
  const snapshot = tracker.snapshot(t + 600);
  assert.deepEqual(snapshot.alerts.map(a => [a.id, a.title]), [
    ['approval:req-1', 'Claude task'],
    ['approval:req-2', 'proj'],
    ['approval:req-3', 'posix-app'],
    ['approval:req-4', 'my-app'],
  ]);
  assert.deepEqual(snapshot.vendors.codex, { phase: 'asking', running: 0 });
});

test('setApprovals replaces the stored list and an empty list clears approvals', () => {
  const tracker = createSessionTracker({ startedAt: t });
  tracker.setApprovals([approval()]);
  assert.equal(tracker.snapshot(t + 600).alerts.length, 1);
  tracker.setApprovals([approval({ id: 'req-2' })]);
  assert.deepEqual(tracker.snapshot(t + 600).alerts.map(a => a.id), ['approval:req-2']);
  tracker.setApprovals([]);
  assert.deepEqual(tracker.snapshot(t + 600).alerts, []);
  assert.deepEqual(tracker.snapshot(t + 600).vendors.claude, { phase: 'idle', running: 0 });
});

test('dismiss does not remove approval alerts', () => {
  const tracker = createSessionTracker({ startedAt: t });
  tracker.setApprovals([approval()]);
  const id = tracker.snapshot(t + 600).alerts[0].id;
  tracker.dismiss([id]);
  assert.deepEqual(tracker.snapshot(t + 600).alerts.map(a => a.id), [id]);
  assert.equal(tracker.snapshot(t + 600).vendors.claude.phase, 'asking');
});

test('approvals with an unknown vendor or no id are ignored', () => {
  const tracker = createSessionTracker({ startedAt: t });
  const source = approval();
  tracker.setApprovals([
    approval({ id: 'skip-vendor', vendor: 'other' }),
    { vendor: 'claude', at: t + 1 },
    approval({ id: '' }),
    null,
    source,
  ]);
  assert.deepEqual(tracker.snapshot(t + 600).alerts.map(a => a.id), ['approval:req-1']);
  source.summary = 'changed after the fact';
  assert.equal(tracker.snapshot(t + 600).alerts[0].text, 'npm test');
});

test('a pending approval replaces the inferred Waiting card for the same session', () => {
  const tracker = createSessionTracker({ startedAt: 0, waitingAfterMs: 1000 });
  tracker.ingest('claude', { kind: 'meta', sessionId: 's1', at: 1, source: 'claude-vscode' });
  tracker.ingest('claude', { kind: 'prompt', sessionId: 's1', at: 2, text: 'go' });
  tracker.ingest('claude', { kind: 'tool-call', sessionId: 's1', at: 3, callId: 'c1', label: 'Bash' });
  assert.deepEqual(tracker.snapshot(5000).alerts.map(a => a.kind), ['waiting']);
  tracker.setApprovals([{ id: 'r1', vendor: 'claude', sessionId: 's1', cwd: 'C:/p', tool: 'Bash', summary: 'npm test', at: 4 }]);
  assert.deepEqual(tracker.snapshot(5000).alerts.map(a => a.kind), ['approval']);
  tracker.setApprovals([]);
  assert.deepEqual(tracker.snapshot(5000).alerts.map(a => a.kind), ['waiting']);
});
