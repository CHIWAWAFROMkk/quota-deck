function inferModelStrengths(providerId, modelName) {
  const name = String(modelName || '').toLowerCase();
  const strengths = [];

  if (/flash|spark|luna|fast|hy3/.test(name)) strengths.push('快速问答', '批量轻任务');
  if (/pro|opus|astra|reasoner|high|thinking/.test(name)) strengths.push('复杂推理', '长任务规划');
  if (/codex|code|sonnet|terra|sol/.test(name)) strengths.push('代码实现', '审查与重构');
  if (/vision|5v|image|multimodal/.test(name)) strengths.push('图像理解', '多模态任务');
  if (/kimi/.test(name)) strengths.push('长文本', '资料整理');
  if (/deepseek|glm|gpt|oss/.test(name)) strengths.push('通用推理', '结构化输出');
  if (/medium/.test(name)) strengths.push('速度与质量平衡');
  if (/low/.test(name)) strengths.push('低延迟', '日常任务');
  if (!strengths.length) {
    strengths.push(providerId === 'workbuddy' ? '办公任务' : '通用任务');
  }
  return [...new Set(strengths)].slice(0, 3);
}

module.exports = { inferModelStrengths };
