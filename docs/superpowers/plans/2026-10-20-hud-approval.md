# 子项目 2b 实现计划：HUD 批准卡片

设计：`docs/superpowers/specs/2026-10-20-hud-approval-design.md`。验证命令：`npm run check`（node:test，`tests/*.test.mjs`）。代码风格照现有文件：CommonJS（`src/main/*.cjs`）、渲染层 IIFE（`src/renderer/*.js`）、中文错误信息、简短英文注释。每个 Task 先写测试并确认失败，再实现，`npm run check` 全绿后结束。不要修改已有测试。

## Task 1: 钩子安装模块 approval-hook-install.cjs

新建 `src/main/approval-hook-install.cjs`，仿照 `src/main/claude-statusline-chain.cjs` 的写法（`readJsonFile`、原子写、备份文件名 `<file>.quotadeck-<stamp>.bak`、环境变量覆盖路径）。

导出：
- `HOOK_SCRIPT`：`path.join(__dirname, 'approval-hook.cjs')`。
- `claudeSettingsPath()`：`QUOTADECK_CLAUDE_SETTINGS` 或 `CLAUDE_CONFIG_DIR`/`~/.claude` 下的 `settings.json`。
- `codexHooksPath()`：`QUOTADECK_CODEX_HOOKS` 或 `~/.codex/hooks.json`。
- `isOurs(entry)`：hooks 数组里的一项（`{ type:'command', command, args? }`）的 command 或 args 里包含 `approval-hook.cjs` 即为我们的。
- `connectionState({ settingsPath, codexPath })` → `{ claude: boolean, codex: boolean, codexAvailable: boolean }`；`codexAvailable` = codexPath 所在目录存在。
- `connect({ settingsPath, codexPath, nodePath, now })` → `{ status: 'connected' | 'already-connected', claude: true, codex: boolean }`。对每个目标文件：读取（不存在当 `{}`；Codex 文件结构 `{ hooks: {...} }` 与 Claude 的 `hooks` 键一致）；在 `hooks.PermissionRequest` 数组末尾追加 `{ matcher: '*', hooks: [{ type: 'command', command: nodePath, args: [HOOK_SCRIPT, '--vendor', 'claude' 或 'codex'], timeout: 120 }] }`；已存在我们的条目则不重复添加；写前备份一次。Codex 只在 `codexAvailable` 时写。`nodePath` 不存在时抛中文错误（同 statusline 的处理）。
- `disconnect({ settingsPath, codexPath })` → `{ status: 'disconnected' }`：删除我们的条目（某个 matcher 组的 hooks 删空就删掉该组，PermissionRequest 数组删空就删掉该键，`hooks` 删空就删掉 `hooks`），其他内容原样保留。

测试 `tests/approval-hook-install.test.mjs`（临时目录，不碰真实用户目录）：
- connect 后两个文件都有我们的条目，原有的其他钩子与其他设置键保留，各生成一个备份。
- 再次 connect 返回 already-connected，条目不重复。
- disconnect 后文件内容与 connect 前深度相等（含原有 PermissionRequest 条目的情况）。
- Codex 目录不存在时只写 Claude，`codex:false`。
- settings.json 是坏 JSON 时抛错且不改文件。

## Task 2: 钩子脚本 approval-hook.cjs

新建 `src/main/approval-hook.cjs`。它由 Claude Code / Codex 用 `node approval-hook.cjs --vendor claude|codex` 调用，**任何失败都必须无输出、退出码 0**。

导出纯函数并在 `require.main === module` 时运行 `main()`：
- `endpointPath()`：`QUOTADECK_APPROVAL_ENDPOINT` 或 `%APPDATA%/QuotaDeck/approval-endpoint.json`。
- `summarize(toolName, toolInput)` → 字符串，最多 160 字符：`Bash` 或 `shell` 类取 `command`；`Edit`/`Write`/`MultiEdit`/`apply_patch` 取 `file_path` 或 `path`（apply_patch 无路径时取输入文本首行）；其他取 `JSON.stringify(toolInput)` 截断。
- `buildRequest(vendor, input)` → `{ vendor, sessionId, cwd, tool, summary }`，字段从 stdin JSON 的 `session_id`、`cwd`、`tool_name`、`tool_input` 取，缺失为空字符串，`vendor` 只接受 `claude`/`codex`。
- `decisionOutput(decision)`：`'allow'` → `{ hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: { behavior: 'allow' } } }`；`'deny'` → 同结构 `behavior: 'deny', message: 'Denied from QuotaDeck HUD'`；其他 → `null`。
- `main({ argv, stdin, fetchImpl, readFile, waitMs })`：读 stdin（上限 64 KB）→ 读端点文件 `{ port, token }` → `POST http://127.0.0.1:<port>/approval`，头 `Authorization: Bearer <token>`，体为 `buildRequest` 结果 → 等响应（`AbortSignal.timeout(waitMs)`，默认 `QUOTADECK_APPROVAL_WAIT_MS` 或 110000）→ 响应 JSON `{ decision }` 经 `decisionOutput` 非 null 时写到 stdout。任一步出错直接返回不输出。

测试 `tests/approval-hook.test.mjs`：`summarize` 四类输入；`buildRequest` 字段映射与非法 vendor；`decisionOutput` 三种；`main` 用注入的假 fetch / readFile：正常 allow 输出正确 JSON、端点文件缺失无输出、fetch 抛错无输出、响应 `{decision:'later'}` 无输出、令牌放在 Authorization 头里。

## Task 3: 本机审批服务 approval-server.cjs

新建 `src/main/approval-server.cjs`：
- `createApprovalServer({ endpointPath, onChange = () => {}, maxPending = 20, maxBodyBytes = 65536, randomToken })` 返回 `{ start, stop, list, decide }`。
- `start()`：`http.createServer` 监听 `127.0.0.1` 端口 0；生成 32 字节随机令牌（hex）；把 `{ port, token, pid }` 原子写到 `endpointPath`；返回 `{ port }`。
- 只接受 `POST /approval`，Bearer 令牌必须匹配，否则 401；体超过上限 413；挂起数已满 503；JSON 无效 400。合法请求：生成 id（`randomUUID`），记录 `{ id, vendor, sessionId, cwd, tool, summary, at: Date.now() }`，**挂起响应**，调用 `onChange(list())`。
- 客户端断开（`req.on('close')` 且未决定）时移除该项并 `onChange`。
- `decide(id, decision)`：`decision` 只能是 `'allow'`/`'deny'`，否则返回 false；找到挂起项就回 200 `{ decision }`、移除、`onChange`，返回 true；找不到返回 false。
- `list()`：挂起项的浅拷贝数组，按 `at` 升序。
- `stop()`：对所有挂起项回 200 `{ decision: null }`，关闭服务，删除端点文件（不存在不报错）。

测试 `tests/approval-server.test.mjs`（真实 loopback）：start 写端点文件；无令牌 401；正确请求挂起后 `list()` 有一项且 `onChange` 被调；`decide(id,'allow')` 后客户端收到 `{decision:'allow'}`；非法 decision 返回 false；客户端中途断开后项被移除；超过 `maxPending` 返回 503；`stop()` 删除端点文件并让挂起请求收到 `{decision:null}`。

## Task 4: tracker 合并批准项

修改 `src/main/session-tracker.cjs`，不改变现有行为：
- 新增 `setApprovals(list)`：保存数组（只保留 `id`、`vendor` 为 claude/codex 的项）。
- `snapshot(now)` 里为每个批准项生成 alert：`{ id: 'approval:' + item.id, vendor, kind: 'approval', sessionId, title, model: null, text: item.summary, tool: item.tool, at: item.at, durationMs: null, returnable: false }`。`title` 优先用同 vendor、同 sessionId 会话的标题，没有就用 `cwd` 的最后一级目录名。
- vendor phase：有 approval 时为 `'asking'`（与 waiting 相同）。排序保持 `b.at - a.at`，渲染层负责把 approval 放最前。
- `dismiss` 不删除批准项（批准项只由服务端决定或断开时消失）。

测试追加到新文件 `tests/session-tracker-approval.test.mjs`：批准项出现在 snapshot、phase 为 asking、标题回退到 cwd 目录名、`setApprovals([])` 后消失、dismiss 不影响批准项、非法 vendor 被忽略。

## Task 5: 主进程接线与 IPC

- `src/main/hud-window.cjs`：`ACTIONS` 增加 `'approval-connect'`、`'approval-disconnect'`；`INVOKE_CHANNELS` 增加 `'hud:approve'`；`createHud` 新参数 `onApprove = async () => ({ status: 'unavailable' })`；`ipcMain.handle('hud:approve', guard((id, decision) => ...))`：id 必须是以 `approval:` 开头的字符串、decision 必须是 allow/deny，否则抛 `未知操作`；调用 `onApprove(id.slice(9), decision)`。销毁时一并移除该 handler（照现有 INVOKE_CHANNELS 清理方式）。
- `src/main/preload-hud.cjs`：暴露 `approve: (id, decision) => ipcRenderer.invoke('hud:approve', String(id), decision === 'allow' ? 'allow' : 'deny')`。
- `src/main/main.cjs`：`app.whenReady` 里创建 `createApprovalServer({ endpointPath: path.join(app.getPath('appData'), 'QuotaDeck', 'approval-endpoint.json'), onChange: list => { sessionTracker.setApprovals(list); pushSessions(); } })` 并 `start()`（失败只记录，不影响 HUD）；`createHud` 传 `onApprove: async (id, decision) => ({ status: approvalServer.decide(id, decision) ? 'decided' : 'gone' })`；`actions` 增加 `'approval-connect'`（调用 `connect({ nodePath })` 后 `refreshAll`）与 `'approval-disconnect'`；`before-quit` 里 `approvalServer.stop()`。HUD 推给渲染层的 item 或设置数据里带上 `approvals: connectionState()`，供设置页显示（照 Claude 行的 `setup` 字段做法，选最小改动的方式）。

测试：在 `tests/hud-window.test.mjs` 同风格的新文件 `tests/hud-approval-ipc.test.mjs` 中，用现有测试里的假 electron 驱动 `createHud`：`hud:approve` 对合法参数调用 `onApprove('abc','allow')`，对 `'reply:1'`、`'maybe'` 抛错；`hud:action` 接受两个新动作名。

## Task 6: 渲染层卡片、胶囊与设置行

- `src/renderer/hud-card.js`：`alertBlock` 支持 `kind === 'approval'`：chip 文案 `Approve?`，脸 `asking`，无关闭按钮；显示 `alert.tool`（`alert-tool`）与 `alert.text`（`alert-summary`），时间行 `Waiting ${sinceOf(at)}`；footer 换成两个按钮：`button.alert-allow[data-act=approve-allow][data-id]` 文案 `Allow once`，`button.alert-deny[data-act=approve-deny][data-id]` 文案 `Deny`。点击调用 `window.hud.approve(id, 'allow'|'deny')`，调用期间两个按钮 disabled。`ordered` 排序改为 approval 最前，其次 waiting，再按时间。
- `src/renderer/hud-strip.js`：`alertContent` 中 approval 优先：`Approve? · ${since(at)}`（class `alert-text approval`）；15 秒刷新条件包含 approval。
- `src/renderer/hud-settings.js`：Connections 区在 Claude 行下面加 `row('approvals', 'Approvals', box)`：显示 `Connected` 或 `Not connected`，按钮 `Connect`/`Disconnect` 分别调用 `approval-connect`/`approval-disconnect`；Codex 可用但未信任时附注 `Codex: run /hooks once to trust`。数据来自 Task 5 推送的 `approvals` 状态；数据缺失时显示 `Not connected` 和 Connect 按钮（向下兼容：后端字段缺失时界面不能坏）。
- `src/renderer/hud.css`：`.alert-allow`（主色按钮）、`.alert-deny`（描边按钮）、`.alert-text.approval`，与现有 `.alert-return` 风格一致。

测试：在 `tests/hud-view.test.mjs` 同风格的新文件 `tests/hud-approval-view.test.mjs`：approval alert 渲染出两个按钮和 `Approve?`、排序在 waiting 之前、缺少 `tool`/`text` 字段时不抛错；设置页在 `approvals` 缺失时显示 Connect。

## 不在本计划内（Claude 审查时做）

`npm run check:desktop` 桌面冒烟、真实 Claude Code 会话里的端到端验证、打包。
