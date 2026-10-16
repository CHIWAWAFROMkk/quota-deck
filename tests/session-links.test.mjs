import test from 'node:test';
import assert from 'node:assert/strict';
import links from '../src/main/session-links.cjs';

const sessionId = '11111111-2222-3333-4444-555555555555';

test('claude and codex links', () => {
  assert.equal(links.returnUrl({ vendor: 'claude', sessionId, returnable: true }), `vscode://anthropic.claude-code/open?session=${sessionId}`);
  assert.equal(links.returnUrl({ vendor: 'codex', sessionId, returnable: true }), `codex://threads/${sessionId}`);
});

test('bad ids and non-returnable alerts give null', () => {
  for (const alert of [null, undefined, {}, { vendor: 'unknown', sessionId, returnable: true },
    { vendor: 'claude', sessionId, returnable: false }, { vendor: 'codex', sessionId, returnable: false },
    ...['', '../escape', `${sessionId}?url=https://example.test`, 'x'.repeat(36), null, 123].map(id => ({ vendor: 'claude', sessionId: id, returnable: true })),
  ]) assert.equal(links.returnUrl(alert), null);
});
