# QuotaDeck

Windows 桌面 AI 额度显示器与本地 Agent 并行任务入口。使用 Electron + Node.js，MIT 开源。

[项目介绍](https://chiwawafromkk.github.io/projects/quota-deck/) · [源码](https://github.com/CHIWAWAFROMkk/quota-deck)

## 当前功能

- 额度页按服务商与共享额度池折叠，避免把账户余额复制成独立模型额度。
- Codex：读取本机 CLI 的账户额度窗口和模型列表。
- Claude Code：接收官方 statusLine 的 5 小时 / 每周订阅窗口和当前会话模型。界面内一键接入：原有状态栏（如 claude-hud）改由串联桥转发，照常显示；可一键断开并原样恢复。详见 [接入说明](docs/claude-setup.md)。
- Antigravity：优先读取本机服务额度和可选模型目录，目录失败才回退 CLI，按共享池显示窗口、重置时间与采样消耗速度。
- DeepSeek：使用官方 API 读取共享账户余额与模型列表。
- WorkBuddy：读取用户自行保存的官方网页 JSON 快照，显示模型消费倍率；不是自动同步网页。
- 模型库：列出连接器当前返回的全部模型，支持搜索；能力标签是本地启发式建议，未经基准评测。
- 并行任务：可选择 Codex、Claude Code、Antigravity、WorkBuddy；分工分别为技术方案、独立审查、替代方案、交付结构。仅用户勾选后发起，CLI 检测与额度快照状态分离。
- 托盘窗口、桌面快捷方式、可选登录后监听已知 Agent 启动。
- 界面异常可有限自动恢复，也可从托盘重新加载；本次运行中的协作状态和最后结果在内存中保留，不会因重载自动再次调用模型，完整退出后不保留。

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
npm run package:portable -- -OutputName QuotaDeck-0.5.0-rc.5
pwsh -NoProfile -File scripts/install-shortcuts.ps1 -InstallDirectory dist/QuotaDeck-0.5.0-rc.5
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
- 协作是所选 Agent 的独立并行结果，不包含互相审查、多轮沟通、自动合并代码或自动最终汇总。使用只读／规划模式，仍会消耗服务商额度；检测到 CLI 不等于已验证登录。
- 本机 CLI 可能加载自身上下文；任务由所选 Agent 发送给其服务商。请按实际任务选择是否提交敏感内容。

## 验证与开发

`npm run check` 覆盖共享额度映射、输出解析和状态边界。真实账号连通性测试不会自动在测试套件或 CI 中运行。

核心代码：`src/main/` 为连接器与任务调度，`src/renderer/compact.*` 为正式界面，`scripts/` 为预览和 Windows 打包工具。

本项目与 OpenAI、Google、DeepSeek、腾讯无官方隶属关系；相关商标属于各自权利人。
