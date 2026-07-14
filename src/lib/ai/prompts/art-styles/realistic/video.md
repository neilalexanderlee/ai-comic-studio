# 视频提示词 · 视觉风格约束 · 写实真人（现代都市）

生成视频提示词时，根据导演调性选择对应风格标签：

---

## 通用真人都市摄影调性

| 元素 | 标准词汇 |
|---|---|
| 基础风格标签 | `真人实拍摄影，真人电影剧照，当代中国都市，电影级摄影，自然光与人造光调度，真实色彩科学` |
| 影像血统 | `王家卫的夜色，是枝裕和的日常，达内兄弟的贴近，娄烨的都市漫游` |
| 景深 | `浅景深f/2.8-f/4，anamorphic椭圆bokeh，背景城市光斑虚化` |
| 运动方式 | `固定机位（locked-off shot）为主，手持微晃用于情绪波动段落` |
| 胶片质感 | `35mm胶片颗粒质感或全画幅数字摄影，自然暗角过渡` |

---

## 王家卫电影调性（王家卫 / Christopher Doyle）

| 元素 | 标准词汇 |
|---|---|
| 基础风格标签 | `王家卫电影风格，35mm Kodak Vision3胶片颗粒，anamorphic widescreen 16:9` |
| 光影基调 | `暗调低key，大量阴影+局部高光，冷蓝主导，contrast偏强` |
| 饱和霓虹变体 | `饱和粉紫霓虹主色调，冷蓝侧光，暖橘点缀，medium contrast` |
| 景深 | `极浅景深T1.4，anamorphic椭圆bokeh，背景虚化成抽象色块` |
| 运动方式 | `三脚架完全固定（locked-off shot），画面无运动，不抽帧` |
| 手持变体 | `手持晃动handheld camera，广角12mm wide lens，自然抖动` |
| steady-cam变体 | `steady-cam稳定，持续匀速跟拍，背景纵深向镜头方向流动` |
| 空气质感 | `空气尘埃在光柱里可见，微尘漂浮（暖橘灯下）` |

---

## 是枝裕和 / 达内兄弟纪实调性（日常贴近）

| 元素 | 标准词汇 |
|---|---|
| 基础风格标签 | `是枝裕和式日常纪实，达内兄弟式贴近跟随，自然光摄影，非布光感` |
| 光影基调 | `自然窗光/天光为主，无明显人工布光痕迹，柔和低反差` |
| 运动方式 | `手持轻微呼吸感（subtle handheld breathing movement），与人物保持贴近距离` |
| 景深 | `中等景深，人物与环境共存而非割裂，避免过度虚化背景` |
| 质感 | `真实生活流质感，不刻意构图，允许画面边缘的日常杂物入镜` |

---

## Christopher Nolan 调性（Hoyte van Hoytema摄影）

| 元素 | 标准词汇 |
|---|---|
| 基础风格标签 | `Christopher Nolan cinematography，Hoyte van Hoytema，IMAX 65mm，handheld微抖` |
| 景深 | `shallow DoF，IMAX intimate close-up，毛孔级细节可见` |
| 光影 | `chiaroscuro side lighting，一侧打亮+另一侧深陷阴影，暗部眼睛反射画外光` |
| 稳定感 | `steady-cam稳定感，handheld微抖保留自然呼吸感` |

---

## 通用多参模式

| 模式 | 风格标签 |
|---|---|
| **通用多参模式（英文）** | `live-action urban cinema, real human actors photography, contemporary Chinese urban setting, cinematic color science, natural light and practical lighting, shallow depth of field, handheld camera breathing, smooth Steadicam movement, film grain texture, motion blur for video, cinematic frame rate, non-CGI non-rendered` |
| **通用首尾帧模式（英文）** | `live-action urban cinema, real human actors photography, contemporary Chinese urban setting, cinematic color science, natural light and practical lighting, rack focus, focal plane locking, shallow depth of field, cinematic bokeh, film grain texture, non-CGI non-rendered` |
| **Seedance 2.0（中文）** | `真人都市电影摄影，真人实拍质感，当代中国都市，电影级色彩科学，自然光与实用光源调度，浅景深，手持呼吸感或稳定器流动，电影颗粒质感，视频动态优化，非CG非渲染` |

---

## 摄影机支撑方式 · 写实风格选择指南

| 场景氛围 | 推荐摄影机支撑 |
|---|---|
| 王家卫室内静态（咖啡厅/卧室/夜场） | `三脚架完全固定（locked-off shot），画面无运动` |
| 街头行走/都市漫游跟拍 | `手持晃动handheld camera，广角12-28mm，自然抖动` |
| 情感张力对话场景 | `手持轻微呼吸感（subtle handheld breathing movement）` |
| 一镜到底式跟拍 | `steady-cam稳定，持续匀速倒退跟拍` |
| Nolan戏剧张力场景 | `handheld微抖，IMAX 65mm` |
| 空间揭示/环绕镜头 | `counter-clockwise orbit [X]度，以[主体]为圆心` |

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

## 都市光斑、玻璃反射与空气质感描述（写实帧细节）

在 startFrameDesc 的景深/光影描述后可追加：

- **玻璃多层反射**：`[人物]处于玻璃隔断/落地窗前，画面呈现前景反射+中景人物+背景城市延伸的多层空间`
- **雨夜光束**：`车灯光束穿过雨雾，产生体积光效果，光束中雨丝清晰可见`
- **空气尘埃**：`逆光下微尘漂浮可见，光柱穿过空气，暖橘灯下微尘清晰`
- **anamorphic bokeh**：`anamorphic椭圆bokeh，背景城市灯光虚化成模糊色块，前景[道具]虚化入画作脏构图前景`
- **胶片颗粒**：`35mm Kodak Vision3 film grain，画面自然颗粒感`
