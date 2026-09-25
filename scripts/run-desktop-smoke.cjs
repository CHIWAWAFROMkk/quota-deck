const { execFile } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
fs.mkdirSync(path.join(__dirname, '../work'), { recursive: true });
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
execFile(require('electron'), [path.join(__dirname, 'smoke-desktop.cjs')], { timeout: 45000, windowsHide: true, env }, (error, stdout, stderr) => {
  console.log(stdout);
  if (error) { console.error(stderr); console.error(error.message); process.exitCode = 1; }
});
