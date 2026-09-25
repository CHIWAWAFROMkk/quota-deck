const path = require('node:path');
const { app, BrowserWindow, ipcMain, Menu, nativeImage, nativeTheme, screen, shell, Tray } = require('electron');
const { readAll, readProvider, configureHistory } = require('./snapshot.cjs');
const { WORKBUDDY_APP_URL } = require('./workbuddy-client.cjs');
const { runCollaboration, stopOwnedProcesses } = require('./orchestrator.cjs');
const { isTrustedRenderer, validateProviderId } = require('./security.cjs');
const { connect: connectClaudeStatusLine, disconnect: disconnectClaudeStatusLine } = require('./claude-statusline-chain.cjs');
const { nodePath } = require('./local-paths.cjs');
const rendererEntry = path.join(__dirname, '..', 'renderer', 'compact.html');
const providerIds = ['codex', 'claude', 'antigravity', 'deepseek', 'workbuddy'];

let window = null;
let tray = null;
let refreshTimer = null;
let refreshPending = null;
let collaborationPending = false;
let collaborationState = { running: false, result: null, error: null };
let rendererRecoveries = [];

const singleInstanceLock = app.requestSingleInstanceLock();
if (!singleInstanceLock) app.quit();

app.on('second-instance', () => {
  if (!window || window.isDestroyed()) { createWindow(); return; }
  positionWindow();
  window.show();
  window.focus();
});

function createWindow() {
  window = new BrowserWindow({
    width: 520,
    height: 760,
    minWidth: 400,
    minHeight: 560,
    show: false,
    frame: false,
    resizable: true,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#1a1815' : '#f2ede2',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event, url) => {
    if (!isTrustedRenderer(url, rendererEntry)) event.preventDefault();
  });
  window.webContents.on('will-attach-webview', event => event.preventDefault());
  window.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  window.webContents.session.setPermissionCheckHandler(() => false);
  const createdWindow = window;
  window.webContents.on('render-process-gone', (_event, details) => {
    if (app.isQuiting || details.reason === 'clean-exit') return;
    const now = Date.now();
    rendererRecoveries = rendererRecoveries.filter(time => now - time < 60000);
    if (rendererRecoveries.length >= 3) {
      tray?.setToolTip('QuotaDeck · 界面连续异常，请在托盘菜单重新加载');
      return;
    }
    rendererRecoveries.push(now);
    setTimeout(() => {
      if (!app.isQuiting && window === createdWindow && !createdWindow.isDestroyed()) {
        createdWindow.loadFile(rendererEntry).catch(() => {});
      }
    }, 250);
  });
  window.loadFile(rendererEntry).catch(() => {});
  window.on('closed', () => { window = null; });
  window.on('blur', () => {
    if (window && !window.isDestroyed() && !window.webContents.isDevToolsOpened()) window.hide();
  });
  window.on('close', (event) => {
    if (!app.isQuiting) {
      event.preventDefault();
      window.hide();
    }
  });
  window.webContents.once('did-finish-load', async () => {
    if (!window || window.isDestroyed()) return;
    positionWindow();
    window.show();
    window.focus();
    await refreshAll().catch(() => {});
  });
}

function positionWindow() {
  if (!window || window.isDestroyed()) return;
  const point = screen.getCursorScreenPoint();
  const display = screen.getDisplayNearestPoint(point);
  const [width, height] = window.getSize();
  const { x, y, width: workWidth, height: workHeight } = display.workArea;
  window.setPosition(x + Math.max(0, workWidth - width - 12), y + Math.max(0, workHeight - height - 12), false);
}

function toggleWindow() {
  if (!window || window.isDestroyed()) { createWindow(); return; }
  if (window.isVisible()) window.hide();
  else {
    positionWindow();
    window.show();
    window.focus();
  }
}

async function refreshAll() {
  if (refreshPending) return refreshPending;
  refreshPending = performRefresh().finally(() => { refreshPending = null; });
  return refreshPending;
}

async function performRefresh() {
  const snapshot = await readAll();
  if (window && !window.isDestroyed()) window.webContents.send('quota:snapshot', snapshot);
  return snapshot;
}

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
    { label: '显示额度', click: toggleWindow },
    { label: '刷新全部', click: () => { refreshAll().catch(() => {}); } },
    { label: '重新加载界面', click: () => {
      rendererRecoveries = [];
      tray.setToolTip('QuotaDeck · AI 额度');
      if (!window || window.isDestroyed()) createWindow();
      else { window.loadFile(rendererEntry).catch(() => {}); window.show(); }
    } },
    { type: 'separator' },
    { label: '退出', click: () => { app.isQuiting = true; app.quit(); } },
  ]));
  tray.on('click', toggleWindow);
}

app.whenReady().then(() => {
  if (!singleInstanceLock) return;
  configureHistory(path.join(app.getPath('userData'), 'quota-history.json'));
  createWindow();
  createTray();
  refreshTimer = setInterval(() => { refreshAll().catch(() => {}); }, 60_000);
});

app.on('before-quit', () => {
  app.isQuiting = true;
  if (refreshTimer) clearInterval(refreshTimer);
  stopOwnedProcesses();
});

app.on('window-all-closed', () => {});

function handle(channel, handler) {
  ipcMain.handle(channel, (event, ...args) => {
    if (!window || window.isDestroyed() || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame || !isTrustedRenderer(event.senderFrame.url, rendererEntry)) throw new Error('不可信的请求来源');
    return handler(event, ...args);
  });
}
handle('quota:refresh-all', refreshAll);
handle('quota:refresh-provider', async (_event, providerId) => {
  const provider = await readProvider(validateProviderId(providerId, providerIds));
  return provider;
});
handle('quota:open-settings', () => ({ status: 'available', version: app.getVersion(), dataLocation: app.getPath('userData') }));
handle('quota:hide', () => { window.hide(); return true; });
handle('quota:claude-help', async () => {
  const error = await shell.openPath(path.join(__dirname, '../../docs/claude-setup.md'));
  if (error) throw new Error('无法打开 Claude 接入说明');
  return { status: 'opened' };
});
handle('quota:claude-connect', async () => {
  const result = connectClaudeStatusLine({ nodePath });
  await refreshAll().catch(() => {});
  return result;
});
handle('quota:claude-disconnect', async () => {
  const result = disconnectClaudeStatusLine();
  await refreshAll().catch(() => {});
  return result;
});
handle('quota:open-workbuddy', async () => {
  await shell.openExternal(WORKBUDDY_APP_URL);
  return { status: 'opened', url: WORKBUDDY_APP_URL };
});
function notifyCollaboration() {
  // Results remain in this process's memory only; never persist task text.
  try {
    if (window && !window.isDestroyed()) window.webContents.send('collab:state', collaborationState);
  } catch { /* A renderer may be restarting; it can request the state on load. */ }
}
handle('collab:state', () => collaborationState);
handle('collab:run', async (_event, request) => {
  if (collaborationPending) throw new Error('已有协作任务运行，请等待结束');
  collaborationPending = true;
  collaborationState = { running: true, result: null, error: null };
  notifyCollaboration();
  try {
    const result = await runCollaboration(request);
    collaborationState = { running: false, result, error: null };
    return result;
  } catch (error) {
    collaborationState = { running: false, result: null, error: error.message || '协作失败，请重试' };
    throw error;
  } finally { collaborationPending = false; notifyCollaboration(); }
});
