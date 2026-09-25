// Connects Claude Code's statusLine to QuotaDeck without replacing the user's own statusline.
// settings.json points at claude-statusline-tee.cjs; the previous command is kept in QuotaDeck's
// own config and runs downstream with the same stdin, so tools like claude-hud keep drawing.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const TEE_NAME = 'claude-statusline-tee.cjs';
const teePath = path.join(__dirname, TEE_NAME);

function appData() { return process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'); }
function chainPath() { return process.env.QUOTADECK_CLAUDE_CHAIN || path.join(appData(), 'QuotaDeck', 'claude-statusline.json'); }
function claudeSettingsPath() {
  return process.env.QUOTADECK_CLAUDE_SETTINGS || path.join(process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'), 'settings.json');
}

const forward = (file) => String(file).replace(/\\/g, '/');
const isOurs = (command) => typeof command === 'string' && command.includes(TEE_NAME);

function isFile(file) {
  try { return fs.statSync(file).isFile(); } catch { return false; }
}

// Claude Code on Windows runs statusLine commands through Git Bash, so the downstream command
// is bash syntax. System32\bash.exe is WSL and must never be picked.
function findBash(env = process.env) {
  const programFiles = [env.ProgramFiles, env['ProgramFiles(x86)'], env.LOCALAPPDATA && path.join(env.LOCALAPPDATA, 'Programs')].filter(Boolean);
  const pathDirs = (env.PATH || env.Path || '').split(path.delimiter).filter(Boolean);
  const fromGit = pathDirs.filter(dir => isFile(path.join(dir, 'git.exe'))).flatMap(dir => [
    path.join(dir, '..', 'bin', 'bash.exe'), path.join(dir, '..', '..', 'bin', 'bash.exe'),
  ]);
  const candidates = [
    env.CLAUDE_CODE_GIT_BASH_PATH,
    ...programFiles.map(dir => path.join(dir, 'Git', 'bin', 'bash.exe')),
    ...fromGit,
    ...pathDirs.map(dir => path.join(dir, 'bash.exe')),
  ].filter(Boolean).map(file => path.resolve(file));
  return candidates.find(file => isFile(file) && !/\\(System32|WindowsApps)\\/i.test(file)) || null;
}

function readJsonFile(file, fallback) {
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch (error) {
    if (error.code === 'ENOENT') return fallback;
    throw error;
  }
  try { return JSON.parse(text.replace(/^﻿/, '')); } catch {
    throw new Error(`${path.basename(file)} 不是有效的 JSON，已停止修改，请先修复该文件`);
  }
}

function writeJsonAtomic(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  fs.renameSync(temporary, file);
}

function readChain(file = chainPath()) {
  try {
    const chain = readJsonFile(file, null);
    if (!chain || chain.version !== 1) return null;
    return {
      version: 1,
      downstream: typeof chain.downstream === 'string' && chain.downstream.trim() ? chain.downstream : null,
      shell: typeof chain.shell === 'string' && chain.shell ? chain.shell : null,
      previous: chain.previous && typeof chain.previous === 'object' ? chain.previous : null,
    };
  } catch { return null; }
}

function connectionState({ settingsPath = claudeSettingsPath() } = {}) {
  try {
    const settings = readJsonFile(settingsPath, {});
    return { connected: isOurs(settings?.statusLine?.command) };
  } catch { return { connected: false }; }
}

function connect({ settingsPath = claudeSettingsPath(), file = chainPath(), nodePath = 'node', bash = findBash(), now = new Date() } = {}) {
  const settings = readJsonFile(settingsPath, {});
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) throw new Error('Claude settings.json 结构异常，已停止修改');
  const current = settings.statusLine && typeof settings.statusLine === 'object' ? settings.statusLine : null;
  if (isOurs(current?.command)) return { status: 'already-connected', downstream: readChain(file)?.downstream || null };
  // Without a runnable node the new statusLine command would blank the user's status bar.
  if (!isFile(nodePath)) throw new Error('未找到 Node.js，接入后状态栏会无法运行；请先安装 Node.js 再接入');

  if (fs.existsSync(settingsPath)) {
    const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\..*/, '');
    fs.copyFileSync(settingsPath, `${settingsPath}.quotadeck-${stamp}.bak`);
  }
  const downstream = current?.type === 'command' && typeof current.command === 'string' ? current.command : null;
  writeJsonAtomic(file, { version: 1, downstream, shell: bash, previous: current, connectedAt: now.toISOString() });
  settings.statusLine = { ...(current || {}), type: 'command', command: `"${forward(nodePath)}" "${forward(teePath)}"` };
  writeJsonAtomic(settingsPath, settings);
  return { status: 'connected', downstream };
}

function disconnect({ settingsPath = claudeSettingsPath(), file = chainPath() } = {}) {
  const settings = readJsonFile(settingsPath, {});
  const chain = readChain(file);
  if (isOurs(settings?.statusLine?.command)) {
    if (chain?.previous) settings.statusLine = chain.previous;
    else delete settings.statusLine;
    writeJsonAtomic(settingsPath, settings);
  }
  try { fs.unlinkSync(file); } catch { /* already gone */ }
  return { status: 'disconnected', restored: Boolean(chain?.previous) };
}

module.exports = { TEE_NAME, teePath, chainPath, claudeSettingsPath, findBash, readChain, connectionState, connect, disconnect, isOurs };
