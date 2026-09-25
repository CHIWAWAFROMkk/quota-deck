import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { runProcess, runCollaboration } from '../src/main/orchestrator.cjs';

test('agent transport preserves Chinese characters split across output chunks', async () => {
  const script = "const b=Buffer.from('中文输出');process.stdout.write(b.subarray(0,2));setTimeout(()=>process.stdout.write(b.subarray(2)),30)";
  assert.equal(await runProcess(process.execPath, ['-e', script], '', 5000), '中文输出');
});

test('agent transport bounds runtime, output and startup failure without paid requests', async () => {
  await assert.rejects(runProcess(process.execPath, ['-e', 'setInterval(()=>{},1000)'], '', 100), /超时/);
  await assert.rejects(runProcess(process.execPath, ['-e', "process.stdout.write('x'.repeat(5*1024*1024))"], '', 5000), /超出限制/);
  await assert.rejects(runProcess(resolve('work/missing-test-agent.exe'), [], '', 1000), /无法启动/);
});

test('invalid collaboration requests never start agent processes', async () => {
  for (const request of [null, {}, { task: '', agents: ['codex', 'claude'] }, { task: 'x'.repeat(20001), agents: ['codex', 'claude'] }, { task: 'test', agents: ['codex', 'codex', '__proto__'] }]) {
    await assert.rejects(runCollaboration(request));
  }
});
