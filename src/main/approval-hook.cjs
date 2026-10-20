// Claude Code / Codex PermissionRequest hook. The vendor client runs this with
// `node approval-hook.cjs --vendor claude|codex`; QuotaDeck answers over a loopback token.
// Any failure must print nothing and exit 0 so the vendor falls back to its own prompt.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const INPUT_LIMIT = 65536;
const DEFAULT_WAIT_MS = 110000;
const SUMMARY_LIMIT = 160;
const DENY_MESSAGE = 'Denied from QuotaDeck HUD';
const EDIT_TOOLS = new Set(['edit', 'write', 'multiedit', 'apply_patch']);

function textValue(value) {
  return typeof value === 'string' ? value : '';
}

function endpointPath() {
  if (process.env.QUOTADECK_APPROVAL_ENDPOINT) return process.env.QUOTADECK_APPROVAL_ENDPOINT;
  const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
  return path.join(appData, 'QuotaDeck', 'approval-endpoint.json');
}

function firstLine(text) {
  const line = String(text).split(/\r?\n/).map(value => value.trim()).find(Boolean);
  return line || '';
}

// apply_patch arrives either as raw text or as an object carrying the patch text.
function patchText(toolInput) {
  if (typeof toolInput === 'string') return toolInput;
  if (!toolInput || typeof toolInput !== 'object') return '';
  for (const key of ['input', 'patch', 'diff']) {
    if (typeof toolInput[key] === 'string') return toolInput[key];
  }
  return '';
}

function summarize(toolName, toolInput) {
  const tool = textValue(toolName);
  const lower = tool.toLowerCase();
  const input = toolInput && typeof toolInput === 'object' && !Array.isArray(toolInput) ? toolInput : {};
  let summary = '';
  if (lower === 'bash' || lower.includes('shell')) {
    summary = textValue(input.command);
  } else if (EDIT_TOOLS.has(lower)) {
    summary = textValue(input.file_path) || textValue(input.path);
    if (lower === 'apply_patch') summary = summary || firstLine(patchText(toolInput));
  } else {
    try {
      const json = JSON.stringify(toolInput);
      summary = typeof json === 'string' ? json : '';
    } catch { summary = ''; }
  }
  return summary.slice(0, SUMMARY_LIMIT);
}

// Unknown vendors are carried as an empty string; main aborts before contacting the server.
function buildRequest(vendor, input) {
  const payload = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  return {
    vendor: vendor === 'claude' || vendor === 'codex' ? vendor : '',
    sessionId: textValue(payload.session_id),
    cwd: textValue(payload.cwd),
    tool: textValue(payload.tool_name),
    summary: summarize(payload.tool_name, payload.tool_input),
  };
}

function decisionOutput(decision) {
  if (decision !== 'allow' && decision !== 'deny') return null;
  const result = { behavior: decision };
  if (decision === 'deny') result.message = DENY_MESSAGE;
  return { hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: result } };
}

function vendorFromArgv(argv) {
  const args = Array.isArray(argv) ? argv : [];
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === '--vendor') return textValue(args[index + 1]);
    if (typeof args[index] === 'string' && args[index].startsWith('--vendor=')) {
      return args[index].slice('--vendor='.length);
    }
  }
  return '';
}

function capInput(buffer) {
  if (buffer.length > INPUT_LIMIT) throw new Error('approval hook input exceeds limit');
  return buffer;
}

function readStdin(stdin) {
  if (typeof stdin === 'string') return Promise.resolve(capInput(Buffer.from(stdin)));
  if (Buffer.isBuffer(stdin)) return Promise.resolve(capInput(stdin));
  if (!stdin || typeof stdin[Symbol.asyncIterator] !== 'function') return Promise.resolve(Buffer.alloc(0));
  return (async () => {
    const chunks = [];
    let bytes = 0;
    for await (const chunk of stdin) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
      bytes += buffer.length;
      if (bytes > INPUT_LIMIT) throw new Error('approval hook input exceeds limit');
      chunks.push(buffer);
    }
    return Buffer.concat(chunks);
  })();
}

function defaultWaitMs() {
  const value = Number(process.env.QUOTADECK_APPROVAL_WAIT_MS);
  return Number.isFinite(value) && value > 0 ? value : DEFAULT_WAIT_MS;
}

async function main({ argv = process.argv.slice(2), stdin = process.stdin, fetchImpl = globalThis.fetch, readFile = fs.readFileSync, waitMs } = {}) {
  try {
    const vendor = vendorFromArgv(argv);
    if (!vendor) return null;
    const input = JSON.parse((await readStdin(stdin)).toString('utf8'));
    const endpoint = JSON.parse(await readFile(endpointPath(), 'utf8'));
    const port = Number(endpoint && endpoint.port);
    const token = textValue(endpoint && endpoint.token);
    if (!Number.isInteger(port) || port <= 0 || port > 65535 || !token) return null;
    if (typeof fetchImpl !== 'function') return null;
    const request = buildRequest(vendor, input);
    if (!request.vendor) return null;
    const timeout = Number.isFinite(waitMs) && waitMs > 0 ? waitMs : defaultWaitMs();
    const response = await fetchImpl(`http://127.0.0.1:${port}/approval`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(timeout),
    });
    if (!response || typeof response.json !== 'function') return null;
    const body = await response.json();
    const output = decisionOutput(body && body.decision);
    if (!output) return null;
    const text = JSON.stringify(output);
    process.stdout.write(`${text}\n`);
    return text;
  } catch {
    return null;
  }
}

if (require.main === module) {
  // Claude Code waits for this process to exit; fetch's keep-alive socket would hold it
  // open for seconds after the decision. Exit once stdout has drained.
  main().catch(() => {}).finally(() => { process.stdout.write('', () => process.exit(0)); });
}

module.exports = { endpointPath, summarize, buildRequest, decisionOutput, main };
