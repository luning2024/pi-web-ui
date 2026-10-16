# 这个 fork 是什么

`pi-web-ui` 的 fork，用来产出**我们自己品牌的桌面版**（`pi-desktop` / 「pi 桌面版」）并承载 SFW 开发面板插件。

三个 remote：

| remote | 地址 | 角色 |
|---|---|---|
| `origin` | `git@gitlab.funplus.io:ning.lu2/sfw-go.git` | 本仓库的正式家（公司 GitLab），默认推送目标 |
| `github` | `git@github.com:luning2024/pi-web-ui.git` | GitHub 上的 pi-web-ui fork：**跟上游打交道只走这条路** |
| `upstream` | `https://github.com/xing-shuyin/pi-web-ui.git` | 原始上游（MIT） |

GitHub 的 fork 关系是 GitHub 侧的概念，与本地 remote 怎么命名无关 —— 代码搬到 GitLab 后，`luning2024/pi-web-ui` 依然是 pi-web-ui 的 fork，sync fork / 提 PR 照旧。GitLab 上的 `sfw-go` 只是普通仓库，它不认识 pi-web-ui，所以**同步上游的活儿永远在 `github` / `upstream` 上做**，推代码则推 `origin`。

> GitLab 的 `main` 是 protected branch（禁 force push）。接管空仓库时用的是 `git merge -s ours --allow-unrelated-histories origin/main`，再普通 push。
- 本 fork 相对上游的改动**全是提交**，`git diff upstream/main` 一眼看全

## 改了什么

| 位置 | 改什么 |
|---|---|
| `desktop/electron-builder.yml` | `appId` `com.sfwgo.pi-desktop`、`productName` `pi-desktop`、`extraMetadata.name`（决定 `%APPDATA%\pi-desktop`）、去掉 `publish` 块 |
| `package.json` | 删掉 `repository`（electron-builder 会从它推断上游更新 feed） |
| `web/index.html`、`web/src/i18n.tsx`、`web/src/App.tsx` | 窗口标题。**两处来源都要改**：`<title>` 只管首屏，`useEffect` 里的 `document.title` 随后覆盖 |
| `web/src/components/TopBar.tsx`、`BarItem.tsx` | 顶栏品牌块 |
| `web/public/manifest.webmanifest`、`locales/*.json` ×11 | PWA 名称、`docTitle` |
| `web/public/icons/*`、`favicon.svg`、`icon.ico` | 换图标。重新生成：`node scripts/sfw-go/make-brand-assets.mjs --out-dir web/public` |
| `plugins/sfw-dev/` | SFW 开发面板 + `sfw_use` 工具（新增） |
| `scripts/sfw-go/` | 契约检查、插件安装、图标生成（新增） |
| `docs/sfw-go/` | 本 fork 的设计文档（新增） |

**server 代码一行没动。**

## 出包

```bash
npm ci
npm run desktop:dist        # → release/pi-desktop-<版本>-setup.exe，约 140 MB
```

**`app-update.yml` 是从 `origin` 推断出来的，而 origin 现在是自建 GitLab。** electron-builder 用 `hosted-git-info` 解析 `origin` 的 URL，它**不认自建 GitLab**（实测 `git@gitlab.funplus.io:ning.lu2/sfw-go.git` → `null`）；拿不到仓库信息就不写这个文件 —— 即 **GitLab 时代打出的包里没有 `app-update.yml`，自动更新彻底停用**（比过去更干净，连「检查失败」的日志都不会有）。

打包后一眼验证：

```bash
Test-Path release\win-unpacked\resources\app-update.yml   # 期望 False
```

> 历史：origin 还指着 GitHub 那会儿，推断结果是 `owner: luning2024 / repo: pi-web-ui`，包里带 `app-update.yml`，启动日志会出现一行「开机更新检查失败（不影响使用）」（`No published versions on GitHub`）。
>
> 无论哪条路，**唯一要守住的是 `app-update.yml` 绝不能指向 `xing-shuyin/pi-web-ui`** —— 那会让应用被原地升回官方版、品牌被覆盖。从 `origin` 指向上游的临时克隆打包时，必须删掉它。

## 跟上游

**基线锚点**：`upstream-sync` 支指向「上次同步到的上游提交」；`main` 是 fork 支（上游 + 我们的改动）。
`upstream-sync..upstream/main` 就是上游新增、还没进本 fork 的东西 —— 挑之前先看它。

```bash
git fetch upstream
git log --oneline upstream-sync..upstream/main      # 上游新增了什么
```

同步三选一：

```bash
git cherry-pick <sha>                          # 挑单个修复
git cherry-pick <a>^..<b>                      # 挑一批
git merge --no-commit --no-ff upstream/main    # 先试合，不满意就 git merge --abort
git merge upstream/main                        # 全量跟
```

同步完推进基线：

```bash
git branch -f upstream-sync upstream/main      # 全量跟之后
git branch -f upstream-sync <挑到的上游提交>    # 只挑了一部分：推到你看过的那条
```

> 只挑了一部分却把基线推到 `upstream/main`，没挑的提交就会从候选清单里消失。

冲突只会出在上游也在天天改的那 14 个文件：`locales/*.json` ×11、`web/src/i18n.tsx`、`web/index.html`、`package.json`。
`rerere` 已开，重复的品牌冲突会自动复用解法。

上游 3.18 版/天，不必跟 —— pin 在某一版，想升再升。

## 插件

`plugins/sfw-dev/` 是新增的一等公民插件（和上游那 31 个并列），**不写进 `plugins/catalog.json`**（避免和上游冲突）。装法：

```bash
node scripts/sfw-go/install-plugin.mjs --data-dir <数据目录>
node scripts/sfw-go/check-plugin.mjs        # 25 项契约检查
```

详见 [docs/sfw-go/README.md](docs/sfw-go/README.md)。
