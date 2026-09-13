async function deepSeekRequest(path, apiKey) {
  const response = await fetch(`https://api.deepseek.com${path}`, {
    headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`DeepSeek API 返回 ${response.status}`);
  return response.json();
}

async function readDeepSeekSnapshot() {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    return {
      id: 'deepseek',
      name: 'DeepSeek API',
      status: 'disconnected',
      source: '官方',
      precision: 'unavailable',
      updatedAt: null,
      models: [],
      note: '设置 DEEPSEEK_API_KEY 后读取官方共享余额与可用模型。',
    };
  }
  const [balance, modelList] = await Promise.all([
    deepSeekRequest('/user/balance', apiKey),
    deepSeekRequest('/models', apiKey),
  ]);
  const balances = balance.balance_infos || [];
  return {
    id: 'deepseek',
    name: 'DeepSeek API',
    status: balance.is_available ? 'healthy' : 'critical',
    source: '官方',
    precision: 'provider-reported',
    updatedAt: new Date().toISOString(),
    balances,
    models: (modelList.data || []).map((model) => ({
      id: model.id,
      name: model.id,
      pool: 'shared',
      poolLabel: 'DeepSeek API 账户余额',
      source: '官方',
      note: '该模型从账户共享余额扣费；官方未提供独立模型余额。',
    })),
    note: '所有模型共享账户余额，按调用量与当期价格扣费。',
  };
}

module.exports = { readDeepSeekSnapshot };
