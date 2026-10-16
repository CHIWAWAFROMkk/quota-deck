const os = require('node:os');
const path = require('node:path');

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function windowLimits(window) {
  if (!isObject(window)) return null;
  return {
    usedPercent: window.used_percent,
    windowDurationMins: window.window_minutes,
    resetsAt: window.resets_at,
  };
}

function parseLimits(line) {
  let event;
  try {
    event = JSON.parse(line);
  } catch {
    return null;
  }
  if (event?.type !== 'event_msg' || event.payload?.type !== 'token_count') return null;
  const limits = event.payload.rate_limits;
  if (!isObject(limits) || (limits.limit_id !== undefined && limits.limit_id !== 'codex')) return null;
  const primary = windowLimits(limits.primary);
  const at = Date.parse(event.timestamp);
  if (!primary || !Number.isFinite(primary.usedPercent) || !Number.isFinite(at)) return null;
  return { at, planType: limits.plan_type ?? null, primary, secondary: windowLimits(limits.secondary) };
}

async function directoryEntries(directory, fileSystem) {
  try {
    return await fileSystem.readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

async function directories(directory, fileSystem) {
  const entries = await directoryEntries(directory, fileSystem);
  return entries.filter(entry => entry.isDirectory()).map(entry => entry.name).sort().reverse();
}

async function readTail(file, fileSystem, tailBytes) {
  const handle = await fileSystem.open(file, 'r');
  try {
    const { size } = await handle.stat();
    const start = Math.max(0, size - tailBytes);
    const buffer = Buffer.alloc(size - start);
    let total = 0;
    while (total < buffer.length) {
      const { bytesRead } = await handle.read(buffer, total, buffer.length - total, start + total);
      if (!bytesRead) break;
      total += bytesRead;
    }
    const lines = buffer.subarray(0, total).toString('utf8').split('\n');
    if (start > 0) lines.shift();
    for (let index = lines.length - 1; index >= 0; index--) {
      const limits = parseLimits(lines[index]);
      if (limits) return limits;
    }
    return null;
  } finally {
    await handle.close();
  }
}

async function readLatestCodexLimits({
  root = path.join(os.homedir(), '.codex', 'sessions'),
  fileSystem = require('node:fs/promises'),
  maxFiles = 12,
  tailBytes = 512 * 1024,
} = {}) {
  if (maxFiles <= 0) return null;
  let checked = 0;
  for (const year of await directories(root, fileSystem)) {
    const yearPath = path.join(root, year);
    for (const month of await directories(yearPath, fileSystem)) {
      const monthPath = path.join(yearPath, month);
      for (const day of await directories(monthPath, fileSystem)) {
        const dayPath = path.join(monthPath, day);
        const entries = await directoryEntries(dayPath, fileSystem);
        const files = await Promise.all(entries.filter(entry => entry.isFile() && entry.name.endsWith('.jsonl')).map(async entry => {
          const file = path.join(dayPath, entry.name);
          const { mtimeMs } = await fileSystem.stat(file);
          return { file, mtimeMs };
        }));
        files.sort((a, b) => b.mtimeMs - a.mtimeMs);
        for (const { file } of files) {
          const limits = await readTail(file, fileSystem, tailBytes);
          checked++;
          if (limits) return limits;
          if (checked >= maxFiles) return null;
        }
      }
    }
  }
  return null;
}

module.exports = { readLatestCodexLimits };
