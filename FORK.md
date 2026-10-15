# 这个 fork 是什么

`pi-web-ui` 的 fork，用来产出**我们自己品牌的桌面版**（`pi-desktop` / 「pi 桌面版」）并承载 SFW 开发面板插件。

- `origin` = 我们的 fork：https://github.com/luning2024/pi-web-ui
- `upstream` = 上游：https://github.com/xing-shuyin/pi-web-ui（MIT）
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

**不要删 `app-update.yml`。** electron-builder 会从 `origin` 推断出仓库写进它 —— 在本 fork 里那指向**我们自己**（`owner: luning2024 / repo: pi-web-ui`），这正是想要的：自动更新只认我们自己的 release，不会把应用升回官方版。

只要 fork 上还没有 release，启动日志就会有一行「开机更新检查失败（不影响使用）」（`No published versions on GitHub`）—— 预期状态。想在 fork 上发版，照上游的 `.github/workflows/desktop-release.yml` 打 tag 即可。

> 反过来：从一份 `origin` 指向**上游**的检出打包（临时克隆那种），`app-update.yml` 会指向 `xing-shuyin/pi-web-ui` —— 那种情况下**必须删掉它**，否则应用会被原地升回官方版、品牌被覆盖。

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
