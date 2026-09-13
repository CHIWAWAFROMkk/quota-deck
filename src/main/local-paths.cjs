const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function executable(name, override, candidates = []) {
  const paths = [override, ...candidates,
    ...(process.env.PATH || '').split(path.delimiter).filter(Boolean).map(dir => path.join(dir, name))
  ].filter(Boolean);
  return paths.find(file => fs.existsSync(file)) || name;
}

const localData = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
const roamingData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
const agyPath = executable('agy.exe', process.env.QUOTADECK_AGY_PATH, [path.join(localData, 'agy', 'bin', 'agy.exe')]);
const nodePath = executable('node.exe', process.env.QUOTADECK_NODE_PATH);
const workbuddyScript = process.env.QUOTADECK_WORKBUDDY_CLI || path.join(localData, 'Programs', 'WorkBuddy', 'resources', 'app.asar.unpacked', 'cli', 'bin', 'codebuddy');
const languageServerLog = process.env.QUOTADECK_ANTIGRAVITY_LOG || path.join(roamingData, 'Antigravity', 'logs', 'language_server.log');

module.exports = { agyPath, nodePath, workbuddyScript, languageServerLog };
