const fs = require('node:fs/promises');
const https = require('node:https');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');

const execFileAsync = promisify(execFile);
const { languageServerLog: LANGUAGE_SERVER_LOG, agyPath: AGY_PATH } = require('./local-paths.cjs');
const QUOTA_ROUTE = '/exa.language_server_pb.LanguageServerService/RetrieveUserQuotaSummary';
const burnSamples = new Map();

async function findHttpsPort(logPath = LANGUAGE_SERVER_LOG) {
  const log = await fs.readFile(logPath, 'utf8');
  const matches = [...log.matchAll(/listening on random port at (\d+) for HTTPS/g)];
  if (!matches.length) throw new Error('未找到 Antigravity 本机语言服务器端口');
  return Number(matches.at(-1)[1]);
}

function requestLocal(port, pathname, options = {}) {
  return new Promise((resolve, reject) => {
    const request = https.request({
      hostname: '127.0.0.1',
      port,
      path: pathname,
      method: options.method || 'GET',
      headers: options.headers,
      rejectUnauthorized: false,
      timeout: 8000,
    }, (response) => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => { body += chunk; });
      response.on('end', () => {
        if ((response.statusCode || 500) >= 400) {
          reject(new Error(`Antigravity 本机接口返回 ${response.statusCode}`));
          return;
        }
        resolve(body);
      });
    });
    request.on('timeout', () => request.destroy(new Error('Antigravity 本机接口读取超时')));
    request.on('error', reject);
    if (options.body) request.write(options.body);
    request.end();
  });
}

async function readCsrfToken(port) {
  const html = await requestLocal(port, '/');
  const match = html.match(/window\.__APP_CONFIG__\s*=\s*(\{.*?\});<\/script>/s);
  if (!match) throw new Error('未找到 Antigravity 本机会话标识');
  const config = JSON.parse(match[1]);
  if (!config.csrfToken) throw new Error('Antigravity 本机会话未就绪');
  return config.csrfToken;
}

async function readQuotaResponse(port, csrfToken) {
  const body = JSON.stringify({ forceRefresh: true });
  const text = await requestLocal(port, QUOTA_ROUTE, {
    method: 'POST',
    body,
    headers: {
      'content-type': 'application/json',
      'content-length': Buffer.byteLength(body),
      'connect-protocol-version': '1',
      'x-codeium-csrf-token': csrfToken,
    },
  });
  return JSON.parse(text).response;
}

async function readAvailableModels(agyPath = AGY_PATH) {
  const proxy = process.env.ANTIGRAVITY_PROXY;
  const { stdout } = await execFileAsync(agyPath, ['models'], {
    timeout: 15_000,
    windowsHide: true,
    env: {
      ...process.env,
      ...(proxy ? { HTTP_PROXY: proxy, HTTPS_PROXY: proxy, ALL_PROXY: proxy } : {}),
    },
  });
  return stdout.split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.includes('\t'))
    .map((line) => {
      const [id, name] = line.split('\t');
      return { id, name };
    });
}

function groupForModel(model) {
  return model.id.startsWith('gemini-') ? 'Gemini Models' : 'Claude and GPT models';
}

function normalizeAntigravitySnapshot(response, availableModels, updatedAt = new Date().toISOString()) {
  const groups = Array.isArray(response?.groups) ? response.groups : [];
  const groupMap = new Map(groups.map((group) => [group.displayName, group]));
  const models = availableModels.map((model) => {
    const group = groupMap.get(groupForModel(model));
    const windows = (group?.buckets || []).map((bucket) => ({
      id: bucket.bucketId,
      label: bucket.window === '5h' ? '5 小时' : '每周',
      window: bucket.window,
      remainingPercent: Number(bucket.remainingFraction) * 100,
      resetsAt: bucket.resetTime,
    }));
    const windowLabel = windows.map((item) => `${item.label} ${item.remainingPercent.toFixed(1)}%`).join(' · ');
    const remainingPercent = windows.length
      ? Math.min(...windows.map((item) => item.remainingPercent))
      : null;
    return {
      id: model.id,
      name: model.name,
      pool: 'shared',
      poolLabel: group?.displayName || 'Antigravity 共享额度池',
      source: 'Antigravity 本机官方接口',
      windows,
      remainingPercent,
      quotaLabel: windowLabel || '额度窗口未知',
    };
  });
  const allWindows = groups.flatMap((group) => group.buckets || []);
  const remainingPercent = allWindows.length
    ? Math.min(...allWindows.map((bucket) => Number(bucket.remainingFraction) * 100))
    : null;
  return {
    id: 'antigravity',
    name: 'Antigravity',
    status: Number.isFinite(remainingPercent)
      ? remainingPercent <= 10 ? 'critical' : remainingPercent <= 30 ? 'low' : 'healthy'
      : 'stale',
    source: 'Antigravity 本机官方接口',
    precision: 'provider-reported',
    updatedAt,
    remainingPercent,
    groups,
    models,
    quotaNote: `${models.length} 个模型 · ${groups.length} 个共享额度池`,
    note: '同组模型共享每周与 5 小时额度，消耗按 Token 成本比例计算。',
  };
}

function attachBurnRates(snapshot, sampledAt = Date.now()) {
  for (const group of snapshot.groups || []) {
    for (const bucket of group.buckets || []) {
      const key = `${group.displayName}:${bucket.bucketId}`;
      const current = Number(bucket.remainingFraction);
      const previous = burnSamples.get(key);
      bucket.burnPerHour = null;
      if (previous && previous.resetTime === bucket.resetTime) {
        const elapsedHours = (sampledAt - previous.sampledAt) / 3_600_000;
        if (elapsedHours >= 1 / 240 && current <= previous.remainingFraction) {
          bucket.burnPerHour = (previous.remainingFraction - current) * 100 / elapsedHours;
        }
      }
      burnSamples.set(key, { remainingFraction: current, resetTime: bucket.resetTime, sampledAt });
    }
  }
  return snapshot;
}

async function readAntigravitySnapshot(options = {}) {
  const port = await findHttpsPort(options.logPath);
  const token = await readCsrfToken(port);
  const [quota, models] = await Promise.all([
    readQuotaResponse(port, token),
    readAvailableModels(options.agyPath),
  ]);
  return attachBurnRates(normalizeAntigravitySnapshot(quota, models));
}

module.exports = {
  findHttpsPort,
  attachBurnRates,
  groupForModel,
  normalizeAntigravitySnapshot,
  readAntigravitySnapshot,
  readAvailableModels,
};
