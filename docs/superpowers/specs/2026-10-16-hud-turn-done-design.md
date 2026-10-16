# QuotaDeck HUD 子项目 2a："做完了"提醒与 bot 脸 设计

日期：2026-10-16 · 状态：待用户审阅 · 基于 `main`（`2d956c0`）

## 1. 意图

用户一边让 Claude Code（在 **VS Code 插件**里）和 Codex（在 **Codex 桌面版**里）干活，一边会离开电脑（例子：去上厕所）。回来时最怕的是它其实早就做完了，自己白等了一阵。HUD 要让人一回到电脑前，扫一眼屏幕边缘就知道：哪个会话做完了、做了什么，点一下就能回到那个会话。

用户还提到：以后各家可能会把额度做得一目了然，HUD 的额度圆环就没那么必要了；但同时盯住 Claude Code 和 Codex 两边的"做完了"，是各家官方不会替对方做的。所以这块要能**独立用**，不依赖额度数据是否可用。

## 2. 目标、非目标、反目标

**目标**
1. Claude Code 或 Codex 做完一轮时，几秒内在 HUD 上出现提醒（照 Agent HUD 视频 14–17s）：浮条上那家的图标变成笑脸 bot，旁边伸出 "New reply" 胶囊；点开是回复卡片，有 "Return to session"。
2. 提醒**一直留着，直到用户看过**。用户离开时它照样会弹，回来时必须还在。
3. 不改任何配置文件，不需要用户去 Codex 里点信任：只读本机会话日志。
4. 图标平时也随状态变化：有会话在跑时显示 bot 脸（working），刚做完时显示笑脸（done）。
5. "可能在等你"：某个工具调用超过 30 秒还没有结果，就当作可能停下来等用户批准或回答，换一种表情（asking），并伸出 "Waiting" 胶囊。这只是根据日志的推测，偶尔会把很长的命令（比如编译）误判成在等你，用户已接受这个代价。准确的"等批准"留给 2b 的钩子。

**非目标（本子项目不做）**
- "等你批准"卡片（Deny / Allow once）和装钩子的开关：单独作为**子项目 2b**，因为必须改 Claude Code 和 Codex 的配置，还要实测两边会不会把批准交给 HUD。
- 在卡片上直接打字回复（原版也没有回复输入框）。
- 声音、Windows 系统通知、手机通知：用户明确说不需要。
- 刘海胶囊加光晕（子项目 3）。

**反目标（做了等于失败）**
- 提醒几秒后自动消失，用户回来看不到。
- 把自动化跑的会话当成用户的会话来提醒，比如 Claude 派 GPT 写代码用的 `codex exec`，或者子代理。一直误报会让用户不再看它。
- 把对话内容写到磁盘，或者发到网络上。

## 3. 约束

- Windows 11，Electron 44，沿用现有 HUD 架构：主进程读数据，渲染层只负责显示。CSP 不允许内联样式，只能用 CSSOM。
- 不新增运行时依赖。
- 隐私：回复正文只在内存里，最多保留 2 KB，不写盘、不记日志；退出就没了。标题最多 60 个字符。
- 界面文案英文，照视频。
- 向下兼容：渲染层要容忍事件字段缺失。
- 分工（用户的长期偏好）：后端（`src/main/**`）由 GPT 写，前端（`src/renderer/**`、preload、冒烟脚本）由 Claude 写并协调合并。

## 4. 数据从哪里来（已在本机日志核实，2026-10-16）

**Claude Code**：`~/.claude/projects/<项目>/<会话 id>.jsonl`
- 一轮开始：`type: "user"` 的行，而且是用户输入，不是工具结果。
- 一轮结束：`type: "assistant"`、`message.stop_reason` 为 `end_turn` 或 `stop_sequence` 的行。`tool_use` 表示还在继续。
- 被打断：用户行的文本以 `[Request interrupted` 开头。这算结束，但**不**提醒。
- 跳过子代理：`isSidechain: true` 的行。
- 标题：最后一条 `type: "ai-title"` 的 `aiTitle`。有 `custom-title` 时优先用它。都没有，就用第一条用户输入的第一行。
- 来源：行里有 `entrypoint`，本机都是 `claude-vscode`。`sessionId`、`cwd` 也在行里。
- 回复正文：结束那一条 assistant 消息里的文本块。

**Codex**：`~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl`
- 一轮开始：`event_msg` / `task_started`。
- 一轮结束：`event_msg` / `task_complete`，字段有 `turn_id`、`last_agent_message`、`started_at`、`completed_at`、`duration_ms`、`error`。
- 被打断：`turn_aborted`。不提醒。
- 会话信息：`session_meta` 里有 `id`（会话 id）、`cwd`、`originator`，以及 `source` / `thread_source`。
- **只提醒 `originator` 为 `Codex Desktop`、`thread_source` 为 `user` 的会话**。`codex_exec`（Claude 派 GPT 干活用的）和子代理（`thread_source: subagent`）不提醒，但仍算"在跑"，bot 脸照常显示。
- 标题：日志里没有现成的标题，用这个会话第一条用户输入的第一行。模型名取 `turn_context.model`。

## 5. 用户会看到什么（照视频）

**浮条上的图标**（每家一个，不变）
- 有这家的会话在跑：logo 换成这家颜色的 bot 脸，working 状态（轻微动作）。
- 有会话"可能在等你"：asking 表情（敲门似的轻跳），伸出 "Waiting" 胶囊（琥珀色文字 `Waiting · 2m`）。它的优先级高于 "New reply"。
- 有没看过的"做完了"：笑脸 bot（done），并且伸出 "New reply" 胶囊。
- 都没有：静态 logo，和现在一样。

**"New reply" 胶囊**：样式和悬停胶囊同一套：`logo Claude  💬 New reply`，"New reply" 是蓝色，带一个对话气泡图标。它常驻显示，不需要悬停。同一家有几条没看过时写 `3 new replies`。

**"Waiting" 卡片**：点开显示会话标题、在等哪个工具（比如 `Bash: npm run build` 的前 80 个字符）、已经等了多久，以及 "Return to session"。工具调用一有结果，或者新一轮开始，它就自动消失。

**回复卡片**（点胶囊或点图标打开，外观和现有卡片同一套）
- 头部：bot 脸 logo、厂商名、模型名（比如 `Fable 5.1`），右上角 "New reply" 标签和关闭用的 ×。
- 会话标题（粗体），回复摘要（最后一段，最多约 4 行）。
- 完成时间（`18:27`）和耗时（`3m`）。
- 左下 "View token usage"，切换到这家现有的额度卡片。右下蓝色 "Return to session" 按钮。
- 同一家有多条没看过时，卡片按时间从新到旧排，每条一块。

**什么时候算看过**：
- 卡片打开时不立刻清掉；**关上卡片后**，刚才显示过的那几条才算看过。
- 点某一条的 ×，或点 "Return to session"，那一条立即算看过。
- 用户在那个会话里又发了一条新消息（新一轮开始），也算看过。
- 看过的从胶囊和卡片里去掉。重启 QuotaDeck 不会复活旧提醒，因为提醒只在内存里。

**有提醒时点图标**：打开回复卡片（有 Waiting 时先显示 Waiting）；卡片里的 "View token usage" 切回这家的额度卡片。没有提醒时照旧打开额度卡片。常驻的提醒胶囊和悬停胶囊位置相同：悬停时临时显示悬停胶囊，移开后恢复提醒胶囊。

**出错结束的一轮**（Codex `task_complete.error` 不为空；Claude 的结束消息是 API 报错，比如额度用完、断网）：照样提醒。胶囊写 `Stopped`（红色），卡片标明 "Stopped with an error"，摘要显示错误原文。

## 6. "Return to session"

- **Claude**：打开 `vscode://anthropic.claude-code/open?session=<sessionId>`。官方文档确认：会话已经开着就聚焦到那个标签页；必须属于当前 VS Code 打开的工作区，否则会新开一个对话。
- **Codex**：打开 `codex://threads/<id>`。本机注册了 `codex://` 协议，但这个链接格式在 Windows 版能不能跳到对应会话**还没验证**。实现的第一步就是实测；不行的话，退回到只把 Codex 桌面版窗口切到前台。
- 主进程只接受上面两种格式、参数是合法 id 的链接，用 `shell.openExternal` 打开。渲染层不能传任意 URL。

## 7. 反应速度

现在 Token 统计每 60 秒读一次日志，提醒不能这么慢。改成：
- 记住最近 30 分钟内改动过的会话日志，每 1–2 秒检查它们有没有变大，只读新增的部分。
- 每 60 秒照常重新扫一次目录，发现新会话。
- 目标：一轮结束后 **3 秒内**出现提醒。

具体怎么读、和现有 `token-ledger.cjs` 共用多少代码，交给实现的人决定，但不能拖慢现有的 Token 统计。

## 8. 会话状态规则

- 在跑：一轮已经开始还没结束，而且日志 30 分钟内有新内容。超过 30 分钟没动静就当作已经放弃，不再显示 working。
- 程序刚启动时，只把启动之后才结束的轮次当成新提醒，不翻出历史。
- 可能在等你：一轮在跑，最后一条是工具调用（Claude：`stop_reason: tool_use` 的 assistant 行；Codex：`response_item` 里的函数调用），超过 30 秒还没有对应的结果行。结果一出现或新一轮开始就解除。Codex 日志里如果有明确的审批事件，实现时优先用它，并在计划里写明。
- 会话监视放在主进程里、HUD 窗口之外，**HUD 被托盘隐藏时照样运行**。重新显示时把当前状态和没看过的提醒补发过去。

**哪些会话会提醒**
- Claude：`entrypoint` 为 `claude-vscode` 或 `cli`（交互式）的会话会提醒；`sdk-*` 等自动化入口和子代理（`isSidechain`）不提醒。只有 `claude-vscode` 的会话显示 "Return to session"。
- Codex：见第 4 节，只提醒 `Codex Desktop` 加 `user` 的会话。

## 9. 已由用户决定

| 问题 | 决定 |
|---|---|
| 两件事哪个更重要 | "做完了"优先；"等你批准"拆成下一块（子项目 2b） |
| 声音、系统通知 | 不需要，只在 HUD 上留着 |
| 装钩子（2b 用） | 设置页开关，由用户手动装卸 |
| 主要使用场景 | Claude Code 在 VS Code 插件里，Codex 在桌面版里 |
| 等你批准时 | 本子项目先加"可能在等你"提示（工具调用超 30 秒无结果），接受偶尔误判 |

## 10. 我替用户做的决定（请过目）

- "做完了"不装钩子，只读日志。理由：不碰配置，Codex 不用点信任，装上就能用。
- 提醒留到看过为止，而不是像原版那样 4 秒后收起。
- `codex exec` 和子代理不提醒。
- 回复正文最多 2 KB、只在内存里，卡片上最多显示约 4 行。
- bot 脸由我们自己画：两家各一个简单的 SVG 脸，颜色用各自的品牌色，working 和 done 两种表情，参照视频 4s、14–17s 的样子。
- "View token usage" 打开这家现有的额度卡片。
- 关卡片后才算看过；有提醒时点图标开回复卡片；出错结束也提醒（写 Stopped）。
- Claude 提醒 `claude-vscode` 和 `cli`，不提醒 `sdk-*`。
- HUD 隐藏时会话监视照常运行，重新显示时补发。

## 11. 留给实现的人

- 日志增量读取的具体做法：轮询间隔、文件句柄、和 `token-ledger` 怎么共用。
- bot 脸的具体画法和动画节奏，不超出第 5 节的描述。
- 主进程和渲染层之间新事件通道的命名和结构。要遵守现有的 IPC 信任检查。
- 测试怎么组织：单测覆盖日志解析和状态规则，冒烟覆盖胶囊、卡片和"看过即消失"。
