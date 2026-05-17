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
  generationMode: text('generation_mode', { enum: ['keyframe', 'reference'] }).notNull().default('keyframe'),
  useProjectPrompts: integer("use_project_prompts").notNull().default(0),
  visualStyle: text("visual_style").notNull().default("anime_2d"),
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
  generationMode: text("generation_mode", { enum: ["keyframe", "reference"] })
    .notNull()
    .default("keyframe"),
  description: text("description").default(""),
  keywords: text("keywords").default(""),
  finalVideoUrl: text("final_video_url"),
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
  referenceImage: text("reference_image"),
  beautyImage: text("beauty_image"),
  combatImage: text("combat_image"),
  scope: text("scope", { enum: ["main", "guest"] }).notNull().default("main"),
  episodeId: text("episode_id").references(() => episodes.id, {
    onDelete: "cascade",
  }),
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
  assetType: text("asset_type", { enum: ["morph", "blueprint"] })
    .notNull()
    .default("morph"),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
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
  firstFrame: text("first_frame"),
  lastFrame: text("last_frame"),
  videoUrl: text("video_url"),
  referenceVideoUrl: text("reference_video_url"),
  remoteVideoUrl: text("remote_video_url"),
  remoteVideoTaskId: text("remote_video_task_id"),
  remoteVideoStatus: text("remote_video_status"),
  remoteVideoCreatedAt: integer("remote_video_created_at", { mode: "timestamp" }),
  remoteVideoExpiresAt: integer("remote_video_expires_at", { mode: "timestamp" }),
  remoteVideoLastDownloadAt: integer("remote_video_last_download_at", { mode: "timestamp" }),
  remoteReferenceVideoUrl: text("remote_reference_video_url"),
  remoteReferenceVideoTaskId: text("remote_reference_video_task_id"),
  remoteReferenceVideoStatus: text("remote_reference_video_status"),
  remoteReferenceVideoCreatedAt: integer("remote_reference_video_created_at", { mode: "timestamp" }),
  remoteReferenceVideoExpiresAt: integer("remote_reference_video_expires_at", { mode: "timestamp" }),
  remoteReferenceVideoLastDownloadAt: integer("remote_reference_video_last_download_at", { mode: "timestamp" }),
  lastFrameUrl: text("last_frame_url"),
  sceneRefFrame: text("scene_ref_frame"),
  videoScript: text("video_script"),
  videoPrompt: text("video_prompt"),
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

export const dialogues = sqliteTable("dialogues", {
  id: text("id").primaryKey(),
  shotId: text("shot_id")
    .notNull()
    .references(() => shots.id, { onDelete: "cascade" }),
  characterId: text("character_id")
    .notNull()
    .references(() => characters.id, { onDelete: "cascade" }),
  text: text("text").notNull(),
  audioUrl: text("audio_url"),
  sequence: integer("sequence").notNull().default(0),
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
