# 视频提示词 · 视觉风格约束

生成视频提示词时，必须注入以下视觉风格标签：

| 模式 | 风格标签 |
|------|----------|
| **通用多参模式（英文）** | `mature urban romance anime, cel-shaded, cinematic lighting, cool tones, dramatic low-key shadows, clean line art` |
| **通用首尾帧模式（英文）** | `mature urban romance anime, cel-shaded, cinematic lighting, cool tones, dramatic low-key shadows, clean line art, shallow depth of field` |
| **Seedance 2.0（中文）** | `2D成熟都市言情动画，2D赛璐璐上色，电影级光影，冷色调，戏剧化低调光影，清晰线条` |

---

## 战斗/动作场景专用标签

当 prompt 涉及打斗/格挡/冲刺/能量释放等动作场景时，在通用标签基础上追加以下标签：

| 模式 | 追加标签 |
|---|---|
| **Seedance 2.0（中文）** | `速度流线，方向性运动模糊，冲击波特效，轮廓光，强逆光，动漫战斗粒子特效` |
| **通用多参模式（英文）** | `speed lines, directional motion blur, shockwave FX, rim lighting, strong backlight, anime combat particle effects` |

### 战斗场景摄影机运动指南

| 动作阶段 | 推荐摄影机方式 |
|---|---|
| 对峙/蓄势 | `固定镜头（locked-off）中景，极缓慢dolly in，目的：张力积累` |
| 冲刺/高速位移 | `侧面追踪（lateral tracking）高速，背景横向流动，目的：速度感` |
| 击中/格挡瞬间 | `固定镜头 → 冲击帧镜头震动（0.3s）→ 固定，目的：冲击力物理震感` |
| 腾空/跃起 | `低角度仰拍（low angle upward）→ 随角色弧线轻微tilt上扬，目的：壮阔感` |
| 能量爆发 | `固定全景 → 冲击波扩散至画面边缘时缓慢dolly out，目的：规模感` |
| 开场建立 | `宽全景固定，双方同框，目的：建立战场空间和双方位置关系` |


