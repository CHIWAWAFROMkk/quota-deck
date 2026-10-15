// Launches compare-sheet.cjs in Electron proper: ELECTRON_RUN_AS_NODE (set by some shells) would run it as plain Node.
const { execFile } = require('node:child_process');
const path = require('node:path');
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
execFile(require('electron'), [path.join(__dirname, 'compare-sheet.cjs'), ...process.argv.slice(2)], { timeout: 60000, windowsHide: true, env }, (error, stdout, stderr) => {
  process.stdout.write(stdout);
  if (error) { process.stderr.write(stderr); console.error(error.message); process.exitCode = 1; }
});
