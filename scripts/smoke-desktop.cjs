// Runs the real main process, sandboxed preload and HUD renderer against synthetic
// data that mirrors the Agent HUD video. Never reads credentials or calls a provider.
const { app, BrowserWindow } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(process.env.QD_TEST_APP_ROOT || path.join(__dirname, '..'));
const output = fs.mkdtempSync(path.join(__dirname, '../work/desktop-smoke-'));
// The approval endpoint lives under appData and is deleted on quit: a running QuotaDeck must keep its own.
const realEndpoint = path.join(app.getPath('appData'), 'QuotaDeck', 'approval-endpoint.json');
const endpointState = () => { try { return fs.readFileSync(realEndpoint, 'utf8'); } catch { return null; } };
const endpointBefore = endpointState();
app.setPath('userData', path.join(output, 'profile'));
app.setPath('appData', path.join(output, 'appdata'));
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
// Never read the real ~/.claude or ~/.codex logs in the smoke run; sessions are pushed by the checks below.
const sessionWatcherModule = require(path.join(root, 'src/main/session-watcher.cjs'));
let sessionFeed = null;
sessionWatcherModule.createSessionWatcher = ({ tracker, onChange }) => {
  // The real tracker, fed by hand: lets the smoke drive a whole turn through the main process.
  sessionFeed = (vendor, events) => { for (const event of events) tracker.ingest(vendor, event); onChange(tracker.snapshot(Date.now())); };
  return { start: async () => {}, stop() {}, tick: async () => {}, rescan: async () => {} };
};
// No real PowerShell probe: the smoke decides when a game starts and ends.
const gameDetectorModule = require(path.join(root, 'src/main/game-detector.cjs'));
let gameFeed = null;
gameDetectorModule.createGameDetector = ({ onChange }) => {
  gameFeed = (gaming, exe = null) => onChange(gaming, gaming ? exe : null);
  return { start() {}, stop() {} };
};
// The tray menu is captured so the smoke can hide and show the HUD the way the user does.
const { Menu } = require('electron');
let trayMenu = [];
const buildMenu = Menu.buildFromTemplate.bind(Menu);
Menu.buildFromTemplate = template => { if (template.some(item => item.label === '显示 HUD')) trayMenu = template; return buildMenu(template); };
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
  const { ipcMain } = require('electron');
  let lastHits = [];
  ipcMain.on('hud:hits', (_event, rects) => { lastHits = rects; });
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

  const gapNow = await hudEval(`hud.setSettings({ showsNumbers: false }).then(() => new Promise(r => setTimeout(r, 0))).then(() => {
    const s = document.querySelector('#strip'); return document.documentElement.clientWidth - s.offsetLeft - s.offsetWidth; })`);
  assert.equal(gapNow, 3, 'the strip stays flush to the right edge before the main process relays out');
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
  await sleep(40);
  assert.ok(lastHits.some(r => r.width >= 439), 'the card is clickable as soon as it starts opening');
  await until(() => hudEval('document.querySelectorAll("#card .chart .col rect").length > 0'));
  await hudEval(`(() => { const svg = document.querySelector('#card .chart svg'); const r = svg.getBoundingClientRect();
    svg.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, clientX: r.left + r.width * (27.5 / 96), clientY: r.top + 10 }));
    svg.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: r.left + r.width * (27.5 / 96), clientY: r.top + 10 })); })()`);
  await until(() => hudEval('!document.querySelector("#card .chart-tip").hidden'));
  const liveTokens = await hudEval('hud.initial().then(s => s.tokens)');
  hudWindow.webContents.send('hud:tokens', liveTokens);
  await sleep(150);
  assert.equal(await hudEval('!document.querySelector("#card .chart-tip").hidden'), true, 'a data push does not close the tooltip being read');
  await hudEval('document.querySelector("#card").dispatchEvent(new MouseEvent("mouseleave"))');
  await until(() => hudEval('document.querySelector("#card .chart-tip").hidden'));
  const liveItems = await hudEval('hud.initial().then(s => s.items)');
  const legacyItems = JSON.parse(JSON.stringify(liveItems));
  legacyItems.find(item => item.id === 'claude').card.balance = '¥8.85';
  hudWindow.webContents.send('hud:state', legacyItems);
  hudWindow.webContents.send('hud:tokens', { claude: { status: 'ok', total: 5000 } });
  await until(() => hudEval('[...document.querySelectorAll("#card .row .name")].some(n => n.textContent === "Balance")'));
  assert.equal(await hudEval('[...document.querySelectorAll("#card .row")].find(r => r.querySelector(".name").textContent === "Balance").querySelector(".value").textContent'), '¥8.85');
  assert.equal(await hudEval('/undefined/.test(document.querySelector("#card").innerHTML) || /NaN|undefined/.test(document.querySelector("#card").innerText)'), false);
  assert.equal(await hudEval('document.querySelector("#card .tokens .sec-meta").textContent'), '24h · 5,000 tok');
  hudWindow.webContents.send('hud:state', liveItems);
  hudWindow.webContents.send('hud:tokens', liveTokens);
  await click('claude');
  await until(() => hudEval('document.querySelector("#card").hidden'));
  checks.push('card: clickable while opening, keeps a hovered tooltip across pushes, tolerates legacy balance and ledger');

  // Session events (sub-project 2a): the main process pushes SessionsSnapshot objects.
  const snapshotOf = (claude, codex, alerts = []) => ({ vendors: { claude: { phase: claude, running: claude === 'idle' ? 0 : 1 }, codex: { phase: codex, running: codex === 'idle' ? 0 : 1 } }, alerts });
  const pushSessions = value => hudWindow.webContents.send('hud:sessions', value);
  pushSessions(snapshotOf('working', 'idle'));
  await until(() => hudEval('!!document.querySelector("#strip [data-id=claude] .bot.working") && !document.querySelector("#strip [data-id=claude] img.logo") && !!document.querySelector("#strip [data-id=codex] img.logo")'));
  pushSessions(snapshotOf('asking', 'done'));
  await until(() => hudEval('!!document.querySelector("#strip [data-id=claude] .bot.asking") && !!document.querySelector("#strip [data-id=codex] .bot.done")'));
  await sleep(300);
  await shot('hud-bots');
  pushSessions(snapshotOf('idle', 'idle'));
  await until(() => hudEval('!!document.querySelector("#strip [data-id=claude] img.logo") && !document.querySelector("#strip .bot")'));
  checks.push('bot faces follow each vendor session phase');
  const sid = n => `0f0e0d0c-0b0a-4908-8706-05040302010${n}`;
  const alertOf = (n, extra = {}) => ({ id: `claude:${sid(n)}:${1000 + n}`, vendor: 'claude', kind: 'reply', sessionId: sid(n), title: `Build the iOS dashboard ${n}`, model: 'Fable 5.1', text: 'The dashboard builds, and all 42 tests pass.', tool: null, at: Date.now() - n * 60000, durationMs: 180000, returnable: true, ...extra });
  const alertPill = vendor => `document.querySelector(".alert-pill[data-vendor=${vendor}]")`;
  pushSessions(snapshotOf('done', 'idle', [alertOf(1)]));
  await until(() => hudEval(`!${alertPill('claude')}?.hidden && ${alertPill('claude')}?.textContent.includes("New reply")`));
  pushSessions(snapshotOf('done', 'idle', [alertOf(1), alertOf(2)]));
  await until(() => hudEval(`${alertPill('claude')}?.textContent.includes("2 new replies")`));
  await sleep(450);
  await shot('hud-reply-pill');
  pushSessions(snapshotOf('asking', 'idle', [alertOf(3, { id: `claude:${sid(3)}:wait:c1`, kind: 'waiting', tool: 'Bash: npm run build', at: Date.now() - 125000 }), alertOf(1)]));
  await until(() => hudEval(`${alertPill('claude')}?.textContent.includes("Waiting · 2m")`));
  pushSessions(snapshotOf('done', 'idle', [alertOf(4, { kind: 'error', text: 'API Error: 529 overloaded' })]));
  await until(() => hudEval(`${alertPill('claude')}?.textContent.includes("Stopped")`));
  pushSessions(snapshotOf('done', 'idle', [alertOf(1)]));
  await until(() => hudEval(`${alertPill('claude')}?.textContent.includes("New reply")`));
  await hover('claude');
  await until(() => hudEval(`document.querySelector("#pill").classList.contains("shown") && ${alertPill('claude')}?.hidden`));
  await unhover();
  await until(() => hudEval(`!${alertPill('claude')}?.hidden`));
  assert.equal(await hudEval(`${alertPill('codex')} === null || ${alertPill('codex')}.hidden`), true);
  pushSessions(snapshotOf('idle', 'idle'));
  await until(() => hudEval(`${alertPill('claude')}?.hidden`));
  checks.push('alert capsules: New reply, counts, Waiting, Stopped; hover swaps to the quota capsule');
  const dismissed = [];
  ipcMain.on('hud:dismiss', (_event, ids) => { dismissed.push(ids); });
  const blocks = '[...document.querySelectorAll("#card .alert-block")]';
  const closeCard = async () => { await hudEval('document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }))'); await until(() => hudEval('document.querySelector("#card").hidden')); };
  pushSessions(snapshotOf('done', 'idle', [alertOf(1), alertOf(2)]));
  await click('claude');
  await until(() => hudEval(`${blocks}.length === 2`));
  assert.deepEqual(await hudEval(`${blocks}.map(b => b.querySelector('.alert-title').textContent)`), ['Build the iOS dashboard 1', 'Build the iOS dashboard 2']);
  assert.match(await hudEval(`${blocks}[0].querySelector('.alert-time').textContent`), /^\d\d:\d\d$/);
  assert.equal(await hudEval(`${blocks}[0].querySelector('.alert-duration').textContent`), '3m');
  assert.equal(await hudEval(`${blocks}.filter(b => b.textContent.includes('Return to session')).length`), 2);
  assert.equal(await hudEval(`${blocks}[0].textContent.includes('Fable 5.1') && ${blocks}[0].textContent.includes('The dashboard builds')`), true);
  await sleep(450);
  await shot('hud-reply-card');
  pushSessions(snapshotOf('done', 'idle', [alertOf(5, { at: Date.now() }), alertOf(1), alertOf(2)]));
  await until(() => hudEval(`${blocks}.length === 3`));
  await hudEval(`${blocks}.find(b => b.querySelector('.alert-title').textContent.endsWith(' 2')).querySelector('[data-act=dismiss]').click()`);
  await until(() => dismissed.some(ids => ids.length === 1 && ids[0] === alertOf(2).id));
  await closeCard();
  await until(() => dismissed.length >= 2);
  assert.deepEqual(dismissed.at(-1), [alertOf(1).id], 'closing dismisses only what was shown when the card opened');
  pushSessions(snapshotOf('done', 'idle', [alertOf(1)]));
  await click('claude');
  await until(() => hudEval(`${blocks}.length === 1`));
  await hudEval('document.querySelector("#card [data-act=usage]").click()');
  await until(() => hudEval('document.querySelector("#card .row .name")?.textContent === "Current session"'));
  await closeCard();
  pushSessions(snapshotOf('done', 'idle', [{ id: 'claude:legacy:1', vendor: 'claude', kind: 'reply', returnable: false }]));
  await click('claude');
  await until(() => hudEval(`${blocks}.length === 1`));
  assert.equal(await hudEval(`${blocks}[0].textContent.includes('Return to session')`), false);
  assert.equal(await hudEval('/NaN|undefined/.test(document.querySelector("#card").innerText)'), false);
  await closeCard();
  pushSessions(snapshotOf('asking', 'idle', [alertOf(1), alertOf(3, { id: `claude:${sid(3)}:wait:c1`, kind: 'waiting', tool: 'Bash: npm run build', at: Date.now() - 125000 }), alertOf(4, { kind: 'error', text: 'API Error: 529 overloaded' })]));
  await click('claude');
  await until(() => hudEval(`${blocks}.length === 3`));
  assert.equal(await hudEval(`${blocks}[0].textContent.includes('Waiting for you') && ${blocks}[0].textContent.includes('Bash: npm run build') && !${blocks}[0].querySelector('[data-act=dismiss]')`), true);
  assert.equal(await hudEval(`${blocks}.some(b => b.textContent.includes('Stopped with an error') && b.textContent.includes('API Error: 529 overloaded'))`), true);
  const dismissCount = dismissed.length;
  await closeCard();
  await until(() => dismissed.length > dismissCount);
  assert.equal(dismissed.at(-1).some(id => id.includes(':wait:')), false, 'waiting alerts are never dismissed');
  pushSessions(snapshotOf('idle', 'idle'));
  checks.push('alert card: newest first, Waiting on top, dismiss on close / x, usage view, legacy-safe');
  pushSessions(snapshotOf('done', 'done', [alertOf(1), alertOf(2, { id: 'codex:switch:2', vendor: 'codex', sessionId: '11111111-2222-3333-4444-555555555555' })]));
  await click('claude');
  await until(() => hudEval(`${blocks}.length === 1`));
  const beforeSwitch = dismissed.length;
  await click('codex');
  await until(() => dismissed.length > beforeSwitch);
  assert.deepEqual(dismissed.at(-1), [alertOf(1).id], 'switching to another vendor marks the shown alerts as seen');
  await closeCard();
  pushSessions(snapshotOf('asking', 'idle', [alertOf(3, { id: `claude:${sid(3)}:wait:c9`, kind: 'waiting', tool: 'Bash: npm test', at: Date.now() - 90000 })]));
  await until(() => hudEval(`${alertPill('claude')}?.textContent.includes("Waiting · 1m")`));
  pushSessions(snapshotOf('idle', 'idle'));
  checks.push('switching vendors dismisses what was shown; waiting minutes round down');
  assert.ok(sessionFeed, 'main.cjs created the session watcher');
  const live = '7a1d9c3e-5b2f-4e8a-9c0d-112233445566';
  const t0 = Date.now();
  sessionFeed('claude', [
    { kind: 'meta', at: t0, sessionId: live, source: 'claude-vscode', cwd: 'C:/work' },
    { kind: 'title', at: t0, sessionId: live, title: 'Ship the reply card', custom: false },
    { kind: 'prompt', at: t0, sessionId: live, text: 'Ship the reply card' },
  ]);
  await until(() => hudEval('!!document.querySelector("#strip [data-id=claude] .bot.working")'));
  const ended = Date.now();
  sessionFeed('claude', [{ kind: 'turn-end', at: ended, sessionId: live, text: 'Done: the reply card ships.', error: false, durationMs: null, model: 'claude-opus-5-5' }]);
  await until(() => hudEval(`${alertPill('claude')}?.textContent.includes("New reply") && !!document.querySelector("#strip [data-id=claude] .bot.done")`));
  assert.ok(Date.now() - ended < 3000, 'the reminder shows within 3 seconds');
  await click('claude');
  await until(() => hudEval(`${blocks}.length === 1 && ${blocks}[0].textContent.includes('Ship the reply card') && ${blocks}[0].textContent.includes('Opus 5.5')`));
  await closeCard();
  await until(() => hudEval(`${alertPill('claude')}?.hidden && !document.querySelector("#strip .bot")`));
  checks.push('end to end: a finished turn reaches the HUD within 3 s and closing the card clears it through the main process');
  // <<turn-done checks>>
  // <<approval checks>> An approval request: capsule, card with Deny / Allow once, ahead of Waiting.
  pushSessions(snapshotOf('asking', 'idle', [
    alertOf(3, { id: `claude:${sid(3)}:wait:c1`, kind: 'waiting', tool: 'Bash: npm run build', at: Date.now() - 125000 }),
    { id: 'approval:req-1', vendor: 'claude', kind: 'approval', sessionId: sid(3), title: 'QuotaDeck', model: null,
      text: 'git push origin feat/hud-approval && npm run package:portable -- --out C:/Users/yoshi/Documents/ChatGPT/release/QuotaDeck-0.6.0', tool: 'Bash', at: Date.now() - 42000, durationMs: null, returnable: false },
  ]));
  await until(() => hudEval(`${alertPill('claude')}?.textContent.includes('Approve?')`));
  await click('claude');
  await until(() => hudEval(`${blocks}.length === 2`));
  assert.equal(await hudEval(`${blocks}[0].dataset.id === 'approval:req-1' && ${blocks}[0].querySelector('[data-act=approve-allow]')?.textContent === 'Allow once' && ${blocks}[0].querySelector('[data-act=approve-deny]')?.textContent === 'Deny' && !${blocks}[0].querySelector('[data-act=dismiss]')`), true);
  assert.equal(await hudEval(`${blocks}[0].textContent.includes('QuotaDeck-0.6.0')`), true);
  await sleep(450);
  await shot('hud-approval');
  await closeCard();
  pushSessions(snapshotOf('idle', 'idle'));
  checks.push('approval card: Approve? capsule, Deny / Allow once ahead of Waiting, no dismiss');
  await click('claude');
  await until(() => hudEval('document.querySelector("#card").classList.contains("shown")'));
  await hudEval('document.querySelector("#card [data-act=settings]").click()');
  await until(() => hudEval('document.querySelector("#card h2")?.textContent === "Settings"'));
  assert.deepEqual(await hudEval('[...document.querySelectorAll("#card .set-row > span:first-child")].map(n => n.textContent)'), ['Style', 'Size', 'Show rings', 'Ring thickness', 'Show numbers', 'Position', 'Claude', 'Approvals', 'WorkBuddy', 'DeepSeek']);
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
  const pushed = await hudEval('hud.initial().then(s => s.items)');
  pushed.find(item => item.id === 'claude').setup = 'claude-connect';
  hudWindow.webContents.send('hud:state', pushed);
  await until(() => hudEval('[...document.querySelectorAll("#card [data-row=claude] .btn")].some(b => b.textContent === "Connect") && document.querySelector("#card h2").textContent === "Settings"'));
  pushed.find(item => item.id === 'claude').setup = null;
  hudWindow.webContents.send('hud:state', pushed);
  await until(() => hudEval('![...document.querySelectorAll("#card [data-row=claude] .btn")].some(b => b.textContent === "Connect")'));
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
  statsWindow.webContents.send('stats:tokens', null);
  await until(() => statsEval('document.querySelector(".empty")?.textContent === "Reading…"'));
  statsWindow.webContents.send('stats:tokens', await hudEval('hud.initial().then(s => s.tokens)'));
  await until(() => statsEval('document.querySelectorAll(".source").length === 1'));
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
  await hudEval('document.querySelector("#strip").dispatchEvent(new MouseEvent("mouseleave"))');
  await click('claude');
  await until(() => hudEval('document.querySelector("#card").classList.contains("shown")'));
  await hudEval('document.querySelector("#card [data-act=settings]").click()');
  await until(() => hudEval('document.querySelector("#card h2")?.textContent === "Settings"'));
  const room = await hudEval(`(() => { const c = document.querySelector('#card'); const s = document.querySelector('#strip').getBoundingClientRect();
    return { max: parseFloat(getComputedStyle(c).maxHeight), room: document.documentElement.clientHeight - s.bottom - 6 - 4 }; })()`);
  assert.equal(Math.round(room.max), Math.round(room.room), 'at the top edge the card is capped to the room below the strip');
  await click('claude');
  await until(() => hudEval('document.querySelector("#card").hidden'));
  checks.push('card height is capped to the room on the inner side of a top-docked strip');
  pushSessions(snapshotOf('done', 'done', [alertOf(1), alertOf(2, { id: 'codex:x:2', vendor: 'codex', sessionId: '11111111-2222-3333-4444-555555555555' })]));
  await until(() => hudEval('[...document.querySelectorAll(".alert-pill")].filter(p => !p.hidden).length === 2'));
  await sleep(450);
  const overlap = await hudEval(`(() => { const [a, b] = [...document.querySelectorAll('.alert-pill')].filter(p => !p.hidden).map(p => p.getBoundingClientRect());
    return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom; })()`);
  assert.equal(overlap, false, 'alert capsules of two vendors never overlap at the top edge');
  await shot('hud-top-alerts');
  pushSessions(snapshotOf('idle', 'idle'));
  checks.push('two vendors alerting at the top edge get separate, non-overlapping capsules');
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
  // <<notch checks>> Style Notch: black block at the top centre, glow, wings, rings on hover.
  const notchBox = () => hudEval(`(() => { const n = document.querySelector('#notch');
    return { x: n.offsetLeft, y: n.offsetTop, width: n.offsetWidth, height: n.offsetHeight, text: n.innerText.trim(), view: n.dataset.view }; })()`);
  const notchView = view => hudEval(`document.querySelector('#notch').dataset.view === '${view}'`);
  await hudEval("hud.setSettings({ style: 'notch' })");
  await until(() => hudEval('!document.querySelector("#notch").hidden && document.querySelector("#strip").hidden'));
  await until(() => hudWindow.getBounds().y === area.y);
  await sleep(450);
  assert.deepEqual(await notchBox(), { x: 220, y: 0, width: 200, height: 30, text: '', view: 'collapsed' });
  assert.equal(await hudEval('[...document.querySelectorAll(".alert-pill")].every(p => p.hidden)'), true, 'no strip capsules in notch mode');
  await until(() => lastHits.some(r => r.x === 220 && r.y === 0 && r.width === 200 && r.height === 30));
  const breath = () => hudEval('getComputedStyle(document.querySelector("#notch")).getPropertyValue("--breath").trim()');
  assert.equal(await breath(), '7s');
  await shot('hud-notch');
  pushSessions(snapshotOf('working', 'idle'));
  await until(async () => (await breath()) === '3s');
  checks.push('notch: 200 × 30 at the top centre, empty, strip hidden, breath 7 s idle and 3 s while running');
  pushSessions(snapshotOf('done', 'idle', [alertOf(1)]));
  await until(() => hudEval('document.querySelector("#notch").dataset.view === "wings" && document.querySelector("#notch .notch-seg[data-vendor=claude]").classList.contains("pulse")'));
  assert.equal(await hudEval('document.querySelector("#notch .notch-seg[data-vendor=codex]").classList.contains("pulse")'), false, 'only the alerting vendor flashes');
  await sleep(450);
  const wings = await notchBox();
  assert.deepEqual([wings.width, wings.height], [456, 38]);
  assert.equal(await hudEval('document.querySelector("#notch .wing-l").textContent'), 'Claude');
  assert.equal(await hudEval('document.querySelector("#notch .wing-r").textContent'), 'New reply');
  await shot('hud-notch-wings');
  pushSessions(snapshotOf('asking', 'idle', [alertOf(1), { id: 'approval:req-2', vendor: 'claude', kind: 'approval', sessionId: sid(3), title: 'QuotaDeck', model: null, text: 'npm test', tool: 'Bash', at: Date.now(), durationMs: null, returnable: false }]));
  await until(() => hudEval('document.querySelector("#notch .wing-r").textContent === "Approve? ×2"'));
  checks.push('notch wings: 456 × 38, bot and vendor on the left, New reply then Approve? ×2 on the right, only that vendor flashes');
  await hudEval('document.querySelector("#notch").dispatchEvent(new MouseEvent("mouseover", { bubbles: true }))');
  await sleep(200);
  assert.equal(await notchView('wings'), true, 'not before 400ms');
  await until(() => notchView('rings'));
  assert.equal(await hudEval('document.querySelectorAll("#notch .notch-rings .item .ring").length'), 5);
  assert.equal(await hudEval('document.querySelectorAll("#notch .num").length'), 0);
  await sleep(450);
  const widened = await notchBox();
  assert.ok(widened.width > 200 && widened.width < 456 && widened.height === 30, JSON.stringify(widened));
  await shot('hud-notch-rings');
  await hudEval('document.querySelector("#notch").dispatchEvent(new MouseEvent("mouseleave"))');
  await until(() => notchView('wings'));
  pushSessions(snapshotOf('idle', 'idle'));
  await until(() => notchView('collapsed'));
  checks.push('notch hover: after 400ms the wings give way to five rings without numbers, back on leave');
  // Task 6: the card hangs 6px below the black block, centred, whether opened from a ring or the wing.
  const notchHover = async () => { await hudEval('document.querySelector("#notch").dispatchEvent(new MouseEvent("mouseover", { bubbles: true }))'); await until(() => notchView('rings')); };
  const notchLeave = () => hudEval('document.querySelector("#notch").dispatchEvent(new MouseEvent("mouseleave"))');
  const cardUnder = () => hudEval(`(() => { const c = document.querySelector('#card').getBoundingClientRect(); const n = document.querySelector('#notch');
    return { gap: Math.round(c.top - (n.offsetTop + n.offsetHeight)), centred: Math.abs(c.left + c.width / 2 - (n.offsetLeft + n.offsetWidth / 2)) <= 1 }; })()`);
  await notchHover();
  await hudEval('document.querySelector("#notch .notch-rings [data-id=claude]").click()');
  await until(() => hudEval('document.querySelector("#card").classList.contains("shown") && document.querySelectorAll("#card .row").length === 3'));
  await notchLeave();
  await sleep(450);
  assert.equal(await notchView('rings'), true, 'the notch keeps its shape while the card is open');
  assert.deepEqual(await cardUnder(), { gap: 6, centred: true });
  await shot('hud-notch-card');
  await closeCard();
  await until(() => notchView('collapsed'));
  const gameTurn = '9b8a7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
  const turnAt = Date.now();
  sessionFeed('claude', [
    { kind: 'meta', at: turnAt, sessionId: gameTurn, source: 'claude-vscode', cwd: 'C:/work' },
    { kind: 'prompt', at: turnAt, sessionId: gameTurn, text: 'Tidy the notch' },
    { kind: 'turn-end', at: turnAt + 1, sessionId: gameTurn, text: 'Tidied.', error: false, durationMs: null, model: 'claude-opus-5-5' },
  ]);
  await until(() => hudEval('document.querySelector("#notch .wing-r")?.textContent === "New reply"'));
  await hudEval('document.querySelector("#notch .notch-wings").click()');
  await until(() => hudEval(`${blocks}.length === 1`));
  await sleep(450);
  assert.deepEqual(await cardUnder(), { gap: 6, centred: true });
  checks.push('notch card: 6px below the block and centred, from a ring and from the wing; the notch holds its shape meanwhile');
  // A game closes the card; when it ends the alerting vendor flashes again.
  gameFeed(true, 'cs2.exe');
  await until(() => hudEval('document.querySelector("#card").hidden'));
  await until(() => !hudWindow.isVisible());
  const gameTurn2 = '9b8a7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6e';
  sessionFeed('claude', [
    { kind: 'meta', at: Date.now(), sessionId: gameTurn2, source: 'claude-vscode', cwd: 'C:/work' },
    { kind: 'prompt', at: Date.now(), sessionId: gameTurn2, text: 'Finish while I play' },
    { kind: 'turn-end', at: Date.now() + 1, sessionId: gameTurn2, text: 'Finished.', error: false, durationMs: null, model: 'claude-opus-5-5' },
  ]);
  await sleep(300);
  assert.equal(hudWindow.isVisible(), false, 'an alert during a game stays hidden');
  await hudEval('document.querySelectorAll("#notch .notch-seg").forEach(s => s.classList.remove("pulse"))');
  gameFeed(false);
  await until(async () => hudWindow.isVisible() && await hudEval('document.querySelector("#notch .notch-seg[data-vendor=claude]").classList.contains("pulse") && /^New reply/.test(document.querySelector("#notch .wing-r").textContent)'));
  checks.push('gaming closes the card and hides the HUD; a turn finished meanwhile shows with a flash when the game ends');
  await hudEval('document.querySelector("#notch .notch-wings").click()');
  await until(() => hudEval(`${blocks}.length === 1`));
  await closeCard();
  await until(() => notchView('collapsed'));
  // The Style switch on the settings page, both ways; the strip comes back to the edge it had.
  await notchHover();
  await hudEval('document.querySelector("#notch .notch-rings [data-id=claude]").click()');
  await until(() => hudEval('document.querySelector("#card").classList.contains("shown")'));
  await hudEval('document.querySelector("#card [data-act=settings]").click()');
  await until(() => hudEval('document.querySelector("#card h2")?.textContent === "Settings"'));
  assert.equal(await hudEval('document.querySelector("#card [data-style=notch]").classList.contains("on") && document.querySelector("#card [data-row=showsNumbers]").hidden'), true);
  await hudEval('document.querySelector("#card [data-style=strip]").click()');
  await until(() => hudEval('document.querySelector("#notch").hidden && !document.querySelector("#strip").hidden && document.body.classList.contains("edge-top")'));
  assert.equal(await hudEval('document.querySelector("#card h2")?.textContent === "Settings" && !document.querySelector("#card [data-row=showsNumbers]").hidden'), true, 'the settings page stays open across the switch');
  await hudEval('document.querySelector("#card [data-style=notch]").click()');
  await until(() => hudEval('!document.querySelector("#notch").hidden && document.querySelector("#strip").hidden'));
  await hudEval('document.querySelector("#card [data-style=strip]").click()');
  await until(() => hudEval('document.querySelector("#notch").hidden && document.body.classList.contains("edge-top")'));
  await closeCard();
  checks.push('settings Style switches Strip and Notch both ways and the strip returns to its edge');
  // Task 7, end to end through the main process: a real approval request while gaming.
  await hudEval("hud.setSettings({ style: 'notch' })");
  await until(() => hudEval('!document.querySelector("#notch").hidden'));
  const endpoint = JSON.parse(fs.readFileSync(path.join(output, 'appdata', 'QuotaDeck', 'approval-endpoint.json'), 'utf8'));
  gameFeed(true, 'deadlock.exe');
  await until(() => !hudWindow.isVisible());
  const http = require('node:http');
  const pending = http.request({ host: '127.0.0.1', port: endpoint.port, path: '/approval', method: 'POST', headers: { authorization: `Bearer ${endpoint.token}`, 'content-type': 'application/json' } });
  pending.on('error', () => {});
  pending.end(JSON.stringify({ vendor: 'claude', sessionId: 'game-approval', cwd: 'C:/work', tool: 'Bash', summary: 'npm test' }));
  await sleep(1000);
  assert.equal(hudWindow.isVisible(), false, 'an approval during a game does not show the HUD');
  const leftAt = Date.now();
  gameFeed(false);
  await until(async () => hudWindow.isVisible() && /^Approve\?/.test(await hudEval('document.querySelector("#notch .wing-r")?.textContent || ""')));
  assert.ok(Date.now() - leftAt < 2000, 'back within 2 s with the approval on the wing');
  pending.destroy();
  await until(() => hudEval('!/^Approve/.test(document.querySelector("#notch .wing-r")?.textContent || "")'));
  checks.push('end to end: an approval during a game stays hidden and shows Approve? within 2 s after the game');
  await until(() => lastHits.some(r => r.width === 200 && r.height === 30));
  await sleep(500);
  const showItem = trayMenu.find(item => item.label === '显示 HUD');
  showItem.click({ checked: false });
  await until(() => !hudWindow.isVisible());
  gameFeed(true, 'cs2.exe');
  gameFeed(false);
  await sleep(600);
  assert.equal(hudWindow.isVisible(), false, 'leaving a game does not show a HUD the user hid');
  gameFeed(true, 'cs2.exe');
  showItem.click({ checked: true });
  await sleep(300);
  assert.equal(hudWindow.isVisible(), false, 'show during a game waits for the game to end');
  // The main process forgets the clickable areas when a game starts; the page must report them again.
  lastHits = [];
  gameFeed(false);
  await until(() => hudWindow.isVisible());
  await until(() => lastHits.some(r => r.width === 200 && r.height === 30));
  checks.push('a HUD hidden from the tray stays hidden across a game; showing it during a game waits for the game to end');
  await hudEval("hud.setSettings({ style: 'strip' })");
  await until(() => hudEval('document.querySelector("#notch").hidden && !document.querySelector("#strip").hidden'));
  // <<more checks>>
  assert.equal(endpointState(), endpointBefore, 'the real approval endpoint is untouched');
  assert.ok(fs.existsSync(path.join(output, 'appdata', 'QuotaDeck', 'approval-endpoint.json')), 'the smoke writes its own endpoint');
  checks.push('approval endpoint isolated: the real one under appData is untouched');
  fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify({ electron: process.versions.electron, checks }, null, 2));
  console.log(JSON.stringify({ passed: checks.length, output, electron: process.versions.electron }));
  clearTimeout(watchdog);
  app.quit();
}).catch(error => { console.error(error.stack); app.exit(1); });
