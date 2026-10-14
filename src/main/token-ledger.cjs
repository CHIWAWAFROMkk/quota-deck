const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const QUARTER = 15 * 60000;
const BUCKETS = 96;
const CHUNK = 4 * 1024 * 1024;
const MAX_LINE = 1024 * 1024;
const MAX_DEPTH = 5;

/** Start of the oldest of 96 local quarter-hour buckets; the newest one contains `now`. */
function windowStart(now) {
  const d = new Date(now);
  d.setSeconds(0, 0);
  d.setMinutes(d.getMinutes() - (d.getMinutes() % 15));
  return d.getTime() - (BUCKETS - 1) * QUARTER;
}

const count = (usage, key) => (Number.isFinite(usage[key]) && usage[key] > 0 ? usage[key] : 0);

// One assistant message can span several lines; the caller keeps the last one per id.
function parseClaudeLine(line) {
  if (!line.includes('"usage"')) return null;
  let row;
  try { row = JSON.parse(line); } catch { return null; }
  const usage = row?.message?.usage;
  const id = row?.message?.id;
  const at = Date.parse(row?.timestamp);
  if (row?.type !== 'assistant' || typeof id !== 'string' || !usage || typeof usage !== 'object' || !Number.isFinite(at)) return null;
  return { id, at, tokens: count(usage, 'input_tokens') + count(usage, 'output_tokens') + count(usage, 'cache_creation_input_tokens') + count(usage, 'cache_read_input_tokens') };
}

function parseCodexLine(line) {
  if (!line.includes('"token_count"')) return null;
  let row;
  try { row = JSON.parse(line); } catch { return null; }
  const total = row?.payload?.info?.total_token_usage?.total_tokens;
  const at = Date.parse(row?.timestamp);
  if (row?.type !== 'event_msg' || row?.payload?.type !== 'token_count' || !Number.isFinite(total) || total < 0 || !Number.isFinite(at)) return null;
  return { at, total };
}

async function listRecentJsonl(root, since, fileSystem) {
  const found = [];
  async function walk(dir, depth) {
    let entries;
    try { entries = await fileSystem.readdir(dir, { withFileTypes: true }); }
    catch (error) { if (depth === 0) throw error; return; }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) { if (depth < MAX_DEPTH) await walk(full, depth + 1); continue; }
      if (!entry.isFile() || !entry.name.endsWith('.jsonl')) continue;
      try {
        const stat = await fileSystem.stat(full);
        if (stat.mtimeMs >= since) found.push({ file: full, stat });
      } catch { /* deleted between readdir and stat */ }
    }
  }
  await walk(root, 0);
  return found;
}

// Reads complete lines after state.offset; a trailing partial line waits for the next read.
async function readLines(file, state, size, fileSystem, onLine) {
  if (size <= state.offset) return;
  const handle = await fileSystem.open(file, 'r');
  try {
    let position = state.offset;
    let carry = Buffer.alloc(0);
    while (position < size) {
      const chunk = Buffer.alloc(Math.min(CHUNK, size - position));
      const { bytesRead } = await handle.read(chunk, 0, chunk.length, position);
      if (!bytesRead) break;
      position += bytesRead;
      const data = carry.length ? Buffer.concat([carry, chunk.subarray(0, bytesRead)]) : chunk.subarray(0, bytesRead);
      let start = 0;
      for (let end = data.indexOf(0x0a); end >= 0; end = data.indexOf(0x0a, start)) {
        if (end - start <= MAX_LINE) onLine(data.toString('utf8', start, end));
        start = end + 1;
      }
      carry = Buffer.from(data.subarray(start));
    }
    state.offset = position - carry.length;
  } finally {
    await handle.close();
  }
}

const SOURCES = {
  claude: {
    fresh: () => ({ offset: 0, mtimeMs: 0, events: new Map() }),
    take(state, line) {
      const event = parseClaudeLine(line);
      if (event) state.events.set(event.id, event);
    },
    events: state => state.events.values(),
    prune(state, since) { for (const [id, event] of state.events) if (event.at < since) state.events.delete(id); },
  },
  codex: {
    fresh: () => ({ offset: 0, mtimeMs: 0, lastTotal: 0, events: [] }),
    take(state, line) {
      const event = parseCodexLine(line);
      if (!event) return;
      // A cumulative total going down starts a new segment counted from zero.
      const delta = event.total >= state.lastTotal ? event.total - state.lastTotal : event.total;
      state.lastTotal = event.total;
      if (delta > 0) state.events.push({ at: event.at, tokens: delta });
    },
    events: state => state.events,
    prune(state, since) { state.events = state.events.filter(event => event.at >= since); },
  },
};

function emptySeries(status, startAt) {
  return { status, buckets: new Array(BUCKETS).fill(0), total: 0, startAt, partial: false };
}

function createTokenLedger({
  claudeRoot = path.join(os.homedir(), '.claude', 'projects'),
  codexRoot = path.join(os.homedir(), '.codex', 'sessions'),
  fileSystem = fs,
  budgetMs = 2000,
  clock = Date.now,
} = {}) {
  const roots = { claude: claudeRoot, codex: codexRoot };
  const files = { claude: new Map(), codex: new Map() };
  let pending = null;

  async function readSource(id, startAt, deadline) {
    const source = SOURCES[id];
    const known = files[id];
    const series = emptySeries('ok', startAt);
    let recent;
    try { recent = await listRecentJsonl(roots[id], startAt, fileSystem); }
    catch (error) { return emptySeries(error?.code === 'ENOENT' ? 'unsupported' : 'error', startAt); }
    const alive = new Set();
    for (const { file, stat } of recent) {
      alive.add(file);
      if (clock() > deadline) { series.partial = true; continue; } // keep what earlier rounds parsed
      let state = known.get(file);
      if (!state || stat.size < state.offset || stat.mtimeMs < state.mtimeMs) {
        state = source.fresh();
        known.set(file, state);
      }
      try {
        await readLines(file, state, stat.size, fileSystem, line => source.take(state, line));
        state.mtimeMs = stat.mtimeMs;
        source.prune(state, startAt);
      } catch {
        known.delete(file); // reread from scratch next round rather than double count
        series.partial = true;
      }
    }
    for (const file of [...known.keys()]) if (!alive.has(file)) known.delete(file);
    const seen = new Set();
    for (const state of known.values()) {
      for (const event of source.events(state)) {
        if (event.id) { if (seen.has(event.id)) continue; seen.add(event.id); }
        const index = Math.floor((event.at - startAt) / QUARTER);
        if (index < 0 || index >= BUCKETS) continue;
        series.buckets[index] += event.tokens;
        series.total += event.tokens;
      }
    }
    return series;
  }

  async function read(now = clock()) {
    const startAt = windowStart(now);
    const deadline = clock() + budgetMs;
    return { claude: await readSource('claude', startAt, deadline), codex: await readSource('codex', startAt, deadline) };
  }

  return {
    read(now) {
      if (!pending) pending = read(now).finally(() => { pending = null; });
      return pending;
    },
  };
}

module.exports = { BUCKETS, QUARTER, createTokenLedger, parseClaudeLine, parseCodexLine, windowStart };
