// Runs the real main process, sandboxed preload and renderer against synthetic
// data. Never starts an agent, reads credentials, or calls a provider.
const { app, BrowserWindow } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(process.env.QD_TEST_APP_ROOT || path.join(__dirname, '..'));
const output = fs.mkdtempSync(path.join(__dirname, '../work/desktop-smoke-'));
app.setPath('userData', path.join(output, 'profile'));
const source = require(path.join(root, 'src/main/snapshot.cjs'));
const { sanitizeClaudePayload, normalizeClaudeSnapshot } = require(path.join(root, 'src/main/claude-client.cjs'));
const now = Date.now();
const claude = normalizeClaudeSnapshot(sanitizeClaudePayload({ model: { id: 'fixture', display_name: 'Claude 测试模型' }, rate_limits: { five_hour: { used_percentage: 20, resets_at: now / 1000 + 3600 }, seven_day: { used_percentage: 96, resets_at: now / 1000 + 86400 } } }, now), now);
const data = { lastUpdated: '12:00', globalStatus: '测试数据 · 非真实额度', agents: { codex: true, claude: true, workbuddy: true, antigravity: true }, providers: [
  { id: 'codex', name: 'Codex', status: 'critical', remainingPercent: 0, models: [{ name: '<img src=x onerror=alert(1)>', pool: 'shared', poolLabel: '共享额度' }] },
  claude,
  { id: 'antigravity', name: 'Antigravity', status: 'stale', models: [] },
  { id: 'deepseek', name: 'DeepSeek', status: 'error', models: [] },
  { id: 'workbuddy', name: 'WorkBuddy', status: 'stale', models: [] },
].map(source.providerToUi) };
let calls = 0;
let fail = false;
source.configureHistory = () => {};
source.readAll = async () => {
  calls++;
  await new Promise(resolve => setTimeout(resolve, 30));
  if (fail) throw new Error('测试刷新失败');
  return data;
};
source.readProvider = async id => data.providers.find(provider => provider.id === id);
const tokenModule = require(path.join(root, 'src/main/token-ledger.cjs'));
const tokenStart = tokenModule.windowStart(now);
const tokenFixture = {
  claude: { status: 'ok', buckets: Array.from({ length: 96 }, (_, i) => (i % 7 === 0 ? 1000 + i * 10 : 0)), total: 0, startAt: tokenStart, partial: false },
  codex: { status: 'unsupported', buckets: new Array(96).fill(0), total: 0, startAt: tokenStart, partial: false },
};
tokenFixture.claude.total = tokenFixture.claude.buckets.reduce((a, b) => a + b, 0);
tokenModule.createTokenLedger = () => ({ read: async () => tokenFixture });
const orchestrator = require(path.join(root, 'src/main/orchestrator.cjs'));
const realRun = orchestrator.runCollaboration;
let completeFixture;
let fixtureRuns = 0;
orchestrator.runCollaboration = request => {
  if (request?.task !== 'fixture crash recovery') return realRun(request);
  fixtureRuns++;
  return new Promise(resolve => { completeFixture = resolve; });
};
const checks = [];
const watchdog = setTimeout(() => { console.error('Desktop smoke timed out'); app.exit(1); }, 35000);
require(path.join(root, 'src/main/main.cjs'));
async function until(fn) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (await fn()) return;
    await new Promise(resolve => setTimeout(resolve, 30));
  }
  throw new Error('Timed out waiting for UI');
}
app.whenReady().then(async () => {
  const byPage = name => BrowserWindow.getAllWindows().find(item => item.webContents.getURL().endsWith(name));
  await until(() => byPage('compact.html') && byPage('hud.html'));
  const window = byPage('compact.html');
  const hudWindow = byPage('hud.html');
  const evaluate = code => window.webContents.executeJavaScript(code);
  await until(async () => !window.webContents.isLoading() && await evaluate('document.querySelectorAll(".provider").length === 5'));
  assert.equal(window.webContents.getLastWebPreferences().sandbox, true);
  await evaluate('quotaDeck.refreshAll()');
  await new Promise(resolve => setTimeout(resolve, 50));
  const prior = calls;
  await evaluate('Promise.all([quotaDeck.refreshAll(), quotaDeck.refreshAll()])');
  assert.equal(calls - prior, 1);
  checks.push('real IPC and concurrent refresh');
  assert.equal(await evaluate("quotaDeck.refreshProvider('__proto__').then(()=>false,()=>true)"), true);
  assert.equal(await evaluate("quotaDeck.runCollaboration({task:'test',agents:[]}).then(()=>false,()=>true)"), true);
  assert.equal(await evaluate("typeof require === 'undefined' && typeof process === 'undefined'"), true);
  assert.equal(await evaluate("document.querySelectorAll('#providerList img').length"), 0);
  checks.push('invalid inputs, sandbox, escaped provider content');
  for (const width of [520, 400]) {
    window.setSize(width, 760);
    await evaluate("if (!document.querySelector('[data-provider=claude]').classList.contains('open')) document.querySelector('[data-provider=claude] .provider-summary').click()");
    await evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
    assert.equal(await evaluate('document.documentElement.scrollWidth <= innerWidth'), true);
    assert.equal(await evaluate("document.querySelectorAll('[data-provider=claude] .window-row').length"), 2);
    assert.equal(await evaluate('/NaN|undefined/.test(document.body.innerText)'), false);
    fs.writeFileSync(path.join(output, `quota-${width}.png`), (await window.webContents.capturePage()).toPNG());
  }
  checks.push('520px and 400px layout');
  await evaluate("document.querySelector('#aboutBtn').click()");
  await until(() => evaluate("document.querySelector('#appVersion').textContent.includes('.')"));
  assert.equal(await evaluate("document.querySelector('#aboutDialog').open"), true);
  await evaluate("document.querySelector('#aboutDialog button').click()");
  assert.equal(await evaluate("document.querySelector('#aboutDialog').open"), false);
  await evaluate('quotaDeck.hide()');
  assert.equal(window.isVisible(), false);
  checks.push('version dialog, keyboard-native dismissal and tray hiding');
  await evaluate("document.querySelector('[data-view=collab]').click()");
  assert.equal(await evaluate("document.querySelectorAll('#agentChoices input:checked').length"), 0);
  await evaluate("document.querySelector('#agentChoices input[value=codex]').click(); document.querySelector('#agentChoices input[value=workbuddy]').click(); document.querySelector('#refreshBtn').click()");
  await until(() => evaluate('!document.querySelector("#refreshBtn").disabled'));
  assert.equal(await evaluate("document.querySelectorAll('#agentChoices input:checked').length"), 2);
  fail = true;
  await evaluate('document.querySelector("#refreshBtn").click()');
  await until(() => evaluate('!document.querySelector("#refreshBtn").disabled'));
  assert.equal(await evaluate('document.querySelectorAll(".provider").length'), 5);
  assert.equal(await evaluate('document.querySelector("#toast").textContent.includes("测试刷新失败")'), true);
  fail = false;
  await evaluate('quotaDeck.refreshAll()');
  checks.push('explicit selection, selection retention, failed refresh recovery');
  const alien = new BrowserWindow({ show: false, webPreferences: { preload: path.join(root, 'src/main/preload.cjs'), contextIsolation: true, sandbox: true } });
  await alien.loadFile(path.join(root, 'src/renderer/compact.html'));
  assert.equal(await alien.webContents.executeJavaScript('quotaDeck.refreshAll().then(()=>false,()=>true)'), true);
  alien.destroy();
  checks.push('other window IPC denied');
  const hudEval = code => hudWindow.webContents.executeJavaScript(code);
  await until(async () => !hudWindow.webContents.isLoading() && await hudEval('document.querySelectorAll("#strip .item").length === 5'));
  assert.equal(hudWindow.isAlwaysOnTop(), true);
  assert.equal(hudWindow.webContents.getLastWebPreferences().sandbox, true);
  assert.equal(await hudEval('typeof require === "undefined" && typeof process === "undefined"'), true);
  assert.deepEqual(await hudEval('[...document.querySelectorAll("#strip .item")].map(b => b.dataset.id)'), ['codex', 'claude', 'antigravity', 'deepseek', 'workbuddy']);
  await until(() => hudEval('[...document.querySelectorAll("#strip img")].every(img => img.complete && img.naturalWidth > 0)'));
  assert.equal(await hudEval('document.querySelector("[data-id=codex] .ring").classList.contains("high")'), true);
  assert.equal(await hudEval('document.querySelector("[data-id=antigravity] .ring .value") === null'), true);
  await hudEval(`(() => { const b = document.querySelector('[data-id=claude]');
    b.dispatchEvent(new PointerEvent('pointerdown', { button: 0, bubbles: true, screenX: 10, screenY: 10 }));
    b.dispatchEvent(new PointerEvent('pointerup', { button: 0, bubbles: true, screenX: 10, screenY: 10 })); })()`);
  await until(() => hudEval('!document.querySelector("#card").hidden && document.querySelectorAll("#card .row").length === 2'));
  assert.ok(await hudEval('document.querySelectorAll("#card .chart rect").length') > 0);
  assert.equal(await hudEval('/NaN|undefined/.test(document.querySelector("#card").innerText)'), false);
  await hudEval('document.querySelector("#card .row").click()');
  assert.match(await hudEval('document.querySelector("#card .row-value").textContent'), /%\/h|采样中/);
  await hudEval('document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }))');
  assert.equal(await hudEval('document.querySelector("#card").hidden'), true);
  fs.writeFileSync(path.join(output, 'hud.png'), (await hudWindow.webContents.capturePage()).toPNG());
  const alienHud = new BrowserWindow({ show: false, webPreferences: { preload: path.join(root, 'src/main/preload-hud.cjs'), contextIsolation: true, sandbox: true } });
  await alienHud.loadFile(path.join(root, 'src/renderer/hud.html'));
  assert.equal(await alienHud.webContents.executeJavaScript('hud.refresh().then(()=>false,()=>true)'), true);
  alienHud.destroy();
  checks.push('HUD: five rings with logos, click card with tokens, rate toggle, Esc, sandbox, IPC origin');
  await evaluate("void quotaDeck.runCollaboration({task:'fixture crash recovery',agents:['codex','claude']}).catch(()=>{}); true");
  await until(() => Boolean(completeFixture));
  const crashed = new Promise(resolve => window.webContents.once('render-process-gone', resolve));
  const recovered = new Promise(resolve => window.webContents.once('did-finish-load', resolve));
  window.webContents.forcefullyCrashRenderer();
  await crashed;
  await recovered;
  await until(async () => {
    try { return !window.webContents.isLoading() && await evaluate('document.querySelectorAll(".provider").length === 5 && document.querySelector("#runCollabBtn").disabled'); }
    catch { return false; }
  });
  assert.equal(await evaluate("quotaDeck.runCollaboration({task:'fixture crash recovery',agents:['codex','claude']}).then(()=>false,()=>true)"), true);
  completeFixture({ results: [{ id: 'codex', status: 'done', output: '恢复后仍可查看的测试结果' }] });
  await until(() => evaluate('document.querySelector("#collabResults").textContent.includes("恢复后仍可查看")'));
  assert.equal(fixtureRuns, 1);
  await window.loadFile(path.join(root, 'src/renderer/compact.html'));
  await until(() => evaluate('document.querySelector("#collabResults").textContent.includes("恢复后仍可查看")'));
  assert.equal(fixtureRuns, 1);
  checks.push('renderer crash recovery and collaboration result retention without resubmission');
  fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify({ electron: process.versions.electron, checks }, null, 2));
  console.log(JSON.stringify({ passed: checks.length, output, electron: process.versions.electron }));
  clearTimeout(watchdog);
  app.quit();
}).catch(error => { console.error(error.stack); app.exit(1); });
