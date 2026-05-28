# 开源发布清单 — ai-comic-studio

> 产品中文名：**AI漫剧工坊**  
> 英文仓库名 / npm 包名：**`ai-comic-studio`**

---

## 命名对照

| 用途 | 名称 |
|------|------|
| 中文产品名 | AI漫剧工坊 |
| 英文项目名 | AI Comic Studio |
| GitHub 仓库 | `ai-comic-studio` |
| 建议本地目录 | `ai-comic-studio` |
| `package.json` → `name` | `ai-comic-studio` |
| 数据库文件（默认） | `./data/aicomic.db`（无需为改名而改） |

英文说明（README / GitHub About）：*Open-source workflow for **manju** (漫剧) — AI-generated episodic animated shorts.*

---

## 1. 本地目录改名（可选）

Git **不要求**文件夹名与仓库名一致；为方便记忆可改：

```bash
cd /Users/chenjiewen/Documents/workspace
mv AIComicBuilder ai-comic-studio
cd ai-comic-studio
```

然后在 Cursor / VS Code 中重新打开 `ai-comic-studio` 目录。`.git` 与 `data/`、`uploads/` 会原样保留。

---

## 2. 创建 GitHub 仓库

1. 登录 GitHub → **New repository**
2. **Repository name**：`ai-comic-studio`
3. **Public**
4. **不要**勾选 “Add a README / License”（本地已有）
5. 仓库地址：  
   [https://github.com/neilalexanderlee/ai-comic-studio](https://github.com/neilalexanderlee/ai-comic-studio)

### 远程配置（与 Game 目录相同：GitHub + 本地 git-server）

```bash
cd /path/to/ai-comic-studio

# 若当前 origin 指向本地 bare 仓库，先改名为 local
git remote rename origin local

# GitHub 作为主远程 origin（与 Game 里 origin → github 一致）
git remote add origin https://github.com/neilalexanderlee/ai-comic-studio.git

# 查看
git remote -v
# local   /Users/chenjiewen/git-server/ai-comic-builder.git (fetch/push)
# origin  https://github.com/neilalexanderlee/ai-comic-studio.git (fetch/push)
```

### 首次推送到 GitHub

```bash
git add .
git commit -m "chore: open source as AI漫剧工坊 (ai-comic-studio)"
git push -u origin main
```

可选：同时推送到本地 bare 仓库备份：

```bash
git push local main
```

若 `origin` 曾指向其他 GitHub 仓库，可改 URL 而不改名：

```bash
git remote set-url origin https://github.com/neilalexanderlee/ai-comic-studio.git
```

---

## 3. License（Apache 2.0）

本项目采用 **Apache License 2.0**：

| 文件 | 作用 |
|------|------|
| [LICENSE](../LICENSE) | Apache 2.0 完整法律文本（**请勿删改正文条款**） |
| [NOTICE](../NOTICE) | 版权与上游致谢（**你的署名 + AIComicBuilder 来源**） |

### 为何不用「删掉 LICENSE 自己换一份」？

当前代码在 [AIComicBuilder](https://github.com/twwch/AIComicBuilder)（Apache 2.0）基础上持续演进。作为衍生发行时：

- 应继续遵守 Apache 2.0（保留 LICENSE、声明修改、保留 NOTICE 等）
- 你的贡献版权写在 **NOTICE** 即可
- 若将来几乎完全重写且获得上游明确授权，再考虑换协议（需自行评估）

### 修改版权人

若 NOTICE 中的姓名需调整，编辑 [NOTICE](../NOTICE) 第一段的 `Neil Alexander Lee` 为你的法定姓名或组织名。

---

## 4. README / 发布前检查

- [ ] README 顶部 Demo 链接正确
- [ ] 未提交 `.env`、API Key、`data/*.db` 私密数据（确认 `.gitignore`）
- [ ] `pnpm test` / `npx tsc --noEmit` 通过
- [ ] GitHub 仓库 Description 填写英文一句 + 中文「AI漫剧工坊」

---

## 5. 与上游的关系（建议写在 README）

在 README 中保留简短致谢即可，例如：

> 本项目基于 [AIComicBuilder](https://github.com/twwch/AIComicBuilder)（Apache-2.0）演进，由 **AI漫剧工坊 / ai-comic-studio** 继续维护。

Fork 用户应同时阅读上游与本仓库的 LICENSE、NOTICE。
