const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');

function defaultClaudeSnapshotPath() {
  return path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'QuotaDeck', 'claude-usage.json');
}

// Official statusLine JSON contains private paths. Never persist the raw payload.
function sanitizeClaudePayload(input, now = Date.now()) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Claude 状态数据不是对象');
  if (!Number.isFinite(now) || !Number.isFinite(new Date(now).getTime())) throw new Error('Claude 接收时间无效');
  const windows = {};
  for (const id of ['five_hour', 'seven_day', 'spend_limit']) {
    const value = input?.rate_limits?.[id];
    if (!value || !Number.isFinite(value.used_percentage) || value.used_percentage < 0) continue;
    windows[id] = {
      used_percentage: value.used_percentage,
      resets_at: Number.isFinite(value.resets_at) && value.resets_at > 0 && value.resets_at < 253402300800 ? value.resets_at : null,
    };
  }
  const id = typeof input?.model?.id === 'string' ? input.model.id.slice(0, 200) : null;
  return {
    schemaVersion: 1,
    receivedAt: new Date(now).toISOString(),
    sessionKey: typeof input?.session_id === 'string' && input.session_id.length <= 4096 ? createHash('sha256').update(input.session_id).digest('hex') : null,
    model: id ? { id, display_name: typeof input.model.display_name === 'string' ? input.model.display_name.slice(0, 200) : id } : null,
    rate_limits: windows,
  };
}

function normalizeClaudeSnapshot(input, now = Date.now()) {
  if (input?.schemaVersion !== 1) throw new Error('Claude 快照格式不支持');
  const received = typeof input.receivedAt === 'string' ? Date.parse(input.receivedAt) : NaN;
  const fresh = Number.isFinite(received) && received <= now + 60000 && now - received <= 300000;
  const labels = { five_hour: '5 小时', seven_day: '每周', spend_limit: 'Gateway 支出' };
  const windows = Object.entries(labels).filter(([id]) => input.rate_limits?.[id]).map(([id, label]) => {
    const value = input.rate_limits[id];
    const reset = Number.isFinite(value.resets_at) && value.resets_at > 0 && value.resets_at < 253402300800 ? value.resets_at * 1000 : null;
    const known = Number.isFinite(value.used_percentage) && value.used_percentage >= 0 && (reset === null || reset > now);
    return { id, label, remainingPercent: known ? Math.max(0, 100 - value.used_percentage) : null, resetsAt: reset ? new Date(reset).toISOString() : null };
  });
  const known = windows.map(w => w.remainingPercent).filter(Number.isFinite);
  const remainingPercent = known.length ? Math.min(...known) : null;
  const name = 'Claude 订阅共享额度';
  const modelId = typeof input.model?.id === 'string' ? input.model.id.trim().slice(0, 200) : '';
  const modelName = typeof input.model?.display_name === 'string' ? input.model.display_name.trim().slice(0, 200) : '';
  const models = modelId ? [{ id: modelId, name: modelName || modelId, pool: 'shared', poolLabel: name, windows, remainingPercent, source: fresh ? 'Claude Code statusLine 当前会话观测' : 'Claude Code statusLine 历史会话观测' }] : [];
  return {
    id: 'claude', name: 'Claude Code', precision: 'provider-reported',
    status: !fresh || !known.length ? 'stale' : remainingPercent <= 10 ? 'critical' : remainingPercent <= 30 ? 'low' : 'healthy',
    updatedAt: Number.isFinite(received) && received <= now + 60000 ? new Date(received).toISOString() : null,
    source: 'Claude Code 官方 statusLine', remainingPercent, windows, models,
    groups: [{ displayName: name, buckets: windows.map(w => ({ bucketId: w.id, label: w.label, window: w.id === 'five_hour' ? '5h' : w.id === 'seven_day' ? 'weekly' : 'spend', remainingFraction: w.remainingPercent === null ? null : w.remainingPercent / 100, resetTime: w.resetsAt })) }],
    quotaNote: fresh ? '订阅窗口 · 当前会话观测' : '订阅窗口 · 历史观测，等待更新',
    note: '仅列 statusLine 当前会话观测到的模型，不代表完整可选目录。接收时间不是独立查询时间；超过 5 分钟标记旧数据。缺失额度可能尚未产生首个响应，或登录类型不提供订阅窗口。',
  };
}

async function readClaudeSnapshot(options = {}) {
  const file = options.snapshotPath || process.env.QUOTADECK_CLAUDE_SNAPSHOT || defaultClaudeSnapshotPath();
  // Lazy require: only the desktop app needs to know whether the statusLine chain is installed.
  const chainConnected = options.chainConnected ?? require('./claude-statusline-chain.cjs').connectionState().connected;
  try {
    if ((await fs.stat(file)).size > 65536) throw new Error('Claude 快照超出大小限制');
    const text = await fs.readFile(file, 'utf8');
    if (Buffer.byteLength(text) > 65536) throw new Error('Claude 快照超出大小限制');
    return { chainConnected, ...normalizeClaudeSnapshot(JSON.parse(text.replace(/^\uFEFF/, '')), options.now) };
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    const note = chainConnected
      ? '已接入，等 Claude Code 下一次回复后显示额度。原有状态栏照常显示。'
      : '尚未接入。一键接入会把 Claude 状态栏的数据同时转给 QuotaDeck，你现在的状态栏照常显示，不需要密钥。';
    return { id: 'claude', name: 'Claude Code', status: 'unsupported', precision: 'unavailable', updatedAt: null, models: [], source: 'Claude Code 官方 statusLine', note, chainConnected };
  }
}

module.exports = { defaultClaudeSnapshotPath, sanitizeClaudePayload, normalizeClaudeSnapshot, readClaudeSnapshot };
