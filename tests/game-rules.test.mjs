import test from 'node:test';
import assert from 'node:assert/strict';
import rules from '../src/main/game-rules.cjs';
const { isGaming } = rules;
const games = ['cs2.exe', 'tlou-ii.exe', 'tlou-ii-l.exe', 'javaw.exe'];
const fact = { notification: 2, exe: 'msedge.exe', path: 'C:\\Apps\\msedge.exe', covers: false };

test('exclusive fullscreen is gaming whatever the program', () => {
  assert.equal(isGaming({ ...fact, notification: 3 }, games), true);
});
test('a fullscreen steam game is gaming', () => {
  assert.equal(isGaming({ ...fact, covers: true, exe: 'deadlock.exe', path: 'D:\\SteamLibrary\\steamapps\\common\\Deadlock\\game\\bin\\win64\\deadlock.exe' }, games), true);
  assert.equal(isGaming({ ...fact, covers: true, path: 'D:\\STEAMAPPS\\COMMON\\Game\\game.exe' }, []), true);
});
test('a fullscreen listed exe is gaming, case-insensitively', () => {
  for (const exe of ['CS2.exe', 'tlou-ii.exe']) assert.equal(isGaming({ ...fact, covers: true, exe }, games), true);
  assert.equal(isGaming({ ...fact, covers: true, exe: 'cs2.exe' }, ['CS2.EXE']), true);
});
test('a fullscreen browser is not gaming', () => {
  assert.equal(isGaming({ ...fact, covers: true }, games), false);
  assert.equal(isGaming({ ...fact, covers: true, path: 'D:\\steamapps\\common-ish\\msedge.exe' }, games), false);
});
test('windowed games and missing facts are not gaming', () => {
  assert.equal(isGaming({ ...fact, exe: 'cs2.exe' }, games), false);
  for (const value of [null, undefined, {}, [], 3]) assert.equal(isGaming(value, games), false);
  for (const key of Object.keys(fact)) {
    const value = { ...fact, notification: 3 };
    delete value[key];
    assert.equal(isGaming(value, games), false, key);
  }
  for (const value of [{ ...fact, notification: '3' }, { ...fact, covers: 'true', exe: 'cs2.exe' }, { ...fact, exe: null }]) {
    assert.equal(isGaming(value, games), false);
  }
});
