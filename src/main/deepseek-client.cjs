async function deepSeekRequest(path, apiKey) {
  const response = await fetch(`https://api.deepseek.com${path}`, {
    headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`DeepSeek API 返回 ${response.status}`);
  if (Number(response.headers.get('content-length')) > 1048576) {
    await response.body?.cancel();
    throw new Error('DeepSeek API 响应超出大小限制');
  }
  const reader = response.body?.getReader();
  if (!reader) throw new Error('DeepSeek API 响应为空');
  const chunks = [];
  let bytes = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > 1048576) { await reader.cancel(); throw new Error('DeepSeek API 响应超出大小限制'); }
      chunks.push(Buffer.from(value));
    }
  } finally { reader.releaseLock(); }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

async function readDeepSeekSnapshot(options = {}) {
  const apiKey = options.apiKey ?? process.env.DEEPSEEK_API_KEY;
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
  const request = options.request || deepSeekRequest;
  const [balanceResult, modelsResult] = await Promise.allSettled([
    request('/user/balance', apiKey),
    request('/models', apiKey),
  ]);
  if (balanceResult.status === 'rejected') throw balanceResult.reason;
  const balance = balanceResult.value;
  const modelList = modelsResult.status === 'fulfilled' ? modelsResult.value : null;
  const balances = (Array.isArray(balance?.balance_infos) ? balance.balance_infos : []).filter(item => item
    && typeof item.currency === 'string' && /^[A-Z]{3}$/.test(item.currency)
    && ['string', 'number'].includes(typeof item.total_balance) && String(item.total_balance).trim()
    && Number.isFinite(Number(item.total_balance))).map(item => ({ currency: item.currency, total_balance: String(item.total_balance) }));
  const models = (Array.isArray(modelList?.data) ? modelList.data : []).filter(model => model && typeof model.id === 'string' && model.id.trim() && model.id.length <= 200);
  const uniqueModels = [...new Map(models.map(model => [model.id, model])).values()];
  const directoryReady = uniqueModels.length > 0;
  return {
    id: 'deepseek',
    name: 'DeepSeek API',
    status: !balances.length || typeof balance?.is_available !== 'boolean' ? 'stale' : balance.is_available ? 'healthy' : 'critical',
    source: '官方',
    precision: 'provider-reported',
    updatedAt: new Date().toISOString(),
    balances,
    modelDirectoryStatus: directoryReady ? 'ready' : 'error',
    modelDirectoryUpdatedAt: directoryReady ? new Date().toISOString() : null,
    models: uniqueModels.map((model) => ({
      id: model.id,
      name: model.id,
      pool: 'shared',
      poolLabel: 'DeepSeek API 账户余额',
      source: '官方',
      note: '该模型从账户共享余额扣费；官方未提供独立模型余额。',
    })),
    note: '所有模型共享账户余额，按调用量与当期价格扣费。' + (directoryReady ? '' : ' 模型目录读取失败或为空；余额仍可查看。'),
  };
}

module.exports = { readDeepSeekSnapshot, deepSeekRequest };
