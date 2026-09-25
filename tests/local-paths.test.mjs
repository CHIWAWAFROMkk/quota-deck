import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { execFileSync } from 'node:child_process';

test('stable user paths survive package changes; directories are not executable files', () => {
  mkdirSync('work', { recursive: true });
  const temp = mkdtempSync(resolve('work/paths-test-'));
  const config = join(temp, 'QuotaDeck');
  mkdirSync(config);
  const node = join(temp, 'node.exe');
  const cli = join(temp, 'codebuddy');
  writeFileSync(node, 'fixture, never execute');
  writeFileSync(cli, 'fixture, never execute');
  const file = join(config, 'local-paths.json');
  writeFileSync(file, '\uFEFF' + JSON.stringify({ nodePath: node, workbuddyScript: cli }));
  const read = () => JSON.parse(execFileSync(process.execPath, ['-e', 'console.log(JSON.stringify(require("./src/main/local-paths.cjs")))'], {
    timeout: 5000, encoding: 'utf8', windowsHide: true,
    env: { ...process.env, APPDATA: temp, QUOTADECK_NODE_PATH: '', QUOTADECK_WORKBUDDY_CLI: '' },
  }));
  assert.equal(read().nodePath, node);
  assert.equal(read().workbuddyScript, cli);
  writeFileSync(file, JSON.stringify({ nodePath: config, workbuddyScript: config }));
  assert.notEqual(read().nodePath, config);
  assert.notEqual(read().workbuddyScript, config);
});
