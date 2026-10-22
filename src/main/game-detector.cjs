const path = require('node:path');
const { spawn } = require('node:child_process');
const { createInterface } = require('node:readline');
const { isGaming } = require('./game-rules.cjs');

function createGameDetector({ getGames, onChange, spawnProcess = spawn,
  script = path.join(__dirname, 'game-probe.ps1'), clock = Date.now }) {
  let started = false;
  let stopped = false;
  let current = null;
  let retry = null;
  let restarts = [];
  let gaming = null;

  function report(next, exe, force = false) {
    if (stopped || (!force && next === gaming)) return;
    gaming = next;
    onChange(next, next ? exe : null);
  }

  function restart() {
    if (stopped) return;
    const now = clock();
    restarts = restarts.filter(time => now - time < 60_000);
    if (restarts.length >= 3) { report(false, null, true); return; }
    restarts.push(now);
    retry = setImmediate(() => { retry = null; launch(); });
  }

  function launch() {
    if (stopped) return;
    let child;
    try {
      child = spawnProcess('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script],
        { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
    } catch { restart(); return; }
    const probe = { child, reader: null, finished: false };
    current = probe;
    const finish = () => {
      if (probe.finished) return;
      probe.finished = true;
      probe.reader?.close();
      if (current === probe) current = null;
      restart();
    };
    // A failed spawn emits error followed by close; a real process emits exit first.
    child.on('error', finish);
    child.once('exit', finish);
    child.once('close', finish);
    probe.reader = createInterface({ input: child.stdout, crlfDelay: Infinity });
    probe.reader.on('line', line => {
      if (stopped || probe.finished || current !== probe || !line.trim()) return;
      let fact;
      try { fact = JSON.parse(line); } catch { return; }
      report(isGaming(fact, getGames()), fact?.exe ?? null);
    });
  }

  return {
    start() { if (started || stopped) return; started = true; launch(); },
    stop() {
      stopped = true;
      if (retry) { clearImmediate(retry); retry = null; }
      const probe = current;
      current = null;
      if (!probe) return;
      probe.finished = true;
      probe.reader?.close();
      try { probe.child.kill(); } catch { /* already exited */ }
    },
  };
}

module.exports = { createGameDetector };
