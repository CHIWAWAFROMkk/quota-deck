import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import hudWindow from '../src/main/hud-window.cjs';

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

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
      this.moves = 0;
      this.loads = 0;
      this.position = [0, 0];
      this.destroyed = false;
      this.webContents = Object.assign(new Emitter(), {
        mainFrame: { url: pathToFileURL(path.resolve('src/renderer/hud.html')).href },
        session: { setPermissionRequestHandler() {}, setPermissionCheckHandler() {} },
        setWindowOpenHandler() {},
        send() {},
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
    setBounds(bounds) { this.position = [bounds.x, bounds.y]; }
    getBounds() { return { x: this.position[0], y: this.position[1], width: 480, height: 480 }; }
    isVisible() { return true; }
    getPosition() { return this.position; }
    setPosition(x, y) { this.position = [x, y]; this.moves++; }
    loadFile() { this.loads++; return Promise.resolve(); }
    destroy() { this.destroyed = true; }
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

test('a renderer crash ends the drag and restores click-through and focus before reloading', async () => {
  const fake = fakeElectron();
  const hud = hudWindow.createHud({ settingsPath: await settingsPath(), onRefresh: async () => {}, onOpenPanel() {}, electron: fake.electron });
  const win = fake.windows[0];
  win.webContents.emit('did-finish-load');
  const event = { sender: win.webContents, senderFrame: win.webContents.mainFrame };
  fake.ipc.on['hud:card'](event, true);
  fake.ipc.on['hud:drag'](event, 'start');
  assert.equal(win.ignore, false);
  assert.equal(win.focusable, true);

  win.webContents.emit('render-process-gone', {}, { reason: 'crashed' });
  assert.equal(win.ignore, true, 'click-through restored');
  assert.equal(win.focusable, false, 'card focus released');
  const moves = win.moves;
  fake.moveCursor(100, 100);
  await sleep(80);
  assert.equal(win.moves, moves, 'drag timer stopped');
  await sleep(300);
  assert.equal(win.loads, 2, 'renderer reloaded once');
  hud.destroy();
});

test('untrusted senders cannot drive the HUD', async () => {
  const fake = fakeElectron();
  const hud = hudWindow.createHud({ settingsPath: await settingsPath(), onRefresh: async () => {}, onOpenPanel() {}, electron: fake.electron });
  const win = fake.windows[0];
  win.webContents.emit('did-finish-load');
  const alien = { sender: {}, senderFrame: win.webContents.mainFrame };
  fake.ipc.on['hud:hits'](alien, [{ x: 0, y: 0, width: 480, height: 480 }]);
  await sleep(100);
  fake.ipc.on['hud:card'](alien, true);
  assert.equal(win.ignore, true);
  assert.equal(win.focusable, false);
  assert.throws(() => fake.ipc.handle['hud:initial'](alien));
  hud.destroy();
});

test('the main process drops click-through only while the cursor is over a reported hit area', async () => {
  const fake = fakeElectron();
  const hud = hudWindow.createHud({ settingsPath: await settingsPath(), onRefresh: async () => {}, onOpenPanel() {}, electron: fake.electron });
  const win = fake.windows[0];
  win.webContents.emit('did-finish-load');
  const event = { sender: win.webContents, senderFrame: win.webContents.mainFrame };
  fake.ipc.on['hud:hits'](event, [{ x: 443, y: 161, width: 34, height: 158 }]);
  fake.moveCursor(1440 + 450, 104 + 200);
  await sleep(120);
  assert.equal(win.ignore, false, 'over the strip');
  fake.moveCursor(1440 + 100, 104 + 100);
  await sleep(120);
  assert.equal(win.ignore, true, 'over the transparent area');
  fake.ipc.on['hud:hits'](event, 'garbage');
  fake.moveCursor(1440 + 450, 104 + 200);
  await sleep(120);
  assert.equal(win.ignore, true, 'invalid hits mean nothing to hit');
  hud.destroy();
});
