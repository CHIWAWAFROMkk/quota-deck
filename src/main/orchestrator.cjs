const { spawn } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const { findCodexBinary } = require('./codex-client.cjs');

const { agyPath: AGY_PATH, claudePath, nodePath, workbuddyScript: CODEBUDDY_SCRIPT } = require('./local-paths.cjs');
const ownedChildren = new Set();

function stopOwnedProcesses() {
  for (const child of ownedChildren) child.kill();
}

function localAgentAvailability() {
  let codex = false;
  try { codex = fs.existsSync(findCodexBinary()); } catch {}
  return { codex, antigravity: fs.existsSync(AGY_PATH), claude: fs.existsSync(claudePath), workbuddy: fs.existsSync(CODEBUDDY_SCRIPT) && fs.existsSync(nodePath) };
}

function findNodeBinary() {
  return nodePath;
}

function runProcess(binary, args, input, timeoutMs = 180_000) {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, {
      cwd: process.cwd(),
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...process.env,
      },
    });
    ownedChildren.add(child);
    child.stdout.setEncoding('utf8');
    let stdout = '';
    let bytes = 0;
    let failure = null;
    const timer = setTimeout(() => { failure = 'Agent 执行超时，请缩小任务后重试'; child.kill(); }, timeoutMs);
    child.stdout.on('data', (chunk) => {
      bytes += Buffer.byteLength(chunk);
      if (bytes > 4 * 1024 * 1024) { failure = 'Agent 输出超出限制'; child.kill(); }
      else stdout += chunk;
    });
    child.stderr.on('data', () => {});
    child.stdin.on('error', () => {});
    child.on('error', () => { ownedChildren.delete(child); clearTimeout(timer); reject(new Error('无法启动 Agent，请检查本机 CLI 路径')); });
    child.on('close', (code) => {
      ownedChildren.delete(child);
      clearTimeout(timer);
      if (code === 0 && !failure) resolve(stdout.trim());
      else reject(new Error(failure || 'Agent 执行失败，请在对应 CLI 中检查登录与额度'));
    });
    if (input) child.stdin.end(input);
    else child.stdin.end();
  });
}

function parseAgentOutput(output) {
  function extract(value) {
    if (!value || typeof value !== 'object') return [];
    if (Array.isArray(value)) return value.flatMap(extract);
    const texts = [];
    if (typeof value.result === 'string') texts.push(value.result.trim());
    if (typeof value.response === 'string') texts.push(value.response.trim());
    if (typeof value.item?.text === 'string') texts.push(value.item.text.trim());
    if (value.role === 'assistant' && Array.isArray(value.content)) {
      for (const part of value.content) {
        if (typeof part?.text === 'string') texts.push(part.text.trim());
      }
    }
    return texts.filter(Boolean);
  }

  try {
    const parsed = JSON.parse(output);
    const texts = extract(parsed);
    if (texts.length) return texts.at(-1);
  } catch {
    // Some agents emit NDJSON rather than one JSON document.
  }

  const lines = output.split(/\r?\n/).filter(Boolean);
  const messages = [];
  for (const line of lines) {
    try {
      const item = JSON.parse(line);
      const texts = extract(item);
      if (texts.length) messages.push(...texts);
    } catch {
      if (line.trim()) messages.push(line.trim());
    }
  }
  return messages.at(-1) || output.trim();
}

function rolePrompt(task, role) {
  return `你正在参加一次本机多 Agent 协作。共同任务：\n${task}\n\n你的分工：${role}\n只提交你的独立成果、关键证据、风险和给汇总者的建议。不要假装看过其他 Agent 的输出。`;
}

async function runCodex(task, role) {
  const output = await runProcess(findCodexBinary(), [
    'exec', '--ephemeral', '--json', '--sandbox', 'read-only', '--skip-git-repo-check', '-C', process.cwd(), '-'
  ], rolePrompt(task, role));
  return parseAgentOutput(output);
}

async function runAntigravity(task, role) {
  const output = await runProcess(AGY_PATH, [
    '--print', rolePrompt(task, role), '--mode', 'plan', '--output-format', 'json'
  ]);
  return parseAgentOutput(output);
}

async function runWorkBuddy(task, role) {
  if (!fs.existsSync(CODEBUDDY_SCRIPT)) throw new Error('未找到 WorkBuddy CLI');
  const output = await runProcess(findNodeBinary(), [
    CODEBUDDY_SCRIPT, '--print', '--permission-mode', 'plan', '--tools', '', '--no-session-persistence',
    '--output-format', 'json', rolePrompt(task, role)
  ]);
  return parseAgentOutput(output);
}

async function runClaude(task, role) {
  const output = await runProcess(claudePath, ['--print', '--permission-mode', 'plan', '--tools', '', '--no-session-persistence', '--output-format', 'json'], rolePrompt(task, role));
  return parseAgentOutput(output);
}

const runners = {
  claude: (task) => runClaude(task, '独立审查、逻辑核验与风险识别'),
  codex: (task) => runCodex(task, '技术方案、实现路径与事实核查'),
  antigravity: (task) => runAntigravity(task, '发散方案、替代路径与边界条件'),
  workbuddy: (task) => runWorkBuddy(task, '用户视角、办公落地与交付结构'),
};

async function runCollaboration(request) {
  if (!request || typeof request.task !== 'string' || !Array.isArray(request.agents)) throw new Error('协作请求格式无效');
  const { task, agents } = request;
  const cleanTask = String(task || '').trim();
  if (!cleanTask) throw new Error('请输入协作任务');
  if (cleanTask.length > 20000) throw new Error('任务过长，请限制在 20000 字符内');
  const selected = [...new Set(agents.filter((id) => Object.hasOwn(runners, id)))];
  if (selected.length < 2) throw new Error('至少选择两个可调用 Agent');
  const settled = await Promise.allSettled(selected.map(async (id) => ({ id, output: await runners[id](cleanTask) })));
  return {
    task: cleanTask,
    completedAt: new Date().toISOString(),
    results: settled.map((result, index) => result.status === 'fulfilled'
      ? { ...result.value, status: 'done' }
      : { id: selected[index], status: 'error', error: result.reason?.message || '执行失败' }),
  };
}

module.exports = { parseAgentOutput, rolePrompt, runCollaboration, localAgentAvailability, runProcess, stopOwnedProcesses };
