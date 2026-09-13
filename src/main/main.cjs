const path = require('node:path');
const { app, BrowserWindow, ipcMain, Menu, nativeImage, screen, shell, Tray } = require('electron');
const { readAll, readProvider } = require('./snapshot.cjs');
const { WORKBUDDY_APP_URL } = require('./workbuddy-client.cjs');
const { runCollaboration } = require('./orchestrator.cjs');

let window = null;
let tray = null;
let refreshTimer = null;

const singleInstanceLock = app.requestSingleInstanceLock();
if (!singleInstanceLock) app.quit();

app.on('second-instance', () => {
  if (!window) return;
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
    backgroundColor: '#f5f5f7',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  window.loadFile(path.join(__dirname, '..', 'renderer', 'compact.html'));
  window.on('blur', () => {
    if (!window.webContents.isDevToolsOpened()) window.hide();
  });
  window.on('close', (event) => {
    if (!app.isQuiting) {
      event.preventDefault();
      window.hide();
    }
  });
  window.webContents.once('did-finish-load', async () => {
    await refreshAll();
    positionWindow();
    window.show();
    window.focus();
  });
}

function positionWindow() {
  const point = screen.getCursorScreenPoint();
  const display = screen.getDisplayNearestPoint(point);
  const [width, height] = window.getSize();
  const { x, y, width: workWidth, height: workHeight } = display.workArea;
  window.setPosition(x + workWidth - width - 12, y + workHeight - height - 12, false);
}

function toggleWindow() {
  if (window.isVisible()) window.hide();
  else {
    positionWindow();
    window.show();
    window.focus();
  }
}

async function refreshAll() {
  const snapshot = await readAll();
  if (window && !window.isDestroyed()) window.webContents.send('quota:snapshot', snapshot);
  return snapshot;
}

function createTray() {
  const icon = nativeImage.createFromPath(path.join(__dirname, '..', '..', 'assets', 'tray.svg'));
  tray = new Tray(icon.resize({ width: 18, height: 18 }));
  tray.setToolTip('QuotaDeck · AI 额度');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '显示额度', click: toggleWindow },
    { label: '刷新全部', click: refreshAll },
    { type: 'separator' },
    { label: '退出', click: () => { app.isQuiting = true; app.quit(); } },
  ]));
  tray.on('click', toggleWindow);
}

app.whenReady().then(() => {
  if (!singleInstanceLock) return;
  createWindow();
  createTray();
  refreshTimer = setInterval(refreshAll, 60_000);
});

app.on('before-quit', () => {
  app.isQuiting = true;
  if (refreshTimer) clearInterval(refreshTimer);
});

app.on('window-all-closed', () => {});

ipcMain.handle('quota:refresh-all', refreshAll);
ipcMain.handle('quota:refresh-provider', async (_event, providerId) => {
  const provider = await readProvider(providerId);
  return provider;
});
ipcMain.handle('quota:open-settings', () => ({ status: 'not-implemented' }));
ipcMain.handle('quota:open-workbuddy', async () => {
  await shell.openExternal(WORKBUDDY_APP_URL);
  return { status: 'opened', url: WORKBUDDY_APP_URL };
});
ipcMain.handle('collab:run', async (_event, request) => runCollaboration(request));
