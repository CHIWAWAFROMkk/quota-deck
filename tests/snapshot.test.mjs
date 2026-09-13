import assert from 'node:assert/strict';
import test from 'node:test';
import snapshotModule from '../src/main/snapshot.cjs';
import codexModule from '../src/main/codex-client.cjs';
import workbuddyModule from '../src/main/workbuddy-client.cjs';
import antigravityModule from '../src/main/antigravity-client.cjs';
import orchestratorModule from '../src/main/orchestrator.cjs';

const { health, providerToUi } = snapshotModule;
const { remainingPercent } = codexModule;
const { normalizeWorkBuddySnapshot } = workbuddyModule;
const { normalizeAntigravitySnapshot } = antigravityModule;
const { parseAgentOutput, rolePrompt } = orchestratorModule;

test('remainingPercent clamps provider values', () => {
  assert.equal(remainingPercent({ usedPercent: 50 }), 50);
  assert.equal(remainingPercent({ usedPercent: 120 }), 0);
  assert.equal(remainingPercent({ usedPercent: -5 }), 100);
  assert.equal(remainingPercent(null), null);
});

test('collaboration prompt keeps role and shared task explicit', () => {
  assert.match(rolePrompt('做一份方案', '负责审查'), /做一份方案/);
  assert.match(rolePrompt('做一份方案', '负责审查'), /负责审查/);
});

test('agent JSON output parser returns the last useful result', () => {
  assert.equal(parseAgentOutput('{"result":"first"}\n{"result":"final"}'), 'final');
});

test('agent parser handles WorkBuddy formatted JSON arrays', () => {
  const output = JSON.stringify([
    { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'OK' }] },
    { type: 'result', subtype: 'success', result: 'OK' },
  ], null, 2);
  assert.equal(parseAgentOutput(output), 'OK');
});

test('WorkBuddy keeps model rows tied to one shared credit pool', () => {
  const raw = normalizeWorkBuddySnapshot({
    capturedAt: '2026-09-13T00:00:00.000Z',
    plan: '标准版',
    totalCredits: 4000,
    usedCredits: 1000,
    models: [{ name: '模型 A' }, { name: '模型 B' }],
  });
  const provider = providerToUi(raw);
  assert.equal(provider.quotaHero, '3,000 积分');
  assert.equal(provider.status, 'healthy');
  assert.equal(provider.models[0].val, '3,000 积分共享');
  assert.equal(provider.models[1].pool, '共享 WorkBuddy 积分');
  assert.equal(provider.models[0].consumeMultiplier, null);
});

test('Antigravity maps models to truthful shared quota windows', () => {
  const raw = normalizeAntigravitySnapshot({
    groups: [
      {
        displayName: 'Gemini Models',
        buckets: [
          { bucketId: 'gemini-weekly', window: 'weekly', remainingFraction: 0.94, resetTime: '2026-09-19T15:37:18Z' },
          { bucketId: 'gemini-5h', window: '5h', remainingFraction: 0.75, resetTime: '2026-09-13T10:45:12Z' },
        ],
      },
    ],
  }, [{ id: 'gemini-3.8-flash-high', name: 'Gemini 3.8 Flash (High)' }]);
  const provider = providerToUi(raw);
  assert.equal(provider.models[0].val, '每周 94.0% · 5 小时 75.0%');
  assert.equal(provider.models[0].pool, 'Gemini Models');
  assert.equal(provider.pools[0].modelCount, 1);
});

test('health uses visible non-color states', () => {
  assert.equal(health(7), 'critical');
  assert.equal(health(25), 'low');
  assert.equal(health(80), 'healthy');
});

test('shared model is not assigned a fabricated independent quota', () => {
  const provider = providerToUi({
    id: 'deepseek',
    name: 'DeepSeek API',
    status: 'healthy',
    source: '官方',
    precision: 'provider-reported',
    balances: [{ currency: 'CNY', total_balance: '10.00' }],
    models: [{ name: 'deepseek-v4-flash', pool: 'shared', poolLabel: 'DeepSeek API 账户余额', source: '官方' }],
    note: '全模型共享余额。',
  });
  assert.equal(provider.models[0].val, '¥ 10.00 共享');
  assert.match(provider.models[0].pool, /账户余额/);
});
