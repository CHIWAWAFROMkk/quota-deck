// Installs QuotaDeck's PermissionRequest hook into Claude Code and Codex without replacing
// the user's other hooks. Each target file is backed up before it is rewritten.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const HOOK_SCRIPT = path.join(__dirname, 'approval-hook.cjs');
const HOOK_NAME = path.basename(HOOK_SCRIPT);

function claudeSettingsPath() {
  return process.env.QUOTADECK_CLAUDE_SETTINGS || path.join(process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'), 'settings.json');
}
function codexHooksPath() {
  return process.env.QUOTADECK_CODEX_HOOKS || path.join(os.homedir(), '.codex', 'hooks.json');
}

function isFile(file) {
  try { return fs.statSync(file).isFile(); } catch { return false; }
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

function backup(file, now) {
  if (!fs.existsSync(file)) return;
  const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\..*/, '');
  fs.copyFileSync(file, `${file}.quotadeck-${stamp}.bak`);
}

// A hooks entry is ours when either its command or one of its args names our hook script.
function isOurs(entry) {
  if (!entry || typeof entry !== 'object') return false;
  const values = [entry.command, ...(Array.isArray(entry.args) ? entry.args : [])];
  return values.some(value => typeof value === 'string' && value.includes(HOOK_NAME));
}

function hasOurHook(data) {
  const groups = data?.hooks?.PermissionRequest;
  return Array.isArray(groups) && groups.some(group => Array.isArray(group?.hooks) && group.hooks.some(isOurs));
}

function hasOurs(file) {
  try { return hasOurHook(readJsonFile(file, {})); } catch { return false; }
}

function hookGroup(vendor, nodePath) {
  return { matcher: '*', hooks: [{ type: 'command', command: nodePath, args: [HOOK_SCRIPT, '--vendor', vendor], timeout: 120 }] };
}

function connectionState({ settingsPath = claudeSettingsPath(), codexPath = codexHooksPath() } = {}) {
  return {
    claude: hasOurs(settingsPath),
    codex: hasOurs(codexPath),
    codexAvailable: fs.existsSync(path.dirname(codexPath)),
  };
}

// Existing PermissionRequest groups are kept in order; ours is appended last.
function permissionGroups(data, file) {
  if (data.hooks === undefined) return [];
  if (!data.hooks || typeof data.hooks !== 'object' || Array.isArray(data.hooks)) {
    throw new Error(`${path.basename(file)} 结构异常，已停止修改`);
  }
  const groups = data.hooks.PermissionRequest;
  if (groups === undefined) return [];
  if (!Array.isArray(groups)) throw new Error(`${path.basename(file)} 结构异常，已停止修改`);
  return groups;
}

function connect({ settingsPath = claudeSettingsPath(), codexPath = codexHooksPath(), nodePath = process.execPath, now = new Date() } = {}) {
  // Without a runnable node the hook would fail on every permission request.
  if (!isFile(nodePath)) throw new Error('未找到 Node.js，批准钩子无法运行；请先安装 Node.js 再接入');
  const codexAvailable = fs.existsSync(path.dirname(codexPath));
  const targets = [{ file: settingsPath, vendor: 'claude' }];
  if (codexAvailable) targets.push({ file: codexPath, vendor: 'codex' });

  // Read and validate everything first so one broken file never leaves a half-connected state.
  const pending = [];
  for (const { file, vendor } of targets) {
    const data = readJsonFile(file, {});
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error(`${path.basename(file)} 结构异常，已停止修改`);
    const groups = permissionGroups(data, file);
    if (hasOurHook(data)) continue;
    data.hooks = { ...(data.hooks || {}), PermissionRequest: [...groups, hookGroup(vendor, nodePath)] };
    pending.push({ file, data });
  }

  for (const { file, data } of pending) {
    backup(file, now);
    writeJsonAtomic(file, data);
  }
  return {
    status: pending.length ? 'connected' : 'already-connected',
    claude: true,
    codex: codexAvailable && hasOurs(codexPath),
  };
}

function removeOurHooks(data) {
  const groups = data.hooks && Array.isArray(data.hooks.PermissionRequest) ? data.hooks.PermissionRequest : null;
  if (!groups) return false;
  let changed = false;
  const kept = [];
  for (const group of groups) {
    if (!group || typeof group !== 'object' || !Array.isArray(group.hooks)) { kept.push(group); continue; }
    const hooks = group.hooks.filter(hook => !isOurs(hook));
    if (hooks.length === group.hooks.length) { kept.push(group); continue; }
    changed = true;
    if (hooks.length) kept.push({ ...group, hooks });
  }
  if (!changed) return false;
  if (kept.length) data.hooks.PermissionRequest = kept;
  else delete data.hooks.PermissionRequest;
  if (Object.keys(data.hooks).length === 0) delete data.hooks;
  return true;
}

function disconnect({ settingsPath = claudeSettingsPath(), codexPath = codexHooksPath() } = {}) {
  for (const file of [settingsPath, codexPath]) {
    let data;
    try { data = readJsonFile(file, null); } catch { continue; } // unreadable files are left untouched
    if (!data || typeof data !== 'object' || Array.isArray(data)) continue;
    if (removeOurHooks(data)) writeJsonAtomic(file, data);
  }
  return { status: 'disconnected' };
}

module.exports = {
  HOOK_SCRIPT, claudeSettingsPath, codexHooksPath, isOurs, connectionState, connect, disconnect,
};
