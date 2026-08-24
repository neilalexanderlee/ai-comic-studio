# 战略路线图：对标 Toonflow 的差异化升级

> 本文档是路线图草案，产出于 2026-08。阶段 0 已随本次改动落地；阶段 1-4 需团队评审优先级后再拆解为具体开发任务，本文档本身不包含对应代码改动。
>
> Toonflow 侧的调研结论来自对本地只读克隆的 `Toonflow-app`（Electron + Express + SQLite 后端）与 `Toonflow-web`（Vue3 前端工作台）两个仓库的代码级分析，所有引用均给出文件路径，可自行核对。另见 [docs/toonflow-consistency-analysis.md](toonflow-consistency-analysis.md)（早期针对角色一致性机制的分析，聚焦点不同，可互相参照）。

---

## 一、现状对标矩阵

| 能力维度 | ai-comic-studio 现状 | Toonflow 现状（代码证据） | 差距 / 优势 |
|---|---|---|---|
| **文本→视频提示词耦合** | 直出架构：`buildDirectVideoPrompt`（[shot-video-prompt-sync.server.ts](../src/lib/storyboard/shot-video-prompt-sync.server.ts)）零 LLM 拼接，`startFrameDesc`/`motionScript`/`cameraDirection`/`duration` 单一事实来源，无二次改写导致的信息丢失 | 两段独立 LLM：`storyboardPanelAgent` 生成 `videoDesc`（含时长）→ `generateVideoPrompt.ts` 用另一套完全独立的 system prompt 重新生成视频提示词，`wan2.6`/通用多参模板明确放弃标注时长（"时长由模型侧控制"），编辑 `videoDesc` 不会同步更新结构化 `duration` 字段 | **我方优势**：直出架构从根上避免了 Toonflow 这类"两段 LLM 各说各话"的耦合断裂 |
| **时长与模型档位一致性** | Seedance/MiniMax H3 等 provider 各自 `resolveDuration` 做 `Math.ceil` + clamp；Kling 离散档位（5/10s）用 `mapDuration` 就近吸附 | `Toonflow-web` 的 `clampDuration()`（`generate/index.vue:192-198`）只做区间夹紧（`Math.max(min, Math.min(x, max))`），不判断值是否在离散档位数组里——可灵档位 `[5,10]` 遇到算出 7s/8s 会原样透传非法值给 API | 我方已对 Kling 做就近吸附，但 Seedance/MiniMax 目前也是纯 clamp，非离散档位吸附。**阶段1 待办** |
| **节拍密度校验** | `shot_split` 路径有硬编码密度表+黄金6秒（[registry.ts:935-951](../src/lib/ai/prompts/registry.ts:935)）；`batch_storyboard_rewrite` 此前只在意图列表提及"节拍密度"但无具体数值定义——**本次已修复**（见下方阶段0），新增 `checkBeatDensity()`（[shot-supervision.ts](../src/lib/storyboard/shot-supervision.ts)）非阻塞校验 | 节拍密度约束只存在于 `production_skills/storyboard_table_techniques.md`（分镜表撰写阶段的软性 markdown），`data/modelPrompt/video/*.md`（真正生成视频提示词读取的 system prompt）里 `grep "拍\|密度"` 零命中；全仓库无对应代码校验函数 | **我方优势（本次升级后）**：密度约束覆盖到了视频提示词生成的最后一步，且有确定性代码校验兜底，不仅是 LLM 自觉遵守的软约束 |
| **角色记忆 / 跨集状态** | 角色定妆图复用 + `isDefault` 手动切换 + `voiceHint`；无跨集"性格/关系状态"追踪 | `Memory` 类（`src/utils/agent/memory.ts`）是**对话记忆**（Agent 记住和用户聊过什么），按 `projectId:agentType:episodesId` 隔离，非叙事实体记忆；角色一致性靠 `o_assets` 静态资产复用（图/音色绑定），无可跨集查询更新的"角色状态机" | **双方都缺失**：这是明确的空白地带，双方都没有真正的角色记忆系统。**阶段2 待办**，也是差异化机会 |
| **叙事 Agent 分层** | pipeline-stage 式：`outline_expand`/`script_generate`/`shot_split`/`batch_storyboard_rewrite`/`batch_plot_optimize` 等各自独立触发，无决策层统一调度 | 明确的多层 Agent 架构：`decisionAgent` → 多个 `sub_agent`（大纲/改编/剧本/分镜表/分镜面板/分镜图）→ `supervisionAgent`，对话驱动（`src/agents/{scriptAgent,productionAgent}/index.ts`） | Toonflow 有更完整的分层调度，但**其分层止步于分镜图**（`productionAgent/tools.ts` 无生成视频的工具）。**阶段3 待评估**：是否值得引入决策层 Agent，需先验证 ROI |
| **视频生成→成片自动化** | 已有 `groupShotsIntoTracks`（Track 分组）+ 浏览器端视频编辑器 + 服务端 ffmpeg render，仍需人工在编辑器排轨道 | 视频生成必须在 `Toonflow-web` 工作台手动触发（选模型→生成文案→人工核对→生成）；成片剪辑是独立的 WebAV 时间轴工具，**无自动装配整集成片的一键功能** | 双方都需要人工介入成片环节，但我方已有 Track 分组的结构化数据可用于自动装配。**阶段4 待办**，是相对容易兑现的差异化点 |
| **生成后质量校验闭环** | `superviseShots` 6 条红线仅覆盖 `shot_split` 初次生成；`batch_storyboard_rewrite` 本次新增 `checkBeatDensity` 非阻塞校验；视频生成完成后无内容级校验 | 全仓库搜索 `videoQC/checkVideo/videoReview/videoValidate/analyzeVideo` 除任务状态轮询外零命中；生成后无论视频是否兑现了 `videoDesc` 里的内容都判定为"生成成功" | 双方都缺视频生成后的内容级回读校验（帧差/动态检测）。**阶段1 后段待办**，成本较高，优先级低于其他阶段 |

---

## 二、分阶段路线图

### 阶段 0（已随本次改动落地）

- MiniMax H3 视频 provider 接入（`minimax-video` 协议，新增可选项，与 Seedance/Kling/即梦 并列）
- 慢动作根因修复：`STORYBOARD_REWRITE_SYSTEM` 补全节拍密度下限表 + cameraDirection 运镜速度多样化 + 呼吸镜头触发频率上限；`PLOT_OPTIMIZE_SYSTEM` 增加密度保护提醒；新增 `checkBeatDensity()` 非阻塞校验并接入 SSE `done` 事件

### 阶段 1：视频闭环强化（对标 Toonflow 的 duration 断裂点）

- **时长离散档位就近吸附**：把 Kling 已有的 `mapDuration` 吸附逻辑模式推广到 Seedance/MiniMax H3（虽然二者目前是连续区间而非离散档位，暂无强需求，但需在新增离散档位模型时优先复用此模式，而非重新发明 Toonflow 式的"纯 clamp"）
- **`motionScript`/`duration` 变更后 `videoPrompt` 自动失效**：目前 `syncVideoPromptIfStale` 只在 `videoPrompt` 为空时才生成（见 [shot-video-prompt-sync.server.ts:124](../src/lib/storyboard/shot-video-prompt-sync.server.ts:124)）；需确认 `batch_storyboard_rewrite` 写入时是否已经把 `videoPrompt` 置空触发重生成（当前写入逻辑里 `writeShotRewrite` 已经 `videoPrompt: null`，需要审计是否所有编辑路径都遵守这个约定，例如单镜手动编辑 motionScript 的路径）
- **密度校验从"警告"升级为"生成前阻断+一键重写"**：`checkBeatDensity` 目前是非阻塞提示，可以在前端加一个"重新生成低密度镜头"的批量操作按钮，复用现有 `batch_storyboard_rewrite` 单镜重试路径
- 工作量级别：2-3 周；依赖：无；风险：低

### 阶段 2：全局角色记忆体系（差异化机会点，双方都空白）

- 新增角色状态表：跟踪性格标签、当前关系阶段（如"陌生→熟识→信任"）、好感度数值、当前剧情状态（如"受伤/易容/身份暴露"等衍生状态标记）
- 每集分镜生成/优化完成后，跑一次轻量 LLM 推断步骤，从本集台词/场景描述里提取角色状态变化，写回状态表（类似现有 `batch_voice_generate` 的单趟批处理模式）
- 下一集生成剧本/分镜前，自动把最新角色状态注入 system prompt，替代目前"依赖 LLM 自己记住之前几集内容"的隐式假设
- 与现有 `character_assets`（`isDefault`/`prop`/衍生形态图）体系打通：角色状态变化（如"重伤"）可以联动提示用户是否需要上传对应的衍生定妆图
- 工作量级别：3-4 周；依赖：无；风险：中（LLM 状态推断的准确性需要 eval 验证，可参考 `src/lib/evals/` 现有框架新增一个 suite）

### 阶段 3：叙事 Agent 分层强化（需先评估 ROI，非必须）

- 现状是一系列可独立触发的 pipeline stage，用户需要手动依次点击"扩写大纲→生成剧本→拆分镜→批量优化文本→批量优化剧情"
- 候选方案：引入一个"总导演"决策层 Agent，读取项目当前状态，自动判断下一步该做什么（如检测到 `superviseShots` 评分为 D 级时主动建议/触发批量重写），但这类"决策层调用子 Agent"架构比 Toonflow 现有分层更进一步的地方在于——**要把视频生成和成片装配也纳入自动化工具链**，这是 Toonflow 明确没做到的（其 `productionAgent` 工具集止步于分镜图）
- 需要先用现有 pipeline 跑几个真实项目积累"用户实际操作顺序"的数据，判断决策层能带来多少减少点击次数的实际价值，再决定是否投入
- 工作量级别：4-6 周（若做）；依赖：阶段1（视频闭环要先稳定，决策层才能安全调用生成视频这类高成本操作）；风险：高（架构改动大，且 ROI 未经验证）

### 阶段 4：一键到成片（相对低成本，可提前于阶段3）

- 基于已有 `groupShotsIntoTracks`（[track-grouping.ts](../src/lib/storyboard/track-grouping.ts)）的分组结果，自动生成时间线（视频 clip 顺序排列 + 字幕轨从 `dialogues` 自动生成，这部分逻辑 `useEditorStore.initFromShots` 已经有）
- 新增"快速预览成片"入口：跳过手动在编辑器里拖拽排轨道的步骤，直接调用现有服务端 `POST /api/projects/[id]/episodes/[episodeId]/render` 一键出片
- 专业剪辑需求（转场/字幕微调/BGM混流）仍保留现有手动编辑器作为精修选项，两者并存不互斥
- 工作量级别：1-2 周；依赖：无（可独立于阶段1-3先做）；风险：低

---

## 三、优先级建议（供评审参考，非最终决定）

按"工作量小、风险低、差异化明确"排序：**阶段4 > 阶段1 > 阶段2 > 阶段3**。阶段2（角色记忆）虽然工作量中等，但是 Toonflow 和小云雀AI等同类产品目前都未做扎实的领域，差异化价值最高，建议优先于阶段3。阶段3（决策层 Agent）架构改动最大且 ROI 未经验证，建议放在最后，先用阶段1-2-4 的实际效果验证方向，再决定是否投入。
