# QuotaDeck HUD 一比一复刻（子项目 1）实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 照 Agent HUD 简约形态视频重做 QuotaDeck 的贴边浮条、悬停胶囊、点击卡片（三种模式、按模型堆叠的 Token 柱与浮层）、卡片内设置页和统计窗口，并删除侘寂大面板、协作与模型库。

**Architecture:** 主进程骨架（单透明窗口、40ms 穿透轮询、崩溃恢复、数据推送）保留；拖动改为每帧按指针吸附。渲染层按原版数值重写，拆成 `hud-metrics.js`（纯公式，Node 可测）、`hud-dom.js`、`hud-strip.js`、`hud-chart.js`、`hud-card.js`、`hud-settings.js`、`hud.js`。浮条尺寸由渲染层按公式算出、经 `hud:strips` 报给主进程定位窗口。

**Tech Stack:** Electron 44、Node 24 内置 `node:test`、原生 DOM/SVG/CSS，无运行时依赖；Inter 字体（OFL）作本地资源。

**Spec:** `docs/superpowers/specs/2026-10-14-hud-replica-design.md`

## Global Constraints

- 仓库：`C:\Users\yoshi\Documents\ChatGPT\额度显示器`，分支 `feat/edge-hud`；不合并、不推送。
- 提交作者用 `git -c user.name=CHIWAWAFROMkk -c user.email=323616687+CHIWAWAFROMkk@users.noreply.github.com commit ...`（仓库未配置作者）；提交信息末尾加 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`。
- 测试命令：`npm run check`（`node --test tests/*.test.mjs`）；桌面冒烟：`npm run check:desktop`。
- 不新增 npm 依赖，不改 `package.json` 的依赖列表。
- `~/.claude/.credentials.json` 只读；令牌不得出现在日志、测试快照、IPC 载荷里。
- 渲染层 CSP 不含 `unsafe-inline`：样式只能用 CSSOM（`node.style.x = …`、`setProperty`），不能 `setAttribute('style', …)`。
- 界面文案英文，与视频一致；主进程抛出的错误信息保持中文（原样）。
- 数值照抄 spec §4–§5：圆环 22 / 线宽 1.5，底色黑 0.82，描边白 0.14，阈值 70/90，色 `#3ddc84 #ffd23f #ff453a #9a9aa0`，曲线 `cubic-bezier(.2,.8,.2,1)` 400ms，悬停 400ms，收回 200ms，点击判定 6px / 300ms，卡片 440 宽、圆角 22、离浮条 6。
- 顺序：Codex、Claude、Antigravity、WorkBuddy、DeepSeek。
- 没拿到的数据显示 `–`（浮条）/ `—`（胶囊、卡片），绝不画成 0%。

## Review Focus

1. **改 Size / 关数字后贴在右边或底边**：浮条必须仍贴边且整条在窗口与工作区内 → Task 5 测试 `large strips stay inside the window and the work area`。
2. **余额币种不是 ¥/$ 或文本无法解析**：圆环空、数字 `–`，不显示 0 → Task 3 测试 `balances that cannot be parsed stay unknown`。
3. **重置时间已过或缺失**：`%` 模式右列 `Pending update` / `—`，`🔥` 模式 `No estimate` → Task 3 测试 `reset and burn text cover past, missing and exhausted windows`。
4. **日志里模型超过 6 个、或 Codex 文件没有 `turn_context`**：多出的并入 `Other`、缺模型记 `Unknown`，各模型之和等于总量 → Task 2 测试 `more than six models fold into Other and totals still add up`。
5. **手改 `hud-settings.json` 写入垃圾值**：全部回到默认值，不崩 → Task 5 测试 `settings with junk values fall back to defaults`。

## 文件结构

| 文件 | 职责 | 任务 |
|---|---|---|
| `src/main/main.cjs` | 应用入口：托盘、刷新节拍、接入操作、HUD 与统计窗口 | 1、3、9 |
| `src/main/hud-window.cjs` | HUD 窗口：穿透、吸附拖动、设置、操作白名单、崩溃恢复 | 1、5 |
| `src/main/hud-geometry.cjs` | 纯函数：窗口布局、吸附、设置与尺寸校验 | 5 |
| `src/main/hud-view.cjs` | 纯函数：快照 → 浮条/胶囊/卡片数据（英文）；Token 推送数据 | 3 |
| `src/main/model-names.cjs` | 模型 id → 显示名 | 2 |
| `src/main/token-ledger.cjs` | 增量读日志，按模型拆分 96 个 15 分钟桶 | 2 |
| `src/main/snapshot.cjs` | 去掉协作/模型库依赖；多给出 `planType`、`updatedAt` | 1、3 |
| `src/main/claude-oauth.cjs` | 凭证里读套餐档位 | 3 |
| `src/main/stats-window.cjs`、`preload-stats.cjs` | 统计窗口 | 9 |
| `src/main/preload-hud.cjs` | HUD 预加载桥 | 1、6 |
| `src/renderer/hud-metrics.js` | 浮条尺寸公式、点击判定（页面与 Node 共用） | 4 |
| `src/renderer/hud-dom.js` | DOM 小工具、图标、格式化 | 6 |
| `src/renderer/hud-strip.js` | 浮条、胶囊、按压/拖动 | 6 |
| `src/renderer/hud-chart.js` | 堆叠 Token 柱与浮层（卡片和统计窗口共用） | 7 |
| `src/renderer/hud-card.js` | 点击卡片 | 7 |
| `src/renderer/hud-settings.js` | 卡片设置页 | 8 |
| `src/renderer/hud.js`、`hud.html`、`hud.css` | 页面装配与样式 | 6、7、8 |
| `src/renderer/stats.html/css/js` | 统计窗口页面 | 9 |
| `assets/fonts/` | Inter 字体与许可证 | 6 |
| `scripts/smoke-desktop.cjs` | 桌面冒烟（只测 HUD 与统计窗口） | 1、6–10 |
| `scripts/compare-sheet.cjs` | 与原片帧并排的对照图 | 10 |

---

### Task 1: 删除大面板、协作与模型库，接入操作迁到 HUD

**Files:**
- Delete: `src/renderer/index.html`, `src/renderer/app.js`, `src/renderer/styles.css`, `src/renderer/compact.html`, `src/renderer/compact.css`, `src/renderer/compact.js`, `src/main/preload.cjs`, `src/main/orchestrator.cjs`, `src/main/model-guidance.cjs`, `tests/orchestrator-process.test.mjs`, `scripts/preview-server.mjs`
- Modify: `src/main/main.cjs`（整文件替换）, `src/main/snapshot.cjs:6-7,110,219-220`, `src/main/hud-window.cjs:15,32,167`, `src/main/preload-hud.cjs`, `src/renderer/hud.js:176,258`, `scripts/package-portable.ps1:62-66`, `scripts/smoke-desktop.cjs`（整文件替换）, `tests/snapshot.test.mjs:7,13,22-37`, `tests/security.test.mjs:8`, `README.md`
- Test: `tests/hud-window.test.mjs`

**Interfaces:**
- Produces: `createHud({ settingsPath, onRefresh, onAction, electron })`；IPC `hud:action`（invoke，参数为操作名字符串，白名单 `claude-connect | claude-disconnect | claude-help | open-workbuddy`）；HUD 对象新增 `reload()`；预加载 `window.hud.action(name)`，删除 `window.hud.openPanel`。

- [ ] **Step 1: 写失败的测试**

在 `tests/hud-window.test.mjs` 末尾追加：

```js
test('setup actions run only for the HUD page and only from the whitelist', async () => {
  const fake = fakeElectron();
  const ran = [];
  const hud = hudWindow.createHud({ settingsPath: await settingsPath(), onRefresh: async () => {}, onAction: async name => { ran.push(name); return { status: 'ok' }; }, electron: fake.electron });
  const win = fake.windows[0];
  const event = { sender: win.webContents, senderFrame: win.webContents.mainFrame };
  assert.deepEqual(await fake.ipc.handle['hud:action'](event, 'claude-connect'), { status: 'ok' });
  assert.throws(() => fake.ipc.handle['hud:action'](event, 'collab:run'), /未知操作/);
  assert.throws(() => fake.ipc.handle['hud:action'](event, { toString: () => 'claude-help' }), /未知操作/);
  assert.throws(() => fake.ipc.handle['hud:action']({ sender: {}, senderFrame: win.webContents.mainFrame }, 'claude-help'), /不可信/);
  assert.deepEqual(ran, ['claude-connect']);
  assert.equal(fake.ipc.handle['hud:open-panel'], undefined);
  hud.destroy();
});
```

- [ ] **Step 2: 运行确认失败**

Run: `node --test tests/hud-window.test.mjs`
Expected: FAIL（`fake.ipc.handle['hud:action'] is not a function`）

- [ ] **Step 3: 改 `hud-window.cjs`**

第 15 行改为：

```js
const INVOKE_CHANNELS = ['hud:initial', 'hud:refresh', 'hud:action'];
const ACTIONS = ['claude-connect', 'claude-disconnect', 'claude-help', 'open-workbuddy'];
```

第 32 行函数签名改为：

```js
function createHud({ settingsPath, onRefresh, onAction = async () => ({ status: 'ignored' }), electron = require('electron') }) {
```

第 167 行 `ipcMain.handle('hud:open-panel', …)` 替换为：

```js
  ipcMain.handle('hud:action', guard(name => {
    if (typeof name !== 'string' || !ACTIONS.includes(name)) throw new Error('未知操作');
    return onAction(name);
  }));
```

在返回对象的 `window: () => …` 之前加：

```js
    reload() {
      recoveries = [];
      if (!alive()) { create(); return; }
      resetInteraction();
      win.loadFile(hudEntry).catch(() => {});
    },
```

- [ ] **Step 4: 改 `preload-hud.cjs`**

把 `openPanel: () => ipcRenderer.invoke('hud:open-panel'),` 换成：

```js
  action: (name) => ipcRenderer.invoke('hud:action', String(name)),
```

- [ ] **Step 5: 旧 `hud.js` 去掉「完整面板」按钮**

第 176 行改为：

```js
      el('footer', { class: 'card-foot' }, [el('span', { text: c.freshness })]),
```

删除第 258 行（`if (action.dataset.act === 'panel') …`）。

- [ ] **Step 6: 替换 `src/main/main.cjs` 整个文件**

```js
const path = require('node:path');
const { app, Menu, nativeImage, shell, Tray } = require('electron');
const { readAll, configureHistory } = require('./snapshot.cjs');
const { WORKBUDDY_APP_URL } = require('./workbuddy-client.cjs');
const { connect: connectClaudeStatusLine, disconnect: disconnectClaudeStatusLine } = require('./claude-statusline-chain.cjs');
const { nodePath } = require('./local-paths.cjs');
const { buildHudItems } = require('./hud-view.cjs');
const { createHud } = require('./hud-window.cjs');
const { createTokenLedger } = require('./token-ledger.cjs');

let tray = null;
let refreshTimer = null;
let refreshPending = null;
let hud = null;
let tokenLedger = null;

const singleInstanceLock = app.requestSingleInstanceLock();
if (!singleInstanceLock) app.quit();

app.on('second-instance', () => { hud?.show(); });

async function refreshAll() {
  if (refreshPending) return refreshPending;
  refreshPending = performRefresh().finally(() => { refreshPending = null; });
  return refreshPending;
}

async function performRefresh() {
  const snapshot = await readAll();
  hud?.pushState(buildHudItems(snapshot));
  tokenLedger?.read().then(tokens => hud?.pushTokens(tokens)).catch(() => {});
  return snapshot;
}

// Setup actions the HUD settings page may ask for; hud-window.cjs keeps the whitelist.
const actions = {
  'claude-connect': async () => {
    const result = connectClaudeStatusLine({ nodePath });
    await refreshAll().catch(() => {});
    return result;
  },
  'claude-disconnect': async () => {
    const result = disconnectClaudeStatusLine();
    await refreshAll().catch(() => {});
    return result;
  },
  'claude-help': async () => {
    const error = await shell.openPath(path.join(__dirname, '../../docs/claude-setup.md'));
    if (error) throw new Error('无法打开 Claude 接入说明');
    return { status: 'opened' };
  },
  'open-workbuddy': async () => {
    await shell.openExternal(WORKBUDDY_APP_URL);
    return { status: 'opened', url: WORKBUDDY_APP_URL };
  },
};

function createTray() {
  // NativeImage does not reliably decode SVG on Windows. A BGRA bitmap works
  // without platform codecs and remains visible even if the asset is missing.
  let icon = nativeImage.createFromPath(path.join(__dirname, '..', '..', 'assets', 'tray.png'));
  if (icon.isEmpty()) {
    const pixels = Buffer.alloc(18 * 18 * 4);
    for (let y = 2; y < 16; y++) for (let x = 2; x < 16; x++) {
      const i = (y * 18 + x) * 4;
      const ink = x === 3 || x === 14 || y === 3 || y === 14 || (x >= 9 && y >= 9);
      pixels[i] = ink ? 210 : 45; pixels[i + 1] = ink ? 160 : 35;
      pixels[i + 2] = ink ? 75 : 25; pixels[i + 3] = 255;
    }
    icon = nativeImage.createFromBitmap(pixels, { width: 18, height: 18 });
  }
  tray = new Tray(icon.resize({ width: 18, height: 18 }));
  tray.setToolTip('QuotaDeck · AI 额度');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '显示 HUD', type: 'checkbox', checked: hud?.isVisible() ?? true, click: (item) => { if (item.checked) hud?.show(); else hud?.hide(); } },
    { label: '刷新全部', click: () => { refreshAll().catch(() => {}); } },
    { label: '重新加载界面', click: () => { hud?.reload(); } },
    { type: 'separator' },
    { label: '退出', click: () => { app.isQuiting = true; app.quit(); } },
  ]));
  tray.on('click', () => { hud?.show(); });
}

app.whenReady().then(() => {
  if (!singleInstanceLock) return;
  configureHistory(path.join(app.getPath('userData'), 'quota-history.json'));
  tokenLedger = createTokenLedger();
  hud = createHud({
    settingsPath: path.join(app.getPath('userData'), 'hud-settings.json'),
    onRefresh: () => refreshAll(),
    onAction: name => actions[name](),
  });
  createTray();
  refreshAll().catch(() => {});
  refreshTimer = setInterval(() => { refreshAll().catch(() => {}); }, 60_000);
});

app.on('before-quit', () => {
  app.isQuiting = true;
  if (refreshTimer) clearInterval(refreshTimer);
  hud?.destroy();
});

app.on('window-all-closed', () => {});
```

- [ ] **Step 7: `snapshot.cjs` 去掉协作与模型库依赖**

删除第 6、7 行（`localAgentAvailability`、`inferModelStrengths` 的 require）。第 110 行改为：

```js
  return toUiSnapshot(raw);
```

第 219–220 行（`strengths: …`、`guidanceSource: …`）删除。

- [ ] **Step 8: 删除文件**

```bash
git rm src/renderer/index.html src/renderer/app.js src/renderer/styles.css src/renderer/compact.html src/renderer/compact.css src/renderer/compact.js src/main/preload.cjs src/main/orchestrator.cjs src/main/model-guidance.cjs tests/orchestrator-process.test.mjs scripts/preview-server.mjs
```

- [ ] **Step 9: 修测试与打包脚本**

`tests/snapshot.test.mjs`：删除第 7 行 `import orchestratorModule …`、第 13 行 `const { parseAgentOutput, rolePrompt } = …`，以及三个测试 `collaboration prompt keeps role and shared task explicit`、`agent JSON output parser returns the last useful result`、`agent parser handles WorkBuddy formatted JSON arrays`（第 22–37 行）。再运行 `grep -n "strengths\|guidanceSource\|agents" tests/snapshot.test.mjs`，删掉命中的断言行（只删断言，不删所在测试）。

`tests/security.test.mjs` 第 8 行改为 `const entry = resolve('src/renderer/hud.html');`。

`scripts/package-portable.ps1` 第 62–66 行（`New-Item … $rendererRoot` 到 `foreach ($rendererFile …) { … }`）替换为：

```powershell
Copy-Item -LiteralPath (Join-Path $projectRoot 'src\renderer') -Destination $sourceRoot -Recurse
```

并删除不再使用的 `$rendererRoot = …` 一行。

- [ ] **Step 10: 冒烟脚本改为只测 HUD**

`scripts/smoke-desktop.cjs` 整个文件替换为：

```js
// Runs the real main process, sandboxed preload and HUD renderer against synthetic
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
const data = { providers: [
  { id: 'codex', name: 'Codex', status: 'critical', remainingPercent: 0, models: [{ name: '<img src=x onerror=alert(1)>', pool: 'shared', poolLabel: '共享额度' }] },
  claude,
  { id: 'antigravity', name: 'Antigravity', status: 'stale', models: [] },
  { id: 'deepseek', name: 'DeepSeek', status: 'error', models: [] },
  { id: 'workbuddy', name: 'WorkBuddy', status: 'stale', models: [] },
].map(source.providerToUi) };
source.configureHistory = () => {};
source.readAll = async () => data;
const tokenModule = require(path.join(root, 'src/main/token-ledger.cjs'));
const tokenStart = tokenModule.windowStart(now);
const tokenFixture = {
  claude: { status: 'ok', buckets: Array.from({ length: 96 }, (_, i) => (i % 7 === 0 ? 1000 + i * 10 : 0)), total: 0, startAt: tokenStart, partial: false },
  codex: { status: 'unsupported', buckets: new Array(96).fill(0), total: 0, startAt: tokenStart, partial: false },
};
tokenFixture.claude.total = tokenFixture.claude.buckets.reduce((a, b) => a + b, 0);
tokenModule.createTokenLedger = () => ({ read: async () => tokenFixture });
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
  await until(() => byPage('hud.html'));
  const hudWindow = byPage('hud.html');
  const hudEval = code => hudWindow.webContents.executeJavaScript(code);
  await until(async () => !hudWindow.webContents.isLoading() && await hudEval('document.querySelectorAll("#strip .item").length === 5'));
  assert.equal(BrowserWindow.getAllWindows().length, 1, 'no big panel window');
  assert.equal(hudWindow.isAlwaysOnTop(), true);
  assert.equal(hudWindow.webContents.getLastWebPreferences().sandbox, true);
  assert.equal(await hudEval('typeof require === "undefined" && typeof process === "undefined" && typeof hud.openPanel === "undefined"'), true);
  await until(() => hudEval('[...document.querySelectorAll("#strip img")].every(img => img.complete && img.naturalWidth > 0)'));
  checks.push('HUD only: five rings with logos, sandbox, no big panel');
  const alienHud = new BrowserWindow({ show: false, webPreferences: { preload: path.join(root, 'src/main/preload-hud.cjs'), contextIsolation: true, sandbox: true } });
  await alienHud.loadFile(path.join(root, 'src/renderer/hud.html'));
  assert.equal(await alienHud.webContents.executeJavaScript('hud.action("claude-help").then(()=>false,()=>true)'), true);
  alienHud.destroy();
  checks.push('HUD IPC origin enforced for setup actions');
  // <<more checks>>
  fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify({ electron: process.versions.electron, checks }, null, 2));
  console.log(JSON.stringify({ passed: checks.length, output, electron: process.versions.electron }));
  clearTimeout(watchdog);
  app.quit();
}).catch(error => { console.error(error.stack); app.exit(1); });
```

- [ ] **Step 11: README 去掉大面板内容**

`README.md`：删除第 15 行（模型库）、第 18 行（协作状态）、第 109 行（协作说明）；第 26 行末句「HUD 显示时启动不再自动弹出完整面板。」删除；第 116 行改为：

```markdown
核心代码：`src/main/` 为连接器与 HUD 主进程，`src/renderer/hud*` 为界面，`scripts/` 为冒烟与 Windows 打包工具。
```

再运行 `grep -n "大面板\|完整面板\|协作\|模型库\|compact" README.md docs/PORTABLE-README.md`，把剩余命中句子删掉或改写为 HUD 的说法。

- [ ] **Step 12: 运行全部检查**

Run: `npm run check`
Expected: 全部 PASS（`orchestrator-process` 测试已随文件删除）。

Run: `npm run check:desktop`
Expected: 输出 `{"passed":2,…}`。

- [ ] **Step 13: Commit**

```bash
git add -A src scripts tests README.md docs/PORTABLE-README.md
git -c user.name=CHIWAWAFROMkk -c user.email=323616687+CHIWAWAFROMkk@users.noreply.github.com commit -m "refactor: 删除侘寂大面板、协作与模型库，接入操作改由 HUD 调用

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Token 账本按模型拆分

**Files:**
- Create: `src/main/model-names.cjs`
- Modify: `src/main/token-ledger.cjs:1-41,80-114,222-238`
- Test: `tests/token-ledger.test.mjs`, `tests/model-names.test.mjs`

**Interfaces:**
- Produces: `modelName(id: string) → string`；`parseClaudeLine` 返回 `{ id, at, tokens, model }`；新导出 `parseCodexContext(line) → string | null`；`ledger.read()` 每个来源返回 `{ status, startAt, partial, total, buckets: number[96], models: [{ id, name, total }], stacks: number[96][models.length] }`，`models` 按 24h 用量降序，最多 6 个，超出部分并成 `{ id: 'other', name: 'Other' }` 放在最后。

- [ ] **Step 1: 写失败的测试**

新建 `tests/model-names.test.mjs`：

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import names from '../src/main/model-names.cjs';

test('model ids from the agent logs get short display names', () => {
  const cases = {
    'claude-opus-5-5': 'Opus 5.5',
    'claude-fable-5-1': 'Fable 5.1',
    'claude-sonnet-5-5': 'Sonnet 5.5',
    'claude-opus-4-1-20250805': 'Opus 4.1',
    'claude-haiku-4': 'Haiku 4',
    'gpt-6.1-sol': 'GPT-6.1 Sol',
    'gpt-5-codex': 'GPT-5 Codex',
    unknown: 'Unknown',
    other: 'Other',
    '': 'Unknown',
    '<synthetic>': '<synthetic>',
  };
  for (const [id, name] of Object.entries(cases)) assert.equal(names.modelName(id), name, id);
  assert.equal(names.modelName(null), 'Unknown');
  assert.equal(names.modelName('x'.repeat(80)).length, 40);
});
```

在 `tests/token-ledger.test.mjs` 中：第 18 行 `claudeLine` 改为可带模型：

```js
const claudeLine = (id, at, usage, model) => JSON.stringify({ type: 'assistant', timestamp: new Date(at).toISOString(), message: { id, usage, ...(model ? { model } : {}) } });
const contextLine = (at, model) => JSON.stringify({ timestamp: new Date(at).toISOString(), type: 'turn_context', payload: { model } });
```

第 29 行断言改为：

```js
  assert.deepEqual(ledger.parseClaudeLine(claudeLine('m', 0, { input_tokens: 2, output_tokens: 3, cache_creation_input_tokens: 5, cache_read_input_tokens: 7, output_tokens_details: { thinking_tokens: 99 } })), { id: 'm', at: 0, tokens: 17, model: 'unknown' });
  assert.equal(ledger.parseCodexContext(contextLine(0, 'gpt-6.1-sol')), 'gpt-6.1-sol');
  assert.equal(ledger.parseCodexContext(codexLine(0, 1)), null);
  assert.equal(ledger.parseCodexContext('{"type":"turn_context","payload":{"model":""}}'), null);
```

文件末尾追加：

```js
const sum = arr => arr.reduce((a, b) => a + b, 0);

test('claude tokens are split by model into stacked buckets', async () => {
  const { claudeRoot, codexRoot } = await roots();
  const now = Date.now();
  await writeFile(path.join(claudeRoot, 'proj', 'session', 'a.jsonl'), [
    claudeLine('m1', now - 60000, { input_tokens: 100 }, 'claude-opus-5-5'),
    claudeLine('m2', now - 50000, { input_tokens: 30 }, 'claude-fable-5-1'),
    claudeLine('m3', now - 40000, { input_tokens: 50 }, 'claude-opus-5-5'),
  ].join('\n') + '\n');
  const series = (await ledger.createTokenLedger({ claudeRoot, codexRoot }).read(now)).claude;
  assert.deepEqual(series.models, [{ id: 'claude-opus-5-5', name: 'Opus 5.5', total: 150 }, { id: 'claude-fable-5-1', name: 'Fable 5.1', total: 30 }]);
  assert.equal(series.stacks.length, BUCKETS);
  assert.deepEqual([0, 1].map(m => sum(series.stacks.map(column => column[m]))), [150, 30]);
  assert.equal(series.total, 180);
  for (let i = 0; i < BUCKETS; i++) assert.equal(sum(series.stacks[i]), series.buckets[i], `bucket ${i}`);
});

test('codex remembers the turn model across reads of a growing file', async () => {
  const { claudeRoot, codexRoot } = await roots();
  const now = Date.now();
  const file = path.join(codexRoot, '2026', '10', '13', 'rollout-m.jsonl');
  await writeFile(file, [codexLine(now - 90000, 10), contextLine(now - 80000, 'gpt-6.1-sol'), codexLine(now - 70000, 40)].join('\n') + '\n');
  const reader = ledger.createTokenLedger({ claudeRoot, codexRoot });
  let series = (await reader.read(now)).codex;
  assert.deepEqual(series.models.map(m => [m.id, m.total]), [['gpt-6.1-sol', 30], ['unknown', 10]]);
  await appendFile(file, codexLine(now - 1000, 100) + '\n');
  series = (await reader.read(now)).codex;
  assert.deepEqual(series.models.map(m => [m.id, m.name, m.total]), [['gpt-6.1-sol', 'GPT-6.1 Sol', 90], ['unknown', 'Unknown', 10]]);
});

test('more than six models fold into Other and totals still add up', async () => {
  const { claudeRoot, codexRoot } = await roots();
  const now = Date.now();
  const lines = [];
  for (let i = 0; i < 8; i++) lines.push(claudeLine(`m${i}`, now - 60000, { input_tokens: 100 - i }, `claude-opus-${i + 1}`));
  await writeFile(path.join(claudeRoot, 'proj', 'session', 'many.jsonl'), lines.join('\n') + '\n');
  const series = (await ledger.createTokenLedger({ claudeRoot, codexRoot }).read(now)).claude;
  assert.equal(series.models.length, 7);
  assert.deepEqual(series.models.at(-1), { id: 'other', name: 'Other', total: 94 + 93 });
  assert.equal(sum(series.models.map(m => m.total)), series.total);
  assert.equal(sum(series.stacks.flat()), series.total);
});
```

- [ ] **Step 2: 运行确认失败**

Run: `node --test tests/model-names.test.mjs tests/token-ledger.test.mjs`
Expected: FAIL（`Cannot find module '../src/main/model-names.cjs'`；ledger 断言缺 `model` 字段、`parseCodexContext is not a function`）

- [ ] **Step 3: 新建 `src/main/model-names.cjs`**

```js
const cap = word => (word ? word[0].toUpperCase() + word.slice(1) : word);

/** Short display name for a model id from the agent logs, e.g. claude-opus-4-1-20250805 → Opus 4.1. */
function modelName(id) {
  const raw = typeof id === 'string' ? id.trim() : '';
  if (!raw || raw === 'unknown') return 'Unknown';
  if (raw === 'other') return 'Other';
  const claude = /^claude-([a-z]+)-(\d+)(?:-(\d{1,2}))?(?:-\d{8})?$/.exec(raw);
  if (claude) return `${cap(claude[1])} ${claude[2]}${claude[3] ? `.${claude[3]}` : ''}`;
  const gpt = /^gpt-(\d+(?:\.\d+)?)(?:-([a-z0-9-]+))?$/.exec(raw);
  if (gpt) return `GPT-${gpt[1]}${gpt[2] ? ` ${gpt[2].split('-').map(cap).join(' ')}` : ''}`;
  return raw.slice(0, 40);
}

module.exports = { modelName };
```

- [ ] **Step 4: 改 `token-ledger.cjs`**

文件头 require 后加：

```js
const { modelName } = require('./model-names.cjs');
const MAX_MODELS = 6;
```

`parseClaudeLine` 的 return 改为：

```js
  const model = typeof row.message.model === 'string' && row.message.model ? row.message.model : 'unknown';
  return { id, at, model, tokens: count(usage, 'input_tokens') + count(usage, 'output_tokens') + count(usage, 'cache_creation_input_tokens') + count(usage, 'cache_read_input_tokens') };
```

在 `parseCodexLine` 后加：

```js
// Codex names the model once per turn; the token counts that follow belong to it.
function parseCodexContext(line) {
  if (!line.includes('"turn_context"')) return null;
  let row;
  try { row = JSON.parse(line); } catch { return null; }
  const model = row?.payload?.model;
  return row?.type === 'turn_context' && typeof model === 'string' && model ? model : null;
}
```

`SOURCES.codex` 整段替换为：

```js
  codex: {
    fresh: () => ({ offset: 0, size: 0, mtimeMs: 0, lastTotal: 0, model: null, events: [] }),
    stage: state => ({ lastTotal: state.lastTotal, model: state.model, events: [] }),
    take(stage, line) {
      const model = parseCodexContext(line);
      if (model) { stage.model = model; return; }
      const event = parseCodexLine(line);
      if (!event) return;
      // A cumulative total going down starts a new segment counted from zero.
      const delta = event.total >= stage.lastTotal ? event.total - stage.lastTotal : event.total;
      stage.lastTotal = event.total;
      if (delta > 0) stage.events.push({ at: event.at, tokens: delta, model: stage.model || 'unknown' });
    },
    commit(state, stage) {
      state.lastTotal = stage.lastTotal;
      state.model = stage.model;
      state.events = state.events.concat(stage.events);
    },
    events: state => state.events,
    prune(state, since) { state.events = state.events.filter(event => event.at >= since); },
  },
```

`emptySeries` 改为：

```js
function emptySeries(status, startAt) {
  return { status, buckets: new Array(BUCKETS).fill(0), total: 0, startAt, partial: false, models: [], stacks: Array.from({ length: BUCKETS }, () => []) };
}
```

`readSource` 里从 `for (const event of [...merged.values(), ...plain]) {` 到 `return series;` 替换为：

```js
    const events = [...merged.values(), ...plain].filter(event => event.at >= startAt && event.at < startAt + BUCKETS * QUARTER);
    const totals = new Map();
    for (const event of events) {
      series.buckets[Math.floor((event.at - startAt) / QUARTER)] += event.tokens;
      series.total += event.tokens;
      totals.set(event.model, (totals.get(event.model) || 0) + event.tokens);
    }
    const ranked = [...totals].sort((a, b) => b[1] - a[1]);
    const slot = new Map(ranked.slice(0, MAX_MODELS).map(([id], i) => [id, i]));
    series.models = ranked.slice(0, MAX_MODELS).map(([id, total]) => ({ id, name: modelName(id), total }));
    if (ranked.length > MAX_MODELS) series.models.push({ id: 'other', name: 'Other', total: ranked.slice(MAX_MODELS).reduce((sum, [, n]) => sum + n, 0) });
    series.stacks = Array.from({ length: BUCKETS }, () => new Array(series.models.length).fill(0));
    for (const event of events) {
      const m = slot.has(event.model) ? slot.get(event.model) : series.models.length - 1;
      series.stacks[Math.floor((event.at - startAt) / QUARTER)][m] += event.tokens;
    }
    return series;
```

`module.exports` 加上 `parseCodexContext`：

```js
module.exports = { BUCKETS, QUARTER, createTokenLedger, parseClaudeLine, parseCodexContext, parseCodexLine, windowStart };
```

- [ ] **Step 5: 运行确认通过**

Run: `npm run check`
Expected: 全部 PASS。

- [ ] **Step 6: Commit**

```bash
git add src/main/model-names.cjs src/main/token-ledger.cjs tests/model-names.test.mjs tests/token-ledger.test.mjs
git -c user.name=CHIWAWAFROMkk -c user.email=323616687+CHIWAWAFROMkk@users.noreply.github.com commit -m "feat: Token 账本按模型拆分，超过 6 个并入 Other

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Task 3: HUD 视图模型改英文并给出三种模式的数据

**Files:**
- Modify: `src/main/hud-view.cjs`（整文件替换）, `src/main/snapshot.cjs`（`providerToUi` 返回对象）, `src/main/claude-oauth.cjs:33`（`readCredentials` 的返回）, `src/main/main.cjs`（`performRefresh`）
- Test: `tests/hud-view.test.mjs`（整文件替换）, `tests/claude-oauth.test.mjs`

**Interfaces:**
- Consumes: Task 2 的账本序列 `{ status, startAt, partial, total, buckets, models, stacks }`。
- Produces:
  - `HUD_ORDER = ['codex', 'claude', 'antigravity', 'workbuddy', 'deepseek']`
  - `buildHudItems(ui, now) → Item[]`，其中
    `Item = { id, name, label, state: 'loading'|'live'|'stale'|'error'|'disconnected', setup: 'claude-connect'|'claude-disconnect'|'open-workbuddy'|null, ring: { usedPct: number|null, level, dashed }, pill: [{ name, value, level }], card: { plan, account, note, balance: { text, level }|null, rows: Row[], tokens: boolean } }`
    `Row = { name, short, usedPct: number|null, level, reset, burn: { value, level, detail, projectedPct: number|null } }`；`level ∈ 'ok'|'warn'|'high'|'none'`。
  - `buildHudTokens(ledger) → { claude?, codex? }`：在账本序列上加 `perHour`（`1.2M/h`）、`perDay`（`29M / day`）、`totalText`（`31M tok`）。
  - `compact(n) → string`，`resetText(iso, now) → string`，`levelFor(usedPct)`。
  - `providerToUi(p)` 返回值新增 `planType`、`updatedAt`。

- [ ] **Step 1: 写失败的测试**

`tests/hud-view.test.mjs` 整个文件替换为：

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import view from '../src/main/hud-view.cjs';
import snapshots from '../src/main/snapshot.cjs';
import oauth from '../src/main/claude-oauth.cjs';

// Local Tuesday 13 October 2026, 08:00 — the same clock the tests' expected texts use.
const now = new Date(2026, 9, 13, 8, 0).getTime();
const at = minutes => new Date(now + minutes * 60000).toISOString();
const saturday = new Date(2026, 9, 17, 18, 27).toISOString();
const item = (ui, id) => view.buildHudItems(ui, now).find(entry => entry.id === id);
const codexRaw = remaining => ({ id: 'codex', name: 'Codex', status: 'healthy', precision: 'provider-reported', planType: 'pro', updatedAt: new Date(now).toISOString(), remainingPercent: remaining, windows: [{ label: '主窗口', remainingPercent: remaining, windowDurationMins: 300, resetsAt: at(72) }, { label: '周窗口', remainingPercent: 88, windowDurationMins: 10080, resetsAt: saturday }], models: [] });
const codex = remaining => snapshots.providerToUi(codexRaw(remaining));
function claude(usage, burns = []) {
  const raw = oauth.parseUsage(usage, 'max_20x', now);
  raw.groups[0].buckets.forEach((bucket, i) => { bucket.burnPerHour = burns[i] ?? null; });
  return snapshots.providerToUi(raw);
}
const wallet = (currency, amount) => snapshots.providerToUi({ id: 'deepseek', name: 'DeepSeek', status: 'healthy', precision: 'provider-reported', updatedAt: new Date(now).toISOString(), balances: [{ currency, total_balance: amount }], models: [] });

test('always five items in the video order, placeholders while nothing is read', () => {
  const items = view.buildHudItems({ providers: [] }, now);
  assert.deepEqual(items.map(entry => entry.id), ['codex', 'claude', 'antigravity', 'workbuddy', 'deepseek']);
  assert.deepEqual(items[0].ring, { usedPct: null, level: 'none', dashed: false });
  assert.equal(items[0].label, '–');
  assert.equal(items[0].state, 'loading');
  assert.deepEqual(items[0].pill, [{ name: '', value: 'Codex', level: 'none' }]);
});

test('ring shows the most used window, coloured by thresholds, with English rows', () => {
  const cases = [[31, 69, 'ok'], [30, 70, 'warn'], [11, 89, 'warn'], [10, 90, 'high'], [0, 100, 'high']];
  for (const [remaining, used, level] of cases) {
    const entry = item({ providers: [codex(remaining)] }, 'codex');
    assert.deepEqual(entry.ring, { usedPct: used, level, dashed: false }, `remaining ${remaining}`);
    assert.equal(entry.label, `${used}%`);
  }
  const entry = item({ providers: [codex(31)] }, 'codex');
  assert.deepEqual(entry.pill, [{ name: '5h', value: '69%', level: 'ok' }, { name: 'Weekly', value: '12%', level: 'ok' }]);
  assert.deepEqual(entry.card.rows.map(row => row.name), ['5h limit', 'Weekly limit']);
  assert.equal(entry.card.plan, 'Pro');
  assert.equal(entry.card.account, 'Current account');
  assert.equal(entry.card.tokens, true);
  assert.equal(entry.state, 'live');
});

test('Claude rows read like the video', () => {
  const entry = item({ providers: [claude({ five_hour: { utilization: 12, resets_at: at(72) }, seven_day: { utilization: 79, resets_at: saturday }, seven_day_opus: { utilization: 60, resets_at: saturday } })] }, 'claude');
  assert.equal(entry.name, 'Claude');
  assert.deepEqual(entry.card.rows.map(row => [row.name, row.usedPct, row.level, row.reset]), [
    ['Current session', 12, 'ok', '1h 12m'],
    ['Weekly', 79, 'warn', 'Sat 18:27'],
    ['Weekly limit · Opus', 60, 'ok', 'Sat 18:27'],
  ]);
  assert.deepEqual(entry.pill.map(p => `${p.name} ${p.value}`), ['5h 12%', 'Weekly 79%', 'Opus 60%']);
  assert.deepEqual(entry.ring, { usedPct: 79, level: 'warn', dashed: false });
  assert.equal(entry.card.plan, 'Max x20');
});

test('reset and burn text cover past, missing and exhausted windows', () => {
  assert.equal(view.resetText(at(72), now), '1h 12m');
  assert.equal(view.resetText(at(242), now), '4h 02m');
  assert.equal(view.resetText(at(51), now), '51m');
  assert.equal(view.resetText(at(0.5), now), '<1m');
  assert.equal(view.resetText(saturday, now), 'Sat 18:27');
  assert.equal(view.resetText(null, now), '—');
  assert.equal(view.resetText('bad', now), '—');
  assert.equal(view.resetText(at(-1), now), 'Pending update');

  const rates = item({ providers: [claude({ five_hour: { utilization: 12, resets_at: at(72) }, seven_day: { utilization: 79, resets_at: saturday }, seven_day_opus: { utilization: 60, resets_at: saturday } }, [6.3, 1.4, null])] }, 'claude');
  assert.deepEqual(rates.card.rows.map(row => [row.burn.value, row.burn.level, row.burn.detail]), [
    ['6.3%/h', 'ok', '20% by reset'],
    ['1.4%/h', 'warn', '23:00'],
    ['—', 'none', 'Insufficient data'],
  ]);
  assert.ok(Math.abs(rates.card.rows[0].burn.projectedPct - 19.56) < 0.01);

  const edges = item({ providers: [claude({ five_hour: { utilization: 100, resets_at: at(30) }, seven_day: { utilization: 10, resets_at: null } }, [5, 0])] }, 'claude');
  assert.deepEqual(edges.card.rows.map(row => row.burn.detail), ['Exhausted', 'No usage']);
  assert.equal(edges.card.rows[1].reset, '—');

  const stale = item({ providers: [{ ...codex(50), status: 'stale', updatedAt: new Date(now - 2 * 3600000).toISOString(), gauge: { ...codex(50).gauge, provenance: 'stale' } }] }, 'codex');
  assert.deepEqual(stale.card.rows.map(row => row.burn.detail), ['No estimate', 'No estimate']);
});

test('stale, failed and unconfigured providers are never drawn as 0%', () => {
  const stale = item({ providers: [{ ...codex(50), status: 'stale', updatedAt: new Date(now - 2 * 3600000).toISOString(), gauge: { ...codex(50).gauge, provenance: 'stale' } }] }, 'codex');
  assert.equal(stale.ring.dashed, true);
  assert.equal(stale.state, 'stale');
  assert.equal(stale.card.account, 'Last read 2h ago');
  assert.equal(stale.card.note, 'Showing the last reading.');

  const broken = item({ providers: [snapshots.providerToUi({ id: 'antigravity', name: 'Antigravity', status: 'error', models: [] })] }, 'antigravity');
  assert.deepEqual(broken.ring, { usedPct: null, level: 'none', dashed: false });
  assert.equal(broken.label, '–');
  assert.deepEqual(broken.pill, [{ name: '', value: 'Error', level: 'none' }]);
  assert.equal(broken.card.note, 'Could not read usage. Check sign-in or network.');
  assert.deepEqual(broken.card.rows, []);

  const missing = item({ providers: [snapshots.providerToUi({ id: 'deepseek', name: 'DeepSeek', status: 'disconnected', models: [] })] }, 'deepseek');
  assert.deepEqual(missing.pill, [{ name: '', value: 'Not connected', level: 'none' }]);
  assert.equal(missing.card.note, 'Set DEEPSEEK_API_KEY to read your balance.');
  assert.equal(missing.card.tokens, false);
});

test('balances use their own warning levels', () => {
  const low = item({ providers: [wallet('CNY', '8.85')] }, 'deepseek');
  assert.equal(low.label, '¥8.85');
  assert.deepEqual(low.ring, { usedPct: null, level: 'warn', dashed: false });
  assert.deepEqual(low.pill, [{ name: 'Balance', value: '¥8.85', level: 'warn' }]);
  assert.deepEqual(low.card.balance, { text: '¥8.85', level: 'warn' });
  assert.equal(item({ providers: [wallet('CNY', '20')] }, 'deepseek').ring.level, 'ok');
  assert.equal(item({ providers: [wallet('CNY', '0')] }, 'deepseek').ring.level, 'high');
  assert.equal(item({ providers: [wallet('USD', '1.5')] }, 'deepseek').label, '$1.50');
  assert.equal(item({ providers: [wallet('USD', '1.5')] }, 'deepseek').ring.level, 'warn');
});

test('balances that cannot be parsed stay unknown', () => {
  const odd = item({ providers: [wallet('EUR', '3')] }, 'deepseek');
  assert.equal(odd.label, '–');
  assert.deepEqual(odd.ring, { usedPct: null, level: 'none', dashed: false });
  assert.equal(odd.card.balance, null);
});

test('token data gets per-hour and per-day texts', () => {
  const buckets = new Array(96).fill(0);
  buckets.fill(300_000, 92);
  buckets[0] = 30_200_000;
  const tokens = view.buildHudTokens({ claude: { status: 'ok', buckets, total: 31_400_000, startAt: 0, partial: false, models: [], stacks: [] }, codex: { status: 'unsupported', buckets: new Array(96).fill(0), total: 0, startAt: 0, partial: false, models: [], stacks: [] } });
  assert.equal(tokens.claude.perHour, '1.2M/h');
  assert.equal(tokens.claude.perDay, '31M / day');
  assert.equal(tokens.claude.totalText, '31M tok');
  assert.equal(tokens.codex.perHour, '0/h');
  assert.deepEqual([950, 1234, 123456, 9_960_000, 2_500_000_000].map(view.compact), ['950', '1.2K', '123K', '10M', '2.5B']);
});
```

在 `tests/claude-oauth.test.mjs` 末尾追加（若文件里已有 `credentials` 夹具写法，照用；下面是独立版本）：

```js
test('the plan comes from the rate-limit tier when it names a Max size', async () => {
  const { mkdtemp, writeFile, mkdir } = await import('node:fs/promises');
  const path = (await import('node:path')).default;
  await mkdir('work', { recursive: true });
  const dir = await mkdtemp(path.resolve('work/oauth-plan-'));
  const cases = [[{ subscriptionType: 'max', rateLimitTier: 'default_claude_max_20x' }, 'max_20x'], [{ subscriptionType: 'max', rateLimitTier: 'default_claude_max_5x' }, 'max_5x'], [{ subscriptionType: 'pro', rateLimitTier: 'default_claude_ai' }, 'pro'], [{}, '']];
  for (const [fields, plan] of cases) {
    const file = path.join(dir, `${plan || 'none'}.json`);
    await writeFile(file, JSON.stringify({ claudeAiOauth: { accessToken: 'test-token', ...fields } }));
    assert.equal((await oauth.readCredentials(file)).plan, plan);
  }
});
```

- [ ] **Step 2: 运行确认失败**

Run: `node --test tests/hud-view.test.mjs tests/claude-oauth.test.mjs`
Expected: FAIL（顺序仍是旧的、文案是中文、`buildHudTokens is not a function`；若 `readCredentials` 未导出，报 `oauth.readCredentials is not a function`）。

- [ ] **Step 3: 改 `claude-oauth.cjs`**

`readCredentials` 里 `return { token: …, plan: … };` 改为：

```js
    const tier = typeof o.rateLimitTier === 'string' ? o.rateLimitTier : '';
    const plan = /max_20x/.test(tier) ? 'max_20x' : /max_5x/.test(tier) ? 'max_5x' : typeof o.subscriptionType === 'string' ? o.subscriptionType : '';
    return { token: o.accessToken, plan };
```

若 `module.exports` 里没有 `readCredentials`，加进去。

- [ ] **Step 4: 改 `snapshot.cjs` 的 `providerToUi`**

在返回对象的 `freshness,` 一行后加：

```js
    planType: provider.planType || '',
    updatedAt: provider.updatedAt || null,
```

- [ ] **Step 5: 替换 `src/main/hud-view.cjs` 整个文件**

```js
const { modelName } = require('./model-names.cjs');

const HUD_ORDER = ['codex', 'claude', 'antigravity', 'workbuddy', 'deepseek'];
const NAMES = { codex: 'Codex', claude: 'Claude', antigravity: 'Antigravity', workbuddy: 'WorkBuddy', deepseek: 'DeepSeek' };
const TOKEN_SOURCES = ['claude', 'codex'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const HOUR = 3_600_000;
const PLANS = { max_20x: 'Max x20', max_5x: 'Max x5', max: 'Max', pro: 'Pro', plus: 'Plus', free: 'Free', team: 'Team', business: 'Business', enterprise: 'Enterprise' };
const SETUP_NOTES = {
  codex: 'No Codex usage found. Sign in to Codex.',
  claude: 'Not connected. Sign in to Claude Code, or connect the statusLine in Settings.',
  antigravity: 'Antigravity is not running.',
  workbuddy: 'Sign in to WorkBuddy in Settings to read usage.',
  deepseek: 'Set DEEPSEEK_API_KEY to read your balance.',
};
const ROW_RANK = { '5h': 0, Weekly: 1 };
const pad = n => String(n).padStart(2, '0');
const clock = d => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

function levelFor(usedPct) {
  if (!Number.isFinite(usedPct)) return 'none';
  return usedPct >= 90 ? 'high' : usedPct >= 70 ? 'warn' : 'ok';
}

const usedOf = remaining => (Number.isFinite(remaining) ? Math.round(100 - Math.max(0, Math.min(100, remaining))) : null);

// The card shows the full window name, the capsule the short one.
function windowNames(providerId, label, pool) {
  const text = String(label || '');
  const model = /^每周 · (.+)$/.exec(text)?.[1];
  let name;
  let short;
  if (text === '5 小时') { name = providerId === 'claude' ? 'Current session' : '5h limit'; short = '5h'; }
  else if (text === '每周') { name = providerId === 'claude' ? 'Weekly' : 'Weekly limit'; short = 'Weekly'; }
  else if (model) { name = `Weekly limit · ${model}`; short = model; }
  else { name = text || 'Limit'; short = name; }
  return pool ? { name: `${pool} · ${short}`, short: `${pool} ${short}` } : { name, short };
}

const parseTime = iso => (typeof iso === 'string' ? Date.parse(iso) : NaN);

/** Under a day: a countdown (1h 12m, 51m, <1m); later: weekday and time (Sat 18:27). */
function resetText(iso, now) {
  const at = parseTime(iso);
  if (!Number.isFinite(at)) return '—';
  const left = at - now;
  if (left <= 0) return 'Pending update';
  if (left >= 24 * HOUR) { const d = new Date(at); return `${DAYS[d.getDay()]} ${clock(d)}`; }
  const minutes = Math.floor(left / 60000);
  if (minutes < 1) return '<1m';
  const hours = Math.floor(minutes / 60);
  return hours ? `${hours}h ${pad(minutes % 60)}m` : `${minutes}m`;
}

// A moment later today is just its time; another day gets its weekday.
function whenText(at, now) {
  const d = new Date(at);
  return d.toDateString() === new Date(now).toDateString() ? clock(d) : `${DAYS[d.getDay()]} ${clock(d)}`;
}

// Projected use at reset = used now + rate × hours left (12% + 6.3%/h × 1.2h ≈ 20% by reset).
function burnFor(w, usedPct, now, stale) {
  const rate = w.burnPerHour;
  const value = Number.isFinite(rate) ? `${Math.max(0, rate).toFixed(1)}%/h` : '—';
  const at = parseTime(w.resetsAt);
  if (stale || usedPct === null) return { value: '—', level: 'none', detail: 'No estimate', projectedPct: null };
  if (usedPct >= 100) return { value, level: 'high', detail: 'Exhausted', projectedPct: 100 };
  if (!Number.isFinite(rate)) return { value: '—', level: 'none', detail: 'Insufficient data', projectedPct: null };
  if (rate <= 0) return { value: '0.0%/h', level: 'ok', detail: 'No usage', projectedPct: usedPct };
  if (!Number.isFinite(at) || at <= now) return { value, level: 'ok', detail: 'No estimate', projectedPct: null };
  const projected = usedPct + rate * (at - now) / HOUR;
  if (projected < 100) return { value, level: 'ok', detail: `${Math.round(projected)}% by reset`, projectedPct: projected };
  return { value, level: 'warn', detail: whenText(now + (100 - usedPct) / rate * HOUR, now), projectedPct: 100 };
}

// Pools carry per-pool windows (Claude, Antigravity); otherwise use the gauge's windows (Codex).
function windowRows(provider, now, stale) {
  const pools = (provider.pools || []).filter(pool => pool.windows?.length);
  const windows = pools.length
    ? pools.flatMap(pool => pool.windows.map(w => ({ ...w, pool: pools.length > 1 ? pool.name : '' })))
    : (provider.gauge?.windows || []).map(w => ({ ...w, pool: '' }));
  return windows.map(w => {
    const usedPct = usedOf(w.remainingPercent);
    return { ...windowNames(provider.id, w.label, w.pool), usedPct, level: levelFor(usedPct), reset: resetText(w.resetsAt, now), burn: burnFor(w, usedPct, now, stale) };
  }).sort((a, b) => (ROW_RANK[a.short] ?? 2) - (ROW_RANK[b.short] ?? 2));
}

// "¥ 8.85" → ¥8.85, yellow at or below CNY 10 / USD 2, red at or below 0. Other currencies stay unknown.
function balanceOf(provider) {
  const match = /^([¥$])(-?\d+(?:\.\d+)?)$/.exec(String(provider.quotaHero || '').replace(/\s+/g, ''));
  if (!match) return null;
  const amount = Number(match[2]);
  const warnAt = match[1] === '$' ? 2 : 10;
  return { text: `${match[1]}${amount.toFixed(2)}`, level: amount <= 0 ? 'high' : amount <= warnAt ? 'warn' : 'ok' };
}

function planText(type) {
  const key = String(type || '').trim().toLowerCase();
  if (PLANS[key]) return PLANS[key];
  return String(type || '').trim().replace(/(^|[_\s-]+)([a-z])/g, (_, gap, letter) => `${gap ? ' ' : ''}${letter.toUpperCase()}`);
}

function agoText(iso, now) {
  const at = parseTime(iso);
  if (!Number.isFinite(at)) return 'Last read unknown';
  const minutes = Math.max(0, Math.floor((now - at) / 60000));
  if (minutes < 60) return `Last read ${minutes}m ago`;
  if (minutes < 1440) return `Last read ${Math.floor(minutes / 60)}h ago`;
  return `Last read ${Math.floor(minutes / 1440)}d ago`;
}

function stateOf(provider, gauge) {
  if (provider.status === 'error') return 'error';
  if (gauge.kind === 'unknown' || ['disconnected', 'unsupported'].includes(provider.status)) return 'disconnected';
  return gauge.provenance === 'stale' ? 'stale' : 'live';
}

function placeholder(id) {
  return {
    id, name: NAMES[id], label: '–', state: 'loading', setup: null,
    ring: { usedPct: null, level: 'none', dashed: false },
    pill: [{ name: '', value: NAMES[id], level: 'none' }],
    card: { plan: '', account: '', note: 'Reading…', balance: null, rows: [], tokens: TOKEN_SOURCES.includes(id) },
  };
}

function buildHudItems(ui, now = Date.now()) {
  const providers = new Map((ui?.providers || []).map(provider => [provider.id, provider]));
  return HUD_ORDER.map(id => {
    const p = providers.get(id);
    if (!p) return placeholder(id);
    const gauge = p.gauge || { kind: 'unknown', provenance: 'unknown' };
    const state = stateOf(p, gauge);
    const stale = state === 'stale';
    const rows = state === 'live' || stale ? windowRows(p, now, stale) : [];
    let ring = { usedPct: null, level: 'none', dashed: stale };
    let label = '–';
    let balance = null;
    if (gauge.kind === 'window' || gauge.kind === 'ratio') {
      const usedPct = usedOf(gauge.remainingPercent);
      ring = { usedPct, level: levelFor(usedPct), dashed: stale };
      if (usedPct !== null) label = `${usedPct}%`;
    } else if (gauge.kind === 'balance') {
      balance = balanceOf(p);
      if (balance) { ring = { usedPct: null, level: balance.level, dashed: stale }; label = balance.text; }
    }
    let pill;
    if (rows.length) pill = rows.map(row => ({ name: row.short, value: row.usedPct === null ? '—' : `${row.usedPct}%`, level: row.level }));
    else if (balance) pill = [{ name: 'Balance', value: balance.text, level: balance.level }];
    else if (gauge.kind === 'ratio' && ring.usedPct !== null) pill = [{ name: 'Used', value: label, level: ring.level }];
    else pill = [{ name: '', value: state === 'error' ? 'Error' : state === 'disconnected' ? 'Not connected' : NAMES[id], level: 'none' }];
    const note = state === 'error' ? 'Could not read usage. Check sign-in or network.'
      : state === 'disconnected' ? SETUP_NOTES[id]
        : stale ? 'Showing the last reading.' : '';
    return {
      id, name: NAMES[id], label, state, setup: p.setupAction || null, ring, pill,
      card: {
        plan: planText(p.planType),
        account: stale ? agoText(p.updatedAt, now) : state === 'live' ? 'Current account' : '',
        note, balance, rows, tokens: TOKEN_SOURCES.includes(id),
      },
    };
  });
}

/** 950, 1.2K, 123K, 1.2M, 31M, 2.5B: one decimal below ten, none above. */
function compact(n) {
  const value = Number.isFinite(n) ? Math.max(0, n) : 0;
  for (const [size, unit] of [[1e9, 'B'], [1e6, 'M'], [1e3, 'K']]) {
    if (value >= size) {
      const scaled = value / size;
      return `${scaled >= 10 ? Math.round(scaled) : Math.round(scaled * 10) / 10}${unit}`;
    }
  }
  return String(Math.round(value));
}

// The renderer only formats what it is given, so the texts for the `#` mode are made here.
function buildHudTokens(ledger) {
  const out = {};
  for (const id of TOKEN_SOURCES) {
    const series = ledger?.[id];
    if (!series) continue;
    const lastHour = (series.buckets || []).slice(-4).reduce((sum, n) => sum + n, 0);
    out[id] = {
      ...series,
      models: (series.models || []).map(model => ({ ...model, name: model.name || modelName(model.id) })),
      perHour: `${compact(lastHour)}/h`,
      perDay: `${compact(series.total)} / day`,
      totalText: `${compact(series.total)} tok`,
    };
  }
  return out;
}

module.exports = { HUD_ORDER, buildHudItems, buildHudTokens, compact, levelFor, resetText };
```

- [ ] **Step 6: `main.cjs` 推送前加文本**

`require('./hud-view.cjs')` 一行改为：

```js
const { buildHudItems, buildHudTokens } = require('./hud-view.cjs');
```

`performRefresh` 里的 token 一行改为：

```js
  tokenLedger?.read().then(tokens => hud?.pushTokens(buildHudTokens(tokens))).catch(() => {});
```

- [ ] **Step 7: 运行确认通过**

Run: `npm run check`
Expected: 全部 PASS。若 `tests/snapshot.test.mjs` 对 `providerToUi` 整体 `deepEqual` 而失败，在期望值里补上 `planType`、`updatedAt` 两个字段（值取输入里的对应字段，没有则 `''` / `null`）。

- [ ] **Step 8: Commit**

```bash
git add src/main/hud-view.cjs src/main/snapshot.cjs src/main/claude-oauth.cjs src/main/main.cjs tests/hud-view.test.mjs tests/claude-oauth.test.mjs tests/snapshot.test.mjs
git -c user.name=CHIWAWAFROMkk -c user.email=323616687+CHIWAWAFROMkk@users.noreply.github.com commit -m "feat: HUD 视图改英文，给出额度/速率/Token 三种模式与套餐档位

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: 浮条尺寸公式与点击判定（渲染层纯模块）

**Files:**
- Create: `src/renderer/hud-metrics.js`
- Test: `tests/hud-metrics.test.mjs`

**Interfaces:**
- Produces（页面里是 `window.HudMetrics`，Node 里是 `module.exports`）：
  - `CLICK_SLOP = 6`，`HOLD_MS = 300`
  - `metrics({ size, showsRings, showsNumbers, vertical }) → { logo, mark, font, spacing, gap, lead, trail, cross }`
  - `stripSize({ size, showsRings, showsNumbers, vertical, labelWidths: number[] }) → { width, height, radius, metrics }`
  - `isClick({ dx, dy, ms }) → boolean`

- [ ] **Step 1: 写失败的测试**

新建 `tests/hud-metrics.test.mjs`：

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import m from '../src/renderer/hud-metrics.js';

const labels = [40, 40, 22, 40, 50];

test('default metrics match Agent HUD at size 22', () => {
  assert.deepEqual(m.metrics({ size: 22, showsRings: true, showsNumbers: true, vertical: true }), { logo: 12, mark: 22, font: 13, spacing: 5, gap: 10, lead: 5, trail: 10, cross: 7 });
  assert.deepEqual(m.metrics({ size: 22, showsRings: true, showsNumbers: false, vertical: false }), { logo: 12, mark: 22, font: 13, spacing: 5, gap: 7, lead: 5, trail: 5, cross: 4 });
  assert.deepEqual(m.metrics({ size: 22, showsRings: false, showsNumbers: true, vertical: true }), { logo: 15, mark: 15, font: 13, spacing: 5, gap: 10, lead: 10, trail: 10, cross: 7 });
  assert.equal(m.metrics({ size: 16, showsRings: true, showsNumbers: true, vertical: true }).font, 9);
});

test('strip sizes for both orientations', () => {
  assert.deepEqual(stripOf({ vertical: true, showsNumbers: true }), { width: 92, height: 164, radius: 16 });
  assert.deepEqual(stripOf({ vertical: true, showsNumbers: false }), { width: 32, height: 164, radius: 16 });
  assert.deepEqual(stripOf({ vertical: false, showsNumbers: true }), { width: 5 + (22 + 5) * 5 + 192 + 40 + 10, height: 30, radius: 15 });
  assert.deepEqual(stripOf({ vertical: false, showsNumbers: false }), { width: 148, height: 30, radius: 15 });
  assert.deepEqual(m.stripSize({ size: 22, showsRings: true, showsNumbers: true, vertical: true, labelWidths: [] }).height, 32);
  const big = m.stripSize({ size: 40, showsRings: true, showsNumbers: true, vertical: true, labelWidths: labels.map(w => w * 2) });
  assert.deepEqual([big.width, big.height, big.radius], [8 + 40 + 9 + 100 + 18, 10 * 2 + 5 * 40 + 4 * 18, 29]);
});

test('a press is a click only when short and still', () => {
  assert.equal(m.isClick({ dx: 0, dy: 0, ms: 120 }), true);
  assert.equal(m.isClick({ dx: 4, dy: 4, ms: 299 }), true);
  assert.equal(m.isClick({ dx: 5, dy: 5, ms: 100 }), false);
  assert.equal(m.isClick({ dx: 0, dy: 0, ms: 301 }), false);
});

function stripOf({ vertical, showsNumbers }) {
  const { width, height, radius } = m.stripSize({ size: 22, showsRings: true, showsNumbers, vertical, labelWidths: labels });
  return { width, height, radius };
}
```

- [ ] **Step 2: 运行确认失败**

Run: `node --test tests/hud-metrics.test.mjs`
Expected: FAIL（`Cannot find module '../src/renderer/hud-metrics.js'`）

- [ ] **Step 3: 新建 `src/renderer/hud-metrics.js`**

```js
// Strip geometry from Agent HUD's SimpleMeter: every length derives from the ring size.
// Loaded as a plain script in the HUD page (window.HudMetrics) and required by the Node tests.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.HudMetrics = api;
})(typeof self !== 'undefined' ? self : this, () => {
  'use strict';
  const CLICK_SLOP = 6;
  const HOLD_MS = 300;
  const EMPTY_RUN = 32;

  function metrics({ size = 22, showsRings = true, showsNumbers = true, vertical = true } = {}) {
    const logo = Math.round(size * (showsRings ? 0.55 : 0.68));
    const tight = Math.max(3, Math.round(size * 0.18));
    const loose = Math.round(size * 0.45);
    const lead = showsRings ? tight + 1 : loose;
    return {
      logo,
      mark: showsRings ? size : logo,
      font: Math.max(9, Math.round(size * 0.59)),
      spacing: Math.round(size * 0.23),
      gap: Math.round(size * (showsNumbers || vertical ? 0.45 : 0.32)),
      lead,
      trail: showsNumbers ? loose : lead,
      cross: vertical ? tight + 3 : tight,
    };
  }

  // Vertical: numbers share one right-aligned column; horizontal: each number sits after its mark.
  function stripSize({ size = 22, showsRings = true, showsNumbers = true, vertical = true, labelWidths = [] } = {}) {
    const m = metrics({ size, showsRings, showsNumbers, vertical });
    const n = labelWidths.length;
    const labels = labelWidths.map(w => (showsNumbers ? Math.ceil(w) : 0));
    let width;
    let height;
    if (vertical) {
      width = m.lead + m.mark + (showsNumbers && n ? m.spacing + Math.max(...labels) : 0) + m.trail;
      height = n ? m.cross * 2 + n * m.mark + (n - 1) * m.gap : EMPTY_RUN;
    } else {
      width = n ? m.lead + labels.reduce((sum, w) => sum + m.mark + (showsNumbers ? m.spacing + w : 0), 0) + (n - 1) * m.gap + m.trail : EMPTY_RUN;
      height = m.cross * 2 + m.mark;
    }
    return { width, height, radius: Math.min(Math.round(size * 0.73), Math.min(width, height) / 2), metrics: m };
  }

  const isClick = ({ dx, dy, ms }) => Math.hypot(dx, dy) <= CLICK_SLOP && ms <= HOLD_MS;

  return { CLICK_SLOP, HOLD_MS, metrics, stripSize, isClick };
});
```

- [ ] **Step 4: 运行确认通过**

Run: `npm run check`
Expected: 全部 PASS。

- [ ] **Step 5: Commit**

```bash
git add src/renderer/hud-metrics.js tests/hud-metrics.test.mjs
git -c user.name=CHIWAWAFROMkk -c user.email=323616687+CHIWAWAFROMkk@users.noreply.github.com commit -m "feat: 浮条尺寸公式与点击判定（照 Agent HUD SimpleMeter）

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Task 5: 窗口几何、实时吸附拖动、设置与尺寸通道

**Files:**
- Modify: `src/main/hud-geometry.cjs`（整文件替换）, `src/main/hud-window.cjs`（整文件替换）
- Test: `tests/hud-geometry.test.mjs`（整文件替换）, `tests/hud-window.test.mjs`（整文件替换）

**Interfaces:**
- Consumes: Task 1 的 `onAction` / `ACTIONS` 白名单。
- Produces:
  - `hud-geometry.cjs` 导出 `DEFAULT_SETTINGS`、`DEFAULT_STRIPS`、`EDGES`、`MARGIN`、`WINDOW`、`layoutHud({ workArea, edge, offset, strips }) → { window: {x,y,width,height}, strip: {x,y,width,height}, edge }`、`snapToEdge({ workArea, cursor, grabAlong, strips, current }) → { edge, offset }`、`normalizeHudSettings(raw)`、`normalizeStrips(raw) → { vertical: {width,height}, horizontal: {width,height} } | null`、`normalizeHits`、`pointerOverHits`、`pickDisplay`。
  - 设置对象：`{ displayId, edge, offset, visible, size, ringWidth, showsRings, showsNumbers, metrics: { [providerId]: 'quota'|'burn'|'tokens' } }`。
  - `createHud({ settingsPath, onRefresh, onAction, onOpenStats, electron })`。
  - IPC：send `hud:hits`、`hud:drag`、`hud:card`、`hud:strips`；invoke `hud:initial → { items, tokens, layout, settings }`、`hud:refresh`、`hud:action`、`hud:settings(patch) → displaySettings`、`hud:open-stats`；push `hud:state`、`hud:tokens`、`hud:layout`（`{ edge, strip: {x,y,width,height}, size: {width,height}, dragging }`）、`hud:settings`（`{ size, ringWidth, showsRings, showsNumbers, metrics }`）。
  - `patch` 只接受 `size`、`ringWidth`、`showsRings`、`showsNumbers`、`metrics`（与已有值合并）以及 `resetPosition: true`。

> 过渡说明：本任务结束时旧的 `hud.js` 仍用自己的常量定位浮条，右边停靠时会离边缘一段距离；Task 6 重写渲染层后恢复。冒烟脚本只检查条目数，不受影响。

- [ ] **Step 1: 写失败的测试（几何）**

`tests/hud-geometry.test.mjs` 整个文件替换为：

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import geometry from '../src/main/hud-geometry.cjs';

const { DEFAULT_STRIPS, layoutHud, normalizeHudSettings, normalizeStrips, pickDisplay, snapToEdge } = geometry;
const wa = { x: 0, y: 0, width: 1920, height: 1040 };
const big = { vertical: { width: 160, height: 420 }, horizontal: { width: 700, height: 60 } };

test('layout docks the reported strip 3px from each edge, inside a 640×600 window', () => {
  assert.deepEqual(layoutHud({ workArea: wa, edge: 'right', offset: 0.3 }), { window: { x: 1280, y: 45, width: 640, height: 600 }, strip: { x: 545, y: 218, width: 92, height: 164 }, edge: 'right' });
  assert.deepEqual(layoutHud({ workArea: wa, edge: 'left', offset: 0 }).strip, { x: 3, y: 0, width: 92, height: 164 });
  assert.deepEqual(layoutHud({ workArea: wa, edge: 'top', offset: 1, strips: { ...DEFAULT_STRIPS, horizontal: { width: 390, height: 30 } } }), { window: { x: 1280, y: 0, width: 640, height: 600 }, strip: { x: 250, y: 3, width: 390, height: 30 }, edge: 'top' });
  const bottom = layoutHud({ workArea: wa, edge: 'bottom', offset: 0.5, strips: big });
  assert.equal(bottom.window.width, 716, 'a long horizontal strip widens the window');
  assert.equal(bottom.strip.y + bottom.strip.height, bottom.window.height - 3);
});

test('large strips stay inside the window and the work area', () => {
  const second = { x: -1280, y: 0, width: 1280, height: 1024 };
  const cases = [[wa, big], [second, big], [wa, DEFAULT_STRIPS], [{ x: 0, y: 0, width: 400, height: 300 }, DEFAULT_STRIPS]];
  for (const [area, strips] of cases) {
    for (const edge of geometry.EDGES) {
      for (const offset of [0, 0.25, 0.5, 1]) {
        const { window, strip } = layoutHud({ workArea: area, edge, offset, strips });
        const label = `${JSON.stringify(area)} ${edge} ${offset}`;
        assert.ok(strip.x >= 0 && strip.y >= 0 && strip.x + strip.width <= window.width && strip.y + strip.height <= window.height, label);
        assert.ok(window.x >= area.x && window.y >= area.y && window.x + window.width <= area.x + area.width && window.y + window.height <= area.y + area.height, label);
        const gap = { left: strip.x, right: window.width - strip.x - strip.width, top: strip.y, bottom: window.height - strip.y - strip.height }[edge];
        const flush = { left: window.x - area.x, right: area.x + area.width - window.x - window.width, top: window.y - area.y, bottom: area.y + area.height - window.y - window.height }[edge];
        assert.equal(gap + flush, 3, `${label} stays 3px off the edge`);
      }
    }
  }
});

test('snap follows the pointer to the nearest edge and keeps the grabbed point under it', () => {
  assert.deepEqual(snapToEdge({ workArea: wa, cursor: { x: 1910, y: 300 }, grabAlong: 82 }), { edge: 'right', offset: (300 - 82) / (1040 - 164) });
  const top = snapToEdge({ workArea: wa, cursor: { x: 900, y: 5 }, grabAlong: 37, strips: DEFAULT_STRIPS });
  assert.equal(top.edge, 'top');
  assert.ok(Math.abs(top.offset - (900 - 37) / (1920 - DEFAULT_STRIPS.horizontal.width)) < 1e-9);
  assert.deepEqual(snapToEdge({ workArea: wa, cursor: { x: 0, y: 0 }, grabAlong: 0, current: 'top' }).edge, 'top', 'a tie keeps the current edge');
  assert.deepEqual(snapToEdge({ workArea: wa, cursor: { x: 0, y: 0 }, grabAlong: 0 }).edge, 'left');
  assert.deepEqual(snapToEdge({ workArea: wa, cursor: { x: -500, y: 2000 }, grabAlong: 9999 }), { edge: 'left', offset: 1 });
  assert.deepEqual(snapToEdge({ workArea: wa, cursor: { x: 2, y: 10 }, grabAlong: 500 }), { edge: 'left', offset: 0 });
});

test('settings are validated and fall back to defaults', () => {
  assert.deepEqual(normalizeHudSettings(null), { ...geometry.DEFAULT_SETTINGS, metrics: {} });
  assert.deepEqual(normalizeHudSettings([1]), { ...geometry.DEFAULT_SETTINGS, metrics: {} });
  assert.deepEqual(normalizeHudSettings({ displayId: 7, edge: 'top', offset: 0.2, visible: false, size: 30, ringWidth: 2.3, showsRings: false, showsNumbers: false, metrics: { claude: 'burn', codex: 'tokens' } }),
    { displayId: 7, edge: 'top', offset: 0.2, visible: false, size: 30, ringWidth: 2.5, showsRings: false, showsNumbers: false, metrics: { codex: 'tokens', claude: 'burn' } });
});

test('settings with junk values fall back to defaults', () => {
  const junk = normalizeHudSettings({ displayId: 1.5, edge: 'middle', offset: 5, visible: 'yes', size: 'big', ringWidth: 9, showsRings: 'no', showsNumbers: 1, metrics: { codex: 'x', claude: 'tokens', __proto__: { deepseek: 'burn' }, evil: 'burn' } });
  assert.deepEqual(junk, { displayId: null, edge: 'right', offset: 1, visible: true, size: 22, ringWidth: 1.5, showsRings: true, showsNumbers: true, metrics: { claude: 'tokens' } });
  assert.equal(normalizeHudSettings({ size: 16.5 }).size, 22);
  assert.equal(normalizeHudSettings({ size: 41 }).size, 22);
  assert.deepEqual(normalizeHudSettings({ metrics: ['burn'] }).metrics, {});
});

test('strip sizes from the renderer are validated', () => {
  assert.deepEqual(normalizeStrips({ vertical: { width: 91.2, height: 164 }, horizontal: { width: 382, height: 30 } }), { vertical: { width: 92, height: 164 }, horizontal: { width: 382, height: 30 } });
  for (const bad of [null, 'x', { vertical: { width: 92, height: 164 } }, { vertical: { width: 0, height: 164 }, horizontal: { width: 382, height: 30 } }, { vertical: { width: 92, height: 5000 }, horizontal: { width: 382, height: 30 } }, { vertical: { width: '92', height: 164 }, horizontal: { width: 382, height: 30 } }]) {
    assert.equal(normalizeStrips(bad), null, JSON.stringify(bad));
  }
});

test('a removed display falls back to the primary one', () => {
  const primary = { id: 1, workArea: wa };
  const other = { id: 2, workArea: wa };
  assert.equal(pickDisplay([primary, other], primary, 2), other);
  assert.equal(pickDisplay([primary], primary, 2), primary);
  assert.equal(pickDisplay([primary], primary, null), primary);
});

test('hit rectangles from the renderer are validated', () => {
  assert.deepEqual(geometry.normalizeHits('nope'), []);
  assert.deepEqual(geometry.normalizeHits([{ x: 1, y: 2, width: 3, height: 4, extra: 1 }, { x: NaN, y: 0, width: 1, height: 1 }, { x: 0, y: 0, width: 0, height: 5 }, null]), [{ x: 1, y: 2, width: 3, height: 4 }]);
  assert.equal(geometry.normalizeHits(Array.from({ length: 10 }, () => ({ x: 0, y: 0, width: 1, height: 1 }))).length, 4);
});

test('the pointer is over a hit area only inside its rectangle plus a small margin', () => {
  const bounds = { x: 1280, y: 45, width: 640, height: 600 };
  const hits = [{ x: 545, y: 218, width: 92, height: 164 }];
  assert.equal(geometry.pointerOverHits({ cursor: { x: 1280 + 550, y: 45 + 250 }, bounds, hits }), true);
  assert.equal(geometry.pointerOverHits({ cursor: { x: 1280 + 544, y: 45 + 250 }, bounds, hits }), true);
  assert.equal(geometry.pointerOverHits({ cursor: { x: 1280 + 100, y: 45 + 100 }, bounds, hits }), false);
  assert.equal(geometry.pointerOverHits({ cursor: { x: 1280 + 550, y: 45 + 250 }, bounds, hits: [] }), false);
});
```

- [ ] **Step 2: 写失败的测试（窗口）**

`tests/hud-window.test.mjs` 整个文件替换为：

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import hudWindow from '../src/main/hud-window.cjs';

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

class Emitter {
  constructor() { this.handlers = {}; }
  on(name, fn) { (this.handlers[name] ||= []).push(fn); return this; }
  once(name, fn) { return this.on(name, fn); }
  emit(name, ...args) { for (const fn of this.handlers[name] || []) fn(...args); }
  removeListener() { return this; }
}

// Just enough of BrowserWindow / ipcMain / screen to drive hud-window.cjs without a real window.
function fakeElectron() {
  const workArea = { x: 0, y: 0, width: 1920, height: 1040 };
  const display = { id: 1, workArea };
  let cursor = { x: 1900, y: 400 };
  const windows = [];
  class BrowserWindow extends Emitter {
    constructor(options) {
      super();
      this.focusable = options.focusable;
      this.ignore = null;
      this.boundsSet = 0;
      this.loads = 0;
      this.bounds = { x: 0, y: 0, width: options.width, height: options.height };
      this.destroyed = false;
      this.sent = [];
      this.webContents = Object.assign(new Emitter(), {
        mainFrame: { url: pathToFileURL(path.resolve('src/renderer/hud.html')).href },
        session: { setPermissionRequestHandler() {}, setPermissionCheckHandler() {} },
        setWindowOpenHandler() {},
        send: (channel, payload) => { this.sent.push([channel, payload]); },
      });
      windows.push(this);
    }
    setAlwaysOnTop() {}
    setIgnoreMouseEvents(flag) { this.ignore = flag; }
    setFocusable(flag) { this.focusable = flag; }
    focus() {}
    showInactive() {}
    hide() {}
    isDestroyed() { return this.destroyed; }
    setBounds(bounds) { this.bounds = { ...bounds }; this.boundsSet++; }
    getBounds() { return { ...this.bounds }; }
    isVisible() { return true; }
    loadFile() { this.loads++; return Promise.resolve(); }
    destroy() { this.destroyed = true; }
    last(channel) { return this.sent.filter(([name]) => name === channel).at(-1)?.[1]; }
  }
  const ipc = { on: {}, handle: {} };
  const ipcMain = {
    on(channel, fn) { ipc.on[channel] = fn; },
    handle(channel, fn) { ipc.handle[channel] = fn; },
    removeAllListeners() {},
    removeHandler() {},
  };
  const screen = Object.assign(new Emitter(), {
    getAllDisplays: () => [display],
    getPrimaryDisplay: () => display,
    getCursorScreenPoint: () => cursor,
    getDisplayNearestPoint: () => display,
  });
  return { electron: { BrowserWindow, ipcMain, screen }, ipc, windows, moveCursor(x, y) { cursor = { x, y }; } };
}

async function settingsPath() {
  await mkdir('work', { recursive: true });
  return path.join(await mkdtemp(path.resolve('work/hud-window-test-')), 'hud-settings.json');
}

async function setup(options = {}) {
  const fake = fakeElectron();
  const file = await settingsPath();
  const hud = hudWindow.createHud({ settingsPath: file, onRefresh: async () => {}, electron: fake.electron, ...options });
  const win = fake.windows[0];
  win.webContents.emit('did-finish-load');
  return { fake, hud, win, file, event: { sender: win.webContents, senderFrame: win.webContents.mainFrame } };
}

test('a renderer crash ends the drag and restores click-through and focus before reloading', async () => {
  const { fake, hud, win, event } = await setup();
  fake.ipc.on['hud:card'](event, true);
  fake.moveCursor(1830, 300);
  fake.ipc.on['hud:drag'](event, 'start');
  assert.equal(win.ignore, false);
  assert.equal(win.focusable, true);

  win.webContents.emit('render-process-gone', {}, { reason: 'crashed' });
  assert.equal(win.ignore, true, 'click-through restored');
  assert.equal(win.focusable, false, 'card focus released');
  const set = win.boundsSet;
  fake.moveCursor(10, 500);
  await sleep(80);
  assert.equal(win.boundsSet, set, 'drag timer stopped');
  await sleep(300);
  assert.equal(win.loads, 2, 'renderer reloaded once');
  hud.destroy();
});

test('untrusted senders cannot drive the HUD', async () => {
  const { fake, hud, win } = await setup({ onAction: async () => assert.fail('action ran') });
  const alien = { sender: {}, senderFrame: win.webContents.mainFrame };
  fake.ipc.on['hud:hits'](alien, [{ x: 0, y: 0, width: 640, height: 600 }]);
  fake.ipc.on['hud:strips'](alien, { vertical: { width: 300, height: 300 }, horizontal: { width: 300, height: 300 } });
  fake.ipc.on['hud:drag'](alien, 'start');
  await sleep(100);
  fake.ipc.on['hud:card'](alien, true);
  assert.equal(win.ignore, true);
  assert.equal(win.focusable, false);
  assert.equal(win.last('hud:layout').strip.width, 92);
  for (const channel of ['hud:initial', 'hud:settings', 'hud:open-stats', 'hud:action']) assert.throws(() => fake.ipc.handle[channel](alien, 'claude-help'), /不可信/, channel);
  hud.destroy();
});

test('the main process drops click-through only while the cursor is over a reported hit area', async () => {
  const { fake, hud, win, event } = await setup();
  fake.ipc.on['hud:hits'](event, [{ x: 545, y: 218, width: 92, height: 164 }]);
  fake.moveCursor(1280 + 550, 45 + 250);
  await sleep(120);
  assert.equal(win.ignore, false, 'over the strip');
  fake.moveCursor(1280 + 100, 45 + 100);
  await sleep(120);
  assert.equal(win.ignore, true, 'over the transparent area');
  fake.ipc.on['hud:hits'](event, 'garbage');
  fake.moveCursor(1280 + 550, 45 + 250);
  await sleep(120);
  assert.equal(win.ignore, true, 'invalid hits mean nothing to hit');
  hud.destroy();
});

test('dragging snaps live to the edge nearest the pointer and saves on release', async () => {
  const { fake, hud, win, event, file } = await setup();
  fake.moveCursor(1830, 300);
  fake.ipc.on['hud:drag'](event, 'start');
  assert.equal(win.last('hud:layout').dragging, true);
  fake.moveCursor(900, 5);
  await sleep(60);
  const live = win.last('hud:layout');
  assert.equal(live.edge, 'top');
  assert.equal(live.dragging, true);
  assert.equal(win.bounds.y, 0);
  await assert.rejects(readFile(file, 'utf8'), 'nothing saved mid-drag');
  fake.ipc.on['hud:drag'](event, 'end');
  const saved = JSON.parse(await readFile(file, 'utf8'));
  assert.equal(saved.edge, 'top');
  assert.ok(Math.abs(saved.offset - (900 - 37) / (1920 - 390)) < 1e-9);
  assert.equal(win.last('hud:layout').dragging, false);
  hud.destroy();
});

test('settings patches are filtered, normalised, saved and pushed', async () => {
  const { fake, hud, win, event, file } = await setup();
  const result = await fake.ipc.handle['hud:settings'](event, { size: 30, showsNumbers: false, metrics: { claude: 'burn', codex: 'bogus' }, edge: 'left', visible: false });
  assert.deepEqual(result, { size: 30, ringWidth: 1.5, showsRings: true, showsNumbers: false, metrics: { claude: 'burn' } });
  assert.deepEqual(win.last('hud:settings'), result);
  assert.equal(win.last('hud:layout').edge, 'right', 'position is not a setting');
  const saved = JSON.parse(await readFile(file, 'utf8'));
  assert.equal(saved.size, 30);
  assert.equal(saved.visible, true);
  await fake.ipc.handle['hud:settings'](event, { metrics: { codex: 'tokens' } });
  assert.deepEqual(win.last('hud:settings').metrics, { claude: 'burn', codex: 'tokens' }, 'metrics merge');
  fake.moveCursor(1830, 300);
  fake.ipc.on['hud:drag'](event, 'start');
  fake.moveCursor(10, 500);
  await sleep(60);
  fake.ipc.on['hud:drag'](event, 'end');
  assert.equal(win.last('hud:layout').edge, 'left');
  await fake.ipc.handle['hud:settings'](event, { resetPosition: true });
  assert.equal(win.last('hud:layout').edge, 'right');
  assert.deepEqual((await fake.ipc.handle['hud:initial'](event)).settings.metrics, { claude: 'burn', codex: 'tokens' });
  hud.destroy();
});

test('the reported strip size re-lays out the window; garbage is ignored', async () => {
  const { fake, hud, win, event } = await setup();
  fake.ipc.on['hud:strips'](event, { vertical: { width: 120, height: 200 }, horizontal: { width: 400, height: 40 } });
  // offset 0.3 → strip top at round(0.3 × (1040 − 200)) = 252; window top = 252 + 100 − 300 = 52.
  assert.deepEqual(win.last('hud:layout').strip, { x: 640 - 3 - 120, y: 252 - 52, width: 120, height: 200 });
  const count = win.sent.length;
  fake.ipc.on['hud:strips'](event, { vertical: { width: -1, height: 200 } });
  fake.ipc.on['hud:strips'](event, { vertical: { width: 120, height: 200 }, horizontal: { width: 400, height: 40 } });
  assert.equal(win.sent.length, count, 'nothing re-sent');
  hud.destroy();
});

test('setup actions run only for the HUD page and only from the whitelist', async () => {
  const ran = [];
  const { fake, hud, win, event } = await setup({ onAction: async name => { ran.push(name); return { status: 'ok' }; } });
  assert.deepEqual(await fake.ipc.handle['hud:action'](event, 'claude-connect'), { status: 'ok' });
  assert.throws(() => fake.ipc.handle['hud:action'](event, 'collab:run'), /未知操作/);
  assert.throws(() => fake.ipc.handle['hud:action'](event, { toString: () => 'claude-help' }), /未知操作/);
  assert.throws(() => fake.ipc.handle['hud:action']({ sender: {}, senderFrame: win.webContents.mainFrame }, 'claude-help'), /不可信/);
  assert.deepEqual(ran, ['claude-connect']);
  assert.equal(fake.ipc.handle['hud:open-panel'], undefined);
  hud.destroy();
});

test('the stats button reaches the main process', async () => {
  let opened = 0;
  const { fake, hud, event } = await setup({ onOpenStats: () => { opened++; } });
  assert.equal(await fake.ipc.handle['hud:open-stats'](event), true);
  assert.equal(opened, 1);
  hud.destroy();
});
```

- [ ] **Step 3: 运行确认失败**

Run: `node --test tests/hud-geometry.test.mjs tests/hud-window.test.mjs`
Expected: FAIL（`normalizeStrips` 等不存在，`hud:strips` / `hud:settings` 处理器不存在）。

- [ ] **Step 4: 替换 `src/main/hud-geometry.cjs` 整个文件**

```js
const MARGIN = 3;
// Big enough for the strip at size 40 plus a 6px gap and the 440px card.
const WINDOW = Object.freeze({ width: 640, height: 600 });
const EDGES = ['left', 'right', 'top', 'bottom'];
const PROVIDERS = ['codex', 'claude', 'antigravity', 'workbuddy', 'deepseek'];
const METRICS = ['quota', 'burn', 'tokens'];
// Size 22 with numbers and five items; used until the renderer reports what it measured.
const DEFAULT_STRIPS = Object.freeze({ vertical: Object.freeze({ width: 92, height: 164 }), horizontal: Object.freeze({ width: 390, height: 30 }) });
const DEFAULT_SETTINGS = Object.freeze({ displayId: null, edge: 'right', offset: 0.3, visible: true, size: 22, ringWidth: 1.5, showsRings: true, showsNumbers: true, metrics: Object.freeze({}) });

const clamp = (value, low, high) => Math.min(high, Math.max(low, value));
const isVertical = edge => edge === 'left' || edge === 'right';
const isPlainObject = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

function normalizeHudSettings(raw) {
  const r = isPlainObject(raw) ? raw : {};
  const metrics = {};
  if (isPlainObject(r.metrics)) for (const id of PROVIDERS) if (Object.hasOwn(r.metrics, id) && METRICS.includes(r.metrics[id])) metrics[id] = r.metrics[id];
  return {
    displayId: Number.isSafeInteger(r.displayId) ? r.displayId : null,
    edge: EDGES.includes(r.edge) ? r.edge : DEFAULT_SETTINGS.edge,
    offset: Number.isFinite(r.offset) ? clamp(r.offset, 0, 1) : DEFAULT_SETTINGS.offset,
    visible: typeof r.visible === 'boolean' ? r.visible : DEFAULT_SETTINGS.visible,
    size: Number.isInteger(r.size) && r.size >= 16 && r.size <= 40 ? r.size : DEFAULT_SETTINGS.size,
    ringWidth: Number.isFinite(r.ringWidth) && r.ringWidth >= 1 && r.ringWidth <= 4 ? Math.round(r.ringWidth * 2) / 2 : DEFAULT_SETTINGS.ringWidth,
    showsRings: typeof r.showsRings === 'boolean' ? r.showsRings : DEFAULT_SETTINGS.showsRings,
    showsNumbers: typeof r.showsNumbers === 'boolean' ? r.showsNumbers : DEFAULT_SETTINGS.showsNumbers,
    metrics,
  };
}

/** Strip sizes the renderer measured for both orientations, or null when either is unusable. */
function normalizeStrips(raw) {
  const one = s => (isPlainObject(s) && [s.width, s.height].every(v => typeof v === 'number' && Number.isFinite(v) && v >= 8 && v <= 1200)
    ? { width: Math.ceil(s.width), height: Math.ceil(s.height) } : null);
  if (!isPlainObject(raw)) return null;
  const vertical = one(raw.vertical);
  const horizontal = one(raw.horizontal);
  return vertical && horizontal ? { vertical, horizontal } : null;
}

/** Window rectangle in screen coordinates, and the strip's rectangle inside it. */
function layoutHud({ workArea: wa, edge, offset, strips = DEFAULT_STRIPS }) {
  const vertical = isVertical(edge);
  const strip = vertical ? strips.vertical : strips.horizontal;
  const width = Math.min(wa.width, Math.max(WINDOW.width, vertical ? 0 : strip.width + 16));
  const height = Math.min(wa.height, Math.max(WINDOW.height, vertical ? strip.height + 16 : 0));
  const along = clamp(Number.isFinite(offset) ? offset : DEFAULT_SETTINGS.offset, 0, 1);
  let sx; let sy; let wx; let wy;
  if (vertical) {
    sy = Math.round(wa.y + along * Math.max(0, wa.height - strip.height));
    sx = edge === 'left' ? wa.x + MARGIN : wa.x + wa.width - MARGIN - strip.width;
    wx = edge === 'left' ? wa.x : wa.x + wa.width - width;
    wy = Math.round(clamp(sy + strip.height / 2 - height / 2, wa.y, wa.y + wa.height - height));
  } else {
    sx = Math.round(wa.x + along * Math.max(0, wa.width - strip.width));
    sy = edge === 'top' ? wa.y + MARGIN : wa.y + wa.height - MARGIN - strip.height;
    wy = edge === 'top' ? wa.y : wa.y + wa.height - height;
    wx = Math.round(clamp(sx + strip.width / 2 - width / 2, wa.x, wa.x + wa.width - width));
  }
  return { window: { x: wx, y: wy, width, height }, strip: { x: sx - wx, y: sy - wy, width: strip.width, height: strip.height }, edge };
}

/**
 * Edge nearest the pointer (a tie keeps `current`) and the position along it that keeps
 * the grabbed point — `grabAlong` px from the strip's start — under the pointer.
 */
function snapToEdge({ workArea: wa, cursor, grabAlong = 0, strips = DEFAULT_STRIPS, current = null }) {
  const px = clamp(cursor.x, wa.x, wa.x + wa.width);
  const py = clamp(cursor.y, wa.y, wa.y + wa.height);
  const distance = { left: px - wa.x, right: wa.x + wa.width - px, top: py - wa.y, bottom: wa.y + wa.height - py };
  let edge = EDGES.reduce((best, candidate) => (distance[candidate] < distance[best] ? candidate : best), EDGES[0]);
  if (EDGES.includes(current) && distance[current] === distance[edge]) edge = current;
  const vertical = isVertical(edge);
  const strip = vertical ? strips.vertical : strips.horizontal;
  const long = vertical ? strip.height : strip.width;
  const start = (vertical ? py - wa.y : px - wa.x) - clamp(grabAlong, 0, long);
  const room = (vertical ? wa.height : wa.width) - long;
  return { edge, offset: room > 0 ? clamp(start / room, 0, 1) : 0 };
}

/** Hit rectangles (window-relative px) reported by the renderer, validated; at most four. */
function normalizeHits(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, 4)
    .filter(r => r && typeof r === 'object' && ['x', 'y', 'width', 'height'].every(key => Number.isFinite(r[key])) && r.width > 0 && r.height > 0 && r.width <= 4096 && r.height <= 4096)
    .map(r => ({ x: r.x, y: r.y, width: r.width, height: r.height }));
}

/** Whether a screen point lies over a hit rectangle of the window at `bounds`, give or take `margin`. */
function pointerOverHits({ cursor, bounds, hits, margin = 2 }) {
  const x = cursor.x - bounds.x;
  const y = cursor.y - bounds.y;
  return hits.some(r => x >= r.x - margin && x <= r.x + r.width + margin && y >= r.y - margin && y <= r.y + r.height + margin);
}

/** The saved display if it is still connected, otherwise the primary one. */
function pickDisplay(displays, primary, displayId) {
  return displays.find(display => display.id === displayId) || primary;
}

module.exports = { DEFAULT_SETTINGS, DEFAULT_STRIPS, EDGES, MARGIN, WINDOW, layoutHud, normalizeHits, normalizeHudSettings, normalizeStrips, pickDisplay, pointerOverHits, snapToEdge };
```

- [ ] **Step 5: 替换 `src/main/hud-window.cjs` 整个文件**

```js
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { isTrustedRenderer } = require('./security.cjs');
const { DEFAULT_SETTINGS, DEFAULT_STRIPS, WINDOW, layoutHud, normalizeHits, normalizeHudSettings, normalizeStrips, pickDisplay, pointerOverHits, snapToEdge } = require('./hud-geometry.cjs');

const hudEntry = path.join(__dirname, '..', 'renderer', 'hud.html');
const DRAG_LIMIT_MS = 60_000;
const DRAG_TICK_MS = 16;
// On Windows only 'normal' and 'pop-up-menu'+ make the window topmost; 'floating' (the default) does not.
const TOP_LEVEL = 'normal';
// Forwarded mouse events flap between enter and leave on Windows, so the main process
// decides click-through itself by polling the cursor against the rectangles the page reports.
const POLL_MS = 40;
const ACTIONS = ['claude-connect', 'claude-disconnect', 'claude-help', 'open-workbuddy'];
const SETTING_KEYS = ['size', 'ringWidth', 'showsRings', 'showsNumbers', 'metrics'];
const SEND_CHANNELS = ['hud:hits', 'hud:drag', 'hud:card', 'hud:strips'];
const INVOKE_CHANNELS = ['hud:initial', 'hud:refresh', 'hud:action', 'hud:settings', 'hud:open-stats'];

function loadSettings(file) {
  try { return normalizeHudSettings(JSON.parse(fs.readFileSync(file, 'utf8'))); }
  catch { return normalizeHudSettings(null); }
}

function saveSettings(file, settings) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(settings), 'utf8');
    fs.renameSync(temporary, file);
  } catch { /* a lost position is not worth interrupting the HUD */ }
}

// What the page draws from; position and visibility stay in the main process.
const displaySettings = s => ({ size: s.size, ringWidth: s.ringWidth, showsRings: s.showsRings, showsNumbers: s.showsNumbers, metrics: { ...s.metrics } });

// `electron` is injectable so tests can drive the window logic with fakes.
function createHud({ settingsPath, onRefresh, onAction = async () => ({ status: 'ignored' }), onOpenStats = () => {}, electron = require('electron') }) {
  const { BrowserWindow, ipcMain, screen } = electron;
  let settings = loadSettings(settingsPath);
  let win = null;
  let layout = null;
  let strips = DEFAULT_STRIPS;
  let items = [];
  let tokens = null;
  let drag = null;
  let ignoring = null;
  let recoveries = [];
  let hits = [];
  let poll = null;

  const alive = () => win && !win.isDestroyed();
  const send = (channel, payload) => { try { if (alive()) win.webContents.send(channel, payload); } catch { /* renderer restarting */ } };
  const layoutMessage = () => (layout ? { edge: layout.edge, strip: layout.strip, size: { width: layout.window.width, height: layout.window.height }, dragging: Boolean(drag) } : null);
  const trusted = event => alive() && event.sender === win.webContents && event.senderFrame === win.webContents.mainFrame && isTrustedRenderer(event.senderFrame.url, hudEntry);

  function setIgnore(flag) {
    if (!alive() || ignoring === flag) return;
    ignoring = flag;
    if (flag) win.setIgnoreMouseEvents(true, { forward: true });
    else win.setIgnoreMouseEvents(false);
  }

  // Windows drops a topmost flag set before the first show, so set it again on every reveal.
  function reveal() {
    if (!alive()) return;
    win.showInactive();
    win.setAlwaysOnTop(true, TOP_LEVEL);
  }

  // Lay the window out for the current settings; tell the page whenever what it draws from changed.
  function place(force = false) {
    if (!alive()) return;
    const display = pickDisplay(screen.getAllDisplays(), screen.getPrimaryDisplay(), settings.displayId);
    const next = layoutHud({ workArea: display.workArea, edge: settings.edge, offset: settings.offset, strips });
    const moved = !layout || JSON.stringify(next.window) !== JSON.stringify(layout.window);
    const changed = moved || JSON.stringify(next) !== JSON.stringify(layout);
    layout = next;
    if (moved) win.setBounds(layout.window, false);
    if (changed || force) send('hud:layout', layoutMessage());
  }

  // A new renderer starts with no press, no open card and the pointer outside;
  // put the window back to match before it loads, or a drag or card could outlive it.
  function resetInteraction() {
    if (drag) { clearInterval(drag.timer); drag = null; }
    hits = [];
    if (!alive()) return;
    setIgnore(true);
    win.setFocusable(false);
    place(true);
  }

  function trackPointer() {
    if (!alive() || drag || !win.isVisible()) return;
    setIgnore(!pointerOverHits({ cursor: screen.getCursorScreenPoint(), bounds: win.getBounds(), hits }));
  }

  // Every tick the strip jumps to the edge nearest the pointer, keeping the grabbed point under it.
  function follow() {
    const cursor = screen.getCursorScreenPoint();
    const display = screen.getDisplayNearestPoint(cursor);
    const snapped = snapToEdge({ workArea: display.workArea, cursor, grabAlong: drag.grabAlong, strips, current: settings.edge });
    if (snapped.edge === settings.edge && snapped.offset === settings.offset && display.id === settings.displayId) return;
    settings = { ...settings, displayId: display.id, ...snapped };
    place();
  }

  function startDrag() {
    if (drag || !alive() || !layout) return;
    const cursor = screen.getCursorScreenPoint();
    const bounds = win.getBounds();
    const vertical = layout.edge === 'left' || layout.edge === 'right';
    const grabAlong = vertical ? cursor.y - bounds.y - layout.strip.y : cursor.x - bounds.x - layout.strip.x;
    const startedAt = Date.now();
    drag = { grabAlong, timer: setInterval(() => {
      if (!alive() || Date.now() - startedAt > DRAG_LIMIT_MS) { endDrag(); return; }
      follow();
    }, DRAG_TICK_MS) };
    setIgnore(false);
    place(true);
  }

  function endDrag() {
    if (!drag) return;
    clearInterval(drag.timer);
    drag = null;
    if (!alive()) return;
    saveSettings(settingsPath, settings);
    place(true);
  }

  function applySettings(patch) {
    const p = patch && typeof patch === 'object' && !Array.isArray(patch) ? patch : {};
    const merged = { ...settings };
    for (const key of SETTING_KEYS) {
      if (!Object.hasOwn(p, key)) continue;
      merged[key] = key === 'metrics' ? { ...settings.metrics, ...(p.metrics && typeof p.metrics === 'object' ? p.metrics : {}) } : p[key];
    }
    if (p.resetPosition === true) Object.assign(merged, { displayId: DEFAULT_SETTINGS.displayId, edge: DEFAULT_SETTINGS.edge, offset: DEFAULT_SETTINGS.offset });
    settings = normalizeHudSettings(merged);
    saveSettings(settingsPath, settings);
    send('hud:settings', displaySettings(settings));
    place();
    return displaySettings(settings);
  }

  function create() {
    win = new BrowserWindow({
      width: WINDOW.width, height: WINDOW.height, show: false, frame: false, transparent: true,
      backgroundColor: '#00000000', resizable: false, minimizable: false, maximizable: false,
      fullscreenable: false, skipTaskbar: true, focusable: false, hasShadow: false, alwaysOnTop: true,
      webPreferences: { preload: path.join(__dirname, 'preload-hud.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true },
    });
    const created = win;
    ignoring = null;
    layout = null;
    win.setAlwaysOnTop(true, TOP_LEVEL);
    setIgnore(true);
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('will-navigate', (event, url) => { if (!isTrustedRenderer(url, hudEntry)) event.preventDefault(); });
    win.webContents.on('will-attach-webview', event => event.preventDefault());
    win.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    win.webContents.session.setPermissionCheckHandler(() => false);
    win.webContents.on('did-finish-load', () => {
      if (win !== created || !alive()) return;
      place(true);
      // Items before settings, so the page's first measurement already has all five numbers.
      send('hud:state', items);
      send('hud:settings', displaySettings(settings));
      if (tokens) send('hud:tokens', tokens);
      if (settings.visible) reveal();
    });
    win.webContents.on('render-process-gone', (_event, details) => {
      if (details.reason === 'clean-exit') return;
      if (win === created) resetInteraction();
      const now = Date.now();
      recoveries = recoveries.filter(time => now - time < 60000);
      if (recoveries.length >= 3) return;
      recoveries.push(now);
      setTimeout(() => { if (win === created && alive()) created.loadFile(hudEntry).catch(() => {}); }, 250);
    });
    win.on('closed', () => { if (win === created) { win = null; clearInterval(poll); poll = null; if (drag) { clearInterval(drag.timer); drag = null; } } });
    clearInterval(poll);
    poll = setInterval(trackPointer, POLL_MS);
    win.loadFile(hudEntry).catch(() => {});
  }

  const guard = handler => (event, ...args) => { if (!trusted(event)) throw new Error('不可信的请求来源'); return handler(...args); };
  ipcMain.on('hud:hits', (event, rects) => { if (trusted(event)) hits = normalizeHits(rects); });
  ipcMain.on('hud:drag', (event, phase) => { if (!trusted(event)) return; if (phase === 'start') startDrag(); else if (phase === 'end') endDrag(); });
  ipcMain.on('hud:card', (event, open) => {
    if (!trusted(event) || typeof open !== 'boolean') return;
    win.setFocusable(open);
    if (open) win.focus();
  });
  ipcMain.on('hud:strips', (event, raw) => {
    if (!trusted(event)) return;
    const next = normalizeStrips(raw);
    if (!next || JSON.stringify(next) === JSON.stringify(strips)) return;
    strips = next;
    place();
  });
  ipcMain.handle('hud:initial', guard(() => ({ items, tokens, layout: layoutMessage(), settings: displaySettings(settings) })));
  ipcMain.handle('hud:refresh', guard(async () => { await onRefresh(); return true; }));
  ipcMain.handle('hud:action', guard(name => {
    if (typeof name !== 'string' || !ACTIONS.includes(name)) throw new Error('未知操作');
    return onAction(name);
  }));
  ipcMain.handle('hud:settings', guard(patch => applySettings(patch)));
  ipcMain.handle('hud:open-stats', guard(() => { onOpenStats(); return true; }));

  const onDisplays = () => place();
  screen.on('display-metrics-changed', onDisplays);
  screen.on('display-added', onDisplays);
  screen.on('display-removed', onDisplays);

  if (settings.visible) create();

  return {
    isVisible: () => settings.visible,
    show() {
      settings = { ...settings, visible: true };
      saveSettings(settingsPath, settings);
      if (!alive()) create(); else { place(); reveal(); }
    },
    hide() {
      settings = { ...settings, visible: false };
      saveSettings(settingsPath, settings);
      if (alive()) win.hide();
    },
    pushState(next) { items = Array.isArray(next) ? next : []; send('hud:state', items); },
    pushTokens(next) { tokens = next; send('hud:tokens', tokens); },
    reload() {
      recoveries = [];
      if (!alive()) { create(); return; }
      resetInteraction();
      win.loadFile(hudEntry).catch(() => {});
    },
    window: () => (alive() ? win : null),
    destroy() {
      if (drag) { clearInterval(drag.timer); drag = null; }
      clearInterval(poll);
      poll = null;
      screen.removeListener('display-metrics-changed', onDisplays);
      screen.removeListener('display-added', onDisplays);
      screen.removeListener('display-removed', onDisplays);
      for (const channel of SEND_CHANNELS) ipcMain.removeAllListeners(channel);
      for (const channel of INVOKE_CHANNELS) ipcMain.removeHandler(channel);
      if (alive()) win.destroy();
      win = null;
    },
  };
}

module.exports = { createHud };
```

- [ ] **Step 6: 运行确认通过**

Run: `npm run check`
Expected: 全部 PASS。

Run: `npm run check:desktop`
Expected: `{"passed":2,…}`。

- [ ] **Step 7: Commit**

```bash
git add src/main/hud-geometry.cjs src/main/hud-window.cjs tests/hud-geometry.test.mjs tests/hud-window.test.mjs
git -c user.name=CHIWAWAFROMkk -c user.email=323616687+CHIWAWAFROMkk@users.noreply.github.com commit -m "feat: HUD 窗口按渲染层报来的浮条尺寸布局，拖动逐帧吸附，新增设置与统计通道

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Task 6: 渲染层重写——浮条、胶囊、拖动（含字体与冒烟夹具）

**Files:**
- Create: `assets/fonts/inter-latin-wght-normal.woff2`, `assets/fonts/LICENSE-inter.txt`, `src/renderer/hud-dom.js`, `src/renderer/hud-strip.js`
- Modify: `src/renderer/hud.html`、`src/renderer/hud.css`、`src/renderer/hud.js`（三个整文件替换）, `src/main/preload-hud.cjs`（整文件替换）, `scripts/smoke-desktop.cjs`（整文件替换）
- Test: `scripts/smoke-desktop.cjs`（`npm run check:desktop`）

**Interfaces:**
- Consumes: Task 3 的 `Item`；Task 4 的 `window.HudMetrics`；Task 5 的 IPC 与 `layout` / `settings` 消息。
- Produces:
  - 预加载 `window.hud = { initial, refresh, action(name), setSettings(patch), openStats(), hits(rects), drag(phase), card(open), strips(value), onState, onTokens, onLayout, onSettings }`。
  - `window.HudDom = { el(tag, attrs, children), icon(name), logo(id, className), fmtInt(n), periodText(start, end), hm(date) }`；图标名 `percent | flame | number | gear | chart | back`。
  - `window.HudStrip.create({ root, pill, frame, isBlocked, onClick(id), onDragStart(), onStrips(value) }) → { setItems(items), setSettings(settings), place(layout), hidePill(), markRect(id) → DOMRect|null }`。
  - 冒烟脚本的 `checks` 数组与 `// <<more checks>>` 插入点，后续任务在这里追加检查。

- [ ] **Step 1: 下载 Inter 字体（OFL）**

```bash
mkdir -p assets/fonts
curl -sSf -x http://127.0.0.1:7890 -o assets/fonts/inter-latin-wght-normal.woff2 https://cdn.jsdelivr.net/npm/@fontsource-variable/inter@5.1.0/files/inter-latin-wght-normal.woff2
curl -sSf -x http://127.0.0.1:7890 -o assets/fonts/LICENSE-inter.txt https://cdn.jsdelivr.net/npm/@fontsource-variable/inter@5.1.0/LICENSE
```

Expected: 两个文件，字体约 48 KB，许可证开头是 `Copyright (c) 2016 The Inter Project Authors`（或同类 OFL 文本）。没有网络时停下来报告，不要改用别的字体。

- [ ] **Step 2: 写失败的冒烟检查**

`scripts/smoke-desktop.cjs` 整个文件替换为（夹具按视频的数值：Codex 49%、Claude 79%、Antigravity 9%、WorkBuddy 34%、DeepSeek ¥8.85）：

```js
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
const claudeRaw = oauth.parseUsage({ five_hour: { utilization: 12, resets_at: iso(72) }, seven_day: { utilization: 79, resets_at: iso(4 * 1440 + 627) }, seven_day_opus: { utilization: 60, resets_at: iso(4 * 1440 + 627) } }, 'max_20x', now);
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
const checks = [];
const watchdog = setTimeout(() => { console.error('Desktop smoke timed out'); app.exit(1); }, 60000);
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
  await shot('hud-strip');
  checks.push('settings change re-measures the strip');

  const alienHud = new BrowserWindow({ show: false, webPreferences: { preload: path.join(root, 'src/main/preload-hud.cjs'), contextIsolation: true, sandbox: true } });
  await alienHud.loadFile(path.join(root, 'src/renderer/hud.html'));
  assert.equal(await alienHud.webContents.executeJavaScript('hud.action("claude-help").then(()=>false,()=>true)'), true);
  assert.equal(await alienHud.webContents.executeJavaScript('hud.setSettings({ size: 40 }).then(()=>false,()=>true)'), true);
  alienHud.destroy();
  checks.push('HUD IPC origin enforced');
  // <<more checks>>
  fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify({ electron: process.versions.electron, checks }, null, 2));
  console.log(JSON.stringify({ passed: checks.length, output, electron: process.versions.electron }));
  clearTimeout(watchdog);
  app.quit();
}).catch(error => { console.error(error.stack); app.exit(1); });
```

`scripts/run-desktop-smoke.cjs` 的 `timeout: 45000` 改为 `timeout: 70000`。

- [ ] **Step 3: 运行确认失败**

Run: `npm run check:desktop`
Expected: FAIL（旧渲染层数字是隐藏的、`hud.setSettings` 不存在、`#pill .pair` 不存在）。

- [ ] **Step 4: 替换 `src/main/preload-hud.cjs`**

```js
const { contextBridge, ipcRenderer } = require('electron');

function subscribe(channel, callback) {
  const listener = (_event, value) => callback(value);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

const plain = value => (value && typeof value === 'object' && !Array.isArray(value) ? value : {});

contextBridge.exposeInMainWorld('hud', {
  initial: () => ipcRenderer.invoke('hud:initial'),
  refresh: () => ipcRenderer.invoke('hud:refresh'),
  action: (name) => ipcRenderer.invoke('hud:action', String(name)),
  setSettings: (patch) => ipcRenderer.invoke('hud:settings', plain(patch)),
  openStats: () => ipcRenderer.invoke('hud:open-stats'),
  hits: (rects) => ipcRenderer.send('hud:hits', Array.isArray(rects) ? rects : []),
  drag: (phase) => ipcRenderer.send('hud:drag', phase === 'start' ? 'start' : 'end'),
  card: (open) => ipcRenderer.send('hud:card', open === true),
  strips: (value) => ipcRenderer.send('hud:strips', plain(value)),
  onState: (callback) => subscribe('hud:state', callback),
  onTokens: (callback) => subscribe('hud:tokens', callback),
  onLayout: (callback) => subscribe('hud:layout', callback),
  onSettings: (callback) => subscribe('hud:settings', callback),
});
```

- [ ] **Step 5: 替换 `src/renderer/hud.html`**

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'self'; style-src 'self'; font-src 'self' file:; img-src 'self' file:; object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'">
  <title>QuotaDeck HUD</title>
  <link rel="stylesheet" href="hud.css">
</head>
<body class="edge-right">
  <div id="strip" class="strip hit" role="toolbar" aria-label="AI usage"></div>
  <svg id="dragframe" class="dragframe" aria-hidden="true"><rect></rect></svg>
  <div id="pill" class="pill" role="tooltip" hidden></div>
  <script src="hud-metrics.js"></script>
  <script src="hud-dom.js"></script>
  <script src="hud-strip.js"></script>
  <script src="hud.js"></script>
</body>
</html>
```

- [ ] **Step 6: 替换 `src/renderer/hud.css`**

```css
@font-face {
  font-family: 'Inter';
  src: url('../../assets/fonts/inter-latin-wght-normal.woff2') format('woff2');
  font-weight: 100 900;
  font-style: normal;
  font-display: block;
}
:root {
  color-scheme: dark;
  --fill: rgba(0, 0, 0, 0.82);
  --edge: rgba(255, 255, 255, 0.14);
  --divider: rgba(255, 255, 255, 0.10);
  --track: rgba(255, 255, 255, 0.12);
  --text: #f5f5f7;
  --text-2: #98989d;
  --text-3: #6e6e73;
  --popover: #282828;
  --ok: #3ddc84;
  --warn: #ffd23f;
  --high: #ff453a;
  --idle: #9a9aa0;
  --ease: cubic-bezier(0.2, 0.8, 0.2, 1);
  --font: 'Inter', 'Segoe UI Variable Text', 'Segoe UI', system-ui, sans-serif;
  /* Strip metrics; hud-strip.js overwrites them from HudMetrics. */
  --mark: 22px; --logo: 12px; --num: 13px; --spacing: 5px; --gap: 10px;
  --lead: 5px; --trail: 10px; --cross: 7px; --radius: 16px; --ring: 1.5px;
}
* { box-sizing: border-box; }
html, body { margin: 0; width: 100%; height: 100%; overflow: hidden; background: transparent; }
body { font: 13px/1.25 var(--font); color: var(--text); user-select: none; -webkit-user-select: none; font-feature-settings: 'tnum' 1; -webkit-font-smoothing: antialiased; }
button { font: inherit; color: inherit; background: none; border: 0; padding: 0; margin: 0; cursor: default; }
[hidden] { display: none !important; }
.ok { --tone: var(--ok); }
.warn { --tone: var(--warn); }
.high { --tone: var(--high); }
.none { --tone: var(--idle); }
.icon-svg { width: 1em; height: 1em; display: block; }
.icon-svg.stroke { fill: none; stroke: currentColor; stroke-width: 1.5; stroke-linecap: round; stroke-linejoin: round; }
.icon-svg.fill { fill: currentColor; }

/* Strip: black 0.82, 1px white 0.14 inside border, no shadow, blur or glow. */
.strip { position: absolute; z-index: 2; display: flex; gap: var(--gap); padding: var(--cross) var(--trail) var(--cross) var(--lead); background: var(--fill); box-shadow: inset 0 0 0 1px var(--edge); border-radius: var(--radius); }
.edge-left .strip, .edge-right .strip { flex-direction: column; }
.edge-top .strip, .edge-bottom .strip { flex-direction: row; align-items: center; }
.item { display: flex; align-items: center; gap: var(--spacing); height: var(--mark); flex: none; }
.mark { position: relative; flex: none; width: var(--mark); height: var(--mark); }
.ring { position: absolute; inset: 0; width: 100%; height: 100%; overflow: visible; }
.ring circle { fill: none; stroke-width: var(--ring); }
.ring .track { stroke: rgba(255, 255, 255, 0.14); }
.ring .value { stroke: var(--tone); stroke-linecap: round; }
.ring.dashed .track { stroke-dasharray: 2 2; }
.ring.dashed .value { opacity: 0.55; }
.logo { position: absolute; left: 50%; top: 50%; width: var(--logo); height: var(--logo); transform: translate(-50%, -50%); pointer-events: none; }
.num { flex: 1 0 auto; text-align: right; font-size: var(--num); font-weight: 500; color: var(--tone); white-space: nowrap; }

/* Shown only while the strip is picked up. */
.dragframe { position: absolute; z-index: 3; overflow: visible; pointer-events: none; display: none; filter: drop-shadow(0 0 2px rgba(0, 0, 0, 0.8)); }
.dragging .dragframe { display: block; }
.dragframe rect { fill: rgba(255, 255, 255, 0.025); stroke: rgba(255, 255, 255, 0.9); stroke-width: 1.25; stroke-dasharray: 4 3; }

/* Capsule: grows out of the strip's inner side. */
.pill { position: absolute; z-index: 1; display: flex; align-items: center; gap: 12px; height: 26px; padding: 0 12px; background: var(--fill); border-radius: 13px; white-space: nowrap; pointer-events: none; font-size: 12px; opacity: 0; transition: opacity 0.4s var(--ease), transform 0.4s var(--ease); }
.pill.follow { transition: opacity 0.4s var(--ease), transform 0.4s var(--ease), left 0.4s var(--ease), top 0.4s var(--ease); }
.pill.edge-left { transform-origin: left center; transform: scaleX(0.2); padding-left: calc(12px + var(--tuck, 0px)); }
.pill.edge-right { transform-origin: right center; transform: scaleX(0.2); padding-right: calc(12px + var(--tuck, 0px)); }
.pill.edge-top { transform-origin: center top; transform: scale(0.86); }
.pill.edge-bottom { transform-origin: center bottom; transform: scale(0.86); }
.pill.shown { opacity: 1; transform: none; }
.pair { display: flex; gap: 5px; }
.pair .k { color: var(--text-2); }
.pair .v { font-weight: 600; color: var(--tone); }
.pair.none .v { color: var(--text-2); }

@media (prefers-reduced-motion: reduce) { * { transition: none !important; } }
```

- [ ] **Step 7: 新建 `src/renderer/hud-dom.js`**

```js
(function () {
  'use strict';
  const SVG = 'http://www.w3.org/2000/svg';
  const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const pad = n => String(n).padStart(2, '0');
  const hm = d => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

  // Attributes only; inline styles are blocked by the CSP, so callers set node.style afterwards.
  function el(tag, attrs = {}, children = []) {
    const node = tag.startsWith('svg:') ? document.createElementNS(SVG, tag.slice(4)) : document.createElement(tag);
    for (const [key, value] of Object.entries(attrs)) {
      if (value === null || value === undefined || value === false) continue;
      if (key === 'text') node.textContent = value;
      else node.setAttribute(key, value === true ? '' : String(value));
    }
    for (const child of [].concat(children)) if (child) node.append(child);
    return node;
  }

  // 16×16 stand-ins for the SF Symbols the original uses.
  const ICONS = {
    percent: ['stroke', [['circle', { cx: 4.5, cy: 4.5, r: 1.9 }], ['circle', { cx: 11.5, cy: 11.5, r: 1.9 }], ['path', { d: 'M12.5 3.5l-9 9' }]]],
    flame: ['fill', [['path', { d: 'M8 1c.6 2.4 4.5 4 4.5 8.2a4.5 4.5 0 0 1-9 0c0-2 1-3.3 2-4.2.1 1.5.8 2.4 1.7 2.8C7 5.5 7.1 3.2 8 1z' }]]],
    number: ['stroke', [['path', { d: 'M6.2 2.5 5 13.5M11 2.5 9.8 13.5M2.8 6h11M2.2 10h11' }]]],
    gear: ['stroke', [['circle', { cx: 8, cy: 8, r: 2.2 }], ['circle', { cx: 8, cy: 8, r: 4.6 }], ['path', { d: 'M8 1.6v1.8M8 12.6v1.8M1.6 8h1.8M12.6 8h1.8M3.5 3.5l1.2 1.2M11.3 11.3l1.2 1.2M3.5 12.5l1.2-1.2M11.3 4.7l1.2-1.2' }]]],
    chart: ['stroke', [['path', { d: 'M3.5 12V8.5M6.5 12V4.5M9.5 12V6.5M12.5 12V9M2 14.2h12' }]]],
    back: ['stroke', [['path', { d: 'M10 3 5 8l5 5' }]]],
  };
  function icon(name) {
    const [kind, body] = ICONS[name];
    return el('svg:svg', { class: `icon-svg ${kind}`, viewBox: '0 0 16 16', 'aria-hidden': 'true' }, body.map(([tag, attrs]) => el(`svg:${tag}`, attrs)));
  }

  const logo = (id, className) => el('img', { class: className, src: `../../assets/logos/${id}.svg`, alt: '', draggable: 'false' });
  const fmtInt = n => Math.round(n).toLocaleString('en-US');
  // "Mon 12 Oct at 15:30 – 15:45"
  const periodText = (start, end) => `${DAYS[start.getDay()]} ${start.getDate()} ${MONTHS[start.getMonth()]} at ${hm(start)} – ${hm(end)}`;

  window.HudDom = { el, icon, logo, fmtInt, periodText, hm };
})();
```

- [ ] **Step 8: 新建 `src/renderer/hud-strip.js`**

```js
(function () {
  'use strict';
  const { el, logo } = window.HudDom;
  const { CLICK_SLOP, HOLD_MS, isClick, metrics: metricsFor, stripSize } = window.HudMetrics;
  const SHOW_MS = 400;
  const HIDE_MS = 200;
  const FADE_MS = 400;
  const MARGIN = 4;

  function create({ root, pill, frame, isBlocked, onClick, onDragStart, onStrips }) {
    let items = [];
    let settings = null;
    let edge = 'right';
    let sizes = null;
    let pillId = null;
    let showTimer = null;
    let hideTimer = null;
    let fadeTimer = null;
    let press = null;
    let lastReport = '';
    const ctx = document.createElement('canvas').getContext('2d');
    const vertical = () => edge === 'left' || edge === 'right';
    const current = () => (vertical() ? sizes.vertical : sizes.horizontal);

    function ring(item, size, width) {
      const c = size / 2;
      const r = (size - width) / 2;
      const used = item.ring.usedPct;
      return el('svg:svg', { class: `ring ${item.ring.level}${item.ring.dashed ? ' dashed' : ''}`, viewBox: `0 0 ${size} ${size}`, 'aria-hidden': 'true' }, [
        el('svg:circle', { class: 'track', cx: c, cy: c, r }),
        used > 0 ? el('svg:circle', { class: 'value', cx: c, cy: c, r, pathLength: 100, 'stroke-dasharray': `${Math.min(used, 100)} 100`, transform: `rotate(-90 ${c} ${c})` }) : null,
      ]);
    }

    // Number widths are measured once per render and drive both orientations' sizes,
    // which the main process needs to place the window and to snap while dragging.
    function measure() {
      const font = metricsFor({ size: settings.size }).font;
      ctx.font = `500 ${font}px Inter`;
      const widths = items.map(item => Math.ceil(ctx.measureText(item.label).width));
      const base = { size: settings.size, showsRings: settings.showsRings, showsNumbers: settings.showsNumbers, labelWidths: widths };
      sizes = { vertical: stripSize({ ...base, vertical: true }), horizontal: stripSize({ ...base, vertical: false }), widths };
      const report = { vertical: { width: sizes.vertical.width, height: sizes.vertical.height }, horizontal: { width: sizes.horizontal.width, height: sizes.horizontal.height } };
      const key = JSON.stringify(report);
      if (key !== lastReport) { lastReport = key; onStrips(report); }
    }

    function render() {
      if (!settings) return;
      measure();
      const size = current();
      const m = size.metrics;
      const vars = { mark: m.mark, logo: m.logo, num: m.font, spacing: m.spacing, gap: m.gap, lead: m.lead, trail: m.trail, cross: m.cross, radius: size.radius, ring: settings.ringWidth };
      for (const [key, value] of Object.entries(vars)) document.documentElement.style.setProperty(`--${key}`, `${value}px`);
      root.style.width = `${size.width}px`;
      root.style.height = `${size.height}px`;
      root.replaceChildren(...items.map((item, i) => {
        const num = settings.showsNumbers ? el('span', { class: `num ${item.ring.level}`, text: item.label }) : null;
        if (num && !vertical()) num.style.width = `${sizes.widths[i]}px`;
        return el('button', { class: 'item', type: 'button', 'data-id': item.id, 'aria-label': `${item.name} ${item.label}` }, [
          el('span', { class: 'mark' }, [settings.showsRings ? ring(item, m.mark, settings.ringWidth) : null, logo(item.id, 'logo')]),
          num,
        ]);
      }));
      if (vertical()) for (const node of root.querySelectorAll('.item')) node.style.width = '100%';
      placeFrame();
      if (pillId) showPill(pillId);
    }

    function placeFrame() {
      const w = root.offsetWidth;
      const h = root.offsetHeight;
      const r = sizes ? current().radius + 2 : 18;
      frame.style.left = `${root.offsetLeft - 2.625}px`;
      frame.style.top = `${root.offsetTop - 2.625}px`;
      frame.setAttribute('width', w + 5.25);
      frame.setAttribute('height', h + 5.25);
      const rect = frame.firstElementChild;
      for (const [key, value] of Object.entries({ x: 0.625, y: 0.625, width: w + 4, height: h + 4, rx: r, ry: r })) rect.setAttribute(key, value);
    }

    function place(layout) {
      const turned = layout.edge !== edge;
      edge = layout.edge;
      root.style.left = `${layout.strip.x}px`;
      root.style.top = `${layout.strip.y}px`;
      if (turned) render(); else placeFrame();
      if (pillId && !turned) showPill(pillId);
    }

    function markRect(id) {
      return root.querySelector(`[data-id="${id}"] .mark`)?.getBoundingClientRect() || null;
    }

    function showPill(id) {
      const item = items.find(entry => entry.id === id);
      const mark = markRect(id);
      if (!item || !mark || isBlocked()) { hidePill(); return; }
      clearTimeout(fadeTimer);
      const following = pillId !== null && !pill.hidden;
      pillId = id;
      pill.replaceChildren(...item.pill.map(pair => el('span', { class: `pair ${pair.level}` }, [pair.name ? el('span', { class: 'k', text: pair.name }) : null, el('span', { class: 'v', text: pair.value })])));
      const s = { left: root.offsetLeft, top: root.offsetTop, width: root.offsetWidth, height: root.offsetHeight };
      const tuck = vertical() ? Math.round(s.width / 2) : 0;
      pill.classList.remove('edge-left', 'edge-right', 'edge-top', 'edge-bottom');
      pill.classList.add(`edge-${edge}`);
      pill.classList.toggle('follow', following);
      pill.style.setProperty('--tuck', `${tuck}px`);
      pill.hidden = false;
      const w = pill.offsetWidth;
      const h = pill.offsetHeight;
      const cx = mark.left + mark.width / 2;
      const cy = mark.top + mark.height / 2;
      const maxX = document.documentElement.clientWidth - w - MARGIN;
      const maxY = document.documentElement.clientHeight - h - MARGIN;
      const clamp = (v, high) => Math.max(MARGIN, Math.min(high, v));
      let x;
      let y;
      if (edge === 'left') { x = s.left + s.width - tuck; y = clamp(cy - h / 2, maxY); }
      else if (edge === 'right') { x = s.left + tuck - w; y = clamp(cy - h / 2, maxY); }
      else if (edge === 'top') { y = s.top + s.height; x = clamp(cx - w / 2, maxX); }
      else { y = s.top - h; x = clamp(cx - w / 2, maxX); }
      pill.style.left = `${Math.round(x)}px`;
      pill.style.top = `${Math.round(y)}px`;
      requestAnimationFrame(() => { if (pillId === id) pill.classList.add('shown'); });
    }

    function hidePill(now = false) {
      clearTimeout(showTimer);
      clearTimeout(hideTimer);
      clearTimeout(fadeTimer);
      pillId = null;
      pill.classList.remove('shown', 'follow');
      if (now) pill.hidden = true;
      else fadeTimer = setTimeout(() => { if (!pillId) pill.hidden = true; }, FADE_MS);
    }

    root.addEventListener('mouseover', event => {
      const target = event.target.closest('.item');
      if (!target || press?.dragging || isBlocked()) return;
      clearTimeout(hideTimer);
      clearTimeout(showTimer);
      if (pillId) showPill(target.dataset.id);
      else showTimer = setTimeout(() => showPill(target.dataset.id), SHOW_MS);
    });
    root.addEventListener('mouseleave', () => {
      clearTimeout(showTimer);
      hideTimer = setTimeout(() => hidePill(), HIDE_MS);
    });

    // Held for 0.3s or moved 6px: a drag. Released sooner and closer: a click.
    function startDrag() {
      if (!press || press.dragging) return;
      press.dragging = true;
      clearTimeout(press.hold);
      hidePill(true);
      onDragStart();
      window.hud.drag('start');
    }
    root.addEventListener('pointerdown', event => {
      if (event.button !== 0) return;
      press = { x: event.screenX, y: event.screenY, at: performance.now(), id: event.target.closest('.item')?.dataset.id || null, dragging: false, hold: setTimeout(startDrag, HOLD_MS) };
      try { root.setPointerCapture(event.pointerId); } catch { /* synthetic events have no capture */ }
    });
    root.addEventListener('pointermove', event => {
      if (press && !press.dragging && Math.hypot(event.screenX - press.x, event.screenY - press.y) > CLICK_SLOP) startDrag();
    });
    root.addEventListener('pointerup', event => {
      if (!press) return;
      const done = press;
      press = null;
      clearTimeout(done.hold);
      try { root.releasePointerCapture(event.pointerId); } catch { /* not captured */ }
      if (done.dragging) window.hud.drag('end');
      else if (done.id && isClick({ dx: event.screenX - done.x, dy: event.screenY - done.y, ms: performance.now() - done.at })) onClick(done.id);
    });
    root.addEventListener('pointercancel', () => {
      if (press) { clearTimeout(press.hold); if (press.dragging) window.hud.drag('end'); }
      press = null;
    });

    return {
      setItems(next) { items = Array.isArray(next) ? next : []; render(); },
      setSettings(next) { if (next) { settings = next; render(); } },
      place,
      hidePill,
      markRect,
    };
  }

  window.HudStrip = { create };
})();
```

- [ ] **Step 9: 替换 `src/renderer/hud.js`**

```js
(function () {
  'use strict';
  const stripNode = document.querySelector('#strip');
  let layout = null;
  let lastHits = '';

  const strip = window.HudStrip.create({
    root: stripNode,
    pill: document.querySelector('#pill'),
    frame: document.querySelector('#dragframe'),
    isBlocked: () => Boolean(layout?.dragging),
    onClick: () => {},
    onDragStart: () => {},
    onStrips: value => window.hud.strips(value),
  });

  // Tell the main process where the visible parts are; it turns click-through off only over them.
  function reportHits() {
    const rects = [...document.querySelectorAll('.hit')].filter(node => !node.hidden).map(node => node.getBoundingClientRect())
      .map(r => ({ x: Math.floor(r.left), y: Math.floor(r.top), width: Math.ceil(r.width), height: Math.ceil(r.height) }));
    const key = JSON.stringify(rects);
    if (key === lastHits) return;
    lastHits = key;
    window.hud.hits(rects);
  }
  const scheduleHits = () => requestAnimationFrame(reportHits);
  new ResizeObserver(scheduleHits).observe(stripNode);

  function applyLayout(next) {
    if (!next) return;
    layout = next;
    document.body.classList.remove('edge-left', 'edge-right', 'edge-top', 'edge-bottom');
    document.body.classList.add(`edge-${layout.edge}`);
    document.body.classList.toggle('dragging', layout.dragging);
    if (layout.dragging) strip.hidePill(true);
    strip.place(layout);
    scheduleHits();
  }

  window.hud.onState(next => { strip.setItems(next); scheduleHits(); });
  window.hud.onSettings(next => { strip.setSettings(next); scheduleHits(); });
  window.hud.onLayout(applyLayout);
  // Numbers are measured with Inter, so wait for it before the first measurement.
  // Items go in before settings: the strip only renders once it has settings, and its
  // first measurement should already include every number.
  document.fonts.load('500 13px Inter').catch(() => {}).then(() => window.hud.initial()).then(state => {
    strip.setItems(state.items);
    strip.setSettings(state.settings);
    applyLayout(state.layout);
  }).catch(() => {});
})();
```

- [ ] **Step 10: 运行确认通过**

Run: `npm run check && npm run check:desktop`
Expected: 单测全部 PASS；冒烟输出 `{"passed":5,…}`，`work/desktop-smoke-*/hud-pill.png`、`hud-strip.png` 存在。打开这两张图看一眼：竖条贴右、圆环和数字颜色与视频一致、胶囊在 Claude 图标左侧伸出。

- [ ] **Step 11: Commit**

```bash
git add assets/fonts src/renderer/hud.html src/renderer/hud.css src/renderer/hud.js src/renderer/hud-dom.js src/renderer/hud-strip.js src/main/preload-hud.cjs scripts/smoke-desktop.cjs scripts/run-desktop-smoke.cjs
git -c user.name=CHIWAWAFROMkk -c user.email=323616687+CHIWAWAFROMkk@users.noreply.github.com commit -m "feat: 照视频重写浮条与悬停胶囊，Inter 字体，拖动逐帧吸附与虚线框

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Task 7: 点击卡片与按模型堆叠的 Token 柱

**Files:**
- Create: `src/renderer/hud-chart.js`, `src/renderer/hud-card.js`, `src/renderer/chart.css`
- Modify: `src/renderer/hud.html`（加卡片节点与脚本）, `src/renderer/hud.css`（追加卡片样式）, `src/renderer/hud.js`（整文件替换）, `scripts/smoke-desktop.cjs`（在 `// <<more checks>>` 前插入）
- Test: `npm run check:desktop`

**Interfaces:**
- Consumes: `Item.card`、`buildHudTokens` 的 `{ status, startAt, partial, total, buckets, models, stacks, perHour, perDay, totalText }`；`HudStrip.markRect(id)`；`window.hud.setSettings`、`openStats`、`card`。
- Produces:
  - `window.HudChart = { render(series, { height = 40, source = null, axis = false }) → HTMLElement, colorOf(model, index) → css color, PALETTE }`（Task 9 统计窗口复用）。
  - `window.HudCard.create({ root, strip, getItem, getTokens, getMetric, setMetric, settingsView, onOpenStats, onChange }) → { open(id), close(), toggle(id), isOpen(), refresh(), reposition() }`；`settingsView({ back }) → Node[]`，为 `null` 时齿轮无反应（Task 8 接上）。
  - DOM 约定（冒烟脚本依赖）：`#card .row .name / .value / .detail`、`#card .account .plan / .status`、`#card [data-metric=quota|burn|tokens]`、`#card [data-act=settings|stats]`、`#card .tokens .sec-meta`、`.chart svg`、`.chart .col rect`、`.chart-tip .tip-period / .tip-total / .tip-row`。

- [ ] **Step 1: 写失败的冒烟检查**

在 `scripts/smoke-desktop.cjs` 的 `// <<more checks>>` 一行之前插入：

```js
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
  await shot('hud-tooltip');
  checks.push('tokens: stacked by model, hover tooltip with period, total and models');

  await hudEval('document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }))');
  await until(() => hudEval('document.querySelector("#card").hidden'));
  await click('codex');
  await until(() => hudEval('document.querySelector("#card .tokens .sec-meta")?.textContent === "No local logs"'));
  await click('codex');
  await until(() => hudEval('document.querySelector("#card").hidden'));
  checks.push('card closes on Esc and on a second click; missing logs are labelled');
```

- [ ] **Step 2: 运行确认失败**

Run: `npm run check:desktop`
Expected: FAIL（`Timed out waiting for UI`：点击后没有卡片）。

- [ ] **Step 3: 新建 `src/renderer/chart.css`**

```css
/* Stacked token bars, shared by the HUD card and the statistics window. */
.chart { position: relative; margin: 8px 6px 0; }
.chart .bars { display: block; width: 100%; overflow: visible; }
.chart .col { transition: opacity 0.15s ease; }
.chart.hovering .col:not(.on) { opacity: 0.55; }
.chart .band { fill: rgba(255, 255, 255, 0.08); }
.chart .cursor { stroke: rgba(152, 152, 157, 0.5); stroke-width: 1; }
.chart .baseline { stroke: rgba(255, 255, 255, 0.10); stroke-width: 1; }
.chart.with-axis { padding-bottom: 18px; }
.axis { position: absolute; left: 0; right: 0; bottom: 0; height: 14px; font-size: 10px; color: #6e6e73; }
.axis span { position: absolute; transform: translateX(-50%); }
.axis span:first-child { transform: none; }
.axis span:last-child { transform: translateX(-100%); }
.chart-tip { position: absolute; bottom: 6px; z-index: 5; display: flex; flex-direction: column; gap: 6px; padding: 10px; background: #282828; border-radius: 8px; box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.12), 0 2px 6px rgba(0, 0, 0, 0.2); pointer-events: none; }
.tip-period { font-size: 11px; color: #98989d; }
.tip-total { font-size: 14px; font-weight: 600; color: #f5f5f7; }
.tip-row { display: flex; align-items: center; gap: 6px; font-size: 11px; color: #f5f5f7; }
.tip-dot { flex: none; width: 6px; height: 6px; border-radius: 50%; }
.tip-logo { flex: none; width: 12px; height: 12px; }
.tip-name { flex: 1; }
.tip-count { font-feature-settings: 'tnum' 1; }
```

- [ ] **Step 4: 新建 `src/renderer/hud-chart.js`**

```js
(function () {
  'use strict';
  const { el, fmtInt, hm, logo, periodText } = window.HudDom;
  const QUARTER = 15 * 60000;
  const PALETTE = ['#c084fc', '#60a5fa', '#2dd4bf', '#fb923c', '#f472b6', '#a3e635'];
  const OTHER = '#6e6e73';
  let charts = 0;
  const colorOf = (model, index) => (model?.id === 'other' ? OTHER : PALETTE[index % PALETTE.length]);

  // 96 quarter-hour bars stacked by model from the bottom; hover shows that quarter's breakdown.
  function render(series, { height = 40, source = null, axis = false } = {}) {
    const id = `chart${++charts}`;
    const n = series.buckets.length;
    const max = Math.max(1, ...series.buckets);
    const box = el('div', { class: `chart${axis ? ' with-axis' : ''}` });
    const svg = el('svg:svg', { class: 'bars', role: 'img', 'aria-label': `${fmtInt(series.total)} tokens in the last 24 hours` });
    const tip = el('div', { class: 'chart-tip', hidden: true });
    box.append(svg, tip);
    if (axis) {
      box.append(el('div', { class: 'axis' }, [0, 24, 48, 72, 96].map(i => {
        const label = el('span', { text: hm(new Date(series.startAt + i * QUARTER)) });
        label.style.left = `${(i / n) * 100}%`;
        return label;
      })));
    }
    let width = 0;
    let columns = [];
    let band = null;
    let cursor = null;

    function draw() {
      width = box.clientWidth;
      if (!width) return;
      svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
      svg.setAttribute('height', height);
      const step = width / n;
      const gap = Math.min(2, step * 0.2);
      const defs = el('svg:defs');
      columns = series.buckets.map((total, i) => {
        const group = el('svg:g', { class: 'col' });
        const h = Math.min(height, (total / max) * height);
        if (h <= 0) return group;
        const x = i * step + gap / 2;
        const w = Math.max(0.5, step - gap);
        // Round the top of each stack: clip it to a rounded rect taller than the bar.
        defs.append(el('svg:clipPath', { id: `${id}-${i}` }, [el('svg:rect', { x, y: height - h, width: w, height: h + 2, rx: 2 })]));
        group.setAttribute('clip-path', `url(#${id}-${i})`);
        let y = height;
        (series.stacks[i] || []).forEach((count, m) => {
          if (count <= 0) return;
          const part = (count / total) * h;
          y -= part;
          group.append(el('svg:rect', { x, y, width: w, height: part, fill: colorOf(series.models[m], m) }));
        });
        return group;
      });
      band = el('svg:rect', { class: 'band', x: -step, y: 0, width: step, height });
      cursor = el('svg:line', { class: 'cursor', x1: -10, x2: -10, y1: 0, y2: height });
      svg.replaceChildren(defs, band, ...columns, el('svg:line', { class: 'baseline', x1: 0, x2: width, y1: height - 0.5, y2: height - 0.5 }), cursor);
      highlight(null);
    }

    function highlight(i) {
      box.classList.toggle('hovering', i !== null);
      columns.forEach((column, k) => column.classList.toggle('on', k === i));
      if (i === null) {
        tip.hidden = true;
        band?.setAttribute('x', -width);
        cursor?.setAttribute('x1', -10);
        cursor?.setAttribute('x2', -10);
        return;
      }
      const step = width / n;
      const centre = (i + 0.5) * step;
      band.setAttribute('x', i * step);
      cursor.setAttribute('x1', centre);
      cursor.setAttribute('x2', centre);
      const start = new Date(series.startAt + i * QUARTER);
      const rows = series.models.map((model, m) => ({ model, m, count: series.stacks[i]?.[m] || 0 })).filter(row => row.count > 0);
      tip.replaceChildren(
        el('div', { class: 'tip-period', text: periodText(start, new Date(start.getTime() + QUARTER)) }),
        el('div', { class: 'tip-total', text: `${fmtInt(series.buckets[i])} tokens` }),
        ...rows.map(row => {
          const dot = el('i', { class: 'tip-dot' });
          dot.style.background = colorOf(row.model, row.m);
          return el('div', { class: 'tip-row' }, [dot, source ? logo(source, 'tip-logo') : null, el('span', { class: 'tip-name', text: row.model.name }), el('span', { class: 'tip-count', text: fmtInt(row.count) })]);
        }),
      );
      tip.hidden = false;
      const tw = Math.min(280, width);
      tip.style.width = `${tw}px`;
      tip.style.left = `${Math.round(centre < width / 2 ? centre + 12 : centre - 12 - tw)}px`;
    }

    svg.addEventListener('mousemove', event => {
      const r = svg.getBoundingClientRect();
      highlight(Math.max(0, Math.min(n - 1, Math.floor(((event.clientX - r.left) / r.width) * n))));
    });
    svg.addEventListener('mouseleave', () => highlight(null));
    new ResizeObserver(draw).observe(box);
    return box;
  }

  window.HudChart = { render, colorOf, PALETTE };
})();
```

- [ ] **Step 5: 新建 `src/renderer/hud-card.js`**

```js
(function () {
  'use strict';
  const { el, icon, logo } = window.HudDom;
  const METRICS = [['quota', 'percent', 'Quota'], ['burn', 'flame', 'Burn rate'], ['tokens', 'number', 'Tokens per hour']];
  const EDGES = ['left', 'right', 'top', 'bottom'];
  const GAP = 6;
  const MARGIN = 4;
  const CLOSE_MS = 100;

  function create({ root, strip, getItem, getTokens, getMetric, setMetric, settingsView = null, onOpenStats, onChange }) {
    let openId = null;
    let view = 'detail';
    let closeTimer = null;

    const edgeNow = () => EDGES.find(edge => document.body.classList.contains(`edge-${edge}`)) || 'right';
    const tokenMeta = s => (!s ? 'Reading…' : s.status === 'unsupported' ? 'No local logs' : s.status !== 'ok' ? 'Read failed' : s.partial ? '24h · partial' : `24h · ${s.totalText}`);

    // Used share in the row's level colour; in burn mode a faint segment shows the projection to reset.
    function track(row, projected) {
      const bar = el('span', { class: `track ${row.level}` });
      if (row.usedPct === null) return bar;
      if (Number.isFinite(projected) && projected > row.usedPct) {
        const ghost = el('i', { class: 'ghost' });
        ghost.style.width = `${Math.min(100, projected)}%`;
        bar.append(ghost);
      }
      const fill = el('i', { class: 'fill' });
      fill.style.width = `${Math.max(0, Math.min(100, row.usedPct))}%`;
      bar.append(fill);
      return bar;
    }

    function rowNode(row, metric, tokens) {
      let value;
      let detail;
      let level;
      let projected = null;
      if (metric === 'burn') ({ value, detail, level, projectedPct: projected } = row.burn);
      else if (metric === 'tokens') {
        const ok = tokens?.status === 'ok';
        value = ok ? tokens.perHour : '—';
        detail = ok ? tokens.perDay : '—';
        level = ok ? 'ok' : 'none';
      } else {
        value = row.usedPct === null ? '—' : `${row.usedPct}%`;
        detail = row.reset;
        level = row.level;
      }
      return el('div', { class: `row ${level}` }, [
        el('i', { class: 'dot' }),
        el('span', { class: 'name', text: row.name, title: row.name, 'data-short': row.short }),
        track(row, projected),
        el('span', { class: 'value', text: value }),
        el('span', { class: `detail${metric === 'burn' && level === 'warn' ? ' tinted' : ''}`, text: detail }),
      ]);
    }

    function detail(item) {
      const metric = getMetric(item.id);
      const tokens = getTokens()?.[item.id];
      const c = item.card;
      const head = el('section', { class: 'sec' }, [
        el('header', { class: 'head' }, [
          el('span', { class: 'head-logo' }, [logo(item.id, 'card-logo')]),
          el('h2', { text: item.name }),
          el('div', { class: 'picker', role: 'radiogroup', 'aria-label': 'Metric' }, METRICS.map(([id, glyph, label]) => el('button', {
            type: 'button', class: `pick${metric === id ? ' on' : ''}`, 'data-metric': id, role: 'radio', 'aria-checked': String(metric === id), 'aria-label': label, title: label,
          }, [icon(glyph)]))),
        ]),
        el('div', { class: 'account' }, [el('span', { class: 'plan', text: c.plan }), el('span', { class: 'status', text: c.account })]),
        c.note ? el('p', { class: 'note', text: c.note }) : null,
        c.balance ? el('div', { class: `row ${c.balance.level}` }, [el('i', { class: 'dot' }), el('span', { class: 'name', text: 'Balance' }), el('span'), el('span', { class: 'value', text: c.balance.text }), el('span', { class: 'detail' })]) : null,
        ...c.rows.map(row => rowNode(row, metric, tokens)),
      ]);
      const tokenSection = c.tokens ? el('section', { class: 'sec tokens' }, [
        el('div', { class: 'sec-head' }, [el('h3', { text: 'Tokens' }), el('span', { class: 'sec-meta', text: tokenMeta(tokens) })]),
        tokens?.status === 'ok' && tokens.total > 0 ? window.HudChart.render(tokens, { source: item.id }) : null,
      ]) : null;
      const foot = el('footer', { class: 'sec foot' }, [
        el('button', { class: 'foot-btn', type: 'button', 'data-act': 'settings', 'aria-label': 'Settings', title: 'Settings' }, [icon('gear')]),
        el('button', { class: 'foot-btn', type: 'button', 'data-act': 'stats', 'aria-label': 'Usage statistics', title: 'Usage statistics' }, [icon('chart')]),
      ]);
      return [head, tokenSection, foot];
    }

    // Beside the strip on its inner side, 6px away, centred on the clicked mark and kept on screen.
    function position(animate) {
      const mark = strip.markRect(openId);
      if (!mark) return;
      const s = document.querySelector('#strip').getBoundingClientRect();
      const edge = edgeNow();
      const w = root.offsetWidth;
      const h = root.offsetHeight;
      const clampX = v => Math.max(MARGIN, Math.min(document.documentElement.clientWidth - w - MARGIN, v));
      const clampY = v => Math.max(MARGIN, Math.min(document.documentElement.clientHeight - h - MARGIN, v));
      let x;
      let y;
      if (edge === 'left') { x = s.right + GAP; y = clampY(mark.top + mark.height / 2 - h / 2); }
      else if (edge === 'right') { x = s.left - GAP - w; y = clampY(mark.top + mark.height / 2 - h / 2); }
      else if (edge === 'top') { y = s.bottom + GAP; x = clampX(mark.left + mark.width / 2 - w / 2); }
      else { y = s.top - GAP - h; x = clampX(mark.left + mark.width / 2 - w / 2); }
      root.style.left = `${Math.round(x)}px`;
      root.style.top = `${Math.round(y)}px`;
      root.dataset.edge = edge;
      if (animate) {
        root.style.transformOrigin = `${Math.round(mark.left + mark.width / 2 - x)}px ${Math.round(mark.top + mark.height / 2 - y)}px`;
        root.classList.remove('shown');
        void root.offsetWidth;
        root.classList.add('shown');
      }
    }

    function render(animate = false) {
      const item = openId ? getItem(openId) : null;
      if (!item) { close(); return; }
      const content = view === 'settings' && settingsView ? settingsView({ back: () => { view = 'detail'; render(); } }) : detail(item);
      root.replaceChildren(el('div', { class: 'card-body' }, content));
      position(animate);
      for (const name of root.querySelectorAll('.row .name[data-short]')) if (name.scrollWidth > name.clientWidth) name.textContent = name.dataset.short;
      onChange();
    }

    function open(id) {
      clearTimeout(closeTimer);
      const animate = !openId;
      openId = id;
      view = 'detail';
      root.hidden = false;
      root.classList.remove('closing');
      render(animate);
      window.hud.card(true);
    }

    function close() {
      if (!openId) return;
      openId = null;
      view = 'detail';
      root.classList.remove('shown');
      root.classList.add('closing');
      clearTimeout(closeTimer);
      closeTimer = setTimeout(() => {
        if (openId) return;
        root.hidden = true;
        root.classList.remove('closing');
        root.replaceChildren();
        onChange();
      }, CLOSE_MS);
      window.hud.card(false);
      onChange();
    }

    root.addEventListener('click', event => {
      const pick = event.target.closest('[data-metric]');
      if (pick && openId) { setMetric(openId, pick.dataset.metric); return; }
      const act = event.target.closest('[data-act]')?.dataset.act;
      if (act === 'settings' && settingsView) { view = 'settings'; render(); }
      if (act === 'stats') onOpenStats();
    });
    root.addEventListener('transitionend', onChange);
    new ResizeObserver(onChange).observe(root);

    return {
      open,
      close,
      toggle(id) { if (openId === id) close(); else open(id); },
      isOpen: () => openId !== null,
      // The settings page keeps its inputs while values change, so it is only moved, not rebuilt.
      refresh() { if (!openId) return; if (view === 'settings') position(false); else render(); },
      reposition() { if (openId) position(false); },
    };
  }

  window.HudCard = { create };
})();
```

- [ ] **Step 6: 追加卡片样式到 `src/renderer/hud.css`（放在 `@media (prefers-reduced-motion …)` 之前）**

```css
/* Card: 440 wide, radius 22, solid black, 1px white 0.14, padding 14/18. */
.card { position: absolute; z-index: 4; width: 440px; max-height: calc(100vh - 8px); overflow: hidden auto; padding: 14px 18px; background: #000; box-shadow: inset 0 0 0 1px var(--edge); border-radius: 22px; opacity: 0; transform: scale(0.3); transition: transform 0.4s var(--ease), opacity 0.4s var(--ease); }
.card.shown { opacity: 1; transform: none; }
.card.closing { opacity: 0; transform: none; transition: opacity 0.1s ease-out; }
.card-body { display: flex; flex-direction: column; gap: 10px; opacity: 0; transition: opacity 0.1s ease-out, transform 0.1s ease-out; }
.card[data-edge="left"] .card-body { transform: translateX(-5px); }
.card[data-edge="right"] .card-body { transform: translateX(5px); }
.card[data-edge="top"] .card-body { transform: translateY(-5px); }
.card[data-edge="bottom"] .card-body { transform: translateY(5px); }
.card.shown .card-body { opacity: 1; transform: none; transition: opacity 0.22s ease-out 0.12s, transform 0.22s ease-out 0.12s; }
.sec { display: flex; flex-direction: column; gap: 2px; }
.sec + .sec { padding-top: 8px; border-top: 1px solid var(--divider); }
.head { display: flex; align-items: center; gap: 6px; margin-bottom: 4px; }
.head-logo { flex: none; width: 20px; display: grid; place-items: center; }
.card-logo { width: 14px; height: 14px; }
.head h2 { flex: 1; margin: 0; font-size: 13px; font-weight: 700; }
.picker { display: flex; gap: 2px; }
.pick { width: 20px; height: 18px; display: grid; place-items: center; border-radius: 5px; color: var(--text-3); transition: background 0.28s var(--ease), color 0.28s var(--ease); }
.pick .icon-svg { width: 9px; height: 9px; }
.pick .icon-svg.stroke { stroke-width: 2; }
.pick.on { background: rgba(245, 245, 247, 0.12); color: var(--text); }
.account { display: flex; justify-content: space-between; gap: 12px; margin-bottom: 4px; font-size: 11px; }
.account .plan { color: var(--text-2); }
.account .status { color: var(--text-3); }
.note { margin: 0 0 4px; font-size: 11px; color: var(--text-2); }
.row { display: grid; grid-template-columns: 8px 152px 1fr 62px 96px; align-items: center; column-gap: 12px; padding: 4px 6px; border-radius: 6px; font-size: 13px; }
.row:hover { background: rgba(245, 245, 247, 0.06); }
.row .dot { width: 8px; height: 8px; border-radius: 50%; background: var(--tone); box-shadow: 0 0 4px var(--tone); }
.row .name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 600; }
.row .value { text-align: right; font-weight: 600; color: var(--tone); white-space: nowrap; }
.row .detail { text-align: right; font-size: 12px; color: var(--text-2); white-space: nowrap; }
.row .detail.tinted { color: var(--tone); }
.track { position: relative; height: 4px; border-radius: 2px; background: var(--track); overflow: hidden; }
.track i { position: absolute; left: 0; top: 0; bottom: 0; border-radius: 2px; background: var(--tone); }
.track .ghost { opacity: 0.38; }
.sec-head { display: flex; justify-content: space-between; align-items: baseline; }
.sec-head h3 { margin: 0; font-size: 13px; font-weight: 600; }
.sec-meta { font-size: 12px; color: var(--text-2); }
.foot { flex-direction: row; justify-content: space-between; }
.sec.foot { padding-top: 6px; }
.foot-btn { width: 28px; height: 28px; display: grid; place-items: center; border-radius: 6px; color: var(--text-2); }
.foot-btn:hover { background: rgba(245, 245, 247, 0.06); }
.foot-btn .icon-svg { width: 14px; height: 14px; }
```

- [ ] **Step 7: 改 `src/renderer/hud.html`**

`<link rel="stylesheet" href="hud.css">` 前加一行 `<link rel="stylesheet" href="chart.css">`；`<div id="pill" …></div>` 后加：

```html
  <section id="card" class="card hit" aria-live="polite" hidden></section>
```

`<script src="hud-strip.js"></script>` 之后加：

```html
  <script src="hud-chart.js"></script>
  <script src="hud-card.js"></script>
```

- [ ] **Step 8: 替换 `src/renderer/hud.js`**

```js
(function () {
  'use strict';
  const stripNode = document.querySelector('#strip');
  const cardNode = document.querySelector('#card');
  let layout = null;
  let items = [];
  let tokens = null;
  let settings = null;
  let lastHits = '';

  // Tell the main process where the visible parts are; it turns click-through off only over them.
  function reportHits() {
    const rects = [...document.querySelectorAll('.hit')].filter(node => !node.hidden).map(node => node.getBoundingClientRect())
      .map(r => ({ x: Math.floor(r.left), y: Math.floor(r.top), width: Math.ceil(r.width), height: Math.ceil(r.height) }));
    const key = JSON.stringify(rects);
    if (key === lastHits) return;
    lastHits = key;
    window.hud.hits(rects);
  }
  const scheduleHits = () => requestAnimationFrame(reportHits);

  const strip = window.HudStrip.create({
    root: stripNode,
    pill: document.querySelector('#pill'),
    frame: document.querySelector('#dragframe'),
    isBlocked: () => Boolean(layout?.dragging) || card.isOpen(),
    onClick: id => card.toggle(id),
    onDragStart: () => card.close(),
    onStrips: value => window.hud.strips(value),
  });

  const card = window.HudCard.create({
    root: cardNode,
    strip,
    getItem: id => items.find(item => item.id === id),
    getTokens: () => tokens,
    getMetric: id => settings?.metrics?.[id] || 'quota',
    setMetric(id, metric) {
      settings = { ...settings, metrics: { ...settings?.metrics, [id]: metric } };
      card.refresh();
      window.hud.setSettings({ metrics: { [id]: metric } }).catch(() => {});
    },
    settingsView: null,
    onOpenStats: () => { window.hud.openStats().catch(() => {}); },
    onChange: scheduleHits,
  });

  new ResizeObserver(scheduleHits).observe(stripNode);

  function applyLayout(next) {
    if (!next) return;
    layout = next;
    document.body.classList.remove('edge-left', 'edge-right', 'edge-top', 'edge-bottom');
    document.body.classList.add(`edge-${layout.edge}`);
    document.body.classList.toggle('dragging', layout.dragging);
    if (layout.dragging) { strip.hidePill(true); card.close(); }
    strip.place(layout);
    card.reposition();
    scheduleHits();
  }

  window.hud.onState(next => { items = Array.isArray(next) ? next : []; strip.setItems(items); card.refresh(); scheduleHits(); });
  window.hud.onTokens(next => { tokens = next; card.refresh(); });
  window.hud.onSettings(next => { settings = next; strip.setSettings(next); card.refresh(); scheduleHits(); });
  window.hud.onLayout(applyLayout);
  document.addEventListener('keydown', event => { if (event.key === 'Escape') card.close(); });
  window.addEventListener('blur', () => card.close());

  // Items go in before settings: the strip only renders once it has settings, and its
  // first measurement should already include every number.
  document.fonts.load('500 13px Inter').catch(() => {}).then(() => window.hud.initial()).then(state => {
    items = Array.isArray(state.items) ? state.items : [];
    tokens = state.tokens;
    settings = state.settings;
    strip.setItems(items);
    strip.setSettings(settings);
    applyLayout(state.layout);
  }).catch(() => {});
})();
```

- [ ] **Step 9: 运行确认通过**

Run: `npm run check && npm run check:desktop`
Expected: 单测全部 PASS；冒烟 `{"passed":8,…}`。打开 `hud-card-quota.png`、`hud-card-burn.png`、`hud-tooltip.png`，与视频 5s、7s、8s 帧目测对照（卡片在浮条左侧、三按钮、行布局、紫蓝堆叠柱、浮层压在行上）。

- [ ] **Step 10: Commit**

```bash
git add src/renderer/hud-chart.js src/renderer/hud-card.js src/renderer/chart.css src/renderer/hud.css src/renderer/hud.html src/renderer/hud.js scripts/smoke-desktop.cjs
git -c user.name=CHIWAWAFROMkk -c user.email=323616687+CHIWAWAFROMkk@users.noreply.github.com commit -m "feat: 照视频重做点击卡片——额度/速率/Token 三种模式、按模型堆叠的 Token 柱与浮层

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: 卡片设置页与接入操作

**Files:**
- Create: `src/renderer/hud-settings.js`
- Modify: `src/renderer/hud.html`（加脚本）, `src/renderer/hud.css`（追加样式）, `src/renderer/hud.js`（`settingsView`）, `scripts/smoke-desktop.cjs`（打桩 `shell` 并插入检查）
- Test: `npm run check:desktop`

**Interfaces:**
- Consumes: `HudCard` 的 `settingsView({ back })`；`window.hud.setSettings`、`window.hud.action`；`Item.setup`、`Item.state`。
- Produces: `window.HudSettings.view({ settings, items, back, onChange(patch), onAction(name) }) → Node[]`；DOM：`#card input[data-key=size|ringWidth|showsRings|showsNumbers]`、`#card [data-row=…]`、`#card .set-row > span:first-child`、`#card [data-act=back]`、`#card .set-status`。

- [ ] **Step 1: 写失败的冒烟检查**

在 `scripts/smoke-desktop.cjs` 中 `const checks = [];` 一行之前插入（让「Setup guide」不真的打开文件）：

```js
const { shell } = require('electron');
const opened = [];
shell.openPath = async target => { opened.push(target); return ''; };
shell.openExternal = async target => { opened.push(target); };
```

在 `// <<more checks>>` 之前插入：

```js
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
```

- [ ] **Step 2: 运行确认失败**

Run: `npm run check:desktop`
Expected: FAIL（齿轮无反应，等不到 `Settings` 标题）。

- [ ] **Step 3: 新建 `src/renderer/hud-settings.js`**

```js
(function () {
  'use strict';
  const { el, icon } = window.HudDom;
  const RESULTS = { opened: 'Opened', connected: 'Connected', disconnected: 'Disconnected' };
  // ipcRenderer.invoke prefixes errors with "Error invoking remote method '…': Error: ".
  const plainError = error => String(error?.message || 'Failed').replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '');

  // Built once per visit; inputs change the strip live without rebuilding this page.
  function view({ settings, items, back, onChange, onAction }) {
    const status = el('p', { class: 'set-status', 'aria-live': 'polite' });
    const row = (key, label, control) => el('div', { class: 'set-row', 'data-row': key }, [el('span', { text: label }), control]);
    let ringRow = null;

    function toggle(key) {
      const input = el('input', { type: 'checkbox', class: 'switch', role: 'switch', 'data-key': key, 'aria-label': key });
      input.checked = Boolean(settings[key]);
      input.addEventListener('change', () => {
        onChange({ [key]: input.checked });
        if (key === 'showsRings' && ringRow) ringRow.hidden = !input.checked;
      });
      return input;
    }

    function slider(key, min, max, step) {
      const input = el('input', { type: 'range', class: 'slider', 'data-key': key, min, max, step, 'aria-label': key });
      input.value = String(settings[key]);
      const shown = el('span', { class: 'set-value', text: String(settings[key]) });
      input.addEventListener('input', () => { shown.textContent = input.value; onChange({ [key]: Number(input.value) }); });
      return el('span', { class: 'set-slider' }, [input, shown]);
    }

    function action(name, label) {
      const button = el('button', { class: 'btn', type: 'button', text: label });
      button.addEventListener('click', () => {
        button.disabled = true;
        status.textContent = '';
        Promise.resolve(onAction(name))
          .then(result => { status.textContent = RESULTS[result?.status] || 'Done'; }, error => { status.textContent = plainError(error); })
          .finally(() => { button.disabled = false; });
      });
      return button;
    }

    const reset = el('button', { class: 'btn', type: 'button', text: 'Reset' });
    reset.addEventListener('click', () => onChange({ resetPosition: true }));
    const backButton = el('button', { class: 'back', type: 'button', 'data-act': 'back', 'aria-label': 'Back', title: 'Back' }, [icon('back')]);
    backButton.addEventListener('click', back);
    ringRow = row('ringWidth', 'Ring thickness', slider('ringWidth', 1, 4, 0.5));
    ringRow.hidden = !settings.showsRings;

    const claude = items.find(item => item.id === 'claude');
    const claudeNote = claude?.setup === 'claude-disconnect' ? 'statusLine connected'
      : claude?.state === 'live' || claude?.state === 'stale' ? 'Official usage API' : 'Not connected';

    return [
      el('section', { class: 'sec' }, [el('header', { class: 'head' }, [backButton, el('h2', { text: 'Settings' })])]),
      el('section', { class: 'sec set' }, [
        el('h3', { text: 'Display' }),
        row('size', 'Size', slider('size', 16, 40, 1)),
        row('showsRings', 'Show rings', toggle('showsRings')),
        ringRow,
        row('showsNumbers', 'Show numbers', toggle('showsNumbers')),
        row('position', 'Position', reset),
      ]),
      el('section', { class: 'sec set' }, [
        el('h3', { text: 'Connections' }),
        row('claude', 'Claude', el('span', { class: 'set-actions' }, [
          el('span', { class: 'set-note', text: claudeNote }),
          claude?.setup === 'claude-connect' ? action('claude-connect', 'Connect') : null,
          claude?.setup === 'claude-disconnect' ? action('claude-disconnect', 'Disconnect') : null,
          action('claude-help', 'Setup guide'),
        ])),
        row('workbuddy', 'WorkBuddy', action('open-workbuddy', 'Sign in')),
        row('deepseek', 'DeepSeek', el('span', { class: 'set-note', text: 'Set DEEPSEEK_API_KEY to read balance' })),
        status,
      ]),
    ];
  }

  window.HudSettings = { view };
})();
```

- [ ] **Step 4: 追加设置页样式到 `src/renderer/hud.css`（放在 `@media (prefers-reduced-motion …)` 之前）**

```css
/* Settings page inside the card. */
.back { flex: none; width: 20px; height: 20px; display: grid; place-items: center; border-radius: 5px; color: var(--text-2); }
.back:hover { background: rgba(245, 245, 247, 0.06); }
.back .icon-svg { width: 12px; height: 12px; }
.set { gap: 4px; }
.set h3 { margin: 0 0 2px; padding: 0 6px; font-size: 11px; font-weight: 600; color: var(--text-2); }
.set-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; min-height: 28px; padding: 0 6px; font-size: 13px; }
.set-slider, .set-actions { display: flex; align-items: center; gap: 8px; }
.set-value { width: 28px; text-align: right; font-size: 12px; color: var(--text-2); }
.set-note { font-size: 12px; color: var(--text-2); }
.slider { width: 140px; margin: 0; accent-color: var(--ok); }
.switch { appearance: none; position: relative; width: 30px; height: 18px; margin: 0; border-radius: 9px; background: rgba(255, 255, 255, 0.18); transition: background 0.2s var(--ease); }
.switch::after { content: ''; position: absolute; left: 2px; top: 2px; width: 14px; height: 14px; border-radius: 50%; background: #fff; transition: transform 0.2s var(--ease); }
.switch:checked { background: var(--ok); }
.switch:checked::after { transform: translateX(12px); }
.btn { padding: 3px 10px; border-radius: 6px; background: rgba(245, 245, 247, 0.12); font-size: 12px; white-space: nowrap; }
.btn:hover { background: rgba(245, 245, 247, 0.18); }
.btn:disabled { opacity: 0.5; }
.set-status { min-height: 16px; margin: 0; padding: 0 6px; font-size: 11px; color: var(--text-2); }
```

- [ ] **Step 5: 接上设置页**

`src/renderer/hud.html`：在 `<script src="hud-card.js"></script>` 后加 `<script src="hud-settings.js"></script>`。

`src/renderer/hud.js`：把 `settingsView: null,` 替换为：

```js
    settingsView: ({ back }) => window.HudSettings.view({
      settings,
      items,
      back,
      onChange: patch => window.hud.setSettings(patch).catch(() => {}),
      onAction: name => window.hud.action(name),
    }),
```

- [ ] **Step 6: 运行确认通过**

Run: `npm run check && npm run check:desktop`
Expected: 单测全部 PASS；冒烟 `{"passed":9,…}`；`hud-settings.png` 存在。

- [ ] **Step 7: Commit**

```bash
git add src/renderer/hud-settings.js src/renderer/hud.css src/renderer/hud.html src/renderer/hud.js scripts/smoke-desktop.cjs
git -c user.name=CHIWAWAFROMkk -c user.email=323616687+CHIWAWAFROMkk@users.noreply.github.com commit -m "feat: 卡片设置页——尺寸、圆环、数字、复位与 Claude/WorkBuddy 接入入口

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Task 9: 24 小时 Token 统计窗口

**Files:**
- Create: `src/main/stats-window.cjs`, `src/main/preload-stats.cjs`, `src/renderer/stats.html`, `src/renderer/stats.css`, `src/renderer/stats.js`, `tests/stats-window.test.mjs`
- Modify: `src/main/main.cjs`, `scripts/smoke-desktop.cjs`（在 `// <<more checks>>` 前插入）

**Interfaces:**
- Consumes: `buildHudTokens` 的结果；`window.HudChart.render(series, { height, source, axis })`、`colorOf`；`window.HudDom`。
- Produces: `createStats({ getTokens, electron }) → { open(), push(tokens), window(), destroy() }`；IPC invoke `stats:initial`、push `stats:tokens`；预加载 `window.stats = { initial, onTokens }`。

- [ ] **Step 1: 写失败的测试**

新建 `tests/stats-window.test.mjs`：

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import statsWindow from '../src/main/stats-window.cjs';

class Emitter {
  constructor() { this.handlers = {}; }
  on(name, fn) { (this.handlers[name] ||= []).push(fn); return this; }
  once(name, fn) { return this.on(name, fn); }
  emit(name, ...args) { for (const fn of this.handlers[name] || []) fn(...args); }
}

function fakeElectron() {
  const windows = [];
  class BrowserWindow extends Emitter {
    constructor(options) {
      super();
      this.options = options;
      this.shown = 0;
      this.focused = 0;
      this.destroyed = false;
      this.sent = [];
      this.webContents = Object.assign(new Emitter(), {
        mainFrame: { url: pathToFileURL(path.resolve('src/renderer/stats.html')).href },
        session: { setPermissionRequestHandler() {}, setPermissionCheckHandler() {} },
        setWindowOpenHandler() {},
        send: (channel, payload) => { this.sent.push([channel, payload]); },
      });
      windows.push(this);
    }
    show() { this.shown++; }
    focus() { this.focused++; }
    isDestroyed() { return this.destroyed; }
    loadFile() { return Promise.resolve(); }
    destroy() { this.destroyed = true; this.emit('closed'); }
  }
  const ipc = { handle: {} };
  const ipcMain = { handle(channel, fn) { ipc.handle[channel] = fn; }, removeHandler(channel) { delete ipc.handle[channel]; } };
  return { electron: { BrowserWindow, ipcMain }, ipc, windows };
}

test('the statistics window is one sandboxed window fed only by the main process', async () => {
  const fake = fakeElectron();
  const tokens = { claude: { status: 'ok' } };
  const stats = statsWindow.createStats({ getTokens: () => tokens, electron: fake.electron });
  stats.open();
  stats.open();
  assert.equal(fake.windows.length, 1, 'a second open focuses the same window');
  const win = fake.windows[0];
  assert.equal(win.focused, 1);
  assert.deepEqual([win.options.webPreferences.sandbox, win.options.webPreferences.contextIsolation, win.options.webPreferences.nodeIntegration], [true, true, false]);
  win.emit('ready-to-show');
  assert.ok(win.shown >= 1);
  const event = { sender: win.webContents, senderFrame: win.webContents.mainFrame };
  assert.equal(await fake.ipc.handle['stats:initial'](event), tokens);
  assert.throws(() => fake.ipc.handle['stats:initial']({ sender: {}, senderFrame: win.webContents.mainFrame }), /不可信/);
  stats.push({ codex: 1 });
  assert.deepEqual(win.sent.at(-1), ['stats:tokens', { codex: 1 }]);
  win.destroy();
  stats.open();
  assert.equal(fake.windows.length, 2, 'reopens after being closed');
  stats.destroy();
  assert.equal(fake.ipc.handle['stats:initial'], undefined);
});
```

在 `scripts/smoke-desktop.cjs` 的 `// <<more checks>>` 之前插入：

```js
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
```

- [ ] **Step 2: 运行确认失败**

Run: `node --test tests/stats-window.test.mjs`
Expected: FAIL（`Cannot find module '../src/main/stats-window.cjs'`）。

- [ ] **Step 3: 新建 `src/main/stats-window.cjs`**

```js
const path = require('node:path');
const { isTrustedRenderer } = require('./security.cjs');

const statsEntry = path.join(__dirname, '..', 'renderer', 'stats.html');

// A plain dark window with the 24-hour token charts; it shows only what the main process sends.
function createStats({ getTokens, electron = require('electron') }) {
  const { BrowserWindow, ipcMain } = electron;
  let win = null;
  const alive = () => win && !win.isDestroyed();
  const trusted = event => alive() && event.sender === win.webContents && event.senderFrame === win.webContents.mainFrame && isTrustedRenderer(event.senderFrame.url, statsEntry);
  ipcMain.handle('stats:initial', event => {
    if (!trusted(event)) throw new Error('不可信的请求来源');
    return getTokens();
  });

  function open() {
    if (alive()) { win.show(); win.focus(); return; }
    win = new BrowserWindow({
      width: 720, height: 420, minWidth: 560, minHeight: 360, show: false, title: 'Token usage',
      backgroundColor: '#000000', autoHideMenuBar: true, titleBarStyle: 'hidden',
      titleBarOverlay: { color: '#000000', symbolColor: '#98989d', height: 36 },
      webPreferences: { preload: path.join(__dirname, 'preload-stats.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true },
    });
    const created = win;
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('will-navigate', (event, url) => { if (!isTrustedRenderer(url, statsEntry)) event.preventDefault(); });
    win.webContents.on('will-attach-webview', event => event.preventDefault());
    win.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    win.webContents.session.setPermissionCheckHandler(() => false);
    win.once('ready-to-show', () => { if (win === created && alive()) win.show(); });
    win.on('closed', () => { if (win === created) win = null; });
    win.loadFile(statsEntry).catch(() => {});
  }

  return {
    open,
    push(tokens) { try { if (alive()) win.webContents.send('stats:tokens', tokens); } catch { /* reloading */ } },
    window: () => (alive() ? win : null),
    destroy() {
      ipcMain.removeHandler('stats:initial');
      if (alive()) win.destroy();
      win = null;
    },
  };
}

module.exports = { createStats };
```

- [ ] **Step 4: 新建 `src/main/preload-stats.cjs`**

```js
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('stats', {
  initial: () => ipcRenderer.invoke('stats:initial'),
  onTokens: (callback) => {
    const listener = (_event, value) => callback(value);
    ipcRenderer.on('stats:tokens', listener);
    return () => ipcRenderer.removeListener('stats:tokens', listener);
  },
});
```

- [ ] **Step 5: 新建页面三件套**

`src/renderer/stats.html`：

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'self'; style-src 'self'; font-src 'self' file:; img-src 'self' file:; object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'">
  <title>Token usage</title>
  <link rel="stylesheet" href="chart.css">
  <link rel="stylesheet" href="stats.css">
</head>
<body>
  <header class="titlebar"><h1>Token usage</h1><span>Last 24 hours</span></header>
  <main id="sources"></main>
  <script src="hud-dom.js"></script>
  <script src="hud-chart.js"></script>
  <script src="stats.js"></script>
</body>
</html>
```

`src/renderer/stats.css`：

```css
@font-face {
  font-family: 'Inter';
  src: url('../../assets/fonts/inter-latin-wght-normal.woff2') format('woff2');
  font-weight: 100 900;
  font-style: normal;
  font-display: block;
}
:root { color-scheme: dark; --text: #f5f5f7; --text-2: #98989d; --text-3: #6e6e73; --divider: rgba(255, 255, 255, 0.10); --font: 'Inter', 'Segoe UI Variable Text', 'Segoe UI', system-ui, sans-serif; }
* { box-sizing: border-box; }
html, body { margin: 0; background: #000; color: var(--text); font: 13px/1.35 var(--font); font-feature-settings: 'tnum' 1; -webkit-font-smoothing: antialiased; }
.titlebar { -webkit-app-region: drag; height: 36px; display: flex; align-items: baseline; gap: 10px; padding: 10px 18px 0; user-select: none; }
.titlebar h1 { margin: 0; font-size: 13px; font-weight: 700; }
.titlebar span { font-size: 12px; color: var(--text-2); }
main { display: flex; flex-direction: column; gap: 18px; padding: 8px 18px 18px; }
.source + .source { padding-top: 14px; border-top: 1px solid var(--divider); }
.source-head { display: flex; align-items: center; gap: 8px; }
.source-logo { width: 16px; height: 16px; }
.source-head h2 { flex: 1; margin: 0; font-size: 13px; font-weight: 600; }
.source-total { font-size: 12px; color: var(--text-2); }
.models { width: 100%; margin-top: 10px; border-collapse: collapse; font-size: 12px; }
.models th { padding: 4px 0; text-align: left; font-weight: 500; color: var(--text-3); }
.models td { padding: 4px 0; border-top: 1px solid var(--divider); }
.models th:not(:first-child), .models td:not(:first-child) { text-align: right; }
.models .dot { display: inline-block; width: 8px; height: 8px; margin-right: 8px; border-radius: 50%; }
.empty { color: var(--text-2); }
```

`src/renderer/stats.js`：

```js
(function () {
  'use strict';
  const { el, fmtInt, logo } = window.HudDom;
  const NAMES = { claude: 'Claude', codex: 'Codex' };
  const root = document.querySelector('#sources');

  function table(series) {
    return el('table', { class: 'models' }, [
      el('thead', {}, [el('tr', {}, [el('th', { text: 'Model' }), el('th', { text: 'Tokens' }), el('th', { text: 'Share' })])]),
      el('tbody', {}, series.models.map((model, m) => {
        const dot = el('i', { class: 'dot' });
        dot.style.background = window.HudChart.colorOf(model, m);
        return el('tr', {}, [
          el('td', {}, [dot, el('span', { text: model.name })]),
          el('td', { text: fmtInt(model.total) }),
          el('td', { text: `${((model.total / series.total) * 100).toFixed(1)}%` }),
        ]);
      })),
    ]);
  }

  function render(tokens) {
    const sources = ['claude', 'codex'].map(id => [id, tokens?.[id]]).filter(([, series]) => series?.status === 'ok' && series.total > 0);
    if (!sources.length) { root.replaceChildren(el('p', { class: 'empty', text: 'No token data in the last 24h' })); return; }
    root.replaceChildren(...sources.map(([id, series]) => el('section', { class: 'source' }, [
      el('header', { class: 'source-head' }, [logo(id, 'source-logo'), el('h2', { text: NAMES[id] }), el('span', { class: 'source-total', text: `${fmtInt(series.total)} tokens${series.partial ? ' · partial' : ''}` })]),
      window.HudChart.render(series, { height: 120, source: id, axis: true }),
      table(series),
    ])));
  }

  window.stats.onTokens(render);
  window.stats.initial().then(render).catch(() => render(null));
})();
```

- [ ] **Step 6: `main.cjs` 接入统计窗口**

require 区加：

```js
const { createStats } = require('./stats-window.cjs');
```

变量区加：

```js
let stats = null;
let lastTokens = null;
```

`performRefresh` 里 token 一行改为：

```js
  tokenLedger?.read().then(tokens => {
    lastTokens = buildHudTokens(tokens);
    hud?.pushTokens(lastTokens);
    stats?.push(lastTokens);
  }).catch(() => {});
```

`app.whenReady()` 里 `hud = createHud({` 之前加 `stats = createStats({ getTokens: () => lastTokens });`，并在 `createHud` 参数里加 `onOpenStats: () => stats.open(),`。`before-quit` 里 `hud?.destroy();` 之后加 `stats?.destroy();`。

- [ ] **Step 7: 运行确认通过**

Run: `npm run check && npm run check:desktop`
Expected: 单测全部 PASS；冒烟 `{"passed":10,…}`；`stats.png` 存在（黑底、Claude 一张 120 高的堆叠柱、底部 5 个时间刻度、两行模型表）。

- [ ] **Step 8: Commit**

```bash
git add src/main/stats-window.cjs src/main/preload-stats.cjs src/main/main.cjs src/renderer/stats.html src/renderer/stats.css src/renderer/stats.js tests/stats-window.test.mjs scripts/smoke-desktop.cjs
git -c user.name=CHIWAWAFROMkk -c user.email=323616687+CHIWAWAFROMkk@users.noreply.github.com commit -m "feat: 卡片统计按钮打开 24 小时 Token 统计窗口

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: 横条冒烟、与原片对照图、文档与收尾

**Files:**
- Create: `scripts/compare-sheet.cjs`
- Modify: `scripts/smoke-desktop.cjs`（在 `// <<more checks>>` 前插入）, `README.md`, `package.json`（只加一个 script）
- Test: `npm run check:desktop`

**Interfaces:**
- Consumes: 冒烟截图 `hud-strip.png`、`hud-pill.png`、`hud-card-quota.png`、`hud-card-burn.png`、`hud-tooltip.png`、`hud-top.png`；原片帧 `f015 f043 f058 f087 f102 f281`。
- Produces: `npm run compare -- <参考帧目录> <冒烟输出目录>` 生成 `compare.png`。

- [ ] **Step 1: 写失败的冒烟检查（拖到上边变横条）**

在 `// <<more checks>>` 之前插入（打桩 `screen.getCursorScreenPoint`，主进程拖动逻辑读的就是它）：

```js
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
```

- [ ] **Step 2: 运行确认（这一步应直接通过，用来锁住行为）**

Run: `npm run check:desktop`
Expected: `{"passed":11,…}`。如果失败，按失败信息修 `hud-strip.js` / `hud-window.cjs`，不要改断言。

- [ ] **Step 3: 新建 `scripts/compare-sheet.cjs`**

```js
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
```

`package.json` 的 `scripts` 里加一行（不动依赖）：

```json
    "compare": "electron scripts/compare-sheet.cjs",
```

- [ ] **Step 4: 准备原片帧并生成对照图**

```bash
git -c http.proxy=http://127.0.0.1:7890 clone --depth 1 https://github.com/jazzenchen/agent-hud-open.git work/agent-hud-open
mkdir -p work/reference
python -I -c "import sys; from PIL import Image; im = Image.open(sys.argv[1]); [(im.seek(i), im.convert('RGB').save(f'{sys.argv[2]}/f{i:03d}.png')) for i in (15, 43, 58, 87, 102, 281)]" work/agent-hud-open/docs/videos/simple-mode-tour.zh-CN.webp work/reference
npm run compare -- work/reference "$(ls -td work/desktop-smoke-* | head -1)"
```

Expected: 打印 `…/compare.png` 路径。打开它逐行对照：浮条外形与数字颜色、胶囊位置、卡片三行与按钮、速率模式文字、Token 浮层、上边横条。发现与视频不一致的地方，记下来在汇报里列出（属于数值层面的差异就回到对应任务的 CSS 修正、重跑冒烟，再在提交信息里写明）。`work/` 不进 git。

- [ ] **Step 5: README 改写**

把 `README.md` 里从 `## 贴边 HUD` 到下一个 `## ` 标题之前的整段替换为：

```markdown
## 贴边 HUD

界面照 Agent HUD（`jazzenchen/agent-hud-open`，Apache-2.0）的简约形态复刻，QuotaDeck 只有这一种界面：

- 屏幕边缘一条小浮条，Codex、Claude、Antigravity、WorkBuddy、DeepSeek 各一个额度圆环；数字是已用比例（余额类写余额），不到 70% 绿、70% 起黄、90% 起红，没读到写 `–`。
- 鼠标停在图标上 0.4 秒，旁边伸出一行明细，例如 `5h 12%  Weekly 79%  Opus 60%`。
- 点击图标弹出这家的卡片：右上角 `%` / `🔥` / `#` 切换已用比例、消耗速率、每小时 Token；Claude 与 Codex 还有过去 24 小时按模型堆叠的 Token 柱，悬停看每 15 分钟明细。
- 卡片左下齿轮是设置（尺寸、圆环、数字、复位位置、Claude statusLine 与 WorkBuddy 接入），右下图标打开 24 小时 Token 统计窗口。
- 按住浮条拖动，它会实时吸到离指针最近的屏幕边，贴上下边时变成横条；松手后位置会记住。托盘菜单「显示 HUD」可开关。
```

在 `## 参考项目` 一节末尾加一行：

```markdown
- 界面字体 Inter（SIL OFL 1.1），许可证见 `assets/fonts/LICENSE-inter.txt`。
```

- [ ] **Step 6: 全量检查**

```bash
npm run check
npm run check:desktop
npm run package:portable
```

Expected: 单测全部 PASS（记录通过数）；冒烟 `{"passed":11,…}`；打包成功并通过 `verify-package.ps1`。打包若因环境原因失败（例如缺 pwsh），写明「未执行/失败原因」，不要声称成功。

- [ ] **Step 7: Commit**

```bash
git add scripts/compare-sheet.cjs scripts/smoke-desktop.cjs README.md package.json
git -c user.name=CHIWAWAFROMkk -c user.email=323616687+CHIWAWAFROMkk@users.noreply.github.com commit -m "test: 横条冒烟与原片对照图；README 改为 HUD 说明

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 8: 交给用户的手动验收清单（不由 AI 宣称已验证）**

1. 启动后屏幕右边出现竖条，五个图标顺序为 Codex、Claude、Antigravity、WorkBuddy、DeepSeek；Claude 圆环读数与蕾蒂一致。
2. 停在 Claude 图标约 0.4 秒出胶囊；滑到别的图标胶囊跟着移；移开后收回。
3. 点 Claude，卡片从图标处展开；`%` / `🔥` / `#` 切换；悬停 Token 柱出浮层；重启后各家选的模式还在。
4. 齿轮 → 设置页：拖 Size 滑块浮条实时变化；关「Show rings」「Show numbers」再打开；「Reset」回到右边。
5. 卡片右下图标打开统计窗口，能关闭、再打开。
6. 拖动浮条到四条边，实时吸附，上下边变横条；松手后重启位置保留。
7. Esc、再点同一图标、点到别的软件都能关卡片；切到别的软件（包括全屏程序）时 HUD 仍在最上层。
8. 鼠标在浮条和卡片以外时，下面的窗口能正常点击（穿透）。
9. 托盘菜单只有：显示 HUD、刷新全部、重新加载界面、退出。
