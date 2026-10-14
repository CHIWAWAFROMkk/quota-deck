const HUD_ORDER = ['codex', 'claude', 'antigravity', 'deepseek', 'workbuddy'];
const NAMES = { codex: 'Codex', claude: 'Claude Code', antigravity: 'Antigravity', deepseek: 'DeepSeek', workbuddy: 'WorkBuddy' };
const TOKEN_SOURCES = ['claude', 'codex'];
const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
const pad = n => String(n).padStart(2, '0');

function levelFor(usedPct) {
  if (!Number.isFinite(usedPct)) return 'none';
  return usedPct >= 90 ? 'high' : usedPct >= 70 ? 'warn' : 'ok';
}

const usedOf = remaining => (Number.isFinite(remaining) ? Math.round(100 - Math.max(0, Math.min(100, remaining))) : null);

function shortLabel(label) {
  const text = String(label || '');
  if (text === '5 小时') return '5h';
  if (text === '每周') return '周';
  const named = /^每周 · (.+)$/.exec(text);
  return named ? named[1] : text;
}

function resetText(iso, now) {
  const at = typeof iso === 'string' ? Date.parse(iso) : NaN;
  if (!Number.isFinite(at)) return '重置时间未知';
  if (at <= now) return '待重置';
  const d = new Date(at);
  const hm = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  return at - now < 86_400_000 ? `${hm} 重置` : `${WEEKDAYS[d.getDay()]} ${hm} 重置`;
}

const burnText = burn => (Number.isFinite(burn) ? `${Math.max(0, burn).toFixed(1)}%/h` : '采样中');

// Pools carry per-pool windows (Claude, Antigravity); otherwise use the gauge's windows (Codex).
function windowRows(provider, now) {
  const pools = (provider.pools || []).filter(pool => pool.windows?.length);
  const windows = pools.length
    ? pools.flatMap(pool => pool.windows.map(w => ({ ...w, pool: pools.length > 1 ? pool.name : '' })))
    : (provider.gauge?.windows || []).map(w => ({ ...w, pool: '' }));
  return windows.map(w => {
    const usedPct = usedOf(w.remainingPercent);
    return {
      label: w.pool ? `${w.pool} · ${w.label}` : w.label,
      short: w.pool ? `${w.pool} ${shortLabel(w.label)}` : shortLabel(w.label),
      usedPct,
      level: levelFor(usedPct),
      reset: resetText(w.resetsAt, now),
      burn: burnText(w.burnPerHour),
    };
  });
}

function placeholder(id) {
  return {
    id, name: NAMES[id], logo: `${id}.svg`,
    ring: { usedPct: null, level: 'none', dashed: false },
    label: '–',
    pill: [{ name: '', text: '未读取', level: 'none' }],
    card: { plan: '', freshness: '', note: '还没有读取到这个服务商的数据。', stale: false, balance: null, rows: [], tokens: TOKEN_SOURCES.includes(id) },
  };
}

function buildHudItems(ui, now = Date.now()) {
  const providers = new Map((ui?.providers || []).map(provider => [provider.id, provider]));
  return HUD_ORDER.map(id => {
    const p = providers.get(id);
    if (!p) return placeholder(id);
    const gauge = p.gauge || { kind: 'unknown', provenance: 'unknown' };
    const stale = gauge.provenance === 'stale';
    const rows = windowRows(p, now);
    let ring = { usedPct: null, level: 'none', dashed: false };
    let label = '–';
    let balance = null;
    if (gauge.kind === 'window' || gauge.kind === 'ratio') {
      const usedPct = usedOf(gauge.remainingPercent);
      ring = { usedPct, level: levelFor(usedPct), dashed: stale };
      if (usedPct !== null) label = `${usedPct}%`;
    } else if (gauge.kind === 'balance') {
      balance = String(p.quotaHero || '').replace(/\s+/g, '') || null;
      ring = { usedPct: null, level: p.status === 'critical' ? 'high' : 'ok', dashed: stale };
      label = balance || '–';
    }
    const pill = rows.length
      ? rows.map(row => ({ name: row.short, text: row.usedPct === null ? '–' : `${row.usedPct}%`, level: row.level }))
      : [{ name: '', text: balance ? `余额 ${balance}` : gauge.kind === 'ratio' ? `已用 ${label}` : (p.statusText || '未知'), level: ring.level }];
    const note = gauge.kind === 'unknown' ? (p.quotaSub || p.statusText || '') : stale ? '旧数据，不代表当前额度。' : '';
    return {
      id, name: p.name || NAMES[id], logo: `${id}.svg`, ring, label, pill,
      card: { plan: p.plan || '', freshness: p.freshness || '', note, stale, balance, rows, tokens: TOKEN_SOURCES.includes(id) },
    };
  });
}

module.exports = { HUD_ORDER, buildHudItems, levelFor, resetText };
