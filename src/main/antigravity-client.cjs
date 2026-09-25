const fs = require('node:fs/promises');
const https = require('node:https');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');

const execFileAsync = promisify(execFile);
const { languageServerLog: LANGUAGE_SERVER_LOG, agyPath: AGY_PATH } = require('./local-paths.cjs');
const QUOTA_ROUTE = '/exa.language_server_pb.LanguageServerService/RetrieveUserQuotaSummary';

async function findHttpsPort(logPath = LANGUAGE_SERVER_LOG) {
  const handle = await fs.open(logPath, 'r');
  let log;
  try {
    const size = (await handle.stat()).size;
    let end = size;
    let suffix = '';
    log = '';
    // Search backwards in bounded chunks: startup lines may be far from the tail.
    while (end > 0 && size - end < 16777216) {
      const start = Math.max(0, end - 262144);
      const buffer = Buffer.alloc(end - start);
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, start);
      const chunk = buffer.subarray(0, bytesRead).toString('utf8');
      log = chunk + suffix;
      if (/listening on random port at \d+ for HTTPS/.test(log)) break;
      suffix = chunk.slice(0, 100);
      end = start;
    }
  } finally { await handle.close(); }
  const matches = [...log.matchAll(/listening on random port at (\d+) for HTTPS/g)];
  if (!matches.length) throw new Error('未找到 Antigravity 本机语言服务器端口');
  const port = Number(matches.at(-1)[1]);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Antigravity 本机端口无效');
  return port;
}

function requestLocal(port, pathname, options = {}) {
  return new Promise((resolve, reject) => {
    if (!Number.isInteger(port) || port < 1 || port > 65535) return reject(new Error('Antigravity 本机端口无效'));
    let timer;
    const finish = (error, value) => { clearTimeout(timer); if (error) reject(error); else resolve(value); };
    const request = https.request({
      hostname: '127.0.0.1',
      port,
      path: pathname,
      method: options.method || 'GET',
      headers: options.headers,
      // Loopback traffic must never inherit a global proxy agent. A fresh
      // direct agent also keeps the local session token on this machine.
      agent: false,
      rejectUnauthorized: false,
      timeout: 8000,
    }, (response) => {
      let body = '';
      let bytes = 0;
      response.setEncoding('utf8');
      response.on('error', () => finish(new Error('Antigravity 本机响应中断')));
      response.on('aborted', () => finish(new Error('Antigravity 本机响应中断')));
      response.on('data', (chunk) => {
        bytes += Buffer.byteLength(chunk);
        if (bytes > 5242880) { request.destroy(new Error('Antigravity 本机响应超出大小限制')); return; }
        body += chunk;
      });
      response.on('end', () => {
        if (response.statusCode < 200 || response.statusCode >= 300 || !response.statusCode) {
          finish(new Error(`Antigravity 本机接口返回 ${response.statusCode}`));
          return;
        }
        finish(null, body);
      });
    });
    request.on('timeout', () => request.destroy(new Error('Antigravity 本机接口读取超时')));
    timer = setTimeout(() => request.destroy(new Error('Antigravity 本机接口读取超时')), 8000);
    request.on('error', finish);
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

async function readQuotaResponse(port, csrfToken, route = QUOTA_ROUTE) {
  const body = JSON.stringify({ forceRefresh: true });
  const text = await requestLocal(port, route, {
    method: 'POST',
    body,
    headers: {
      'content-type': 'application/json',
      'content-length': Buffer.byteLength(body),
      'connect-protocol-version': '1',
      'x-codeium-csrf-token': csrfToken,
    },
  });
  const parsed = JSON.parse(text);
  return parsed.response || parsed;
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

function parseLocalModelDirectory(response) {
  const sorts = Array.isArray(response?.agentModelSorts) ? response.agentModelSorts : [];
  const ids = [...new Set(sorts.flatMap(sort =>
    (Array.isArray(sort?.groups) ? sort.groups : []).flatMap(group => Array.isArray(group?.modelIds) ? group.modelIds : [])))];
  if (!ids.length || !response.models || typeof response.models !== 'object') {
    throw new Error('本机接口未返回可选 Agent 模型目录');
  }
  return ids.map(id => {
    if (typeof id !== 'string' || !id.trim() || id.length > 200) throw new Error('模型 ID 无效');
    const config = response.models[id];
    return { id, name: typeof config?.displayName === 'string' && config.displayName ? config.displayName.slice(0, 200) : id };
  });
}

async function readModelDirectory(port, token, agyPath, request = readQuotaResponse, cli = readAvailableModels) {
  try {
    const response = await request(port, token, '/exa.language_server_pb.LanguageServerService/GetAvailableModels');
    return { models: parseLocalModelDirectory(response), source: 'Antigravity 本机 Agent 模型目录' };
  } catch {
    // Same local session first; launch the network-dependent CLI only as a fallback.
    const models = await cli(agyPath);
    if (!models.length) throw new Error('模型目录为空');
    return { models, source: 'Antigravity agy models' };
  }
}

function groupForModel(model) {
  if (/^gemini-/i.test(model.id)) return 'Gemini Models';
  if (/^(claude-|gpt-)/i.test(model.id)) return 'Claude and GPT models';
  return null;
}

function fraction(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1 ? value : null;
}

function unexpiredFraction(value, reset, observedAt) {
  if (reset !== undefined && reset !== null && reset !== '') {
    const timestamp = typeof reset === 'string' ? Date.parse(reset) : NaN;
    if (!Number.isFinite(timestamp) || timestamp <= observedAt) return null;
  }
  return fraction(value);
}

function normalizeAntigravitySnapshot(response, availableModels, updatedAt = new Date().toISOString()) {
  const groups = (Array.isArray(response?.groups) ? response.groups : []).filter(group => group && typeof group.displayName === 'string').map(group => ({
    displayName: group.displayName,
    description: group.description,
    buckets: (Array.isArray(group.buckets) ? group.buckets : []).filter(bucket => bucket && typeof bucket.bucketId === 'string' && bucket.bucketId).map(bucket => ({
      bucketId: bucket.bucketId,
      window: bucket.window || (/5h|session/i.test(`${bucket.bucketId} ${bucket.displayName}`) ? '5h' : /week/i.test(`${bucket.bucketId} ${bucket.displayName}`) ? 'weekly' : 'unknown'),
      remainingFraction: unexpiredFraction(bucket.remainingFraction ?? bucket.remaining?.remainingFraction,
        bucket.resetTime || bucket.remaining?.resetTime, Date.parse(updatedAt)),
      resetTime: (() => { const reset = bucket.resetTime || bucket.remaining?.resetTime; return typeof reset === 'string' && Number.isFinite(Date.parse(reset)) ? new Date(reset).toISOString() : null; })(),
    })),
  }));
  const groupMap = new Map(groups.map((group) => [group.displayName, group]));
  const models = (Array.isArray(availableModels) ? availableModels : []).filter(model => model && typeof model.id === 'string' && model.id).map((model) => {
    const group = groupMap.get(groupForModel(model));
    const windows = (group?.buckets || []).map((bucket) => ({
      id: bucket.bucketId,
      label: bucket.window === '5h' ? '5 小时' : bucket.window === 'weekly' ? '每周' : '未知窗口',
      window: bucket.window,
      remainingPercent: bucket.remainingFraction === null ? null : bucket.remainingFraction * 100,
      resetsAt: bucket.resetTime,
    }));
    const windowLabel = windows.map((item) => `${item.label} ${item.remainingPercent === null ? '未知' : `${item.remainingPercent.toFixed(1)}%`}`).join(' · ');
    const knownWindows = windows.filter(item => Number.isFinite(item.remainingPercent));
    const remainingPercent = knownWindows.length
      ? Math.min(...knownWindows.map((item) => item.remainingPercent))
      : null;
    return {
      id: model.id,
      name: model.name,
      pool: group ? 'shared' : 'unknown',
      poolLabel: group?.displayName || '额度归属待确认',
      source: 'Antigravity 本机官方接口',
      windows,
      remainingPercent,
      quotaLabel: windowLabel || '额度窗口未知',
    };
  });
  const allWindows = groups.flatMap((group) => group.buckets || []).filter(bucket => Number.isFinite(bucket.remainingFraction));
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
    note: '同组模型共享额度；家族映射为本地兼容规则，未知模型不猜测归属。消耗速度是共享池采样估算，非单模型用量。',
  };
}

function normalizeLegacySnapshot(response) {
  const configs = response?.userStatus?.cascadeModelConfigData?.clientModelConfigs;
  if (!Array.isArray(configs) || !configs.length) throw new Error('旧版接口未返回模型数据');
  const snapshot = normalizeAntigravitySnapshot({}, []);
  snapshot.models = configs.filter(model => model && typeof model === 'object').map(model => {
    const remaining = unexpiredFraction(model.quotaInfo?.remainingFraction, model.quotaInfo?.resetTime, Date.now());
    return {
      id: model.modelOrAlias?.model || model.modelId || model.label,
      name: model.label || model.modelId || '未命名模型',
      pool: 'unknown', poolLabel: '旧版模型窗口 · 共享关系未知',
      remainingPercent: remaining === null ? null : remaining * 100,
      quotaLabel: remaining === null ? '额度未知' : `${(remaining * 100).toFixed(1)}% 剩余（旧版窗口）`,
      windows: [{ label: '旧版窗口', remainingPercent: remaining === null ? null : remaining * 100, resetsAt: model.quotaInfo?.resetTime }],
    };
  });
  const known = snapshot.models.map(m => m.remainingPercent).filter(Number.isFinite);
  snapshot.remainingPercent = known.length ? Math.min(...known) : null;
  snapshot.status = !known.length ? 'stale' : snapshot.remainingPercent <= 10 ? 'critical' : snapshot.remainingPercent <= 30 ? 'low' : 'healthy';
  snapshot.quotaNote = '旧版来源 · 周额度未知';
  snapshot.note = '主额度接口不可用，已回退到 GetUserStatus；仅展示源返回的模型窗口，不推断共享关系或周额度。';
  return snapshot;
}

async function readAntigravitySnapshot(options = {}) {
  const readConnection = options.readConnection || (async () => {
    const port = await findHttpsPort(options.logPath);
    return { port, token: await readCsrfToken(port) };
  });
  const quotaReader = options.readQuota || readQuotaResponse;
  const modelReader = options.readModels || readModelDirectory;
  let port;
  let token;
  try {
    ({ port, token } = await readConnection());
  } catch (error) {
    if (!['ENOENT', 'ECONNREFUSED'].includes(error.code)) throw error;
    return { id: 'antigravity', name: 'Antigravity', status: 'disconnected', precision: 'unavailable', updatedAt: null, models: [], source: 'Antigravity 本机接口', note: '本机服务未运行或尚未就绪。请打开 Antigravity，完成登录后刷新；仅安装 CLI 不代表额度接口已启动。' };
  }
  const [quotaResult, modelResult] = await Promise.all([
    quotaReader(port, token).then(quota => ({ quota })).catch(() => ({ failed: true })),
    modelReader(port, token, options.agyPath).catch(() => ({ models: [], failed: true })),
  ]);
  const quota = quotaResult.quota;
  if (!Array.isArray(quota?.groups) || !quota.groups.length) {
    let fallback;
    try {
      const legacy = await quotaReader(port, token, '/exa.language_server_pb.LanguageServerService/GetUserStatus');
      fallback = normalizeLegacySnapshot(legacy);
    } catch {
      const partial = normalizeAntigravitySnapshot({}, modelResult.models);
      partial.status = 'error';
      partial.modelSource = modelResult.source || null;
      partial.modelDirectoryStatus = modelResult.failed ? 'error' : 'ready';
      partial.modelDirectoryUpdatedAt = modelResult.failed ? null : partial.updatedAt;
      partial.quotaNote = '额度读取失败 · 不是余额为零';
      partial.note = '已连接本机服务，但额度接口失败。请在 Antigravity 中检查登录和网络后刷新；成功取得的模型目录仍保留，不据此推断额度或可用性。';
      return partial;
    }
    const ids = new Set(fallback.models.map(model => model.id));
    for (const model of modelResult.models) if (!ids.has(model.id)) fallback.models.push({ ...model, pool: 'unknown', poolLabel: '额度归属待确认', quotaLabel: '额度未知' });
    fallback.modelSource = modelResult.source || 'Antigravity GetUserStatus（非完整目录）';
    fallback.modelDirectoryStatus = modelResult.failed ? 'error' : 'ready';
    fallback.modelDirectoryUpdatedAt = modelResult.failed ? null : fallback.updatedAt;
    return fallback;
  }
  const snapshot = normalizeAntigravitySnapshot(quota, modelResult.models);
  snapshot.modelSource = modelResult.source || null;
  snapshot.modelDirectoryStatus = modelResult.failed ? 'error' : 'ready';
  snapshot.modelDirectoryUpdatedAt = modelResult.failed ? null : snapshot.updatedAt;
  if (!modelResult.failed) snapshot.note += ` 模型目录来源：${modelResult.source}；仅列服务端标记可选的 Agent 模型，不将内部功能模型当作对话模型。`;
  if (modelResult.failed) snapshot.note += ' 模型目录读取失败；额度池仍可查看，模型列表不完整。';
  return snapshot;
}

module.exports = {
  parseLocalModelDirectory,
  readModelDirectory,
  readCsrfToken,
  readQuotaResponse,
  findHttpsPort,
  normalizeLegacySnapshot,
  groupForModel,
  normalizeAntigravitySnapshot,
  readAntigravitySnapshot,
  readAvailableModels,
  requestLocal,
};
