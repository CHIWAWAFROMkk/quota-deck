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
  if (!['number', 'string'].includes(typeof value) || String(value).trim() === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function normalizeWorkBuddySnapshot(input, sourcePath = null) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('WorkBuddy 快照格式无效');
  const remainingCredits = finiteNumber(input.remainingCredits);
  const total = finiteNumber(input.totalCredits);
  const used = finiteNumber(input.usedCredits);
  const totalCredits = total !== null && total >= 0 ? total : null;
  const usedCredits = used !== null && used >= 0 ? used : null;
  const calculatedRemaining = remainingCredits ?? (
    totalCredits !== null && usedCredits !== null ? Math.max(0, totalCredits - usedCredits) : null
  );
  const remainingPercent = totalCredits > 0 && calculatedRemaining !== null
    ? Math.max(0, Math.min(100, calculatedRemaining / totalCredits * 100))
    : null;
  const models = Array.isArray(input.models) ? input.models.filter(model => model && typeof model.name === 'string' && model.name.trim()).slice(0, 1000) : [];
  const status = remainingPercent === null
    ? 'stale'
    : remainingPercent <= 10 ? 'critical' : remainingPercent <= 30 ? 'low' : 'healthy';

  return {
    id: 'workbuddy',
    name: 'WorkBuddy',
    status,
    source: 'WorkBuddy 官方网页快照',
    precision: 'browser-snapshot',
    updatedAt: typeof input.capturedAt === 'string' && Number.isFinite(Date.parse(input.capturedAt)) && Date.parse(input.capturedAt) <= Date.now() + 60000 ? new Date(input.capturedAt).toISOString() : null,
    planType: typeof input.plan === 'string' ? input.plan.slice(0, 200) : null,
    remainingCredits: calculatedRemaining,
    totalCredits,
    usedCredits,
    remainingPercent,
    snapshotPath: sourcePath,
    models: models.map((model) => ({
      name: model.name.trim().slice(0, 200),
      consumeMultiplier: (() => { const raw = model.rateMultiplier; const value = finiteNumber(typeof raw === 'string' ? raw.replace(/x$/i, '') : raw); return value !== null && value >= 0 ? value : null; })(),
      pool: 'shared',
      poolLabel: ['string', 'number'].includes(typeof model.rateMultiplier)
        ? `共享 WorkBuddy 积分 · ${String(model.rateMultiplier).slice(0, 30)}`
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
      if ((await fs.stat(snapshotPath)).size > 1048576) throw new Error('WorkBuddy 快照超出大小限制');
      const text = await fs.readFile(snapshotPath, 'utf8');
      if (Buffer.byteLength(text) > 1048576) throw new Error('WorkBuddy 快照超出大小限制');
      return normalizeWorkBuddySnapshot(JSON.parse(text.replace(/^\uFEFF/, '')), snapshotPath);
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
