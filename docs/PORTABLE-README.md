# QuotaDeck 桌面版

这是未签名的发布候选版。主程序无需另外安装 Node.js；部分本机 CLI 和 Claude 数据桥仍需各自的运行环境，见对应接入说明。请将整个文件夹保存在固定位置，不要只移动 `QuotaDeck.exe`，也不要直接在压缩包里运行。

## 启动与退出

双击 `QuotaDeck.exe`。点「−」隐藏到系统托盘；点击托盘图标重新显示，托盘菜单「退出」结束软件。如果界面异常，可从托盘「重新加载界面」。

Windows 安全提示不是本软件的安装步骤。请先确认下载来源与校验结果；不要为运行软件关闭安全保护。文件清单只能检查完整性，不能代替代码签名或证明发布者身份。

## 添加桌面快捷方式

在此文件夹中打开 PowerShell，运行：

```powershell
powershell.exe -NoProfile -File .\install-shortcuts.ps1
```

默认只创建桌面入口并保留已有自启动设置。如确实需要“打开已知 Agent 时自动启动 QuotaDeck”，增加 `-EnableStartup`。脚本被系统策略阻止时，不要自行关闭保护；仍可直接运行主程序，或请管理员审核脚本。无需管理员权限。

快捷方式更新会保留备份，输出备份位置；旧软件文件夹不会被删除。升级前先从托盘退出旧版，保留旧目录，再在新版文件夹运行上述命令。已有旧监听器的用户需注销后重新登录以切换监听器；安装器不会强行结束其他程序。

如需回退，用当前安装脚本指定保留的旧软件目录：

```powershell
powershell.exe -NoProfile -File .\install-shortcuts.ps1 -InstallDirectory '旧版的完整文件夹路径'
```

## 检查文件完整性

```powershell
powershell.exe -NoProfile -File .\verify-package.ps1
```

检查只读，不修改文件。发现缺失、损坏或未列入清单的文件时会报错；请保留报告，从可信来源获取干净副本，不要自行忽略错误。

## 连接与真实性

- Codex、Antigravity、Claude 和 WorkBuddy 的 CLI 是否存在，与是否已登录、额度是否可读是不同状态。
- Antigravity 需启动本机服务并登录；仅装有 CLI 不足以读取额度。
- Claude 默认不修改原状态栏，需要按 `resources/app/docs/claude-setup.md` 手动转发官方 statusLine 数据。
- WorkBuddy 当前读取官方网页快照，不是自动抓取网页；格式见 `resources/app/README.md`。
- DeepSeek 使用本机环境变量 `DEEPSEEK_API_KEY`，不要把密钥发给他人或写入公开文件。
- 不公开的模型倍率、共享关系或额度显示未知，不编造独立模型余额。模型能力标签为本地建议。
- 多 Agent 协作需要主动勾选，实际执行会消耗对应服务商额度。界面重载不重复调用；软件完整退出后不保留任务和结果。

本机配置、Claude 桥接快照与 WorkBuddy 快照位于 `%APPDATA%/QuotaDeck`。不要将该私人目录随软件一起发布。
