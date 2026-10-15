# sfw-go

天天农场（SFW）开发 agent 的**领域层仓库**：一个 pi-web-ui 界面插件 + 一组 agent 工具。

宿主用上游的 **pi-web-ui 桌面版**（Electron，官方发布）。本仓不改上游一个字节；自建的 Electron 壳只留作开发对照。

- **宿主**：pi-web-ui 桌面版 —— 聊天 / 会话 / 终端 / Git / 文件树 / 插件市场都由它提供
- **本仓**：`plugin/`（SFW 面板 + `sfw_use` 工具）+ 契约检查 + 安装脚本 + 品牌包构建（[§2](#2-品牌包自己打一个pi-桌面版)）
- **状态**：领域层**冻结中**，只维护不推进。原因与验收见 [基础App-方案.md](基础App-方案.md)

## 1. 装宿主

从 [pi-web-ui Releases](https://github.com/xing-shuyin/pi-web-ui/releases/latest) 二选一：

| 用途 | 资产 | 说明 |
|---|---|---|
| **便携自包含** | `pi-web-ui-desktop-<版本>-portable.zip` | 解压后双击 `启动Pi.bat`。数据全落 `<根>/data/`，内置 PortableGit，不碰宿主机 `~/.pi-web` 与 `~/.pi/agent` |
| 常规安装 | `pi-web-ui-desktop-<版本>-setup.exe` | NSIS 安装包，带自动更新；数据落 `%APPDATA%\pi-web-ui-desktop\data` |

**别把便携版解压进本仓库**：Node 的模块向上查找会串到本仓 `node_modules`，把 pi SDK 顶成仓库里的版本（实测 1.1.0 → 1.2.0）。放 `D:\PiWebUI-Portable\` 或 U 盘。

## 2. 品牌包：自己打一个「pi 桌面版」

官方安装包是 `pi-web-ui-desktop` 的品牌。要一个我们自己的（名字 / 图标 / 独立数据目录），从源码检出打：

```bash
git clone --depth 1 https://github.com/xing-shuyin/pi-web-ui.git <检出>
git -C <检出> apply <本仓>/branding/pi-desktop-brand.patch
npm ci --prefix <检出>
node scripts/build-branded.mjs --repo <检出>
```

产物：`<检出>/release/pi-desktop-<版本>-setup.exe`（约 140 MB）。实测：clone 11 秒 / `npm ci` 1 分 9 秒（841 MB）/ 打包约 3 分钟。

品牌改动共 27 个文件，全在 [branding/pi-desktop-brand.patch](branding/pi-desktop-brand.patch)：名称、图标、PWA manifest、11 个语言包的 `docTitle`、打包配置、去掉上游更新 feed。**server 代码一行没动。**

升级 = `git -C <检出> pull && git -C <检出> apply <补丁> && node scripts/build-branded.mjs --repo <检出>`。

三个要知道的：

1. **自动更新是关的。** electron-builder 会从检出的 git remote 推断出上游仓库、写进 `app-update.yml`；留着它应用会被原地升回官方版、品牌被覆盖。配置层堵不住（`publish` 不写、`repository` 删掉都试过，仍从 remote 推断），所以 `build-branded.mjs` 打包后直接删掉它。启动日志会有一行「开机更新检查失败（不影响使用）」—— 预期状态。
2. **产物未签名**，和官方一样。Windows 首启有 SmartScreen「未知发布者」。
3. **数据落 `%APPDATA%\pi-desktop\`**（靠 `extraMetadata.name` 改的），不与上游桌面版共用。agent 配置仍走 `~/.pi/agent`（上游桌面版的设计如此）；要彻底隔离就用便携版 + `PI_CODING_AGENT_DIR`。
## 3. 装插件

```bash
node scripts/install-plugin.mjs --portable D:\PiWebUI-Portable
```

`--portable` 指向便携版根目录（含 `app/` 与 `data/`），脚本用便携版自带的 CLI 装进 `<根>/data/web/plugins/sfw-dev/`。
安装版或任意数据目录用 `--data-dir <路径>`。装完刷新界面即生效；没在跑就下次启动生效。

> 插件**不是启动即加载** —— 浏览器 / 窗口 attach 时才激活（服务端 `index.js` 的 `ensureLoaded`）。
> 所以只起服务、不开客户端时，日志里不会出现 `[plugin:sfw-dev]` 行，那是正常的。

## 4. 契约检查

```bash
npm run check-plugin              # 25 项，对真实 SFW 工作区（默认 D:\work-sfw-1）
npm run check-plugin -- --json
```

用官方 `createMockHost()` 加载插件本体，只跑只读操作（不调 `act`，不会往工作区写产物）。
`plugin/sdk/` 是上游 plugin SDK 的逐字节副本，所以这条路径不需要 `npm install`。

## 5. 本地壳（开发对照，不参与发布）

```bash
npm install
npm run desktop                    # 从本仓起一个 pi-web-ui 实例，数据落 .data/
node scripts/install-plugin.mjs    # 把 plugin/ 装进 .data/
```

`desktop/main.cjs` 是个薄 Electron 壳（起服务 → 等端口 → 开窗）。改插件时用它快速起一个真实宿主；发布路径是上游桌面版，不是它。

## 6. 插件做什么

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

## 7. 目录

```
plugin/                  SFW 插件（唯一手写源）
├─ manifest.json         清单：id / 权限 / 声明式设置
├─ index.mjs             服务端：工作区探测 + 编辑器调度 + 产物判读 + agent 工具
├─ client/entry.mjs      面板视图（纯 DOM，跟随宿主主题）
└─ sdk/                  上游 plugin SDK 的逐字节副本（插件按约定自带）
desktop/                 本地壳（开发对照）
branding/
└─ pi-desktop-brand.patch  品牌改动（27 个文件，git apply 即用）
scripts/
├─ install-plugin.mjs    装进便携版 / 安装版 / 任意数据目录
├─ check-plugin.mjs      契约检查（createMockHost）
├─ build-branded.mjs     从 pi-web-ui 检出打品牌安装包
├─ make-brand-assets.mjs 生成品牌图标集（零依赖，手写 PNG/ICO）
├─ start.mjs             本地壳：起服务
├─ desktop.mjs           本地壳：拉起 Electron
└─ make-icon.mjs         生成 desktop/icon.png
.data/ .pi-agent/        本地壳的数据与 pi 配置（gitignored）
```

领域层的设计见 [SFW-开发Agent-设计方案.md](SFW-开发Agent-设计方案.md)（§3–§8 讲的就是这一层）。
