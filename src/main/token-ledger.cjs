const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { modelName } = require('./model-names.cjs');
const MAX_MODELS = 6;

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
  const model = typeof row.message.model === 'string' && row.message.model ? row.message.model : 'unknown';
  return { id, at, model, tokens: count(usage, 'input_tokens') + count(usage, 'output_tokens') + count(usage, 'cache_creation_input_tokens') + count(usage, 'cache_read_input_tokens') };
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

// Codex names the model once per turn; the token counts that follow belong to it.
function parseCodexContext(line) {
  if (!line.includes('"turn_context"')) return null;
  let row;
  try { row = JSON.parse(line); } catch { return null; }
  const model = row?.payload?.model;
  return row?.type === 'turn_context' && typeof model === 'string' && model ? model : null;
}

// Usage of a streamed message only grows, so the fullest copy is its final usage, in any file order.
function keepFullest(map, event) {
  const known = map.get(event.id);
  if (!known || event.tokens >= known.tokens) map.set(event.id, event);
}

// Reads complete lines from `from`; a trailing partial line waits for the next read.
// Stops between chunks once the round is late; `done` says whether it reached `size`,
// `shrunk` that the file ended before `size` (it was rewritten since that size was seen).
async function readLines(file, from, size, fileSystem, onLine, { chunkSize, isLate }) {
  if (size <= from) return { offset: from, done: true, shrunk: false };
  const handle = await fileSystem.open(file, 'r');
  try {
    let position = from;
    let carry = Buffer.alloc(0);
    let shrunk = false;
    while (position < size) {
      const chunk = Buffer.alloc(Math.min(chunkSize, size - position));
      const { bytesRead } = await handle.read(chunk, 0, chunk.length, position);
      if (!bytesRead) { shrunk = true; break; }
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
    return { offset: position - carry.length, done: position >= size, shrunk };
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
    fresh: () => ({ offset: 0, size: 0, mtimeMs: 0, lastTotal: 0, model: null, events: [] }),
    stage: state => ({ lastTotal: state.lastTotal, model: state.model, events: [] }),
    take(stage, line) {
      const model = parseCodexContext(line);
      if (model) { stage.model = model; return; }
      const event = parseCodexLine(line);
      if (!event) return;
      // A cumulative total going down starts a new segment counted from zero.
      const delta = event.total >= stage.lastTotal ? event.total - stage.lastTotal : event.total;
      stage.lastTotal = event.total;
      if (delta > 0) stage.events.push({ at: event.at, tokens: delta, model: stage.model || 'unknown' });
    },
    commit(state, stage) {
      state.lastTotal = stage.lastTotal;
      state.model = stage.model;
      state.events = state.events.concat(stage.events);
    },
    events: state => state.events,
    prune(state, since) { state.events = state.events.filter(event => event.at >= since); },
  },
};

function emptySeries(status, startAt) {
  return { status, buckets: new Array(BUCKETS).fill(0), total: 0, startAt, partial: false, models: [], stacks: Array.from({ length: BUCKETS }, () => []) };
}

// A file needs reading when it is new, changed since its last complete read, or was only partly read.
function needsRead(state, stat) {
  return !state || !state.done || stat.size !== state.size || stat.mtimeMs !== state.mtimeMs;
}

function createTokenLedger({
  claudeRoot = path.join(os.homedir(), '.claude', 'projects'),
  codexRoot = path.join(os.homedir(), '.codex', 'sessions'),
  fileSystem = fs,
  budgetMs = 2000,
  chunkSize = CHUNK,
  clock = Date.now,
} = {}) {
  // Per source: parsed files, files waiting to be read, and a directory scan that may span several rounds.
  const sources = {
    claude: { root: claudeRoot, known: new Map(), pending: new Map(), scan: null, status: 'ok' },
    codex: { root: codexRoot, known: new Map(), pending: new Map(), scan: null, status: 'ok' },
  };
  let pending = null;

  // Continue the current scan pass until late. Returns true when the pass reached its end,
  // so files missing from it can be forgotten; the next round then starts a new pass.
  async function scanStep(src, since, isLate) {
    if (!src.scan) src.scan = { queue: [{ dir: src.root, depth: 0 }], seen: new Set() };
    const scan = src.scan;
    while (scan.queue.length) {
      if (isLate()) return false;
      const item = scan.queue.shift();
      if (item.dir) {
        let entries;
        try { entries = await fileSystem.readdir(item.dir, { withFileTypes: true }); }
        catch (error) { if (item.depth === 0) { src.scan = null; throw error; } continue; }
        const next = [];
        for (const entry of entries) {
          const full = path.join(item.dir, entry.name);
          if (entry.isDirectory()) { if (item.depth < MAX_DEPTH) next.push({ dir: full, depth: item.depth + 1 }); }
          else if (entry.isFile() && entry.name.endsWith('.jsonl')) next.push({ file: full });
        }
        scan.queue.unshift(...next);
        continue;
      }
      let stat;
      try { stat = await fileSystem.stat(item.file); } catch { continue; } // deleted since readdir
      if (stat.mtimeMs < since) continue;
      scan.seen.add(item.file);
      if (needsRead(src.known.get(item.file), stat)) src.pending.set(item.file, stat);
    }
    for (const file of [...src.known.keys()]) if (!scan.seen.has(file)) src.known.delete(file);
    for (const file of [...src.pending.keys()]) if (!scan.seen.has(file)) src.pending.delete(file);
    src.scan = null;
    return true;
  }

  // Read waiting files, oldest first. Past the deadline one file per round is still read,
  // so a slow disk cannot stall the count forever.
  async function readPending(source, src, startAt, isLate, round) {
    for (const [file, stat] of [...src.pending]) {
      if (isLate() && round.progressed) return;
      round.progressed = true;
      const previous = src.known.get(file);
      // A file smaller than last time or than what was read (even with a trailing partial line), or older, was rewritten.
      const continues = previous && stat.size >= previous.size && stat.size >= previous.offset && stat.mtimeMs >= previous.mtimeMs;
      const state = continues ? previous : source.fresh();
      const stage = source.stage(state);
      try {
        const { offset, done, shrunk } = await readLines(file, state.offset, stat.size, fileSystem, line => source.take(stage, line), { chunkSize, isLate });
        if (shrunk) {
          // Rewritten since it was queued: drop it; the scan finds it again with its new size.
          src.known.delete(file);
          src.pending.delete(file);
          continue;
        }
        source.commit(state, stage);
        state.offset = offset;
        // Record the size seen even after a partial read, so a later truncation is still noticed.
        state.size = stat.size;
        state.mtimeMs = stat.mtimeMs;
        state.done = done;
        source.prune(state, startAt);
        src.known.set(file, state);
        if (done) src.pending.delete(file);
      } catch {
        // The last good state stays and the file stays pending for the next round.
      }
    }
  }

  async function readSource(id, startAt, deadline) {
    const source = SOURCES[id];
    const src = sources[id];
    const isLate = () => clock() > deadline;
    const round = { progressed: false };
    await readPending(source, src, startAt, isLate, round);
    let complete;
    try { complete = await scanStep(src, startAt, isLate); }
    catch (error) {
      if (error?.code === 'ENOENT') {
        src.known.clear();
        src.pending.clear();
        src.status = 'unsupported';
        return emptySeries('unsupported', startAt);
      }
      return emptySeries('error', startAt); // keep what is known for the next round
    }
    if (complete) src.status = 'ok';
    await readPending(source, src, startAt, isLate, round);
    const series = emptySeries(src.status, startAt);
    series.partial = !complete || src.pending.size > 0;
    const merged = new Map();
    const plain = [];
    for (const state of src.known.values()) {
      for (const event of source.events(state)) {
        if (event.id) keepFullest(merged, event);
        else plain.push(event);
      }
    }
    const events = [...merged.values(), ...plain].filter(event => event.at >= startAt && event.at < startAt + BUCKETS * QUARTER);
    const totals = new Map();
    for (const event of events) {
      series.buckets[Math.floor((event.at - startAt) / QUARTER)] += event.tokens;
      series.total += event.tokens;
      totals.set(event.model, (totals.get(event.model) || 0) + event.tokens);
    }
    const ranked = [...totals].sort((a, b) => b[1] - a[1]);
    const slot = new Map(ranked.slice(0, MAX_MODELS).map(([id], i) => [id, i]));
    series.models = ranked.slice(0, MAX_MODELS).map(([id, total]) => ({ id, name: modelName(id), total }));
    if (ranked.length > MAX_MODELS) series.models.push({ id: 'other', name: 'Other', total: ranked.slice(MAX_MODELS).reduce((sum, [, n]) => sum + n, 0) });
    series.stacks = Array.from({ length: BUCKETS }, () => new Array(series.models.length).fill(0));
    for (const event of events) {
      const m = slot.has(event.model) ? slot.get(event.model) : series.models.length - 1;
      series.stacks[Math.floor((event.at - startAt) / QUARTER)][m] += event.tokens;
    }
    return series;
  }

  // Each source gets half the budget, so one slow source cannot starve the other.
  async function read(now = clock()) {
    const startAt = windowStart(now);
    const share = budgetMs / 2;
    const claude = await readSource('claude', startAt, clock() + share);
    const codex = await readSource('codex', startAt, clock() + share);
    return { claude, codex };
  }

  return {
    read(now) {
      if (!pending) pending = read(now).finally(() => { pending = null; });
      return pending;
    },
  };
}

module.exports = { BUCKETS, QUARTER, createTokenLedger, parseClaudeLine, parseCodexContext, parseCodexLine, windowStart };
