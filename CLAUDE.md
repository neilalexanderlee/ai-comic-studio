# AI漫剧工坊 — Claude 开发指南

> 本文件是面向 AI 助手（Claude）的项目级开发指南。
> 每次开始任务前请先读本文件，所有改动必须符合此处记录的约定。

---

## 沟通语言约定

**所有回复必须使用中文。** 无论用户用什么语言提问，Claude 的回复一律用中文。代码注释和代码本身保持原有风格（英文或中文均可），但解释、分析、提问、确认等文字部分全部用中文。

---

## 项目概述

AI漫剧工坊（英文 **AI Comic Studio**，仓库名 `ai-comic-studio`）是一个基于 AI 的漫剧/短剧分镜生成工具。用户可以：
1. 创建项目 → 编写剧情大纲和剧本
2. 将剧本解析为分镜版本（storyboard versions），含结构化字段（startFrameDesc / endFrameDesc / motionScript / 朝向 / 台词类型等）
3. 为每个分镜生成首帧/尾帧（三段式 Toonflow 提示词 + @图N 角色绑定）
4. Seedance 多参模式批量生成连贯视频（@参考N 编号 + 音色克隆 + Track 分组）
5. 浏览器端视频编辑器（时间线 + 字幕 + BGM + 转场 + 导出 WebM）
6. 将视频合并为完整剧集（ffmpeg 拼接）

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
ai-comic-studio/   # 本地目录建议名；历史亦可能为 AIComicBuilder
├── CLAUDE.md                  # ← 本文件
├── docs/
│   ├── ARCHITECTURE.md        # 系统架构详解
│   ├── EVAL.md                # Eval 框架说明
│   └── APIs/                  # 火山方舟/Kling 官方 API PDF 文档
├── drizzle/                   # SQL migration 文件
│   └── meta/_journal.json     # Migration 注册表（必须与 .sql 文件同步更新）
├── src/
│   ├── app/
│   │   ├── api/               # Next.js Route Handlers (Server)
│   │   │   └── projects/[id]/
│   │   │       ├── generate/route.ts   # 核心生成入口（SSE 流式输出）
│   │   │       ├── import/split/       # 导入时自动分集
│   │   │       ├── episodes/           # 剧集 CRUD
│   │   │       └── ...
│   │   └── [locale]/          # 国际化页面
│   ├── lib/
│   │   ├── ai/
│   │   │   ├── types.ts               # AIProvider / VideoProvider 接口
│   │   │   ├── provider-factory.ts    # 按 protocol 字符串创建 provider 实例
│   │   │   ├── character-router.ts    # 角色图片路由（智能状态选择）
│   │   │   ├── prompt-enhancer.ts     # 模型感知 prompt 增强
│   │   │   └── prompts/               # Prompt 构建函数 + 注册表
│   │   │       ├── art-styles/        # ★ 美术风格约束库（Toonflow 移植）
│   │   │       │   ├── index.ts       #   getArtStylePrompt(style, type) 加载器
│   │   │       │   ├── anime_2d/      #   prefix / character / scene / storyboard / video
│   │   │       │   ├── realistic/
│   │   │       │   ├── cg_3d/
│   │   │       │   ├── chinese_ink/
│   │   │       │   ├── western_cartoon/
│   │   │       │   └── storyboard-techniques.md  # 通用分镜技法（Toonflow 移植）
│   │   │       ├── storyboard-image.ts  # ★ buildStoryboardImagePrompt()（三段式 + @图N）
│   │   │       ├── seedance-multi-param.ts  # ★ buildSeedanceMultiParamVideoPrompt()
│   │   │       ├── frame-generate.ts    # buildFirstFramePrompt / buildLastFramePrompt
│   │   │       ├── outline-expand-defaults.ts  # 大纲扩写（含 videoDesc 输出规范）
│   │   │       ├── storyboard-supervision.ts  # ★ 分镜督导 Agent（七律视觉连续性审核）
│   │   │       └── ...
│   │   ├── db/
│   │   │   ├── schema.ts              # Drizzle 表定义（单一事实来源，最新 idx=46）
│   │   │   └── index.ts               # DB 实例 + idempotent migration runner
│   │   ├── storyboard/                # 分镜工具函数
│   │   │   ├── frame-generation-strategy.ts  # 智能帧生成策略（三层决策）
│   │   │   ├── video-desc.ts          # ★ buildVideoDesc()（10维 videoDesc 组装）
│   │   │   ├── track-grouping.ts      # ★ groupShotsIntoTracks()（≤15s 分组）
│   │   │   ├── shot-video-prompt-sync.server.ts  # ★ buildDirectVideoPrompt / syncVideoPromptIfStale（直出架构）
│   │   │   ├── shot-supervision.ts    # superviseShots()（单镜6红线校验 + LLM judge，generate 路由内部调用）
│   │   │   ├── detect-structured-storyboard.ts
│   │   │   ├── extract-shot-script.ts
│   │   │   └── complete-extracted-shots.ts
│   │   └── bootstrap.ts              # 启动序列（migrations → providers → worker）
│   ├── components/editor/
│   │   └── video-editor/              # ★ 浏览器端视频编辑器
│   │       ├── hooks/useEditorStore.ts  # Zustand 轨道/Clip/播放状态
│   │       ├── Timeline.tsx           # 时间线组件（拖拽 + 刻度尺 + 播放头）
│   │       ├── MediaLibrary.tsx       # 左侧素材库
│   │       ├── VideoPreview.tsx       # Canvas 预览 + 导出
│   │       ├── PropertyPanel.tsx      # 右侧属性编辑
│   │       └── utils/                 # 转场/滤镜/轨道工具（Toonflow 移植）
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

**当前最新迁移索引**：`idx 46` — `0046_drop_scenes`

### 关键表

| 表 | 说明 |
|---|---|
| `projects` | 顶层实体，含 `visualStyle`、`enhancePrompts`、`linkShotsViaCutPoint`、`useProjectPrompts` |
| `episodes` | 分属 project 的剧集 |
| `storyboard_versions` | 分镜版本，每个版本对应一批 shots |
| `shots` | 单个分镜；帧字段：`anchorFirst`、`anchorLastAi`、`cutPoint`；`track`（`emotion`/`framing`/`lightingAtm`/`sceneId` 已全部移除） |
| `dialogues` | 台词；`type`（'dialogue'\|'os'\|'vo'）|
| `characters` | 项目/剧集角色，含 `visualHint`、`voiceHint`（9维音色描述）|
| `character_assets` | 角色图片/音频；`audioPath`（音色参考，用于 Seedance 音色克隆）|
| `episode_characters` | 多对多：角色参与哪些剧集 |

**已移除的表**：`scenes`（migration 0046）、`scene_variants`（migration 0045）。场景功能整体废弃，`shots.scene_id` 字段同步移除。

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

`projects.enhance_prompts` 字段（integer，默认 1）对应 UI 上的「AI 增强」开关，控制两件事：
1. 生成图片/视频前调用 `enhanceImagePrompt` / `enhanceVideoPrompt` 进行 prompt 改写
2. 帧生成策略（`resolveFrameMode`）中启用 LLM 语义判断（关闭时仅走确定性规则）

通过 `PATCH /api/projects/:id` 持久化，不使用 localStorage。

### 5. SSE 流式生成 — loopCtx 模式

生成路由使用 `ReadableStream` 做 SSE。循环变量必须通过 `loopCtx` 对象在 `start()` 回调中捕获，不能直接在 `start` 外闭包引用会在异步过程中变化的变量。

### 6. handleCharacterExtract — 必须传入 visualStyle

`handleCharacterExtract` 必须总是先查项目的 `visualStyle`，再用 `resolveCharacterExtractSystemPrompt(visualStyle, { userId, projectId })` 构建 system prompt。该函数在 `resolvePrompt("character_extract")` 之后**仍会把** `{STYLE_INSTRUCTION}` 替换为项目画风（不得单独 `resolvePrompt` 而跳过 visualStyle 注入）。

```typescript
// ✅ 正确
const [proj] = await db.select({ visualStyle: projects.visualStyle }).from(projects)...;
const charExtractSystem = await resolveCharacterExtractSystemPrompt(
  proj?.visualStyle || "anime_2d",
  { userId, projectId }
);

// ❌ 错误：裸 resolvePrompt 不注入 visualStyle
const charExtractSystem = await resolvePrompt("character_extract", { userId, projectId });
```

### 7. 帧生成策略 — resolveFrameMode

`src/lib/storyboard/frame-generation-strategy.ts` 决定每个分镜生成「首帧+尾帧」还是「仅首帧」。

**三层决策（按顺序）：**

| 层 | 触发条件 | 结果 |
|---|---|---|
| 确定性（无 LLM） | 无命名角色 / duration < 5s / endFrameDesc 为空 / 首尾帧描述相似度 > 82% | `first_only` |
| LLM 语义判断 | 确定性规则未命中 + `enhancePrompts=true` | LLM 分析摄影机意图、首尾帧差异、场景跳变风险 |
| 安全兜底 | LLM 报错/超时 或 无 textConfig | `both`（保守默认） |

**关键设计决策：**
- LLM judge 绑定在 `enhancePrompts`（「AI 增强」开关）上——关掉 AI 功能时仅走确定性规则，不产生额外 LLM 调用
- `first_only` 结果：只写 `anchor_first`，不写 `anchor_last_ai`；视频生成时若磁盘无有效 `anchor_last_ai` → Seedance 首帧参考图模式
- Seedance 参考图模式返回视频最后一帧 → 写入本镜 `cut_point`（**不**自动写下一镜，除非开启衔接开关）

**帧生成策略** = 决定当前镜头要不要生成 AI 尾帧（与镜间衔接无关）。

### 8. linkShotsViaCutPoint — 镜头衔接（视频尾帧）

`projects.link_shots_via_cut_point`（integer，默认 0）对应分镜页「镜头衔接（视频尾帧）」。

- 开启：单镜/批量视频成功后调用 `maybeAutoLinkNextShotAfterVideo` → `linkNextShotAnchorFromCutPoint`（`src/lib/storyboard/shot-frame-link.ts`）
- 机制：**路径直拷** `cut_point[i]` → `anchor_first[i+1]`（同集、同 `versionId`、同 `episodeId`）
- 跳过：`isCrowdToCharacterCut`（上一镜群演、下一镜有命名角色）
- 与手动衔接并存：「承接上一镜尾帧」「承接上一集尾帧」、参考图 AI 重绘
- Reference 双轨已废弃（generate 相关 action **410**）；勿恢复生成画面前自动链式参考

### 9. Drizzle null 比较

```typescript
// ✅ 正确：用 isNull() / isNotNull()
where(isNull(storyboardVersions.episodeId))

// ❌ 错误：eq() 对 null 值返回 false（SQL NULL != NULL）
where(eq(storyboardVersions.episodeId, null))
```

### 10. 多参考图生成首/尾帧 — frameReferences 数组

Seedream API（`doubao-seedream-5.0-lite/4.5/4.0`）支持最多 **14 张**参考图（官方文档确认）。

**类型约定**：

```typescript
// ✅ 新格式（v0.5）：多选数组，第一张为主参考/衔接参考
export type FrameReferenceChoice =
  | { mode: "none" }
  | { mode: "pick"; references: Array<{ shotId: string; frameType: FrameReferenceType }> };

// 发送给服务端的字段
payload.frameReferences = choice.references;  // 数组
```

**API 路由**（`generate/route.ts`）：
- `MAX_REFERENCE_IMAGES = 14`（与 API 上限对齐）
- 解析顺序：优先读 `frameReferences[]`（新）；若无，fallback 到 `frameReference`（旧单个）保持向后兼容
- `resolvedFrameRefs[0]` 作为 `continuityRef`（写 `chainSourceShotId` / `chainSourceType`）
- refImages 组装顺序：`crossShotRefPaths`（用户手选）→ `charRefImages`（角色定妆图）

**动态上限计算**（`use-shot-frame-actions.ts`）：

```typescript
const API_MAX_REF_IMAGES = 14;

function estimateAutoRefCount(namedCharacterCount: number): number {
  return namedCharacterCount; // 1 张定妆图/角色
}

// 暴露给组件的动态上限
crossShotRefLimit: Math.max(1, API_MAX_REF_IMAGES - estimateAutoRefCount(namedCharacterCount))
```

**上限示例**（`namedCharacterCount` 来自 `filterShotCharacters()`）：
- 0 个角色 → 用户可手选 14 张（14 - 0）
- 1 个角色 → 用户可手选 13 张（14 - 1）
- 3 个角色 → 用户可手选 11 张（14 - 3）

**组件链路**：`storyboard/page.tsx` → `namedCharacterCount={shotNamedCharacters.length}` → `ShotCard` / `ShotDrawer` → `useShotFrameActions` → `crossShotRefLimit` → `FrameReferencePicker maxSelectable`

**FrameReferencePicker UI**：checkbox 多选（替代原 radio 单选），第一张选中标「主参考」角标；达上限其余选项置灰。

### 11. motionScript — bracket 多角色动作链格式

DB 中 `motionScript` 字段统一使用以下格式（migration 后全面推广）：

```
Xs-Ys: [单一主体/共同动作] Ys-Zs: [角色A:动作1→动作2] [角色B:动作3→动作4] | 朝向：角色A正面面朝镜头
```

**格式规则**：
- `[内容]` 无冒号 → 单一主体或共同动作，`→` 替换为 `、`
- `[角色名:动作1→动作2]` → 具名角色动作链（名字 ≤8 字，无标点）
- 同一时间段多个 `[]` → 叙事先后顺序，第一个先发生
- `| 朝向：角色名+方位词` → 结尾必填（有具名角色时）
- 时间段求和必须精确等于 `shot.duration`

**`expandMotionScriptBrackets(motionScript, opts?)`**（`src/lib/ai/prompts/ref-video-prompt-generate.ts`）：

```typescript
// 默认模式：保留时间码（给 LLM / 结构化展示用）
// "0-3s: 龙渊转身、迈步 3-7s: 灵瑶嘴唇微颤、眼睑下垂"
expandMotionScriptBrackets(motionScript)

// prose 模式（直出视频提示词用）：去掉时间码，跨段用「，随后」衔接
// "龙渊转身、迈步，随后灵瑶嘴唇微颤、眼睑下垂"
expandMotionScriptBrackets(motionScript, { prose: true })
```

旧格式（无 `[]` 包裹）原样透传，向后兼容。

### 12. 视频提示词直出架构 — 不再使用 LLM

**架构决策（不可逆）**：视频提示词生成已完全移除 Vision-LLM 精炼模式，统一为直出模式。

**原因**：Seedance API 直接接收帧图（`anchorFirst` / `anchorLastAi`），让 LLM「描述帧图」放进文字 prompt 是循环冗余；直出模式零幻觉、零动作重排、零 API 费用、不依赖帧图。

**核心函数**（`src/lib/storyboard/shot-video-prompt-sync.server.ts`）：

```typescript
// 组装：Duration 头 + startFrameDesc + expandedMotionScript(prose) + cameraDirection + visualStyleTag
export function buildDirectVideoPrompt(params: {
  shot: Pick<ShotRow, "duration"|"startFrameDesc"|"endFrameDesc"|"motionScript"|"prompt"|"cameraDirection"|"bgmNote">;
  visualStyleTag?: string;
  stripBgmContent: (text: string, bgmNote?: string | null) => string;
}): string

// 写入 DB（videoPromptFrameFingerprint 置 null）
export async function generateAndPersistDirectVideoPrompt(params): Promise<string>

// 确保 videoPrompt 存在（空时自动直出生成，非空时直接返回）
export async function syncVideoPromptIfStale(params): Promise<{ videoPrompt: string | null; refreshed: boolean }>
```

**已删除的函数**：`generateAndPersistVisionVideoPrompt`、`shouldRefreshVideoPrompt`。禁止恢复 Vision-LLM 路径。

**输出格式**（对齐 Toonflow videoDesc）：
```
Duration: 7s.

近景平视，李明站在画面左三分之一，左侧冷调月光侧逆光。李明转身、迈步，随后推开门。固定镜头缓推。日本2D动漫风格。
```

### 13. 台词注入 — Toonflow 内联格式

台词注入架构已从旧版 NOTE 块迁移为 Toonflow 内联格式（`generate/route.ts` 的 `ensureDialoguesInPrompt`）。

**旧格式（已废弃）**：
```
NOTE: The following are the ONLY lines of speech...
【对白口型】李明（视觉描述）: "台词"
【画外音】角色名（音色）: "台词"
```

**新格式（Toonflow 内联）**：
```
李明（视觉描述）说：「台词」音色：男声，青年，音调低沉...（嘴型口型同步）
角色名 画外音VO：「台词」音色：...（画面外，角色嘴型静止）
```

**机制**：LLM 被要求在叙事中台词自然发生的时机处内嵌台词。`ensureDialoguesInPrompt` 仅做兜底——检测哪些台词原文未出现在正文中，只对缺失的补充追加，不覆盖 LLM 已自然内嵌的台词。

### 14. startFrameDesc — 帧生成唯一事实来源

`startFrameDesc` / `endFrameDesc` 是图像生成的唯一画面依据，必须自包含四要素（景别/角色姿态/主光/情绪身体解剖）。`emotion`、`framing`、`lightingAtm` 三个冗余字段已于 migration 0042/0043 从数据库完全移除，所有信息统一写入 `startFrameDesc`。

```
// ✅ 正确：startFrameDesc 自包含全部视觉信息（含光影）
startFrameDesc: "近景平视，李明站在画面左三分之一，左手扶额，右臂垂落，
                 左侧冷调月光侧逆光勾勒轮廓，嘴角绷紧眼眸下垂"

// ❌ 错误：startFrameDesc 缺少主光描述（光影是四要素之一，不得省略）
startFrameDesc: "近景平视，李明站在画面左三分之一，左手扶额，嘴角绷紧"
```

**startFrameDesc 四要素**（缺一不可）：
1. 景别/视角（如"近景平视"）
2. 具名角色精确位置与静止姿态（不写运动过程）
3. 主光（颜色 + 方向 + 来源，如"左侧冷调月光侧逆光"）
4. 情绪的身体解剖表现（如"嘴角绷紧眼眸下垂"，禁用"神情坚定"等形容词）

---

## AI Prompt 增强系统

`src/lib/ai/prompt-enhancer.ts` 提供按 protocol 定制的 prompt 改写：

- `enhanceVideoPrompt(rawPrompt, protocol, textProvider)` — 视频 prompt
- `enhanceImagePrompt(rawPrompt, protocol, textProvider)` — 图片帧 prompt

每个 protocol 对应专属的 system prompt（如 Seedance 五段式、Kling 四要素、DALL-E 英文格式等）。新增 provider 时必须在对应的 `VIDEO_ENHANCE_SYSTEM_PROMPTS` 或 `IMAGE_ENHANCE_SYSTEM_PROMPTS` map 里添加条目。增强失败时静默回退到原始 prompt，不阻塞生成。

---

## S 级分镜标准集成

系统所有 AI 生成分镜内容的路径均已集成 S 级分镜标准（首帧/尾帧/videoScript 四要素/微表情词汇/禁用模板列表）。

### 覆盖的产线路径

| 功能入口 | 文件 / Key | 说明 |
|---|---|---|
| AI 自动生成（大纲扩写） | `outline-expand.ts` / `outline_expand` | 故事大纲 → 多集 S 级剧本 |
| 解析分镜（散文） | `registry` → `shot_split` | 一次 LLM 切镜并写全字段 |
| 解析分镜（结构化 md） | `finalizeExtractedShotsForDb` | 无 LLM，缺字段保持 null |
| 全集分镜批量重写 | `storyboard-supervision.ts` / `batch_storyboard_rewrite` | 全集七律视觉连续性重写：LLM 一次读入全部分镜，批量重写 startFrameDesc/endFrameDesc/motionScript/cameraDirection 并写回 DB |

### 不在此范围内的路径

- `handleAiOptimizeText` — 通用文字优化，执行用户自定义指令，不生成分镜结构
- `import/split/route.ts` — 剧集级文本分割，不涉及分镜字段
- `ref-video-prompt-generate.ts` — 现在是**直出工具函数库**（`expandMotionScriptBrackets`、`buildRefVideoPromptRequest` 等），不再包含 LLM 视频精炼系统

### batch_voice_generate — 批量生成音色描述

`action = "batch_voice_generate"` → `handleBatchVoiceGenerate`：为项目中所有有 `visualHint` 的角色批量生成 9 维标准化音色描述，写入 `characters.voiceHint`。

**9 维格式**：`{性别}，{年龄音色}，{音调}，{音色质感}，{声音厚度}，{发音方式}，{气息}，{语速}，{特殊质感}`

示例：`女声，少女音色，音调偏高，音色干净纯粹，声音轻薄，发音清晰，气息轻盈，语速适中，带温婉真诚感`

SSE 事件序列：`start` → `progress`（每角色一条，含 `voiceHint` 字段供前端实时更新角色卡） → `done`。前端无需额外请求即可更新 UI。

### S 级核心规范速查

**videoScript 四要素**（缺一不可）：
1. 角色名（视觉 ID 字符串）+ 在画面中的精确位置/姿态
2. 单一动词驱动的核心动作
3. 摄影机公式：起幅 + 运镜动作 + 速度 + 落幅
4. 单一感官细节（光线/粒子/材质/声音，只选其一）

**startFrameDesc / endFrameDesc 四要素**（单一事实来源，必须自包含）：
1. 景别/视角（如"近景仰拍"）
2. 具名角色精确位置/姿态（静止态，不写运动过程）
3. 主光（颜色 + 方向 + 来源，如"左侧冷调月光侧逆光"）
4. 情绪的身体解剖表现（如"嘴唇微颤、眼睑下垂"，禁用形容词如"神情坚定"）

**首帧/尾帧配对规则**：
- 首帧 = 动作开始前的静止状态（不写运动过程）
- 尾帧 = 动作完成后的稳定状态（必须与首帧不同，体现起止位移）
- 禁止：两帧相同 / 用情绪形容词代替身体解剖描述

**禁用模板**（出现即质量失败）：
- "说话人面部表情随台词情绪流动，神情专注"
- "中景跟拍：捕捉[XX]动作过程"
- "角色情绪丰富" / "神情坚定" / "眼神复杂"
- videoScript 超过 80 字 / 纯摄影机描述无角色动作
- videoScript 里写配乐/BGM/背景音乐描述（如"配乐响起""悲壮BGM""弦乐渐强"）——音频后期统一叠加，单片段生成不引导模型产生 BGM

---

## 测试规范

详见 `docs/EVAL.md` 和 `src/__tests__/`。

### 快速运行

```bash
pnpm test              # 运行所有单测
pnpm test:watch        # 监听模式
pnpm test:integration  # API 集成测试（需要测试 DB）
pnpm eval              # 运行 AI Eval 评估（需要真实 API Key）
pnpm eval -- --suite char     # 只跑角色路由 suite（无需 API key）
pnpm eval -- --suite prompt   # 只跑 prompt 增强 suite（需要 API key）
```

### 测试文件位置

- 单元测试：`src/__tests__/unit/`，与被测文件路径对应
- 集成测试：`src/__tests__/integration/`
- Eval 用例：`src/lib/evals/cases/`
- Eval fixtures（共享测试数据）：`src/lib/evals/fixtures/shots.ts`
- 占位角色名（禁止用真实剧情角色）：`src/lib/test-fixtures/placeholder-characters.ts`

### Eval Harness 架构

```
src/lib/evals/
├── index.ts              # 入口：注册并分发 suite
├── runner.ts             # 框架核心：EvalCase / EvalSuite 类型 + runSuite / runAllSuites
│                         # 包含 llmJudge() / assertContains() / assertMinLength() 等 helper
├── cases/
│   ├── character-routing.ts     # Suite：filterShotCharacters 角色过滤行为（确定性，无 API）
│   └── prompt-enhancement.ts   # Suite：enhanceVideoPrompt / enhanceImagePrompt（需 API key）
└── fixtures/
    └── shots.ts          # 标准镜头/角色/prompt fixture（用 FIXTURE_CHAR_* 占位符）
```

**关键设计**：

- `EvalCase.run()` 抛出异常 = fail；返回 `"skip"` = 跳过；返回 `void` = pass
- `llmJudge(output, criteria, provider)` 以 YES/NO 格式评估输出质量（temperature=0）
- Eval 失败退出码非零，可接入 CI scheduled job（不加入 PR CI 以避免 API 费用）
- 环境变量：优先 `ARK_API_KEY`（便宜），fallback `OPENAI_API_KEY`

**新增 Eval Suite 步骤**：
1. 在 `fixtures/shots.ts` 添加测试数据（角色用 `FIXTURE_CHAR_*` 占位符）
2. 在 `cases/` 新建 suite 文件，export `XxxSuite: EvalSuite`
3. 在 `index.ts` 的 `allSuites` 数组注册
4. 运行 `pnpm eval -- --suite <name>` 验证

**不变量（任何情况下必须 pass）**：
- `crowd-scene-returns-empty`：群演 `filterShotCharacters` 返回 `[]`
- `fallback-on-api-error`：增强失败时原样返回原始 prompt
- `fallback-on-empty-prompt`：空 prompt 不触发 API 调用

---

## 已知陷阱 / 历史修复记录

| 问题 | 根因 | 修复位置 |
|---|---|---|
| 删版本后刷新 v4 消失 | `currentEpisodeId` 水合为 null，版本建为 `episodeId=null` | storyboard page：用 `urlEpisodeId` |
| 镜间 PPT / 群演误衔接 | 群演 `cut_point` 当下镜首帧 | 自动衔接跳过 `crowd_to_character`；手动勿点承接 |
| DB 有帧路径文件已删 | 误走首尾帧模式 / ENOENT | UI 红框「文件缺失」（D6-B），不自动清 DB |
| 版本 DELETE 返回 404 | `eq(episodeId, null)` 匹配不到孤儿版本 | version DELETE route：移除 episodeId 过滤 |
| 群演场景注入全部角色图 | `filterShotCharacters` 无匹配时 fallback 到全量 | `generate/route.ts` + `filterShotCharacters`：移除 fallback |
| `enhance_prompts` column 缺失 | schema 先于 migration 被 Drizzle 读取 | migration 0027 + Python 直接 ALTER |
| 视频生成跳过 visualStyleTag | 生成路径未传参数 | 各 handler 全面审计 |
| 角色解析后变成写实风 | `handleCharacterExtract` 用裸 `resolvePrompt` 未注入 visualStyle | 使用 `resolveCharacterExtractSystemPrompt(visualStyle, …)` |
| 尾帧人物与定妆图不符 | 尾帧 prompt 未明确角色设定图优先于首帧 | `registry.ts` `LAST_FRAME_RELATIONSHIP_TO_FIRST` + `LAST_FRAME_RENDERING_QUALITY` |
| PPT割裂感（群演→主角切换） | 强制继承上一镜头尾帧导致首帧图像错误 | 智能链式中断：`isCrowdToCharacterCut` 检测，独立生成首帧 |
| 生成首帧出现火光/动态元素 | `lightingAtm` 含视频级动态描述被注入静帧 `【光影】` 段 | migration 0042/0043：从数据库完全移除 `emotion`/`framing`/`lightingAtm`；光影信息统一写入 `startFrameDesc` |
| Seedance 多参音色错位 | audioPath 有值但 hasAudio 未传入 | `handleBatchVideoGenerate` 查询 `character_assets.audioPath` |
| Track 分组后视频混乱 | 分镜不连续（有跳号 sequence）| 重新「自动分配 Track」重计算分组 |
| 视频编辑器字幕未显示 | Canvas 字幕轨道 clip 时间范围不覆盖当前播放头 | 调整字幕 clip 的 startTime / endTime |
| 参考图只能单选 | `FrameReferenceChoice` 为单值设计，API 实际支持 14 张 | 改为多选数组 `frameReferences[]`；`use-shot-frame-actions` 暴露 `crossShotRefLimit` 动态上限 |
| 场景图注入首帧导致构图污染 | Diffusion 模型无法分离风格与构图，scene 参考图结构性渗入画面 | migration 0045/0046：完整移除场景图功能，`startFrameDesc` 文本为唯一视觉依据 |
| 单镜「重新生成文本」无法保证全集一致性 | 逐镜 AI 介入破坏相邻镜头场景词一致性 | 移除 `single_shot_rewrite` action；改用 `batch_storyboard_rewrite`（全集一次性批量重写，保证跨镜一致性） |
| Seedance 400 错误：duration=7.5 | AI 拆分分镜产生小数时长（如 15/2=7.5），Seedance API 仅接受整数秒 | `seedance.ts` `resolveDuration()` 改为 `Math.ceil(duration)`；`split/route.ts` 先 `Math.ceil(totalDuration)` 再拆分 |
| 视频提示词 LLM 模式循环冗余 | Vision-LLM「描述帧图」放入 prompt，但 Seedance 已直接收到帧图参数（`anchorFirst`/`anchorLastAi`），描述等于无效二次编码 | 删除 `generateAndPersistVisionVideoPrompt`；统一为 `buildDirectVideoPrompt`（直出架构，零 API 费用） |
| 台词注入 NOTE 块被 LLM 误解 | 旧 NOTE 块格式要求 LLM「不重复」台词，实践中 LLM 经常忽略或放错位置 | 改为 Toonflow 内联格式：`ensureDialoguesInPrompt` 只补充缺失台词，LLM 自然内嵌的不重复追加 |
| motionScript 多角色动作顺序被 LLM 重排 | 散文描述无法锁定发声先后顺序 | 改为显式 bracket 格式 `[角色A:动作→动作] [角色B:动作]`，`[]` 顺序即叙事铁律；`expandMotionScriptBrackets` 展开为散文 |

---

## 开发工作流

**修改系统提示词默认模板时**：遵守 [docs/PROMPT-TEMPLATE-AUTHORING.md](docs/PROMPT-TEMPLATE-AUTHORING.md)（禁止写入具体作品剧情；示例用角色甲/乙等占位符）。提交前运行 `pnpm test src/__tests__/unit/lib/ai/prompt-templates-deplot.test.ts`。

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
