import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

export const projects = sqliteTable("projects", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().default(""),
  title: text("title").notNull(),
  idea: text("idea").default(""),
  script: text("script").default(""),
  status: text("status", {
    enum: ["draft", "processing", "completed"],
  })
    .notNull()
    .default("draft"),
  finalVideoUrl: text("final_video_url"),
  useProjectPrompts: integer("use_project_prompts").notNull().default(0),
  visualStyle: text("visual_style").notNull().default("anime_2d"),
  /** 画面比例："16:9" | "9:16" | "1:1"，驱动帧/视频生成 ratio 与视频编辑器画布尺寸 */
  videoRatio: text("video_ratio").notNull().default("16:9"),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const episodes = sqliteTable("episodes", {
  id: text("id").primaryKey(),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  sequence: integer("sequence").notNull(),
  idea: text("idea").default(""),
  script: text("script").default(""),
  status: text("status", {
    enum: ["draft", "processing", "completed"],
  })
    .notNull()
    .default("draft"),
  description: text("description").default(""),
  keywords: text("keywords").default(""),
  finalVideoUrl: text("final_video_url"),
  editorState: text("editor_state"),  // JSON 快照：时间线轨道+clip 数据
  targetDurationSeconds: integer("target_duration_seconds"),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const characters = sqliteTable("characters", {
  id: text("id").primaryKey(),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  description: text("description").default(""),
  visualHint: text("visual_hint").default(""),
  /**
   * 声音属性描述（Seedance 1.5-pro 官方公式）：
   * 性别 + 年龄区间 + 声音属性 + 语速 + 情绪基线
   * 示例："男性，约25岁，声音低沉沙哑，语速缓慢，情绪压抑克制"
   * 由角色提取 AI 根据角色描述自动生成，也可在 UI 手动编辑。
   */
  voiceHint: text("voice_hint").default(""),
  referenceImage: text("reference_image"),
  beautyImage: text("beauty_image"),
  combatImage: text("combat_image"),
  scope: text("scope", { enum: ["main", "guest"] }).notNull().default("main"),
  episodeId: text("episode_id").references(() => episodes.id, {
    onDelete: "cascade",
  }),
  /**
   * 火山方舟「私域虚拟人像素材资产库」的素材组合 ID（group-xxxxx）。
   * 一个角色对应一个素材组，组内可放该角色的多张素材（全身正面图+人脸特写图）。
   * 由 ark-asset-library.ts 的 createAssetGroup() 首次注册时创建并写入。
   */
  arkAssetGroupId: text("ark_asset_group_id"),
});

export const episodeCharacters = sqliteTable("episode_characters", {
  id: text("id").primaryKey(),
  episodeId: text("episode_id")
    .notNull()
    .references(() => episodes.id, { onDelete: "cascade" }),
  characterId: text("character_id")
    .notNull()
    .references(() => characters.id, { onDelete: "cascade" }),
});

export const characterAssets = sqliteTable("character_assets", {
  id: text("id").primaryKey(),
  characterId: text("character_id")
    .notNull()
    .references(() => characters.id, { onDelete: "cascade" }),
  imagePath: text("image_path"),
  tag: text("tag").notNull().default("日常"),
  isDefault: integer("is_default").notNull().default(0),
  assetType: text("asset_type", { enum: ["morph", "blueprint", "prop"] })
    .notNull()
    .default("morph"),
  /**
   * 角色参考音频路径（MP3 / WAV / M4A）。
   * 用于 Seedance 2.0 多参模式的音色克隆（@参考N 音频类型）。
   * 有值时对应 SeedanceAsset.hasAudio = true，生成视频时角色说话声音克隆自该音频。
   */
  audioPath: text("audio_path"),
  /**
   * 角度标签：null=正面原图（用户上传），"3q"=3/4侧面，"profile"=正侧面，"back"=背面。
   * 由 expand_character_asset action 从正面定妆图自动生成角度变体。
   */
  angle: text("angle"),
  /**
   * 若是扩展生成的角度资产，指向来源正面资产的 ID（用户直接上传的原始资产此字段为 null）。
   */
  sourceAssetId: text("source_asset_id"),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
  /**
   * 火山方舟私域素材库 —— 该资产注册后拿到的素材 ID（asset-xxxxx，不含 asset:// 前缀）。
   * 永久有效（不像「信任模型产物」有 30 天窗口）。
   * 视频生成时优先用 `asset://<arkAssetId>` 替代本地图片路径，绕过 Seedance 2.0 真人人脸拦截。
   */
  arkAssetId: text("ark_asset_id"),
  /** none=未注册，pending=已提交等待火山处理，active=可用，failed=处理失败需重传 */
  arkAssetStatus: text("ark_asset_status", { enum: ["none", "pending", "active", "failed"] })
    .notNull()
    .default("none"),
  arkAssetRegisteredAt: integer("ark_asset_registered_at", { mode: "timestamp" }),
});

export const storyboardVersions = sqliteTable("storyboard_versions", {
  id: text("id").primaryKey(),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  label: text("label").notNull(),
  versionNum: integer("version_num").notNull(),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
  episodeId: text("episode_id").references(() => episodes.id, {
    onDelete: "cascade",
  }),
});

export const shots = sqliteTable("shots", {
  id: text("id").primaryKey(),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  sequence: integer("sequence").notNull(),
  prompt: text("prompt").default(""),
  startFrameDesc: text("start_frame_desc"),
  endFrameDesc: text("end_frame_desc"),
  motionScript: text("motion_script"),
  cameraDirection: text("camera_direction").default("static"),
  duration: integer("duration").notNull().default(10),
  /** 本镜构图/视频用的首帧（生成、上传或参考重绘） */
  anchorFirst: text("anchor_first"),
  /** 首帧公网 URL（图片 API 返回），供 Seedance 请求避免 base64 */
  anchorFirstRemoteUrl: text("anchor_first_remote_url"),
  /** AI 生成的尾帧锚点（首尾帧插值视频终点，可选） */
  anchorLastAi: text("anchor_last_ai"),
  /** AI 尾帧公网 URL */
  anchorLastAiRemoteUrl: text("anchor_last_ai_remote_url"),
  videoUrl: text("video_url"),
  remoteVideoUrl: text("remote_video_url"),
  remoteVideoTaskId: text("remote_video_task_id"),
  remoteVideoStatus: text("remote_video_status"),
  remoteVideoCreatedAt: integer("remote_video_created_at", { mode: "timestamp" }),
  remoteVideoExpiresAt: integer("remote_video_expires_at", { mode: "timestamp" }),
  remoteVideoLastDownloadAt: integer("remote_video_last_download_at", { mode: "timestamp" }),
  videoPrompt: text("video_prompt"),
  /** 首/尾帧路径+mtime 指纹；与 videoPrompt 对照以触发 B2 自动 vision 刷新 */
  videoPromptFrameFingerprint: text("video_prompt_frame_fingerprint"),
  episodeId: text("episode_id").references(() => episodes.id, {
    onDelete: "cascade",
  }),
  versionId: text("version_id").references(() => storyboardVersions.id, {
    onDelete: "cascade",
  }),
  status: text("status", {
    enum: ["pending", "generating", "completed", "failed"],
  })
    .notNull()
    .default("pending"),
  warnings: text("warnings"),
  /** 视频生成/增强的分辨率。null = 未知（历史数据），"480p" = 已生成待增强，"720p" = 已增强或直接生成 720p */
  videoResolution: text("video_resolution"),
  /**
   * 视频真实切点（Seedance return_last_frame 下载路径）。
   * 仅作审阅与「参考图生成首帧」来源，不自动写入下一镜 anchor_first。
   */
  cutPoint: text("cut_point"),
  /** 首帧参考来源分镜 id（可选，追溯用） */
  chainSourceShotId: text("chain_source_shot_id"),
  /** 首帧参考类型：anchor_first | anchor_last_ai | cut_point */
  chainSourceType: text("chain_source_type"),
  /** 首帧连续性模式：strict_start = 视频严格从 anchor_first 开始；reference_redraw = 仅追溯参考重绘来源 */
  anchorFirstContinuityMode: text("anchor_first_continuity_mode", {
    enum: ["strict_start", "reference_redraw"],
  }),
  /**
   * 背景音乐注记（从剧本 【背景音】 标签提取）。
   * 仅供后期剪辑参考，绝不注入视频生成 prompt。
   * 存储后用于精确剔除 motionScript/videoScript 中可能残留的 BGM 描述（取代正则匹配）。
   */
  bgmNote: text("bgm_note"),
  /**
   * 场景级音效提示（从剧本 【音效】 标签提取，如"火焰噼啪、金属碰撞、脚步声"）。
   * 在视频生成 prompt 中作为 SFX 提示注入，引导 Seedance/Kling 生成对应的原生音效。
   */
  soundEffectNote: text("sound_effect_note"),
  /**
   * 视频分组标识（Seedance 多参模式）。
   * 同 track 的连续分镜会被合并为一次多分镜视频生成请求（累计时长 ≤ 15s 为一组）。
   * 示例："T1" / "T2"。null 表示未分配，按单镜独立生成。
   */
  track: text("track"),
  /**
   * 分镜级道具绑定（JSON 数组，存 character_assets.id）。
   * 用户在分镜卡上手动勾选本镜需要使用的道具图（assetType="prop"）。
   * 生成首帧/视频时，对应资产的 imagePath 加入参考图列表。
   * null 或 "[]" 表示本镜不附加任何道具参考。
   */
  propRefs: text("prop_refs"),
});

/** 分镜视频历史版本，每个分镜最多保留 5 条，超出时应用层删除最旧记录和文件 */
export const shotVideoHistory = sqliteTable("shot_video_history", {
  id: text("id").primaryKey(),
  shotId: text("shot_id")
    .notNull()
    .references(() => shots.id, { onDelete: "cascade" }),
  videoUrl: text("video_url").notNull(),
  resolution: text("resolution"),       // "480p" | "720p" | null
  label: text("label"),                 // "生成" | "增强↑720p" 等
  createdAt: integer("created_at").notNull(), // Unix ms
});


export const importLogs = sqliteTable("import_logs", {
  id: text("id").primaryKey(),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  step: integer("step").notNull(),
  status: text("status", { enum: ["running", "done", "error"] })
    .notNull()
    .default("running"),
  message: text("message").notNull().default(""),
  metadata: text("metadata", { mode: "json" }),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const promptTemplates = sqliteTable("prompt_templates", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  promptKey: text("prompt_key").notNull(),
  slotKey: text("slot_key"),
  scope: text("scope", { enum: ["global", "project"] }).notNull().default("global"),
  projectId: text("project_id"),
  content: text("content").notNull(),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const promptVersions = sqliteTable("prompt_versions", {
  id: text("id").primaryKey(),
  templateId: text("template_id")
    .notNull()
    .references(() => promptTemplates.id, { onDelete: "cascade" }),
  content: text("content").notNull(),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const promptPresets = sqliteTable("prompt_presets", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  userId: text("user_id"),
  promptKey: text("prompt_key").notNull(),
  slots: text("slots", { mode: "json" }).notNull(),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const providerSecrets = sqliteTable("provider_secrets", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  providerId: text("provider_id").notNull(),
  apiKey: text("api_key").notNull().default(""),
  secretKey: text("secret_key"),
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

/**
 * 火山方舟「私域虚拟人像素材资产库」账号级凭证。
 * 与 provider_secrets（Bearer API Key）分开存储 —— 素材库管控面 API（CreateAssetGroup/
 * CreateAsset/GetAsset）用的是 AK/SK 签名鉴权，不是普通 Bearer Key。
 * 每个用户最多一套凭证（够用：私域素材库是账号级能力，不区分 Provider/模型）。
 */
export const arkAssetLibraryCredentials = sqliteTable("ark_asset_library_credentials", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().unique(),
  accessKeyId: text("access_key_id").notNull().default(""),
  secretAccessKey: text("secret_access_key").notNull().default(""),
  /** 素材组/素材所属的方舟项目名，默认 default；需与调用视频生成 API 的 Key 所属项目一致 */
  projectName: text("project_name").notNull().default("default"),
  region: text("region").notNull().default("cn-beijing"),
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

/** 无登录场景下 model-store 的服务端备份（与 zustand partialize 同形，不含密钥） */
export const userClientPrefs = sqliteTable("user_client_prefs", {
  userId: text("user_id").primaryKey().notNull(),
  modelStoreJson: text("model_store_json").notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  username: text("username").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  /**
   * 会话版本号。改密码或「登出所有设备」时自增，使此前签发的所有 cookie 立即失效。
   * cookie 里带着签发时的版本号（见 lib/auth.ts），异步校验路径会比对这个字段。
   */
  tokenVersion: integer("token_version").notNull().default(0),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const tasks = sqliteTable("tasks", {
  id: text("id").primaryKey(),
  projectId: text("project_id").references(() => projects.id, {
    onDelete: "cascade",
  }),
  type: text("type", {
    enum: [
      "script_parse",
      "character_extract",
      "character_image",
      "shot_split",
      "frame_generate",
      "video_generate",
      "video_assemble",
    ],
  }).notNull(),
  status: text("status", {
    enum: ["pending", "running", "completed", "failed"],
  })
    .notNull()
    .default("pending"),
  payload: text("payload", { mode: "json" }),
  result: text("result", { mode: "json" }),
  error: text("error"),
  retries: integer("retries").notNull().default(0),
  maxRetries: integer("max_retries").notNull().default(3),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
  scheduledAt: integer("scheduled_at", { mode: "timestamp" }),
  episodeId: text("episode_id").references(() => episodes.id, {
    onDelete: "cascade",
  }),
});

/**
 * Track 级别合并视频表。
 * Seedance 多参批量生成后，将同 track 的分镜合并成一个视频文件，
 * 写入此表（而非 shot.videoUrl），在剪辑台按 track 导入整段视频。
 */
export const trackVideos = sqliteTable("track_videos", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull(),
  episodeId: text("episode_id"),
  versionId: text("version_id"),
  /** Track 标识符，如 "T1" / "T2" */
  trackId: text("track_id").notNull(),
  /** 本地视频文件路径 */
  videoUrl: text("video_url").notNull(),
  /** 累计时长（秒） */
  totalDuration: integer("total_duration"),
  /** 包含的分镜数量 */
  shotCount: integer("shot_count"),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});
