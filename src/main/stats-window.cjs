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
