# Prompt 工程架构 — S 级漫剧（单一事实来源）

> 帧/视频资产语义见 [ARCHITECTURE-FRAMES.md](./ARCHITECTURE-FRAMES.md)。操作见 [WORKFLOW.md](./WORKFLOW.md)。  
> **默认模板编写规范**见 [PROMPT-TEMPLATE-AUTHORING.md](./PROMPT-TEMPLATE-AUTHORING.md)。  
> 火山方舟文档见 [docs/APIs/](./APIs/)（Seedream 提示词指南、Seedance 提示词指南、Seedream→Seedance 最佳实践）。

---

## 四层流水线

```mermaid
flowchart LR
  upstream[上游 LLM 分镜字段]
  assembly[组装层 registry + builders]
  enhance[可选 prompt-enhancer]
  api[Seedream / Seedance API]
  upstream --> assembly --> enhance --> api
```

| 层 | 职责 | 代码入口 |
|----|------|----------|
| **1. 上游** | 分镜字段 LLM 写出合规 start/end/videoScript 等 | 见下表「提示词分层」 |
| **2. 组装** | 把 DB 字段拼成模型输入；**不**把 `prompt` 当首/尾帧主画面 | [frame-prompt-context.ts](../src/lib/storyboard/frame-prompt-context.ts)、[frame-generate.ts](../src/lib/ai/prompts/frame-generate.ts)、[video-generate.ts](../src/lib/ai/prompts/video-generate.ts) |
| **3. 增强** | 按协议改写；推理链由 [sanitize-model-output.ts](../src/lib/ai/sanitize-model-output.ts) 剥离 | [prompt-enhancer.ts](../src/lib/ai/prompt-enhancer.ts) |
| **4. API** | 图像静帧 / 视频运动 | `generate/route.ts` |

---

## 提示词分层（剧本 vs 分镜 vs 组装）

避免在「提示词管理」里误改期待：**不是所有条目都是 S 级单镜四要素标准**。

| 层级 | 用途 | 是否在提示词管理 | 代表入口 |
|------|------|------------------|----------|
| **剧本层** | 大纲、整本剧本、分集、角色规格书 | 是（`script_*`、`character_*`） | `script_generate`、`script_parse`、`script_split`、`character_extract` |
| **分镜上游** | 切镜 / 单镜重写 → DB 字段 | 是（见下表） | `shot_split`、`single_shot_rewrite` 等 |
| **组装层** | 把 DB 字段拼成 Seedream/Seedance 输入 | 是（`frame_*`、`video_generate`） | `frame-prompt-context`、`video-generate.ts` |
| **Vision 精炼** | 看图写 `videoPrompt` | 是（`ref_video_prompt` 按协议插槽） | `resolveRefVideoPromptSystem` |

### 解析分镜：产线实际走哪条路

| 剧本类型 | 代码路径 | 用的提示词 | 是否 LLM |
|----------|----------|------------|----------|
| 结构化 md（带分镜块） | `extractShotsFromScript` → `finalizeExtractedShotsForDb` | 无 | 否（尊重作者原文，缺字段保持 null） |
| 散文 / 无分镜块 | `handleShotSplitStream` → `shot_split` | `shot_split` | 是（一次切镜并写全字段） |
| 单镜不满意 | 分镜卡片「重新生成文本」 | `single_shot_rewrite` | 是 |

### 分镜上游（已接入 `resolvePrompt` 且产线会调用）

| Registry Key | 运行时 | 说明 |
|--------------|--------|------|
| `outline_expand` | `resolveOutlineExpandSystem` | 大纲扩写 system；user 为 `buildOutlineExpandPrompt` |
| `single_shot_rewrite` | `resolveSingleShotRewriteSystem` + `buildSingleShotRewriteUserPrompt` | system 可配置；`{VISUAL_STYLE_LOCK}` 注入项目画风 |

默认文案：`outline-expand-defaults.ts`、`single-shot-rewrite-defaults.ts`。

已移除 `shot_complete`（历史批量补全，从未接入产线；缺字段请改剧本、`shot_split` 或 `single_shot_rewrite`）。

---

## 分镜字段合同（必守）

| 字段 | 语义 | 首/尾帧图像 | 视频（Seedance） |
|------|------|-------------|------|
| `shot.prompt` | 镜头情节/场景卡（可含将发生的动态） | **仅上下文**，禁止作为主画面 | 理解场次，不重复长人设 |
| `startFrameDesc` | 动作开始前的静止画面；**自包含五要素**（用「；」分隔）：① 机位空间坐标（`摄影机在[主体][方位][距离]，镜头高度[身体部位]`）② 景别/视角+取景范围 ③ 角色位置姿态 ④ 主光完整叙述句（颜色+方向+铺洒方式+受光效果）⑤ 情绪解剖+背景锚定词 | **首帧唯一依据**（单一事实来源） | 可选 Opening 锚点 |
| `endFrameDesc` | 动作结束后的静止收束；同五要素格式；必须与首帧有可见位移差；光源方向须与首帧一致 | **尾帧唯一依据** | 可选 Closing 锚点 |
| `motionScript` | 精确时间线（含 `｜朝向：` 标注）；`buildStoryboardImagePrompt` 从中提取朝向注入构图 | 朝向提取 | **主要动作脚本** |
| `cameraDirection` | **必须含叙事目的**：`起幅[景别] → 运动方式+速度 → 落幅[景别]，目的：[揭示/跟随/强调什么]`；首帧=起幅、尾帧=落幅（代码截取） | 起幅/落幅截取 | 整句 |
| `videoPrompt` | Vision 精炼后的成片 prompt | — | 优先于组装（B2 帧变更后自动刷新） |

> **已移除字段**（migration 0042/0043）：`emotion`（情绪）、`framing`（景别）、`lightingAtm`（光影氛围）。其信息现由 `startFrameDesc` 直接承载（自包含五要素），不再作为独立 DB 列。

编剧原则：**动态情节写进 `motionScript`，机位坐标/景别/角色姿态/主光/情绪解剖全部写进 `startFrameDesc`（五要素格式），不作为独立字段单独维护。**  
`prompt` 可写场次与将发生的事，但静帧生成以 start/end 为准。

### 导演前思考（shot_split + batch_storyboard_rewrite 共同遵守）

分镜字段必须从**导演决策**出发，而非从剧情动作出发。两条生成路径的系统提示词均要求 AI 在写任何技术字段前先完成三步思考：

| 步骤 | 问题 | 编码位置 |
|------|------|----------|
| Q1 单一视觉概念 | 这个镜头在视觉上只关于一件事，是什么？ | `sceneDescription` 首行 `【视觉核心：...】` |
| Q2 核心反差对 | 画面里什么和什么形成对比？ | `sceneDescription` 首行 `【反差：A vs B】` |
| Q3 主动排除 | 明确不拍什么？（排除本身是叙事选择） | `sceneDescription` 首行 `【排除：...】` |

`sceneDescription` 格式：`【视觉核心：... | 反差：... | 排除：...】 + 环境描述`

实现：`registry.ts` → `SHOT_SPLIT_DIRECTOR_CONCEPT_RULES`；`storyboard-supervision.ts` → 导演前思考段落。

### 入画/出画铁律（shot_split 遵守）

次要角色必须从**取景框边缘**进入/离开，不得在画面中央凭空现身或消失。状态切换可用**遮挡转场**（路人走过 / 报纸飞过，0.3–0.5s 遮挡后解除）替代切镜。实现：`SHOT_SPLIT_ENTRY_EXIT_RULES`（`registry.ts`）。

---

## 图像组装（Seedream）

### 首帧 `frame_generate_first`

- 参数：[pickFirstFramePromptBuildParams](../src/lib/storyboard/frame-prompt-context.ts)
- 环境/群演镜（无具名角色）：内置 `FIRST_FRAME_RENDERING_QUALITY_ENVIRONMENT`，**无**「角色占 40–70%」
- 镜间参考图：`FIRST_FRAME_CONTINUITY_REFERENCE_RULES`（非设定图四视图文案）
- 运镜：仅 `extractOpeningCameraDirection`

### 尾帧 `frame_generate_last`

- 参数：`pickLastFramePromptBuildParams`
- 主画面：`endFrameDesc`；`prompt` 降级为「禁止画进尾帧」的上下文
- 运镜：仅 `extractClosingCameraDirection`
- 参考图：首帧图 + 设定图；保留 slot `relationship_to_first`

### 提示词管理 UI

- 编辑的是 registry **默认插槽**；用户自定义插槽会覆盖默认文案（`resolvePrompt` / `resolveSlotContents`）。
- **环境镜**走代码内置渲染块，与插槽里「角色占 40–70%」无关。
- **`video_generate`**：预览为插槽拼装 + 占位符；实际送模由 `buildVideoPrompt` / `buildReferenceVideoPrompt` 按分镜字段组装。
- **`ref_video_prompt`**：预览默认 Seedance 插槽；运行时按视频协议选 `seedance_system` / `kling_system` 等。
- **`character_extract` / `import_character_extract`**：须保留 `{STYLE_INSTRUCTION}`，运行时注入项目 `visualStyle`。
- 改版后可在插槽页「恢复默认」；强制清空见 `pnpm prune-prompt-overrides`。

### 增强开关 `enhancePrompts`

- doubao/Seedream：组装器先出完整 prompt；增强前经 [compress-frame-prompt-for-enhance.ts](../src/lib/storyboard/compress-frame-prompt-for-enhance.ts) **摘摘要**，再由 LLM 输出 **≤180 字** 逗号分隔静帧句（`视频静帧画面。` 开头）；失败回退**未增强的组装结果**（非增强输出）。
- 关闭 `enhancePrompts` 时：直接发送组装器结果（仍建议保持 start/end 字段合规）。

---

## 视频组装（Seedance / Kling）

原则（见 [seedance-prompt-patterns.md](./seedance-prompt-patterns.md)）：**图像已见角色时，文字只写发生什么。**

| 模式 | 条件 | 组装 |
|------|------|------|
| 首尾帧插值 | 有效 `anchor_last_ai` | [buildVideoPrompt](../src/lib/ai/prompts/video-generate.ts)；弱化角色块；简化 FRAME ANCHORS |
| 首帧参考 | 群演 / 无 AI 尾帧 | [buildReferenceVideoPrompt](../src/lib/ai/prompts/video-generate.ts) |
| Vision 精炼 | 按钮或 **B2 自动** | `resolveRefVideoPromptSystem`（registry `ref_video_prompt`，按视频协议选插槽）→ 写入 `videoPrompt` |

### B2：条件自动刷新 `videoPrompt`

- 字段：`shots.video_prompt_frame_fingerprint`（路径 + mtime 指纹）
- 触发：`single_video_generate` 前，若无 `videoPrompt` 或指纹与当前帧不一致 → 自动 vision 精炼
- 手动「生成视频提示词」始终可用

---

## 提示词管理 ↔ 运行时（已接 `resolvePrompt`）

| Registry Key | 运行时函数 | 说明 |
|--------------|------------|------|
| `character_extract` | `resolveCharacterExtractSystemPrompt` | 插槽默认与产线一致；运行时把 `{STYLE_INSTRUCTION}` 替换为项目 `visualStyle` |
| `import_character_extract` | `resolveImportCharacterExtractSystem` | 同上（导入剧本抽角色） |
| `ref_video_prompt` | `resolveRefVideoPromptSystem` | 按 `modelConfig.video.protocol` 选用 `seedance_system` / `kling_system` / `jimeng_video_system` / `veo_system`；预览默认展示 Seedance 插槽 |

代码默认文案来源：`character-extract-defaults.ts`、`import-character-extract-defaults.ts`、`ref-video-prompt-defaults.ts`（避免 registry ↔ resolver 循环依赖）。

---

## 已移除的 Reference 双轨（不再出现在提示词管理）

2026-05 起已从 `PROMPT_REGISTRY` 删除（避免与 Plan B 混淆）：

| 原 Key | 说明 |
|--------|------|
| `scene_frame_generate` | 旧「场景参考帧」；现由 `frame_generate_first` + `anchor_first` 替代 |
| `ref_video_generate` | 旧「参考视频」对白插槽；现 `buildReferenceVideoPrompt` 共用 `video_generate.dialogue_format` |

对应 API（`single_scene_frame`、`single_reference_video` 等）仍返回 **410**。

**DB 恢复默认**：在提示词管理 UI 点「恢复本模板全部默认」，或手动执行 `pnpm prune-prompt-overrides`（会清空已接线三个 key 的全部自定义）。日常 `pnpm dev` 启动仅清理**无效插槽名**与已废弃的 prompt key，不会动你在 UI 里保存的有效自定义。

---

## 产品决策（已落地）

| ID | 决策 |
|----|------|
| **A** | A1 组装层 + A2 上游文案（`shot_split` / WORKFLOW） |
| **B** | B2 有帧且 prompt 过期时自动 vision 精炼 |

---

## 迁移

- `drizzle/0034_video_prompt_frame_fingerprint.sql` — `video_prompt_frame_fingerprint`
