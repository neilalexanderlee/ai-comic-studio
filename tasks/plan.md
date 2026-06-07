# 实施计划：AI漫剧工坊 → Toonflow 同级质量重构

## 概述

将 AI漫剧工坊的分镜图生成、视频提示词、角色一致性提升到 Toonflow 同级质量。
核心改动在三个层：数据模型扩展、提示词系统重构、视频生成流水线升级。

**不动的东西**：`character_assets` 表（角色定妆图）、`shots.videoUrl`（已生成视频）、UI主框架。
所有新字段均为 nullable，老数据完全向后兼容。

---

## 架构决策

1. **美术风格约束以 Markdown 文件存储**（`src/lib/ai/prompts/art-styles/`），而非数据库。
   原因：内容由开发者维护，不需要用户编辑，文件系统更易 diff/版本控制。

2. **分镜图提示词采用三段式**（`【画面】/【光影】/【风格】`）替换现有 `=== SECTION ===` 英文格式。
   原因：Toonflow 验证过，中文结构化输出对 Seedream/Doubao 模型更有效。

3. **`@图N` 绑定系统**在 `buildFirstFramePrompt` 中按 `associateAssetsIds` 顺序编号，
   替换现有"角色描述文字+参考图附件"的隐式对应。

4. **Seedance 视频提示词的 `@参考N` 系统**独立实现在 `buildSeedanceMultiParamVideoPrompt()`，
   不动现有 `buildVideoPrompt()` 和 `buildReferenceVideoPrompt()`（首尾帧模式保留）。

5. **Track 分组**存为 `shots.track` 字符串字段，UI 按此字段聚合显示，
   后端批量生成 API 按 track 分组后一次提交 Seedance。

6. **监督层**以独立函数实现（非 Agent），在 `shot_split` 完成后同步调用，
   避免引入额外 Agent 框架依赖。

---

## 依赖图

```
T1: Schema shots 新字段
T2: Schema dialogues.type
    │
    ├── T3: 美术风格文件系统 + getArtStylePrompt()
    │       │
    │       ├── T4: anime_2d 风格全套文件
    │       └── T5: 其余4种风格文件
    │
    ├── T6: 分镜提示词通用技法文档 + buildStoryboardImagePrompt()
    │       │ (依赖 T3/T4/T5 获取风格文件)
    │       ├── T7: buildFirstFramePrompt / buildLastFramePrompt 重构
    │       ├── T8: outline_expand prompt 更新（12维 videoDesc + 朝向）
    │       └── T9: single_shot_rewrite prompt 更新（6重校验）
    │
    ├── T10: buildVideoDesc() 12维组装函数 (依赖 T1)
    │       │
    │       ├── T11: buildSeedanceMultiParamVideoPrompt() (依赖 T10)
    │       └── T12: Track分组批量视频API (依赖 T10/T11)
    │
    ├── T13: 监督层 6红线校验 prompt + superviseShots()
    │       │
    │       └── T14: 接入 shot_split 流程 (依赖 T13/T8)
    │
    └── T15: UI 台词类型选择器 (依赖 T2)
        T16: UI Track分组显示 + 批量视频按钮 (依赖 T12)
```

---

## Phase 1：数据模型扩展

### T1 — shots 表新增 emotion / lightingAtm / framing / track

**描述**：为分镜表补充 Toonflow videoDesc 中缺失的字段：情绪、光影氛围、景别、视频分组标识。
这4个字段是 Phase 3/4 所有 prompt 重构的数据基础。

**验收标准**：
- [ ] `drizzle/0035_shot_structured_fields.sql` 存在，包含4条 ALTER TABLE
- [ ] `src/lib/db/schema.ts` 的 `shots` 表包含 `emotion`、`lightingAtm`、`framing`、`track` 字段
- [ ] `drizzle/meta/_journal.json` 中 idx=35 条目正确注册
- [ ] `npx tsc --noEmit` 无报错
- [ ] 启动 dev server，访问分镜页面不报错，老数据正常显示

**验证步骤**：
- [ ] `pnpm dev` 启动后首次请求触发 migration，无 "no such column" 错误
- [ ] 打开任意已有项目，分镜卡片正常渲染（新字段为 null，不影响显示）

**依赖**：无

**涉及文件**：
- `drizzle/0035_shot_structured_fields.sql`（新建）
- `drizzle/meta/_journal.json`（更新）
- `src/lib/db/schema.ts`（更新 shots 表）

**规模**：S

---

### T2 — dialogues 表新增 type 字段

**描述**：为台词表增加类型字段区分对白/内心OS/画外音VO，这是 Seedance 多参视频提示词正确处理台词的前提。

**验收标准**：
- [ ] `drizzle/0036_dialogue_type.sql` 存在
- [ ] `src/lib/db/schema.ts` 的 `dialogues` 表包含 `type` 字段，默认 `'dialogue'`
- [ ] `drizzle/meta/_journal.json` 中 idx=36 条目正确
- [ ] `npx tsc --noEmit` 无报错
- [ ] 现有台词数据（type=null）被默认值处理不报错

**验证步骤**：
- [ ] 打开分镜抽屉，点击台词编辑，保存不报错
- [ ] 查询 DB：`SELECT type FROM dialogues LIMIT 5` 返回 'dialogue'

**依赖**：T1

**涉及文件**：
- `drizzle/0036_dialogue_type.sql`（新建）
- `drizzle/meta/_journal.json`（更新）
- `src/lib/db/schema.ts`（更新 dialogues 表）

**规模**：XS

---

### 检查点 1（T1-T2 完成后）

- [ ] `npx tsc --noEmit` 零错误
- [ ] `pnpm dev` 正常启动，老项目/老分镜正常显示
- [ ] 已有角色定妆图、分镜视频可正常访问

---

## Phase 2：美术风格约束库

### T3 — 美术风格文件加载器 getArtStylePrompt()

**描述**：建立 `src/lib/ai/prompts/art-styles/` 目录结构和加载工具函数，
替换现有的 `VISUAL_STYLE_PRESETS[style].tag` 单行字符串方案。
加载器需支持 fallback：风格文件不存在时回退到旧 tag 方案。

**验收标准**：
- [ ] `src/lib/ai/prompts/art-styles/index.ts` 导出 `getArtStylePrompt(visualStyle, type)` 函数
- [ ] `type` 参数支持：`'prefix' | 'character' | 'scene' | 'storyboard' | 'video'`
- [ ] 文件不存在时返回空字符串（graceful fallback，不抛异常）
- [ ] `npx tsc --noEmit` 无报错
- [ ] 单元测试：`getArtStylePrompt('anime_2d', 'prefix')` 返回非空字符串（在 T4 完成后）

**验证步骤**：
- [ ] `pnpm test src/__tests__/unit/lib/ai/prompts/art-styles.test.ts` 通过

**依赖**：无（可与 T1/T2 并行）

**涉及文件**：
- `src/lib/ai/prompts/art-styles/index.ts`（新建）
- `src/__tests__/unit/lib/ai/prompts/art-styles.test.ts`（新建）

**规模**：S

---

### T4 — anime_2d 风格全套约束文件

**描述**：移植 Toonflow `2D_90s_japanese_anime` 风格的全部约束文件到 `anime_2d/` 目录。
这是使用最广泛的风格，也是验证整个风格库方案的基准。

直接来源文件（Toonflow）：
- `data/skills/art_skills/2D_90s_japanese_anime/prefix.md` → `anime_2d/prefix.md`
- `data/skills/art_skills/2D_90s_japanese_anime/art_prompt/art_character.md` → `anime_2d/character.md`
- `data/skills/art_skills/2D_90s_japanese_anime/art_prompt/art_scene.md` → `anime_2d/scene.md`
- `data/skills/art_skills/2D_90s_japanese_anime/driector_skills/director_storyboard.md` → `anime_2d/storyboard.md`
- `data/skills/art_skills/2D_90s_japanese_anime/art_prompt/art_storyboard_video.md` → `anime_2d/video.md`

**验收标准**：
- [ ] `src/lib/ai/prompts/art-styles/anime_2d/` 下存在 prefix / character / scene / storyboard / video 共5个 .md 文件
- [ ] `getArtStylePrompt('anime_2d', 'prefix')` 返回含「90年代日式动画」的字符串
- [ ] `getArtStylePrompt('anime_2d', 'character')` 返回含「四视图」约束的字符串
- [ ] `getArtStylePrompt('anime_2d', 'storyboard')` 返回含情绪→面容映射表的字符串
- [ ] 单元测试全部通过

**验证步骤**：
- [ ] `pnpm test src/__tests__/unit/lib/ai/prompts/art-styles.test.ts`

**依赖**：T3

**涉及文件**：
- `src/lib/ai/prompts/art-styles/anime_2d/prefix.md`（新建）
- `src/lib/ai/prompts/art-styles/anime_2d/character.md`（新建）
- `src/lib/ai/prompts/art-styles/anime_2d/scene.md`（新建）
- `src/lib/ai/prompts/art-styles/anime_2d/storyboard.md`（新建）
- `src/lib/ai/prompts/art-styles/anime_2d/video.md`（新建）

**规模**：M

---

### T5 — 其余4种风格约束文件

**描述**：移植/编写剩余4种风格的约束文件。映射关系：
- `realistic` → 移植 Toonflow `realpeople_urban_modern`
- `cg_3d` → 移植 Toonflow `3D_anime_render`
- `chinese_ink` → 移植 Toonflow `2D_chinese_guofeng`
- `western_cartoon` → 移植 Toonflow `2D_flat_design`

每种风格至少需要：prefix + storyboard + video（character/scene 可后续补全）

**验收标准**：
- [ ] 每种风格目录下至少存在 prefix.md / storyboard.md / video.md
- [ ] `getArtStylePrompt('realistic', 'prefix')` 等调用均返回非空内容
- [ ] `getArtStylePrompt('auto', 'prefix')` 返回空字符串（auto 无文件，graceful fallback）

**验证步骤**：
- [ ] `pnpm test src/__tests__/unit/lib/ai/prompts/art-styles.test.ts`（覆盖所有风格）

**依赖**：T3, T4（参考 anime_2d 格式）

**涉及文件**：
- `src/lib/ai/prompts/art-styles/realistic/` (3 files)
- `src/lib/ai/prompts/art-styles/cg_3d/` (3 files)
- `src/lib/ai/prompts/art-styles/chinese_ink/` (3 files)
- `src/lib/ai/prompts/art-styles/western_cartoon/` (3 files)

**规模**：M

---

### 检查点 2（T3-T5 完成后）

- [ ] `pnpm test` 全部通过
- [ ] `getArtStylePrompt(style, type)` 对5种非-auto风格均返回有效内容
- [ ] `pnpm dev` 无报错

---

## Phase 3：分镜图提示词重构

### T6 — 通用分镜技法文档 + buildStoryboardImagePrompt()

**描述**：移植 Toonflow `storyboard_prompt_techniques.md` 为我们的通用规范文档，
并实现核心函数 `buildStoryboardImagePrompt()`，输出三段式结构的分镜图提示词。

这是首帧/尾帧生成质量的核心升级。新函数规则：
1. 按 `associateAssetsIds` 顺序生成 `@图N` 标注前缀
2. 三段式正文：【画面】/【光影】/【风格】
3. 角色在画面中的朝向（从 `orientationNotes` 或 `motionScript` 中的 `｜朝向：` 提取）
4. 景别词库映射（8种景别 → 中文标准词）
5. 注入风格文件（storyboard.md）的情绪→面容词、光影词、锚定词

**验收标准**：
- [ ] `src/lib/ai/prompts/storyboard-image.ts` 导出 `buildStoryboardImagePrompt()`
- [ ] 输出格式以 `@图1 为{角色名}角色 @图N 为{场景名}场景,` 开头（有资产时）
- [ ] 输出包含 `【画面】` / `【光影】` / `【风格】` 三段（顺序不可颠倒）
- [ ] 传入 `visualStyle='anime_2d'`，【风格】段包含「90年代日式动画风格」
- [ ] 无资产时（空镜）输出不含 `@图N` 标注
- [ ] 单元测试覆盖：有/无资产、有/无朝向、不同景别映射
- [ ] `npx tsc --noEmit` 无报错

**验证步骤**：
- [ ] `pnpm test src/__tests__/unit/lib/ai/prompts/storyboard-image.test.ts`

**依赖**：T3, T4

**涉及文件**：
- `src/lib/ai/prompts/storyboard-image.ts`（新建）
- `src/lib/ai/prompts/art-styles/storyboard-techniques.md`（新建，移植通用规范）
- `src/__tests__/unit/lib/ai/prompts/storyboard-image.test.ts`（新建）

**规模**：M

---

### T7 — buildFirstFramePrompt / buildLastFramePrompt 接入新系统

**描述**：将现有 `buildFirstFramePrompt()` / `buildLastFramePrompt()` 内部实现切换为
调用 `buildStoryboardImagePrompt()`，保持函数签名不变（向后兼容调用方）。

旧方案（`=== SECTION ===` 英文格式）退为 fallback，仅在新系统出错时启用。

**验收标准**：
- [ ] `buildFirstFramePrompt({...})` 输出包含 `【画面】` 三段式格式
- [ ] 传入 `characterDescriptions` 仍然有效（作为角色视觉描述补充）
- [ ] 传入 `visualStyleTag` 仍有效（注入【风格】段）
- [ ] 已有调用方（`generate/route.ts`）无需改动，`npx tsc --noEmit` 无报错
- [ ] 单元测试：首帧/尾帧输出格式验证

**验证步骤**：
- [ ] `pnpm test src/__tests__/unit/lib/ai/prompts/frame-generate.test.ts`
- [ ] 手动触发「生成首帧」，检查发送给图片 API 的 prompt 包含三段式格式

**依赖**：T6

**涉及文件**：
- `src/lib/ai/prompts/frame-generate.ts`（更新）
- `src/__tests__/unit/lib/ai/prompts/frame-generate.test.ts`（新建/更新）

**规模**：S

---

### T8 — outline_expand + shot_split prompt 更新（12维输出 + 朝向）

**描述**：更新两个生成类 prompt，要求 LLM 在输出分镜时包含：
- `framing`（景别）字段（近景/中景/远景等8类之一）
- `emotion`（情绪）字段
- `lightingAtm`（光影氛围）字段
- 角色动作字段末尾的 `｜朝向：` 显式标注（6优先级推断规则写入 system prompt）

同时更新 `finalizeExtractedShotsForDb()` 和 `persistStoryboardVersion()` 中对新字段的写入。

**验收标准**：
- [ ] `OUTLINE_EXPAND_SYSTEM_DEFAULT` 包含12维 videoDesc 输出规范说明
- [ ] `buildShotSplitPrompt()` 包含 `｜朝向：` 标注规则和6优先级推断
- [ ] `finalizeExtractedShotsForDb()` 能解析并写入 `emotion`、`lightingAtm`、`framing` 字段
- [ ] `npx tsc --noEmit` 无报错
- [ ] 生成新版分镜后，查询 DB：`SELECT emotion, lighting_atm, framing FROM shots LIMIT 3` 有值

**验证步骤**：
- [ ] 创建测试项目，执行「AI自动生成」，检查生成的 shots 是否有 emotion/lightingAtm/framing
- [ ] `pnpm test src/__tests__/unit/lib/storyboard/complete-extracted-shots.test.ts`

**依赖**：T1

**涉及文件**：
- `src/lib/ai/prompts/outline-expand-defaults.ts`（更新）
- `src/lib/ai/prompts/shot-split.ts`（更新）
- `src/lib/storyboard/complete-extracted-shots.ts`（更新，新字段写入）
- `src/lib/storyboard/persist-storyboard-version.ts`（更新）

**规模**：M

---

### T9 — single_shot_rewrite prompt 更新（6重校验 + 朝向）

**描述**：更新单镜重写的 system prompt，加入：
1. 6重逐字段校验要求（零遗漏/情绪一致/禁光影词混入画面/景别匹配/动作语义/朝向标注）
2. 输出必须包含 `｜朝向：` 标注
3. 禁用词库（画质降级词）

**验收标准**：
- [ ] `assembleSingleShotRewriteSystem()` 生成的 system prompt 包含「6重校验」和「朝向」关键词
- [ ] `pnpm test src/__tests__/unit/lib/ai/prompt-templates-deplot.test.ts` 通过（模板验证）
- [ ] `npx tsc --noEmit` 无报错

**验证步骤**：
- [ ] `pnpm test`
- [ ] 在 UI 点击单镜「重新生成文本」，检查重写后的 motionScript 末尾是否含 `｜朝向：`

**依赖**：T1

**涉及文件**：
- `src/lib/ai/prompts/single-shot-rewrite-defaults.ts`（更新）

**规模**：S

---

### 检查点 3（T6-T9 完成后）

- [ ] `pnpm test` 全部通过
- [ ] `npx tsc --noEmit` 零报错
- [ ] 生成首帧：prompt 包含 `【画面】/【光影】/【风格】` 三段式
- [ ] 新建分镜：emotion / lightingAtm / framing 字段有值
- [ ] 老项目/老分镜正常运行（不受影响）

---

## Phase 4：视频提示词重构

### T10 — buildVideoDesc() 12维组装函数

**描述**：实现 `buildVideoDesc(shot, charNames, sceneName)` 函数，
将 shot 的各个字段组装为 Toonflow 标准的12维 videoDesc 字符串：
`（画面描述、场景、关联资产名称、时长、景别、运镜、角色动作、情绪、光影氛围、台词、音效、关联资产ID）`

台词字段根据 `dialogues.type` 输出对应格式（说：/内心OS：/画外音VO：）。

**验收标准**：
- [ ] `src/lib/storyboard/video-desc.ts` 导出 `buildVideoDesc()`
- [ ] 返回格式严格符合12维顿号分隔，外套圆括号
- [ ] 台词类型映射正确：`dialogue` → `{角色} 说：「...」`，`os` → `内心OS：「...」`，`vo` → `画外音VO：「...」`
- [ ] 无台词时第10位输出 `无台词`
- [ ] 无情绪/无光影时对应位输出空字符串（不崩溃）
- [ ] 单元测试覆盖台词3种类型

**验证步骤**：
- [ ] `pnpm test src/__tests__/unit/lib/storyboard/video-desc.test.ts`

**依赖**：T1, T2

**涉及文件**：
- `src/lib/storyboard/video-desc.ts`（新建）
- `src/__tests__/unit/lib/storyboard/video-desc.test.ts`（新建）

**规模**：S

---

### T11 — buildSeedanceMultiParamVideoPrompt() 实现

**描述**：实现 Toonflow 移植的 Seedance 多参视频提示词生成器，支持：
1. `@参考N` 编号系统（角色图→场景图→音频→分镜图，按输入顺序连续）
2. 「参考定义:」段（集中声明所有 @参考N 的名称和简述）
3. 台词三种类型（对白/OS/VO）+ 9维音色（从 `characters.voiceHint` 读取）
4. 分镜正文用角色名，禁止写 @参考N
5. 支持多分镜（同一 track 组内的连续分镜）

**验收标准**：
- [ ] `src/lib/ai/prompts/seedance-multi-param.ts` 导出 `buildSeedanceMultiParamVideoPrompt()`
- [ ] 输出第一行为 `画面风格和类型:`
- [ ] 输出包含 `参考定义:` 段，@参考N 编号无跳号
- [ ] 带音频的角色在同一行尾追加 `，参考音频为：@参考N+1`
- [ ] 分镜正文不出现 `@参考N`
- [ ] 单元测试：单分镜/多分镜/有音频/无音频 全场景

**验证步骤**：
- [ ] `pnpm test src/__tests__/unit/lib/ai/prompts/seedance-multi-param.test.ts`
- [ ] 手动触发 Seedance 视频生成，检查 API 请求 body 中的 prompt 格式

**依赖**：T10

**涉及文件**：
- `src/lib/ai/prompts/seedance-multi-param.ts`（新建）
- `src/__tests__/unit/lib/ai/prompts/seedance-multi-param.test.ts`（新建）

**规模**：M

---

### T12 — Track分组批量视频生成API

**描述**：在 `generate/route.ts` 中增加 `batch_video_generate` action：
1. 按 `shots.track` 字段将同集/同版本的分镜分组（累计时长 ≤ 15s 为一组）
2. 每组调用 `buildSeedanceMultiParamVideoPrompt()` 生成一个提示词
3. 提交给 Seedance，返回 job ID
4. 各分镜的 `videoUrl` 在视频完成后按时间轴切割（或记录为同一视频 URL）

同时提供 `assign_tracks` action：按上述规则为当前版本的所有 shots 批量写入 `track` 字段。

**验收标准**：
- [ ] `POST /api/projects/:id/generate` 支持 `action: 'assign_tracks'`，正确写入 `shots.track`
- [ ] `POST /api/projects/:id/generate` 支持 `action: 'batch_video_generate'`
- [ ] 同 track 的分镜得到同一 `videoUrl`（或切割后各自的 URL）
- [ ] 单分镜（track 内只有1条）等同于现有单镜生成逻辑
- [ ] `npx tsc --noEmit` 无报错

**验证步骤**：
- [ ] 分镜页点击「分配 Track」按钮，检查 shots.track 有值
- [ ] 点击「Track 批量生成视频」，Seedance 提示词包含多分镜格式

**依赖**：T10, T11

**涉及文件**：
- `src/app/api/projects/[id]/generate/route.ts`（更新，增加2个 action）
- `src/lib/storyboard/track-grouping.ts`（新建，分组逻辑）

**规模**：M

---

### 检查点 4（T10-T12 完成后）

- [ ] `pnpm test` 全部通过
- [ ] `npx tsc --noEmit` 零报错
- [ ] Seedance 单镜生成仍然可用（现有路径未破坏）
- [ ] 新 Seedance 多参提示词格式验证通过

---

## Phase 5：质量控制层

### T13 — 6红线校验 prompt + superviseShots()

**描述**：实现分镜质量监督函数，移植 Toonflow 的6条红线：
- R1: 每条分镜 `emotion` / `lightingAtm` / `framing` 字段非空
- R2: 台词与剧本原文完全一致（无改写）
- R3: 角色动作字段包含 `｜朝向：` 标注（有命名角色时）
- R4: 出现的角色名都在项目角色表中
- R5: `associateAssetsIds` 非空（有命名角色的分镜）
- R6: `videoDesc` 12维字段完整

评分 A/B/C/D，返回问题清单（issue list），A/B 直接通过，C/D 返回问题由调用方决定是否重试。

**验收标准**：
- [ ] `src/lib/storyboard/shot-supervision.ts` 导出 `superviseShots(shots, projectChars)` 
- [ ] 返回 `{ grade: 'A'|'B'|'C'|'D', issues: Issue[], passCount: number, failCount: number }`
- [ ] R1-R6 规则全部实现，issue 包含 shotId + ruleId + description
- [ ] 单元测试：全部通过（A级）/ 有缺失字段（C/D级）

**验证步骤**：
- [ ] `pnpm test src/__tests__/unit/lib/storyboard/shot-supervision.test.ts`

**依赖**：T1, T8

**涉及文件**：
- `src/lib/storyboard/shot-supervision.ts`（新建）
- `src/__tests__/unit/lib/storyboard/shot-supervision.test.ts`（新建）

**规模**：S

---

### T14 — 接入 shot_split / outline_expand 流程

**描述**：在 `generate/route.ts` 的 `shot_split` 和 `outline_expand` action 完成后，
自动调用 `superviseShots()`，结果通过 SSE 推送给前端。

- A/B 级：SSE 推送 `{ type: 'supervision', grade: 'A', issues: [] }`，流程继续
- C/D 级：SSE 推送 `{ type: 'supervision', grade: 'C', issues: [...] }`，前端显示警告 toast，不中断流程（用户决定是否重新生成）

**验收标准**：
- [ ] `shot_split` 完成后 SSE 流包含 `supervision` 事件
- [ ] 前端 storyboard page 收到 supervision 事件并显示 toast（A级：绿色成功，C/D级：橙色警告 + 问题摘要）
- [ ] 监督失败不阻断分镜生成（分镜已写入 DB）

**验证步骤**：
- [ ] 执行「解析分镜」，观察 toast 是否出现质量等级提示
- [ ] 故意制造缺失字段（删 emotion 更新），重新生成，确认 C 级警告出现

**依赖**：T13, T8

**涉及文件**：
- `src/app/api/projects/[id]/generate/route.ts`（更新）
- `src/app/[locale]/project/[id]/episodes/[episodeId]/storyboard/page.tsx`（更新，处理 supervision SSE 事件）

**规模**：S

---

### 检查点 5（T13-T14 完成后）

- [ ] `pnpm test` 全部通过
- [ ] 执行完整分镜生成流程，supervision 结果在 UI 可见
- [ ] 老路径（单镜重写等）无副作用

---

## Phase 6：UI 适配

### T15 — 台词类型选择器（对白/OS/VO）

**描述**：在分镜卡片和抽屉的台词编辑区域，为每条台词增加类型选择器，
支持「对白（默认）」「内心独白 OS」「画外音 VO」三种选项。

同时更新 `PATCH /api/projects/:id/shots/:shotId` 和台词保存 API，接受 `type` 字段。

**验收标准**：
- [ ] 台词编辑区每条台词显示类型选择器（下拉或 radio）
- [ ] 切换类型后保存，DB 中 `dialogues.type` 更新
- [ ] 视频提示词生成时根据 type 正确映射（说：/ 内心OS：/ 画外音VO：）
- [ ] 老台词（type=null）在 UI 默认显示「对白」

**验证步骤**：
- [ ] 手动添加3种类型的台词，生成视频提示词，检查格式正确

**依赖**：T2, T11

**涉及文件**：
- `src/components/editor/shot-card.tsx`（更新台词编辑区）
- `src/components/editor/shot-drawer.tsx`（更新台词编辑区）
- `src/app/api/projects/[id]/shots/[shotId]/route.ts`（如有 dialogues patch）
- `messages/zh.json`（新增翻译键）

**规模**：M

---

### T16 — Track 分组显示 + 批量视频按钮

**描述**：在分镜看板上按 `track` 字段分组显示分镜，并提供：
1. 「自动分配 Track」按钮（调用 `assign_tracks` action）
2. 每个 track 组显示「生成本组视频」按钮（调用 `batch_video_generate` action）
3. Track 编号 badge 显示在分镜卡片序号旁

**验收标准**：
- [ ] storyboard 页面顶部有「自动分配 Track」按钮
- [ ] 分配后每个分镜卡片显示 track badge
- [ ] 每个 track 组底部有「生成本组视频」按钮
- [ ] 点击后调用 API，SSE 流式反馈进度
- [ ] 无 track 信息（老数据）的分镜仍正常显示

**验证步骤**：
- [ ] 手动测试完整 track 分组→批量生成视频流程

**依赖**：T12

**涉及文件**：
- `src/app/[locale]/project/[id]/episodes/[episodeId]/storyboard/page.tsx`（更新）
- `src/components/editor/shot-kanban.tsx`（更新，track 分组渲染）
- `src/components/editor/shot-card.tsx`（更新，track badge）

**规模**：M

---

### 检查点 6（最终）

- [ ] `pnpm test` 全部通过
- [ ] `npx tsc --noEmit` 零报错
- [ ] **端到端验证**：创建新项目 → AI生成大纲 → 解析分镜（包含情绪/光影/朝向）→ 生成首帧（三段式 prompt）→ 分配 Track → 批量生成 Seedance 多参视频
- [ ] **保留验证**：已有项目的角色定妆图、分镜视频可正常访问和播放
- [ ] supervision 质量评分在 UI 可见

---

## 风险与应对

| 风险 | 影响 | 应对 |
|------|------|------|
| Seedance @参考N 多图顺序敏感 | 角色错位 | T11 写充分单元测试，staging 环境验证 |
| shot_split 不输出 ｜朝向： | Phase 3 校验失败 | T8 加 few-shot 示例强制格式，T9/T13 作兜底 |
| 风格 storyboard.md 导致 prompt 过长 | 超过 token 限制 | 测量实际 token 数，必要时截取关键段落 |
| Track 批量视频返回的 URL 需要切割 | 视频对应关系错乱 | 先以"同组共享一个 URL"实现，切割作 v2 |
| 老 unit test 对 prompt 内容有硬编码断言 | CI 红线 | 先跑 `pnpm test`，定位受影响测试一并修复 |

---

## 开放问题（需人工决策）

1. **T12 视频切割**：Seedance 多分镜视频返回一个文件，是否需要按时间轴切割为独立 shotVideoUrl？
   → 建议 v1 先存同一 URL，UI 标注"Track N 共享视频"，切割作 v2 feature。

2. **角色音频**：`characters` 表有 `voiceHint` 文字描述，但 Toonflow 支持音频文件参考。
   → 当前系统无音频上传功能，T11 仅实现文字音色描述（情况3），音频参考作后续规划。

3. **监督层 LLM 调用**：T13 superviseShots 当前设计为纯规则校验（无 LLM）。
   Toonflow 用 LLM 做更深层语义审核，是否需要？
   → 建议 v1 纯规则，v2 再加 LLM judge（与 enhancePrompts 开关联动）。
