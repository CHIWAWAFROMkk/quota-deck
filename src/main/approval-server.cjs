// Loopback approval endpoint for the HUD. Every hook request is held open until the
// user decides; a hook that times out closes its connection and its card disappears.
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { randomBytes, randomUUID } = require('node:crypto');

const HOST = '127.0.0.1';
const ROUTE = '/approval';

function textValue(value) {
  return typeof value === 'string' ? value : '';
}

// The hook may read the endpoint file at any moment, so replace it in one step.
function writeEndpoint(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value)}\n`, 'utf8');
  fs.renameSync(temporary, file);
}

function removeEndpoint(file) {
  if (!file) return;
  try {
    fs.unlinkSync(file);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}

function createApprovalServer({
  endpointPath,
  onChange = () => {},
  maxPending = 20,
  maxBodyBytes = 65536,
  randomToken = () => randomBytes(32).toString('hex'),
} = {}) {
  const pending = new Map();
  const sockets = new Set();
  let server = null;
  let token = '';
  let port = 0;

  function list() {
    return Array.from(pending.values())
      .map(entry => ({ ...entry.item }))
      .sort((a, b) => a.at - b.at);
  }

  function notify() {
    try {
      onChange(list());
    } catch {
      // A broken listener must not take the approval service down.
    }
  }

  function drop(id) {
    if (!pending.delete(id)) return;
    notify();
  }

  function respond(res, status, body) {
    if (!res || res.writableEnded || res.destroyed) return;
    try {
      res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify(body));
    } catch {
      // The hook may already be gone; nothing left to answer.
    }
  }

  function handle(req, res) {
    let id = '';
    // The request stream closes as soon as its body is read, so the response is what
    // tells us the hook actually went away: it closes unfinished only on disconnect.
    const onClose = () => {
      if (!id || res.writableFinished) return;
      drop(id);
    };
    res.on('close', onClose);
    req.on('error', () => {});
    res.on('error', () => {});

    if (req.method !== 'POST' || req.url !== ROUTE) {
      respond(res, 404, { error: '未找到该接口' });
      return;
    }
    const header = typeof req.headers.authorization === 'string' ? req.headers.authorization : '';
    if (header !== `Bearer ${token}`) {
      respond(res, 401, { error: '未授权' });
      return;
    }

    const chunks = [];
    let bytes = 0;
    let tooLarge = false;
    req.on('data', chunk => {
      if (tooLarge) return;
      bytes += chunk.length;
      if (bytes > maxBodyBytes) {
        tooLarge = true;
        chunks.length = 0;
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (tooLarge) {
        respond(res, 413, { error: '请求体超过上限' });
        return;
      }
      let payload;
      try {
        payload = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      } catch {
        respond(res, 400, { error: '请求体不是有效的 JSON' });
        return;
      }
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
        respond(res, 400, { error: '请求体不是有效的 JSON' });
        return;
      }
      if (pending.size >= maxPending) {
        respond(res, 503, { error: '挂起数量已满' });
        return;
      }
      id = randomUUID();
      pending.set(id, {
        item: {
          id,
          vendor: textValue(payload.vendor),
          sessionId: textValue(payload.sessionId),
          cwd: textValue(payload.cwd),
          tool: textValue(payload.tool),
          summary: textValue(payload.summary),
          at: Date.now(),
        },
        response: res,
      });
      notify();
    });
  }

  function start() {
    if (server) return Promise.resolve({ port });
    token = String(randomToken());
    const instance = http.createServer(handle);
    instance.on('connection', socket => {
      sockets.add(socket);
      socket.once('close', () => sockets.delete(socket));
    });
    return new Promise((resolve, reject) => {
      instance.once('error', reject);
      instance.listen(0, HOST, () => {
        instance.removeListener('error', reject);
        instance.on('error', () => {});
        port = instance.address().port;
        server = instance;
        try {
          writeEndpoint(endpointPath, { port, token, pid: process.pid });
        } catch (error) {
          server = null;
          port = 0;
          instance.close();
          reject(error);
          return;
        }
        resolve({ port });
      });
    });
  }

  function stop() {
    const instance = server;
    server = null;
    for (const entry of pending.values()) {
      respond(entry.response, 200, { decision: null });
    }
    pending.clear();
    if (!instance) {
      try {
        removeEndpoint(endpointPath);
        return Promise.resolve();
      } catch (error) {
        return Promise.reject(error);
      }
    }
    for (const socket of sockets) {
      if (!socket.destroyed) socket.end();
    }
    return new Promise((resolve, reject) => {
      instance.close(() => {
        try {
          removeEndpoint(endpointPath);
          resolve();
        } catch (error) {
          reject(error);
        }
      });
      if (typeof instance.closeIdleConnections === 'function') instance.closeIdleConnections();
    });
  }

  function decide(id, decision) {
    if (decision !== 'allow' && decision !== 'deny') return false;
    const entry = pending.get(id);
    if (!entry) return false;
    pending.delete(id);
    respond(entry.response, 200, { decision });
    notify();
    return true;
  }

  return { start, stop, list, decide };
}

module.exports = { createApprovalServer };
