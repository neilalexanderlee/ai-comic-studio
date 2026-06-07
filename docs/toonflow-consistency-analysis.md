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

> 对比表更新于 2026-06-06，反映本次 Toonflow 对齐迭代后的实际状态。

| 机制 | Toonflow | 本项目（当前） | 状态 |
|------|----------|--------------|------|
| 角色参考图持久化 | ✅ 生成一次存 filePath | ✅ character_assets.imagePath | ✅ 已对齐 |
| 角色参考图注入首帧 | ✅ 每次生成都注入 | ✅ filterShotCharacters + 定妆图注入 | ✅ 已对齐 |
| 场景资产 @图N 注入 | ✅ t_assets type=场景 | ✅ scenes 表 + sceneId 关联 + @图N 注入 | ✅ 已对齐 |
| 名称精确绑定 | ✅ System prompt 强制禁止简称 | ✅ filterShotCharacters 最长优先匹配（代码层）| ✅ 机制不同，目标相同 |
| 帧生成 = 首帧（Seedance 主流程）| ✅ storyboard image = 首帧 | ✅ "生成画面" = 只生首帧，无启发式 | ✅ 已对齐 |
| 画风统一（项目级）| ✅ 项目级 artStyle | ✅ visualStyle + art-styles/ 全套 | ✅ 已对齐 |
| @图N 提示词系统 | ✅ "名字=图片N" 格式 | ✅ "@图N 为名字 类型" 格式（更显式）| ✅ 格式不同，语义等价 |
| 场景图生成用 scene.md | ✅ 场景专属约束 | ✅ getArtStylePrompt("scene") | ✅ 已对齐 |
| 视频风格标签 | ✅ video.md | ✅ getArtStylePrompt("video") | ✅ 已对齐 |
| BGM 剔除 | ✅ 不传给视频模型 | ✅ stripBgmContent() + bgmNote 字段 | ✅ 已对齐 |
| 视频 prompt 不推断光色 | ✅ 风格标签锁定色调基准 | ✅ 修复：只引用明确存在的光源 | ✅ 已对齐 |
| Seedance 多参（多镜打包）| ✅ buildSeedanceMultiParamVideoPrompt | ✅ 完整实现含 @参考N | ✅ 已对齐 |
| 多提供商适配 | ✅ 统一适配层 | ✅ Provider 抽象 | ✅ 已对齐 |
| ControlNet/IP-Adapter | ❌ 仅依赖多模态提示 | ❌ 同 | — |
| 跨集视觉漂移检测 | ❌ 无 | ❌ 无 | — |
| 参考图超10张限制策略 | ✅ 合并第11张起 | ✅ 优先级截取前10张（无 sharp 暂不合图）| ✅ 已对齐（方式不同）|
| 资产创建时机 | ✅ 大纲阶段（先于分镜）| ⚠️ 分镜解析后提取（retroactive）| 设计差异（可接受）|

### 剩余差距说明

**参考图数量限制**：已实现 `limitReferenceImages(images, limit=10)` 工具函数，在所有三处调用点（首帧、尾帧、批量视频）生效。截取策略按优先级顺序保留前 10 张（continuityRef → 角色定妆图 → 场景参考图 → 分镜图）。Toonflow 是合并超出部分为合成图，本项目因无 sharp 暂用截断，实际效果近似（大多数镜头图片数量 2-5 张，极少超限）。

**设计差异**：资产创建时机不同——Toonflow 在用户写大纲时就声明场景/角色资产，本项目是分镜解析后用 LLM 从分镜反推。这是 UX 设计选择，不是功能缺失。

---

*初始分析：2026-03-18 | 更新：2026-06-06（Toonflow 对齐迭代后）*
