const { readCodexSnapshot } = require('./codex-client.cjs');
const { readDeepSeekSnapshot } = require('./deepseek-client.cjs');
const { readWorkBuddySnapshot } = require('./workbuddy-client.cjs');
const { readAntigravitySnapshot } = require('./antigravity-client.cjs');
const { inferModelStrengths } = require('./model-guidance.cjs');

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
  codex: readCodexSnapshot,
  deepseek: readDeepSeekSnapshot,
  antigravity: readAntigravitySnapshot,
  workbuddy: readWorkBuddySnapshot,
};

async function readProvider(id) {
  const reader = readers[id];
  if (!reader) throw new Error(`未知数据源：${id}`);
  try {
    return await reader();
  } catch (error) {
    return {
      ...unavailable(id, id, error.message),
      status: 'error',
      error: error.message,
      updatedAt: new Date().toISOString(),
    };
  }
}

async function readAll() {
  const ids = ['codex', 'antigravity', 'deepseek', 'workbuddy'];
  const raw = {
    updatedAt: new Date().toISOString(),
    providers: await Promise.all(ids.map(readProvider)),
  };
  return toUiSnapshot(raw);
}

function relativeReset(value) {
  if (!value) return '重置时间未知';
  const delta = new Date(value).getTime() - Date.now();
  if (delta <= 0) return '即将重置';
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

function providerToUi(provider) {
  const firstWindow = provider.windows?.[0] || null;
  const balance = provider.balances?.[0] || null;
  const percent = provider.remainingPercent;
  const displayStatus = provider.status === 'error' ? 'critical' : provider.status;
  let quotaMain = '未配置';
  let quotaNote = provider.note || statusText(provider.status);
  if (Number.isFinite(provider.remainingCredits)) {
    quotaMain = `${provider.remainingCredits.toLocaleString('zh-CN')} 积分`;
    quotaNote = Number.isFinite(provider.totalCredits)
      ? `共 ${provider.totalCredits.toLocaleString('zh-CN')} 积分`
      : '共享账号积分';
  } else if (Number.isFinite(percent)) {
    quotaMain = `${percent.toFixed(1)}%`;
    quotaNote = provider.quotaNote || (firstWindow ? relativeReset(firstWindow.resetsAt) : '额度可用');
  } else if (balance) {
    const symbol = balance.currency === 'CNY' ? '¥' : balance.currency === 'USD' ? '$' : balance.currency;
    quotaMain = `${symbol} ${balance.total_balance}`;
    quotaNote = '全模型共享余额';
  }

  const models = (provider.models || []).map((model) => {
    const modelWindow = model.windows?.[0] || firstWindow;
    const modelPercent = Number.isFinite(model.remainingPercent)
      ? model.remainingPercent
      : modelWindow?.remainingPercent;
    let value = balance ? `${quotaMain} 共享` : '共享账户额度';
    if (Number.isFinite(provider.remainingCredits)) value = `${provider.remainingCredits.toLocaleString('zh-CN')} 积分共享`;
    if (model.quotaLabel) value = model.quotaLabel;
    else if (Number.isFinite(modelPercent)) value = `${modelPercent.toFixed(1)}% 剩余`;
    return {
      name: model.name,
      val: value,
      percent: Number.isFinite(modelPercent) ? modelPercent : Number.isFinite(percent) ? percent : 0,
      state: health(modelPercent, displayStatus),
      pool: model.poolLabel || (model.pool === 'shared' ? '共享账户额度' : '独立额度'),
      reset: model.resetLabel || (model.windows?.length > 1
        ? model.windows.map((item) => `${item.label} ${relativeReset(item.resetsAt)}`).join(' · ')
        : modelWindow ? relativeReset(modelWindow.resetsAt) : '随账户余额'),
      source: model.source || provider.source,
      sync: '刚刚',
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
      label: bucket.window === '5h' ? '5 小时' : '每周',
      remainingPercent: Number(bucket.remainingFraction) * 100,
      resetsAt: bucket.resetTime,
      reset: relativeReset(bucket.resetTime),
      burnPerHour: Number.isFinite(bucket.burnPerHour) ? bucket.burnPerHour : null,
    })),
  }));

  return {
    id: provider.id,
    name: provider.name,
    monogram: provider.id === 'workbuddy' ? 'WB' : provider.id === 'antigravity' ? 'AG' : provider.id === 'deepseek' ? 'DS' : 'CX',
    status: displayStatus,
    statusText: statusText(provider.status),
    plan: provider.id === 'codex'
      ? `${provider.planType || 'ChatGPT'} · 官方额度窗口`
      : provider.id === 'workbuddy' && provider.planType
        ? `${provider.planType} · 官方网页快照`
        : provider.precision === 'provider-reported' ? '已连接 · 官方数据' : '连接器待配置',
    quotaHero: quotaMain,
    quotaSub: quotaNote,
    sharedPool: models.some((model) => model.pool.includes('共享')),
    sharedNotice: provider.note,
    models,
    pools,
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
  const critical = (counts.critical || 0) + (counts.low || 0);
  return {
    lastUpdated: new Date(snapshot.updatedAt).toLocaleTimeString('zh-CN', {
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
    }),
    globalStatus: critical ? '需注意' : '额度已同步',
    summaryRatio: `${counts.healthy || 0} 可用 · ${critical} 需注意 · ${(counts.disconnected || 0) + (counts.unsupported || 0)} 待配置`,
    gemState: critical ? 'critical' : 'healthy',
    providers,
  };
}

module.exports = { health, providerToUi, readAll, readProvider, relativeReset, toUiSnapshot };
