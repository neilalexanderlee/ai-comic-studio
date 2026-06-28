# AIComicBuilder — Eval 框架说明

---

## 概述

本项目使用两层测试体系：

| 层 | 工具 | 特点 | 是否需要 API |
|---|---|---|---|
| **单元测试** | Vitest | 纯函数、确定性、快速 | 否 |
| **AI Eval** | 自研 runner | 真实 AI 调用、质量评估 | 是（部分 case 无需） |

---

## 单元测试

### 运行

```bash
pnpm test           # 运行全部单测
pnpm test:watch     # 监听模式（开发时用）
pnpm test:coverage  # 生成覆盖率报告
```

### 文件结构

```
src/__tests__/
  setup.ts                                         # 全局 mock（DB、fs）
  unit/lib/ai/
    character-router.test.ts                       # filterShotCharacters 行为测试
    expand-motion-script-brackets.test.ts          # expandMotionScriptBrackets 全覆盖
    prompt-enhancer.test.ts                        # enhanceVideoPrompt / enhanceImagePrompt mock
    prompt-builders.test.ts                        # buildFirstFramePrompt / buildLastFramePrompt
    prompt-templates-deplot.test.ts                # 系统提示词模板不含角色剧情占位
    ref-video-prompt-defaults.test.ts              # buildRefVideoPromptRequest 默认值
    ref-video-prompt-generate.test.ts              # buildRefVideoPromptRequest 全量
    sanitize-model-output.test.ts                  # 模型输出净化
    single-shot-rewrite-defaults.test.ts           # (已废弃路径回归)
    prune-stale-prompt-overrides.test.ts           # prompt 覆盖剪枝
  unit/lib/storyboard/
    compress-frame-prompt-for-enhance.test.ts      # 帧 prompt 压缩
    first-frame-prompt.test.ts                     # buildFirstFramePrompt
    frame-prompt-context.test.ts                   # 帧 prompt 上下文构建
    frame-reference.server.test.ts                 # 服务端帧引用解析
    generate-route-deprecations.test.ts            # 废弃 action 返回 410
    shot-frame-link.test.ts                        # cut_point → 下一镜首帧链
    shot-video-prompt-sync.test.ts                 # buildDirectVideoPrompt（直出架构）
    shot-video-readiness.test.ts                   # 视频生成就绪判断
    track-grouping.test.ts                         # groupShotsIntoTracks / buildShotTrackMap
    video-cut-point.test.ts                        # cut_point 计算逻辑
  unit/lib/video/
    remote-video-recovery.test.ts                  # 远程视频恢复
  unit/api/
    generate-route-contract.test.ts                # generate 路由接口约定
```

### Mock 策略

单元测试通过 `src/__tests__/setup.ts` mock 掉：
- **DB**：所有 `db.select()/insert()/update()` 调用
- **文件系统**：`node:fs` 的所有写操作

`makeTextProvider(response)` 工厂函数提供轻量的 AI provider mock。

---

## AI Eval 框架

### 运行

```bash
# 全部 suite（确定性 + LLM judge）
pnpm eval

# 只跑角色路由 suite（确定性，无 API）
pnpm eval -- --suite char

# 只跑 prompt 增强 suite（需要 API key）
pnpm eval -- --suite prompt

# 只跑分镜质量 suite（部分 deterministic，部分需要 API）
pnpm eval -- --suite storyboard
```

### 环境变量

```bash
# Eval 优先使用 Ark（成本低）
export ARK_API_KEY=your_ark_api_key
export EVAL_TEXT_MODEL=ep-xxxxx   # 可选，Ark endpoint ID

# 或使用 OpenAI
export OPENAI_API_KEY=sk-...
```

### Suite 结构

每个 eval suite 是一个 `EvalSuite` 对象，包含若干 `EvalCase`：

```typescript
const mySuite: EvalSuite = {
  name: "suite-name",
  description: "描述",
  cases: [
    {
      name: "case-name",
      aspect: "测试的属性",
      async run() {
        // 抛出异常 = fail
        // 返回 "skip" = 跳过（API key 未配置时）
        // 返回 undefined/void = pass
      },
    },
  ],
};
```

### Helper 函数

```typescript
// runner.ts 提供的工具函数：

// LLM-as-judge：YES/NO 评估 output 是否满足 criteria
llmJudge(output: string, criteria: string, provider): Promise<boolean>

// 断言包含 / 不包含
assertContains(text, substring, label?)
assertNotContains(text, substring, label?)

// 断言最小长度
assertMinLength(text, minChars)
```

---

## 已有 Suites

### `character-routing`（确定性，不需要 API）

```bash
pnpm eval -- --suite char
```

测试 `filterShotCharacters` 角色过滤行为：

| Case | 验证点 |
|---|---|
| `named-characters-detected` | 正确识别镜头中明确出现的角色 |
| `crowd-scene-returns-empty` | **CRITICAL** 群演场景必须返回空列表 |
| `pure-action-shot-returns-empty` | 纯动作/环境镜头（无角色名）返回空列表 |
| `single-character-matched` | 单角色镜头只返回该角色 |
| `base-name-matching` | 带括号后缀的角色名通过 base name 匹配 |
| `empty-shot-text` | 空文本不崩溃，返回空列表 |
| `no-fallback-to-all-characters` | 无匹配时绝不 fallback 到全量角色（防回归） |

---

### `prompt-enhancement`（需要 API）

```bash
pnpm eval -- --suite prompt
```

测试 `enhanceVideoPrompt` / `enhanceImagePrompt` 质量：

| Case | 验证点 | 是否需 API |
|---|---|---|
| `seedance-video-enhancement` | Seedance 增强包含五段式结构 | 是 |
| `kling-video-enhancement` | Kling 增强保留核心内容 | 是 |
| `gemini-video-enhancement-english` | Gemini 增强输出英文 | 是 |
| `doubao-image-enhancement` | Doubao 增强包含画质词 | 是 |
| `openai-image-enhancement-english` | OpenAI 增强英文输出 | 是 |
| `fallback-on-empty-prompt` | 空 prompt 不调 API，原样返回 | **否** |
| `fallback-on-api-error` | API 失败静默回退到原始 prompt | **否** |
| `llm-judge-seedance-quality` | LLM judge 评估 Seedance 增强综合质量 | 是 |

---

### `storyboard-quality`（部分确定性，部分需要 API）

```bash
pnpm eval -- --suite storyboard
```

测试分镜字段结构化质量规范：

| Case | 验证点 | 是否需 API |
|---|---|---|
| `frame-desc-five-elements-valid` | 符合规范的 startFrameDesc 被 judge 认定合规 | 是 |
| `frame-desc-missing-camera-position-detected` | 缺少机位坐标的 startFrameDesc 被拒绝 | 是 |
| `camera-direction-with-purpose-valid` | 含「目的：」的 cameraDirection 被认定合规 | 是 |
| `camera-direction-no-purpose-detected` | 无叙事目的的 cameraDirection 被拒绝 | 是 |
| `banned-template-words-not-in-valid-frame-desc` | 合规样本不含禁用模板词 | **否** |
| `video-script-no-bgm-description` | motionScript 不含 BGM/配乐描述词 | **否** |
| `bracket-prose-output-quality` | bracket→prose 展开结果可作视频提示词 | 是 |
| `bracket-prose-preserves-order` | prose 展开保持 bracket 定义的叙事顺序 | **否** |

**评估的核心规范**：

`startFrameDesc` 五要素（缺一不可，严格按此顺序）：
1. 机位空间坐标（首要素）— `摄影机在[主体][方位][距离]，镜头高度[身体部位]`
2. 景别/视角 + 取景范围
3. 具名角色精确位置与静止姿态
4. 主光完整叙述句（颜色 + 方向 + 铺洒方式 + 受光效果）
5. 情绪身体解剖 + 场景锚定词（禁用形容词如"神情坚定"）

`cameraDirection` 强制格式：
`起幅[景别/机位] → 运动方式+速度 → 落幅[景别/机位]，目的：[揭示/跟随/强调什么]`

---

## 不变量（任何情况下必须 pass）

这些 case 是系统核心约束，不允许回归：

| 不变量 | Suite | 防止的问题 |
|---|---|---|
| `crowd-scene-returns-empty` | character-routing | 群演镜头注入全部角色参考图 |
| `no-fallback-to-all-characters` | character-routing | filterShotCharacters 无匹配时 fallback 全量 |
| `fallback-on-empty-prompt` | prompt-enhancement | 空 prompt 触发 API 调用 |
| `fallback-on-api-error` | prompt-enhancement | 增强失败阻塞生成流程 |
| `bracket-prose-preserves-order` | storyboard-quality | 展开函数重排叙事动作顺序 |
| `video-script-no-bgm-description` | storyboard-quality | motionScript 混入 BGM 描述误导视频生成模型 |

---

## 新增 Eval Suite 步骤

1. 在 `src/lib/evals/fixtures/shots.ts` 添加测试数据（角色用 `FIXTURE_CHAR_*` 占位符）
2. 在 `src/lib/evals/cases/` 新建 `xxx.ts`，`export const xxxSuite: EvalSuite`
3. 在 `src/lib/evals/index.ts` 的 `allSuites` 数组注册，顶部注释补充 `--suite xxx`
4. 运行 `pnpm eval -- --suite xxx` 验证

---

## 新增 Unit Test 步骤

1. 在 `src/__tests__/unit/lib/` 对应子目录新建 `.test.ts` 文件
2. 使用 Vitest 标准：`describe` / `it` / `expect`
3. 调用真实生产函数，不 mock 被测函数本身
4. 运行 `pnpm test <文件路径>` 单独验证

---

## CI 集成说明

- **单元测试** (`pnpm test`)：加入 PR CI，每次提交必须全通过
- **AI Eval** (`pnpm eval`)：不加入 PR CI（避免 API 费用），建议设为 Scheduled Job（每日或每周）
- Eval 失败时 `process.exit(1)`，可接入 CI 通知系统
