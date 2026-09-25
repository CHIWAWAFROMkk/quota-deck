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
  await until(() => BrowserWindow.getAllWindows().length > 0);
  const window = BrowserWindow.getAllWindows()[0];
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
