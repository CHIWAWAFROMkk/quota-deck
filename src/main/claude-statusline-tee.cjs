// Claude Code statusLine entry point installed by QuotaDeck.
// 1. Saves the whitelisted quota fields for QuotaDeck.
// 2. Hands the identical stdin to the user's previous statusline and passes its output through.
// A failure in step 1 never hides the user's statusline.
const { spawn } = require('node:child_process');
const { readInput, writeSnapshot } = require('./claude-statusline-bridge.cjs');
const { readChain } = require('./claude-statusline-chain.cjs');

const DOWNSTREAM_TIMEOUT_MS = 10000;

function runDownstream(chain, input) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(chain.downstream, { shell: chain.shell || true, stdio: ['pipe', 'inherit', 'inherit'], windowsHide: true });
    } catch { resolve(1); return; }
    const timer = setTimeout(() => child.kill(), DOWNSTREAM_TIMEOUT_MS);
    child.on('error', () => { clearTimeout(timer); resolve(1); });
    child.on('close', (code) => { clearTimeout(timer); resolve(code ?? 1); });
    child.stdin.on('error', () => {});
    child.stdin.end(input);
  });
}

// Shown only when there was no statusline before QuotaDeck connected.
function fallbackLine(snapshot) {
  const limits = snapshot?.rate_limits || {};
  const part = (id, label) => Number.isFinite(limits[id]?.used_percentage) ? `${label} 剩 ${Math.max(0, 100 - limits[id].used_percentage).toFixed(0)}%` : null;
  const parts = [part('five_hour', '5 小时'), part('seven_day', '每周')].filter(Boolean);
  return parts.length ? `Claude 额度 · ${parts.join(' · ')}` : 'Claude 额度 · 等待首个回复';
}

async function main() {
  let input;
  try { input = await readInput(process.stdin); } catch { process.exitCode = 1; return; }
  const saving = writeSnapshot(input).catch(() => null);
  const chain = readChain();
  if (chain?.downstream) {
    const code = await runDownstream(chain, input);
    await saving;
    process.exitCode = code;
    return;
  }
  process.stdout.write(fallbackLine(await saving));
}

if (require.main === module) main();
module.exports = { fallbackLine, runDownstream };
