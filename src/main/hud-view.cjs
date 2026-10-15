const { modelName } = require('./model-names.cjs');

const HUD_ORDER = ['codex', 'claude', 'antigravity', 'workbuddy', 'deepseek'];
const NAMES = { codex: 'Codex', claude: 'Claude', antigravity: 'Antigravity', workbuddy: 'WorkBuddy', deepseek: 'DeepSeek' };
const TOKEN_SOURCES = ['claude', 'codex'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const HOUR = 3_600_000;
const PLANS = { max_20x: 'Max x20', max_5x: 'Max x5', max: 'Max', pro: 'Pro', plus: 'Plus', free: 'Free', team: 'Team', business: 'Business', enterprise: 'Enterprise' };
const SETUP_NOTES = {
  codex: 'No Codex usage found. Sign in to Codex.',
  claude: 'Not connected. Sign in to Claude Code, or connect the statusLine in Settings.',
  antigravity: 'Antigravity is not running.',
  workbuddy: 'Sign in to WorkBuddy in Settings to read usage.',
  deepseek: 'Set DEEPSEEK_API_KEY to read your balance.',
};
const ROW_RANK = { '5h': 0, Weekly: 1 };
const pad = n => String(n).padStart(2, '0');
const clock = d => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

function levelFor(usedPct) {
  if (!Number.isFinite(usedPct)) return 'none';
  return usedPct >= 90 ? 'high' : usedPct >= 70 ? 'warn' : 'ok';
}

const usedOf = remaining => (Number.isFinite(remaining) ? Math.round(100 - Math.max(0, Math.min(100, remaining))) : null);

// The card shows the full window name, the capsule the short one.
function windowNames(providerId, label, pool) {
  const text = String(label || '');
  const model = /^每周 · (.+)$/.exec(text)?.[1];
  let name;
  let short;
  if (text === '5 小时') { name = providerId === 'claude' ? 'Current session' : '5h limit'; short = '5h'; }
  else if (text === '每周') { name = providerId === 'claude' ? 'Weekly' : 'Weekly limit'; short = 'Weekly'; }
  else if (model) { name = `Weekly limit · ${model}`; short = model; }
  else { name = text || 'Limit'; short = name; }
  return pool ? { name: `${pool} · ${short}`, short: `${pool} ${short}` } : { name, short };
}

const parseTime = iso => (typeof iso === 'string' ? Date.parse(iso) : NaN);

/** Under a day: a countdown (1h 12m, 51m, <1m); later: weekday and time (Sat 18:27). */
function resetText(iso, now) {
  const at = parseTime(iso);
  if (!Number.isFinite(at)) return '—';
  const left = at - now;
  if (left <= 0) return 'Pending update';
  if (left >= 24 * HOUR) { const d = new Date(at); return `${DAYS[d.getDay()]} ${clock(d)}`; }
  const minutes = Math.floor(left / 60000);
  if (minutes < 1) return '<1m';
  const hours = Math.floor(minutes / 60);
  return hours ? `${hours}h ${pad(minutes % 60)}m` : `${minutes}m`;
}

// A moment later today is just its time; another day gets its weekday.
function whenText(at, now) {
  const d = new Date(at);
  return d.toDateString() === new Date(now).toDateString() ? clock(d) : `${DAYS[d.getDay()]} ${clock(d)}`;
}

// Projected use at reset = used now + rate × hours left (12% + 6.3%/h × 1.2h ≈ 20% by reset).
function burnFor(w, usedPct, now, stale) {
  const rate = w.burnPerHour;
  const value = Number.isFinite(rate) ? `${Math.max(0, rate).toFixed(1)}%/h` : '—';
  const at = parseTime(w.resetsAt);
  if (stale || usedPct === null || !Number.isFinite(at) || at <= now) return { value: '—', level: 'none', detail: 'No estimate', projectedPct: null };
  if (usedPct >= 100) return { value, level: 'high', detail: 'Exhausted', projectedPct: 100 };
  if (!Number.isFinite(rate)) return { value: '—', level: 'none', detail: 'Insufficient data', projectedPct: null };
  if (rate <= 0) return { value: '0.0%/h', level: 'ok', detail: 'No usage', projectedPct: usedPct };
  const projected = usedPct + rate * (at - now) / HOUR;
  if (projected < 100) return { value, level: 'ok', detail: `${Math.round(projected)}% by reset`, projectedPct: projected };
  return { value, level: 'warn', detail: whenText(now + (100 - usedPct) / rate * HOUR, now), projectedPct: 100 };
}

// Pools carry per-pool windows (Claude, Antigravity); otherwise use the gauge's windows (Codex).
function windowRows(provider, now, stale) {
  const pools = (provider.pools || []).filter(pool => pool.windows?.length);
  const windows = pools.length
    ? pools.flatMap(pool => pool.windows.map(w => ({ ...w, pool: pools.length > 1 ? pool.name : '' })))
    : (provider.gauge?.windows || []).map(w => ({ ...w, pool: '' }));
  return windows.map(w => {
    const usedPct = usedOf(w.remainingPercent);
    return { ...windowNames(provider.id, w.label, w.pool), usedPct, level: levelFor(usedPct), reset: resetText(w.resetsAt, now), burn: burnFor(w, usedPct, now, stale) };
  }).sort((a, b) => (ROW_RANK[a.short] ?? 2) - (ROW_RANK[b.short] ?? 2));
}

// "¥ 8.85" → ¥8.85, yellow at or below CNY 10 / USD 2, red at or below 0. Other currencies stay unknown.
function balanceOf(provider) {
  const match = /^([¥$])(-?\d+(?:\.\d+)?)$/.exec(String(provider.quotaHero || '').replace(/\s+/g, ''));
  if (!match) return null;
  const amount = Number(match[2]);
  const warnAt = match[1] === '$' ? 2 : 10;
  return { text: `${match[1]}${amount.toFixed(2)}`, level: amount <= 0 ? 'high' : amount <= warnAt ? 'warn' : 'ok' };
}

function planText(type) {
  const key = String(type || '').trim().toLowerCase();
  if (PLANS[key]) return PLANS[key];
  return String(type || '').trim().replace(/(^|[_\s-]+)([a-z])/g, (_, gap, letter) => `${gap ? ' ' : ''}${letter.toUpperCase()}`);
}

function agoText(iso, now) {
  const at = parseTime(iso);
  if (!Number.isFinite(at)) return 'Last read unknown';
  const minutes = Math.max(0, Math.floor((now - at) / 60000));
  if (minutes < 60) return `Last read ${minutes}m ago`;
  if (minutes < 1440) return `Last read ${Math.floor(minutes / 60)}h ago`;
  return `Last read ${Math.floor(minutes / 1440)}d ago`;
}

function stateOf(provider, gauge) {
  if (provider.status === 'error') return 'error';
  if (gauge.kind === 'unknown' || ['disconnected', 'unsupported'].includes(provider.status)) return 'disconnected';
  return gauge.provenance === 'stale' ? 'stale' : 'live';
}

function placeholder(id) {
  return {
    id, name: NAMES[id], label: '–', state: 'loading', setup: null,
    ring: { usedPct: null, level: 'none', dashed: false },
    pill: [{ name: '', value: NAMES[id], level: 'none' }],
    card: { plan: '', account: '', note: 'Reading…', balance: null, rows: [], tokens: TOKEN_SOURCES.includes(id) },
  };
}

function buildHudItems(ui, now = Date.now()) {
  const providers = new Map((ui?.providers || []).map(provider => [provider.id, provider]));
  return HUD_ORDER.map(id => {
    const p = providers.get(id);
    if (!p) return placeholder(id);
    const gauge = p.gauge || { kind: 'unknown', provenance: 'unknown' };
    const state = stateOf(p, gauge);
    const stale = state === 'stale';
    const rows = state === 'live' || stale ? windowRows(p, now, stale) : [];
    let ring = { usedPct: null, level: 'none', dashed: stale };
    let label = '–';
    let balance = null;
    if (gauge.kind === 'window' || gauge.kind === 'ratio') {
      const usedPct = usedOf(gauge.remainingPercent);
      ring = { usedPct, level: levelFor(usedPct), dashed: stale };
      if (usedPct !== null) label = `${usedPct}%`;
    } else if (gauge.kind === 'balance') {
      balance = balanceOf(p);
      if (balance) { ring = { usedPct: null, level: balance.level, dashed: stale }; label = balance.text; }
    }
    let pill;
    if (rows.length) pill = rows.map(row => ({ name: row.short, value: row.usedPct === null ? '—' : `${row.usedPct}%`, level: row.level }));
    else if (balance) pill = [{ name: 'Balance', value: balance.text, level: balance.level }];
    else if (gauge.kind === 'ratio' && ring.usedPct !== null) pill = [{ name: 'Used', value: label, level: ring.level }];
    else pill = [{ name: '', value: state === 'error' ? 'Error' : state === 'disconnected' ? 'Not connected' : NAMES[id], level: 'none' }];
    const note = state === 'error' ? 'Could not read usage. Check sign-in or network.'
      : state === 'disconnected' ? SETUP_NOTES[id]
        : stale ? 'Showing the last reading.' : '';
    return {
      id, name: NAMES[id], label, state, setup: p.setupAction || null, ring, pill,
      card: {
        plan: planText(p.planType),
        account: stale ? agoText(p.updatedAt, now) : state === 'live' ? 'Current account' : '',
        note, balance, rows, tokens: TOKEN_SOURCES.includes(id),
      },
    };
  });
}

/** 950, 1.2K, 123K, 1.2M, 31M, 2.5B: one decimal below ten, none above. */
function compact(n) {
  const value = Number.isFinite(n) ? Math.max(0, n) : 0;
  for (const [size, unit] of [[1e9, 'B'], [1e6, 'M'], [1e3, 'K']]) {
    if (value >= size) {
      const scaled = value / size;
      return `${scaled >= 10 ? Math.round(scaled) : Math.round(scaled * 10) / 10}${unit}`;
    }
  }
  return String(Math.round(value));
}

// The renderer only formats what it is given, so the texts for the `#` mode are made here.
function buildHudTokens(ledger) {
  const out = {};
  for (const id of TOKEN_SOURCES) {
    const series = ledger?.[id];
    if (!series) continue;
    const lastHour = (series.buckets || []).slice(-4).reduce((sum, n) => sum + n, 0);
    out[id] = {
      ...series,
      models: (series.models || []).map(model => ({ ...model, name: model.name || modelName(model.id) })),
      perHour: `${compact(lastHour)}/h`,
      perDay: `${compact(series.total)} / day`,
      totalText: `${compact(series.total)} tok`,
    };
  }
  return out;
}

module.exports = { HUD_ORDER, buildHudItems, buildHudTokens, compact, levelFor, resetText };
