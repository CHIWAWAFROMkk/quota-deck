import test from 'node:test';
import assert from 'node:assert/strict';
import names from '../src/main/model-names.cjs';

test('model ids from the agent logs get short display names', () => {
  const cases = {
    'claude-opus-5-5': 'Opus 5.5',
    'claude-fable-5-1': 'Fable 5.1',
    'claude-sonnet-5-5': 'Sonnet 5.5',
    'claude-opus-4-1-20250805': 'Opus 4.1',
    'claude-haiku-4': 'Haiku 4',
    'gpt-6.1-sol': 'GPT-6.1 Sol',
    'gpt-5-codex': 'GPT-5 Codex',
    unknown: 'Unknown',
    other: 'Other',
    '': 'Unknown',
    '<synthetic>': '<synthetic>',
  };
  for (const [id, name] of Object.entries(cases)) assert.equal(names.modelName(id), name, id);
  assert.equal(names.modelName(null), 'Unknown');
  assert.equal(names.modelName('x'.repeat(80)).length, 40);
});
