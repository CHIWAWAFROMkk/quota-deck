// Puts the smoke screenshots next to the matching Agent HUD video frames for a visual check.
// Usage: npm run compare -- <reference-frames-dir> <smoke-output-dir>
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const [referenceDir, smokeDir] = process.argv.slice(-2).map(dir => path.resolve(dir));
const PAIRS = [
  ['f015.png', 'hud-strip.png', '2.0s · strip with numbers'],
  ['f043.png', 'hud-pill.png', '4.0s · hover capsule'],
  ['f058.png', 'hud-card-quota.png', '5.1s · card, quota'],
  ['f087.png', 'hud-card-burn.png', '7.0s · card, burn rate'],
  ['f102.png', 'hud-tooltip.png', '8.0s · token tooltip'],
  ['f281.png', 'hud-top.png', '21.1s · top edge'],
];

app.whenReady().then(async () => {
  const missing = PAIRS.flatMap(([ref, ours]) => [path.join(referenceDir, ref), path.join(smokeDir, ours)]).filter(file => !fs.existsSync(file));
  if (missing.length) { console.error(`Missing:\n${missing.join('\n')}`); app.exit(1); return; }
  const rows = PAIRS.map(([ref, ours, label]) => `<tr><th>${label}</th><td><img src="${pathToFileURL(path.join(referenceDir, ref))}"></td><td class="ours"><img class="zoom" src="${pathToFileURL(path.join(smokeDir, ours))}"></td></tr>`).join('');
  const page = path.join(smokeDir, 'compare.html');
  fs.writeFileSync(page, `<!doctype html><meta charset="utf-8"><style>
    body { margin: 0; background: #111; color: #eee; font: 14px sans-serif; }
    table { border-collapse: collapse; } th { width: 120px; padding: 8px; text-align: left; vertical-align: top; }
    td { padding: 4px; vertical-align: top; } img { display: block; width: 1000px; }
    .ours { background: linear-gradient(160deg, #1d2bb0, #3b57e0 60%, #c9a3e8); } .zoom { width: 960px; }
  </style><table><tr><th></th><th>Agent HUD video</th><th>QuotaDeck (1.5×)</th></tr>${rows}</table>`);
  const win = new BrowserWindow({ show: false, width: 2120, height: 800, webPreferences: { offscreen: true } });
  await win.loadFile(page);
  await new Promise(resolve => setTimeout(resolve, 500));
  win.setContentSize(2120, await win.webContents.executeJavaScript('document.body.scrollHeight'));
  await new Promise(resolve => setTimeout(resolve, 300));
  const out = path.join(smokeDir, 'compare.png');
  fs.writeFileSync(out, (await win.webContents.capturePage()).toPNG());
  console.log(out);
  app.quit();
});
