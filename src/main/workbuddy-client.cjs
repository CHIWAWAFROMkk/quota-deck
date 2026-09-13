const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const WORKBUDDY_APP_URL = 'https://www.workbuddy.cn/profile/plans-usage';

function defaultSnapshotPath() {
  const base = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
  return path.join(base, 'QuotaDeck', 'workbuddy-usage.json');
}

function bundledSnapshotPath() {
  return path.join(__dirname, '..', '..', 'data', 'workbuddy-usage.json');
}

function finiteNumber(value) {
  if (value === null || value === undefined || String(value).trim() === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function normalizeWorkBuddySnapshot(input, sourcePath = null) {
  const remainingCredits = finiteNumber(input.remainingCredits);
  const totalCredits = finiteNumber(input.totalCredits);
  const usedCredits = finiteNumber(input.usedCredits);
  const calculatedRemaining = remainingCredits ?? (
    totalCredits !== null && usedCredits !== null ? Math.max(0, totalCredits - usedCredits) : null
  );
  const remainingPercent = totalCredits > 0 && calculatedRemaining !== null
    ? Math.max(0, Math.min(100, calculatedRemaining / totalCredits * 100))
    : null;
  const models = Array.isArray(input.models) ? input.models : [];
  const status = remainingPercent === null
    ? 'stale'
    : remainingPercent <= 10 ? 'critical' : remainingPercent <= 30 ? 'low' : 'healthy';

  return {
    id: 'workbuddy',
    name: 'WorkBuddy',
    status,
    source: 'WorkBuddy 官方网页快照',
    precision: 'browser-snapshot',
    updatedAt: input.capturedAt || null,
    planType: input.plan || null,
    remainingCredits: calculatedRemaining,
    totalCredits,
    usedCredits,
    remainingPercent,
    snapshotPath: sourcePath,
    models: models.map((model) => ({
      name: String(model.name),
      consumeMultiplier: finiteNumber(String(model.rateMultiplier || '').replace(/x$/i, '')),
      pool: 'shared',
      poolLabel: model.rateMultiplier
        ? `共享 WorkBuddy 积分 · ${model.rateMultiplier}`
        : '共享 WorkBuddy 积分',
      source: 'WorkBuddy 官方网页',
    })),
    note: 'WorkBuddy 模型共享账号积分；网页未提供独立模型额度时不做拆分估算。',
  };
}

async function readWorkBuddySnapshot(options = {}) {
  const explicitPath = options.snapshotPath || process.env.WORKBUDDY_USAGE_SNAPSHOT;
  const candidates = explicitPath
    ? [explicitPath]
    : [defaultSnapshotPath(), bundledSnapshotPath()];
  for (const snapshotPath of candidates) {
    try {
      const text = await fs.readFile(snapshotPath, 'utf8');
      return normalizeWorkBuddySnapshot(JSON.parse(text), snapshotPath);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  {
    return {
      id: 'workbuddy',
      name: 'WorkBuddy',
      status: 'disconnected',
      source: 'WorkBuddy 官方网页',
      precision: 'unavailable',
      updatedAt: null,
      models: [],
      usageUrl: WORKBUDDY_APP_URL,
      note: '请登录 WorkBuddy，进入“个人主页 → 套餐与用量”完成首次读取。',
    };
  }
}

module.exports = {
  WORKBUDDY_APP_URL,
  bundledSnapshotPath,
  defaultSnapshotPath,
  normalizeWorkBuddySnapshot,
  readWorkBuddySnapshot,
};
