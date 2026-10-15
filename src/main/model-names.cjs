const cap = word => (word ? word[0].toUpperCase() + word.slice(1) : word);

/** Short display name for a model id from the agent logs, e.g. claude-opus-4-1-20250805 → Opus 4.1. */
function modelName(id) {
  const raw = typeof id === 'string' ? id.trim() : '';
  if (!raw || raw === 'unknown') return 'Unknown';
  if (raw === 'other') return 'Other';
  const claude = /^claude-([a-z]+)-(\d+)(?:-(\d{1,2}))?(?:-\d{8})?$/.exec(raw);
  if (claude) return `${cap(claude[1])} ${claude[2]}${claude[3] ? `.${claude[3]}` : ''}`;
  const gpt = /^gpt-(\d+(?:\.\d+)?)(?:-([a-z0-9-]+))?$/.exec(raw);
  if (gpt) return `GPT-${gpt[1]}${gpt[2] ? ` ${gpt[2].split('-').map(cap).join(' ')}` : ''}`;
  return raw.slice(0, 40);
}

module.exports = { modelName };
