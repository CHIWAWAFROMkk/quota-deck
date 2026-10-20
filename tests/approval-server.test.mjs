import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import approvalServer from '../src/main/approval-server.cjs';

const { createApprovalServer } = approvalServer;

const payload = {
  vendor: 'claude',
  sessionId: 'session-1',
  cwd: 'C:\\work\\project',
  tool: 'Bash',
  summary: 'npm test',
};

function sandbox() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qd-approval-server-'));
  return { dir, endpoint: path.join(dir, 'approval-endpoint.json') };
}

async function setup(t, options = {}) {
  const box = sandbox();
  const changes = [];
  const server = createApprovalServer({
    endpointPath: box.endpoint,
    onChange: list => changes.push(list),
    ...options,
  });
  t.after(() => server.stop());
  const { port } = await server.start();
  const endpoint = JSON.parse(fs.readFileSync(box.endpoint, 'utf8'));
  return { server, port, box, changes, token: endpoint.token };
}

// Starts a real loopback request; callers await `response` once the server settles it.
function call(port, { token, body, method = 'POST', route = '/approval' } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  let request;
  const response = new Promise((resolve, reject) => {
    request = http.request({ host: '127.0.0.1', port, path: route, method, headers }, res => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { text += chunk; });
      res.on('end', () => {
        let parsed = null;
        try { parsed = text ? JSON.parse(text) : null; } catch { parsed = text; }
        resolve({ status: res.statusCode, body: parsed });
      });
    });
    request.on('error', reject);
    request.end(body === undefined ? undefined : (typeof body === 'string' ? body : JSON.stringify(body)));
  });
  return { request, response };
}

async function waitFor(predicate, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('等待条件超时');
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}

test('start listens on loopback and writes { port, token, pid } atomically', async (t) => {
  const box = sandbox();
  const token = 'f'.repeat(64);
  const server = createApprovalServer({ endpointPath: box.endpoint, randomToken: () => token });
  t.after(() => server.stop());

  const { port } = await server.start();
  assert.ok(Number.isInteger(port) && port > 0);
  assert.deepEqual(JSON.parse(fs.readFileSync(box.endpoint, 'utf8')), { port, token, pid: process.pid });
  assert.deepEqual(fs.readdirSync(box.dir).filter(name => name.endsWith('.tmp')), []);
});

test('requests without the matching bearer token get 401', async (t) => {
  const { server, port, token } = await setup(t);
  assert.match(token, /^[0-9a-f]{64}$/);

  const missing = await call(port, { body: payload }).response;
  assert.equal(missing.status, 401);
  const wrong = await call(port, { token: 'x'.repeat(64), body: payload }).response;
  assert.equal(wrong.status, 401);
  assert.equal(server.list().length, 0);
});

test('a valid request stays pending, appears in list and notifies onChange', async (t) => {
  const { server, port, token, changes } = await setup(t);
  const startedAt = Date.now();
  const client = call(port, { token, body: payload });
  try {
    await waitFor(() => server.list().length === 1);
    const [item] = server.list();
    assert.equal(item.vendor, 'claude');
    assert.equal(item.sessionId, 'session-1');
    assert.equal(item.cwd, 'C:\\work\\project');
    assert.equal(item.tool, 'Bash');
    assert.equal(item.summary, 'npm test');
    assert.equal(item.id.length, 36);
    assert.ok(item.at >= startedAt);
    assert.deepEqual(Object.keys(item).sort(), ['at', 'cwd', 'id', 'sessionId', 'summary', 'tool', 'vendor']);
    assert.equal(changes.length >= 1, true);
    assert.equal(changes.at(-1).length, 1);
  } finally {
    const id = server.list()[0]?.id;
    if (id) server.decide(id, 'allow');
  }
  assert.deepEqual(await client.response, { status: 200, body: { decision: 'allow' } });
});

test('decide settles allow/deny and rejects unknown ids and decisions', async (t) => {
  const { server, port, token, changes } = await setup(t);
  const client = call(port, { token, body: payload });
  await waitFor(() => server.list().length === 1);
  const id = server.list()[0].id;

  assert.equal(server.decide(id, 'later'), false);
  assert.equal(server.decide('missing-id', 'allow'), false);
  assert.equal(server.list().length, 1);

  assert.equal(server.decide(id, 'allow'), true);
  assert.deepEqual(await client.response, { status: 200, body: { decision: 'allow' } });
  assert.equal(server.list().length, 0);
  assert.equal(changes.at(-1).length, 0);
  assert.equal(server.decide(id, 'deny'), false);
});

test('a client that disconnects drops its pending request', async (t) => {
  const { server, port, token, changes } = await setup(t);
  const client = call(port, { token, body: payload });
  client.response.catch(() => {});
  await waitFor(() => server.list().length === 1);

  client.request.destroy();
  await waitFor(() => server.list().length === 0);
  assert.equal(changes.at(-1).length, 0);
});

test('oversized bodies get 413 and invalid JSON gets 400', async (t) => {
  const { server, port, token } = await setup(t);
  const oversized = await call(port, { token, body: { ...payload, summary: 'x'.repeat(70000) } }).response;
  assert.equal(oversized.status, 413);
  const broken = await call(port, { token, body: '{ broken' }).response;
  assert.equal(broken.status, 400);
  assert.equal(server.list().length, 0);
});

test('a full pending queue gets 503', async (t) => {
  const { server, port, token } = await setup(t, { maxPending: 1 });
  const first = call(port, { token, body: payload });
  await waitFor(() => server.list().length === 1);

  const second = await call(port, { token, body: payload }).response;
  assert.equal(second.status, 503);
  assert.equal(server.list().length, 1);

  assert.equal(server.decide(server.list()[0].id, 'deny'), true);
  assert.deepEqual(await first.response, { status: 200, body: { decision: 'deny' } });
});

test('list returns shallow copies ordered by arrival time', async (t) => {
  const { server, port, token } = await setup(t);
  const first = call(port, { token, body: payload });
  await waitFor(() => server.list().length === 1);
  const second = call(port, { token, body: { ...payload, summary: 'npm run check' } });
  await waitFor(() => server.list().length === 2);

  const items = server.list();
  const ids = items.map(item => item.id);
  assert.ok(items[0].at <= items[1].at);
  items[0].vendor = 'tampered';
  items.pop();
  assert.deepEqual(server.list().map(item => item.id), ids);
  assert.equal(server.list()[0].vendor, 'claude');

  await server.stop();
  await Promise.all([first.response, second.response]);
});

test('stop settles pending requests with decision null and removes the endpoint file', async (t) => {
  const { server, port, token, box } = await setup(t);
  const client = call(port, { token, body: payload });
  await waitFor(() => server.list().length === 1);

  await server.stop();
  assert.deepEqual(await client.response, { status: 200, body: { decision: null } });
  assert.equal(fs.existsSync(box.endpoint), false);
  assert.equal(server.list().length, 0);

  await server.stop();
  assert.equal(fs.existsSync(box.endpoint), false);
});
