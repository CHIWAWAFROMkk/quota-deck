const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
let installPaths = {};
const roamingData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
for (const file of [path.join(__dirname, '../../data/local-paths.json'), path.join(roamingData, 'QuotaDeck', 'local-paths.json')]) {
  try {
    if (fs.statSync(file).size > 65536) continue;
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) installPaths = { ...installPaths, ...parsed };
  } catch { /* Optional machine-local paths are excluded from public packages. */ }
}

function isFile(file) {
  try { return typeof file === 'string' && fs.statSync(file).isFile(); } catch { return false; }
}

function executable(name, override, candidates = []) {
  const paths = [override, ...candidates,
    ...(process.env.PATH || '').split(path.delimiter).filter(Boolean).map(dir => path.join(dir, name))
  ].filter(Boolean);
  return paths.find(isFile) || name;
}

const localData = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
const agyPath = executable('agy.exe', process.env.QUOTADECK_AGY_PATH, [path.join(localData, 'agy', 'bin', 'agy.exe')]);
const claudePath = executable('claude.exe', process.env.QUOTADECK_CLAUDE_PATH, [path.join(os.homedir(), '.local', 'bin', 'claude.exe')]);
const nodePath = executable('node.exe', process.env.QUOTADECK_NODE_PATH, typeof installPaths.nodePath === 'string' ? [installPaths.nodePath] : []);
const workbuddyScript = process.env.QUOTADECK_WORKBUDDY_CLI || (isFile(installPaths.workbuddyScript) ? installPaths.workbuddyScript : null) || path.join(localData, 'Programs', 'WorkBuddy', 'resources', 'app.asar.unpacked', 'cli', 'bin', 'codebuddy');
const languageServerLog = process.env.QUOTADECK_ANTIGRAVITY_LOG || path.join(roamingData, 'Antigravity', 'logs', 'language_server.log');

module.exports = { agyPath, claudePath, nodePath, workbuddyScript, languageServerLog };
