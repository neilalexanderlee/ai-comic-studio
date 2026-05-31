# 提示词模板编写规范

面向 **提示词模板**（`src/lib/ai/prompts/*-defaults.ts`、`registry.ts` 内置插槽、UI「提示词模板」中保存的覆盖内容）的编写与评审标准。

运行时 **用户剧本、分镜字段、角色库** 可以包含任意剧情；**仓库里的默认模板不行**——不能把某一部的具体人名、地名、势力、道具或情节写进默认示例。

---

## 1. 适用范围

| 属于模板（须遵守） | 不属于模板（用户数据） |
|-------------------|------------------------|
| `ref_video_prompt`、`single_shot_rewrite`、`shot_split` 等 registry 默认插槽 | `shots.prompt`、`videoScript`、导入的剧本 |
| `buildXxxPrompt` 里写死的 **system / 规则 / 正反例** | 单次 API 请求里的 user 消息正文 |
| UI 保存到 `prompt_templates` 表的 **全局/项目覆盖** | Eval fixture、单元测试里的假数据（见下文） |

**运行时数据传递**（例如 `Scene description: ${shot.prompt}`）只传字段原文，不在代码里拼接叙事句式。

---

## 2. 必须遵守

1. **规则抽象化**：写「起幅 / 随后 / 远景建立段 / 主体特写段」，不写「宁静小镇 → 魔族入侵」这类绑定某一项目的叙事。
2. **示例用占位符**：角色用 `角色甲`、`角色乙` 或 `主角`、`配角B`；地点用 `城镇`、`掩体区`、`集会场地`；技能用 `晶盾术`、`铭刃` 等**非本项目专属名**。
3. **类型标签可用**：`魔族士兵`、`村民`、`精灵斥候` 等表示**可替换群演**的标签可以保留（Substitution test 需要）。
4. **情节只来自请求**：模板只教「如何读 Scene description / motionScript」，不预置具体剧情句子。
5. **禁止后处理写剧情**：不得在 TypeScript 里根据场景描述强行 prepend 最终 `videoPrompt` 字符串。

---

## 3. 禁止出现在默认模板中的内容

维护列表见 `src/lib/ai/prompts/prompt-template-standards.ts` 中的 `BANNED_PLOT_TERMS_IN_TEMPLATES`。

当前包括但不限于：具体主角名、本项目地名、专属武器/技能名、以及曾用于示例的复合词（如 `龙渊灵瑶`）。

新增默认示例前：在脑中做 **Substitution test**——换一部完全不同的剧是否仍成立；不成立则改为更抽象的写法。

---

## 4. 推荐结构（视频 / 分镜类）

1. **忠实度**：只写用户提供的字段，不发明反向运动或剧本外感官细节。
2. **字段分工**（若系统分字段）：
   - `sceneDescription` / `prompt`：情节与环境；
   - `startFrame` / `endFrame`：静帧构图（无运镜动词）；
   - `motionScript`：分段时间轴；
   - `videoScript` / 视频精炼：给视频模型的散文 prompt。
3. **时间轴**（可选能力，非绑定剧情）：首帧可为「变化前」；片中变化写在远景段的 `随后/接着`；多段 `[Xs-Ys]` 时背景事件放在第一段广角。
4. **运镜锁定**：`cameraDirection` 为唯一运镜依据时，在规则中写明不得另 invent 运镜。

---

## 5. 修改模板后的检查

```bash
pnpm test src/__tests__/unit/lib/ai/prompt-templates-deplot.test.ts
```

若你在 UI 中 **自定义过插槽**，代码默认更新不会自动覆盖 DB：

1. 打开 **设置 → 提示词模板** → 对应 `promptKey` / `slotKey`；
2. 使用 **恢复默认**，或手动删除与 `BANNED_PLOT_TERMS` 冲突的句子；
3. 再跑一次「重新生成文本 / 重新生成提示词」验证。

`ref_video_prompt` 与 `single_shot_rewrite` 的代码默认在：

- `ref-video-prompt-defaults.ts`
- `single-shot-rewrite-defaults.ts`

---

## 6. 与 ARCHITECTURE-PROMPTS 的关系

流水线字段含义见 `docs/ARCHITECTURE-PROMPTS.md`。  
本文档只约束 **模板文案如何写**；不改变 API 字段语义。

---

## 7. 评审清单（PR / 改模板时）

- [ ] 默认插槽中无 `BANNED_PLOT_TERMS` 中的词
- [ ] 无 TS 后处理拼接用户剧情
- [ ] 正反例可在任意题材复用
- [ ] `prompt-templates-deplot` 单测通过
- [ ] 若改 `registry.ts` 内置常量，同步检查 UI 预览 `buildFullPrompt` 是否仍合理
