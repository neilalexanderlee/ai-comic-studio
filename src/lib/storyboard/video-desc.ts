/**
 * videoDesc 12维结构化字符串组装（Toonflow 标准格式）
 *
 * 格式：（画面描述、场景、关联资产名称、时长、景别、运镜、角色动作、情绪、光影氛围、台词、音效、关联资产ID）
 *
 * 用途：
 * - 作为 Seedance 多参模式视频提示词的核心输入
 * - 作为 universalFirstAndLastFrameMode 的结构化描述
 * - 供监督层质量校验（T13）逐字段检查
 */

export type VideoDescDialogue = {
  characterName: string;
  text: string;
  /** 台词类型：普通对白 / 内心独白 / 画外音 */
  type: "dialogue" | "os" | "vo";
};

export type VideoDescParams = {
  /** 第1维：画面描述（分镜主体动作描述，来自 shot.prompt） */
  sceneDescription: string;
  /** 第2维：场景（场景名称，来自分镜文字或项目资产） */
  sceneName?: string | null;
  /** 第3维：关联资产名称（角色名/场景名，顿号分隔） */
  assetNames?: string | null;
  /** 第4维：时长（秒数，来自 shot.duration） */
  duration: number;
  /** 第5维：景别（来自 shot.framing） */
  framing?: string | null;
  /** 第6维：运镜（来自 shot.cameraDirection） */
  cameraDirection?: string | null;
  /** 第7维：角色动作（来自 shot.motionScript，含 ｜朝向：标注） */
  motionScript?: string | null;
  /** 第8维：情绪（来自 shot.emotion） */
  emotion?: string | null;
  /** 第9维：光影氛围（来自 shot.lightingAtm） */
  lightingAtm?: string | null;
  /** 第10维：台词（列表，含类型） */
  dialogues?: VideoDescDialogue[];
  /** 第11维：音效（来自 shot.soundEffectNote） */
  soundEffect?: string | null;
  /** 第12维：关联资产ID（斜杠分隔，如 A001/A002/A003） */
  assetIds?: string | null;
};

/** 台词类型 → 标准前缀映射 */
const DIALOGUE_TYPE_PREFIX: Record<VideoDescDialogue["type"], string> = {
  dialogue: "说：",
  os: "内心OS：",
  vo: "画外音VO：",
};

/**
 * 组装 12 维 videoDesc 字符串。
 * 空字段输出空字符串（保留顿号位置），不抛异常。
 */
export function buildVideoDesc(params: VideoDescParams): string {
  const {
    sceneDescription,
    sceneName,
    assetNames,
    duration,
    framing,
    cameraDirection,
    motionScript,
    emotion,
    lightingAtm,
    dialogues = [],
    soundEffect,
    assetIds,
  } = params;

  // 第10维：台词字符串组装
  let dialogueStr = "无台词";
  if (dialogues.length > 0) {
    dialogueStr = dialogues
      .map((d) => {
        const prefix = DIALOGUE_TYPE_PREFIX[d.type] ?? "说：";
        return `${d.characterName}${prefix}「${d.text}」`;
      })
      .join("；");
  }

  // 第7维：角色动作（截去 ｜朝向：标注部分保持简洁，完整标注保留在 motionScript 字段）
  const motionDesc = motionScript
    ? motionScript.replace(/｜朝向：[^\n]+/, "").trim()
    : "";

  const fields = [
    sceneDescription || "",           // 1. 画面描述
    sceneName || "",                   // 2. 场景
    assetNames || "",                  // 3. 关联资产名称
    `${duration}s`,                    // 4. 时长
    framing || "",                     // 5. 景别
    cameraDirection || "",             // 6. 运镜
    motionDesc,                        // 7. 角色动作
    emotion || "",                     // 8. 情绪
    lightingAtm || "",                 // 9. 光影氛围
    dialogueStr,                       // 10. 台词
    soundEffect || "无音效",           // 11. 音效
    assetIds || "",                    // 12. 关联资产ID
  ];

  return `（${fields.join("、")}）`;
}

/**
 * 从 shot 数据和角色列表快速构建 videoDesc（路由层便捷入口）
 */
export function buildVideoDescFromShot(params: {
  shot: {
    prompt?: string | null;
    duration: number;
    framing?: string | null;
    cameraDirection?: string | null;
    motionScript?: string | null;
    emotion?: string | null;
    lightingAtm?: string | null;
    soundEffectNote?: string | null;
  };
  /** 角色名列表（按 associateAssets 顺序） */
  characterNames?: string[];
  /** 场景名 */
  sceneName?: string;
  /** 台词列表 */
  dialogues?: VideoDescDialogue[];
  /** 资产ID列表（斜杠拼接） */
  assetIds?: string[];
}): string {
  const { shot, characterNames = [], sceneName, dialogues, assetIds = [] } = params;

  return buildVideoDesc({
    sceneDescription: shot.prompt || "",
    sceneName: sceneName || "",
    assetNames: characterNames.join("/") || null,
    duration: shot.duration,
    framing: shot.framing,
    cameraDirection: shot.cameraDirection,
    motionScript: shot.motionScript,
    emotion: shot.emotion,
    lightingAtm: shot.lightingAtm,
    dialogues,
    soundEffect: shot.soundEffectNote,
    assetIds: assetIds.join("/") || null,
  });
}
