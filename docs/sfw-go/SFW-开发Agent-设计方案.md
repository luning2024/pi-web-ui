# SFW 开发 Agent 设计方案

> 状态：**已按本方案实施 v0.1**（见 §7 落地状态）
> 日期：2026-10-14
> 参考：[OhMyGame 优缺点评估](OhMyGame-优缺点评估.md)
> 目标工作区：SFW 检出（默认 `D:\work-sfw-1`，只读参考）
> 本仓产物：`plugin/` + `scripts/` + `package.json`，全部在 `sfw-go` 内

---

## 0. 形态决定

**sfw-go = pi-web-ui 集成层 + 一个 SFW 插件。不 fork pi-web-ui 内核。**

依据（2026-10-14 实测）：

| 判断 | 证据 |
|---|---|
| 上游自己不维护 GUI | 官方 `@earendil-works/pi-web-ui` 只是 Lit 组件库、不内嵌 agent，停在 0.75.3（2026-05） |
| 第三方 `pi-web-ui` 是唯一成熟实现 | xingshuyin，MIT，29 天 35 个版本；聊天/会话/终端/Git/文件树/桌面安装包/插件系统齐备 |
| **不必 fork** | 主题（完整样式表可覆盖一切）、语言包、插件目录、48 个 `PI_WEB_*` 环境变量、设置预设——全是官方通道 |
| fork 的真实成本 | 1.2 版/天，单包非 monorepo。真 fork = 每天一次 rebase；只有品牌层（title/favicon/包名）必须动源码，十几行 |
| 曾以为「卡」是架构问题 | **不成立**。0.85 与 0.105 都是进程内 SDK，变的只是 SDK 副本从哪来。卡是具体热路径，0.86→0.105 有 18 条性能修复（0.93.0 流式每帧重算会话统计吃掉 27.6% CPU；0.98.0 同步 `existsSync` 能冻住事件循环数秒） |

**引擎必须是 `pi`**：`dsh` 引擎没有插件宿主（agent 工具固定空数组、无插件市场），SFW 面板会失效。

---

## 1. 架构

```
sfw-go/                          ← 全部产物在这里
├─ package.json                  依赖 pi-web-ui@0.105.1 + pi-coding-agent@^1.2.0
├─ scripts/start.mjs             注入 PI_WEB_* → 起官方 CLI
├─ scripts/install-plugin.mjs    官方 CLI install → 装进 .data/plugins/
├─ scripts/check-plugin.mjs      契约检查（createMockHost）
├─ .data/                        运行时数据（gitignored，不碰全局 ~/.pi-web）
└─ plugin/                       SFW 插件 = 唯一手写源
   ├─ manifest.json
   ├─ index.mjs                  服务端（全权 Node）
   ├─ client/entry.mjs           面板视图（纯 DOM）
   └─ sdk/                       pi-web-ui plugin SDK（插件按约定自带副本）

启动后：
  pi-web-ui 进程（PI_WEB_ENGINE=pi）
    └─ 进程内 pi SDK（createAgentSessionRuntime）
         └─ 插件服务端 index.mjs ── 起团结引擎 batchmode 子进程
  PI_WEB_CWD 指向 SFW 检出（只读参考；只有跑测试会往它的 artifacts/ 写产物）
```

---

## 2. 插件契约（实测，非推测）

来源：`plugin-sdk/index.d.ts`（23.5KB 权威类型面）+ `plugins/demo-mailbox` 模板 + `plugins/legado-web` 真实实现。

| 项 | 契约 |
|---|---|
| 服务端入口 | `export default definePlugin({ activate(host) { … return cleanup } })` |
| 客户端入口 | `export default defineView({ mount(container, ctx) { … return cleanup } })` |
| agent 工具 | `host.registerAgentTool({ name, label?, description, promptSnippet?, promptGuidelines?, parameters, execute })` |
| `parameters` | **纯 JSON Schema**（不是 TypeBox） |
| `execute` 返回 | **纯对象**（不是 Pi 的 `{content, details}`） |
| 双向协议 | 上行 `ctx.send(payload)` → 服务端 `host.onMessage((payload, from) => …)`；回包 `host.sendTo(from, payload)`。带请求语义的上行必须自带 `reqId` |
| 权限 | `manifest.permissions`；声明即进严格模式。能力族：`fs`(`:read`/`:write`) `ui` `tools` `http` `chat` `llm` `net` `dom` `notify` `storage` `secrets` |
| **客户端 import 陷阱** | 宿主只暴露 `/plugins/<id>/client/*`，所以客户端只能写 `./sdk/…` 这类相对 import；越界会让整个 bundle 不执行、插件页空白而服务端一切正常 |

---

## 3. OhMyGame 三条模式的落地

| 模式 | OhMyGame | sfw-go |
|---|---|---|
| **A2** agent 亲手验证产物 | `game_use` 五操作（持有浏览器会话） | `sfw_use` **四**操作（一次性进程，所以砍掉 `close`——那是 cargo cult） |
| **A3** 规则跟着工具走 | 手写 `promptGuidelines` | `registerAgentTool.promptGuidelines`，**10 条**，含项目铁律与生成物红线 |
| **A4** 按阶段门控 | `projectPiToolNames` 手搓 | 面板按钮是显式动作；agent 侧靠工具自身的守卫（能力协商 + 编辑器占用检查）拒绝，而不是靠提示词劝阻 |

`sfw_use` 四操作：

```
open      解析工作区：四仓实时分支 vs .workspaces.json、平台目录、编辑器版本、能力清单
inspect   tests | bindings | memory | docs | config      （全只读）
act       compile | editmode-tests | checks | sync-skills
capture   把测试产物判成结论：verdict / totals / firstFailure / compileErrors
```

**能力协商**（A2 的 `driver.capabilities`）：`capabilities` 由实际探测得出。

| capability | 条件 | 缺失后果 |
|---|---|---|
| `tests` | 编辑器可执行文件存在 **且** `<platform>/Library` 存在 | `act` 明确失败，给 remedy |
| `checks` | 有 `scripts/` | — |
| `memory` | 有 `scripts/host-memory.mjs` | — |
| `bindings` | 有 UIFacade 离线导出脚本 | — |

---

## 4. 验证面：SFW 真实能跑的东西

### 4.1 静态编译门（最便宜）

```
<Tuanjie.exe> -batchmode -nographics -silent-crashes -quit
  -projectPath "<root>/main/Project/project_wx"
  -logFile     "<root>/artifacts/<slug>-compile.log"
```

成功判据是**三条日志同时出现**：`BatchMode: 1`、`Tundra build success`、`Exiting batchmode successfully now!`，且无 `error CS`。
**这里 `-quit` 是对的**——不跑测试，静默跳过的坑不适用。

### 4.2 EditMode（唯一能证明「功能真的对」的）

```
<Tuanjie.exe>
  -batchmode -nographics -buildTarget WeixinMiniGame
  -projectPath "<root>/main/Project/project_wx"
  -runTests -testPlatform EditMode
  -assemblyNames AGame.Logic.EditorTests    # 整程序集；与 -testFilter 二选一
  -testResults "<root>/artifacts/<slug>-editmode.xml"
  -logFile     "<root>/artifacts/<slug>-editmode.log"
```

- **不传 `-quit`**（AGENTS.md 调试铁律：传了测试可能静默跳过）。旧计划文档 `docs/plans/2026-08-10-*` 带 `-quit`，**那是过时形态**。
- `-buildTarget WeixinMiniGame` **必须带**，否则 CenturyGame SDK 报 ~127 个 `CGSdkMiniGame*` 错误。
- `-assemblyNames` 是 artifacts 日志里真实用过的形态（`artifacts/all-logic-editmode-final.log:33-45`）。

**第二条入口（仅作后备）**：`EditModeTestBootstrap.RunFiltered` 注释声称 batchmode 下 `-runTests` 不触发，但它在 `main/` 与 `artifacts/` 里**零使用痕迹**，而 artifacts 证明 `-runTests` 确实出结果。**以 artifacts 实测为准**。

### 4.3 工作台检查

`node scripts/sync-skills.mjs check`（skill 分发漂移）、`python scripts/check-workspace.py`（工作区结构）。

### 4.4 验证能力的真实天花板

| 想验证 | 能自动做吗 | 用什么 |
|---|---|---|
| 分支组合 / 工作区 | ✅ | `check-workspace.py`、插件 `open` |
| C# 能否编译 | ✅ | 团结引擎 batchmode + 三条日志判据 |
| EditMode 单测 | ✅ | `-runTests -testPlatform EditMode` |
| UIFacade 绑定 | ✅ 离线 | `export_uifacade.py --check --diff`（不启动 Unity） |
| Play Mode / 真机 / 视觉 | ❌ | **无入口** |
| 后端 / 协议 / 结算 | ❌ | 不在本地范围（AGENTS.md 前端边界） |

**V1 不假装有编辑器内的眼睛。** 三条曾被认为可用的线索实测都不成立：`Assets/ThirdPartyLibs/UnityMCP/` 是**空目录**；`GameScripts/Editor/Mcp/*.cs` 是 `[MenuItem]` 带 tag 日志的检查器（`DDOLInspector` 还要求 Play mode，batchmode 跑不了）；只有 `project_wx/Packages/manifest.json` 确实声明了 `com.coplaydev.unity-mcp`——**包依赖在，客户端没接线**。

---

## 5. 边界与安全

| 项 | 决定 |
|---|---|
| 文件访问 | 插件用 `node:fs` 绝对路径，不走 `host.fs`。理由：服务端入口本就是全权 Node，插件天然要碰工作区外路径（编辑器 exe、Hub 目录）；`host.fs` 只强制工作区边界，在这里没有额外保护价值，却让探测逻辑无法用 `createMockHost` 测试（mock 的 `fs` 是惰性桩） |
| 权限声明 | `["tools", "notify"]`。声明即进严格模式，未声明能力被拒 |
| 子进程 | `node:child_process.execFile` 起编辑器，不用 `host.bash`（后者默认 60s 超时，跑不了 EditMode） |
| 凭据 | 由 pi 侧持有（`~/.pi/agent/auth.json` 或环境变量）；插件不碰 |
| 工作区写入 | 只在跑编译门/测试时写 `<SFW>/artifacts/*.log|xml`。其余操作全只读 |

---

## 6. 未决项

1. **品牌层**：`web/index.html` 的 title/favicon/PWA manifest + 包名要改源码。当前未做——先看集成层是否够用。
2. **编辑器内联动（V2）**：要接 mcp-unity 客户端 → 编辑器常驻 → 与 batch EditMode 互斥调度（Assets 被锁）。
3. **终端**：`node-pty` 的安装脚本被 npm allow-scripts 拦下，内置终端当前不可用。需要时 `npm approve-scripts node-pty`。
4. **门控**：A4 目前只做到「面板按钮是显式动作 + 工具自身守卫」。若要在 agent 侧做 planning/executing 硬门控，得看插件 API 是否暴露 `setActiveTools` 等价物。

---

## 7. 落地状态（v0.1，已验证）

| 产物 | 路径 | 状态 |
|---|---|---|
| 集成层 | `package.json` | ✅ pi-web-ui@0.105.1 + pi-coding-agent@^1.2.0，257 包，安装 exit 0 |
| 启动 | `scripts/start.mjs` | ✅ 写死 `PI_WEB_ENGINE=pi`，数据目录落 `.data/` |
| 安装 | `scripts/install-plugin.mjs` | ✅ 官方 CLI 安装成功，9 个文件与源逐字节一致 |
| 插件 | `plugin/` | ✅ manifest + 服务端（646 行）+ 面板（170 行） |
| 契约检查 | `scripts/check-plugin.mjs` | ✅ **25/25 通过** |
| **agentDir 隔离** | `scripts/start.mjs` | ✅ 落 `.pi-agent/`，不读写全局 `~/.pi/agent`；首次一次性导入凭据 |
| **桌面壳** | `desktop/main.cjs` + `scripts/desktop.mjs` | ✅ 实测起窗口，标题「sfw-go — 天天农场开发工作台」 |

**桌面壳实测证据**：Electron 窗口起来（进程 MainWindowTitle 正确）、`/api/health` 返回
`{"ok":true,"engine":"pi","piVersion":"1.2.0"}`、`/plugins/sfw-dev/client/entry.mjs` HTTP 200 6844 字节、
服务端日志 `[plugin:sfw-dev] registered AI tool: sfw_use`。

**桌面壳上踩到的三个坑**（都已修）：
1. **ESM `import { app } from "electron"` 拿不到 API** —— `node_modules/electron/index.js` 在磁盘上导出的是**字符串路径**，命名导出靠 Electron 运行时拦截 `require` 才成立，ESM 静态分析看不到。主进程改用 **CommonJS**。
2. **`ELECTRON_RUN_AS_NODE=1`** —— 环境里有这个变量时 Electron 退化成纯 Node，`app` 为 undefined。`scripts/desktop.mjs` 显式清掉再拉起二进制。
3. **Electron 二进制的安装脚本被 npm allow-scripts 拦下** —— `dist/electron.exe` 缺失（367 MB 没下）。补跑 `node node_modules/electron/install.js`。

**验证证据**（`node scripts/check-plugin.mjs`，对真实 SFW 工作区）：

- `open` → `workspace=dev`（四仓实时分支与 `.workspaces.json` 的 dev 档完全吻合）、`platform=project_wx`、`capabilities=[tests,checks,memory,bindings]`
- `inspect(tests)` → 2 个测试程序集，`AGame.Logic.EditorTests` **655** 个 `[Test]`、`Sfv.UITemplateComposer.Editor.Tests` 32 个
- `capture` 读工作区里**真实的**产物 `artifacts/all-logic-editmode-final-results.xml` → `verdict=passed`、`totals={total:20,passed:20,failed:0}`
- 面板 → 服务端协议：`state` 经 `sendTo` 回包；未知 action 回 `error`
- 客户端 import 面合法（只有 `./sdk/index.mjs`，不越界）

**过程中修掉的三个真问题**：
1. 面板发 `act` 但服务端没有 `act` 分支 → 按钮会拿到「unknown action」。已补。
2. 客户端 SDK 只拷了 `index.mjs`，缺 `client-utils.mjs` → 插件页加载即 `ERR_MODULE_NOT_FOUND`。已补。
3. `host.fs` 在 mock 下是惰性桩（`readText` 回空串）→ 探测逻辑无法测试。改用 `node:fs`。

---

## 8. 与 OhMyGame 的对照

| 维度 | OhMyGame | sfw-go |
|---|---|---|
| 运行时 | 内嵌 Pi 0.99.2 + 私打 patch | 内嵌 Pi 1.2.0（pi-web-ui 运行时解析） |
| 界面 | 自研 Electron + Fastify daemon + React | 复用 pi-web-ui，只加一个插件 |
| 领域工具 | `game_use` 五操作 | `sfw_use` 四操作 |
| 规则承载 | 手写 `promptGuidelines` | 插件 API 原生字段 |
| 升级成本 | pin 旧版 + 313 行 dist 补丁 | 换 `package.json` 版本号 |
| 失败面 | 本机信任，无 OS 沙箱 | 同（插件服务端是全权 Node） |
