# sfw-dev：天天农场开发面板

本 fork 的一等公民插件（`plugins/sfw-dev/`）：一个 pi-web-ui 界面面板 + 一个 agent 工具 `sfw_use`。

- **宿主**：本 fork 打出来的桌面版（见 [FORK.md](../../FORK.md)），或任何 pi-web-ui 实例
- **状态**：领域层**冻结中**，只维护不推进。原因与验收见 [基础App-方案.md](基础App-方案.md)

## 装插件

```bash
node scripts/sfw-go/install-plugin.mjs --data-dir <数据目录>
```

`--portable <便携版根目录>` 装进便携版；`--data-dir` 不给就装进本仓 `.pi-web`（已在 .gitignore 里）。
装完刷新界面即生效；没在跑就下次启动生效。

> 插件**不是启动即加载** —— 浏览器 / 窗口 attach 时才激活（服务端 `index.js` 的 `ensureLoaded`）。
> 所以只起服务、不开客户端时，日志里不会出现 `[plugin:sfw-dev]` 行，那是正常的。

## 契约检查

```bash
node scripts/sfw-go/check-plugin.mjs            # 25 项，对真实 SFW 工作区（默认 D:\work-sfw-1）
node scripts/sfw-go/check-plugin.mjs --json
```

用官方 `createMockHost()` 加载插件本体，只跑只读操作（不调 `act`，不会往工作区写产物）。
`plugins/sfw-dev/sdk/` 是上游 plugin SDK 的逐字节副本，所以这条路径不需要 `npm install`。

## 插件做什么

| 区域 | 内容 |
|---|---|
| 状态条 | 工作区 profile（对 `.workspaces.json` 匹配）、平台工程目录、编辑器版本、是否被占用 |
| 分支表 | main / conf / GameScripts / sow-server 的实时分支 + 脏标记 |
| 能力条 | `tests` / `checks` / `memory` / `bindings` —— 由实际探测得出，不是写死的 |
| 编译门 | 团结引擎 batchmode 静态编译，约 1 分钟 |
| EditMode | `project_wx` + `-buildTarget WeixinMiniGame` 跑测试，自动接一次判读 |

agent 工具 `sfw_use` 四个操作（A2 模式）：

| 操作 | 做什么 |
|---|---|
| `open` | 解析工作区：四仓分支、平台目录、编辑器、能力清单 |
| `inspect` | 只读探查：`tests` / `bindings` / `memory` / `docs` / `config` |
| `act` | 执行：`compile` / `editmode-tests` / `checks` / `sync-skills` |
| `capture` | 把测试产物判成结论：verdict / totals / firstFailure / compileErrors |

使用规则跟着工具走（A3 模式）：`promptGuidelines` 里写了「编译通过 ≠ 功能验证」「`-runTests` 不要传 `-quit`」「编辑器开着时 Assets 被锁」等 10 条。

## 目录

```
plugins/sfw-dev/          SFW 插件（唯一手写源）
├─ manifest.json          清单：id / 权限 / 声明式设置
├─ index.mjs              服务端：工作区探测 + 编辑器调度 + 产物判读 + agent 工具
├─ client/entry.mjs       面板视图（纯 DOM，跟随宿主主题）
└─ sdk/                   上游 plugin SDK 的逐字节副本（插件按约定自带）
scripts/sfw-go/
├─ install-plugin.mjs     装进任意数据目录 / 便携版
├─ check-plugin.mjs       契约检查（createMockHost）
└─ make-brand-assets.mjs  生成品牌图标集（零依赖，手写 PNG/ICO）
```

领域层的设计见 [SFW-开发Agent-设计方案.md](SFW-开发Agent-设计方案.md)（§3–§8 讲的就是这一层）。
