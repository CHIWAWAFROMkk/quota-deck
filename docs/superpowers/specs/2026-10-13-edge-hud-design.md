# QuotaDeck 贴边 HUD（第一期）设计

日期：2026-10-13 · 状态：待用户审阅

## 1. 背景与目标

参考 Agent HUD（`jazzenchen/agent-hud-open`，Apache-2.0，macOS）的「简约形态」：一条停靠在屏幕边缘的小浮条，每个 agent 一个额度圆环；悬停看一行明细，点击展开该 agent 的卡片（额度、消耗速率、24 小时 Token 柱）；可拖到任意一条屏幕边。

用户要求在 QuotaDeck 上**照视频复刻**这套交互和外观（深色玻璃），分两期：

- **第一期（本文）**：贴边 HUD 条 + 悬停一行 + 点击卡片 + 拖动吸附；Claude 额度改用 oauth 接口；24 小时 Token 柱。
- **第二期（另立设计）**：Claude Code / Codex 的「一轮结束」「等待批准」事件卡片、会话列表。需要往客户端写 hooks，本期不碰任何客户端配置。

成功标准：

1. 开机后屏幕边缘出现 HUD 条，5 个服务商各一个圆环，颜色与数字与大面板同一份快照一致。
2. 悬停、点击、拖动的行为与视频一致；切到别的软件时 HUD 仍在。
3. Claude 圆环显示真实的 5 小时 / 每周已用比例（不再依赖状态栏桥）。
4. 卡片里能看到 Claude、Codex 过去 24 小时每 15 分钟的 Token 用量。
5. 没拿到的数据显示为未知，不画成 0%；旧快照有明显区分。

## 2. 用户已确认的决定

| 问题 | 决定 |
|---|---|
| 范围 | 先做 HUD 条；事件卡片放第二期 |
| 外观 | 照视频：深色玻璃，彩色官方 logo，绿/黄/红圆环 |
| 悬停面板内容 | 额度 + 24h Token 柱；会话列表放第二期 |
| 与大面板关系 | HUD 常驻；现有侘寂大面板保留（协作、模型库在里面），托盘和卡片都能打开 |
| 窗口实现 | 方案 A：单个固定尺寸透明窗口 + 鼠标穿透 + CSS 动画 |
| Claude 数据源 | 改读 `~/.claude/.credentials.json` 并请求 `api/oauth/usage`，状态栏桥作为后备 |

## 3. 结构

```
src/main/
  main.cjs              改：创建 HUD 窗口；托盘菜单加「显示/隐藏 HUD」；快照同时推给 HUD
  hud-window.cjs        新：HUD 窗口创建、鼠标穿透切换、拖动与吸附、位置持久化
  hud-geometry.cjs      新：纯函数——吸附到最近边、沿边偏移、窗口矩形计算
  hud-view.cjs          新：纯函数——从 UI 快照算出每个圆环的数据（选窗口、颜色、文字）
  token-ledger.cjs      新：增量读取 Claude / Codex 本机日志，汇总 96 根 15 分钟柱
  claude-oauth.cjs      新：读凭证、请求 oauth usage、解析窗口
  claude-client.cjs     改：先用 oauth，失败再读状态栏桥快照
  codex-client.cjs      改：补 groups/buckets，供消耗速率采样
  snapshot.cjs          改：history 对所有窗口制服务商记录；暴露 per-window 速率
  preload-hud.cjs       新：HUD 专用 preload，只暴露 HUD 需要的几个接口
src/renderer/
  hud.html / hud.css / hud.js   新：HUD 条、一行胶囊、卡片、Token 柱
assets/logos/*.svg      新：Lobe Icons 的 Claude、OpenAI(Codex)、Antigravity、DeepSeek、WorkBuddy 图标
```

数据流：主进程每 60 秒 `readAll()`，得到 UI 快照后同时发给大面板和 HUD；`token-ledger` 也在同一节拍刷新，结果以 `hud:tokens` 单独推送。HUD 渲染进程只做展示，不读文件、不发网络请求。

## 4. 窗口（方案 A）

- `BrowserWindow`：`transparent: true`、`frame: false`、`resizable: false`、`skipTaskbar: true`、`focusable: false`（卡片打开时临时 `setFocusable(true)` 以接收 Esc）、`alwaysOnTop: true`（层级 `floating`）、`hasShadow: false`。
- 尺寸固定为「卡片展开后的最大尺寸」：卡片宽 340px、最高 420px，再加 HUD 条本身。窗口贴边放置，HUD 条画在贴边的一侧，卡片向屏幕内侧展开。
- 默认 `setIgnoreMouseEvents(true, { forward: true })`。渲染进程用转发来的 `mousemove` 判断指针是否在可见元素（HUD 条、胶囊、卡片）上，进入时通知主进程关闭穿透，离开时恢复穿透。
- 安全设置与大面板一致：`contextIsolation`、`sandbox`、`nodeIntegration: false`、CSP、拒绝新窗口与跳转、权限请求全部拒绝、IPC 校验来源。

## 5. 交互规则

### 5.1 HUD 条（收起）

- 顺序固定：Codex、Claude、Antigravity、DeepSeek、WorkBuddy。全部显示，未接入的也占位。
- 每项：logo 外套一个圆环，旁边写数字。
  - **窗口制**（Codex、Claude、Antigravity）：圆环与数字取**已用比例最高**的窗口（即剩余最少），数字写**已用 %**（取整）。
  - **比例制**（WorkBuddy 积分）：已用 = 100 − 剩余比例，规则同上。
  - **余额制**（DeepSeek）：空环，数字位置写余额，如 `¥8.85`。
  - **未知**：空环 + `–`。未知不等于 0%。
- 颜色按已用比例：`< 70%` 绿，`≥ 70%` 黄，`≥ 90%` 红。余额制的颜色取服务商状态（healthy 绿 / critical 红）。
- 旧快照（`gauge.provenance === 'stale'`）：圆环改为虚线，整项透明度 0.55。
- 尺寸：圆环直径 22px，描边 1.5px，logo 为直径的 0.6，离屏幕边 3px。贴左/右边时竖排、数字在 logo 内侧且右对齐；贴上/下边时横排。
- 外观：深色半透明底 `rgba(20,20,24,0.78)` + `backdrop-filter: blur(20px)`，1px 发丝边 `rgba(255,255,255,0.08)`，圆角 = 条宽一半。

### 5.2 悬停一行（胶囊）

- 指针停在某一项上 150ms 后，在它旁边（朝屏幕内侧）弹出一条胶囊，高度与圆环相同，写这家所有已知窗口：`5h 12%  每周 79%  Opus 60%`；余额制写余额；未知写原因（如「未接入」）。
- 每个窗口的数字用自己的颜色。指针离开 200ms 后收起。

### 5.3 点击卡片

- 点击某一项（按下与松开之间移动不超过 4px）打开这家的卡片；再点同一项、点卡片外、按 Esc 关闭。打开卡片时胶囊消失。
- 卡片内容自上而下：
  1. 头部：logo、名称、套餐/来源一行（取快照的 `plan`）、右侧刷新按钮。
  2. 窗口行：每个窗口一行——名称、细进度条、已用 %、重置时间（`周三 03:54` 或 `2 小时后`）。点击任一行，所有行的「已用 %」切换为「消耗速率 x.x %/h」，再点切回。速率不可用时写「采样中」。
  3. Token 区（仅 Claude、Codex）：标题「Tokens · 24 小时」+ 合计数；96 根柱，每根 15 分钟，含当前这一刻钟；悬停某根显示 `10/13 10:00–10:15 · 245,900 tokens`。读取失败时写「Token 读取失败」，不画柱。
  4. 底部：数据时间（`freshness`）、「完整面板」按钮（打开现有大面板）。
- 卡片外观：与条同材质，圆角 14px，内边距 14px；字号按原版——名称 13 semibold、行 12、次要 11。

### 5.4 拖动与吸附

- 在 HUD 条上按下并移动超过 4px 进入拖动；拖动中由主进程每帧按 `screen.getCursorScreenPoint()` 移动窗口，HUD 条显示 1px 高亮边框。
- 松手时：取指针所在显示器的工作区，找到离指针最近的一条边，吸附到该边，沿边位置换算为 0–1 的偏移并保证整条不出界。
- 持久化到 `userData/hud-settings.json`：`{ displayId, edge, offset, visible }`。启动时该显示器不存在则回落到主显示器右边、offset 0.3。
- 只有一个 HUD，跟随用户拖到的显示器。显示器变化（插拔、分辨率改变）时重新计算位置。

### 5.5 托盘

托盘菜单新增「显示 HUD / 隐藏 HUD」（勾选项，持久化 `visible`）。原「显示额度」仍打开大面板。

## 6. 数据

### 6.1 Claude oauth（`claude-oauth.cjs`）

- 每次刷新都重新读 `~/.claude/.credentials.json`（Claude Code 自己续期改写它），只读，取 `claudeAiOauth.accessToken` 与 `subscriptionType`。
- 用 Electron `net.fetch` 请求 `GET https://api.anthropic.com/api/oauth/usage`，头部 `Authorization: Bearer …`、`anthropic-beta: oauth-2025-04-20`，15 秒超时。`net.fetch` 走 Chromium 网络栈，自动跟随系统代理（Clash Verge 系统代理模式）。
- 解析：返回 JSON 里每个形如 `{ utilization: number, resets_at: string }` 的顶层字段都算一个窗口。已知标签 `five_hour`→「5 小时」、`seven_day`→「每周」、`seven_day_opus`→「每周 · Opus」、`seven_day_sonnet`→「每周 · Sonnet」，其他沿用字段名。没有 `five_hour` 视为解析失败。
- 输出与现有 `normalizeClaudeSnapshot` 相同结构（`windows`、`groups.buckets`、`remainingPercent`、`status`），`source` 写「Claude 官方用量接口」，`plan` 写套餐名。
- 失败处理：401 → note「登录令牌过期，在 Claude Code 里发一条消息即可续期」；429 → 本轮跳过，下一次刷新间隔翻倍（上限 15 分钟），成功后恢复；网络错误 → 回退读状态栏桥快照（按其原规则标旧）。凭证缺失 → 回退状态栏桥。
- 令牌只在主进程内存中使用，不进入快照、历史、日志、错误信息。

### 6.2 Token 统计（`token-ledger.cjs`）

- 时间轴：以当前时刻所在的一刻钟为最后一根，往前共 96 根；按本地时区对齐整刻钟。
- **Claude**：枚举 `~/.claude/projects/**/*.jsonl` 中修改时间在 24 小时内的文件；逐行解析 `type === 'assistant'` 且带 `message.usage` 的记录，按 `message.id` 去重（同一消息可能分多行），token = `input_tokens + output_tokens + cache_creation_input_tokens + cache_read_input_tokens`，按 `timestamp` 落桶。
- **Codex**：枚举 `~/.codex/sessions/YYYY/MM/DD/*.jsonl` 中修改时间在 24 小时内的文件；取 `event_msg` 且 `payload.type === 'token_count'` 的记录，以同一文件内 `info.total_token_usage.total_tokens` 的正增量落桶（首条记录以 0 为基准；总量回退视为新段，不计负数）。
- 增量读取：记住每个文件的 `{ size, mtimeMs, offset, 每文件状态 }`，文件变大只读新增部分；文件变小或 mtime 回退则重读。只缓存在内存中，不落盘。单行超过 1MB 跳过。
- 一次刷新的时间预算 2 秒，超出则本轮返回已有结果并标记 `partial`。
- 每个服务商的结果：`{ status: 'ok' | 'error' | 'unsupported', buckets: number[96], total, startAt }`。读不到目录 → `unsupported`；异常 → `error`。

### 6.3 消耗速率

- `quota-history` 改为对所有带 `groups.buckets` 的服务商记录（现在只有 Antigravity）。Codex 客户端补出 `groups`：一个组「Codex 账户额度」，每个窗口一个 bucket，`bucketId` 用窗口时长（`300m`、`10080m`）。
- 速率规则不变：保留 24 小时，近 1 小时样本、跨度 ≥ 5 分钟才给速率，断档超过 10 分钟、比例回升、时钟回退都重新开始。
- UI 快照的每个窗口带上 `burnPerHour`（已用百分点/小时）和 `estimatedHoursLeft`，HUD 卡片直接读取。

### 6.4 HUD 视图模型（`hud-view.cjs`）

纯函数 `buildHudItems(uiSnapshot, tokens)` → 每项 `{ id, name, logo, ring: { usedPct | null, level: 'ok' | 'warn' | 'high' | 'none', dashed }, label, pill: [{ name, text, level }], card }`。渲染进程只拼 DOM。

## 7. 出错与边界

| 情况 | 表现 |
|---|---|
| 某服务商未接入 / 读取失败 | 空环 + `–`；胶囊写原因；卡片显示原因与大面板同款 setup 按钮的文字提示（按钮在大面板里） |
| 旧快照 | 虚线环、调暗；卡片顶部写「旧数据 · 时间」 |
| Token 读取失败 / 目录不存在 | 卡片 Token 区写「Token 读取失败」或不显示该区 |
| HUD 渲染进程崩溃 | 与大面板同样的重载与 1 分钟内 3 次上限 |
| 显示器拔掉 | 回落主显示器 |
| 全屏应用 | `floating` 层级不压独占全屏；无边框全屏游戏下用户可从托盘隐藏 HUD |

## 8. 测试

- `node --test`（与现有 `tests/*.test.mjs` 同风格）：
  - `hud-view`：选已用最高的窗口；三档颜色边界（69/70/89/90）；比例制、余额制、未知、旧快照。
  - `hud-geometry`：四条边吸附、偏移夹在 0–1、整条不出界、多显示器取指针所在屏。
  - `token-ledger`：Claude 按 `message.id` 去重；Codex 正增量与回退分段；15 分钟边界与 24 小时窗口；增量读取续读与文件截断重读；坏行跳过。
  - `claude-oauth`：解析已知/未知窗口字段、缺 `five_hour` 失败、401/429/网络错误的状态与回退；断言令牌不出现在任何返回对象与错误信息中。
  - `codex-client`：新增 groups 后 history 能算出速率。
- `scripts/smoke-desktop.cjs` 扩展：启动后 HUD 窗口存在、透明、置顶、默认鼠标穿透。
- 手动验收清单（交给用户在桌面上点，不由 AI 宣称已验证）：圆环颜色与大面板一致、悬停胶囊、点击卡片与速率切换、Token 柱悬停、四条边拖动吸附、重启后位置保留、托盘显示/隐藏、切到其他软件后 HUD 仍在、Claude 圆环有真实数据。

## 9. 不做（本期）

事件卡片与 hooks、会话列表、Bot 动画、光晕、刘海/动态形态、多屏各一个 HUD、HUD 设置界面（尺寸等先用默认值，设置文件可手改）、iPhone/远程。

## 10. 第三方素材

logo 来自 Lobe Icons（MIT），随 `assets/logos/LICENSE-lobe-icons.txt` 一起提交，并在大面板「软件与数据说明」里注明。交互设计参考 Agent HUD（Apache-2.0），不复制其源码。
