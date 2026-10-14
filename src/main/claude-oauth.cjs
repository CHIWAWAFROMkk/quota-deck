const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const USAGE_URL = 'https://api.anthropic.com/api/oauth/usage';
const OAUTH_SOURCE = 'Claude 官方用量接口';
const LABELS = { five_hour: '5 小时', seven_day: '每周', seven_day_opus: '每周 · Opus', seven_day_sonnet: '每周 · Sonnet' };
const ORDER = Object.keys(LABELS);
const REASONS = {
  'no-credentials': '没找到 Claude 登录信息，先在 Claude Code 里登录。',
  expired: '登录令牌过期，在 Claude Code 里发一条消息即可续期。',
  'rate-limited': 'Claude 用量接口限流，稍后自动重试。',
  network: '连不上 Claude 用量接口，检查网络或代理。',
  'bad-response': 'Claude 用量接口返回了无法识别的数据。',
};
const BACKOFF_START = 2 * 60_000;
const BACKOFF_MAX = 15 * 60_000;
// The usage endpoint rate-limits hard (and Claude tools such as a desktop pet poll it too),
// so a good reading is reused for five minutes instead of asking on every refresh.
const MIN_INTERVAL = 5 * 60_000;

function defaultCredentialsPath() {
  return path.join(os.homedir(), '.claude', '.credentials.json');
}

// Read-only. Claude Code renews the token and rewrites this file, so read it on every refresh.
async function readCredentials(file) {
  let text;
  try { text = await fs.readFile(file, 'utf8'); } catch { return null; }
  try {
    const o = JSON.parse(text.replace(/^\uFEFF/, ''))?.claudeAiOauth;
    if (typeof o?.accessToken !== 'string' || !o.accessToken) return null;
    return { token: o.accessToken, plan: typeof o.subscriptionType === 'string' ? o.subscriptionType : '' };
  } catch {
    return null; // Claude Code may be rewriting it; the next refresh reads it again.
  }
}

const rank = id => (ORDER.includes(id) ? ORDER.indexOf(id) : ORDER.length);
const labelFor = id => LABELS[id] || `每周 · ${id.replace(/^seven_day_/, '')}`;

// Only five_hour / seven_day* are quota windows; extra_usage and other fields are not.
function parseUsage(json, plan, now) {
  if (!json || typeof json !== 'object' || Array.isArray(json)) return null;
  const windows = [];
  for (const [id, value] of Object.entries(json)) {
    if (!/^(five_hour|seven_day)/.test(id)) continue;
    if (!value || typeof value !== 'object' || typeof value.utilization !== 'number' || !Number.isFinite(value.utilization)) continue;
    const at = typeof value.resets_at === 'string' ? Date.parse(value.resets_at) : NaN;
    const used = Math.max(0, Math.min(100, value.utilization));
    windows.push({ id, label: labelFor(id), remainingPercent: Math.round((100 - used) * 1000) / 1000, resetsAt: Number.isFinite(at) ? new Date(at).toISOString() : null });
  }
  if (!windows.some(w => w.id === 'five_hour')) return null;
  windows.sort((a, b) => rank(a.id) - rank(b.id));
  const remainingPercent = Math.min(...windows.map(w => w.remainingPercent));
  return {
    id: 'claude',
    name: 'Claude Code',
    precision: 'provider-reported',
    status: remainingPercent <= 10 ? 'critical' : remainingPercent <= 30 ? 'low' : 'healthy',
    updatedAt: new Date(now).toISOString(),
    source: OAUTH_SOURCE,
    planType: plan,
    remainingPercent,
    windows,
    models: [],
    groups: [{
      displayName: 'Claude 订阅共享额度',
      buckets: windows.map(w => ({
        bucketId: w.id,
        label: w.label,
        window: w.id === 'five_hour' ? '5h' : 'weekly',
        remainingFraction: w.remainingPercent / 100,
        resetTime: w.resetsAt,
      })),
    }],
    quotaNote: '订阅窗口 · 官方用量接口',
    note: '由 Claude 官方用量接口读取，与 Claude Code 的 /usage 同源。',
  };
}

function defaultFetch() {
  // In the Electron main process net.fetch follows the system proxy; plain Node falls back to fetch.
  const electron = require('electron');
  return typeof electron === 'object' && electron?.net?.fetch ? electron.net.fetch.bind(electron.net) : globalThis.fetch;
}

function createClaudeOAuthReader({ credentialsPath = defaultCredentialsPath(), fetchImpl = null, now = Date.now, timeoutMs = 15_000 } = {}) {
  let backoff = 0;
  let blockedUntil = 0;
  let last = null;
  let lastAt = 0;
  // Failures carry the last good reading so callers can show it as stale rather than nothing.
  const fail = reason => (last ? { ok: false, reason, last } : { ok: false, reason });
  return async function readClaudeOAuth() {
    const t = now();
    if (last && t - lastAt < MIN_INTERVAL) return { ok: true, snapshot: last };
    if (t < blockedUntil) return fail('rate-limited');
    const credentials = await readCredentials(credentialsPath);
    if (!credentials) { last = null; return { ok: false, reason: 'no-credentials' }; }
    let response;
    try {
      response = await (fetchImpl || defaultFetch())(USAGE_URL, {
        method: 'GET',
        headers: { Authorization: `Bearer ${credentials.token}`, 'anthropic-beta': 'oauth-2025-04-20', Accept: 'application/json' },
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch {
      return fail('network'); // never forward the error: it may echo request details
    }
    if (response.status === 401 || response.status === 403) return fail('expired');
    if (response.status === 429) {
      backoff = Math.min(BACKOFF_MAX, backoff ? backoff * 2 : BACKOFF_START);
      blockedUntil = t + backoff;
      return fail('rate-limited');
    }
    if (!response.ok) return fail('network');
    let json;
    try { json = await response.json(); } catch { return fail('bad-response'); }
    const snapshot = parseUsage(json, credentials.plan, t);
    if (!snapshot) return fail('bad-response');
    backoff = 0;
    blockedUntil = 0;
    last = snapshot;
    lastAt = t;
    return { ok: true, snapshot };
  };
}

module.exports = { OAUTH_SOURCE, REASONS, USAGE_URL, createClaudeOAuthReader, parseUsage, readCredentials };
