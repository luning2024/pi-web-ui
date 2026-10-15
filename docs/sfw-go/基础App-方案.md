# 基础 App 方案（v0.2 · 草案，待评审）

> 状态：**已实施**（2026-10-15）—— 见 §7 落地状态。
> 日期：2026-10-15
> 与旧文档的关系：[SFW-开发Agent-设计方案.md](SFW-开发Agent-设计方案.md) 的 §0–§2（形态决定 + 集成层 + 插件契约）继续有效；
> §3–§8（SFW 领域层）随插件一起**冻结**，等基础 App 站住再回来。

---

## 0. 决定

**sfw-go = desktop + pi-web-ui + pi 的组合 App，不含任何领域代码。**
天天农场面板、`sfw_use` 工具、团结引擎编译门 = 下一阶段的事；现在只冻结，不推进。

理由：基础 App 的成败只取决于一件事 —— **能不能一直零改上游地跟着 pi-web-ui 升级**。
领域代码一进来，兼容性出问题时的归因就变模糊了（是壳的错，还是插件的错？）。
所以先在没有领域代码的状态下把这条路走通。

---

## 1. 现状：基础 App 已经能跑，但有 4 处天天农场耦合

| # | 位置 | 现状 | 后果 |
|---|---|---|---|
| 1 | [scripts/start.mjs:51](scripts/start.mjs#L51) + [:56-59](scripts/start.mjs#L56-L59) | 默认 `--cwd D:\\work-sfw-1`，目录不存在就 `exit 2` | **没有 SFW 检出就打不开这个 App** —— 硬伤 |
| 2 | [scripts/start.mjs:88](scripts/start.mjs#L88) | `PI_WEB_MANAGED=1` | 上游文档原文：该实例的**自更新、装 pi CLI、插件市场安装**都会被服务端拒绝、前端隐藏入口。当初为「公司内部分发」设的，但基础 App 不该默认阉掉上游能力 |
| 3 | `.data/plugins/sfw-dev/`（已安装） | 服务启动即加载领域插件，注册 `sfw_use` | 基础 App 一启动就带着领域逻辑 |
| 4 | [desktop/main.cjs:30-31](desktop/main.cjs#L30-L31)、[package.json:6](package.json#L6)、[README.md:3](README.md#L3) | 应用名 / 窗口标题 / 描述写死「天天农场」 | 定位不清 |

另外 [scripts/start.mjs:82](scripts/start.mjs#L82) 的 `PI_WEB_ENGINE=pi` 是**冗余**的：
上游默认引擎就是 `pi`（`--help` 与 README 一致）。当初写死是因为插件宿主只在 pi 引擎上存在 —— 插件冻结后这行可以删。

---

## 2. v0.2 改什么（3 个文件 + 1 处运行态）

1. [scripts/start.mjs](scripts/start.mjs) —— 删 SFW 默认 cwd 与 `exit 2` 守卫：不传 `--cwd` 就不设 `PI_WEB_CWD`，跟随上游默认（当前目录）；`PI_WEB_MANAGED` 改为默认不开、需要时 `--managed` 显式开。（`PI_WEB_ENGINE=pi` 最后**保留**了，理由见 §7。）
2. [desktop/main.cjs](desktop/main.cjs) —— `APP_NAME` / `WINDOW_TITLE` 去掉「天天农场」，改中性标题。
3. [package.json](package.json#L6) description + [README.md](README.md) —— 定位改成「基础 App」；天天农场那部分移到「冻结层」一节。
4. 运行态 —— 卸掉 `.data/plugins/sfw-dev`（`npm run install-plugin` 随时装回）。

领域层代码 `plugin/`、[scripts/install-plugin.mjs](scripts/install-plugin.mjs)、[scripts/check-plugin.mjs](scripts/check-plugin.mjs) **原地不动**，只是不再在默认路径上。

---

## 3. 「完全兼容」的可验证定义

不是口号，是 4 条能跑出来的检查：

| # | 契约 | 怎么验 |
|---|---|---|
| 1 | 不改上游一个字节 | `npm pack pi-web-ui@<版本>` 解到临时目录，与 `node_modules/pi-web-ui/` 逐文件比对 SHA256（约 20 秒） |
| 2 | 只用官方通道 | 全仓只出现 CLI flags + 官方 `PI_WEB_*` 环境变量 + `<data-dir>/plugins/`；无 monkey-patch、无 dist 改写 |
| 3 | 不阉割上游能力 | 默认不设 `PI_WEB_MANAGED`、不设 `PI_WEB_TABS` 收窄 |
| 4 | 升级 = 改版本号 | 改 `package.json` 里 `pi-web-ui` 版本 → `npm install` → App 起来 |

第 1、2、3 条可以合进一个 `npm run verify:compat`（纯只读）。

---

## 4. 摊开的取舍（我的建议，不是结论）

| 决定 | 选项 | 建议 | 为什么 |
|---|---|---|---|
| 默认工作区 | A 不设，跟随上游 / B 必须显式 `--cwd`，否则报错退出 | **A** | B 只是把 `exit 2` 换个说法，仍然拦住第一次打开 |
| `PI_WEB_MANAGED` | A 删掉 / B 默认关、需要时显式开 | **B** | 内部分发是真需求，但默认必须开满上游能力 |
| 领域层放哪 | A `plugin/` 原地 / B 挪到 `domain/sfw/` | **A** | 挪动是纯搬运，不换来任何东西，还会让 `check-plugin.mjs` 的路径失效 |
| 应用名 | A 保留 `sfw-go` / B 改中性名 | **A** | 改名是独立动作，且牵动 `.pi-agent` / `.data` 路径与桌面快捷方式 |

---

## 5. 验收（改完怎么算过）

1. `npm run desktop` 在**没有** `D:\\work-sfw-1` 的前提下能开窗 —— 用一个无关目录验证。
2. `/api/health` 返回 `{"ok":true,"engine":"pi",...}`，且服务日志里**没有** `[plugin:sfw-dev] registered AI tool: sfw_use` 这一行。
3. `npm run verify:compat` 全绿。
4. `npm run install-plugin && npm run check-plugin` 仍然 **25/25**（领域层没被改坏，随时能装回来）。

---

## 6. 待你决定

1. 第 4 节四个取舍，有要改的吗？
2. `npm run verify:compat` 现在就做（约 60 行脚本），还是先只改代码、验证手工跑？

---

## 7. 落地状态（2026-10-15 实施）

| 改动 | 文件 | 验证 |
|---|---|---|
| 去掉 SFW 默认工作区与 `exit 2` 守卫 | [scripts/start.mjs](scripts/start.mjs) | 不传 `--cwd` 起服务 → `/api/health` 返回 `{"ok":true,"engine":"pi",...}` |
| `PI_WEB_MANAGED` 改 `--managed` 显式开启 | 同上 | 服务日志出现 `[catalog] 插件市场列表预同步完成` —— 插件市场回来了 |
| 应用名 / 窗口标题去天天农场 | [desktop/main.cjs](desktop/main.cjs) | 实测窗口标题 `pi 桌面版`，`GET /` 200 |
| 卸掉领域插件 | `.data/plugins/sfw-dev` | 启动日志不再有 `[plugin:sfw-dev] registered AI tool: sfw_use` |

**零改上游已实测**：`npm pack pi-web-ui@0.105.1` 解出上游 **314** 个文件，与本机 `node_modules/pi-web-ui` 逐文件比 SHA256 —— **0 处不一致、0 处缺失**（本机多出的 1415 个文件是 npm 装进去的嵌套依赖，不在上游包里）。

**两处与草案不同，都记在这里：**

1. **`PI_WEB_ENGINE=pi` 保留了。** 草案说它冗余（上游默认就是 pi）—— 但 [scripts/start.mjs](scripts/start.mjs) 会把整个 `process.env` 透传给子进程，环境里若已有 `PI_WEB_ENGINE=dsh`，这个 App 就变成 dsh 引擎了。它的定位就是 pi 桌面版，所以显式写死。要换引擎改这一行。
2. **草案没写、实施时发现的缺陷已修。** [desktop/main.cjs](desktop/main.cjs) 用 `process.execPath` 拉子进程 —— 在 Electron 里那是 `electron.exe`，于是服务被当成**第二个 Electron 应用**起来，跟主进程抢同一个 userData 缓存目录（stderr 报 `disk_cache ... 拒绝访问 (0x5)`）。加 `ELECTRON_RUN_AS_NODE: "1"` 让它以纯 Node 跑，报错消失。

**顺手清掉的**：一个从 2026-10-14 19:41 一直挂着的旧实例（旧品牌窗口，占着 8899 端口）。

**这次没做的**：§3 的 `npm run verify:compat` 还没写 —— 只做第一步。

---

## 8. 形态改判：宿主改用上游桌面版（2026-10-15 · 方案 B）

§0 当初「不必 fork pi-web-ui」的判断仍然成立，但漏了一件事实：**上游自己就发布桌面安装包**。

`pi-web-ui` v0.105.1 的 GitHub Release 里：

| 资产 | 大小 |
|---|---|
| `pi-web-ui-desktop-0.105.1-setup.exe`（NSIS，带 electron-updater） | 139.7 MB |
| `pi-web-ui-desktop-0.105.1-portable.zip`（内含 PortableGit 397 MB） | 351.5 MB |
| `.dmg` / `-mac.zip` / `AppImage` | 152–165 MB |

它的 `desktop/main.ts` 与我们写的 `desktop/main.cjs` 是同一套 sidecar 思路，但多出：随机空闲口、便携模式（Electron 缓存 / WebUI 数据 / agent 凭据 / 会话 / git 配置全落 `data/`）、electron-updater 自动更新、导航守卫、token 鉴权、健康超时。

**决定**：发布路径 = 上游桌面版；sfw-go 收缩成「插件 + 配置」层。自建壳降级为开发对照，不删。

### 实测（便携版，2026-10-15）

| 检查 | 结果 |
|---|---|
| 启动 | 窗口 `pi-web-ui — pi 编码智能体`，随机端口 58100，`/api/health` → `{"ok":true,"engine":"pi"}` |
| 数据隔离 | 全落 `<便携根>/data/`：`agent` `web` `electron` `workspace` `git` `home`；宿主 `~/.pi-web`、`~/.pi/agent` 未被碰 |
| 内置 PortableGit | `runtime/git/cmd/git.exe` + `bin/bash.exe` 在位（397 MB）—— 目标机不需要装 Git |
| 装插件 | `node scripts/install-plugin.mjs --portable <根>` → exit 0，落到 `data/web/plugins/sfw-dev/` |
| 插件真的加载 | 挂 WS 客户端发 `{"type":"hello"}` 触发 attach 后，日志出现 `[plugin:sfw-dev] registered AI tool: sfw_use` 与 `activated (v0.1.0)`；客户端收到 `plugins` 消息含 `sfw-dev`、`hasClient: true` |

### 两条踩到的

1. **插件不是启动即加载**，是客户端 attach 时才激活（`dist/server/index.js:2259` → `pluginMgr.ensureLoaded`）。只起服务不开客户端，日志里永远没有 `[plugin:sfw-dev]`。
2. **别把便携版解压进本仓库**。Node 的模块向上查找会串到 `sfw-go/node_modules`：`piSdkCopies` 里仓库的 1.2.0 排在自带的 1.1.0 前面，服务端选了 1.2.0。放仓库外。

### 本仓相应改动

- [scripts/install-plugin.mjs](scripts/install-plugin.mjs) 加 `--portable <根目录>`：数据目录取 `<根>/data/web`，CLI 用便携版自带的那个（版本天然一致）。
- [README.md](README.md) 重写：宿主安装在前，本地壳降为「开发对照」。
- 自建壳（`desktop/` + `start.mjs` + `desktop.mjs` + `make-icon.mjs`）**保留**：它是唯一「从仓库一条命令起真实宿主」的路径，改插件时有用，0 维护成本。要删说一声 —— 注意这个目录没进 git，删了没有历史可回。

---

## 9. 品牌包（2026-10-15 实施）

B 的代价是「产物是上游的品牌」。补上：从源码检出打一个自己的 `pi-desktop`。

### 实测

| 步骤 | 结果 |
|---|---|
| `git clone --depth 1` | 31 MB，11 秒 |
| `npm ci` | 889 包，841 MB，exit 0，1 分 9 秒 |
| `npm run desktop:dist`（首次验证） | exit 0，约 5.5 分钟 |
| `node scripts/build-branded.mjs --repo <检出>` | exit 0，约 3 分钟，产物 `release/pi-desktop-0.105.1-setup.exe` 139.80 MB |
| 装出来的应用 | 窗口标题 `pi 桌面版`、`/api/health` ok、数据落 `%APPDATA%\pi-desktop\data`、无 `app-update.yml` |

npm 的 allow-scripts 拦了 6 个包的安装脚本（cpu-features / electron-winstaller / esbuild / protobufjs / ssh2 / @google/genai）—— **没挡住构建**：esbuild 走平台包、node-pty 走预编译。

### 品牌改动面（27 个文件，全在 [branding/pi-desktop-brand.patch](branding/pi-desktop-brand.patch)）

| 文件 | 改什么 |
|---|---|
| `desktop/electron-builder.yml` | `appId` `com.sfwgo.pi-desktop`、`productName` `pi-desktop`、`extraMetadata.name`（决定 userData）、去掉 `publish` 块 |
| `package.json` | 删掉 `repository`（electron-builder 会从它推断更新 feed） |
| `web/index.html` | `<title>` |
| `web/src/i18n.tsx`、`web/src/App.tsx` | 运行时 `document.title`（不改的话窗口标题会被覆盖回 pi-web-ui） |
| `web/src/components/TopBar.tsx`、`BarItem.tsx` | 顶栏品牌块 |
| `web/public/manifest.webmanifest` | name / short_name / description |
| `locales/*.json` ×11 | `docTitle` |
| `web/public/icons/*`、`favicon.svg`、`icon.ico` | 换图标（`scripts/make-brand-assets.mjs` 生成） |

**server 代码一行没动。**

### 三个踩到的

1. **`publish` 不写、`repository` 删掉，都堵不住更新 feed。** electron-builder 会继续从**检出的 git remote** 推断出 `owner: xing-shuyin / repo: pi-web-ui` 写进 `app-update.yml`。留着它，electron-updater 会把应用原地升回官方版、品牌被覆盖。所以 `build-branded.mjs` 打包后删掉该文件；启动日志留一行「开机更新检查失败（不影响使用）」，上游本来就设计了这条失败路径。
2. **窗口标题有两处来源。** `web/index.html` 的 `<title>` 只管首屏；`App.tsx` 的 `useEffect` 会用 `t("docTitle")` 或 `${项目名} — pi-web-ui` 覆盖 `document.title`。两处都要改。
3. **userData 跟的是打包后 package.json 的 `name`，不是 `productName`。** 不设 `extraMetadata.name`，我们的包会和上游桌面版共用 `%APPDATA%\pi-web-ui\data`。

### 升级

`git -C <检出> pull && git -C <检出> apply <本仓>/branding/pi-desktop-brand.patch && node scripts/build-branded.mjs --repo <检出>`

上游 3.18 版/天，不必跟；pin 在某一版，想升再升。
