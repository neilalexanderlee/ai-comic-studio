/**
 * videoDesc 9维结构化字符串组装（完全对齐 Toonflow 精简格式）
 *
 * 格式：（画面描述、场景、关联资产名称、时长、运镜、角色动作、台词、音效、关联资产ID）
 *
 * 注：emotion / framing / lightingAtm 三个冗余字段已从数据库完全移除（migration 0042/0043）：
 * - 景别 → 内含于 cameraDirection（如"起幅[中景]→..."）及 startFrameDesc 开头
 * - 情绪 → 内含于 startFrameDesc 情绪身体解剖表现（四要素之④）
 * - 光影氛围 → 内含于 startFrameDesc 主光描述（四要素之③）
 *
 * 用途：
 * - 作为 Seedance 多参模式视频提示词的核心输入
 * - 供监督层质量校验逐字段检查
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
  /** 第5维：运镜（来自 shot.cameraDirection；含景别信息如"起幅[中景]→..."） */
  cameraDirection?: string | null;
  /** 第6维：角色动作（来自 shot.motionScript，含 ｜朝向：标注） */
  motionScript?: string | null;
  /** 第7维：台词（列表，含类型） */
  dialogues?: VideoDescDialogue[];
  /** 第8维：音效（来自 shot.soundEffectNote） */
  soundEffect?: string | null;
  /** 第9维：关联资产ID（斜杠分隔，如 A001/A002/A003） */
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
    cameraDirection,
    motionScript,
    dialogues = [],
    soundEffect,
    assetIds,
  } = params;

  // 第7维：台词字符串组装
  let dialogueStr = "无台词";
  if (dialogues.length > 0) {
    dialogueStr = dialogues
      .map((d) => {
        const prefix = DIALOGUE_TYPE_PREFIX[d.type] ?? "说：";
        return `${d.characterName}${prefix}「${d.text}」`;
      })
      .join("；");
  }

  // 第6维：角色动作（截去 ｜朝向：标注部分保持简洁，完整标注保留在 motionScript 字段）
  const motionDesc = motionScript
    ? motionScript.replace(/｜朝向：[^\n]+/, "").trim()
    : "";

  const fields = [
    sceneDescription || "",           // 1. 画面描述
    sceneName || "",                   // 2. 场景
    assetNames || "",                  // 3. 关联资产名称
    `${duration}s`,                    // 4. 时长
    cameraDirection || "",             // 5. 运镜
    motionDesc,                        // 6. 角色动作
    dialogueStr,                       // 7. 台词
    soundEffect || "无音效",           // 8. 音效
    assetIds || "",                    // 9. 关联资产ID
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
    cameraDirection?: string | null;
    motionScript?: string | null;
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
    cameraDirection: shot.cameraDirection,
    motionScript: shot.motionScript,
    dialogues,
    soundEffect: shot.soundEffectNote,
    assetIds: assetIds.join("/") || null,
  });
}
