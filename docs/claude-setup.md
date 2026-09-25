# Claude Code 额度接入

QuotaDeck 不读取 OAuth 凭证，不修改登录状态。额度来自 Claude Code 官方 statusLine 传给状态栏命令的 JSON。

## 一键接入（推荐）

在 QuotaDeck 额度页展开 Claude Code，点「一键接入（保留现有状态栏）」。它会：

1. 备份 `~/.claude/settings.json` 为 `settings.json.quotadeck-<时间>.bak`。
2. 把你原来的 `statusLine.command`（例如 claude-hud）存入 `%APPDATA%/QuotaDeck/claude-statusline.json`。
3. 将 `statusLine.command` 改为 `node ".../src/main/claude-statusline-tee.cjs"`，`refreshInterval`、`padding` 等其他字段保持不变。

之后每次 Claude 刷新状态栏，串联桥 `claude-statusline-tee.cjs` 会：

- 只保存白名单字段（`rate_limits`、当前模型、接收时间、会话 ID 的哈希）到 `%APPDATA%/QuotaDeck/claude-usage.json`，不保存路径等原始输入；
- 把同一份输入原样交给原来的状态栏命令，并把它的输出显示出来。原命令是 bash 语法时，用接入时找到的 Git Bash 运行（排除 WSL 的 `System32\bash.exe`）；
- 保存失败不影响原状态栏显示；原命令 10 秒无响应会被结束。
- 接入前没有状态栏时，显示一行 `Claude 额度 · 5 小时 剩 xx% · 每周 剩 xx%`。

点「断开接入，恢复原状态栏」会把 `statusLine` 原样恢复（接入前没有则删除该字段），并删除串联配置。

## 注意

- 状态栏只在 Claude Code 命令行版里运行。只用 VS Code 扩展面板时不会产生数据；在终端里运行一次 `claude` 并收到回复后才会出现额度。
- 额度数据在收到 Claude 的第一个回复后才有；超过 5 分钟未更新标记为旧数据。
- 只在接入后首次收到真实输入时，才能说连接成功。

## 真实性边界

- `rate_limits.five_hour`、`seven_day`：已用比例与 Unix 秒重置时间；仅支持的订阅登录会提供。缺失显示未知，不补零。
- `spend_limit`：Gateway 支出窗口，不能当作模型独立额度。
- 超过重置时间的旧比例不继续显示。
- `model.id` / `display_name` 只证明当前会话模型；不硬编码全套 Claude 模型。
- 多会话仅展示最后接收到的会话，不合并账号额度。

## 手动接入

不想改 `settings.json` 时，可以让自己的状态栏程序把收到的 JSON 通过 stdin 转给静默旁路 `src/main/claude-statusline-bridge.cjs`（不输出内容，只保存白名单字段）。可用 `QUOTADECK_CLAUDE_SNAPSHOT` 指定保存位置。不要把 JSON 放到命令行参数或日志里。

官方依据：[statusLine](https://code.claude.com/docs/en/statusline)。
