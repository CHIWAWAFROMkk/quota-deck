const path = require('node:path');
const { app, Menu, nativeImage, shell, Tray } = require('electron');
const { readAll, configureHistory } = require('./snapshot.cjs');
const { WORKBUDDY_APP_URL } = require('./workbuddy-client.cjs');
const { connect: connectClaudeStatusLine, disconnect: disconnectClaudeStatusLine } = require('./claude-statusline-chain.cjs');
const { connect: connectApprovalHooks, connectionState: approvalConnectionState, disconnect: disconnectApprovalHooks } = require('./approval-hook-install.cjs');
const { createApprovalServer } = require('./approval-server.cjs');
const { nodePath } = require('./local-paths.cjs');
const { buildHudItems, buildHudTokens } = require('./hud-view.cjs');
const { createHud } = require('./hud-window.cjs');
const { createGameDetector } = require('./game-detector.cjs');
const { createTokenLedger } = require('./token-ledger.cjs');
const { createStats } = require('./stats-window.cjs');
const { createSessionTracker } = require('./session-tracker.cjs');
const { createSessionWatcher } = require('./session-watcher.cjs');
const { returnUrl } = require('./session-links.cjs');

let tray = null;
let refreshTimer = null;
let refreshPending = null;
let hud = null;
let gameDetector = null;
let tokenLedger = null;
let stats = null;
let lastTokens = null;
let sessionTracker = null;
let sessionWatcher = null;
let approvalServer = null;
let approvalStart = null;

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
  tokenLedger?.read().then(tokens => {
    lastTokens = buildHudTokens(tokens);
    hud?.pushTokens(lastTokens);
    stats?.push(lastTokens);
  }).catch(() => {});
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
  'approval-connect': async () => {
    // Only hook files change; push the new state at once instead of waiting on a quota refresh.
    const result = connectApprovalHooks({ nodePath });
    hud?.pushApprovals?.(approvalConnectionState());
    return result;
  },
  'approval-disconnect': async () => {
    // Only hook files change; push the new state at once instead of waiting on a quota refresh.
    const result = disconnectApprovalHooks();
    hud?.pushApprovals?.(approvalConnectionState());
    return result;
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
  sessionTracker = createSessionTracker({ startedAt: Date.now() });
  const pushSessions = () => hud?.pushSessions(sessionTracker.snapshot(Date.now()));
  const dismissSessions = ids => { sessionTracker.dismiss(ids); pushSessions(); };
  configureHistory(path.join(app.getPath('userData'), 'quota-history.json'));
  tokenLedger = createTokenLedger();
  stats = createStats({ getTokens: () => lastTokens });
  approvalServer = createApprovalServer({
    endpointPath: path.join(app.getPath('appData'), 'QuotaDeck', 'approval-endpoint.json'),
    onChange: list => { sessionTracker.setApprovals(list); pushSessions(); },
  });
  const server = approvalServer;
  approvalStart = server.start().catch(error => { console.error('审批服务启动失败:', error); });
  hud = createHud({
    settingsPath: path.join(app.getPath('userData'), 'hud-settings.json'),
    onRefresh: () => refreshAll(),
    onAction: name => actions[name](),
    onOpenStats: () => stats.open(),
    onDismiss: dismissSessions,
    onApprove: async (id, decision) => ({ status: server.decide(id, decision) ? 'decided' : 'gone' }),
    onReturn: async id => {
      const alert = sessionTracker.snapshot(Date.now()).alerts.find(item => item.id === id);
      const url = returnUrl(alert);
      if (!url) return { status: 'unavailable' };
      try { await shell.openExternal(url); }
      catch { return { status: 'unavailable' }; }
      dismissSessions([id]);
      return { status: 'opened' };
    },
  });
  hud.pushApprovals?.(approvalConnectionState());
  gameDetector = createGameDetector({ getGames: () => hud.getGames(), onChange: gaming => hud?.setGaming(gaming) });
  gameDetector.start();
  sessionWatcher = createSessionWatcher({ tracker: sessionTracker, onChange: snapshot => hud?.pushSessions(snapshot) });
  sessionWatcher.start().catch(() => {});
  createTray();
  refreshAll().catch(() => {});
  refreshTimer = setInterval(() => { refreshAll().catch(() => {}); }, 60_000);
});

app.on('before-quit', () => {
  app.isQuiting = true;
  if (refreshTimer) clearInterval(refreshTimer);
  sessionWatcher?.stop();
  gameDetector?.stop();
  hud?.destroy();
  stats?.destroy();
  const server = approvalServer;
  const started = approvalStart;
  approvalServer = null;
  approvalStart = null;
  if (server) {
    // Stop now if listening; otherwise wait for a start that is still binding the port.
    const stop = () => { try { server.stop().catch(() => {}); } catch { /* already closed */ } };
    stop();
    started?.then(stop).catch(() => {});
  }
});

app.on('window-all-closed', () => {});
