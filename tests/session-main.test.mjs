import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { EventEmitter } from 'node:events';
import vm from 'node:vm';
import path from 'node:path';
import trackerModule from '../src/main/session-tracker.cjs';

const realRequire = createRequire(new URL('../src/main/main.cjs', import.meta.url));
const sessionId = '11111111-2222-3333-4444-555555555555';
function setup({ failOpen = false, shortcutFree = true } = {}) {
  let ready, hudOptions, watcherOptions, tracker, tray;
  const shortcuts = {};
  let unregistered = 0, shows = 0;
  const gaming = [];
  let starts = 0, stops = 0;
  const sent = [], opened = [];
  const now = 100000;
  const app = Object.assign(new EventEmitter(), {
    requestSingleInstanceLock: () => true, whenReady: () => ({ then: fn => { ready = fn; } }),
    getPath: () => 'synthetic-user-data', quit() {},
  });
  const icon = { isEmpty: () => false, resize() { return this; } };
  const hud = { isVisible: () => false, show: () => { shows++; }, setGaming: value => gaming.push(value), pushSessions: snapshot => sent.push(snapshot), pushState() {}, pushTokens() {}, destroy() {} };
  class Tray extends EventEmitter { constructor() { super(); tray = this; this.menus = []; } setToolTip() {} setContextMenu(menu) { this.menus.push(menu); } }
  const modules = {
    electron: { app, Tray, Menu: { buildFromTemplate: value => value }, globalShortcut: { register: (key, fn) => { if (!shortcutFree) return false; shortcuts[key] = fn; return true; }, unregisterAll: () => { unregistered++; } }, nativeImage: { createFromPath: () => icon }, shell: { openExternal: async url => { opened.push(url); if (failOpen) throw new Error('synthetic launcher error'); } } },
    './snapshot.cjs': { configureHistory() {}, readAll: async () => [] },
    './workbuddy-client.cjs': { WORKBUDDY_APP_URL: 'https://example.test' },
    './claude-statusline-chain.cjs': {}, './local-paths.cjs': {},
    './hud-view.cjs': { buildHudItems: () => [], buildHudTokens: value => value },
    './hud-window.cjs': { createHud: options => { hudOptions = options; return hud; } },
    './token-ledger.cjs': { createTokenLedger: () => ({ read: async () => ({}) }) },
    './stats-window.cjs': { createStats: () => ({ open() {}, push() {}, destroy() {} }) },
    './session-tracker.cjs': { createSessionTracker: options => { tracker = trackerModule.createSessionTracker(options); return tracker; } },
    './session-watcher.cjs': { createSessionWatcher: options => { watcherOptions = options; return { start: async () => { starts++; }, stop: () => { stops++; } }; } },
  };
  class Clock extends Date { static now() { return now; } }
  vm.runInNewContext(readFileSync(new URL('../src/main/main.cjs', import.meta.url), 'utf8'), {
    require: id => Object.hasOwn(modules, id) ? modules[id] : realRequire(id),
    __dirname: path.resolve('src/main'), Date: Clock,
    setInterval: () => 1, clearInterval() {},
  });
  ready();
  function finish(id = sessionId, at = now + 1) {
    tracker.ingest('claude', { kind: 'meta', sessionId: id, at: now, source: 'claude-vscode' });
    tracker.ingest('claude', { kind: 'prompt', sessionId: id, at: now, text: 'Synthetic task' });
    tracker.ingest('claude', { kind: 'turn-end', sessionId: id, at, text: 'Done' });
    return `claude:${id}:${at}`;
  }
  return { app, sent, opened, finish, hud: () => hudOptions, watcher: () => watcherOptions, tracker: () => tracker, starts: () => starts, stops: () => stops,
    gaming, shortcuts, tray: () => tray, menu: () => tray.menus.at(-1), unregistered: () => unregistered, shows: () => shows };
}

test('main starts session monitoring independently of HUD visibility and stops on quit', () => {
  const s = setup();
  try {
    assert.equal(s.starts(), 1);
    assert.equal(s.watcher().tracker, s.tracker());
    const snapshot = { vendors: {}, alerts: [] };
    s.watcher().onChange(snapshot);
    assert.deepEqual(s.sent.at(-1), snapshot);
  } finally { s.app.emit('before-quit'); }
  assert.equal(s.stops(), 1);
});

test('main dismisses only requested replies and immediately pushes the current snapshot', () => {
  const s = setup();
  try {
    const first = s.finish();
    const second = s.finish('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', 100002);
    s.hud().onDismiss([first]);
    assert.deepEqual(s.sent.at(-1).alerts.map(a => a.id), [second]);
  } finally { s.app.emit('before-quit'); }
});

test('main opens only a currently available session and dismisses it after success', async () => {
  const s = setup();
  try {
    const id = s.finish();
    assert.equal((await s.hud().onReturn('https://example.test')).status, 'unavailable');
    assert.equal(s.opened.length, 0);
    assert.equal((await s.hud().onReturn(id)).status, 'opened');
    assert.deepEqual(s.opened, [`vscode://anthropic.claude-code/open?session=${sessionId}`]);
    assert.deepEqual(s.sent.at(-1).alerts, []);
    assert.equal((await s.hud().onReturn(id)).status, 'unavailable');
    assert.equal(s.opened.length, 1);
  } finally { s.app.emit('before-quit'); }
});

test('main preserves an unread reply when launching the session fails', async () => {
  const s = setup({ failOpen: true });
  try {
    const id = s.finish();
    assert.equal((await s.hud().onReturn(id)).status, 'unavailable');
    assert.equal(s.tracker().snapshot(100001).alerts[0].id, id);
  } finally { s.app.emit('before-quit'); }
});

test('Ctrl+Alt+H and the tray item toggle game mode, the tray icon leaves it, quitting frees the key', () => {
  const s = setup();
  const item = () => s.menu().find(entry => entry.label?.startsWith('游戏模式'));
  try {
    assert.equal(typeof s.shortcuts['Control+Alt+H'], 'function');
    assert.equal(item().label, '游戏模式（Ctrl+Alt+H）');
    assert.equal(item().checked, false);
    s.shortcuts['Control+Alt+H']();
    assert.deepEqual(s.gaming, [true]);
    assert.equal(item().checked, true, 'the tray shows the mode the key turned on');
    item().click({ checked: false });
    assert.deepEqual(s.gaming, [true, false]);
    assert.equal(item().checked, false);
    s.shortcuts['Control+Alt+H']();
    const shows = s.shows();
    s.tray().emit('click');
    assert.deepEqual(s.gaming, [true, false, true, false], 'clicking the tray icon means: show me the HUD');
    assert.equal(s.shows(), shows + 1);
  } finally { s.app.emit('before-quit'); s.app.emit('will-quit'); }
  assert.equal(s.unregistered(), 1);
});

test('a hotkey taken by another program leaves game mode in the tray only', () => {
  const s = setup({ shortcutFree: false });
  try {
    const item = s.menu().find(entry => entry.label?.startsWith('游戏模式'));
    assert.equal(item.label, '游戏模式');
    item.click({ checked: true });
    assert.deepEqual(s.gaming, [true]);
  } finally { s.app.emit('before-quit'); s.app.emit('will-quit'); }
});
