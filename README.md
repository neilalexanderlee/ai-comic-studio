# AI漫剧工坊

**AI Comic Studio** (`ai-comic-studio`) — 开源漫剧（manju）工作流：从剧本到分镜、首尾帧、视频与合成。

| | |
|---|---|
| **GitHub** | [github.com/neilalexanderlee/ai-comic-studio](https://github.com/neilalexanderlee/ai-comic-studio) |
| **npm 包名** | `ai-comic-studio` |

AI 驱动的漫剧工坊 — 从剧本到动画视频的全自动流水线。

📺 **系统介绍 / Demo**：[Bilibili — AI漫剧工坊](https://b23.tv/3xzE8uz)

> 基于 [AIComicBuilder](https://github.com/twwch/AIComicBuilder)（Apache-2.0）演进。上游致谢与版权说明见 [NOTICE](./NOTICE)。

## 功能特性

- **剧本导入** — 支持上传 TXT/DOCX/PDF 文件，AI 自动解析文本、提取角色、智能分集，流程可视化
- **分集管理** — 项目级分集列表，角色按集关联，支持手动创建或导入自动分集
- **角色管理** — 项目级角色管理，主角/配角分区展示，支持跨集复用和按集独立解析
- **剧本创作** — 手动编写或 AI 辅助生成剧本
- **角色提取** — AI 自动从剧本中提取角色并生成详细视觉描述；支持批量生成 9 维标准化音色描述
- **角色四视图** — 为每个角色生成四视图参考图（正面/四分之三/侧面/背面），确保后续帧画面一致性
- **智能分镜** — AI 将剧本拆解为专业镜头列表（含景别、主光、运镜、motionScript 动作链等结构化字段）
- **分镜督导批量重写** — 全集一次性七律视觉连续性审核：LLM 读入全部分镜，批量重写首尾帧描述与动作脚本，保证跨镜场景词一致性
- **首尾帧生成** — 三层决策策略（确定性规则 → LLM 语义判断 → 安全兜底）自动决定每个镜头生成首帧+尾帧还是仅首帧；支持最多 14 张多选参考图
- **视频提示词** — 直出架构：基于 startFrameDesc / motionScript / cameraDirection 零 LLM 费用生成，支持直接编辑
- **视频生成** — 基于首尾帧插值生成动画视频片段；Seedance 多参模式支持 Track 分组（≤15s）+ 音色克隆
- **镜头衔接** — 开启后自动将上一镜视频尾帧链接为下一镜首帧，保证镜间画面连贯
- **视频合成** — 将所有片段拼接为完整动画，支持字幕烧录
- **分镜工作流** — 分镜编辑抽屉、角色内联面板、看板视图三种协作视图
- **帧图管理** — 生成帧支持手动上传替换及一键清除
- **提示词模板** — 内置 S 级分镜标准提示词模板，支持槽位化编辑与版本管理
- **资源下载** — 支持最终视频下载及全部素材打包下载
- **多语言** — 中文 / English / 日本語 / 한국어
- **风格自适应** — 自动识别剧本风格（动漫/写实/国风/3D 等），角色四视图与首尾帧生成均匹配对应风格
- **视频比例** — 支持 16:9 / 9:16 / 1:1 / 自适应比例，首尾帧与视频生成统一比例
- **多模型** — 支持 OpenAI、Gemini、Doubao/Seedream、即梦、Kling、Seedance、Veo 等多家 AI 供应商，可按项目配置
- **密钥后端存储** — 模型 API Key/Secret Key 通过后端接口写入数据库，不再持久化在浏览器 localStorage/sessionStorage

## 技术栈

| 层级 | 技术 |
|------|------|
| 框架 | Next.js 16 (App Router) |
| 前端 | React 19, Tailwind CSS 4, Zustand, Base UI |
| 国际化 | next-intl |
| 数据库 | SQLite + Drizzle ORM |
| AI 文本 | OpenAI / Gemini (via AI SDK) |
| AI 图像 | OpenAI DALL-E / Gemini Imagen / Kling |
| AI 视频 | Seedance / Kling / Veo |
| 视频处理 | FFmpeg (fluent-ffmpeg) |
| 包管理 | pnpm |

## 快速开始

### 本地开发（推荐）

热更新亚秒级响应，适合日常开发。

**前置依赖：** Node.js 18+、pnpm、FFmpeg

```bash
# macOS
brew install ffmpeg

# Ubuntu / Debian
sudo apt install ffmpeg
```

```bash
pnpm install
pnpm drizzle-kit push   # 初始化数据库（首次）
pnpm dev                # 启动开发服务器
```

访问 [http://localhost:3007](http://localhost:3007)

### Docker 部署（生产）

```bash
make build    # 构建镜像并启动
make up       # 仅启动（镜像已构建）
make down     # 停止
make logs     # 查看日志
```

数据通过 volume 持久化：`./data`（数据库）、`./uploads`（媒体文件）。

## 生成流水线

```
剧本输入 → 剧本解析 → 角色提取（含音色描述）→ 角色四视图
                                                      ↓
                                                   智能分镜
                                                      ↓
                                        （可选）分镜督导全集批量重写
                                                      ↓
                                           首尾帧生成（逐镜头）
                                         三层决策 + 多参考图支持
                                                      ↓
                                        视频提示词直出（零 LLM 费用）
                                                      ↓
                                     视频生成（Seedance 多参 / Kling 等）
                                         镜头衔接自动传递尾帧
                                                      ↓
                                            视频合成 + 字幕烧录
```

每个阶段支持单独触发或批量生成，用户可完全控制流水线节奏。分镜页提供列表视图和看板视图，看板按生成进度自动分列。支持分镜版本管理，可创建多个版本进行对比迭代。

## 项目结构

```
src/
├── app/
│   ├── [locale]/                # i18n 路由
│   │   ├── (dashboard)/         # 项目列表
│   │   ├── project/[id]/        # 项目编辑器
│   │   │   ├── script/          # 剧本编辑
│   │   │   ├── characters/      # 角色管理
│   │   │   ├── storyboard/      # 分镜面板
│   │   │   └── preview/         # 预览 & 合成
│   │   └── settings/            # 模型配置
│   └── api/                     # API 路由
├── components/
│   ├── ui/                      # 基础 UI 组件
│   ├── editor/                  # 编辑器组件
│   └── settings/                # 设置组件
├── lib/
│   ├── ai/                      # AI 供应商 & Prompt
│   ├── pipeline/                # 生成流水线
│   ├── db/                      # 数据库 Schema
│   └── video/                   # FFmpeg 处理
└── stores/                      # Zustand 状态管理
```

## 数据模型

- **Project** — 项目（剧本、视觉风格、比例、增强开关、镜头衔接开关）
- **Episode** — 分集（序号、描述、关键词）
- **Character** — 角色（视觉描述、9 维音色描述、定妆图/音频资产）
- **StoryboardVersion** — 分镜版本（支持多版本对比迭代）
- **Shot** — 镜头（startFrameDesc / endFrameDesc / motionScript / cameraDirection / 首尾帧路径 / 视频路径）
- **Dialogue** — 对白（角色、文本、类型 dialogue/os/vo）
- **Task** — 后台任务队列

## 界面截图

| 项目列表 | 分集管理 |
|:---:|:---:|
| ![项目列表](images/demo/list.png) | ![分集管理](images/demo/分集管理.png) |

| 剧本导入 | 导入 — 角色解析 | 导入 — 自动分集 |
|:---:|:---:|:---:|
| ![剧本导入](images/demo/剧本上传.png) | ![角色解析](images/demo/剧本上传-角色解析.png) | ![自动分集](images/demo/剧本上传-自动分集.png) |

| 角色管理 | 剧本生成 |
|:---:|:---:|
| ![角色管理](images/demo/角色管理.png) | ![剧本生成](images/demo/剧本生成.png) |

| 角色解析 | 分镜 | 分镜看板 |
|:---:|:---:|:---:|
| ![角色解析](images/demo/角色解析.png) | ![分镜](images/demo/分镜.png) | ![分镜看板](images/demo/分镜看板.png) |

| 看板 | 看板详情 |
|:---:|:---:|
| ![看板](images/demo/看板.png) | ![看板详情](images/demo/看板详情.png) |

| 预览 | 模型配置 |
|:---:|:---:|
| ![预览](images/demo/预览.png) | ![模型配置](images/demo/模型配置.png) |

| 提示词快捷入口 |
|:---:|
| ![提示词快捷入口](images/demo/提示词快捷入口.png) |

## Demo

[Bilibili — AI漫剧工坊](https://b23.tv/3xzE8uz)

## 模型配置（重要）

首次使用需要在设置页配置模型供应商。

### 支持的供应商

| 供应商 | 支持能力 | 需要的密钥 |
|--------|----------|------------|
| OpenAI | 文本、图像 | OpenAI API Key |
| Gemini | 文本、图像、视频 | Gemini API Key |
| Doubao / Seedream | 图像（火山方舟 ARK API） | ARK API Key |
| 即梦（Jimeng） | 图像、视频 | Jimeng API Key |
| Seedance | 视频（火山方舟 ARK API） | ARK API Key |
| Kling | 图像、视频 | Access Key + Secret Key |
| Veo | 视频 | 通过 Gemini 体系使用 |

### 配置步骤

1. 打开“设置”页面
2. 添加供应商（OpenAI / Gemini / Seedance / Kling）
3. 填写 `name`、`baseUrl`、`apiKey`（Kling 还需要 `secretKey`；Doubao/Seedance 使用火山方舟 ARK API Key）
4. 点击“获取模型列表”并勾选可用模型
5. 设为默认文本/图像/视频模型

### 密钥安全说明

- 密钥保存到后端数据库，不再存储在浏览器 localStorage/sessionStorage
- 刷新页面、重开浏览器后模型配置仍然有效
- 建议仅在受信任设备上使用，定期轮换 API Key

## 使用流程

1. 创建项目（选择比例与生成模式）
2. 输入或导入剧本（TXT / DOCX / PDF）
3. 角色提取与分镜生成
4. 帧图生成（首尾帧或场景参考帧）
5. 视频生成与最终合成

## 数据与目录

| 路径 | 说明 |
|------|------|
| `./data/aicomic.db` | SQLite 数据库 |
| `./uploads/` | 媒体文件 |
| `./uploads/frames/` | 帧图片 |
| `./uploads/videos/` | 视频片段和成片 |

## 安全与隐私说明

### 部署边界

- 推荐本机或受信内网使用，不要直接暴露公网
- Docker 端口示例默认绑定 `127.0.0.1:3007:3007`（仅本机访问）

### 日志与第三方上报

- Prompt/脚本相关日志已做降敏处理，不再打印完整 system prompt / promptRequest / videoPrompt
- 项目代码中未发现 Sentry / PostHog / Mixpanel / Datadog 等第三方日志上报

### 模型调用数据流

- 输入的剧本、提示词、参考图会发送到你配置的模型供应商执行生成任务
- 生成媒体保存在本地 `uploads` 目录

## 故障排查

### Q1：`better-sqlite3` 报错

```bash
pnpm rebuild better-sqlite3
```

### Q2：找不到 FFmpeg

```bash
ffmpeg -version
```

### Q3：模型调用提示 Key 无效

- 检查 Key 是否正确、是否过期、是否有余额/配额
- 在设置页重新保存该 Provider 的密钥后再重试

### Q4：视频生成慢或超时

- 降低并发批量
- 缩短时长
- 检查网络和目标模型服务状态

## 环境变量参考

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `DATABASE_URL` | `file:./data/aicomic.db` | SQLite 数据库路径 |
| `UPLOAD_DIR` | `./uploads` | 上传与生成媒体目录 |
| `OPENAI_API_KEY` | - | OpenAI Key |
| `OPENAI_BASE_URL` | - | OpenAI/兼容 API 基础地址 |
| `OPENAI_MODEL` | - | 默认 OpenAI 文本模型 |
| `GEMINI_API_KEY` | - | Gemini Key |
| `SEEDANCE_API_KEY` | - | Seedance Key |
| `SEEDANCE_BASE_URL` | `https://ark.cn-beijing.volces.com/api/v3` | Seedance 地址 |
| `SEEDANCE_MODEL` | - | 默认 Seedance 模型 |
| `KLING_ACCESS_KEY` | - | Kling Access Key |
| `KLING_SECRET_KEY` | - | Kling Secret Key |
| `KLING_BASE_URL` | `https://api.klingai.com` | Kling 地址 |

## 系统架构

### 总体架构

- 基于 Next.js App Router 的全栈单体应用（前后端同仓）。
- 前端负责项目编辑、配置与触发生成；后端 API 负责模型调用、任务编排、数据落库。
- 数据层使用 SQLite + Drizzle ORM；媒体文件落在本地 `uploads`。

### 目录结构（核心）

```text
src/
├── app/                      # 页面与 API 路由
│   ├── [locale]/             # 国际化页面路由
│   └── api/                  # 后端 API
├── components/               # 页面/业务组件
├── lib/
│   ├── ai/                   # Provider 实现、提示词模板、工厂
│   ├── db/                   # schema 与数据库连接
│   ├── pipeline/             # 各阶段流水线逻辑
│   ├── task-queue/           # 后台任务队列
│   └── video/                # ffmpeg 封装
├── stores/                   # Zustand 状态管理
└── i18n/                     # 国际化配置
```

### 关键数据模型

- `projects`：项目主表（标题、剧本、视觉风格、增强开关、镜头衔接开关）
- `episodes`：分集信息（序号、描述、关键词）
- `storyboard_versions`：分镜版本（按集关联，支持多版本）
- `characters`：角色信息（视觉描述、9 维音色描述）
- `character_assets`：角色资产（定妆图、音色参考音频）
- `shots`：镜头信息（startFrameDesc / endFrameDesc / motionScript / 首尾帧路径 / 视频路径）
- `dialogues`：对白（类型 dialogue/os/vo）
- `tasks`：异步任务队列
- `provider_secrets`：模型密钥后端存储（按 `userId + providerId` 关联）

### 核心 API（按职责）

- 项目管理：`/api/projects/*`
- 统一生成入口：`POST /api/projects/[id]/generate`（通过 `action` 分发）
- 剧本导入：`/api/projects/[id]/upload-script` 与 `/api/projects/[id]/import/*`
- 资源访问：`/api/uploads/[...path]`
- 模型相关：`/api/models/list`、`/api/provider-secrets/*`
- 提示词系统：`/api/prompt-templates/*`、`/api/prompt-presets/*`

### AI Provider 架构

- Provider 工厂在 `src/lib/ai/provider-factory.ts`，按配置分发到 OpenAI / Gemini / Seedance / Kling / Veo。
- 文本、图像、视频调用走统一抽象接口，便于切换供应商。
- 提示词模板在 `src/lib/ai/prompts/`，支持槽位化编辑与版本化管理。

### 任务与媒体处理

- 生成任务通过 `src/lib/task-queue/` 执行（支持状态跟踪与重试）。
- 视频后处理由 `src/lib/video/ffmpeg.ts` 完成（拼接、字幕烧录等）。
- 所有媒体默认落地本地 `uploads`，再通过 API 路由提供访问。

### 国际化与状态管理

- 国际化：`next-intl`，支持 zh/en/ja/ko。
- 前端状态：Zustand（项目、分集、模型配置、提示词编辑状态等）。

## Git 同步（GitHub + 本地 git-server）

本项目配置了两个远程仓库，用途不同：

| 远程名 | 地址 | 用途 |
|--------|------|------|
| `origin` | `https://github.com/neilalexanderlee/ai-comic-studio.git` | GitHub 公开仓库 |
| `local` | `/Users/chenjiewen/git-server/ai-comic-studio.git` | 本机 bare 仓库备份 |

### 日常推送

改完代码后：

```bash
git status
git add .
git commit -m "描述本次改动"

git push origin main   # 推送到 GitHub
git push local main    # 推送到本地 git-server（可选备份）
```

两个都推：

```bash
git push origin main && git push local main
```

### 首次配置远程（新 clone 时参考）

若仓库还没有 `local` 远程，可按下面方式配置（路径按你的本机 bare 仓库位置调整）：

```bash
# 若 origin 当前指向本地 bare 仓库，先改名为 local
git remote rename origin local

# 添加 GitHub 为主远程 origin
git remote add origin https://github.com/neilalexanderlee/ai-comic-studio.git

git remote -v
```

首次推送到 GitHub：

```bash
git push -u origin main
```

### 不会上传的敏感文件

`.env`、`data/`（含数据库与 API Key）、`uploads/` 已在 `.gitignore` 中，正常 `git push` **不会**把这些文件推到 GitHub 或本地 git-server。推送前可用 `git status` 确认暂存区里没有上述路径。

## License

本项目采用 [Apache License 2.0](./LICENSE)，并附一份**补充协议**（见 LICENSE 末尾）。

**一句话版本**：自己部署随便用，改随便改，**用它做片子赚钱也随便赚**——
唯一的限制是「把本软件本身包装成与官方服务竞争的托管服务卖出去」需要先谈授权。

- 版权与上游衍生说明：[NOTICE](./NOTICE)
- 补充协议适用范围：仅约束本项目的原创贡献；来自
  [AIComicBuilder](https://github.com/twwch/AIComicBuilder) 的部分继续单纯按 Apache-2.0 授权
- 补充协议**不追溯**：在其加入之前发布的版本继续按纯 Apache-2.0 可用

> ⚠️ 补充协议目前为**草案，尚未经律师复核**，措辞可能调整。



