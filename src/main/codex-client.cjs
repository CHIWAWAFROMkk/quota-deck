const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');

function findCodexBinary() {
  const appData = process.env.APPDATA;
  const candidates = appData
    ? [
        path.join(
          appData,
          'npm',
          'node_modules',
          '@openai',
          'codex',
          'node_modules',
          '@openai',
          'codex-win32-x64',
          'vendor',
          'x86_64-pc-windows-msvc',
          'bin',
          'codex.exe',
        ),
      ]
    : [];
  const found = candidates.find((candidate) => fs.existsSync(candidate));
  if (!found) throw new Error('未找到 Codex CLI，请先安装或更新 Codex。');
  return found;
}

class CodexRpcClient {
  constructor({ spawnProcess = spawn, binary = findCodexBinary } = {}) {
    this.nextId = 1;
    this.pending = new Map();
    this.child = null;
    this.spawnProcess = spawnProcess;
    this.binary = binary;
    this.failure = null;
  }

  async start() {
    this.child = this.spawnProcess(this.binary(), ['app-server', '--stdio'], {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
    const fail = (error) => {
      this.failure = error;
      for (const pending of this.pending.values()) pending.reject(error);
      this.pending.clear();
    };
    this.child.once('error', () => fail(new Error('Codex 本机服务无法启动')));
    this.child.once('exit', (code) => fail(new Error(`Codex 本机服务已退出 (${code ?? 'unknown'})`)));
    this.child.stdin.on('error', () => fail(new Error('Codex 本机服务连接中断')));
    // Drain diagnostics so a full stderr pipe cannot stall RPC responses.
    this.child.stderr.resume();
    readline.createInterface({ input: this.child.stdout }).on('line', (line) => {
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        return;
      }
      if (message.id == null || !this.pending.has(message.id)) return;
      const pending = this.pending.get(message.id);
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(message.error.message || 'Codex RPC 错误'));
      else pending.resolve(message.result);
    });

    await this.request('initialize', {
      clientInfo: { name: 'quota-deck', title: 'QuotaDeck', version: '0.1.0' },
      capabilities: {
        experimentalApi: true,
        requestAttestation: false,
        optOutNotificationMethods: [],
        extensions: {},
      },
    });
    this.notify('initialized');
  }

  notify(method, params) {
    if (this.failure) throw this.failure;
    this.child.stdin.write(`${JSON.stringify(params === undefined ? { method } : { method, params })}\n`);
  }

  request(method, params, timeoutMs = 20_000) {
    if (this.failure) return Promise.reject(this.failure);
    if (!this.child || this.child.stdin.destroyed) return Promise.reject(new Error('Codex 本机服务未连接'));
    const id = this.nextId++;
    const message = params === undefined ? { method, id } : { method, id, params };
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${method} 读取超时`));
      }, timeoutMs);
      this.pending.set(id, {
        resolve: (value) => {
          clearTimeout(timeout);
          resolve(value);
        },
        reject: (error) => {
          clearTimeout(timeout);
          reject(error);
        },
      });
      try {
        this.child.stdin.write(`${JSON.stringify(message)}\n`, (error) => {
          if (!error || !this.pending.has(id)) return;
          this.pending.get(id).reject(new Error('Codex 本机服务写入失败'));
          this.pending.delete(id);
        });
      } catch {
        this.pending.get(id)?.reject(new Error('Codex 本机服务写入失败'));
        this.pending.delete(id);
      }
    });
  }

  close() {
    if (this.child && !this.child.killed) this.child.kill();
  }
}

function remainingPercent(window) {
  if (!window || !Number.isFinite(window.usedPercent)) return null;
  return Math.max(0, Math.min(100, 100 - window.usedPercent));
}

function normalize(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function windowView(window, label) {
  if (!window) return null;
  return {
    label,
    remainingPercent: remainingPercent(window),
    usedPercent: window.usedPercent,
    windowDurationMins: window.windowDurationMins,
    resetsAt: Number.isFinite(window.resetsAt) && Number.isFinite(new Date(window.resetsAt * 1000).getTime())
      ? new Date(window.resetsAt * 1000).toISOString() : null,
  };
}

async function readModelPages(client) {
  const models = new Map();
  const cursors = new Set();
  let cursor;
  for (let page = 0; page < 100; page++) {
    const result = await client.request('model/list', { limit: 100, includeHidden: false, ...(cursor ? { cursor } : {}) });
    for (const model of result.data || []) models.set(model.id || model.model, model);
    if (!result.nextCursor) return { data: [...models.values()] };
    if (cursors.has(result.nextCursor)) throw new Error('Codex 模型目录分页异常');
    cursors.add(result.nextCursor);
    cursor = result.nextCursor;
  }
  throw new Error('Codex 模型目录分页过多');
}

async function readCodexSnapshot(client = new CodexRpcClient()) {
  try {
    await client.start();
    const [account, limits, models] = await Promise.all([
      client.request('account/read', { refreshToken: false }),
      client.request('account/rateLimits/read'),
      readModelPages(client),
    ]);
    if (!account.account) throw new Error('Codex 尚未登录。');

    const buckets = Object.entries(limits.rateLimitsByLimitId || {}).filter(([, bucket]) => bucket && typeof bucket === 'object')
      .map(([id, bucket]) => ({ ...bucket, limitId: bucket.limitId || id }));
    const shared = buckets.find((bucket) => bucket.limitId === 'codex') || limits.rateLimits || {};
    const namedBuckets = buckets.filter((bucket) => bucket.limitName);
    const modelRows = (models.data || []).map((model) => {
      const ownBucket = namedBuckets.find((bucket) => {
        const limitName = normalize(bucket.limitName);
        return limitName === normalize(model.displayName) || limitName === normalize(model.model);
      });
      const bucket = ownBucket || shared;
      return {
        id: model.id,
        name: model.displayName,
        model: model.model,
        pool: ownBucket ? 'independent' : 'shared',
        poolLabel: ownBucket ? bucket.limitName : 'Codex 共享额度',
        windows: [windowView(bucket.primary, '主窗口'), windowView(bucket.secondary, '周窗口')].filter(Boolean),
        source: '本机读取',
      };
    });
    const remainingWindows = [remainingPercent(shared.primary), remainingPercent(shared.secondary)].filter(Number.isFinite);
    const primaryRemaining = remainingWindows.length ? Math.min(...remainingWindows) : null;
    return {
      id: 'codex',
      name: 'Codex',
      status: primaryRemaining == null ? 'stale' : primaryRemaining <= 10 ? 'critical' : primaryRemaining <= 30 ? 'low' : 'healthy',
      remainingPercent: primaryRemaining,
      source: '本机读取',
      precision: 'provider-reported',
      updatedAt: new Date().toISOString(),
      planType: shared.planType,
      credits: shared.credits,
      windows: [windowView(shared.primary, '主窗口'), windowView(shared.secondary, '周窗口')].filter(Boolean),
      models: modelRows,
      note: '未显示独立额度的模型共用 Codex 账户额度，不进行虚假拆分。',
    };
  } finally {
    client.close();
  }
}

module.exports = { findCodexBinary, readCodexSnapshot, remainingPercent, readModelPages, CodexRpcClient };
