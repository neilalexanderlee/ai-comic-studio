# 视频提示词 · 视觉风格约束 · 写实真人

生成视频提示词时，根据导演调性选择对应风格标签：

---

## 王家卫电影调性（王家卫 / Christopher Doyle）

| 元素 | 标准词汇 |
|------|----------|
| 基础风格标签 | `王家卫电影风格，35mm Kodak Vision3胶片颗粒，anamorphic widescreen 16:9` |
| 光影基调 | `暗调低key，大量阴影+局部高光，冷蓝主导，contrast偏强` |
| 饱和霓虹变体 | `饱和粉紫霓虹主色调，冷蓝侧光，暖橘点缀，medium contrast` |
| 景深 | `极浅景深T1.4，anamorphic椭圆bokeh，背景虚化成抽象色块` |
| 运动方式 | `三脚架完全固定（locked-off shot），画面无运动，不抽帧` |
| 手持变体 | `手持晃动handheld camera，广角12mm wide lens，自然抖动` |
| steady-cam变体 | `steady-cam稳定，持续匀速跟拍，背景纵深向镜头方向流动` |
| 胶片质感 | `35mm Kodak Vision3 film grain，anamorphic widescreen 16:9，medium contrast` |
| 空气质感 | `空气尘埃在光柱里可见，微尘漂浮（暖橘灯下）` |

---

## Christopher Nolan 调性（Hoyte van Hoytema摄影）

| 元素 | 标准词汇 |
|------|----------|
| 基础风格标签 | `Christopher Nolan cinematography，Hoyte van Hoytema，IMAX 65mm，handheld微抖` |
| 景深 | `shallow DoF，IMAX intimate close-up，毛孔级细节可见` |
| 光影 | `chiaroscuro side lighting，一侧打亮+另一侧深陷阴影，暗部眼睛反射画外光` |
| 稳定感 | `steady-cam稳定感，handheld微抖保留自然呼吸感` |

---

## 通用多参模式

| 模式 | 风格标签 |
|------|----------|
| **Seedance 2.0 通用（中文）** | `真人写实摄影，电影级摄影质感，自然光照，极致细节，强对比度` |
| **旧版甜宠写实（中文）** | `都市写实摄影，电影风格，自然光照，极致细节` |
| **英文通用** | `modern cinematic realism, photorealistic, 35mm film grain, natural lighting, ultra-fine detail, shallow depth of field, anamorphic lens bokeh` |
| **首尾帧模式（英文）** | `modern urban drama, photorealistic, cinematic, natural lighting, ultra-fine detail, shallow depth of field` |

---

## 摄影机支撑方式 · 写实风格选择指南

| 场景氛围 | 推荐摄影机支撑 |
|---|---|
| 王家卫室内静态（化妆间/卧室/咖啡厅） | `三脚架完全固定（locked-off shot），画面无运动` |
| 剧组片场通道跟拍 | `手持晃动handheld camera，广角12mm，自然抖动` |
| 情感张力对话场景 | `手持轻微呼吸感（subtle handheld breathing movement）` |
| Birdman式一镜到底跟拍 | `steady-cam稳定，持续匀速倒退跟拍` |
| Nolan戏剧奇观/能量场景 | `handheld微抖，IMAX 65mm` |
| orbit环绕揭示 | `counter-clockwise orbit [X]度，以[主体]为圆心` |

---

## 人物比例-景框约束（写实风格视频必守）

写实真人视频中，人物在画面内的比例必须明确声明：

| 取景范围 | 人物高度占画面竖向比例 | 示例写法 |
|---|---|---|
| 全身（远/全景） | 竖向1/3到1/2 | `全景，人物全身竖向高度约占画面1/3（不得推近到半身）` |
| 腰部以上 | 竖向2/3 | `腰部以上入镜，从腰到头顶占画面竖向2/3` |
| 特写（胸部以上） | 竖向2/3以上 | `近景，胸口到额顶占画面竖向2/3以上，五官清晰` |
| 下半身侧拍 | 腰以下到脚底占画面竖向2/3 | `侧拍下半身，腰以下到脚底占画面竖向2/3` |

---

## caustics波光与空气尘埃描述（写实帧细节）

在 startFrameDesc 的景深/光影描述后可追加：

- **caustics波光**：`[人物]脸上有缓慢流动的冷蓝色调波纹光斑（水面/鱼缸折射效果），脸是波光主要承载体`
- **空气尘埃**：`暖橘灯下微尘漂浮可见，光柱穿过空气，粒子在光柱里清晰可见`
- **anamorphic bokeh**：`anamorphic椭圆bokeh，背景虚化成模糊色块，前景[道具]虚化入画作脏构图前景`
- **胶片颗粒**：`35mm Kodak Vision3 film grain，画面自然颗粒感`
