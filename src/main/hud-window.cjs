const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { isTrustedRenderer } = require('./security.cjs');
const { STRIP, WINDOW_SIZE, layoutHud, normalizeHudSettings, pickDisplay, snapToEdge } = require('./hud-geometry.cjs');

const hudEntry = path.join(__dirname, '..', 'renderer', 'hud.html');
const DRAG_LIMIT_MS = 60_000;
// On Windows only 'normal' and 'pop-up-menu'+ make the window topmost; 'floating' (the default) does not.
const TOP_LEVEL = 'normal';
const SEND_CHANNELS = ['hud:pointer', 'hud:drag', 'hud:card'];
const INVOKE_CHANNELS = ['hud:initial', 'hud:refresh', 'hud:open-panel'];

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

// `electron` is injectable so tests can drive the window logic with fakes.
function createHud({ settingsPath, onRefresh, onOpenPanel, electron = require('electron') }) {
  const { BrowserWindow, ipcMain, screen } = electron;
  let settings = loadSettings(settingsPath);
  let win = null;
  let layout = null;
  let items = [];
  let tokens = null;
  let drag = null;
  let ignoring = null;
  let recoveries = [];

  const alive = () => win && !win.isDestroyed();
  const send = (channel, payload) => { try { if (alive()) win.webContents.send(channel, payload); } catch { /* renderer restarting */ } };
  const layoutMessage = (dragging = false) => (layout ? { edge: layout.edge, strip: layout.strip, size: { width: layout.window.width, height: layout.window.height }, dragging } : null);
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

  function place() {
    if (!alive() || drag) return;
    const display = pickDisplay(screen.getAllDisplays(), screen.getPrimaryDisplay(), settings.displayId);
    layout = layoutHud({ workArea: display.workArea, edge: settings.edge, offset: settings.offset });
    win.setBounds(layout.window, false);
    send('hud:layout', layoutMessage());
  }

  // A new renderer starts with no press, no open card and the pointer outside;
  // put the window back to match before it loads, or a drag or card could outlive it.
  function resetInteraction() {
    if (drag) { clearInterval(drag.timer); drag = null; }
    if (!alive()) return;
    setIgnore(true);
    win.setFocusable(false);
    place();
  }

  function startDrag() {
    if (drag || !alive() || !layout) return;
    const cursor = screen.getCursorScreenPoint();
    const [x, y] = win.getPosition();
    const startedAt = Date.now();
    drag = { dx: cursor.x - x, dy: cursor.y - y, timer: setInterval(() => {
      if (!alive() || Date.now() - startedAt > DRAG_LIMIT_MS) { endDrag(); return; }
      const point = screen.getCursorScreenPoint();
      win.setPosition(point.x - drag.dx, point.y - drag.dy, false);
    }, 16) };
    setIgnore(false);
    send('hud:layout', layoutMessage(true));
  }

  function endDrag() {
    if (!drag) return;
    clearInterval(drag.timer);
    drag = null;
    if (!alive() || !layout) return;
    const [x, y] = win.getPosition();
    const vertical = layout.edge === 'left' || layout.edge === 'right';
    const center = {
      x: x + layout.strip.x + (vertical ? STRIP.short : STRIP.long) / 2,
      y: y + layout.strip.y + (vertical ? STRIP.long : STRIP.short) / 2,
    };
    const display = screen.getDisplayNearestPoint({ x: Math.round(center.x), y: Math.round(center.y) });
    settings = { ...settings, displayId: display.id, ...snapToEdge({ workArea: display.workArea, point: center }) };
    saveSettings(settingsPath, settings);
    place();
  }

  function create() {
    win = new BrowserWindow({
      width: WINDOW_SIZE, height: WINDOW_SIZE, show: false, frame: false, transparent: true,
      backgroundColor: '#00000000', resizable: false, minimizable: false, maximizable: false,
      fullscreenable: false, skipTaskbar: true, focusable: false, hasShadow: false, alwaysOnTop: true,
      webPreferences: { preload: path.join(__dirname, 'preload-hud.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true },
    });
    const created = win;
    ignoring = null;
    win.setAlwaysOnTop(true, TOP_LEVEL);
    setIgnore(true);
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('will-navigate', (event, url) => { if (!isTrustedRenderer(url, hudEntry)) event.preventDefault(); });
    win.webContents.on('will-attach-webview', event => event.preventDefault());
    win.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    win.webContents.session.setPermissionCheckHandler(() => false);
    win.webContents.on('did-finish-load', () => {
      if (win !== created || !alive()) return;
      place();
      send('hud:state', items);
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
    win.on('closed', () => { if (win === created) { win = null; if (drag) { clearInterval(drag.timer); drag = null; } } });
    win.loadFile(hudEntry).catch(() => {});
  }

  ipcMain.on('hud:pointer', (event, inside) => { if (trusted(event) && typeof inside === 'boolean' && !drag) setIgnore(!inside); });
  ipcMain.on('hud:drag', (event, phase) => { if (!trusted(event)) return; if (phase === 'start') startDrag(); else if (phase === 'end') endDrag(); });
  ipcMain.on('hud:card', (event, open) => {
    if (!trusted(event) || typeof open !== 'boolean') return;
    win.setFocusable(open);
    if (open) win.focus();
  });
  const guard = handler => (event, ...args) => { if (!trusted(event)) throw new Error('不可信的请求来源'); return handler(...args); };
  ipcMain.handle('hud:initial', guard(() => ({ items, tokens, layout: layoutMessage() })));
  ipcMain.handle('hud:refresh', guard(async () => { await onRefresh(); return true; }));
  ipcMain.handle('hud:open-panel', guard(() => { onOpenPanel(); return true; }));

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
    window: () => (alive() ? win : null),
    destroy() {
      if (drag) { clearInterval(drag.timer); drag = null; }
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
