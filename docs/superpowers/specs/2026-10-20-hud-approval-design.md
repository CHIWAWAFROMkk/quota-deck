# 子项目 2b：HUD 上的"等你批准"卡片

日期：2026-10-20　作者：Claude（用户授权放开做）　状态：设计定稿，交 DeepSeek Harness 按计划实现，Claude 审查

## 为什么

2a 只能从日志推测 Waiting（工具 30 秒没结果）。用户离开电脑回来，想在 HUD 上直接看到"谁在等我批准、要做什么"，并当场点 **Allow once** 或 **Deny**，不必切回 VS Code 或 Codex。

## 已核实的外部事实（2026-10-19/20）

- **Claude Code**：`PermissionRequest` 钩子在要弹权限确认时触发，CLI、VS Code 扩展、桌面版都会触发。stdin 有 `session_id`、`transcript_path`、`cwd`、`permission_mode`、`tool_name`、`tool_input`；**没有请求 id**。stdout 输出 `{"hookSpecificOutput":{"hookEventName":"PermissionRequest","decision":{"behavior":"allow"}}}` 或 `behavior:"deny"` 加 `message`。不输出或出错就回到原生弹窗。默认超时 600 秒，可用 `timeout` 设（秒）。并行工具调用会同时触发多个。来源 https://code.claude.com/docs/en/hooks.md
- **Codex**：同名 `PermissionRequest` 钩子，`~/.codex/hooks.json`，输入输出格式同上（另有 `turn_id`）；不输出就走正常弹窗；非托管钩子要先在 CLI 里 `/hooks` 审核信任一次。桌面版是否触发未确认。来源 https://learn.chatgpt.com/docs/hooks
- Windows 上钩子命令用 `node` + 脚本路径，避免 `.cmd` 与引号问题。

## 行为

1. 设置页 Connections 区新增一行 **Approvals**，按钮 Connect / Disconnect，**默认未接入**。Connect 时在 `~/.claude/settings.json` 的 `hooks.PermissionRequest` 追加一条我们的钩子（`matcher: "*"`、`timeout: 120`）；若 `~/.codex` 目录存在，同样写进 `~/.codex/hooks.json`，并在设置行提示"Codex 需在终端运行 /hooks 信任一次"。Disconnect 只删我们那一条，别的钩子原样保留；修改前各自备份一次。
2. 钩子脚本被调用时：读 QuotaDeck 写下的本机端点文件（端口 + 随机令牌）。**文件不存在、连不上、令牌不对、或 110 秒内没有决定，都立即无输出退出**，回到原生弹窗——HUD 关着时绝不卡住用户。
3. QuotaDeck 主进程在 `127.0.0.1` 随机端口起一个只认令牌的小 HTTP 服务。收到请求就生成 id，挂起响应，HUD 出现一张 **approval** 卡片：哪家（Claude / Codex）、会话标题（按 `session_id` 从 tracker 取，取不到用 `cwd` 目录名）、工具名、一行摘要（Bash 显示命令、Edit/Write 显示文件路径、其他显示 JSON 前 160 字）。
4. 点 **Allow once** → 钩子输出 allow；点 **Deny** → 输出 deny，message 为 "Denied from QuotaDeck HUD"。卡片随即消失。钩子那边断开（用户已在原生弹窗里处理、或超时）时卡片也消失。
5. 胶囊：有 approval 时该家胶囊显示 `Approve? · 时长`，优先级高于 Waiting；bot 脸为 asking。卡片排序 approval 最前。
6. 绝不自动批准；没有"总是允许"。HUD 不接管任何安全决策，只是另一个点按钮的地方。

## 安全

- 服务只监听 `127.0.0.1`，令牌 32 字节随机，每次启动重新生成；端点文件写在 `%APPDATA%\QuotaDeck\approval-endpoint.json`，退出时删除。
- 请求体上限 64 KB，`tool_input` 只保留摘要需要的字段，不落盘、不进日志。
- 同时挂起上限 20 个，超出直接让钩子无输出退出。
- 渲染层只能对存在的 approval id 发 `allow`/`deny`，过 `trusted(event)` 校验。

## 不做

不做"总是允许"；不改 Claude/Codex 的 permission 规则；不替代 Waiting 推测（没接入钩子时 Waiting 照旧）。

## 留给实现者

服务内部结构、摘要截断细节、样式微调。界面文案以本文为准（英文，与现有 HUD 一致）。
