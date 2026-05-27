# AIComicBuilder — 系统架构文档

---

## 1. 系统全景

```
┌─────────────────────────────────────────────────────────┐
│                    Browser (Next.js Client)              │
│  ProjectStore (Zustand) ── EpisodeStore ── ModelStore   │
│       ↕ apiFetch (cookie auth)                          │
├─────────────────────────────────────────────────────────┤
│                  Next.js Server (Route Handlers)         │
│                                                         │
│  /api/projects/[id]/generate  ← 核心生成路由 (SSE)      │
│  /api/projects/[id]/episodes/[episodeId]  ← 剧集数据    │
│  /api/projects/[id]/characters            ← 角色管理    │
│  /api/projects/[id]/shots/[shotId]        ← 单镜操作    │
│                                                         │
│  bootstrap() → runMigrations() → initProviders()        │
├─────────────────────────────────────────────────────────┤
│                    SQLite (better-sqlite3)               │
│  projects ─< episodes ─< storyboard_versions ─< shots  │
│  projects ─< characters ─< character_assets             │
│  episodes >─< characters (via episode_characters)       │
├─────────────────────────────────────────────────────────┤
│                   AI Provider Layer                      │
│  Text: OpenAI / Gemini                                  │
│  Image: OpenAI(DALL-E) / Gemini(Imagen) /               │
│         Doubao(Seedream) / Kling / Jimeng               │
│  Video: Seedance / Kling / Jimeng-video / Veo           │
└─────────────────────────────────────────────────────────┘
```

---

## 2. 数据模型

### 核心实体关系

```
Project (1)
  ├── visualStyle: string              # 锁定全项目画风
  ├── enhancePrompts: 0|1              # AI prompt 增强开关
  ├── linkShotsViaCutPoint: 0|1        # 视频尾帧自动衔接下一镜（默认关）
  ├── useProjectPrompts: 0|1           # 是否用项目级 prompt 模板
  │
  ├──< Episode (N)
  │     ├──< StoryboardVersion (N)
  │     │     ├── versionNum: int
  │     │     ├── label: string
  │     │     └──< Shot (N)
  │     │           ├── prompt: string          # 场景描述
  │     │           ├── startFrameDesc          # 首帧描述
  │     │           ├── endFrameDesc            # 尾帧描述
  │     │           ├── videoScript             # 视频脚本
  │     │           ├── motionScript            # 运动描述
  │     │           ├── cameraDirection         # 运镜
  │     │           ├── duration: int           # 秒
  │     │           ├── anchorFirst: path       # Seedream 首帧（anchor_first）
  │     │           ├── anchorLastAi: path       # Seedream AI 尾帧（可选）
  │     │           ├── cutPoint: path           # 视频真实尾帧（Seedance return_last_frame）
  │     │           ├── videoUrl: path
  │     │           ├── chainSourceShotId / chainSourceType  # 首帧参考追溯
  │     │           ├── remoteVideoUrl          # 远程视频 URL（有效期 48h）
  │     │           └──< Dialogue (N)
  │     │
  │     └──< EpisodeCharacter >── Character
  │
  └──< Character (N)
        ├── visualHint: string   # 服装/外貌描述，注入 prompt
        ├── voiceHint: string    # 声音属性（Seedance 1.5-pro）
        ├── scope: main|guest
        └──< CharacterAsset (N)
              ├── assetType: morph|blueprint
              ├── tag: string    # 状态标签，如"日常"/"战斗"
              └── imagePath: string
```

### Shot 状态机

```
pending → generating → completed
                    ↘ error (在 warnings 字段记录)
```

---

## 3. AI 生成 Pipeline

> **用户操作手册**：[WORKFLOW.md](./WORKFLOW.md)  
> **帧/视频字段与衔接语义**：[ARCHITECTURE-FRAMES.md](./ARCHITECTURE-FRAMES.md)（含「Plan B」名词说明 §0）

### 3.1 单镜生成（当前帧方案）

```
Shot prompt / startFrameDesc / endFrameDesc
    │
    ├── filterShotCharacters(shotText, episodeChars)
    │       └── 无匹配 → []，不 fallback 全量角色
    │
    ├── resolveFrameMode (确定性 + 可选 LLM judge) → first_only | both
    │
    ├── single_frame_generate
    │       ├── 可选 payload.frameReference → Seedream 参考图重绘 → anchor_first
    │       ├── resolveFrameMode=both → 再生成 anchor_last_ai
    │       └── 无自动读上一镜尾帧
    │
    ├── single_video_generate
    │       ├── 群演或无 anchor_last_ai 文件 → 仅 anchor_first（参考图模式）
    │       ├── 否则 anchor_first + anchor_last_ai（首尾帧模式）
    │       └── Seedance return_last_frame → 下载写入 cut_point（不写 anchor_last_ai）
    │
    └── 可选 link_shots_via_cut_point → cut_point[i] 直拷 anchor_first[i+1]
```

**客户端 UI：** 列表 `ShotCard` 与看板→`ShotDrawer` 共用 `useShotFrameActions`、`ShotFrameAssets`、`ShotFrameToolbar`（`src/hooks/`、`src/components/editor/`）。

### 3.2 Reference 双轨（已废弃）

`sceneRefFrame` / `referenceVideoUrl` 及 `single_scene_frame`、`batch_reference_video` 等 action 均返回 **410**。新镜头仅走 §3.1。

### 3.3 镜头衔接

> **帧/视频字段语义详见 [ARCHITECTURE-FRAMES.md](./ARCHITECTURE-FRAMES.md)。**

**当前（2026-05）：**

- 无批量链式、无生成画面前自动衔接。
- 视频结束后写入本镜 `cut_point`。
- 项目开关 **`link_shots_via_cut_point`**（UI「镜头衔接（视频尾帧）」，默认关）：开启时，同集同版本自动 `cut_point[i]` → `anchor_first[i+1]`（路径直拷）。
- 手动：参考图选择器（AI 重绘）、「承接上一镜尾帧」（本集）、「承接上一集尾帧」（跨集）。
- Worker `frame_generate` / `video_generate` 已废弃（enqueue **410**）。

**已移除：** `batch_chain_generate`、续上集、一键续跑、镜间批量直拷、Reference 生成 API。

### 3.4 Prompt 增强流

```
Protocol 字符串 → prompt-enhancer.ts
    VIDEO_ENHANCE_SYSTEM_PROMPTS[protocol] 或 IMAGE_ENHANCE_SYSTEM_PROMPTS[protocol]
        ↓
    textProvider.generateText(rawPrompt, { systemPrompt, temperature: 0.3 })
        ↓
    enhanced prompt（失败时静默回退到 raw）
```

---

## 4. API 结构

### 核心路由

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/projects` | 项目列表 |
| POST | `/api/projects` | 创建项目 |
| GET | `/api/projects/[id]` | 项目详情（含 shots/characters/versions） |
| PATCH | `/api/projects/[id]` | 更新项目属性（title/enhancePrompts/linkShotsViaCutPoint/visualStyle 等） |
| DELETE | `/api/projects/[id]` | 删除项目及所有子数据 |
| GET | `/api/projects/[id]/episodes/[episodeId]` | 剧集数据（含 shots/characters/versions） |
| POST | `/api/projects/[id]/generate` | **核心生成接口**（SSE，见下） |
| DELETE | `/api/projects/[id]/episodes/[episodeId]/versions/[versionId]` | 删除分镜版本 |

### Generate 路由（SSE）

`POST /api/projects/[id]/generate` 接受一个 `action` 字段路由到不同 handler：

| action | 说明 |
|---|---|
| `single_frame_generate` | 单镜 `anchor_first` / `anchor_last_ai`；支持 `frameReference` |
| `single_video_generate` | 单镜视频；写 `cut_point`；可返回 `shotLink`（自动衔接结果） |
| `single_video_prompt` | 单镜视频提示词 |
| `batch_video_prompt` | 批量视频提示词（仍可用） |
| `batch_frame_generate` | 已废弃（410） |
| `batch_video_generate` | 已废弃（410） |
| `batch_chain_generate` 等 Reference / pipeline action | 已废弃（410） |

**镜间衔接 HTTP（非 generate）：**

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `.../shots/[shotId]/adopt-prev-episode-frame` | 跨集：上一集最后一镜尾帧 → 本镜 `anchor_first` |

> 完整废弃列表与产品决策见 [ARCHITECTURE-FRAMES.md §2.4、§4](./ARCHITECTURE-FRAMES.md)。

SSE 事件格式：
```json
{ "shotId": "01KR...", "sequence": 3, "status": "generating" | "completed" | "skipped" | "error" }
```

---

## 5. Provider 系统

### Provider Factory

`src/lib/ai/provider-factory.ts` 是唯一的 provider 实例化入口：

```typescript
createAIProvider(config: ProviderConfig, uploadDir?) → AIProvider
createVideoProvider(config: ProviderConfig, uploadDir?) → VideoProvider

resolveAIProvider(modelConfig?)    → text provider
resolveImageProvider(modelConfig?) → image provider
resolveVideoProvider(modelConfig?) → video provider
```

`modelConfig` 来自请求体，由用户在设置页配置，fallback 到环境变量默认值。

### Provider 接口

```typescript
// src/lib/ai/types.ts
interface AIProvider {
  generateText(prompt, options?: TextOptions): Promise<string>
  generateImage(prompt, options?: ImageOptions): Promise<string>
  generateImages?(prompts[], options?): Promise<string[]>  // 可选：批量连贯生成
}

interface VideoProvider {
  generateVideo(params: VideoGenerateParams): Promise<VideoGenerateResult>
}
```

---

## 6. 状态管理

### 服务端（SQLite）
- 所有持久数据，包括偏好设置（`enhancePrompts`、`linkShotsViaCutPoint` 等）

### 客户端（Zustand）
- `ProjectStore`：当前项目数据（shots/characters/versions），从 API 加载
  - **注意**：`currentEpisodeId` 在首次渲染时可能为 null，操作时要用 `useParams()` 中的 `urlEpisodeId`
- `EpisodeStore`：剧集列表缓存
- `ModelStore`：当前选择的 AI 模型配置（text/image/video）

### 不持久化到 localStorage 的内容
- AI 模型选择（存 ModelStore，从设置 DB 加载）
- `enhancePrompts`、`linkShotsViaCutPoint`（存 `projects` 表）
- 分镜视图 list/kanban（`localStorage` `storyboardView:{projectId}`，纯 UI）

---

## 7. 文件存储

所有生成的图片/视频存储在本地磁盘：

```
uploads/
  images/   # 生成的帧图片（.png）
  videos/   # 生成的视频（.mp4）
  frames/   # 角色参考图
```

路径通过 `getVersionedUploadDir(versionId)` 获取，按版本隔离。

远程 URL（Seedance / Kling 等返回的云端链接）存储在 `shots.remoteVideoUrl`，有效期约 48 小时，到期后需要重新下载。

---

## 8. 安全 & 认证

- **未认证用户**：通过浏览器 fingerprint 生成 `userId`，存 cookie
- **已认证用户**：JWT 存 cookie，`getAuthUserIdFromRequest` 解析
- **数据隔离**：所有查询均加 `eq(projects.userId, userId)` 条件
- **本地开发**：认证可选，fingerprint 模式即开即用

---

## 9. Bootstrap 启动序列

```typescript
bootstrap()
  runMigrations()    // idempotent，基于 SHA-256 hash 跟踪已应用迁移
  initializeProviders()  // 从 DB secrets 或环境变量加载 API key
  registerPipelineHandlers()  // script_parse / character_* / video_assemble；不含 frame/video_generate
  startWorker()             // 后台任务队列（视频下载等异步任务）
```

**开发注意**：`bootstrapped` 是模块级变量，热重载后 Next.js 会重新执行模块，自动重跑迁移。
