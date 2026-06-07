# Todo — AI漫剧工坊重构任务列表

> 详细说明见 [plan.md](./plan.md)。
> 状态：`[ ]` 未开始 | `[~]` 进行中 | `[x]` 完成

---

## Phase 1：数据模型扩展

- [x] **T1** — shots 表新增 emotion / lightingAtm / framing / track 字段
  - `drizzle/0035_shot_structured_fields.sql`
  - `src/lib/db/schema.ts`（shots 表）
  - `drizzle/meta/_journal.json`（idx=35）

- [x] **T2** — dialogues 表新增 type 字段（'dialogue'|'os'|'vo'，默认'dialogue'）
  - `drizzle/0036_dialogue_type.sql`
  - `src/lib/db/schema.ts`（dialogues 表）
  - `drizzle/meta/_journal.json`（idx=36）

### ✅ 检查点 1
- [ ] `npx tsc --noEmit` 零报错
- [ ] `pnpm dev` 启动，老项目正常显示
- [ ] 角色定妆图、已有视频可正常访问

---

## Phase 2：美术风格约束库

- [x] **T3** — 美术风格文件加载器 getArtStylePrompt()
  - `src/lib/ai/prompts/art-styles/index.ts`
  - `src/__tests__/unit/lib/ai/prompts/art-styles.test.ts`

- [x] **T4** — anime_2d 风格全套约束文件（移植 Toonflow 2D_90s_japanese_anime）
  - `src/lib/ai/prompts/art-styles/anime_2d/prefix.md`
  - `src/lib/ai/prompts/art-styles/anime_2d/character.md`
  - `src/lib/ai/prompts/art-styles/anime_2d/scene.md`
  - `src/lib/ai/prompts/art-styles/anime_2d/storyboard.md`
  - `src/lib/ai/prompts/art-styles/anime_2d/video.md`

- [x] **T5** — 其余4种风格约束文件（realistic / cg_3d / chinese_ink / western_cartoon）
  - 各风格目录下 prefix.md / storyboard.md / video.md（各3个文件，共12个）

### ✅ 检查点 2
- [ ] `pnpm test` 全部通过
- [ ] `getArtStylePrompt('anime_2d', 'storyboard')` 返回情绪→面容映射表
- [ ] `getArtStylePrompt('auto', 'prefix')` 返回空字符串（graceful fallback）

---

## Phase 3：分镜图提示词重构

- [x] **T6** — 通用分镜技法文档 + buildStoryboardImagePrompt()
  - `src/lib/ai/prompts/storyboard-image.ts`
  - `src/lib/ai/prompts/art-styles/storyboard-techniques.md`

- [x] **T7** — buildFirstFramePrompt / buildLastFramePrompt 接入三段式新系统
  - `src/lib/ai/prompts/frame-generate.ts`
  - `src/lib/storyboard/frame-prompt-context.ts`
  - `src/app/api/projects/[id]/generate/route.ts`

- [x] **T8** — outline_expand + shot_split prompt 更新（12维输出 + 朝向标注）
  - `src/lib/ai/prompts/registry.ts`（SHOT_SPLIT_OUTPUT_FORMAT_TEMPLATE）
  - `src/lib/storyboard/complete-extracted-shots.ts`
  - `src/lib/storyboard/persist-storyboard-version.ts`
  - `src/lib/storyboard/extract-shot-script.ts`

- [x] **T9** — single_shot_rewrite prompt 更新（6重校验 + 朝向 + 禁用词）
  - `src/lib/ai/prompts/single-shot-rewrite-defaults.ts`

### ✅ 检查点 3
- [ ] `pnpm test` 全部通过
- [ ] `npx tsc --noEmit` 零报错
- [ ] 生成首帧 → prompt 包含【画面】/【光影】/【风格】三段
- [ ] 新建分镜 → DB 中 emotion / lightingAtm / framing 有值
- [ ] 老项目/老分镜正常运行

---

## Phase 4：视频提示词重构

- [x] **T10** — buildVideoDesc() 12维组装函数
  - `src/lib/storyboard/video-desc.ts`

- [x] **T11** — buildSeedanceMultiParamVideoPrompt() 实现（@参考N 编号系统）
  - `src/lib/ai/prompts/seedance-multi-param.ts`

- [x] **T12** — Track分组批量视频生成API（assign_tracks + batch_video_generate）
  - `src/app/api/projects/[id]/generate/route.ts`（新增2个action）
  - `src/lib/storyboard/track-grouping.ts`

### ✅ 检查点 4 — 通过
- [x] `pnpm test` 全部通过（124/124）
- [x] `npx tsc --noEmit` 零报错

---

## Phase 5：质量控制层

- [x] **T13** — 6红线校验 + superviseShots() 函数
  - `src/lib/storyboard/shot-supervision.ts`（含LLM judge system prompt）

- [x] **T14** — 接入 shot_split 流程（supervision 结果随 JSON 返回，UI 显示 toast）
  - `src/app/api/projects/[id]/generate/route.ts`
  - `src/app/[locale]/project/[id]/episodes/[episodeId]/storyboard/page.tsx`

### ✅ 检查点 5 — 通过
- [x] `pnpm test` 全部通过
- [x] 解析分镜后 API 响应含 supervision 字段，UI 显示质量 toast

---

## Phase 6：UI 适配

- [x] **T15** — 台词类型选择器（对白/OS/VO）
  - `src/components/editor/shot-card.tsx`（select下拉 + 类型badge显示）

- [x] **T16** — Track 分组显示 + 批量视频按钮
  - `src/app/[locale]/project/[id]/episodes/[episodeId]/storyboard/page.tsx`（自动分配Track按钮）
  - `src/components/editor/shot-card.tsx`（track badge显示）

### ✅ 检查点 6（最终）
- [ ] `pnpm test` 全部通过
- [ ] `npx tsc --noEmit` 零报错
- [ ] 端到端：新建项目 → AI生成 → 解析分镜 → 生成首帧 → 分配Track → 批量视频
- [ ] 保留验证：老项目定妆图、已有视频正常访问
- [ ] supervision 评级在 UI 可见

---

## 开放决策记录

| 问题 | 暂定方案 | 状态 |
|------|---------|------|
| T12 多镜视频是否切割 | ✅ 按时间轴切割，每镜独立 URL | 已确认 |
| 角色音频参考 | ✅ 支持音频文件上传 + @参考N 绑定 | 已确认 |
| 监督层是否用 LLM | ✅ LLM judge，与 enhancePrompts 联动 | 已确认 |
