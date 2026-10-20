import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import hudWindow from '../src/main/hud-window.cjs';

class Emitter {
  constructor() { this.handlers = {}; }
  on(name, fn) { (this.handlers[name] ||= []).push(fn); return this; }
  once(name, fn) { return this.on(name, fn); }
  emit(name, ...args) { for (const fn of this.handlers[name] || []) fn(...args); }
  removeListener() { return this; }
}

// The same minimal BrowserWindow / ipcMain / screen fakes as hud-window.test.mjs,
// plus the handler bookkeeping the approval channel needs.
function fakeElectron() {
  const workArea = { x: 0, y: 0, width: 1920, height: 1040 };
  const display = { id: 1, workArea };
  const windows = [];
  class BrowserWindow extends Emitter {
    constructor(options) {
      super();
      this.focusable = options.focusable;
      this.ignore = null;
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
    setBounds(bounds) { this.bounds = { ...bounds }; }
    getBounds() { return { ...this.bounds }; }
    isVisible() { return true; }
    loadFile() { return Promise.resolve(); }
    destroy() { this.destroyed = true; }
  }
  const ipc = { on: {}, handle: {} };
  const removedHandlers = [];
  const ipcMain = {
    on(channel, fn) { ipc.on[channel] = fn; },
    handle(channel, fn) { ipc.handle[channel] = fn; },
    removeAllListeners() {},
    removeHandler(channel) { removedHandlers.push(channel); },
  };
  const screen = Object.assign(new Emitter(), {
    getAllDisplays: () => [display],
    getPrimaryDisplay: () => display,
    getCursorScreenPoint: () => ({ x: 1900, y: 400 }),
    getDisplayNearestPoint: () => display,
  });
  return { electron: { BrowserWindow, ipcMain, screen }, ipc, windows, removedHandlers };
}

async function setup(options = {}) {
  const fake = fakeElectron();
  await mkdir('work', { recursive: true });
  const file = path.join(await mkdtemp(path.resolve('work/hud-approval-ipc-test-')), 'hud-settings.json');
  const hud = hudWindow.createHud({ settingsPath: file, onRefresh: async () => {}, electron: fake.electron, ...options });
  const win = fake.windows[0];
  win.webContents.emit('did-finish-load');
  return { fake, hud, win, event: { sender: win.webContents, senderFrame: win.webContents.mainFrame } };
}

test('approval decisions reach the main process only for approval ids and allow/deny', async () => {
  const received = [];
  const { fake, hud, win, event } = await setup({
    onApprove: async (id, decision) => { received.push([id, decision]); return { status: 'decided' }; },
  });
  try {
    assert.deepEqual(await fake.ipc.handle['hud:approve'](event, 'approval:abc', 'allow'), { status: 'decided' });
    assert.deepEqual(await fake.ipc.handle['hud:approve'](event, 'approval:def', 'deny'), { status: 'decided' });
    for (const [id, decision] of [
      ['reply:1', 'allow'], ['maybe', 'allow'], ['approval:abc', 'maybe'],
      [null, 'allow'], [7, 'deny'], ['approval:abc', undefined],
    ]) assert.throws(() => fake.ipc.handle['hud:approve'](event, id, decision), /未知操作/);
    for (const untrusted of [
      { sender: {}, senderFrame: win.webContents.mainFrame },
      { sender: win.webContents, senderFrame: { url: win.webContents.mainFrame.url } },
    ]) assert.throws(() => fake.ipc.handle['hud:approve'](untrusted, 'approval:abc', 'allow'), /不可信/);
    assert.deepEqual(received, [['abc', 'allow'], ['def', 'deny']]);
  } finally { hud.destroy(); }
});

test('the approval setup actions are whitelisted alongside the existing ones', async () => {
  const ran = [];
  const { fake, hud, event } = await setup({ onAction: async name => { ran.push(name); return { status: 'ok' }; } });
  try {
    assert.deepEqual(await fake.ipc.handle['hud:action'](event, 'approval-connect'), { status: 'ok' });
    assert.deepEqual(await fake.ipc.handle['hud:action'](event, 'approval-disconnect'), { status: 'ok' });
    assert.throws(() => fake.ipc.handle['hud:action'](event, 'approval-maybe'), /未知操作/);
    assert.deepEqual(ran, ['approval-connect', 'approval-disconnect']);
  } finally { hud.destroy(); }
});

test('the approval handler falls back to unavailable and is removed with the window', async () => {
  const { fake, hud, event } = await setup();
  try {
    assert.deepEqual(await fake.ipc.handle['hud:approve'](event, 'approval:abc', 'allow'), { status: 'unavailable' });
  } finally { hud.destroy(); }
  assert.ok(fake.removedHandlers.includes('hud:approve'));
});

test('approval connection state rides along in the settings pushed to the page', async () => {
  const { fake, hud, event } = await setup();
  try {
    const approvals = { claude: true, codex: false, codexAvailable: true };
    hud.pushApprovals(approvals);
    assert.deepEqual((await fake.ipc.handle['hud:initial'](event)).settings.approvals, approvals);
  } finally { hud.destroy(); }
});
