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
