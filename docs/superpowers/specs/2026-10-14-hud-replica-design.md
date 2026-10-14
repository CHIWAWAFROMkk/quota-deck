# QuotaDeck HUD 一比一复刻（子项目 1）设计

日期：2026-10-14 · 状态：待用户审阅 · 分支：`feat/edge-hud`

## 1. 背景与目标

第一期贴边 HUD（`2026-10-13-edge-hud-design.md`）已本地完成，但卡片、胶囊、文案与参考视频差距明显，侘寂大面板仍在。用户要求：**不要原来的面板，按视频一比一复刻**。

参考：Agent HUD（`jazzenchen/agent-hud-open`，Apache-2.0）的简约形态，以仓库自带的 `docs/videos/simple-mode-tour.zh-CN.webp`（1000×666，24 秒）为准；尺寸、颜色、时序取自其 Swift 源码。只照抄数值与布局，不复制源码。

视频里的内容拆成三个子项目，各自走 spec → 计划 → 实现：

| 子项目 | 内容 | 状态 |
|---|---|---|
| **1（本文）** | 简约形态浮条、悬停胶囊、点击卡片（三种模式、Token 柱与浮层）、四边吸附、卡片内设置页、统计窗口；删除大面板 | 本文 |
| 2 | Claude Code / Codex hooks：一轮结束卡片、New reply 胶囊、批准请求卡片（Deny / Allow once）、悬停 logo 变 bot 脸 | 另立设计 |
| 3 | 刘海胶囊 + 彩色光晕形态 | 另立设计，依赖子项目 1 |

成功标准：

1. 把本机 HUD 截图与原片同一时刻的帧并排，布局、配色、文字、动画节奏看不出差别（数据换成本机真实读数）。
2. 侘寂大面板、协作、模型库从界面和代码中移除；托盘仍可显示/隐藏 HUD、刷新、退出。
3. Claude statusLine 连接/断开、接入说明、WorkBuddy 登录可在卡片设置页完成。
4. 没拿到的数据显示为未知（`–` / `—`），不画成 0%；旧数据有明显区分。

## 2. 用户已确认的决定

| 问题 | 决定 |
|---|---|
| 去掉哪个面板 | 两个都换：点击卡片照视频重做；侘寂大面板删除 |
| 大面板里的功能 | 接入设置进卡片设置页；协作、模型库连同代码删除 |
| 视频范围 | 一轮结束卡片、刘海光晕、Token 柱悬停浮层都要；前两者拆为子项目 2、3 |
| 统计按钮 | 放图标，点开一个简单的 24h Token 大图窗口 |
| 实现路线 | A：保留主进程骨架（单透明窗口、穿透轮询、吸附、崩溃恢复、数据流），重写渲染层 |
| 交互模式 | 原版 `separatesAgents = on` 的行为（视频演示的就是它）：悬停出胶囊，点击出单家卡片；不做默认的 540pt 整体展开面板 |
| 文案 | 照视频用英文 |
| 字体 | SF Pro 不能用于 Windows，打包 Inter（OFL）作本地资源，数字等宽 |
| bot 脸 | 依赖会话状态，放子项目 2；本项目 logo 始终静态彩色 |

## 3. 结构与删改范围

**保留**
- `hud-window.cjs`：窗口、40ms 穿透判断、拖动、崩溃恢复。窗口从 480×480 放大到 640×600（不超过工作区），size 40 时也能容纳浮条 + 6 间距 + 440 卡片。拖动时每一帧按指针重新吸附并重排窗口（不再让窗口跟手自由移动）。
- 各家额度客户端、`snapshot.cjs`、`quota-history.cjs`、`claude-oauth.cjs`、托盘。

**改写**
- `hud-geometry.cjs`：删除常量 `STRIP = {158, 34}`，改为 §4.1 的公式，按 `size / ringWidth / showsRings / showsNumbers / 方向 / 各项数字宽度` 计算。公式写在 `src/renderer/hud-metrics.js`：普通脚本，在页面里挂到 `window.HudMetrics`，在 Node 里通过 `module.exports` 供单测使用。数字宽度要实测文字，所以由渲染层算出浮条尺寸，经新通道 `hud:strip {width, height}` 报给主进程（主进程校验范围）；主进程用它定位窗口、计算吸附位置，收到前用默认值。
- `hud-view.cjs`：英文文案；每行给出三种模式各自需要的值；套餐行、账户状态。
- `hud.html / hud.css / hud.js`：重写，拆成浮条、胶囊、卡片、Token 图、设置页几个模块，每个文件一件事。

**新增**
- `token-ledger.cjs` 按模型拆分（§6）。
- 统计窗口：`stats-window.cjs` + `stats.html/css/js`。
- `assets/fonts/Inter*.woff2` 与许可证。

**删除**
- 大面板：`index.html`、`app.js`、`styles.css`、`compact.html/css/js`、主进程中大面板窗口的创建与 `quota:hide` 等专用 IPC。
- `orchestrator.cjs`、`model-guidance.cjs`、`collab:*` IPC 与相关测试。
- 托盘「显示额度」。托盘剩：显示 HUD（勾选）、刷新全部、重新加载界面、退出。

**迁移**
- `quota:claude-connect / claude-disconnect / claude-help / open-workbuddy` 改为只接受 HUD 窗口主框架发来的请求，入口在卡片设置页。

## 4. 浮条、胶囊、拖动

所有 pt 按 CSS px 实现，随系统缩放。

### 4.1 浮条尺寸（默认 `size = 22`，`ringWidth = 1.5`）

| 项 | 公式 | 默认值 |
|---|---|---|
| 离屏幕边 | 3 | 3 |
| 环内 logo | `round(size × (rings ? 0.55 : 0.68))` | 12 |
| 图标方块 | `rings ? size : logo` | 22 |
| 数字字号 | `max(9, round(size × 0.59))` | 13 |
| 图标到数字 | `round(size × 0.23)` | 5 |
| 条目间距 | `round(size × (numbers ∥ vertical ? 0.45 : 0.32))` | 10 |
| 内边距 | `tight = max(3, round(size×0.18))`，`loose = round(size×0.45)`；起始侧 `rings ? tight+1 : loose`；末尾侧 `numbers ? loose : 起始侧`；横向上下 `tight`，竖向上下 `tight+3` | 竖：上 7 左 5 下 7 右 10；横：上 4 左 5 下 4 右 10 |
| 圆角 | `min(round(size × 0.73), min(w, h)/2)` | 横 15（胶囊），竖 16 |
| 无条目时长度 | 32 | |

竖向：宽 = 左 + 图标 + 图标到数字 + 数字列宽 + 右；高 = 上 + n×图标 + (n−1)×间距 + 下。数字列宽取最宽数字的实测宽度，数字右对齐；左右两边停靠时数字都在图标右侧。横向：宽 = 左 + Σ(图标 + 图标到数字 + 各自数字宽) + (n−1)×间距 + 右；高 = 上 + 图标 + 下。关闭数字时去掉数字与其间距。

### 4.2 外观
- 底色黑 0.82；1px 白 0.14 内描边；无阴影、模糊、光晕；强制深色。
- 圆环：底轨白 0.14；进度从 12 点顺时针，圆端头，线宽 `ringWidth`。
- 档位色：已用 <70% `#3ddc84`，≥70% `#ffd23f`，≥90% `#ff453a`，无读数 `#9a9aa0`。圆环与数字同色。
- 数字：`49%`；余额类 `¥8.85`（圆环留空；≤10 元黄，≤0 红）；未读到 `–`。圆环取该家用量最高的窗口。
- 顺序：Codex、Claude、Antigravity、WorkBuddy、DeepSeek（余额类排最后）。
- 默认：显示圆环、显示数字（与原版默认一致）。

### 4.3 悬停胶囊
- 停在图标上 400ms 出现，离开 200ms 收回；滑到另一图标时胶囊跟随平移，同一曲线。
- 内容：每个窗口一对 `短名 值`，如 `5h 12%  Weekly 79%  Fable 60%`。标签 12px `#98989d`；值 12px 半粗等宽、档位色（无档位 `#98989d`）；无读数 `—`。余额类 `Balance ¥8.85`。没有窗口时写 `Not connected` / `Error` / 厂商名。
- 高 26，两端内边距 12，标签与值间隔 5，对与对间隔 12；黑 0.82，全圆角，无描边。
- 竖边：胶囊有 `round(浮条宽/2)` 藏在浮条下，从浮条一侧伸出，`scaleX 0.2→1`；横边：贴浮条内侧，间距 0，`scale 0.86→1`。沿停靠边以图标中心对齐，并保持在屏幕内。
- 动画：`cubic-bezier(.2,.8,.2,1)` 400ms，透明度同步。

### 4.4 拖动
- 按住 0.3s 或移动 6px 拿起；拿起期间暂停悬停与卡片。
- 每次移动吸到离指针最近的边，平局保持当前边；抓住的点始终在指针下；换到上下边立即横排，不做动画；松手保存。
- 虚线框：浮条外扩 2，圆角 = 浮条圆角 + 2；填充白 0.025，描边白 0.9、1.25px、虚线 `4 3`，阴影黑 0.8 半径 2。只在拿起时显示。
- 松开时移动 ≤6px 且按下 ≤0.3s 算点击，打开该家卡片。

## 5. 卡片、设置页、统计窗口

### 5.1 外框
- 宽 440，高随内容（上限为 HUD 窗口高 − 8，超出时内容区滚动）；圆角 22；纯黑；1px 白 0.14 描边；内边距 14/18/14/18；离浮条 6。
- 从被点图标处展开，尺寸与位置一起变，400ms 同一曲线；内容淡入：延迟 120ms、220ms ease-out、自停靠边方向 5px 位移；淡出 100ms。
- 段间距 10；第二段起每段顶部 8 内边距 + 1px 白 0.10 分隔线。
- 点卡片外、按 Esc、或再点同一图标关闭；点另一图标切换到那家。

### 5.2 头部
- 14px logo（20 宽框），间距 6，厂商名 13px 粗体：Claude / Codex / Antigravity / WorkBuddy / DeepSeek。
- 右上三个按钮 `%`（Quota）、`🔥`（Burn rate）、`#`（Tokens/h）：各 20×18，间隔 2，图标 9px 半粗，内嵌 SVG 仿 SF Symbols `percent / flame.fill / number`；选中衬 `#f5f5f7` 0.12、圆角 5，未选 `#6e6e73`；切换 280ms。每家的模式分别记住并持久化。

### 5.3 账户行（11px）
- 左：账户名（0.85 透明）+ 套餐（`#98989d`）。Claude 凭证里没有账户名，只写套餐：`rateLimitTier` 含 `max_20x` → `Max x20`，含 `max_5x` → `Max x5`，否则按 `subscriptionType` 首字母大写（本机为 `Pro`）。拿不到的部分省略，不编造。其他家用现有 `plan` 文本的英文化版本，没有就留空。
- 右（`#6e6e73`）：`Current account`；数据旧时 `Last read 2h ago`。

### 5.4 额度行（13px）
- 横排间距 12，内边距上下 4、左右 6；悬停衬 `#f5f5f7` 0.06、圆角 6。
- 8px 色点（数值色，`box-shadow` 光晕 4）→ 名称 152 宽半粗（放不下用短名）→ 4px 进度条（底轨白 0.12，填充为已用比例、档位色）→ 数值 62 宽右对齐等宽半粗 → 右列 96 宽右对齐 12px 等宽。
- 名称：Claude `Current session` / `Weekly` / `Weekly limit · <模型>`；Codex `5h` / `Weekly`；Antigravity `<池名> · 5h` 等；短名用于胶囊：`5h` / `Weekly` / `<模型>`。

| 模式 | 数值 | 数值色 | 右列 |
|---|---|---|---|
| `%` | `72%` | 档位色 | 重置：<24h 倒计时 `1h 12m` / `4h 02m` / `51m` / `<1m`；≥24h `Sat 18:27`；已过 `Pending update`；未知 `—` |
| `🔥` | `6.3%/h`（一位小数） | 重置前会用完 → 黄，否则绿 | `20% by reset` / 预计用完时间 `Sat 18:27` / `Exhausted` / `No estimate` / `No usage` / `Insufficient data` |
| `#` | `1.2M/h` | 绿 | `29M / day`；无 Token 来源的厂商写 `—` |

- `🔥` 模式进度条在已用段后追加 0.38 透明的预测段（到重置时的预计用量）。
- 余额类只有一行 `Balance  ¥8.85`，右列空。

### 5.5 Tokens 段（Claude、Codex）
- 标题 `Tokens` 13px 半粗；右侧 `24h · 31M tok` 12px 等宽 `#98989d`；部分读取时 `24h · partial`。
- 柱图高 40，左右内边距 6，上 8；96 根（每根 15 分钟），柱间距 `min(2, 柱宽×0.2)`，每根堆叠圆角 2；按模型从下往上堆叠，配色依次 `#c084fc #60a5fa #2dd4bf #fb923c #f472b6 #a3e635`，`Other` 用 `#6e6e73`；底部 1px 白 0.10 基线。
- 悬停：该列衬白 0.08，中线 1px `#98989d`×0.5，其余柱 0.55 透明。浮层宽 `min(280, 图宽)`，列在左半边则放右侧 +12，否则放左侧；y −6；内边距 10，行距 6，`#282828`，圆角 8，1px 白 0.12，阴影黑 0.2 r6 y2。内容：时间段 11px（`Mon 12 Oct at 15:30 – 15:45`）、`495,897 tokens` 14px 半粗、每模型一行（6px 色点、12px logo、11px 名称、11px 等宽数量）。

### 5.6 底部
- 1px 分隔线，顶部内边距 6；左齿轮（设置页），右柱图图标（统计窗口）；按钮 28×28，图标 14px，`#98989d`。

### 5.7 设置页
- 点齿轮后卡片内容换成设置页，左上返回箭头，标题 `Settings`；同一外框与动画。
- **Display**：Size（滑块 16–40，步长 1）、Show rings、Ring thickness（1–4，步长 0.5，仅在显示圆环时出现）、Show numbers、Reset position。改动即时生效并持久化。
- **Connections**：Claude statusLine `Connect` / `Disconnect`，`Setup guide`；WorkBuddy `Sign in`；DeepSeek 说明 `Set DEEPSEEK_API_KEY to read balance`。
- 开关、滑块按原版深色样式（开关绿色 `#3ddc84` 底）。

### 5.8 统计窗口
- 普通深色窗口约 720×420，可关闭，单例；安全设置与 HUD 相同。
- Claude、Codex 各一张大柱图（96 根，横轴每 6 小时一个刻度，图例按模型），下方表格列出各模型 24h 合计与占比。数据来自同一份 `hud:tokens`。

## 6. 数据

- 主进程每 60 秒读额度，Token 账本同节拍刷新；分别推送 `hud:items`、`hud:tokens`。渲染层只展示，不读文件、不联网。
- **Token 按模型拆分**：
  - Claude：取 `message.model`，同一 `message.id` 仍取用量最大的一条。
  - Codex：每个文件记住最近一次 `turn_context` 的模型名（跨轮续读时保存在文件状态里）；相邻 `token_count` 的总量增量计入当时的模型；文件中尚未出现 `turn_context` 时计入 `Unknown`。
  - 每个来源最多 6 个模型（按 24h 用量排序），其余并入 `Other`。
  - 显示名映射：如 `claude-opus-5-5` → `Opus 5.5`，`claude-fable-5-1` → `Fable 5.1`，`gpt-5-codex` → `GPT-5 Codex`；未知名原样显示。
  - 账本结构：`{ status, startAt, partial, total, buckets: [96 个总量], models: [{ id, name, total }], stacks: [96 × [每模型数量…]] }`；颜色按 `models` 顺序在渲染层分配。主进程推送前再加上 `perHour` / `perDay` 文本（`1.2M/h`、`29M / day`）。
- **🔥**：沿用 `quota-history` 的 `burnPerHour`。到重置时预计已用 = 已用% + 速率 × 距重置小时（视频：12% + 6.3%/h × 1.2h ≈ 20%）；<100 写 `N% by reset`（绿），否则写预计用完时间（黄）；无速率 `Insufficient data`，速率为 0 `No usage`，已用完 `Exhausted`，数据旧或无重置时间 `No estimate`。
- **`#`**：最近 4 个桶（1 小时）总量为 `/h`；24h 总量为 `/ day`。
- **设置**：HUD 设置文件新增 `size`、`ringWidth`、`showsRings`、`showsNumbers`、`metric`（每家一个）；规范化时越界取默认值。主进程改设置后重算浮条尺寸与窗口位置。

## 7. 出错处理

| 情况 | 表现 |
|---|---|
| 未接入 / 读取失败 | 空环 + `–`；胶囊 `Not connected` / `Error`；卡片写原因并指向设置页对应入口 |
| 旧数据 | 圆环虚线；账户行 `Last read …`；`🔥` 写 `No estimate` |
| Token 部分读取 | `24h · partial` |
| 渲染进程崩溃、穿透、凭证 | 沿用现有逻辑（1 分钟内 3 次上限；凭证只在主进程） |
| 统计窗口无数据 | 图区写 `No token data in the last 24h` |

## 8. 测试

- 单测：
  - `hud:strip` 尺寸校验（非数字、过大、过小被拒绝）。
  - 浮条尺寸公式：四边 × 显示数字开/关 × size 16/22/40。
  - 吸附与点击判定（6px / 0.3s）。
  - `hud-view`：英文文案、三种模式的数值与右列、倒计时格式、余额档位。
  - 账本按模型拆分：Claude 模型字段；Codex `turn_context` 跨轮续读后仍记得模型；超过 6 个并入 `Other`。
  - 设置规范化。
  - 大面板与协作 IPC 已移除；迁移后的接入 IPC 只接受 HUD 窗口。
- 桌面冒烟：截浮条、胶囊、卡片三种模式、Token 浮层、设置页、横条，与原片同时刻帧拼成对照图交给用户目测。
- 手动验收清单交给用户在桌面上点，不由 AI 宣称已验证。

## 9. 不做（本子项目）

hooks 与事件卡片、bot 脸（子项目 2）；刘海光晕形态（子项目 3）；原版默认的 540pt 整体展开面板；会话列表；多屏各一个 HUD；悬停/收回延迟的设置项（固定 400/200ms）；完整多标签统计窗口。

## 10. 许可

交互与数值参考 Agent HUD（Apache-2.0），不复制源码。logo 继续用 Lobe Icons（MIT）。Inter 字体 OFL 1.1，许可证随字体文件提交。
