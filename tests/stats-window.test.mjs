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
