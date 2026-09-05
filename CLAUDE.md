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
5. 浏览器端视频编辑器（时间线 + 字幕 + BGM + 转场）+ 服务端 ffmpeg 导出 MP4
6. AI 生成 BGM（豆包音乐 / 火山「生成纯音乐」，纯器乐，基于分镜 bgmNote 字段）
7. 将视频合并为完整剧集（ffmpeg 拼接）

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

## 角色资产架构（最优实践）

### 每个角色的资产组成

| 资产类型 | assetType | 数量 | 用途 |
|---|---|---|---|
| 主定妆图（正面，isDefault=1） | `morph` | 1 张 | 始终传入，锁定外貌身份 |
| 角度变体（3q/profile/back） | `morph` | 0-3 张 | 补充视角，angle 字段标记 |
| 武器/道具图 | `prop` | 0-N 张 | 在分镜抽屉「道具参考图」区域勾选，写入 shots.prop_refs（JSON 数组，store character_assets.id） |
| 音色参考 | 任意 | 0-1 个 | audioPath 字段，音色克隆 |

### 主定妆图选择逻辑（无 LLM）

```
多张 morph（angle=null）→ isDefault=1 那张；无标记则取第一张
一张 morph             → 直接用
零张 morph             → 用 blueprint
```

### 武器处理决策规则

- **武器是角色标志性外观**（如龙渊的背剑）→ 主定妆图包含武器；背面/3q 角度图自然展示背剑姿势；另上传一张剑的特写道具图（`prop`）供需要武器细节的分镜引用
- **武器仅在特定场景出现** → 主定妆图不含武器；武器作为 `prop` 资产，在打戏分镜手动加入 FrameReferencePicker
- **角色换武器**（如故事中期换剑）→ 用 inpainting 生成新剑版本的角度图，上传后更新 `isDefault=1`；旧定妆图保留，手动在角色页切换

### 行业对标

- Kling Elements：每个角色最多 4 张角度图（front + 3/4 x2 + back），武器可建独立 Element
- Seedance 2.0：`[identity_lock]` 锁定角色，`[object_lock]` 锁定道具，分别传入
- 共同原则：角色外貌与武器道具分开，不用 LLM 路由

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
| `seedance` | Seedance 2.5 / 2.0 / 1.5（火山方舟 ARK API） | 视频 |
| `volc-music` | 豆包音乐 / 火山「AI 生成音乐大模型 · 生成纯音乐」 | 音乐（BGM） |

**规则**：`provider-factory.ts` 的 switch-case 是增加新 provider 的唯一入口；视频 provider 还必须在
`video-capabilities.ts` 的 `VIDEO_CAPABILITIES` 里加一条能力描述（见约定 7a，一致性测试会强制校验）。
音乐 protocol（`volc-music` 等）**不经过** `provider-factory.ts`，由 `POST /api/bgm/generate` 内部的 `callMusicProvider` switch 路由；添加新音乐 provider 只需扩展该 switch 即可。

### 三种 Provider

```typescript
AIProvider       // generateText + generateImage
VideoProvider    // generateVideo
// 音乐 Provider 目前无独立接口，通过 /api/bgm/generate 路由调用
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

**当前最新迁移索引**：`idx 62` — `0062_task_progress`

### 关键表

| 表 | 说明 |
|---|---|
| `projects` | 顶层实体，含 `visualStyle`、`videoRatio`、`useProjectPrompts`、`finalVideoUrl`（`enhancePrompts` / `linkShotsViaCutPoint` 两列已由 migration 0047 删除）|
| `episodes` | 分属 project 的剧集 |
| `storyboard_versions` | 分镜版本，每个版本对应一批 shots |
| `shots` | 单个分镜；帧字段：`anchorFirst`、`anchorLastAi`、`cutPoint`；`previewUrl`/`posterUrl`（480p 预览代理与封面，migration 0058）；`previzSelectedId`（已选用的白模预演，migration 0059）；`track`（`emotion`/`framing`/`lightingAtm`/`sceneId` 已全部移除，三列由 migration `0057` 补删完成）|
| `episodes.previz_scene` | 3D 导演台的**场景**（JSON）：一集搭好的景 + 出场演员身形，跨镜共用。只有数字，不内嵌素材路径 |
| `shots.previz_blocking` / `previz_layout_url` | 本镜的走位与机位（JSON，参数化机位：主体/方位角/距离/高度/焦距）；以及导演台导出的构图参考图 |
| `subscriptions` | 订阅（一用户一条）。周期滚动是**惰性**的：`ensureSubscriptionPeriod()` 在闸门与余额读取处调用，发现周期已过就当场滚动，不用 cron |
| `orders` | 订单。状态机 `pending → paid / closed → refunded`；价格与积分在下单时快照，改价不影响历史；`UNIQUE(channel, channel_trade_no)` 是回调幂等的数据库兜底 |
| `shot_previz` | 白模预演 take（一个分镜可多条）；`videoUrl`/`posterUrl`/`prompt`/`modelId`/`duration`/`resolution`。选中的那条由 `shots.previzSelectedId` 指向，正式生成时作为 `reference_video` 传给 Seedance 2.5 |
| `dialogues` | 台词；`type`（'dialogue'\|'os'\|'vo'）|
| `characters` | 项目/剧集角色，含 `visualHint`、`voiceHint`（9维音色描述）|
| `character_assets` | 角色图片/音频；`assetType`（`morph`/`blueprint`/`prop`）；`isDefault`（1=当前主定妆图）；`audioPath`（音色参考，用于 Seedance 音色克隆）|
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

### 4. ~~enhancePrompts~~ — 已移除（保留编号，勿复用）

**「AI 增强」开关已整体移除，不要按旧文档去实现或调用它。**

- `projects.enhance_prompts` 列已由 migration `0047_drop_enhance_prompts_link_shots` 删除
  （原因：该开关实际是 no-op）
- UI 上的「AI 增强」开关已删除
- `enhanceImagePrompt` / `enhanceVideoPrompt`（`src/lib/ai/prompt-enhancer.ts`）**在生产代码里零调用方**，
  目前只被 eval suite（`src/lib/evals/cases/prompt-enhancement.ts`）和单测引用

视频提示词现在走**直出架构**（`buildDirectVideoPrompt`，见约定 12），不经过任何 LLM 改写。
本节编号保留是为了不打乱后续约定的交叉引用。

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

### 7. 帧生成 — frameTarget 机制

UI 的「生成画面」/「重新生成帧」按钮**始终**只生成首帧（`frameTarget: "first"`）。AI 尾帧需用户单独点击「生成尾帧」按钮（`frameTarget: "last"`）触发。

**frameTarget 取值（客户端显式传入，无 "both"）：**
- `"first"` — 只生成/覆写 `anchorFirst`
- `"last"` — 只生成/覆写 `anchorLastAi`（需要 `anchorFirst` 已存在）

服务端 default 为 `"first"`（防御性兜底，正常流程不依赖 default）。`"both"` 模式已于 2026-06 完全移除。

**视频生成模式因此的影响：**
- `anchorLastAi` 几乎不存在（用户极少主动生成尾帧）
- 视频生成默认路径：普通首帧/参考图重绘首帧 → `multimodal` 模式；直拷承接帧（`anchorFirstContinuityMode="strict_start"`）→ `initialImage` 模式

### 7a. 视频能力注册表 — `video-capabilities.ts`（视频侧唯一事实来源）

**`src/lib/ai/video-capabilities.ts` 的 `VIDEO_CAPABILITIES` 是「一个视频模型能做什么」的唯一事实来源。**
新增品牌/版本 = 加一条 capability + 在 `provider-factory.ts` 加一个 case，**不改通用路由**。

一条 capability 描述：支持的生成模式（`modes`）、时长区间、比例（含 `ratioLockedModes` 这种
「某模式下比例被 API 锁死」的约束）、分辨率、各类参考素材上限与传输方式（`refs` / `refTransport`）、
特性开关（`generateAudio` / `voiceClone` / `returnLastFrame` / `realFaceBlocked` / `serviceTierModes`）、
提示词方言（`promptDialect`）、`@参考N` 编号规则。

**禁止再在业务代码里写协议判断**。以下写法一律改为读能力表：

| ❌ 旧写法 | ✅ 改为 |
|---|---|
| `protocol === "seedance" \|\| protocol === "doubao"` | `cap.promptDialect === "seedance-multi-param"` |
| 局部常量 `MAX_MULTIMODAL_REFS = 9` / `MAX_AUDIO_REFS = 3` | `cap.refs.image` / `cap.refs.audio` |
| `getModelMaxDuration(modelId)`（原 `model-limits.ts`，已删除并入本表） | 仍可用，内部读 `cap.duration.max` |

**关键 API**：
- `resolveVideoCapability(modelId, protocol?)` — 精确 id → 家族子串（长的优先）→ 协议兜底 → `UNKNOWN_VIDEO_CAPABILITY`（不抛异常）
- `downgradeVideoMode(ideal, cap)` — **必须调用**，见 7b
- `describeCapabilityLoss(cap, ctx)` — 生成「本次会丢什么」的中文说明，经响应体 `capabilityNotes` 回传前端 toast

**Seedance 2.0 与 2.5 的差异全部由本表表达**（`refNumbering` / `ratioLockedModes` / `refs` / `duration` /
`resolutions` / `outputFormats`），业务代码不需要判断版本。唯一的例外是 `providers/seedance.ts` 内部的
`isSeedance25()` —— 它决定请求体形状（`omni_reference_task_type`、`role: "first_frame"`、`reference_video`），
那是火山自家两个 API 版本之间的差异，属于该 provider 的内部知识，不放进跨品牌可比的能力表。

**约束**：本文件被客户端组件引用（shot-card / shot-drawer / prompt-editor），
必须保持纯数据 + 纯函数，不得引入 `server-only`、node 内置模块或有副作用的 import。

**一致性守卫**：`src/__tests__/unit/lib/ai/video-capability-consistency.test.ts` 断言
注册表 ↔ `createVideoProvider` switch ↔ `model-store.ts` 的 `Protocol` 联合类型 ↔
`models/list` fallback 模型 id 四者一一对应，并校验每条 capability 自洽
（`refs` 与 `refTransport` 同时有/同时无、声明 multimodal 就必须有 `refs.image`、
`voiceClone` 与 `refs.audio > 0` 一致、锁定比例必须在 `ratios` 里）。漏配任意一项直接失败。

### 7b. 视频生成三路分流 — SingleVideoMode

`SingleVideoMode = "initialImage" | "keyframe" | "multimodal"`（即 `video-capabilities.ts` 的 `VideoMode`），
由 `resolveSingleVideoMode(shot)` 决定，定义于 `src/lib/storyboard/shot-video-readiness.server.ts`。

⚠️ **`resolveSingleVideoMode` 返回的是「理想模式」，只看分镜数据，不知道 provider 支不支持。
调用方必须再过一道 `downgradeVideoMode(ideal, capability)`。**
Kling / Veo / 即梦三家都只实现了首帧和首尾帧两种 body —— 把 `multimodal`（绝大多数镜头的默认模式）
直接送进去，Kling 会对 undefined 的 `initialImage` 取 base64 而崩溃，Veo 会抛
`Veo requires an image input`，即梦会提交一个空图列表。

降级链：`multimodal → initialImage → keyframe`（multimodal 与 initialImage 都只需一张首帧图；
keyframe 需要额外的 AI 尾帧，无法凭空造出来，只作最后兜底）。降级结果通过 `capabilityNotes`
回传前端并 toast 告知用户 —— **降级不能静默**，否则用户切换品牌后只会觉得「效果莫名变差」。

**决策顺序（不可调整）：**

```
1. shotFrameFileOnDisk(shot.anchorLastAi) → "keyframe"     // 首尾帧双锁（最强）
2. shot.anchorFirstContinuityMode === "strict_start" → "initialImage" // 直拷承接帧，时序连续优先
3. 其余所有镜头（含群演）                 → "multimodal"   // 角色外貌锁定
```

群演镜头（无命名角色）现在也走 `multimodal`：`resolveCharacterImages` 返回空列表，`multimodalRefs` 仅含 `anchorFirst`，Seedance 降级处理，无副作用。旧的 `isCrowdShot` 字符串匹配判断已全面移除（不稳定，误判代价高）。

`chainSourceShotId` / `chainSourceType` 仅表示首帧来源追溯，不再单独决定视频模式。手动选择参考图生成首帧会写 `anchorFirstContinuityMode="reference_redraw"`，继续走 `multimodal`；「承接上一镜尾帧」「承接上一集尾帧」这类路径直拷会写 `strict_start`，才走严格首帧模式。migration `0054` 会按 `anchor_first` 是否等于来源帧路径回填历史链源数据，并补回旧版「承接上一镜尾帧」漏写的链源；历史数据中 `anchorFirstContinuityMode` 为空但 `chainSourceShotId` 非空时，`resolveSingleVideoMode` 仍保留 legacy `initialImage` 兜底。

**multimodal refs 组装顺序**（必须与 `buildRefEntries` 的三轮分配完全一致，否则 `@参考N` 编号错位）：

```
第一轮（asset_image）：每个命名角色的主图 → @参考1, @参考2...
第二轮（storyboard_image）：anchorFirst（分镜首帧，构图锚点）→ @参考N
第三轮（asset_audio）：音频参考（audioPath，音色克隆）→ @参考N+1...
```

**关键约束：`@参考N` 必须先于 refs 组装前确定角色列表**

`buildSeedanceMultiParamVideoPrompt`（prompt 端）和 `multimodalRefs`（API 端）必须使用**同一份过滤后的角色列表**——仅包含 `resolveCharacterImages` 实际找到磁盘图片的角色。若 prompt 端包含无图角色、API 端不包含，编号会系统性错位。实现上通过在 prompt 构建前预先调用 `resolveCharacterImages` 来保证同步（`needPreResolveCharImages` 标志，`generate/route.ts`）。

**角度变体（3q/profile/back）已加入 multimodalRefs**

`resolveCharacterImages` 返回 `angleImages: { angle: string; path: string }[]`（按 3q → profile → back 顺序，仅含磁盘存在的文件）。`buildRefEntries` Round 1 在每个 asset 主图后紧跟其角度变体，prompt 参考定义段生成如下格式：

```
@参考1: 李明，角色正面（外貌主参考），参考音频为：@参考5
@参考2: 李明四分之三侧面视图（与@参考1同一角色，四分之三侧面外貌补充）
@参考3: 灵瑶，角色正面（外貌主参考）
@参考4: 分镜1构图参考
@参考5: 李明音色参考
```

`multimodalRefs` 顺序与 `buildRefEntries` 完全对齐：第一轮角色主图+角度变体、第二轮 anchorFirst、第三轮音频。

**9 张图片上限保护**（Seedance 2.0 官方文档硬限制：多模态参考生视频 1~9 张图片）：
- 音频走独立的 `audio_url` 类型，**不占图片名额**（音频另有上限 3 个，`MAX_AUDIO_REFS=3`）
- 图片优先级（高→低）：主图 > anchorFirst > **道具图** > 角度变体
- 预算 = 9 − 主图数 − anchorFirst(1) − propReserve（道具图预留槽位）
- 角度变体按剩余预算分配；超出时后面的角度（back 先丢）自然跳过
- 道具图在第四轮用 `imageCount < 9` 检查（只数 image 类型，不含 audio）

实现位置：`handleSingleVideoGenerate`（`generate/route.ts`）三路分流代码块。`resolveCharacterImages`（`character-router.ts`）返回 `angleImages` 和 `audioPath` 字段。

**批量视频生成无需单独迁移**：批量视频是客户端循环调用 `single_video_generate`，每次调用走同一套三态逻辑，自动享受 multimodal 路径。

### 8. 镜头衔接 — 自动链接已移除，现在只有手动承接

**`linkShotsViaCutPoint` 自动衔接已整体移除，不要按旧文档去实现或调用它。**

- `projects.link_shots_via_cut_point` 列已由 migration `0047_drop_enhance_prompts_link_shots` 删除
  （原因：手动按钮已覆盖该场景）
- `maybeAutoLinkNextShotAfterVideo` / `linkNextShotAnchorFromCutPoint` / `isCrowdToCharacterCut`
  这三个函数**都已不存在**；`src/lib/storyboard/shot-frame-link.ts` 现在只剩
  `resolvePreviousEpisodeTailFrame`（供「承接上一集尾帧」使用）

**现存的衔接方式全部是用户手动触发的**：
- 「承接上一镜尾帧」「承接上一集尾帧」——路径直拷，写 `anchorFirstContinuityMode="strict_start"`，
  视频生成走 `initialImage` 模式（见约定 7b）
- 参考图 AI 重绘首帧——写 `anchorFirstContinuityMode="reference_redraw"`，仍走 `multimodal`

`shots.cutPoint`（视频真实尾帧）仍在写入，由 `buildVideoCutPointUpdate` 在单镜视频成功后落库，
供上述手动承接按钮取用。注意 `cutPoint` 依赖 provider 返回尾帧——能力表的
`features.returnLastFrame` 记录了各家是否支持（Kling / Veo / 即梦均不支持）。

Reference 双轨已废弃；勿恢复生成画面前的自动链式参考。

### 8b. API 路由鉴权 — 每条路由都必须做用户识别

**新增 API 路由时，要么接鉴权助手，要么在测试白名单里登记理由。** 没有第三种选择 ——
`src/__tests__/unit/api/route-auth-guard.test.ts` 会扫描全部 `src/app/api/**/route.ts` 并强制这一点。

助手在 `src/lib/api-guard.ts`，用法固定两行（刻意保持可 grep）：

```ts
const guard = await requireProjectOwner(request, projectId);
if (!guard.ok) return guard.response;
```

| 助手 | 用途 |
|---|---|
| `requireProjectOwner(request, projectId)` | 带 projectId 的路由（绝大多数） |
| `requireTaskOwner(request, taskId)` | task → projectId → 归属 |
| `requireUser(request)` | 无资源归属、但不该匿名调用（写盘、SSRF 面、算力消耗） |
| `requireCharacterInProject` / `requireShotInProject` / `requireCharacterAssetInProject` | **子资源二级校验**，见下 |

**两级校验缺一不可**：`requireProjectOwner` 只证明「你拥有这个项目」。
路由随后若直接 `where(eq(characters.id, characterId))`，用自己的 projectId 配别人的
characterId 依然打得穿。凡是路径里带子资源 id 的，都要再过一次 `requireXxxInProject`。

**一律返回 404，不返回 403**：403 等于告诉对方「这个 id 存在但不属于你」，可以用来枚举。

⚠️ **`getUserIdFromRequest` 从不抛异常，只返回空串。** 所以下面这行是**没有鉴权**的，
只是看起来像：

```ts
getUserIdFromRequest(request); // ❌ 注释写着 auth check，实际返回值被丢弃
```

真实案例：`shots/[shotId]/split` 就是这么写的，于是知道 projectId + shotId
就能把别人的分镜拆掉，而按标志词扫描的守卫测试**照样是绿的**。
测试已补一条：不允许把鉴权函数当成裸语句调用。

⚠️ **空 userId 会变成一个共用租户。** 路由普遍用 `eq(x.userId, userId)` 圈定归属，
`userId` 为空串时读到的是空集（安全），但**写入会落成 `user_id = ''` 的行**——
`REQUIRE_AUTH=1` 之下任何未认证访客都能建项目、写提示词覆盖。
所以凡是会 `insert` 的路由都必须先过 `requireUser`（它对空串返回 401），
不能只靠「按 userId 过滤」。

**注意 `getUserIdFromRequest` 包含匿名指纹用户**（`src/proxy.ts` 下发的 `ai_comic_uid`），
所以本地匿名使用不受影响，被挡住的只有跨租户访问。

### 8c. 计费闸门 — 默认关闭，三段式扣费

**`BILLING_ENABLED` 未设为 `"1"` 时，`src/lib/billing/gate.ts` 全部退化为空操作**，
生成链路行为与接入计费前完全一致。

这是刻意的：本项目同时是**可自部署的开源软件**（用户自带 API Key，不需要积分）
和**托管 SaaS**（平台统一 Key，按积分计费）。闸门若默认开启，自部署用户装上就会
因余额为 0 而完全不能用。`gate.test.ts` 锁死了这个语义（只认字面量 `"1"`）。

**必须是预扣 → 结算/退还三段式**，不能先生成后扣费：视频生成是 5–10 分钟的
异步长任务，生成完再扣时余额不足的钱已经花在上游了，追不回来。也不能直接扣余额——
失败退款若不留流水账就对不上，并发下「查余额→扣减」两步之间还有竞态。

```
reserve  余额 → 冻结（带条件的原子 UPDATE：WHERE balance >= amount）
settle   冻结 → 扣除（可按真实用量少扣，差额自动退回余额）
refund   冻结 → 余额（失败/超时全额退回）
```

**任何余额变动都必须写 `credit_ledger` 流水**，不允许只改 `credit_accounts`。

⚠️ **流水里的 `balance_after` 一律是「两个桶之和」，且必须在改完账户之后重新读。**
`credits.ts` 用 `getBalance()`（含订阅桶），而 `subscription.ts` / `orders.ts` 一度记的是
**永久桶**、还用的是事务开始时读到的旧值 —— 同一列两种含义，账面不会错（
`credit_accounts` 始终是对的），但**流水就没法用来对账**：用户问「我积分怎么少了」，
翻出来那条 grant 写着余额 11000，而他当时实际有 65973。
`order-lifecycle.test.ts` 会逐条重放全部流水来锁这条。

接入点只有三处（`generateVideo()` 全项目仅一个 handler 调用）：
`generate/route.ts` 的单镜视频与图片生成、`bgm/generate/route.ts`。
定价在 `src/lib/billing/pricing.ts`（纯函数，前后端共用），时长按能力表 clamp，
**报价永不为 0**——为 0 意味着可以无限白嫖。

### 8d. 存储抽象层 — 本地与 OSS 共存，不是一次性切换

产物存储走 `src/lib/storage/artifact-store.ts`，**不要再直接 `fs.writeFileSync` 到 uploadDir**。

数据库里存的是**存储引用**，两种形态并存：

| 形态 | 例 | 何时产生 |
|---|---|---|
| 本地路径 | `uploads/bgm/x.wav` | 未配置 OSS（与改造前一致） |
| OSS 引用 | `oss://bgm/x.wav` | 四个 `OSS_*` 变量齐全时 |

`readArtifact` / `artifactExists` / `deleteArtifact` / `resolveArtifactUrl` 同时认这两种，
所以**存量 1.1GB 本地文件不需要迁移就能继续读**，迁移可按目录分批做、中途中断也不会坏。
这是刻意避免「半途而废的存储层重构」——那种状态下写入与读取路径不一致，
症状是「文件明明生成了但界面显示缺失」，极难排查。

**`saveArtifact` 返回的是实际写入路径（跟随 `UPLOAD_DIR`），不是硬编码的 `./uploads/...`。**
Docker 里 `UPLOAD_DIR=/app/uploads`，硬编码会让引用指向不存在的位置（单测锁死了这条）。

**OSS bucket 必须私有**：`resolveArtifactUrl` 对 OSS 引用签发 1 小时有效的签名 URL；
匿名裸 URL 返回 403（已实测验证）。

⚠️ **OSS bucket 必须配 CORS**，否则视频编辑器会报 `TypeError: Failed to fetch`：
`/api/uploads/_oss/<key>` 是 **302 跳转**到 OSS 签名 URL，跳转后即跨域。
`<img src>` / `<video src>` / 下载都不需要 CORS（所以缩略图看着一切正常），
但 `fetch()` 需要 —— `VideoPreview.tsx` 用 fetch 把视频流喂给 `MP4Clip`，
缺 CORS 时报错且**完全看不出是跨域问题**。
用 `pnpm oss:cors --apply` 配置；**部署到生产必须带上线上域名重跑一次**
（`--origin https://你的域名`），否则线上编辑器会复现同样的报错。
放开 CORS 不等于放开访问：bucket 仍是私有的，请求照样要带有效签名。

**读路径必须和写路径同时改**，否则就是「写进去了但界面显示缺失」：
`uploadUrl()` 是纯客户端函数（46 个调用点），拿不到 OSS 密钥签不了名，
所以它把 `oss://frames/x.png` 映射成 `/api/uploads/_oss/frames/x.png`，
由 `/api/uploads/[...path]` 鉴权后 **302 跳转**到签名 URL。
不在服务端代理下载 —— 那会让所有流量绕经自己的服务器白吃带宽。

⚠️ `ali-oss` 必须列在 `next.config.ts` 的 `serverExternalPackages` 里 ——
它依赖的 `urllib` 会运行时 `require('proxy-agent')`，打包器静态解析不到会直接构建失败。
**这个错误 tsc 检查不出来，只有真跑才会暴露。**

### 8e. Provider 存储桥 — DB 存 `oss://`，provider 只认本地文件

**所有 provider 出口都过 `withArtifactBridge` / `withVideoArtifactBridge`
（`src/lib/ai/provider-artifact-bridge.ts`，接在 `provider-factory.ts` 的两个工厂出口）。**

每个 provider 都是照着「素材是本地文件」写的（`fs.readFileSync(path)` 转 base64：
seedance 的 `toDataUrl`/`toAudioDataUrl`、openai 的 `fileToBase64DataUri`、kling / jimeng / veo 同理）。
产物迁到 OSS 之后 DB 里存的是 `oss://frames/x.png`，这些读取要么抛错，要么被上游的
「文件存在吗」检查提前静默丢弃。桥负责把 OSS 引用先下到临时文件再交给 provider，调用结束即清理。

**不碰三类引用**：`asset://`（火山私域素材 ID，必须原样传）、`http(s)://`（已是公网地址）、
以及**参考视频**（Seedance 2.5 的 `reference_video` 只接受 URL，下成本地文件反而走不通）。

新增 provider 不需要知道 OSS 存在 —— 只要它走 `createAIProvider` / `createVideoProvider`
就自动享受这一层。

### 8f. `shotFrameUsable` — 语义是「引用可用」，不是「本地磁盘上有」

`src/lib/storyboard/frame-reference.server.ts` 的 `shotFrameUsable(ref)`
（旧名 `shotFrameFileOnDisk`，2026-09-02 改名）：

- `oss://` / `asset://` / `http(s)://` → **一律判为可用**（DB 里的引用即事实）
- 本地路径 → 仍查磁盘（自部署、未配置 OSS 的情况）

保持同步函数：它在生成路径上每个角色、每个道具各调一次，改成异步的 `artifactExists`
等于给每次调用加一个网络 HEAD。真正的悬空引用交给 provider 那一步显式报错 ——
比静默丢弃好排查得多。

### 8g. 预演台（白模预演）— 先便宜地验运镜，再花钱出正式片

`action = "previz_generate"` → `handlePrevizGenerate`（`generate/route.ts`）。

与正式生成刻意拉开的差别，都是为了**便宜且只回答一个问题**（运镜对不对）：
480p、不生成音频、**不传角色定妆图/角度图/音色/道具**（传了会把模型往"出正式彩色画面"上拽），
时长用镜头完整时长（运镜要整段看才判断得准）。提示词在正式提示词外面**首尾各夹一段白模覆盖**
（`wrapAsPrevizPrompt`，`src/lib/ai/prompts/previz.ts`）——只放一处压不住正文里大量的材质与光影描写。

**必须有 `anchorFirst`**：参考生视频任务在 2.5 下会显式声明 `omni_reference_task_type="reference"`，
一个参考素材都不带就是自相矛盾的请求。

确认后的那条经 `shots.previzSelectedId` 参与正式生成：`decidePrevizReference`
（`src/lib/storyboard/previz-reference.ts`）判定能不能用，能用则由
`resolveArtifactUrlForUpstream(ref)` 签一个 **6 小时、不做窗口对齐**的 URL
（窗口对齐是为浏览器缓存服务的；上游排队后才来拉，TTL 卡紧会变成任务启动后才报的异步错误），
作为 `@视频N` 加入 `multimodalRefs`。**每条拒绝路径都必须给出理由**并经 `capabilityNotes` 回传前端 ——
用户点过"选用这条运镜"却毫无关系地出片，是最难排查的一类问题。

### 8h. 3D 导演台 —— 机位是算出来的，不是让 LLM 猜的

`src/components/editor/previz-stage/` + `src/lib/previz/stage-types.ts`。

**它和预演台的分工**：预演台回答「模型会怎么理解我的运镜」，导演台回答「运镜到底该是什么」。
后者原本靠 LLM 凭空写 `startFrameDesc` 的第一要素（机位空间坐标）—— 那是 LLM 最不擅长的，
所以约定 14 才要用那么大篇幅去约束它。3D 摆位是确定的、免费的、秒级的。

**机位刻意不是自由 6 自由度**，而是相对某个主体的极坐标（`CameraRig`：
主体 / 方位角 / 距离 / 机位高度 / 焦距）。因为约定 14 要的就是
「摄影机在[主体][方位][距离]，镜头高度[身体部位]」这四个量 —— 存自由位姿的话回写时
还得反解「它在谁的什么方位」，而多人场景里这个反解是有歧义的。

**景别是算出来的**：`distanceForShotSize` / `shotSizeForDistance` 双向换算，
所以景别词与机位坐标永远自洽，不会出现「写着近景、机位却在 8 米外」。

**盒体人偶，不引外部模型资源**：零授权问题，且场景 JSON 里不会出现素材路径 ——
`editor_state` 正是因为内嵌路径给存储脚本留下了扫描盲区（见 `verify-editor-state-refs.ts`）。

**参考视频的时长限制在提交前挡下**（能力表 `refVideoLimits` → `decidePrevizReference`）：
这类限制是**异步**校验的 —— 任务照常创建、几十秒后才报错，用户看到的只是「又失败了一次」，
失败信息里根本不会出现「运镜预演」四个字。本地 3D 渲染的时长等于镜头时长，
而镜头时长是用户填的，所以 <2s 的快切镜头是真实可达的。
**不确定的模型就不声明限制** —— 编一个数字会把本来能用的预演挡掉，比让上游报一次错更糟。

**导出的构图图写进 `shots.previz_layout_url`，刻意不写 `anchor_first`**：
后者是真要送去生成视频的首帧，被一张灰盒渲染图覆盖是不可逆的。

**人形代理是骨骼层级，不是一堆盒子**（`src/lib/previz/humanoid.ts`）：姿态 = 一组关节角度，
所以**两个姿态之间可以插值** —— 这是运镜视频里「站起来 / 蹲下去」能平滑演出来的前提。
第一版用互不相干的盒子摆位，「站」和「蹲」是两组毫无关系的坐标，根本没法过渡。
造型用胶囊体拼，仍然零外部模型资源。

**运镜时间线（P3）**：关键帧把**相机与走位放在一起**（`PrevizKeyframe`），不是两条轨道 ——
预演要验的是「镜头这么动的同时人这么走」，分开对齐纯属手工负担，而且分开之后
「这一刻画面长什么样」就不再是一个能直接截图的状态。

⚠️ **编辑态必须绑定到"当前选中的那一帧"**（`editingT` + `patchFrame`）。
最初编辑态就等于 t=0，于是"拖到 3.5s、改机位、加关键帧"会把 0s 一起改掉，
首尾同机位、运镜视频等于静止画面 —— 实测踩过。

**导出走逐帧渲染 + 服务端 ffmpeg 拼帧**，不用 `captureStream` + MediaRecorder：
后者在 WebGL canvas 上实测一帧都抓不到（只产出 110 字节空 webm）。逐帧的好处是
**帧数严格等于 fps × 时长**，渲染慢只是导出久一点，不会丢帧或时长漂移。
截图用同步的 `toDataURL` 而不是 `toBlob`：标签页被遮挡时浏览器把合成节流到 1Hz，
`toBlob` 每帧要等一秒（实测 1021ms → 48ms）。

产物写进 `shot_previz`（`model_id = "local-3d"`），**后端零新增** ——
`shot_previz → previz_selected_id → decidePrevizReference → @视频N` 这条链路
不关心视频是谁生成的。意义：运镜验证从"调一次 Seedance"变成"本地渲染几秒"。

**背景板**（`StageBackdrop`，挂在**每镜**的 blocking 上，不是一集共用的 scene）：
把本镜 anchorFirst 贴成一块正对起始机位的板，摆位时能对着真环境的透视放人。
挂在镜上而不是集上，是因为每个镜头的环境就是它自己的首帧 —— 挂在集上的话，
摆第 12 镜看到的是第 1 镜的背景，错的次数远多于对的。天空色则确实属于「景」，留在集上。
板子走 **three 的 layer 1，只在机位视图出现**：它有十几米宽，编辑视角环绕时会整个把画面
糊住，而编辑视角要看的本来就是空间关系。与「从画面反推 3D 场景」是两回事 ——
那个是单目深度估计，对动漫画面尤其不可靠，明确不做。

**回写（P2）只碰算得出来的那两句**（`src/lib/previz/describe.ts`，纯函数无 LLM）：
`startFrameDesc` 的要素 1（机位空间坐标）与要素 2（景别 + 取景范围），
以及 `cameraDirection` 的起幅/运动方式/速度/落幅。**叙事目的不算** —— 那是导演意图不是几何量，
从原文里保留；取不到时留显眼占位而不是编一个。角色姿态也不写：盒体人偶只有五档姿态，
写进去会把「左手扶额、右臂垂落」换成「站立」，是纯粹的降级。

⚠️ **合并必须是外科手术式的，且必须经用户确认再落库。** 真实库里**每一条**
`startFrameDesc` 都把景别和角色走位写在同一个子句里
（「中景平视，角色甲位于画面右侧偏后、右脚前跨左膝微弯……」），
按「这句含景别词就整句替换」去做会把整段走位删掉 —— 而走位正是这里算不出来、
也最不该丢的内容。所以分三种形状处理，全部无损：整句就是景别才整句换；
混写时只就地换掉开头那个景别词；原文没写景别才插一句新的。
`startFrameDesc` 是帧生成的唯一事实来源（约定 14），静默覆盖光影或情绪子句不可逆。

**当前进度**：P1（摆位 + 导出构图图）、P2（机位与景别回写）、
P3（运镜时间线 + 本地渲染运镜视频）、背景板均已完成。

### 8i. 订阅 / 套餐 —— 两种寿命的积分

`src/lib/billing/plans.ts`（套餐是**代码常量，不建表**，与 `VIDEO_CAPABILITIES` 同一套做法；
可审计性由订单快照保证）、`subscription.ts`、`orders.ts`。

⚠️ **积分体系假设「平台出 Key、用户花积分」，而生成链路目前是 BYOK（用户自带 Key）——
两者尚未对接。** `provider_secrets` 按用户存，全仓没有管理员概念（`admin`/`role` 零命中），
所以今天真有人注册，他会**既付积分又要自带 API Key**。
对接需要：管理员概念 + 平台 Key 解析 + 锁设置页 + `models/list` 改读管理员配置 + 全局并发调度；
前提（上游地址只能来自服务端）见约定 8n，已完成。**建议与支付接入一起做** ——
没有支付渠道用户充不了值，先做完只会让平台 Key 的暴露面提前存在几个月。
清单见 `docs/PLAN-2026-09-SEEDANCE25-SAAS.md` 的「待办清单」B 节。

**产品前提**：这门生意几乎是纯成本转嫁（2.5 · 720p 上游 ¥1.51/秒），**积分本身就是商品**，
不存在一层零边际成本的功能能单独卖钱。所以订阅不是"解锁功能"，而是**按月产能承诺**：

| 来源 | 寿命 | 存哪 |
|---|---|---|
| 订阅每月发放 | **周期末清零** | `credit_accounts.subscription_balance` |
| 加油包购买 | **永不过期** | `credit_accounts.balance` |

消费顺序：**先花会过期的**。退还**按原路**（拆分记在 `usage_records.reserved_from_subscription`）——
少了这条就能套利：订阅积分预扣 → 取消 → 退进永久桶，把会过期的洗成永久的。

**为什么是双余额而不是积分批次**：批次是通用解，但要求退款退回原批次；而本项目同一时刻
最多只有一个会过期的桶（当前订阅周期），批次退化成一个字段 + 一个到期时间。
将来若要卖"限期促销积分"（多个到期日并存）才需要升级成批次，那时拆分记录就是迁移依据。

**周期滚动不用 cron**：项目没有调度器，改成惰性滚动 —— 天然幂等、天然补偿，
也没有"任务没跑起来所以没发积分"这种故障模式。

⚠️ **裸 SQL 写时间戳必须换算成秒**：Drizzle 的 `mode:"timestamp"` 存的是秒，
写毫秒不会报错，只会被当成公元五万年读出来 —— 于是「周期是否已过」永远为否，
**订阅再也不会滚动而且毫无征兆**。各文件里的 `toDbTime()` 就是为此。

**功能位的执行在 `plan-limits.ts`**（`plans.ts` 声明、`subscription.ts` 解析、这里落地）。
接入点三处：视频生成、白模预演（同一个模型、同一份并发额度）、创建项目。

⚠️ **套餐限制一律拒绝，不做静默降级**。能力表那边的 `downgradeVideoMode` 降级是对的
（「这个模型做不到」），但套餐限制是「你还没为这个付费」—— 悄悄把 720p 降成 480p，
用户会**照着 720p 的预期付掉积分**、拿到 480p 的片子，且看不出哪里出了问题。
返回 **403 + `code: "PLAN_LIMIT"`**，与 402「余额不足」区分开：充积分解决不了套餐限制，
前端要给的是完全不同的引导。（这不违反「一律 404」那条 —— 那条针对资源归属，
403 会泄漏「这个 id 存在但不是你的」；套餐限制不涉及任何资源是否存在的信息。）

**并发直接数 `usage_records` 里 `status='reserved'` 的条数**，不另建任务表 ——
预扣到结算/退还之间正好就是任务在飞的那段时间。**只数 15 分钟内的**：进程在预扣与结算
之间崩掉会留下永远 `reserved` 的记录，全算上的话用户会被自己的历史残骸永久锁死。
（这些残骸同时冻结着积分，那是另一个问题：自动退还有「任务其实成功了、钱却退了」的风险，
需要单独决策。）**认不出的分辨率写法返回 0 即不挡人** —— 各家写法不统一
（`480p`/`720P`/`768P`/`2K`/`4k`），宁可漏挡也不要把付费用户挡在门外。

**BILLING_ENABLED 未设为 "1" 时**：套餐接口返回空列表、功能位返回 `UNLIMITED_FEATURES`、
下单直接拒绝、UI 整块不渲染。与约定 8c 是同一条原则。

**支付回调**（`/api/billing/callback/[channel]`）没有用户会话，身份由渠道签名证明，
已在 `route-auth-guard.test.ts` 的 `NO_AUTH_ALLOWLIST` 登记。目前只有 mock 通道，
真实渠道需要商户号（企业资质）。

### 8j. 任务队列与 worker 外置 —— ffmpeg 不跑在请求路径上

**规则没有例外：服务端 ffmpeg 一律进队列。** `episode_render`（剪辑台导出）与
`episode_merge`（多集拼接）原先直接跑在请求处理函数里，导出一次把 HTTP 连接挂几分钟：
过任何反向代理都会撞空闲超时、部署重启一次正在跑的导出全丢、还和请求处理抢同一份 CPU。
留一个例外，下次就会有人照着它再写一个。

代价是**进度不能再用 SSE 推给发起请求的连接**：worker 在别的进程里。
改为 handler 写 `tasks.progress`，客户端拿 taskId 轮询 `GET /api/tasks/[id]`。
好处顺带来了 —— 关页面、刷新、服务重启，任务都还在。

⚠️ **handler 里出错必须 `throw`。** 原实现把错误当成一条 SSE 事件发出去然后正常结束；
搬进队列后那等于「成功」—— 任务成败只看 handler 抛不抛异常。

**`WORKER_IN_WEB` 默认为开**（未设为 `"0"` 即开）。自部署用户 `docker run` 单个容器
就该能用全部功能，默认关掉的话他们点了导出会永远停在「排队中」且毫无线索。
这与 `BILLING_ENABLED` 默认关闭是同一条原则的两面：**默认值要让单机装机即用**。
托管部署把 web 侧设成 `0`，由 compose 里的 worker service 承担。

⚠️ **独立 worker 必须带 `--conditions=react-server` 启动**（`pnpm worker` 已带）。
生成链路上大量模块 `import "server-only"`，那个包在 Next 打包器下解析到空模块，
在**纯 Node** 下解析到默认入口 —— 而默认入口就是一句 `throw`。

**worker 必须与 web 同机**（Compose 两个 service 共享 volume 也算）：任务表在 SQLite 里，
WAL 支持同机多进程但不支持跨网络文件系统。**要把 worker 挪到另一台机器，得先迁 PostgreSQL**
（届时认领语句要改成 `FOR UPDATE SKIP LOCKED`；已决定迁则只留 PG，compose 自带一个，
不维护双方言 schema）。Docker 里 worker 镜像基于 `deps` 而不是 standalone 产物 ——
standalone 没有 `src/` 也没有 tsx。

**队列的三条硬要求**（`task-queue/queue.ts`，真库单测锁死）：
认领必须是**一条**语句（分两步做，两个 worker 会各跑一遍 ffmpeg）；
失败要**退避**再排队（上游 429 立即重排会打成紧密循环）；
`running` 超时要能**回收**（走与普通失败相同的 `failTask` 路径，重试语义自动一致）。

⚠️ 又一次的秒/毫秒：`scheduled_at` 是 `mode:"timestamp"`（秒），原实现拿
`now.getTime()`（毫秒）去比，`scheduled_at <= <毫秒>` 恒为真 —— **延迟执行静默失效**。
当时没人传 `scheduledAt` 所以没暴露，重试退避一加上去就是致命的。同约定 8i。

### 8k. 公网暴露 —— 默认关，开之前四个开关缺一不可

**默认配置是「只能本机访问」，这是刻意的**：不知情的人 `docker compose up` 一份
不会意外把数据裸放在公网上，暴露必须是显式的选择。

历史上这里有三个真实的洞，全部在 2026-09-04 端口对公网开放前实测复现并堵掉：

| 洞 | 表现 | 开关 |
|---|---|---|
| `getUserIdFromRequest` 的回退链认**未签名**身份 | `curl -H "x-user-id: <某人的 ULID>"` 直接读到别人全部项目 | `REQUIRE_AUTH=1` |
| ~~`AUTH_SECRET` 未设时回落到代码里的默认值~~ | **本仓库是公开的** —— 任何人都能照着签一个合法 cookie | 已改为**没设就自动生成一把随机密钥并落盘**（数据目录下 `.auth-secret`），不再有硬编码回落；显式设 `AUTH_SECRET` 行为不变 |
| 登录接口零限速 | scrypt 只是把「几小时爆破」拖成「几天爆破」，不是挡住 | 无开关，`auth-rate-limit.ts` 常开 |

加上监听地址，公网暴露前必须同时满足：

```
REQUIRE_AUTH=1              # 只认签名 cookie，未签名的请求头/cookie 一律不认
ALLOW_REGISTRATION=0        # 关掉自助注册，否则任何人可以给自己开号
AUTH_SECRET=<随机值>         # 可选：不设会自动生成并落盘（见下）
APP_BIND=0.0.0.0:3007       # 默认 127.0.0.1:3007
```

⚠️ **`REQUIRE_AUTH` 只认字面量 `"1"`，未设时行为与改造前完全一致** —— 与
`BILLING_ENABLED`（约定 8c）、`WORKER_IN_WEB`（约定 8j）是同一条原则：
**默认值要让单机装机即用**，`require-auth.test.ts` 锁死了这个语义。

⚠️ **安全组和监听地址是两道独立的闸。** 云控制台放行端口之后仍然连不上，
八成是容器只绑了 `127.0.0.1` —— 两道都开才通。

限速按 **IP 和用户名两个维度**计数取更严的那个：只按 IP 换个 IP 就绕过，
只按用户名则用不存在的用户名喷洒永远不触发。登录成功清零，避免正常用户把自己锁在外面。

线上部署的现状、数据库权威副本在哪、以及**服务器停用时的操作步骤**，
见 [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)。


### 8l. 全新安装必须能建起库 —— 迁移基线 + 迁移锁

**每加一条迁移，都要问一句「空库跑一遍这条链还能建起来吗」。**
2026-09-04 部署到服务器时发现：**迁移链根本无法从零建库**，`0001` 之后某处就断了，
症状是 worker 反复重启报 `no such table: character_assets`。
这不只影响这次部署 —— **每一个自部署用户、每一次 CI 建库都撞得上**，
只是本地库是历史演进来的，从来没人从零跑过，所以一直没暴露。

修法是**基线压缩**（`drizzle/baseline/`）：

| 文件 | 内容 |
|---|---|
| `baseline/schema.sql` | 从健康库导出的完整 DDL（32 条语句） |
| `baseline/meta.json` | `throughTag` —— 这份基线覆盖到哪条迁移（含） |

`applyBaselineIfFresh()` 在**确认是空库**时应用基线，并把 `throughTag` 及之前的迁移
标记为已应用；之后新增的迁移照常增量执行。存量库完全不受影响。

⚠️ **判空库的 SQL 里 `_` 是通配符。** 初版写的是
`name NOT LIKE '__%'` —— 本意是排除 `__drizzle_migrations`，实际把**每一张表**都排除了，
于是任何库都被判成空库，**基线会盖到生产库上**。必须写
`NOT LIKE '\_\_%' ESCAPE '\'`。这条有专门的回归测试。

**迁移必须串行**：web 与 worker 两个容器同时启动会同时跑迁移。
`acquireMigrationLock()` 用 `__migration_lock` 表串行化，等锁上限由
`MIGRATION_LOCK_WAIT_MS` 控制（测试用；`Atomics.wait` 会阻塞事件循环，
所以不能用 `setTimeout` 做超时）。

**新增迁移后自检**：`rm -rf /tmp/fresh && DATABASE_URL=file:/tmp/fresh/x.db pnpm tsx -e "..."`
起一次，或直接跑 `baseline-schema.test.ts`。基线过期时用 `pnpm baseline:dump` 重导。

### 8m. 数据库是唯一不可再生的东西 —— 备份与同步

帧图、视频、BGM 全都能重新生成（花钱花时间而已）；**剧本、分镜、角色设定、
剪辑状态只有一份**。所以 DB 的处置规则与产物完全不同。

**备份**（`scripts/backup-db.ts`，`pnpm db:backup`）：

- 用 better-sqlite3 的 `.backup()`，**不是 `cp`** —— 开着 WAL 时直接拷文件会漏掉
  尚未合并的写入，拷出来的库看着正常、实际少数据，且当场发现不了
- 走 `saveArtifactFromFile`，配了 OSS 就传 OSS（服务器上还走内网端点不计流量），
  没配的自部署用户落在 `uploads/backups/`
- **只上传 / 只列举 / 只删除，从不下载** —— 下行流量包只有 2 GB/月且打穿过一次
- 实测 6.1 MB → 1.09 MB，默认保留 30 份
- **`docs/` 与 `deploy/` 另有一条**（`pnpm docs:backup`，`deploy-ecs.sh` 结尾自动跑）：
  这两个目录在 gitignore 里，代码在 GitHub、数据在 OSS，唯独它们只有本机一份，
  而 `docs/DEPLOYMENT.md` 正是「服务器没了怎么恢复」的手册。
  排除 `docs/APIs`（厂商 PDF，可重新下载）后整包约 0.3 MB。
  **刻意不挂服务器 cron** —— 服务器上那份是上次部署的快照，挂上去只会每天备份一份过期副本；
  文档只在本机编辑时变化，备份该跑在它变化的那一端。手动触发为主，`deploy-ecs.sh` 结尾顺带一次

⚠️ **产物引用列清单（`scripts/storage-audit.ts` 的 `REF_COLUMNS`）必须随 schema 同步。**
它不只给审计用，`storage-migrate` / `prune-orphan-files` / `verify-editor-state-refs`
都读它。漏一列的后果按严重度递增：审计看不见 → 存量迁移不迁它 →
**孤儿清理把正在用的文件当成没人引用删掉**。最后这条真实发生过
（`episodes.editor_state` 内嵌路径没被扫，差点删掉在用的 6 个 BGM），
而 migration 0059/0060 的三列又漏了一次。现已由
`storage-audit-columns.test.ts` 结构性盯着：schema 里带 url/path/image 的列，
要么在清单里，要么在测试的 `NOT_OUR_ARTIFACTS` 里登记理由。

**同步**：本地与服务器各有一份 SQLite，**服务器是权威副本**（它读写 OSS 走内网
不吃流量包，worker 也在那边）。两边只单向流动：服务器 → 本地。
`pnpm dev` 启动前会比一次指纹并提示，但**默认永远不自动覆盖本地库**。
操作细节与服务器停用手册在 `docs/DEPLOYMENT.md`（本地文档，未随仓库分发）。

### 8n. 上游地址必须来自服务端 —— 平台统一 Key 的前提

生成请求里的 `modelConfig` **整个来自客户端**（providerId / protocol / baseUrl / modelId），
服务端只把 `apiKey` 换成自己库里那一份。也就是
**「密钥从服务端取，地址听客户端的」**。

BYOK（用户自带 Key）下这无害：你的 Key 发到你指定的地址。但它有两个后果：

1. **平台统一 Key 模式下这是直接的密钥外泄** —— 把 `baseUrl` 换成自己的服务器，
   一个请求就收到平台 Key。所以「管理员配模型、用户买积分订阅」那套要落地，
   这一条是**前提**而不是优化。
2. **今天就存在的 SSRF 面** —— 服务端会向调用方指定的地址发请求。

规则：**协议与地址一律从服务端存的 provider 记录取**
（`user_client_prefs.model_store_json`，见 `resolveTrustedEndpoint`），
请求体里的同名字段只作参考、不作数；**服务端没有该 provider 的记录就不注入密钥**，
绝不退回去用请求体里的地址。落地在 `hydrateModelConfigSecrets`
（注入密钥的唯一入口）与 `/api/bgm/generate`。

⚠️ **私网地址默认放行**：自部署用户会把 provider 指向本机（Ollama、自建网关），
一刀切禁掉等于废掉这类用法。只在 `BILLING_ENABLED=1`（平台模式、机器上还有别人）
时才拦环回 / 私网 / 云元数据（169.254.169.254）。与约定 8c / 8j / 8k 同一条原则：
**默认值要让单机装机即用**。

**还没做的那半边**：`/api/models/list` 同样会拿客户端给的 `baseUrl` 发服务端请求，
但它用的是**请求体里的 apiKey**（设置页里还没保存的那个），不是库里的密钥，
所以不构成存量密钥外泄，且已经要求登录。**接平台 Key 时这里要一起改成读管理员配置。**

### 8o. 下行流量是唯一紧的那项 —— 浏览器侧必须少下、下小的

**OSS 三个资源包里只有下行流量包会打穿**（2 GB/月，2026-09-02 已经因此欠费停服过一次；
存储与请求都有两个数量级的余量）。而**服务端读 OSS 走内网端点是不计费的** ——
所以省流量这件事，能优化的只有**浏览器**那一侧。

⚠️ **常见误解：以为访问线上站点就不吃流量包。** 不是。`/api/uploads/_oss/<key>` 是
**302 跳转**到 OSS 公网签名 URL，跳转之后是**浏览器直接从公网下载**。
`OSS_INTERNAL=1` 只让服务端自己的读写免费。本地开发和线上访问在流量上完全一样。

三条规则，按贡献大小排：

**① 界面上的图一律用缩略图**（`uploadUrl(ref, { w })`，见 `src/lib/utils/upload-url.ts`）。
帧图是 Seedream 出的原图，平均 **1.09 MB**，而卡片上的渲染宽度只有 44–200 px。
宽度是**闭集** `160 / 320 / 640` —— 每多一档就多一份 OSS 处理结果和一个浏览器缓存键。
实测 4448 KB 的定妆图 → w_320 只有 **7.4 KB**。

实现是在签名 URL 上加一段 `x-oss-process`，**不是预生成一份缩略图存起来**：
预生成要新增 DB 列 + migration + 回填脚本 + 同步 `REF_COLUMNS`（约定 8m 那个坑），
而实时处理零新增存储、零迁移，存量的图立刻就有缩略图。

⚠️ 指令**必须签进 URL**（`signatureUrl` 的 `process` 选项）。私有 bucket 下事后往
URL 上贴 `x-oss-process` 会让签名失效，直接 403。

⚠️ **只有图片能缩。** `uploadUrl` 拿到的是不透明的存储引用，分不清图片和视频，
所以服务端按扩展名兜底**静默忽略** —— 传错了只该「没省到流量」，不能让视频播不出来。

⚠️ **灯箱、预览浮层、导出、下载一律用原图。** 也就是「点开看大图」的那一次才下原图。

⚠️ **同一处的探测与渲染必须用同一个宽度。** `useFrameImageMissing` 是靠**真的把图下下来**
判断文件在不在的，它和渲染缩略图的组件成对使用 —— 宽度不一致等于把每张图**下载两遍**。

**② 取 OSS 产物一律走 `mediaCache.ts` 的 `fetchArtifact()` / `fetchMedia()`，不要裸 `fetch`。**
它按**稳定的存储引用**（不是逐次变化的签名 URL）做 Cache Storage 持久缓存，
重复浏览为 0 流量；并且带 403/5xx 重试（重试用 `cache:"reload"`，见已知陷阱表里
「缓存的 302 指向过期签名」那条）。

**③ 视频用 480p 代理，不用源片**（`shots.preview_url`，见已知陷阱表）。导出仍用源片。

**本地引用（未配 OSS 的自部署）不做缩略图**：文件就在本机磁盘上，不产生流量也不产生费用，
为它引入一个图片处理依赖不划算。与 `BILLING_ENABLED` / `WORKER_IN_WEB` 同一条原则：
**默认值要让单机装机即用**。

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

`startFrameDesc` / `endFrameDesc` 是图像生成的唯一画面依据，必须自包含**五要素**（机位空间坐标/景别取景范围/角色姿态/主光/情绪身体解剖）。`emotion`、`framing`、`lightingAtm` 三个冗余字段已从 `schema.ts` 和全部代码路径移除，所有信息统一写入 `startFrameDesc`。

历史注记：migration `0042`/`0043` 当年想用「建新表→拷数据→删旧表→改名」删掉它们，
但执行到一半失败又被误记为已应用，三列一直留在库里（详见已知陷阱表）。
2026-09-02 由 migration `0057` 用 `ALTER TABLE ... DROP COLUMN` 补删完成 ——
better-sqlite3 内置 SQLite 3.51 原生支持该语法，不必再走重建表那套高风险流程。

五要素用全角分号「；」分隔，形成五个独立子句：

```
// ✅ 正确（五要素）
startFrameDesc: "摄影机在角色正前方约1.5米，镜头高度胸口平视；
                 近景平视，取景胸口以上；
                 李明站在画面左三分之一，左手扶额，右臂垂落；
                 左侧柔和月光冷蓝侧逆光均匀铺洒，轮廓光勾勒角色肩线，面部半逆光阴影留存；
                 嘴角绷紧眼眸下垂——书房烛光"

// ❌ 错误：缺少机位空间坐标（第一要素）
startFrameDesc: "近景平视，李明站在画面左三分之一，左手扶额，右臂垂落，
                 左侧冷调月光侧逆光勾勒轮廓，嘴角绷紧眼眸下垂"
```

**startFrameDesc 五要素**（缺一不可，严格按此顺序）：
1. **机位空间坐标**（首要素）——摄影机与主体的物理位置关系。格式：`摄影机在[主体][方位][距离]，镜头高度[身体部位]`
2. **景别/视角 + 取景范围**——景别（远/全/中/近/特写）+ 镜头能看到的范围（如"取景胸口以上"）
3. **具名角色精确位置与静止姿态**（不写运动过程）
4. **主光完整叙述句**（颜色 + 方向 + 铺洒方式 + 受光效果，如"左侧柔和月光冷蓝侧逆光均匀铺洒，轮廓光勾勒肩线，面部半逆光阴影留存"）
5. **情绪的身体解剖表现 + 场景背景锚定词**（如"嘴角绷紧眼眸下垂——书房烛光"，禁用"神情坚定"等形容词）

### 15. 导演前思考步骤 — shot_split 和 batch_storyboard_rewrite 共同遵守

**问题根因**：分镜质量差的根本原因是"从剧情动作出发"写分镜——AI 直接把剧情描述翻译成画面，而不是先做导演决策。好的分镜是摄影机优先，不是动作优先。

**强制导演思考步骤**（在两个核心路径的系统提示词里均已编码）：

在写任何技术字段之前，AI 必须先回答三个问题：

| 问题 | 内容 |
|---|---|
| **Q1 单一视觉概念** | 这个镜头在视觉上只关于一件事，是什么？（不是剧情动作，是视觉 IDEA） |
| **Q2 核心反差对** | 画面里什么和什么形成对比？（强迫找到一个：静止vs动态 / 平静vs混乱 / 前景秘密vs中景无知 / 局部vs全貌） |
| **Q3 主动排除** | 明确不拍什么？（排除本身是叙事选择，如"全程不拍脸，只拍腿部——悬念留给下一镜"） |

**编码规则**：答案写进 `sceneDescription` 的第一行：
```
【视觉核心：[Q1] | 反差：[Q2] | 排除：[Q3]】 + 环境描述...
```

**正反例**：

```
剧情动作（错误出发点）：
"李明走进房间看到了灵瑶"

导演视角（正确出发点）：
Q1: 门口作为情感分界线，进门那一刻的迟疑比任何对白都重要
Q2: 李明脚步停住（静止）vs 灵瑶背对镜头（不知道他来了）
Q3: 不拍灵瑶的脸，保留悬念，脸的揭示留给下一镜

sceneDescription 写法：
【视觉核心：门口作为情感分界线，进门停顿是核心画面 | 反差：李明停在门口（静）vs 灵瑶背对镜头（未察觉）| 排除：不拍灵瑶的脸，不让角色进入房间内部】 书房内，暖调台灯光自右侧照亮灵瑶侧背，门框投落冷调月光线条...
```

**实现位置**：
- `registry.ts` → `SHOT_SPLIT_DIRECTOR_CONCEPT_RULES`（shot_split 路径）
- `storyboard-supervision.ts` → `STORYBOARD_REWRITE_SYSTEM` 导演前思考段落（batch_storyboard_rewrite 路径）

---

## AI Prompt 增强系统（⚠️ 生产链路已停用）

`src/lib/ai/prompt-enhancer.ts` 提供按 protocol 定制的 prompt 改写：

- `enhanceVideoPrompt(rawPrompt, protocol, textProvider)` — 视频 prompt
- `enhanceImagePrompt(rawPrompt, protocol, textProvider)` — 图片帧 prompt

**这两个函数目前在生产代码里零调用方**，仅被 eval suite（`src/lib/evals/cases/prompt-enhancement.ts`）
和单测引用。控制它的「AI 增强」开关与 `projects.enhance_prompts` 列已于 migration 0047 移除（见约定 4）；
视频提示词改走直出架构（约定 12），不再经过 LLM 改写。

因此**新增 provider 时不需要**往 `VIDEO_ENHANCE_SYSTEM_PROMPTS` / `IMAGE_ENHANCE_SYSTEM_PROMPTS`
里加条目 —— 加了也不会在生产中生效。文件与 eval 保留，是为了将来若要恢复该能力时不用从零重写；
真要恢复，需要先决定在哪个环节调用、以及如何与直出架构共存。

---

## 提示词管理（PROMPT_REGISTRY）

`src/lib/ai/prompts/registry.ts` 的 `PROMPT_REGISTRY` 数组是提示词管理页面的唯一数据源。所有在 UI 中可编辑的提示词都必须注册在此。

### 当前注册的提示词（按分类）

**剧本（script）**：`outline_expand`、`script_generate`、`script_parse`、`script_split`

**角色（character）**：`character_extract`、`import_character_extract`、`character_image`、`beauty_image`、`combat_image`

**分镜（shot）**：`shot_split`、`split_shot_single`、`batch_storyboard_rewrite`、`batch_plot_optimize`

**画面（frame）**：`frame_generate_first`、`frame_generate_last`

**视频（video）**：`video_generate`

### 废弃的提示词（不在 registry，但有 DB 覆盖清理）

- `single_shot_rewrite` — route handler 已移除，shot-drawer 按钮已删除，改用 `batch_storyboard_rewrite`
- `ref_video_prompt` — Vision-LLM 视频精炼路径已被直出架构替代（`buildDirectVideoPrompt`）
- `character_state_router` — LLM 状态路由已移除（2026-06），改为 `isDefault=1` 直接选图

三者保留在 `prune-stale-prompt-overrides.ts` 的清单中，确保旧用户的 DB 覆盖数据被清理。

### 新增提示词到 registry 的规范

1. 在 `registry.ts` 定义 `PromptDefinition` 对象（参考 `batchPlotOptimizeDef` 模式）
2. 添加到 `PROMPT_REGISTRY` 数组
3. 在 `messages/zh.json` 的 `promptTemplates.prompts.*` 下添加 `nameKey` 和 `descriptionKey` 对应的中文翻译
4. 如果该提示词在 handler 内部通过 `resolvePrompt()` 读取，确保传入 `userId` 和 `projectId`

### batch_plot_optimize — 全集剧情优化

`action = "batch_plot_optimize"` → `handleBatchPlotOptimize`：

- **功能**：编剧视角批量重写全集 `shots.prompt`（场景描述）
- **只写 `shots.prompt`**，不触碰 `startFrameDesc`/`endFrameDesc`/`motionScript`/`cameraDirection`
- **分块处理**（每块 5 镜）+ 全集只读上下文（防止跨 chunk 跳跃）+ 降级逐镜重试
- **叙事跳跃修复策略**：四类跳跃（时间/因果/动作/情绪）**只用文字桥接**（`△承接上镜:` 前缀），**不允许插入新镜头**（分块处理与插镜架构不兼容；需要插镜用「AI拆分分镜」手动操作）
- **System prompt**：`PLOT_OPTIMIZE_SYSTEM`（`storyboard-supervision.ts`），可通过提示词管理页面覆盖
- **UI 入口**：分镜页「优化剧情」按钮（位于「批量优化文本」左侧）

---

## S 级分镜标准集成

系统所有 AI 生成分镜内容的路径均已集成 S 级分镜标准（首帧/尾帧/videoScript 四要素/微表情词汇/禁用模板列表）。

### 覆盖的产线路径

| 功能入口 | 文件 / Key | 说明 |
|---|---|---|
| AI 自动生成（大纲扩写） | `outline-expand.ts` / `outline_expand` | 故事大纲 → 多集 S 级剧本 |
| 解析分镜（散文） | `registry` → `shot_split` | 一次 LLM 切镜并写全字段；内置导演前思考步骤（视觉核心/反差/排除），写入 sceneDescription 第一行 |
| 解析分镜（结构化 md） | `finalizeExtractedShotsForDb` | 无 LLM，缺字段保持 null |
| 全集分镜批量重写 | `storyboard-supervision.ts` / `batch_storyboard_rewrite` | 全集七律视觉连续性重写：LLM 一次读入全部分镜，每镜先完成导演前思考（Q1视觉核心/Q2反差/Q3主动排除），再批量重写五要素帧描述/motionScript/cameraDirection 并写回 DB |
| 全集剧情优化 | `storyboard-supervision.ts` / `batch_plot_optimize` | 编剧视角批量重写全集 `shots.prompt`（场景描述）：检测四种叙事跳跃（时间/因果/动作/情绪），用 `△承接上镜:` 文字桥接，身体解剖词代替情绪形容词；**只改 prompt，不改帧描述/motionScript** |

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

**startFrameDesc / endFrameDesc 五要素**（单一事实来源，必须自包含，用「；」分隔）：
1. 机位空间坐标（首要素）——`摄影机在[主体][方位][距离]，镜头高度[身体部位]`
2. 景别/视角 + 取景范围（如"近景仰拍，取景胸口以上"）
3. 具名角色精确位置/姿态（静止态，不写运动过程）
4. 主光完整叙述句（颜色 + 方向 + 铺洒方式 + 受光效果，禁止短词如"冷调月光"）
5. 情绪的身体解剖表现 + 场景背景锚定词（如"嘴唇微颤、眼睑下垂——宫殿廊道"，禁用形容词如"神情坚定"）

**cameraDirection 格式**（必须含叙事目的）：
`起幅[景别/机位] → 运动方式+速度 → 落幅[景别/机位]，目的：[揭示/跟随/强调什么]`
- ✅ `全景 → 缓慢dolly out拉远 → 大全景，目的：揭示角色孤立于空旷环境`
- ✅ `中景 → counter-clockwise orbit 180度 → 中景背面，目的：环绕揭示身后的对手`
- ❌ 禁止只写运镜词不写叙事目的（"缓慢推近"不合规）

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
| `enhance_prompts` column 缺失 | schema 先于 migration 被 Drizzle 读取 | migration 0027 + Python 直接 ALTER（历史记录：该列后已由 migration 0047 删除，见约定 4） |
| 视频生成跳过 visualStyleTag | 生成路径未传参数 | 各 handler 全面审计 |
| 角色解析后变成写实风 | `handleCharacterExtract` 用裸 `resolvePrompt` 未注入 visualStyle | 使用 `resolveCharacterExtractSystemPrompt(visualStyle, …)` |
| 尾帧人物与定妆图不符 | 尾帧 prompt 未明确角色设定图优先于首帧 | `registry.ts` `LAST_FRAME_RELATIONSHIP_TO_FIRST` + `LAST_FRAME_RENDERING_QUALITY` |
| PPT割裂感（群演→主角切换） | 强制继承上一镜头尾帧导致首帧图像错误 | 智能链式中断：`isCrowdToCharacterCut` 检测，独立生成首帧（历史记录：该函数已随自动衔接功能一并移除，现在衔接全靠用户手动触发，见约定 8） |
| 生成首帧出现火光/动态元素 | `lightingAtm` 含视频级动态描述被注入静帧 `【光影】` 段 | migration 0042/0043 从 `schema.ts` 和代码路径移除 `emotion`/`framing`/`lightingAtm`；光影信息统一写入 `startFrameDesc`（注：这三列当年未真正删掉，已由 migration 0057 补删）|
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
| 分镜帧描述缺少摄影机物理位置，Seedream 渲染构图混乱 | startFrameDesc 只写"近景"等景别词，未指定摄影机在哪里、距离多远 | startFrameDesc 升为五要素：第一要素为机位空间坐标（格式：`摄影机在[主体][方位][距离]，镜头高度[身体部位]`） |
| cameraDirection 无叙事目的，运镜显得随意 | 只写运镜动作不写为什么这样运镜 | cameraDirection 强制格式：`起幅→运动方式+速度→落幅，目的：[揭示/跟随/强调什么]`；`registry.ts` 和 `storyboard-supervision.ts` 均已更新 |
| AI 分镜从剧情动作出发，画面感弱、缺乏视觉张力 | shot_split 和 batch_storyboard_rewrite 直接把剧情翻译成技术字段，跳过了导演决策层 | 新增导演前思考步骤（Q1单一视觉概念 / Q2核心反差对 / Q3主动排除）；约定 15；`SHOT_SPLIT_DIRECTOR_CONCEPT_RULES` + `STORYBOARD_REWRITE_SYSTEM` |
| 次要角色「凭空出现/消失」在镜头中间 | shot_split 无入画/出画规则，角色可以从画面中央直接现身 | 入画铁律：次要角色必须从取景框边缘进入；出画铁律：必须从边缘离开；`SHOT_SPLIT_ENTRY_EXIT_RULES`（`registry.ts`） |
| 任意访客打开首页就继承了别人的项目和 API Key | `reclaim-local-user.ts` 会把「库里项目最多的孤儿匿名用户」的全部数据（含 `provider_secrets`）过继给下一个空手到访的访客。这是为本地单用户设计的便利功能，默认开启，公网部署下等于数据泄露开关 | 整套删除（不是加环境变量开关）；`route-auth-guard.test.ts` 里有一条断言禁止它复活 |
| 知道一个 project ULID 就能读写别人的分镜/角色/上传文件 | 只有 `projects` 表有 `user_id`，其余 17 张表全靠 `project_id` 级联；26 / 65 个路由既不识别用户也不回溯归属 | 新增 `src/lib/api-guard.ts`：`requireProjectOwner` / `requireUser` / `requireTaskOwner`，两行接入且可 grep。**找不到和不属于都返回 404**（返回 403 会泄漏「这个 id 存在」，可用来枚举）|
| 过了项目校验后仍能改别人的数据（二级 IDOR） | 路由拿到 `characterId` / `shotId` / `assetId` 后直接 `where(eq(x.id, childId))`，没约束子资源属于该项目 —— 用自己的 projectId 配别人的 childId 依然打得穿 | 补 `requireCharacterInProject` / `requireShotInProject` / `requireCharacterAssetInProject`（后者需 join 回 characters，因为 `character_assets` 表没有 project_id）|
| provider API Key 明文存 SQLite | `provider_secrets.api_key` / `secret_key` 和 `ark_asset_library_credentials` 的 AK/SK 都是明文；一次库文件泄漏 = 所有上游 Key 全泄 | 新增 `secret-crypto.ts`（AES-256-GCM，密文带 `enc:v1:` 前缀）。**兼容存量明文所以不需要数据迁移**，下次保存自动升级为密文；未设 `AI_COMIC_SECRETS_VAULT_KEY` 时降级明文并告警 |
| auth cookie 永久有效，改密码也踢不掉 | v1 cookie = `{userId}.{hmac(userId)}`，只签了 userId，不含过期时间也不含版本号，唯一撤销手段是改 `AUTH_SECRET`（踢掉所有人） | v2 = `v2.{userId}.{issuedAt}.{tokenVersion}.{hmac}`，服务端校验过期（30 天，原 1 年）；`users.token_version`（migration 0055）自增即可批量失效；生产环境补 `Secure`。⚠️ 版本号校验要读库，同步的 `getAuthUserIdFromRequest` 做不到，需强撤销语义时用异步的 `getFreshAuthUserId()` |
| Seedance 2.5 的首帧/首尾帧任务用 16:9 必然异步报错 | 2.5 规定首帧/首尾帧生视频的 `ratio` **必须**为 `adaptive`（模型自动保持输出宽高比与首帧图一致），而 `seedance.ts` 的 `buildKeyframeBody`/`buildReferenceBody` 写的是 `params.ratio \|\| "16:9"`；违反时任务创建成功、启动后才报 `InvalidParameter.TaskTypeConstraint` | 能力表新增 `ratioLockedModes: { keyframe: "adaptive", initialImage: "adaptive" }`，route 用 `resolveRatioForMode(cap, mode)` 覆盖用户选的比例。这是通用机制，以后任何模型有同类约束只需填表 |
| Seedance 2.5 参考生视频可能被模型误判成「视频编辑/延长」 | 不传或传 `omni_reference_task_type: "auto"` 时，模型按提示词意图自行判定子任务类型；判成 edit/extend 后会因 `ratio`/`duration` 不符合那两类任务的特殊限制而**异步**报错 | `buildMultimodalBody` 在 2.5 下显式传 `omni_reference_task_type: "reference"`，把校验前置到提交时同步返回 |
| Seedance 2.5 参考视频传本地路径会静默失败 | 2.5 的参考视频**只接受公网 URL 或 `asset://` 素材 ID，不支持 base64**（图片和音频可以），沿用图片的 `toDataUrl` 思路必然出错 | 新增 `toVideoUrl()`，遇到本地路径**直接抛错**而非降级成 data URI —— 静默降级会让错误推迟到任务启动后才暴露。这也是白模预演必须排在对象存储之后的原因 |
| 切到 Kling / Veo / 即梦生成视频必崩 | `resolveSingleVideoMode` 只看分镜数据算模式，不知道 provider 支不支持；`multimodal` 是绝大多数镜头的默认模式，而这三家 provider 只实现了首帧/首尾帧两种 body（Kling 对 undefined 的 `initialImage` 取 base64 崩溃、Veo 抛 `Veo requires an image input`、即梦提交空图列表） | 新增 `video-capabilities.ts` 能力注册表；`downgradeVideoMode(ideal, cap)` 在生成前把模式降级到 provider 真正支持的那个，并通过响应体 `capabilityNotes` 回传前端 toast 告知用户本次丢了什么 |
| 参考素材上限写死 Seedance 2.0 的 9/3，换模型不跟着变 | `MAX_MULTIMODAL_REFS=9` / `MAX_AUDIO_REFS=3` 是 `handleSingleVideoGenerate` 里的**函数内局部常量**，未导出、未共享 | 改读 `cap.refs.image` / `cap.refs.audio`；`model-limits.ts` 整体并入 `video-capabilities.ts` 后删除 |
| 预览代理接入后仍有周期性卡顿（不是持续卡，而是「偶尔某处顿一下」）| 代理编码没禁用 B 帧（`has_b_frames=2`，High profile）。B 帧要求解码器缓冲并重排帧序 —— 先解未来帧才能输出当前帧 —— 浏览器 WebCodecs 实时播放时会周期性卡顿。项目的**导出路由早就在用 `-bf 0`**（注释里还解释了 encoder delay），写代理时没沿用 | 代理编码加 `-bf 0 -tune fastdecode -profile:v main -pix_fmt yuv420p`，实测体积仅 +12%（764KB→858KB）。**凡是给浏览器实时解码的视频，一律禁 B 帧** |
| 编辑器报 `MP4Clip.tick audio timeout`（`pcmLen:0`）且播放严重卡顿 | 编辑器用 WebCodecs 在浏览器里解码**源片**，而源片是 1882×1080、单个可达 55MB。主线程忙于解视频帧时音频解码线程被饿死，产不出 PCM。音频本身是标准 AAC-LC 44.1kHz（**不是编解码问题**）。迁到 OSS 后叠加网络拉流延迟，越过了解码器的超时阈值 —— 隐患一直在，OSS 把它暴露了 | 新增 `shots.preview_url` / `poster_url`（migration 0058）+ `lib/video/preview-proxy.ts`：视频生成成功后顺带转一份 480p/CRF30 代理与封面帧，编辑器优先用代理，**导出仍用原片**。实测压缩 7–73 倍（分镜1 55MB→0.75MB），转码约 1.6s/条。`tryBuildPreviewProxy` 吞掉所有错误 —— 视频已生成、钱已花，不能因转码失败判整体失败。回填脚本 `pnpm proxies:backfill`。**顺带解决了「有视频但没首帧的分镜在编辑器里没缩略图」**：封面帧作为 anchorFirst 的回退 |
| 视频编辑器报 `TypeError: Failed to fetch`，但缩略图和下载都正常 | 产物迁到 OSS 后，`/api/uploads/_oss/<key>` 会 **302 跳转**到 OSS 签名 URL，跳转后就是跨域请求。而 bucket 默认**没有任何 CORS 规则** —— `<img src>`/`<video src>`/下载不需要 CORS 所以毫无异常，唯独 `fetch()` 需要，浏览器因响应缺少 `Access-Control-Allow-Origin` 直接拦掉。`VideoPreview.tsx:491` 正是用 `fetch()` 把视频流喂给 `MP4Clip`，报错信息里**完全看不出是跨域问题** | 新增 `pnpm oss:cors --apply` 配置规则（GET/HEAD、`allowedHeader: *` 以支持 Range 分段、`exposeHeader` 暴露 Content-Length/Accept-Ranges/Content-Range 供 MP4Clip 使用）。**部署生产必须带 `--origin https://线上域名` 重跑**，否则线上复现同样报错。注意放开 CORS ≠ 放开访问：bucket 仍私有、请求仍需有效签名 |
| migration 0042/0043 被记为「已应用」但从未生效，三列至今仍在库里 | 两个缺陷叠加：① `0042.sql` 里**没有 `statement-breakpoint`**，整份 SQL 作为一块交给 `sqlite.exec()`，而迁移执行器**没有事务包裹** —— 第一次跑 `CREATE TABLE shots_new` 提交成功、后续 `INSERT` 失败，留下一张空表；② 第二次跑时 `CREATE` 报 `already exists`，被执行器「兼容旧库」的 catch 吞掉，`exec()` 在第一句就中止、后面的 `INSERT`/`DROP`/`RENAME` 从未执行，**却照样写入了 `__drizzle_migrations`**。于是 `emotion`/`framing`/`lightingAtm` 永久留在 `shots` 表里，而 CLAUDE.md 三处都写着「已完全移除」 | `runMigrations()` 加事务包裹（`BEGIN`/`COMMIT`/失败 `ROLLBACK`），一份迁移要么整体生效要么整体回滚；残留的空表 `shots_new` 已删除（删前校验 0 行、0 条独有数据 + 整库备份）。三列随后由 migration `0057` 用 `ALTER TABLE DROP COLUMN` 补删（SQLite 3.35+ 原生支持，无需重建表）。**教训：`rename-copy-drop` 式迁移必须有事务，且「already exists」这种容错会掩盖真实失败** |
| CLAUDE.md 把两个已删除的功能当现存功能写，照着写代码会直接 tsc 报错 | migration `0047_drop_enhance_prompts_link_shots` 删了 `projects.enhance_prompts` 和 `link_shots_via_cut_point` 两列（前者是 no-op、后者被手动按钮取代），但约定 4、约定 8、关键表 `projects` 行、Provider 规则、开发检查清单五处都没同步。连带发现 `prompt-enhancer.ts` 的 `enhanceImagePrompt`/`enhanceVideoPrompt` 在生产代码里**零调用方**（只剩 eval + 单测），而文档还写着「新增 provider 时必须同步添加 system prompt」 | 约定 4 / 约定 8 改写为「已移除」记录并保留编号（避免打乱交叉引用），列出已不存在的函数名（`maybeAutoLinkNextShotAfterVideo` / `linkNextShotAnchorFromCutPoint` / `isCrowdToCharacterCut`）；「AI Prompt 增强系统」一节加停用标注；开发检查清单那条换成 `VIDEO_CAPABILITIES`。**教训：删列的 migration 必须同步扫一遍 CLAUDE.md 里的列名** |
| MiniMax 音乐接口停用，BGM 生成整条链路失效 | MiniMax Music 接口已不可用；替代品「豆包音乐」实为火山「AI 生成音乐大模型 · 生成纯音乐」，与 MiniMax 有四处结构性差异：AK/SK 签名（非 Bearer）、submit+轮询（非同步返回）、返回 CDN wav URL（非 hex 串）、`Duration` 是真参数且强制 30–120 整数秒（非塞进 prompt 文字） | protocol `minimax` → `volc-music`；`bgm/generate/route.ts` 重写为 `generateWithVolcMusic`（`@volcengine/openapi` 签名，`serviceName=imagination`，`GenBGMForTime`/`QuerySong`，`Version=2024-08-12`）；`provider-form.tsx` 的 `needsSecretKey` 必须加 `volc-music`，否则 UI 不显示 SK 输入框 |
| BGM API key 从客户端传来不安全 | 前端把 apiKey 放 body 传给 route | 改为 route 从 DB 读 `getProviderSecret(userId, providerId)`；客户端只传 `providerId + protocol + baseUrl` |
| shot-drawer「重写文本」按钮静默失败 | `single_shot_rewrite` route handler 已按 CLAUDE.md 要求移除，但 shot-drawer 还在调用 | 从 shot-drawer.tsx 移除该按钮及 state；用分镜页「批量优化文本」替代 |
| registry.ts 用 `require()` 加载 storyboard-supervision | Next.js App Router 是纯 ESM，`require()` 运行时报 `ReferenceError` | 改为顶部 `import { STORYBOARD_REWRITE_SYSTEM, PLOT_OPTIMIZE_SYSTEM } from "./storyboard-supervision"`（无循环依赖） |
| prompt-editor.tsx 保留废弃 key 的 hint 映射 | `ref_video_prompt` 和 `single_shot_rewrite` 从 registry 移除后，hint map 未同步清理 | 移除两条废弃 key |
| 视频生成非正面/非近景首帧导致角色跑偏 | 原 `initialImage` 模式把首帧作为严格首帧锚定，非正面视角时 Seedance 无法同时保持构图和角色外貌 | 引入 `SingleVideoMode` 三态；普通首帧默认走 `multimodal`：首帧作构图参考(@参考1)，角色定妆图作外貌锁定(@参考2+)；仅 `strict_start` 承接帧走 `initialImage` |
| `frameTarget: "both"` 被服务端默认采用但客户端已停止发送 | 清理时机滞后，服务端 default 为 `"both"` 而客户端全路径已改为显式 `"first"` | 服务端 default 改为 `"first"`，`"both"` 分支整体移除，类型收窄为 `"first" \| "last"` |
| multimodal 模式 `@参考N` 编号与 refs 数组错位 | prompt 端用全量 `singleVideoShotChars` 构建编号，API 端 refs 只含有磁盘图片的角色，无图角色导致后续编号系统性偏移 | 在 prompt 构建前预先调用 `resolveCharacterImages`（`needPreResolveCharImages`），两端使用同一份已过滤角色列表 |
| 三/四视图角度变体在视频生成时被忽略 | `buildRefEntries` 未为角度变体分配 `@参考N`，贸然加入 `multimodalRefs` 会导致后续编号整体错位 | 已修复：`SeedanceAsset` 加 `angleImages` 字段，`buildRefEntries` Round 1 每 asset 主图后追加角度变体，prompt 参考定义段生成"XXX四分之三侧面视图（与@参考N同一角色）"说明行，`multimodalRefs` 完全对齐；9 张上限保护优先丢角度变体 |
| `isCrowdShot` 字符串匹配不稳定导致角色跑偏 bug 在某些镜头上无法修复 | 角色写外号/旁白省略名字时 `filterShotCharacters` 返回空，误将有角色的镜头路由到 `initialImage` | 从 `resolveSingleVideoMode` 移除 `isCrowdShot` 参数；群演统一走 `multimodal`（refs 仅含 anchorFirst，Seedance 降级无害） |
| 手动参考图重绘首帧误进严格首帧视频模式 | `chainSourceShotId` 同时承担「来源追溯」和「strict 首帧连续性」两种语义 | 增加 `anchor_first_continuity_mode`：直拷承接写 `strict_start`；参考图重绘写 `reference_redraw`；migration `0054` 回填历史链源并补旧上一镜直拷数据；三态分流只把 `strict_start` 送入 `initialImage` |
| LLM 状态路由（武装/日常）选错定妆图 | `determineCharacterState` 用 LLM 判断服装状态，sceneDesc 不含明确服装词时误选 | 移除整个 LLM 路由层（`determineCharacterState`/`STATE_EQUIV`/`isCoveredByTag`）；改为 `isDefault=1` 直接选图，用户在角色页手动设置哪张是当前主定妆图 |
| 道具参考图无法按分镜绑定 | 原架构道具（武器/道具）只能通过 FrameReferencePicker 全局手选，无法持久化到特定分镜 | 增加 `shots.prop_refs`（JSON 数组，migration 0051）；ShotCard 主页和 ShotDrawer 均新增「道具参考图」缩略图勾选区（乐观更新 `localPropRefs`）；帧生成时追加到 `refImages` 末尾，视频生成时作第四轮加入 `multimodalRefs`（不占 `@参考N` 编号位置，受 9 张上限保护） |
| Seedance 2.0 多模态参考图上限误记为 14 | 沿用了 Seedream 图片生成的 14 张上限，未查 Seedance 视频生成官方文档；且误将音频计入图片配额（音频走独立的 `audio_url` 类型，另有上限 3 个） | 官方文档确认 Seedance 2.0 多模态参考生视频 1~9 张图片；`MAX_MULTIMODAL_REFS` 改为 9；budget 计算移除 `audioCount`（`generate/route.ts`） |
| 角色资产上传规则对新用户不可见 | 定妆图/道具图/主定妆图的最优实践只存在 CLAUDE.md，UI 无引导 | 项目级和分集级角色页均新增可折叠 3 栏资产上传指南卡（蓝/琥珀/黄三列，默认展开）；`character-card.tsx` 「添加形态」和「添加道具图」按钮增加行业规则 tooltip |
| `AiOptimizeButton` 单字段修改破坏跨镜一致性 | 该组件早于批量重写设计，无跨镜上下文，修改 startFrameDesc/motionScript 等字段会破坏 `batch_storyboard_rewrite` 建立的视觉连续性；`videoPrompt` 为直出字段，单字段 AI 改写与 startFrameDesc/motionScript 来源脱节 | 从 `shot-card.tsx`、`shot-drawer.tsx` 完全移除；`ai_optimize_text` route handler 删除；`ai-optimize-button.tsx` 已删除（当时只能置空，2026-09-04 复查时文件已不在仓库里）；`ARCHITECTURE-FRAMES.md` L6 同步更新 |
| `startFrameDesc` 含运动词导致扩散模型渲染动态模糊首帧 | `STORYBOARD_REWRITE_SYSTEM` 的静止状态规则表述不够具体，LLM 仍写"转身/迈步/张嘴"等动词 | 在 `storyboard-supervision.ts` 添加禁用动词清单（走向/转身/迈步/抬手/张嘴/伸出/挥/喷/冲/跑/跳/正在/已经）及静态替代写法示例（将动作改为"起始瞬间身体的空间定格"） |
| `batch_plot_optimize` 写入 `△承接上镜:` 前缀到 DB 字段 | `PLOT_OPTIMIZE_SYSTEM` 指示 LLM 在跨镜衔接处加"△承接上镜：[说明]"前缀，该前缀被原样写入 `shots.prompt`，下游 LLM 收到时无法理解"上镜"指谁 | 将"△承接上镜："写法改为自然融入正文；承接说明以叙事语言开头而非特殊标注；`PLOT_OPTIMIZE_SYSTEM` 跨镜修复策略表和承接词写法说明均已更新 |
| 动漫打斗场景 motionScript 缺乏战斗质感，仅描述动作轨迹不写物理效果 | `STORYBOARD_REWRITE_SYSTEM` 的动作规范只讲"不写伤害结果"，未提供正向的动漫战斗物理词汇 | 在 `storyboard-supervision.ts` 的"动作场景描写规范"后插入"动画战斗物理词汇"完整章节：流线模糊写法、冲击波帧、镜头震动（Screen Shake）、startFrameDesc 战斗冻帧补充细节（环境粒子/冲击波/残影）、战斗序列镜头时长规范与景别交替铁律 |
| 写实真人风格（realistic）生成质量远低于万物生参考prompt规格 | 三大系统性缺口：①`realistic/video.md` 无王家卫/Nolan摄影词汇，只有3行基础tag；②`realistic/storyboard.md` 无声音设计框架（【关键音效】），无多光源分层词库，无摄影机语言词汇；③`STORYBOARD_REWRITE_SYSTEM` 对写实风格无专项规范，"同一帧不超过两个光源"规则与真实电影摄影冲突 | 三项升级：（1）重写 `realistic/video.md` —— 添加王家卫/Nolan风格标签、T1.4景深、ARRI Alexa/Kodak Vision3胶片词、handheld vs locked-off选择指南、人物比例-景框约束；（2）扩充 `realistic/storyboard.md` —— 新增【关键音效】三层设计框架（底噪/事件音/空间感 + 词库）、王家卫三层命名光源分层、写实摄影机语言词库（支撑方式/运动/特殊效果）；（3）在 `STORYBOARD_REWRITE_SYSTEM` 添加"写实真人风格专项规范"：motionScript 末尾追加【关键音效】必须项、多光源例外（写实风格允许三层命名光源）、摄影机支撑方式词汇；"同一帧两光源"禁止规则加上"动漫/2D风格"限定语 |
| `PLOT_OPTIMIZE_SYSTEM` 缺少节奏架构意识、行为真实性规范、换场首镜建立规则 | 优化剧情用"剧情动作"驱动写 prompt，缺乏导演级预扫描；行为描写影视化夸张；换场第一镜未强制空间落地 | （1）新增"第零步：节奏架构扫描"——A.场景节奏类型分类（快切/慢凝/急停/悬念延迟）；B.情绪命门标出；C.声音节奏骨架识别（2-3关键声音事件）；（2）新增"规则1b 行为真实性"——区分日常真实反应vs影视式表演，附4个行为真实特征和正反例；（3）新增"规则4c 换场首镜落地三步法"——空间物理感+氛围感官锚点+然后才进入动作 |
| `STORYBOARD_REWRITE_SYSTEM` 缺少战斗 1 秒时长例外和战斗色彩语法 | motionScript 规则强制"每段2-4秒"，击中定格/冲击波扩散等节奏密片段被强制撑到2秒失真；无冷青主基调+战斗点缀光的配色规范 | 在 motionScript 规则加"战斗峰值例外"（允许1秒段，单镜≤2个）；在动漫战斗词汇章节新增"战斗色彩语法"表格（冷青主基调/金白弧/蓝白电火花/强逆光轮廓光） |
| `cel_shaded_action` 被创建又撤销 | 该风格仅适用于三渲二特定 CG 风格，用户实际需求是在现有 `anime_2d` 风格内实现 S 级战斗分镜 | 移除 `cel_shaded_action` 风格注册；将全部战斗词汇整合进 `anime_2d/storyboard.md` 第七章 + `anime_2d/video.md` 战斗标签；`visual-style-presets.ts` 不添加新条目 |
| `batch_storyboard_rewrite` 战斗词汇对 LLM 不可见 | `generate/route.ts` 的 `visualStyleContext` 提取正则只匹配第 II 章（光影）和第 IV 章（风格锚定），新加的第 VII 章（战斗技法）从未被传入 LLM | 在 route.ts 加 `combatSection` 提取（`/##\s*[七7]、[\s\S]*/`），三段合并后传入；`buildRewriteUserPrompt` section 标题扩展为"写所有视觉字段时必须参照此词库：光影描述 / 战斗动作词汇 / 摄影机语言 / 场景质感" |
| `STORYBOARD_REWRITE_SYSTEM` 五要素编号错误：③ 出现两次 | 角色姿态和主光均被标为 ③，LLM 对"五要素"的结构理解混乱 | 修正为 ①机位 ②景别 ③角色姿态 ④主光 ⑤(情绪解剖+背景锚定词)，五要素总数正确 |
| "禁止同一帧写两个以上光源"规则缺风格限定语 | 该规则写在主光 ④ 要素说明内，无风格前提，写实项目 LLM 看到后不敢使用三层命名光源（与写实专项规范矛盾） | 加上"动漫/2D/3DCG风格"前缀，并追注"写实真人风格可用三层命名光源，见下方写实专项规范" |
| `STORYBOARD_REWRITE_SYSTEM` 台词内嵌示例后有孤立 bullet 缺 header | 示例代码块后面的两条禁用规则（"说话人面部表情随台词情绪流动""同场景连续镜头背景锚定词不同"）没有 `❌ 禁止` header，LLM 解析时这两条规则的约束语义丢失 | 在两条 bullet 前添加 `❌ **台词内嵌禁止：**` header，并补充括号说明每条的失败原因 |
| `write_shot_rewrite` 工具 schema 描述错误 | `startFrameDesc`/`endFrameDesc` 描述写"四要素"（已过时），`motionScript` 描述写"四要素，≤80字"（完全描述错误——motionScript 是 `[]` 时间轴格式，非四要素）；LLM 以 JSON schema description 作为工具行为指导 | 更新 `startFrameDesc`/`endFrameDesc` 为"五要素：机位坐标；景别+取景范围；角色位置姿态；主光叙述；情绪解剖+背景锚定词"；`motionScript` 更新为"[] 包裹格式，时间段求和=镜头时长，末尾 \| 朝向：标注" |
| `estimateAutoRefCount` 预留过时的场景图名额（`+1`） | migration 0045/0046 移除了 scenes 表，但 `use-shot-frame-actions.ts` 的 `estimateAutoRefCount` 仍返回 `namedCharacterCount + 1`，导致 0 个角色镜头 `crossShotRefLimit = 13` 而非 14 | 改为 `return namedCharacterCount`，同步更新注释 |
| 道具图优先级低于角度变体，被角度变体耗尽槽位后静默丢弃 | `angleSlotBudget` 计算未预留道具图名额；若4个角色各带角度图填满9槽，用户手选的道具图全被丢 | 计算时提前 `propReserve = min(propIds.length, 9 - mainCount - anchorCount)`，`angleSlotBudget` 再减去 `propReserve` | 
| 音频引用无上限，超过3个会触发 Seedance API 错误 | 第三轮无条件 push 所有角色音频，4个角色均有音色时推4个音频，超出官方上限3个 | 加 `MAX_AUDIO_REFS = 3`，第三轮加 `audioRefCount < MAX_AUDIO_REFS` 检查 |
| 道具图第四轮检查用 `multimodalRefs.length` 含音频条目 | 第三轮 audio 加入 `multimodalRefs` 后，第四轮用 `multimodalRefs.length < 9` 实际把音频计入图片配额，音频多时道具图被错误拒绝 | 改为 `multimodalRefs.filter(r => r.type === "image").length < MAX_MULTIMODAL_REFS` |
| 帧描述（`startFrameDesc`/`endFrameDesc`）中使用否定短语导致扩散模型渲染出被禁止的元素 | "无伤痕"/"背景无人"等否定词会让模型聚焦于否定对象，反而渲染出来 | 在 `STORYBOARD_REWRITE_SYSTEM` 绝对禁止段新增否定词规则：改为肯定描述（"皮肤完好"/"空旷走廊仅二人"） |
| `generate-route-deprecations.ts` 残留废弃 action 的 410 处理逻辑引发误解 | `batch_video_generate` 等 action 早已移除，但 deprecations 文件仍包含完整逻辑，看起来像仍在维护的能力 | 删除 `generate-route-deprecations.ts` 及其测试文件（当时只能置空，2026-09-04 复查时文件已不在仓库里）；从 `route.ts` 移除 import 和调用；从 `generate-route-contract.test.ts` 移除废弃 action 测试；`pipeline/index.ts` 删除过时注释 |
| 系统缺少万物生5个核心维度（集级色温弧/呼吸镜头/对话覆盖节律/集末视觉钩/前景叙事层） | `STORYBOARD_REWRITE_SYSTEM` 只优化单镜质量，无集级视觉弧线；"黄金6秒规则"主动排斥情绪收束镜头；对话场景无聆听方身体反应镜头规范；无集末悬念截断规则 | 在 `storyboard-supervision.ts` 新增：Q0集级色温弧（冷→暖/暖→冷等弧线类型+色温渐变规则）；情感收束镜头检查（物理自检第8条，呼吸镜头豁免黄金6秒）；对话场景覆盖节律（六步节律+步骤3聆听方身体反应镜头+前景叙事层选项）；规则5b集末视觉钩（信息截断/情绪强切/空间悬念三种钩型） |
| Seedance 多参模式选了「写实真人（古风）」等风格，视频提示词却出现「动画风格，电影质感」 | `seedance-multi-param.ts` 的 `resolveStyleTag` 没有复用 `VISUAL_STYLE_PRESETS`，而是自己用正则解析各风格 `video.md` 表格；`realistic_ancient/video.md` 的表格行写的是"Seedance 2.0 通用（中文）"（多了空格和"通用"二字），正则/逐行扫描双双落空；兜底的 `fallbacks` 字典也从未同步收录 `realistic_ancient`/`anime_2d_retro` 两个新风格，最终摔进硬编码默认值 `"动画风格, 电影质感"`（该默认值本身也与 `VISUAL_STYLE_PRESETS.auto.tag=""`「自动检测=不强制风格」的设计意图相悖） | 删除正则解析和过期字典，`resolveStyleTag` 直接读 `VISUAL_STYLE_PRESETS[visualStyle]?.tag`（与 `buildStyleInstruction` 等其他路径共用同一数据源）；`auto`/未知风格返回空字符串时省略"画面风格和类型"整行，不再强制注入动漫风格 |
| `batch_storyboard_rewrite` 对 4/7 风格（`anime_2d_retro`/`cg_3d`/`chinese_ink`/`western_cartoon`）注入的项目画风词库恒为空，LLM 拿不到光影/风格锚定词库自由发挥 | `generate/route.ts` 用正则 `##\s*[二2]、`/`[四4]、`/`[七7]、` 从 `storyboard.md` 按中文数字编号标题切片三段，但只有 `anime_2d`/`realistic`/`realistic_ancient` 的标题带编号，其余 4 风格标题无编号，正则全部落空且无报错；`cg_3d` 额外损失"摄影机语言词库"/"声音设计词库"两段独有内容 | 新增 `rewrite_vocab.md`（每风格一份，人工从 `storyboard.md` 对应章节整理，整读整段，不做标题正则切片），`ArtStyleFileType` 新增 `"rewrite_vocab"`；`generate/route.ts` 三行正则改一行 `getArtStylePrompt(style, "rewrite_vocab")` |
| 图片生成的负向词/画质锁定词依赖正则从 `storyboard.md` 抠"模式B/默认"段落，零容错，措辞一改就静默退化成通用兜底 | `storyboard-image.ts` 的 `extractNegativePrompt`/`buildStyleSection` 正则依赖固定的"模式B（英文）：""默认：\n超清/高清..."行格式，无 schema 约束 | `VISUAL_STYLE_PRESETS` 新增 `negativePrompt` 结构化字段（7风格各一份，内容与原正则抽取结果等价，已用脚本比对确认输出集合一致），`extractNegativePrompt` 改读结构化字段；`buildStyleSection` 的正则分支本就是死代码（唯一调用处永远先传非空 `visualStyleTag`），直接删除 |
| 上述几类"新增风格漏同步某处"的 bug 均无自动化防护，只能靠人工发现 | 风格相关的数据分散在 `VISUAL_STYLE_PRESETS`（TS 常量）和 `art-styles/<style>/*.md`（7 目录 × 多文件）两处，无联动校验 | 新增 `src/__tests__/unit/lib/ai/art-style-consistency.test.ts`：断言 `VISUAL_STYLE_PRESETS` 与 `art-styles/` 目录双向一一对应、每风格必需文件（含新增的 `rewrite_vocab.md`）存在且非空、`tag`/`negativePrompt`/`label`/`description` 均非空。测试内用 `vi.mock("node:fs", async (importOriginal) => importOriginal())` 覆盖全局 `setup.ts` 对 `node:fs` 的 mock（该 mock 让所有其他单测的 `fs.existsSync`/`readFileSync` 恒为 false/""，此测试需要真实磁盘读取），与 `prompt-templates-deplot.test.ts` 同一模式 |
| `video.md`（7 风格各一份）在 `resolveStyleTag` 改为读 `VISUAL_STYLE_PRESETS` 后变成 100% 无代码路径读取的死内容，但仍摆在目录里像是仍被使用，容易诱使后人重新写正则解析它 | 无 | 7 个风格的 `video.md` 全部物理删除（含摄影机运镜/景深/王家卫调性等未被任何代码消费的 prose——曾经短暂考虑过"标签表格删、prose 保留"的折中方案，但确认零调用后判断"没人用又没地方去"的内容留着只会增加误导，直接清空更干净；这些内容仍在 git 历史里，需要时可以找回）；`ArtStyleFileType` 移除 `"video"` |
| `rewrite_vocab.md`（每风格一份）最初只从 `storyboard.md` 摘了 光影/风格锚定/进阶技法 三段，两个文件并存导致重复维护风险 | 复查时发现 `storyboard.md` 在 A/B 两项重构后已经**彻底没有任何代码路径读取**（`buildStyleSection`/`extractNegativePrompt` 改读 `VISUAL_STYLE_PRESETS`，`batch_storyboard_rewrite` 改读 `rewrite_vocab.md`，三个原读取点全部迁走）——不是"两处都在用、内容会漂移"，是"一处在用、另一处已经是像 `video.md` 一样的死文件" | 把 `storyboard.md` 剩余还有价值但从未被任何代码消费过的三段（情绪→面容/眼神词映射、场景质感约束词、美学禁止项）一并整理进 `rewrite_vocab.md`，`storyboard.md` 整个删除（7 个风格全删）；跳过了"完整生成示例"（Seedream/Nanobanana 完整格式范例，混进 LLM 系统提示词会造成格式误导）和"快速参考卡"（前两节的浓缩重复）。`ArtStyleFileType` 移除 `"storyboard"`，`art-style-consistency.test.ts` 的必需文件清单同步移除；`rewrite_vocab.md` 现在是该风格图像/视频生成侧唯一权威词库文件，不再有第二份需要同步的副本 |
| `single-shot-rewrite.ts`/`single-shot-rewrite-defaults.ts` 早已零调用方（route handler 已删、registry 未注册），但文件仍在仓库里，内部还带一份和本次同类的正则段落抽取逻辑（`table.md` 按 `## 标题` 切片） | 之前几次清理只置空了别的废弃文件，这两个漏删 | 物理删除两个文件及对应测试 `single-shot-rewrite-defaults.test.ts`；`registry.ts` 顶部移除死 import（`SINGLE_SHOT_REWRITE_DEFAULT_SLOTS`/`assembleSingleShotRewriteSystem` 全文件无第二处引用）；`prompt-template-standards.ts` 的 `PROMPT_TEMPLATE_SOURCE_FILES` 同步移除该文件名（否则 deplot 扫描测试会读一个不存在的文件报错）。DB 里 `single_shot_rewrite` 覆盖数据的清理逻辑（`prune-stale-prompt-overrides.ts`）不受影响，继续保留 |
| 迁到 OSS 之后，**所有参考图都被静默丢弃**：角色定妆图锁不住外貌、分镜首帧进不了构图参考、道具图完全失效 | 两处叠加：① `shotFrameFileOnDisk` 的实现是 `fs.existsSync(path.resolve(ref))`，`oss://frames/x.png` 会被 `path.resolve` 拧成 `<cwd>/oss:/frames/x.png`，**恒为 false**，于是每个参考图都被判成「文件不存在」并悄悄跳过；② 就算漏过这道检查，各 provider 内部也一律 `fs.readFileSync(本地路径)` 转 base64，同样读不到。界面上没有任何提示，只表现为「效果突然变差」 | ① 函数改名 `shotFrameUsable` 并改语义为「引用可用」（`oss://`/`asset://`/http(s) 一律可用，本地路径仍查磁盘），见约定 8f；② 新增 `provider-artifact-bridge.ts` 接在 `provider-factory.ts` 两个工厂出口，统一把 OSS 引用物化成临时文件再交给 provider，见约定 8e。**教训：产物存储层换掉之后，凡是「判断文件在不在」和「读文件」的地方都要跟着改，前者出错是静默的，比后者危险得多** |
| 参考生视频传 `service_tier: flex` 被同步拒绝 | `InvalidParameter: the specified parameter service_tier is not supported for model doubao-seedance-2-0 in r2v, must be empty`。这个参数**按模式**开放而不是按模型，而 `resolveServiceTier` 对所有模式一视同仁（`SEEDANCE_SERVICE_TIER` 环境变量一直是这么用的，只是从没人在 r2v 下设过它，所以一直没暴露）| 能力表 `features.serviceTierModes` 声明哪些模式接受该参数（Seedance 系列为 `["initialImage","keyframe"]`）；`resolveServiceTier(mode, requested)` 对不接受的模式直接吞掉。`video-capability-consistency.test.ts` 断言任何 capability 都不得在 `multimodal` 上声明它 |
| 编辑器首次加载要等一分多钟，且每打开一次吃掉 125MB OSS 下行流量 | 两处叠加：① `initFromShots` 与存量时间线快照里 `clip.url` 存的是**源片**而不是 480p 代理（`MediaLibrary` 用了代理，时间线初始化没用），实测一集 15 条 = 源片 125.5MB vs 代理 12.5MB；② `syncSprites` 里十几个 clip 完全串行 `await buildSprite`，而 `MP4Clip.ready`（av-cliper 1.2.8）要等**整个流下载并解析完**才 resolve | ① `Clip` 拆成 `url`（导出源，永远是源片）+ `previewUrl`（浏览器解码源），存量快照在 `loadFromSnapshot` 前经 `healSnapshotMediaRefs` 自愈（顺带修掉「从素材库拖进来的 clip 导出会降级成 480p」）；② 改为 4 路并发 + 按离播放头距离排序 + 渐进可播（门只等播放头附近的素材）；③ 新增 `mediaCache.ts` 用 Cache Storage 按**稳定的存储引用**（不是签名 URL）缓存。实测：可播 70s → 2.5s（缓存命中 142ms），单次流量 125MB → 12.5MB → 0 |
| 「首次点播放会跳回 0」的真正成因（此前靠 loading 门掩盖）| `syncSprites` 结尾 `if (!abort.signal.aborted && !isPlaying) previewFrame(playhead)` 用的是**这一轮 sync 开始时捕获的闭包值**。`previewFrame` 内部先 `pause()`（emit paused）再把时间强设为传入值 —— sync 期间用户点了播放，sync 结束时却以为自己还处在暂停态、还停在 0 秒 | 改读 `isPlayingRef.current` 与 `useEditorStore.getState().playhead`。这个修复是渐进可播的前提：门放开后 sync 必然在播放中结束 |
| 取 OSS 产物偶发 `TypeError: Failed to fetch`，同一个 URL 一会儿好一会儿坏 | `/api/uploads/_oss/<key>` 是 302 跳到签名 URL，这一跳带 `Cache-Control: private, max-age=1800`。浏览器缓存的是**重定向本身**，于是会出现「缓存里的 302 还在、它指向的签名已经过期」—— OSS 对过期签名返回 403，而 **403 没有 CORS 头**，浏览器就把它报成一个毫无线索的 `Failed to fetch`（看起来像 CORS 没配，实际 CORS 是好的）。实测：默认 fetch 必失败，加 `cache:"reload"` 立刻 200，之后默认 fetch 又好了。另一类同样报这个错的情况是页面正忙的瞬间（打开 3D 导演台要同时创建两个 WebGL 上下文）请求直接挂掉 | 统一收进 `mediaCache.ts` 的 `fetchArtifact()`：最多 3 次、重试一律 `cache:"reload"`（这样才能拿到新的 302 和新签名）、带退避；403 与 5xx 才重试，404/401 不重试。**凡是取 OSS 产物一律走它，不要裸 fetch** |
| 姜离场景（画面外传来哭声→角色应先反应再冲刺）生成的视频里角色从第一帧就已经在跑，"听见才追"的因果转折在画面上消失 | `startFrameDesc` 被写成动作展开中段的姿态（"步幅已展开，两足悬于地面上方半寸"），而不是触发事件发生瞬间的静止反应姿态；`motionScript` 也把触发事件和已展开的动作压缩进同一时间段，没有独立的短促反应拍。`storyboard-supervision.ts` 原有的"因果时序铁律"未明确要求触发事件必须有独立反应拍、且 `startFrameDesc` 必须锁定在反应瞬间 | `STORYBOARD_REWRITE_SYSTEM`（`storyboard-supervision.ts`）和 `SHOT_SPLIT_MOTION_SCRIPT_RULES`/`SHOT_SPLIT_START_END_FRAME_RULES`（`registry.ts`，英文版，避免 shot_split 与 batch_storyboard_rewrite 两条路径再次漂移）新增"触发-反应铁律"+正反例+物理自检清单项。⚠️ 这是内容质量规则，非结构性 bug，没法用单测锁死，只能人工抽查验证；首版规则示例一度直接写了用户项目的真实角色名/场景（"姜离"/树林/小童哭声），已改用 `角色甲`/`角色乙` 占位符——修改默认模板前务必先看 [docs/PROMPT-TEMPLATE-AUTHORING.md](docs/PROMPT-TEMPLATE-AUTHORING.md)，`prompt-templates-deplot.test.ts` 会扫描但只覆盖 `BANNED_PLOT_TERMS_IN_TEMPLATES` 里登记过的词，新项目的角色名不会自动被拦下 |
| 迁移链**根本无法从零建库**，全新安装/CI 全都撞得上 | `0001` 之后某处断链。本地库是历史演进来的，从来没人从零跑过，所以一直没暴露；部署到服务器跑空库时才炸出来（worker 反复重启报 `no such table: character_assets`）。我一开始误判成「两个容器并发跑迁移的竞态」并跟用户这么说了，单进程复现后已更正 | 基线压缩：`drizzle/baseline/schema.sql` + `meta.json`（`throughTag`），`applyBaselineIfFresh()` 只在空库时应用并把该 tag 及之前标记为已应用。并发是另一个真实隐患，单独用 `__migration_lock` 修掉。见约定 8l |
| 判「是不是空库」的 SQL 把**每一张表**都排除了，基线差点盖到生产库上 | `name NOT LIKE '__%'` —— SQL 的 `LIKE` 里 `_` 是单字符通配符，本意排除 `__drizzle_migrations`，实际匹配任意两字符开头的表名，于是任何库都被判成空库 | 改 `NOT LIKE '\_\_%' ESCAPE '\'`，加专门的回归测试。发现契机是对比脚本报「健康库 0 张表」这个明显不可能的数字 |
| 公网暴露后**只加一个请求头就能读到别人全部项目** | `getUserIdFromRequest` 的回退链认未签名身份（`x-user-id` 请求头 / 裸 `ai_comic_uid` cookie）。这对单机单用户是合理便利，对公网等于完全没有认证 | `REQUIRE_AUTH=1` 关掉未签名回退；`ALLOW_REGISTRATION=0` 关自助注册；`AUTH_SECRET`（当时会回落到公开仓库里的默认值；现已改为自动生成并落盘，见下方那条）；登录加双维度限速。默认全部保持改造前行为，见约定 8k |
| 云控制台放行了端口，公网仍然连不上 | compose 里写死 `127.0.0.1:3007:3007`，**只绑回环**。安全组和监听地址是两道独立的闸 | `${APP_BIND:-127.0.0.1:3007}`，默认仍只绑回环 —— 暴露必须是显式选择 |
| `db-sync.sh` 在服务器侧静默失败 | 服务器上**没装 sqlite3 CLI**，而脚本靠它取 `.backup` 一致性快照 | 装上；比较用的指纹脚本改成不依赖两端工具一致（见下条） |
| `credit_ledger.balance_after` 同一列两种含义，流水无法对账 | `credits.ts` 记的是两个桶之和，`subscription.ts` / `orders.ts` 记的是永久桶且用事务开始时的旧值。账面余额一直是对的（`credit_accounts` 无误），坏的是审计追溯能力 —— 而写流水的全部意义就是审计 | 三处统一改为「改完账户后重读 `balance + subscription_balance`」。发现方式是新增 `order-lifecycle.test.ts` 按真实时间顺序跑完整闭环并逐条重放流水 —— **单点不变量各自成立不代表串起来成立**，那些单测早就全绿了 |
| Docker 构建某天毫无征兆地失败：`ERR_UNKNOWN_BUILTIN_MODULE: node:sqlite` | Dockerfile 里写的是 `corepack prepare pnpm@latest` —— pnpm 10.33 起依赖 `node:sqlite`（Node 22.5+ 才有的内置模块）。代码一行没改，**上游发了个新版本就崩**，这是日历触发型故障，最难联想到根因 | 钉死 `pnpm@10.33.0` + `node:22-alpine`，并在 `package.json` 写 `packageManager` 让本地与镜像用同一个版本。**凡是构建期拉取的东西都要钉版本**，`@latest` 等于把构建的可重复性交给别人的发版节奏 |
| 部署"成功"了，跑的却是旧代码 | 部署脚本先 `git pull` 再 `docker compose build`。GitHub 的 TLS 握手在境内失败，`git pull` 报错，但脚本没有 `set -e` 的保护，`build` 照常成功 —— 于是构建出来的是**上一次的代码**，容器起来了、页面能开，**完全没有任何异常迹象** | 改用 rsync 走已有的 SSH 通道（不依赖第三方网络），并在构建前**显式校验关键文件确实到了服务器**、构建后校验两个容器都 running 且 HTTP 200。**"前一步失败、后一步照常成功"是部署脚本最典型的坑，每一步都要能证明自己真的生效了** |
| 境内构建拉依赖 19 KiB/s，`better-sqlite3` 预编译包超时后回落 node-gyp 再失败 | npm 官方源与 `unofficial-builds`（better-sqlite3 预编译产物的托管地）在境内都不可达 | `NPM_REGISTRY` / `BETTER_SQLITE3_BINARY_HOST` 做成 build arg，**默认值保持官方源不变**（自部署用户与 CI 不受影响），只在服务器 `.env` 里指向境内镜像 |
| `docker compose config` 把 OSS AccessKey Secret 打到了终端 | 该命令的作用就是把 `env_file` 与变量全部展开后打印，密钥自然也在里面 | 排查带密钥的 compose 用 `docker compose config --no-interpolate`，或只看具体 service。已泄漏到终端/日志的密钥按泄漏处理（轮换） |
| 迁移锁的单测在换了连接之后仍读到旧库 | `globalForDb` 挂在 `globalThis` 上做单例，而 `vi.resetModules()` **只重置模块注册表，不动 globalThis** —— 于是新一轮 import 拿回的还是上一轮那个 sqlite 连接 | 测试的 `beforeEach` 里显式删掉 `globalThis` 上的那几个键。**凡是把单例挂在 globalThis 上的模块，`vi.resetModules()` 都不足以隔离测试** |
| 改写 git 历史抹掉服务器 IP 之后，GitHub 上旧提交**仍能按 SHA 访问** | force-push 只是让旧提交不可达，不等于删除；GitHub 在 GC 之前照常按 SHA 提供网页访问（实测 HTTP 200），fork 里也会留存 | 需要彻底清除得开工单请 GitHub 跑 GC。**改写历史能降低暴露面，但不能当成"已经删掉了"** —— 真正泄漏了凭据时必须轮换，而不是指望改历史 |
| 打开一次分镜页要从 OSS 拉 16 MB 图片，而流量包只有 2 GB/月 | 帧图是 Seedream 出的原图（88 张 PNG 平均 **1.09 MB**），却被直接 `<img src={uploadUrl(ref)}>` 渲染进 44–200 px 宽的卡片；浏览器只有 302 那一跳的 30 分钟缓存，换个浏览器或隔天再看就全部重下。**而且线上访问同样吃流量** —— 302 之后是浏览器直连 OSS 公网，`OSS_INTERNAL=1` 只管服务端自己 | `uploadUrl(ref, { w })` 在签名 URL 上加 `x-oss-process` 实时缩放，三档闭集 160/320/640 按实际渲染尺寸分配；零新增存储、零迁移、存量图立刻生效。实测 4448 KB → 7.4 KB。见约定 8o |
| 部署脚本报告成功，但 `src/app/api/uploads/` 的改动**永远到不了服务器** | rsync 的 `--exclude uploads`（无前导斜杠）匹配的是**任意一层**叫 uploads 的目录，于是那个路由目录被静默跳过。失败方式极其隐蔽：rsync 不报错、构建成功、两个容器 running、HTTP 200、脚本原有的「关键文件确实到位」检查也过（它只点名 3 个文件）—— **只有那一个文件停在旧版本**。同理 `--exclude data` 也会命中任意一层的 data 目录 | 路径型排除一律加前导斜杠（`/uploads` `/data` `/.next`）；`node_modules` / `.git` 保持不带斜杠（它们在任何一层都不该传）；顺带排掉 `.claude`（本机 agent 工作树，实测 87 MB 被传上了服务器）。并在 rsync 之后**比对两端 `src`/`drizzle`/`scripts` 的全量 cksum 指纹**——点名检查证明不了「全部到齐」，而漏传是静默的 |
| 把「我连不上服务器」当成「服务器挂了」，先后误判成 OOM、磁盘满、云盘 I/O 卡死，还据此对生产机做了**强制重启** | 三次都错。事后登进去看日志才知道：**机器从头到尾没坏** —— `journalctl --list-boots` 显示它连续运行了 28 小时（**我在控制台点的强制重启根本没生效**，而我当时把 VNC 上 `[ 3333.07]` 那个 dmesg 时间戳当成了 uptime）；上一次启动 OOM 次数 **0**；磁盘 54%、inode 20%；`systemctl --failed` 空；**4 GB swap 一直都在**；sshd 全程正常，日志里还有来自新 IP 的 `Accepted publickey` 成功登录。把我引偏的两个假象：① 本地 VPN/TUN 会伪造 TCP 连接成功与 ICMP 应答；② Linux 内核在**没有任何进程 accept()** 时也会完成三次握手，所以「端口开着」不证明后面有活人 | **先看日志，再下结论**：`journalctl --list-boots`（机器到底重启过没有）、`journalctl -b -1 -p err`、`journalctl -u ssh | grep Accepted`（对方到底连上过没有）。本地判据永远要带对照组：`nc -z <IP> 12345` 连一个没放行的端口，它若也「成功」说明本机结果全不可信。**没有日志支撑的因果推断不要写进文档，更不要拿它当动生产机的依据** |
| 登录提示成功，回到首页却没有数据，再进设置仍显示未登录 | `secureAttr()` 按 `NODE_ENV === "production"` 决定加不加 `Secure`，**假设了「生产 ⇒ HTTPS」**。而本项目在备案下来之前，生产就是明文 HTTP（`http://<ip>:3007`），浏览器会把 HTTP 响应里的 Secure cookie **静默丢弃** —— 登录接口返回 200、`Set-Cookie` 确实发了，浏览器就是不存，**控制台没有任何报错**，只有抓包才看得出来 | 改为按**这次请求实际用的协议**判断（`x-forwarded-proto` 优先，其次请求 URL 的 scheme），`COOKIE_SECURE=1/0` 可强制覆盖；四个下发/清除 cookie 的路由都要把 request 传进去。**拿不到 request 时默认不加** —— 两种错法代价不对称：该加没加只是少一层传输保护（还有 HttpOnly + SameSite=Lax），不该加却加了是**登录完全失效且无声无息**。清除 cookie 的属性必须与下发时完全一致，否则浏览器当成另一个 cookie、登出点了没反应。`auth-cookie-secure.test.ts` 钉死 |
| `REQUIRE_AUTH=1` 下未登录访客以为「我的项目丢了」 | 登录表单藏在设置页里，没有 `/login` 路由；而「未登录」和「还没建项目」**渲染出来是同一个空首页**，界面上没有任何「去登录」的入口。`page.tsx` 里算好的 `isAuthenticated` 一直悬空没被引用 | 新增 `/[locale]/login`；首页用 `isAuthRequired() && !isAuthenticated` 区分两种空状态，未登录时明确写「项目没有丢失，登录后即可看到」并把「新建项目」换成「登录」。**两种空状态长得一样但需要完全相反的引导，不区分等于把人堵死** |
| `/login?next=` 是开放重定向 | 不校验就能让用户在**我们的域名**下完成登录、再被送到钓鱼站，全程地址栏可信 —— 这正是钓鱼最想要的外壳 | `safeNext()` 只放行站内相对路径：挡绝对 URL、协议相对 `//evil.com`、以及反斜杠变体 `/\evil.com`（部分浏览器把 `\` 规范化成 `/`）。`login-safe-next.test.ts` 钉死 |
| 服务端组件调用 `"use client"` 模块导出的函数 → **线上 500，但本地全绿** | `buttonVariants` 定义在 `ui/button.tsx` 里，而那个文件顶部有 `"use client"`。服务端组件只能把客户端模块**当组件渲染**，不能**当函数调用**，运行时抛 `Attempted to call buttonVariants() from the server`。⚠️ **既不是类型错误也不是构建错误**：`tsc` 干净、`next build` 成功、单测全绿，只有真正渲染到那条分支时才炸 —— 而那条分支恰好只在 `REQUIRE_AUTH=1` 下出现，本地没开就永远走不到 | 纯样式配置（cva）拆到不带 `"use client"` 的 `ui/button-variants.ts`，`button.tsx` 照常 re-export，既有 import 不受影响。`server-safe-button-variants.test.ts` 做结构性守卫。**教训：只在某个环境变量下才出现的分支，本地跑不到就等于没验过 —— 要么在本地临时开那个开关，要么部署后立刻验那条分支** |
| 重写组件时把「在 effect 里读 localStorage」改回「在 render 里读」，引入 hydration mismatch | `localStorage` / `indexedDB` / `window` 只有浏览器有：在 render 里直接读，**服务端渲染出一个值、客户端渲染出另一个**，两份 HTML 对不上。被替换掉的旧代码里本来就有 `useEffect` + 一条明确注释在防这件事，重写时丢了 | 这类值一律 `useState(null)` + `useEffect` 里赋值。**重写一个组件前先读懂它每一处「看起来多余」的写法** —— `useEffect` 包一个同步读取、`typeof window !== "undefined"` 判断、看似无用的中间变量，通常都是在防某个具体的坑，注释没写全不代表没有原因 |
| 首页 dev 控制台常驻一条 `Hydration failed`（base-ui 生成的 `id` 服务端/客户端不一致）| `base-ui-_R_1pinekned5rlb_`（服务端）vs `base-ui-_R_dinekned5rlb_`（客户端）。React 明确说这类属性差异 **"won't be patched up"** —— 客户端会一直带着服务端那个 id，base-ui 的 aria 关联因此指错。**不是 dev-only**（我一度这么误判，见下）| **给 `DialogTrigger` 显式传 `id`**，base-ui 就不再自己生成。`CreateProjectDialog` 因此把 `triggerId` 做成**必填 prop** —— 它在首页出现两次，写死在组件里会产生重复 DOM id，同样破坏 aria 关联和 `getElementById`。已双向验证：去掉显式 id 报错复现，加上就干净 |
| 误判「这个 hydration 报错是 dev-only、线上没有」| 我拿生产环境的 `/zh/login` 和 `/zh/settings/prompts` 测出「零报错」就下了结论 —— 但**那两页根本不渲染出问题的组件**：生产是 `REQUIRE_AUTH=1`，未登录首页显示的是登录引导，`CreateProjectDialog` 压根没渲染。**「换个页面没复现」只有在那个页面确实包含问题组件时才算证据** | 排查顺序仍然是「先换未改动页面、再上生产构建复现」，但每一步都要先确认**被测页面真的包含那个组件**，否则测的是空气。另一类 hydration 问题（render 里读 `localStorage`/`window`）见上一条 || 页面级登录闸该放哪：**segment layout，不是 middleware** | middleware 跑在 **edge runtime，没有 node 的 `crypto`** —— 想在那里验 auth cookie 的签名，就得用 Web Crypto 再写一份 HMAC，于是仓库里有了**两份签名实现**，早晚漂移。而 segment layout 是服务端组件（node runtime），可以直接复用 `lib/auth.ts` 的 `parseCookieValue` | `src/app/[locale]/settings/layout.tsx` 是范本：`isAuthRequired()` 为真且 cookie 无效才 redirect。⚠️ 两条必须记住：① **未开 `REQUIRE_AUTH` 时不能拦** —— 自部署单机是匿名可用的，拦住等于废掉整个自部署场景；② **这是 UX 跳转，不是安全边界** —— 真正的准入在 API 那层（约定 8b），绕过跳转直接打接口一样会被挡。代价：layout 拿不到具体 pathname，从子页被踢出去时 `next=` 只能回到该区根路径 |
| 自部署用户 `docker compose up` 之后**一注册就 500** | `getSecret()` 在 `NODE_ENV=production` 且未设 `AUTH_SECRET` 时直接抛错，而 compose 跑的就是 production。匿名浏览没事（不解析 auth cookie 就不会调到它），一旦注册/登录才炸，且错误只在服务端日志里。**另一半**：原实现用 `??` 回落，只认 `undefined` —— 而 `.env.example` 里有一行 `# AUTH_SECRET=`，用户取消注释却没填就会拿**空字符串**当签名密钥，绕过所有校验、毫无提示 | 改为：`AUTH_SECRET` 为空/空白一律当作没设；没设时**自动生成一把随机密钥并落盘**到数据目录的 `.auth-secret`（与 sqlite 同目录，Docker 下在挂载卷里，重启不踢人），**不再有任何硬编码默认值**（公开仓库里的默认密钥等于没有密钥）。随机的每部署独立密钥安全性严格优于共享默认值，同时满足「装机即用」。`auth-secret.test.ts` 锁死三种状态 + 持久化 + 「源码里不得再出现那个默认密钥字面量」|
| 两端 sqlite3 / 哈希工具版本不同，指纹恒报「不一致」 | 本地 3.50、服务器 3.37，`.dump` 文本格式可能有差异；`shasum`（mac）与 `sha256sum`（linux）输出也不通用 | 比 `SELECT *` 的行数据而非 dump 文本（本库全是 TEXT/INTEGER，跨版本稳定）；哈希改用 POSIX `cksum`；按表算 CRC 后整库指纹只有 700 字节，还能直接说出是哪张表不同 |

---

## 视频编辑器架构

路由：`/[locale]/project/[id]/episodes/[episodeId]/editor`

**三栏布局**：左（MediaLibrary 208px）/ 中（VideoPreview 60% + Timeline 40%）/ 右（PropertyPanel 176px）

**状态管理**：`useEditorStore`（Zustand）负责：
- `tracks`：视频轨（`video`）/ 音频轨（`bgm`、`voice`）/ 字幕轨（`subtitle`）/ 特效轨（`effect`）
- `clips`：每条轨上的 clip，含 startTime / endTime / url / metadata
- `initFromShots(shots)`：进入编辑器时用分镜数据初始化视频 clip + 字幕 clip（从 `dialogues` 自动生成）

**BGM 生成入口**（`Timeline.tsx` → `BgmGeneratePanel`，在时间线上多选分镜片段后由顶部工具栏唤起；
`MediaLibrary.tsx` 音频 Tab 只负责上传本地 BGM 文件，不含生成）：
- 协议路由架构：`POST /api/bgm/generate` 接收 `{prompt, providerId, protocol, baseUrl, modelId?, targetDuration}`
- 添加新音乐 provider：在 `callMusicProvider` 的 switch-case 中新增 case，实现 `generateWithXxx()` 函数
- 密钥一律服务端从 `getProviderSecret(userId, providerId)` 读，客户端只传 `providerId + protocol + baseUrl`
- 豆包音乐（`volc-music`）单段仅支持 **30–120 整数秒**：服务端 clamp，客户端 `BGM_MIN/MAX_DURATION` 生成前提示；
  clip 时长取 `min(选区时长, 实际生成时长)`，避免选区超 120s 时尾部无声
- bgmNote 建议：分镜页的 `shots.bgmNote` 字段（从剧本 `【背景音】` 标签提取）在编辑器页去重后作为 chip 建议展示

**服务端渲染**：`POST /api/projects/[id]/episodes/[episodeId]/render`（ffmpeg concat，支持字幕 + BGM 混流），结果写入 `episodes.final_video_url`；编辑器顶部导航显示「上次导出」下载按钮（`project.finalVideoUrl`）。

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

- [ ] schema 改动有对应 migration 文件（每条语句之间带 `--> statement-breakpoint`）
- [ ] 新 provider 走 `createAIProvider` / `createVideoProvider`（自动过存储桥，约定 8e）
- [ ] 新增「文件在不在」的判断用 `shotFrameUsable`，不要裸写 `fs.existsSync`（约定 8f）
- [ ] 新视频 provider 在 `VIDEO_CAPABILITIES` 里有对应能力条目（约定 7a）
- [ ] 新生成路径传入了 `visualStyleTag`
- [ ] 新生成路径正确使用 `filterShotCharacters`（无 fallback）
- [ ] 客户端 episodeId 来自 `urlEpisodeId`，非 store
- [ ] 持久化偏好存 DB，非 localStorage
- [ ] `npx tsc --noEmit` 无报错
- [ ] 关键函数有对应单测
- [ ] **空库能建起来**：加了迁移之后跑一次 `baseline-schema.test.ts`（约定 8l）
- [ ] 新 API 路由接了 `api-guard`，或在 `route-auth-guard.test.ts` 白名单里登记了理由（约定 8b）
