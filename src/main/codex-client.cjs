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
  constructor() {
    this.nextId = 1;
    this.pending = new Map();
    this.child = null;
  }

  async start() {
    this.child = spawn(findCodexBinary(), ['app-server', '--stdio'], {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
    this.child.once('exit', (code) => {
      const error = new Error(`Codex 本机服务已退出 (${code ?? 'unknown'})`);
      for (const pending of this.pending.values()) pending.reject(error);
      this.pending.clear();
    });
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
    this.child.stdin.write(`${JSON.stringify(params === undefined ? { method } : { method, params })}\n`);
  }

  request(method, params, timeoutMs = 20_000) {
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
      this.child.stdin.write(`${JSON.stringify(message)}\n`);
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
    resetsAt: window.resetsAt ? new Date(window.resetsAt * 1000).toISOString() : null,
  };
}

async function readCodexSnapshot() {
  const client = new CodexRpcClient();
  try {
    await client.start();
    const [account, limits, models] = await Promise.all([
      client.request('account/read', { refreshToken: false }),
      client.request('account/rateLimits/read'),
      client.request('model/list', { limit: 100, includeHidden: false }),
    ]);
    if (!account.account) throw new Error('Codex 尚未登录。');

    const buckets = Object.values(limits.rateLimitsByLimitId || {});
    const shared = buckets.find((bucket) => bucket.limitId === 'codex') || limits.rateLimits;
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
    const primaryRemaining = remainingPercent(shared.primary);
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

module.exports = { findCodexBinary, readCodexSnapshot, remainingPercent };
