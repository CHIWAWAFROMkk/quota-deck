# QuotaDeck HUD 子项目 2a："做完了"提醒与 bot 脸 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 读本机 Claude Code / Codex 会话日志，一轮做完后 3 秒内在 HUD 上出现 "New reply" 提醒和笑脸 bot，工具调用超 30 秒无结果时提示 "Waiting"，提醒留到用户看过为止，可一键回到会话。

**Architecture:** 主进程新增三个纯模块：日志解析（每行 → 会话事件）、会话状态机（事件 → 每家状态与提醒列表）、日志监视（增量读文件、喂给状态机）。监视器在 HUD 窗口之外常驻，经新的 `hud:sessions` 通道推给渲染层。渲染层把 logo 换成 bot 脸，加常驻提醒胶囊和提醒卡片。

**Tech Stack:** Electron 44、Node 24 `node:test`、原生 DOM/SVG/CSS，无新依赖。

**Spec:** `docs/superpowers/specs/2026-10-16-hud-turn-done-design.md`

## 分工与分支

- 新分支 `feat/turn-done`，从 `main`（`3a696b3`）开。
- **后端 Task 1–4 交给 GPT（Codex，`-m gpt-6-astra -s danger-full-access`）**，在 worktree `../quotadeck-backend`、分支 `feat/turn-done-backend` 上做，Claude 审查后合并。GPT 只能改 `src/main/**`（两个 preload 除外）和 `tests/**`。
- **前端 Task 5–8 由 Claude 做**：`src/renderer/**`、`src/main/preload-hud.cjs`、`scripts/**`、`README.md`。Task 5 可以在后端完成前开始（只依赖本计划里的接口），冒烟要等 Task 4 合并后才能跑通。
- 提交作者：`git -c user.name=CHIWAWAFROMkk -c user.email=323616687+CHIWAWAFROMkk@users.noreply.github.com commit`，尾注 GPT 写 `Co-Authored-By: GPT (Codex) <noreply@openai.com>`，Claude 写 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`。

## Global Constraints

- 只读日志，不改任何配置文件；不新增运行时依赖。
- 回复正文最多 2048 字符、只在内存；标题最多 60 字符；工具说明最多 80 字符；任何对话内容不写盘、不打日志。
- 一轮结束后 3 秒内出现提醒；监视轮询 1500 ms，目录重扫 60000 ms，只盯 30 分钟内改动过的日志。
- "可能在等你"阈值 30000 ms；会话 30 分钟无新内容视为放弃。
- 提醒只针对 QuotaDeck 启动之后结束的轮次。
- Claude 提醒 `entrypoint` ∈ {`claude-vscode`, `cli`}，跳过 `isSidechain`；只有 `claude-vscode` 可回到会话。Codex 只提醒 `originator == "Codex Desktop"` 且 `thread_source == "user"`。
- 文案英文：`New reply`、`N new replies`、`Waiting · 2m`、`Stopped`、`Stopped with an error`、`View token usage`、`Return to session`。
- 渲染层 CSP 无内联样式（只用 CSSOM）；渲染层向下兼容（字段缺失不出 `undefined`/`NaN`）。
- 新 IPC 通道必须过现有的 `trusted()` 检查。

## Review Focus

1. **日志读到半行**：一轮结束那一行正好被分两次读到 → 不能丢、不能重复提醒 → Task 3 测试 `a turn-end split across two reads alerts exactly once`。
2. **卡片开着时又来一条**：关卡片只算看过刚才显示过的那些，新来的保留 → Task 2 测试 `dismissing only removes the alerts that were shown` 和 Task 7 冒烟。
3. **长命令跑完**：工具调用超 30 秒后有了结果 → Waiting 消失，不产生 reply 提醒 → Task 2 测试 `a waiting tool that finishes clears the waiting alert`。
4. **HUD 渲染层重载或被托盘隐藏**：没看过的提醒还在 → Task 4 测试 `sessions are re-sent after the renderer reloads`。
5. **QuotaDeck 在一轮中途启动**：显示 working，但不翻出启动前已结束的旧轮次 → Task 2 测试 `turns that ended before start never alert`。

---

### Task 1（GPT）：日志解析

**Files:**
- Create: `src/main/session-parsers.cjs`
- Test: `tests/session-parsers.test.mjs`

**Interfaces:**
- Produces（`SessionEvent`，所有事件都带 `at: number`（毫秒）和 `sessionId: string`）：
  - `{ kind: 'meta', source, cwd }`：`source` 为 Claude 的 `entrypoint` 原值，或 Codex 的 `'codex-desktop' | 'codex-exec' | 'subagent' | 'codex-other'`
  - `{ kind: 'prompt', text }`：一轮开始
  - `{ kind: 'title', title, custom: boolean }`
  - `{ kind: 'model', model }`
  - `{ kind: 'tool-call', callId, label }`：`label` 形如 `Bash: npm run build`，≤80 字符
  - `{ kind: 'tool-result', callId }`
  - `{ kind: 'turn-end', text, error: boolean, durationMs: number | null, model: string | null }`：`text` ≤2048
  - `{ kind: 'interrupt' }`
- `parseClaudeLine(line: string) → SessionEvent[]`
- `createCodexFileParser() → { parse(line: string): SessionEvent[] }`：记住本文件的 `sessionId`（来自 `session_meta.payload.id`）

**规则（spec §4，已在本机日志核实）**
- **Claude**
  - 每行带 `sessionId`、`timestamp`、`entrypoint`、`cwd`；同一会话遇到的第一行额外产出一个 `meta` 事件（解析器不记状态，按行产出即可，去重交给 Task 2）。
  - `isSidechain: true` 或 `isMeta: true` 的行 → `[]`。
  - `type: 'user'`：文本内容不含 `tool_result`、不以 `<command-` 或 `<local-command-` 开头 → `prompt`；以 `[Request interrupted` 开头 → `interrupt`；含 `tool_result` 块 → 每块一个 `tool-result`（`callId` = `tool_use_id`）。
  - `type: 'assistant'`：
    - `stop_reason` 为 `tool_use` → 每个 `tool_use` 块一个 `tool-call`（`label` = `name` + `: ` + `input.command` / `input.file_path` / `input.pattern` 中第一个存在的）。
    - `stop_reason` 为 `end_turn` / `stop_sequence` → `turn-end`（`text` = 文本块拼接，`model` = `message.model`，`durationMs: null`）。
    - `isApiErrorMessage: true` → `turn-end`，`error: true`。
  - `type: 'ai-title'` → `title`（`custom: false`）；`type: 'custom-title'` → `title`（`custom: true`）。实现时用本机任一含 `custom-title` 的日志核对字段名；本机没有就照 `ai-title` 的 `aiTitle` 推作 `customTitle`，在提交信息里写明。
- **Codex**
  - `session_meta` → `meta`。`source`：`originator == 'Codex Desktop' && thread_source == 'user'` → `codex-desktop`；`originator == 'codex_exec'` → `codex-exec`；`thread_source == 'subagent'` → `subagent`；其余 `codex-other`。
  - `event_msg/task_started` → `prompt`（`text: ''`）。
  - `response_item/message` 且 `role == 'user'` → `prompt`，`text` 为第一个不以 `<` 开头的文本段。只用于标题，不重复开始一轮：与 `task_started` 时间差不超过 5 秒时，合并成同一个 `prompt`。
  - `turn_context` → `model`。
  - `response_item/function_call` 或 `custom_tool_call` → `tool-call`（`callId` = `call_id`，`label` = `name` + 参数里的 `cmd` / `command` 前 80 字符）；`*_output` → `tool-result`。
  - `event_msg/task_complete` → `turn-end`（`text` = `last_agent_message ?? ''`，`error` = `Boolean(error)`，`durationMs` = `duration_ms`）。
  - `event_msg/turn_aborted` → `interrupt`。
- 坏 JSON、未知类型 → `[]`，不抛错。

- [ ] **Step 1: 写测试** `tests/session-parsers.test.mjs`。为上面每条规则各写一个用例，用手写的 JSON 行，字段照本机格式。至少包括：
  - `claude prompt, tool call, tool result and end of turn`
  - `claude sidechain, meta and command lines are ignored`
  - `claude api error ends the turn with error`
  - `claude titles`
  - `codex meta sources`（四种 `source`）
  - `codex turn lifecycle with tool calls`（含 `custom_tool_call`）
  - `codex user text skips environment context`
  - `bad lines yield no events`
  - `long texts are capped`：2048、80、60 的截断都要断言
- [ ] **Step 2:** 运行 `node --test tests/session-parsers.test.mjs`，预期因模块不存在而失败。
- [ ] **Step 3:** 实现 `src/main/session-parsers.cjs`。
- [ ] **Step 4:** 用本机真实日志做一次只读核对：各取一个最近的 Claude 和 Codex 文件，打印解析出的 `kind` 计数（不打印正文），确认 `turn-end` 数与 `end_turn` / `task_complete` 行数一致。然后运行 `npm run check`，预期全部通过。
- [ ] **Step 5:** 提交 `feat: 会话日志解析（Claude/Codex 一轮开始、工具调用、结束、出错、标题）`。

### Task 2（GPT）：会话状态机

**Files:**
- Create: `src/main/session-tracker.cjs`
- Test: `tests/session-tracker.test.mjs`

**Interfaces:**
- Consumes：Task 1 的 `SessionEvent`。
- Produces：
  - `createSessionTracker({ startedAt: number, waitingAfterMs = 30000, abandonAfterMs = 1800000 }) → { ingest(vendor, event), snapshot(now): SessionsSnapshot, dismiss(ids: string[]) }`，其中 `vendor` ∈ `'claude' | 'codex'`。
  - `SessionsSnapshot = { vendors: { claude: VendorState, codex: VendorState }, alerts: Alert[] }`，`alerts` 按 `at` 从新到旧排。
  - `VendorState = { phase: 'idle' | 'working' | 'asking' | 'done', running: number }`
  - `Alert = { id, vendor, kind: 'reply' | 'error' | 'waiting', sessionId, title, model, text, tool, at, durationMs, returnable }`
    - `id`：reply / error 用 `${vendor}:${sessionId}:${at}`，waiting 用 `${vendor}:${sessionId}:wait:${callId}`
    - `tool` 只在 waiting 时有，其余为 `null`；`model` 经 `model-names.cjs` 的 `modelName()` 转换
    - `returnable = source ∈ {'claude-vscode', 'codex-desktop'}`

**规则（spec §5、§8）**
- 只有可提醒来源（Global Constraints）的会话产生提醒；其余会话仍计入 `running` 和 `phase`。
- `turn-end` 的 `at < startedAt` → 不产生提醒，但更新会话状态。
- `durationMs` 为空时，用本轮 `prompt` 到 `turn-end` 的时间差。
- 标题：`custom` 优先，其次 `ai-title`，再次本会话第一条 `prompt` 的第一行；≤60 字符。
- 新的 `prompt` → 移除同一会话所有 reply / error 提醒。
- waiting：会话在跑，有 `tool-call` 超过 `waitingAfterMs` 没有对应 `tool-result` → 在 `snapshot(now)` 里算出一条 waiting 提醒（以最早那个没结果的调用为准）。结果到达、`turn-end`、`interrupt` 或新 `prompt` → 消失。
- 会话"在跑"：一轮开始后还没 `turn-end` / `interrupt`，而且最后一个事件距 `now` 不到 `abandonAfterMs`。
- `phase` 优先级：有 waiting → `asking`；否则有这家的 reply / error → `done`；否则 `running > 0` → `working`；否则 `idle`。
- `dismiss(ids)` 只移除列出的 reply / error 提醒，忽略 waiting 和未知 id。

- [ ] **Step 1: 写测试** `tests/session-tracker.test.mjs`。每个用例用 Task 1 形状的手写事件：
  - `a finished turn becomes one reply alert with title, model and duration`
  - `turns that ended before start never alert`（但 `phase` 仍按规则走）
  - `only notifiable sources alert; others still count as running`（`codex-exec`、`subagent`、`sdk-ts`）
  - `returnable only for claude-vscode and codex-desktop`
  - `error turns become error alerts`
  - `a waiting tool appears after 30 s and wins the phase`（`snapshot(t+29999)` 没有，`snapshot(t+30000)` 有）
  - `a waiting tool that finishes clears the waiting alert`（之后没有 reply，直到 `turn-end`）
  - `a new prompt clears that session's replies`
  - `dismissing only removes the alerts that were shown`（两条中 dismiss 一条，另一条保留；dismiss waiting 无效）
  - `sessions idle for 30 minutes stop counting as running`
  - `custom title wins over ai title and first prompt; titles are capped at 60`
- [ ] **Step 2:** 运行 `node --test tests/session-tracker.test.mjs`，预期失败。
- [ ] **Step 3:** 实现 `src/main/session-tracker.cjs`。只在内存里，不持久化。
- [ ] **Step 4:** 运行 `npm run check`，预期全部通过。
- [ ] **Step 5:** 提交 `feat: 会话状态机（在跑/可能在等你/做完了提醒，看过即移除）`。

### Task 3（GPT）：日志监视

**Files:**
- Create: `src/main/session-watcher.cjs`
- Test: `tests/session-watcher.test.mjs`

**Interfaces:**
- Consumes：Task 1 的 `parseClaudeLine`、`createCodexFileParser`；Task 2 的 tracker。
- Produces：`createSessionWatcher({ tracker, onChange, claudeRoot = ~/.claude/projects, codexRoot = ~/.codex/sessions, fileSystem = fs/promises, clock = Date.now, pollMs = 1500, scanMs = 60000, activeWindowMs = 1800000, tailBytes = 262144 }) → { start(), stop(), tick(): Promise<void>, rescan(): Promise<void> }`。
  - `onChange(snapshot)` 只在 `tracker.snapshot(clock())` 和上次推送的不同时调用（JSON 比较即可）。

**行为**
- `rescan()`：在两个根目录下（Claude 深度 ≤2，Codex 按 年/月/日）找 `mtime` 在 `activeWindowMs` 内的 `.jsonl`。新发现的文件从 `max(0, size - tailBytes)` 开始读（不是从头读就丢弃第一行），之后只读新增部分；半行留到下次。
- `tick()`：对已知的活跃文件比较 `size`，有增长就读增量、解析、`ingest`，最后检查快照是否有变化。文件变小视为被重写，从头按 tail 规则重读。超出 `activeWindowMs` 的文件不再轮询。
- `start()` 先 `rescan()` 再 `tick()`，之后按 `pollMs` 调 `tick`、按 `scanMs` 调 `rescan`；`stop()` 清掉定时器。单次 `tick` 没结束前不重入。
- 读文件出错时跳过这个文件，下一轮再试；根目录不存在时当作空目录。

- [ ] **Step 1: 写测试** `tests/session-watcher.test.mjs`，在 `work/` 下造临时目录和日志，用注入的 `clock`，手动调 `rescan()` / `tick()`，不用真定时器：
  - `a new claude turn-end is reported via onChange`
  - `a turn-end split across two reads alerts exactly once`
  - `codex files under year/month/day are found and parsed`
  - `files older than the active window are ignored`
  - `a truncated file is reread without duplicate alerts`
  - `missing roots are not an error`
  - `stop clears timers`：调 `start()` 后 `stop()`，进程能正常退出
- [ ] **Step 2:** 运行，预期失败。
- [ ] **Step 3:** 实现 `src/main/session-watcher.cjs`。
- [ ] **Step 4:** 运行 `npm run check`，预期全部通过。
- [ ] **Step 5:** 提交 `feat: 会话日志监视（1.5 秒增量读取，只盯 30 分钟内活跃的日志）`。

### Task 4（GPT）：接入主进程与 HUD 窗口

**Files:**
- Create: `src/main/session-links.cjs`
- Modify: `src/main/hud-window.cjs`、`src/main/main.cjs`
- Test: `tests/session-links.test.mjs`、`tests/hud-window.test.mjs`

**Interfaces:**
- Consumes：Task 2、Task 3。
- Produces：
  - `returnUrl(alert) → string | null`
    - Claude（`returnable`）：`vscode://anthropic.claude-code/open?session=<sessionId>`，`sessionId` 必须匹配 `/^[0-9a-f-]{36}$/i`
    - Codex：`codex://threads/<sessionId>`，同样的 id 校验
    - 其余返回 `null`
  - `createHud` 新增参数 `onDismiss(ids: string[])`、`onReturn(id: string) → Promise<{ status: 'opened' | 'unavailable' }>`
  - HUD 对象新增方法 `pushSessions(snapshot)`
  - IPC：push `hud:sessions`（`SessionsSnapshot`）；send `hud:dismiss`（`string[]`，最多 50 个，每个不超过 200 字符，其余丢弃）；invoke `hud:return`（`id` 字符串）
  - `hud:initial` 的返回值增加 `sessions`；`did-finish-load` 时补发最新的 `hud:sessions`

**`main.cjs`**
- `whenReady` 里创建 tracker（`startedAt = Date.now()`）和 watcher，然后 `start()`，与 HUD 是否可见无关。
- `onChange` → `hud.pushSessions`。
- `onDismiss` → `tracker.dismiss` 之后立即推一次快照。
- `onReturn` → 在当前快照里找这个 id 的提醒，`returnUrl` 不为空就 `shell.openExternal`，并把这条当作看过（dismiss）；找不到或为空返回 `unavailable`。
- `before-quit` 时 `watcher.stop()`。

- [ ] **Step 1: 先实测 Codex 链接（不写代码）**：从本机 `~/.codex/sessions` 取一个 `Codex Desktop` 会话的 `session_meta.payload.id`，运行 `Start-Process "codex://threads/<id>"`。把结果写进提交信息：Codex 桌面版是切到那个会话、只打开了应用，还是没反应。
  - 只打开应用或没反应：`returnUrl` 对 Codex 仍返回这个链接（至少能把桌面版带到前台）。
  - 完全没反应：Codex 改成返回 `null`，卡片上就不显示按钮。
- [ ] **Step 2: 写测试**
  - `tests/session-links.test.mjs`：`claude and codex links`、`bad ids and non-returnable alerts give null`
  - `tests/hud-window.test.mjs` 追加：
    - `sessions are pushed and re-sent after the renderer reloads`
    - `dismiss accepts only a bounded string list from the HUD page`
    - `return asks the main process and is refused for untrusted senders`
- [ ] **Step 3:** 运行，预期失败。
- [ ] **Step 4:** 实现。新通道加进 `SEND_CHANNELS` / `INVOKE_CHANNELS`，过 `trusted()`。
- [ ] **Step 5:** 运行 `npm run check`，预期全部通过。
- [ ] **Step 6:** 提交 `feat: 会话提醒接入主进程（HUD 隐藏时照常监视，回到会话链接）`。

### Task 5（Claude）：预加载桥与 bot 脸

**Files:**
- Modify: `src/main/preload-hud.cjs`
- Create: `src/renderer/hud-bots.js`
- Modify: `src/renderer/hud.html`（加脚本）、`src/renderer/hud.css`

**Interfaces:**
- Produces：
  - `window.hud.onSessions(cb)`、`window.hud.dismiss(ids)`、`window.hud.returnTo(id) → Promise`
  - `window.HudBots.face(vendor: 'claude' | 'codex', phase: 'working' | 'asking' | 'done', size: number) → SVGElement`

**外观**
- 圆脸 SVG：Claude 用 `#D97757`，Codex 用 `#10A37F`。
- `working`：眼睛左右扫动，2 秒一个循环。
- `asking`：每 2.6 秒轻跳一次。
- `done`：弯眼笑脸。
- 尺寸用 HudMetrics 的 `logo`。

- [ ] **Step 1:** 在冒烟脚本里加检查：用 `hudWindow.webContents.send('hud:sessions', …)` 推一个 `claude: working` 的快照，断言 `#strip [data-id=claude] .bot.working` 存在；推 `idle` 后恢复成 `img.logo`。
- [ ] **Step 2:** 运行 `npm run check:desktop`，预期失败。
- [ ] **Step 3:** 实现预加载、`hud-bots.js`，并在 `hud-strip.js` 里按 `phase` 用 bot 替换 logo（`idle` 照旧用 logo）。
- [ ] **Step 4:** 再跑冒烟，预期通过；截图 `hud-bots.png`。
- [ ] **Step 5:** 提交。

### Task 6（Claude）：常驻提醒胶囊

**Files:** `src/renderer/hud-strip.js`、`src/renderer/hud.css`、`scripts/smoke-desktop.cjs`

**规则**
- 每家只要有提醒，就在图标旁常驻一个胶囊，位置和外形同悬停胶囊。
- 胶囊文字：
  - waiting：琥珀色 `Waiting · 2m`
  - 有一条 error：红色 `Stopped`
  - 其余：`logo Claude  💬 New reply`，`New reply` 为蓝色 `#64a8ff`，多条时写 `N new replies`
- 悬停时临时换成悬停胶囊，移开后恢复。
- 点胶囊等同于点图标。
- 拖动时隐藏。

- [ ] **Step 1:** 冒烟加检查：
  - 推一条 reply 后出现 `New reply`
  - 推两条后显示 `2 new replies`
  - 推 waiting 后显示 `Waiting · `
  - 推 error 后显示 `Stopped`
  - 悬停后变回 `5h …`，`mouseleave` 后恢复
- [ ] **Step 2:** 运行冒烟，预期失败。
- [ ] **Step 3:** 实现。胶囊位置复用 `showPill` 的计算；同时多家都有提醒时，各自贴在各自的图标旁。
- [ ] **Step 4:** 冒烟通过；截图 `hud-reply-pill.png`。
- [ ] **Step 5:** 提交。

### Task 7（Claude）：提醒卡片

**Files:** `src/renderer/hud-card.js`、`src/renderer/hud.js`、`src/renderer/hud.css`、`scripts/smoke-desktop.cjs`

**规则（spec §5）**
- 有提醒时点图标或胶囊，打开这家的提醒视图；没有提醒时照旧打开额度视图。
- 每条提醒一块：waiting 排在最前，其余按时间从新到旧：
  - 头部：bot 脸（`done`）、厂商名、模型名，右上 `New reply` 标签和 ×
  - 粗体标题；摘要最多 4 行（CSS `line-clamp`）
  - 底部：`18:27 · 3m`
  - 左下 `View token usage`（切到额度视图）；`returnable` 时右下显示蓝色 `Return to session`
- waiting 块：写 `Waiting for you`，加工具说明和已等时长，没有 ×。
- error 块：写 `Stopped with an error`，摘要用错误原文，强调色为红色。
- 看过：
  - 关卡片时，`dismiss` 本次显示过的 reply / error 的 id
  - 点 × 立即 `dismiss` 那一条
  - `Return to session` 调 `hud.returnTo(id)`，返回 `opened` 后关卡片
- 卡片开着时来了新提醒：追加到列表，但关闭时不 dismiss 它，因为没显示过。
- 用 `withDefaults` 思路容忍字段缺失。

- [ ] **Step 1:** 冒烟加检查：
  - 推两条 reply，点 Claude 图标，出现 2 块，标题、`3m`、`Return to session` 都对
  - 卡片开着时再推第三条，关卡片后用 `ipcMain` 监听到 `hud:dismiss` 只带前两条的 id
  - 点 × 时 dismiss 那一条
  - `View token usage` 切到额度视图（出现 `Current session` 行）
  - `returnable: false` 时没有按钮
  - 推缺字段的提醒，`/NaN|undefined/` 不出现
- [ ] **Step 2:** 运行冒烟，预期失败。
- [ ] **Step 3:** 实现（`hud-card.js` 加 `view: 'alerts'`）。
- [ ] **Step 4:** 冒烟通过；截图 `hud-reply-card.png`。
- [ ] **Step 5:** 提交。

### Task 8（Claude）：端到端冒烟、对照图与文档

**Files:** `scripts/smoke-desktop.cjs`、`scripts/compare-sheet.cjs`、`README.md`

- [ ] **Step 1:** 冒烟加一项端到端检查：替换 `session-watcher.cjs` 的 `createSessionWatcher`，改为用真的 tracker 加一个可手动喂事件的假 watcher。喂入一轮 Claude 事件（`at` 在启动之后），断言 3 秒内 HUD 出现 `New reply`。
- [ ] **Step 2:** `compare-sheet.cjs` 的 `PAIRS` 加两组：`f184.png` ↔ `hud-reply-pill.png`，`f207.png` ↔ `hud-reply-card.png`。生成对照图并目测。
- [ ] **Step 3:** README 的「贴边 HUD」一节加一段"做完了提醒"：只读本机日志、不改配置；提醒留到看过；`Waiting` 是推测（工具调用超过 30 秒）；Codex 只提醒桌面版里自己开的会话。
- [ ] **Step 4:** 运行 `npm run check && npm run check:desktop && npm run package:portable`，三项都通过。
- [ ] **Step 5:** 提交，并把手动验收清单交给用户：
  1. 在 VS Code 里让 Claude 做一件小事，做完 3 秒内 HUD 出现 New reply。
  2. Return to session 能回到那个对话。
  3. 让它跑一个需要批准的命令，约 30 秒后出现 Waiting。
  4. Codex 桌面版做完一轮也会提醒，回到会话的效果和 Task 4 的实测一致。
  5. 关掉卡片后提醒消失，再发一条新消息后旧提醒也不会回来。
