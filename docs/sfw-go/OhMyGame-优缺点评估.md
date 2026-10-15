# OhMyGame 优缺点评估

> 评估口径：基于源码深读（pinned `aa93b07`，v0.0.0-beta.4.6，2026-10-13 收录）+ README/docs 对照，**未实际运行产品**。配套背景见 [OhMyGame 项目说明](OhMyGame-项目说明.md)。
> 上游：https://github.com/WhiteTowerAI/ohmygame · Apache-2.0 · ⭐680 / fork 76

## 优点

### A1 · 架构分层干净：Pi 是内核，领域层是壳里长出来的真东西

Pi（`@earendil-works/pi-coding-agent` 库形态嵌入）提供会话循环与基础工具，OhMyGame 在其上叠了三层：领域工具（`game_use`/媒体生成）→ 文件契约（canvas schema、graph.json）→ GUI 与云发布。每层职责清楚，**没有把 agent 逻辑和业务逻辑搅在一起**（`agent.ts` 的单体问题除外，见 C2）。

### A2 · `game_use` 是「agent 亲手验证产物」的完整参考实现

单工具五操作（open/inspect/act/capture/close）、sessionId 复用、按 `driver.capabilities` 协商参数 schema、capture 直接返回图片、`__OHMYGAME_PLAYTEST__` 测试桥提供确定性重放（reset/setSeed/step）。**这套设计可整体迁移到任何「agent 操控外部运行时」的场景**，是本次调研最有价值的单一产出。

### A3 · 规则内聚在工具上，不堆 system prompt

使用准则以 `promptGuidelines` 跟着工具走（如「构建成功 ≠ playtest」「批量合并相邻 action」），规则的可见域与工具的可用域一致。比全局 system prompt 更省 token、更不容易与实际能力漂移。

### A4 · 按阶段硬门控工具集

planning 模式物理上只给只读工具（read/grep/find/ls/search/questionnaire），executing 才放开 write/edit/bash + 媒体 + playtest（`agent-tools.ts` 的 `projectPiToolNames`）。**零评估成本、零误判率的门控**，代价是每次要人批准——是 pi-task-probe「事前评估」路线的直接对照面。

### A5 · 一切皆文件 + 每类工作区自带契约

游戏是普通 web 项目、设计文档是 Markdown、画布是 JSON + schema，每类工作区配 `AGENTS.md` + JSON schema。agent 用文件工具编辑、可视化编辑器读写同一份文件，两个入口不打架；节点引用、资产入列（`assets/generated/` 不算游戏的一部分，必须拷进源码）都有明确规则。

### A6 · 密钥与 agent workspace 严格隔离

BYOK 40+ provider，key 加密存 daemon 侧（0600 key 文件），**永不出现在 agent 工具结果、游戏代码或 renderer 里**。插件配置的 `${config.field-id}` 注入 + secret 字段拒绝默认值，边界设计成熟。

### A7 · 工程活跃度与透明度

2 个月 847 commits，发版有 changelog 级别的 commit message（Windows 安装器竞态、ZIP 校验和跨 zlib 一致性这类问题都写清了根因），`PI_CODING_AGENT_DIR` 隔离验证、实验分支（Bun runtime 迁移）留有实测报告。

## 缺点

### C1 · Pin 旧版 Pi + 私打 patch，SDK 跟随成本转嫁给上游

`@earendil-works/pi-coding-agent` pin 在 **0.99.2**（本机 CLI 已是 1.2.0），且对 `pi-ai@0.99.2` 私打 patch。上游升级时这层要人肉跟进；读它源码研究 Pi API 会有版本代差。

### C2 · 2200+ 行单文件 `agent.ts`

会话管理、prompt 装配、工具注册、plan 状态机全在一个文件里，可读性差，改动影响面难评估。

### C3 · 双工具链复杂度：Bun + Node 并存

Bun 管 install/build/test，Node 22.19 管 daemon 与 workspace 命令，`bunfig.toml` 要关掉 Bun 的一堆自动行为才不出事（dotenv、peer 自动安装、Node 替换）。Bun daemon 完整迁移做了一次又退回（`chore/bun-runtime` → 只采纳 toolchain 阶段），说明这条路的坑是实测过的。

### C4 · 安全模型是「本机信任」，无 OS 级沙箱

源码自陈：`cwd guides Pi but is not an OS security boundary`。agent 的 bash 对文件系统有真实访问权，隔离只靠目录约定 + 工具门控。**作为本机单人工具成立，作为可运行不可信内容的平台不成立**——画布节点引用外部图片、Community 游戏 remix 这类场景目前没有对应的沙箱故事。

### C5 · beta 期的交付毛边

Windows 安装包未签名（SmartScreen 警告）；无 Linux / Intel Mac 构建；发布必须走 OhMyGame Cloud（自建静态托管不行）；README 承认 playtest 是开环的——agent 无实时反应能力，只能「计划一批输入 → 跑 → 看结果」。

### C6 · 社区与生态还在早期

⭐680、4 watchers、无 Discussions/Wiki，`help wanted` 素材少。押注它的插件生态（`.ohmygame-plugin` 格式）现在为时过早——格式本身设计不差，但能否成为标准取决于产品存续。

## 结论

**作为「用 Pi 做产品」的参考实现：值得精读，A2/A3/A4 三条模式可直接搬进自己的扩展开发。**
**作为游戏生产工具：beta 早期，等 first-run setup 和 playtest 报告落地后再实际上手评估。**
**作为依赖对象（pin 版本/抄格式/押生态）：谨慎，C1/C6 的代差和生态风险都是真实成本。**
