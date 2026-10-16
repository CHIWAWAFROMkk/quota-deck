const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { parseClaudeLine, createCodexFileParser } = require('./session-parsers.cjs');

const CHUNK = 64 * 1024;

function createSessionWatcher({ tracker, onChange,
  claudeRoot = path.join(os.homedir(), '.claude', 'projects'),
  codexRoot = path.join(os.homedir(), '.codex', 'sessions'),
  fileSystem = fs, clock = Date.now, pollMs = 1500, scanMs = 60000,
  activeWindowMs = 1800000, tailBytes = 262144,
}) {
  const files = new Map();
  let lastSnapshot = null;
  let tickPending = null;
  let scanPending = null;
  let queue = Promise.resolve();
  let generation = 0;
  let started = false;
  let starting = null;
  let pollTimer = null;
  let scanTimer = null;
  const active = stat => clock() - stat.mtimeMs <= activeWindowMs;
  const enqueue = work => {
    const pending = queue.then(work);
    queue = pending.catch(() => {});
    return pending;
  };

  async function walk(dir, vendor, depth = 0) {
    let entries;
    try { entries = await fileSystem.readdir(dir, { withFileTypes: true }); }
    catch { return; }
    for (const entry of entries) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (vendor === 'claude' && depth < 2) await walk(file, vendor, depth + 1);
        if (vendor === 'codex' && depth < 3 && (depth === 0 ? /^\d{4}$/ : /^\d{2}$/).test(entry.name)) await walk(file, vendor, depth + 1);
      } else if (entry.isFile() && entry.name.endsWith('.jsonl') && (vendor === 'claude' || depth === 3)) {
        try {
          const stat = await fileSystem.stat(file);
          if (active(stat) && !files.has(file)) files.set(file, { vendor, offset: null, size: 0, carry: Buffer.alloc(0), discard: false, parse: null });
        } catch { /* a file can disappear while its directory is scanned */ }
      }
    }
  }

  function rescan() {
    if (!scanPending) scanPending = enqueue(async () => {
      await walk(claudeRoot, 'claude');
      await walk(codexRoot, 'codex');
    }).finally(() => { scanPending = null; });
    return scanPending;
  }

  // session_meta lives at the head, usually outside a large rollout's tail.
  // Read only that first record, not the intervening conversation history.
  async function seedCodex(handle, size, parse) {
    let position = 0;
    let carry = Buffer.alloc(0);
    while (position < size) {
      const chunk = Buffer.alloc(Math.min(CHUNK, size - position));
      const { bytesRead } = await handle.read(chunk, 0, chunk.length, position);
      if (!bytesRead) return;
      position += bytesRead;
      const data = Buffer.concat([carry, chunk.subarray(0, bytesRead)]);
      const end = data.indexOf(10);
      if (end >= 0) {
        for (const event of parse(data.toString('utf8', 0, end))) if (event.kind === 'meta') tracker.ingest('codex', event);
        return;
      }
      carry = data;
    }
  }

  async function readFile(file, state, stat) {
    if (stat.size < state.size) state.offset = null;
    state.size = stat.size;
    if (state.offset !== null && stat.size <= state.offset) return;
    const handle = await fileSystem.open(file, 'r');
    try {
      if (state.offset === null) {
        const from = Math.max(0, stat.size - tailBytes);
        const parse = state.vendor === 'claude' ? parseClaudeLine : createCodexFileParser().parse;
        if (state.vendor === 'codex' && from > 0) await seedCodex(handle, stat.size, parse);
        Object.assign(state, { offset: from, carry: Buffer.alloc(0), discard: from > 0, parse });
      }
      while (state.offset < stat.size) {
        const chunk = Buffer.alloc(Math.min(CHUNK, stat.size - state.offset));
        const { bytesRead } = await handle.read(chunk, 0, chunk.length, state.offset);
        if (!bytesRead) break;
        // Keep bytes until the newline, so a UTF-8 character split over polls
        // is decoded once, only after its complete record has arrived.
        const data = Buffer.concat([state.carry, chunk.subarray(0, bytesRead)]);
        let from = 0;
        for (let end = data.indexOf(10); end >= 0; end = data.indexOf(10, from)) {
          if (state.discard) state.discard = false;
          else for (const event of state.parse(data.toString('utf8', from, end))) tracker.ingest(state.vendor, event);
          from = end + 1;
        }
        state.carry = Buffer.from(data.subarray(from));
        state.offset += bytesRead;
      }
    } finally { await handle.close(); }
  }

  function tick() {
    if (!tickPending) {
      const current = generation;
      tickPending = enqueue(async () => {
        for (const [file, state] of files) {
          if (current !== generation) return;
          try {
            const stat = await fileSystem.stat(file);
            if (!active(stat)) { files.delete(file); continue; }
            await readFile(file, state, stat);
          } catch { /* leave its offset in place and retry next poll */ }
        }
        if (current !== generation) return;
        const snapshot = tracker.snapshot(clock());
        const serialized = JSON.stringify(snapshot);
        if (serialized !== lastSnapshot) { onChange(snapshot); lastSnapshot = serialized; }
      }).finally(() => { tickPending = null; });
    }
    return tickPending;
  }

  function start() {
    if (started) return starting || Promise.resolve();
    started = true;
    const current = ++generation;
    starting = (async () => {
      await rescan();
      if (!started || current !== generation) return;
      await tick();
      if (!started || current !== generation) return;
      pollTimer = setInterval(() => { tick().catch(() => {}); }, pollMs);
      scanTimer = setInterval(() => { rescan().catch(() => {}); }, scanMs);
    })().finally(() => { if (current === generation) starting = null; });
    return starting;
  }

  function stop() {
    started = false;
    starting = null;
    generation++;
    clearInterval(pollTimer);
    clearInterval(scanTimer);
    pollTimer = scanTimer = null;
  }

  return { start, stop, tick, rescan };
}

module.exports = { createSessionWatcher };
