# AIComicBuilder — Eval 框架说明

---

## 概述

本项目使用两层测试体系：

| 层 | 工具 | 特点 | 是否需要 API |
|---|---|---|---|
| **单元测试** | Vitest | 纯函数、确定性、快速 | 否 |
| **AI Eval** | 自研 runner | 真实 AI 调用、质量评估 | 是 |

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
  setup.ts                          # 全局 mock（DB、fs）
  unit/lib/ai/
    character-router.test.ts        # filterShotCharacters 行为测试
    prompt-enhancer.test.ts         # enhanceVideoPrompt / enhanceImagePrompt
    prompt-builders.test.ts         # buildFirstFramePrompt / buildLastFramePrompt
  integration/
    api/generate.test.ts            # (预留) generate API 集成测试
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
# 全部 suite
pnpm eval

# 只跑角色路由 suite
pnpm eval -- --suite char

# 只跑 prompt 增强 suite（需要 API key）
pnpm eval -- --suite prompt
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

### 已有 Suites

#### `character-routing` (确定性，不需要 API)

| Case | 验证内容 |
|---|---|
| `named-characters-detected` | 命名角色被正确识别 |
| `crowd-scene-returns-empty` | 群演场景返回空列表 ← CRITICAL |
| `pure-action-shot-returns-empty` | 纯动作镜头返回空列表 |
| `single-character-matched` | 单角色镜头只返回该角色 |
| `base-name-matching` | 括号后缀角色名通过 base name 匹配 |
| `empty-shot-text` | 空文本不崩溃 |
| `no-fallback-to-all-characters` | 防止历史 bug 回归 |

#### `prompt-enhancement` (需要 API key)

| Case | 验证内容 |
|---|---|
| `seedance-video-enhancement` | Seedance prompt 增强，包含五段式结构 |
| `kling-video-enhancement` | Kling prompt 增强，保留核心叙事 |
| `gemini-video-enhancement-english` | Gemini prompt 输出英文 |
| `doubao-image-enhancement` | Doubao(Seedream) prompt 增强，含画质词 |
| `openai-image-enhancement-english` | OpenAI prompt 英文输出 |
| `fallback-on-empty-prompt` | 空 prompt 不调用 API，原样返回 |
| `fallback-on-api-error` | API 失败静默回退 |
| `llm-judge-seedance-quality` | LLM-as-judge 评估 Seedance prompt 质量 |

---

## 评估方法

### Rule-based 检查

```typescript
assertMinLength(enhanced, 40);               // 最小长度
assertContains(enhanced, "龙渊");            // 包含核心内容
assertNotContains(enhanced, "ERROR");        // 不含错误标记
```

### LLM-as-judge

```typescript
const isGood = await llmJudge(
  enhanced,
  "The prompt describes motion and includes camera language",
  provider
);
```

Judge 被要求只回答 YES/NO，温度设为 0 以保证稳定性。

---

## 新增 Eval Case 的步骤

1. 在 `src/lib/evals/fixtures/shots.ts` 添加测试数据（如需要）
2. 在 `src/lib/evals/cases/` 创建或修改 suite 文件
3. 在 `src/lib/evals/index.ts` 注册 suite
4. 运行 `pnpm eval -- --suite <name>` 验证

---

## CI 集成建议

```yaml
# .github/workflows/ci.yml 中
- name: Unit tests
  run: pnpm test

- name: Type check
  run: npx tsc --noEmit

# Eval 单独在 scheduled job 里跑（需要 secrets）
# 不加入普通 PR CI（避免 API 费用和不稳定性）
```

---

## 关键 Eval 不变量（防回归）

以下行为必须在每次 eval 中通过。如果失败，视为严重回归：

1. **`crowd-scene-returns-empty`**：群演场景的 `filterShotCharacters` 返回 `[]`
2. **`fallback-on-api-error`**：`enhanceVideoPrompt`/`enhanceImagePrompt` 在 API 故障时返回原始 prompt
3. **`fallback-on-empty-prompt`**：空 prompt 不触发 API 调用
