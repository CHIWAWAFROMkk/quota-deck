const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const QUARTER = 15 * 60000;
const BUCKETS = 96;
const CHUNK = 4 * 1024 * 1024;
const MAX_LINE = 1024 * 1024;
const MAX_DEPTH = 5;

/** Start of the oldest of 96 quarter-hour buckets; the newest one contains `now`. */
function windowStart(now) {
  // Every real UTC offset is a multiple of 15 minutes, so epoch quarters are also local quarters,
  // and epoch arithmetic keeps the two 01:xx hours apart when clocks fall back.
  return Math.floor(now / QUARTER) * QUARTER - (BUCKETS - 1) * QUARTER;
}

const count = (usage, key) => (Number.isFinite(usage[key]) && usage[key] > 0 ? usage[key] : 0);

// One assistant message can span several lines and be copied into resumed sessions.
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

// Usage of a streamed message only grows, so the fullest copy is its final usage, in any file order.
function keepFullest(map, event) {
  const known = map.get(event.id);
  if (!known || event.tokens >= known.tokens) map.set(event.id, event);
}

async function listRecentJsonl(root, since, fileSystem, isLate) {
  const found = [];
  let complete = true;
  async function walk(dir, depth) {
    if (isLate()) { complete = false; return; }
    let entries;
    try { entries = await fileSystem.readdir(dir, { withFileTypes: true }); }
    catch (error) { if (depth === 0) throw error; return; }
    for (const entry of entries) {
      if (!complete) return;
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
  return { found, complete };
}

// Reads complete lines from `from`; a trailing partial line waits for the next read.
// Stops between chunks once the round is late; `done` says whether it reached `size`.
async function readLines(file, from, size, fileSystem, onLine, { chunkSize, isLate }) {
  if (size <= from) return { offset: from, done: true };
  const handle = await fileSystem.open(file, 'r');
  try {
    let position = from;
    let carry = Buffer.alloc(0);
    while (position < size) {
      const chunk = Buffer.alloc(Math.min(chunkSize, size - position));
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
      if (position < size && isLate()) break;
    }
    return { offset: position - carry.length, done: position >= size };
  } finally {
    await handle.close();
  }
}

// Lines are parsed into a stage and only committed once the read succeeds,
// so a failed read leaves the previous round's counts untouched.
const SOURCES = {
  claude: {
    fresh: () => ({ offset: 0, size: 0, mtimeMs: 0, events: new Map() }),
    stage: () => ({ events: new Map() }),
    take(stage, line) {
      const event = parseClaudeLine(line);
      if (event) keepFullest(stage.events, event);
    },
    commit(state, stage) { for (const event of stage.events.values()) keepFullest(state.events, event); },
    events: state => state.events.values(),
    prune(state, since) { for (const [id, event] of state.events) if (event.at < since) state.events.delete(id); },
  },
  codex: {
    fresh: () => ({ offset: 0, size: 0, mtimeMs: 0, lastTotal: 0, events: [] }),
    stage: state => ({ lastTotal: state.lastTotal, events: [] }),
    take(stage, line) {
      const event = parseCodexLine(line);
      if (!event) return;
      // A cumulative total going down starts a new segment counted from zero.
      const delta = event.total >= stage.lastTotal ? event.total - stage.lastTotal : event.total;
      stage.lastTotal = event.total;
      if (delta > 0) stage.events.push({ at: event.at, tokens: delta });
    },
    commit(state, stage) {
      state.lastTotal = stage.lastTotal;
      state.events = state.events.concat(stage.events);
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
  chunkSize = CHUNK,
  clock = Date.now,
} = {}) {
  const roots = { claude: claudeRoot, codex: codexRoot };
  const files = { claude: new Map(), codex: new Map() };
  const statuses = { claude: 'ok', codex: 'ok' };
  let pending = null;

  async function readSource(id, startAt, isLate) {
    const source = SOURCES[id];
    const known = files[id];
    let scan;
    try { scan = await listRecentJsonl(roots[id], startAt, fileSystem, isLate); }
    catch (error) {
      if (error?.code === 'ENOENT') { known.clear(); statuses[id] = 'unsupported'; return emptySeries('unsupported', startAt); }
      return emptySeries('error', startAt); // keep what is known for the next round
    }
    if (scan.complete) statuses[id] = 'ok';
    let partial = !scan.complete;
    const alive = new Set();
    for (const { file, stat } of scan.found) {
      alive.add(file);
      if (isLate()) { partial = true; continue; } // keep what earlier rounds parsed
      const previous = known.get(file);
      // A file smaller than last time (even with a trailing partial line) or older was rewritten.
      const state = previous && stat.size >= previous.size && stat.mtimeMs >= previous.mtimeMs ? previous : source.fresh();
      const stage = source.stage(state);
      try {
        const { offset, done } = await readLines(file, state.offset, stat.size, fileSystem, line => source.take(stage, line), { chunkSize, isLate });
        source.commit(state, stage);
        state.offset = offset;
        if (done) { state.size = stat.size; state.mtimeMs = stat.mtimeMs; } else partial = true;
        source.prune(state, startAt);
        known.set(file, state);
      } catch {
        partial = true; // the last good state stays; the next round retries from its offset
      }
    }
    if (scan.complete) for (const file of [...known.keys()]) if (!alive.has(file)) known.delete(file);
    const series = emptySeries(statuses[id], startAt);
    series.partial = partial;
    const merged = new Map();
    const plain = [];
    for (const state of known.values()) {
      for (const event of source.events(state)) {
        if (event.id) keepFullest(merged, event);
        else plain.push(event);
      }
    }
    for (const event of [...merged.values(), ...plain]) {
      const index = Math.floor((event.at - startAt) / QUARTER);
      if (index < 0 || index >= BUCKETS) continue;
      series.buckets[index] += event.tokens;
      series.total += event.tokens;
    }
    return series;
  }

  async function read(now = clock()) {
    const startAt = windowStart(now);
    const deadline = clock() + budgetMs;
    const isLate = () => clock() > deadline;
    return { claude: await readSource('claude', startAt, isLate), codex: await readSource('codex', startAt, isLate) };
  }

  return {
    read(now) {
      if (!pending) pending = read(now).finally(() => { pending = null; });
      return pending;
    },
  };
}

module.exports = { BUCKETS, QUARTER, createTokenLedger, parseClaudeLine, parseCodexLine, windowStart };
