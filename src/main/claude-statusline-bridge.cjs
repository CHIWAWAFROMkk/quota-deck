const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { sanitizeClaudePayload, defaultClaudeSnapshotPath } = require('./claude-client.cjs');

const INPUT_LIMIT = 1048576;

async function readInput(stream = process.stdin, { timeoutMs = 4000 } = {}) {
  const chunks = [];
  let bytes = 0;
  const timer = setTimeout(() => stream.destroy(new Error('statusLine input timed out')), timeoutMs);
  try {
    for await (const chunk of stream) {
      bytes += Buffer.byteLength(chunk);
      if (bytes > INPUT_LIMIT) throw new Error('statusLine input exceeds limit');
      chunks.push(Buffer.from(chunk));
    }
  } finally { clearTimeout(timer); }
  return Buffer.concat(chunks);
}

// Persist only the whitelisted quota fields; the raw payload holds private paths.
async function writeSnapshot(input, target = process.env.QUOTADECK_CLAUDE_SNAPSHOT || defaultClaudeSnapshotPath()) {
  const snapshot = sanitizeClaudePayload(JSON.parse(Buffer.from(input).toString('utf8')));
  await fs.mkdir(path.dirname(target), { recursive: true });
  const temporary = `${target}.${process.pid}.${randomUUID()}.tmp`;
  await fs.writeFile(temporary, JSON.stringify(snapshot), { encoding: 'utf8', mode: 0o600 });
  await fs.rename(temporary, target);
  return snapshot;
}

async function capture(stream = process.stdin, target, options) {
  return writeSnapshot(await readInput(stream, options), target);
}

if (require.main === module) {
  const timeout = setTimeout(() => process.exit(1), 4000);
  capture().then(() => clearTimeout(timeout)).catch(() => { clearTimeout(timeout); process.exitCode = 1; });
}
module.exports = { capture, readInput, writeSnapshot };
