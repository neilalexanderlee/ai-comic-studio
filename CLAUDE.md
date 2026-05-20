# AIComicBuilder — Claude 开发指南

> 本文件是面向 AI 助手（Claude）的项目级开发指南。
> 每次开始任务前请先读本文件，所有改动必须符合此处记录的约定。

---

## 项目概述

AIComicBuilder 是一个基于 AI 的漫画/短剧分镜生成工具。用户可以：
1. 创建项目 → 编写剧情大纲和剧本
2. 将剧本解析为分镜版本（storyboard versions）
3. 为每个分镜生成首帧/尾帧（keyframe 模式）或参考帧（reference 模式）
4. 用帧驱动视频生成（Seedance / Kling / Jimeng / Veo 等）
5. 将视频合并为完整剧集

---

## 技术栈

| 层 | 技术 |
|---|---|
| 前端框架 | Next.js 15 (App Router, Turbopack) |
| 语言 | TypeScript (strict) |
| 样式 | Tailwind CSS |
| 数据库 | SQLite via better-sqlite3 |
| ORM | Drizzle ORM |
| 状态管理 | Zustand |
| AI SDK | `ai` (Vercel AI SDK), `@ai-sdk/openai`, `@ai-sdk/google` |
| i18n | next-intl |
| 测试 | Vitest |

---

## 目录结构

```
AIComicBuilder/
├── CLAUDE.md                  # ← 本文件
├── docs/
│   ├── ARCHITECTURE.md        # 系统架构详解
│   └── EVAL.md                # Eval 框架说明
├── drizzle/                   # SQL migration 文件
│   └── meta/_journal.json     # Migration 注册表（必须与 .sql 文件同步更新）
├── src/
│   ├── app/
│   │   ├── api/               # Next.js Route Handlers (Server)
│   │   │   └── projects/[id]/
│   │   │       ├── generate/route.ts   # 核心生成入口（SSE 流式输出）
│   │   │       ├── episodes/           # 剧集 CRUD
│   │   │       └── ...
│   │   └── [locale]/          # 国际化页面
│   ├── lib/
│   │   ├── ai/
│   │   │   ├── types.ts               # AIProvider / VideoProvider 接口
│   │   │   ├── provider-factory.ts    # 按 protocol 字符串创建 provider 实例
│   │   │   ├── character-router.ts    # 角色图片路由（智能状态选择）
│   │   │   ├── prompt-enhancer.ts     # 模型感知 prompt 增强
│   │   │   ├── prompts/               # Prompt 构建函数 + 注册表
│   │   │   └── providers/             # 各模型实现（openai/gemini/kling/seedance/jimeng/...）
│   │   ├── db/
│   │   │   ├── schema.ts              # Drizzle 表定义（单一事实来源）
│   │   │   └── index.ts               # DB 实例 + idempotent migration runner
│   │   ├── storyboard/                # 分镜工具函数
│   │   └── bootstrap.ts              # 启动序列（migrations → providers → worker）
│   ├── stores/                # Zustand 客户端状态
│   │   ├── project-store.ts
│   │   ├── episode-store.ts
│   │   └── model-store.ts
│   └── __tests__/
│       ├── setup.ts
│       ├── unit/              # 纯函数单元测试
│       └── integration/       # API 集成测试
└── src/lib/evals/             # AI Eval 评估框架
```

---

## AI Provider 系统

### Protocol 字符串

每个 AI 能力由一个 `protocol` 字符串标识。这是整个 provider 系统的 key。

| Protocol | 模型 | 用途 |
|---|---|---|
| `openai` | GPT-4o / DALL-E / 兼容接口 | 文本 + 图片 |
| `gemini` | Gemini / Veo | 文本 + 图片 + 视频 |
| `doubao` | Seedream（火山方舟 ARK API） | 图片 |
| `jimeng` | 即梦 AI | 图片 |
| `jimeng-video` | 即梦 AI | 视频 |
| `kling` | 可灵 | 图片 + 视频 |
| `seedance` | Seedance（火山方舟 ARK API） | 视频 |

**规则**：`provider-factory.ts` 的 switch-case 是增加新 provider 的唯一入口。`prompt-enhancer.ts` 必须为新 protocol 同步添加对应的 system prompt。

### 三种 Provider

```typescript
AIProvider       // generateText + generateImage
VideoProvider    // generateVideo
```

`resolveAIProvider` / `resolveImageProvider` / `resolveVideoProvider`（在 `provider-factory.ts`）从请求体中的 `modelConfig` 读取配置，用户未配置时 fallback 到 `getAIProvider()` 全局默认。

---

## 数据库规范

### 迁移流程（必须严格遵守）

1. 在 `src/lib/db/schema.ts` 添加字段
2. 在 `drizzle/` 创建 `NNNN_<描述>.sql`（仅写增量 DDL）
3. 在 `drizzle/meta/_journal.json` 添加对应条目（idx 递增，when 递增）
4. 不需要手动运行迁移 — `bootstrap()` 在启动时自动执行

**Boolean 列**：统一用 `integer("col_name").notNull().default(0)`（0/1），不用 SQLite 的 BOOLEAN。

**当前最新迁移索引**：`idx 27` — `0027_add_enhance_prompts`

### 关键表

| 表 | 说明 |
|---|---|
| `projects` | 顶层实体，含 `visualStyle`、`generationMode`、`enhancePrompts`、`useProjectPrompts` |
| `episodes` | 分属 project 的剧集，含 `generationMode`（可覆盖 project 级） |
| `storyboard_versions` | 分镜版本，每个版本对应一批 shots |
| `shots` | 单个分镜，含所有帧/视频 URL 字段 |
| `characters` | 项目/剧集角色，含 `visualHint`、`voiceHint` |
| `character_assets` | 角色图片（morph/blueprint 类型，带 tag 状态标签） |
| `episode_characters` | 多对多：角色参与哪些剧集 |

---

## 核心约定（必须遵守）

### 1. filterShotCharacters — 绝不 fallback 到全量角色

```typescript
// ✅ 正确：无匹配时传空列表
const charsForFrame = filterShotCharacters(shotText, projectCharacters);

// ❌ 错误：无匹配时 fallback 到所有角色（群演场景会注入无关角色图）
const charsForFrame = shotCharacters.length > 0 ? shotCharacters : projectCharacters;
```

`filterShotCharacters` 在 shot 文本里找不到角色名时返回 `[]`，这是正确行为。调用方不得覆盖这个结果。

### 2. episodeId — 始终优先用 URL 参数

```typescript
// ✅ 正确
const episodeId = urlEpisodeId || useProjectStore.getState().currentEpisodeId;

// ❌ 错误：Zustand store 在首次渲染时可能未水合（null）
const episodeId = useProjectStore.getState().currentEpisodeId;
```

Zustand store 的 `currentEpisodeId` 在客户端水合前是 `null`。任何需要 episodeId 的操作（版本创建/删除、分镜生成）必须先读 `useParams()` 里的 `urlEpisodeId`。

### 3. visualStyleTag — 必须流经所有生成路径

所有帧和视频的生成调用都必须传 `visualStyleTag`。获取方式：

```typescript
import { VISUAL_STYLE_PRESETS } from "@/lib/ai/prompts/presets";
const visualStyleTag = VISUAL_STYLE_PRESETS[project.visualStyle]?.tag ?? "";
```

新增生成路径必须检查：`buildFirstFramePrompt`、`buildLastFramePrompt`、`buildVideoPrompt`、`buildReferenceVideoPrompt` 都有 `visualStyleTag` 参数，必须传入。

### 4. enhancePrompts — 存 DB，不存 localStorage

`projects.enhance_prompts` 字段（integer，默认 1）控制是否在生成前调用 `enhanceImagePrompt` / `enhanceVideoPrompt`。通过 `PATCH /api/projects/:id` 持久化，不使用 localStorage。

### 5. SSE 流式生成 — loopCtx 模式

生成路由使用 `ReadableStream` 做 SSE。循环变量必须通过 `loopCtx` 对象在 `start()` 回调中捕获，不能直接在 `start` 外闭包引用会在异步过程中变化的变量。

### 6. handleCharacterExtract — 必须传入 visualStyle

`handleCharacterExtract` 必须总是先查项目的 `visualStyle`，再用 `buildCharacterExtractSystemPrompt(visualStyle)` 构建 system prompt。不得用 `resolvePrompt("character_extract", ...)` 替代，因为 `resolvePrompt` 不注入 visualStyle，会导致输出写实风格而非项目设定的画风。

```typescript
// ✅ 正确
const [proj] = await db.select({ visualStyle: projects.visualStyle }).from(projects)...;
const charExtractSystem = buildCharacterExtractSystemPrompt(proj?.visualStyle || "anime_2d");

// ❌ 错误：resolvePrompt 不注入 visualStyle
const charExtractSystem = await resolvePrompt("character_extract", { userId, projectId });
```

### 7. Drizzle null 比较

```typescript
// ✅ 正确：用 isNull() / isNotNull()
where(isNull(storyboardVersions.episodeId))

// ❌ 错误：eq() 对 null 值返回 false（SQL NULL != NULL）
where(eq(storyboardVersions.episodeId, null))
```

---

## AI Prompt 增强系统

`src/lib/ai/prompt-enhancer.ts` 提供按 protocol 定制的 prompt 改写：

- `enhanceVideoPrompt(rawPrompt, protocol, textProvider)` — 视频 prompt
- `enhanceImagePrompt(rawPrompt, protocol, textProvider)` — 图片帧 prompt

每个 protocol 对应专属的 system prompt（如 Seedance 五段式、Kling 四要素、DALL-E 英文格式等）。新增 provider 时必须在对应的 `VIDEO_ENHANCE_SYSTEM_PROMPTS` 或 `IMAGE_ENHANCE_SYSTEM_PROMPTS` map 里添加条目。增强失败时静默回退到原始 prompt，不阻塞生成。

---

## 测试规范

详见 `docs/EVAL.md` 和 `src/__tests__/`。

### 快速运行

```bash
pnpm test              # 运行所有单测
pnpm test:watch        # 监听模式
pnpm test:integration  # API 集成测试（需要测试 DB）
pnpm eval              # 运行 AI Eval 评估（需要真实 API Key）
```

### 测试文件位置

- 单元测试：`src/__tests__/unit/`，与被测文件路径对应
- 集成测试：`src/__tests__/integration/`
- Eval 用例：`src/lib/evals/cases/`

---

## 已知陷阱 / 历史修复记录

| 问题 | 根因 | 修复位置 |
|---|---|---|
| 删版本后刷新 v4 消失 | `currentEpisodeId` 水合为 null，版本建为 `episodeId=null` | storyboard page：用 `urlEpisodeId` |
| 版本 DELETE 返回 404 | `eq(episodeId, null)` 匹配不到孤儿版本 | version DELETE route：移除 episodeId 过滤 |
| 群演场景注入全部角色图 | `filterShotCharacters` 无匹配时 fallback 到全量 | `generate/route.ts` + `filterShotCharacters`：移除 fallback |
| `enhance_prompts` column 缺失 | schema 先于 migration 被 Drizzle 读取 | migration 0027 + Python 直接 ALTER |
| 视频生成跳过 visualStyleTag | 生成路径未传参数 | 各 handler 全面审计 |
| 角色解析后变成写实风 | `handleCharacterExtract` 用 `resolvePrompt` 未传 visualStyle | `generate/route.ts` 改用 `buildCharacterExtractSystemPrompt(visualStyle)` |
| 尾帧人物与定妆图不符 | 尾帧 prompt 未明确角色设定图优先于首帧 | `registry.ts` `LAST_FRAME_RELATIONSHIP_TO_FIRST` + `LAST_FRAME_RENDERING_QUALITY` |
| PPT割裂感（群演→主角切换） | 强制继承上一镜头尾帧导致首帧图像错误 | 智能链式中断：`isCrowdToCharacterCut` 检测，独立生成首帧 |

---

## 开发工作流

```
# 1. 修改 DB schema
vim src/lib/db/schema.ts
# 同步创建 drizzle/NNNN_xxx.sql + 更新 _journal.json

# 2. 类型检查（提交前必做）
npx tsc --noEmit

# 3. 运行测试
pnpm test

# 4. 开发服务器（Turbopack）
pnpm dev
```

**热重载注意**：dev 模式下改 schema 后，第一次请求会触发 migration。若报 `no such column`，说明迁移文件未正确注册，检查 `_journal.json`。

---

## 新功能开发检查清单

- [ ] schema 改动有对应 migration 文件
- [ ] 新 AI provider 有对应 prompt enhancer 条目
- [ ] 新生成路径传入了 `visualStyleTag`
- [ ] 新生成路径正确使用 `filterShotCharacters`（无 fallback）
- [ ] 客户端 episodeId 来自 `urlEpisodeId`，非 store
- [ ] 持久化偏好存 DB，非 localStorage
- [ ] `npx tsc --noEmit` 无报错
- [ ] 关键函数有对应单测
