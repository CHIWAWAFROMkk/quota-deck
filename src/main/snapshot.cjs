const { readCodexSnapshot } = require('./codex-client.cjs');
const { readDeepSeekSnapshot } = require('./deepseek-client.cjs');
const { readWorkBuddySnapshot } = require('./workbuddy-client.cjs');
const { readAntigravitySnapshot } = require('./antigravity-client.cjs');
const { readClaudeSnapshot } = require('./claude-client.cjs');
const { localAgentAvailability } = require('./orchestrator.cjs');
const { inferModelStrengths } = require('./model-guidance.cjs');
const { createHistory } = require('./quota-history.cjs');
let history = null;
function configureHistory(filePath) { history = createHistory(filePath); }

function unavailable(id, name, note, source = '手动') {
  return {
    id,
    name,
    status: 'disconnected',
    source,
    precision: 'unavailable',
    updatedAt: null,
    models: [],
    note,
  };
}

const readers = {
  claude: readClaudeSnapshot,
  codex: readCodexSnapshot,
  deepseek: readDeepSeekSnapshot,
  antigravity: readAntigravitySnapshot,
  workbuddy: readWorkBuddySnapshot,
};

function createProviderReader(providerReaders) {
 const lastGood = new Map();
 const pending = new Map();
 async function fetchProvider(id) {
  const reader = Object.hasOwn(providerReaders, id) ? providerReaders[id] : null;
  if (typeof reader !== 'function') throw new Error('未知数据源');
  try {
    const result = await reader();
    if (['error', 'disconnected', 'unsupported'].includes(result.status)) {
      if (lastGood.has(id)) throw new Error('数据源未连接');
      return result;
    }
    if (result.modelDirectoryStatus === 'error' && lastGood.get(id)?.models?.length) {
      result.models = structuredClone(lastGood.get(id).models).map(model => ({ ...model, windows: [], remainingPercent: null, pool: 'unknown', poolLabel: '目录缓存 · 额度归属待确认', quotaLabel: '目录缓存 · 本轮未核验额度' }));
      result.modelDirectoryUpdatedAt = lastGood.get(id).modelDirectoryUpdatedAt || lastGood.get(id).updatedAt;
      result.note += ' 保留上次模型目录；本轮模型与额度归属未核验。';
    }
    if (history && result.id === 'antigravity') {
      try { await history.record(result); }
      catch { result.historyWarning = '历史记录保存失败，消耗趋势暂不可用'; }
    }
    if (result.status !== 'stale' || !lastGood.has(id)) lastGood.set(id, structuredClone(result));
    return result;
  } catch (error) {
    const previous = lastGood.get(id);
    if (previous) return {
      ...structuredClone(previous), status: 'stale',
      error: '刷新失败，请检查登录或网络后重试',
      note: '刷新失败；以下为上次成功读取的数据，不代表当前可用额度。',
    };
    return {
      ...unavailable(id, id, '读取失败，请检查登录或网络后重试'),
      status: 'error',
      error: '读取失败',
    };
  }
 }
 return function read(id) {
   if (!pending.has(id)) pending.set(id, fetchProvider(id).finally(() => pending.delete(id)));
   return pending.get(id);
 };
}
const readProvider = createProviderReader(readers);

async function readAll() {
  const ids = ['codex', 'claude', 'antigravity', 'deepseek', 'workbuddy'];
  const raw = {
    updatedAt: new Date().toISOString(),
    providers: await Promise.all(ids.map(readProvider)),
  };
  return { ...toUiSnapshot(raw), agents: localAgentAvailability() };
}

function relativeReset(value) {
  if (!value) return '重置时间未知';
  const delta = new Date(value).getTime() - Date.now();
  if (!Number.isFinite(delta)) return '重置时间未知';
  if (delta <= 0) return '已到重置时间 · 待同步';
  const minutes = Math.ceil(delta / 60_000);
  if (minutes < 60) return `${minutes}m 后重置`;
  const hours = Math.ceil(minutes / 60);
  if (hours < 48) return `${hours}h 后重置`;
  return `${Math.ceil(hours / 24)}d 后重置`;
}

function health(percent, fallback = 'healthy') {
  if (!Number.isFinite(percent)) return fallback;
  if (percent <= 10) return 'critical';
  if (percent <= 30) return 'low';
  return 'healthy';
}

function statusText(status) {
  return {
    healthy: '充裕',
    low: '偏低',
    critical: '告急',
    loading: '读取中',
    disconnected: '未连接',
    stale: '缓存数据',
    unsupported: '待配置',
    error: '异常',
  }[status] || '未知';
}

// How the renderer should draw a provider's meter, and where its number came from.
// provenance: live = provider-reported this round, stale = last good / browser snapshot, unknown = nothing measured.
function gaugeFor(provider, { percent, balance, stale, pools }) {
  const provenance = ['error', 'disconnected', 'unsupported'].includes(provider.status) ? 'unknown' : stale ? 'stale' : 'live';
  const windows = (provider.windows?.length ? provider.windows : pools.flatMap(pool => pool.windows))
    .filter(w => Number.isFinite(w.remainingPercent))
    .map(w => ({ label: { 300: '5 小时', 10080: '每周' }[w.windowDurationMins] || w.label || '窗口', remainingPercent: w.remainingPercent, resetsAt: w.resetsAt || null, reset: relativeReset(w.resetsAt) }))
    // The headline number is the tightest window, so windows[0] must be that window for its label and reset.
    .sort((a, b) => a.remainingPercent - b.remainingPercent);
  if (Number.isFinite(provider.remainingCredits) && Number.isFinite(provider.totalCredits) && provider.totalCredits > 0) {
    return { kind: 'ratio', provenance, remainingPercent: Math.max(0, Math.min(100, provider.remainingCredits / provider.totalCredits * 100)), windows: [] };
  }
  if (Number.isFinite(percent)) return { kind: 'window', provenance, remainingPercent: percent, windows };
  if (balance) return { kind: 'balance', provenance, remainingPercent: null, windows: [] };
  return { kind: 'unknown', provenance: 'unknown', remainingPercent: null, windows };
}

function providerToUi(provider) {
  const firstWindow = provider.windows?.[0] || null;
  const balance = provider.balances?.[0] || null;
  const percent = provider.remainingPercent;
  const displayStatus = provider.precision === 'browser-snapshot' ? 'stale' : provider.status;
  const timestamp = Date.parse(provider.updatedAt);
  const freshness = Number.isFinite(timestamp)
    ? `数据时间 ${new Date(timestamp).toLocaleString('zh-CN', { hour12: false })}` : '数据时间未知';
  const stale = provider.status === 'stale' || provider.precision === 'browser-snapshot';
  let quotaMain = provider.status === 'error' ? '读取失败' : '未知';
  let quotaNote = provider.note || statusText(provider.status);
  if (Number.isFinite(provider.remainingCredits)) {
    quotaMain = `${provider.remainingCredits.toLocaleString('zh-CN')} 积分`;
    quotaNote = Number.isFinite(provider.totalCredits)
      ? `共 ${provider.totalCredits.toLocaleString('zh-CN')} 积分`
      : '共享账号积分';
  } else if (Number.isFinite(percent)) {
    quotaMain = `${percent.toFixed(1)}%`;
    quotaNote = provider.quotaNote || (percent <= 0 ? '已知窗口已耗尽' : firstWindow ? relativeReset(firstWindow.resetsAt) : '共享账户剩余');
  } else if (balance) {
    const symbol = balance.currency === 'CNY' ? '¥' : balance.currency === 'USD' ? '$' : balance.currency;
    quotaMain = `${symbol} ${balance.total_balance}`;
    quotaNote = '全模型共享余额';
  }

  const models = (provider.models || []).map((model) => {
    const modelWindow = model.windows?.[0] || firstWindow;
    const knownModelWindows = (model.windows || []).map(w => w.remainingPercent).filter(Number.isFinite);
    const modelPercent = Number.isFinite(model.remainingPercent)
      ? model.remainingPercent
      : knownModelWindows.length ? Math.min(...knownModelWindows) : model.pool === 'unknown' ? null : modelWindow?.remainingPercent;
    let value = balance ? `${quotaMain} 共享` : '共享账户额度';
    if (Number.isFinite(provider.remainingCredits)) value = `${provider.remainingCredits.toLocaleString('zh-CN')} 积分共享`;
    if (model.quotaLabel) value = model.quotaLabel;
    else if (Number.isFinite(modelPercent)) value = `${modelPercent.toFixed(1)}% 剩余`;
    return {
      id: model.id || model.name,
      poolType: model.pool,
      name: model.name,
      val: value,
      percent: Number.isFinite(modelPercent) ? modelPercent : model.pool === 'unknown' ? null : Number.isFinite(percent) ? percent : null,
      state: stale ? 'stale' : health(modelPercent, displayStatus),
      pool: model.poolLabel || (model.pool === 'shared' ? '共享账户额度' : model.pool === 'unknown' ? '额度归属待确认' : '独立额度'),
      windows: (model.windows || provider.windows || []).map(w => ({ ...w, reset: relativeReset(w.resetsAt) })),
      reset: model.resetLabel || (model.windows?.length > 1
        ? model.windows.map((item) => `${item.label} ${relativeReset(item.resetsAt)}`).join(' · ')
        : modelWindow ? relativeReset(modelWindow.resetsAt) : '随账户余额'),
      source: model.source || provider.source,
      sync: freshness,
      consumeMultiplier: Number.isFinite(model.consumeMultiplier) ? model.consumeMultiplier : null,
      strengths: model.strengths || inferModelStrengths(provider.id, model.name),
      guidanceSource: model.strengths ? '官方说明' : '本地建议',
    };
  });

  const pools = (provider.groups || []).map((group) => ({
    name: group.displayName,
    description: group.description,
    modelCount: (provider.models || []).filter((model) => model.poolLabel === group.displayName).length,
    windows: (group.buckets || []).map((bucket) => ({
      label: bucket.label || (bucket.window === '5h' ? '5 小时' : bucket.window === 'weekly' ? '每周' : '未知窗口'),
      remainingPercent: Number.isFinite(bucket.remainingFraction) ? bucket.remainingFraction * 100 : null,
      resetsAt: bucket.resetTime,
      reset: relativeReset(bucket.resetTime),
      burnPerHour: !stale && Number.isFinite(bucket.burnPerHour) ? bucket.burnPerHour : null,
      samplingSupported: provider.id === 'antigravity',
      estimatedHoursLeft: !stale ? bucket.estimatedHoursLeft : null,
    })),
  }));

  return {
    id: provider.id,
    name: provider.name,
    monogram: { workbuddy: 'WB', antigravity: 'AG', deepseek: 'DS', claude: 'CC', codex: 'CX' }[provider.id] || String(provider.name || provider.id || '?').slice(0, 2).toUpperCase(),
    gauge: gaugeFor(provider, { percent, balance, stale, pools }),
    status: displayStatus,
    statusText: statusText(displayStatus),
    plan: stale ? `旧数据 · ${freshness}` : provider.status === 'error' ? '连接异常 · 请重试' : provider.id === 'claude' ? '官方 statusLine · 当前会话观测' : provider.id === 'codex'
      ? `${provider.planType || 'ChatGPT'} · 官方额度窗口`
      : provider.id === 'workbuddy' && provider.planType
        ? `${provider.planType} · 官方网页快照`
        : provider.precision === 'provider-reported' ? '已连接 · 官方数据' : '连接器待配置',
    quotaHero: quotaMain,
    quotaSub: quotaNote,
    sharedPool: models.some((model) => model.pool.includes('共享')),
    sharedNotice: [provider.note, freshness, provider.historyWarning].filter(Boolean).join(' · '),
    freshness,
    models,
    pools,
    modelDirectoryStatus: provider.modelDirectoryStatus,
    setupAction: provider.id === 'claude' ? (provider.chainConnected ? 'claude-disconnect' : 'claude-connect') : provider.id === 'workbuddy' ? 'open-workbuddy' : null,
    chainConnected: provider.id === 'claude' ? provider.chainConnected === true : undefined,
    action: models.length === 0
      ? provider.id === 'workbuddy'
        ? { label: '登录并读取用量', type: 'open-workbuddy' }
        : { label: '配置连接', type: 'configure' }
      : null,
  };
}

function toUiSnapshot(snapshot) {
  const providers = snapshot.providers.map(providerToUi);
  const counts = providers.reduce((result, provider) => {
    result[provider.status] = (result[provider.status] || 0) + 1;
    return result;
  }, {});
  const critical = (counts.critical || 0) + (counts.low || 0) + (counts.error || 0);
  return {
    lastUpdated: new Date(snapshot.updatedAt).toLocaleTimeString('zh-CN', {
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
    }),
    globalStatus: critical || counts.stale || counts.disconnected || counts.unsupported ? '部分数据需检查' : '额度已同步',
    summaryRatio: `${counts.healthy || 0} 可用 · ${critical} 需注意 · ${(counts.disconnected || 0) + (counts.unsupported || 0)} 待配置`,
    gemState: critical ? 'critical' : 'healthy',
    providers,
  };
}

module.exports = { configureHistory, createProviderReader, health, providerToUi, readAll, readProvider, relativeReset, toUiSnapshot };
