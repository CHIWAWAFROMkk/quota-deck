// Runs the real main process, sandboxed preload and HUD renderer against synthetic
// data that mirrors the Agent HUD video. Never reads credentials or calls a provider.
const { app, BrowserWindow } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(process.env.QD_TEST_APP_ROOT || path.join(__dirname, '..'));
const output = fs.mkdtempSync(path.join(__dirname, '../work/desktop-smoke-'));
app.setPath('userData', path.join(output, 'profile'));
const source = require(path.join(root, 'src/main/snapshot.cjs'));
const oauth = require(path.join(root, 'src/main/claude-oauth.cjs'));
const now = Date.now();
const updatedAt = new Date(now).toISOString();
const iso = minutes => new Date(now + minutes * 60000).toISOString();
const claudeRaw = oauth.parseUsage({ five_hour: { utilization: 12, resets_at: iso(72.5) }, seven_day: { utilization: 79, resets_at: iso(4 * 1440 + 627) }, seven_day_opus: { utilization: 60, resets_at: iso(4 * 1440 + 627) } }, 'max_20x', now);
[6.3, 1.4, 0.8].forEach((rate, i) => { claudeRaw.groups[0].buckets[i].burnPerHour = rate; });
const data = { providers: [
  { id: 'codex', name: 'Codex', status: 'healthy', precision: 'provider-reported', planType: 'pro', updatedAt, remainingPercent: 51, windows: [{ label: '5h', remainingPercent: 51, windowDurationMins: 300, resetsAt: iso(150) }, { label: 'week', remainingPercent: 70, windowDurationMins: 10080, resetsAt: iso(3000) }], models: [] },
  claudeRaw,
  { id: 'antigravity', name: 'Antigravity', status: 'healthy', precision: 'provider-reported', updatedAt, remainingPercent: 91, groups: [{ displayName: 'Gemini', buckets: [{ label: '5 小时', window: '5h', remainingFraction: 0.91, resetTime: iso(200) }] }], models: [] },
  { id: 'workbuddy', name: 'WorkBuddy', status: 'healthy', precision: 'provider-reported', updatedAt, remainingCredits: 660, totalCredits: 1000, models: [] },
  { id: 'deepseek', name: 'DeepSeek', status: 'healthy', precision: 'provider-reported', updatedAt, balances: [{ currency: 'CNY', total_balance: '8.85' }], models: [{ name: '<img src=x onerror=alert(1)>' }] },
].map(source.providerToUi) };
source.configureHistory = () => {};
source.readAll = async () => data;
const tokenModule = require(path.join(root, 'src/main/token-ledger.cjs'));
const tokenStart = tokenModule.windowStart(now);
const stacks = Array.from({ length: 96 }, (_, i) => (i % 9 < 6 ? [200000 + (i % 5) * 60000, i % 3 === 0 ? 90000 : 0] : [0, 0]));
const claudeTokens = { status: 'ok', startAt: tokenStart, partial: false, stacks, buckets: stacks.map(([a, b]) => a + b), models: [{ id: 'claude-opus-5-5', name: 'Opus 5.5', total: 0 }, { id: 'claude-fable-5-1', name: 'Fable 5.1', total: 0 }] };
claudeTokens.models.forEach((model, m) => { model.total = stacks.reduce((sum, column) => sum + column[m], 0); });
claudeTokens.total = claudeTokens.buckets.reduce((a, b) => a + b, 0);
const tokenFixture = { claude: claudeTokens, codex: { status: 'unsupported', startAt: tokenStart, partial: false, total: 0, buckets: new Array(96).fill(0), models: [], stacks: Array.from({ length: 96 }, () => []) } };
tokenModule.createTokenLedger = () => ({ read: async () => tokenFixture });
const { shell } = require('electron');
const opened = [];
shell.openPath = async target => { opened.push(target); return ''; };
shell.openExternal = async target => { opened.push(target); };
const checks = [];
const watchdog = setTimeout(() => { console.error('Desktop smoke timed out'); app.exit(1); }, 120000);
require(path.join(root, 'src/main/main.cjs'));
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(fn) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (await fn()) return;
    await sleep(30);
  }
  throw new Error('Timed out waiting for UI');
}
app.whenReady().then(async () => {
  const byPage = name => BrowserWindow.getAllWindows().find(item => item.webContents.getURL().endsWith(name));
  await until(() => byPage('hud.html'));
  const hudWindow = byPage('hud.html');
  const hudEval = code => hudWindow.webContents.executeJavaScript(code);
  const shot = async name => fs.writeFileSync(path.join(output, `${name}.png`), (await hudWindow.webContents.capturePage()).toPNG());
  const hover = id => hudEval(`document.querySelector('#strip [data-id=${id}]').dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))`);
  const unhover = () => hudEval('document.querySelector("#strip").dispatchEvent(new MouseEvent("mouseleave"))');
  const click = id => hudEval(`(() => { const b = document.querySelector('#strip [data-id=${id}]');
    b.dispatchEvent(new PointerEvent('pointerdown', { button: 0, bubbles: true, screenX: 10, screenY: 10 }));
    b.dispatchEvent(new PointerEvent('pointerup', { button: 0, bubbles: true, screenX: 10, screenY: 10 })); })()`);
  await until(async () => !hudWindow.webContents.isLoading() && await hudEval('document.querySelectorAll("#strip .item").length === 5 && document.querySelector("#strip .num")?.textContent === "49%"'));

  assert.equal(BrowserWindow.getAllWindows().length, 1, 'no big panel window');
  assert.equal(hudWindow.isAlwaysOnTop(), true);
  assert.equal(hudWindow.webContents.getLastWebPreferences().sandbox, true);
  assert.equal(await hudEval('typeof require === "undefined" && typeof process === "undefined" && typeof hud.openPanel === "undefined"'), true);
  assert.deepEqual(await hudEval('[...document.querySelectorAll("#strip .item")].map(b => b.dataset.id)'), ['codex', 'claude', 'antigravity', 'workbuddy', 'deepseek']);
  assert.deepEqual(await hudEval('[...document.querySelectorAll("#strip .num")].map(n => n.textContent)'), ['49%', '79%', '9%', '34%', '¥8.85']);
  await until(() => hudEval('[...document.querySelectorAll("#strip img")].every(img => img.complete && img.naturalWidth > 0)'));
  assert.equal(await hudEval('document.fonts.check("500 13px Inter")'), true, 'Inter loaded');
  checks.push('HUD only: five rings, video numbers, logos, Inter, sandbox');

  await until(async () => {
    const [main, dom] = await Promise.all([hudEval('hud.initial().then(s => s.layout)'), hudEval('(() => { const s = document.querySelector("#strip"); return { x: s.offsetLeft, y: s.offsetTop, width: s.offsetWidth, height: s.offsetHeight }; })()')]);
    return JSON.stringify(main.strip) === JSON.stringify(dom) && main.size.width - dom.x - dom.width === 3;
  });
  checks.push('renderer-measured strip matches the main-process layout and sits 3px off the right edge');

  await hover('claude');
  await sleep(200);
  assert.equal(await hudEval('document.querySelector("#pill").classList.contains("shown")'), false, 'not before 400ms');
  await until(() => hudEval('document.querySelector("#pill").classList.contains("shown")'));
  assert.deepEqual(await hudEval('[...document.querySelectorAll("#pill .pair")].map(p => p.textContent)'), ['5h12%', 'Weekly79%', 'Opus60%']);
  await sleep(450);
  await shot('hud-pill');
  await hover('deepseek');
  await until(() => hudEval('document.querySelector("#pill").textContent === "Balance¥8.85"'));
  await unhover();
  await until(() => hudEval('document.querySelector("#pill").hidden'));
  checks.push('hover capsule after 400ms, follows marks, hides after leaving');

  await hudEval('hud.setSettings({ showsNumbers: false })');
  await until(() => hudEval('document.querySelector("#strip").offsetWidth === 32'));
  await hudEval('hud.setSettings({ showsNumbers: true })');
  await until(() => hudEval('document.querySelector("#strip").offsetWidth > 60'));
  await sleep(300); // the main process re-lays the window after the size report; let it repaint
  await shot('hud-strip');
  checks.push('settings change re-measures the strip');

  const alienHud = new BrowserWindow({ show: false, webPreferences: { preload: path.join(root, 'src/main/preload-hud.cjs'), contextIsolation: true, sandbox: true } });
  await alienHud.loadFile(path.join(root, 'src/renderer/hud.html'));
  assert.equal(await alienHud.webContents.executeJavaScript('hud.action("claude-help").then(()=>false,()=>true)'), true);
  assert.equal(await alienHud.webContents.executeJavaScript('hud.setSettings({ size: 40 }).then(()=>false,()=>true)'), true);
  alienHud.destroy();
  checks.push('HUD IPC origin enforced');
  await click('claude');
  await until(() => hudEval('document.querySelector("#card").classList.contains("shown") && document.querySelectorAll("#card .row").length === 3'));
  await sleep(500);
  assert.deepEqual(await hudEval('[...document.querySelectorAll("#card .row .name")].map(n => n.textContent)'), ['Current session', 'Weekly', 'Weekly limit · Opus']);
  assert.deepEqual(await hudEval('[...document.querySelectorAll("#card .row .value")].map(n => n.textContent)'), ['12%', '79%', '60%']);
  assert.equal(await hudEval('document.querySelector("#card .row .detail").textContent'), '1h 12m');
  assert.equal(await hudEval('document.querySelector("#card .account .plan").textContent'), 'Max x20');
  assert.equal(await hudEval('document.querySelector("#card .account .status").textContent'), 'Current account');
  assert.equal(await hudEval('document.querySelector("#card").offsetWidth'), 440);
  assert.equal(await hudEval('Math.round(document.querySelector("#strip").getBoundingClientRect().left - document.querySelector("#card").getBoundingClientRect().right)'), 6);
  assert.equal(await hudEval('/NaN|undefined/.test(document.querySelector("#card").innerText)'), false);
  await shot('hud-card-quota');

  await hudEval('document.querySelector("#card [data-metric=burn]").click()');
  await until(() => hudEval('document.querySelector("#card .row .value").textContent === "6.3%/h"'));
  assert.equal(await hudEval('document.querySelector("#card .row .detail").textContent'), '20% by reset');
  assert.equal(await hudEval('document.querySelectorAll("#card .row .track .ghost").length > 0'), true);
  await until(async () => (await hudEval('hud.initial()')).settings.metrics.claude === 'burn');
  await shot('hud-card-burn');
  await hudEval('document.querySelector("#card [data-metric=tokens]").click()');
  await until(() => hudEval('/\\/h$/.test(document.querySelector("#card .row .value").textContent)'));
  assert.match(await hudEval('document.querySelector("#card .row .detail").textContent'), / \/ day$/);
  await hudEval('document.querySelector("#card [data-metric=quota]").click()');
  await until(() => hudEval('document.querySelector("#card .row .value").textContent === "12%"'));
  checks.push('card: video rows and layout, three metrics persisted per provider');

  assert.match(await hudEval('document.querySelector("#card .tokens .sec-meta").textContent'), /^24h · [\d.]+[KMB]? tok$/);
  await until(() => hudEval('document.querySelectorAll("#card .chart .col rect").length > 0'));
  await hudEval(`(() => { const svg = document.querySelector('#card .chart svg'); const r = svg.getBoundingClientRect();
    svg.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: r.left + r.width * (27.5 / 96), clientY: r.top + 10 })); })()`);
  await until(() => hudEval('!document.querySelector("#card .chart-tip").hidden'));
  assert.match(await hudEval('document.querySelector("#card .tip-period").textContent'), /^(Sun|Mon|Tue|Wed|Thu|Fri|Sat) \d{1,2} [A-Z][a-z]{2} at \d\d:\d\d – \d\d:\d\d$/);
  assert.match(await hudEval('document.querySelector("#card .tip-total").textContent'), /^[\d,]+ tokens$/);
  assert.deepEqual(await hudEval('[...document.querySelectorAll("#card .tip-row .tip-name")].map(n => n.textContent)'), ['Opus 5.5', 'Fable 5.1']);
  await sleep(200); // let the tooltip paint before capturing
  await shot('hud-tooltip');
  checks.push('tokens: stacked by model, hover tooltip with period, total and models');

  await hudEval('document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }))');
  await until(() => hudEval('document.querySelector("#card").hidden'));
  await click('codex');
  await until(() => hudEval('document.querySelector("#card .tokens .sec-meta")?.textContent === "No local logs"'));
  await click('codex');
  await until(() => hudEval('document.querySelector("#card").hidden'));
  checks.push('card closes on Esc and on a second click; missing logs are labelled');
  await click('claude');
  await until(() => hudEval('document.querySelector("#card").classList.contains("shown")'));
  await hudEval('document.querySelector("#card [data-act=settings]").click()');
  await until(() => hudEval('document.querySelector("#card h2")?.textContent === "Settings"'));
  assert.deepEqual(await hudEval('[...document.querySelectorAll("#card .set-row > span:first-child")].map(n => n.textContent)'), ['Size', 'Show rings', 'Ring thickness', 'Show numbers', 'Position', 'Claude', 'WorkBuddy', 'DeepSeek']);
  await sleep(450);
  await shot('hud-settings');
  await hudEval(`(() => { const r = document.querySelector('#card input[data-key=size]'); r.value = '30'; r.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await until(() => hudEval('getComputedStyle(document.documentElement).getPropertyValue("--mark").trim() === "30px"'));
  assert.equal(await hudEval('document.querySelector("#card h2").textContent'), 'Settings', 'the page stays open while sliding');
  assert.equal(await hudEval('document.querySelector("#card input[data-key=size]").value'), '30');
  await hudEval(`(() => { const r = document.querySelector('#card input[data-key=size]'); r.value = '22'; r.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await hudEval('document.querySelector("#card input[data-key=showsRings]").click()');
  await until(() => hudEval('document.querySelector("#card [data-row=ringWidth]").hidden && document.querySelectorAll("#strip .ring").length === 0'));
  await hudEval('document.querySelector("#card input[data-key=showsRings]").click()');
  await until(() => hudEval('document.querySelectorAll("#strip .ring").length === 5 && !document.querySelector("#card [data-row=ringWidth]").hidden'));
  await hudEval('[...document.querySelectorAll("#card .btn")].find(b => b.textContent === "Setup guide").click()');
  await until(() => hudEval('document.querySelector("#card .set-status").textContent === "Opened"'));
  assert.ok(opened.some(target => target.endsWith('claude-setup.md')));
  await hudEval('document.querySelector("#card [data-act=back]").click()');
  await until(() => hudEval('document.querySelector("#card h2")?.textContent === "Claude"'));
  await click('claude');
  await until(() => hudEval('document.querySelector("#card").hidden'));
  checks.push('settings page: live size and rings, setup guide action, back to the card');
  await click('claude');
  await until(() => hudEval('document.querySelector("#card").classList.contains("shown")'));
  await hudEval('document.querySelector("#card [data-act=stats]").click()');
  await until(() => byPage('stats.html'));
  const statsWindow = byPage('stats.html');
  const statsEval = code => statsWindow.webContents.executeJavaScript(code);
  await until(async () => !statsWindow.webContents.isLoading() && await statsEval('document.querySelectorAll(".source").length === 1'));
  assert.equal(statsWindow.webContents.getLastWebPreferences().sandbox, true);
  assert.deepEqual(await statsEval('[...document.querySelectorAll(".models tbody td:first-child")].map(td => td.textContent)'), ['Opus 5.5', 'Fable 5.1']);
  assert.equal(await statsEval('document.querySelectorAll(".axis span").length'), 5);
  await until(() => statsEval('document.querySelectorAll(".chart .col rect").length > 0'));
  fs.writeFileSync(path.join(output, 'stats.png'), (await statsWindow.webContents.capturePage()).toPNG());
  statsWindow.close();
  await until(() => !byPage('stats.html'));
  await until(() => hudEval('document.querySelector("#card").hidden || !document.querySelector("#card").classList.contains("shown")'));
  if (await hudEval('!document.querySelector("#card").hidden')) await hudEval('document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }))');
  checks.push('statistics window: sandboxed, per-model table, time axis');
  const { screen } = require('electron');
  const area = screen.getPrimaryDisplay().workArea;
  const realCursor = screen.getCursorScreenPoint;
  const before = await hudEval('hud.initial().then(s => s.layout)');
  const bounds = hudWindow.getBounds();
  let pointer = { x: bounds.x + before.strip.x + 10, y: bounds.y + before.strip.y + 40 };
  screen.getCursorScreenPoint = () => pointer;
  await hudEval('hud.drag("start")');
  pointer = { x: area.x + Math.round(area.width / 2), y: area.y + 2 };
  await until(async () => (await hudEval('hud.initial().then(s => s.layout)')).edge === 'top');
  assert.equal(await hudEval('document.body.classList.contains("dragging")'), true);
  await hudEval('hud.drag("end")');
  await until(async () => { const l = await hudEval('hud.initial().then(s => s.layout)'); return l.edge === 'top' && !l.dragging; });
  screen.getCursorScreenPoint = realCursor;
  await until(() => hudEval('getComputedStyle(document.querySelector("#strip")).flexDirection === "row"'));
  assert.deepEqual(await hudEval('(() => { const s = document.querySelector("#strip"); return [s.offsetTop, s.offsetHeight]; })()'), [3, 30]);
  await hover('claude');
  await until(() => hudEval('document.querySelector("#pill").classList.contains("shown") && document.querySelector("#pill").classList.contains("edge-top")'));
  await sleep(450);
  await shot('hud-top');
  checks.push('dragging snaps live to the top edge, the strip turns horizontal and the capsule hangs below');
  const dragging = async () => (await hudEval('hud.initial().then(s => s.layout)')).dragging;
  const pressAndMove = () => hudEval(`(() => { const s = document.querySelector('#strip');
    s.dispatchEvent(new PointerEvent('pointerdown', { button: 0, bubbles: true, screenX: 10, screenY: 10, pointerId: 1 }));
    s.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, screenX: 40, screenY: 10, pointerId: 1 })); })()`);
  await pressAndMove();
  await until(dragging);
  await hudEval('document.querySelector("#strip").dispatchEvent(new PointerEvent("lostpointercapture", { pointerId: 1 }))');
  await until(async () => !(await dragging()));
  await pressAndMove();
  await until(dragging);
  await hudEval(`document.querySelector('#strip').dispatchEvent(new PointerEvent('pointerdown', { button: 0, bubbles: true, screenX: 10, screenY: 10, pointerId: 2 }))`);
  await until(async () => !(await dragging()));
  await hudEval(`document.querySelector('#strip').dispatchEvent(new PointerEvent('pointerup', { button: 0, bubbles: true, screenX: 10, screenY: 10, pointerId: 2 }))`);
  checks.push('a lost pointer capture or a fresh press ends a stuck drag');
  // <<more checks>>
  fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify({ electron: process.versions.electron, checks }, null, 2));
  console.log(JSON.stringify({ passed: checks.length, output, electron: process.versions.electron }));
  clearTimeout(watchdog);
  app.quit();
}).catch(error => { console.error(error.stack); app.exit(1); });
