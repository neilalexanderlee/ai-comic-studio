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
  ├── visualStyle: string        # 锁定全项目画风
  ├── generationMode: keyframe|reference
  ├── enhancePrompts: 0|1        # AI prompt 增强开关
  ├── useProjectPrompts: 0|1     # 是否用项目级 prompt 模板
  │
  ├──< Episode (N)
  │     ├── generationMode (可覆盖 project 级)
  │     │
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
  │     │           ├── firstFrame: path        # 本地文件路径
  │     │           ├── lastFrame: path
  │     │           ├── videoUrl: path
  │     │           ├── seedanceLastFrame: path # Seedance 实际尾帧
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

### 3.1 Keyframe 模式（双帧驱动）

```
Shot prompt
    │
    ├── filterShotCharacters(shotText, episodeChars)
    │       └── 仅保留 shot 文本中明确出现的角色名
    │           ⚠️ 无匹配 → 返回 []，不 fallback 到全量
    │
    ├── resolveCharacterImages(sceneDesc, chars, textModel)
    │       └── 为每个角色选择最合适的 morph asset（战斗/日常等）
    │           通过 LLM 判断场景氛围，多 morph 时才调用
    │
    ├── buildFirstFramePrompt(params) → raw prompt
    │       └── 注入: visualStyleTag + cameraDirection + characterDescriptions
    │
    ├── [if enhancePrompts] enhanceImagePrompt(raw, protocol, textProvider)
    │       └── 按目标图片模型重写 prompt（Seedream 六步 / DALL-E 英文 / 等）
    │
    ├── imageProvider.generateImage(enhancedPrompt, { referenceImages, ... })
    │       └── → firstFrame (本地路径)
    │
    ├── buildLastFramePrompt(params)  → [enhance] → generateImage
    │       └── → lastFrame (本地路径)
    │
    └── videoProvider.generateVideo({ firstFrame, lastFrame, ... })
            └── → videoUrl (本地路径)
```

### 3.2 Reference 模式（单帧驱动）

```
Shot prompt
    │
    ├── buildSceneFramePrompt → [enhance] → generateImage → sceneRefFrame
    │
    └── buildReferenceVideoPrompt → [enhance] → generateVideo({ initialImage: sceneRefFrame })
```

### 3.3 Chain 模式（连续帧接力）

```
Shot[0]: firstFrame = 用户上传或独立生成
Shot[i]: firstFrame = Shot[i-1].seedanceLastFrame（Seedance 实际尾帧）
         ← 实现视频间的视觉连续性
```

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
| PATCH | `/api/projects/[id]` | 更新项目属性（title/generationMode/enhancePrompts/visualStyle 等） |
| DELETE | `/api/projects/[id]` | 删除项目及所有子数据 |
| GET | `/api/projects/[id]/episodes/[episodeId]` | 剧集数据（含 shots/characters/versions） |
| POST | `/api/projects/[id]/generate` | **核心生成接口**（SSE，见下） |
| DELETE | `/api/projects/[id]/episodes/[episodeId]/versions/[versionId]` | 删除分镜版本 |

### Generate 路由（SSE）

`POST /api/projects/[id]/generate` 接受一个 `action` 字段路由到不同 handler：

| action | 说明 |
|---|---|
| `batch_frame_generate` | 批量生成所有 shot 的首尾帧（Chain 模式） |
| `single_frame_generate` | 单个 shot 的首尾帧 |
| `batch_video_generate` | 批量生成视频 |
| `single_video_generate` | 单个视频 |
| `batch_chain_generate` | 帧+视频链式批量生成 |
| `single_scene_frame` | Reference 模式：生成单个场景帧 |
| `batch_scene_frame` | Reference 模式：批量场景帧 |
| `single_reference_video` | Reference 模式：单个参考视频 |
| `batch_reference_video` | Reference 模式：批量参考视频 |

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
- 所有持久数据，包括偏好设置（`enhancePrompts`、`generationMode` 等）

### 客户端（Zustand）
- `ProjectStore`：当前项目数据（shots/characters/versions），从 API 加载
  - **注意**：`currentEpisodeId` 在首次渲染时可能为 null，操作时要用 `useParams()` 中的 `urlEpisodeId`
- `EpisodeStore`：剧集列表缓存
- `ModelStore`：当前选择的 AI 模型配置（text/image/video）

### 不持久化到 localStorage 的内容
- AI 模型选择（存 ModelStore，从设置 DB 加载）
- enhancePrompts 开关（存 `projects.enhance_prompts`）
- 视图模式 storyboard/kanban（localStorage 可以，因为是纯 UI 偏好）

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
  registerPipelineHandlers()
  startWorker()      // 后台任务队列（视频下载等异步任务）
```

**开发注意**：`bootstrapped` 是模块级变量，热重载后 Next.js 会重新执行模块，自动重跑迁移。
