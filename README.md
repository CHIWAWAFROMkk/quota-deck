# QuotaDeck

Windows 桌面 AI 额度显示器与本地 Agent 并行任务入口。使用 Electron + Node.js，MIT 开源。

[项目介绍](https://chiwawafromkk.github.io/projects/quota-deck/) · [源码](https://github.com/CHIWAWAFROMkk/quota-deck)

## 当前功能

- 额度页按服务商与共享额度池折叠，避免把账户余额复制成独立模型额度。
- Codex：读取本机 CLI 的账户额度窗口和模型列表。
- Antigravity：读取本机语言服务器额度和 CLI 模型列表，按共享池显示窗口、重置时间与采样消耗速度。
- DeepSeek：使用官方 API 读取共享账户余额与模型列表。
- WorkBuddy：读取用户自行保存的官方网页 JSON 快照，显示模型消费倍率；不是自动同步网页。
- 模型库：列出连接器当前返回的全部模型，支持搜索；能力标签是本地启发式建议，未经基准评测。
- 并行任务：向 Codex、Antigravity、WorkBuddy 分别发送技术方案、替代方案、交付结构分工，返回各自结果。
- 托盘窗口、桌面快捷方式、可选登录后监听已知 Agent 启动。

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
npm run package:portable -- -OutputName QuotaDeck-0.3.1
pwsh -NoProfile -File scripts/install-shortcuts.ps1 -InstallDirectory dist/QuotaDeck-0.3.1
```

打包复制 Electron 运行时与应用源码，不复制 `data/`。快捷方式安装会创建桌面入口和登录启动的 Agent 监听器；仅构建不会安装监听器。

## 数据含义与局限

- 模型是否可用以当前账号、地区、服务端返回和登录状态为准；不能保证发现任意本地 Agent 或隐藏模型。
- Antigravity 本机接口属于实验性适配，版本变化可能破坏连接；不是官方承诺稳定的公共 API。
- 共享额度不能分成独立余额。服务商不公开倍率时，不提供猜测倍率。
- WorkBuddy 的相对可用量使用 `1 / 消费倍率`，仅在相同计费基准、输入输出和折扣条件下可比；不是还可调用多少次，免费也不意味着无其他限制。
- 当前消耗速度只对 Antigravity 共享窗口采样，单位为百分点/小时；样本保存在内存，重启后重新采样，不能归因到单个模型。
- 协作是三路独立并行结果，不包含互相审查、多轮沟通、自动合并代码或自动最终汇总。使用只读／规划模式，仍会消耗服务商额度。
- 本机 CLI 可能加载自身上下文；任务由所选 Agent 发送给其服务商。请按实际任务选择是否提交敏感内容。

## 验证与开发

`npm run check` 覆盖共享额度映射、输出解析和状态边界。真实账号连通性测试不会自动在测试套件或 CI 中运行。

核心代码：`src/main/` 为连接器与任务调度，`src/renderer/compact.*` 为正式界面，`scripts/` 为预览和 Windows 打包工具。

本项目与 OpenAI、Google、DeepSeek、腾讯无官方隶属关系；相关商标属于各自权利人。
