import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { setImmediate as nextTurn } from 'node:timers/promises';
import detectorModule from '../src/main/game-detector.cjs';
const { createGameDetector } = detectorModule;
const fact = { notification: 2, exe: 'cs2.exe', path: 'D:\\Games\\cs2.exe', covers: true };
function setup(options = {}) {
  const children = []; const calls = []; const changes = [];
  const spawnProcess = (...args) => {
    calls.push(args);
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.killed = false;
    child.kill = () => { child.killed = true; child.emit('exit', null); return true; };
    child.line = value => child.stdout.write(JSON.stringify(value) + '\r\n');
    children.push(child);
    return child;
  };
  const detector = createGameDetector({ getGames: () => ['cs2.exe'], onChange: (...args) => changes.push(args), spawnProcess, ...options });
  return { detector, children, calls, changes, cleanup() { detector.stop(); for (const child of children) child.stdout.destroy(); } };
}

test('reports only changes', () => {
  let games = ['cs2.exe'];
  const f = setup({ getGames: () => games, script: 'C:\\test folder\\game-probe.ps1' });
  try {
    f.detector.start(); f.detector.start();
    assert.equal(f.calls.length, 1);
    assert.equal(f.calls[0][0], 'powershell.exe');
    assert.deepEqual(f.calls[0][1], ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', 'C:\\test folder\\game-probe.ps1']);
    assert.equal(f.calls[0][2].windowsHide, true);
    const child = f.children[0];
    child.line(fact); child.line(fact);
    child.line({ ...fact, notification: 3, exe: 'other.exe' });
    games = [];
    child.line(fact); child.line(fact);
    assert.deepEqual(f.changes, [[true, 'cs2.exe'], [false, null]]);
  } finally { f.cleanup(); }
});

test('a probe that keeps dying gives up and reports not gaming', async () => {
  const f = setup({ clock: () => 1000 });
  try {
    f.detector.start(); f.children[0].line(fact);
    for (let i = 0; i < 4; i++) { f.children[i].emit('exit', 1); await nextTurn(); }
    assert.equal(f.calls.length, 4, 'one initial launch and three restarts');
    assert.deepEqual(f.changes.at(-1), [false, null]);
    f.children[0].line(fact);
    assert.deepEqual(f.changes.at(-1), [false, null], 'dead process cannot hide the HUD again');
  } finally { f.cleanup(); }
});

test('bad lines are ignored', () => {
  const f = setup();
  try {
    f.detector.start();
    const text = JSON.stringify(fact);
    f.children[0].stdout.write('not json\n\n' + text.slice(0, 30));
    assert.deepEqual(f.changes, []);
    f.children[0].stdout.write(text.slice(30) + '\n{broken}\n');
    assert.deepEqual(f.changes, [[true, 'cs2.exe']]);
  } finally { f.cleanup(); }
});

test('stop kills the probe and prevents restarts', async () => {
  const f = setup();
  try {
    f.detector.start(); f.detector.stop(); f.detector.stop();
    await nextTurn();
    assert.equal(f.children[0].killed, true);
    assert.equal(f.calls.length, 1);
    assert.deepEqual(f.changes, []);
  } finally { f.cleanup(); }
});

test('spawn errors and synchronous spawn failures are bounded', async () => {
  const f = setup();
  let attempts = 0; const changes = [];
  const throwing = createGameDetector({ getGames: () => [], onChange: (...args) => changes.push(args), spawnProcess: () => { attempts++; throw new Error('unavailable'); } });
  try {
    f.detector.start();
    for (let i = 0; i < 4; i++) {
      f.children[i].emit('error', new Error('ENOENT'));
      f.children[i].emit('exit', 1);
      await nextTurn();
    }
    assert.equal(f.calls.length, 4);
    assert.deepEqual(f.changes.at(-1), [false, null]);
    throwing.start();
    for (let i = 0; i < 5; i++) await nextTurn();
    assert.equal(attempts, 4);
    assert.deepEqual(changes.at(-1), [false, null]);
  } finally { throwing.stop(); f.cleanup(); }
});

test('restart budget expires after a minute and stop cancels a queued restart', async () => {
  let now = 0;
  const f = setup({ clock: () => now });
  try {
    f.detector.start();
    for (let i = 0; i < 3; i++) { f.children.at(-1).emit('exit', 1); await nextTurn(); }
    now = 60001;
    f.children.at(-1).emit('exit', 1); await nextTurn();
    assert.equal(f.calls.length, 5);
    f.children.at(-1).emit('exit', 1);
    f.detector.stop(); await nextTurn();
    assert.equal(f.calls.length, 5);
  } finally { f.cleanup(); }
});
