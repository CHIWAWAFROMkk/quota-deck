import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import hook from '../src/main/approval-hook.cjs';

const HOOK_SCRIPT = fileURLToPath(new URL('../src/main/approval-hook.cjs', import.meta.url));

const goodInput = {
  session_id: 'session-1',
  cwd: 'C:\\work\\project',
  tool_name: 'Bash',
  tool_input: { command: 'npm test' },
};

const endpoint = { port: 4567, token: 'secret-endpoint-token' };
const readFileFor = (value = endpoint) => (file, encoding) => {
  assert.equal(encoding, 'utf8');
  return typeof value === 'string' ? value : JSON.stringify(value);
};

async function captureStdout(run) {
  const writes = [];
  const original = process.stdout.write;
  process.stdout.write = (chunk) => { writes.push(String(chunk)); return true; };
  try {
    const result = await run();
    return { result, output: writes.join('') };
  } finally {
    process.stdout.write = original;
  }
}

const silentFailure = () => {
  throw Object.assign(new Error('ENOENT: no such file'), { code: 'ENOENT' });
};

test('endpointPath honours the override and falls back under APPDATA', () => {
  const saved = process.env.QUOTADECK_APPROVAL_ENDPOINT;
  try {
    process.env.QUOTADECK_APPROVAL_ENDPOINT = path.join('C:', 'custom', 'approval-endpoint.json');
    assert.equal(hook.endpointPath(), process.env.QUOTADECK_APPROVAL_ENDPOINT);

    delete process.env.QUOTADECK_APPROVAL_ENDPOINT;
    const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
    assert.equal(hook.endpointPath(), path.join(appData, 'QuotaDeck', 'approval-endpoint.json'));
  } finally {
    if (saved === undefined) delete process.env.QUOTADECK_APPROVAL_ENDPOINT;
    else process.env.QUOTADECK_APPROVAL_ENDPOINT = saved;
  }
});

test('summarize uses the command for Bash and shell tools', () => {
  assert.equal(hook.summarize('Bash', { command: 'npm test', description: 'run tests' }), 'npm test');
  assert.equal(hook.summarize('shell', { command: 'Get-ChildItem' }), 'Get-ChildItem');
  assert.equal(hook.summarize('shell_command', { command: 'dir' }), 'dir');
  assert.equal(hook.summarize('Bash', {}), '');
});

test('summarize uses file paths for edit tools and the patch first line for apply_patch', () => {
  assert.equal(hook.summarize('Edit', { file_path: 'src/main/a.cjs', old_string: 'x' }), 'src/main/a.cjs');
  assert.equal(hook.summarize('Write', { path: 'src/main/b.cjs', content: 'x' }), 'src/main/b.cjs');
  assert.equal(hook.summarize('MultiEdit', { file_path: 'src/main/c.cjs' }), 'src/main/c.cjs');
  assert.equal(hook.summarize('apply_patch', { file_path: 'src/main/d.cjs' }), 'src/main/d.cjs');
  assert.equal(hook.summarize('apply_patch', { input: '*** Begin Patch\n*** Update File: x\n*** End Patch' }), '*** Begin Patch');
  assert.equal(hook.summarize('apply_patch', { patch: '\n*** Begin Patch\n*** End Patch' }), '*** Begin Patch');
});

test('summarize falls back to truncated JSON and caps at 160 characters', () => {
  assert.equal(hook.summarize('WebFetch', { url: 'https://example.com', prompt: 'sum' }), '{"url":"https://example.com","prompt":"sum"}');
  const long = 'x'.repeat(300);
  assert.equal(hook.summarize('Bash', { command: long }), long.slice(0, 160));
  assert.equal(hook.summarize('WebFetch', long).length, 160);
  assert.equal(hook.summarize('WebFetch', undefined), '');
});

test('buildRequest maps stdin fields and rejects unknown vendors', () => {
  assert.deepEqual(hook.buildRequest('claude', goodInput), {
    vendor: 'claude', sessionId: 'session-1', cwd: 'C:\\work\\project', tool: 'Bash', summary: 'npm test',
  });
  assert.deepEqual(hook.buildRequest('codex', {}), { vendor: 'codex', sessionId: '', cwd: '', tool: '', summary: '' });
  assert.equal(hook.buildRequest('other', goodInput).vendor, '');
  assert.equal(hook.buildRequest(undefined, goodInput).vendor, '');
  assert.deepEqual(hook.buildRequest('claude', null), { vendor: 'claude', sessionId: '', cwd: '', tool: '', summary: '' });
});

test('decisionOutput produces Claude PermissionRequest payloads', () => {
  assert.deepEqual(hook.decisionOutput('allow'), {
    hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: { behavior: 'allow' } },
  });
  assert.deepEqual(hook.decisionOutput('deny'), {
    hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: { behavior: 'deny', message: 'Denied from QuotaDeck HUD' } },
  });
  assert.equal(hook.decisionOutput('later'), null);
  assert.equal(hook.decisionOutput(null), null);
});

test('main prints the allow payload and sends the request with the bearer token', async () => {
  let seen;
  const { result, output } = await captureStdout(() => hook.main({
    argv: ['--vendor', 'claude'],
    stdin: JSON.stringify(goodInput),
    readFile: readFileFor(),
    fetchImpl: async (url, init) => {
      seen = { url, init };
      return { ok: true, json: async () => ({ decision: 'allow' }) };
    },
    waitMs: 100,
  }));

  assert.deepEqual(JSON.parse(output), hook.decisionOutput('allow'));
  assert.equal(result, output.trim());
  assert.equal(seen.url, 'http://127.0.0.1:4567/approval');
  assert.equal(seen.init.method, 'POST');
  assert.equal(seen.init.headers.Authorization, `Bearer ${endpoint.token}`);
  assert.equal(seen.init.headers['Content-Type'], 'application/json');
  assert.deepEqual(JSON.parse(seen.init.body), hook.buildRequest('claude', goodInput));
  assert.ok(seen.init.signal instanceof AbortSignal);
});

test('main stays silent when the endpoint file cannot be read', async () => {
  let calls = 0;
  const { output } = await captureStdout(() => hook.main({
    argv: ['--vendor', 'claude'],
    stdin: JSON.stringify(goodInput),
    readFile: silentFailure,
    fetchImpl: async () => { calls += 1; return { json: async () => ({ decision: 'allow' }) }; },
    waitMs: 100,
  }));
  assert.equal(output, '');
  assert.equal(calls, 0);
});

test('main stays silent when fetch fails', async () => {
  const { output } = await captureStdout(() => hook.main({
    argv: ['--vendor', 'claude'],
    stdin: JSON.stringify(goodInput),
    readFile: readFileFor(),
    fetchImpl: async () => { throw new Error('ECONNREFUSED'); },
    waitMs: 100,
  }));
  assert.equal(output, '');
});

test('main stays silent for unknown decisions and oversized stdin', async () => {
  let calls = 0;
  const later = await captureStdout(() => hook.main({
    argv: ['--vendor', 'claude'],
    stdin: JSON.stringify(goodInput),
    readFile: readFileFor(),
    fetchImpl: async () => { calls += 1; return { json: async () => ({ decision: 'later' }) }; },
    waitMs: 100,
  }));
  assert.equal(later.output, '');
  assert.equal(calls, 1);

  const huge = await captureStdout(() => hook.main({
    argv: ['--vendor', 'claude'],
    stdin: JSON.stringify({ ...goodInput, session_id: 'x'.repeat(70000) }),
    readFile: readFileFor(),
    fetchImpl: async () => { calls += 1; return { json: async () => ({ decision: 'allow' }) }; },
    waitMs: 100,
  }));
  assert.equal(huge.output, '');
  assert.equal(calls, 1);
});

test('main ignores a vendor outside claude/codex', async () => {
  let calls = 0;
  const { output } = await captureStdout(() => hook.main({
    argv: ['--vendor', 'other'],
    stdin: JSON.stringify(goodInput),
    readFile: readFileFor(),
    fetchImpl: async () => { calls += 1; return { json: async () => ({ decision: 'allow' }) }; },
    waitMs: 100,
  }));
  assert.equal(output, '');
  assert.equal(calls, 0);
});

test('running as a script stays silent with exit code 0 when there is no endpoint', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qd-approval-hook-cli-'));
  const missing = path.join(dir, 'approval-endpoint.json');
  const stdinFile = path.join(dir, 'stdin.json');
  const stdoutFile = path.join(dir, 'stdout.txt');
  const stderrFile = path.join(dir, 'stderr.txt');
  fs.writeFileSync(stdinFile, JSON.stringify(goodInput));
  const [inFd, outFd, errFd] = [fs.openSync(stdinFile, 'r'), fs.openSync(stdoutFile, 'w'), fs.openSync(stderrFile, 'w')];
  let run;
  try {
    run = spawnSync(process.execPath, [HOOK_SCRIPT, '--vendor', 'claude'], {
      stdio: [inFd, outFd, errFd],
      env: { ...process.env, QUOTADECK_APPROVAL_ENDPOINT: missing },
      timeout: 15000,
    });
  } finally {
    for (const fd of [inFd, outFd, errFd]) fs.closeSync(fd);
  }
  assert.equal(run.status, 0);
  assert.equal(fs.readFileSync(stdoutFile, 'utf8'), '');
  assert.equal(fs.readFileSync(stderrFile, 'utf8'), '');
});
