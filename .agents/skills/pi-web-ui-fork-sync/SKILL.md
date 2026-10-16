---
name: pi-web-ui-fork-sync
description: >-
  把上游 pi-web-ui 的新提交同步进 sfw-go fork：列出候选、挑单个 cherry-pick 或全量
  merge、推进 upstream-sync 基线、推 GitLab + GitHub。Use when the user asks to
  同步上游 / 跟上游 / 拉上游提交 / sync upstream / merge upstream commits, or
  mentions upstream-sync、sfw-go、pi-desktop fork 维护。
---

# pi-web-ui fork 上游同步

`D:\pi-web-ui` 是 `xing-shuyin/pi-web-ui` 的 fork（品牌化 pi-desktop + SFW 插件）。
**动手前先读仓库根的 `FORK.md`** —— 它是这个 fork 的唯一事实源，本 skill 只是把它的「跟上游」节变成可执行步骤。

## 三个 remote（别搞混）

| remote | 地址 | 角色 |
|---|---|---|
| `origin` | `git@gitlab.funplus.io:ning.lu2/sfw-go.git` | 正式家，**推代码推这里** |
| `github` | `git@github.com:luning2024/pi-web-ui.git` | GitHub 上的 fork，**跟上游打交道走这条** |
| `upstream` | `https://github.com/xing-shuyin/pi-web-ui.git` | 原始上游，只读 |

## 核心概念：`upstream-sync` 基线

`upstream-sync` 支指向「上次同步到的上游提交」。它就是「上游有什么新的」的答案：

```bash
git fetch upstream
git log --oneline upstream-sync..upstream/main    # 候选：上游有、我们没有
git log --oneline upstream-sync..main             # 我们自己的全部改动
```

## 标准流程

1. **体检**：跑上面两条 log，把候选清单给用户看，**不要自己决定挑哪些**
2. **同步**（三选一）：
   ```bash
   git cherry-pick <sha>                        # 挑单个修复
   git cherry-pick <a>^..<b>                    # 挑一批
   git merge upstream/main                      # 全量跟
   ```
   撞冲突先看是不是那 14 个品牌文件；**不自动解决**，`git merge --abort` 退回去问用户
3. **推进基线**：
   ```bash
   git branch -f upstream-sync upstream/main    # 全量 merge 之后
   git branch -f upstream-sync <挑到的上游提交>  # 只挑了一部分：推到你看过的那条
   ```
4. **推送**（先 `git status -sb` 确认干净）：
   ```bash
   git push origin main && git push github main
   git push origin upstream-sync
   ```

## 硬规矩

- **只挑了一部分、却把 `upstream-sync` 推到 `upstream/main`** = 没挑的提交从候选清单消失。这是这套机制唯一的坑
- **绝不往 GitHub 推 tag**：`desktop-release` / `extension-release` / `release-notes` 全是 `on: push: tags: v*`，推 78 个 tag = 234 次 workflow + 78 个 Release
- **GitLab 的 `main` 是 protected branch**，禁 force push
- **`server/` 一行不要动**（fork 只该有「品牌层」和「新增目录」两类改动），否则每次 `git merge upstream/main` 都多一处冲突

## 冲突面

上游也在天天改的只有这 14 个文件：`locales/*.json` ×11、`web/src/i18n.tsx`、`web/index.html`、`package.json`。
其余 27 个（新增目录 + 图标）上游永远不碰。`rerere` 已开，重复的品牌冲突会自动复用解法。

## 收尾

```bash
git log --oneline upstream-sync..upstream/main   # 应为空，或只剩故意没挑的
git status -sb                                    # 应无 ahead / behind
```

改完走根 `AGENTS.md` 的提交前三连验：`npm run format:check && npm run lint && npm run typecheck`。
（GitLab 上不配 CI，这三条就是唯一闸门。）