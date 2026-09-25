import test from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import security from '../src/main/security.cjs';

test('IPC trusts only the exact application document', () => {
  const entry = resolve('src/renderer/compact.html');
  const url = pathToFileURL(entry).href;
  assert.equal(security.isTrustedRenderer(url, entry), true);
  for (const untrusted of [undefined, '', 'https://example.org', `${url}?injected`, `${url}/../other.html`, 'file:///other.html']) {
    assert.equal(security.isTrustedRenderer(untrusted, entry), false);
  }
});

test('provider identifiers reject prototype keys and non-string inputs', () => {
  const ids = ['codex', 'claude', 'antigravity', 'deepseek', 'workbuddy'];
  for (const id of ids) assert.equal(security.validateProviderId(id, ids), id);
  for (const id of ['__proto__', 'constructor', 'toString', null, {}, ['codex']]) {
    assert.throws(() => security.validateProviderId(id, ids), /未知服务商/);
  }
});
