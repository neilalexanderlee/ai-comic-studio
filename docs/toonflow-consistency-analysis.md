# Toonflow 连续性与角色一致性机制分析

> 基于 [HBAI-Ltd/Toonflow-app](https://github.com/HBAI-Ltd/Toonflow-app) 源码分析

---

## 核心思路一句话总结

**文字锚定 + 视觉参考双轨制**：通过严格的资产名称约束保证文字提示词一致，通过将角色参考图注入每次图像生成调用保证视觉一致。

---

## 一、资产（角色/场景/道具）的存储

### 数据库结构

```
t_assets 表
├── name        角色/场景/道具名称（唯一）
├── intro       文字描述
├── prompt      AI 生成提示词
├── videoPrompt 视频生成专用提示词
├── type        类型：角色 | 场景 | 道具
├── filePath    已生成的参考图（base64/路径）
└── state       状态：生成中 | 生成成功
```

**关键设计**：每个角色只生成一次并持久化存储。后续所有分镜图生成都复用这张已生成的参考图，而不是每次重新生成。

### 生成流程

```
项目大纲（含角色/场景/道具描述）
    ↓
generateAssets 批量生成资产图片
    ↓
存入 t_assets.filePath
    ↓
分镜生成时按名称查询、注入参考图
```

---

## 二、分镜图生成的一致性机制

### 核心文件：`src/agents/storyboard/generateImageTool.ts`

这是整个一致性系统的核心，流程如下：

#### Step 1：收集本格分镜涉及的所有资产

```typescript
// 从大纲提取该场景的角色、场景、道具名称
// 按优先级排序：角色 > 场景 > 道具
const assetImages = await fetchAssetsByNames(outlineAssets);
```

#### Step 2：构建参考图映射提示词

```typescript
function buildResourcesMapPrompts(images: ImageInfo[]): string {
  const mapping = images.map((item, index) =>
    `${item.name}=图片${index + 1}`
  );
  return `其中人物、场景、道具参考对照关系如下：${mapping.join(", ")}。`;
  // 输出示例："张三=图片1, 李四=图片2, 外星基地=图片3"
}
```

#### Step 3：压缩并限制图片数量

```typescript
// 最多注入 10 张参考图（API 限制）
if (images.length <= 10) {
  // 每张单独压缩至 3MB
} else {
  // 第 10 张之后的合并为一张合成图，压缩至 10MB
}
```

#### Step 4：调用图像 API（注入参考图）

```typescript
const result = await ai.image({
  systemPrompt: resourcesMapPrompts,   // "张三=图片1, 李四=图片2..."
  prompt: shotPrompts,                  // 分镜描述
  imageBase64: processedImages,         // 参考图数组
  aspectRatio: project.videoRatio,
  size: "4K",
});
```

**关键点**：每次生成分镜图，都会把相关角色的参考图和名称映射同时传给 AI，让 AI 在视觉上保持一致。

---

## 三、提示词层面的一致性约束

### 资产名称严格绑定

在分镜规划时（`src/agents/storyboard/index.ts`），Agent 系统提示中明确写入：

```
⚠️ 重要规则：
1. 必须原封不动地使用上述资产名称，禁止使用近义词、缩写或任何变体
2. 禁止在资产名称前后添加修饰词
3. 禁止捏造资产列表中不存在的角色、场景、道具
```

**目的**：确保文字提示词中的角色名称与数据库中的资产名称精确匹配，才能在后续步骤中正确查到参考图。

### 可用资产注入提示词

```typescript
const assetsSection = `
【可用资产】
${assets.map(a => `- ${a.name}：${a.intro}`).join("\n")}

⚠️ 必须使用完整资产名称，禁止简称或代词。
`;
```

---

## 四、画风一致性

### 60+ 预设风格库（`src/lib/artStyle.ts`）

```typescript
{
  "2D动漫风格": "(画风：2D动漫风格, 2d animation style)",
  "吉卜力":     "(画风：吉卜力, Ghibli style, Studio Ghibli aesthetic)",
  "真人写实":   "(画风：照片级真人超写实, photorealistic, ultra detailed)",
  // ...60+ styles
}
```

### 应用方式

- 存储在 `t_project.artStyle`（项目级别）
- 资产生成时注入：`画风风格: ${project.artStyle}`
- 同一项目下所有资产使用相同 artStyle，保证风格统一

---

## 五、多 AI 提供商的参考图适配

| 提供商 | 参考图注入方式 |
|--------|--------------|
| Gemini | `imageBase64` 作为 `type: "image"` content block |
| ModelScope/grsai | `urls` 参数；>6张时合并第5张后的所有图为一张 |
| OpenAI-compatible | `prompt.images` 数组参数 |

所有提供商均通过统一适配层（`src/utils/ai/image/`）处理，上层逻辑无需关心差异。

---

## 六、分镜的空间一致性：网格图切割

分镜图以**网格方式**批量生成（降低 API 调用次数），然后精确切割：

```typescript
// imageSplitting.ts — 确定性网格布局
1 格 → 1×1
2 格 → 2×1
3 格 → 3×1
4 格 → 2×2
5-9 格 → 3×3
10+ 格 → 3×N
```

网格切割保证了每格图片的位置固定，不会发生错位。

---

## 七、整体数据流

```
项目（artStyle, videoRatio）
    ↓
大纲（角色/场景/道具 名称+描述）
    ↓
资产生成（每个角色生成一次，存参考图）
    ↓
分镜规划（三层 Agent：片段师 → 分镜师 → 主控）
│   └─ 约束：必须使用精确资产名，不得捏造
    ↓
分镜图生成（generateImageTool）
│   ├─ 查询本格涉及的资产参考图
│   ├─ 构建 name=图片N 映射提示词
│   ├─ 压缩参考图（≤10张，≤10MB）
│   └─ AI 调用（systemPrompt + imageBase64 + 分镜描述）
    ↓
网格图切割（imageSplitting）
    ↓
单格分镜图存入 t_image
```

---

## 八、与我们项目的对比与启示

| 机制 | Toonflow | AIComicBuilder（现状） |
|------|----------|-----------------------|
| 角色参考图持久化 | ✅ 生成一次存 filePath | 需要评估 |
| 参考图注入分镜生成 | ✅ 每次生成都注入 | 待实现 |
| 名称精确绑定约束 | ✅ System prompt 强制 | 待实现 |
| 画风统一 | ✅ 项目级 artStyle | 有 artStyle 字段 |
| 多提供商适配 | ✅ 统一适配层 | 有 Provider 抽象 |
| ControlNet/IP-Adapter | ❌ 仅依赖多模态提示 | — |
| 跨集视觉漂移检测 | ❌ 无 | — |

### 可借鉴的关键点

1. **"先生成资产，再生成分镜"的两阶段流程**：角色参考图只生成一次，后续复用，避免风格漂移。

2. **名称精确匹配机制**：文字提示词中的角色名 → 数据库查询 → 参考图注入，三环节完全依赖名称匹配，任何简称/变体都会导致断链。在系统提示中明确禁止变体是关键防护。

3. **参考图数量限制策略**：API 通常有图片数量限制，Toonflow 的"超出10张则合并"策略值得参考。

4. **resourcesMapPrompts 格式**：`"张三=图片1, 李四=图片2"` 这种显式映射比仅传图片更有效，让 AI 知道每张图对应哪个角色。

---

*分析时间：2026-03-18 | 源码版本：main 分支*
