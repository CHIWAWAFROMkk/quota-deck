const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { isTrustedRenderer } = require('./security.cjs');
const { DEFAULT_SETTINGS, DEFAULT_STRIPS, WINDOW, isValidSetting, layoutHud, normalizeHits, normalizeHudSettings, normalizeStrips, pickDisplay, pointerOverHits, snapToEdge } = require('./hud-geometry.cjs');

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
      // An invalid entry is ignored so the current value stays; the rest of the patch still applies.
      if (!Object.hasOwn(p, key) || !isValidSetting(key, p[key])) continue;
      merged[key] = key === 'metrics' ? { ...settings.metrics, ...p.metrics } : p[key];
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
