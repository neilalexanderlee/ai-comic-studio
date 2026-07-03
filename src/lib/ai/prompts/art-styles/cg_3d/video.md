# 视频提示词 · 视觉风格约束

生成视频提示词时，必须注入以下视觉风格标签：

| 模式 | 风格标签 |
|------|----------|
| **通用多参模式（英文）** | `3D anime render, cel-shaded 3D, cinematic lighting, warm tones, high-detail textures, clear outlines` |
| **通用首尾帧模式（英文）** | `3D anime render, cel-shaded 3D, cinematic lighting, warm tones, high-detail textures, clear outlines, shallow depth of field` |
| **Seedance 2.0（中文）** | `3D动画渲染，赛璐珞质感，电影级光影，温暖色调，高细节材质，清晰轮廓线` |

---

## 摄影机运动 · 3D 动画选择指南

3D 动画的虚拟摄影机运动与真人摄影术语完全对应，决定画面视觉节奏：

| 场景氛围 | 推荐摄影机方式 |
|---|---|
| 温馨室内/咖啡厅对话 | `固定镜头（locked-off），人物表情主导画面节奏` |
| 角色步行/移动 | `侧面追踪（lateral tracking shot），匀速跟拍，背景横向流动` |
| 情感升华/爆点时刻 | `缓慢dolly in推近，全景→近景，目的：强调情绪积聚` |
| 场景开场/空间交代 | `宽景固定（wide locked-off），人物在画面1/3处，目的：建立空间关系` |
| 告别/分离/失落感 | `缓慢dolly out拉远，人物越来越小，目的：表现孤独感` |
| 环绕揭示角色 | `counter-clockwise orbit [X]度，以角色为圆心，展示三维空间纵深` |
| 仰拍·人物气场 | `低角度仰拍固定（low angle upward），目的：塑造人物气场/重量感` |
| 俯拍·全景概览 | `垂直俯拍（top-down god's-eye view）固定，目的：交代空间布局` |

---

## 景深（3D 渲染景深描述）

3D 渲染景深是后期合成参数，不同于实拍光圈，以下为标准描述写法：

| 场景 | 景深描述写法 |
|---|---|
| 情感对话近景 | `浅景深渲染（soft DoF），背景高斯虚化，主体轮廓清晰` |
| 场景交代全景 | `深景深渲染（deep focus），前中后景均清晰入画` |
| 情绪特写帧 | `极浅景深，背景虚化为模糊色块，前景道具可轻微虚化入画` |
| 人物与背景分离 | `景深分层明确，人物边缘轮廓锐利，背景柔焦层与人物层形成对比` |


