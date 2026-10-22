import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const smoke = fs.readFileSync(path.join(root, 'scripts/smoke-desktop.cjs'), 'utf8');

// The approval server writes its endpoint under appData and deletes it on quit; a smoke run
// that shares the real appData would cut a running QuotaDeck off from its approval hook.
test('the desktop smoke moves userData and appData into its temp folder before main.cjs loads', () => {
  const loadMain = smoke.indexOf("require(path.join(root, 'src/main/main.cjs'))");
  assert.ok(loadMain > 0, 'smoke loads main.cjs');
  for (const name of ['userData', 'appData']) {
    const at = smoke.search(new RegExp(`app\\.setPath\\('${name}', path\\.join\\(output, `));
    assert.ok(at > 0 && at < loadMain, `${name} is redirected before main.cjs loads`);
  }
});
