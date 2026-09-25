const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const queues = new Map();
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

// Persist only quota counters, never raw provider responses or credentials.
function createHistory(filePath, { fileSystem = fs, sleep = delay } = {}) {
  filePath = path.resolve(filePath);
  const queueKey = process.platform === 'win32' ? filePath.toLowerCase() : filePath;
  let rows = [];
  const sessionScope = randomUUID();
  async function record(snapshot, now = Date.now()) {
    if (!Number.isFinite(now) || !Number.isFinite(new Date(now).getTime())) throw new TypeError('History sample time must be finite');
    if (!snapshot || typeof snapshot !== 'object') throw new TypeError('History snapshot must be an object');
    const observedAt = typeof snapshot.updatedAt === 'string' ? Date.parse(snapshot.updatedAt) : NaN;
    // Re-reading a statusLine file is not a new provider observation.
    if (Number.isFinite(observedAt) && observedAt <= now) now = observedAt;
    // The path-level queue protects all instances in this process. Reload under
    // that queue, otherwise one instance can overwrite another's newer rows.
    {
      try {
        if ((await fileSystem.stat(filePath)).size > 4194304) throw new Error('History exceeds size limit');
        const data = JSON.parse(await fileSystem.readFile(filePath, 'utf8'));
        rows = [];
        if (Array.isArray(data)) rows = data.filter(r => r && typeof r.key === 'string' && Number.isFinite(r.at)
          && r.key.length <= 2000 && Number.isFinite(r.value) && r.value >= 0 && r.value <= 1).sort((a, b) => a.at - b.at).slice(-5000);
      } catch (error) {
        if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error;
        rows = []; // Missing or damaged JSON starts a new sampling series.
      }
    }
    rows = rows.filter(r => r.at >= now - 24 * 3600000 && r.at <= now).slice(-5000);
    for (const group of Array.isArray(snapshot.groups) ? snapshot.groups : []) {
      for (const bucket of Array.isArray(group?.buckets) ? group.buckets : []) {
        if (!bucket || typeof bucket !== 'object') continue;
        bucket.burnPerHour = null;
        bucket.estimatedHoursLeft = null;
        if (['stale', 'error', 'disconnected', 'unsupported'].includes(snapshot.status)) continue;
        const value = bucket.remainingFraction;
        const resetAt = Date.parse(bucket.resetTime);
        if (!Number.isFinite(resetAt) || resetAt <= now || typeof bucket.bucketId !== 'string' || !bucket.bucketId || bucket.bucketId.length > 200) continue;
        // Only an explicit, caller-verified account scope may reconnect persisted samples.
        // Hash it to avoid writing account identifiers; unknown accounts stay session-local.
        const explicitScope = typeof snapshot.historyScope === 'string' && snapshot.historyScope.trim();
        const scope = explicitScope
          ? createHash('sha256').update(explicitScope).digest('hex') : sessionScope;
        const key = JSON.stringify([scope, snapshot.id, group.displayName, bucket.bucketId, new Date(resetAt).toISOString()]);
        if (!Number.isFinite(value) || value < 0 || value > 1) { rows = rows.filter(r => r.key !== key); continue; }
        let series = rows.filter(r => r.key === key && r.at >= now - 3600000);
        const last = series.at(-1);
        // Reset, quota top-up, long offline gaps and clock rollback break the estimate.
        if (last && now === last.at && value === last.value) continue;
        if (last && (now - last.at > 600000 || value > last.value || now <= last.at)) series = [];
        const first = series[0];
        if (first && series.length >= 2 && now - first.at >= 300000) {
          bucket.burnPerHour = (first.value - value) * 100 / ((now - first.at) / 3600000);
          const hours = bucket.burnPerHour > 0 ? value * 100 / bucket.burnPerHour : null;
          const untilReset = (Date.parse(bucket.resetTime) - now) / 3600000;
          if (hours !== null && hours < untilReset) bucket.estimatedHoursLeft = hours;
        }
        if (!series.length) rows = rows.filter(r => r.key !== key);
        if (!last || now - last.at >= 15000 || !series.length) rows.push({ key, at: now, value });
      }
    }
    rows = rows.slice(-5000);
    await fileSystem.mkdir(path.dirname(filePath), { recursive: true });
    const temporary = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
    await fileSystem.writeFile(temporary, JSON.stringify(rows), 'utf8');
    for (let attempt = 0; ; attempt++) {
      try { await fileSystem.rename(temporary, filePath); break; }
      catch (error) {
        if (!['EPERM', 'EBUSY'].includes(error.code) || attempt >= 3) throw error;
        await sleep(20 * (2 ** attempt));
      }
    }
    return snapshot;
  }
  return { record(snapshot, now) {
    const task = (queues.get(queueKey) || Promise.resolve()).then(() => record(snapshot, now));
    const settled = task.catch(() => {});
    queues.set(queueKey, settled);
    void settled.then(() => { if (queues.get(queueKey) === settled) queues.delete(queueKey); });
    return task;
  } };
}

module.exports = { createHistory };
