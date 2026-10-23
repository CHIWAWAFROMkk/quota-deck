# QuotaDeck

Windows 桌面 AI 额度显示器与本地 Agent 并行任务入口。使用 Electron + Node.js，MIT 开源。

[项目介绍](https://chiwawafromkk.github.io/projects/quota-deck/) · [源码](https://github.com/CHIWAWAFROMkk/quota-deck)

## 当前功能

- 额度页按服务商与共享额度池折叠，避免把账户余额复制成独立模型额度。
- Codex：读取本机 CLI 的账户额度窗口和模型列表。
- Claude Code：优先只读本机 `~/.claude/.credentials.json`，请求官方用量接口读取 5 小时 / 每周订阅窗口（令牌只留在主进程，不进快照、日志或界面）；读不到时回退到官方 statusLine 转发的数据。界面内一键接入：原有状态栏（如 claude-hud）改由串联桥转发，照常显示；可一键断开并原样恢复。详见 [接入说明](docs/claude-setup.md)。
- Antigravity：优先读取本机服务额度和可选模型目录，目录失败才回退 CLI，按共享池显示窗口、重置时间与采样消耗速度。
- DeepSeek：使用官方 API 读取共享账户余额与模型列表。
- WorkBuddy：读取用户自行保存的官方网页 JSON 快照，显示模型消费倍率；不是自动同步网页。
- 并行任务：可选择 Codex、Claude Code、Antigravity、WorkBuddy；分工分别为技术方案、独立审查、替代方案、交付结构。仅用户勾选后发起，CLI 检测与额度快照状态分离。
- 托盘窗口、桌面快捷方式、可选登录后监听已知 Agent 启动。

## 贴边 HUD

界面照 Agent HUD（`jazzenchen/agent-hud-open`，Apache-2.0）的简约形态复刻。默认是贴边浮条，也可以换成顶部正中的[刘海](#刘海模式)：

- 屏幕边缘一条小浮条，Codex、Claude、Antigravity、WorkBuddy、DeepSeek 各一个额度圆环；数字是已用比例（余额类写余额），不到 70% 绿、70% 起黄、90% 起红，没读到写 `–`。
- 鼠标停在图标上 0.4 秒，旁边伸出一行明细，例如 `5h 12%  Weekly 79%  Opus 60%`。
- 点击图标弹出这家的卡片：右上角 `%` / `🔥` / `#` 切换已用比例、消耗速率、每小时 Token；Claude 与 Codex 还有过去 24 小时按模型堆叠的 Token 柱，悬停看每 15 分钟明细。
- 卡片左下齿轮是设置（尺寸、圆环、数字、复位位置、Claude statusLine 与 WorkBuddy 接入），右下图标打开 24 小时 Token 统计窗口。
- 按住浮条拖动，它会实时吸到离指针最近的屏幕边，贴上下边时变成横条；松手后位置会记住。托盘菜单「显示 HUD」可开关。

### 做完了提醒

- QuotaDeck 只读本机会话日志（`~/.claude/projects`、`~/.codex/sessions`），不改 Claude Code 或 Codex 的任何配置。
- Claude Code（VS Code 插件或终端）或 Codex 桌面版做完一轮，几秒内图标变成笑脸 bot，旁边伸出 `New reply`；在跑时是 working 的 bot，出错停下写 `Stopped`。
- 提醒一直留到你看过：关上卡片、点 ×、点 `Return to session`，或在那个会话里发新消息。`Return to session` 会打开 VS Code 里对应的 Claude 对话（`vscode://anthropic.claude-code/open?session=…`），或 Codex 桌面版（`codex://threads/…`）。
- `Waiting` 是推测：某个工具调用超过 30 秒还没结果，就当作可能在等你批准。很长的命令（比如编译）也会被这样标出来。
- 只提醒你自己开的会话：Codex 只看桌面版里的会话，`codex exec` 和子代理不提醒；Claude 不提醒 `-p` / SDK 自动跑的会话。回复内容只在内存里，不写盘。

### 刘海模式

- 卡片齿轮 → Display → `Style` 选 `Notch`，浮条换成屏幕顶部正中的一块黑色刘海；选 `Strip` 换回浮条，浮条回到原来的位置。
- 刘海外面一圈光晕，从左到右依次是 Codex、Claude、Antigravity、WorkBuddy、DeepSeek，颜色和圆环一致：绿、黄、红表示额度用了多少，灰色是没读到。全部没读到时整圈淡灰、不动。
- 光晕会呼吸：有会话在跑时 3 秒一次，都闲着时 7 秒一次。来了新提醒，那一家对应的那一段闪一下：做完闪蓝，在等你或要批准闪橙。
- 有提醒时刘海向两边长出翅膀：左边是 bot 和厂商名，右边是 `Approve?` / `Waiting` / `Stopped` / `New reply`，同一家多条时加 `×N`。几家同时有提醒时只显示最该处理的那条（批准 > 等待 > 出错 > 新回复）。点翅膀打开那一家的提醒卡片。
- 鼠标停在刘海上 0.4 秒，它稍微变宽，露出五个圆环（不显示数字）；点圆环打开那一家的卡片。Size、Show rings、Ring thickness 对刘海里的圆环同样有效。

### 打游戏时自动安静

- 以下任一情况算在打游戏，整个 HUD（浮条或刘海、提醒、卡片）都会隐藏：
  - 程序在独占全屏运行 Direct3D；
  - 前台窗口占满整块屏幕，且程序在 Steam 游戏库里（路径含 `\steamapps\common\`）；
  - 前台窗口占满整块屏幕，且程序名在游戏名单里。
- 浏览器或播放器全屏看视频不算，HUD 照常显示。
- 游戏中提醒和批准请求照常攒着；退出游戏后约 2 秒 HUD 回来，攒下的提醒照常出现，光晕补闪一次。托盘里手动隐藏的 HUD 不会因为进出游戏自己冒出来。
- 游戏名单在 `%APPDATA%\quota-deck\hud-settings.json` 的 `games` 键里，是一组 exe 文件名，不区分大小写。默认包括 `cs2.exe`（完美世界 CS2）、`tlou-ii.exe` / `tlou-ii-l.exe`（最后生还者 2）和 `javaw.exe`（Minecraft，只有占满全屏时才算）。先从托盘退出 QuotaDeck 再改（运行中保存设置会覆盖手改的内容），改完启动生效；写错的项会被忽略。
- 检测用一个后台 PowerShell 小进程，每 1.5 秒看一次前台程序名、路径和是否占满屏幕，不读窗口标题。它起不来时就当作没在打游戏。

## 运行

Windows 11、Node.js 22+、PowerShell 7。先安装并登录需要使用的 Agent CLI。

```powershell
npm ci
npm run check
npm start
```

安装脚本不会替你登录第三方服务。缺少连接器或凭证时应显示未连接；源码不包含个人额度数据或 API 密钥。

### 可选环境变量

| 变量 | 用途 |
| --- | --- |
| `DEEPSEEK_API_KEY` | DeepSeek 官方 API 密钥，仅本机进程读取 |
| `WORKBUDDY_USAGE_SNAPSHOT` | WorkBuddy 用量 JSON 文件路径 |
| `QUOTADECK_CLAUDE_SNAPSHOT` | Claude statusLine 桥接后的脱敏快照路径 |
| `QUOTADECK_CLAUDE_PATH` | Claude Code 原生 `claude.exe` 路径 |
| `QUOTADECK_AGY_PATH` | Antigravity 的 `agy.exe` 路径 |
| `QUOTADECK_ANTIGRAVITY_LOG` | Antigravity 语言服务器日志路径 |
| `QUOTADECK_NODE_PATH` | WorkBuddy 启动所用 `node.exe`，默认搜索 PATH |
| `QUOTADECK_WORKBUDDY_CLI` | WorkBuddy 安装目录中 `resources/app.asar.unpacked/cli/bin/codebuddy` 路径 |
| `ANTIGRAVITY_PROXY` | Antigravity 模型列表读取所需代理，默认继承系统进程环境 |

WorkBuddy 默认从 `%APPDATA%/QuotaDeck/workbuddy-usage.json` 读取，格式如下。这里的 `null` 和空列表是结构说明，不代表真实余额：

```json
{
  "capturedAt": null,
  "plan": null,
  "remainingCredits": null,
  "totalCredits": null,
  "usedCredits": null,
  "models": []
}
```

模型条目格式为 `{"name":"官方模型名称","rateMultiplier":"官方倍率，例如 0.5x"}`，请使用页面实际值和采集时间。

## 构建桌面包

```powershell
npm run check:desktop
npm run package:portable -- -OutputName QuotaDeck-0.6.0
pwsh -NoProfile -File scripts/install-shortcuts.ps1 -InstallDirectory dist/QuotaDeck-0.6.0
```

打包复制精确锁定版本的 Electron 与应用源码，不复制 `data/`、凭证或开发测试数据；包含逐文件 SHA-256 清单。当前为未签名候选版，不绕过 Windows 安全提示。

安装器创建桌面入口，保留已有登录启动设置；新启用监听需显式加 `-EnableStartup`。升级前备份快捷方式与安装指针，失败回退。旧监听进程不会被强行终止，迁移后需注销再登录；新监听器随当前安装指针启动。仅构建不改变用户设置。

交付包根目录带有 `README.md`、`install-shortcuts.ps1`、`verify-package.ps1`，用户不需要下载源码才能添加桌面入口或核验文件。帮助脚本兼容 Windows 自带 PowerShell；安装与登录监听尊重系统脚本执行策略，不自动绕过。清单校验用于检测文件变化，不替代发布者签名。

从已有桌面入口升级时，安装器会将旧私有包内合法的 `local-paths.json`、`workbuddy-usage.json` 复制到 `%APPDATA%/QuotaDeck`，仅在目标不存在时迁移，源文件保留，不覆盖稳定配置。没有明确旧入口时不扫描个人文件；可手动复制这两份文件到该目录。Claude 配置始终不改写。

## 数据含义与局限

- 模型是否可用以当前账号、地区、服务端返回和登录状态为准；不能保证发现任意本地 Agent 或隐藏模型。
- Antigravity 本机接口属于实验性适配，版本变化可能破坏连接；不是官方承诺稳定的公共 API。
- 共享额度不能分成独立余额。服务商不公开倍率时，不提供猜测倍率。
- WorkBuddy 的相对可用量使用 `1 / 消费倍率`，仅在相同计费基准、输入输出和折扣条件下可比；不是还可调用多少次，免费也不意味着无其他限制。
- 消耗速度仅对 Antigravity 共享窗口采样，单位为百分点/小时；最近 24 小时计数保存在 Electron 用户数据目录 `quota-history.json`（不含凭证和原始响应）。以最近 1 小时、至少 3 次且跨度 5 分钟的样本估算；重置、额度回升或超过 10 分钟断档会重新采样。只有明确账号范围的采样才能跨启动续接；当前 Antigravity 尚未验证账号范围，重启重新采样，切换账号后也应重启。仅在预计先于重置耗尽时显示耗尽时间，不归因到单模型，也不保证未来速度不变。
- 单次刷新失败保留本次运行中上次成功的数据和原始时间，并标为缓存；重启后不会从磁盘恢复账户快照。网页快照始终显示采集时间。
- Antigravity 兼容顶层和嵌套的剩余比例字段；未知数值不当成零，未知模型保留在目录但不猜测额度池。模型目录失败不会阻止已读取的额度池展示。

- 主额度接口缺失时尝试同一本机服务的 `GetUserStatus`，回退结果明确标记“旧版来源、周额度未知”。尚未实现跨 App/CLI/IDE 的自动账号核验；本机 CLI `/usage` 实测未成功，未将未经验证的解析接入正式连接器。

## 参考项目

Antigravity 模型目录优先读取同一本机服务的 `GetAvailableModels`，严格使用 `agentModelSorts` 中的可选 Agent 模型 ID，保留未知名称的 ID，不混入补全等内部功能配置。仅本机目录失败时回退到 `agy models`。2026-09-15 本机验证返回 14 个可选模型及两个共享额度池；这是该次账号与版本的实测，不是固定模型总数。

本轮借鉴设计思路，未复制第三方源码：

- [CodexBar](https://github.com/steipete/CodexBar)：额度池语义、未知状态、来源兼容。
- [Codex Usage Monitor](https://github.com/upstream-ray/codex-usage-monitor)：紧凑额度与重置展示。
- [WhereMyTokens](https://github.com/jeongwookie/WhereMyTokens)：区分历史消耗与额度窗口。
- [AI Usage Dashboard](https://github.com/neyham/ai-usage-dashboard)：独立刷新与上次成功数据保留。
- 本机 CLI 可能加载自身上下文；任务由所选 Agent 发送给其服务商。请按实际任务选择是否提交敏感内容。
- 界面字体 Inter（SIL OFL 1.1），许可证见 `assets/fonts/LICENSE-inter.txt`。

## 验证与开发

`npm run check` 覆盖共享额度映射、输出解析和状态边界。真实账号连通性测试不会自动在测试套件或 CI 中运行。

核心代码：`src/main/` 为连接器与 HUD 主进程，`src/renderer/hud*` 为界面，`scripts/` 为冒烟与 Windows 打包工具。

本项目与 OpenAI、Google、DeepSeek、腾讯无官方隶属关系；相关商标属于各自权利人。
